// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/grid_tricks.h` + `common/grid_tricks.cpp`: `GRID_TRICKS`, what
 * every KiCad grid does beyond wxGrid - one-click editing and check boxes,
 * the cell and column-label context menus, cut / copy / paste / delete of a
 * rectangle as tab- and newline-separated text, select all, space to toggle,
 * Enter on the last row to add one, Ctrl+Tab out of the grid, and cell
 * tooltips.
 *
 * It connects to a WX_GRID's events as upstream connects to the wxGrid; the
 * view (`widgets/grid_ui.tsx`) turns the page's mouse and keys into them.
 */
import { GetClipboardText, SaveClipboard } from './clipboard.js';
import type { WX_GRID } from './widgets/wx_grid.js';
import {
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_LEFT_CLICK,
  wxEVT_GRID_CELL_LEFT_DCLICK,
  wxEVT_GRID_CELL_RIGHT_CLICK,
  wxEVT_GRID_LABEL_LEFT_CLICK,
  wxEVT_GRID_LABEL_RIGHT_CLICK,
  wxGRID_VALUE_BOOL,
  wxGRID_VALUE_STRING,
  wxGridCellBoolRenderer,
  wxGridCellChoiceEditor,
  wxGridCellTextEditor,
  wxGridEvent,
  wxGridSelectionModes,
} from './wx/grid.js';
import { wxMenu, wxMenuEvent, wxMenuEventType } from './wx/menu.js';
import {
  WXK,
  wxEVT_CHAR_HOOK,
  wxEVT_KEY_DOWN,
  wxEVT_UPDATE_UI,
  type wxKeyEvent,
  wxMOD_CONTROL,
  wxMOD_NONE,
  type wxUpdateUIEvent,
} from './wx/wx_event.js';

export const GRIDTRICKS_MAX_COL = 50;

export const GRIDTRICKS_FIRST_ID = 901;
export const GRIDTRICKS_ID_CUT = 902;
export const GRIDTRICKS_ID_COPY = 903;
export const GRIDTRICKS_ID_DELETE = 904;
export const GRIDTRICKS_ID_PASTE = 905;
export const GRIDTRICKS_ID_SELECT = 906;
/** Reserved for sub-classes. */
export const GRIDTRICKS_FIRST_CLIENT_ID = 1101;
export const GRID_TRICKS_LAST_CLIENT_ID = 2100;
/** Reserved for show/hide-column-n. */
export const GRIDTRICKS_FIRST_SHOWHIDE = 2101;
export const GRIDTRICKS_LAST_ID = GRIDTRICKS_FIRST_SHOWHIDE + GRIDTRICKS_MAX_COL;

const COL_SEP = '\t';
const ROW_SEP = '\n';
const ROW_SEP_R = '\r';

/**
 * `wxStringTokenizer( text, sep, wxTOKEN_RET_EMPTY )`: an empty token between
 * separators counts, a trailing separator adds none.
 */
function tokenize(aText: string, aSep: string): string[] {
  const tokens = aText.split(aSep);

  if (tokens[tokens.length - 1] === '') tokens.pop();

  return tokens;
}

/** The text control a cell editor is, as the key hook reaches it. */
export interface GRID_TEXT_ENTRY {
  GetStringSelection(): string;
  WriteText(aText: string): void;
  IsEditable(): boolean;
}

export class GRID_TRICKS {
  /** I don't own the grid, but he owns me. */
  protected m_grid: WX_GRID;

  // The selected area, by cell coordinate and count.
  protected m_sel_row_start = 0;
  protected m_sel_col_start = 0;
  protected m_sel_row_count = 0;
  protected m_sel_col_count = 0;

  protected m_addHandler: (() => void) | null;
  protected m_tooltipEnabled = new Set<number>();
  protected m_enableSingleClickEdit = true;
  protected m_multiCellEditEnabled = true;

  constructor(aGrid: WX_GRID, aAddHandler: (() => void) | null = null) {
    this.m_grid = aGrid;
    this.m_addHandler = aAddHandler;
    this.init();
  }

