// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_FRAME` (eeschema/sch_edit_frame.h), on `SCH_BASE_FRAME`
 * (`sch_base_frame.ts`, which holds the screen bookkeeping) — its KIWAY half:
 * the mail it takes in (`KiwayMailIn`, `ExecuteRemoteCommand`) and the
 * cross-probe packets it sends (eeschema/cross-probing.cpp).
 * `SchematicEditor.tsx` is the window, and owns the state each command
 * changes, so the frame reaches it through {@link SCH_EDIT_FRAME_HOOKS}.
 *
 * Its live-model half (stage E3b) holds a `SCHEMATIC` and the undo/redo lists over the
 * live items: the frame methods `SCH_COMMIT` and `schematic_undo_redo.ts`
 * (`SCH_UNDO_REDO_MIXIN`, mixed in below) need.
 */
import { IsOK } from '@ziroeda/common/confirm.js';
import { IS_MOVING, SKIP_STRUCT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { IsPointOnSegment } from '@ziroeda/kimath/src/trigo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_LINE } from './sch_line.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import type { SCH_PIN } from './sch_pin.js';
import { FindSymbolByRefAndUnit } from './tools/sch_tool_utils.js';
import { SCH_LINE_WIRE_BUS_TOOL } from './tools/sch_line_wire_bus_tool.js';
import { SCH_ALIGN_TOOL } from './tools/sch_align_tool.js';
import { SCH_DRAWING_TOOLS } from './tools/sch_drawing_tools.js';
import { SCH_EDIT_TOOL } from './tools/sch_edit_tool.js';
import { SCH_GROUP_TOOL } from './tools/sch_group_tool.js';
import { SCH_INSPECTION_TOOL } from './tools/sch_inspection_tool.js';
import type { SCH_MARKER } from './sch_marker.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { Pgm, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { GetDefaultVariantName } from '@ziroeda/common/string_utils.js';
import type { SINGLE_CHOICE_ARG } from './tools/assign_footprints.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import {
  PROJECT_FILE_EXTENSION,
  TOP_LEVEL_SHEET_INFO,
} from '@ziroeda/common/project/project_file.js';
import type { SCH_SELECTION_FILTER_OPTIONS } from '@ziroeda/common/project/project_local_settings.js';
import { BASE_SCREEN } from '@ziroeda/common/base_screen.js';
import { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import {
  wxDirExists,
  wxFileExists,
  wxIsDirWritable,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import type { SCHEMATIC_SETTINGS } from './schematic_settings.js';
import type { FILEDLG_HOOK_SAVE_PROJECT } from './files-io.js';
import type { FILEDLG_HOOK_NEW_LIBRARY } from '@ziroeda/common/widgets/filedlg_hook_new_library.js';
import type { FILEDLG_IMPORT_SHEET_CONTENTS } from './widgets/sch_design_block_pane.js';

/** The customize hooks a file dialog of this frame can carry; the window tells them apart. */
export type FILEDLG_HOOK =
  | FILEDLG_HOOK_SAVE_PROJECT
  | FILEDLG_HOOK_NEW_LIBRARY
  | FILEDLG_IMPORT_SHEET_CONTENTS;
import { PosixPath } from './sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { TEXTVARS_CHANGED } from '@ziroeda/common/tool/tools_holder.js';
import { DIALOG_BOOK_REPORTER } from '@ziroeda/common/dialogs/dialog_book_reporter.js';
import { SCH_NAVIGATE_TOOL } from './tools/sch_navigate_tool.js';
import { SCH_POINT_EDITOR } from './tools/sch_point_editor.js';
import { SCH_DESIGN_BLOCK_CONTROL } from './tools/sch_design_block_control.js';
import { SCH_EDITOR_CONTROL } from './tools/sch_editor_control.js';
import { PROPERTIES_TOOL } from '@ziroeda/common/tool/properties_tool.js';
import { EMBED_TOOL } from '@ziroeda/common/tool/embed_tool.js';
import { SCH_FIND_REPLACE_TOOL } from './tools/sch_find_replace_tool.js';
import { SCH_EDIT_TABLE_TOOL } from './tools/sch_edit_table_tool.js';
import { SCH_MOVE_TOOL } from './tools/sch_move_tool.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_SHEET_MIXIN } from './sheet.js';
import { SCH_ANNOTATE_MIXIN } from './annotate.js';
import { SCH_NETLIST_GENERATOR_MIXIN } from './netlist_exporters/netlist_generator.js';
import { NETLIST_EXPORTER_KICAD } from './netlist_exporters/netlist_exporter_kicad.js';
import {
  GNL_ALL,
  GNL_T,
  type NETLIST_LIBRARY_URI,
} from './netlist_exporters/netlist_exporter_xml.js';
import { SCH_FILES_IO_MIXIN } from './files-io.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { SCH_GLOBALLABEL, SCH_LABEL_BASE } from './sch_label.js';
import type { SCHEMATIC_HOLDER } from './schematic_holder.js';
import {
  frameTitle,
  type FrameTitleParts,
  READ_ONLY_SUFFIX,
} from '@ziroeda/common/use_document_title.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { STRTOK, strncpyLine } from '@ziroeda/common/libc/string.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import type { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { SCH_ACTIONS } from './tools/sch_actions.js';
import type { SCH_CONNECTION } from './sch_connection.js';
import { COMMON_CONTROL } from '@ziroeda/common/tool/common_control.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import { PICKER_TOOL } from '@ziroeda/common/tool/picker_tool.js';
import { SCH_SELECTION_TOOL } from './tools/sch_selection_tool.js';
import { findItemsFromSyncSelection } from './cross-probing.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { SCH_BASE_FRAME } from './sch_base_frame.js';
import { SCH_COMMIT } from './sch_commit.js';
import { AUTOPLACE_ALGO, type SCH_ITEM } from './sch_item.js';
import { SCH_SCREEN } from './sch_screen.js';
import type { SYMBOL_LIBRARY_FILTER } from './symbol_library_common.js';
import type { PICKED_SYMBOL } from './sch_screen.js';
import type { LIB_SYMBOL } from './lib_symbol.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { SCH_SHEET } from './sch_sheet.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import { SCH_CLEANUP_FLAGS, SCHEMATIC } from './schematic.js';
import { SCH_UNDO_REDO_MIXIN } from './schematic_undo_redo.js';
import { SCH_DESIGN_BLOCK_UTILS_MIXIN } from './sch_design_block_utils.js';
import type { SCH_DESIGN_BLOCK_PANE } from './widgets/sch_design_block_pane.js';
import type { SCH_GROUP } from './sch_group.js';

/** `EditSheetProperties`' out-parameters (sheet.cpp): what OK left to be done. */
export interface SHEET_PROPERTIES_RESULT {
  isUndoable: boolean;
  clearAnnotation: boolean;
  updateHierarchyNavigator: boolean;
}

/** `DIFF_SYMBOLS_DIALOG_NAME` (sch_edit_frame.cpp:135). */
const DIFF_SYMBOLS_DIALOG_NAME = 'DiffSymbolsDialog';

/**
 * `DIALOG_ERC` (dialogs/dialog_erc.h) as SCH_INSPECTION_TOOL drives it. The dialog is the
 * window's; the frame hands it over through its hooks.
 */
/** `DIALOG_SYMBOL_FIELDS_TABLE` as SCH_EDITOR_CONTROL drives it. */
export interface DIALOG_SYMBOL_FIELDS_TABLE {
  Show(aShow: boolean): void;
  Raise(): void;
  ShowEditTab(): void;
  ShowExportTab(): void;
}

export interface DIALOG_ERC {
  Show(aShow: boolean): void;
  Raise(): void;
  /** `okButton->SetDefault()` with the focus on it, as ShowERCDialog asks. */
  FocusOkButton(): void;
  IsShownOnScreen(): boolean;
  PrevMarker(): void;
  NextMarker(): void;
  SelectMarker(aMarker: SCH_MARKER): void;
  /** Exclude \a aMarker, or whichever marker the dialog has selected when null. */
  ExcludeMarker(aMarker: SCH_MARKER | null): void;
  /** `Destroy()`, from onCloseErcDialog / EDA_EVT_CLOSE_ERC_DIALOG. */
  Destroy(): void;
}

/** `SCH_SEARCH_T` (sch_edit_frame.h:77): what FindSymbolAndItem looks for. */
export enum SCH_SEARCH_T {
  HIGHLIGHT_PIN,
  HIGHLIGHT_SYMBOL,
}

/** `NET_NAVIGATOR_ITEM_DATA` (sch_edit_frame.h:91): a net navigator row's sheet and item. */
export class NET_NAVIGATOR_ITEM_DATA {
  constructor(
    private m_sheetPath: SCH_SHEET_PATH | null = null,
    private m_item: SCH_ITEM | null = null,
  ) {}

  GetSheetPath(): SCH_SHEET_PATH | null {
    return this.m_sheetPath;
  }

  GetItem(): SCH_ITEM | null {
    return this.m_item;
  }

  /** `operator==`. */
  equals(aRhs: NET_NAVIGATOR_ITEM_DATA): boolean {
    const sameSheet =
      this.m_sheetPath === aRhs.m_sheetPath ||
      (!!this.m_sheetPath && !!aRhs.m_sheetPath && this.m_sheetPath.equals(aRhs.m_sheetPath));

    return sameSheet && this.m_item === aRhs.m_item;
  }
}

/**
 * The net navigator (`m_netNavigator`, a wxGenericTreeCtrl, and its filter) as the frame drives
 * it: the window owns the tree. Upstream's tree walks in SelectNetNavigatorItem and
 * GetSelectedNetNavigatorItem are the window's.
 */
export interface NET_NAVIGATOR {
  /** `RefreshNetNavigator( aSelection )` (net_navigator.cpp). */
  Refresh(aSelection: NET_NAVIGATOR_ITEM_DATA | null): void;
  /** The row equal to \a aSelection made visible and selected; nothing when none is. */
  SelectItem(aSelection: NET_NAVIGATOR_ITEM_DATA): void;
  /** The selected row's item; null for none or the root. */
  GetSelectedItem(): SCH_ITEM | null;
  /** `IsFrozen()`. */
  IsFrozen(): boolean;
  /** Whether its pane (`NetNavigatorPaneName()`) is shown. */
  IsShown(): boolean;
  /** `m_netNavigatorFilter->SetValue( aNetName )`. */
  SetFilter(aNetName: string): void;
}

/**
 * `m_currentVariantCtrl`, the toolbar's design-variant wxChoice
 * (`ID_TOOLBAR_SCH_SELECT_VARAIANT`): the window builds it and installs it with
 * SetVariantSelectCtrl; its selection change calls onVariantSelected.
 */
export interface VARIANT_CHOICE {
  GetSelection(): number;
  SetSelection(aIndex: number): void;
  GetString(aIndex: number): string;
  GetCount(): number;
  FindString(aString: string): number;
  Set(aItems: readonly string[]): void;
}

/** The "New Design Variant" dialog's two fields, which the window fills on OK. */
export interface NEW_VARIANT_DIALOG_ARG {
  name: string;
  description: string;
}

/** The "Edit Description for '%s'" dialog's field, which the window fills on OK. */
export interface VARIANT_DESCRIPTION_DIALOG_ARG {
  title: string;
  description: string;
}

export interface SCH_EDIT_FRAME_HOOKS {
  /** `eeconfig()->m_CrossProbing`, read on every probe so a changed preference is seen. */
  crossProbingSettings(): CROSS_PROBING_SETTINGS;
  /** `SaveProject()`: write the schematic now; false when it could not be. */
  saveProject(): boolean;
  /**
   * `MAIL_SCH_GET_NETLIST`'s body: `ReadyToNetlist( aAnnotateMessage )`, then
   * `NETLIST_EXPORTER_KICAD::Format( GNL_ALL | GNL_OPT_KICAD )`. Null when the
   * schematic is not ready to netlist, which leaves the payload unchanged.
   */
  getNetlist?(aAnnotateMessage: string): string | null;
  /**
   * TRANSITIONAL (S2-5b, deleted at S7): bring this frame's live `Schematic()` up to the
   * window's records. When given, the netlist mail is answered from the live model.
   */
  syncLiveSchematic?(): boolean;
  /** `ModalAnnotate( aMessage )`: the Annotate dialog, opened to fix annotation. */
  modalAnnotate?(aMessage: string): void;
  /** `IsOK( this, aMessage )`: a yes/no confirmation. */
  isOK?(aMessage: string): boolean;
  /** `DisplayError( this, aMessage )`: the window shows it; with no hook it is only logged. */
  displayError?(aMessage: string): void;
  /**
   * TRANSITIONAL (until S7): the live model was modified (`OnModify`, every SCH_COMMIT push). The
   * window, which still keeps records, writes the changed screens back so its state follows the
   * tools that run on the live model. Gone when the window edits the live model itself.
   */
  liveModified?(): void;
  /**
   * TRANSITIONAL (until S7): `DisplayCurrentSheet` showed another sheet (a live tool entered or
   * left one). The window, which still tracks its own current sheet, follows.
   */
  liveSheetChanged?(): void;
  /**
   * The KIDIALOG SelectUnit asks when the unit chosen is already placed elsewhere ("Unit Already
   * Placed": Swap / Duplicate / Cancel). KiCad's is modal; a window answers it synchronously, and
   * with no hook the change is cancelled.
   */
  unitAlreadyPlaced?(
    aMessage: string,
    aSwapLabel: string,
    aDuplicateLabel: string,
  ): 'swap' | 'duplicate' | 'cancel';
  /**
   * `LIBRARY_MANAGER::GetFullURI( SYMBOL, nickname )`: the netlist's `(libraries …)` asks it.
   * Without it no library is listed.
   */
  symbolLibraryUri?: NETLIST_LIBRARY_URI;
  /**
   * `DIALOG_xxx( this, aItems… ).ShowModal()` / `ShowQuasiModal()`: the window opens the dialog
   * KiCad names \a aDialog (its C++ class, e.g. `DIALOG_LABEL_PROPERTIES`) on these live items,
   * applies it through a commit as the dialog does, and returns what ShowModal returns. With no
   * hook every dialog is cancelled (`wxID_CANCEL`).
   */
  showModal?(
    aDialog: string,
    aItems: readonly EDA_ITEM[],
    aArg?: unknown,
  ): number | Promise<number>;
  /**
   * `EditSheetProperties( aSheet, aHierarchy, … )` (sheet.cpp): DIALOG_SHEET_PROPERTIES on a live
   * sheet. Null (cancelled) with no hook.
   */
  editSheetProperties?(
    aSheet: SCH_SHEET,
    aHierarchy: SCH_SHEET_PATH,
    aSourceSheetFilename?: string,
  ): SHEET_PROPERTIES_RESULT | null | Promise<SHEET_PROPERTIES_RESULT | null>;
  /**
   * DIALOG_SYMBOL_CHOOSER's answer (picksymbol.cpp): the symbol chosen, its unit (0 when the
   * symbol itself was picked), the fields edited, and the two checkboxes; null when cancelled.
   */
  pickSymbol?(
    aFilter: SYMBOL_LIBRARY_FILTER | null,
    aHistoryList: readonly PICKED_SYMBOL[],
    aAlreadyPlaced: readonly PICKED_SYMBOL[],
    aShowFootprints: boolean,
  ): Promise<PICKED_SYMBOL | null>;
  /** `new DIALOG_ERC( this )`: the window's ERC dialog for this frame; null when there is none. */
  ercDialog?(): DIALOG_ERC | null;
  /**
   * `new DIALOG_SYMBOL_FIELDS_TABLE( this )`: the modeless Symbol Fields Table, which the window
   * builds; GetSymbolFieldsTableDialog keeps it.
   */
  symbolFieldsTableDialog?(): DIALOG_SYMBOL_FIELDS_TABLE | null;
  /** `m_netNavigator`: the window's net navigator, or null while it has none. */
  netNavigator?(): NET_NAVIGATOR | null;
  /** `m_hierarchy->UpdateNetHighlight( aConnection )`: the window's HIERARCHY_PANE. */
  hierarchyUpdateNetHighlight?(aConnection: string): void;
  /** `m_hierarchy->GetCollapsedPaths()`: the window's HIERARCHY_PANE. */
  hierarchyCollapsedPaths?(): string[];
  /**
   * The AUI half of ToggleSearch, ToggleSchematicHierarchy, ToggleNetNavigator,
   * ToggleProperties, ToggleLibraryTree and ToggleRemoteSymbolPanel (sch_edit_frame.cpp,
   * net_navigator.cpp): the window owns `m_auimgr` and its panes, and shows or hides the one
   * KiCad names (`SearchPaneName()`, ...), saving its size into `m_AuiPanels` as upstream does.
   */
  togglePane?(
    aPane:
      | 'Search'
      | 'SchematicHierarchy'
      | 'NetNavigator'
      | 'Properties'
      | 'DesignBlocks'
      | 'RemoteSymbol',
  ): void;
  /** `PROJECT_SCH::SymbolLibAdapter( &Prj() )->HasLibrary( aNickname, aCheckEnabled )`. */
  symbolLibHasLibrary?(aNickname: string, aCheckEnabled: boolean): boolean;
  /** `m_hierarchy->UpdateHierarchySelection()`: the window's hierarchy tree follows the selection. */
  updateHierarchySelection?(): void;
  /** `DIALOG_CHANGE_SYMBOLS` from the diff dialog's Update button (onCloseSymbolDiffDialog). */
  /** `wxTextEntryDialog( this, aMessage, aCaption, aValue ).ShowModal()`: null when cancelled. */
  textEntry?(
    aMessage: string,
    aCaption: string,
    aValue: string,
  ): string | null | Promise<string | null>;
  /**
   * `wxFileDialog( this, aTitle, aDefaultDir, aDefaultFile, aWildcard, aStyle ).ShowModal()` then
   * `GetPath()`: the project file manager's picker. Null is wxID_CANCEL, as with no hook.
   */
  fileDialog?(
    aTitle: string,
    aDefaultDir: string,
    aDefaultFile: string,
    aWildcard: string | readonly ChooserFilter[],
    aStyle: number,
    aCustomizeHook?: FILEDLG_HOOK,
  ): string | null | Promise<string | null>;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (SCH_UNDO_REDO_MIXIN, see libs/core/mixins.ts)
export interface SCH_EDIT_FRAME
  extends SCH_UNDO_REDO_MIXIN,
    SCH_DESIGN_BLOCK_UTILS_MIXIN,
    SCH_FILES_IO_MIXIN,
    SCH_ANNOTATE_MIXIN,
    SCH_NETLIST_GENERATOR_MIXIN,
    SCH_SHEET_MIXIN {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (SCH_UNDO_REDO_MIXIN, see libs/core/mixins.ts)
export class SCH_EDIT_FRAME extends SCH_BASE_FRAME implements SCHEMATIC_HOLDER {
  private readonly hooks: SCH_EDIT_FRAME_HOOKS;

  /// The live-model schematic this frame edits (null until one is set).
  private m_schematic: SCHEMATIC | null = null;

  /// `m_designBlocksPane`: the Design Blocks dock, set by the window that docks it.
  m_designBlocksPane: SCH_DESIGN_BLOCK_PANE | null = null;

  /** `GetDesignBlockPane()`. */
  GetDesignBlockPane(): SCH_DESIGN_BLOCK_PANE | null {
    return this.m_designBlocksPane;
  }

  /** `GetCurrentSelection()` (sch_edit_frame.cpp:2217). */
  override GetCurrentSelection(): SELECTION {
    return this.m_toolManager!.GetTool(SCH_SELECTION_TOOL)!.GetSelection();
  }

  /// Set when an undo/redo or recalculation may have changed the highlighted net.
  m_highlightedConnChanged = false;

  /** `m_highlightedConn`: the name of the highlighted net, empty for none. */
  m_highlightedConn = '';

  /** `GetHighlightedConnection()` (sch_edit_frame.h). */
  GetHighlightedConnection(): string {
    return this.m_highlightedConn;
  }

  /** `RefreshNetNavigator( aSelection )` (net_navigator.cpp): the window's tree. */
  RefreshNetNavigator(aSelection: NET_NAVIGATOR_ITEM_DATA | null = null): void {
    this.hooks.netNavigator?.()?.Refresh(aSelection);
  }

  /** `SetHighlightedConnection( aConnection, aSelection )` (sch_edit_frame.cpp:2581). */
  SetHighlightedConnection(
    aConnection: string,
    aSelection: NET_NAVIGATOR_ITEM_DATA | null = null,
  ): void {
    const refreshNetNavigator = aConnection !== this.m_highlightedConn;

    this.m_highlightedConn = aConnection;

    if (refreshNetNavigator) {
      this.RefreshNetNavigator(aSelection);

      this.hooks.hierarchyUpdateNetHighlight?.(aConnection);
    }
  }

  /** `SetCrossProbeConnection( aConnection )` (cross-probing.cpp:406). */
  SetCrossProbeConnection(aConnection: SCH_CONNECTION | null): void {
    if (!aConnection) {
      this.SendCrossProbeClearHighlight();
      return;
    }

    if (aConnection.IsNet()) {
      this.SendCrossProbeNetName(aConnection.Name());
      return;
    }

    if (aConnection.Members().length === 0) return;

    const all_members = aConnection.AllMembers();

    let nets = all_members[0]!.Name();

    if (all_members.length === 1) {
      this.SendCrossProbeNetName(nets);
      return;
    }

    // TODO: This could be replaced by just sending the bus name once we have bus contents
    // included as part of the netlist sent from Eeschema to Pcbnew (and thus Pcbnew can
    // natively keep track of bus membership)

    for (let i = 1; i < all_members.length; i++) nets += `,${all_members[i]!.Name()}`;

    const packet = `$NETS: "${nets}"`;

    // Typically ExpressMail is going to be s-expression packets, but since
    // we have existing interpreter of the cross probe packet on the other
    // side in place, we use that here.
    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      MAIL_T.MAIL_CROSS_PROBE,
      { value: packet },
      this,
    );
  }

  /** `SelectNetNavigatorItem( aSelection )` (net_navigator.cpp:551). */
  SelectNetNavigatorItem(aSelection: NET_NAVIGATOR_ITEM_DATA | null): void {
    const navigator = this.hooks.netNavigator?.() ?? null;

    if (!navigator || navigator.IsFrozen()) return; // wxCHECK

    // Maybe in the future we can do something like collapse the tree for an empty selection.
    // For now, leave the tree selection in its current state.
    if (!aSelection) return;

    navigator.SelectItem(aSelection);
  }

  /** `GetSelectedNetNavigatorItem()` (net_navigator.cpp:604). */
  GetSelectedNetNavigatorItem(): SCH_ITEM | null {
    const navigator = this.hooks.netNavigator?.() ?? null;

    if (!navigator || navigator.IsFrozen()) return null;

    return navigator.GetSelectedItem();
  }

  /** `FindNetInInspector( aNetName )` (net_navigator.cpp:729). */
  FindNetInInspector(aNetName: string): void {
    const navigator = this.hooks.netNavigator?.() ?? null;

    if (!navigator || aNetName === '') return;

    // Ensure the net navigator is shown
    if (!navigator.IsShown()) this.ToggleNetNavigator();

    // Clear any net highlights
    this.m_highlightedConn = '';
    this.GetToolManager()?.RunAction(SCH_ACTIONS.updateNetHighlighting);

    // Set the search text to the aNetName
    navigator.SetFilter(aNetName);

    // Refresh the tree
    this.RefreshNetNavigator();
  }

  /** `DirtyHighlightedConnection()` (sch_edit_frame.h). */
  DirtyHighlightedConnection(): void {
    this.m_highlightedConnChanged = true;
  }

  /// The list of items for the repeat-last-item command.
  private m_items_to_repeat: SCH_ITEM[] = [];

  constructor(hooks: SCH_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_SCH);
    this.hooks = hooks;

    // sch_edit_frame.cpp:178-180
    this.m_schematic = new SCHEMATIC(this.Prj());
    this.m_schematic.SetSchematicHolder(this);
    this.CreateDefaultScreens();
  }

  /** `CreateDefaultScreens` (sch_edit_frame.cpp:1066): the schematic's, shown. */
  CreateDefaultScreens(): void {
    this.m_schematic!.CreateDefaultScreens();
    this.SetScreen(this.Schematic().RootScreen());

    if (this.GetScreen() === null) {
      const screen = new SCH_SCREEN(this.m_schematic);
      this.SetScreen(screen);
    }
  }

  // -------------------------------------------------------------------------------------
  // The live-model half (eeschema stage E3b): what the undo/redo mixin and SCH_COMMIT ask
  // of the frame.  The window (SchematicEditor.tsx) still edits the record model; nothing
  // here is called by it yet.  The view calls upstream makes (`GetCanvas()->GetView()`)
  // have no live view to reach and are left out.
  // -------------------------------------------------------------------------------------

  /**
   * Point the frame at \a aSchematic, and give it the TOOL_MANAGER its commits go
   * through (upstream's frame builds one in its constructor).
   */
  SetSchematic(aSchematic: SCHEMATIC | null): void {
    this.m_schematic = aSchematic;

    if (!this.m_toolManager) this.m_toolManager = new TOOL_MANAGER();

    // sch_edit_frame.cpp:179 / :3051: the schematic calls back through its editor.
    aSchematic?.SetSchematicHolder(this);

    // sch_edit_frame.cpp:3053-3056 (a frame without a canvas has no view to give).
    const canvas = this.GetCanvas();
    const painter = canvas?.GetView().GetPainter() as {
      SetSchematic?(s: SCHEMATIC | null): void;
    } | null;
    painter?.SetSchematic?.(aSchematic);
    this.m_toolManager.SetEnvironment(
      aSchematic,
      canvas?.GetView() ?? null,
      canvas?.GetViewControls() ?? null,
      this.config(),
      this,
    );
  }

  Schematic(): SCHEMATIC {
    return this.m_schematic!;
  }

  /**
   * The current sheet's screen. Upstream `SCH_BASE_FRAME::GetScreen` returns
   * `m_currentScreen`, which `SCH_EDIT_FRAME` keeps pointed at the current
   * sheet's; here it is read off the sheet path directly.
   */
  override GetScreen(): SCH_SCREEN | null {
    return this.m_schematic ? this.m_schematic.CurrentSheet().LastScreen() : null;
  }

  GetCurrentSheet(): SCH_SHEET_PATH {
    return this.m_schematic!.CurrentSheet();
  }

  /**
   * `SCH_EDIT_FRAME::SetCurrentSheet` (sch_edit_frame.cpp:1085): go to \a aSheet and show it.
   */
  SetCurrentSheet(aSheet: SCH_SHEET_PATH): void {
    if (!aSheet.equals(this.GetCurrentSheet())) {
      this.ClearFocus();

      this.Schematic().SetCurrentSheet(aSheet);
      this.SetSheetNumberAndCount();
      this.GetCanvas()?.DisplaySheet(aSheet.LastScreen());
    }
  }

  /**
   * `SCH_EDIT_FRAME::setupTools` (sch_edit_frame.cpp:679). Upstream's constructor builds the
   * canvas and then this; here the window hands the canvas over later
   * (sch_canvas.ts createSchDrawPanel), which runs it. A frame with no canvas (the headless
   * netlister) keeps the bare manager SetSchematic gives its commits.
   */
  setupTools(): void {
    const canvas = this.GetCanvas()!;

    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(
      this.m_schematic,
      canvas.GetView(),
      canvas.GetViewControls(),
      this.config(),
      this,
    );
    // m_actions = new SCH_ACTIONS(): the actions are static members here (tools/sch_actions.ts).
    this.m_toolDispatcher = new TOOL_DISPATCHER(this.m_toolManager);

    // Register tools
    this.m_toolManager.RegisterTool(new COMMON_CONTROL());
    this.m_toolManager.RegisterTool(new COMMON_TOOLS());
    this.m_toolManager.RegisterTool(new ZOOM_TOOL());
    this.m_toolManager.RegisterTool(new SCH_SELECTION_TOOL());
    this.m_toolManager.RegisterTool(new PICKER_TOOL());
    this.m_toolManager.RegisterTool(new SCH_DRAWING_TOOLS());
    this.m_toolManager.RegisterTool(new SCH_LINE_WIRE_BUS_TOOL());
    this.m_toolManager.RegisterTool(new SCH_MOVE_TOOL());
    this.m_toolManager.RegisterTool(new SCH_ALIGN_TOOL());
    this.m_toolManager.RegisterTool(new SCH_EDIT_TOOL());
    this.m_toolManager.RegisterTool(new SCH_EDIT_TABLE_TOOL());
    this.m_toolManager.RegisterTool(new SCH_GROUP_TOOL());
    this.m_toolManager.RegisterTool(new SCH_INSPECTION_TOOL());
    this.m_toolManager.RegisterTool(new SCH_DESIGN_BLOCK_CONTROL());
    this.m_toolManager.RegisterTool(new SCH_EDITOR_CONTROL());
    this.m_toolManager.RegisterTool(new SCH_FIND_REPLACE_TOOL());
    this.m_toolManager.RegisterTool(new SCH_POINT_EDITOR());
    this.m_toolManager.RegisterTool(new SCH_NAVIGATE_TOOL());
    this.m_toolManager.RegisterTool(new PROPERTIES_TOOL());
    this.m_toolManager.RegisterTool(new EMBED_TOOL());
    this.m_toolManager.InitTools();

    // sch_edit_frame.cpp:458
    this.m_toolManager.GetTool(SCH_NAVIGATE_TOOL)!.ResetHistory();

    // Run the selection tool, it is supposed to be always active
    this.m_toolManager.PostAction(ACTIONS.selectionActivate);

    canvas.SetEventDispatcher(this.m_toolDispatcher);
  }

  /** `SCH_EDIT_FRAME::initScreenZoom` (sch_edit_frame.cpp:1866). */
  initScreenZoom(): void {
    this.m_toolManager?.RunAction(ACTIONS.zoomFitScreen);

    const screen = this.GetScreen();

    if (screen) screen.m_zoomInitialized = true;
  }

  /**
   * `SCH_EDIT_FRAME::GetDocumentExtents` (sch_edit_frame.cpp:2130): the page, or the items on
   * the current screen.
   */
  override GetDocumentExtents(aIncludeAllVisible = true): BOX2I {
    let bBoxDoc = new BOX2I();
    const screen = this.GetScreen();

    if (!screen) return bBoxDoc;

    if (aIncludeAllVisible) {
      // Get the whole page size and return that
      const sizeX = screen.GetPageSettings().GetWidthIU(schIUScale.IU_PER_MILS);
      const sizeY = screen.GetPageSettings().GetHeightIU(schIUScale.IU_PER_MILS);
      bBoxDoc = new BOX2I({ x: 0, y: 0 }, { x: sizeX, y: sizeY });
    } else {
      // Calc the bounding box of all items on screen except the page border (the drawing
      // sheet is the view's, not the screen's, here)
      for (const item of screen.Items()) bBoxDoc.Merge(item.GetBoundingBox());
    }

    return bBoxDoc;
  }

  /** `SCH_EDIT_FRAME::HardRedraw` (sch_edit_frame.cpp:1105). */
  override HardRedraw(): void {
    const screen = this.GetCurrentSheet().LastScreen();

    if (!screen) return;

    for (const item of screen.Items()) item.ClearCaches();

    for (const libSymbol of screen.GetLibSymbols().values()) libSymbol.ClearCaches();

    if (this.Schematic().Settings().m_IntersheetRefsShow) this.RecomputeIntersheetRefs();

    this.ClearFocus();

    this.GetCanvas()?.DisplaySheet(screen);

    // SCH_SELECTION_TOOL::Reset( REDRAW ): no selection tool yet.

    this.GetCanvas()?.ForceRefresh();
  }

  /**
   * `SCH_EDIT_FRAME::DisplayCurrentSheet` (sch_edit_frame.cpp:2320), as far as the ported tools
   * reach: the find dialog's brightening, the operating-point display and SCH_EDITOR_CONTROL's
   * net-highlight refresh wait for their tools.
   */
  DisplayCurrentSheet(): void {
    if (!this.m_toolManager) return;

    this.m_toolManager.RunAction(ACTIONS.cancelInteractive);
    this.m_toolManager.RunAction(ACTIONS.selectionClear);
    const screen = this.GetCurrentSheet().LastScreen();

    if (!screen) return;

    this.SetSheetNumberAndCount(); // will also update CurrentScreen()'s sheet number info

    this.m_toolManager.ResetTools(RESET_REASON.MODEL_RELOAD);

    // update the references, units, and intersheet-refs
    this.GetCurrentSheet().UpdateAllScreenReferences();

    // dangling state can also have changed if different units with different pin locations are
    // used
    screen.TestDanglingEnds();

    if (!screen.m_zoomInitialized) {
      this.initScreenZoom();
    } else {
      // Set zoom to last used in this screen
      const view = this.GetCanvas()?.GetView();
      view?.SetScale(screen.m_LastZoomLevel);
      view?.SetCenter(screen.m_ScrollCenter);
    }

    this.HardRedraw(); // Ensure all items are redrawn (especially the drawing-sheet items)

    // Allow tools to re-add their VIEW_ITEMs after the last call to Clear in HardRedraw
    this.m_toolManager.ResetTools(RESET_REASON.MODEL_RELOAD);

    this.hooks.liveSheetChanged?.();
  }

  /** `SCH_EDIT_FRAME::GetScreenDesc` (sch_edit_frame.cpp:1054): the current sheet's name. */
  override GetScreenDesc(): string {
    return this.GetCurrentSheet().Last()!.GetName();
  }

  /** `SCH_EDIT_FRAME::GetFullScreenDesc` (:1060): the current sheet's human-readable path. */
  override GetFullScreenDesc(): string {
    return this.GetCurrentSheet().PathHumanReadable();
  }

  /**
   * `SCH_EDIT_FRAME::RecalculateConnections`: the schematic's, with the change handler that
   * flags a changed highlighted net.  The view refresh upstream does after is left out.
   */
  RecalculateConnections(aCommit: SCH_COMMIT | null, aCleanupFlags: SCH_CLEANUP_FLAGS): void {
    this.m_schematic!.RecalculateConnections(
      aCommit,
      aCleanupFlags,
      this.m_toolManager,
      null,
      null,
      () => {
        this.m_highlightedConnChanged = true;
      },
    );
  }

  /** `RecomputeIntersheetRefs()` (sch_edit_frame.cpp:1966). */
  RecomputeIntersheetRefs(): void {
    this.Schematic().RecomputeIntersheetRefs();
  }

  /** `IntersheetRefUpdate()` (sch_edit_frame.cpp:1972): repaint the label's references. */
  IntersheetRefUpdate(aItem: SCH_GLOBALLABEL): void {
    this.GetCanvas()?.GetView().Update(aItem);
  }

  /** `ShowAllIntersheetRefs()` (sch_edit_frame.cpp:1978). */
  ShowAllIntersheetRefs(aShow: boolean): void {
    this.RecomputeIntersheetRefs();

    this.GetCanvas()?.GetView().SetLayerVisible(SCH_LAYER_ID.LAYER_INTERSHEET_REFS, aShow);
  }

  /** `ModalAnnotate( aMessage )` (dialog_annotate.cpp): the window's Annotate dialog. */
  ModalAnnotate(aMessage: string): void {
    this.hooks.modalAnnotate?.(aMessage);
  }

  /** `IsOK( this, aMessage )` (confirm.cpp): no window to ask is a no. */
  IsOK(aMessage: string): boolean {
    if (this.m_capture) {
      this.m_capture.messages.push(aMessage);
      return this.m_capture.answer;
    }

    return this.hooks.isOK?.(aMessage) ?? false;
  }

  /**
   * `IsOK( this, aMessage )` as the browser can ask it: the common question box, answered later.
   * The AI's capture answers at once.
   */
  IsOKAsync(aMessage: string): Promise<boolean> {
    if (this.m_capture) {
      this.m_capture.messages.push(aMessage);
      return Promise.resolve(this.m_capture.answer);
    }

    if (this.hooks.isOK) return Promise.resolve(this.hooks.isOK(aMessage));

    return IsOK(aMessage);
  }

  /** `DisplayError( this, aMessage )`. */
  DisplayError(aMessage: string): void {
    if (this.m_capture) this.m_capture.messages.push(aMessage);
    else if (this.hooks.displayError) this.hooks.displayError(aMessage);
    else console.warn(aMessage);
  }

  /** Messages and answers while a caller with no dialog (the AI) drives the frame. */
  private m_capture: { messages: string[]; answer: boolean } | null = null;

  /**
   * Run \a aEdit with the frame's questions answered \a aAnswer and its errors collected
   * rather than shown: what a caller that drives the frame without a window gets in place of
   * the dialogs. Returns the edit's result and what the frame said.
   */
  WithoutDialogs<T>(aAnswer: boolean, aEdit: () => T): { result: T; messages: string[] } {
    const outer = this.m_capture;
    const capture = { messages: [] as string[], answer: aAnswer };
    this.m_capture = capture;

    try {
      return { result: aEdit(), messages: capture.messages };
    } finally {
      this.m_capture = outer;
    }
  }

  /** WithoutDialogs for an edit that awaits: the capture holds until the edit has settled. */
  async WithoutDialogsAsync<T>(
    aAnswer: boolean,
    aEdit: () => Promise<T>,
  ): Promise<{ result: T; messages: string[] }> {
    const outer = this.m_capture;
    const capture = { messages: [] as string[], answer: aAnswer };
    this.m_capture = capture;

    try {
      return { result: await aEdit(), messages: capture.messages };
    } finally {
      this.m_capture = outer;
    }
  }

  /**
   * `AutoRotateItem` (sch_edit_frame.cpp:1792): a global or hierarchical label set to turn on
   * placement takes the spin of what it landed on, and the global labels of the same name
   * re-place their fields.
   */
  AutoRotateItem(aScreen: SCH_SCREEN, aItem: SCH_ITEM): void {
    if (aItem.Type() === KICAD_T.SCH_GLOBAL_LABEL_T || aItem.Type() === KICAD_T.SCH_HIER_LABEL_T) {
      const label = aItem as SCH_LABEL_BASE;

      if (label.AutoRotateOnPlacement()) {
        const spin = aScreen.GetLabelOrientationForPoint(
          label.GetPosition(),
          label.GetSpinStyle(),
          this.GetCurrentSheet(),
        );

        if (!spin.equals(label.GetSpinStyle())) {
          label.SetSpinStyle(spin);

          for (const item of aScreen.Items().OfType(KICAD_T.SCH_GLOBAL_LABEL_T)) {
            const otherLabel = item as SCH_LABEL_BASE;

            if (otherLabel !== label && otherLabel.GetText() === label.GetText())
              otherLabel.AutoplaceFields(aScreen, AUTOPLACE_ALGO.AUTOPLACE_AUTO);
          }
        }
      }
    }
  }

  SetSheetNumberAndCount(): void {
    this.m_schematic!.SetSheetNumberAndCount();
  }

  /**
   * `UpdateHierarchyNavigator` (sch_edit_frame.cpp:1396): the navigate tool drops history entries
   * that no longer exist; the hierarchy tree itself is the window's.
   */
  UpdateHierarchyNavigator(): void {
    this.m_toolManager?.GetTool(SCH_NAVIGATE_TOOL)?.CleanHistory();
  }

  /**
   * `UpdateLabelsHierarchyNavigator` (sch_edit_frame.cpp:1406): `m_hierarchy->
   * UpdateLabelsHierarchyTree()`. The window's HIERARCHY_PANE rebuilds its tree from the documents
   * on every change (`sheetTree`), so there is nothing to push to it here.
   */
  UpdateLabelsHierarchyNavigator(): void {}

  /// `m_currentVariantCtrl`: null until the window builds the toolbar control.
  private m_currentVariantCtrl: VARIANT_CHOICE | null = null;

  /** The toolbar control factory's result, or null from ClearToolbarControl. */
  SetVariantSelectCtrl(aCtrl: VARIANT_CHOICE | null): void {
    this.m_currentVariantCtrl = aCtrl;
  }

  /** `UpdateVariantSelectionCtrl( aVariantNames )` (toolbars_sch_editor.cpp:290). */
  UpdateVariantSelectionCtrl(aVariantNames: readonly string[]): void {
    const ctrl = this.m_currentVariantCtrl;

    if (!ctrl) return;

    // Fall back to the default if nothing is currently selected.
    let currentSelection = GetDefaultVariantName();
    let selectionIndex = ctrl.GetSelection();

    if (selectionIndex !== -1) currentSelection = ctrl.GetString(selectionIndex);

    // Add all variant names, a separator, and "Add New Variant..." at the end
    ctrl.Set([...aVariantNames, '---', 'Add New Design Variant...']);

    selectionIndex = ctrl.FindString(currentSelection);

    if (selectionIndex === -1 && ctrl.GetCount() !== 0) selectionIndex = 0;

    ctrl.SetSelection(selectionIndex);
  }

  /** `onVariantSelected( aEvent )` (toolbars_sch_editor.cpp:318): the control's wxEVT_CHOICE. */
  async onVariantSelected(): Promise<void> {
    const ctrl = this.m_currentVariantCtrl;

    if (!ctrl) return; // wxCHECK

    const selection = ctrl.GetSelection();
    const count = ctrl.GetCount();

    if (selection === -1 || count === 0) return;

    const previous = () =>
      ctrl.FindString(
        this.Schematic().GetCurrentVariant() === ''
          ? GetDefaultVariantName()
          : this.Schematic().GetCurrentVariant(),
      );

    // "Add New Variant..." is always the last item, separator is second-to-last
    if (selection === count - 1) {
      // Restore previous selection before showing dialog
      const previousSelection = previous();

      if (previousSelection !== -1) ctrl.SetSelection(previousSelection);

      await this.ShowAddVariantDialog();
      return;
    }

    // Separator line - ignore selection
    if (selection === count - 2) {
      const previousSelection = previous();

      if (previousSelection !== -1) ctrl.SetSelection(previousSelection);

      return;
    }

    const selectedString = ctrl.GetString(selection);
    let selectedVariant = '';

    if (selectedString !== GetDefaultVariantName()) selectedVariant = selectedString;

    this.Schematic().SetCurrentVariant(selectedVariant);
    this.UpdateProperties();
    this.HardRedraw();

    // Refresh message panel for current selection
    const selTool = this.m_toolManager?.FindTool('common.InteractiveSelection') as {
      GetSelection(): SELECTION;
    } | null;

    if (selTool) {
      const sub_sel = selTool.GetSelection();

      if (sub_sel.Size() === 1) this.SetMsgPanel(sub_sel.Front()!);
    }
  }

  /** `ShowAddVariantDialog( aParent )` (toolbars_sch_editor.cpp:384). */
  async ShowAddVariantDialog(): Promise<boolean> {
    const dlg: NEW_VARIANT_DIALOG_ARG = { name: '', description: '' };

    if ((await this.ShowModalDialog('NEW_DESIGN_VARIANT', [], dlg)) === wxID_CANCEL) return false;

    const variantName = dlg.name.trim();
    const variantDesc = dlg.description.trim();

    // Empty strings, reserved names, and duplicate variant names are not allowed.
    if (variantName === '') {
      this.GetInfoBar()?.ShowMessageFor('Variant name cannot be empty.', 10000, 'error');
      return false;
    }

    // Check for reserved name (case-insensitive)
    if (variantName.toLowerCase() === GetDefaultVariantName().toLowerCase()) {
      this.GetInfoBar()?.ShowMessageFor(
        `'${GetDefaultVariantName()}' is a reserved variant name.`,
        10000,
        'error',
      );
      return false;
    }

    // Check for duplicate variant names (case-insensitive)
    for (const existingName of this.Schematic().GetVariantNames()) {
      if (existingName.toLowerCase() === variantName.toLowerCase()) {
        this.GetInfoBar()?.ShowMessageFor(
          `Variant '${existingName}' already exists.`,
          10000,
          'error',
        );
        return false;
      }
    }

    // Add variant to the schematic
    this.Schematic().AddVariant(variantName);

    if (variantDesc !== '') this.Schematic().SetVariantDescription(variantName, variantDesc);

    // Update the variant selector and select the new variant
    this.UpdateVariantSelectionCtrl(this.Schematic().GetVariantNamesForUI());
    this.SetCurrentVariant(variantName);
    this.OnModify();
    return true;
  }

  /** `SetCurrentVariant( aVariantName )` (toolbars_sch_editor.cpp:472). */
  SetCurrentVariant(aVariantName: string): void {
    const ctrl = this.m_currentVariantCtrl;

    if (!ctrl) return;

    const name = aVariantName === '' ? GetDefaultVariantName() : aVariantName;
    const newSelection = ctrl.FindString(name);

    if (newSelection === -1) return;

    const currentSelection = ctrl.GetSelection();
    let selectedString = '';

    if (currentSelection !== -1) selectedString = ctrl.GetString(currentSelection);

    if (selectedString !== name) {
      ctrl.SetSelection(newSelection);
      this.Schematic().SetCurrentVariant(aVariantName);

      this.UpdateProperties();
      this.HardRedraw();
    }
  }

  /** `AddVariant()` (sch_edit_frame.cpp:3060): pick the control's "Add New Design Variant...". */
  async AddVariant(): Promise<void> {
    if (!this.m_currentVariantCtrl) return;

    this.m_currentVariantCtrl.SetSelection(this.m_currentVariantCtrl.GetCount() - 1);

    await this.onVariantSelected();
  }

  /** `EditVariantDescription()` (sch_edit_frame.cpp:3072). */
  async EditVariantDescription(): Promise<void> {
    const choices = this.Schematic().GetVariantNamesForUI();

    // Default variant cannot be edited.
    choices.splice(0, 1);

    if (choices.length === 0) {
      this.GetInfoBar()?.ShowMessageFor('No design variants to edit.', 10000, 'error');
      return;
    }

    const chooser: SINGLE_CHOICE_ARG = {
      message: 'Select variant to edit description:                ',
      caption: 'Edit Variant Description',
      choices,
      selection: -1,
    };

    if ((await this.ShowModalDialog('wxSingleChoiceDialog', [], chooser)) === wxID_CANCEL) return;

    const variantName = chooser.selection >= 0 ? (choices[chooser.selection] ?? '') : '';

    if (variantName === '') return;

    const dlg: VARIANT_DESCRIPTION_DIALOG_ARG = {
      title: `Edit Description for '${variantName}'`,
      description: this.Schematic().GetVariantDescription(variantName),
    };

    if ((await this.ShowModalDialog('VARIANT_DESCRIPTION', [], dlg)) === wxID_CANCEL) return;

    const newDesc = dlg.description.trim();

    this.Schematic().SetVariantDescription(variantName, newDesc);
    this.OnModify();
    this.GetCanvas()?.Refresh();
  }

  /** `RemoveVariant()` (sch_edit_frame.cpp:3134). */
  async RemoveVariant(): Promise<void> {
    if (!this.m_currentVariantCtrl) return;

    const choices = this.Schematic().GetVariantNamesForUI();

    // Default variant cannot be removed.
    choices.splice(0, 1);

    // wxSingleChoiceDialog will ellipsize the title bar if the contents aren't wide enough.  The
    // set of spaces in the control label are to prevent this.
    const dlg: SINGLE_CHOICE_ARG = {
      message: 'Select variant name to remove:                ',
      caption: 'Remove Design Variant',
      choices,
      selection: -1,
    };

    if ((await this.ShowModalDialog('wxSingleChoiceDialog', [], dlg)) === wxID_CANCEL) return;

    const variantName = dlg.selection >= 0 ? (choices[dlg.selection] ?? '') : '';

    if (variantName === '') return;

    const commit = new SCH_COMMIT(this);
    this.Schematic().DeleteVariant(variantName, commit);

    if (!commit.Empty()) {
      commit.Push(`Delete variant '${variantName}'`);
      this.OnModify();
    }

    if (this.Schematic().GetCurrentVariant() === variantName) this.SetCurrentVariant('');

    this.UpdateVariantSelectionCtrl(this.Schematic().GetVariantNamesForUI());

    this.GetCanvas()?.Refresh();
  }

  /** `SCH_EDIT_FRAME::UpdateHopOveredWires`: the hop-over shapes are view-side, not here. */
  UpdateHopOveredWires(_aItem: SCH_ITEM): void {}

  /** Return the items which are to be repeated with the insert key. */
  GetRepeatItems(): readonly SCH_ITEM[] {
    return this.m_items_to_repeat;
  }

  /** Clear the list of items which are to be repeated with the insert key. */
  ClearRepeatItemsList(): void {
    this.m_items_to_repeat = [];
  }

  /** `SaveCopyForRepeatItem` (sch_edit_frame.cpp:996): \a aItem, alone, as the item to repeat. */
  SaveCopyForRepeatItem(aItem: SCH_ITEM | null): void {
    // we cannot store a pointer to an item in the display list here since
    // that item may be deleted, such as part of a line concatenation or other.
    // So simply always keep a copy of the object which is to be repeated.

    if (aItem) {
      this.m_items_to_repeat = [];

      this.AddCopyForRepeatItem(aItem);
    }
  }

  /**
   * `TrimWire` (bus-wire-junction.cpp:51): remove the stretch of wire between \a aStart and
   * \a aEnd, breaking it at both. True when a stretch was removed.
   */
  TrimWire(aCommit: SCH_COMMIT, aStart: VECTOR2I, aEnd: VECTOR2I): boolean {
    if (aStart.x === aEnd.x && aStart.y === aEnd.y) return false;

    const screen = this.GetScreen()!;
    const wires: SCH_LINE[] = [];
    const bb = new BOX2I(aStart);

    const lwbTool = this.m_toolManager!.FindTool(
      'eeschema.InteractiveDrawingLineWireBus',
    ) as unknown as SCH_LINE_WIRE_BUS_TOOL;
    bb.Merge(aEnd);

    // We cannot modify the RTree while iterating, so push the possible
    // wires into a separate structure.
    for (const item of screen.Items().Overlapping(bb)) {
      const line = item as SCH_LINE;

      if (item.Type() === KICAD_T.SCH_LINE_T && line.GetLayer() === SCH_LAYER_ID.LAYER_WIRE)
        wires.push(line);
    }

    for (let line of wires) {
      // Don't remove wires that are already deleted or are currently being dragged
      if (line.GetEditFlags() & (STRUCT_DELETED | IS_MOVING | SKIP_STRUCT)) continue;

      if (
        !IsPointOnSegment(line.GetStartPoint(), line.GetEndPoint(), aStart) ||
        !IsPointOnSegment(line.GetStartPoint(), line.GetEndPoint(), aEnd)
      ) {
        continue;
      }

      const same = (a: VECTOR2I, b: VECTOR2I) => a.x === b.x && a.y === b.y;

      // Don't remove entire wires
      if (
        (same(line.GetStartPoint(), aStart) && same(line.GetEndPoint(), aEnd)) ||
        (same(line.GetStartPoint(), aEnd) && same(line.GetEndPoint(), aStart))
      ) {
        continue;
      }

      // Step 1: break the segment on one end.
      // Ensure that *line points to the segment containing aEnd
      const new_line: { value: SCH_LINE | null } = { value: null };
      lwbTool.BreakSegment(aCommit, line, aStart, new_line, screen);

      if (IsPointOnSegment(new_line.value!.GetStartPoint(), new_line.value!.GetEndPoint(), aEnd))
        line = new_line.value!;

      // Step 2: break the remaining segment.
      // Ensure that *line _also_ contains aStart.  This is our overlapping segment
      lwbTool.BreakSegment(aCommit, line, aEnd, new_line, screen);

      if (IsPointOnSegment(new_line.value!.GetStartPoint(), new_line.value!.GetEndPoint(), aStart))
        line = new_line.value!;

      this.RemoveFromScreen(line, screen);
      aCommit.Removed(line, screen);

      return true;
    }

    return false;
  }

  private m_ercDialog: DIALOG_ERC | null = null;
  private m_diffSymbolDialog: DIALOG_BOOK_REPORTER | null = null;

  /** `GetErcDialog` (sch_edit_frame.cpp:2455): made on first use. */
  private m_symbolFieldsTableDialog: DIALOG_SYMBOL_FIELDS_TABLE | null = null;

  /** `GetSymbolFieldsTableDialog()` (sch_edit_frame.cpp:2474). */
  GetSymbolFieldsTableDialog(): DIALOG_SYMBOL_FIELDS_TABLE | null {
    if (!this.m_symbolFieldsTableDialog)
      this.m_symbolFieldsTableDialog = this.hooks.symbolFieldsTableDialog?.() ?? null;

    return this.m_symbolFieldsTableDialog;
  }

  /** `onCloseSymbolFieldsTableDialog()`: the dialog's close handler calls it. */
  OnCloseSymbolFieldsTableDialog(): void {
    this.m_symbolFieldsTableDialog = null;
  }

  /** `ToggleSearch()` (sch_edit_frame.cpp:2845). */
  ToggleSearch(): void {
    this.hooks.togglePane?.('Search');
  }

  /** `ToggleSchematicHierarchy()` (sch_edit_frame.cpp:2911). */
  ToggleSchematicHierarchy(): void {
    this.hooks.togglePane?.('SchematicHierarchy');
  }

  /** `ToggleNetNavigator()` (net_navigator.cpp:674). */
  ToggleNetNavigator(): void {
    this.hooks.togglePane?.('NetNavigator');
  }

  /** `ToggleProperties()` (sch_edit_frame.cpp:2885). */
  override ToggleProperties(): void {
    this.hooks.togglePane?.('Properties');
  }

  /** `ToggleLibraryTree()` (sch_edit_frame.cpp:2954): the Design Blocks pane. */
  override ToggleLibraryTree(): void {
    this.hooks.togglePane?.('DesignBlocks');
  }

  /** `ToggleRemoteSymbolPanel()` (sch_edit_frame.cpp:2996). */
  ToggleRemoteSymbolPanel(): void {
    this.hooks.togglePane?.('RemoteSymbol');
  }

  /** `OnAnnotate()` (dialog_annotate.cpp:284): the modeless DIALOG_ANNOTATE, shown or raised. */
  OnAnnotate(): void {
    void this.ShowModalDialog('DIALOG_ANNOTATE', []);
  }

  /**
   * `ShowSchematicSetupDialog( aInitialPage )` (eeschema_config.cpp:103). The window runs
   * DIALOG_SCHEMATIC_SETUP; on OK the frame does what follows it upstream.
   */
  async ShowSchematicSetupDialog(aInitialPage = ''): Promise<void> {
    // One dialog at a time.
    if (this.m_schematicSetupDialogOpen) return;

    const oldAliases = this.Prj().GetProjectFile().m_BusAliases;
    const oldAliasesKey = JSON.stringify([...oldAliases]);

    this.m_schematicSetupDialogOpen = true;
    let result: number;

    try {
      result = await this.ShowModalDialog('DIALOG_SCHEMATIC_SETUP', [], aInitialPage);
    } finally {
      this.m_schematicSetupDialogOpen = false;
    }

    if (result === wxID_OK) {
      // Mark document as modified so that project settings can be saved as part of doc save
      this.OnModify();

      this.Kiway()?.CommonSettingsChanged(TEXTVARS_CHANGED);

      this.Prj().IncrementTextVarsTicker();
      this.Prj().IncrementNetclassesTicker();
      PgmOrNull()?.GetSettingsManager().SaveProject();

      const settings = this.Schematic().Settings();
      const rs = this.GetRenderSettings();

      if (rs) {
        rs.SetDefaultPenWidth(settings.m_DefaultLineWidth);
        rs.m_LabelSizeRatio = settings.m_LabelSizeRatio;
        rs.m_TextOffsetRatio = settings.m_TextOffsetRatio;
        rs.m_PinSymbolSize = settings.m_PinSymbolSize;
        rs.m_SymbolLineWidth = settings.m_DefaultLineWidth;

        rs.SetDashLengthRatio(settings.m_DashedLineDashRatio);
        rs.SetGapLengthRatio(settings.m_DashedLineGapRatio);
      }

      this.GetCanvas()?.GetView()?.MarkDirty();
      this.GetCanvas()?.GetView()?.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);

      const newAliases = this.Prj().GetProjectFile().m_BusAliases;

      if (oldAliasesKey !== JSON.stringify([...newAliases]))
        this.RecalculateConnections(null, SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP);

      // RefreshOperatingPointDisplay(): the simulator is not ported, so there is no operating
      // point to show.
      this.GetCanvas()?.Refresh();
    }
  }

  /// The `dialogMutex` of ShowSchematicSetupDialog: a second request while one is open does nothing.
  private m_schematicSetupDialogOpen = false;

  /// `m_syncingPcbToSchSelection`: recursion guard when synchronizing selection from PCB.
  private m_syncingPcbToSchSelection = false;

  /// The cross-probe flash: the items' KIIDs, the phase, and the 500 ms wxTimer.
  private m_crossProbeFlashItems: KIID[] = [];
  private m_crossProbeFlashPhase = 0;
  private m_crossProbeFlashing = false;
  private m_crossProbeFlashTimer: ReturnType<typeof setInterval> | null = null;

  /** `StartCrossProbeFlash( aItems )` (sch_edit_frame.cpp:491). */
  StartCrossProbeFlash(aItems: readonly SCH_ITEM[]): void {
    if (!this.hooks.crossProbingSettings().flash_selection) return;

    if (aItems.length === 0) return;

    if (this.m_crossProbeFlashing && this.m_crossProbeFlashTimer !== null) {
      clearInterval(this.m_crossProbeFlashTimer);
      this.m_crossProbeFlashTimer = null;
    }

    this.m_crossProbeFlashItems = aItems.map((it) => it.m_Uuid);
    this.m_crossProbeFlashPhase = 0;
    this.m_crossProbeFlashing = true;
    this.m_crossProbeFlashTimer = setInterval(() => this.OnCrossProbeFlashTimer(), 500);
  }

  /** `OnCrossProbeFlashTimer( aEvent )` (sch_edit_frame.cpp:530). */
  OnCrossProbeFlashTimer(): void {
    if (!this.m_crossProbeFlashing) return;

    const selTool = this.m_toolManager?.GetTool(SCH_SELECTION_TOOL) ?? null;

    if (!selTool) return;

    const prevGuard = this.m_syncingPcbToSchSelection;
    this.m_syncingPcbToSchSelection = true;

    const restore = (): void => {
      for (const id of this.m_crossProbeFlashItems) {
        const item = this.Schematic().ResolveItem(id, null, true);

        if (item) selTool.AddItemToSel(item, true);
      }
    };

    if (this.m_crossProbeFlashPhase % 2 === 0) selTool.ClearSelection(true);
    else restore();

    this.GetCanvas()?.ForceRefresh();

    this.m_syncingPcbToSchSelection = prevGuard;
    this.m_crossProbeFlashPhase++;

    if (this.m_crossProbeFlashPhase > 6) {
      restore();

      this.m_crossProbeFlashing = false;

      if (this.m_crossProbeFlashTimer !== null) clearInterval(this.m_crossProbeFlashTimer);

      this.m_crossProbeFlashTimer = null;
    }
  }

  /**
   * `OnModify()` (sch_edit_frame.cpp:1333). `Kiway().LocalHistory().NoteFileChange` is the
   * desktop's local file history, which the cloud store replaces; the title the window builds
   * from IsContentModified().
   */
  override OnModify(): void {
    super.OnModify();

    this.GetScreen()?.SetContentModified();

    this.hooks.liveModified?.();

    if (this.m_isClosing) return;

    this.GetCanvas()?.Refresh();
  }

  /** `IsSyncingSelection()` (sch_edit_frame.h:812). */
  IsSyncingSelection(): boolean {
    return this.m_syncingPcbToSchSelection;
  }

  GetErcDialog(): DIALOG_ERC | null {
    if (!this.m_ercDialog) this.m_ercDialog = this.hooks.ercDialog?.() ?? null;

    return this.m_ercDialog;
  }

  /** `onCloseErcDialog` (sch_edit_frame.cpp:2464): the dialog is destroyed and forgotten. */
  CloseErcDialog(): void {
    if (this.m_ercDialog) {
      this.m_ercDialog.Destroy();
      this.m_ercDialog = null;
    }
  }

  /** `GetSymbolDiffDialog` (sch_edit_frame.cpp:2410): made on first use, with its Update button. */
  GetSymbolDiffDialog(): DIALOG_BOOK_REPORTER {
    if (!this.m_diffSymbolDialog) {
      this.m_diffSymbolDialog = new DIALOG_BOOK_REPORTER(
        DIFF_SYMBOLS_DIALOG_NAME,
        'Compare Symbol with Library',
        (aName, aId) => this.onCloseSymbolDiffDialog(aName, aId),
      );

      this.m_diffSymbolDialog.SetApplyLabel('Update Symbol from Library...');
    }

    return this.m_diffSymbolDialog;
  }

  /** `onCloseSymbolDiffDialog` (sch_edit_frame.cpp:2426): Update opens Change Symbols on the symbol. */
  private onCloseSymbolDiffDialog(aName: string, aId: 'ok' | 'apply'): void {
    if (this.m_diffSymbolDialog && aName === DIFF_SYMBOLS_DIALOG_NAME) {
      if (aId === 'apply') {
        const symbolUUID = this.m_diffSymbolDialog.GetUserItemID();

        // CallAfter
        queueMicrotask(() => {
          const item = symbolUUID ? this.ResolveItem(symbolUUID) : null;

          if (item && item.Type() === KICAD_T.SCH_SYMBOL_T) {
            this.m_toolManager!.RunAction(ACTIONS.selectItem, item as EDA_ITEM);

            void this.ShowModalDialog('DIALOG_CHANGE_SYMBOLS', [item], 0 /* MODE::UPDATE */);
          }
        });
      }

      this.m_diffSymbolDialog = null;
    }
  }

  /** `SymbolLibAdapter( &Prj() )->HasLibrary( aNickname, aCheckEnabled )`. */
  SymbolLibHasLibrary(aNickname: string, aCheckEnabled: boolean): boolean {
    return this.hooks.symbolLibHasLibrary?.(aNickname, aCheckEnabled) ?? false;
  }

  /** `UpdateNetHighlightStatus` (sch_edit_frame.cpp:2097): the highlighted net in the status bar. */
  UpdateNetHighlightStatus(): void {
    if (this.GetHighlightedConnection() !== '') {
      this.SetStatusText(`Highlighted net: ${unescapeString(this.GetHighlightedConnection())}`);
    } else {
      this.SetStatusText('');
    }
  }

  /** `UpdateHierarchySelection` (sch_edit_frame.cpp:1414): the hierarchy tree is the window's. */
  UpdateHierarchySelection(): void {
    this.hooks.updateHierarchySelection?.();
  }

  /**
   * `DeleteJunction` (bus-wire-junction.cpp:117): remove \a aJunction, and merge the parallel
   * wires that met on it (`MergeOverlap` without the junction check, so it may bridge the point).
   */
  DeleteJunction(aCommit: SCH_COMMIT, aJunction: SCH_ITEM): void {
    const screen = this.GetScreen()!;
    const selectionTool = this.m_toolManager?.GetTool(SCH_SELECTION_TOOL) ?? null;

    aJunction.SetFlags(STRUCT_DELETED);
    this.RemoveFromScreen(aJunction, screen);
    aCommit.Removed(aJunction, screen);

    // std::list: the pair loop below appends merged lines, which the loop must then visit
    const lines: SCH_LINE[] = [];

    for (const item of screen.Items().Overlapping(KICAD_T.SCH_LINE_T, aJunction.GetPosition())) {
      const line = item as SCH_LINE;

      if (
        (line.IsWire() || line.IsBus()) &&
        line.IsEndPoint(aJunction.GetPosition()) &&
        !(line.GetEditFlags() & STRUCT_DELETED)
      ) {
        lines.push(line);
      }
    }

    // alg::for_all_pairs: each unordered pair once, first before second, over a growing list
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const firstLine = lines[i]!;
        const secondLine = lines[j]!;

        if (
          firstLine.GetEditFlags() & STRUCT_DELETED ||
          secondLine.GetEditFlags() & STRUCT_DELETED ||
          !secondLine.IsParallel(firstLine)
        ) {
          continue;
        }

        // Remove identical lines
        if (
          firstLine.IsEndPoint(secondLine.GetStartPoint()) &&
          firstLine.IsEndPoint(secondLine.GetEndPoint())
        ) {
          firstLine.SetFlags(STRUCT_DELETED);
          continue;
        }

        // Try to merge the remaining lines
        const new_line = secondLine.MergeOverlap(screen, firstLine, false);

        if (new_line) {
          firstLine.SetFlags(STRUCT_DELETED);
          secondLine.SetFlags(STRUCT_DELETED);
          this.AddToScreen(new_line, screen);
          aCommit.Added(new_line, screen);

          if (new_line.IsSelected()) selectionTool?.AddItemToSel(new_line, true /*quiet mode*/);

          lines.push(new_line);
        }
      }
    }

    for (const line of lines) {
      if (line.GetEditFlags() & STRUCT_DELETED) {
        if (line.IsSelected()) selectionTool?.RemoveItemFromSel(line, true /*quiet mode*/);

        this.RemoveFromScreen(line, screen);
        aCommit.Removed(line, screen);
      }
    }
  }

  /** `TestDanglingEnds` (bus-wire-junction.cpp:39): the current screen's, repainting what changed. */
  TestDanglingEnds(): void {
    const changeHandler = (aChangedItem: SCH_ITEM): void => {
      this.GetCanvas()?.GetView().Update(aChangedItem, VIEW_UPDATE_FLAGS.REPAINT);
    };

    this.GetScreen()!.TestDanglingEnds(null, changeHandler);
  }

  /** `OnPageSettingsChange` (sch_edit_frame.cpp:2048): keep the zoom, and rebuild the sheet view. */
  OnPageSettingsChange(): void {
    // Store the current zoom level into the current screen before calling
    // DisplayCurrentSheet() that set the zoom to GetScreen()->m_LastZoomLevel
    const view = this.GetCanvas()?.GetView();

    if (view) this.GetScreen()!.m_LastZoomLevel = view.GetScale();

    // Rebuild the sheet view (draw area and any other items):
    this.DisplayCurrentSheet();
  }

  /** See SCH_EDIT_FRAME_HOOKS.fileDialog. */
  override ShowFileDialog(
    aTitle: string,
    aDefaultDir: string,
    aDefaultFile: string,
    aWildcard: string | readonly ChooserFilter[],
    aStyle: number,
    aCustomizeHook?: FILEDLG_HOOK,
  ): Promise<string | null> {
    // `dlg.SetCustomizeHook( hook )`: a hook the window does not show stays unattached.
    if (aCustomizeHook) aCustomizeHook.attached = false;

    return Promise.resolve(
      this.hooks.fileDialog?.(
        aTitle,
        aDefaultDir,
        aDefaultFile,
        aWildcard,
        aStyle,
        aCustomizeHook,
      ) ?? null,
    );
  }

  /**
   * `saveProjectSettings()` (eeschema_config.cpp:162): ERC exclusions, the drawing sheet file,
   * the IPC-2581 revision and the top-level sheets into the project file, which is then saved.
   */
  saveProjectSettings(): void {
    const fn = this.Schematic()
      .RootScreen()!
      .GetFileName()
      .replace(/\.[^./]*$/, `.${PROJECT_FILE_EXTENSION}`);

    if (
      fn.slice(fn.lastIndexOf('/') + 1) === `.${PROJECT_FILE_EXTENSION}` ||
      !this.IsWritable(fn, false)
    )
      return;

    this.Schematic().RecordERCExclusions();

    // `Kiway().Player( FRAME_SIMULATOR )`'s ngspice settings: the simulator is not ported.

    // Save the page layout file if doesn't exist yet (e.g. if we opened a non-kicad schematic)

    // TODO: We need to remove dependence on BASE_SCREEN
    const schSettings = this.Prj().GetProjectFile()
      .m_SchematicSettings as unknown as SCHEMATIC_SETTINGS | null;

    if (schSettings) schSettings.m_SchDrawingSheetFileName = BASE_SCREEN.m_DrawingSheetFileName;

    if (BASE_SCREEN.m_DrawingSheetFileName !== '') {
      const resolve = new FILENAME_RESOLVER();
      resolve.SetProject(this.Prj());
      resolve.SetProgramBase(PgmOrNull());

      let layoutfn = resolve.ResolvePath(
        BASE_SCREEN.m_DrawingSheetFileName,
        this.Prj().GetProjectPath(),
        [this.Schematic().GetEmbeddedFiles()],
      );

      if (!PosixPath.isAbsolute(layoutfn))
        layoutfn = PosixPath.makeAbsolute(layoutfn, this.Prj().GetProjectPath());

      if (layoutfn !== '' && !wxFileExists(layoutfn)) {
        const dir = PosixPath.dirname(layoutfn);

        if (wxDirExists(dir) && wxIsDirWritable(dir))
          wxWriteFileSync(
            layoutfn,
            new TextEncoder().encode(DS_DATA_MODEL.GetTheInstance().Save(layoutfn)),
          );
      }
    }

    // Propagate the root schematic revision to the project file for IPC-2581 BOM export
    if (this.Schematic().RootScreen())
      this.Prj().GetProjectFile().m_IP2581Bom.schRevision = this.Schematic()
        .RootScreen()!
        .GetTitleBlock()
        .GetRevision();

    // Update top-level sheets information in the project file
    const topLevelSheets = this.Schematic().GetTopLevelSheets();

    if (topLevelSheets.length > 0) {
      const projectSheets = this.Prj().GetProjectFile().GetTopLevelSheets();
      projectSheets.length = 0;

      const projectPath = this.Prj().GetProjectPath();

      for (const sheet of topLevelSheets) {
        // For top-level sheets, get the filename from the screen, not from the sheet's
        // SHEET_FILENAME field (which is only used for sheet instances on parent sheets)
        let filename = sheet.GetScreen()?.GetFileName() ?? '';

        // Make the filename relative to the project path
        if (PosixPath.isAbsolute(filename))
          filename = PosixPath.makeRelativeTo(filename, projectPath);

        projectSheets.push(new TOP_LEVEL_SHEET_INFO(sheet.m_Uuid, sheet.GetName(), filename));
      }
    }

    Pgm().GetSettingsManager().SaveProject();
  }

  /** `SaveProjectLocalSettings()` (eeschema_config.cpp:250). */
  SaveProjectLocalSettings(): void {
    const localSettings = this.Prj().GetLocalSettings();
    const selTool = this.GetToolManager()?.FindTool('common.InteractiveSelection') as {
      GetFilter(): SCH_SELECTION_FILTER_OPTIONS;
    } | null;

    if (selTool) localSettings.m_SchSelectionFilter = selTool.GetFilter();

    localSettings.m_SchHierarchyCollapsed =
      this.hooks.hierarchyCollapsedPaths?.() ?? localSettings.m_SchHierarchyCollapsed;
  }

  /**
   * `NewProject()` (sch_edit_frame.cpp:1435): "Only standalone mode can directly load a new
   * document" - `if( !Kiface().IsSingle() ) return;` - and the browser always runs under the
   * project manager, so the rest of it never runs.
   */
  NewProject(): void {}

  /** `LoadProject()` (sch_edit_frame.cpp:1470): standalone only, as NewProject. */
  LoadProject(): void {}

  /** The window's half of the dialogs a tool opens: see SCH_EDIT_FRAME_HOOKS.showModal. */
  override ShowModalDialog(
    aDialog: string,
    aItems: readonly EDA_ITEM[],
    aArg?: unknown,
  ): Promise<number> {
    // WithoutDialogs: no window to ask; a message dialog's question takes the capture's answer.
    if (this.m_capture) {
      const message = (aArg as { message?: string } | undefined)?.message;

      if (message) this.m_capture.messages.push(message);

      return Promise.resolve(this.m_capture.answer ? wxID_OK : wxID_CANCEL);
    }

    return Promise.resolve(this.hooks.showModal?.(aDialog, aItems, aArg) ?? wxID_CANCEL);
  }

  /**
   * `EditSheetProperties( aSheet, aHierarchy, aIsUndoable, aClearAnnotationNewItems,
   * aUpdateHierarchyNavigator )` (sheet.cpp): the out-params come back in the result; null is
   * Cancel.
   */
  EditSheetProperties(
    aSheet: SCH_SHEET,
    aHierarchy: SCH_SHEET_PATH,
    aSourceSheetFilename?: string,
  ): Promise<SHEET_PROPERTIES_RESULT | null> {
    return Promise.resolve(
      this.hooks.editSheetProperties?.(aSheet, aHierarchy, aSourceSheetFilename) ?? null,
    );
  }

  /**
   * `PickSymbolFromLibrary` (picksymbol.cpp:48, SCH_BASE_FRAME's): the symbol chooser; the pick
   * goes to the front of \a aHistoryList. An invalid LibId (or null here) is Cancel.
   */
  async PickSymbolFromLibrary(
    aFilter: SYMBOL_LIBRARY_FILTER | null,
    aHistoryList: PICKED_SYMBOL[],
    aAlreadyPlaced: PICKED_SYMBOL[],
    aShowFootprints: boolean,
  ): Promise<PICKED_SYMBOL | null> {
    const picked =
      (await this.hooks.pickSymbol?.(aFilter, aHistoryList, aAlreadyPlaced, aShowFootprints)) ??
      null;

    if (!picked || !picked.LibId.IsValid()) return null;

    const sel: PICKED_SYMBOL = { ...picked, Unit: picked.Unit === 0 ? 1 : picked.Unit };

    // std::erase_if( aHistoryList, same LibId ); insert at the front
    for (let i = aHistoryList.length - 1; i >= 0; i--)
      if (aHistoryList[i]!.LibId.equals(sel.LibId)) aHistoryList.splice(i, 1);

    aHistoryList.unshift({
      LibId: sel.LibId,
      Unit: sel.Unit,
      Convert: sel.Convert,
      Fields: sel.Fields,
    });

    return sel;
  }

  /** `wxTextEntryDialog`: null when cancelled, or when there is no window to ask. */
  TextEntryDialog(aMessage: string, aCaption: string, aValue: string): Promise<string | null> {
    return Promise.resolve(this.hooks.textEntry?.(aMessage, aCaption, aValue) ?? null);
  }

  /**
   * `SelectUnit` (picksymbol.cpp:97): show unit \a aUnit of \a aSymbol, swapping with or
   * duplicating a unit already placed elsewhere as the user answers. The unit count is the
   * embedded library symbol's (GetLibSymbol asks the library, which the live frame has not).
   */
  SelectUnit(aSymbol: SCH_SYMBOL, aUnitIn: number): void {
    let aUnit = aUnitIn;
    const commit = new SCH_COMMIT(this.m_toolManager!);
    const symbol = aSymbol.GetLibSymbolRef();

    if (!symbol) return;

    const unitCount = symbol.GetUnitCount();
    const currentUnit = aSymbol.GetUnit();

    if (unitCount <= 1 || currentUnit === aUnit) return;

    if (aUnit > unitCount) aUnit = unitCount;

    const sheetPath = this.GetCurrentSheet();
    let swapWithOther = false;
    const otherSymbolRef = FindSymbolByRefAndUnit(
      aSymbol.Schematic()!,
      aSymbol.GetRef(sheetPath, false),
      aUnit,
    );

    if (otherSymbolRef) {
      const targetUnitName = symbol.GetUnitDisplayName(aUnit, false);
      const currUnitName = symbol.GetUnitDisplayName(currentUnit, false);
      let otherSheetName = otherSymbolRef.GetSheetPath().PathHumanReadable(true, true);

      if (otherSheetName === '') otherSheetName = 'Root';

      const msg = `Symbol unit '${targetUnitName}' is already placed (on sheet '${otherSheetName}')`;

      const ret =
        this.hooks.unitAlreadyPlaced?.(
          msg,
          `&Swap '${targetUnitName}' and '${currUnitName}'`,
          `&Duplicate '${targetUnitName}'`,
        ) ?? 'cancel';

      if (ret === 'cancel') return;

      if (ret === 'swap') swapWithOther = true;
    }

    if (swapWithOther) {
      // We were reliably informed this would exist.
      const otherSymbol = otherSymbolRef!.GetSymbol();

      if (!otherSymbol.GetEditFlags())
        commit.Modify(otherSymbol, otherSymbolRef!.GetSheetPath().LastScreen());

      // Give that symbol the unit we used to have
      otherSymbol.SetUnitSelection(otherSymbolRef!.GetSheetPath(), currentUnit);
      otherSymbol.SetUnit(currentUnit);
    }

    if (!aSymbol.GetEditFlags())
      // No command in progress: save in undo list
      commit.Modify(aSymbol, this.GetScreen());

    // Update the unit number.
    aSymbol.SetUnit(aUnit);
    aSymbol.SetUnitSelection(sheetPath, aUnit);

    if (!commit.Empty()) {
      if (this.eeconfig()!.autoplace_fields.enable) {
        const fieldsAutoplaced = aSymbol.GetFieldsAutoplaced();

        if (
          fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
          fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
        )
          aSymbol.AutoplaceFields(this.GetScreen(), fieldsAutoplaced);
      }

      if (swapWithOther) commit.Push('Swap Units');
      else commit.Push('Change Unit');
    }
  }

  /** `SelectBodyStyle` (picksymbol.cpp:186). */
  SelectBodyStyle(aSymbol: SCH_SYMBOL | null, aBodyStyleIn: number): void {
    let aBodyStyle = aBodyStyleIn;

    if (!aSymbol || !aSymbol.GetLibSymbolRef()) return;

    const bodyStyleCount = aSymbol.GetLibSymbolRef()!.GetBodyStyleCount();
    const currentBodyStyle = aSymbol.GetBodyStyle();

    if (bodyStyleCount <= 1 || currentBodyStyle === aBodyStyle) return;

    if (aBodyStyle > bodyStyleCount) aBodyStyle = bodyStyleCount;

    const commit = new SCH_COMMIT(this.m_toolManager!);

    commit.Modify(aSymbol, this.GetScreen());

    aSymbol.SetBodyStyle(aBodyStyle);

    // If selected make sure all the now-included pins are selected
    if (aSymbol.IsSelected()) this.m_toolManager!.RunAction(ACTIONS.selectItem, aSymbol);

    commit.Push('Change Body Style');
  }

  /** `SetAltPinFunction` (picksymbol.cpp:214). */
  SetAltPinFunction(aPin: SCH_PIN | null, aFunction: string): void {
    if (!aPin) return;

    const commit = new SCH_COMMIT(this.m_toolManager!);
    commit.Modify(aPin, this.GetScreen());

    if (aFunction === aPin.GetName()) aPin.SetAlt('');
    else aPin.SetAlt(aFunction);

    commit.Push('Set Pin Function');
  }

  /** Clone \a aItem and add it to the list of repeatable items. */
  AddCopyForRepeatItem(aItem: SCH_ITEM | null): void {
    // we cannot store a pointer to an item in the display list here since
    // that item may be deleted, such as part of a line concatenation or other.
    // So simply always keep a copy of the object which is to be repeated.

    if (aItem) {
      const repeatItem = aItem.Duplicate(false /* IGNORE_PARENT_GROUP */) as SCH_ITEM;

      // Clone() preserves the flags & parent, we want 'em cleared.
      repeatItem.ClearFlags();
      repeatItem.SetParent(null);

      this.m_items_to_repeat.push(repeatItem);
    }
  }

  /** `SCH_EDIT_FRAME::KiwayMailIn` (eeschema/cross-probing.cpp). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    const payload = mail.GetPayload();

    switch (mail.Command()) {
      case MAIL_T.MAIL_CROSS_PROBE:
        this.ExecuteRemoteCommand(payload);
        break;

      // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH, as upstream
      case MAIL_T.MAIL_SELECTION:
        if (!this.hooks.crossProbingSettings().on_selection) break;

      // KI_FALLTHROUGH;

      case MAIL_T.MAIL_SELECTION_FORCE: {
        // $SELECT: 0,<spec1>,<spec2>,<spec3>
        // Try to select specified items.

        // $SELECT: 1,<spec1>,<spec2>,<spec3>
        // Select and focus on <spec1> item, select other specified items that are on the
        // same sheet.

        const prefix = '$SELECT: ';

        const paramStr = payload.substring(prefix.length);

        // Empty/broken command: we need at least 2 chars for sync string.
        if (paramStr.length < 2) break;

        const syncStr = paramStr.substring(2);

        const focusOnFirst = paramStr[0] === '1';

        const findRet = findItemsFromSyncSelection(this.Schematic(), syncStr, focusOnFirst);

        if (findRet) {
          const [sheetPath, focusItem, items] = findRet;

          this.m_syncingPcbToSchSelection = true; // recursion guard

          try {
            this.m_toolManager
              ?.GetTool(SCH_SELECTION_TOOL)
              ?.SyncSelection(sheetPath, focusItem, items);
          } finally {
            this.m_syncingPcbToSchSelection = false;
          }

          if (this.hooks.crossProbingSettings().flash_selection && items.length > 0)
            this.StartCrossProbeFlash(items);
        }

        break;
      }

      case MAIL_T.MAIL_ASSIGN_FOOTPRINTS:
        try {
          const controlTool = this.m_toolManager?.FindTool(
            'eeschema.EditorControl',
          ) as SCH_EDITOR_CONTROL | null;
          controlTool?.AssignFootprints(payload);
        } catch {
          // IO_ERROR: an unreadable payload assigns nothing.
        }

        break;

      case MAIL_T.MAIL_SCH_SAVE:
        if (this.hooks.saveProject()) mail.SetPayload('success');

        break;

      case MAIL_T.MAIL_SCH_GET_NETLIST: {
        if (!this.hooks.syncLiveSchematic) {
          // TRANSITIONAL: the record model's netlist, until the window keeps a live schematic.
          const netlist = this.hooks.getNetlist?.(payload) ?? null;

          if (netlist !== null) mail.SetPayload(netlist);

          break;
        }

        if (!this.hooks.syncLiveSchematic()) break;

        if (payload !== '') {
          // Ensure schematic is OK for netlist creation (especially that it is fully annotated):
          if (!this.ReadyToNetlist(payload)) break;
        }

        // (ADVANCED_CFG::m_IncrementalConnectivity is off by default: no recalculation here.)
        const exporter = new NETLIST_EXPORTER_KICAD(this.Schematic());

        if (this.hooks.symbolLibraryUri) exporter.m_libraryUri = this.hooks.symbolLibraryUri;

        mail.SetPayload(exporter.Format(GNL_ALL | GNL_T.GNL_OPT_KICAD));

        break;
      }

      default:
        break;
    }
  }

  /**
   * `SCH_EDIT_FRAME::ExecuteRemoteCommand` (eeschema/cross-probing.cpp:202): a cross-probe
   * packet from the board.
   */
  ExecuteRemoteCommand(cmdline: string): void {
    // A remote command can arrive over the cross-probe socket before tools are registered
    // or after the tool manager has been torn down while the frame is closing.
    if (!this.m_toolManager) return;

    const editor = this.m_toolManager.FindTool(
      'eeschema.EditorControl',
    ) as SCH_EDITOR_CONTROL | null;

    if (!editor) return;

    const tok = new STRTOK(strncpyLine(cmdline));
    let idcmd = tok.Next(' \n\r');
    let text = tok.Next('"\n\r');

    if (idcmd === null) return;

    const crossProbingSettings = this.hooks.crossProbingSettings();

    if (idcmd === '$CONFIG') {
      this.GetToolManager()!.RunAction(ACTIONS.showSymbolLibTable);
      return;
    } else if (idcmd === '$ERC') {
      this.GetToolManager()!.RunAction(SCH_ACTIONS.runERC);
      return;
    } else if (idcmd === '$NET:') {
      if (!crossProbingSettings.auto_highlight) return;

      const netName = text ?? '';
      const sg = this.Schematic().ConnectionGraph().FindFirstSubgraphByName(netName);

      if (sg) this.m_highlightedConn = sg.GetDriverConnection()!.Name();
      else this.m_highlightedConn = '';

      this.GetToolManager()!.RunAction(SCH_ACTIONS.updateNetHighlighting);
      this.RefreshNetNavigator();

      this.SetStatusText(`Highlighted net: ${unescapeString(netName)}`);

      return;
    } else if (idcmd === '$CLEAR:') {
      // Cross-probing is now done through selection so we no longer need a clear command
      return;
    }

    if (!crossProbingSettings.on_selection) return;

    if (text === null) return;

    if (idcmd !== '$PART:') return;

    const part_ref = text;

    /* look for a complement */
    idcmd = tok.Next(' \n\r');

    if (idcmd === null) {
      // Highlight symbol only (from CvPcb or Pcbnew)
      // Highlight symbol part_ref, or clear Highlight, if part_ref is not existing
      editor.FindSymbolAndItem(null, part_ref, true, SCH_SEARCH_T.HIGHLIGHT_SYMBOL, '');
      return;
    }

    text = tok.Next('"\n\r');

    if (text === null) return;

    const msg = text;

    if (idcmd === '$REF:') {
      // Highlighting the reference itself isn't actually that useful, and it's harder to
      // see.  Highlight the parent and display the message.
      editor.FindSymbolAndItem(null, part_ref, true, SCH_SEARCH_T.HIGHLIGHT_SYMBOL, msg);
    } else if (idcmd === '$VAL:') {
      // Highlighting the value itself isn't actually that useful, and it's harder to see.
      // Highlight the parent and display the message.
      editor.FindSymbolAndItem(null, part_ref, true, SCH_SEARCH_T.HIGHLIGHT_SYMBOL, msg);
    } else if (idcmd === '$PAD:') {
      editor.FindSymbolAndItem(null, part_ref, true, SCH_SEARCH_T.HIGHLIGHT_PIN, msg);
    } else {
      editor.FindSymbolAndItem(null, part_ref, true, SCH_SEARCH_T.HIGHLIGHT_SYMBOL, '');
    }
  }

  /**
   * `SCH_EDIT_FRAME::OnUpdatePCB` (eeschema/sch_edit_frame.cpp:1354): bring
   * the board up and mail it `MAIL_PCB_UPDATE`, which runs its Update PCB
   * from Schematic. Upstream opens the project's board when pcbnew is not
   * running, creating it if it does not exist; the editor here only offers
   * the command when the project has a board.
   */
  /**
   * `sendNetlistToCvpcb()` (netlist_generator.cpp:232): the KiCad netlist, mailed to CvPcb
   * (`MAIL_EESCHEMA_NETLIST`).
   */
  sendNetlistToCvpcb(): void {
    // @todo : trim GNL_ALL down to minimum for CVPCB
    const exporter = new NETLIST_EXPORTER_KICAD(this.Schematic());

    if (this.hooks.symbolLibraryUri) exporter.m_libraryUri = this.hooks.symbolLibraryUri;

    const packet = exporter.Format(GNL_ALL | GNL_T.GNL_OPT_KICAD); // an abbreviated "kicad" (s-expr) netlist

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_CVPCB,
      MAIL_T.MAIL_EESCHEMA_NETLIST,
      { value: packet },
      this,
    );
  }

  /** `OnOpenCvpcb()` (sch_edit_frame.cpp:1576). */
  OnOpenCvpcb(): void {
    if (!this.ReadyToNetlist('Assigning footprints requires a fully annotated schematic.')) return;

    const kiway = this.Kiway();

    if (!kiway) return;

    // Kiway().Player( FRAME_CVPCB, true ) and Show( true ): the program opens or raises it; it
    // returns false when CvPcb cannot be run ("No need to show a warning").
    if (!kiway.Player(FRAME_T.FRAME_CVPCB)) return;

    // Ensure the netlist (mainly info about symbols) is up to date
    this.RecalculateConnections(null, SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP);
    this.sendNetlistToCvpcb();
  }

  /**
   * `OnOpenPcbnew()` (sch_edit_frame.cpp:1520), under the project manager: open or raise the
   * board editor. Upstream hands a new frame `OpenProjectFiles( boardfn )`; the program here
   * opens the project's own board when it brings the editor up.
   */
  OnOpenPcbnew(): void {
    // Use the project's board, not the active sheet's name, which may belong to another project.
    const projectName = this.Prj().GetProjectFullName();
    const kicad_board =
      projectName === '' ? this.Prj().AbsolutePath(this.Schematic().GetFileName()) : projectName;
    const name = kicad_board.slice(kicad_board.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');

    // `ExecuteFile( PCBNEW_EXE, ... )` is standalone mode's, which the browser never runs in.
    if (name === '') return;

    this.Kiway()?.Player(FRAME_T.FRAME_PCB_EDITOR);
  }

  OnUpdatePCB(): void {
    const kiway = this.Kiway();

    if (!kiway) return;

    kiway.Player(FRAME_T.FRAME_PCB_EDITOR);

    const payload = { value: '' };
    kiway.ExpressMail(FRAME_T.FRAME_PCB_EDITOR, MAIL_T.MAIL_PCB_UPDATE, payload, this);
  }

  /** `SCH_EDIT_FRAME::SendSelectItemsToPcb( aItems, aForce )` (eeschema/cross-probing.cpp:312). */
  SendSelectItemsToPcb(aItems: readonly EDA_ITEM[], aForce: boolean): void {
    const parts: string[] = [];

    for (const item of aItems) {
      switch (item.Type()) {
        case KICAD_T.SCH_SYMBOL_T: {
          const symbol = item as unknown as SCH_SYMBOL;
          const ref = symbol.GetField(FIELD_T.REFERENCE)!.GetText();

          parts.push(`F${EscapeString(ref, ESCAPE_CONTEXT.CTX_IPC)}`);
          break;
        }

        case KICAD_T.SCH_SHEET_T: {
          // For cross probing, we need the full path of the sheet, because
          // we search by the footprint path prefix in the PCB editor
          const full_path = this.GetCurrentSheet().PathAsString() + item.m_Uuid;

          parts.push(`S${full_path}`);
          break;
        }

        case KICAD_T.SCH_PIN_T: {
          const pin = item as unknown as SCH_PIN;
          const symbol = pin.GetParentSymbol() as unknown as SCH_SYMBOL;
          const ref = symbol.GetRef(this.GetCurrentSheet(), false);

          parts.push(
            `P${EscapeString(ref, ESCAPE_CONTEXT.CTX_IPC)}/${EscapeString(pin.GetShownNumber(), ESCAPE_CONTEXT.CTX_IPC)}`,
          );
          break;
        }

        default:
          break;
      }
    }

    if (parts.length === 0) return;

    let command = '$SELECT: 0,';

    for (const part of parts) {
      command += part;
      command += ',';
    }

    command = command.slice(0, -1);

    // Typically ExpressMail is going to be s-expression packets, but since
    // we have existing interpreter of the selection packet on the other
    // side in place, we use that here.
    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      aForce ? MAIL_T.MAIL_SELECTION_FORCE : MAIL_T.MAIL_SELECTION,
      { value: command },
      this,
    );
  }

  /** `SCH_EDIT_FRAME::SendCrossProbeNetName` (eeschema/cross-probing.cpp:383). */
  SendCrossProbeNetName(aNetName: string): void {
    // The command is a keyword followed by a quoted string.
    const packet = `$NET: "${aNetName}"`;

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      MAIL_T.MAIL_CROSS_PROBE,
      { value: packet },
      this,
    );
  }

  /** `SCH_EDIT_FRAME::SendCrossProbeClearHighlight` (eeschema/cross-probing.cpp:457). */
  SendCrossProbeClearHighlight(): void {
    const packet = '$CLEAR\n';

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      MAIL_T.MAIL_CROSS_PROBE,
      { value: packet },
      this,
    );
  }
}

