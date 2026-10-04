// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDIT_FRAME` (pcbnew/footprint_edit_frame.h) — so far only its
 * KIWAY half: the mail it takes in. `FootprintEditor.tsx` is the window and
 * owns the library tree and canvas each command changes, so the frame
 * reaches them through {@link FOOTPRINT_EDIT_FRAME_HOOKS}.
 */
import { pcbIUScale, PCB_IU_PER_MM } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { FOOTPRINT_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import {
  PCB_BASE_EDIT_FRAME,
  type PCB_BASE_EDIT_FRAME_DIALOG_HOOKS,
} from './pcb_base_edit_frame.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { DisplayErrorMessage, type UnsavedChangesResult } from '@ziroeda/common/confirm.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { PCB_DRC_CODE as DRCE } from './drc/drc_item.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import { CLEARANCE_LAYER_FOR, IsCopperLayer, type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from './pcb_base_frame.js';
import { BOARD, BOARD_USE } from './board.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import type { FOOTPRINT } from './footprint.js';
import { PCB_SCREEN } from './pcb_screen.js';
import { PCBNEW_SETTINGS } from './pcbnew_settings.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { COMMON_CONTROL } from '@ziroeda/common/tool/common_control.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import { EMBED_TOOL } from '@ziroeda/common/tool/embed_tool.js';
import { PROPERTIES_TOOL } from '@ziroeda/common/tool/properties_tool.js';
import { PCB_SELECTION_TOOL } from './tools/pcb_selection_tool.js';
import { EDIT_TOOL } from './tools/edit_tool.js';
import { PCB_EDIT_TABLE_TOOL } from './tools/pcb_edit_table_tool.js';
import { PAD_TOOL } from './tools/pad_tool.js';
import { DRAWING_TOOL } from './tools/drawing_tool.js';
import { PCB_POINT_EDITOR } from './tools/pcb_point_editor.js';
import { PCB_CONTROL } from './tools/pcb_control.js';
import { ALIGN_DISTRIBUTE_TOOL } from './tools/align_distribute_tool.js';
import { PCB_PICKER_TOOL } from './tools/pcb_picker_tool.js';
import { POSITION_RELATIVE_TOOL } from './tools/position_relative_tool.js';
import { PCB_VIEWER_TOOLS } from './tools/pcb_viewer_tools.js';
import { PCB_GROUP_TOOL } from './tools/pcb_group_tool.js';
import { CONVERT_TOOL } from './tools/convert_tool.js';
import { PCB_TOOL_BASE } from './tools/pcb_tool_base.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { parse } from '@ziroeda/sexpr';
import { FOOTPRINT_EDIT_FRAME_LOAD_SELECT_MIXIN } from './load_select_footprint.js';
import { FOOTPRINT_EDIT_FRAME_INITPCB_MIXIN } from './initpcb.js';
import { FOOTPRINT_EDITOR_UTILS_MIXIN } from './footprint_editor_utils.js';
import { FOOTPRINT_LIBRARIES_UTILS_MIXIN } from './footprint_libraries_utils.js';
import {
  frameTitle,
  type FrameTitleParts,
  READ_ONLY_SUFFIX,
  UNSAVED_SUFFIX,
} from '@ziroeda/common/use_document_title.js';
import { gridSizeToIU } from '@ziroeda/common/settings/grid_settings_ui.js';
import { gridSnappingEnabled } from '@ziroeda/common/draw_panel_gal_grid_cursor.js';
import { defaultUnitsToggle } from '@ziroeda/common/settings/app_settings_units.js';
import type { FP_EDIT_JSON_SETTINGS_LIKE as FpEditSettings } from './footprint_editor_settings.js';
import { readFootprintFile } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { type Board, type PcbFootprint, type PcbLayerDef } from './types.js';
import { FOOTPRINT_EDITOR_CONTROL } from './tools/footprint_editor_control.js';
import { LIBRARY_EDITOR_CONTROL } from '@ziroeda/common/tool/library_editor_control.js';
import type { LIB_TREE } from '@ziroeda/common/eda_draw_frame.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import type { FOOTPRINT_LIBRARY_ADAPTER } from './footprint_library_adapter.js';
import { LAYER_CLASS, TEXT_ITEM_INFO } from './board_design_settings.js';
import { LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import type { DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR } from './dialogs/dialog_footprint_properties_fp_editor.js';

export interface FOOTPRINT_EDIT_FRAME_HOOKS extends PCB_BASE_EDIT_FRAME_DIALOG_HOOKS {
  /**
   * `MAIL_FP_EDIT`'s body: find the footprint file's library, select the
   * footprint in the tree and load it.
   */
  fpEdit(aFile: string): void;
  /**
   * `EDA_LIST_DIALOG::ShowModal()` (`SelectFootprintFromBoard`): a one-column
   * list dialog over the window. Answers the text of the row chosen, or null
   * when cancelled. Optional: a frame with no window chooses nothing.
   */
  selectFromList?(
    aMessage: string,
    aHeaders: readonly string[],
    aItems: readonly (readonly string[])[],
  ): Promise<string | null>;
  /** `OnModify()`'s window half: the title's modified mark. */
  onModify?(): void;
  /**
   * `UnsavedChangesDialog( this, aMessage, ... )`: Save, Discard Changes or
   * Cancel. Without a window there is nobody to ask, and nothing is saved.
   */
  askUnsavedChanges?(aMessage: string): Promise<UnsavedChangesResult>;
  /** The window's half of LoadFootprintFromLibrary: zoom to fit, the 3D view, the tree. */
  onFootprintLoaded?(aFPID: LIB_ID): void;
  /**
   * `SyncLibraryTree`'s middle: `adapter->Sync( footprints )` and
   * `GetLibTree()->Regenerate( true )` — the tree's rows rebuilt from the
   * library adapter, the expanded libraries kept.
   */
  syncLibraryTree?(): void;
  /** `EDA_BASE_FRAME::ShowInfoBarError`: the window's infobar. */
  showInfoBarError?(aErrorMsg: string, aShowCloseButton: boolean): void;
  /** `EDA_BASE_FRAME::ShowInfoBarWarning`. */
  showInfoBarWarning?(aWarningMsg: string, aShowCloseButton: boolean): void;
  /** `EDA_BASE_FRAME::ShowInfoBarMsg`. */
  showInfoBarMsg?(aMsg: string, aShowCloseButton: boolean): void;
  /** `wxFrame::SetTitle`, which `UpdateTitle` ends with. */
  setTitle?(aTitle: string): void;
  /** `m_auimgr.GetPane( m_treePane ).IsShown()`. Shown when there is no window. */
  isLibraryTreeShown?(): boolean;
  /** `ToggleLibraryTree()`'s pane half. */
  toggleLibraryTree?(): void;
  /** `ToggleLayersManager()`'s pane half: the Appearance and Selection Filter panes. */
  toggleLayersManager?(): void;
  /** `ToggleProperties()`'s pane half. */
  toggleProperties?(): void;
  /**
   * `ConfirmRevertDialog( this, aMessage )` (confirm.cpp): Revert or Cancel,
   * with "Your current changes will be permanently lost." under it.
   */
  confirmRevert?(aMessage: string): Promise<boolean>;
  /**
   * `SAVE_AS_DIALOG( this, footprintName, libraryName, validator )` and its
   * ShowModal: the library and name chosen, or null for Cancel. The window
   * runs `aValidator` on OK and keeps the dialog up while it answers false.
   */
  showSaveAsDialog?(
    aFootprintName: string,
    aLibraryName: string,
    aValidator: (aNewLib: string, aNewName: string) => Promise<boolean>,
  ): Promise<{ library: string; name: string } | null>;
  /**
   * `ImportFootprint`'s `wxFileDialog( this, _( "Import Footprint" ), m_mruPath,
   * …, wxFD_OPEN | wxFD_FILE_MUST_EXIST )`: the file chosen, read, or null.
   */
  showImportFootprintDialog?(): Promise<{ path: string; text: string } | null>;
  /**
   * A save-mode `wxFileDialog( this, aTitle, aDefaultDir, aDefaultName, aWildcard,
   * wxFD_SAVE | wxFD_OVERWRITE_PROMPT )`: the path chosen, or null.
   */
  showSaveFileDialog?(
    aTitle: string,
    aDefaultName: string,
    aWildcard: ChooserFilter,
  ): Promise<{ path: string } | null>;
  /** `wxFopen( path, "wt" )` + `fprintf`: false when it could not be written. */
  writeTextFile?(aPath: string, aText: string): boolean;
  /** `GetInfoBar()->Dismiss()` when it is shown with a close button. */
  dismissInfoBar?(): void;
  /**
   * `DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR dialog( this, aFootprint );
   * dialog.ShowQuasiModal() == wxID_OK`: true when OK closed it.
   */
  showFootprintPropertiesFpEditorDialog?(
    aDialog: DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR,
  ): Promise<boolean>;
  /** `UpdateUserInterface()`'s window half: the layer widget and the toolbars re-read. */
  updateUserInterface?(): void;
  /** `KIDIALOG( this, … ).ShowModal()`, through the window's KiDialog host. */
  askKiDialog?(aRequest: KiDialogRequest): Promise<KiDialogResult>;
}

export interface FOOTPRINT_EDIT_FRAME
  extends FOOTPRINT_EDIT_FRAME_LOAD_SELECT_MIXIN,
    FOOTPRINT_EDIT_FRAME_INITPCB_MIXIN,
    FOOTPRINT_EDITOR_UTILS_MIXIN,
    FOOTPRINT_LIBRARIES_UTILS_MIXIN {}

/**
 * `FOOTPRINT_EDIT_FRAME` (pcbnew/footprint_edit_frame.cpp): a PCB_BASE_EDIT_FRAME
 * whose BOARD is a footprint holder (`BOARD_USE::FPHOLDER`) carrying the one
 * footprint being edited, edited by pcbnew's own tools in their footprint
 * mode. The canvas is the window's and arrives later (`ActivateGalCanvas`),
 * as PCB_EDIT_FRAME's does.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (the four *_MIXIN halves, see libs/core/mixins.ts)
export class FOOTPRINT_EDIT_FRAME extends PCB_BASE_EDIT_FRAME {
  protected readonly hooks: FOOTPRINT_EDIT_FRAME_HOOKS;
  /** `m_originalFootprintCopy`: the footprint as loaded, for IsContentModified. */
  private m_originalFootprintCopy: FOOTPRINT | null = null;
  /** `m_footprintNameWhenLoaded`. */
  protected m_footprintNameWhenLoaded = '';
  /**
   * `PROJECT_PCB::FootprintLibAdapter( &Prj() )`: the libraries this frame
   * loads from and saves to. Every holder board `Clear_Pcb` makes is given it,
   * as KiCad's is given the project.
   */
  protected m_footprintLibAdapter: FOOTPRINT_LIBRARY_ADAPTER | null = null;
  /** `GetLibTree()`: the Footprints pane's LIB_TREE, once the window has one. */
  protected m_libTree: LIB_TREE | null = null;
  /** `m_mruPath`: where Export last went, when `m_LastExportPath` is empty. */
  protected m_mruPath = '';
  /**
   * `cfg->m_DesignSettings`: `fpedit.json`'s `design_settings`, which every
   * holder board takes (`LoadSettings`, `CommonSettingsChanged`, `Clear_Pcb`).
   */
  private m_cfgDesignSettings: FpEditSettings['design_settings'] | null = null;

  constructor(hooks: FOOTPRINT_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_FOOTPRINT_EDITOR);
    this.hooks = hooks;

    this.SetBoard(new BOARD());

    this.GetBoard()!.SetBoardUse(BOARD_USE.FPHOLDER);

    this.GetBoard()!.GetDesignSettings().m_NetSettings.GetDefaultNetclass().SetClearance(0);

    this.GetBoard()!.GetDesignSettings().m_SolderMaskExpansion = 0;

    this.GetBoard()!.SetVisibleAlls();

    this.SetPageSettings(new PAGE_INFO(PAGE_SIZE_TYPE.A4));
    this.SetScreen(new PCB_SCREEN(this.GetPageSettings().GetSizeIU(pcbIUScale.IU_PER_MILS)));

    this.setupTools();
  }

  /** `FOOTPRINT_EDIT_FRAME::setupTools` (footprint_edit_frame.cpp:1220-1270). */
  private setupTools(): void {
    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(this.GetBoard(), null, null, this.config(), this);
    this.m_toolDispatcher = new TOOL_DISPATCHER(this.m_toolManager);

    this.m_toolManager.RegisterTool(new COMMON_CONTROL());
    this.m_toolManager.RegisterTool(new COMMON_TOOLS());
    this.m_toolManager.RegisterTool(new PCB_SELECTION_TOOL());
    this.m_toolManager.RegisterTool(new ZOOM_TOOL());
    this.m_toolManager.RegisterTool(new EDIT_TOOL());
    this.m_toolManager.RegisterTool(new PCB_EDIT_TABLE_TOOL());
    this.m_toolManager.RegisterTool(new PAD_TOOL());
    this.m_toolManager.RegisterTool(new DRAWING_TOOL());
    this.m_toolManager.RegisterTool(new PCB_POINT_EDITOR());
    this.m_toolManager.RegisterTool(new PCB_CONTROL()); // copy/paste
    this.m_toolManager.RegisterTool(new LIBRARY_EDITOR_CONTROL());
    this.m_toolManager.RegisterTool(new FOOTPRINT_EDITOR_CONTROL());
    this.m_toolManager.RegisterTool(new ALIGN_DISTRIBUTE_TOOL());
    this.m_toolManager.RegisterTool(new PCB_PICKER_TOOL());
    this.m_toolManager.RegisterTool(new POSITION_RELATIVE_TOOL());
    // Not yet a TOOL: ARRAY_TOOL.
    this.m_toolManager.RegisterTool(new PCB_VIEWER_TOOLS());
    this.m_toolManager.RegisterTool(new PCB_GROUP_TOOL());
    this.m_toolManager.RegisterTool(new CONVERT_TOOL());
    // Not ported: SCRIPTING_TOOL (no Python in the browser).
    this.m_toolManager.RegisterTool(new PROPERTIES_TOOL());
    this.m_toolManager.RegisterTool(new EMBED_TOOL());

    for (const tool of this.m_toolManager.Tools()) {
      if (tool instanceof PCB_TOOL_BASE) tool.SetIsFootprintEditor(true);
    }

    this.m_toolManager.InitTools();

    this.m_toolManager.InvokeTool('common.InteractiveSelection');
  }

  GetName(): string {
    return FOOTPRINT_EDIT_FRAME_NAME;
  }

  /** `GetModel()`: the footprint being edited. */
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.GetBoard()?.GetFirstFootprint() ?? null;
  }

  /** `GetPcbNewSettings()`: the board editor's settings, which the tools share. */
  GetPcbNewSettings(): PCBNEW_SETTINGS {
    const cfg = PgmOrNull()?.GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew');

    if (cfg) return cfg;

    // No PGM_BASE (a unit test): the defaults, kept so edits to them stick.
    if (!this.m_fallbackSettings) this.m_fallbackSettings = new PCBNEW_SETTINGS();

    return this.m_fallbackSettings;
  }

  private m_fallbackSettings: PCBNEW_SETTINGS | null = null;

  /**
   * `m_editorSettings`, `GetAppSettings<FOOTPRINT_EDITOR_SETTINGS>( "fpedit" )`:
   * one object for the frame's life, so what a tool writes into it stays
   * written. The window keeps it and `fpedit.json` in step.
   */
  private readonly m_editorSettings: FOOTPRINT_EDITOR_SETTINGS_LIKE = {
    m_DisplayInvertXAxis: false,
    m_DisplayInvertYAxis: false,
    m_AngleSnapMode: LEADER_MODE.DIRECT,
  };

  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return this.m_editorSettings;
  }

  /**
   * `ReloadFootprint` (footprint_edit_frame.cpp:623-718): the board emptied,
   * the original kept for IsContentModified, the footprint added.
   */
  ReloadFootprint(aFootprint: FOOTPRINT): void {
    // Cancel a mid-draw tool before the footprint it points into is freed (#24975).
    this.GetToolManager()?.ResetTools(RESET_REASON.MODEL_RELOAD);

    this.GetBoard()!.DeleteAllFootprints();

    this.m_originalFootprintCopy = aFootprint.Clone() as FOOTPRINT;
    this.m_originalFootprintCopy.SetParent(null);

    this.m_footprintNameWhenLoaded = aFootprint.GetFPID().GetUniStringLibItemName();

    super.AddFootprintToBoard(aFootprint);
    // Ensure item UUIDs are valid
    // ("old" footprints can have null uuids that create issues in fp editor)
    aFootprint.FixUuids();
  }

  /**
   * `GetDesignSettings() = cfg->m_DesignSettings` (footprint_edit_frame.cpp:787,
   * :1525): the footprint editor's own design settings — its default text
   * items and each layer class's line and text defaults — onto the board, now
   * and on every board `Clear_Pcb` makes.
   */
  LoadFootprintEditorDesignSettings(aCfg: FpEditSettings['design_settings']): void {
    this.m_cfgDesignSettings = aCfg;

    const board = this.GetBoard();

    if (board) this.ApplyFootprintEditorDesignSettings(board);
  }

  /**
   * The copy itself. `PARAM_SCALED` stores millimetres; the board holds IU.
   * Only what `fpedit.json` carries is copied: the dimension defaults are not
   * in our settings file yet, and keep the board's.
   */
  ApplyFootprintEditorDesignSettings(aBoard: BOARD): void {
    const cfg = this.m_cfgDesignSettings;

    if (!cfg) return;

    const bds = aBoard.GetDesignSettings();

    bds.m_DefaultFPTextItems = cfg.default_footprint_text_items.map(
      (item) =>
        new TEXT_ITEM_INFO(item.text, item.visible, LSET_NameToLayer(item.layer) as PCB_LAYER_ID),
    );

    const mm = (aValue: number): number => pcbIUScale.mmToIU(aValue);
    const classes: [
      LAYER_CLASS,
      FpEditSettings['design_settings'][keyof FpEditSettings['design_settings']],
    ][] = [
      [LAYER_CLASS.LAYER_CLASS_SILK, cfg.silk],
      [LAYER_CLASS.LAYER_CLASS_COPPER, cfg.copper],
      [LAYER_CLASS.LAYER_CLASS_EDGES, cfg.edges],
      [LAYER_CLASS.LAYER_CLASS_COURTYARD, cfg.courtyard],
      [LAYER_CLASS.LAYER_CLASS_FAB, cfg.fab],
      [LAYER_CLASS.LAYER_CLASS_OTHERS, cfg.others],
    ];

    for (const [cls, row] of classes) {
      const r = row as Partial<{
        line_width: number;
        text_size_h: number;
        text_size_v: number;
        text_thickness: number;
        text_italic: boolean;
      }>;

      if (r.line_width !== undefined) bds.m_LineThickness[cls] = mm(r.line_width);

      if (r.text_size_h !== undefined && r.text_size_v !== undefined)
        bds.m_TextSize[cls] = { x: mm(r.text_size_h), y: mm(r.text_size_v) };

      if (r.text_thickness !== undefined) bds.m_TextThickness[cls] = mm(r.text_thickness);

      if (r.text_italic !== undefined) bds.m_TextItalic[cls] = r.text_italic;
    }
  }

  /** `PROJECT_PCB::FootprintLibAdapter( &Prj() )`. */
  FootprintLibAdapter(): FOOTPRINT_LIBRARY_ADAPTER | null {
    return this.m_footprintLibAdapter;
  }

  /** The project's libraries, handed to the frame and to its holder board. */
  SetFootprintLibAdapter(aAdapter: FOOTPRINT_LIBRARY_ADAPTER | null): void {
    this.m_footprintLibAdapter = aAdapter;
    this.GetBoard()?.SetFootprintLibAdapter(aAdapter);
  }

  /**
   * `LoadFootprint`'s library read, through this frame's adapter. A hosted
   * library's file may not be fetched yet, so the asynchronous read is asked
   * first when the adapter has one.
   */
  override loadFootprintFromLibraryWindow(
    aFootprintId: LIB_ID,
    aKeepUUID: boolean,
  ): Promise<FOOTPRINT | null> | null {
    const adapter = this.m_footprintLibAdapter;
    const nickname = aFootprintId.GetUniStringLibNickname();

    if (!adapter?.LoadFootprintAsync || nickname === '') return null;

    return adapter.LoadFootprintAsync(nickname, aFootprintId.GetUniStringLibItemName(), aKeepUUID);
  }

  override ShowInfoBarError(aErrorMsg: string, aShowCloseButton = false): void {
    this.hooks.showInfoBarError?.(aErrorMsg, aShowCloseButton);
  }

  override ShowInfoBarWarning(aWarningMsg: string, aShowCloseButton = false): void {
    this.hooks.showInfoBarWarning?.(aWarningMsg, aShowCloseButton);
  }

  override ShowInfoBarMsg(aMsg: string, aShowCloseButton = false): void {
    this.hooks.showInfoBarMsg?.(aMsg, aShowCloseButton);
  }

  /** The window's Footprints pane, or null to forget it. */
  SetLibTree(aLibTree: LIB_TREE | null): void {
    this.m_libTree = aLibTree;
  }

  override GetLibTree(): LIB_TREE | null {
    return this.m_libTree;
  }

  /** `IsLibraryTreeShown()` (footprint_edit_frame.cpp:396-399). */
  override IsLibraryTreeShown(): boolean {
    return this.hooks.isLibraryTreeShown?.() ?? true;
  }

  /** `ToggleLibraryTree()` (:402-419). */
  override ToggleLibraryTree(): void {
    this.hooks.toggleLibraryTree?.();
  }

  /** `ToggleLayersManager()` (:422-444). */
  ToggleLayersManager(): void {
    this.hooks.toggleLayersManager?.();
  }

  override ToggleProperties(): void {
    this.hooks.toggleProperties?.();
  }

  /**
   * `GetTargetFPID()` (:472-483): the tree's selection when the tree is shown,
   * else — or when nothing is selected there — the loaded footprint.
   */
  GetTargetFPID(): LIB_ID {
    let id = new LIB_ID();

    if (this.IsLibraryTreeShown()) id = this.GetLibTree()?.GetSelectedLibId() ?? new LIB_ID();

    if (id.GetLibNickname() === '') id = this.GetLoadedFPID();

    return id;
  }

  /** `ClearModify()` (:503-511). */
  ClearModify(): void {
    if (this.GetBoard()?.GetFirstFootprint()) {
      this.m_footprintNameWhenLoaded = this.GetBoard()!
        .GetFirstFootprint()!
        .GetFPID()
        .GetUniStringLibItemName();
    }

    this.GetScreen()?.SetContentModified(false);
  }

  /** `UpdateTitle()` (:1094-1146). */
  UpdateTitle(): void {
    let title = '';
    const fpid = this.GetLoadedFPID();
    const footprint = this.GetBoard()?.GetFirstFootprint() ?? null;
    let writable = true;

    if (this.IsCurrentFPFromBoard()) {
      if (this.IsContentModified()) title = '*';

      title += footprint!.GetReference();
      title += ` ${fromBoardSuffix(this.Prj().GetProjectName())}`;
    } else if (fpid.IsValid()) {
      writable =
        this.m_footprintLibAdapter?.IsFootprintLibWritable?.(fpid.GetLibNickname()) ?? true;

      // Note: don't used GetLoadedFPID(); footprint name may have been edited
      if (this.IsContentModified()) title = '*';

      title += footprint!.GetFPID().Format();

      if (!writable) title += ' [Read Only]';
    } else if (fpid.GetLibItemName() !== '') {
      // Note: don't used GetLoadedFPID(); footprint name may have been edited
      if (this.IsContentModified()) title = '*';

      title += footprint!.GetFPID().GetLibItemName();
      title += ' [Unsaved]';
    } else {
      title = FP_NO_DOCUMENT;
    }

    title += ` \u2014 ${FP_FRAME_NAME}`;

    this.hooks.setTitle?.(title);
  }

  /** `UpdateView()` (:1186-1193). */
  UpdateView(): void {
    const canvas = this.GetCanvas();

    if (canvas) {
      canvas.UpdateColors();
      canvas.DisplayBoard(this.GetBoard()!);
    }

    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);
    this.m_propertiesPanel?.UpdateData();
    this.UpdateTitle();
  }

  /**
   * `SyncLibraryTree( aProgress )` (:1149-1196): the tree rebuilt from the
   * libraries, the target footprint selected again if it was, else centred, and
   * its library when the footprint went.
   */
  SyncLibraryTree(_aProgress: boolean): void {
    const tree = this.GetLibTree();
    const target = this.GetTargetFPID();
    const targetSelected = tree !== null && target.equals(tree.GetSelectedLibId());

    // Unselect before syncing to avoid null reference in the adapter
    // if a selected item is removed during the sync
    tree?.Unselect();

    // Sync the LIB_TREE to the FOOTPRINT_INFO list
    this.hooks.syncLibraryTree?.();

    if (!tree || !target.IsValid()) return;

    // `adapter->FindItem( target )`: the tree's rows are the adapter's, so a
    // footprint the library holds is a row the tree holds.
    if (
      this.m_footprintLibAdapter?.FootprintExists(target.GetLibNickname(), target.GetLibItemName())
    ) {
      if (targetSelected) tree.SelectLibId(target);
      else tree.CenterLibId(target);
    } else {
      // Try to focus on parent
      target.SetLibItemName('');
      tree.CenterLibId(target);
    }
  }

  /** `RefreshLibraryTree()` (:1199-1202). */
  RefreshLibraryTree(): void {
    this.GetLibTree()?.RefreshLibTree();
  }

  /** `FocusOnLibID( aLibID )` (:1205-1208). */
  FocusOnLibID(aLibID: LIB_ID): void {
    this.GetLibTree()?.SelectLibId(aLibID);
  }

  /** The window's save-mode file dialog; null without a window. */
  ShowSaveFileDialog(
    aTitle: string,
    aDefaultName: string,
    aWildcard: ChooserFilter,
  ): Promise<{ path: string } | null> {
    return (
      this.hooks.showSaveFileDialog?.(aTitle, aDefaultName, aWildcard) ?? Promise.resolve(null)
    );
  }

  /** `wxFopen` + `fprintf`; false when there is nowhere to write. */
  WriteTextFile(aPath: string, aText: string): boolean {
    return this.hooks.writeTextFile?.(aPath, aText) ?? false;
  }

  /** `DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR( … ).ShowQuasiModal() == wxID_OK`; Cancel without a window. */
  ShowFootprintPropertiesFpEditorDialog(
    aDialog: DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR,
  ): Promise<boolean> {
    return this.hooks.showFootprintPropertiesFpEditorDialog?.(aDialog) ?? Promise.resolve(false);
  }

  /** `if( infobar->IsShownOnScreen() && infobar->HasCloseButton() ) infobar->Dismiss()`. */
  DismissInfoBar(): void {
    this.hooks.dismissInfoBar?.();
  }

  protected override dialogHooks(): PCB_BASE_EDIT_FRAME_DIALOG_HOOKS {
    return this.hooks;
  }

  /** `KIDIALOG( this, … ).ShowModal()`. Cancel without a window. */
  AskKiDialog(aRequest: KiDialogRequest): Promise<KiDialogResult> {
    return this.hooks.askKiDialog?.(aRequest) ?? Promise.resolve('cancel');
  }

  /** `SAVE_AS_DIALOG( … ).ShowModal()`; Cancel without a window. */
  ShowSaveAsDialog(
    aFootprintName: string,
    aLibraryName: string,
    aValidator: (aNewLib: string, aNewName: string) => Promise<boolean>,
  ): Promise<{ library: string; name: string } | null> {
    return (
      this.hooks.showSaveAsDialog?.(aFootprintName, aLibraryName, aValidator) ??
      Promise.resolve(null)
    );
  }

  /** `ImportFootprint`'s file dialog; Cancel without a window. */
  ShowImportFootprintDialog(): Promise<{ path: string; text: string } | null> {
    return this.hooks.showImportFootprintDialog?.() ?? Promise.resolve(null);
  }

  /** `ConfirmRevertDialog( this, aMessage )`; Cancel without a window. */
  ConfirmRevertDialog(aMessage: string): Promise<boolean> {
    return this.hooks.confirmRevert?.(aMessage) ?? Promise.resolve(false);
  }

  /** `IsCurrentFPFromBoard()`: the edited footprint came from the board (it has a link). */
  IsCurrentFPFromBoard(): boolean {
    const footprint = this.GetBoard()?.GetFirstFootprint() ?? null;

    return footprint !== null && footprint.GetLink() !== niluuid;
  }

  /** `AddFootprintToBoard` (:722-730): ReloadFootprint; the file watcher is not ported. */
  /**
   * `FOOTPRINT_EDIT_FRAME::SetActiveLayer` (footprint_editor_utils.cpp:275-308):
   * the clearance layer of the active copper layer shown and the old one
   * hidden, as the PCB editor does, then high contrast on the new layer.
   * Declared here rather than in the footprint_editor_utils.ts mixin: a mixin
   * cannot override a base-class method in TypeScript's type system.
   */
  override SetActiveLayer(aLayer: PCB_LAYER_ID, _aForceRedraw = false): void {
    const oldLayer = this.GetActiveLayer();

    if (oldLayer === aLayer) return;

    super.SetActiveLayer(aLayer);

    /*
     * Follow the PCB editor logic for showing/hiding clearance layers: show only for
     * the active copper layer or a front/back non-copper layer.
     */
    const getClearanceLayerForActive = (aActiveLayer: PCB_LAYER_ID): number | null =>
      IsCopperLayer(aActiveLayer) ? CLEARANCE_LAYER_FOR(aActiveLayer) : null;

    const view = this.GetCanvas()?.GetView() ?? null;
    const oldClearanceLayer = getClearanceLayerForActive(oldLayer);

    if (oldClearanceLayer !== null) view?.SetLayerVisible(oldClearanceLayer, false);

    const newClearanceLayer = getClearanceLayerForActive(aLayer);

    if (newClearanceLayer !== null) view?.SetLayerVisible(newClearanceLayer, true);

    this.m_appearancePanel?.OnLayerChanged?.();

    this.m_toolManager?.RunAction(PCB_ACTIONS.layerChanged); // notify other tools
    this.GetCanvas()?.SetHighContrastLayer(aLayer);
    this.GetCanvas()?.Refresh();
  }

  override AddFootprintToBoard(aFootprint: FOOTPRINT | null): void {
    if (aFootprint) this.ReloadFootprint(aFootprint);
  }

  /** `GetLoadedFPID()`: the edited footprint's LIB_ID, or an empty one. */
  GetLoadedFPID(): LIB_ID {
    const fp = this.GetBoard()?.GetFirstFootprint();
    return fp ? fp.GetFPID() : new LIB_ID();
  }

  /** `m_footprintNameWhenLoaded`: what a rename is measured against. */
  GetFootprintNameWhenLoaded(): string {
    return this.m_footprintNameWhenLoaded;
  }

  /**
   * `IsContentModified()` (footprint_edit_frame.cpp): the screen's modify flag;
   * an empty frame is never modified.
   */
  override IsContentModified(): boolean {
    return !!this.GetBoard()?.GetFirstFootprint() && this.GetScreen()?.IsContentModified() === true;
  }

  /** `m_originalFootprintCopy`, for the "Revert" and the diff. */
  GetOriginalFootprintCopy(): FOOTPRINT | null {
    return this.m_originalFootprintCopy;
  }

  override OnModify(): void {
    super.OnModify();
    this.hooks.onModify?.();
  }

  /** `FOOTPRINT_EDIT_FRAME::KiwayMailIn` (footprint_editor_utils.cpp:330). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    const payload = mail.GetPayload();

    switch (mail.Command()) {
      case MAIL_T.MAIL_FP_EDIT:
        if (payload !== '') this.hooks.fpEdit(payload);

        break;

      default:
        break;
    }
  }
}

applyMixins(FOOTPRINT_EDIT_FRAME, [
  FOOTPRINT_EDIT_FRAME_LOAD_SELECT_MIXIN,
  FOOTPRINT_EDIT_FRAME_INITPCB_MIXIN,
  FOOTPRINT_EDITOR_UTILS_MIXIN,
  FOOTPRINT_LIBRARIES_UTILS_MIXIN,
]);

// --- FOOTPRINT_EDIT_FRAME::UpdateTitle (was footprint_edit_frame_title.ts) ---

/** `_( "Footprint Editor" )`, the half after the dash. */
export const FP_FRAME_NAME = 'Footprint Editor';