  SetTooltipEnable(aCol: number, aEnable = true): void {
    if (aEnable) this.m_tooltipEnabled.add(aCol);
    else this.m_tooltipEnabled.delete(aCol);
  }

  GetTooltipEnabled(aCol: number): boolean {
    return this.m_tooltipEnabled.has(aCol);
  }

  /** Shared initialization: connect to the grid's events. */
  protected init(): void {
    this.m_sel_row_start = 0;
    this.m_sel_col_start = 0;
    this.m_sel_row_count = 0;
    this.m_sel_col_count = 0;

    const g = this.m_grid;
    g.Connect(wxEVT_GRID_CELL_LEFT_CLICK, (e: wxGridEvent) => this.onGridCellLeftClick(e));
    g.Connect(wxEVT_GRID_CELL_LEFT_DCLICK, (e: wxGridEvent) => this.onGridCellLeftDClick(e));
    g.Connect(wxEVT_GRID_CELL_RIGHT_CLICK, (e: wxGridEvent) => this.onGridCellRightClick(e));
    g.Connect(wxEVT_GRID_LABEL_RIGHT_CLICK, (e: wxGridEvent) => this.onGridLabelRightClick(e));
    g.Connect(wxEVT_GRID_LABEL_LEFT_CLICK, (e: wxGridEvent) => this.onGridLabelLeftClick(e));
    g.Connect(wxEVT_CHAR_HOOK, (e: wxKeyEvent) => this.onCharHook(e));
    g.Connect(wxEVT_KEY_DOWN, (e: wxKeyEvent) => this.onKeyDown(e));
    g.Connect(wxEVT_UPDATE_UI, (e: wxUpdateUIEvent) => this.onUpdateUI(e));
  }

  /**
   * The cell's tooltip (`onGridMotion`): its text when its column has
   * tooltips enabled, else none.
   */
  GetCellTooltip(aRow: number, aCol: number): string {
    if (aCol < 0 || aRow < 0 || !this.m_tooltipEnabled.has(aCol)) return '';

    return this.m_grid.GetCellValue(aRow, aCol);
  }

  protected isTextEntry(aRow: number, aCol: number): boolean {
    return this.m_grid.GetCellEditor(aRow, aCol) instanceof wxGridCellTextEditor;
  }

  protected isChoiceEditor(aRow: number, aCol: number): boolean {
    return this.m_grid.GetCellEditor(aRow, aCol) instanceof wxGridCellChoiceEditor;
  }

  protected isCheckbox(aRow: number, aCol: number): boolean {
    return this.m_grid.GetCellRenderer(aRow, aCol) instanceof wxGridCellBoolRenderer;
  }

  protected isReadOnly(aRow: number, aCol: number): boolean {
    return !this.m_grid.IsEditable() || this.m_grid.IsReadOnly(aRow, aCol);
  }

  protected toggleCell(aRow: number, aCol: number, aPreserveSelection = false): boolean {
    if (!this.isCheckbox(aRow, aCol)) return false;

    if (!aPreserveSelection) {
      this.m_grid.ClearSelection();
      this.m_grid.SetGridCursor(aRow, aCol);
    }

    const model = this.m_grid.GetTable()!;

    if (
      model.CanGetValueAs(aRow, aCol, wxGRID_VALUE_BOOL) &&
      model.CanSetValueAs(aRow, aCol, wxGRID_VALUE_BOOL)
    ) {
      model.SetValueAsBool(aRow, aCol, !model.GetValueAsBool(aRow, aCol));
    } else {
      // fall back to string processing
      model.SetValue(aRow, aCol, model.GetValue(aRow, aCol) === '1' ? '0' : '1');
    }

    this.m_grid.ForceRefresh();

    // Let any clients know
    const event = new wxGridEvent(wxEVT_GRID_CELL_CHANGED, this.m_grid, aRow, aCol);
    event.SetString(model.GetValue(aRow, aCol));
    this.m_grid.ProcessEvent(event);

    return true;
  }

