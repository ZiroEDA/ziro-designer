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
 *  - The global table is the hosted library set: a LIBRARY_TABLE the dialog
 *    builds, read-only, so no row can be added, moved, removed or edited.
 *    Upstream lets a read-only table's Enable / Show change and saves them as
 *    overrides (`SaveOverrides`); nothing here reads such overrides, so those
 *    two refuse too rather than change what nothing honours.
 *  - "Add Existing" is a list of the project's library files not yet in the
 *    table, where upstream's SPLIT_BUTTON opens a file dialog per format.
 *    A nickname already in the table is skipped (upstream asks "Skip" / "Add
 *    Anyway").
 *  - The Library Format choice offers "KiCad" only: the one format the
 *    browser reads (upstream lists every IO plugin it was built with). A row
 *    in another format keeps its text.
 *  - A `Table` row cannot be opened (no nested table is read), so no closable
 *    page ever appears; Reset Libraries and Migrate Libraries act on the
 *    global table and legacy files on disk, and are not here.
 *  - The page shown first is the project's, as this dialog always opened.
 */
import { type JSX, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { DIALOG_EDIT_LIBRARY_TABLES } from './dialog_edit_library_tables.js';
import { DIALOG_PLUGIN_OPTIONS } from './dialog_plugin_options.js';
import { DisplayInfoMessage } from '../confirm.js';
import { ENV_VAR } from '../env_vars.js';
import { GRID_TRICKS } from '../grid_tricks.js';
import { LIB_ID } from '../lib_id.js';
import { LIB_TABLE_GRID_TRICKS } from '../lib_table_grid_tricks.js';
import {
  type LIB_TABLE_NOTEBOOK,
  LIB_TABLE_NOTEBOOK_PANEL,
  LibTableNotebookView,
} from '../lib_table_notebook_panel.js';
import {
  COL_NICKNAME,
  COL_TYPE,
  COL_URI,
  COL_VISIBLE,
  LIB_TABLE_GRID_DATA_MODEL,
} from '../libraries/lib_table_grid_data_model.js';
import {
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
import { PROJECT_VAR_NAME } from '../project.js';
import { StdBitmapButton } from '../widgets/std_bitmap_button.js';
import { WX_GRID } from '../widgets/wx_grid.js';
import { wxAuiNotebook } from '../wx/aui_notebook.js';
import { wxGridStringTable } from '../wx/grid.js';
import { WxGridView } from '../wx/grid_ui.js';
import { wxGetEnv } from '../wx/utils.js';

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
  /** The global table: the hosted libraries, read-only. */
  globalTable: LIBRARY_TABLE;
  /** The project table, a working copy of which the project page edits. */
  projectTable: LIBRARY_TABLE;
  /**
   * The adapter's load of one row (`LoadOne` through the plugin): undefined
   * when the row is nothing this page can check.
   */
  checkRow: (aRow: LIBRARY_TABLE_ROW) => LIB_STATUS | undefined;
  /** Whether a nested table's file exists, for `createPlugin`'s Table row. */
  nestedTableExists: (aRow: LIBRARY_TABLE_ROW) => boolean;
  /** The project's library files no row of the project table registers: "Add Existing"'s list. */
  existing: (aRows: readonly LIBRARY_TABLE_ROW[]) => readonly ExistingLibrary[];
  /** OK with a changed project table. */
  onSave: (aTable: LIBRARY_TABLE) => void;
  onClose: () => void;
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
  ) {
    super(aGrid, aAddHandler);
    this.SetTooltipEnable(0 /* COL_STATUS */);
  }

  /** DIALOG_PLUGIN_OPTIONS over the row, when the table has it. */
  protected optionsEditor(aRow: number): void {
    const tbl = this.m_grid.GetTable() as LIB_TABLE_GRID_DATA_MODEL;

    if (tbl.GetNumberRows() > aRow) this.m_onOptionsEditor(this.m_grid, aRow);
  }

  /** No nested table can be read here: upstream's message for one that failed to load. */
  protected openTable(_aRow: LIBRARY_TABLE_ROW): void {
    void DisplayInfoMessage('Unable to load library table.');
  }

  protected getTablePreamble(): string {
    return this.m_preamble;
  }

  protected supportsVisibilityColumn(): boolean {
    return this.m_visibility;
  }
}

/**
 * `populateEnvironReadOnlyTable`: every `${VAR}` / `$(VAR)` the pages' URIs
 * use, plus KIPRJMOD and the versioned library directory, with their values.
 */
function environVars(aNotebook: LIB_TABLE_NOTEBOOK, aDirVarBase: string): [string, string][] {
  const re = /\$\{(.+?)\}|\$\((.+?)\)/g;
  const unique = new Set<string>();

  for (let page = 0; page < aNotebook.GetPageCount(); ++page) {
    const model = aNotebook.GetPage(page).GetModel();

    for (let row = 0; row < model.GetNumberRows(); ++row)
      for (const m of model.GetValue(row, COL_URI).matchAll(re)) unique.add(m[1] ?? m[2] ?? '');
  }

  // Make sure this special environment variable shows up even if it was
  // not used yet.  It is automatically set by KiCad to the directory holding
  // the current project.
  unique.add(PROJECT_VAR_NAME);
  unique.add(ENV_VAR.GetVersionedEnvVarName(aDirVarBase));

  // std::set< wxString >: ordered.
  return [...unique]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => [`\${${name}}`, wxGetEnv(name) ?? '']);
}