/** `_( "[no footprint loaded]" )` — footprint_edit_frame.cpp:1128. */
export const FP_NO_DOCUMENT = '[no footprint loaded]';

/**
 * `FILEEXT::PcbFileExtension` — [data] KiCad's own constant
 * (`common/kicad_string.h` / `include/wildcards_and_files_ext.h`), interpolated
 * into `[from %s]` after the project name.
 *
 * A local literal because there is no shared FILEEXT mirror in this repo yet;
 * the string is spelled independently in at least five places
 * (`home/file_activation.ts`, `fs/file_types.ts`, `home/project_tree.ts`,
 * `editors/pcb/board_file_settings.ts`). Worth one module eventually — noted
 * rather than done here, because those files belong to other work in flight.
 */
export const PCB_FILE_EXTENSION = 'kicad_pcb';

/**
 * `wxString::Format( _( "[from %s]" ), Prj().GetProjectName() + "." + FILEEXT::PcbFileExtension )`
 * — footprint_edit_frame.cpp:1092-1094. Frame 4 only.
 */
export function fromBoardSuffix(projectName: string): string {
  return `[from ${projectName}.${PCB_FILE_EXTENSION}]`;
}

export interface FpFrameTitleSpec {
  /** `IsCurrentFPFromBoard()` — selects branch 1. */
  fromBoard?: boolean;
  /** `footprint->GetReference()` — branch 1's document. */
  reference?: string;
  /** `Prj().GetProjectName()`, interpolated by {@link fromBoardSuffix}. */
  projectName?: string;
  /**
   * `GetLoadedFPID().IsValid()` — the GUARD on branch 2.
   *
   * Not derivable from {@link fpid} below: that one is the live footprint's,
   * which stays valid-looking while the loaded one is not.
   */
  loadedFpidValid?: boolean;
  /**
   * `!GetLoadedFPID().GetLibItemName().empty()` — the GUARD on branch 3, again
   * on the loaded FPID rather than the live one.
   */
  loadedLibItemName?: string;
  /**
   * `footprint->GetFPID().Format()` — `lib:name` off the LIVE footprint, which
   * is what branch 2 prints.
   */
  fpid?: string;
  /**
   * `footprint->GetFPID().GetLibItemName()` — the live footprint's name half,
   * which is what branch 3 prints.
   */
  libItemName?: string;
  /**
   * `IsFootprintLibWritable( fpid.GetLibNickname() )`. Upstream seeds this
   * `true` and only a successful lookup can clear it — an `IO_ERROR` is
   * swallowed "best efforts", leaving the footprint titled writable. So
   * `undefined` here means writable, not unknown.
   */
  writable?: boolean;
  /** `IsContentModified()`. */
  modified?: boolean;
}