  protected showEditor(aRow: number, aCol: number): boolean {
    if (this.m_grid.GetGridCursorRow() !== aRow || this.m_grid.GetGridCursorCol() !== aCol)
      this.m_grid.SetGridCursor(aRow, aCol);

    if (!this.isReadOnly(aRow, aCol)) {
      this.m_grid.ClearSelection();

      this.m_sel_row_start = aRow;
      this.m_sel_col_start = aCol;
      this.m_sel_row_count = 1;
      this.m_sel_col_count = 1;

      if (this.m_grid.GetSelectionMode() === wxGridSelectionModes.wxGridSelectRows) {
        const rows = this.m_grid.GetSelectedRows();

        if (rows.length !== 1 || rows[0] !== aRow) this.m_grid.SelectRow(aRow);
      }

      // The editor opens on the click's mouse-up (wx's slow-click hack).
      this.m_grid.ShowEditorOnMouseUp();

      return true;
    }

    return false;
  }

  protected onGridCellLeftClick(aEvent: wxGridEvent): void {
    const row = aEvent.GetRow();
    const col = aEvent.GetCol();

    // Don't make users click twice to toggle a checkbox or edit a text cell
    if (!aEvent.GetModifiers()) {
      let toggled = false;

      if (this.toggleCell(row, col, true)) toggled = true;
      else if (this.m_enableSingleClickEdit && this.showEditor(row, col)) return;

      // Apply checkbox changes to multi-selection.
      // Non-checkbox changes handled elsewhere
      if (toggled) {
        this.getSelectedArea();

        // We only want to apply this to whole rows. If the grid allows selecting
        // individual cells, and the selection contains disjoint cells, skip this logic.
        if (this.m_grid.GetSelectedCells().length > 0 || this.m_sel_row_count < 2) {
          // We preserved the selection in toggleCell above; so clear it now that we
          // know we aren't doing a multi-select edit
          this.m_grid.ClearSelection();
          return;
        }

        const newVal = this.m_grid.GetCellValue(row, col);

        for (
          let otherRow = this.m_sel_row_start;
          otherRow < this.m_sel_row_start + this.m_sel_row_count;
          ++otherRow
        ) {
          if (otherRow === row) continue;

          this.m_grid.SetCellValue(otherRow, col, newVal);
        }

        return;
      }
    }

    aEvent.Skip();
  }

  protected onGridCellLeftDClick(aEvent: wxGridEvent): void {
    if (!this.handleDoubleClick(aEvent)) this.onGridCellLeftClick(aEvent);
  }

  /** Double-click processing must be handled by specific sub-classes. */
  protected handleDoubleClick(_aEvent: wxGridEvent): boolean {
    return false;
  }

  /** Put the selected area into a sensible rectangle of m_sel_{row,col}_{start,count}. */
  protected getSelectedArea(): void {
    const topLeft = this.m_grid.GetSelectionBlockTopLeft();
    const botRight = this.m_grid.GetSelectionBlockBottomRight();
    const cols = this.m_grid.GetSelectedCols();
    const rows = this.m_grid.GetSelectedRows();

    if (topLeft.length && botRight.length) {
      this.m_sel_row_start = topLeft[0]!.GetRow();
      this.m_sel_col_start = topLeft[0]!.GetCol();

      this.m_sel_row_count = botRight[0]!.GetRow() - this.m_sel_row_start + 1;
      this.m_sel_col_count = botRight[0]!.GetCol() - this.m_sel_col_start + 1;
    } else if (cols.length) {
      this.m_sel_col_start = cols[0]!;
      this.m_sel_col_count = cols.length;
      this.m_sel_row_start = 0;
      this.m_sel_row_count = this.m_grid.GetNumberRows();
    } else if (rows.length) {
      this.m_sel_col_start = 0;
      this.m_sel_col_count = this.m_grid.GetNumberCols();
      this.m_sel_row_start = rows[0]!;
      this.m_sel_row_count = rows.length;
    } else {
      this.m_sel_row_start = this.m_grid.GetGridCursorRow();
      this.m_sel_col_start = this.m_grid.GetGridCursorCol();
      this.m_sel_row_count = this.m_sel_row_start >= 0 ? 1 : 0;
      this.m_sel_col_count = this.m_sel_col_start >= 0 ? 1 : 0;
    }
  }

