// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/pl_editor_frame.h` + `pl_editor_frame.cpp`:
 * `PL_EDITOR_FRAME`, the Drawing Sheet Editor's frame, on `EDA_DRAW_FRAME` —
 * the page it previews on, the coordinate origin and page choices, the tools,
 * the UI conditions, the status bar, and the item it adds for a drawing tool.
 *
 * Below the class, the parts of this file the React window
 * (`designer/.../DrawingSheetEditor.tsx`) still calls directly while the frame
 * is not hosted: the status bar's `dims[]`, the coordinate panes, the
 * `setupUIConditions` rules over its React state, and the page half of
 * `LoadSettings` / `SaveSettings`. STRUCTURE.md says why both exist.
 */

import { BASE_SCREEN } from '@ziroeda/common/base_screen.js';
import { BITMAP_BASE } from '@ziroeda/common/bitmap_base.js';
import { type Color4d, LEGACY_COLORS } from '@ziroeda/common/color4d.js';
import { PAPER_MM } from '@ziroeda/common';
import type { PageSettingsValue } from '@ziroeda/common/dialogs/dialog_page_settings.js';
import {
  CORNER_ANCHOR,
  DS_DATA_ITEM,
  DS_DATA_ITEM_BITMAP,
  DS_DATA_ITEM_POLYGONS,
  DS_DATA_ITEM_TEXT,
  DS_ITEM_TYPE,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import type { DS_DRAW_ITEM_BASE } from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import { UNDO_REDO_LIST } from '@ziroeda/common/eda_base_frame.js';
import { EDA_DRAW_FRAME, PL_EDITOR_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { drawSheetIUScale, toUserUnit } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { LAYER_DRAWINGSHEET_PAGE1, LAYER_DRAWINGSHEET_PAGEn } from '@ziroeda/common/layer_id.js';
import { ORIGIN_TRANSFORMS } from '@ziroeda/common/origin_transforms.js';
import { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { DEFAULT_THEME, GetColorSettings, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import { formatG } from '@ziroeda/common/string_utils.js';
import type { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { ACTION_CONDITIONS } from '@ziroeda/common/tool/action_manager.js';
import { EDITOR_CONDITIONS } from '@ziroeda/common/tool/editor_conditions.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import {
  type SELECTION_CONDITION,
  SELECTION_CONDITIONS,
} from '@ziroeda/common/tool/selection_conditions.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import {
  TOOL_MANAGER,
  type TOOL_MANAGER_VIEW_CONTROLS,
} from '@ziroeda/common/tool/tool_manager.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { wxChoice } from '@ziroeda/common/wx/choice.js';
import type { WX_IMAGE } from '@ziroeda/common/wx_image.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { InsertDrawingSheetFile, LoadDrawingSheetFile, SaveDrawingSheetFile } from './files.js';
import type { PL_DRAW_PANEL_GAL } from './pl_draw_panel_gal.js';
import { PL_EDITOR_LAYOUT } from './pl_editor_layout.js';
import type { PL_EDITOR_SETTINGS, PL_EDITOR_SETTINGS_JSON } from './pl_editor_settings.js';
import {
  GetLayoutFromRedoList,
  GetLayoutFromUndoList,
  RollbackFromUndo,
  SaveCopyInUndoList,
} from './pl_editor_undo_redo.js';
import { PL_ACTIONS } from './tools/pl_actions.js';
import { PL_DRAWING_TOOLS } from './tools/pl_drawing_tools.js';
import { PL_EDIT_TOOL } from './tools/pl_edit_tool.js';
import { PL_EDITOR_CONTROL } from './tools/pl_editor_control.js';
import { PL_SELECTION_TOOL } from './tools/pl_selection_tool.js';

/** `PL_EDITOR_FRAME_NAME`, the frame's wx name (common/eda_draw_frame.ts has it). [data] */
export { PL_EDITOR_FRAME_NAME };

/**
 * The docked properties panel as the frame drives it: `PROPERTIES_FRAME`'s
 * two calls (`dialogs/properties_frame.cpp`), which the page's
 * `properties_frame_ui.tsx` answers.
 */
export interface PROPERTIES_FRAME_LIKE {
  CopyPrmsFromItemToPanel(aItem: DS_DATA_ITEM | null): void;
  CopyPrmsFromGeneralToPanel(): void;
  /** `GetSize().x`, for `SaveSettings`' `m_propertiesFrameWidth`. */
  GetWidth(): number;
}

/**
 * What the frame asks of the page that hosts it, in place of the wx calls a
 * browser answers differently: the title bar, the modal message box, and the
 * file writes a desktop would make itself.
 */
export interface PL_EDITOR_FRAME_HOST {
  /** `wxFrame::SetTitle`. */
  SetTitle(aTitle: string): void;
  /** `DisplayErrorMessage( this, aText, aExtraInfo )` / `wxMessageBox`. */
  DisplayErrorMessage(aText: string, aExtraInfo?: string): void;
  /**
   * Write `aContents` to `aFullFileName` (the temp-file-and-rename of
   * `SaveDrawingSheetFile`). False when the write failed.
   */
  WriteFile(aFullFileName: string, aContents: string): boolean;
  /** `wxFileExists` and the file's text, or null when there is no such file. */
  ReadFile(aFullFileName: string): string | null;
  /** `UpdateFileHistory( aFullFileName )`. */
  UpdateFileHistory(aFullFileName: string): void;
  /** `m_infoBar->ShowMessage` / `Dismiss` for the "older version" warning. */
  ShowOutdatedSaveInfoBar(aShow: boolean): void;
  /** `Files_io( event )`: the file commands, whose dialogs are the page's. */
  Files_io(aId: PL_FILES_IO_ID): void;
  /** `ToPrinter( doPreview )`: the print dialog. */
  ToPrinter(aDoPreview: boolean): void;
  /** `ShowDesignInspector()`: the modal `DIALOG_INSPECTOR`. */
  ShowDesignInspector(): void;
  /** `DIALOG_PAGES_SETTINGS::ShowModal() == wxID_OK`. */
  ShowPageSettingsDialog(): boolean;
  /**
   * The "Choose Image" `wxFileDialog` (`ImageFileWildcard()`, starting in
   * `aDefaultDir`): the chosen file's path and bytes, or null on Cancel.
   */
  ChooseImageFile(aDefaultDir: string): { path: string; data: Uint8Array } | null;
  /** `SaveClipboard( aTextUTF8 )` (common/clipboard.cpp). */
  SaveClipboard(aText: string): boolean;
  /** `GetClipboardUTF8()`: the text a paste carries. */
  GetClipboardUTF8(): string;
  /** `GetImageFromClipboard()`: the image a paste carries, or null. */
  GetImageFromClipboard(): WX_IMAGE | null;
  /** `ShowInfoBarMsg( aMsg )`. */
  ShowInfoBarMsg(aMsg: string): void;
  /** `GetInfoBar()->Dismiss()`. */
  DismissInfoBar(): void;
}

/** The command ids `Files_io` dispatches on (`wxID_*`, `ID_APPEND_DESCR_FILE`). */
export type PL_FILES_IO_ID =
  | 'wxID_NEW'
  | 'wxID_OPEN'
  | 'wxID_SAVE'
  | 'wxID_SAVEAS'
  | 'ID_APPEND_DESCR_FILE';

/**
 * The main window used in the drawing sheet editor.
 *
 * The wx window construction (AUI panes, icons, the menu bar, the status
 * bar's widths) is the page's (`designer/.../DrawingSheetEditor.tsx`), which
 * builds the frame and hands it the canvas with
 * {@link PL_EDITOR_FRAME.AttachCanvas}: the half of the C++ constructor that
 * runs once the GAL panel exists. The members KiCad defines in other files
 * keep their files — `files.ts` (`LoadDrawingSheetFile`,
 * `InsertDrawingSheetFile`, `SaveDrawingSheetFile`) and
 * `pl_editor_undo_redo.ts` (`SaveCopyInUndoList` and the three pops) — and are
 * bound here.
 */
export class PL_EDITOR_FRAME extends EDA_DRAW_FRAME {
  protected m_propertiesPagelayout: PROPERTIES_FRAME_LIKE | null;

  private m_pageLayout = new PL_EDITOR_LAYOUT();
  private m_propertiesFrameWidth: number; // last width (in pixels) of m_propertiesPagelayout
  private m_originSelectBox: wxChoice; // Corner origin choice for coordinates
  private m_originSelectChoice: number; // the last choice for m_originSelectBox
  // The page number sel'ector (page 1 or other pages useful when there are some items which
  // are only on page 1, not on page 1
  private m_pageSelectBox: wxChoice;
  private m_mruImagePath: string; // Most recently used path for placing a new image
  private m_grid_origin: VECTOR2I = { x: 0, y: 0 };

  /// `EDA_DRAW_FRAME::m_drawBgColor`, which our base does not carry yet.
  private m_drawBgColor: Color4d = LEGACY_COLORS.WHITE;
  private m_settings: PL_EDITOR_SETTINGS;
  private m_host: PL_EDITOR_FRAME_HOST | null = null;
  private m_originTransforms = new ORIGIN_TRANSFORMS();
  private m_aboutTitle: string;

  private m_originChoiceList: readonly string[] = [
    'Left Top paper corner',
    'Right Bottom page corner',
    'Left Bottom page corner',
    'Right Top page corner',
    'Left Top page corner',
  ];

  constructor(aSettings: PL_EDITOR_SETTINGS) {
    super(FRAME_T.FRAME_PL_EDITOR, drawSheetIUScale, 'mm');

    this.m_settings = aSettings;
    this.m_propertiesPagelayout = null;
    this.m_propertiesFrameWidth = 200;
    this.m_originSelectChoice = 0;
    this.m_mruImagePath = '';

    this.SetUserUnits('mm');

    this.m_showBorderAndTitleBlock = true; // true for reference drawings.
    DS_DATA_MODEL.GetTheInstance().m_EditMode = true;
    this.m_aboutTitle = 'KiCad Drawing Sheet Editor';

    // The two toolbar choice boxes `configureToolbars` makes
    // (toolbars_pl_editor.cpp:152-185).
    this.m_originSelectBox = new wxChoice(this.m_originChoiceList);
    this.m_originSelectBox.SetSelection(this.m_originSelectChoice);
    this.m_pageSelectBox = new wxChoice(['Page 1', 'Other pages']);
    this.m_pageSelectBox.SetSelection(0);
  }

  GetName(): string {
    return PL_EDITOR_FRAME_NAME;
  }

  GetOriginTransforms(): ORIGIN_TRANSFORMS {
    return this.m_originTransforms;
  }

  override config(): PL_EDITOR_SETTINGS {
    return this.m_settings;
  }

  /** The page's answers to the frame's wx calls. */
  SetHost(aHost: PL_EDITOR_FRAME_HOST | null): void {
    this.m_host = aHost;
  }

  GetHost(): PL_EDITOR_FRAME_HOST | null {
    return this.m_host;
  }

  /** `m_aboutTitle`. */
  GetAboutTitle(): string {
    return this.m_aboutTitle;
  }

  /**
   * The rest of the constructor, once the page has made the canvas and the
   * properties panel: settings, screen, tools, UI conditions, units, the
   * grid origin and the default drawing sheet.
   */
  AttachCanvas(aCanvas: PL_DRAW_PANEL_GAL, aProperties: PROPERTIES_FRAME_LIKE | null): void {
    this.SetCanvas(aCanvas);

    this.LoadSettings(this.config());

    const pageSizeIU = this.GetPageLayout()
      .GetPageSettings()
      .GetSizeIU(drawSheetIUScale.IU_PER_MILS);
    this.SetScreen(new BASE_SCREEN(pageSizeIU));

    this.setupTools();
    this.setupUIConditions();

    this.m_propertiesPagelayout = aProperties;

    this.SwitchCanvas(this.m_canvasType);

    // Add the exit key handler
    this.setupUnits(this.config());

    const originCoord = this.ReturnCoordOriginCorner();
    this.SetGridOrigin(originCoord);

    // Initialize the current drawing sheet
    // start with the default KiCad layout
    DS_DATA_MODEL.GetTheInstance().LoadDrawingSheet('', null);
    this.OnNewDrawingSheet();
  }

  /** `~PL_EDITOR_FRAME()` / `doCloseWindow()`. */
  Destroy(): void {
    this.m_isClosing = true;

    // Ensure m_canvasType is up to date, to save it in config
    const canvas = this.GetCanvas();

    if (canvas) this.m_canvasType = canvas.GetBackend();

    // Shutdown all running tools
    if (this.m_toolManager) this.m_toolManager.ShutdownAllTools();

    // clean up the data before the view is destroyed
    DS_DATA_MODEL.GetTheInstance().ClearList();

    canvas?.Destroy();
    this.SetCanvas(null);
  }

  GetPropertiesFrame(): PROPERTIES_FRAME_LIKE | null {
    return this.m_propertiesPagelayout;
  }

  /** The toolbar's origin choice box (`ID_SELECT_COORDINATE_ORIGIN`). */
  GetOriginSelectBox(): wxChoice {
    return this.m_originSelectBox;
  }

  /** The toolbar's page choice box (`ID_SELECT_PAGE_NUMBER`). */
  GetPageSelectBox(): wxChoice {
    return this.m_pageSelectBox;
  }

  OpenProjectFiles(aFileSet: readonly string[], _aCtl = 0): boolean {
    const fn = aFileSet[0]!;

    if (!this.LoadDrawingSheetFile(fn)) {
      this.m_host?.DisplayErrorMessage(`Error loading drawing sheet '${fn}'.`);
      return false;
    } else {
      this.OnNewDrawingSheet();
      return true;
    }
  }

  // ---- files.cpp ------------------------------------------------------------

  /**
   * Load a .kicad_wks drawing sheet file.
   *
   * @param aFullFileName is the filename.
   */
  LoadDrawingSheetFile(aFullFileName: string): boolean {
    return LoadDrawingSheetFile(this, aFullFileName);
  }

  /**
   * Save the current layout in a .kicad_wks drawing sheet file.
   *
   * @param aFullFileName is the filename.
   */
  SaveDrawingSheetFile(aFullFileName: string): boolean {
    return SaveDrawingSheetFile(this, aFullFileName);
  }

  /**
   * Load a .kicad_wks drawing sheet file, and add items to the current layout list.
   *
   * @param aFullFileName is the filename.
   */
  InsertDrawingSheetFile(aFullFileName: string): boolean {
    return InsertDrawingSheetFile(this, aFullFileName);
  }

  /**
   * Get if the drawing sheet has been modified but not saved.
   *
   * @return true if the any changes have not been saved
   */
  override IsContentModified(): boolean {
    return this.GetScreen()?.IsContentModified() ?? false;
  }

  // The Tool Framework initialization
  setupTools(): void {
    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(
      null,
      this.GetCanvas()!.GetView(),
      this.GetCanvas()!.GetViewControls() as unknown as TOOL_MANAGER_VIEW_CONTROLS,
      this.config(),
      this,
    );
    this.m_actions = new PL_ACTIONS();
    this.m_toolDispatcher = new TOOL_DISPATCHER(this.m_toolManager);

    this.GetCanvas()!.SetEventDispatcher(this.m_toolDispatcher);

    // Register tools
    // COMMON_CONTROL and PICKER_TOOL are not ported to common/tool yet
    // (STRUCTURE.md); the page's menus answer COMMON_CONTROL's actions.
    this.m_toolManager.RegisterTool(new COMMON_TOOLS());
    this.m_toolManager.RegisterTool(new ZOOM_TOOL());
    this.m_toolManager.RegisterTool(new PL_SELECTION_TOOL());
    this.m_toolManager.RegisterTool(new PL_EDITOR_CONTROL());
    this.m_toolManager.RegisterTool(new PL_DRAWING_TOOLS());
    this.m_toolManager.RegisterTool(new PL_EDIT_TOOL());
    this.m_toolManager.InitTools();

    // Run the selection tool, it is supposed to be always active
    this.m_toolManager.InvokeTool('common.InteractiveSelection');
  }

  /** `setupUIConditions()` (`pl_editor_frame.cpp:305-368`). */
  protected override setupUIConditions(): void {
    super.setupUIConditions();

    const mgr = this.m_toolManager!.GetActionManager();
    const cond = new EDITOR_CONDITIONS(this);

    const ENABLE = (x: SELECTION_CONDITION): ACTION_CONDITIONS => new ACTION_CONDITIONS().Enable(x);
    const CHECK = (x: SELECTION_CONDITION): ACTION_CONDITIONS => new ACTION_CONDITIONS().Check(x);

    mgr.SetConditions(ACTIONS.save, ENABLE(SELECTION_CONDITIONS.ShowAlways));
    mgr.SetConditions(ACTIONS.undo, ENABLE(cond.UndoAvailable()));
    mgr.SetConditions(ACTIONS.redo, ENABLE(cond.RedoAvailable()));

    mgr.SetConditions(ACTIONS.toggleGrid, CHECK(cond.GridVisible()));

    mgr.SetConditions(ACTIONS.cut, ENABLE(SELECTION_CONDITIONS.NotEmpty));
    mgr.SetConditions(ACTIONS.copy, ENABLE(SELECTION_CONDITIONS.NotEmpty));
    mgr.SetConditions(
      ACTIONS.paste,
      ENABLE(SELECTION_CONDITIONS.And(SELECTION_CONDITIONS.Idle, cond.NoActiveTool())),
    );
    mgr.SetConditions(ACTIONS.doDelete, ENABLE(SELECTION_CONDITIONS.NotEmpty));

    mgr.SetConditions(ACTIONS.zoomTool, CHECK(cond.CurrentTool(ACTIONS.zoomTool)));
    mgr.SetConditions(ACTIONS.selectionTool, CHECK(cond.CurrentTool(ACTIONS.selectionTool)));
    mgr.SetConditions(ACTIONS.deleteTool, CHECK(cond.CurrentTool(ACTIONS.deleteTool)));

    mgr.SetConditions(PL_ACTIONS.drawLine, CHECK(cond.CurrentTool(PL_ACTIONS.drawLine)));
    mgr.SetConditions(PL_ACTIONS.drawRectangle, CHECK(cond.CurrentTool(PL_ACTIONS.drawRectangle)));
    mgr.SetConditions(PL_ACTIONS.placeText, CHECK(cond.CurrentTool(PL_ACTIONS.placeText)));
    mgr.SetConditions(PL_ACTIONS.placeImage, CHECK(cond.CurrentTool(PL_ACTIONS.placeImage)));

    // Not a tool, just a way to activate the action
    mgr.SetConditions(PL_ACTIONS.appendImportedDrawingSheet, CHECK(SELECTION_CONDITIONS.ShowNever));

    const titleBlockNormalMode = (_s: SELECTION): boolean =>
      DS_DATA_MODEL.GetTheInstance().m_EditMode === false;

    const titleBlockEditMode = (_s: SELECTION): boolean =>
      DS_DATA_MODEL.GetTheInstance().m_EditMode === true;

    mgr.SetConditions(PL_ACTIONS.layoutNormalMode, CHECK(titleBlockNormalMode));
    mgr.SetConditions(PL_ACTIONS.layoutEditMode, CHECK(titleBlockEditMode));
  }

  SetPageSettings(aPageSettings: PAGE_INFO): void {
    this.m_pageLayout.SetPageSettings(aPageSettings);

    const screen = this.GetScreen();

    if (screen) screen.InitDataPoints(aPageSettings.GetSizeIU(drawSheetIUScale.IU_PER_MILS));
  }

  GetPageSettings(): PAGE_INFO {
    return this.m_pageLayout.GetPageSettings();
  }

  GetPageSizeIU(): VECTOR2I {
    // this function is only needed because EDA_DRAW_FRAME is not compiled
    // with either -DPCBNEW or -DEESCHEMA, so the virtual is used to route
    // into an application specific source file.
    return this.m_pageLayout.GetPageSettings().GetSizeIU(drawSheetIUScale.IU_PER_MILS);
  }

  override GetCanvas(): PL_DRAW_PANEL_GAL | null {
    return super.GetCanvas() as PL_DRAW_PANEL_GAL | null;
  }

  override GetCurrentSelection(): SELECTION {
    return this.m_toolManager!.GetTool(PL_SELECTION_TOOL)!.GetSelection();
  }

  GetGridOrigin(): VECTOR2I {
    return this.m_grid_origin;
  }

  SetGridOrigin(aPoint: VECTOR2I): void {
    this.m_grid_origin = aPoint;

    const canvas = this.GetCanvas();

    if (canvas) {
      canvas.GetGAL().SetGridOrigin({ x: aPoint.x, y: aPoint.y });
      canvas.GetView().MarkDirty();
    }
  }

  /**
   * Calculate the position (in page, in iu) of the corner used as coordinate origin
   * of items.
   */
  ReturnCoordOriginCorner(): VECTOR2I {
    // calculate the position (in page, in iu) of the corner used as coordinate origin
    // coordinate origin can be the paper Top Left corner, or each of 4 page corners
    let originCoord: VECTOR2I = { x: 0, y: 0 };

    // To avoid duplicate code, we use a dummy segment starting at 0,0 in relative coord
    const dummy = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);

    switch (this.m_originSelectChoice) {
      default:
      case 0: // Origin = paper Left Top corner
        break;

      case 1: // Origin = page Right Bottom corner
        dummy.SetStart(0, 0, CORNER_ANCHOR.RB_CORNER);
        originCoord = dummy.GetStartPosIU();
        break;

      case 2: // Origin = page Left Bottom corner
        dummy.SetStart(0, 0, CORNER_ANCHOR.LB_CORNER);
        originCoord = dummy.GetStartPosIU();
        break;

      case 3: // Origin = page Right Top corner
        dummy.SetStart(0, 0, CORNER_ANCHOR.RT_CORNER);
        originCoord = dummy.GetStartPosIU();
        break;

      case 4: // Origin = page Left Top corner
        dummy.SetStart(0, 0, CORNER_ANCHOR.LT_CORNER);
        originCoord = dummy.GetStartPosIU();
        break;
    }

    return originCoord;
  }

  GetTitleBlock(): TITLE_BLOCK {
    return this.GetPageLayout().GetTitleBlock();
  }

  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    this.m_pageLayout.SetTitleBlock(aTitleBlock);
  }

  /**
   * `EDA_BASE_FRAME::Prj()`, or null where no program is running (a test).
   * KiCad always has one; the drawing sheet list takes null for "no project".
   */
  PrjOrNull(): PROJECT | null {
    return PgmOrNull()?.GetSettingsManager().Prj() ?? null;
  }

  override CommonSettingsChanged(aFlags = 0): void {
    super.CommonSettingsChanged(aFlags);

    const cfg = this.m_settings;
    const colors = GetColorSettings(cfg ? cfg.m_ColorTheme : DEFAULT_THEME);

    // Update gal display options like cursor shape, grid options:
    this.GetGalDisplayOptions().ReadWindowSettings(cfg.m_Window);

    const canvas = this.GetCanvas()!;
    canvas.GetView().GetPainter().GetSettings().LoadColors(colors);

    canvas.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.COLOR);
    canvas.ForceRefresh();
  }

  override DisplayGridMsg(): void {
    let gridformatter: (n: number) => string;

    switch (this.GetUserUnits()) {
      case 'in':
        gridformatter = (n) => `grid ${n.toFixed(3)}`;
        break;
      case 'mm':
        gridformatter = (n) => `grid ${n.toFixed(4)}`;
        break;
      default:
        gridformatter = (n) => `grid ${n.toFixed(6)}`;
        break;
    }

    const grid = toUserUnit(
      drawSheetIUScale,
      this.GetUserUnits(),
      this.GetCanvas()!.GetGAL().GetGridSize().x,
    );
    const line = gridformatter(grid);

    this.SetStatusText(line, 4);
  }

  override UpdateStatusBar(): void {
    // Display Zoom level:
    this.SetStatusText(this.GetZoomLevelIndicator(), 1);

    // coordinate origin can be the paper Top Left corner, or each of 4 page corners
    const originCoord = this.ReturnCoordOriginCorner();

    // We need the orientation of axis (sign of coordinates)
    let Xsign = 1;
    let Ysign = 1;

    switch (this.m_originSelectChoice) {
      default:
      case 0: // Origin = paper Left Top corner
        break;

      case 1: // Origin = page Right Bottom corner
        Xsign = -1;
        Ysign = -1;
        break;

      case 2: // Origin = page Left Bottom corner
        Ysign = -1;
        break;

      case 3: // Origin = page Right Top corner
        Xsign = -1;
        break;

      case 4: // Origin = page Left Top corner
        break;
    }

    switch (this.GetUserUnits()) {
      case 'in':
        this.SetStatusText('inches', 6);
        break;
      case 'mils':
        this.SetStatusText('mils', 6);
        break;
      case 'mm':
        this.SetStatusText('mm', 6);
        break;
      case 'unscaled':
        this.SetStatusText('', 6);
        break;
      default:
        console.assert(false);
        break;
    }

    // Display absolute and relative coordinates
    const cursorPos = this.GetCanvas()!.GetViewControls().GetCursorPosition();
    const screen = this.GetScreen();
    const fields = plCoordFields(
      cursorPos,
      originCoord,
      { xs: Xsign, ys: Ysign },
      screen ? screen.m_LocalOrigin : { x: 0, y: 0 },
      (iu) => toUserUnit(drawSheetIUScale, this.GetUserUnits(), iu),
      (n) => formatG(n, 4),
    );

    this.SetStatusText(fields.coords, 2);

    // Display relative coordinates:
    if (screen) this.SetStatusText(fields.deltas, 3);

    this.DisplayGridMsg();

    // Display corner reference for coord origin
    const line = `coord origin: ${this.m_originSelectBox.GetString(this.m_originSelectChoice)}`;
    this.SetStatusText(line, 5);
  }

  /**
   * Must be called to initialize parameters when a new drawing sheet is loaded
   */
  OnNewDrawingSheet(): void {
    this.ClearUndoRedoList();
    this.GetScreen()!.SetContentModified(false);
    this.GetCanvas()!.DisplayDrawingSheet();

    this.m_propertiesPagelayout?.CopyPrmsFromItemToPanel(null);
    this.m_propertiesPagelayout?.CopyPrmsFromGeneralToPanel();

    this.UpdateTitleAndInfo();

    this.m_toolManager!.RunAction(ACTIONS.zoomFitScreen);

    // KIPLATFORM::APP::SetShutdownBlockReason: n/a, a page cannot block a shutdown.
  }

  GetPageLayout(): PL_EDITOR_LAYOUT {
    return this.m_pageLayout;
  }

  override GetDocumentExtents(_aIncludeAllVisible = true): BOX2I {
    return new BOX2I(
      { x: 0, y: 0 },
      this.GetPageLayout().GetPageSettings().GetSizeIU(drawSheetIUScale.IU_PER_MILS),
    );
  }

  /**
   * Drawing sheet editor can show the title block using a page number 1 or another number.
   *
   * This is because some items can be shown (or not) only on page 1 (a feature  which
   * looks like word processing option "page 1 differs from other pages").
   *
   * @return true if the page 1 is selected, and false if not.
   */
  GetPageNumberOption(): boolean {
    return this.m_pageSelectBox.GetSelection() === 0;
  }

  /**
   * Display the short filename (if exists) loaded file on the caption of the main window.
   */
  UpdateTitleAndInfo(): void {
    let title = '';
    const file = this.GetCurrentFileName();

    if (this.IsContentModified()) title = '*';

    // wxFileName::IsOk() && GetName(): the name without directory or extension.
    if (file !== '') title += fileNameWithoutExt(file);
    else title += '[no drawing sheet loaded]';

    title += ' — Drawing Sheet Editor';

    this.m_title = title;
    this.m_host?.SetTitle(title);
  }

  /** The title `UpdateTitleAndInfo` last set. */
  GetTitle(): string {
    return this.m_title;
  }
  private m_title = '';

  /**
   * Display the size of the sheet to the message panel.
   */
  UpdateMsgPanelInfo(): void {
    const size = this.GetPageSettings().GetSizeIU(drawSheetIUScale.IU_PER_MILS);

    const msgItems = [
      new MSG_PANEL_ITEM('Page Width', this.GetUnitsProvider().MessageTextFromValue(size.x)),
      new MSG_PANEL_ITEM('Page Height', this.GetUnitsProvider().MessageTextFromValue(size.y)),
    ];

    this.SetMsgPanel(msgItems);
  }

  override LoadSettings(aCfg: PL_EDITOR_SETTINGS): void {
    super.LoadSettings(aCfg);

    const cfg = aCfg;

    this.m_propertiesFrameWidth = cfg.m_PropertiesFrameWidth;
    this.m_originSelectChoice = cfg.m_CornerOrigin;
    this.m_originSelectBox.SetSelection(this.m_originSelectChoice);

    this.SetDrawBgColor(cfg.m_BlackBackground ? LEGACY_COLORS.BLACK : LEGACY_COLORS.WHITE);

    PAGE_INFO.SetCustomWidthMils(cfg.m_LastCustomWidth);
    PAGE_INFO.SetCustomHeightMils(cfg.m_LastCustomHeight);

    const pageInfo = new PAGE_INFO().assign(this.GetPageSettings());
    pageInfo.SetType(cfg.m_LastPaperSize, cfg.m_LastWasPortrait);
    this.SetPageSettings(pageInfo);
  }

  override SaveSettings(aCfg: PL_EDITOR_SETTINGS): void {
    super.SaveSettings(aCfg);

    const cfg = aCfg;

    if (this.m_propertiesPagelayout)
      this.m_propertiesFrameWidth = this.m_propertiesPagelayout.GetWidth();

    cfg.m_PropertiesFrameWidth = this.m_propertiesFrameWidth;
    cfg.m_CornerOrigin = this.m_originSelectChoice;
    cfg.m_BlackBackground = colorEquals(this.GetDrawBgColor(), LEGACY_COLORS.BLACK);
    cfg.m_LastPaperSize = this.GetPageSettings().GetTypeAsString();
    cfg.m_LastWasPortrait = this.GetPageSettings().IsPortrait();
    cfg.m_LastCustomWidth = Math.trunc(PAGE_INFO.GetCustomWidthMils());
    cfg.m_LastCustomHeight = Math.trunc(PAGE_INFO.GetCustomHeightMils());
  }

  /** `EDA_DRAW_FRAME::SetDrawBgColor`. */
  SetDrawBgColor(aColor: Color4d): void {
    this.m_drawBgColor = aColor;
  }

  /** `EDA_DRAW_FRAME::GetDrawBgColor`. */
  GetDrawBgColor(): Color4d {
    return this.m_drawBgColor;
  }

  OnSelectPage(): void {
    const view = this.GetCanvas()!.GetView();
    view.SetLayerVisible(LAYER_DRAWINGSHEET_PAGE1, this.m_pageSelectBox.GetSelection() === 0);
    view.SetLayerVisible(LAYER_DRAWINGSHEET_PAGEn, this.m_pageSelectBox.GetSelection() === 1);
    this.GetCanvas()!.Refresh();
  }

  /**
   * Called when the user select one of the 4 page corner as corner reference (or the
   * left top paper corner).
   */
  OnSelectCoordOriginCorner(): void {
    this.m_originSelectChoice = this.m_originSelectBox.GetSelection();
    this.UpdateStatusBar(); // Update grid origin
    this.GetCanvas()!.DisplayDrawingSheet();
    this.GetCanvas()!.Refresh();
  }

  /**
   * @return the filename of the current layout descr file
   * If this is the default (no loaded file) returns a empty name
   * or a new design.
   */
  GetCurrentFileName(): string {
    return BASE_SCREEN.m_DrawingSheetFileName;
  }

  /**
   * Store the current layout description file filename.
   */
  SetCurrentFileName(aName: string): void {
    BASE_SCREEN.m_DrawingSheetFileName = aName;
  }

  /**
   * Refresh the library tree and redraw the window.
   */
  override HardRedraw(): void {
    this.GetCanvas()!.DisplayDrawingSheet();

    const selTool = this.m_toolManager!.GetTool(PL_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();
    let item: DS_DATA_ITEM | null = null;

    if (selection.GetSize() === 1) item = (selection.Front() as DS_DRAW_ITEM_BASE).GetPeer();

    this.m_propertiesPagelayout?.CopyPrmsFromItemToPanel(item);
    this.m_propertiesPagelayout?.CopyPrmsFromGeneralToPanel();
    this.UpdateMsgPanelInfo();
    this.GetCanvas()!.Refresh();
  }

  /**
   * Add a new item to the drawing sheet item list.
   *
   * @param aType is the type of item:
   *  DS_TEXT, DS_SEGMENT, DS_RECT, DS_POLYPOLYGON
   * @return a reference to the new item.
   */
  AddDrawingSheetItem(aType: DS_ITEM_TYPE): DS_DATA_ITEM | null {
    let item: DS_DATA_ITEM | null = null;

    switch (aType) {
      case DS_ITEM_TYPE.DS_TEXT:
        item = new DS_DATA_ITEM_TEXT('Text');
        break;

      case DS_ITEM_TYPE.DS_SEGMENT:
        item = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);
        break;

      case DS_ITEM_TYPE.DS_RECT:
        item = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_RECT);
        break;

      case DS_ITEM_TYPE.DS_POLYPOLYGON:
        item = new DS_DATA_ITEM_POLYGONS();
        break;

      case DS_ITEM_TYPE.DS_BITMAP: {
        const aImageFile = this.m_host?.ChooseImageFile(this.m_mruImagePath) ?? null;

        if (!aImageFile) return null;

        const fullFilename = aImageFile.path;
        this.m_mruImagePath = fullFilename.slice(0, Math.max(0, fullFilename.lastIndexOf('/')));

        const image = new BITMAP_BASE();

        if (!image.ReadImageFile(aImageFile.data)) {
          this.m_host?.DisplayErrorMessage(`Could not load image from '${fullFilename}'.`);
          break;
        }

        // Set the scale factor for pl_editor (it is set for Eeschema by default)
        image.SetPixelSizeIu((drawSheetIUScale.IU_PER_MILS * 1000.0) / image.GetPPI());
        item = new DS_DATA_ITEM_BITMAP(image);
        break;
      }
    }

    if (item === null) return null;

    DS_DATA_MODEL.GetTheInstance().Append(item);
    item.SyncDrawItems(null, this.GetCanvas()!.GetView());

    return item;
  }

  /** `m_mruImagePath`: the directory the next "Choose Image" dialog opens in. */
  GetMruImagePath(): string {
    return this.m_mruImagePath;
  }

  /**
   * Must be called after a change in order to set the "modify" flag.
   */
  override OnModify(): void {
    // Must be called after a change in order to set the "modify" flag and update
    // the frame title.
    super.OnModify();

    this.GetScreen()!.SetContentModified();

    if (this.m_isClosing) return;

    this.UpdateTitleAndInfo();
  }

  // ---- pl_editor_undo_redo.cpp ---------------------------------------------

  /**
   * Save a copy of the description (in a S expr string) for Undo/redo commands.
   */
  SaveCopyInUndoList(): void {
    SaveCopyInUndoList(this);
  }

  /**
   * Redo the last edit:
   *  - Place the current edited layout in undo list.
   *  - Get the previous version of the current edited layout.
   */
  GetLayoutFromRedoList(): void {
    GetLayoutFromRedoList(this);
  }

  /**
   * Undo the last edit:
   *  - Place the current layout in Redo list.
   *  - Get the previous version of the current edited layout.
   */
  GetLayoutFromUndoList(): void {
    GetLayoutFromUndoList(this);
  }

  /**
   * Apply the last command in Undo List without stacking a Redo. Used to clean the
   * Undo stack after canceling a command.
   */
  RollbackFromUndo(): void {
    RollbackFromUndo(this);
  }

  override ClearUndoORRedoList(aWhichList: UNDO_REDO_LIST, aItemCount = -1): void {
    if (aItemCount === 0) return;

    const list = aWhichList === UNDO_REDO_LIST.UNDO_LIST ? this.m_undoList : this.m_redoList;

    if (aItemCount < 0) {
      list.ClearCommandList();
    } else {
      for (let ii = 0; ii < aItemCount; ii++) {
        if (list.m_CommandsList.length === 0) break;

        list.m_CommandsList.shift();
      }
    }
  }

  /** `Files_io( event )`: the page's file dialogs (files.cpp:98-238). */
  Files_io(aId: PL_FILES_IO_ID): void {
    this.m_host?.Files_io(aId);
  }

  /**
   * Open a dialog frame to print layers.
   */
  ToPrinter(aDoPreview: boolean): void {
    this.m_host?.ToPrinter(aDoPreview);
  }

  /**
   * Show the dialog displaying the list of DS_DATA_ITEM items in the page layout
   */
  ShowDesignInspector(): void {
    this.m_host?.ShowDesignInspector();
  }

  /** `DIALOG_PAGES_SETTINGS dlg( … ); dlg.ShowModal() == wxID_OK`. */
  ShowPageSettingsDialog(): boolean {
    return this.m_host?.ShowPageSettingsDialog() ?? false;
  }

  /** `saveCurrentPageLayout()`: Save, and whether nothing is left unsaved. */
  saveCurrentPageLayout(): boolean {
    this.Files_io('wxID_SAVE');

    return !this.IsContentModified();
  }
}

