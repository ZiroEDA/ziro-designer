// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What `PANEL_SYM_LIB_TABLE` (eeschema/dialogs/panel_sym_lib_table.cpp) and
 * `PANEL_FP_LIB_TABLE` (pcbnew/dialogs/panel_fp_lib_table.cpp) both are,
 * installed in DIALOG_EDIT_LIBRARY_TABLES: a notebook of library tables -
 * "Global Libraries", then "Project Specific Libraries" - each page a
 * LIB_TABLE_NOTEBOOK_PANEL whose WX_GRID carries a LIB_TABLE_GRID_DATA_MODEL
 * and the panel's LIB_TABLE_GRID_TRICKS; under it the add / Add Existing /
 * up / down / delete buttons, and the read-only "Available path
 * substitutions" grid.
 *
 * Upstream writes the two panels out twice, the same code over a different
 * IO manager. Here the shared part is written once and each dialog states
 * its differences (`LibTablePanelSpec`): the table type, the tricks' preamble
 * and Show column, the path variable, the check a row gets, the project items
 * "Add Existing" offers.
 *
 * Web deltas, all about files the browser cannot reach:
 *
 *  - Before the library manager has a global table, the global page is the
 *    hosted library set alone: a LIBRARY_TABLE the dialog builds, with no
 *    file, so nothing on it changes - not even Enable / Show, which upstream
 *    keeps as overrides against the table's file.
 *  - "Add Existing" is a list of the project's library files not yet in the
 *    table, and the file dialog upstream's SPLIT_BUTTON opens, onto the
 *    computer: what it picks is copied into the project on OK.
 *    A nickname already in the table is skipped (upstream asks "Skip" / "Add
 *    Anyway").
 *  - The Library Format choice offers "KiCad" only: the one format the
 *    browser reads (upstream lists every IO plugin it was built with). A row
 *    in another format keeps its text.
 *  - Migrate Libraries converts legacy files on disk, and is not here.
 *  - The page shown first is the project's, as this dialog always opened.
 */
import { type JSX, type ReactNode, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { MenuItem } from '@ziroeda/wx/menu.js';
import { DIALOG_EDIT_LIBRARY_TABLES } from './dialog_edit_library_tables.js';
import { DIALOG_PLUGIN_OPTIONS } from './dialog_plugin_options.js';
import {
  DisplayInfoMessage,
  handleUnsavedChanges,
  IsOK,
  ShowKicadMessageDialog,
  type UnsavedChangesResult,
} from '../confirm.js';
import { UnsavedChangesDialog } from './dialog_unsaved_changes.js';
import { LIB_ID } from '../lib_id.js';
import { LIB_TABLE_GRID_TRICKS } from '../lib_table_grid_tricks.js';
import {
  type LIB_TABLE_NOTEBOOK,
  LIB_TABLE_NOTEBOOK_PANEL,
  LibTableNotebookView,
} from '../lib_table_notebook_panel.js';
import {
  COL_NICKNAME,
  COL_OPTIONS,
  COL_TYPE,
  COL_URI,
  COL_VISIBLE,
  LIB_TABLE_GRID_DATA_MODEL,
} from '../libraries/lib_table_grid_data_model.js';
import {
  LIBRARY_MANAGER,
  LIBRARY_MANAGER_ADAPTER,
  type LIB_DATA,
  type LIB_STATUS,
  LOAD_STATUS,
} from '../libraries/library_manager.js';
import {
  LIBRARY_ERROR,
  type LIBRARY_RESULT,
  LIBRARY_TABLE,
  LIBRARY_TABLE_OK,
  LIBRARY_TABLE_ROW,
  LIBRARY_TABLE_SCOPE,
  type LIBRARY_TABLE_TYPE,
} from '../libraries/library_table.js';
import { PgmOrNull } from '../pgm_base.js';
import type { KICAD_SETTINGS } from '../settings/kicad_settings.js';
import { wxICON_ERROR, wxOK } from '@ziroeda/wx/defs.js';
import type { WX_GRID } from '../widgets/wx_grid.js';
import { wxAuiNotebook } from '@ziroeda/wx/aui_notebook.js';
import { wxReadFileSync } from '@ziroeda/wx/filefn.js';

/** `m_pluginChoices`: the formats this build reads (see the file comment). */
const PLUGIN_CHOICES = ['KiCad'];

/** A library file in the project, which "Add Existing" can register. */
export interface ExistingLibrary {
  /** `fn.GetName()`: the nickname it is added under, before FixIllegalChars. */
  name: string;
  /** The row's URI, `${KIPRJMOD}`-relative. */
  uri: string;
  /** What the list shows. */
  label: string;
}

/** What one library-table dialog is, beyond the shared panel. */
/**
 * What PANEL_SYM_LIB_TABLE and PANEL_FP_LIB_TABLE hand their bases: the members each base
 * declares, built by the shared class. The two bases differ only in borders and spacers.
 */
export interface LIB_TABLE_BASE_PROPS {
  m_notebook: ReactNode;
  onAppend: () => void;
  /** m_browseButton's menu: the project's libraries no row names yet. */
  browseMenu: MenuItem[];
  /** m_resetGlobal's `onReset`, and whether it is enabled (the global page is the one shown). */
  onReset?: () => void;
  resetEnabled?: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

/** The two places a library lives: the Global Libraries page's and the project's. */
export type LIB_TABLE_SCOPE = 'global' | 'project';

export interface LibTablePanelSpec {
  /** DIALOG_EDIT_LIBRARY_TABLES' title: "Symbol Libraries", "Footprint Libraries". */
  title: string;
  type: LIBRARY_TABLE_TYPE;
  /** `getTablePreamble`: `(sym_lib_table`, `(fp_lib_table`. */
  preamble: string;
  /** `SupportsVisibilityColumn`: symbols have Show, footprints hide it. */
  supportsVisibilityColumn: boolean;
  /** The versioned path variable the substitutions list always shows ("SYMBOL_DIR"). */
  dirVarBase: string;
  /**
   * The global table: the library manager's own (the user's table, which chains the hosted set),
   * or the hosted libraries alone, read-only, where the manager has none.
   */
  globalTable: LIBRARY_TABLE;
  /**
   * The project table, a working copy of which the project page edits. Absent with no project
   * open: `LIBRARY_MANAGER::Table( PROJECT )` has no value, and the panel adds the global page
   * alone.
   */
  projectTable?: LIBRARY_TABLE;
  /**
   * The adapter's load of one row (`LoadOne` through the plugin): undefined
   * when the row is nothing this page can check.
   */
  checkRow: (aRow: LIBRARY_TABLE_ROW) => LIB_STATUS | undefined;
  /** Whether a nested table's file exists, for `createPlugin`'s Table row. */
  nestedTableExists: (aRow: LIBRARY_TABLE_ROW) => boolean;
  /**
   * The library files of \a aScope's place - the account's folder, the project - that no row of
   * \a aRows registers: "Add Existing"'s list for that page.
   */
  existing: (
    aRows: readonly LIBRARY_TABLE_ROW[],
    aScope: LIB_TABLE_SCOPE,
  ) => readonly ExistingLibrary[];
  /**
   * `browseLibrariesHandler`'s file dialog: libraries picked off the computer, which the dialog
   * holds and writes into \a aScope's place on OK. Each comes back as a row to add.
   */
  browse?: {
    label: string;
    pick: (aScope: LIB_TABLE_SCOPE) => Promise<readonly ExistingLibrary[]>;
    /** The pages it serves; all of them when absent. */
    scopes?: readonly LIB_TABLE_SCOPE[];
  };
  /**
   * The path a row added with the add button gets from its nickname: a new, empty library in
   * \a aScope's place, which OK makes. Absent, the row keeps whatever path it was given.
   */
  newLibraryUri?: (aScope: LIB_TABLE_SCOPE, aNickname: string) => string;
  /** OK, before the global table is saved: the library files its rows name, written. */
  beforeGlobalSave?: (aRows: readonly LIBRARY_TABLE_ROW[]) => void;
  /** OK with a changed project table. */
  onSave: (aTable: LIBRARY_TABLE) => void;
  onClose: () => void;
  /** PANEL_SYM_LIB_TABLE_BASE or PANEL_FP_LIB_TABLE_BASE. */
  Base: (p: LIB_TABLE_BASE_PROPS) => JSX.Element;
}

/**
 * The adapter the grids ask: `createPlugin` knows the KiCad format and a
 * nested table, `LoadOne` is the spec's check.
 */
class WEB_LIBRARY_ADAPTER extends LIBRARY_MANAGER_ADAPTER {
  constructor(
    private readonly m_type: LIBRARY_TABLE_TYPE,
    private readonly m_spec: Pick<LibTablePanelSpec, 'checkRow' | 'nestedTableExists'>,
  ) {
    super();
  }

  Type(): LIBRARY_TABLE_TYPE {
    return this.m_type;
  }

  LoadOne(aLib: LIB_DATA): LIB_STATUS | undefined {
    return this.m_spec.checkRow(aLib.row);
  }

  protected createPlugin(aRow: LIBRARY_TABLE_ROW): LIBRARY_RESULT<unknown> {
    if (aRow.Type() === LIBRARY_TABLE_ROW.TABLE_TYPE_NAME) {
      if (this.m_spec.nestedTableExists(aRow)) return { ok: false, error: new LIBRARY_TABLE_OK() };

      return {
        ok: false,
        error: new LIBRARY_ERROR(`Nested table '${aRow.URI()}' not found.`),
      };
    }

    return { ok: true, value: aRow.Type() };
  }
}

/**
 * The hosted global table's model: a read-only table refuses Enable and Show
 * too, since no override store reads them here (see the file comment).
 */
class HOSTED_LIB_TABLE_GRID_DATA_MODEL extends LIB_TABLE_GRID_DATA_MODEL {
  override SetValue(aRow: number, aCol: number, aValue: string): void {
    if (this.m_table.IsReadOnly()) return;

    super.SetValue(aRow, aCol, aValue);
  }

  override SetValueAsBool(aRow: number, aCol: number, aValue: boolean): void {
    if (this.m_table.IsReadOnly()) return;

    super.SetValueAsBool(aRow, aCol, aValue);
  }
}

/** `SYMBOL_GRID_TRICKS` / `FP_GRID_TRICKS`. */
class WEB_GRID_TRICKS extends LIB_TABLE_GRID_TRICKS {
  constructor(
    aGrid: WX_GRID,
    aAddHandler: () => void,
    private readonly m_preamble: string,
    private readonly m_visibility: boolean,
    private readonly m_onOptionsEditor: (aGrid: WX_GRID, aRow: number) => void,
    private readonly m_onOpenTable: (aRow: LIBRARY_TABLE_ROW) => void,
  ) {
    super(aGrid, aAddHandler);
    this.SetTooltipEnable(0 /* COL_STATUS */);
  }

  /** DIALOG_PLUGIN_OPTIONS over the row, when the table has it. */
  protected optionsEditor(aRow: number): void {
    const tbl = this.m_grid.GetTable() as LIB_TABLE_GRID_DATA_MODEL;

    if (tbl.GetNumberRows() > aRow) this.m_onOptionsEditor(this.m_grid, aRow);
  }

  /** `openTable( aRow )`: the panel reads the nested table and opens it on a page of its own. */
  protected openTable(aRow: LIBRARY_TABLE_ROW): void {
    this.m_onOpenTable(aRow);
  }

  protected getTablePreamble(): string {
    return this.m_preamble;
  }

  protected supportsVisibilityColumn(): boolean {
    return this.m_visibility;
  }
}

export function LibTablePanel(spec: LibTablePanelSpec): JSX.Element {
  const specRef = useRef(spec);
  specRef.current = spec;

  // The row whose DIALOG_PLUGIN_OPTIONS is up (optionsEditor).
  const [options, setOptions] = useState<{ grid: WX_GRID; row: number } | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const bumpRef = useRef(bump);

  const [{ notebook, addTable, setPageTable }] = useState(() => {
    const nb: LIB_TABLE_NOTEBOOK = new wxAuiNotebook<LIB_TABLE_NOTEBOOK_PANEL>();
    const adapter = new WEB_LIBRARY_ADAPTER(spec.type, {
      checkRow: (r) => specRef.current.checkRow(r),
      nestedTableExists: (r) => specRef.current.nestedTableExists(r),
    });

    // AddTable( table, title, closable ).
    /** A page's grid onto \a aTable: its model, the rows checked, the cursor on the first. */
    const setPageTable = (panel: LIB_TABLE_NOTEBOOK_PANEL, aTable: LIBRARY_TABLE): void => {
      const grid = panel.GetGrid();
      // The hosted set standing in for a global table has no file to keep overrides against;
      // a read-only table read from one (the stock table) takes Enable and Show as upstream's.
      const model =
        aTable.IsReadOnly() && aTable.Path() === ''
          ? new HOSTED_LIB_TABLE_GRID_DATA_MODEL(aTable, adapter, PLUGIN_CHOICES)
          : new LIB_TABLE_GRID_DATA_MODEL(aTable, adapter, PLUGIN_CHOICES);

      grid.SetTable(model, true);
      model.RecheckRows();
      model.SetChangeCallback(() => {
        panel.MarkDirty();
        // The Add Existing list follows the project table.
        bumpRef.current();
      });

      if (grid.GetNumberRows() > 0) {
        grid.SetGridCursor(0, COL_NICKNAME);
        grid.SelectRow(0);
      }
    };

    const addTable = (aTable: LIBRARY_TABLE, aTitle: string, aClosable = false): void => {
      LIB_TABLE_NOTEBOOK_PANEL.AddTable(nb, aTitle, aClosable);

      const panel = nb.GetPage(nb.GetPageCount() - 1);
      const grid = panel.GetGrid();

      setPageTable(panel, aTable);

      // add Cut, Copy, and Paste to wxGrids
      panel.PushEventHandler(
        new WEB_GRID_TRICKS(
          grid,
          () => LIB_TABLE_GRID_TRICKS.AppendRowHandler(grid),
          spec.preamble,
          spec.supportsVisibilityColumn,
          (g, row) => setOptions({ grid: g, row }),
          (row) => openTableRef.current(row),
        ),
      );

      // TransferDataToWindow: no visibility control for footprint libraries.
      if (!spec.supportsVisibilityColumn) grid.HideCol(COL_VISIBLE);

      // Web delta: a library lives in the account (the Global page) or in the project (the
      // Project page), and the program names its file, so there is no path to show or type, no
      // format but KiCad's and no plugin to give options to. The table files keep all three.
      grid.HideCol(COL_URI);
      grid.HideCol(COL_TYPE);
      grid.HideCol(COL_OPTIONS);
    };

    addTable(spec.globalTable, 'Global Libraries');

    if (spec.projectTable) addTable(spec.projectTable, 'Project Specific Libraries');

    nb.SetSelection(nb.GetPageCount() - 1);

    return {
      notebook: nb,
      addTable,
      setPageTable,
    };
  });

  /** The pages always there: the global table's and, with a project open, the project's. */
  const fixedPages = spec.projectTable ? 2 : 1;

  /**
   * `PANEL_SYM_LIB_TABLE::OpenTable( aTable, aTitle )`: a nested table on a closable page of its
   * own, or the page it already has.
   */
  const OpenTable = (aTable: LIBRARY_TABLE, aTitle: string): void => {
    let tabTitle = aTitle;

    if (aTable.IsReadOnly()) tabTitle += ' (read-only)';

    for (let ii = fixedPages; ii < notebook.GetPageCount(); ++ii) {
      if (notebook.GetPageText(ii) === tabTitle) {
        notebook.ChangeSelection(ii);
        return;
      }
    }

    addTable(aTable, tabTitle, true);
    notebook.ChangeSelection(notebook.GetPageCount() - 1);
  };

  /** `SYMBOL_GRID_TRICKS::openTable` / `FP_GRID_TRICKS::openTable`. */
  const openTableRef = useRef((_aRow: LIBRARY_TABLE_ROW): void => {});
  openTableRef.current = (aRow) => {
    const manager = PgmOrNull()?.GetLibraryManager();
    const path = manager?.GetFullURI(aRow, true) ?? aRow.URI();
    const bytes = wxReadFileSync(path);
    const child = LIBRARY_TABLE.FromFile(
      path,
      bytes ? new TextDecoder().decode(bytes) : null,
      LIBRARY_TABLE_SCOPE.GLOBAL,
      spec.type,
    );

    if (!child.IsOk()) {
      void DisplayInfoMessage('Unable to load library table.');
    } else {
      manager?.ApplyLibOverrides(child);
      OpenTable(child, aRow.Nickname());
    }
  };

  /**
   * `onReset`: the global table made again as a new install has it - the stock table chained -
   * and read back. Upstream does this at once, whether or not the dialog is then cancelled.
   */
  const onReset = async (): Promise<void> => {
    if (!cur_grid().CommitPendingChanges()) return;

    const manager = PgmOrNull()?.GetLibraryManager();
    const panel0 = notebook.GetPage(0);

    if (!manager) return;

    // No need to prompt to preserve an empty table
    if (
      panel0.GetGrid().GetNumberRows() > 0 &&
      !(await IsOK(
        'This action will reset your global library table on disk and cannot be undone.',
      ))
    )
      return;

    LIBRARY_MANAGER.CreateGlobalTable(spec.type, true);

    // Go ahead and reload here because this action takes place even if the dialog is canceled
    manager.LoadGlobalTables([spec.type]);

    const newTable = manager.Table(spec.type, LIBRARY_TABLE_SCOPE.GLOBAL);

    if (!newTable) return; // wxASSERT

    setPageTable(panel0, newTable);
    panel0.ClearDirty();
    bump();
  };

  /** The "Save changes to nested library table?" question a closing page asks, while it is up. */
  const [unsaved, setUnsaved] = useState<{
    message: string;
    answer: (aResult: UnsavedChangesResult) => void;
  } | null>(null);

  /** `onNotebookPageCloseRequest`: a closable page closes once it says it can. */
  const onPageClose = (aPage: number): void => {
    const panel = notebook.GetPage(aPage);

    if (!panel.GetClosable()) return;

    void panel
      .GetCanClose(
        (aMessage, aSave) =>
          new Promise<boolean>((resolve) =>
            setUnsaved({
              message: aMessage,
              answer: (aResult) => {
                setUnsaved(null);
                resolve(handleUnsavedChanges(aResult, aSave));
              },
            }),
          ),
      )
      .then((aCanClose) => {
        if (!aCanClose) return;

        const index = notebook.GetPageIndex(panel);

        if (index < 0) return;

        panel.Destroy();
        notebook.DeletePage(index);
      });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the pages and grids are made once
  useLayoutEffect(
    () => () => {
      for (let i = 0; i < notebook.GetPageCount(); ++i) notebook.GetPage(i).Destroy();
    },
    [],
  );

  // Redraw when the page changes.
  useLayoutEffect(() => notebook.AddRefreshListener(bump), [notebook]);

  const cur_grid = (): WX_GRID => notebook.GetPage(notebook.GetSelection()).GetGrid();
  const cur_model = (): LIB_TABLE_GRID_DATA_MODEL =>
    notebook.GetPage(notebook.GetSelection()).GetModel();

  const projectModel = spec.projectTable ? notebook.GetPage(1).GetModel() : null;

  /** The place the page \a aPage's libraries live; none for a nested table's page. */
  const scopeOf = (aPage: number): LIB_TABLE_SCOPE | null =>
    aPage === 0 ? 'global' : aPage === 1 && projectModel ? 'project' : null;

  // Add Existing brings a library into the shown page's place: none for a nested table's page.
  const curScope = scopeOf(notebook.GetSelection());
  const unregistered = curScope ? spec.existing(cur_model().Table().Rows(), curScope) : [];
  const browse =
    curScope && (!spec.browse?.scopes || spec.browse.scopes.includes(curScope))
      ? spec.browse
      : undefined;

  /** `browseLibrariesHandler`, over the project's own files. */
  const addExisting = (aLib: ExistingLibrary): void => {
    const grid = cur_grid();

    if (!grid.CommitPendingChanges()) return;

    const nickname = LIB_ID.FixIllegalChars(aLib.name, true);

    // "Skip" (see the file comment).
    if (cur_model().ContainsNickname(nickname)) return;

    if (grid.AppendRows(1)) {
      const last_row = grid.GetNumberRows() - 1;

      grid.SetCellValue(last_row, COL_NICKNAME, nickname);
      grid.SetCellValue(last_row, COL_TYPE, PLUGIN_CHOICES[0]!);
      grid.SetCellValue(last_row, COL_URI, aLib.uri);
      grid.SetGridCursor(last_row, COL_NICKNAME);
    }
  };

  /** `verifyTables`. */
  const verifyTables = (): boolean => {
    for (let page = 0; page < notebook.GetPageCount(); ++page) {
      const grid = notebook.GetPage(page).GetGrid();

      if (
        !LIB_TABLE_GRID_TRICKS.VerifyTable(grid, spec.supportsVisibilityColumn, (aRow, aCol) => {
          // show the tabbed panel holding the grid we have flunked:
          if (notebook.GetSelection() !== page) notebook.SetSelection(page);

          grid.SetGridCursor(aRow, aCol);
        })
      )
        return false;
    }

    return true;
  };

  /**
   * `TransferDataFromWindow`: each table written only if it changed. The global one is the
   * manager's own - the user's table, when the dialog shows it - assigned, saved, and read back
   * (`InvokeSchEditSymbolLibTable`'s `LoadGlobalTables` on `m_GlobalTableChanged`).
   */
  const onOK = (): void => {
    if (!cur_grid().CommitPendingChanges()) return;

    // A row the add button made has a nickname and no path, which verifyTables would silently
    // drop ("Silently nuke rows that have no library URI"): its path is its new library's.
    if (spec.newLibraryUri) {
      for (let page = 0; page < notebook.GetPageCount(); ++page) {
        const scope = scopeOf(page);
        const model = notebook.GetPage(page).GetModel();

        if (!scope) continue;

        for (let row = 0; row < model.GetNumberRows(); ++row) {
          const nick = model.GetValue(row, COL_NICKNAME).trim();

          if (nick !== '' && model.GetValue(row, COL_URI).trim() === '') {
            model.SetValue(row, COL_URI, spec.newLibraryUri(scope, nick));

            // Its format, which upstream's row is given in Library Format: the one there is.
            if (model.GetValue(row, COL_TYPE).trim() === '')
              model.SetValue(row, COL_TYPE, PLUGIN_CHOICES[0]!);
          }
        }
      }
    }

    if (!verifyTables()) return;

    const manager = PgmOrNull()?.GetLibraryManager();
    const globalTable = manager?.Table(spec.type, LIBRARY_TABLE_SCOPE.GLOBAL);
    const globalModel = notebook.GetPage(0).GetModel();

    // The hosted set standing in (no file) is not the user's table, and is never written over it.
    if (
      manager &&
      globalTable &&
      globalModel.Table().Path() !== '' &&
      !globalModel.Table().equals(globalTable)
    ) {
      spec.beforeGlobalSave?.(globalModel.Table().Rows());

      const saved = globalModel.Table().Save();

      if (!saved.ok)
        void ShowKicadMessageDialog({
          message: `Error saving global library table:\n\n${saved.error.message}`,
          caption: 'File Save Error',
          style: wxOK | wxICON_ERROR,
        });

      manager.LoadGlobalTables([spec.type]);
    }

    // The nested pages: a changed one saved - a read-only one's Enable and Show as overrides -
    // and the global tables read again, which applies them.
    let nestedChanged = false;

    for (let ii = 0; ii < notebook.GetPageCount(); ++ii) {
      const panel = notebook.GetPage(ii);

      if (panel.GetClosable() && panel.TableModified()) {
        panel.SaveTable();
        nestedChanged = true;
      }
    }

    if (manager && nestedChanged) {
      // Web delta: KiCad writes kicad.json, where the overrides are kept, at exit; a page can be
      // closed instead, so it is written now.
      const settingsMgr = PgmOrNull()?.GetSettingsManager();
      const kicad = settingsMgr?.GetAppSettings<KICAD_SETTINGS>('kicad');

      if (settingsMgr && kicad) settingsMgr.Save(kicad);

      manager.LoadGlobalTables([spec.type]);
    }

    const table = projectModel?.Table();

    if (table && spec.projectTable && !table.equals(spec.projectTable)) spec.onSave(table);
    else spec.onClose();
  };

  const optionsRow = options ? (options.grid.GetTable() as LIB_TABLE_GRID_DATA_MODEL) : null;

  return (
    <DIALOG_EDIT_LIBRARY_TABLES title={spec.title} onCancel={spec.onClose} onOK={onOK}>
      <spec.Base
        m_notebook={
          <LibTableNotebookView
            notebook={notebook}
            onPageClose={onPageClose}
            ariaLabel={spec.title}
          />
        }
        onAppend={() => LIB_TABLE_GRID_TRICKS.AppendRowHandler(cur_grid())}
        browseMenu={[
          ...(browse
            ? [
                {
                  label: browse.label,
                  action: () => {
                    void browse.pick(curScope!).then((libs) => {
                      for (const lib of libs) addExisting(lib);
                    });
                  },
                },
              ]
            : []),
          ...unregistered.map((lib) => ({
            label: lib.label,
            action: () => addExisting(lib),
          })),
        ]}
        onMoveUp={() => LIB_TABLE_GRID_TRICKS.MoveUpHandler(cur_grid())}
        onMoveDown={() => LIB_TABLE_GRID_TRICKS.MoveDownHandler(cur_grid())}
        onDelete={() => LIB_TABLE_GRID_TRICKS.DeleteRowHandler(cur_grid())}
        onReset={() => void onReset()}
        // onPageChange: m_resetGlobal->Enable( m_notebook->GetSelection() == 0 ), with the
        // manager's table to reset.
        resetEnabled={notebook.GetSelection() === 0 && !!PgmOrNull()?.GetLibraryManager()}
      />

      {unsaved && <UnsavedChangesDialog message={unsaved.message} onResult={unsaved.answer} />}

      {options && optionsRow && optionsRow.GetNumberRows() > options.row && (
        // optionsEditor: the KiCad s-expression plugin appends no choices
        // (IO_BASE::GetLibraryOptions), so the list is empty and the grid is
        // the whole of it. The result is set on the row directly, not through
        // SetValue, as upstream's is.
        <DIALOG_PLUGIN_OPTIONS
          nickname={optionsRow.At(options.row).Nickname()}
          pluginOptions={new Map()}
          formattedOptions={optionsRow.At(options.row).Options()}
          onResult={(result) => {
            const row = optionsRow.At(options.row);
            setOptions(null);

            if (result !== null && result !== row.Options()) {
              row.SetOptions(result);
              options.grid.Refresh();
            }
          }}
        />
      )}
    </DIALOG_EDIT_LIBRARY_TABLES>
  );
}

export { hostedLibraryTable } from '../libraries/library_manager.js';

/** `LOAD_STATUS::LOADED`, and the not-found error, for a spec's `checkRow`. */
export const LIB_LOADED: LIB_STATUS = { load_status: LOAD_STATUS.LOADED };
export const libNotFound = (aMessage: string): LIB_STATUS => ({
  load_status: LOAD_STATUS.LOAD_ERROR,
  error: new LIBRARY_ERROR(aMessage),
});