  protected onGridCellRightClick(aEvent: wxGridEvent): void {
    this.m_grid.CommitPendingChanges(true);

    const menu = new wxMenu();

    this.showPopupMenu(menu, aEvent);
  }

  protected onGridLabelLeftClick(aEvent: wxGridEvent): void {
    this.m_grid.CommitPendingChanges();

    aEvent.Skip();
  }

  /** The column-label menu: a check item per column, to show or hide it. */
  protected onGridLabelRightClick(_aEvent: wxGridEvent): void {
    const menu = new wxMenu();

    for (let i = 0; i < this.m_grid.GetNumberCols(); ++i) {
      const id = GRIDTRICKS_FIRST_SHOWHIDE + i;
      menu.AppendCheckItem(id, this.m_grid.GetColLabelValue(i));
      menu.Check(id, this.m_grid.IsColShown(i));
    }

    this.m_grid.PopupMenu(menu, (aId) => this.onPopupSelection(aId));
  }

  protected showPopupMenu(aMenu: wxMenu, _aEvent: wxGridEvent): void {
    aMenu.Append(
      GRIDTRICKS_ID_CUT,
      'Cut\tCtrl+X',
      'Clear selected cells placing original contents on clipboard',
    );
    aMenu.Append(GRIDTRICKS_ID_COPY, 'Copy\tCtrl+C', 'Copy selected cells to clipboard');

    if (this.m_multiCellEditEnabled) {
      aMenu.Append(
        GRIDTRICKS_ID_PASTE,
        'Paste\tCtrl+V',
        'Paste clipboard cells to matrix at current cell',
      );
      aMenu.Append(GRIDTRICKS_ID_DELETE, 'Delete\tDel', 'Clear contents of selected cells');
    }

    aMenu.Append(GRIDTRICKS_ID_SELECT, 'Select All\tCtrl+A', 'Select all cells');

    aMenu.Enable(GRIDTRICKS_ID_CUT, false);
    aMenu.Enable(GRIDTRICKS_ID_DELETE, false);
    aMenu.Enable(GRIDTRICKS_ID_PASTE, false);

    this.getSelectedArea();

    const anyCellsWritable = (): boolean => {
      for (let row = this.m_sel_row_start; row < this.m_sel_row_start + this.m_sel_row_count; ++row)
        for (
          let col = this.m_sel_col_start;
          col < this.m_sel_col_start + this.m_sel_col_count;
          ++col
        )
          if (
            !this.isReadOnly(row, col) &&
            (this.isTextEntry(row, col) || this.isChoiceEditor(row, col))
          )
            return true;

      return false;
    };

    if (anyCellsWritable()) {
      aMenu.Enable(GRIDTRICKS_ID_CUT, true);
      aMenu.Enable(GRIDTRICKS_ID_DELETE, true);
    }

    // Paste can overflow the selection, so don't depend on the particular cell being writeable.
    if (GetClipboardText() !== null && this.m_grid.IsEditable())
      aMenu.Enable(GRIDTRICKS_ID_PASTE, true);

    this.m_grid.PopupMenu(aMenu, (aId) => this.onPopupSelection(aId));
  }

  protected onPopupSelection(aId: number): void {
    this.doPopupSelection(new wxMenuEvent(wxMenuEventType.wxEVT_COMMAND_MENU_SELECTED, aId));
  }