/** `wxFileName( aPath ).GetName()`: the leaf without its extension. */
function fileNameWithoutExt(aPath: string): string {
  const leaf = aPath.slice(aPath.lastIndexOf('/') + 1);
  const dot = leaf.lastIndexOf('.');

  return dot > 0 ? leaf.slice(0, dot) : leaf;
}

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

// ---- the React window's half (see the file header) -------------------------

/**
 * pl_editor's own status-bar field widths: the constructor's `dims[]`.
 *
 * `EDA_DRAW_FRAME` sizes the eight KISTATUSBAR panes in its constructor
 * (`updateStatusBarWidths`, common/eda_draw_frame.cpp:792), and every other
 * draw frame keeps that table. `PL_EDITOR_FRAME` does not: it calls
 * `stsbar->SetFieldsCount( arrayDim( dims ), dims )` with a table of its own
 * (pagelayout_editor/pl_editor_frame.cpp:150-181), and that call runs after the
 * base constructor, so pl_editor's widths are the ones on screen.
 *
 * The two tables differ in five ways, and all five are visible:
 *
 * | pane | shared `EDA_DRAW_FRAME` | `PL_EDITOR_FRAME` |
 * |---|---|---|
 * | 0 message | `-3` | `-1` |
 * | 2 coords | `X 1234.1234  Y 1234.1234` | `X 0234.567  Y 0234.567` |
 * | 3 deltas | `dx 1234.1234  dy 1234.1234  dist 1234.1234` | `dx 0234.567  dx 0234.567` |
 * | 4 grid | `grid 1234.1234 x 1234.1234` | `grid 0234.567` |
 * | 5 | `Inches` | `coord origin: Right Bottom page corner` |
 * | 6 | `-2` (stretch) | `Inches` |
 * | 7 | `-2` (stretch) | `Constrain to H, V, 45` |
 *
 * Pane 5 is the one that matters most. `UpdateStatusBar` writes
 * `coord origin: <corner>` there (:803-805) and the units into pane 6
 * (:776-779), so on the shared widths the longest corner name — 38 characters
 * — has to fit a pane sized for the word "Inches". Ours did exactly that.
 *
 * ## The spacer, and why each template carries a trailing M
 *
 * Both tables add a spacer to every fixed pane, but not the same one:
 *
 *     int spacer = KIUI::GetTextSize( wxT( "M" ), stsbar ).x * 2;   // pl_editor
 *     int spacer = KIUI::GetTextSize( wxT( "M" ), stsbar ).x;       // shared
 *
 * `.ze-statusbar .cell` already carries the shared bar's one M as horizontal
 * padding, so pl_editor's second M is expressed here as a trailing `M` on each
 * template string. The template is rendered invisibly to reserve width (see
 * {@link StatusField}), so an extra glyph in it is exactly an extra glyph of
 * width and nothing else.
 *
 * ## Measured, not only read
 *
 * A live pl_editor's bar was captured at 1854 px wide and the left edge of each
 * pane's text read off the picture (`qa/probes/pl_e2e`). Field starts, after
 * subtracting the 5 px text inset: 773, 858, 1034, 1224, 1340, 1628. That makes
 * the fixed panes 85, 176, 190, 116 and 288 px wide with 226 px left for panes 6
 * and 7 — and pane 0 keeps the other 773. Every one of those follows from the
 * table above at ~7.1 px per character plus a 2 M spacer; none of them follows
 * from the shared table, whose deltas pane alone would want 42 characters.
 */

