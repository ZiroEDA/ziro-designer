// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerbview_frame.cpp` + `gerbview_frame.h`: `GERBVIEW_FRAME`, the
 * Gerber viewer's frame - the image list and active layer, the layer and
 * element visibility on the canvas's VIEW, the page, the toolbar boxes, the
 * tools, and the status bar.
 *
 * The wx window construction (AUI panes, icons, the menu bar) is the page's
 * (`designer/.../GerberViewer.tsx`), which builds the frame and hands it the
 * canvas with {@link GERBVIEW_FRAME.AttachCanvas}: the half of the C++
 * constructor that runs once the GAL panel exists.
 *
 * The members KiCad defines in other files keep their files:
 * `clear_gbr_drawlayers.ts`, `events_called_functions.ts` and the
 * `update*SelectBox` half of `toolbars_gerber.ts` export the bodies, bound
 * here.
 */

import type { Color4d } from '@ziroeda/common/color4d.js';
import { EDA_DRAW_FRAME } from '@ziroeda/common/eda_draw_frame.js';
import { CANDIDATE } from '@ziroeda/common/eda_item_flags.js';
import { BASE_SCREEN } from '@ziroeda/common/base_screen.js';
import { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import { GAL_TYPE } from '@ziroeda/common/draw_panel_gal.js';
import {
  GAL_LAYER_ID,
  GERBER_DCODE_LAYER,
  GERBER_DRAW_LAYER,
  GERBER_DRAWLAYERS_COUNT,
  GERBVIEW_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { DEFAULT_THEME, GetColorSettings } from '@ziroeda/common/pgm_base.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import {
  TOOL_MANAGER,
  type TOOL_MANAGER_VIEW_CONTROLS,
} from '@ziroeda/common/tool/tool_manager.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import type { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { ORIGIN_TRANSFORMS } from '@ziroeda/common/origin_transforms.js';
import { VIEW_UPDATE_FLAGS, type VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { wxChoice } from '@ziroeda/common/wx/choice.js';
import { messageTextFromValue } from '@ziroeda/common/eda_units.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { Clear_DrawLayers, Erase_Current_DrawLayer } from './clear_gbr_drawlayers.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import {
  LoadAutodetectedFiles,
  LoadExcellonFiles,
  LoadGerberFiles,
  LoadListOfGerberAndDrillFiles,
  LoadZipArchiveFile,
} from './files.js';
import { Read_EXCELLON_File } from './excellon_read_drill_file.js';
import { LoadGerberJobFile } from './job_file_reader.js';
import { Read_GERBER_File } from './readgerb.js';
import {
  OnSelectActiveDCode,
  OnSelectActiveLayer,
  OnSelectHighlightChoice,
} from './events_called_functions.js';
import { GBR_LAYOUT } from './gbr_layout.js';
import { GERBER_DRAW_ITEM } from './gerber_draw_item.js';
import type { GERBER_FILE_IMAGE } from './gerber_file_image.js';
import {
  GERBER_FILE_IMAGE_LIST as GERBER_FILE_IMAGE_LIST_CLASS,
  type GERBER_FILE_IMAGE_LIST,
  GERBER_ORDER_ENUM,
} from './gerber_file_image_list.js';
import { wxDirExists, wxFileExists } from '@ziroeda/common/wx/filefn.js';
import { gerbIUScale } from './gerbview.js';
import type { GERBVIEW_DRAW_PANEL_GAL } from './gerbview_draw_panel_gal.js';
import type { GERBVIEW_PAINTER } from './gerbview_painter.js';
import type { GERBVIEW_SETTINGS } from './gerbview_settings.js';
import {
  OnUpdateSelectDCode,
  updateAperAttributesSelectBox,
  updateComponentListSelectBox,
  updateDCodeSelectBox,
  updateNetnameListSelectBox,
} from './toolbars_gerber.js';
import { GERBVIEW_ACTIONS } from './tools/gerbview_actions.js';
import { GERBVIEW_CONTROL } from './tools/gerbview_control.js';
import { GERBVIEW_INSPECTION_TOOL } from './tools/gerbview_inspection_tool.js';
import { GERBVIEW_SELECTION_TOOL } from './tools/gerbview_selection_tool.js';
import { DCODE_SELECTION_BOX } from './widgets/dcode_selection_box.js';
import { GBR_LAYER_BOX_SELECTOR } from './widgets/gbr_layer_box_selector.js';

export const GERBVIEW_FRAME_NAME = 'GerberFrame';

/// `#define NO_AVAILABLE_LAYERS UNDEFINED_LAYER`
export const NO_AVAILABLE_LAYERS = UNDEFINED_LAYER;

/**
 * What the frame asks of its window for the modal wx calls KiCad makes: the
 * file dialog, the HTML message box, the info bar and wxMessageBox. The page
 * implements it; files it returns are paths in the page's file systems
 * (`common/wx/filefn.ts`).
 */
export interface GERBVIEW_FRAME_HOST {
  /** `wxFileDialog( title, path, name, wildcards )`: the chosen paths, or null on Cancel. */
  FileDialog(
    aTitle: string,
    aFilters: readonly ChooserFilter[],
    aMultiple: boolean,
    aFilterIndex: number,
  ): Promise<{ paths: string[]; filterIndex: number } | null>;
  /** `HTML_MESSAGE_BOX( this, caption ).ListSet( messages ).ShowModal()`. */
  HtmlMessageBox(aCaption: string, aMessages: string): Promise<void>;
  /** `ShowInfoBarError( msg )`. */
  InfoBarError(aMessage: string): void;
  /** `wxMessageBox( msg )`. */
  MessageBox(aMessage: string): Promise<void>;
  /** `UpdateFileHistory( path, &history )`. */
  UpdateFileHistory(aPath: string, aHistory: 'gerber' | 'drill' | 'zip' | 'job'): void;
  /** A `wxFD_SAVE | wxFD_OVERWRITE_PROMPT` dialog: the chosen path, or null. */
  SaveFileDialog(
    aTitle: string,
    aDefaultName: string,
    aFilters: readonly ChooserFilter[],
  ): Promise<string | null>;
  /**
   * `DIALOG_MAP_GERBER_LAYERS_TO_PCB`: the layer look-up table and copper
   * count on OK, null on Cancel.
   */
  MapGerberLayersToPcb(): Promise<{ lookUp: number[]; copperLayersCount: number } | null>;
  /** Write a text file the user chose to save. */
  SaveTextFile(aPath: string, aText: string): void;
  /** `wxSingleChoiceDialog( this, message, caption, choices ).ShowModal()`, the result unread. */
  SingleChoiceDialog(aCaption: string, aChoices: readonly string[]): Promise<void>;
}

/** No window: nothing chosen, nothing shown. */
const NO_HOST: GERBVIEW_FRAME_HOST = {
  FileDialog: () => Promise.resolve(null),
  HtmlMessageBox: () => Promise.resolve(),
  InfoBarError: () => {},
  MessageBox: () => Promise.resolve(),
  UpdateFileHistory: () => {},
  SaveFileDialog: () => Promise.resolve(null),
  MapGerberLayersToPcb: () => Promise.resolve(null),
  SaveTextFile: () => {},
  SingleChoiceDialog: () => Promise.resolve(),
};

export class GERBVIEW_FRAME extends EDA_DRAW_FRAME {
  /// The page's text control, `m_TextInfo`, as its value.
  m_TextInfo = '';

  /// A choice box to display and highlight component graphic items.
  m_SelComponentBox: wxChoice | null = null;
  /// A choice box to display and highlight netlist graphic items.
  m_SelNetnameBox: wxChoice | null = null;
  /// A choice box to display aperture attributes and highlight items.
  m_SelAperAttributesBox: wxChoice | null = null;
  /// The combobox to select the current active graphic layer.
  m_SelLayerBox: GBR_LAYER_BOX_SELECTOR | null = null;
  /// A list box to select the dcode Id to highlight.
  m_DCodeSelector: DCODE_SELECTION_BOX | null = null;

  /// The last filename chosen to be proposed to the user.
  m_lastFileName = '';
  /// `EDA_BASE_FRAME::m_mruPath`: the directory the last dialog was in.
  m_mruPath = '';

  private m_host: GERBVIEW_FRAME_HOST = NO_HOST;

  /// The frame title `SetTitle` sets.
  private m_title = 'Gerber Viewer';
  private m_settings: GERBVIEW_SETTINGS;

  m_show_layer_manager_tools: boolean;
  private m_gerberLayout: GBR_LAYOUT | null;
  private m_activeLayer: number;
  private m_grid_origin: VECTOR2I = { x: 0, y: 0 };
  /// used only to show paper limits to screen
  private m_paper: PAGE_INFO;
  private m_gridColor: Color4d | null = null;

  /// The page's repaint of the frame chrome (layer box, text info, title).
  private m_uiListener: (() => void) | null = null;
  private m_originTransforms = new ORIGIN_TRANSFORMS();

  constructor(aSettings: GERBVIEW_SETTINGS) {
    super(FRAME_T.FRAME_GERBER, gerbIUScale, 'mm');

    this.m_settings = aSettings;
    this.m_activeLayer = 0;
    this.m_gerberLayout = null;
    this.m_show_layer_manager_tools = true;
    this.m_showBorderAndTitleBlock = false; // true for reference drawings.

    // Be sure a page info is set. this default value will be overwritten later.
    this.m_paper = new PAGE_INFO(PAGE_SIZE_TYPE.GERBER);
    this.SetLayout(new GBR_LAYOUT());
    this.m_paper = new PAGE_INFO(PAGE_SIZE_TYPE.GERBER);
  }

  GetName(): string {
    return GERBVIEW_FRAME_NAME;
  }

  GetOriginTransforms(): ORIGIN_TRANSFORMS {
    return this.m_originTransforms;
  }

  /** The page's repaint hook for the frame's own widgets. */
  SetUiListener(aListener: (() => void) | null): void {
    this.m_uiListener = aListener;
  }

  protected uiChanged(): void {
    this.m_uiListener?.();
  }

  /**
   * The rest of the constructor, once the page has made the canvas:
   * `SetCanvas`, draw priority for negative objects, the page and screen,
   * the settings, the tools and the units, then ActivateGalCanvas.
   */
  AttachCanvas(aCanvas: GERBVIEW_DRAW_PANEL_GAL): void {
    this.SetCanvas(aCanvas);

    // GerbView requires draw priority for rendering negative objects
    aCanvas.GetView().UseDrawPriority(true);

    this.SetPageSettings(this.m_paper);

    this.SetVisibleLayers(LSET.AllLayersMask()); // All draw layers visible.

    this.SetScreen(new BASE_SCREEN(this.GetPageSettings().GetSizeIU(gerbIUScale.IU_PER_MILS)));

    // LoadSettings() *after* creating m_LayersManager, because LoadSettings()
    // initialize parameters in m_LayersManager
    this.LoadSettings(this.config());

    this.setupTools();

    this.ReFillLayerWidget(); // this is near end because contents establish size

    this.SetActiveLayer(0, true);
    this.m_toolManager!.PostAction(ACTIONS.zoomFitScreen);

    this.SwitchCanvas(GAL_TYPE.GAL_TYPE_OPENGL);

    this.setupUnits(this.config());

    // Enable the axes to match legacy draw style
    const galOptions = this.GetGalDisplayOptions();
    galOptions.m_axesEnabled = true;
    galOptions.NotifyChanged();

    this.m_toolManager!.RunAction(ACTIONS.zoomFitScreen);
  }

  /** `GERBVIEW_FRAME::~GERBVIEW_FRAME` / doCloseWindow. */
  Destroy(): void {
    this.m_isClosing = true;

    // Shutdown all running tools
    if (this.m_toolManager) this.m_toolManager.ShutdownAllTools();

    this.GetCanvas()?.GetView().Clear();
    this.GetGerberLayout()?.GetImagesList().DeleteAllImages();
    this.GetCanvas()?.Destroy();
    this.SetCanvas(null);
  }

  override config(): GERBVIEW_SETTINGS {
    return this.m_settings;
  }

  gvconfig(): GERBVIEW_SETTINGS {
    return this.m_settings;
  }

  override LoadSettings(aCfg: GERBVIEW_SETTINGS): void {
    super.LoadSettings(aCfg);

    const cfg = aCfg;

    this.SetElementVisibility(
      GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET,
      cfg.m_Appearance.show_border_and_titleblock,
    );
    this.SetElementVisibility(
      GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS,
      cfg.m_Display.m_DisplayPageLimits,
    );

    const pageInfo = new PAGE_INFO(PAGE_SIZE_TYPE.GERBER);
    pageInfo.SetType(cfg.m_Appearance.page_type);
    this.SetPageSettings(pageInfo);

    this.SetElementVisibility(GERBVIEW_LAYER_ID.LAYER_DCODES, cfg.m_Appearance.show_dcodes);
    this.SetElementVisibility(
      GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS,
      cfg.m_Appearance.show_negative_objects,
    );
  }

  override SaveSettings(aCfg: GERBVIEW_SETTINGS): void {
    super.SaveSettings(aCfg);

    aCfg.m_Appearance.page_type = this.GetPageSettings().GetTypeAsString();
  }

  override GetColorSettings(_aForceRefresh = false): COLOR_SETTINGS {
    const cfg = this.m_settings;
    return GetColorSettings(cfg ? cfg.m_ColorTheme : DEFAULT_THEME);
  }

  // ---- the image list ------------------------------------------------------

  SetLayout(aLayout: GBR_LAYOUT): void {
    this.m_gerberLayout = aLayout;
  }

  GetGerberLayout(): GBR_LAYOUT {
    return this.m_gerberLayout!;
  }

  /**
   * Accessors to GERBER_FILE_IMAGE_LIST and GERBER_FILE_IMAGE data
   */
  GetImagesList(): GERBER_FILE_IMAGE_LIST {
    return this.m_gerberLayout!.GetImagesList();
  }

  GetGbrImage(aIdx: number): GERBER_FILE_IMAGE | null {
    return this.m_gerberLayout!.GetImagesList().GetGbrImage(aIdx);
  }

  ImagesMaxCount(): number {
    return this.m_gerberLayout!.GetImagesList().ImagesMaxCount();
  }

  /**
   * Find the next empty layer starting at \a aLayer and returns it to the caller.
   *
   * If no empty layers are found, #NO_AVAILABLE_LAYERS is return.
   */
  getNextAvailableLayer(): number {
    for (let i = 0; i < this.ImagesMaxCount(); ++i) {
      const gerber = this.GetGbrImage(i);

      if (gerber === null)
        // this graphic layer is available: use it
        return i;
    }

    return NO_AVAILABLE_LAYERS;
  }

  override GetDocumentExtents(_aIncludeAllVisible = true): BOX2I {
    console.assert(this.m_gerberLayout !== null);
    return this.m_gerberLayout!.ViewBBox();
  }

  GetGridOrigin(): VECTOR2I {
    return this.m_grid_origin;
  }

  SetGridOrigin(aPoint: VECTOR2I): void {
    this.m_grid_origin = aPoint;
  }

  // ---- the canvas's layers --------------------------------------------------

  private view() {
    return (this.GetCanvas() as GERBVIEW_DRAW_PANEL_GAL).GetView();
  }

  /**
   * Test whether a given element category is visible.
   *
   * @param aLayerID is an item id from the enum GERBVIEW_LAYER_ID_START
   * @return bool - true if the element is visible.
   */
  IsElementVisible(aLayerID: number): boolean {
    const cfg = this.gvconfig();

    switch (aLayerID) {
      case GERBVIEW_LAYER_ID.LAYER_DCODES:
        return cfg.m_Appearance.show_dcodes;
      case GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS:
        return cfg.m_Appearance.show_negative_objects;
      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID:
        return cfg.m_Window.grid.show;
      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET:
        return cfg.m_Appearance.show_border_and_titleblock;
      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS:
        return cfg.m_Display.m_DisplayPageLimits;
      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_BACKGROUND:
        return true;

      default:
        console.assert(false, `GERBVIEW_FRAME::IsElementVisible(): bad arg ${aLayerID}`);
    }

    return true;
  }

  /**
   * Change the visibility of an element category.
   *
   * @param aLayerID is an item id from the enum GERBVIEW_LAYER_ID_START
   * @param aNewState = The new visibility state of the element category
   */
  SetElementVisibility(aLayerID: number, aNewState: boolean): void {
    const view = this.GetCanvas() ? this.view() : null;
    const cfg = this.gvconfig();

    switch (aLayerID) {
      case GERBVIEW_LAYER_ID.LAYER_DCODES:
        cfg.m_Appearance.show_dcodes = aNewState;

        if (view) {
          for (let i = 0; i < GERBER_DRAWLAYERS_COUNT; i++) {
            const layer = GERBER_DRAW_LAYER(i);
            const dcode_layer = GERBER_DCODE_LAYER(layer);
            view.SetLayerVisible(dcode_layer, aNewState && view.IsLayerVisible(layer));
          }
        }

        break;

      case GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS:
        cfg.m_Appearance.show_negative_objects = aNewState;

        view?.UpdateAllItemsConditionally(VIEW_UPDATE_FLAGS.REPAINT, (aItem: VIEW_ITEM) => {
          // GetLayerPolarity() returns true for negative items
          return aItem instanceof GERBER_DRAW_ITEM && aItem.GetLayerPolarity();
        });

        break;

      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET:
        cfg.m_Appearance.show_border_and_titleblock = aNewState;

        this.m_showBorderAndTitleBlock = cfg.m_Appearance.show_border_and_titleblock;

        // NOTE: LAYER_DRAWINGSHEET always used for visibility, but the layer manager passes
        // LAYER_GERBVIEW_DRAWINGSHEET because of independent color control
        view?.SetLayerVisible(GAL_LAYER_ID.LAYER_DRAWINGSHEET, aNewState);
        break;

      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID:
        this.SetGridVisibility(aNewState);
        break;

      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS:
        cfg.m_Display.m_DisplayPageLimits = aNewState;
        this.SetPageSettings(this.GetPageSettings());
        break;

      default:
        console.assert(false, `GERBVIEW_FRAME::SetElementVisibility(): bad arg ${aLayerID}`);
    }

    if (this.GetCanvas()) this.ApplyDisplaySettingsToGAL();

    this.uiChanged();
  }

  /**
   * Updates the GAL with display settings changes
   */
  ApplyDisplaySettingsToGAL(): void {
    const painter = this.view().GetPainter() as GERBVIEW_PAINTER;
    const settings = painter.GetSettings();
    settings.SetHighContrast(this.gvconfig().m_Display.m_HighContrastMode);
    settings.LoadColors(this.GetColorSettings());

    this.view().MarkTargetDirty(RENDER_TARGET.TARGET_NONCACHED);
  }

  /**
   * A list of visible layers.
   *
   * @return each bit indicates a visible layer.
   */
  GetVisibleLayers(): LSET {
    const visible = LSET.AllLayersMask();

    if (this.GetCanvas()) {
      for (let i = 0; i < GERBER_DRAWLAYERS_COUNT; i++)
        visible.set(i, this.view().IsLayerVisible(GERBER_DRAW_LAYER(i)));
    }

    return visible;
  }

  /**
   * A list of visible layers.
   *
   * @param aLayerMask = The new bit-mask of visible layers
   */
  SetVisibleLayers(aLayerMask: LSET): void {
    if (this.GetCanvas()) {
      for (let i = 0; i < GERBER_DRAWLAYERS_COUNT; i++) {
        const v = aLayerMask.test(i);
        const layer = GERBER_DRAW_LAYER(i);
        this.view().SetLayerVisible(layer, v);
        this.view().SetLayerVisible(
          GERBER_DCODE_LAYER(layer),
          this.gvconfig().m_Appearance.show_dcodes && v,
        );
      }
    }

    if (this.gvconfig().m_Display.m_XORMode) this.UpdateXORLayers();

    this.uiChanged();
  }

  /**
   * Test whether a given layer is visible.
   *
   * @param aLayer = The layer to be tested (still 0-31!)
   * @return true if the layer is visible.
   */
  IsLayerVisible(aLayer: number): boolean {
    // m_LayersManager->IsLayerVisible( aLayer ): the manager's check box,
    // which is the view's visibility of the draw layer.
    return this.GetCanvas() ? this.view().IsLayerVisible(GERBER_DRAW_LAYER(aLayer)) : true;
  }

  /**
   * Return the color of a gerber visible element.
   */
  GetVisibleElementColor(aLayerID: number): Color4d | null {
    let color: Color4d | null = null;
    const settings = this.GetColorSettings();

    switch (aLayerID) {
      case GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS:
      case GERBVIEW_LAYER_ID.LAYER_DCODES:
      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET:
      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS:
      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_BACKGROUND:
        color = settings.GetColor(aLayerID);
        break;

      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID:
        color = this.GetGridColor();
        break;

      default:
        console.assert(false, `GERBVIEW_FRAME::GetVisibleElementColor(): bad arg ${aLayerID}`);
    }

    return color;
  }

  SetVisibleElementColor(aLayerID: number, aColor: Color4d): void {
    const settings = this.GetColorSettings();

    settings.SetColor(aLayerID, aColor);

    switch (aLayerID) {
      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET:
      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS:
        this.SetPageSettings(this.GetPageSettings());
        break;

      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID:
        this.SetGridColor(aColor);
        break;

      case GERBVIEW_LAYER_ID.LAYER_GERBVIEW_BACKGROUND:
        // SetDrawBgColor: the canvas clears to the painter's background colour.
        this.ApplyDisplaySettingsToGAL();
        break;

      default:
        break;
    }
  }

  /**
   * @return the color of a pcb layer.
   */
  GetLayerColor(aLayer: number): Color4d {
    return this.GetColorSettings().GetColor(aLayer);
  }

  /**
   * Change a layer color for any valid layer.
   */
  SetLayerColor(aLayer: number, aColor: Color4d): void {
    this.GetColorSettings().SetColor(aLayer, aColor);
    this.ApplyDisplaySettingsToGAL();
  }

  override SetGridVisibility(aVisible: boolean): void {
    super.SetGridVisibility(aVisible);
    // m_LayersManager->SetRenderState( LAYER_GERBVIEW_GRID, aVisible ): the
    // page's render tab reads IsElementVisible.
    this.uiChanged();
  }

  GetGridColor(): Color4d {
    return this.GetColorSettings().GetColor(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID);
  }

  SetGridColor(aColor: Color4d): void {
    this.GetColorSettings().SetColor(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID, aColor);
    this.GetCanvas()!.GetGAL().SetGridColor(aColor);
    this.m_gridColor = aColor;
  }

  // ---- the active layer and the layer widgets --------------------------------

  /**
   * change the currently active layer to \a aLayer and update the GERBER_LAYER_WIDGET.
   */
  SetActiveLayer(aLayer: number, doLayerWidgetUpdate = true): void {
    this.m_activeLayer = aLayer;

    if (this.gvconfig().m_Display.m_XORMode) this.UpdateXORLayers();

    // doLayerWidgetUpdate: m_LayersManager->SelectLayer / OnLayerSelected -
    // the page's layers pane follows GetActiveLayer.
    void doLayerWidgetUpdate;

    this.UpdateTitleAndInfo();

    this.m_toolManager?.PostAction(GERBVIEW_ACTIONS.layerChanged); // notify other tools
    this.GetCanvas()?.SetFocus(); // otherwise hotkeys are stuck somewhere

    this.GetCanvas()?.SetHighContrastLayer(GERBER_DRAW_LAYER(aLayer));
    this.GetCanvas()?.Refresh();

    this.uiChanged();
  }

  /**
   * Return the active layer.
   */
  GetActiveLayer(): number {
    return this.m_activeLayer;
  }

  /**
   * Update the currently "selected" layer within m_LayersManager.
   */
  syncLayerWidget(): void {
    this.uiChanged();
  }

  /**
   * Update the currently "selected" layer within m_SelLayerBox.
   *
   * @param aRebuildLayerBox true to rebuild the layer box of false to just updates the
   *                         selection.
   */
  syncLayerBox(aRebuildLayerBox = false): void {
    if (this.m_SelLayerBox) {
      if (aRebuildLayerBox) this.m_SelLayerBox.Resync();

      this.m_SelLayerBox.SetSelection(this.GetActiveLayer());
    }

    let dcodeSelected = -1;
    const gerber = this.GetGbrImage(this.GetActiveLayer());

    if (gerber) dcodeSelected = gerber.m_Selected_Tool;

    if (this.m_DCodeSelector) {
      this.updateDCodeSelectBox();
      this.m_DCodeSelector.SetDCodeSelection(dcodeSelected);
      this.m_DCodeSelector.Enable(gerber !== null);
    }

    this.uiChanged();
  }

  /**
   * Fill the layers manager and the layer box from the image list.
   */
  ReFillLayerWidget(): void {
    this.m_SelLayerBox?.Resync();

    // Re-build the various boxes in the toolbars
    this.RecreateToolbars();

    this.syncLayerWidget();
  }

  /** `EDA_BASE_FRAME::RecreateToolbars`: the four TOP_AUX boxes refill. */
  RecreateToolbars(): void {
    if (this.m_SelComponentBox) this.updateComponentListSelectBox();
    if (this.m_SelNetnameBox) this.updateNetnameListSelectBox();
    if (this.m_SelAperAttributesBox) this.updateAperAttributesSelectBox();
    if (this.m_DCodeSelector) this.updateDCodeSelectBox();

    this.UpdateGridSelectBox();
    this.UpdateZoomSelectBox();
  }

  /**
   * Display the short filename (if exists) of the selected layer on the caption of the main
   * GerbView window and some other parameters.
   *
   *  - Name of the layer (found in the gerber file: LN &ltname&gt command) in the status bar
   *  - Name of the Image (found in the gerber file: IN &ltname&gt command) in the status bar
   *    and other data in toolbar
   */
  UpdateTitleAndInfo(): void {
    const gerber = this.GetGbrImage(this.GetActiveLayer());

    // Display the gerber filename
    if (gerber === null) {
      this.SetTitle('Gerber Viewer');

      this.SetStatusText('', 0);

      const info = 'Drawing layer not in use';
      this.m_TextInfo = info;

      this.ClearMsgPanel();
      this.uiChanged();
      return;
    }

    const filename = gerber.m_FileName.split(/[\\/]/).pop() ?? '';
    let title = filename;

    if (gerber.m_IsX2_file) title += ' (with X2 attributes)';

    title += ' — Gerber Viewer';
    this.SetTitle(title);

    gerber.DisplayImageInfo(this);

    // Display Image Name and Layer Name (from the current gerber data):
    const status = `Image name: '${gerber.m_ImageName}'  Layer name: '${gerber.GetLayerParams().m_LayerName}'`;
    this.SetStatusText(status, 0);

    // Display data format like fmt in X3.4Y3.4 no LZ or fmt mm X2.3 Y3.5 no TZ in main toolbar
    let info =
      `fmt: ${gerber.m_GerbMetric ? 'mm' : 'in'} ` +
      `X${gerber.m_FmtLen.x - gerber.m_FmtScale.x}.${gerber.m_FmtScale.x} ` +
      `Y${gerber.m_FmtLen.y - gerber.m_FmtScale.y}.${gerber.m_FmtScale.y} ` +
      `no ${gerber.m_NoTrailingZeros ? 'T' : 'L'}Z`;

    if (gerber.m_IsX2_file) info += ' X2 attr';

    this.m_TextInfo = info;
    this.uiChanged();
  }

  /** `wxTopLevelWindow::SetTitle`. */
  SetTitle(aTitle: string): void {
    this.m_title = aTitle;
  }

  GetTitle(): string {
    return this.m_title;
  }

  ToggleLayerManager(): void {
    this.m_show_layer_manager_tools = !this.m_show_layer_manager_tools;

    // show/hide auxiliary Vertical layers and visibility manager toolbar
    this.uiChanged();
  }

  // ---- layer order ---------------------------------------------------------

  SortLayersByFileExtension(): void {
    this.RemapLayers(this.GetImagesList().SortImagesByFileExtension());
  }

  SortLayersByX2Attributes(): void {
    this.RemapLayers(this.GetImagesList().SortImagesByZOrder());
  }

  /**
   * Take a layer remapping and reorders the layers.
   *
   * @param remapping A map of old layer number -> new layer number
   */
  RemapLayers(remapping: Map<number, number>): void {
    // Save the visibility of each existing gerber layer, in order to be able
    // to restore this visibility after layer reorder.
    // Note: the visibility of other objects (D_CODE, negative objects ... )
    // must be not modified
    for (let currlayer = GERBER_DRAWLAYERS_COUNT - 1; currlayer >= 0; --currlayer) {
      const gerber = this.GetImagesList().GetGbrImage(currlayer);

      if (gerber) {
        if (this.IsLayerVisible(currlayer)) gerber.SetFlags(CANDIDATE);
        else gerber.ClearFlags(CANDIDATE);
      }
    }

    const view_remapping = new Map<number, number>();

    for (const [first, second] of remapping) {
      view_remapping.set(GERBER_DRAW_LAYER(first), GERBER_DRAW_LAYER(second));
      view_remapping.set(GERBER_DCODE_LAYER(first), GERBER_DCODE_LAYER(second));
    }

    this.view().ReorderLayerData(view_remapping);

    // Restore visibility of gerber layers
    const newVisibility = this.GetVisibleLayers();

    for (let currlayer = GERBER_DRAWLAYERS_COUNT - 1; currlayer >= 0; --currlayer) {
      const gerber = this.GetImagesList().GetGbrImage(currlayer);

      if (gerber) {
        if (gerber.HasFlag(CANDIDATE)) newVisibility.set(currlayer);
        else newVisibility.set(currlayer, false);

        gerber.ClearFlags(CANDIDATE);
      }
    }

    this.SetVisibleLayers(newVisibility);

    this.ReFillLayerWidget();
    this.syncLayerBox(true);

    // Reordering draw layers need updating the view items
    this.view().RecacheAllItems();
    this.view().MarkDirty();
    this.view().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);

    this.GetCanvas()!.Refresh();
  }

  /**
   * Update the draw params of the active layer: offset and rotation,
   * `DIALOG_DRAW_LAYERS_SETTINGS`. The dialog is the page's, so this is the
   * after-OK half: the view recached with the new transform.
   */
  SetLayerDrawPrms(): void {
    const view = this.view();

    view.RecacheAllItems();
    view.MarkDirty();
    view.UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);

    this.GetCanvas()!.Refresh();
  }

  /**
   * Update each layers' differential option. Needed when xor mode changes or the active layer
   * changes (due to changing rendering order) which matters for xor mode but not otherwise.
   */
  UpdateXORLayers(): void {
    if (!this.GetCanvas()) return;

    const target =
      this.GetCanvas()!.GetBackend() === GAL_TYPE.GAL_TYPE_OPENGL
        ? RENDER_TARGET.TARGET_CACHED
        : RENDER_TARGET.TARGET_NONCACHED;
    const view = this.view();
    const xor = this.gvconfig().m_Display.m_XORMode;

    let lastVisibleLayer = -1;

    for (let i = 0; i < GERBER_DRAWLAYERS_COUNT; i++) {
      view.SetLayerDiff(GERBER_DRAW_LAYER(i), xor);

      // Caching doesn't work with layered rendering of XOR'd layers
      if (xor) view.SetLayerTarget(GERBER_DRAW_LAYER(i), RENDER_TARGET.TARGET_NONCACHED);
      else view.SetLayerTarget(GERBER_DRAW_LAYER(i), target);

      // We want the last visible layer, but deprioritize the active layer unless it's the
      // only layer.  We must check visibility first to avoid selecting hidden layers.
      if (view.IsLayerVisible(GERBER_DRAW_LAYER(i))) {
        if (lastVisibleLayer === -1 || i !== this.GetActiveLayer()) lastVisibleLayer = i;
      }
    }

    // We don't want to diff the last visible layer onto the background, etc.
    // In XOR mode, we must keep TARGET_NONCACHED for all layers including the last one.
    if (lastVisibleLayer !== -1) {
      if (xor)
        view.SetLayerTarget(GERBER_DRAW_LAYER(lastVisibleLayer), RENDER_TARGET.TARGET_NONCACHED);
      else view.SetLayerTarget(GERBER_DRAW_LAYER(lastVisibleLayer), target);

      view.SetLayerDiff(GERBER_DRAW_LAYER(lastVisibleLayer), false);
    }

    view.RecacheAllItems();
    view.MarkDirty();
    view.UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
  }

  // ---- page ------------------------------------------------------------------

  SetPageSettings(aPageSettings: PAGE_INFO): void {
    this.m_paper = aPageSettings;

    const screen = this.GetScreen();

    if (screen) screen.InitDataPoints(aPageSettings.GetSizeIU(gerbIUScale.IU_PER_MILS));

    const drawPanel = this.GetCanvas() as GERBVIEW_DRAW_PANEL_GAL | null;

    if (!drawPanel) return;

    // Prepare drawing-sheet template
    const drawingSheet = new DS_PROXY_VIEW_ITEM(
      gerbIUScale,
      this.GetPageSettings(),
      null,
      this.GetTitleBlock(),
      null,
    );

    if (screen) {
      drawingSheet.SetPageNumber('1');
      drawingSheet.SetSheetCount(1);
    }

    drawingSheet.SetColorLayer(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET);
    drawingSheet.SetPageBorderColorLayer(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_PAGE_LIMITS);

    // Draw panel takes ownership of the drawing-sheet
    drawPanel.SetDrawingSheet(drawingSheet);
  }

  GetPageSettings(): PAGE_INFO {
    return this.m_paper;
  }

  GetPageSizeIU(): VECTOR2I {
    return this.GetPageSettings().GetSizeIU(gerbIUScale.IU_PER_MILS);
  }

  GetTitleBlock(): TITLE_BLOCK {
    console.assert(this.m_gerberLayout !== null);
    return this.m_gerberLayout!.GetTitleBlock();
  }

  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    console.assert(this.m_gerberLayout !== null);
    this.m_gerberLayout!.SetTitleBlock(aTitleBlock);
  }

  // ---- status bar -------------------------------------------------------------

  /**
   * Display the current grid pane on the status bar.
   */
  override DisplayGridMsg(): void {
    const gridSize = this.GetCanvas()!.GetGAL().GetGridSize();

    const line = `grid X ${this.MessageTextFromValue(gridSize.x, false)}  Y ${this.MessageTextFromValue(gridSize.y, false)}`;

    this.SetStatusText(line, 4);
    this.SetStatusText(line, 4);
  }

  /** `UNITS_PROVIDER::MessageTextFromValue( aValue, aAddUnitLabel )`. */
  MessageTextFromValue(aValue: number, aAddUnitLabel = true): string {
    return messageTextFromValue(gerbIUScale, this.GetUserUnits(), aValue, aAddUnitLabel);
  }

  override UpdateStatusBar(): void {
    super.UpdateStatusBar();

    const screen = this.GetScreen();

    if (!screen || !this.GetCanvas()) return;

    let line: string;
    const cursorPos = this.GetCanvas()!.GetViewControls().GetCursorPosition();

    if (this.GetShowPolarCoords()) {
      // display relative polar coordinates
      const v = {
        x: cursorPos.x - screen.m_LocalOrigin.x,
        y: cursorPos.y - screen.m_LocalOrigin.y,
      };
      // EDA_ANGLE theta( VECTOR2D( v.x, -v.y ) ): degrees, normalised by the angle's own ctor
      const theta = (Math.atan2(-v.y, v.x) * 180) / Math.PI;
      const ro = Math.hypot(v.x, v.y);

      line = `r ${this.MessageTextFromValue(ro, false)}  theta ${theta.toFixed(1)}`;

      this.SetStatusText(line, 3);
    }

    // Display absolute coordinates:
    line = `X ${this.MessageTextFromValue(cursorPos.x, false)}  Y ${this.MessageTextFromValue(cursorPos.y, false)}`;
    this.SetStatusText(line, 2);

    if (!this.GetShowPolarCoords()) {
      // Display relative cartesian coordinates:
      const dXpos = cursorPos.x - screen.m_LocalOrigin.x;
      const dYpos = cursorPos.y - screen.m_LocalOrigin.y;

      line =
        `dx ${this.MessageTextFromValue(dXpos, false)}  ` +
        `dy ${this.MessageTextFromValue(dYpos, false)}  ` +
        `dist ${this.MessageTextFromValue(Math.hypot(dXpos, dYpos), false)}`;
      this.SetStatusText(line, 3);
    }

    this.DisplayGridMsg();
  }

  protected override unitsChangeRefresh(): void {
    // Called on units change (see EDA_DRAW_FRAME)
    super.unitsChangeRefresh();
    if (this.m_DCodeSelector) this.updateDCodeSelectBox();
    this.UpdateGridSelectBox();
  }

  // ---- tools ------------------------------------------------------------------

  /**
   * Allow Gerbview to install its preferences panels into the preferences dialog.
   */
  private setupTools(): void {
    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(
      this.m_gerberLayout,
      this.view(),
      this.GetCanvas()!.GetViewControls() as unknown as TOOL_MANAGER_VIEW_CONTROLS,
      this.config(),
      this,
    );
    this.m_toolDispatcher = new TOOL_DISPATCHER(this.m_toolManager);

    // Register tools
    // COMMON_CONTROL (help, preferences, about) waits for the menus to run
    // through ACTION_MENU; the page's menu handles those actions directly.
    this.m_toolManager.RegisterTool(new COMMON_TOOLS());

    this.m_toolManager.RegisterTool(new GERBVIEW_SELECTION_TOOL());
    this.m_toolManager.RegisterTool(new GERBVIEW_CONTROL());
    this.m_toolManager.RegisterTool(new GERBVIEW_INSPECTION_TOOL());

    this.m_toolManager.RegisterTool(new ZOOM_TOOL());
    this.m_toolManager.InitTools();

    // Run the selection tool, it is supposed to be always active
    this.m_toolManager.InvokeTool('common.InteractiveSelection');
  }

  /** The tool manager, as the page's toolbar and menus run actions on it. */
  GetToolManagerOrNull(): TOOL_MANAGER | null {
    return this.m_toolManager;
  }

  override ActivateGalCanvas(): void {
    super.ActivateGalCanvas();

    const galCanvas = this.GetCanvas()!;

    if (this.m_toolManager) {
      this.m_toolManager.SetEnvironment(
        this.m_gerberLayout,
        galCanvas.GetView(),
        galCanvas.GetViewControls() as unknown as TOOL_MANAGER_VIEW_CONTROLS,
        this.config(),
        this,
      );
      this.m_toolManager.ResetTools(RESET_REASON.GAL_SWITCH);
    }

    galCanvas.GetGAL().SetGridColor(this.GetLayerColor(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID));

    this.SetPageSettings(this.GetPageSettings());

    galCanvas.GetView().RecacheAllItems();
    galCanvas.SetEventDispatcher(this.m_toolDispatcher);
    galCanvas.StartDrawing();

    this.ReFillLayerWidget();
  }

  override GetCurrentSelection(): SELECTION {
    const sel = this.m_toolManager?.FindTool('common.InteractiveSelection') as {
      GetSelection(): SELECTION;
    } | null;

    return sel ? sel.GetSelection() : super.GetCurrentSelection();
  }

  /**
   * `CommonSettingsChanged`: the gerbview half - the window's grid and cursor
   * options, the page, the D-code layers and the XOR layers re-read.
   */
  override CommonSettingsChanged(): void {
    const cfg = this.gvconfig();

    this.GetGalDisplayOptions().ReadWindowSettings(cfg.m_Window);

    const pgInfo = new PAGE_INFO();
    pgInfo.SetType(cfg.m_Appearance.page_type);

    this.SetPageSettings(pgInfo);
    this.SetElementVisibility(GERBVIEW_LAYER_ID.LAYER_DCODES, cfg.m_Appearance.show_dcodes);

    this.UpdateXORLayers();

    this.view().MarkTargetDirty(RENDER_TARGET.TARGET_NONCACHED);
    this.view().UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.GetCanvas()!.ForceRefresh();

    this.RecreateToolbars();
    this.ReFillLayerWidget(); // Update the layers list
  }

  // ---- members defined in other files ---------------------------------------

  SetHost(aHost: GERBVIEW_FRAME_HOST | null): void {
    this.m_host = aHost ?? NO_HOST;
  }

  Host(): GERBVIEW_FRAME_HOST {
    return this.m_host;
  }

  /**
   * Open a project or set of files given by `aFileSet`: each file by its
   * extension - a zip, a job file, a drill file, a gerber or autodetect -
   * then zoom to fit. A directory rather than a file becomes the MRU path.
   */
  async OpenProjectFiles(aFileSet: readonly string[]): Promise<boolean> {
    if (aFileSet.length > 0) {
      let path = aFileSet[0]!;

      if (path.endsWith('"')) path = path.slice(0, -1);

      if (!wxFileExists(path) && wxDirExists(path)) {
        this.m_mruPath = path;
        return true;
      }

      const limit = Math.min(aFileSet.length, GERBER_DRAWLAYERS_COUNT);

      for (let i = 0; i < limit; ++i) {
        const file = aFileSet[i]!;
        const dot = file.lastIndexOf('.');
        const ext = dot > file.lastIndexOf('/') ? file.slice(dot + 1).toLowerCase() : '';

        if (ext === 'zip') await this.LoadZipArchiveFile(file);
        else if (ext === 'gbrjob') await this.LoadGerberJobFile(file);
        else {
          const { order } = GERBER_FILE_IMAGE_LIST_CLASS.GetGerberLayerFromFilename(file);

          switch (order) {
            case GERBER_ORDER_ENUM.GERBER_DRILL:
              await this.LoadExcellonFiles(file);
              break;
            case GERBER_ORDER_ENUM.GERBER_LAYER_UNKNOWN:
              await this.LoadAutodetectedFiles(file);
              break;
            default:
              await this.LoadGerberFiles(file);
          }
        }
      }
    }

    this.Zoom_Automatique(true); // Zoom fit in frame

    return true;
  }

  /** files.cpp */
  LoadAutodetectedFiles(aFileName = ''): Promise<boolean> {
    return LoadAutodetectedFiles.call(this, aFileName);
  }

  LoadGerberFiles(aFileName = ''): Promise<boolean> {
    return LoadGerberFiles.call(this, aFileName);
  }

  LoadExcellonFiles(aFileName = ''): Promise<boolean> {
    return LoadExcellonFiles.call(this, aFileName);
  }

  LoadListOfGerberAndDrillFiles(
    aPath: string,
    aFilenameList: readonly string[],
    aFileType: number[],
  ): Promise<boolean> {
    return LoadListOfGerberAndDrillFiles.call(this, aPath, aFilenameList, aFileType);
  }

  LoadZipArchiveFile(aFileName = ''): Promise<boolean> {
    return LoadZipArchiveFile.call(this, aFileName);
  }

  /** readgerb.cpp */
  Read_GERBER_File(aFullFileName: string): Promise<boolean> {
    return Read_GERBER_File.call(this, aFullFileName);
  }

  /** excellon_read_drill_file.cpp */
  Read_EXCELLON_File(aFullFileName: string): Promise<boolean> {
    return Read_EXCELLON_File.call(this, aFullFileName);
  }

  /** job_file_reader.cpp */
  LoadGerberJobFile(aFileName = ''): Promise<boolean> {
    return LoadGerberJobFile.call(this, aFileName);
  }

  /** clear_gbr_drawlayers.cpp */
  Clear_DrawLayers(query: boolean): Promise<boolean> {
    return Clear_DrawLayers.call(this, query);
  }

  Erase_Current_DrawLayer(query: boolean): Promise<void> {
    return Erase_Current_DrawLayer.call(this, query);
  }

  /** events_called_functions.cpp */
  OnSelectHighlightChoice(aBox: wxChoice): void {
    OnSelectHighlightChoice.call(this, aBox);
  }

  OnSelectActiveDCode(): void {
    OnSelectActiveDCode.call(this);
  }

  OnSelectActiveLayer(aSelection: number): void {
    OnSelectActiveLayer.call(this, aSelection);
  }

  /** toolbars_gerber.cpp */
  updateComponentListSelectBox(): void {
    updateComponentListSelectBox.call(this);
  }

  updateNetnameListSelectBox(): void {
    updateNetnameListSelectBox.call(this);
  }

  updateAperAttributesSelectBox(): void {
    updateAperAttributesSelectBox.call(this);
  }

  updateDCodeSelectBox(): void {
    updateDCodeSelectBox.call(this);
  }

  OnUpdateSelectDCode(): boolean {
    return OnUpdateSelectDCode.call(this);
  }

  /** The grid colour set with SetGridColor, for the page. */
  GetStoredGridColor(): Color4d | null {
    return this.m_gridColor;
  }
}