/**
 * The order of the docked panes in the Schematic Editor's left column.
 *
 * eeschema sets each pane's `Position()` in two places — the pane infos in
 * `eeschema/eeschema_settings.cpp` and the one inline `AddPane` in
 * `eeschema/sch_edit_frame.cpp` — kept together here, rather than split across
 * `eeschema_settings.ts`/`sch_edit_frame.ts` by data source, because
 * {@link schLeftDockLayout} and the tables below read both as one dock; see
 * the per-symbol doc comments for exactly which upstream file each number
 * comes from:
 *
 *   | pane                | Position | AddPane | where                     |
 *   |---------------------|----------|---------|---------------------------|
 *   | Net Navigator       |    0     |    4th  | eeschema_settings.cpp:74  |
 *   | Schematic Hierarchy |    1     |    1st  | sch_edit_frame.cpp:262    |
 *   | Properties          |    2     |    2nd  | eeschema_settings.cpp:95  |
 *   | Selection Filter    |    4     |    3rd  | eeschema_settings.cpp:117 |
 *
 * All four are `.Left().Layer( 3 )`, so this is one column. Position 3 is
 * deliberately unused upstream — the numbers are sparse, which is why this
 * table mirrors them rather than renumbering 0..3.
 *
 * **`Position()` is not the order.** It is only the STARTING `dock_pos`, and
 * wxAuiManager rewrites `dock_pos` on every `Update()`. `qa/probes/aui_dock_pos_probe.cpp`
 * builds these four panes with wx 3.2.4 and toggles them the way
 * `SCH_EDIT_FRAME::ToggleSchematicHierarchy` (sch_edit_frame.cpp:2910) and
 * `ToggleProperties` (:2886) do — both of which only call `.Show()` and never
 * touch Position — and measures each pane's on-screen y. Two rules explain
 * every line of its output:
 *
 *   1. Each `Update()` renumbers the SHOWN panes of the dock: it sorts them by
 *      their current `dock_pos` and writes back 0, 1, 2 ... in that order. A
 *      HIDDEN pane is not touched and keeps the number it had.
 *   2. Ties are broken by `AddPane` order, the third column above.
 *
 * So the pane opened FIRST is alone in the dock and is compacted to 0, while
 * the one opened next still carries its original `Position()` — 1, 2 or 4,
 * all greater — and lands BELOW it. Open the hierarchy first and it is on
 * top; open Properties first and IT is on top. That is what the user sees,
 * and it is why a fixed order table was the wrong model, not merely a wrong
 * pair of numbers. The table still decides one case: panes that become
 * visible in the SAME `Update()`, which is a frame restoring its layout.
 *
 * {@link schLeftDockLayout} is those two rules; the editor keeps the resulting
 * `dock_pos` and feeds it back in, exactly as the pane infos do upstream.
 *
 * This is a data module and not a comment in the JSX because a JSX block's
 * order cannot be asserted from a Node test, and the order is exactly the
 * thing that was wrong: ours rendered Properties above the hierarchy, and
 * then — after that was "fixed" — rigidly the other way round.
 *
 * The Search pane is NOT in this list. Upstream docks it at the BOTTOM —
 * `EDA_PANE().Name( SearchPaneName() ).Bottom()` (sch_edit_frame.cpp:290-292)
 * — under the canvas rather than in this column. See {@link SCH_BOTTOM_DOCK}.
 */