export function fpFrameTitle(spec: FpFrameTitleSpec): FrameTitleParts {
  // 1. `if( IsCurrentFPFromBoard() )` — the reference, plus [from <proj>.kicad_pcb].
  if (spec.fromBoard) {
    return frameTitle({
      frameName: FP_FRAME_NAME,
      document: spec.reference ?? '',
      modified: spec.modified,
      suffixes: [fromBoardSuffix(spec.projectName ?? '')],
    });
  }

  // 2. `else if( fpid.IsValid() )` — the LIVE FPID, plus [Read Only] if the
  //    library is not writable. `writable` defaults true, as upstream's does.
  if (spec.loadedFpidValid) {
    return frameTitle({
      frameName: FP_FRAME_NAME,
      document: spec.fpid ?? '',
      modified: spec.modified,
      suffixes: spec.writable === false ? [READ_ONLY_SUFFIX] : [],
    });
  }

  // 3. `else if( !fpid.GetLibItemName().empty() )` — the LIVE name half, and
  //    [Unsaved] unconditionally.
  if ((spec.loadedLibItemName ?? '') !== '') {
    return frameTitle({
      frameName: FP_FRAME_NAME,
      document: spec.libItemName ?? '',
      modified: spec.modified,
      suffixes: [UNSAVED_SUFFIX],
    });
  }

  // 4. `else { title = _( "[no footprint loaded]" ); }` — an assignment, so no star.
  return frameTitle({
    frameName: FP_FRAME_NAME,
    document: null,
    placeholder: FP_NO_DOCUMENT,
    modified: false,
  });
}

