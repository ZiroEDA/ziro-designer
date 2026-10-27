// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDIT_FRAME` (eeschema/symbol_editor/symbol_edit_frame.h), on
 * `SCH_BASE_FRAME` — so far its KIWAY half: the mail it takes in. `SymbolEditor.tsx` is the window
 * and owns the library tree and canvas each command changes, so the frame
 * reaches them through {@link SYMBOL_EDIT_FRAME_HOOKS}.
 */
import type { LIB_SYMBOL } from '../lib_symbol.js';
import { ACTION_CONDITIONS } from '@ziroeda/common/tool/action_manager.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { EDITOR_CONDITIONS } from '@ziroeda/common/tool/editor_conditions.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import {
  type SELECTION_CONDITION,
  SELECTION_CONDITIONS,
} from '@ziroeda/common/tool/selection_conditions.js';
import { COMMON_CONTROL } from '@ziroeda/common/tool/common_control.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import { EMBED_TOOL } from '@ziroeda/common/tool/embed_tool.js';
import { PICKER_TOOL } from '@ziroeda/common/tool/picker_tool.js';
import { PROPERTIES_TOOL } from '@ziroeda/common/tool/properties_tool.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import { RSTRING_T } from '@ziroeda/common/project.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import {
  ENVVARS_CHANGED,
  type TOOLS_HOLDER_INPUT_SETTINGS,
} from '@ziroeda/common/tool/tools_holder.js';
import type { BASE_SCREEN } from '@ziroeda/common/base_screen.js';
import type { wxEvent } from '@ziroeda/wx/wx_event.js';
import { SymbolLibAdapter } from '../project_sch.js';
import { SCH_SCREEN } from '../sch_screen.js';
import { SCH_ACTIONS } from '../tools/sch_actions.js';
import { SCH_FIND_REPLACE_TOOL } from '../tools/sch_find_replace_tool.js';
import { SCH_INSPECTION_TOOL } from '../tools/sch_inspection_tool.js';
import { SCH_POINT_EDITOR } from '../tools/sch_point_editor.js';
import { SCH_SELECTION_TOOL } from '../tools/sch_selection_tool.js';
import { SYMBOL_EDITOR_EDIT_TOOL } from '../tools/symbol_editor_edit_tool.js';
import { SYMBOL_EDITOR_CONTROL } from '../tools/symbol_editor_control.js';
import { SYMBOL_EDITOR_PIN_TOOL } from '../tools/symbol_editor_pin_tool.js';
import { SYMBOL_EDITOR_DRAWING_TOOLS } from '../tools/symbol_editor_drawing_tools.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import { wxID_CANCEL } from '@ziroeda/wx/menu.js';
import { SYMBOL_EDITOR_MOVE_TOOL } from '../tools/symbol_editor_move_tool.js';
import { LIBRARY_EDITOR_CONTROL } from '@ziroeda/common/tool/library_editor_control.js';
import { LIB_SYMBOL_LIBRARY_MANAGER } from './lib_symbol_library_manager.js';
import { wxCopyFile, wxFileExists, wxRemoveFile } from '@ziroeda/wx/filefn.js';
import { niluuid, type KIID } from '@ziroeda/common/kiid.js';
import {
  DisplayErrorMessage,
  ShowKicadMessageDialog,
  type UnsavedChangesResult,
} from '@ziroeda/common/confirm.js';
import {
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { NormalizePath } from '@ziroeda/common/env_paths.js';
import {
  GetUseGlobalTable,
  MakeFileDlgHookNewLibrary,
} from '@ziroeda/common/widgets/filedlg_hook_new_library.js';
import {
  KiCadSymbolLibFileExtension,
  kicadSymbolLibWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import type { ChooserFilter } from '@ziroeda/wx/filedlg.js';
import { wxICON_ERROR, wxOK } from '@ziroeda/wx/defs.js';
import { SCH_IO_MGR } from '../sch_io/sch_io_mgr.js';
import type { wxFileDialogCustomizeHook } from '@ziroeda/common/widgets/filedlg_hook_new_library.js';
import { SYMBOL_EDITOR_UNDO_REDO_MIXIN } from './symbol_editor_undo_redo.js';
import { SYMBOL_EDITOR_FILES_MIXIN, SYMBOL_EDITOR_MIXIN } from './symbol_editor.js';
import { SYMBOL_EDITOR_IMPORT_EXPORT_MIXIN } from './symbol_editor_import_export.js';
import { SYMBOL_EDITOR_PLOTTER_MIXIN } from './symbol_editor_plotter.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { SCH_FIELD } from '../sch_field.js';
import type { SCH_ITEM } from '../sch_item.js';
import { SYMBOL_ORIENTATION_T } from '../symbol.js';
import {
  currentSymbolEditorSettings,
  storeSymbolEditorKifaceSettings,
  symbolEditorKifaceSettings,
  type SymbolEditorSettings,
} from './symbol_editor_settings.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { LIB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { UNDO_REDO_LIST } from '@ziroeda/common/eda_base_frame.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SCH_BASE_FRAME } from '../sch_base_frame.js';

export interface SYMBOL_EDIT_FRAME_HOOKS {
  /**
   * `m_auimgr.GetPane( m_treePane ).Show( aShow ); m_auimgr.Update()`: the tree pane shown or
   * hidden directly, not as a user toggle (LoadSymbolFromSchematic's auto-hide).
   */
  showLibraryTreePane?(aShow: boolean): void;
  /** The tool stack moved: the window's toolbar re-reads `IsCurrentTool` (upstream's update-UI). */
  toolStackChanged?(): void;
  /**
   * `UnsavedChangesDialog( this, aMessage, aApplyToAll )`: Save / Discard / Cancel. With
   * \a aApplyToAll the dialog shows its "apply to all" box and reports it there.
   */
  unsavedChangesDialog?(
    aMessage: string,
    aApplyToAll?: { value: boolean },
  ): Promise<UnsavedChangesResult>;
  /**
   * `wxFileDialog( this, aTitle, aDefaultDir, aDefaultFile, aWildcard, aStyle )` with its
   * customize hook, then `GetPath()`. Null is wxID_CANCEL.
   */
  fileDialog?(
    aTitle: string,
    aDefaultDir: string,
    aDefaultFile: string,
    aWildcard: ChooserFilter | readonly ChooserFilter[],
    aStyle: number,
    aCustomizeHook?: wxFileDialogCustomizeHook,
  ): Promise<string | null>;
  /** {@link SCH_BASE_FRAME.AskLibraryName}: a new library's name, the hook's controls beside it. */
  askLibraryName?(
    aTitle: string,
    aDefaultName: string,
    aHook?: wxFileDialogCustomizeHook,
  ): Promise<string | null>;
  /** {@link SCH_BASE_FRAME.ChooseLocalLibraryFile}: a library file off the computer. */
  chooseLocalLibraryFile?(
    aTitle: string,
    aWildcard: string | readonly ChooserFilter[],
    aHook?: wxFileDialogCustomizeHook,
  ): Promise<{ name: string; text: string } | null>;
  /** `SyncLibraries( aShowProgress, aPreloadCancelled, aForceRefresh )`: the tree rebuilt. */
  syncLibraries?(aShowProgress: boolean, aPreloadCancelled: boolean, aForceRefresh: string): void;
  /** `m_treePane->GetLibTree()->RefreshLibTree()`. */
  refreshLibTree?(): void;
  /** `GetLibTree()->GetSelectedLibIds( aSelection )`: every symbol / library selected. */
  getSelectedLibIds?(): LIB_ID[];
  /** `ReCreateMenuBar()` / `RecreateToolbars()`: the window's menu and toolbars rebuilt. */
  reCreateMenuBar?(): void;
  recreateToolbars?(): void;
  /** `FreezeLibraryTree()` / `ThawLibraryTree()`. */
  freezeLibraryTree?(): void;
  thawLibraryTree?(): void;
  /** `IsLibraryTreeShown()`. */
  isLibraryTreeShown?(): boolean;
  /** `m_auimgr.GetPane( PropertiesPaneName() ).IsShown()`. */
  isPropertiesShown?(): boolean;
  /** `ToggleLibraryTree()`. */
  toggleLibraryTree?(): void;
  /** `FocusOnLibId( aLibID )`: the library tree selects and shows it. */
  focusOnLibId?(aLibId: LIB_ID): void;
  /** `GetLibTree()->SelectLibId( aLibId )`: the tree selects it, its library expanded. */
  libTreeSelectLibId?(aLibId: LIB_ID): void;
  /** `GetLibTree()->ExpandLibId( aLibId )`: the node itself expanded. */
  libTreeExpandLibId?(aLibId: LIB_ID): void;
  /** `GetLibTree()->CenterLibId( aLibId )`: the node scrolled to the middle of the tree. */
  libTreeCenterLibId?(aLibId: LIB_ID): void;
  /** `GetLibTree()->Unselect()`. */
  libTreeUnselect?(): void;
  /** `RebuildSymbolUnitAndBodyStyleLists()`: the unit and body style choosers. */
  rebuildSymbolUnitAndBodyStyleLists?(): void;
  /** `UpdateTitle()`. */
  updateTitle?(): void;
  /** The window's dialogs by class name (DIALOG_PIN_PROPERTIES, ...): wxID_OK / wxID_CANCEL. */
  showModal?(aDialog: string, aItems: readonly EDA_ITEM[], aArg?: unknown): Promise<number>;
  /** `KIDIALOG( frame, ... ).ShowModal()`. */
  askKiDialog?(aRequest: KiDialogRequest): Promise<KiDialogResult>;
  /**
   * `GetLibTree()->GetSelectedLibId( aUnit )`: the symbol the library tree has selected, and in
   * \a aUnit the unit node's unit (0 for a symbol or library node).
   */
  getTreeLibId?(aUnit?: { value: number }): LIB_ID | null;
  /** `UpdateLibraryTree( aTreeItem, aSymbol )`: the tree node shows the symbol's new name/text. */
  updateLibraryTree?(aLibId: LIB_ID, aSymbol: LIB_SYMBOL): void;
  /** `ToggleProperties()`: the properties pane shown or hidden, its width remembered. */
  toggleProperties?(): void;
  /**
   * A generated output (SVGPlotSymbol's file): downloaded, like every plot, instead of written
   * where a wxFD_SAVE picker would have put it.
   */
  writeOutputFile?(aPath: string, aBytes: Uint8Array, aMime: string): void;
}

/** `UNITS_ALL` / `DEMORGAN_ALL` (symbol_edit_frame.h:45-46): the pin table's "every unit / style". */
export const UNITS_ALL = 'ALL';
export const DEMORGAN_ALL = 'ALL';
/** `DEMORGAN_STD` / `DEMORGAN_ALT` (symbol_edit_frame.h:47-48). */
export const DEMORGAN_STD = 'Standard';
export const DEMORGAN_ALT = 'Alternate';

/** `FocusOnItem`'s `static KIID lastBrightenedItemID`: the item it brightened last. */
let s_lastBrightenedItemID: KIID = niluuid;

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (see libs/core/mixins.ts)
export interface SYMBOL_EDIT_FRAME
  extends SYMBOL_EDITOR_UNDO_REDO_MIXIN,
    SYMBOL_EDITOR_MIXIN,
    SYMBOL_EDITOR_FILES_MIXIN,
    SYMBOL_EDITOR_IMPORT_EXPORT_MIXIN,
    SYMBOL_EDITOR_PLOTTER_MIXIN {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (see libs/core/mixins.ts)
export class SYMBOL_EDIT_FRAME extends SCH_BASE_FRAME {
  /** `Kiface().KifaceSettings()`: SYMBOL_EDITOR_SETTINGS. */
  override config(): APP_SETTINGS_BASE | null {
    return symbolEditorKifaceSettings();
  }

  /**
   * `LoadSettings( aCfg )` (:327): the canvas and units, then libeditconfig()'s display options into
   * the render settings.
   */
  override LoadSettings(aCfg: APP_SETTINGS_BASE): void {
    super.LoadSettings(aCfg);

    const settings = this.libeditconfig();
    const renderSettings = this.GetRenderSettings();

    // wxCHECK_RET( m_settings, ... )
    if (!settings || !renderSettings) return;

    renderSettings.m_ShowPinsElectricalType = settings.show_pin_electrical_type;
    renderSettings.m_ShowHiddenPins = settings.show_hidden_lib_pins;
    renderSettings.m_ShowHiddenFields = settings.show_hidden_lib_fields;
    renderSettings.m_ShowPinAltIcons = settings.show_pin_alt_icons;
    renderSettings.SetDefaultFont('');
  }

  /**
   * `GetDocumentExtents( aIncludeAllVisible )` (:1674): what Zoom to Fit fits - the symbol's unit
   * as drawn, or a reasonable drawing area with no symbol.
   */
  override GetDocumentExtents(_aIncludeAllVisible = true): BOX2I {
    if (!this.m_symbol) {
      // Gives a reasonable drawing area size
      const width = schIUScale.mmToIU(50);
      const height = schIUScale.mmToIU(30);

      return new BOX2I({ x: -width / 2, y: -height / 2 }, { x: width, y: height });
    }

    return this.m_symbol.Flatten().GetUnitBoundingBox(this.m_unit, this.m_bodyStyle);
  }

  /**
   * `CommonSettingsChanged( aFlags )` (:1558): SCH_BASE_FRAME's - the colour theme into the
   * painter - then the symbol editor's display options and window settings, the symbol's caches,
   * and the canvas redrawn. The toolbars are the window's, rebuilt by its next render.
   */
  override CommonSettingsChanged(aFlags = 0, aInput?: TOOLS_HOLDER_INPUT_SETTINGS): void {
    super.CommonSettingsChanged(aFlags, aInput);

    const cfg = this.libeditconfig();
    const renderSettings = this.GetRenderSettings();

    if (cfg && renderSettings) {
      renderSettings.m_ShowPinsElectricalType = cfg.show_pin_electrical_type;
      renderSettings.m_ShowHiddenPins = cfg.show_hidden_lib_pins;
      renderSettings.m_ShowHiddenFields = cfg.show_hidden_lib_fields;
      renderSettings.m_ShowPinAltIcons = cfg.show_pin_alt_icons;

      this.GetGalDisplayOptions().ReadWindowSettings(symbolEditorKifaceSettings().m_Window);
    }

    this.m_symbol?.ClearCaches();

    const canvas = this.GetCanvas();

    if (canvas) {
      canvas.ForceRefresh();
      canvas.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
      canvas.Refresh();
    }

    this.RecreateToolbars();

    if (aFlags & ENVVARS_CHANGED) this.SyncLibraries(true);
  }

  /**
   * The frame's idle pass after a canvas event or a command, and what a tool changed in config()
   * (COMMON_TOOLS' current grid, say) saved, as the settings manager does.
   */
  override OnIdle(): void {
    super.OnIdle();
    storeSymbolEditorKifaceSettings(symbolEditorKifaceSettings());
  }

  private readonly hooks: SYMBOL_EDIT_FRAME_HOOKS;

  /** `m_libMgr`: the library buffers the editor works on. */
  private readonly m_libMgr: LIB_SYMBOL_LIBRARY_MANAGER;
  /**
   * `m_dummyScreen`: the screen shown when no symbol is loaded. Public for the frame's mixins
   * (symbol_editor.ts), which are this class split across files.
   */
  readonly m_dummyScreen = new SCH_SCREEN();
  /** `m_SyncPinEdit`: pins of interchangeable units are edited together. */
  m_SyncPinEdit = false;

  constructor(hooks: SYMBOL_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_SCH_SYMBOL_EDITOR);
    this.hooks = hooks;
    this.m_libMgr = new LIB_SYMBOL_LIBRARY_MANAGER(this);
    this.SetScreen(this.m_dummyScreen);

    // A symbol library dropped on the frame is added to the project (symbol_edit_frame.cpp:280).
    this.m_acceptedExts.set(KiCadSymbolLibFileExtension, ACTIONS.ddAddLibrary);
  }

  /** `FocusOnLibId( aLibID )` (:1490). */
  FocusOnLibId(aLibId: LIB_ID): void {
    this.hooks.focusOnLibId?.(aLibId);
  }

  /** `RebuildSymbolUnitAndBodyStyleLists()` (:735): the window's choosers. */
  RebuildSymbolUnitAndBodyStyleLists(): void {
    this.hooks.rebuildSymbolUnitAndBodyStyleLists?.();
  }

  /** `UpdateTitle()`. */
  UpdateTitle(): void {
    this.hooks.updateTitle?.();
  }

  /** `SynchronizePins()` (:1174): pins of interchangeable units are edited together. */
  SynchronizePins(): boolean {
    return (
      this.m_SyncPinEdit &&
      !!this.m_symbol &&
      this.m_symbol.IsMultiUnit() &&
      !this.m_symbol.UnitsLocked()
    );
  }

  /** The window's half of the dialogs the symbol editor opens; with no window, cancelled. */
  override ShowModalDialog(
    aDialog: string,
    aItems: readonly EDA_ITEM[],
    aArg?: unknown,
  ): Promise<number> {
    return this.hooks.showModal?.(aDialog, aItems, aArg) ?? Promise.resolve(wxID_CANCEL);
  }

  /** `KIDIALOG( this, ... ).ShowModal()`; with no window, cancelled. */
  ShowKiDialog(aRequest: KiDialogRequest): Promise<KiDialogResult> {
    return this.hooks.askKiDialog?.(aRequest) ?? Promise.resolve('cancel');
  }

  /**
   * `GetTreeLIBID( aUnit )` (symbol_edit_frame.cpp:1328): the library tree's selection. The tree is
   * the window's; with none, an empty LIB_ID.
   */
  GetTreeLIBID(aUnit?: { value: number }): LIB_ID {
    return this.hooks.getTreeLibId?.(aUnit) ?? new LIB_ID();
  }

  /**
   * `GetTargetLibId()` (symbol_edit_frame.cpp:1359): the tree's selection when the tree is shown,
   * else (or when it names no library) the loaded symbol's.
   */
  override GetTargetLibId(): LIB_ID {
    let id = new LIB_ID();

    if (this.IsLibraryTreeShown()) id = this.GetTreeLIBID();

    if (id.GetLibNickname() === '' && this.m_symbol) id = this.m_symbol.GetLibId();

    return id;
  }

  /** `ToggleProperties()` (:790): the window's AUI pane. */
  override ToggleProperties(): void {
    this.hooks.toggleProperties?.();
  }

  /** `GetTreeLIBIDs( aSelection )` (:1339): the tree's selection, how many. */
  GetTreeLIBIDs(aSelection: LIB_ID[]): number {
    aSelection.push(...(this.hooks.getSelectedLibIds?.() ?? []));
    return aSelection.length;
  }

  /** `GetSelectedLibIds()` (:1373). */
  GetSelectedLibIds(): LIB_ID[] {
    const ids: LIB_ID[] = [];
    this.GetTreeLIBIDs(ids);
    return ids;
  }

  /** `GetTreeSelectionCount()` (:1334). */
  GetTreeSelectionCount(): number {
    return this.hooks.getSelectedLibIds?.().length ?? 0;
  }

  /**
   * `IsCurrentSymbol( aLibId )` (:1536): whether \a aLibId is the symbol shown - an alias by its
   * root.
   */
  IsCurrentSymbol(aLibId: LIB_ID): boolean {
    // This will return the root symbol of any alias
    const symbol = this.m_libMgr.GetBufferedSymbol(
      aLibId.GetLibItemName(),
      aLibId.GetLibNickname(),
    );

    // Now we can compare the libId of the current symbol and the root symbol
    return !!symbol && !!this.m_symbol && symbol.GetLibId().equals(this.m_symbol.GetLibId());
  }

  /** `RefreshLibraryTree()` (:1484): `GetLibTree()->RefreshLibTree()`, the window's tree. */
  RefreshLibraryTree(): void {
    this.hooks.refreshLibTree?.();
  }

  /** `UpdateLibraryTree( aTreeItem, aSymbol )`: the window's tree. */
  UpdateLibraryTree(aLibId: LIB_ID, aSymbol: LIB_SYMBOL): void {
    this.hooks.updateLibraryTree?.(aLibId, aSymbol);
  }

  /** `m_schematicSymbolUUID`: the schematic symbol a symbol from the schematic came from. */
  m_schematicSymbolUUID: KIID = niluuid;

  /**
   * `UnsavedChangesDialog( this, aMessage, aApplyToAll )` (common/confirm.cpp): the window's;
   * with none the answer is Cancel, the one that loses nothing.
   */
  UnsavedChangesDialog(
    aMessage: string,
    aApplyToAll?: { value: boolean },
  ): Promise<UnsavedChangesResult> {
    return this.hooks.unsavedChangesDialog?.(aMessage, aApplyToAll) ?? Promise.resolve('cancel');
  }

  /** EDA_DRAW_FRAME's `wxFileDialog`: the same picker as {@link FileDialog}. */
  override ShowFileDialog(
    aTitle: string,
    aDefaultDir: string,
    aDefaultFile: string,
    aWildcard: string | readonly ChooserFilter[],
    aStyle: number,
    aCustomizeHook?: wxFileDialogCustomizeHook,
  ): Promise<string | null> {
    return this.FileDialog(
      aTitle,
      aDefaultDir,
      aDefaultFile,
      typeof aWildcard === 'string' ? [] : aWildcard,
      aStyle,
      aCustomizeHook,
    );
  }

  override AskLibraryName(
    aTitle: string,
    aDefaultName: string,
    aHook?: wxFileDialogCustomizeHook,
  ): Promise<string | null> {
    return this.hooks.askLibraryName?.(aTitle, aDefaultName, aHook) ?? Promise.resolve(null);
  }

  override ChooseLocalLibraryFile(
    aTitle: string,
    aWildcard: string | readonly ChooserFilter[],
    aHook?: wxFileDialogCustomizeHook,
  ): Promise<{ name: string; text: string } | null> {
    return this.hooks.chooseLocalLibraryFile?.(aTitle, aWildcard, aHook) ?? Promise.resolve(null);
  }

  /** A generated output, handed to the window to download. */
  override WriteOutputFile(aPath: string, aBytes: Uint8Array, aMime: string): void {
    this.hooks.writeOutputFile?.(aPath, aBytes, aMime);
  }

  /** `wxFileDialog( ... ).ShowModal()` then `GetPath()`: the window's; null is Cancel. */
  FileDialog(
    aTitle: string,
    aDefaultDir: string,
    aDefaultFile: string,
    aWildcard: ChooserFilter | readonly ChooserFilter[],
    aStyle: number,
    aCustomizeHook?: wxFileDialogCustomizeHook,
  ): Promise<string | null> {
    return (
      this.hooks.fileDialog?.(
        aTitle,
        aDefaultDir,
        aDefaultFile,
        aWildcard,
        aStyle,
        aCustomizeHook,
      ) ?? Promise.resolve(null)
    );
  }

  /**
   * `Kiway().Player( FRAME_SCH, false )->SaveSymbolToSchematic( aSymbol, aUuid )`: false when no
   * schematic editor is open to take it.
   */
  SaveSymbolToSchematic(aSymbol: LIB_SYMBOL, aSchematicSymbolUUID: KIID): boolean {
    const schframe = this.Kiway()?.GetPlayerFrame(FRAME_T.FRAME_SCH) as {
      SaveSymbolToSchematic(aSymbol: LIB_SYMBOL, aUuid: KIID): void;
    } | null;

    // happens when the schematic editor has been closed
    if (!schframe) return false;

    schframe.SaveSymbolToSchematic(aSymbol, aSchematicSymbolUUID);
    return true;
  }

  /**
   * `getTargetSymbol()` (symbol_edit_frame.cpp:1345): the symbol selected in the tree when it is
   * shown, else the one being edited.
   */
  getTargetSymbol(): LIB_SYMBOL | null {
    if (this.IsLibraryTreeShown()) {
      const libId = this.GetTreeLIBID();

      if (libId.IsValid())
        return this.m_libMgr.GetSymbol(libId.GetLibItemName(), libId.GetLibNickname());
    }

    return this.m_symbol;
  }

  /**
   * `AddLibraryFile( aCreateNew )` (symbol_edit_frame.cpp:1180): a library file chosen - or a new
   * one made - and added to the global or project table; its full path, or empty.
   */
  async AddLibraryFile(aCreateNew: boolean): Promise<string> {
    const fn = { value: this.m_libMgr.GetUniqueLibraryName() };
    const tableChooser = MakeFileDlgHookNewLibrary(true);

    if (
      !(await this.LibraryFileBrowser(
        aCreateNew ? 'New Symbol Library' : 'Add Symbol Library',
        !aCreateNew,
        fn,
        [kicadSymbolLibWildcard()],
        KiCadSymbolLibFileExtension,
        false,
        Pgm().GetSettingsManager().IsProjectOpenNotDummy() ? tableChooser : undefined,
      ))
    ) {
      return '';
    }

    const scope = GetUseGlobalTable(tableChooser)
      ? LIBRARY_TABLE_SCOPE.GLOBAL
      : LIBRARY_TABLE_SCOPE.PROJECT;

    const manager = Pgm().GetLibraryManager();

    if (!manager.Table(LIBRARY_TABLE_TYPE.SYMBOL, scope)) return ''; // wxCHECK

    // fn.GetName()
    const leaf = fn.value.slice(fn.value.lastIndexOf('/') + 1);
    const libName = leaf.includes('.') ? leaf.slice(0, leaf.lastIndexOf('.')) : leaf;

    if (libName === '') return '';

    const adapter = SymbolLibAdapter(this.Prj());

    if (adapter.HasLibrary(libName)) {
      DisplayErrorMessage(`Library '${libName}' already exists.`);
      return '';
    }

    if (aCreateNew) {
      // The file browser already asked to overwrite, so drop the old file here.
      // CreateLibrary fails on an existing path.
      if (wxFileExists(fn.value) && !wxRemoveFile(fn.value)) {
        DisplayErrorMessage(
          `Could not overwrite the library file '${fn.value}'.\n` +
            'Make sure you have write permissions and try again.',
        );
        return '';
      }

      if (!this.m_libMgr.CreateLibrary(fn.value, scope)) {
        DisplayErrorMessage(
          `Could not create the library file '${fn.value}'.\n` +
            'Make sure you have write permissions and try again.',
        );
        return '';
      }
    } else {
      if (!this.m_libMgr.AddLibrary(fn.value, scope)) {
        DisplayErrorMessage('Could not open the library file.');
        return '';
      }
    }

    let success = true;

    // Tables are reinitialized by m_libMgr->AddLibrary(). So reinit table reference.
    const table = manager.Table(LIBRARY_TABLE_TYPE.SYMBOL, scope);

    if (!table) return ''; // wxCHECK

    const result = table.Save();

    if (!result.ok) {
      await ShowKicadMessageDialog({
        message: 'Error saving library table.',
        caption: 'File Save Error',
        style: wxOK | wxICON_ERROR,
        extended: result.error.message,
      });
      success = false;
    }

    if (success) adapter.LoadOne(libName);

    this.SyncLibraries(false);
    this.SetCurLib(libName);

    // GetLibTree()->SelectLibId( libId ); GetLibTree()->CenterLibId( libId ): the window's tree.
    this.FocusOnLibId(new LIB_ID(libName, ''));

    return fn.value;
  }

  /**
   * `DdAddLibrary( aLibFile )` (symbol_edit_frame.cpp:1280-1325): a dropped library file added to
   * the project table under its own name, the table saved, the library read, and both the library
   * list and the editor told (MAIL_RELOAD_LIB, MAIL_LIB_EDIT).
   */
  async DdAddLibrary(aLibFile: string): Promise<void> {
    // wxFileName( aLibFile ).GetName()
    const leaf = aLibFile.slice(aLibFile.lastIndexOf('/') + 1);
    const libName = leaf.includes('.') ? leaf.slice(0, leaf.lastIndexOf('.')) : leaf;

    if (libName === '') return;

    const manager = Pgm().GetLibraryManager();
    const adapter = SymbolLibAdapter(this.Prj());

    if (adapter.HasLibrary(libName)) {
      DisplayErrorMessage(`Library '${libName}' already exists.`);
      return;
    }

    if (!this.m_libMgr.AddLibrary(aLibFile, LIBRARY_TABLE_SCOPE.PROJECT)) {
      DisplayErrorMessage('Could not open the library file.');
      return;
    }

    const table = manager.Table(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.PROJECT);

    if (!table) return; // wxCHECK

    let success = true;
    const result = table.Save();

    if (!result.ok) {
      await ShowKicadMessageDialog({
        message: 'Error saving library table.',
        caption: 'File Save Error',
        style: wxOK | wxICON_ERROR,
        extended: result.error.message,
      });
      success = false;
    }

    if (success) adapter.LoadOne(libName);

    const packet = { value: aLibFile };
    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_SCH_SYMBOL_EDITOR,
      MAIL_T.MAIL_RELOAD_LIB,
      packet,
      this,
    );
    this.Kiway()?.ExpressMail(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, MAIL_T.MAIL_LIB_EDIT, packet, this);
  }

  /** `getTargetLib()` (symbol_edit_frame.cpp:1381). */
  getTargetLib(): string {
    return this.GetTargetLibId().GetLibNickname();
  }

  /**
   * `backupFile( aOriginalFile, aBackupExt )` (symbol_edit_frame.cpp:1507): copy the file beside
   * itself under \a aBackupExt before it is overwritten.
   */
  backupFile(aOriginalFile: string, aBackupExt: string): boolean {
    if (wxFileExists(aOriginalFile)) {
      // wxFileName backupFileName( aOriginalFile ); backupFileName.SetExt( aBackupExt );
      const dot = aOriginalFile.lastIndexOf('.');
      const slash = aOriginalFile.lastIndexOf('/');
      const stem = dot > slash ? aOriginalFile.slice(0, dot) : aOriginalFile;
      const backupFileName = `${stem}.${aBackupExt}`;

      if (wxFileExists(backupFileName)) wxRemoveFile(backupFileName);

      if (!wxCopyFile(aOriginalFile, backupFileName)) {
        DisplayErrorMessage(`Failed to save backup to '${backupFileName}'.`);
        return false;
      }
    }

    return true;
  }

  /** `SyncLibraries( aShowProgress, aPreloadCancelled, aForceRefresh )` (:1387): the window's tree. */
  SyncLibraries(aShowProgress: boolean, aPreloadCancelled = false, aForceRefresh = ''): void {
    this.hooks.syncLibraries?.(aShowProgress, aPreloadCancelled, aForceRefresh);
  }

  /** `m_treePane->GetLibTree()->RefreshLibTree()`. */
  RefreshLibTree(): void {
    this.hooks.refreshLibTree?.();
  }

  /** `ReCreateMenuBar()`: the window's. */
  ReCreateMenuBar(): void {
    this.hooks.reCreateMenuBar?.();
  }

  /** `RecreateToolbars()`: the window's. */
  RecreateToolbars(): void {
    this.hooks.recreateToolbars?.();
  }

  FreezeLibraryTree(): void {
    this.hooks.freezeLibraryTree?.();
  }

  ThawLibraryTree(): void {
    this.hooks.thawLibraryTree?.();
  }

  /** `UpdateMsgPanel()` (symbol_edit_frame.h:262). */
  override UpdateMsgPanel(): void {
    this.UpdateSymbolMsgPanelInfo();
  }

  /**
   * `addLibTableEntry( aLibFile, aScope )` (symbol_edit_frame.cpp:2095): a row for \a aLibFile in
   * the scope's table, its nickname made unique, the table saved.
   */
  addLibTableEntry(aLibFile: string, aScope = LIBRARY_TABLE_SCOPE.GLOBAL): boolean {
    const leaf = aLibFile.slice(aLibFile.lastIndexOf('/') + 1);
    const fnName = leaf.includes('.') ? leaf.slice(0, leaf.lastIndexOf('.')) : leaf;
    let libNickname = fnName;
    const adapter = SymbolLibAdapter(this.Prj());
    const manager = Pgm().GetLibraryManager();
    const envVars = Pgm().GetLocalEnvVariables();

    if (adapter.HasLibrary(libNickname)) {
      let suffix = 1;

      while (adapter.HasLibrary(libNickname)) {
        libNickname = `${fnName}${suffix}`;
        suffix += 1;
      }
    }

    const table = manager.Table(LIBRARY_TABLE_TYPE.SYMBOL, aScope);

    if (!table) return false; // wxCHECK

    const row = table.InsertRow();

    row.SetNickname(libNickname);

    // We cannot normalize against the current project path when saving to global table.
    const normalizedPath = NormalizePath(
      aLibFile,
      envVars,
      aScope === LIBRARY_TABLE_SCOPE.PROJECT ? this.Prj().GetProjectPath() : '',
    );

    row.SetURI(normalizedPath);
    // Deviation, an upstream bug: the type is guessed from the file itself. Upstream guesses from
    // `normalizedPath`, and for the project table that is `${KIPRJMOD}/…`, which
    // CanReadLibrary's FileExists does not expand: the row gets "Unknown SCH_FILE_T value: 12"
    // and its library never loads.
    row.SetType(SCH_IO_MGR.ShowType(SCH_IO_MGR.GuessPluginTypeFromLibPath(aLibFile)));

    const result = table.Save();

    if (!result.ok) {
      void ShowKicadMessageDialog({
        message: 'Error saving library table.',
        caption: 'File Save Error',
        style: wxOK | wxICON_ERROR,
        extended: result.error.message,
      });

      return false;
    }

    // manager.ReloadTables( aScope, { SYMBOL } ): the table was edited in memory and is the
    // manager's own, so there is nothing to read back.
    adapter.LoadOne(libNickname);

    return true;
  }

  /**
   * `replaceLibTableEntry( aLibNickname, aLibFile )` (symbol_edit_frame.cpp:2156): point the
   * library's existing row, global first, at \a aLibFile.
   */
  replaceLibTableEntry(aLibNickname: string, aLibFile: string): boolean {
    const adapter = SymbolLibAdapter(this.Prj());
    const manager = Pgm().GetLibraryManager();
    let table = null;
    let scope = LIBRARY_TABLE_SCOPE.GLOBAL;

    // Check the global library table first because checking the project library table
    // checks the global library table as well due to library chaining.
    if (manager.GetRow(LIBRARY_TABLE_TYPE.SYMBOL, aLibNickname, scope)) {
      table = manager.Table(LIBRARY_TABLE_TYPE.SYMBOL, scope);
    } else {
      scope = LIBRARY_TABLE_SCOPE.PROJECT;

      if (manager.GetRow(LIBRARY_TABLE_TYPE.SYMBOL, aLibNickname, scope))
        table = manager.Table(LIBRARY_TABLE_TYPE.SYMBOL, scope);
    }

    if (!table) return false; // wxCHECK

    const row = manager.GetRow(LIBRARY_TABLE_TYPE.SYMBOL, aLibNickname, scope);

    if (!row) return false; // wxCHECK

    const envVars = Pgm().GetLocalEnvVariables();
    const projectPath = scope === LIBRARY_TABLE_SCOPE.PROJECT ? this.Prj().GetProjectPath() : '';
    const normalizedPath = NormalizePath(aLibFile, envVars, projectPath);

    row.SetURI(normalizedPath);
    row.SetType('KiCad');

    const result = table.Save();

    if (!result.ok) {
      void ShowKicadMessageDialog({
        message: 'Error saving library table.',
        caption: 'File Save Error',
        style: wxOK | wxICON_ERROR,
        extended: result.error.message,
      });

      return false;
    }

    adapter.LoadOne(aLibNickname);

    return true;
  }

  /** `GetLibManager()`. */
  GetLibManager(): LIB_SYMBOL_LIBRARY_MANAGER {
    return this.m_libMgr;
  }

  /**
   * `FocusOnItem( aItem, aAllowScroll )` (symbol_edit_frame.cpp:1691): the item brightened - and the
   * one brightened before it, a pin or a field of the symbol, dimmed again - its unit and body
   * style shown, and the view moved to it. Null clears the focus. The pin table's cross-probe asks
   * this when a row is selected.
   */
  override FocusOnItem(aItem: EDA_ITEM | null, aAllowScroll = true): void {
    let lastItem: SCH_ITEM | null = null;

    // nullptr will clear the current focus
    if (aItem !== null && !aItem.IsSCH_ITEM()) return;

    if (this.m_symbol) {
      for (const pin of this.m_symbol.GetGraphicalPins(0, 0)) {
        if (pin.m_Uuid === s_lastBrightenedItemID) lastItem = pin;
      }

      const fields: SCH_FIELD[] = [];
      this.m_symbol.GetFields(fields);

      for (const field of fields) {
        if (field.m_Uuid === s_lastBrightenedItemID) lastItem = field;
      }
    }

    if (lastItem && lastItem !== aItem) {
      lastItem.ClearBrightened();

      this.UpdateItem(lastItem);
      s_lastBrightenedItemID = niluuid;
    }

    if (aItem) {
      if (aItem.IsSCH_ITEM()) {
        const item = aItem as SCH_ITEM;
        const unit = item.GetUnit();

        if (unit) this.SetUnit(unit);

        const bodyStyle = item.GetBodyStyle();

        if (bodyStyle) this.SetBodyStyle(bodyStyle);
      }

      if (!aItem.IsBrightened()) {
        aItem.SetBrightened();

        this.UpdateItem(aItem);
        s_lastBrightenedItemID = aItem.m_Uuid;
      }

      const pos = aItem.GetFocusPosition();
      this.FocusOnLocation({ x: pos.x, y: pos.y }, aAllowScroll);
    }
  }

  /** `HasLibModifications()` (symbol_edit_frame.cpp:1912): a buffered library or symbol is dirty. */
  HasLibModifications(): boolean {
    // wxCHECK( m_libMgr, false )
    if (!this.m_libMgr) return false;

    return this.m_libMgr.HasModifications();
  }

  /** `GetCurrentSelection()` (symbol_edit_frame.cpp:1970): the selection tool's. */
  override GetCurrentSelection(): SELECTION {
    return this.m_toolManager!.GetTool(SCH_SELECTION_TOOL)!.GetSelection();
  }

  /** `setupTools()` (symbol_edit_frame.cpp:413-446), with the tools ported so far. */
  setupTools(): void {
    const canvas = this.GetCanvas()!;

    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(
      this.GetScreen(),
      canvas.GetView(),
      canvas.GetViewControls(),
      this.config(),
      this,
    );
    // The frame's wxEVT_IDLE follows each canvas event: a page has no idle event of its own.
    const frame = this;
    this.m_toolDispatcher = new (class extends TOOL_DISPATCHER {
      override DispatchWxEvent(aEvent: wxEvent): void {
        super.DispatchWxEvent(aEvent);
        frame.OnIdle();
      }
    })(this.m_toolManager);

    // Register tools
    this.m_toolManager.RegisterTool(new COMMON_CONTROL());
    this.m_toolManager.RegisterTool(new COMMON_TOOLS());
    this.m_toolManager.RegisterTool(new ZOOM_TOOL());
    this.m_toolManager.RegisterTool(new SCH_SELECTION_TOOL());
    this.m_toolManager.RegisterTool(new PICKER_TOOL());
    this.m_toolManager.RegisterTool(new SCH_INSPECTION_TOOL());
    this.m_toolManager.RegisterTool(new SYMBOL_EDITOR_PIN_TOOL());
    this.m_toolManager.RegisterTool(new SYMBOL_EDITOR_DRAWING_TOOLS());
    this.m_toolManager.RegisterTool(new SCH_POINT_EDITOR());
    this.m_toolManager.RegisterTool(new SCH_FIND_REPLACE_TOOL());
    this.m_toolManager.RegisterTool(new SYMBOL_EDITOR_MOVE_TOOL());
    this.m_toolManager.RegisterTool(new SYMBOL_EDITOR_EDIT_TOOL());
    this.m_toolManager.RegisterTool(new LIBRARY_EDITOR_CONTROL());
    this.m_toolManager.RegisterTool(new SYMBOL_EDITOR_CONTROL());
    this.m_toolManager.RegisterTool(new PROPERTIES_TOOL());
    this.m_toolManager.RegisterTool(new EMBED_TOOL());
    this.m_toolManager.InitTools();

    // Run the selection tool, it is supposed to be always active
    this.m_toolManager.InvokeTool('common.InteractiveSelection');

    canvas.SetEventDispatcher(this.m_toolDispatcher);

    // The constructor's next line (symbol_edit_frame.cpp:180): the tools exist only now.
    this.setupUIConditions();
  }

  /**
   * `setupUIConditions()` (symbol_edit_frame.cpp:448-660): which rows and buttons are live and
   * which are checked, asked of the frame through `ProcessUpdateUI` as wx asks before it draws.
   */
  protected override setupUIConditions(): void {
    super.setupUIConditions();

    const mgr = this.m_toolManager!.GetActionManager();
    const cond = new EDITOR_CONDITIONS(this);

    const ENABLE = (x: SELECTION_CONDITION): ACTION_CONDITIONS => new ACTION_CONDITIONS().Enable(x);
    const CHECK = (x: SELECTION_CONDITION): ACTION_CONDITIONS => new ACTION_CONDITIONS().Check(x);
    const { And, Or, ShowAlways, Idle } = {
      And: SELECTION_CONDITIONS.And,
      Or: SELECTION_CONDITIONS.Or,
      ShowAlways: SELECTION_CONDITIONS.ShowAlways,
      Idle: SELECTION_CONDITIONS.Idle,
    };

    const haveSymbolCond = (_aSel: SELECTION): boolean => this.m_symbol !== null;

    const isEditableCond = (_aSel: SELECTION): boolean =>
      // Only root symbols from the new s-expression libraries or the schematic are editable.
      this.IsSymbolEditable() && !this.IsSymbolAlias();

    const isEditableInAliasCond = (_aSel: SELECTION): boolean =>
      // Less restrictive than isEditableCond: the fields of root symbols and aliases.
      this.IsSymbolEditable();

    const canUpdateFieldsCond = (_aSel: SELECTION): boolean =>
      this.IsSymbolEditable() && !!this.m_symbol && this.m_symbol.CanUpdateFieldsFromParent();

    const symbolModifiedCondition = (_aSel: SELECTION): boolean =>
      !!this.m_libMgr &&
      this.m_libMgr.IsSymbolModified(
        this.GetTargetLibId().GetLibItemName(),
        this.GetTargetLibId().GetLibNickname(),
      );

    const libSelectedCondition = (_aSel: SELECTION): boolean =>
      this.GetTargetLibId().GetLibNickname() !== '';

    const canEditProperties = (_aSel: SELECTION): boolean =>
      !!this.m_symbol && (!this.IsSymbolFromLegacyLibrary() || this.IsSymbolFromSchematic());

    const symbolSelectedInTreeCondition = (_aSel: SELECTION): boolean => {
      const targetLibId = this.GetTargetLibId();
      return targetLibId.GetLibNickname() !== '' && targetLibId.GetLibItemName() !== '';
    };

    const saveSymbolAsCondition = (_aSel: SELECTION): boolean => this.getTargetSymbol() !== null;

    const isSymbolFromSchematicCond = (_aSel: SELECTION): boolean => this.IsSymbolFromSchematic();

    mgr.SetConditions(ACTIONS.saveAll, ENABLE(ShowAlways));
    mgr.SetConditions(ACTIONS.save, ENABLE(ShowAlways));
    mgr.SetConditions(SCH_ACTIONS.saveLibraryAs, ENABLE(libSelectedCondition));
    mgr.SetConditions(SCH_ACTIONS.saveSymbolAs, ENABLE(saveSymbolAsCondition));
    mgr.SetConditions(SCH_ACTIONS.saveSymbolCopyAs, ENABLE(saveSymbolAsCondition));
    mgr.SetConditions(SCH_ACTIONS.newSymbol, ENABLE(ShowAlways));
    mgr.SetConditions(SCH_ACTIONS.importSymbol, ENABLE(ShowAlways));
    mgr.SetConditions(SCH_ACTIONS.editLibSymbolWithLibEdit, ENABLE(isSymbolFromSchematicCond));

    mgr.SetConditions(ACTIONS.undo, ENABLE(And(haveSymbolCond, cond.UndoAvailable())));
    mgr.SetConditions(ACTIONS.redo, ENABLE(And(haveSymbolCond, cond.RedoAvailable())));
    mgr.SetConditions(ACTIONS.revert, ENABLE(symbolModifiedCondition));

    mgr.SetConditions(ACTIONS.toggleGrid, CHECK(cond.GridVisible()));
    mgr.SetConditions(ACTIONS.toggleGridOverrides, CHECK(cond.GridOverrides()));

    mgr.SetConditions(ACTIONS.cut, ENABLE(isEditableCond));
    mgr.SetConditions(ACTIONS.copy, ENABLE(haveSymbolCond));
    mgr.SetConditions(ACTIONS.copyAsText, ENABLE(haveSymbolCond));
    mgr.SetConditions(ACTIONS.paste, ENABLE(And(And(isEditableCond, Idle), cond.NoActiveTool())));
    mgr.SetConditions(ACTIONS.doDelete, ENABLE(isEditableCond));
    mgr.SetConditions(ACTIONS.duplicate, ENABLE(isEditableCond));
    mgr.SetConditions(ACTIONS.selectAll, ENABLE(haveSymbolCond));
    mgr.SetConditions(ACTIONS.unselectAll, ENABLE(haveSymbolCond));

    // These actions in symbol editor when editing alias field rotations are allowed.
    mgr.SetConditions(SCH_ACTIONS.rotateCW, ENABLE(isEditableInAliasCond));
    mgr.SetConditions(SCH_ACTIONS.rotateCCW, ENABLE(isEditableInAliasCond));

    mgr.SetConditions(SCH_ACTIONS.mirrorH, ENABLE(isEditableCond));
    mgr.SetConditions(SCH_ACTIONS.mirrorV, ENABLE(isEditableCond));

    mgr.SetConditions(ACTIONS.zoomTool, CHECK(cond.CurrentTool(ACTIONS.zoomTool)));
    mgr.SetConditions(ACTIONS.selectionTool, CHECK(cond.CurrentTool(ACTIONS.selectionTool)));

    const pinTypeCond = (_aSel: SELECTION): boolean =>
      !!this.libeditconfig()?.show_pin_electrical_type;

    const hiddenPinCond = (_aSel: SELECTION): boolean =>
      !!this.libeditconfig()?.show_hidden_lib_pins;

    const hiddenFieldCond = (_aSel: SELECTION): boolean =>
      !!this.libeditconfig()?.show_hidden_lib_fields;

    const showPinAltIconsCond = (_aSel: SELECTION): boolean =>
      !!this.libeditconfig()?.show_pin_alt_icons;

    const showLibraryTreeCond = (_aSel: SELECTION): boolean => this.IsLibraryTreeShown();

    // `m_auimgr.GetPane( PropertiesPaneName() ).IsShown()`: the pane is the window's.
    const propertiesCond = (_aSel: SELECTION): boolean => !!this.hooks.isPropertiesShown?.();

    mgr.SetConditions(SCH_ACTIONS.showElectricalTypes, CHECK(pinTypeCond));
    mgr.SetConditions(ACTIONS.toggleBoundingBoxes, CHECK(cond.BoundingBoxes()));
    mgr.SetConditions(ACTIONS.showLibraryTree, CHECK(showLibraryTreeCond));
    mgr.SetConditions(ACTIONS.showProperties, CHECK(propertiesCond));
    mgr.SetConditions(SCH_ACTIONS.showHiddenPins, CHECK(hiddenPinCond));
    mgr.SetConditions(SCH_ACTIONS.showHiddenFields, CHECK(hiddenFieldCond));
    mgr.SetConditions(SCH_ACTIONS.togglePinAltIcons, CHECK(showPinAltIconsCond));

    const multiUnitModeCond = (_aSel: SELECTION): boolean =>
      !!this.m_symbol && this.m_symbol.IsMultiUnit() && !this.m_symbol.UnitsLocked();

    const multiBodyStyleModeCond = (_aSel: SELECTION): boolean =>
      !!this.m_symbol && this.m_symbol.IsMultiBodyStyle();

    const syncedPinsModeCond = (_aSel: SELECTION): boolean => this.m_SyncPinEdit;

    const haveDatasheetCond = (_aSel: SELECTION): boolean =>
      !!this.m_symbol && this.m_symbol.GetDatasheetField().GetText() !== '';

    mgr.SetConditions(ACTIONS.showDatasheet, ENABLE(haveDatasheetCond));
    mgr.SetConditions(
      SCH_ACTIONS.symbolProperties,
      ENABLE(Or(symbolSelectedInTreeCondition, And(canEditProperties, haveSymbolCond))),
    );
    mgr.SetConditions(SCH_ACTIONS.runERC, ENABLE(haveSymbolCond));
    mgr.SetConditions(SCH_ACTIONS.pinTable, ENABLE(And(isEditableCond, haveSymbolCond)));
    mgr.SetConditions(SCH_ACTIONS.updateSymbolFields, ENABLE(canUpdateFieldsCond));
    mgr.SetConditions(SCH_ACTIONS.cycleBodyStyle, ENABLE(multiBodyStyleModeCond));

    mgr.SetConditions(
      SCH_ACTIONS.toggleSyncedPinsMode,
      new ACTION_CONDITIONS().Enable(multiUnitModeCond).Check(syncedPinsModeCond),
    );

    // Only enable a tool if the symbol is edtable
    const EDIT_TOOL = (tool: TOOL_ACTION): ACTION_CONDITIONS =>
      new ACTION_CONDITIONS().Enable(isEditableCond).Check(cond.CurrentTool(tool));

    mgr.SetConditions(ACTIONS.deleteTool, EDIT_TOOL(ACTIONS.deleteTool));
    mgr.SetConditions(SCH_ACTIONS.placeSymbolPin, EDIT_TOOL(SCH_ACTIONS.placeSymbolPin));
    mgr.SetConditions(SCH_ACTIONS.placeSymbolText, EDIT_TOOL(SCH_ACTIONS.placeSymbolText));
    mgr.SetConditions(SCH_ACTIONS.drawSymbolTextBox, EDIT_TOOL(SCH_ACTIONS.drawSymbolTextBox));
    mgr.SetConditions(SCH_ACTIONS.drawRectangle, EDIT_TOOL(SCH_ACTIONS.drawRectangle));
    mgr.SetConditions(SCH_ACTIONS.drawCircle, EDIT_TOOL(SCH_ACTIONS.drawCircle));
    mgr.SetConditions(SCH_ACTIONS.drawArc, EDIT_TOOL(SCH_ACTIONS.drawArc));
    mgr.SetConditions(SCH_ACTIONS.drawBezier, EDIT_TOOL(SCH_ACTIONS.drawBezier));
    mgr.SetConditions(SCH_ACTIONS.drawSymbolLines, EDIT_TOOL(SCH_ACTIONS.drawSymbolLines));
    mgr.SetConditions(SCH_ACTIONS.drawSymbolPolygon, EDIT_TOOL(SCH_ACTIONS.drawSymbolPolygon));
    mgr.SetConditions(SCH_ACTIONS.placeSymbolAnchor, EDIT_TOOL(SCH_ACTIONS.placeSymbolAnchor));
    mgr.SetConditions(SCH_ACTIONS.importGraphics, EDIT_TOOL(SCH_ACTIONS.importGraphics));
  }

  /** `GetCurLib()` (symbol_edit_frame.cpp:909): the project's current library, if it still exists. */
  GetCurLib(): string {
    const prj = this.Prj();
    let libNickname = prj?.GetRString(RSTRING_T.SCH_LIBEDIT_CUR_LIB) ?? '';

    if (libNickname !== '' && !SymbolLibAdapter(prj).HasLibrary(libNickname)) {
      prj?.SetRString(RSTRING_T.SCH_LIBEDIT_CUR_LIB, '');
      libNickname = '';
    }

    return libNickname;
  }

  /** `SetCurLib( aLibNickname )` (:926): returns the previous one. */
  SetCurLib(aLibNickname: string): string {
    const old = this.GetCurLib();
    const prj = this.Prj();

    if (aLibNickname === '' || !SymbolLibAdapter(prj).HasLibrary(aLibNickname))
      prj?.SetRString(RSTRING_T.SCH_LIBEDIT_CUR_LIB, '');
    else prj?.SetRString(RSTRING_T.SCH_LIBEDIT_CUR_LIB, aLibNickname);

    return old;
  }

  /**
   * `SetCurSymbol( aSymbol, aUpdateZoom )` (:939-1105): take ownership of \a aSymbol and show it.
   * The library tree's selection and the info bar messages are the window's (stage 5).
   */
  SetCurSymbol(aSymbol: LIB_SYMBOL | null, aUpdateZoom: boolean): void {
    if (!this.m_toolManager) return; // wxCHECK

    this.m_toolManager.RunAction(ACTIONS.selectionClear);
    this.GetCanvas()?.GetView().Clear();

    this.m_symbol = aSymbol;

    // select the current symbol in the tree widget
    if (!this.IsSymbolFromSchematic() && this.m_symbol)
      this.hooks.libTreeSelectLibId?.(this.m_symbol.GetLibId());
    else this.hooks.libTreeUnselect?.();

    let symbolName = '';
    let libName = '';

    if (this.m_symbol) {
      symbolName = this.m_symbol.GetName();
      libName = unescapeString(this.m_symbol.GetLibId().GetLibNickname());
    }

    // retain in case this wxFrame is re-opened later on the same PROJECT
    this.Prj()?.SetRString(RSTRING_T.SCH_LIBEDIT_CUR_SYMBOL, symbolName);

    // Ensure synchronized pin edit can be enabled only symbols with interchangeable units
    this.m_SyncPinEdit =
      !!aSymbol && aSymbol.IsRoot() && aSymbol.IsMultiUnit() && !aSymbol.UnitsLocked();

    this.m_toolManager.ResetTools(RESET_REASON.MODEL_RELOAD);

    this.applyRenderSettings();
    this.GetCanvas()?.DisplaySymbol(this.m_symbol);
    this.GetCanvas()?.GetView().HideDrawingSheet();
    this.GetCanvas()?.GetView().ClearHiddenFlags();

    if (aUpdateZoom) this.m_toolManager.RunAction(ACTIONS.zoomFitScreen);

    this.GetCanvas()?.Refresh();
    this.m_propertiesPanel?.UpdateData();

    this.updateSymbolInfoBar(symbolName, libName);
  }

  /** SetCurSymbol's tail (:986-1100): what the infobar says about the symbol just opened. */
  private updateSymbolInfoBar(aSymbolName: string, aLibName: string): void {
    const infobar = this.GetInfoBar();

    if (!infobar) return;

    infobar.RemoveAllButtons();

    const msgs: string[] = [];
    const infobarFlags = 'information';

    if (this.IsSymbolFromSchematic()) {
      msgs.push(
        `Editing symbol ${this.m_reference} from schematic.  Saving will update the schematic only.`,
      );

      infobar.AddButton({
        label: `Open symbol from library ${aLibName}`,
        onClick: () => this.GetToolManager()?.RunAction(SCH_ACTIONS.editLibSymbolWithLibEdit),
      });
    } else if (this.IsSymbolFromLegacyLibrary()) {
      msgs.push(
        'Symbols in legacy libraries are not editable.  Use Manage Symbol Libraries to migrate ' +
          'to current format.',
      );

      // InvokeSchEditSymbolLibTable( &Kiway(), this )
      infobar.AddButton({
        label: 'Manage symbol libraries',
        onClick: () => void this.Kiway()?.CreateKiWindow(FRAME_T.DIALOG_SCH_LIBRARY_TABLE),
      });
    } else if (this.IsSymbolAlias()) {
      msgs.push(
        `Symbol ${unescapeString(aSymbolName)} is a derived symbol. Symbol graphics will not be ` +
          'editable.',
      );

      // Don't assume the parent symbol shared pointer is still valid.
      const rootSymbol = this.m_symbol?.GetRootSymbol() ?? null;

      if (rootSymbol) {
        const unit = this.GetUnit();
        const bodyStyle = this.GetBodyStyle();
        const rootSymbolName = rootSymbol.GetName();

        infobar.AddButton({
          label: `Open ${unescapeString(rootSymbolName)}`,
          onClick: () => void this.LoadSymbolFromCurrentLib(rootSymbolName, unit, bodyStyle),
        });
      }
    }

    if (
      this.m_symbol &&
      !this.IsSymbolFromSchematic() &&
      this.m_libMgr.IsLibraryReadOnly(this.m_symbol.GetLibId().GetFullLibraryName())
    ) {
      msgs.push('Library is read-only.  Changes cannot be saved to this library.');

      infobar.AddButton({
        label: 'Create an editable copy',
        onClick: async () => {
          const msg = `Create an editable copy of the symbol or the entire library (${aLibName})?`;

          // These buttons are in a weird order(?)
          const choice = await this.ShowKiDialog({
            caption: 'Select type of item to save',
            message: msg,
            icon: 'question',
            yesNo: { yes: 'Copy symbol', no: 'Cancel', cancel: 'Copy library' },
          });

          switch (choice) {
            case 'yes':
              await this.SaveSymbolCopyAs(true);
              break;
            case 'cancel':
              await this.SaveLibraryAs();
              break;
            default:
              // Do nothing
              break;
          }
        },
      });
    }

    if (msgs.length === 0) infobar.Dismiss();
    else infobar.ShowMessage(msgs.join('\n'), infobarFlags);
  }

  /** The render settings' unit, body style and disabled states, as SetCurSymbol and RebuildView set them. */
  private applyRenderSettings(): void {
    const settings = this.GetRenderSettings();

    if (!settings) return;

    settings.m_ShowUnit = this.m_unit;
    settings.m_ShowBodyStyle = this.m_bodyStyle;
    settings.m_ShowDisabled = this.IsSymbolFromLegacyLibrary() && !this.IsSymbolFromSchematic();
    settings.m_ShowGraphicsDisabled = this.IsSymbolAlias() && !this.IsSymbolFromSchematic();
  }

  /** `SetUnit( aUnit )` (:1131). */
  SetUnit(aUnit: number): void {
    const symbol = this.GetCurSymbol();

    if (!symbol || aUnit <= 0 || aUnit > symbol.GetUnitCount()) return; // wxCHECK

    if (this.m_unit === aUnit) return;

    this.m_toolManager?.RunAction(ACTIONS.cancelInteractive);
    this.m_toolManager?.RunAction(ACTIONS.selectionClear);

    this.m_unit = aUnit;

    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);
    this.RebuildView();
  }

  /** `SetBodyStyle( aBodyStyle )` (:1152). */
  SetBodyStyle(aBodyStyle: number): void {
    const symbol = this.GetCurSymbol();

    if (!symbol || aBodyStyle <= 0 || aBodyStyle > symbol.GetBodyStyleCount()) return; // wxCHECK

    if (this.m_bodyStyle === aBodyStyle) return;

    this.m_toolManager?.RunAction(ACTIONS.cancelInteractive);
    this.m_toolManager?.RunAction(ACTIONS.selectionClear);

    this.m_bodyStyle = aBodyStyle;

    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);
    this.RebuildView();
  }

  /** `RebuildView()` (:1631). */
  RebuildView(): void {
    this.applyRenderSettings();
    this.GetCanvas()?.DisplaySymbol(this.m_symbol);
    this.GetCanvas()?.GetView().HideDrawingSheet();
    this.GetCanvas()?.GetView().ClearHiddenFlags();

    // Let tools add things to the view if necessary
    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);

    this.GetCanvas()?.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
    this.GetCanvas()?.Refresh();
  }

  /** `TOOLS_HOLDER::PushTool`, and the window's toolbar told (KiCad's toolbar asks on update-UI). */
  override PushTool(aEvent: TOOL_EVENT): void {
    super.PushTool(aEvent);
    this.hooks.toolStackChanged?.();
  }

  /** `TOOLS_HOLDER::PopTool`, and the window's toolbar told. */
  override PopTool(aEvent: TOOL_EVENT): void {
    super.PopTool(aEvent);
    this.hooks.toolStackChanged?.();
  }

  /** `OnModify()` (:1112): the screen is modified and the buffer takes the symbol. */
  override OnModify(): void {
    super.OnModify();

    this.GetScreen()?.SetContentModified();

    if (!this.IsSymbolFromSchematic()) this.storeCurrentSymbol();

    if (this.m_isClosing) return;

    // GetLibTree()->RefreshLibTree()
    this.RefreshLibTree();

    // `if( !GetTitle().StartsWith( "*" ) )`: the title is the window's, and writing it again is the
    // same title.
    this.UpdateTitle();
  }

  /** `storeCurrentSymbol()` (:1529): the edited symbol into the library buffer. */
  protected storeCurrentSymbol(): void {
    if (this.m_symbol && this.GetCurLib() !== '' && this.GetScreen()?.IsContentModified())
      this.m_libMgr.UpdateSymbol(this.m_symbol, this.GetCurLib()); // UpdateSymbol() makes a copy
  }

  /** `SetScreen( aScreen )` (:1621): tools add things to the view for the new screen. */
  override SetScreen(aScreen: BASE_SCREEN | null): void {
    super.SetScreen(aScreen);

    // Let tools add things to the view if necessary
    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);
  }

  /** `ClearUndoORRedoList( whichList, aItemCount )` (:1939): the oldest \a aItemCount, or all. */
  override ClearUndoORRedoList(whichList: UNDO_REDO_LIST, aItemCount = -1): void {
    if (aItemCount === 0) return;

    const list = whichList === UNDO_REDO_LIST.UNDO_LIST ? this.m_undoList : this.m_redoList;

    if (aItemCount < 0) {
      list.ClearCommandList();
    } else {
      for (let ii = 0; ii < aItemCount; ii++) {
        if (list.m_CommandsList.length === 0) break;

        const curr_cmd = list.m_CommandsList.shift()!;

        curr_cmd.ClearListAndDeleteItems(() => {});
      }
    }
  }

  /** `emptyScreen()` (:1546): no library, no symbol, the dummy screen. */
  emptyScreen(): void {
    this.SetCurLib('');
    this.SetCurSymbol(null, false);
    this.SetScreen(this.m_dummyScreen);
    this.ClearUndoRedoList();
    this.m_toolManager?.RunAction(ACTIONS.zoomFitScreen);
  }

  // The live symbol editor's state (symbol_edit_frame.h): the symbol being edited and the unit and
  // body style shown. `m_symbol` is public for the frame's mixins (symbol_editor_undo_redo.ts),
  // which set it as upstream's split methods do.
  m_symbol: LIB_SYMBOL | null = null;
  // Public for the frame's mixins (symbol_editor.ts), as m_symbol is.
  m_unit = 1;
  m_bodyStyle = 1;

  /** `GetCurSymbol()`. */
  GetCurSymbol(): LIB_SYMBOL | null {
    return this.m_symbol;
  }

  /** `GetUnit()`. */
  GetUnit(): number {
    return this.m_unit;
  }

  /** `GetBodyStyle()`. */
  GetBodyStyle(): number {
    return this.m_bodyStyle;
  }

  /** `IsSymbolAlias()` (symbol_edit_frame.cpp:2225): the symbol is derived from another. */
  IsSymbolAlias(): boolean {
    return !!this.m_symbol && !this.m_symbol.IsRoot();
  }

  // `IsSymbolFromSchematic()` / `IsSymbolFromLegacyLibrary()` (symbol_edit_frame.{h:273,cpp:892}):
  // the window knows where its symbol came from and which library row holds it, and sets them.
  private m_isSymbolFromSchematic = false;
  private m_isSymbolFromLegacyLibrary = false;

  SetSymbolOrigin(aFromSchematic: boolean, aFromLegacyLibrary: boolean): void {
    this.m_isSymbolFromSchematic = aFromSchematic;
    this.m_isSymbolFromLegacyLibrary = aFromLegacyLibrary;
  }

  IsSymbolFromSchematic(): boolean {
    return this.m_isSymbolFromSchematic;
  }

  IsSymbolFromLegacyLibrary(): boolean {
    return !!this.m_symbol && this.m_isSymbolFromLegacyLibrary;
  }

  /** `IsSymbolEditable()` (symbol_edit_frame.cpp:2231). */
  IsSymbolEditable(): boolean {
    return !!this.m_symbol && (!this.IsSymbolFromLegacyLibrary() || this.IsSymbolFromSchematic());
  }

  /** `GetSettings()` (symbol_edit_frame.h:221): the frame's SYMBOL_EDITOR_SETTINGS. */
  GetSettings(): SymbolEditorSettings | null {
    return this.libeditconfig();
  }

  /** `GetShowInvisibleFields()` (symbol_edit_frame.cpp:2264): libeditconfig()->m_ShowHiddenFields. */
  GetShowInvisibleFields(): boolean {
    return currentSymbolEditorSettings().show_hidden_lib_fields;
  }

  /** `GetShowInvisiblePins()` (symbol_edit_frame.cpp:2271): libeditconfig()->m_ShowHiddenPins. */
  GetShowInvisiblePins(): boolean {
    return currentSymbolEditorSettings().show_hidden_lib_pins;
  }

  /** `m_libTreeAutoHiddenForSchematicEdit`: the tree was hidden for a schematic edit. */
  m_libTreeAutoHiddenForSchematicEdit = false;

  /** `m_reference`: the reference of a symbol from the schematic. */
  m_reference = '';

  /** `libTreeAutoHiddenForSchematicEdit( aWasFromSchematic, aRestorePending, aTreeShownNow )`. */
  static libTreeAutoHiddenForSchematicEdit(
    aWasFromSchematic: boolean,
    aRestorePending: boolean,
    aTreeShownNow: boolean,
  ): boolean {
    // Auto-hiding a visible tree schedules its restore. A chained schematic edit finds the tree
    // already auto-hidden, so keep the pending restore rather than dropping it. An explicit user
    // toggle clears the flag elsewhere, so a tree hidden without a pending restore stays that way.
    if (aTreeShownNow) return true;

    return aWasFromSchematic && aRestorePending;
  }

  /**
   * `LoadSymbolFromSchematic( aSymbol )` (symbol_edit_frame.cpp:1990-2090): the placement's
   * own library symbol, flattened, with the placement's fields brought back into library space.
   */
  LoadSymbolFromSchematic(aSymbol: SCH_SYMBOL): void {
    const libSymbolRef = aSymbol.GetLibSymbolRef();

    if (!libSymbolRef) return; // wxCHECK( symbol )

    const symbol = libSymbolRef.Flatten();

    symbol.SetLibId(aSymbol.GetLibId());

    // Take in account the symbol orientation and mirroring. to calculate the field
    // positions in symbol editor (i.e. no rotation, no mirroring)
    const MIRROR = SYMBOL_ORIENTATION_T.SYM_MIRROR_X | SYMBOL_ORIENTATION_T.SYM_MIRROR_Y;
    const orientation = aSymbol.GetOrientation() & ~MIRROR;
    const mirror = aSymbol.GetOrientation() & MIRROR;

    const fullSetOfFields: SCH_FIELD[] = [];

    for (const field of aSymbol.GetFields()) {
      const symPos = aSymbol.GetPosition();
      const fieldPos = field.GetPosition();
      const pos = { x: fieldPos.x - symPos.x, y: fieldPos.y - symPos.y };
      const libField = new SCH_FIELD(symbol, field.GetId());

      libField.assignField(field);

      // The inverse transform is mirroring before, rotate after
      switch (mirror) {
        case SYMBOL_ORIENTATION_T.SYM_MIRROR_X:
          pos.y = -pos.y;
          break;
        case SYMBOL_ORIENTATION_T.SYM_MIRROR_Y:
          pos.x = -pos.x;
          break;
        default:
          break;
      }

      switch (orientation) {
        case SYMBOL_ORIENTATION_T.SYM_ORIENT_90:
          [pos.x, pos.y] = [-pos.y, pos.x];
          break;
        case SYMBOL_ORIENTATION_T.SYM_ORIENT_270:
          [pos.x, pos.y] = [pos.y, -pos.x];
          break;
        case SYMBOL_ORIENTATION_T.SYM_ORIENT_180:
          pos.x = -pos.x;
          pos.y = -pos.y;
          break;
        default:
          break;
      }

      libField.SetPosition(pos);

      fullSetOfFields.push(libField);
    }

    symbol.SetFields(fullSetOfFields);

    if (this.m_symbol) this.SetCurSymbol(null, false);

    this.m_isSymbolFromSchematic = true;
    this.m_schematicSymbolUUID = aSymbol.m_Uuid;
    this.m_reference = symbol.GetReferenceField().GetText();
    this.m_unit = Math.max(1, aSymbol.GetUnit());
    this.m_bodyStyle = Math.max(1, aSymbol.GetBodyStyle());

    // Optimize default edit options for this symbol
    // Usually if units are locked, graphic items are specific to each unit
    // and if units are interchangeable, graphic items are common to units
    this.m_toolManager
      ?.GetTool(SYMBOL_EDITOR_DRAWING_TOOLS)
      ?.SetDrawSpecificUnit(symbol.UnitsLocked());

    // The buffered screen for the symbol
    this.SetScreen(new SCH_SCREEN());
    this.SetCurSymbol(symbol, true);
    // setSymWatcher( nullptr ): no file watcher on a page.

    this.ReCreateMenuBar();
    this.RecreateToolbars();

    // Auto-hide the tree while editing a schematic symbol, remembering to restore it in
    // SaveSettings so the user's preference survives a restart. Hide via the pane directly, not
    // ToggleLibraryTree, which would treat this as a user toggle and drop the pending restore.
    this.m_libTreeAutoHiddenForSchematicEdit = SYMBOL_EDIT_FRAME.libTreeAutoHiddenForSchematicEdit(
      this.m_isSymbolFromSchematic,
      this.m_libTreeAutoHiddenForSchematicEdit,
      this.IsLibraryTreeShown(),
    );

    if (this.IsLibraryTreeShown()) this.hooks.showLibraryTreePane?.(false);

    this.UpdateTitle();
    this.RebuildSymbolUnitAndBodyStyleLists();
    this.UpdateSymbolMsgPanelInfo();

    // Let tools add things to the view if necessary
    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);

    this.GetCanvas()?.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
    this.GetCanvas()?.Refresh();
  }

  /** `IsLibraryTreeShown()`. */
  override IsLibraryTreeShown(): boolean {
    return this.hooks.isLibraryTreeShown?.() ?? false;
  }

  /** `ToggleLibraryTree()`. */
  override ToggleLibraryTree(): void {
    // An explicit toggle makes the live visibility authoritative, so drop any pending restore
    // that LoadSymbolFromSchematic's auto-hide left behind.
    this.m_libTreeAutoHiddenForSchematicEdit = false;

    this.hooks.toggleLibraryTree?.();
  }

  /** `LIB_EDIT_FRAME_NAME`, the name wx gives this frame. */
  override GetName(): string {
    return LIB_EDIT_FRAME_NAME;
  }

  /** `SYMBOL_EDIT_FRAME::KiwayMailIn` (symbol_edit_frame.cpp:1753). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    const payload = mail.GetPayload();

    switch (mail.Command()) {
      case MAIL_T.MAIL_LIB_EDIT:
        if (payload !== '') {
          const uri = payload;
          let libNickname: string;
          let msg: string;

          const adapter = SymbolLibAdapter(this.Prj());
          const libTableRow = adapter.FindRowByURI(uri);

          if (!libTableRow) {
            msg = `The current configuration does not include the symbol library '${uri}'.`;
            msg += '\nUse Manage Symbol Libraries to edit the configuration.';
            DisplayErrorMessage('Library not found in symbol library table.', msg);
            break;
          }

          libNickname = libTableRow.Nickname();

          if (!adapter.HasLibrary(libNickname, true)) {
            msg = `The symbol library '${unescapeString(libNickname)}' is not enabled in the current configuration.`;
            msg += '\nUse Manage Symbol Libraries to edit the configuration.';
            DisplayErrorMessage('Symbol library not enabled.', msg);
            break;
          }

          this.SetCurLib(libNickname);

          // `if( m_treePane )`: the window's tree.
          const id = new LIB_ID(libNickname, '');
          this.hooks.libTreeSelectLibId?.(id);
          this.hooks.libTreeExpandLibId?.(id);
          this.hooks.libTreeCenterLibId?.(id);
        }

        break;

      case MAIL_T.MAIL_RELOAD_LIB: {
        const currentLib = this.GetCurLib();

        this.FreezeLibraryTree();

        // Check if the currently selected symbol library been removed or disabled.
        if (currentLib !== '' && !SymbolLibAdapter(this.Prj()).HasLibrary(currentLib, true)) {
          this.SetCurLib('');
          this.emptyScreen();
        }

        this.SyncLibraries(true);
        this.ThawLibraryTree();
        this.RefreshLibraryTree();

        break;
      }

      default:
        break;
    }
  }
}

applyMixins(SYMBOL_EDIT_FRAME, [
  SYMBOL_EDITOR_UNDO_REDO_MIXIN,
  SYMBOL_EDITOR_MIXIN,
  SYMBOL_EDITOR_FILES_MIXIN,
  SYMBOL_EDITOR_IMPORT_EXPORT_MIXIN,
  SYMBOL_EDITOR_PLOTTER_MIXIN,
]);