/**
 * The `dims[]` of `pl_editor_frame.cpp:150-181`, as template strings.
 *
 * Pane 0 is absent because it is proportional upstream too; with panes 1-7 all
 * fixed it takes whatever is left either way.
 */
export const PL_EDITOR_STATUS_TEMPLATES = {
  /** `KIUI::GetTextSize( wxT( "Z 762000" ), stsbar ).x + spacer` (:160). */
  zoom: 'Z 762000M',
  /** `"X 0234.567  Y 0234.567"` (:163) — two spaces, and 0s not 1s. */
  coords: 'X 0234.567  Y 0234.567M',
  /** `"dx 0234.567  dx 0234.567"` (:166) — upstream really does say `dx` twice. */
  deltas: 'dx 0234.567  dx 0234.567M',
  /** `"grid 0234.567"` (:169), which is shorter than the shared bar's. */
  grid: 'grid 0234.567M',
  /** `_( "coord origin: Right Bottom page corner" )` (:172) — "the bigger message". */
  units: 'coord origin: Right Bottom page cornerM',
  /** `_( "Inches" )` (:175), "Inches is bigger than mm". Pane 6 holds the units. */
  tool: 'InchesM',
  /** `_( "Constrain to H, V, 45" )` (:178). Pane 7 is fixed here, not stretched. */
  constraint: 'Constrain to H, V, 45M',
} as const;