// --- FOOTPRINT_EDIT_FRAME's grid (was fp_grid.ts) ---

/**
 * A grid string in **pcbnew's** internal units.
 *
 * `ui/grid_settings.ts`' `gridSizeToIU` takes the IU-per-millimetre of the
 * frame reading it, and getting it wrong is not a rounding error: `PCB_IU_PER_MM`
 * is 1e6 and `SCH_IU_PER_MM` is 1e4, a hundred apart. `prefs/settings.ts`
 * exports a one-argument `gridSizeToIU` that bakes in the schematic scale and
 * defaults a unitless string to mils; it is the wrong one for board geometry,
 * and calling it is what once had this editor's grid combo built at eeschema's
 * precision over pcbnew coordinates.
 */
const toIU = (size: string): number => gridSizeToIU(size, PCB_IU_PER_MM) ?? 0;

/**
 * `gridCfg.grids[ safeGrid( gridCfg.last_size_idx ) ]`, in IU.
 *
 * The clamp is `PANEL_GRID_SETTINGS::safeGrid`'s
 * (`common/dialogs/panel_grid_settings.cpp:232-243`) reason for existing: an
 * index can outlive the row it named — remove the last grid and `last_size_idx`
 * points past the end — and a frame that read `undefined` there would snap to
 * nothing at all.
 */