export function LibTablePanel(spec: LibTablePanelSpec): JSX.Element {
  const specRef = useRef(spec);
  specRef.current = spec;

  // The row whose DIALOG_PLUGIN_OPTIONS is up (optionsEditor).
  const [options, setOptions] = useState<{ grid: WX_GRID; row: number } | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const bumpRef = useRef(bump);

  const [{ notebook, pathSubsGrid, pathSubsTricks }] = useState(() => {
    const nb: LIB_TABLE_NOTEBOOK = new wxAuiNotebook<LIB_TABLE_NOTEBOOK_PANEL>();
    const adapter = new WEB_LIBRARY_ADAPTER(spec.type, {
      checkRow: (r) => specRef.current.checkRow(r),
      nestedTableExists: (r) => specRef.current.nestedTableExists(r),
    });

    // AddTable( table, title, closable ).
    const addTable = (aTable: LIBRARY_TABLE, aTitle: string): void => {
      LIB_TABLE_NOTEBOOK_PANEL.AddTable(nb, aTitle, false);

      const panel = nb.GetPage(nb.GetPageCount() - 1);
      const grid = panel.GetGrid();
      const model = aTable.IsReadOnly()
        ? new HOSTED_LIB_TABLE_GRID_DATA_MODEL(aTable, adapter, PLUGIN_CHOICES)
        : new LIB_TABLE_GRID_DATA_MODEL(aTable, adapter, PLUGIN_CHOICES);

      grid.SetTable(model, true);
      model.RecheckRows();
      model.SetChangeCallback(() => {
        panel.MarkDirty();
        // The Add Existing list follows the project table.
        bumpRef.current();
      });

      // add Cut, Copy, and Paste to wxGrids
      panel.PushEventHandler(
        new WEB_GRID_TRICKS(
          grid,
          () => LIB_TABLE_GRID_TRICKS.AppendRowHandler(grid),
          spec.preamble,
          spec.supportsVisibilityColumn,
          (g, row) => setOptions({ grid: g, row }),
        ),
      );

      if (grid.GetNumberRows() > 0) {
        grid.SetGridCursor(0, COL_NICKNAME);
        grid.SelectRow(0);
      }

      // TransferDataToWindow: no visibility control for footprint libraries.
      if (!spec.supportsVisibilityColumn) grid.HideCol(COL_VISIBLE);
    };

    addTable(spec.globalTable, 'Global Libraries');
    addTable(spec.projectTable, 'Project Specific Libraries');
    nb.SetSelection(nb.GetPageCount() - 1);

    // m_path_subs_grid: a two-column WX_GRID, EnableEditing( false ), GRID_TRICKS.
    const subs = new WX_GRID();
    subs.SetTable(new wxGridStringTable(0, 2), true);
    subs.SetColLabelValue(0, 'Name');
    subs.SetColLabelValue(1, 'Value');
    subs.EnableEditing(false);

    return { notebook: nb, pathSubsGrid: subs, pathSubsTricks: new GRID_TRICKS(subs) };
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the pages and grids are made once
  useLayoutEffect(
    () => () => {
      for (let i = 0; i < notebook.GetPageCount(); ++i) notebook.GetPage(i).Destroy();
    },
    [],
  );

  // populateEnvironReadOnlyTable, filled as the constructor does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filled once, as upstream's constructor does
  useLayoutEffect(() => {
    const vars = environVars(notebook, spec.dirVarBase);
    pathSubsGrid.BeginBatch();
    pathSubsGrid.ClearRows();
    pathSubsGrid.AppendRows(vars.length);
    vars.forEach(([name, value], row) => {
      pathSubsGrid.SetCellValue(row, 0, name);
      pathSubsGrid.SetCellValue(row, 1, value);
    });
    pathSubsGrid.EndBatch();
  }, []);

  // Redraw when the page changes.
  useLayoutEffect(() => notebook.AddRefreshListener(bump), [notebook]);

  const cur_grid = (): WX_GRID => notebook.GetPage(notebook.GetSelection()).GetGrid();
  const cur_model = (): LIB_TABLE_GRID_DATA_MODEL =>
    notebook.GetPage(notebook.GetSelection()).GetModel();

  const projectModel = notebook.GetPage(1).GetModel();
  const unregistered = spec.existing(projectModel.Table().Rows());

  /** `browseLibrariesHandler`, over the project's own files. */
  const addExisting = (aLib: ExistingLibrary): void => {
    setBrowseOpen(false);

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

  /** `TransferDataFromWindow`: the project table is written only if it changed. */
  const onOK = (): void => {
    if (!cur_grid().CommitPendingChanges()) return;

    if (!verifyTables()) return;

    const table = projectModel.Table();

    if (!table.equals(spec.projectTable)) spec.onSave(table);
    else spec.onClose();
  };

  const optionsRow = options ? (options.grid.GetTable() as LIB_TABLE_GRID_DATA_MODEL) : null;

  return (
    <DIALOG_EDIT_LIBRARY_TABLES title={spec.title} onCancel={spec.onClose} onOK={onOK}>
      <LibTableNotebookView notebook={notebook} ariaLabel={spec.title} />

      <div className="ze-grid-btns" style={{ position: 'relative' }}>
        <StdBitmapButton
          bitmap="small_plus"
          title="Add empty row to table"
          onClick={() => LIB_TABLE_GRID_TRICKS.AppendRowHandler(cur_grid())}
        />
        <button
          type="button"
          className="ze-btn sm"
          title="Add Existing"
          disabled={unregistered.length === 0}
          onClick={() => setBrowseOpen((v) => !v)}
        >
          Add Existing
        </button>
        {browseOpen && unregistered.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 34,
              zIndex: 20,
              minWidth: 240,
              marginBottom: 4,
              background: 'var(--chrome-bg2)',
              border: '1px solid var(--chrome-border)',
              borderRadius: 3,
              fontSize: 12,
              boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            }}
          >
            {unregistered.map((lib) => (
              <div
                key={lib.uri}
                className="ze-menu-item"
                style={{ padding: '4px 12px', cursor: 'default' }}
                onClick={() => addExisting(lib)}
              >
                {lib.label}
              </div>
            ))}
          </div>
        )}
        <StdBitmapButton
          bitmap="small_up"
          title="Move up"
          onClick={() => LIB_TABLE_GRID_TRICKS.MoveUpHandler(cur_grid())}
        />
        <StdBitmapButton
          bitmap="small_down"
          title="Move down"
          onClick={() => LIB_TABLE_GRID_TRICKS.MoveDownHandler(cur_grid())}
        />
        {/* `bButtonsSizer->Add( 20, 0, 0, wxEXPAND, 5 )`. */}
        <span className="ze-fieldnames-gap" />
        <StdBitmapButton
          bitmap="small_trash"
          title="Remove library from table"
          onClick={() => LIB_TABLE_GRID_TRICKS.DeleteRowHandler(cur_grid())}
        />
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 3 }}>Available path substitutions:</div>
        <div
          className="ze-grid-pane"
          style={{ maxHeight: 92, overflow: 'auto' }}
          title="This is a read-only table which shows pertinent environment variables."
        >
          {/* SetColLabelSize( 0 ), SetRowLabelSize( 0 ); column 1 takes the
              rest (adjustPathSubsGridColumns). */}
          <WxGridView
            grid={pathSubsGrid}
            tricks={pathSubsTricks}
            colLabels={false}
            columns={[{ width: 72 }, { width: 120 }]}
            flexCol={1}
            ariaLabel="Available path substitutions"
          />
        </div>
      </div>

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

/** The hosted library set as the global LIBRARY_TABLE: read-only, "KiCad" rows. */
export function hostedLibraryTable(
  aType: LIBRARY_TABLE_TYPE,
  aNames: readonly string[],
  aUriOf: (aName: string) => string,
): LIBRARY_TABLE {
  const table = LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.GLOBAL, aType);

  for (const name of aNames) {
    const row = table.InsertRow();
    row.SetNickname(name);
    row.SetType('KiCad');
    row.SetURI(aUriOf(name));
  }

  table.SetReadOnly();
  return table;
}

/** `LOAD_STATUS::LOADED`, and the not-found error, for a spec's `checkRow`. */
export const LIB_LOADED: LIB_STATUS = { load_status: LOAD_STATUS.LOADED };
export const libNotFound = (aMessage: string): LIB_STATUS => ({
  load_status: LOAD_STATUS.LOAD_ERROR,
  error: new LIBRARY_ERROR(aMessage),
});