/** A docked pane of the left column, named as `wxAuiPaneInfo::Name()` names it. */
export type SchLeftPane = 'netNavigator' | 'hierarchy' | 'properties' | 'selectionFilter';

/**
 * `Position()` for each pane of the left dock, verbatim from the two files
 * above. Sparse on purpose: upstream skips 3.
 *
 * This is the value `AddPane` leaves in `dock_pos`, i.e. the state the column
 * starts in — not the order it stays in. See {@link schLeftDockLayout}.
 */
export const SCH_LEFT_PANE_POSITION: Readonly<Record<SchLeftPane, number>> = {
  netNavigator: 0,
  hierarchy: 1,
  properties: 2,
  selectionFilter: 4,
};

/**
 * The order the four `AddPane` calls run in: the hierarchy inline at
 * `sch_edit_frame.cpp:260`, then Properties (:272), the Selection Filter
 * (:273) and the Net Navigator (:279). Note the Net Navigator is added LAST
 * despite being `Position( 0 )`.
 *
 * It is here because it breaks ties: two panes can hold the same `dock_pos`
 * once one of them has been compacted, and then this decides. Measured in the
 * probe's "re-open Properties" scenario, where Properties ties the hierarchy
 * at 0 and the hierarchy — added first — keeps the top slot.
 */