export function footprintGridIU(cfg: FpEditSettings): number {
  const { sizes, last_size_idx } = cfg.window.grid;
  const idx = Math.max(0, Math.min(last_size_idx, sizes.length - 1));
  return toIU(sizes[idx]?.x ?? '0.5 mm') || toIU('0.5 mm');
}

/**
 * `GRID_HELPER::GetGrid( … , PCB_GRID_HELPER::GetItemGrid( item ) )` — the grid
 * an override puts one *kind* of item on, chosen here by the active tool the
 * way `FootprintCanvas` chooses it.
 *
 * `PCB_GRID_HELPER::GetItemGrid` (`pcbnew/tools/pcb_grid_helper.cpp:947-979`)
 * is a switch on the item type. Three of its five answers can occur inside a
 * `FOOTPRINT`:
 *
 *  - `PCB_PAD_T` (with `PCB_FOOTPRINT_T`) -> `GRID_CONNECTABLE`, which is the
 *    row `PANEL_GRID_SETTINGS` relabels `_( "Pads:" )` in this frame
 *    (`common/dialogs/panel_grid_settings.cpp:57`);
 *  - `PCB_TEXT_T`, `PCB_FIELD_T` -> `GRID_TEXT`;
 *  - `PCB_SHAPE_T`, `PCB_DIMENSION_T`, `PCB_REFERENCE_IMAGE_T`,
 *    `PCB_TEXTBOX_T`, `PCB_BARCODE_T` -> `GRID_GRAPHICS`.
 *
 * `GRID_WIRES` and `GRID_VIAS` need a track, an arc or a via, none of which a
 * footprint contains — which is exactly why the panel hides both rows for this
 * frame, so there is no override to read either.
 *
 * `overrides_enabled` is `ACTIONS::toggleGridOverrides`, the left toolbar's own
 * button — with it off every item is on the current grid
 * (`GRID_HELPER::GetGrid`, `common/tool/grid_helper.cpp`).
 */