/**
 * The two coordinate panes, formatted as `UpdateStatusBar` formats them
 * (pl_editor_frame.cpp:765-797).
 *
 * ## There is no empty state
 *
 * `UpdateStatusBar` always reads
 * `GetCanvas()->GetViewControls()->GetCursorPosition()`, and a freshly built
 * `VIEW_CONTROLS` holds (0, 0). It then subtracts `ReturnCoordOriginCorner()`
 * and multiplies each axis by its sign, so what a pl_editor that has never seen
 * the pointer shows depends on the origin corner and is never a dash. On a
 * `corner_origin = 1` profile with A3 paper and 10 mm margins the bar reads
 *
 *     X 410  Y 287        dx -0  dy -0
 *
 * which is (0, 0) through the right-bottom transform - and the minus zero is
 * real: `%.4g` of `0 * -1` is `-0` in C, and `formatG` reproduces it. Both were
 * photographed off the running program (`qa/probes/pl_e2e`). Ours used to print
 * the placeholders `X, Y -` and `dx, dy -`, two strings upstream has nowhere.
 *
 * Here rather than in the frame because the frame is a `.tsx` and `qa`'s
 * tsconfig sets no `--jsx`: a rule that lives inside it cannot be run, only
 * grepped for, and a fallback value is exactly the kind of rule a grep gets
 * wrong.
 *
 * @param aCursor cursor position in IU, or null before the pointer has entered.
 * @param aOrigin `ReturnCoordOriginCorner()` in page IU.
 * @param aSigns the per-axis `Xsign` / `Ysign` for the selected corner.
 * @param aLocalOrigin `GetScreen()->m_LocalOrigin`, in IU.
 * @param aToUser IU to the displayed unit (`EDA_UNIT_UTILS::UI::ToUserUnit`).
 * @param aFormat `%.4g`.
 */