export const SCH_LEFT_PANE_ADD_ORDER: readonly SchLeftPane[] = [
  'hierarchy',
  'properties',
  'selectionFilter',
  'netNavigator',
];

/** `dock_pos` for every pane of the column, the state wxAUI carries forward. */
export type SchDockPos = Readonly<Record<SchLeftPane, number>>;

/**
 * The column's starting `dock_pos`, from a stored perspective or from
 * `AddPane`.
 *
 * `RestoreAuiLayout()` (sch_edit_frame.cpp:304) loads `window.perspective`
 * before a single pane is shown, so the numbers a previous session was left
 * with — not {@link SCH_LEFT_PANE_POSITION} — are what the next one starts
 * from. That matters because wxAUI's renumbering pass is not reversible: it
 * compacts whatever was shown, and a pane hidden at that moment keeps the
 * number it had. Measured with `qa/probes/aui_dock_pos_probe.cpp` on this
 * machine's own saved perspective (Properties `pos=0`, hierarchy `pos=1`),
 * closing both palettes and re-opening Properties and then the hierarchy leaves
 * **Properties on top**; run from `AddPane`'s numbers the very same sequence
 * leaves the **hierarchy** on top, because the two tie at 0 and `AddPane` order
 * breaks the tie. So an editor that forgets the numbers between sessions
 * answers a question KiCad answers from memory.
 *
 * A missing or non-numeric entry falls back to `AddPane`'s value, which is what
 * a pane absent from the perspective string gets upstream.
 */
