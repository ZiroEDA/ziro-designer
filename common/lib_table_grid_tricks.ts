// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIB_TABLE_GRID_TRICKS` (common/lib_table_grid_tricks.cpp,
 * include/lib_table_grid_tricks.h): GRID_TRICKS for a library table grid.
 *
 *  - the status column's button: a row's load error, its settings dialog, or
 *    "open the nested table" (`onGridCellLeftClick`);
 *  - the context menu gains Activate / Deactivate Selected, Set / Unset
 *    Visible Flag, Edit Options..., Edit Settings... and Open Library Table,
 *    and a read-only table shows none of the cut / paste rows - nor, since the
 *    base class is what pops the menu up, any menu at all (10.0.5's own);
 *  - a double-click on Options opens the options editor;
 *  - pasting a `(sym_lib_table …` / `(fp_lib_table …` clipboard inserts its
 *    rows at the top, and spreadsheet text pastes from column 0 of the
 *    cursor's row;
 *  - the static row handlers the panels' buttons call, and `VerifyTable`,
 *    which OK runs.
 *
 * `wxBell()` has no sound here; the places it rings do nothing else, as
 * upstream's do. `AutoSizeColumns` after a paste is the view's: a column is
 * as wide as its text already.
 */
import { GetClipboardText } from './clipboard.js';
import { DisplayErrorMessage } from './confirm.js';
import { GRID_TRICKS, GRIDTRICKS_FIRST_CLIENT_ID } from './grid_tricks.js';
import { LIB_ID } from './lib_id.js';
import {
  COL_NICKNAME,
  COL_OPTIONS,
  COL_STATUS,
  COL_URI,
  COL_VISIBLE,
  LIB_TABLE_GRID_DATA_MODEL,
} from './libraries/lib_table_grid_data_model.js';
import { LIBRARY_TABLE, LIBRARY_TABLE_ROW } from './libraries/library_table.js';
import type { WX_GRID } from './widgets/wx_grid.js';
import { type wxGridEvent, wxGridTableRequest } from './wx/grid.js';
import type { wxMenu, wxMenuEvent } from './wx/menu.js';
import { type wxKeyEvent, wxMOD_CONTROL } from './wx/wx_event.js';

const LIB_TABLE_GRID_TRICKS_ACTIVATE_SELECTED = GRIDTRICKS_FIRST_CLIENT_ID;
const LIB_TABLE_GRID_TRICKS_DEACTIVATE_SELECTED = GRIDTRICKS_FIRST_CLIENT_ID + 1;
const LIB_TABLE_GRID_TRICKS_SET_VISIBLE = GRIDTRICKS_FIRST_CLIENT_ID + 2;
const LIB_TABLE_GRID_TRICKS_UNSET_VISIBLE = GRIDTRICKS_FIRST_CLIENT_ID + 3;
const LIB_TABLE_GRID_TRICKS_LIBRARY_SETTINGS = GRIDTRICKS_FIRST_CLIENT_ID + 4;
const LIB_TABLE_GRID_TRICKS_OPEN_TABLE = GRIDTRICKS_FIRST_CLIENT_ID + 5;
const LIB_TABLE_GRID_TRICKS_OPTIONS_EDITOR = GRIDTRICKS_FIRST_CLIENT_ID + 6;

/** The grid's table, which is always a library table model here. */
const modelOf = (aGrid: WX_GRID): LIB_TABLE_GRID_DATA_MODEL =>
  aGrid.GetTable() as LIB_TABLE_GRID_DATA_MODEL;

function isGridReadOnly(aGrid: WX_GRID): boolean {
  const tbl = aGrid.GetTable();
  return tbl instanceof LIB_TABLE_GRID_DATA_MODEL && tbl.Table().IsReadOnly();
}

export abstract class LIB_TABLE_GRID_TRICKS extends GRID_TRICKS {
  /**
   * `LIB_TABLE_GRID_TRICKS( aGrid [, aAddHandler] )`. Upstream reconnects the
   * char hook to its own `onCharHook`; the base class here dispatches to the
   * override already.
   */
  // biome-ignore lint/complexity/noUselessConstructor: the two upstream constructors are one here
  constructor(aGrid: WX_GRID, aAddHandler: (() => void) | null = null) {
    super(aGrid, aAddHandler);
  }

  protected abstract optionsEditor(aRow: number): void;
  protected abstract openTable(aRow: LIBRARY_TABLE_ROW): void;
  protected abstract supportsVisibilityColumn(): boolean;
  /** `getTablePreamble`: `(sym_lib_table`, `(fp_lib_table`, … */
  protected abstract getTablePreamble(): string;

  protected override onGridCellLeftClick(aEvent: wxGridEvent): void {
    if (aEvent.GetCol() === COL_STATUS) {
      // Status column button action depends on row:
      // Normal rows should have no button, so they are a no-op
      // Errored rows should have the warning button, so we show their error
      // Configurable libraries will have the options button, so we launch the config
      // Chained tables will have the open button, so we request the table be opened
      const table = modelOf(this.m_grid);
      const row = table.At(aEvent.GetRow());
      const adapter = table.Adapter();

      const title =
        row.Type() === 'Table'
          ? `Error loading library table '${row.Nickname()}'`
          : `Error loading library '${row.Nickname()}'`;

      const libraryError = adapter?.LibraryError(row.Nickname());

      if (!row.IsOk()) {
        DisplayErrorMessage(title, row.ErrorDescription());
      } else if (libraryError) {
        DisplayErrorMessage(title, libraryError.message);
      } else if (adapter?.SupportsConfigurationDialog(row.Nickname())) {
        adapter.ShowConfigurationDialog(row.Nickname());
      } else if (row.Type() === LIBRARY_TABLE_ROW.TABLE_TYPE_NAME) {
        this.openTable(row);
      }

      aEvent.Skip();
    } else {
      super.onGridCellLeftClick(aEvent);
    }
  }

  protected override showPopupMenu(aMenu: wxMenu, aEvent: wxGridEvent): void {
    // Ensure selection parameters are up to date
    this.getSelectedArea();

    const tbl = modelOf(this.m_grid);

    if (this.m_sel_row_start < 0 || this.m_sel_row_start >= tbl.GetNumberRows()) return;

    const firstRow = tbl.At(this.m_sel_row_start);
    const readOnly = tbl.Table().IsReadOnly();

    let showSettings = false;
    let showOpen = false;

    if (!readOnly) {
      const adapter = tbl.Adapter();

      if (adapter) {
        const nickname = tbl.GetValue(this.m_sel_row_start, COL_NICKNAME);

        if (this.m_sel_row_count === 1 && adapter.SupportsConfigurationDialog(nickname)) {
          showSettings = true;
          aMenu.Append(LIB_TABLE_GRID_TRICKS_LIBRARY_SETTINGS, 'Edit Settings...');
        }
      }
    }

    if (firstRow.Type() === LIBRARY_TABLE_ROW.TABLE_TYPE_NAME) {
      showOpen = true;
      aMenu.Append(LIB_TABLE_GRID_TRICKS_OPEN_TABLE, 'Open Library Table');
    }

    if (showSettings || showOpen) aMenu.AppendSeparator();

    let showActivate = false;
    let showDeactivate = false;
    let showSetVisible = false;
    let showUnsetVisible = false;
    let showOptions = false;

    // 10.0.5 asks columns 0 and 1 for the two flags, which since COL_STATUS
    // was put first are the status column and Enable. GetValueAsBool answers
    // false for the status column, so every selection offers "Activate
    // Selected", and the visible pair follows Enable. doPopupSelection writes
    // the same two columns, so Activate / Deactivate change nothing and the
    // visible pair toggles Enable. Upstream's own, kept.
    for (let row = this.m_sel_row_start; row < this.m_sel_row_start + this.m_sel_row_count; ++row) {
      if (tbl.GetValueAsBool(row, 0)) showDeactivate = true;
      else showActivate = true;

      if (tbl.GetValueAsBool(row, 1)) showUnsetVisible = true;
      else showSetVisible = true;

      if (showActivate && showDeactivate && showSetVisible && showUnsetVisible) break;
    }

    if (showActivate) aMenu.Append(LIB_TABLE_GRID_TRICKS_ACTIVATE_SELECTED, 'Activate Selected');

    if (showDeactivate)
      aMenu.Append(LIB_TABLE_GRID_TRICKS_DEACTIVATE_SELECTED, 'Deactivate Selected');

    if (this.supportsVisibilityColumn()) {
      if (showSetVisible) aMenu.Append(LIB_TABLE_GRID_TRICKS_SET_VISIBLE, 'Set Visible Flag');

      if (showUnsetVisible) aMenu.Append(LIB_TABLE_GRID_TRICKS_UNSET_VISIBLE, 'Unset Visible Flag');
    }

    if (
      !readOnly &&
      this.m_sel_row_count === 1 &&
      firstRow.Type() !== LIBRARY_TABLE_ROW.TABLE_TYPE_NAME
    ) {
      showOptions = true;
      aMenu.Append(
        LIB_TABLE_GRID_TRICKS_OPTIONS_EDITOR,
        'Edit Options...',
        'Edit options for this library entry',
      );
    }

    if (showActivate || showDeactivate || showSetVisible || showUnsetVisible || showOptions)
      aMenu.AppendSeparator();

    // For read-only tables, only show activate/deactivate and visible options (no cut/paste/delete)
    if (!readOnly) super.showPopupMenu(aMenu, aEvent);
  }

  protected override doPopupSelection(aEvent: wxMenuEvent): void {
    const menu_id = aEvent.GetId();
    const tbl = modelOf(this.m_grid);

    if (menu_id === LIB_TABLE_GRID_TRICKS_OPTIONS_EDITOR) {
      this.optionsEditor(this.m_grid.GetGridCursorRow());
    } else if (
      menu_id === LIB_TABLE_GRID_TRICKS_ACTIVATE_SELECTED ||
      menu_id === LIB_TABLE_GRID_TRICKS_DEACTIVATE_SELECTED
    ) {
      const selected_state = menu_id === LIB_TABLE_GRID_TRICKS_ACTIVATE_SELECTED;

      for (let row = this.m_sel_row_start; row < this.m_sel_row_start + this.m_sel_row_count; ++row)
        tbl.SetValueAsBool(row, 0, selected_state);

      // Ensure the new state (on/off) of the widgets is immediately shown:
      this.m_grid.Refresh();
    } else if (
      menu_id === LIB_TABLE_GRID_TRICKS_SET_VISIBLE ||
      menu_id === LIB_TABLE_GRID_TRICKS_UNSET_VISIBLE
    ) {
      const selected_state = menu_id === LIB_TABLE_GRID_TRICKS_SET_VISIBLE;

      for (let row = this.m_sel_row_start; row < this.m_sel_row_start + this.m_sel_row_count; ++row)
        tbl.SetValueAsBool(row, 1, selected_state);

      // Ensure the new state (on/off) of the widgets is immediately shown:
      this.m_grid.Refresh();
    } else if (menu_id === LIB_TABLE_GRID_TRICKS_LIBRARY_SETTINGS) {
      const row = tbl.At(this.m_sel_row_start);
      tbl.Adapter()?.ShowConfigurationDialog(row.Nickname());
    } else if (menu_id === LIB_TABLE_GRID_TRICKS_OPEN_TABLE) {
      this.openTable(tbl.At(this.m_sel_row_start));
    } else {
      super.doPopupSelection(aEvent);
    }
  }

  /**
   * `onCharHook`: Ctrl+V into an open cell editor with multi-cell text
   * pastes rows - but only into a row that has no nickname yet.
   */
  protected override onCharHook(aEvent: wxKeyEvent): void {
    if (
      aEvent.GetModifiers() === wxMOD_CONTROL &&
      aEvent.GetKeyCode() === 'V'.charCodeAt(0) &&
      this.m_grid.IsCellEditControlShown()
    ) {
      let text = GetClipboardText();

      if (text !== null) {
        if (!text.includes('\t') && text.includes(',')) text = text.replaceAll(',', '\t');

        if (text.includes('\t') || text.includes('\n') || text.includes('\r')) {
          this.m_grid.CancelPendingChanges();
          const row = this.m_grid.GetGridCursorRow();

          // Check if the current row already has data (has a nickname)
          const table = this.m_grid.GetTable();

          if (table && row >= 0 && row < table.GetNumberRows()) {
            // Row already has data, don't allow pasting over it (wxBell)
            if (table.GetValue(row, COL_NICKNAME) !== '') return;
          }

          this.m_grid.ClearSelection();
          this.m_grid.SelectRow(row);
          this.m_grid.SetGridCursor(row, 0);
          this.getSelectedArea();
          this.paste_text(text);
          this.m_grid.ForceRefresh();
          return;
        }
      }
    }

    super.onCharHook(aEvent);
  }

  /**
   * `paste_text`: s-expression rows starting with the table preamble are
   * inserted at the top of the table (starting at column 0 regardless of the
   * cursor); anything else is spreadsheet text for GRID_TRICKS.
   */
  protected override paste_text(aCbText: string): void {
    const tbl = modelOf(this.m_grid);

    // wxBell()
    if (tbl.Table().IsReadOnly()) return;

    if (aCbText.includes(this.getTablePreamble())) {
      // paste the LIB_TABLE_ROWs of s-expr, starting at column 0 regardless of current cursor column.
      const tempTable = new LIBRARY_TABLE(true, aCbText, tbl.Table().Scope());

      if (tempTable.IsOk()) {
        tbl
          .Table()
          .Rows()
          .splice(0, 0, ...tempTable.Rows());

        tbl
          .GetView()
          ?.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_INSERTED, 0, 0);
      } else {
        DisplayErrorMessage(tempTable.ErrorDescription());
      }
    } else {
      let text = aCbText;

      if (!text.includes('\t') && text.includes(',')) text = text.replaceAll(',', '\t');

      if (text.includes('\t')) {
        const row = this.m_grid.GetGridCursorRow();
        this.m_grid.ClearSelection();
        this.m_grid.SelectRow(row);
        this.m_grid.SetGridCursor(row, 0);
        this.getSelectedArea();
      }

      super.paste_text(text);
    }
  }

  protected override handleDoubleClick(aEvent: wxGridEvent): boolean {
    if (aEvent.GetCol() === COL_OPTIONS) {
      this.optionsEditor(aEvent.GetRow());
      return true;
    }

    return false;
  }

  /** `AppendRowHandler`: a row at the end, its Nickname cell open. */
  static AppendRowHandler(aGrid: WX_GRID): void {
    // wxBell()
    if (isGridReadOnly(aGrid)) return;

    aGrid.OnAddRow(() => {
      aGrid.AppendRows(1);
      return [aGrid.GetNumberRows() - 1, COL_NICKNAME];
    });
  }

  /**
   * `DeleteRowHandler`: every row that is selected or holds a selected cell,
   * else the cursor's; the cursor stays on the same index.
   */
  static DeleteRowHandler(aGrid: WX_GRID): void {
    // wxBell()
    if (isGridReadOnly(aGrid)) return;

    if (!aGrid.CommitPendingChanges()) return;

    aGrid.BeginBatch();

    try {
      const curRow = aGrid.GetGridCursorRow();
      const curCol = aGrid.GetGridCursorCol();

      // In a wxGrid, collect rows that have a selected cell, or are selected
      // It is not so easy: it depends on the way the selection was made.
      // Here, we collect rows selected by clicking on a row label, and rows that contain
      // previously-selected cells.
      // If no candidate, just delete the row with the grid cursor.
      const selectedRows = [...aGrid.GetSelectedRows()];
      const cells = aGrid.GetSelectedCells();
      const blockTopLeft = aGrid.GetSelectionBlockTopLeft();
      const blockBotRight = aGrid.GetSelectionBlockBottomRight();

      // Add all row having cell selected to list:
      for (const cell of cells) selectedRows.push(cell.GetRow());

      // Handle block selection
      if (blockTopLeft.length && blockBotRight.length) {
        for (let i = blockTopLeft[0]!.GetRow(); i <= blockBotRight[0]!.GetRow(); ++i)
          selectedRows.push(i);
      }

      // Use the row having the grid cursor only if we have no candidate:
      if (selectedRows.length === 0 && aGrid.GetGridCursorRow() >= 0)
        selectedRows.push(aGrid.GetGridCursorRow());

      // wxBell()
      if (selectedRows.length === 0) return;

      selectedRows.sort((a, b) => a - b);

      // Remove selected rows (note: a row can be stored more than once in list)
      let last_row = -1;

      // Needed to avoid a wxWidgets alert if the row to delete is the last row
      // at least on wxMSW 3.2
      aGrid.ClearSelection();

      for (let ii = selectedRows.length - 1; ii >= 0; ii--) {
        const row = selectedRows[ii]!;

        if (row !== last_row) {
          last_row = row;
          aGrid.DeleteRows(row, 1);
        }
      }

      if (aGrid.GetNumberRows() > 0 && curRow >= 0)
        aGrid.SetGridCursor(Math.min(curRow, aGrid.GetNumberRows() - 1), curCol);
    } finally {
      aGrid.EndBatch();
    }
  }

  static MoveUpHandler(aGrid: WX_GRID): void {
    // wxBell()
    if (isGridReadOnly(aGrid)) return;

    aGrid.OnMoveRowUp((row) => {
      const rows = modelOf(aGrid).Table().Rows();
      const curRow = aGrid.GetGridCursorRow();
      [rows[curRow - 1], rows[curRow]] = [rows[curRow]!, rows[curRow - 1]!];

      // Update the wxGrid
      aGrid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_INSERTED, row - 1, 0);
    });
  }

  static MoveDownHandler(aGrid: WX_GRID): void {
    // wxBell()
    if (isGridReadOnly(aGrid)) return;

    aGrid.OnMoveRowDown((row) => {
      const rows = modelOf(aGrid).Table().Rows();
      const curRow = aGrid.GetGridCursorRow();
      [rows[curRow], rows[curRow + 1]] = [rows[curRow + 1]!, rows[curRow]!];

      // Update the wxGrid
      aGrid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_INSERTED, row, 0);
    });
  }

  /**
   * `VerifyTable`: silently drop rows with no library path, trim the rest,
   * and refuse a missing, illegal or duplicated nickname - the error handler
   * puts the cursor on the offending cell before the message shows.
   */
  static VerifyTable(
    aGrid: WX_GRID,
    aSupportsVisibilityColumn: boolean,
    aErrorHandler: (aRow: number, aCol: number) => void,
  ): boolean {
    const model = modelOf(aGrid);
    let msg: string;

    for (let r = 0; r < model.GetNumberRows(); ) {
      const nick = model.GetValue(r, COL_NICKNAME).trim();
      const uri = model.GetValue(r, COL_URI).trim();
      const illegalCh = nick ? LIB_ID.FindIllegalLibraryNameChar(nick) : 0;

      if (!uri) {
        // Silently nuke rows that have no libraray URI
        model.DeleteRows(r, 1);
      } else if (!nick || illegalCh) {
        if (!nick) msg = 'Library must have a nickname.';
        else msg = `Illegal character '${String.fromCodePoint(illegalCh)}' in nickname '${nick}'.`;

        aErrorHandler(r, COL_NICKNAME);
        // KICAD_MESSAGE_DIALOG( topLevelParent, msg, _( "Library Nickname Error" ) )
        DisplayErrorMessage(msg);
        return false;
      } else {
        // set the trimmed values back into the table so they get saved to disk.
        model.SetValue(r, COL_NICKNAME, nick);
        model.SetValue(r, COL_URI, uri);

        // Make sure to not save an inappropriate hidden flag
        if (!aSupportsVisibilityColumn) model.SetValue(r, COL_VISIBLE, '1');

        ++r; // this row was OK.
      }
    }

    // check for duplicate nickNames
    for (let r1 = 0; r1 < model.GetNumberRows() - 1; ++r1) {
      const nick1 = model.GetValue(r1, COL_NICKNAME);

      for (let r2 = r1 + 1; r2 < model.GetNumberRows(); ++r2) {
        const nick2 = model.GetValue(r2, COL_NICKNAME);

        if (nick1 === nick2) {
          msg = `Multiple libraries cannot share the same nickname ('${nick1}').`;

          // go to the lower of the two rows, it is technically the duplicate:
          aErrorHandler(r2, 1);
          DisplayErrorMessage(msg);
          return false;
        }
      }
    }

    return true;
  }
}