  protected doPopupSelection(aEvent: wxMenuEvent): void {
    const menu_id = aEvent.GetId();

    // assume getSelectedArea() was called by rightClickPopupMenu() and there's
    // no way to have gotten here without that having been called.
    switch (menu_id) {
      case GRIDTRICKS_ID_CUT:
        this.cutcopy(true, true);
        break;

      case GRIDTRICKS_ID_COPY:
        this.cutcopy(true, false);
        break;

      case GRIDTRICKS_ID_DELETE:
        this.cutcopy(false, true);
        break;

      case GRIDTRICKS_ID_PASTE:
        this.paste_clipboard();
        break;

      case GRIDTRICKS_ID_SELECT:
        this.m_grid.SelectAll();
        break;

      default:
        if (menu_id >= GRIDTRICKS_FIRST_SHOWHIDE && this.m_grid.CommitPendingChanges(false)) {
          const col = menu_id - GRIDTRICKS_FIRST_SHOWHIDE;

          if (this.m_grid.IsColShown(col)) this.m_grid.HideCol(col);
          else this.m_grid.ShowCol(col);
        }
    }
  }

  protected onCharHook(aEvent: wxKeyEvent): void {
    let handled = false;
    const key = aEvent.GetKeyCode();
    const mods = aEvent.GetModifiers();

    if (
      (key === WXK.WXK_RETURN || key === WXK.WXK_NUMPAD_ENTER) &&
      mods === wxMOD_NONE &&
      this.m_grid.GetGridCursorRow() === this.m_grid.GetNumberRows() - 1
    ) {
      if (this.m_grid.IsCellEditControlShown()) {
        if (this.m_grid.CommitPendingChanges()) handled = true;
      } else if (this.m_addHandler) {
        this.m_addHandler();
        handled = true;
      }
    } else if (mods === wxMOD_CONTROL && key === 'C'.charCodeAt(0)) {
      if (this.m_grid.IsCellEditControlShown()) {
        const te = aEvent.GetEventObject() as GRID_TEXT_ENTRY | null;

        if (te && typeof te.GetStringSelection === 'function') {
          const selectedText = te.GetStringSelection();

          if (selectedText !== '') {
            SaveClipboard(selectedText);
            handled = true;
          }
        }

        if (!handled) {
          this.m_grid.CancelPendingChanges();
          this.getSelectedArea();
          this.cutcopy(true, false);
          handled = true;
        }
      }
    } else if (mods === wxMOD_CONTROL && key === 'V'.charCodeAt(0)) {
      if (this.m_grid.IsCellEditControlShown()) {
        let text = GetClipboardText();

        if (text !== null) {
          const hasMultipleCells = text.includes(COL_SEP) || text.includes(ROW_SEP);

          if (hasMultipleCells) {
            text = text.replaceAll(ROW_SEP, ' ');
            text = text.replaceAll(ROW_SEP_R, ' ');
            text = text.replaceAll(COL_SEP, ' ');
          }

          const te = aEvent.GetEventObject() as GRID_TEXT_ENTRY | null;

          if (te && typeof te.WriteText === 'function' && te.IsEditable()) {
            te.WriteText(text);
            handled = true;
          } else {
            this.m_grid.CancelPendingChanges();
            this.getSelectedArea();
            this.paste_text(text);
            handled = true;
          }

          this.m_grid.ForceRefresh();
        }
      }
    } else if (key === WXK.WXK_ESCAPE) {
      if (this.m_grid.IsCellEditControlShown()) {
        this.m_grid.CancelPendingChanges();
        handled = true;
      }
    }

    if (!handled) aEvent.Skip(true);
  }