export function footprintGridForTool(cfg: FpEditSettings, activeTool: string | undefined): number {
  const grid = cfg.window.grid;
  const base = footprintGridIU(cfg);
  if (!grid.overrides_enabled) return base;

  const pick = (o: { enabled: boolean; size: string }): number | null =>
    o.enabled ? toIU(o.size) || null : null;

  if (activeTool === 'placePad') return pick(grid.overrides.connected) ?? base;
  if (TEXT_TOOL_IDS.has(activeTool ?? '')) return pick(grid.overrides.text) ?? base;
  if (GRAPHICS_TOOL_IDS.has(activeTool ?? '')) return pick(grid.overrides.graphics) ?? base;
  // `select`, and anything else, is `GRID_CURRENT` — which is also what
  // `GetItemGrid` returns for a mixed selection (`:355-366` of the schematic's
  // equivalent) and for a null item (`:949-950`).
  return base;
}

/** The right toolbar's tools that lay down a `PCB_TEXT_T` or a `PCB_FIELD_T`. */
const TEXT_TOOL_IDS = new Set<string>(['placeText']);

/**
 * The right toolbar's tools that lay down anything `GetItemGrid` answers
 * `GRID_GRAPHICS` for — every shape, the dimensions, the text box, the table,
 * the reference image and the barcode.
 */