export function schDockPosFrom(stored: Readonly<Record<string, number>> | undefined): SchDockPos {
  const out = { ...SCH_LEFT_PANE_POSITION } as Record<SchLeftPane, number>;
  for (const pane of SCH_LEFT_PANE_ADD_ORDER) {
    const v = stored?.[pane];
    if (typeof v === 'number' && Number.isFinite(v)) out[pane] = v;
  }
  return out;
}

/** What one `wxAuiManager::Update()` leaves behind. */
export interface SchLeftDockLayout {
  /** The panes on screen, TOP TO BOTTOM. */
  readonly order: readonly SchLeftPane[];
  /** `dock_pos` after the renumbering pass, to be fed into the next Update. */
  readonly dockPos: SchDockPos;
}

/**
 * One `Update()` of the left dock: sort, draw, renumber.
 *
 * Both rules are the probe's, measured rather than read (there is no wx source
 * on this machine): the shown panes are ordered by `dock_pos` with `AddPane`
 * order breaking ties, and then the shown ones — only those — are renumbered
 * 0, 1, 2 ... A hidden pane keeps its number, which is what makes closing and
 * re-opening a pane put it back where it was instead of at the bottom.
 *
 * Idempotent: running it again with the same `shown` set returns the same
 * order and the same numbers, because compacting an already-compacted dock
 * changes nothing. That is what lets the editor call it once per render.
 */
