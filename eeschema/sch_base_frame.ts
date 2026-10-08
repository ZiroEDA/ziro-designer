// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_BASE_FRAME` (eeschema/sch_base_frame.{h,cpp}): the base of the
 * schematic and symbol editors (and upstream the symbol viewer and chooser) —
 * the screen's page and title block, the item bookkeeping every edit goes
 * through (`AddToScreen`, `RemoveFromScreen`, `UpdateItem`), the colour theme
 * choice, and the free function `SchGetLibSymbol`.
 *
 * Every view call is made through `GetCanvas()?.GetView()`, as upstream's is
 * through `GetCanvas()->GetView()`: until a frame is given a canvas the calls
 * find none and the model half runs alone, which is what the live-model tests
 * exercise.
 *
 * Not ported, each for a stated reason:
 * - `m_watcher` / `setSymWatcher` / `OnSymChange` / `OnSymChangeDebounceTimer`:
 *   a `wxFileSystemWatcher` on the library file on disk. A browser tab has no
 *   file system to watch; the hosted library store pushes changes instead.
 * - `m_spaceMouse` and the activate/iconize handlers that only feed it: the
 *   3Dconnexion driver (`navlib/`, see pcbnew/STRUCTURE.md).
 * - `SelectLibrary`'s `EDA_LIST_DIALOG`: the list it shows is
 *   `GetLibraryItemsForListDialog`, ported below; the modal loop around it is
 *   the window's.
 */
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { LIB_SYMBOL } from './lib_symbol.js';
import { fetchHostedSymbolFile } from './libraries/symbol_library_adapter.js';
import { SCH_FILE_T, SCH_IO_MGR } from './sch_io/sch_io_mgr.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import {
  currentEeschemaSettings,
  EESCHEMA_SETTINGS,
  type EeschemaSettings,
  eeschemaKifaceSettings,
} from './eeschema_settings.js';
import type { SCH_RENDER_SETTINGS } from './sch_render_settings.js';
import type { SCH_SELECTION_FILTER_OPTIONS } from '@ziroeda/common/project/project_local_settings.js';
import type { SCH_DRAW_PANEL } from './sch_draw_panel.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { EDA_DRAW_FRAME, SCH_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { schIUScale, type EdaIuScale, type EdaUnits } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ORIGIN_TRANSFORMS } from '@ziroeda/common/origin_transforms.js';
import type { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { PgmOrNull, GetColorSettings as PgmGetColorSettings } from '@ziroeda/common/pgm_base.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { LIBRARY_TABLE_SCOPE } from '@ziroeda/common/libraries/library_table.js';
import { RSTRING_T } from '@ziroeda/common/project.js';
import {
  GetUseGlobalTable,
  MakeFileDlgHookNewLibrary,
} from '@ziroeda/common/widgets/filedlg_hook_new_library.js';
import {
  KiCadSymbolLibFileExtension,
  kicadSymbolLibWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { wxID_CANCEL, wxID_HIGHEST, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { SymbolLibAdapter } from './project_sch.js';
import { SYMBOL_LIBRARY_MANAGER } from './symbol_library_manager.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { strNumCmp, unescapeString } from '@ziroeda/common/string_utils.js';
import { SCH_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { SCH_FIELD } from './sch_field.js';
import type { SCH_LABEL_BASE } from './sch_label.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import type { SCH_TEXT } from './sch_text.js';
import type { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_GROUP } from './sch_group.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_SCREEN } from './sch_screen.js';
import {
  currentSymbolEditorSettings,
  type SymbolEditorSettings,
} from './symbol_editor/symbol_editor_settings.js';

/** `LIB_TREE_MODEL_ADAPTER::GetPinningSymbol()`: the star a pinned library is listed with. */
export const PINNING_SYMBOL = '☆ ';

/**
 * The symbol library layer `SchGetLibSymbol` asks (`SYMBOL_LIBRARY_ADAPTER::
 * LoadSymbol`), and the legacy cache library's `FindSymbol`. Asynchronous
 * here: the hosted libraries are fetched, not memory-mapped.
 */
export interface SCH_LIB_SYMBOL_SOURCE<S> {
  LoadSymbol(aLibId: string): Promise<S | null | undefined>;
}

/** `LEGACY_SYMBOL_LIB`, the `<project>-cache.lib` a V5 project carries: symbols by cache name. */
/**
 * `DIALOG_SCH_FIND` (eeschema/dialogs/dialog_sch_find.h): the modeless Find / Find and Replace
 * dialog. The window owns it; the frame drives it through these.
 */
export interface DIALOG_SCH_FIND {
  SetFindEntries(aEntries: readonly string[], aFindString: string): void;
  GetFindEntries(): string[];
  SetReplaceEntries(aEntries: readonly string[]): void;
  GetReplaceEntries(): string[];
  Show(aShow: boolean): void;
  Destroy(): void;
}

/** `new DIALOG_SCH_FIND( this, aData, …, aReplace ? wxFR_REPLACEDIALOG : 0 )`. */
export type DIALOG_SCH_FIND_FACTORY = (
  aData: SCH_SEARCH_DATA,
  aReplace: boolean,
) => DIALOG_SCH_FIND | null;

export interface SCH_LEGACY_CACHE_LIB<S> {
  IsCache(): boolean;
  FindSymbol(aName: string): S | null | undefined;
}

/**
 * `SchGetLibSymbol` (sch_base_frame.cpp:83-114): the symbol \a aLibId names,
 * from the library; failing that, from the legacy cache library under
 * `<nickname>_<item>`. A library that throws gives null, reported through
 * \a aShowError when one is given (upstream's `aShowErrorMsg`).
 */
export async function SchGetLibSymbol<S>(
  aLibId: string,
  aLibMgr: SCH_LIB_SYMBOL_SOURCE<S> | null,
  aCacheLib: SCH_LEGACY_CACHE_LIB<S> | null = null,
  aShowError: ((aMsg: string, aWhat: string) => void) | null = null,
): Promise<S | null> {
  // wxCHECK_MSG( aLibMgr, nullptr, "Invalid symbol library manager adapter." )
  if (!aLibMgr) return null;

  const colon = aLibId.indexOf(':');
  const nickname = colon >= 0 ? aLibId.slice(0, colon) : '';
  const itemName = colon >= 0 ? aLibId.slice(colon + 1) : aLibId;
  let symbol: S | null = null;

  try {
    symbol = (await aLibMgr.LoadSymbol(aLibId)) ?? null;

    if (!symbol && aCacheLib) {
      // wxCHECK_MSG( aCacheLib->IsCache(), nullptr, "Invalid cache library." )
      if (!aCacheLib.IsCache()) return null;

      symbol = aCacheLib.FindSymbol(`${nickname}_${itemName}`) ?? null;
    }
  } catch (ioe) {
    aShowError?.(
      `Error loading symbol ${itemName} from library '${nickname}'.`,
      ioe instanceof Error ? ioe.message : String(ioe),
    );
  }

  return symbol;
}

/**
 * The theme `SCH_BASE_FRAME::GetColorSettings` (sch_base_frame.cpp:620-640)
 * loads: eeschema's, unless this is the Symbol Editor and it is set not to use
 * eeschema's colours, in which case the Symbol Editor's own.
 */
export function SchColorThemeName(
  aFrameType: FRAME_T,
  aEeschemaColorTheme: string,
  aSymbolEditorCfg: {
    use_eeschema_color_settings: boolean;
    appearance: { color_theme: string };
  } | null,
): string {
  let colorTheme = aEeschemaColorTheme;

  if (aFrameType === FRAME_T.FRAME_SCH_SYMBOL_EDITOR && aSymbolEditorCfg) {
    if (!aSymbolEditorCfg.use_eeschema_color_settings)
      colorTheme = aSymbolEditorCfg.appearance.color_theme;
  }

  return colorTheme;
}

/** One row of `GetLibraryItemsForListDialog`: the name (star-prefixed when pinned) and description. */
export type LIBRARY_LIST_ITEM = [name: string, description: string];

/**
 * `SCH_BASE_FRAME::GetLibraryItemsForListDialog` (:667-712): the headers and
 * rows of a "choose a library" list — pinned libraries first, each group in
 * `StrNumCmp` order, a pinned name carrying the pinning symbol.
 */
export function GetLibraryItemsForListDialog(
  aLibraries: readonly { nickname: string; description: string }[],
  aPinned: readonly string[],
): { headers: string[]; items: LIBRARY_LIST_ITEM[] } {
  const headers = ['Library', 'Description'];
  const items: LIBRARY_LIST_ITEM[] = [];
  const unpinned: LIBRARY_LIST_ITEM[] = [];

  for (const { nickname, description } of aLibraries) {
    if (aPinned.includes(nickname)) items.push([PINNING_SYMBOL + nickname, description]);
    else unpinned.push([nickname, description]);
  }

  const byName = (a: LIBRARY_LIST_ITEM, b: LIBRARY_LIST_ITEM): number =>
    strNumCmp(a[0], b[0], true);

  items.sort(byName);
  unpinned.sort(byName);

  return { headers, items: [...items, ...unpinned] };
}

export abstract class SCH_BASE_FRAME extends EDA_DRAW_FRAME {
  /**
   * `GetLibSymbol( aLibId, aUseCacheLib, aShowErrorMsg )` (sch_base_frame.cpp:282). Async in the
   * browser: a hosted library symbol is fetched into the download folder before KiCad's reader
   * opens it; a project library is read through the adapter at once.
   */
  async GetLibSymbol(aLibId: LIB_ID): Promise<LIB_SYMBOL | null> {
    const adapter = SymbolLibAdapter(this.Prj());
    const symbol = await SchGetLibSymbol<LIB_SYMBOL>(aLibId.Format(), {
      LoadSymbol: async () => adapter.LoadSymbol(aLibId),
    });

    if (symbol) return symbol;

    const path = await fetchHostedSymbolFile(aLibId);

    if (!path) return null;

    try {
      return SCH_IO_MGR.FindPlugin(SCH_FILE_T.SCH_KICAD)!.LoadSymbol(path, aLibId.GetLibItemName());
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      return null;
    }
  }

  /**
   * The window's half of the dialogs a frame opens: the dialog by name, with an argument it reads
   * and fills. A frame with no window (the symbol viewer and editor until their switch) cancels.
   */
  ShowModalDialog(
    _aDialog: string,
    _aItems: readonly EDA_ITEM[],
    _aArg?: unknown,
  ): Promise<number> {
    return Promise.resolve(wxID_CANCEL);
  }

  /** `GetLibraryItemsForListDialog( aHeaders, aItemsToDisplay )` (sch_base_frame.cpp:667). */
  GetLibraryItemsForListDialog(): { headers: string[]; items: LIBRARY_LIST_ITEM[] } {
    const cfg = PgmOrNull()?.GetCommonSettings() ?? null;
    const project = this.Prj().GetProjectFile();
    const adapter = SymbolLibAdapter(this.Prj());
    const libraries = adapter.GetLibraryNames().map((nickname) => ({
      nickname,
      description: adapter.GetLibraryDescription(nickname) ?? '',
    }));

    return GetLibraryItemsForListDialog(libraries, [
      ...project.m_PinnedSymbolLibs,
      ...(cfg?.m_Session?.pinned_symbol_libs ?? []),
    ]);
  }

  /**
   * `SelectLibrary( aDialogTitle, aListLabel, aExtraCheckboxes )` (sch_base_frame.cpp:715): ask for
   * a symbol library, offering "New Library..." until a valid one is chosen; "" is Cancel.
   */
  async SelectLibrary(
    aDialogTitle: string,
    aListLabel: string,
    aExtraCheckboxes: readonly EDA_LIST_EXTRA_CHECKBOX[] = [],
  ): Promise<string> {
    const ID_MAKE_NEW_LIBRARY = wxID_HIGHEST;

    // Keep asking the user for a new name until they give a valid one or cancel the operation
    while (true) {
      const { headers, items } = this.GetLibraryItemsForListDialog();
      let libraryName = this.Prj().GetRString(RSTRING_T.SCH_LIB_SELECT);

      const dlg: EDA_LIST_DIALOG_ARG = {
        title: aDialogTitle,
        headers,
        items,
        selection: libraryName,
        sortList: false,
        listLabel: aListLabel,
        extraCheckboxes: aExtraCheckboxes.map((c) => ({ label: c.label, value: c.value.value })),
        extraButton: { id: ID_MAKE_NEW_LIBRARY, label: 'New Library...' },
        textSelection: '',
      };

      const ret = await this.ShowModalDialog('EDA_LIST_DIALOG', [], dlg);

      switch (ret) {
        case wxID_CANCEL:
          return '';

        case wxID_OK:
          libraryName = dlg.textSelection;
          this.Prj().SetRString(RSTRING_T.SCH_LIB_SELECT, libraryName);

          // dlg.GetExtraCheckboxValues()
          aExtraCheckboxes.forEach((c, i) => {
            c.value.value = dlg.extraCheckboxes[i]!.value;
          });

          return libraryName;

        case ID_MAKE_NEW_LIBRARY: {
          const mgr = new SYMBOL_LIBRARY_MANAGER(this);
          const fn = { value: this.Prj().GetRString(RSTRING_T.SCH_LIB_PATH) };
          const tableChooser = MakeFileDlgHookNewLibrary(false);

          if (
            !(await this.LibraryFileBrowser(
              'Create New Library',
              false,
              fn,
              [kicadSymbolLibWildcard()],
              KiCadSymbolLibFileExtension,
              false,
              tableChooser,
            ))
          ) {
            break;
          }

          const slash = fn.value.lastIndexOf('/');
          const fullName = fn.value.slice(slash + 1);
          libraryName = fullName.includes('.')
            ? fullName.slice(0, fullName.lastIndexOf('.'))
            : fullName;
          this.Prj().SetRString(
            RSTRING_T.SCH_LIB_PATH,
            slash < 0 ? '' : fn.value.slice(0, slash) || '/',
          );

          const scope = GetUseGlobalTable(tableChooser)
            ? LIBRARY_TABLE_SCOPE.GLOBAL
            : LIBRARY_TABLE_SCOPE.PROJECT;
          const adapter = SymbolLibAdapter(this.Prj());

          if (adapter.HasLibrary(libraryName, false)) {
            DisplayErrorMessage(`Library '${libraryName}' already exists.`);
            break;
          }

          if (!mgr.CreateLibrary(fn.value, scope))
            DisplayErrorMessage(`Could not add library '${libraryName}'.`);

          break;
        }

        default:
          break;
      }
    }
  }
  /** `Kiface().KifaceSettings()`: EESCHEMA_SETTINGS (the symbol editor overrides it). */
  override config(): APP_SETTINGS_BASE | null {
    return eeschemaKifaceSettings();
  }

  /**
   * `eeconfig()` (sch_base_frame.cpp:191): the eeschema settings when config() is
   * EESCHEMA_SETTINGS, null in the symbol editor. Its eeschema rows are the JSON slice's
   * (`m_Input.drag_is_move` is `input.drag_is_move`), see EESCHEMA_SETTINGS.
   */
  private m_findReplaceDialog: DIALOG_SCH_FIND | null = null;
  private m_findReplaceDialogFactory: DIALOG_SCH_FIND_FACTORY | null = null;

  /** The window installs how it builds DIALOG_SCH_FIND; with none, no dialog opens. */
  SetFindReplaceDialogFactory(aFactory: DIALOG_SCH_FIND_FACTORY | null): void {
    this.m_findReplaceDialogFactory = aFactory;
  }

  /** `ShowFindReplaceDialog( aReplace )` (sch_base_frame.cpp:522). */
  ShowFindReplaceDialog(aReplace: boolean): void {
    let findString = '';

    const selection = (
      this.m_toolManager?.FindTool('common.InteractiveSelection') as {
        GetSelection(): SELECTION;
      } | null
    )?.GetSelection();

    if (selection && selection.Size() === 1) {
      const front = selection.Front()!;

      switch (front.Type()) {
        case KICAD_T.SCH_SYMBOL_T: {
          const symbol = front as unknown as SCH_SYMBOL;
          findString = unescapeString(symbol.GetField(FIELD_T.VALUE)!.GetText());
          break;
        }

        case KICAD_T.SCH_FIELD_T:
          findString = unescapeString((front as unknown as SCH_FIELD).GetText());
          break;

        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_SHEET_PIN_T:
          findString = unescapeString((front as unknown as SCH_LABEL_BASE).GetText());
          break;

        case KICAD_T.SCH_TEXT_T:
          findString = unescapeString((front as unknown as SCH_TEXT).GetText());

          if (findString.includes('\n')) findString = findString.slice(0, findString.indexOf('\n'));

          break;

        default:
          break;
      }
    }

    if (this.m_findReplaceDialog) this.m_findReplaceDialog.Destroy();

    this.m_findReplaceDialog =
      this.m_findReplaceDialogFactory?.(this.m_findReplaceData as SCH_SEARCH_DATA, aReplace) ??
      null;

    if (!this.m_findReplaceDialog) return;

    this.m_findReplaceDialog.SetFindEntries(this.m_findStringHistoryList, findString);
    this.m_findReplaceDialog.SetReplaceEntries(this.m_replaceStringHistoryList);
    this.m_findReplaceDialog.Show(true);
  }

  /** `GetFindReplaceDialog()` (sch_base_frame.h:248). */
  GetFindReplaceDialog(): DIALOG_SCH_FIND | null {
    return this.m_findReplaceDialog;
  }

  /** `ShowFindReplaceStatus( aMsg, aStatusTime )` (sch_base_frame.cpp:577). */
  ShowFindReplaceStatus(aMsg: string, aStatusTime: number): void {
    const infoBar = this.GetInfoBar();

    if (!infoBar) return;

    // Prepare the infobar, since we don't know its state
    infoBar.RemoveAllButtons();
    infoBar.AddCloseButton?.();

    infoBar.ShowMessageFor(aMsg, aStatusTime, 'information');
  }

  /** `ClearFindReplaceStatus()` (sch_base_frame.cpp:587). */
  ClearFindReplaceStatus(): void {
    this.GetInfoBar()?.Dismiss();
  }

  /** `OnFindDialogClose()` (sch_base_frame.cpp:593): the dialog's close handler calls it. */
  OnFindDialogClose(): void {
    this.m_findStringHistoryList = this.m_findReplaceDialog!.GetFindEntries();
    this.m_replaceStringHistoryList = this.m_findReplaceDialog!.GetReplaceEntries();

    this.m_findReplaceDialog!.Destroy();
    this.m_findReplaceDialog = null;

    this.m_toolManager?.RunAction(ACTIONS.updateFind);
  }

  private m_busSyntaxHelpPresenter: (() => void) | null = null;

  /**
   * `SCH_TEXT::ShowSyntaxHelp( this )` (sch_text.cpp): the modeless Bus Syntax Help, an
   * HTML_MESSAGE_BOX the window shows and raises when it is already open.
   */
  ShowBusSyntaxHelp(): void {
    this.m_busSyntaxHelpPresenter?.();
  }

  SetBusSyntaxHelpPresenter(aPresenter: (() => void) | null): void {
    this.m_busSyntaxHelpPresenter = aPresenter;
  }

  /**
   * `libeditconfig()` (sch_base_frame.cpp:197): SYMBOL_EDITOR_SETTINGS when config() is one -
   * the symbol editor's frame - else null. SYMBOL_EDITOR_SETTINGS is the JSON slice here.
   */
  libeditconfig(): SymbolEditorSettings | null {
    return this.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR) ? currentSymbolEditorSettings() : null;
  }

  eeconfig(): EeschemaSettings | null {
    return this.config() instanceof EESCHEMA_SETTINGS ? currentEeschemaSettings() : null;
  }

  /** `GetRenderSettings` (sch_base_frame.cpp:320): the canvas painter's, or null. */
  GetRenderSettings(): SCH_RENDER_SETTINGS | null {
    const painter = this.GetCanvas()?.GetView()?.GetPainter() ?? null;

    return painter ? (painter.GetSettings() as SCH_RENDER_SETTINGS) : null;
  }

  /**
   * `HighlightSelectionFilter` (sch_base_frame.cpp:998): post the filter options that rejected
   * a click so the selection-filter panel can flash them. The panel is the window's; it listens
   * through {@link SetSelectionFilterListener}.
   */
  HighlightSelectionFilter(aOptions: SCH_SELECTION_FILTER_OPTIONS): void {
    const listener = this.m_selectionFilterListener;

    if (listener) setTimeout(() => listener(aOptions), 0);
  }

  /** The window's handler for SCH_SELECTION_FILTER_EVENT. */
  SetSelectionFilterListener(
    aListener: ((aOptions: SCH_SELECTION_FILTER_OPTIONS) => void) | null,
  ): void {
    this.m_selectionFilterListener = aListener;
  }

  private m_selectionFilterListener: ((aOptions: SCH_SELECTION_FILTER_OPTIONS) => void) | null =
    null;

  /** `ORIGIN_TRANSFORMS`: the schematic has no user origin, so the identity. */
  private readonly m_originTransforms = new ORIGIN_TRANSFORMS();

  constructor(aFrameType: FRAME_T, aIuScale: EdaIuScale = schIUScale, aUnits: EdaUnits = 'mm') {
    super(aFrameType, aIuScale, aUnits);
    this.m_findReplaceData = new SCH_SEARCH_DATA();
  }

  override GetOriginTransforms(): ORIGIN_TRANSFORMS {
    return this.m_originTransforms;
  }

  /** The frame's wx name; each editor answers its own (`SCH_EDIT_FRAME_NAME` here). */
  override GetName(): string {
    return SCH_EDIT_FRAME_NAME;
  }

  /** `SCH_SCREEN* GetScreen() const override` (:185). */
  /** `SCH_DRAW_PANEL* GetCanvas() const override`: the frame's canvas is a schematic panel. */
  override GetCanvas(): SCH_DRAW_PANEL | null {
    return super.GetCanvas() as SCH_DRAW_PANEL | null;
  }

  override GetScreen(): SCH_SCREEN | null {
    return super.GetScreen() as SCH_SCREEN | null;
  }

  /** `SetPageSettings` (:219). */
  SetPageSettings(aPageSettings: PAGE_INFO): void {
    this.GetScreen()!.SetPageSettings(aPageSettings);
  }

  /** `GetPageSettings` (:225). */
  override GetPageSettings(): PAGE_INFO {
    return this.GetScreen()!.GetPageSettings();
  }

  /** `GetPageSizeIU` (:231): the page in schematic IU. */
  GetPageSizeIU(): VECTOR2I {
    return this.GetScreen()!.GetPageSettings().GetSizeIU(schIUScale.IU_PER_MILS);
  }

  /** `GetGridOrigin`: the schematic's grid origin is always (0, 0). */
  override GetGridOrigin(): VECTOR2I {
    return { x: 0, y: 0 };
  }

  /** `SetGridOrigin`: a no-op in the schematic. */
  override SetGridOrigin(_aPoint: VECTOR2I): void {}

  /** `GetTitleBlock` (:238). */
  override GetTitleBlock(): TITLE_BLOCK {
    return this.GetScreen()!.GetTitleBlock();
  }

  /** `SetTitleBlock` (:245). */
  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    this.GetScreen()!.SetTitleBlock(aTitleBlock);
  }

  /** `GetShowAllPins`: the base answers true; the symbol editor overrides it. */
  GetShowAllPins(): boolean {
    return true;
  }

  /** `RedrawScreen` (:293). */
  RedrawScreen(aCenterPoint: VECTOR2I, aWarpPointer: boolean): void {
    const canvas = this.GetCanvas();
    if (!canvas) return;

    canvas.GetView().SetCenter(aCenterPoint);

    if (aWarpPointer) canvas.GetViewControls().CenterOnCursor();

    canvas.Refresh();
  }

  /** `HardRedraw` (:304). */
  override HardRedraw(): void {
    const canvas = this.GetCanvas();

    if (canvas?.GetView()) {
      canvas.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
      canvas.ForceRefresh();
    }
  }

  /** `AddToScreen` (:465-485). */
  AddToScreen(aItem: EDA_ITEM, aScreen: SCH_SCREEN | null = null): void {
    // wxCHECK( aItem, void ): there is no valid reason to pass a null item.
    if (!aItem) return;

    const screen = aScreen ?? this.GetScreen()!;

    if (aItem.Type() !== KICAD_T.SCH_TABLECELL_T) screen.Append(aItem as SCH_ITEM);

    if (screen === this.GetScreen()) {
      this.GetCanvas()?.GetView().Add(aItem);
      this.UpdateItem(aItem, true); // handle any additional parent semantics
    }
  }

  /** `RemoveFromScreen` (:488-503). */
  RemoveFromScreen(aItem: EDA_ITEM, aScreen: SCH_SCREEN | null = null): void {
    const screen = aScreen ?? this.GetScreen()!;

    if (screen === this.GetScreen()) this.GetCanvas()?.GetView().Remove(aItem);

    if (aItem.Type() !== KICAD_T.SCH_TABLECELL_T) screen.Remove(aItem as SCH_ITEM);

    if (screen === this.GetScreen()) this.UpdateItem(aItem, true); // handle any additional parent semantics
  }

  /**
   * `UpdateItem` (:372-428): repaint \a aItem (a sheet pin through its sheet,
   * and the parent of anything a symbol, sheet, label or table draws), and with
   * \a aUpdateRtree re-file it — and a group's children — in the screen's tree.
   *
   * Not ported: `SCH_SHAPE::UpdateHatching()`, which the live shape does not
   * carry (the hatch is the painter's).
   */
  UpdateItem(aItem: EDA_ITEM, isAddOrDelete = false, aUpdateRtree = false): void {
    const parent = aItem.GetParent();
    const view = this.GetCanvas()?.GetView() ?? null;

    if (aItem.Type() === KICAD_T.SCH_SHEET_PIN_T) {
      // Sheet pins aren't in the view.  Refresh their parent.
      if (parent) view?.Update(parent);
    } else {
      if (!isAddOrDelete) view?.Update(aItem);

      // Some children are drawn from their parents.  Mark them for re-paint.
      if (
        parent &&
        (parent.Type() === KICAD_T.SCH_SYMBOL_T ||
          parent.Type() === KICAD_T.SCH_SHEET_T ||
          parent.Type() === KICAD_T.SCH_LABEL_LOCATE_ANY_T ||
          parent.Type() === KICAD_T.SCH_TABLE_T)
      ) {
        view?.Update(parent, VIEW_UPDATE_FLAGS.REPAINT);
      }
    }

    // Be careful when calling this.  Update will invalidate RTree iterators.
    if (aUpdateRtree && isSchItem(aItem)) {
      const screen = this.GetScreen()!;
      screen.Update(aItem);

      // If we are updating the group, we also need to update all the children otherwise
      // their positions will remain stale in the RTree
      if (aItem.Type() === KICAD_T.SCH_GROUP_T) {
        (aItem as unknown as SCH_GROUP).RunOnChildren(
          (item) => screen.Update(item),
          RECURSE_MODE.RECURSE,
        );
      }
    }
  }

  /** `SyncView` (:506-513): let tools re-add what they own, then repaint everything. */
  SyncView(): void {
    // Let tools add things to the view if necessary
    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);

    this.GetCanvas()?.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
  }

  /** `GetLayerColor` (:516). */
  GetLayerColor(aLayer: SCH_LAYER_ID): Color4d {
    return this.GetColorSettings().GetColor(aLayer);
  }

  /**
   * `GetColorSettings` (:620-640): the theme `SchColorThemeName` picks, loaded
   * once and kept until a refresh is forced.
   */
  override GetColorSettings(aForceRefresh = false): COLOR_SETTINGS {
    if (!this.m_colorSettings || aForceRefresh) {
      const colorTheme = SchColorThemeName(
        this.GetFrameType(),
        currentEeschemaSettings().appearance.color_theme,
        currentSymbolEditorSettings(),
      );

      this.m_colorSettings = PgmGetColorSettings(colorTheme);
    }

    return this.m_colorSettings;
  }

  /** `GetDrawBgColor` (:643). */
  override GetDrawBgColor(): Color4d {
    return this.GetColorSettings().GetColor(SCH_LAYER_ID.LAYER_SCHEMATIC_BACKGROUND);
  }
}

/**
 * `dynamic_cast<SCH_ITEM*>( aItem )`: every concrete SCH_ITEM type sits between
 * `SCH_SHAPE_T` and `SCH_SHEET_T` (`include/core/typeinfo.h`).
 */
function isSchItem(aItem: EDA_ITEM): aItem is SCH_ITEM {
  const t = aItem.Type();
  return t >= KICAD_T.SCH_SHAPE_T && t <= KICAD_T.SCH_SHEET_T;
}

/** `aExtraCheckboxes`: a label and the bool it reads and writes (`std::pair<wxString, bool*>`). */
export interface EDA_LIST_EXTRA_CHECKBOX {
  label: string;
  value: { value: boolean };
}

/**
 * `EDA_LIST_DIALOG( this, aTitle, aHeaders, aItems, aSelection, aSortList )` as SelectLibrary sets
 * it up; the window fills `textSelection` (`GetTextSelection()`) and the check boxes' values, and
 * ends with wxID_OK, wxID_CANCEL or the extra button's id.
 */
export interface EDA_LIST_DIALOG_ARG {
  title: string;
  headers: string[];
  items: LIBRARY_LIST_ITEM[];
  selection: string;
  sortList: boolean;
  listLabel: string;
  extraCheckboxes: { label: string; value: boolean }[];
  extraButton: { id: number; label: string } | null;
  textSelection: string;
}