export function plCoordFields(
  aCursor: { x: number; y: number } | null,
  aOrigin: { x: number; y: number },
  aSigns: { xs: number; ys: number },
  aLocalOrigin: { x: number; y: number },
  aToUser: (iu: number) => number,
  aFormat: (n: number) => string,
): { coords: string; deltas: string } {
  // `VECTOR2D cursorPos = GetCanvas()->GetViewControls()->GetCursorPosition();`
  const c = aCursor ?? { x: 0, y: 0 };
  const at = (v: number, o: number, s: number): string => aFormat(aToUser((v - o) * s));
  return {
    coords: `X ${at(c.x, aOrigin.x, aSigns.xs)}  Y ${at(c.y, aOrigin.y, aSigns.ys)}`,
    deltas: `dx ${at(c.x, aLocalOrigin.x, aSigns.xs)}  dy ${at(c.y, aLocalOrigin.y, aSigns.ys)}`,
  };
}

/**
 * `PL_EDITOR_FRAME::setupUIConditions` (pl_editor_frame.cpp:305-368) — the
 * table that decides which menu rows and toolbar buttons are greyed out, and
 * which paint checked.
 *
 * Upstream this is one table read by both the menu and the toolbar, because an
 * `ACTION_TOOLBAR` button and a menu row share the action's
 * `ACTION_CONDITIONS`. Ours has to be one module for the same reason: a rule
 * restated at two call sites drifts at one of them.
 *
 * `.ts` and not part of the frame component so the suite can execute the rules
 * rather than grep for them.
 */