export function schLeftDockLayout(
  dockPos: SchDockPos,
  shown: Readonly<Record<SchLeftPane, boolean>>,
): SchLeftDockLayout {
  // The comparator states the tie-break instead of leaning on Array.sort being
  // stable over an array that happens to be in AddPane order: the tie is a
  // measured rule and deserves to be written down.
  const bySlot = (a: SchLeftPane, b: SchLeftPane): number =>
    dockPos[a] - dockPos[b] ||
    SCH_LEFT_PANE_ADD_ORDER.indexOf(a) - SCH_LEFT_PANE_ADD_ORDER.indexOf(b);

  // The Selection Filter is not one of the panes that contend for a slot. It is
  // the LAST row of the column, always, and the three facts that say so all
  // agree: `Position( 4 )` where the others are 0, 1 and 2 and 3 is deliberately
  // skipped; `dock_proportion = 0`, so it alone never grows; and no visibility
  // control of its own. Read back out of a real eeschema's saved perspective on
  // this machine (`~/.config/kicad/10.0/eeschema.json`):
  //
  //     PropertiesManager    pos=0 prop=100000
  //     SchematicHierarchy   pos=1 prop=100000
  //     SelectionFilter      pos=2 prop=0
  //
  // -- highest position of the three, and the only one with no proportion, which
  // is why it sits flush against the message panel as part of the same band
  // rather than floating between two palettes.
  const CONTENDERS = SCH_LEFT_PANE_ADD_ORDER.filter((p) => p !== 'selectionFilter');

  const shownContenders = CONTENDERS.filter((p) => shown[p]).sort(bySlot);
  const next: Record<SchLeftPane, number> = { ...dockPos };
  shownContenders.forEach((pane, i) => {
    next[pane] = i;
  });

  // A HIDDEN contender is left alone, which is what wxAUI does and what
  // `qa/probes/aui_dock_pos_probe.cpp` measures -- including the tie that
  // follows when a shown pane later compacts onto the number a hidden one still
  // holds. The probe drives the same path the frame does, `Show()` then
  // `SetAuiPaneSize`'s MinSize/Fixed/Update/Resizable/Update (its lines
  // 406-422), so that tie is real and is deliberately NOT smoothed away here.

  // The filter goes immediately after the SHOWN panes, so nothing can renumber
  // it into the middle of the column. `shownContenders.length` and not
  // `CONTENDERS.length`, because that is the number a real perspective holds:
  // with Properties and the hierarchy shown and the Net Navigator hidden, this
  // machine's eeschema.json has `SelectionFilter … pos=2`, one past the two
  // panes above it — not one past every pane that could exist.
  // Only when it is on screen: a hidden pane keeps the number it had, which is
  // the rule the probe measured for every other pane and there is no reason the
  // filter should differ. It also keeps an empty column a no-op.
  if (shown.selectionFilter) next.selectionFilter = shownContenders.length;

  const order: SchLeftPane[] = shown.selectionFilter
    ? [...shownContenders, 'selectionFilter']
    : shownContenders;

  return { order, dockPos: next };
}