  protected onKeyDown(aEvent: wxKeyEvent): void {
    const key = aEvent.GetKeyCode();
    const mods = aEvent.GetModifiers();

    if (mods === wxMOD_CONTROL && key === 'A'.charCodeAt(0)) {
      this.m_grid.SelectAll();
      return;
    } else if (mods === wxMOD_CONTROL && key === 'C'.charCodeAt(0)) {
      this.getSelectedArea();
      this.cutcopy(true, false);
      return;
    } else if (mods === wxMOD_CONTROL && key === 'V'.charCodeAt(0)) {
      this.getSelectedArea();
      this.paste_clipboard();
      return;
    } else if (mods === wxMOD_CONTROL && key === 'X'.charCodeAt(0)) {
      this.getSelectedArea();
      this.cutcopy(true, true);
      return;
    } else if (!mods && key === WXK.WXK_DELETE) {
      this.getSelectedArea();
      this.cutcopy(false, true);
      return;
    }

    // space-bar toggling of checkboxes
    if (this.m_grid.IsEditable() && key === ' '.charCodeAt(0)) {
      let retVal = false;
      const mode = this.m_grid.GetSelectionMode();

      if (mode === wxGridSelectionModes.wxGridSelectRows) {
        // If only rows can be selected, only toggle the first cell in a row
        for (const row of this.m_grid.GetSelectedRows())
          retVal = this.toggleCell(row, 0, true) || retVal;
      } else if (mode === wxGridSelectionModes.wxGridSelectColumns) {
        // If only columns can be selected, only toggle the first cell in a column
        for (const col of this.m_grid.GetSelectedCols())
          retVal = this.toggleCell(0, col, true) || retVal;
      } else if (mode === wxGridSelectionModes.wxGridSelectCells) {
        // If the user can select the individual cells, toggle each cell selected
        const rowSel = this.m_grid.GetSelectedRows();
        const colSel = this.m_grid.GetSelectedCols();
        const cellSel = this.m_grid.GetSelectedCells();
        const topLeft = this.m_grid.GetSelectionBlockTopLeft();
        const botRight = this.m_grid.GetSelectionBlockBottomRight();

        for (const cell of cellSel)
          retVal = this.toggleCell(cell.GetRow(), cell.GetCol(), true) || retVal;

        for (const col of colSel)
          for (let row = 0; row < this.m_grid.GetNumberRows(); row++)
            retVal = this.toggleCell(row, col, true) || retVal;

        for (const row of rowSel)
          for (let col = 0; col < this.m_grid.GetNumberCols(); col++)
            retVal = this.toggleCell(row, col, true) || retVal;

        for (let blockInd = 0; blockInd < topLeft.length; blockInd++) {
          const start = topLeft[blockInd]!;
          const end = botRight[blockInd]!;

          for (let row = start.GetRow(); row <= end.GetRow(); row++)
            for (let col = start.GetCol(); col <= end.GetCol(); col++)
              retVal = this.toggleCell(row, col, true) || retVal;
        }
      }

      // Return if there were any cells toggled
      if (retVal) return;
    }

    // ctrl-tab for exit grid
    if (aEvent.state.ControlDown() && key === WXK.WXK_TAB) {
      this.m_grid.Navigate();
      return;
    }

    aEvent.Skip(true);
  }

  protected paste_clipboard(): void {
    const text = GetClipboardText();

    if (this.m_grid.IsEditable() && text !== null) {
      this.m_grid.CommitPendingChanges(true);
      this.paste_text(text);
      this.m_grid.ForceRefresh();
    }
  }