/** How deep the two stacks are — `GetUndoCommandCount()` / `GetRedoCommandCount()`. */
export interface HistoryDepth {
  readonly undo: number;
  readonly redo: number;
}

/**
 * What the frame knows about which interactive tool is running. Upstream reads
 * this off `TOOLS_HOLDER::m_toolStack` and the selection's edit flags; ours
 * keeps the same two facts in React state.
 */
export interface ToolState {
  /** The armed right-toolbar tool. `'select'` is "nothing pushed". */
  readonly activeTool: string;
  /** An item is being dragged — `IS_MOVING` on the selection front. */
  readonly moving: boolean;
  /** A shape is mid-placement — `IS_NEW` on the selection front. */
  readonly drawing: boolean;
}

/**
 * `ENABLE( cond.UndoAvailable() )` / `RedoAvailable()`
 * (pl_editor_frame.cpp:319-320), which resolve to `GetUndoCommandCount() > 0`
 * and `GetRedoCommandCount() > 0` (editor_conditions.cpp:169-178).
 */
export function undoEnabled(depth: HistoryDepth): boolean {
  return depth.undo > 0;
}

export function redoEnabled(depth: HistoryDepth): boolean {
  return depth.redo > 0;
}

/**
 * `ENABLE( SELECTION_CONDITIONS::Idle && cond.NoActiveTool() )` on
 * `ACTIONS::paste` (pl_editor_frame.cpp:326).
 *
 * `NoActiveTool` is `ToolStackIsEmpty()` (editor_conditions.cpp:195-198): a
 * drawing tool, the delete tool and the zoom-area tool all `PushTool`
 * (pl_drawing_tools.cpp:81, :245; pl_edit_tool.cpp:128), so any of them armed
 * greys Paste out. `Idle` is the selection carrying none of
 * `IS_NEW | IS_PASTED | IS_MOVING` (selection_conditions.cpp:47-52), which
 * covers the moment between the two clicks of a placement and a drag in
 * progress.
 *
 * Cut, Copy and Delete take `SELECTION_CONDITIONS::NotEmpty` instead
 * (:328-331) — those are already wired.
 */