/**
 * Whether a pane can GROW to fill the column.
 *
 * Only the Selection Filter cannot: `selectionFilterPane.dock_proportion = 0`
 * (sch_edit_frame.cpp:325), with the comment "The selection filter doesn't need
 * to grow in the vertical direction when docked", and its pane info asks for a
 * `-1` height (eeschema_settings.cpp:123-125). Every other pane in the column
 * takes a share of the leftover height, so only those get a drag sash.
 *
 * This is a per-pane predicate and no longer a list, because a list would have
 * to carry an order, and the order is {@link schLeftDockLayout}'s answer now.
 */
export function schPaneGrows(pane: SchLeftPane): boolean {
  return pane !== 'selectionFilter';
}

/**
 * Whether the Selection Filter is on screen.
 *
 * It has no visibility control of its own. `SCH_EDIT_FRAME::updateSelectionFilterVisbility`
 * (sch_edit_frame.cpp:2817-2831) decides for it, with the comment
 *
 *   // Don't give the selection filter its own visibility controls; instead show it if
 *   // anything else is visible
 *
 * and the condition
 *
 *   bool showFilter = ( hierarchyPane.IsShown() && hierarchyPane.IsDocked() )
 *                     || ( netNavigatorPane.IsShown() && netNavigatorPane.IsDocked() )
 *                     || ( propertiesPane.IsShown() && propertiesPane.IsDocked() );
 *
 * Ours keyed on Properties alone, so closing Properties with the hierarchy open
 * took the filter away with it.
 *
 * The `IsDocked()` half has no counterpart here: we have no floating panes, so
 * a shown pane is always a docked one. It is written out above rather than
 * dropped silently, because if panes ever float this predicate is where the
 * other half belongs.
 *
 * The Search pane is deliberately not a term — it is `.Bottom()`, not part of
 * this column, and upstream does not consult it.
 */