const GRAPHICS_TOOL_IDS = new Set<string>([
  'drawLine',
  'drawArc',
  'drawRectangle',
  'drawCircle',
  'drawPolygon',
  'drawBezier',
  'drawTextBox',
  'drawTable',
  'drawRuleArea',
  'placeImage',
  'placeBarcode',
  'drawOrthogonalDimension',
  'drawAlignedDimension',
  'drawCenterDimension',
  'drawRadialDimension',
  'drawLeader',
]);

/**
 * `KIGFX::GAL::GetGridSnapping()` asked with THIS editor's settings object.
 *
 * The predicate itself is `ui/grid_cursor.ts`' `gridSnappingEnabled`, beside
 * the rest of `GAL_DISPLAY_OPTIONS`, because upstream it is one method on the
 * GAL and every canvas calls the same one. This is the call, and naming the
 * settings object in it is the whole point: reading pcbnew's `snap` here is the
 * shape of bug that once had the symbol editor following `eeschema.json`.
 */
export function footprintSnappingEnabled(cfg: FpEditSettings): boolean {
  return gridSnappingEnabled(cfg.window.grid.snap, cfg.window.grid.show);
}

// --- FOOTPRINT_EDIT_FRAME's one-footprint BOARD + layer table (was footprintBoard.ts) ---

/**
 * The footprint-editor layer table — `FOOTPRINT_EDIT_FRAME::updateEnabledLayers`
 * (`pcbnew/footprint_edit_frame.cpp:538-619`), which is the one place this
 * frame decides which layers exist:
 *
 *     LSET enabledLayers = LSET::AllTechMask() | LSET::UserMask();
 *     …
 *     case FOOTPRINT_STACKUP::EXPAND_INNER_LAYERS:
 *         enabledLayers |= LSET{ F_Cu, In1_Cu, B_Cu };
 *         board.SetLayerName( In1_Cu, _( "Inner layers" ) );
 *     …
 *     enabledLayers |= LSET::UserDefinedLayersMask( userLayerCount );
 *
 * Three groups, and ours was missing two of them:
 *
 *   - **`In1_Cu`, shown as "Inner layers"** (:558-561). The default stackup mode
 *     with no footprint loaded is EXPAND_INNER_LAYERS (:582), so the row is
 *     always there. It is one row standing for all inner copper — the name is
 *     set on the board, which is why `GetLayerName` and not `LayerName` is what
 *     puts it on screen.
 *   - **`User.1` … `User.4`** — `LSET::UserDefinedLayersMask( GetUserDefined-
 *     LayerCount() )`, and that count defaults to 4
 *     (`board_design_settings.cpp:66`).
 *
 * `LSET::UserMask()` (`common/lset.cpp:690-694`) is
 * `{ Dwgs_User, Cmts_User, Eco1_User, Eco2_User, Edge_Cuts, Margin }` — the six
 * we already had — and `AllTechMask()` the twelve F/B adhesive, paste,
 * silkscreen, mask, courtyard and fab layers.
 *
 * buildScene reads copper names off this for `*.Cu` pad expansion; the
 * Appearance panel lists the rest, in `appearanceLayerRows`' order.
 */
export const FOOTPRINT_LAYERS: PcbLayerDef[] = [
  { id: 0, name: 'F.Cu', kind: 'signal' },
  // `updateEnabledLayers` calls `board.SetLayerName( In1_Cu, _( "Inner layers" ) )`
  // (`footprint_edit_frame.cpp:560`) — and the call FAILS, so the row keeps its
  // standard name. `BOARD::SetLayerName` stores nothing unless
  // `IsLayerEnabled( aLayer )` already holds (`board.cpp:755-778`), and at that
  // point in the lambda the board's enabled set has just been cleared of all
  // copper by `SetCopperLayerCount( cuLayers.count() )` with a count of 0
  // (`board_design_settings.cpp:1607-1616`); `board.SetEnabledLayers(
  // enabledLayers )` only runs 55 lines later. A live KiCad 10.0.5 footprint
  // editor with no footprint loaded agrees: the row reads "In1.Cu".
  { id: 4, name: 'In1.Cu', kind: 'signal' },
  { id: 2, name: 'B.Cu', kind: 'signal' },
  { id: 9, name: 'F.Adhes', kind: 'user', userName: 'F.Adhesive' },
  { id: 11, name: 'B.Adhes', kind: 'user', userName: 'B.Adhesive' },
  { id: 13, name: 'F.Paste', kind: 'user' },
  { id: 15, name: 'B.Paste', kind: 'user' },
  { id: 5, name: 'F.SilkS', kind: 'user', userName: 'F.Silkscreen' },
  { id: 7, name: 'B.SilkS', kind: 'user', userName: 'B.Silkscreen' },
  { id: 1, name: 'F.Mask', kind: 'user' },
  { id: 3, name: 'B.Mask', kind: 'user' },
  { id: 17, name: 'Dwgs.User', kind: 'user', userName: 'User.Drawings' },
  { id: 19, name: 'Cmts.User', kind: 'user', userName: 'User.Comments' },
  { id: 21, name: 'Eco1.User', kind: 'user', userName: 'User.Eco1' },
  { id: 23, name: 'Eco2.User', kind: 'user', userName: 'User.Eco2' },
  { id: 25, name: 'Edge.Cuts', kind: 'user' },
  { id: 27, name: 'Margin', kind: 'user' },
  { id: 31, name: 'F.CrtYd', kind: 'user', userName: 'F.Courtyard' },
  { id: 29, name: 'B.CrtYd', kind: 'user', userName: 'B.Courtyard' },
  { id: 35, name: 'F.Fab', kind: 'user' },
  { id: 33, name: 'B.Fab', kind: 'user' },
  // LSET::UserDefinedLayersMask( 4 ) — User_1 and every second id after it
  // (`common/lset.cpp:704-719`), against a default count of 4.
  { id: 39, name: 'User.1', kind: 'user' },
  { id: 41, name: 'User.2', kind: 'user' },
  { id: 43, name: 'User.3', kind: 'user' },
  { id: 45, name: 'User.4', kind: 'user' },
];

/**
 * `LSET::UserDefinedLayersMask( n )` and `BOARD::GetLayerName` — the layer set
 * a footprint editor frame actually has, which is {@link FOOTPRINT_LAYERS} with
 * its `User.n` rows re-cut from **Preferences > Footprint Editor > User Layer
 * Names**.
 *
 * Two settings, two effects, both upstream's:
 *
 *   - `design_settings.user_layer_count` decides HOW MANY `User.n` rows there
 *     are. `BOARD_DESIGN_SETTINGS::SetUserDefinedLayerCount` feeds
 *     `LSET::UserDefinedLayersMask` (`common/lset.cpp:704-719`), which is
 *     `User_1` and every second id after it, and
 *     `FOOTPRINT_EDIT_FRAME::updateEnabledLayers` enables exactly that mask.
 *   - `design_settings.default_footprint_layer_names` decides what each of them
 *     is CALLED. That map is `BOARD_DESIGN_SETTINGS::m_UserLayerNames`, keyed
 *     by the canonical name, and `BOARD::GetLayerName` returns the user name
 *     where one is set — which is why the Appearance panel, the layer selector
 *     and the layer combo in every dialog all show it.
 *
 * {@link FOOTPRINT_LAYERS} stays as it was and is still the right answer for
 * the two VIEWER frames — CVPCB's and the schematic's footprint preview — which
 * have no such preference and open on the default count of 4.
 */