  protected paste_text(aCbText: string): void {
    if (!this.m_multiCellEditEnabled) return;

    const tbl = this.m_grid.GetTable()!;

    const cur_row = this.m_grid.GetGridCursorRow();
    const cur_col = this.m_grid.GetGridCursorCol();
    let start_row: number;
    let end_row: number;
    let start_col: number;
    let end_col: number;
    let is_selection = false;

    if (cur_row < 0 || cur_col < 0) return; // wxBell()

    if (this.m_grid.GetSelectionMode() === wxGridSelectionModes.wxGridSelectRows) {
      if (this.m_sel_row_count > 1) is_selection = true;
    } else if (this.m_sel_col_count > 1 || this.m_sel_row_count > 1) {
      is_selection = true;
    }

    const rowTokens = tokenize(aCbText, ROW_SEP);
    let rowIdx = 0;

    // If selection of cells is present then a clipboard pastes to selected cells only.
    if (is_selection) {
      start_row = this.m_sel_row_start;
      end_row = this.m_sel_row_start + this.m_sel_row_count;
      start_col = this.m_sel_col_start;
      end_col = this.m_sel_col_start + this.m_sel_col_count;
    } else {
      // Otherwise, paste whole clipboard starting from cell with cursor.
      start_row = cur_row;
      end_row = cur_row + rowTokens.length;

      if (end_row > tbl.GetNumberRows()) {
        if (this.m_addHandler)
          for (let ii = end_row - tbl.GetNumberRows(); ii > 0; --ii) this.m_addHandler();

        end_row = tbl.GetNumberRows();
      }

      start_col = cur_col;
      end_col = start_col; // end_col actual value calculates later
    }

    for (let row = start_row; row < end_row; ++row) {
      // If number of selected rows is larger than the count of rows on the clipboard,
      // paste again and again until the end of the selection is reached.
      if (rowIdx >= rowTokens.length) rowIdx = 0;

      const rowTxt = rowTokens[rowIdx++] ?? '';
      const colTokens = tokenize(rowTxt, COL_SEP);
      let colIdx = 0;

      if (!is_selection) end_col = cur_col + colTokens.length;

      for (let col = start_col; col < end_col && col < tbl.GetNumberCols(); ++col) {
        // Skip hidden columns
        if (!this.m_grid.IsColShown(col)) {
          end_col++;
          continue;
        }

        // If number of selected cols is larger than the count of cols on the clipboard,
        // paste again and again until the end of the selection is reached.
        if (colIdx >= colTokens.length) colIdx = 0;

        const cellTxt = colTokens[colIdx++] ?? '';

        // Allow paste to anything that can take a string, including things like color
        // swatches and checkboxes
        if (tbl.CanSetValueAs(row, col, wxGRID_VALUE_STRING) && !this.isReadOnly(row, col)) {
          tbl.SetValue(row, col, cellTxt);
          this.m_grid.ProcessEvent(new wxGridEvent(wxEVT_GRID_CELL_CHANGED, this.m_grid, row, col));
        } else if (tbl.CanSetValueAs(row, col, wxGRID_VALUE_BOOL)) {
          // Allow paste to any cell that can accept a boolean value
          tbl.SetValueAsBool(row, col, cellTxt === '1');
          this.m_grid.ProcessEvent(new wxGridEvent(wxEVT_GRID_CELL_CHANGED, this.m_grid, row, col));
        }
      }
    }
  }

  protected cutcopy(aDoCopy: boolean, aDoDelete: boolean): void {
    const tbl = this.m_grid.GetTable()!;
    let txt = '';

    // fill txt with a format that is compatible with most spreadsheets
    for (let row = this.m_sel_row_start; row < this.m_sel_row_start + this.m_sel_row_count; ++row) {
      if (txt !== '') txt += ROW_SEP;

      for (
        let col = this.m_sel_col_start;
        col < this.m_sel_col_start + this.m_sel_col_count;
        ++col
      ) {
        if (!this.m_grid.IsColShown(col)) continue;

        txt += tbl.GetValue(row, col);

        // that was not last column
        if (col < this.m_sel_col_start + this.m_sel_col_count - 1) txt += COL_SEP;

        // Do NOT allow clear of things that can take strings but aren't textEntries
        // (ie: color swatches, textboxes, etc.).
        if (aDoDelete && this.isTextEntry(row, col) && !this.isReadOnly(row, col))
          tbl.SetValue(row, col, '');
      }
    }

    if (aDoCopy) SaveClipboard(txt);

    if (aDoDelete) this.m_grid.ForceRefresh();
  }

  /** Respect ROW selectionMode when moving cursor. */
  protected onUpdateUI(aEvent: wxUpdateUIEvent): void {
    if (this.m_grid.GetSelectionMode() === wxGridSelectionModes.wxGridSelectRows) {
      const cursorRow = this.m_grid.GetGridCursorRow();
      const cursorInSelectedRow = this.m_grid.GetSelectedRows().includes(cursorRow);

      if (!cursorInSelectedRow && cursorRow >= 0) this.m_grid.SelectRow(cursorRow);
    }

    aEvent.Skip();
  }
}