export function pasteEnabled(tools: ToolState): boolean {
  return tools.activeTool === 'select' && !tools.moving && !tools.drawing;
}

/**
 * The toolbar's half of the same table. `ACTION_TOOLBAR::RefreshBitmaps` walks
 * the action manager's conditions, so a top-toolbar Undo greys out with the
 * Edit menu's row and never separately.
 */
export function toolbarDisabledIds(depth: HistoryDepth): ReadonlySet<string> {
  const out = new Set<string>();

  if (!undoEnabled(depth)) out.add('undo');
  if (!redoEnabled(depth)) out.add('redo');

  return out;
}

/**
 * The preview page and title-block data the Drawing Sheet Editor resolves
 * `${…}` against.
 *
 * Standalone `pl_editor` has no schematic and no board to take a page or a
 * title block from, so DIALOG_PAGES_SETTINGS edits a preview copy instead —
 * which is why its labels say "Preview" (dialog_page_settings.cpp:82-88) and
 * why none of this is written to the `.kicad_wks`.
 *
 * A `.ts` module rather than part of the dialog component, so the test suite
 * can reach it: `qa`'s tsconfig has no `--jsx` and cannot import a `.tsx` at
 * all.
 */

/**
 * The preview page + title block data the resolver consumes.
 *
 * It is `DIALOG_PAGES_SETTINGS`' own state under a local name, not a second
 * shape: upstream this frame edits a `PAGE_INFO` and a `TITLE_BLOCK` like every
 * other caller, and the only thing pl_editor-specific about it is that nothing
 * writes it to the `.kicad_wks`. An alias rather than a copy, so a field added
 * to one is added to both.
 */