export function footprintLayers(cfg: FpEditSettings): PcbLayerDef[] {
  const count = Math.max(0, Math.min(9, cfg.design_settings.user_layer_count));
  const names = cfg.design_settings.default_footprint_layer_names;
  const out: PcbLayerDef[] = [];
  for (const l of FOOTPRINT_LAYERS) {
    const numbered = /^User\.(\d+)$/.exec(l.name);
    // A numbered user layer beyond the count is not enabled on this board.
    if (numbered && Number(numbered[1]) > count) continue;
    const userName = names[l.name];
    out.push(userName ? { ...l, userName } : l);
  }
  // ...and a count above the four this table declares needs the rest built.
  // `User_1` is id 39 and the ids step by 2 (`include/layer_ids.h:124`).
  for (let n = USER_LAYERS_IN_TABLE + 1; n <= count; n++) {
    const name = `User.${n}`;
    const userName = names[name];
    out.push({
      id: USER_1_LAYER_ID + (n - 1) * 2,
      name,
      kind: 'user',
      ...(userName ? { userName } : {}),
    });
  }
  return out;
}

/** [data] `User_1` (`include/layer_ids.h:124`), which `common/layer_ids.ts` also names. */
const USER_1_LAYER_ID = 39;

/** How many `User.n` rows {@link FOOTPRINT_LAYERS} spells out — the default count. */
const USER_LAYERS_IN_TABLE = 4;

/**
 * `enabled.CuStack()` for this frame (`appearance_controls.cpp:1859-1860`):
 * "show all coppers first, with front on top, back on bottom". F.Cu, then the
 * inner layers in number order, then B.Cu — the board's declaration order is
 * NOT that, since ids run F_Cu=0, B_Cu=2, In1_Cu=4.
 */
export const FOOTPRINT_COPPER_STACK: readonly string[] = [
  'F.Cu',
  ...FOOTPRINT_LAYERS.map((l) => l.name).filter((n) => /^In\d+\.Cu$/.test(n)),
  'B.Cu',
];

/**
 * Board holding just the given footprint (or empty), for the footprint canvas.
 *
 * `layers` defaults to the module table, which is what the two VIEWER frames
 * want; the EDITOR passes {@link footprintLayers} so its board carries the user
 * layers Preferences was told to give it.
 */
export function footprintToBoard(
  fp: PcbFootprint | null,
  layers: PcbLayerDef[] = FOOTPRINT_LAYERS,
): Board {
  return {
    version: 20241229,
    layers,
    nets: new Map([[0, '']]),
    footprints: fp ? [fp] : [],
    textBoxes: [],
    tables: [],
    images: [],
    dimensions: [],
    // The frame's board owns no points of its own: a footprint's snap points
    // are `FOOTPRINT::Points()` and travel inside `fp`, exactly as its pads and
    // graphics do.
    points: [],
    barcodes: [],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes: [],
    texts: [],
    groups: [],
  };
}

/** Parse `.kicad_mod` text into a footprint, or null if it isn't one. */
export function parseFootprint(text: string): PcbFootprint | null {
  try {
    return readFootprintFile(parse(text));
  } catch {
    return null;
  }
}

/**
 * `SetActiveLayer( F_SilkS )` (`pcbnew/footprint_edit_frame.cpp:191`) — the
 * layer the frame opens on. Ours opened on F.Cu, so the layer selector, the
 * status bar and any graphic drawn before the user touched the combo were all
 * on the wrong layer.
 */
export const FP_DEFAULT_ACTIVE_LAYER = 'F.SilkS';

// --- FOOTPRINT_EDIT_FRAME's left-toolbar toggle state (was footprint_editor_toggles.ts) ---

/**
 * The left toolbar's cycling groups — `AppendGroup( TOOLBAR_GROUP_CONFIG(...) )`
 * (`pcbnew/toolbars_footprint_editor.cpp`), in upstream's order, which is
 * pcbnew's (millimetres first) rather than eeschema's.
 */
export const RADIO_GROUPS: readonly (readonly string[])[] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];

/**
 * The left toolbar's state when the frame opens — every one of these is a
 * setting `FOOTPRINT_EDITOR_SETTINGS` seeds, not a preference of ours.
 *
 * The line mode is the one that was wrong: `lineMode45`, because
 * `FOOTPRINT_EDITOR_SETTINGS::FOOTPRINT_EDITOR_SETTINGS()` seeds
 * `m_AngleSnapMode( LEADER_MODE::DEG45 )`
 * (`pcbnew/footprint_editor_settings.cpp:55`) and
 * `FOOTPRINT_EDITOR_CONTROL::OnAngleSnapModeChanged`
 * (`pcbnew/tools/footprint_editor_control.cpp:1031-1048`) maps DEG45 to
 * `PCB_ACTIONS::lineMode45`. pcbnew's own default is DIRECT
 * (`pcbnew/pcbnew_settings.cpp:59`) and the schematic's is different again, so
 * this is exactly the per-frame value that gets taken from the wrong
 * neighbour — ours was `lineMode90`, which is neither frame's.
 *
 * The three panels are shown because the frame calls
 * `m_auimgr.GetPane( … ).Show( … )` off `m_AuiPanels`
 * (`footprint_edit_frame.cpp:262-264`), all of which default true.
 *
 * `toggleGrid` is `window.grid.show`, default `true`
 * (`common/settings/app_settings.cpp:555-556`), and `crosshairSmall` is
 * `m_crossHairMode( CROSS_HAIR_MODE::SMALL_CROSS )`
 * (`common/gal/gal_display_options.cpp:52`).
 *
 * The units entry is NOT written here. `system.units`' default is one branch in
 * `APP_SETTINGS_BASE` (`common/settings/app_settings.cpp:228-238`), and
 * `FOOTPRINT_EDITOR_SETTINGS` passes the filename `"fpedit"`
 * (`pcbnew/footprint_editor_settings.cpp:46`, through
 * `PCB_VIEWERS_SETTINGS_BASE`'s forwarding constructor,
 * `pcbnew/pcbnew_settings.h:123-124`), which is not on the imperial side — so
 * this frame opens in millimetres.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  defaultUnitsToggle('fpedit'),
  'crosshairSmall',
  'lineMode45',
  'showLibraryTree',
  'showLayersManager',
  'showProperties',
]);

/**
 * Activating `id`, given what is currently on.
 *
 * A member of a radio group REPLACES its group — including itself, so
 * re-activating the member already on leaves it on rather than turning it off.
 * Anything else flips.
 */
export function applyToggle(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  const group = RADIO_GROUPS.find((g) => g.includes(id));

  if (group) {
    for (const g of group) next.delete(g);
    next.add(id);
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}
