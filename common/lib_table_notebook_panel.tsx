// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIB_TABLE_NOTEBOOK_PANEL` (common/lib_table_notebook_panel.cpp,
 * include/lib_table_notebook_panel.h): one page of a library-table dialog's
 * notebook - a WX_GRID the panel's owner puts a LIB_TABLE_GRID_DATA_MODEL and
 * a LIB_TABLE_GRID_TRICKS on. `AddTable` builds the page and adds it;
 * `MarkDirty` / `ClearDirty` put and take the " *" on its tab.
 *
 * `LibTableNotebookView` is the page's drawing: the notebook's tabs over the
 * selected page's grid, the status column's buttons drawn as the shared
 * `.ze-gridbtn`.
 *
 * Not here: `TableModified`, `SaveTable`, `SaveOverrides` and `GetCanClose`,
 * which serve a closable page - a nested table opened from a `Table` row, read
 * from and saved to its own file. The browser's library-table dialogs open no
 * nested table (see their `openTable`), so no page is ever closable.
 */
import { type JSX, useLayoutEffect, useReducer } from 'react';
import type { GRID_TRICKS } from './grid_tricks.js';
import {
  COL_OPTIONS,
  COL_TYPE,
  COL_URI,
  type LIB_TABLE_GRID_DATA_MODEL,
} from './libraries/lib_table_grid_data_model.js';
import { GRID_BITMAP_BUTTON_RENDERER } from './widgets/grid_button.js';
import { WX_GRID } from './widgets/wx_grid.js';
import type { wxAuiNotebook } from './wx/aui_notebook.js';
import { wxEVT_GRID_CELL_CHANGING, type wxGridEvent } from './wx/grid.js';
import { type GRID_COLUMN_VIEW, WxGridView } from './wx/grid_ui.js';

export type LIB_TABLE_NOTEBOOK = wxAuiNotebook<LIB_TABLE_NOTEBOOK_PANEL>;

/**
 * `AddTable`'s column sizes, as floors: `SetColSize` 30 / 48 / 48 / 240 / 100
 * / 80 / 240 for the first seven (`CreateGrid( 1, 7 )`), the eighth at wx's
 * default 80 (`WXGRID_DEFAULT_COL_WIDTH`). Enable and Show are
 * `AutoSizeColumn( col, true )`, so they state none; Nickname, Library Path,
 * Library Format and Description are then auto-sized up from these by the
 * panel (`autoSizeCol`), which a floor already is. [data] upstream's numbers.
 */
const COLUMN_SIZES: readonly GRID_COLUMN_VIEW[] = [
  { width: 30 },
  {},
  {},
  { width: 240 },
  { width: 100 },
  { width: 80 },
  { width: 240 },
  { width: 80 },
];

export class LIB_TABLE_NOTEBOOK_PANEL {
  private readonly m_parent: LIB_TABLE_NOTEBOOK;
  private readonly m_grid = new WX_GRID();
  private m_tricks: GRID_TRICKS | null = null;
  private m_closable = false;
  private m_baseTitle = '';

  private readonly onGridCellChangingHandler = (aEvent: wxGridEvent): void =>
    this.onGridCellChanging(aEvent);

  private constructor(aParent: LIB_TABLE_NOTEBOOK) {
    this.m_parent = aParent;
  }

  /** `AddTable( aNotebook, aTitle, aClosable )`: a new page holding an empty grid. */
  static AddTable(aNotebook: LIB_TABLE_NOTEBOOK, aTitle: string, aClosable: boolean): void {
    const panel = new LIB_TABLE_NOTEBOOK_PANEL(aNotebook);
    const grid = panel.m_grid;

    // CreateGrid, EnableGridLines, SetMargins, the label sizes and alignments,
    // DisableColResize: the view's. SetSelectionMode( wxGridSelectRows ) is
    // undone by the owner's SetTable, whose selection mode defaults to cells -
    // wxGrid::SetTable makes a new wxGridSelection - so it is not repeated.
    panel.SetClosable(aClosable);

    grid.Connect(wxEVT_GRID_CELL_CHANGING, panel.onGridCellChangingHandler);

    panel.m_baseTitle = aTitle;
    aNotebook.AddPage(panel, aTitle, false);
  }

