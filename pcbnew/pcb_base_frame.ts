// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_BASE_FRAME` (include/pcb_base_frame.h, pcbnew/pcb_base_frame.cpp): the
 * base of the board and footprint editors — the board it holds, the model
 * accessor the commit system uses, the origins, the settings accessors and
 * the modify hook. The window, the layer manager and the 3D viewer are the
 * designer's; the settings objects come through two abstract accessors so
 * the designer's stores supply them.
 */
import { applyMixins } from '@ziroeda/core/mixins.js';
import type { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { LOAD_SELECT_FOOTPRINT_MIXIN } from './load_select_footprint.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import { EDA_DRAW_FRAME } from '@ziroeda/common/eda_draw_frame.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common';
import { fromPaperToken, pageSizeMM } from '@ziroeda/common/dialogs/dialog_page_settings.js';
import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { type ARC_EDIT_MODE, FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { RPT_SEVERITY_ACTION, type Severity } from '@ziroeda/common/reporter.js';
import type { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { CLEANUP_FIRST } from './cleanup_item.js';
import type { PAGE_INFO } from '@ziroeda/common/page_info.js';
import type { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { add, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import { FOOTPRINT, FP_SMD } from './footprint.js';
import { PCB_TEXT } from './pcb_text.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ADD_MODE } from './board_item_container.js';
import type { ZONE } from './zone.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type { TOOL_DISPATCHER } from '@ziroeda/common/draw_panel_gal.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { BOARD } from './board.js';
import { PCB_DISPLAY_OPTIONS, type PCB_PAINTER } from './pcb_painter.js';
import type { PCB_DRAW_PANEL_GAL } from './pcb_draw_panel_gal.js';
import type { PCB_SCREEN } from './pcb_screen.js';
import type { PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';
import type { BOARD_DESIGN_SETTINGS } from './board_design_settings.js';
import { type BOARD_ITEM, DELETED_BOARD_ITEM } from './board_item.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import { PCB_ORIGIN_TRANSFORMS } from './pcb_origin_transforms.js';
import {
  type MAGNETIC_SETTINGS,
  PCB_DISPLAY_ORIGIN,
  PCBNEW_SETTINGS,
  type PCB_VIEWERS_SETTINGS_BASE,
} from './pcbnew_settings.js';
import { GRID } from '@ziroeda/common/settings/grid_settings.js';

/**
 * `FOOTPRINT_EDITOR_SETTINGS` as the base frame reads it; the class lands with
 * the settings wiring (#636 stage 6).
 */
export interface FOOTPRINT_EDITOR_SETTINGS_LIKE {
  m_DisplayInvertXAxis: boolean;
  m_DisplayInvertYAxis: boolean;
  m_AngleSnapMode: LEADER_MODE;
  /** `m_ArcEditMode` (footprint_editor_settings.h:79); KEEP_CENTER_ADJUST_ANGLE_RADIUS when absent. */
  m_ArcEditMode?: ARC_EDIT_MODE;
  /**
   * `m_MagneticItems` (footprint_editor_settings.h); absent where the frame's
   * footprint editor settings are not the editor's own.
   */
  m_MagneticItems?: MAGNETIC_SETTINGS;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (LOAD_SELECT_FOOTPRINT_MIXIN, see libs/core/mixins.ts)
export abstract class PCB_BASE_FRAME extends EDA_DRAW_FRAME {
  protected m_pcb: BOARD | null = null;
  protected m_originTransforms: PCB_ORIGIN_TRANSFORMS;
  protected m_displayOptions = new PCB_DISPLAY_OPTIONS();

  constructor(aFrameType: FRAME_T, aUnits: EdaUnits = 'mm') {
    super(aFrameType, pcbIUScale, aUnits);
    this.m_originTransforms = new PCB_ORIGIN_TRANSFORMS(this);
  }

  /**
   * Set the #m_Pcb member in such a way that all the derived classes (that have their own
   * board) will point to the same board.
   */
  SetBoard(aBoard: BOARD | null, _aReporter: PROGRESS_REPORTER_LIKE | null = null): void {
    if (this.m_pcb !== aBoard) {
      this.m_pcb = aBoard;

      if (this.GetBoard()) this.GetBoard()!.SetUserUnits(this.GetUserUnits());

      if (this.GetBoard() && this.GetCanvas()) {
        const rs = this.GetCanvas()!.GetView().GetPainter().GetSettings();

        if (rs) {
          rs.SetDashLengthRatio(this.GetBoard()!.GetPlotOptions().GetDashedLineDashRatio());
          rs.SetGapLengthRatio(this.GetBoard()!.GetPlotOptions().GetDashedLineGapRatio());
        }
      }

      this.OnBoardChanged();
    }
  }

  /** `PCB_DRAW_PANEL_GAL* GetCanvas() const override`. */
  override GetCanvas(): PCB_DRAW_PANEL_GAL | null {
    return this.m_canvas as PCB_DRAW_PANEL_GAL | null;
  }

  override GetScreen(): PCB_SCREEN | null {
    return this.m_currentScreen as PCB_SCREEN | null;
  }

  /**
   * Helper to retrieve the current color settings.
   */
  override GetColorSettings(_aForceRefresh = false): COLOR_SETTINGS {
    throw new Error('Color settings requested for a PCB_BASE_FRAME that does not override!');
  }

  /**
   * Display options control the way tracks, vias, outlines and other things are shown
   * (for instance solid or sketch mode).
   */
  GetDisplayOptions(): PCB_DISPLAY_OPTIONS {
    return this.m_displayOptions;
  }

  /**
   * `displayOptionsRequireRecache( aOld, aNew )` (pcb_base_frame.cpp:1067-1074):
   * only the zone mode and the board flip change geometry; colour, opacity and
   * contrast are recolour only.
   */
  protected displayOptionsRequireRecache(
    aOld: PCB_DISPLAY_OPTIONS,
    aNew: PCB_DISPLAY_OPTIONS,
  ): boolean {
    return (
      aOld.m_ZoneDisplayMode !== aNew.m_ZoneDisplayMode ||
      aOld.m_FlipBoardView !== aNew.m_FlipBoardView
    );
  }

  /**
   * Update the display options and refresh the canvas
   * (`SetDisplayOptions`, pcb_base_frame.cpp:1077-1097).
   */
  SetDisplayOptions(aOptions: PCB_DISPLAY_OPTIONS, aRefresh = true): void {
    const needsRecache = this.displayOptionsRequireRecache(this.m_displayOptions, aOptions);
    this.m_displayOptions = aOptions;

    // The window attaches the canvas after the constructor; until it does
    // there is no view to tell.
    const canvas = this.GetCanvas();

    if (canvas) {
      const view = canvas.GetView();

      view.UpdateDisplayOptions(aOptions);
      view.SetMirror(aOptions.m_FlipBoardView, view.IsMirroredY());

      // skip recache for colour/alpha-only changes handled by the recolour below
      if (needsRecache) view.RecacheAllItems();

      canvas.SetHighContrastLayer(this.GetActiveLayer());
    }

    this.OnDisplayOptionsChanged();

    if (aRefresh) canvas?.Refresh();
  }

  OnDisplayOptionsChanged(): void {}

  /** `SwitchLayer( aLayer )` (pcb_base_frame.cpp:711-735): the board editor overrides it. */
  SwitchLayer(layer: PCB_LAYER_ID): void {
    const preslayer = this.GetActiveLayer();
    const displ_opts = this.GetDisplayOptions();

    // Check if the specified layer matches the present layer
    if (layer === preslayer) return;

    // Copper layers cannot be selected unconditionally; how many of those layers are
    // currently enabled needs to be checked.
    if (IsCopperLayer(layer)) {
      if (layer > this.m_pcb!.GetCopperLayerStackMaxId()) return;
    }

    // Is yet more checking required? E.g. when the layer to be selected is a non-copper
    // layer, or when switching between a copper layer and a non-copper layer, or vice-versa?
    // ...

    this.SetActiveLayer(layer);

    if (displ_opts.m_ContrastModeDisplay !== HIGH_CONTRAST_MODE.NORMAL) this.GetCanvas()?.Refresh();
  }

  SetActiveLayer(aLayer: PCB_LAYER_ID): void {
    this.GetScreen()!.m_Active_Layer = aLayer;
  }

  GetActiveLayer(): PCB_LAYER_ID {
    return this.GetScreen()!.m_Active_Layer;
  }

  protected override unitsChangeRefresh(): void {
    super.unitsChangeRefresh(); // Update the status bar.

    const board = this.GetBoard();

    if (board) board.SetUserUnits(this.GetUserUnits());

    this.UpdateGridSelectBox();
  }

  override LoadSettings(aCfg: APP_SETTINGS_BASE): void {
    super.LoadSettings(aCfg);

    // Move legacy user grids to grid list
    if (aCfg.m_Window.grid.user_grid_x !== '') {
      aCfg.m_Window.grid.grids.push(
        new GRID('User Grid', aCfg.m_Window.grid.user_grid_x, aCfg.m_Window.grid.user_grid_y),
      );
      aCfg.m_Window.grid.user_grid_x = '';
      aCfg.m_Window.grid.user_grid_y = '';
    }

    // Some, but not all, derived classes have a PCBNEW_SETTINGS.
    if (aCfg instanceof PCBNEW_SETTINGS) this.m_polarCoords = aCfg.m_PolarCoords;

    // wxASSERT( GetCanvas() ) upstream: here the window attaches the canvas
    // after the constructor's LoadSettings, so the guard below is what runs.
    const canvas = this.GetCanvas();

    if (canvas) {
      const rs = canvas.GetView().GetPainter().GetSettings();

      if (rs) {
        rs.SetHighlightFactor(aCfg.m_Graphics.highlight_factor);
        rs.SetSelectFactor(aCfg.m_Graphics.select_factor);
        rs.SetDefaultFont(''); // Always the KiCad font for PCBs
      }
    }
  }

  override SaveSettings(aCfg: APP_SETTINGS_BASE): void {
    super.SaveSettings(aCfg);

    // Some, but not all derived classes have a PCBNEW_SETTINGS.
    if (aCfg instanceof PCBNEW_SETTINGS) aCfg.m_PolarCoords = this.m_polarCoords;
  }

  override ActivateGalCanvas(): void {
    super.ActivateGalCanvas();

    const canvas = this.GetCanvas()!;
    const view = canvas.GetView();

    if (this.m_toolManager) {
      this.m_toolManager.SetEnvironment(
        this.m_pcb,
        view,
        canvas.GetViewControls(),
        this.config(),
        this,
      );

      this.m_toolManager.ResetTools(RESET_REASON.GAL_SWITCH);
    }

    const painter = view.GetPainter() as PCB_PAINTER;
    const settings = painter.GetSettings();
    const displ_opts = this.GetDisplayOptions();

    settings.LoadDisplayOptions(displ_opts);
    settings.LoadColors(this.GetColorSettings());
    settings.m_ForceShowFieldsWhenFPSelected =
      this.GetPcbNewSettings().m_Display.m_ForceShowFieldsWhenFPSelected;

    view.RecacheAllItems();
    canvas.SetEventDispatcher(this.m_toolDispatcher as TOOL_DISPATCHER | null);
    canvas.StartDrawing();
  }

  /** `EDA_EVT_BOARD_CHANGED`, the event `SetBoard` raises. */
  protected OnBoardChanged(): void {}

  GetBoard(): BOARD | null {
    return this.m_pcb;
  }

  /**
   * Return the PCB board or the loaded footprint, whichever the frame edits.
   */
  abstract GetModel(): BOARD_ITEM_CONTAINER | null;

  GetPageSettings(): PAGE_INFO {
    return this.m_pcb!.GetPageSettings();
  }

  GetPageSizeIU(): VECTOR2I {
    // this function is only needed because EDA_DRAW_FRAME is not compiled
    // with either -DPCBNEW or -DEESCHEMA, so the virtual is used to route
    // into an application specific source file.
    return this.m_pcb!.GetPageSettings().GetSizeIU(pcbIUScale.IU_PER_MILS);
  }

  GetGridOrigin(): VECTOR2I {
    return this.m_pcb!.GetDesignSettings().GetGridOrigin();
  }

  SetGridOrigin(aPoint: VECTOR2I): void {
    this.m_pcb!.GetDesignSettings().SetGridOrigin(aPoint);
  }

  GetAuxOrigin(): VECTOR2I {
    return this.m_pcb!.GetDesignSettings().GetAuxOrigin();
  }

  GetUserOrigin(): VECTOR2I {
    let origin: VECTOR2I = { x: 0, y: 0 };

    switch (this.GetPcbNewSettings().m_Display.m_DisplayOrigin) {
      case PCB_DISPLAY_ORIGIN.PCB_ORIGIN_PAGE:
        break;
      case PCB_DISPLAY_ORIGIN.PCB_ORIGIN_AUX:
        origin = this.GetAuxOrigin();
        break;
      case PCB_DISPLAY_ORIGIN.PCB_ORIGIN_GRID:
        origin = this.GetGridOrigin();
        break;
      default:
        console.assert(false);
        break;
    }

    return origin;
  }

  /**
   * Return a reference to the default ORIGIN_TRANSFORMS object
   */
  override GetOriginTransforms(): PCB_ORIGIN_TRANSFORMS {
    return this.m_originTransforms;
  }

  SetPageSettings(aPageSettings: PAGE_INFO): void {
    this.m_pcb!.SetPageSettings(aPageSettings);

    const screen = this.GetScreen();

    if (screen) screen.InitDataPoints(aPageSettings.GetSizeIU(pcbIUScale.IU_PER_MILS));
  }

  GetTitleBlock(): TITLE_BLOCK {
    return this.m_pcb!.GetTitleBlock();
  }

  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    this.m_pcb!.SetTitleBlock(aTitleBlock);
  }

  /**
   * Return the BOARD_DESIGN_SETTINGS for the open project.
   */
  GetDesignSettings(): BOARD_DESIGN_SETTINGS {
    return this.m_pcb!.GetDesignSettings();
  }

  /**
   * `PCB_BASE_FRAME::CreateNewFootprint` (`footprint_libraries_utils.cpp:1227`):
   * a blank footprint on this frame's board, its texts taken from
   * `m_DefaultFPTextItems` (item 0 the Reference, item 1 the Value, every one
   * after a `PCB_TEXT`) and its size, stroke, italics and upright flag from the
   * layer class each lands on.
   *
   * With a library name, the name is made unique in that library (`_1`, `_2`,
   * ...) and the attributes are inferred from the last footprint the library
   * lists, "best efforts".
   */
  CreateNewFootprint(aFootprintName: string, aLibName = ''): FOOTPRINT {
    if (aFootprintName === '') aFootprintName = 'Untitled';

    let footprintAttrs = FP_SMD;

    if (aLibName !== '') {
      const adapter = this.GetBoard()?.GetFootprintLibAdapter() ?? null;

      if (adapter) {
        const baseName = aFootprintName;
        let idx = 1;

        // Make sure the name is unique
        while (adapter.FootprintExists(aLibName, aFootprintName))
          aFootprintName = `${baseName}_${idx++}`;

        // Try to infer the footprint attributes from an existing footprint in the library
        try {
          const fpnames = adapter.GetFootprintNames?.(aLibName, true) ?? [];

          if (fpnames.length > 0) {
            const fp = adapter.LoadFootprint(aLibName, fpnames[fpnames.length - 1]!, false);

            if (fp) footprintAttrs = fp.GetAttributes();
          }
        } catch {
          // best efforts
        }
      }
    }

    // Create the new footprint and add it to the head of the linked list of footprints
    const footprint = new FOOTPRINT(this.GetBoard());

    // Update its name in lib
    footprint.SetFPID(new LIB_ID('', aFootprintName));

    footprint.SetAttributes(footprintAttrs);

    const settings = this.GetDesignSettings();
    const items = settings.m_DefaultFPTextItems;
    const default_pos = { x: 0, y: 0 };

    if (items.length > 0) {
      footprint.Reference().SetText(items[0]!.m_Text);
      footprint.Reference().SetVisible(items[0]!.m_Visible);
    }

    let txt_layer = items[0]!.m_Layer;
    footprint.Reference().SetLayer(txt_layer);
    default_pos.y -= Math.trunc(settings.GetTextSize(txt_layer).y / 2);
    footprint.Reference().SetPosition({ ...default_pos });
    default_pos.y += settings.GetTextSize(txt_layer).y;

    if (items.length > 1) {
      footprint.Value().SetText(items[1]!.m_Text);
      footprint.Value().SetVisible(items[1]!.m_Visible);
    }

    txt_layer = items[1]!.m_Layer;
    footprint.Value().SetLayer(txt_layer);
    default_pos.y += Math.trunc(settings.GetTextSize(txt_layer).y / 2);
    footprint.Value().SetPosition({ ...default_pos });
    default_pos.y += settings.GetTextSize(txt_layer).y;

    for (let i = 2; i < items.length; ++i) {
      const textItem = new PCB_TEXT(footprint);
      textItem.SetText(items[i]!.m_Text);
      txt_layer = items[i]!.m_Layer;
      textItem.SetLayer(txt_layer);
      default_pos.y += Math.trunc(settings.GetTextSize(txt_layer).y / 2);
      textItem.SetPosition({ ...default_pos });
      default_pos.y += settings.GetTextSize(txt_layer).y;
      footprint.Add(textItem, ADD_MODE.APPEND);
    }

    if (footprint.GetReference() === '') footprint.SetReference(aFootprintName);

    if (footprint.GetValue() === '') footprint.SetValue(aFootprintName);

    footprint.RunOnChildren((aChild: BOARD_ITEM) => {
      if (aChild.Type() === KICAD_T.PCB_FIELD_T || aChild.Type() === KICAD_T.PCB_TEXT_T) {
        const textItem = aChild as PCB_TEXT;
        const layer = textItem.GetLayer();

        textItem.SetTextThickness(settings.GetTextThickness(layer));
        textItem.SetTextSize({ ...settings.GetTextSize(layer) });
        textItem.SetItalic(settings.GetTextItalic(layer));
        textItem.SetKeepUpright(settings.GetTextUpright(layer));
      }
    }, RECURSE_MODE.RECURSE);

    this.SetMsgPanel(footprint);
    return footprint;
  }

  /**
   * Fetch an item by KIID.
   */
  override ResolveItem(aId: KIID, aAllowNullptrReturn = false): BOARD_ITEM | null {
    return this.GetBoard()!.ResolveItem(aId, aAllowNullptrReturn);
  }

  override GetSeverity(aErrorCode: number): Severity {
    if (aErrorCode >= CLEANUP_FIRST) return RPT_SEVERITY_ACTION;

    const bds = this.GetBoard()!.GetDesignSettings();

    return bds.m_DRCSeverities.get(aErrorCode)!;
  }

  /**
   * `Pgm().GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>( "pcbnew" )`:
   * the designer's settings store supplies the object.
   */
  abstract GetPcbNewSettings(): PCBNEW_SETTINGS;

  /**
   * `GetMagneticItemsSettings()`: the board editor's `m_MagneticItems`
   * (pcb_edit_frame.cpp). The footprint editor answers its own.
   */
  GetMagneticItemsSettings(): MAGNETIC_SETTINGS {
    return this.GetPcbNewSettings().m_MagneticItems;
  }

  /**
   * `virtual void SaveCopyInUndoList( ... ) {}` (pcb_base_frame.h:319-328): a
   * frame with no undo list ignores it; PCB_BASE_EDIT_FRAME's undo_redo.ts
   * mixin is the one that keeps one.
   */
  SaveCopyInUndoList(_aItem: unknown, _aCommandType: UNDO_REDO): void {}

  /**
   * The footprint chooser (`Kiway().Player( FRAME_FOOTPRINT_CHOOSER )->ShowModal(
   * &footprintName )`): the chosen LIB_ID text, or null when cancelled. A frame
   * with no window has no chooser.
   */
  selectFootprintFromChooser(_aPreselect: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  /**
   * The window's footprint library (`PROJECT_PCB::FootprintLibAdapter( &Prj() )`
   * in a browser, where a library file arrives asynchronously): the load, or
   * null to fall back on the board's synchronous adapter.
   */
  loadFootprintFromLibraryWindow(
    _aFootprintId: LIB_ID,
    _aKeepUUID: boolean,
  ): Promise<FOOTPRINT | null> | null {
    return null;
  }

  /**
   * `PCB_BASE_FRAME::AddFootprintToBoard` (pcb_base_frame.cpp:200-222): the
   * footprint appended, new, at the origin, on the front and unrotated.
   */
  AddFootprintToBoard(aFootprint: FOOTPRINT | null): void {
    if (!aFootprint) return;

    this.GetBoard()!.Add(aFootprint, ADD_MODE.APPEND);

    aFootprint.SetFlags(IS_NEW);
    aFootprint.SetPosition({ x: 0, y: 0 }); // cursor in GAL may not be initialized yet

    // Put it on FRONT layer (note that it might be stored flipped if the lib is an archive
    // built from a board)
    if (aFootprint.IsFlipped())
      aFootprint.Flip(aFootprint.GetPosition(), this.GetPcbNewSettings().m_FlipDirection);

    // Place it in orientation 0 even if it is not saved with orientation 0 in lib (note that
    // it might be stored in another orientation if the lib is an archive built from a board)
    aFootprint.SetOrientation(ANGLE_0);

    this.GetBoard()!.UpdateUserUnits(aFootprint, this.GetCanvas()?.GetView() ?? null);

    this.m_toolManager?.RunAction(PCB_ACTIONS.rehatchShapes);
  }

  /**
   * `EDA_BASE_FRAME::config()` is `Kiface().KifaceSettings()`, which in
   * pcbnew's kiface is its PCBNEW_SETTINGS; FOOTPRINT_EDIT_FRAME overrides it.
   */
  override config(): APP_SETTINGS_BASE {
    return this.GetPcbNewSettings();
  }

  /**
   * `Pgm().GetSettingsManager().GetAppSettings<FOOTPRINT_EDITOR_SETTINGS>( "fpedit" )`.
   */
  abstract GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE;

  /**
   * `GetViewerSettingsBase()` (pcb_base_frame.cpp:897-917): the settings whose
   * VIEWERS_DISPLAY_OPTIONS this frame displays with.
   *
   * The CVPCB frames' arm (`GetAppSettings<CVPCB_SETTINGS>( "cvpcb" )`) has no
   * subclass of this frame to reach it here: they answer the default's.
   */
  GetViewerSettingsBase(): PCB_VIEWERS_SETTINGS_BASE {
    switch (this.GetFrameType()) {
      case FRAME_T.FRAME_FOOTPRINT_EDITOR:
      case FRAME_T.FRAME_FOOTPRINT_WIZARD:
        return this.GetFootprintEditorSettings() as unknown as PCB_VIEWERS_SETTINGS_BASE;

      default:
        return this.GetPcbNewSettings();
    }
  }

  /** `static std::vector<KIID> lastBrightenedItemIDs` of FocusOnItems. */
  private static lastBrightenedItemIDs: KIID[] = [];

  override FocusOnItem(aItem: EDA_ITEM | null, aAllowScroll?: boolean): void;
  override FocusOnItem(
    aItem: BOARD_ITEM | null,
    aLayer?: PCB_LAYER_ID,
    aAllowScroll?: boolean,
  ): void;
  override FocusOnItem(
    aItem: EDA_ITEM | BOARD_ITEM | null,
    b?: boolean | PCB_LAYER_ID,
    c?: boolean,
  ): void {
    if (typeof b === 'boolean' || b === undefined) {
      // FocusOnItem( EDA_ITEM* aItem, bool aAllowScroll )
      // nullptr will clear the current focus
      if (aItem !== null && !aItem.IsBOARD_ITEM()) return;

      this.FocusOnItem(aItem as BOARD_ITEM | null, PCB_LAYER_ID.UNDEFINED_LAYER, b ?? true);
      return;
    }

    const items: BOARD_ITEM[] = [];

    if (aItem) items.push(aItem as BOARD_ITEM);

    this.FocusOnItems(items, b, c ?? true);
  }

  FocusOnItems(
    aItems: BOARD_ITEM[],
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aAllowScroll = true,
  ): void {
    let itemsUnbrightened = false;

    for (const lastBrightenedItemID of PCB_BASE_FRAME.lastBrightenedItemIDs) {
      const lastItem = this.GetBoard()!.ResolveItem(lastBrightenedItemID, true);

      if (lastItem) {
        lastItem.ClearBrightened();
        this.GetCanvas()!.GetView().Update(lastItem);
        itemsUnbrightened = true;
      }
    }

    if (itemsUnbrightened) this.GetCanvas()!.Refresh();

    PCB_BASE_FRAME.lastBrightenedItemIDs = [];

    if (aItems.length === 0) return;

    let focusPt: VECTOR2I = { x: 0, y: 0 };
    const view = this.GetCanvas()!.GetView();
    const viewportPoly = new SHAPE_POLY_SET(view.GetViewport());

    for (const dialog of this.findDialogRects()) {
      // ScreenToClient( dialog->GetScreenPosition() ) / dialog->GetSize(): the rects are
      // already client-relative
      const dialogPoly = new SHAPE_POLY_SET(
        new BOX2D(view.ToWorld(dialog.GetOrigin(), true), view.ToWorld(dialog.GetSize(), false)),
      );

      try {
        viewportPoly.BooleanSubtract(dialogPoly);
      } catch (e) {
        console.error('Clipper exception occurred:', e);
      }
    }

    let itemPoly = new SHAPE_POLY_SET();
    const clippedPoly = new SHAPE_POLY_SET();

    for (const item of aItems) {
      if (item && item !== DELETED_BOARD_ITEM.GetInstance()) {
        item.SetBrightened();
        PCB_BASE_FRAME.lastBrightenedItemIDs.push(item.m_Uuid);

        item.RunOnChildren((child: BOARD_ITEM) => {
          child.SetBrightened();
          PCB_BASE_FRAME.lastBrightenedItemIDs.push(child.m_Uuid);
        }, RECURSE_MODE.RECURSE);

        this.GetCanvas()!.GetView().Update(item);

        // Focus on the object's location.  Prefer a visible part of the object to its anchor
        // in order to keep from scrolling around.

        focusPt = item.GetPosition();

        if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER && item.GetLayerSet().any())
          aLayer = item.GetLayerSet().Seq()[0]!;

        switch (item.Type()) {
          case KICAD_T.PCB_FOOTPRINT_T:
            try {
              itemPoly = (item as FOOTPRINT).GetBoundingHull();
            } catch (e) {
              console.error('Clipper exception occurred:', e);
            }

            break;

          case KICAD_T.PCB_PAD_T:
          case KICAD_T.PCB_MARKER_T:
          case KICAD_T.PCB_VIA_T:
            this.FocusOnLocation(item.GetFocusPosition(), aAllowScroll);
            this.GetCanvas()!.Refresh();
            return;

          case KICAD_T.PCB_SHAPE_T:
          case KICAD_T.PCB_FIELD_T:
          case KICAD_T.PCB_TEXT_T:
          case KICAD_T.PCB_TEXTBOX_T:
          case KICAD_T.PCB_BARCODE_T:
          case KICAD_T.PCB_TRACE_T:
          case KICAD_T.PCB_ARC_T:
          case KICAD_T.PCB_DIM_ALIGNED_T:
          case KICAD_T.PCB_DIM_LEADER_T:
          case KICAD_T.PCB_DIM_CENTER_T:
          case KICAD_T.PCB_DIM_RADIAL_T:
          case KICAD_T.PCB_DIM_ORTHOGONAL_T:
            item.TransformShapeToPolygon(
              itemPoly,
              aLayer,
              0,
              pcbIUScale.mmToIU(0.1),
              ERROR_LOC.ERROR_INSIDE,
            );
            break;

          case KICAD_T.PCB_ZONE_T: {
            const zone = item as ZONE;
            // much faster calculation time when using only the zone outlines
            itemPoly = new SHAPE_POLY_SET(zone.Outline());

            break;
          }

          default: {
            const item_bbox = item.GetBoundingBox();
            itemPoly.NewOutline();
            itemPoly.Append(item_bbox.GetOrigin());
            itemPoly.Append(add(item_bbox.GetOrigin(), { x: item_bbox.GetWidth(), y: 0 }));
            itemPoly.Append(add(item_bbox.GetOrigin(), { x: 0, y: item_bbox.GetHeight() }));
            itemPoly.Append(
              add(item_bbox.GetOrigin(), { x: item_bbox.GetWidth(), y: item_bbox.GetHeight() }),
            );
            break;
          }
        }

        try {
          itemPoly.ClearArcs();
          viewportPoly.ClearArcs();
          clippedPoly.BooleanIntersection(itemPoly, viewportPoly);
        } catch (e) {
          console.error('Clipper exception occurred:', e);
        }

        if (!clippedPoly.IsEmpty()) itemPoly = clippedPoly;
      }
    }

    /*
     * Perform a step-wise deflate to find the visual-center-of-mass
     */

    if (itemPoly.IsEmpty()) {
      this.FocusOnLocation(focusPt, aAllowScroll);
      this.GetCanvas()!.Refresh();
      return;
    }

    const bbox = itemPoly.BBox();
    const step = Math.trunc(Math.min(bbox.GetWidth(), bbox.GetHeight()) / 10);

    // Tiny shapes can quantize to a zero deflate step
    if (step <= 0) {
      this.FocusOnLocation(bbox.Centre(), aAllowScroll);
      this.GetCanvas()!.Refresh();
      return;
    }

    while (!itemPoly.IsEmpty()) {
      focusPt = itemPoly.BBox().Centre();

      try {
        itemPoly.Deflate(step, CornerStrategy.ALLOW_ACUTE_CORNERS, ARC_LOW_DEF);
      } catch (e) {
        console.error('Clipper exception occurred:', e);
      }
    }

    this.FocusOnLocation(focusPt, aAllowScroll);
    this.GetCanvas()!.Refresh();
  }

  ShowSolderMask(): void {
    const view = this.GetCanvas()?.GetView() ?? null;

    if (view && this.GetBoard()?.m_SolderMaskBridges) {
      if (view.HasItem(this.GetBoard()!.m_SolderMaskBridges))
        view.Remove(this.GetBoard()!.m_SolderMaskBridges);

      view.Add(this.GetBoard()!.m_SolderMaskBridges);
    }
  }

  /**
   * Remove the solder-mask bridges zone from the view.
   */
  HideSolderMask(): void {
    const view = this.GetCanvas()?.GetView() ?? null;

    if (
      view &&
      this.GetBoard()?.m_SolderMaskBridges &&
      view.HasItem(this.GetBoard()!.m_SolderMaskBridges)
    )
      view.Remove(this.GetBoard()!.m_SolderMaskBridges);
  }

  /**
   * Update the 3D view, if the viewer is open.
   */
  /**
   * `Get3DViewerFrame()` (pcb_base_frame.cpp:148-153): the open 3D viewer, found
   * by its qualified frame name, or null. A frame without one answers null.
   */
  Get3DViewerFrame(): object | null {
    return null;
  }

  /** `CreateAndShow3D_Frame()` (pcb_base_frame.cpp:679-705): raise the 3D viewer, creating it first. */
  CreateAndShow3D_Frame(): object | null {
    return null;
  }

  Update3DView(_aMarkDirty: boolean, _aRefresh: boolean, _aTitle: string | null = null): void {}

  /**
   * Rebuild the ratsnest from the board's connectivity (`ratsnest/ratsnest.cpp`).
   */
  Compile_Ratsnest(aDisplayStatus: boolean): void {
    this.GetBoard()!.GetConnectivity().RecalculateRatsnest();
    this.GetBoard()!.UpdateRatsnestExclusions();
    this.GetBoard()!.OnRatsnestChanged();

    if (aDisplayStatus) this.SetMsgPanel(this.m_pcb!);
  }

  /**
   * Must be called after a change in order to set the "modify" flag and update other data
   * structures and GUI elements.
   */
  override OnModify(): void {
    super.OnModify();

    this.GetScreen()?.SetContentModified();
    this.GetBoard()!.IncrementTimeStamp();

    if (this.m_isClosing) return;

    this.UpdateStatusBar();
    this.UpdateMsgPanel();
  }
}

// --- PCB_BASE_FRAME::GetBoardBoundingBox / GetDocumentExtents + COMMON_TOOLS::doZoomFit's box (was document_extents.ts) ---

/** A `BOX2I` in pcbnew internal units (1 nm). */
export interface ExtentsBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * `PCB_BASE_FRAME::GetPageSizeIU()` — `GetPageSettings().GetSizeIU(
 * pcbIUScale.IU_PER_MILS )` — for a stored `(paper …)` token.
 *
 * The token is split by the one splitter this tree has (`fromPaperToken`), so
 * `(paper "A4" portrait)` and `(paper "User" 431.8 279.4)` resolve the way the
 * Page Settings dialog resolves them rather than by a second reading of the
 * string. The table behind it is `PAGE_INFO::standardPageSizes` in
 * `common/page_info.ts`; there is no size table in this file on purpose.
 */
export function pcbPageSizeIU(paperToken: string): { x: number; y: number } {
  const [widthMM, heightMM] = pageSizeMM(fromPaperToken(paperToken));
  return { x: mmToIU(widthMM), y: mmToIU(heightMM) };
}

/**
 * The rectangle `GetBoardBoundingBox` substitutes for an empty board.
 *
 * `m_showBorderAndTitleBlock` decides where it sits: at the origin while the
 * drawing sheet is drawn — the board's (0,0) is the page's top-left corner —
 * and centred on the origin when it is not, because then there is no page on
 * screen for the box to line up with.
 */
export function pcbPageBox(paperToken: string, showBorderAndTitleBlock: boolean): ExtentsBox {
  const { x, y } = pcbPageSizeIU(paperToken);

  if (showBorderAndTitleBlock) return { minX: 0, minY: 0, maxX: x, maxY: y };

  // `-pageSize.x / 2` on a VECTOR2I is C++ integer division, which truncates
  // toward zero rather than flooring.
  const halfX = Math.trunc(x / 2);
  const halfY = Math.trunc(y / 2);
  return { minX: -halfX, minY: -halfY, maxX: halfX, maxY: halfY };
}

/** Whether a box would give doZoomFit a finite scale to work with. */
function isDegenerate(box: ExtentsBox): boolean {
  // doZoomFit's own test, `GetWidth() == 0 || GetHeight() == 0`.
  return box.maxX - box.minX === 0 || box.maxY - box.minY === 0;
}

/**
 * `BOARD::BOARD() : … m_paper( PAGE_SIZE_TYPE::A4 )` (`pcbnew/board.cpp:98`) —
 * a board that never wrote a `(paper …)` token still has a page, and it is A4.
 */
export const DEFAULT_BOARD_PAPER = 'A4';

export interface ZoomFitOptions {
  /** The board's `(paper …)` token; absent on a board that never wrote one. */
  paper: string | undefined;
  /** `m_showBorderAndTitleBlock` — the drawing sheet's own visibility. */
  drawingSheetVisible: boolean;
  /**
   * `ZOOM_FIT_ALL` for `zoomFitScreen` (Home, and the fit after a board
   * loads), `ZOOM_FIT_OBJECTS` for `zoomFitObjects` (Ctrl+Home).
   */
  fitType: 'all' | 'objects';
  /** `m_pcb->IsLayerVisible( Edge_Cuts )`. */
  edgeCutsVisible: boolean;
  /**
   * `BOARD::GetBoardEdgesBoundingBox()`: the box over the Edge.Cuts items
   * alone, null when the board is empty (`ComputeBoundingBox`'s empty box).
   */
  edgesBox: ExtentsBox | null;
}

/**
 * The box Zoom to Fit scales the view to, or null when there is nothing at all
 * to measure (a board with neither items nor a page).
 *
 * @param itemsBox the scene's bounding box over the board items, null when the
 *                 board is empty — `BOARD::ComputeBoundingBox`'s empty `BOX2I`.
 */
export function pcbZoomFitBox(
  itemsBox: ExtentsBox | null,
  opts: ZoomFitOptions,
): ExtentsBox | null {
  const page = pcbPageBox(opts.paper || DEFAULT_BOARD_PAPER, opts.drawingSheetVisible);

  // `COMMON_TOOLS::doZoomFit` (common/tool/common_tools.cpp:322-406): the box
  // is `GetDocumentExtents()` -- every item -- and for ZOOM_FIT_ALL in the
  // board editor `GetDocumentExtents( false )`: the board edges alone while
  // Edge.Cuts is visible (`pcb_base_frame.cpp:619-637`), so Home frames the
  // board and not the fabrication text around it. The drawing sheet is never
  // part of it on a board with anything on it; it is only what the two
  // fallbacks below land on.
  let box = itemsBox;

  if (opts.fitType === 'all' && opts.edgeCutsVisible) box = opts.edgesBox;

  // GetBoardBoundingBox's fallback, then doZoomFit's. Both land on the page:
  // it is what PCB_DRAW_PANEL_GAL::GetDefaultViewBBox returns too, the drawing
  // sheet's ViewBBox while LAYER_DRAWINGSHEET is visible
  // (pcb_draw_panel_gal.cpp:822-828).
  if (!box || isDegenerate(box)) box = page;

  return isDegenerate(box) ? null : box;
}

export interface PCB_BASE_FRAME extends LOAD_SELECT_FOOTPRINT_MIXIN {}

applyMixins(PCB_BASE_FRAME, [LOAD_SELECT_FOOTPRINT_MIXIN]);