export function schSelectionFilterShown(
  shown: Readonly<Record<Exclude<SchLeftPane, 'selectionFilter'>, boolean>>,
): boolean {
  return shown.hierarchy || shown.netNavigator || shown.properties;
}

/**
 * The Search pane, which is docked at the BOTTOM and not in the column above.
 *
 * `sch_edit_frame.cpp:290-300`:
 *
 *   m_auimgr.AddPane( m_searchPane, EDA_PANE()
 *                     .Name( SearchPaneName() )
 *                     .Bottom()
 *                     .Caption( _( "Search" ) )
 *                     .PaneBorder( false )
 *                     .MinSize( FromDIP( wxSize( 180, 60 ) ) )
 *                     .BestSize( FromDIP( wxSize( 180, 100 ) ) )
 *                     ...
 *
 * **It does not span the window.** There is no `.Layer()` call, so it takes the
 * default layer 0, and wxAUI nests docks outward by layer: layer 0 is the
 * innermost ring around the centre pane, and layers 1-3 then 4-6 wrap it. The
 * panes it has to clear are all outside it —
 *
 *   | pane        | dock   | layer | where                   |
 *   |-------------|--------|-------|-------------------------|
 *   | Search      | Bottom |   0   | sch_edit_frame.cpp:292  |
 *   | LeftToolbar | Left   |   2   | sch_edit_frame.cpp:281  |
 *   | left panes  | Left   |   3   | eeschema_settings.cpp   |
 *   | MsgPanel    | Bottom |   6   | sch_edit_frame.cpp:257  |
 *
 * — so the Search pane is as wide as the CANVAS COLUMN, with the left dock and
 * both toolbars running full height past it, and the message panel below all of
 * them at the full width of the frame.
 *
 * Ours rendered it as the first pane of the left column instead.
 */
export const SCH_BOTTOM_DOCK = {
  /* [data] `.BestSize( FromDIP( wxSize( 180, 100 ) ) )`, sch_edit_frame.cpp:297
     — the height the dock opens at. KiCad hardcodes the pair itself. */
  bestHeight: 100,
  /* [data] `.MinSize( FromDIP( wxSize( 180, 60 ) ) )`, sch_edit_frame.cpp:296
     — how far the sash above it can be dragged down. */
  minHeight: 60,
} as const;

applyMixins(SCH_EDIT_FRAME, [
  SCH_UNDO_REDO_MIXIN,
  SCH_DESIGN_BLOCK_UTILS_MIXIN,
  SCH_FILES_IO_MIXIN,
  SCH_ANNOTATE_MIXIN,
  SCH_NETLIST_GENERATOR_MIXIN,
  SCH_SHEET_MIXIN,
]);

/**
 * `SCH_EDIT_FRAME::updateTitle` (eeschema/sch_edit_frame.cpp:1819-1862).
 *
 * The frame title is per-frame upstream — each editor has its own
 * `updateTitle()` — but the SHAPE of it is not: star, document, suffixes, em
 * dash, frame name is `docs/frame-titles.md`'s twelve-of-thirteen rule, and
 * `frameTitle()` in `ui/useDocumentTitle.ts` is where that shape lives. This
 * is only the schematic's own three decisions on top of it, and it states
 * nothing the shared function already states.
 *
 * The C++, in full:
 *
 *     wxFileName fn( Prj().AbsolutePath( screen->GetFileName() ) );
 *     if( IsContentModified() ) title = wxT( "*" );
 *     title += fn.GetName();
 *     wxString sheetPath = GetCurrentSheet().PathHumanReadable( false, true );
 *     if( sheetPath != fn.GetName() )
 *         title += wxString::Format( wxT( " [%s]" ), sheetPath );
 *     if( readOnly ) title += wxS( " " ) + _( "[Read Only]" );
 *     if( unsaved )  title += wxS( " " ) + _( "[Unsaved]" );
 *     ...
 *     title = _( "[no schematic loaded]" );      // the else branch
 *     title += wxT( " — " ) + _( "Schematic Editor" );
 *
 * Three things that are easy to get wrong and were each wrong here:
 *
 *  - The document half is **the current SCREEN's file name**, not the project
 *    name. Descend into a sub-sheet and the title names the sub-sheet's file.
 *  - `wxFileName::GetName()` drops the extension, so it is `ecc83`, never
 *    `ecc83.kicad_sch`.
 *  - The sheet-path bracket is **suppressed at the root**, because
 *    `PathHumanReadable( false, ... )` seeds the path with the root screen's
 *    own `GetName()` — so on the root sheet the two strings are equal and the
 *    comparison at `:1846` fails. A bracket that showed `[ecc83]` on the root
 *    sheet would be wrong in the one place the title is seen most.
 */

/** `_( "Schematic Editor" )`, the half after the dash. */
export const SCH_FRAME_NAME = 'Schematic Editor';

/** `_( "[no schematic loaded]" )` — sch_edit_frame.cpp:1856. */
export const SCH_NO_DOCUMENT = '[no schematic loaded]';

/**
 * `SCH_SHEET_PATH::PathHumanReadable( false, true )`
 * (eeschema/sch_sheet_path.cpp), for the two arguments `updateTitle` passes.
 *
 * `aUseShortRootName = false` seeds the string with the ROOT screen's file name
 * without its extension rather than with a bare `"/"`; every sheet below the
 * root then contributes its **sheet name** (not its file name) and a `"/"`; and
 * `aStripTrailingSeparator = true` removes the final separator.
 *
 * So the root sheet of `ecc83.kicad_sch` is `"ecc83"`, and a sheet named
 * `Power` beneath it is `"ecc83/Power"`.
 *
 * @param rootFileBase the root screen's file name with the extension already
 *   dropped — `wxFileName( … ).GetName()` of `at( 0 )->GetScreen()`.
 * @param sheetNames the sheet names from the root's child down to the current
 *   sheet, in order. Empty at the root.
 */
export function pathHumanReadable(rootFileBase: string, sheetNames: readonly string[]): string {
  const parts = [rootFileBase, ...sheetNames];
  // `s << sheetName << "/"` for each, then strip the one trailing separator —
  // which is the same string as joining on "/".
  return parts.join('/');
}

export interface SchFrameTitleSpec {
  /**
   * The CURRENT sheet's file name, extension included or not — this function
   * drops it, the way `wxFileName::GetName()` does. Null/empty is the
   * `[no schematic loaded]` branch.
   */
  fileName?: string | null;
  /** `PathHumanReadable( false, true )` for the current sheet. */
  sheetPath?: string;
  /** `IsContentModified()`. */
  modified?: boolean;
  /**
   * `screen->IsReadOnly()`. There is no `[Unsaved]` counterpart here: upstream
   * sets it from `!screen->FileExists()`, and a document in this app exists in
   * the store from the moment it is opened, so the flag would never be true.
   */
  readOnly?: boolean;
}

/** `wxFileName::GetName()` — the base name without its last extension. */
export function fileBaseName(fileName: string): string {
  // A leading dot is not an extension and neither is a dot in a directory
  // component, the same two cases `frameTitleName` handles.
  return fileName.replace(/(?!^)\.[^./\\]*$/, '');
}

export function schFrameTitle(spec: SchFrameTitleSpec): FrameTitleParts {
  const raw = spec.fileName?.trim() ?? '';

  if (raw === '') {
    return frameTitle({
      frameName: SCH_FRAME_NAME,
      document: null,
      placeholder: SCH_NO_DOCUMENT,
      modified: spec.modified,
    });
  }

  const base = fileBaseName(raw);
  // `if( sheetPath != fn.GetName() ) title += " [" + sheetPath + "]"` — equal
  // on the root sheet, so the root carries no bracket.
  const path = spec.sheetPath?.trim() ?? '';
  const document = path !== '' && path !== base ? `${base} [${path}]` : base;

  return frameTitle({
    frameName: SCH_FRAME_NAME,
    document,
    modified: spec.modified,
    suffixes: spec.readOnly ? [READ_ONLY_SUFFIX] : [],
  });
}