  /** Drop the grid's handlers (the destructor's `PopEventHandler` / `Unbind`). */
  Destroy(): void {
    this.m_tricks = null;
    this.m_grid.Disconnect(wxEVT_GRID_CELL_CHANGING, this.onGridCellChangingHandler);
  }

  GetGrid(): WX_GRID {
    return this.m_grid;
  }

  GetModel(): LIB_TABLE_GRID_DATA_MODEL {
    return this.m_grid.GetTable() as LIB_TABLE_GRID_DATA_MODEL;
  }

  /** `grid->PushEventHandler( new …_GRID_TRICKS( … ) )`: kept for the view's tooltips. */
  PushEventHandler(aTricks: GRID_TRICKS): void {
    this.m_tricks = aTricks;
  }

  GetTricks(): GRID_TRICKS | null {
    return this.m_tricks;
  }

  /** `PANEL_NOTEBOOK_BASE::SetClosable`. */
  SetClosable(aClosable: boolean): void {
    this.m_closable = aClosable;
  }

  GetClosable(): boolean {
    return this.m_closable;
  }

  MarkDirty(): void {
    const page = this.m_parent.GetPageIndex(this);

    if (page < 0) return;

    if (!this.m_parent.GetPageText(page).endsWith(' *'))
      this.m_parent.SetPageText(page, `${this.m_baseTitle} *`);
  }

  ClearDirty(): void {
    const page = this.m_parent.GetPageIndex(this);

    if (page < 0) return;

    this.m_parent.SetPageText(page, this.m_baseTitle);
  }

  /**
   * `onGridCellChanging`: a Library Path, Format or Options edit is written
   * into the table and the row rechecked at once, so the status button is
   * right before the change is even applied.
   */
  private onGridCellChanging(aEvent: wxGridEvent): void {
    const row = aEvent.GetRow();
    const col = aEvent.GetCol();

    if (col === COL_URI || col === COL_TYPE || col === COL_OPTIONS) {
      const grid = this.GetGrid();
      // The editor is already hidden when CHANGING is sent, so upstream's
      // "editor shown" branch never runs and this is the cell's old value;
      // ApplyEdit's SetValue then rechecks with the new one.
      const editValue = grid.GetCellValue(row, col);

      grid.GetTable()!.SetValue(row, col, editValue);

      const adapter = this.GetModel().Adapter();

      if (adapter) adapter.CheckTableRow(this.GetModel().At(row));

      grid.Refresh();
    }

    aEvent.Skip();
  }
}

/** The notebook's tabs over its selected page's grid. */
export function LibTableNotebookView({
  notebook,
  ariaLabel,
}: {
  notebook: LIB_TABLE_NOTEBOOK;
  ariaLabel?: string;
}): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useLayoutEffect(() => {
    notebook.SetRefreshListener(bump);
    return () => notebook.SetRefreshListener(null);
  }, [notebook]);

  const selection = notebook.GetSelection();
  const page = selection >= 0 ? notebook.GetPage(selection) : null;
  const grid = page?.GetGrid() ?? null;

  return (
    <>
      <div className="ze-tabbar" role="tablist">
        {Array.from({ length: notebook.GetPageCount() }, (_, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a page is its index in the notebook
            key={i}
            type="button"
            role="tab"
            aria-selected={i === selection}
            className={`ze-tab${i === selection ? ' active' : ''}`}
            onClick={() => {
              // A pending edit is committed before the page changes, as
              // wxGrid's focus loss does.
              grid?.CommitPendingChanges(true);
              notebook.SetSelection(i);
            }}
          >
            {notebook.GetPageText(i)}
          </button>
        ))}
      </div>
      {page && grid && (
        <div className="ze-grid-pane" style={{ flex: 1, minHeight: 0 }}>
          <WxGridView
            key={selection}
            grid={grid}
            {...(page.GetTricks() ? { tricks: page.GetTricks()! } : {})}
            columns={COLUMN_SIZES}
            renderCell={(aRow, aCol) => {
              const renderer = grid.GetCellRenderer(aRow, aCol);

              if (!(renderer instanceof GRID_BITMAP_BUTTON_RENDERER)) return null;

              return (
                <span className="ze-gridbtn" aria-hidden="true">
                  <img src={renderer.GetBitmap()} alt="" />
                </span>
              );
            }}
            {...(ariaLabel ? { ariaLabel } : {})}
          />
        </div>
      )}
    </>
  );
}
