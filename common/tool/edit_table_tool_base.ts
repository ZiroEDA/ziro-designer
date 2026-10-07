// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDIT_TABLE_TOOL_BASE<T_TABLE, T_TABLECELL, T_COMMIT>` (include/tool/edit_table_tool_base.h).
 *
 * SCH_TABLE_EDIT_TOOL and PCB_TABLE_EDIT_TOOL share most of their algorithms, which are
 * implemented here.
 *
 * Upstream the tool inherits from both its TOOL_BASE and this template. TypeScript has single
 * inheritance, so the template is a mixin over the tool's base class: `class SCH_EDIT_TABLE_TOOL
 * extends EDIT_TABLE_TOOL_BASE(SCH_TOOL_BASE<SCH_EDIT_FRAME>)`.
 */
import type { COMMIT } from '../commit.js';
import type { EDA_ITEM } from '../eda_item.js';
import { STRUCT_DELETED } from '../eda_item_flags.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BASE_SCREEN_LIKE } from '../undo_redo_container.js';
import { ACTIONS, EVENTS } from './actions.js';
import type { CONDITIONAL_MENU } from './conditional_menu.js';
import type { SELECTION } from './selection.js';
import { SELECTION_CONDITIONS } from './selection_conditions.js';
import type { TOOL_EVENT } from './tool_event.js';
import type { TOOL_MANAGER } from './tool_manager.js';

/** What the algorithms ask of `T_TABLECELL` (SCH_TABLECELL, PCB_TABLECELL). */
export interface EDIT_TABLECELL extends EDA_ITEM {
  GetColumn(): number;
  GetRow(): number;
  GetColSpan(): number;
  GetRowSpan(): number;
  SetColSpan(aSpan: number): void;
  SetRowSpan(aSpan: number): void;
  GetText(): string;
  SetText(aText: string): void;
  GetStart(): VECTOR2I;
  SetEnd(aEnd: VECTOR2I): void;
  SetAttributes(aSrc: never, aSetPosition?: boolean): void;
  GetStroke(): unknown;
  SetStroke(aStroke: never): void;
  GetFillMode(): unknown;
  SetFillMode(aMode: never): void;
  GetFillColor(): unknown;
  SetFillColor(aColor: never): void;
}

/** What the algorithms ask of `T_TABLE` (SCH_TABLE, PCB_TABLE). */
export interface EDIT_TABLE<T_TABLECELL extends EDIT_TABLECELL> extends EDA_ITEM {
  GetPosition(): VECTOR2I;
  SetPosition(aPos: VECTOR2I): void;
  GetColCount(): number;
  SetColCount(aCount: number): void;
  GetRowCount(): number;
  GetCell(aRow: number, aCol: number): T_TABLECELL | null;
  GetCells(): T_TABLECELL[];
  InsertCell(aIdx: number, aCell: T_TABLECELL): void;
  DeleteMarkedCells(): void;
  GetRowHeight(aRow: number): number;
  SetRowHeight(aRow: number, aHeight: number): void;
  GetColWidth(aCol: number): number;
  SetColWidth(aCol: number, aWidth: number): void;
  Normalize(): void;
}

// biome-ignore lint/suspicious/noExplicitAny: a mixin's base constructor takes any arguments.
type ABSTRACT_CTOR<T = object> = abstract new (...args: any[]) => T;

const INT_MAX = 2147483647; // std::numeric_limits<int>::max()

/** `dynamic_cast<T_TABLECELL*>( item )`. */
function asCell(aItem: EDA_ITEM | null): EDIT_TABLECELL | null {
  return aItem &&
    (aItem.Type() === KICAD_T.SCH_TABLECELL_T || aItem.Type() === KICAD_T.PCB_TABLECELL_T)
    ? (aItem as unknown as EDIT_TABLECELL)
    : null;
}

export function EDIT_TABLE_TOOL_BASE<
  T_TABLE extends EDIT_TABLE<T_TABLECELL>,
  T_TABLECELL extends EDIT_TABLECELL,
  T_COMMIT extends COMMIT,
  TBase extends ABSTRACT_CTOR = ABSTRACT_CTOR,
>(Base: TBase, aMakeCommit: (aToolMgr: TOOL_MANAGER) => T_COMMIT) {
  abstract class EDIT_TABLE_TOOL_BASE_T extends Base {
    // The template's protected members are public here: a mixin's class may not declare
    // protected or private members while the package emits declarations (TS4094).

    addMenus(selToolMenu: CONDITIONAL_MENU): void {
      const S_C = SELECTION_CONDITIONS;
      const cellSelection = S_C.And(
        S_C.MoreThan(0),
        S_C.OnlyTypes([KICAD_T.SCH_TABLECELL_T, KICAD_T.PCB_TABLECELL_T]),
      );

      const cellBlockSelection = (sel: SELECTION): boolean => {
        if (sel.Size() < 2) return false;

        let colMin = INT_MAX;
        let colMax = 0;
        let rowMin = INT_MAX;
        let rowMax = 0;
        let selectedArea = 0;

        for (const item of sel) {
          const cell = asCell(item);

          if (cell) {
            colMin = Math.min(colMin, cell.GetColumn());
            colMax = Math.max(colMax, cell.GetColumn() + cell.GetColSpan());
            rowMin = Math.min(rowMin, cell.GetRow());
            rowMax = Math.max(rowMax, cell.GetRow() + cell.GetRowSpan());

            selectedArea += cell.GetColSpan() * cell.GetRowSpan();
          }
        }

        return selectedArea === (colMax - colMin) * (rowMax - rowMin);
      };

      const mergedCellsSelection = (sel: SELECTION): boolean => {
        for (const item of sel) {
          const cell = asCell(item);

          if (cell && (cell.GetColSpan() > 1 || cell.GetRowSpan() > 1)) return true;
        }

        return false;
      };

      const idleCells = S_C.And(cellSelection, S_C.Idle);

      //
      // Add editing actions to the selection tool menu
      //
      selToolMenu.AddSeparator(100);
      selToolMenu.AddItem(ACTIONS.addRowAbove, idleCells, 100);
      selToolMenu.AddItem(ACTIONS.addRowBelow, idleCells, 100);
      selToolMenu.AddItem(ACTIONS.addColBefore, idleCells, 100);
      selToolMenu.AddItem(ACTIONS.addColAfter, idleCells, 100);

      selToolMenu.AddSeparator(100);
      selToolMenu.AddItem(ACTIONS.deleteRows, idleCells, 100);
      selToolMenu.AddItem(ACTIONS.deleteColumns, idleCells, 100);

      selToolMenu.AddSeparator(100);
      selToolMenu.AddItem(ACTIONS.mergeCells, S_C.And(cellSelection, cellBlockSelection), 100);
      selToolMenu.AddItem(ACTIONS.unmergeCells, S_C.And(cellSelection, mergedCellsSelection), 100);

      selToolMenu.AddSeparator(100);
      selToolMenu.AddItem(ACTIONS.editTable, idleCells, 100);

      selToolMenu.AddSeparator(100);
      selToolMenu.AddItem(ACTIONS.exportTableCSV, idleCells, 100);

      selToolMenu.AddSeparator(100);
    }

    doAddRowAbove(_aEvent: TOOL_EVENT): number {
      const selection = this.getTableCellSelection();
      let topmost: T_TABLECELL | null = null;

      for (const item of selection) {
        const cell = item as unknown as T_TABLECELL;

        if (!topmost || cell.GetRow() < topmost.GetRow()) topmost = cell;
      }

      if (!topmost) return 0;

      const row = topmost.GetRow();
      const table = topmost.GetParent() as unknown as T_TABLE;
      const commit = aMakeCommit(this.getToolMgr());
      const pos = table.GetPosition();

      // Make a copy of the source row before things start moving around
      const sources: T_TABLECELL[] = [];

      for (let col = 0; col < table.GetColCount(); ++col) sources.push(table.GetCell(row, col)!);

      commit.Modify(table, this.getScreen());

      for (let col = 0; col < table.GetColCount(); ++col) {
        const cell = this.copyCell(sources[col]!);
        table.InsertCell(row * table.GetColCount(), cell);
      }

      for (let afterRow = table.GetRowCount() - 1; afterRow > row; afterRow--)
        table.SetRowHeight(afterRow, table.GetRowHeight(afterRow - 1));

      table.SetPosition(pos);
      table.Normalize();

      this.getToolMgr().PostEvent(EVENTS.SelectedEvent);

      commit.Push('Add Row Above');

      return 0;
    }

    doAddRowBelow(_aEvent: TOOL_EVENT): number {
      const selection = this.getTableCellSelection();
      let bottommost: T_TABLECELL | null = null;

      if (selection.Empty()) return 0;

      for (const item of selection) {
        const cell = item as unknown as T_TABLECELL;

        if (!bottommost || cell.GetRow() > bottommost.GetRow()) bottommost = cell;
      }

      if (!bottommost) return 0;

      const row = bottommost.GetRow();
      const table = bottommost.GetParent() as unknown as T_TABLE;
      const commit = aMakeCommit(this.getToolMgr());
      const pos = table.GetPosition();

      // Make a copy of the source row before things start moving around
      const sources: T_TABLECELL[] = [];

      for (let col = 0; col < table.GetColCount(); ++col) sources.push(table.GetCell(row, col)!);

      commit.Modify(table, this.getScreen());

      for (let col = 0; col < table.GetColCount(); ++col) {
        const cell = this.copyCell(sources[col]!);
        table.InsertCell((row + 1) * table.GetColCount(), cell);
      }

      for (let afterRow = table.GetRowCount() - 1; afterRow > row; afterRow--)
        table.SetRowHeight(afterRow, table.GetRowHeight(afterRow - 1));

      table.SetPosition(pos);
      table.Normalize();

      this.getToolMgr().PostEvent(EVENTS.SelectedEvent);

      commit.Push('Add Row Below');

      return 0;
    }

    doAddColumnBefore(_aEvent: TOOL_EVENT): number {
      const selection = this.getTableCellSelection();
      let leftmost: T_TABLECELL | null = null;

      for (const item of selection) {
        const cell = item as unknown as T_TABLECELL;

        if (!leftmost || cell.GetColumn() < leftmost.GetColumn()) leftmost = cell;
      }

      if (!leftmost) return 0;

      const col = leftmost.GetColumn();
      const table = leftmost.GetParent() as unknown as T_TABLE;
      const rowCount = table.GetRowCount();
      const commit = aMakeCommit(this.getToolMgr());
      const pos = table.GetPosition();

      // Make a copy of the source column before things start moving around
      const sources: T_TABLECELL[] = [];

      for (let row = 0; row < rowCount; ++row) sources.push(table.GetCell(row, col)!);

      commit.Modify(table, this.getScreen());
      table.SetColCount(table.GetColCount() + 1);

      for (let row = 0; row < rowCount; ++row) {
        const cell = this.copyCell(sources[row]!);
        table.InsertCell(row * table.GetColCount() + col, cell);
      }

      for (let afterCol = table.GetColCount() - 1; afterCol > col; afterCol--)
        table.SetColWidth(afterCol, table.GetColWidth(afterCol - 1));

      table.SetPosition(pos);
      table.Normalize();

      this.getToolMgr().PostEvent(EVENTS.SelectedEvent);

      commit.Push('Add Column Before');

      return 0;
    }

    doAddColumnAfter(_aEvent: TOOL_EVENT): number {
      const selection = this.getTableCellSelection();
      let rightmost: T_TABLECELL | null = null;

      for (const item of selection) {
        const cell = item as unknown as T_TABLECELL;

        if (!rightmost || cell.GetColumn() > rightmost.GetColumn()) rightmost = cell;
      }

      if (!rightmost) return 0;

      const col = rightmost.GetColumn();
      const table = rightmost.GetParent() as unknown as T_TABLE;
      const rowCount = table.GetRowCount();
      const commit = aMakeCommit(this.getToolMgr());
      const pos = table.GetPosition();

      // Make a copy of the source column before things start moving around
      const sources: T_TABLECELL[] = [];

      for (let row = 0; row < rowCount; ++row) sources.push(table.GetCell(row, col)!);

      commit.Modify(table, this.getScreen());
      table.SetColCount(table.GetColCount() + 1);

      for (let row = 0; row < rowCount; ++row) {
        const cell = this.copyCell(sources[row]!);
        table.InsertCell(row * table.GetColCount() + col + 1, cell);
      }

      for (let afterCol = table.GetColCount() - 1; afterCol > col; afterCol--)
        table.SetColWidth(afterCol, table.GetColWidth(afterCol - 1));

      table.SetPosition(pos);
      table.Normalize();

      this.getToolMgr().PostEvent(EVENTS.SelectedEvent);

      commit.Push('Add Column After');

      return 0;
    }

    doDeleteRows(_aEvent: TOOL_EVENT): number {
      const selection = this.getTableCellSelection();

      if (selection.Empty()) return 0;

      const table = selection.at(0)!.GetParent() as unknown as T_TABLE;
      const deleted: number[] = [];

      for (const cell of table.GetCells()) cell.ClearFlags(STRUCT_DELETED);

      for (let row = 0; row < table.GetRowCount(); ++row) {
        let deleteRow = false;

        for (let col = 0; col < table.GetColCount(); ++col) {
          if (table.GetCell(row, col)!.IsSelected()) {
            deleteRow = true;
            break;
          }
        }

        if (deleteRow) {
          for (let col = 0; col < table.GetColCount(); ++col)
            table.GetCell(row, col)!.SetFlags(STRUCT_DELETED);

          deleted.push(row);
        }
      }

      const commit = aMakeCommit(this.getToolMgr());

      if (deleted.length === table.GetRowCount()) {
        commit.Remove(table, this.getScreen());
      } else {
        commit.Modify(table, this.getScreen());

        const pos = table.GetPosition();

        // Save old row heights BEFORE deleting cells
        const oldRowHeights = new Map<number, number>();
        for (let row = 0; row < table.GetRowCount(); ++row)
          oldRowHeights.set(row, table.GetRowHeight(row));

        this.clearSelection();
        table.DeleteMarkedCells();

        for (let row = 0; row < table.GetRowCount(); ++row) {
          let old_row = row;

          for (const deletedRow of deleted) {
            if (deletedRow <= old_row) old_row++;
          }

          // Use saved old heights instead of querying the modified table
          const height = oldRowHeights.get(old_row) ?? 0;
          table.SetRowHeight(row, height);
        }

        table.SetPosition(pos);
        table.Normalize();

        this.getToolMgr().PostEvent(EVENTS.SelectedEvent);
      }

      if (deleted.length > 1) commit.Push('Delete Rows');
      else commit.Push('Delete Row');

      return 0;
    }

    doDeleteColumns(_aEvent: TOOL_EVENT): number {
      const selection = this.getTableCellSelection();

      if (selection.Empty()) return 0;

      const table = selection.at(0)!.GetParent() as unknown as T_TABLE;
      const deleted: number[] = [];

      for (const cell of table.GetCells()) cell.ClearFlags(STRUCT_DELETED);

      for (let col = 0; col < table.GetColCount(); ++col) {
        let deleteColumn = false;

        for (let row = 0; row < table.GetRowCount(); ++row) {
          if (table.GetCell(row, col)!.IsSelected()) {
            deleteColumn = true;
            break;
          }
        }

        if (deleteColumn) {
          for (let row = 0; row < table.GetRowCount(); ++row)
            table.GetCell(row, col)!.SetFlags(STRUCT_DELETED);

          deleted.push(col);
        }
      }

      const commit = aMakeCommit(this.getToolMgr());

      if (deleted.length === table.GetColCount()) {
        commit.Remove(table, this.getScreen());
      } else {
        commit.Modify(table, this.getScreen());

        const pos = table.GetPosition();

        this.clearSelection();
        table.DeleteMarkedCells();
        table.SetColCount(table.GetColCount() - deleted.length);

        for (let col = 0; col < table.GetColCount(); ++col) {
          let old_col = col;

          for (const deletedCol of deleted) {
            if (deletedCol <= old_col) old_col++;
          }

          table.SetColWidth(col, table.GetColWidth(old_col));
        }

        table.SetPosition(pos);
        table.Normalize();

        this.getToolMgr().PostEvent(EVENTS.SelectedEvent);
      }

      if (deleted.length > 1) commit.Push('Delete Columns');
      else commit.Push('Delete Column');

      return 0;
    }

    doMergeCells(_aEvent: TOOL_EVENT): number {
      const sel = this.getTableCellSelection();

      if (sel.Empty()) return 0;

      let colMin = INT_MAX;
      let colMax = 0;
      let rowMin = INT_MAX;
      let rowMax = 0;

      const commit = aMakeCommit(this.getToolMgr());
      const table = sel.at(0)!.GetParent() as unknown as T_TABLE;

      for (const item of sel) {
        const cell = asCell(item);

        if (cell) {
          colMin = Math.min(colMin, cell.GetColumn());
          colMax = Math.max(colMax, cell.GetColumn() + cell.GetColSpan());
          rowMin = Math.min(rowMin, cell.GetRow());
          rowMax = Math.max(rowMax, cell.GetRow() + cell.GetRowSpan());
        }
      }

      let content = '';
      const extents = { x: 0, y: 0 };

      for (let row = rowMin; row < rowMax; ++row) {
        extents.y += table.GetRowHeight(row);
        extents.x = 0;

        for (let col = colMin; col < colMax; ++col) {
          extents.x += table.GetColWidth(col);

          const cell = table.GetCell(row, col)!;

          if (cell.GetText() !== '') {
            if (content !== '') content += '\n';

            content += cell.GetText();
          }

          commit.Modify(cell, this.getScreen());
          cell.SetColSpan(0);
          cell.SetRowSpan(0);
          cell.SetText('');
        }
      }

      const topLeft = table.GetCell(rowMin, colMin)!;
      topLeft.SetColSpan(colMax - colMin);
      topLeft.SetRowSpan(rowMax - rowMin);
      topLeft.SetText(content);
      const start = topLeft.GetStart();
      topLeft.SetEnd({ x: start.x + extents.x, y: start.y + extents.y });

      table.Normalize();
      commit.Push('Merge Cells');

      this.getToolMgr().PostEvent(EVENTS.SelectedEvent);

      return 0;
    }

    doUnmergeCells(_aEvent: TOOL_EVENT): number {
      const sel = this.getTableCellSelection();

      if (sel.Empty()) return 0;

      const commit = aMakeCommit(this.getToolMgr());
      const table = sel.at(0)!.GetParent() as unknown as T_TABLE;

      for (const item of sel) {
        const cell = asCell(item);

        if (cell) {
          const rowSpan = cell.GetRowSpan();
          const colSpan = cell.GetColSpan();

          for (let row = cell.GetRow(); row < cell.GetRow() + rowSpan; ++row) {
            for (let col = cell.GetColumn(); col < cell.GetColumn() + colSpan; ++col) {
              const target = table.GetCell(row, col)!;
              commit.Modify(target, this.getScreen());
              target.SetColSpan(1);
              target.SetRowSpan(1);

              const start = target.GetStart();
              target.SetEnd({
                x: start.x + table.GetColWidth(col),
                y: start.y + table.GetRowHeight(row),
              });
            }
          }
        }
      }

      table.Normalize();
      commit.Push('Unmerge Cells');

      this.getToolMgr().PostEvent(EVENTS.SelectedEvent);

      return 0;
    }

    /**
     * Get the bounding box of a cell block selection: `[colMin, colMax, rowMin, rowMax]` (the
     * maxima exclusive) when the selection forms a valid contiguous block, else null. Upstream
     * returns the bool and writes the four through references.
     */
    getCellBlockBounds(aSel: SELECTION): [number, number, number, number] | null {
      if (aSel.Size() < 1) return null;

      let aColMin = INT_MAX;
      let aColMax = 0;
      let aRowMin = INT_MAX;
      let aRowMax = 0;
      let selectedArea = 0;

      for (const item of aSel) {
        const cell = asCell(item);

        if (cell) {
          aColMin = Math.min(aColMin, cell.GetColumn());
          aColMax = Math.max(aColMax, cell.GetColumn() + cell.GetColSpan());
          aRowMin = Math.min(aRowMin, cell.GetRow());
          aRowMax = Math.max(aRowMax, cell.GetRow() + cell.GetRowSpan());

          selectedArea += cell.GetColSpan() * cell.GetRowSpan();
        }
      }

      const bounds: [number, number, number, number] = [aColMin, aColMax, aRowMin, aRowMax];

      // Check if selection is contiguous (for single cell, we allow it)
      if (aSel.Size() === 1) return bounds;

      return selectedArea === (aColMax - aColMin) * (aRowMax - aRowMin) ? bounds : null;
    }

    /**
     * Validate if paste-into-cells is possible for the given selection: null when it is, else
     * the error message (upstream's `wxString& aErrorMsg` out-parameter).
     */
    validatePasteIntoSelection(aSel: SELECTION): string | null {
      if (aSel.Empty()) return 'No cells selected';

      // Check if all selected items are table cells from the same table
      let table: EDA_ITEM | null = null;

      for (const item of aSel) {
        const cell = asCell(item);

        if (!cell) return 'Selection contains non-cell items';

        if (!table) table = cell.GetParent();
        else if (cell.GetParent() !== table) return 'Selected cells are from different tables';

        // Check for merged cells (block paste-into for now)
        if (cell.GetColSpan() > 1 || cell.GetRowSpan() > 1) return 'Cannot paste into merged cells';
      }

      // Check if selection is contiguous
      if (!this.getCellBlockBounds(aSel)) return 'Selected cells must form a contiguous block';

      return null;
    }

    /** Paste text content from source table into selected cells. */
    pasteCellsIntoSelection(
      aSel: SELECTION,
      aSourceTable: T_TABLE | null,
      aCommit: T_COMMIT,
    ): boolean {
      if (!aSourceTable || aSel.Empty()) return false;

      // Get target cell range
      const bounds = this.getCellBlockBounds(aSel);

      if (!bounds) return false;

      const [targetColMin, , targetRowMin] = bounds;
      const targetTable = aSel.at(0)!.GetParent() as unknown as T_TABLE;

      // Get source table dimensions
      const sourceRows = aSourceTable.GetRowCount();
      const sourceCols = aSourceTable.GetColCount();

      const pasteEndRow = targetRowMin + sourceRows;
      const pasteEndCol = targetColMin + sourceCols;

      if (pasteEndRow > targetTable.GetRowCount() || pasteEndCol > targetTable.GetColCount()) {
        const rowsToAdd = Math.max(0, pasteEndRow - targetTable.GetRowCount());
        const colsToAdd = Math.max(0, pasteEndCol - targetTable.GetColCount());

        const pos = targetTable.GetPosition();
        aCommit.Modify(targetTable, this.getScreen());

        for (let i = 0; i < rowsToAdd; ++i) {
          const insertRow = targetTable.GetRowCount();
          const clipboardRow = insertRow - targetRowMin;

          const sources: T_TABLECELL[] = [];

          for (let col = 0; col < aSourceTable.GetColCount(); ++col)
            sources.push(aSourceTable.GetCell(clipboardRow, col)!);

          for (let col = 0; col < targetTable.GetColCount(); ++col) {
            const sourceCell = col < aSourceTable.GetColCount() ? sources[col]! : sources[0]!;
            const cell = this.copyCell(sourceCell);
            targetTable.InsertCell(insertRow * targetTable.GetColCount(), cell);
          }

          for (let afterRow = targetTable.GetRowCount() - 1; afterRow > insertRow; afterRow--)
            targetTable.SetRowHeight(afterRow, targetTable.GetRowHeight(afterRow - 1));

          targetTable.SetRowHeight(insertRow, aSourceTable.GetRowHeight(clipboardRow));
        }

        for (let i = 0; i < colsToAdd; ++i) {
          const insertCol = targetTable.GetColCount();
          const clipboardCol = insertCol - targetColMin;
          const rowCount = targetTable.GetRowCount();

          targetTable.SetColCount(targetTable.GetColCount() + 1);

          const sources: T_TABLECELL[] = [];

          for (let row = 0; row < aSourceTable.GetRowCount(); ++row)
            sources.push(aSourceTable.GetCell(row, clipboardCol)!);

          for (let row = 0; row < rowCount; ++row) {
            const sourceCell = row < aSourceTable.GetRowCount() ? sources[row]! : sources[0]!;
            const cell = this.copyCell(sourceCell);
            targetTable.InsertCell(row * targetTable.GetColCount() + insertCol, cell);
          }

          for (let afterCol = targetTable.GetColCount() - 1; afterCol > insertCol; afterCol--)
            targetTable.SetColWidth(afterCol, targetTable.GetColWidth(afterCol - 1));

          targetTable.SetColWidth(insertCol, aSourceTable.GetColWidth(clipboardCol));
        }

        targetTable.SetPosition(pos);
        targetTable.Normalize();
      }

      for (let srcRow = 0; srcRow < sourceRows; ++srcRow) {
        for (let srcCol = 0; srcCol < sourceCols; ++srcCol) {
          const destRow = targetRowMin + srcRow;
          const destCol = targetColMin + srcCol;

          if (destRow >= targetTable.GetRowCount() || destCol >= targetTable.GetColCount())
            continue;

          const sourceCell = aSourceTable.GetCell(srcRow, srcCol)!;
          const targetCell = targetTable.GetCell(destRow, destCol)!;

          aCommit.Modify(targetCell, this.getScreen());

          targetCell.SetText(sourceCell.GetText());
          targetCell.SetAttributes(sourceCell as never, false);
          targetCell.SetStroke(sourceCell.GetStroke() as never);
          targetCell.SetFillMode(sourceCell.GetFillMode() as never);
          targetCell.SetFillColor(sourceCell.GetFillColor() as never);
        }
      }

      targetTable.Normalize();
      return true;
    }

    abstract getToolMgr(): TOOL_MANAGER;
    abstract getScreen(): BASE_SCREEN_LIKE | null;

    abstract getTableCellSelection(): SELECTION;
    abstract clearSelection(): void;

    abstract copyCell(aSource: T_TABLECELL): T_TABLECELL;
  }

  return EDIT_TABLE_TOOL_BASE_T;
}