export type PreviewSettings = PageSettingsValue;

/**
 * The Drawing Sheet Editor's own page defaults — `PL_EDITOR_SETTINGS`, not the
 * shared page dialog's:
 *
 *     PARAM<wxString>( "last_paper_size",   &m_LastPaperSize,   "A3" )
 *     PARAM<int>(      "last_custom_width",  &m_LastCustomWidth,  17000 )
 *     PARAM<int>(      "last_custom_height", &m_LastCustomHeight, 11000 )
 *                                     pagelayout_editor/pl_editor_settings.cpp:52-56
 *
 * **A3, not A4.** pl_editor is the only editor whose page default is not the
 * schematic's A4, and `LoadSettings` feeds `m_LastPaperSize` straight into
 * `SetPageSettings` (`pl_editor_frame.cpp:543-548`), so it is what a fresh
 * profile opens on.
 *
 * It is visible the moment you put the two windows side by side: A3 is 420 mm
 * where A4 is 297, so the border's coordinate band runs 1..8 across the top on
 * KiCad's and ran 1..6 on ours — the marks repeat every 50 mm. The margin was
 * never the problem; measured off both windows it is 9.93 mm on KiCad's and
 * 9.95 mm on ours, which is the 10 mm the sheet declares. The PAGE was the
 * problem.
 *
 * The two custom sizes are already right: 17000 x 11000 mils is 431.8 x 279.4 mm.
 */
export function defaultPreviewSettings(): PreviewSettings {
  return {
    paper: 'A3',
    portrait: false,
    customWidthMM: 431.8,
    customHeightMM: 279.4,
    date: '',
    rev: '',
    title: '',
    company: '',
    comments: ['', '', '', '', '', '', '', '', ''],
  };
}

/** One mil in millimetres — the exact inch, not a rounded conversion. */
const MM_PER_MIL = 0.0254;

/**
 * `clampWidth` / `clampHeight` (common/page_info.cpp:180-195): a custom page
 * edge is floored at 10 mils on the way *in*, wherever it came from.
 */
function clampMils(mils: number): number {
  return mils < 10 ? 10 : mils;
}

/**
 * The page half of `PL_EDITOR_FRAME::LoadSettings` (pl_editor_frame.cpp:543-548).
 *
 *     PAGE_INFO::SetCustomWidthMils( cfg->m_LastCustomWidth );
 *     PAGE_INFO::SetCustomHeightMils( cfg->m_LastCustomHeight );
 *     PAGE_INFO pageInfo = GetPageSettings();
 *     pageInfo.SetType( cfg->m_LastPaperSize, cfg->m_LastWasPortrait );
 *     SetPageSettings( pageInfo );
 *
 * Only the page is restored; the title block, date, revision and the nine
 * comments are not persisted by any parameter and open blank every time
 * (`m_pageLayout.GetTitleBlock()` is default-constructed and nothing seeds it,
 * pl_editor_frame.cpp:625-634).
 */
export function previewSettingsFromConfig(cfg: PL_EDITOR_SETTINGS_JSON): PreviewSettings {
  return {
    ...defaultPreviewSettings(),
    paper: cfg.last_paper_size,
    portrait: cfg.last_was_portrait,
    customWidthMM: clampMils(cfg.last_custom_width) * MM_PER_MIL,
    customHeightMM: clampMils(cfg.last_custom_height) * MM_PER_MIL,
  };
}

/**
 * The page half of `PL_EDITOR_FRAME::SaveSettings` (pl_editor_frame.cpp:563-566).
 *
 *     cfg->m_LastPaperSize   = GetPageSettings().GetTypeAsString();
 *     cfg->m_LastWasPortrait = GetPageSettings().IsPortrait();
 *     cfg->m_LastCustomWidth  = PAGE_INFO::GetCustomWidthMils();
 *     cfg->m_LastCustomHeight = PAGE_INFO::GetCustomHeightMils();
 *
 * The two custom edges are **doubles** on `PAGE_INFO` (page_info.cpp:70-71,
 * include/page_info.h:197-202) and **ints** in the settings object
 * (pl_editor_settings.h:45-46), so the assignment truncates toward zero. That
 * loss is upstream's and is reproduced rather than corrected: a settings file
 * holding more precision than KiCad's would come back as a page KiCad cannot
 * produce. See the same rule for wx field text elsewhere in this tree.
 */
export function writePageToConfig(cfg: PL_EDITOR_SETTINGS_JSON, s: PreviewSettings): void {
  cfg.last_paper_size = s.paper;
  cfg.last_was_portrait = s.portrait;
  cfg.last_custom_width = Math.trunc(s.customWidthMM / MM_PER_MIL);
  cfg.last_custom_height = Math.trunc(s.customHeightMM / MM_PER_MIL);
}

/** Resolved page size in mm for the current settings (orientation applied). */
export function previewPageMM(s: PreviewSettings): [number, number] {
  const base: [number, number] =
    s.paper === 'User' ? [s.customWidthMM, s.customHeightMM] : (PAPER_MM[s.paper] ?? PAPER_MM.A4!);
  // Custom sizes are stored as entered; standard sizes swap for portrait.
  if (s.paper === 'User') return base;
  return s.portrait ? [base[1], base[0]] : base;
}

/** Human description of the page (design-inspector root row / status bar). */
export function paperDescription(s: PreviewSettings): string {
  const [w, h] = previewPageMM(s);
  return `${s.paper} ${w}x${h}mm ${s.paper === 'User' ? '' : s.portrait ? 'portrait' : 'landscape'}`.trim();
}
