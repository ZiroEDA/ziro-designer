// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Merge and unmerge table cells. Counterpart: `EDIT_TABLE_TOOL_BASE`'s
 * `doMergeCells` / `doUnmergeCells`, which `SCH_EDIT_TABLE_TOOL` inherits.
 * Fourth layer of #178.
 *
 * ### Merge takes the bounding block, not the selection
 *
 * `doMergeCells` reads the selection only to compute `colMin/colMax` and
 * `rowMin/rowMax`, then works over **every cell in that rectangle**. Selecting
 * two opposite corners of a 3x3 area merges all nine. There is a
 * `getCellBlockBounds` that reports whether a selection is contiguous, but the
 * merge does not call it — so a scattered selection merges the block that
 * contains it rather than being refused.
 *
 * ### What happens to the text
 *
 * Every non-empty cell's text is collected in row-major order and joined with
 * newlines onto the top-left cell; the rest are emptied. Nothing is thrown
 * away, which matters because a merge is otherwise a lossy operation and undo
 * is the only way back.
 *
 * ### Spans of zero
 *
 * A swallowed cell is not deleted — it keeps its slot with `colSpan` and
 * `rowSpan` set to 0. The grid stays rectangular, the row-major walk keeps
 * working, and `Selectable()` rejects the cell so nothing on screen belongs to
 * it. Unmerge is then just handing those slots their spans back.
 *
 * Both operations end with a `normalizeTable`, which is what actually moves the
 * rectangles; this module only ever changes spans and text.
 */

import type { SchTable, SchTableCell, Schematic } from '../types.js';
import type { EditCommand } from './command.js';
import { refId } from './hittest.js';
import { cellRowCol, normalizeTable, tableOrigin } from './table_layout.js';
import { resolveCell, tableOfCellId } from './table_cells.js';

/** The block a set of cell indices spans, inclusive of their own spans. */
export function cellBlock(
  t: SchTable,
  indices: readonly number[],
): { colMin: number; colMax: number; rowMin: number; rowMax: number } | null {
  let colMin = Infinity,
    colMax = 0,
    rowMin = Infinity,
    rowMax = 0;
  let any = false;
  for (const i of indices) {
    const cell = t.cells[i];
    if (!cell) continue;
    any = true;
    const { row, col } = cellRowCol(t, i);
    colMin = Math.min(colMin, col);
    // colMax is exclusive, and a merged cell reaches past its own column.
    colMax = Math.max(colMax, col + Math.max(1, cell.colSpan));
    rowMin = Math.min(rowMin, row);
    rowMax = Math.max(rowMax, row + Math.max(1, cell.rowSpan));
  }
  return any ? { colMin, colMax, rowMin, rowMax } : null;
}

/**
 * Merge every cell of the block the given cells span into its top-left.
 *
 * Returns the table unchanged when the block is a single cell — there is
 * nothing to merge, and identity lets the caller skip the undo entry.
 */
export function mergeCells(t: SchTable, indices: readonly number[]): SchTable {
  const block = cellBlock(t, indices);
  if (!block || t.columnCount <= 0) return t;
  const { colMin, colMax, rowMin, rowMax } = block;
  if (colMax - colMin <= 1 && rowMax - rowMin <= 1) return t;

  const texts: string[] = [];
  const inBlock = new Set<number>();
  for (let row = rowMin; row < rowMax; row++) {
    for (let col = colMin; col < colMax; col++) {
      const index = row * t.columnCount + col;
      const cell = t.cells[index];
      if (!cell) continue;
      inBlock.add(index);
      if (cell.text !== '') texts.push(cell.text);
    }
  }
  const topLeft = rowMin * t.columnCount + colMin;
  if (!t.cells[topLeft]) return t;

  const cells = t.cells.map((c, i): SchTableCell => {
    if (i === topLeft)
      return { ...c, colSpan: colMax - colMin, rowSpan: rowMax - rowMin, text: texts.join('\n') };
    if (inBlock.has(i)) return { ...c, colSpan: 0, rowSpan: 0, text: '' };
    return c;
  });
  return normalizeTable({ ...t, cells });
}

/**
 * Give every cell each selected merged cell swallowed its own span back.
 *
 * An unmerged cell is left alone rather than refused: unmerging a selection
 * that is already mostly plain cells should still unmerge the one that is not.
 */
export function unmergeCells(t: SchTable, indices: readonly number[]): SchTable {
  if (t.columnCount <= 0) return t;
  const restore = new Set<number>();
  for (const i of indices) {
    const cell = t.cells[i];
    if (!cell || (cell.colSpan <= 1 && cell.rowSpan <= 1)) continue;
    const { row, col } = cellRowCol(t, i);
    for (let r = row; r < row + cell.rowSpan; r++) {
      for (let c = col; c < col + cell.colSpan; c++) restore.add(r * t.columnCount + c);
    }
  }
  if (restore.size === 0) return t;
  const cells = t.cells.map((c, i) => (restore.has(i) ? { ...c, colSpan: 1, rowSpan: 1 } : c));
  return normalizeTable({ ...t, cells });
}

/** Group cell ids by the table they belong to, as indices. */
function byTable(doc: Schematic, ids: Iterable<string>): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const id of ids) {
    if (tableOfCellId(id) === null) continue;
    const r = resolveCell(doc, id);
    if (!r) continue;
    const list = out.get(r.tableIndex);
    if (list) list.push(r.cellIndex);
    else out.set(r.tableIndex, [r.cellIndex]);
  }
  return out;
}

function tablesCommand(label: string, tables: readonly SchTable[]): EditCommand {
  return {
    label,
    apply: (d) => ({ ...d, tables }),
    invert: (before) => tablesCommand(label, before.tables),
  };
}

/**
 * Merge or unmerge the selected cells, across as many tables as the selection
 * touches. Returns null when nothing would change, so the caller can leave the
 * undo stack alone.
 */
export function tableCellsCommand(
  doc: Schematic,
  ids: Iterable<string>,
  op: 'merge' | 'unmerge',
): EditCommand | null {
  const groups = byTable(doc, ids);
  if (groups.size === 0) return null;
  let changed = false;
  const tables = doc.tables.map((t, i) => {
    const indices = groups.get(i);
    if (!indices) return t;
    const next = op === 'merge' ? mergeCells(t, indices) : unmergeCells(t, indices);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? tablesCommand(op === 'merge' ? 'Merge Cells' : 'Unmerge Cells', tables) : null;
}

/** Whether the selection has at least one merged cell to unmerge. */
export function canUnmerge(doc: Schematic, ids: Iterable<string>): boolean {
  for (const [tableIndex, indices] of byTable(doc, ids)) {
    const t = doc.tables[tableIndex];
    if (!t) continue;
    for (const i of indices) {
      const c = t.cells[i];
      if (c && (c.colSpan > 1 || c.rowSpan > 1)) return true;
    }
  }
  return false;
}

/** Whether the selection covers more than one cell of a single table. */
export function canMerge(doc: Schematic, ids: Iterable<string>): boolean {
  for (const [tableIndex, indices] of byTable(doc, ids)) {
    const t = doc.tables[tableIndex];
    if (!t) continue;
    const block = cellBlock(t, indices);
    if (block && (block.colMax - block.colMin > 1 || block.rowMax - block.rowMin > 1)) return true;
  }
  return false;
}

/** The id of a table by index, for callers building a selection. */
export const tableIdAt = (doc: Schematic, i: number): string =>
  refId('table', doc.tables[i]?.uuid, i);

// ----- rows and columns (doAddRow* / doDeleteRows / doAddColumn* / doDeleteColumns) -----

/**
 * A blank copy of a cell: `copyCell` keeps the formatting and **clears the
 * text**, because inserting a row should give you the look of the row you
 * inserted next to, not a second copy of its contents.
 *
 * The span is reset too. A new row's cells are their own 1x1 cells; carrying a
 * merge across would claim cells that are not there yet.
 */
const blankCopy = (c: SchTableCell): SchTableCell => ({
  ...c,
  text: '',
  colSpan: 1,
  rowSpan: 1,
});

/** The row a cell index sits on. */
const rowOf = (t: SchTable, index: number): number => cellRowCol(t, index).row;
/** The column a cell index sits on. */
const colOf = (t: SchTable, index: number): number => cellRowCol(t, index).col;

/**
 * Insert a row above or below `row`, copying that row's cells for their
 * formatting and its height for the new row's.
 */
export function addRow(t: SchTable, row: number, where: 'above' | 'below'): SchTable {
  const n = t.columnCount;
  if (n <= 0) return t;
  const rows = Math.ceil(t.cells.length / n);
  if (row < 0 || row >= rows) return t;
  const origin = tableOrigin(t);
  const at = where === 'above' ? row : row + 1;
  const source = t.cells.slice(row * n, row * n + n);
  if (source.length < n) return t;
  const cells = [...t.cells.slice(0, at * n), ...source.map(blankCopy), ...t.cells.slice(at * n)];
  const height = t.rowHeights[row] ?? 0;
  const rowHeights = [...t.rowHeights.slice(0, at), height, ...t.rowHeights.slice(at)];
  return normalizeTable({ ...t, cells, rowHeights }, origin);
}

/** Insert a column before or after `col`, the same way. */
export function addColumn(t: SchTable, col: number, where: 'before' | 'after'): SchTable {
  const n = t.columnCount;
  if (n <= 0 || col < 0 || col >= n) return t;
  const origin = tableOrigin(t);
  const at = where === 'before' ? col : col + 1;
  const rows = Math.ceil(t.cells.length / n);
  const cells: SchTableCell[] = [];
  for (let r = 0; r < rows; r++) {
    const rowCells = t.cells.slice(r * n, r * n + n);
    const source = rowCells[col];
    if (!source) {
      cells.push(...rowCells);
      continue;
    }
    cells.push(...rowCells.slice(0, at), blankCopy(source), ...rowCells.slice(at));
  }
  const width = t.colWidths[col] ?? 0;
  const colWidths = [...t.colWidths.slice(0, at), width, ...t.colWidths.slice(at)];
  return normalizeTable({ ...t, columnCount: n + 1, cells, colWidths }, origin);
}

/**
 * Delete whole rows. Returns null when every row would go — the table itself is
 * removed then, which is the caller's business rather than this function's
 * (`commit.Remove( table )`).
 */
export function deleteRows(t: SchTable, rows: readonly number[]): SchTable | null {
  const n = t.columnCount;
  if (n <= 0) return t;
  const total = Math.ceil(t.cells.length / n);
  const gone = new Set(rows.filter((r) => r >= 0 && r < total));
  if (gone.size === 0) return t;
  if (gone.size >= total) return null;
  const at = tableOrigin(t);
  const cells = t.cells.filter((_, i) => !gone.has(rowOf(t, i)));
  const rowHeights = t.rowHeights.filter((_, r) => !gone.has(r));
  return normalizeTable({ ...t, cells, rowHeights }, at);
}

/** Delete whole columns; null when every column would go. */
export function deleteColumns(t: SchTable, cols: readonly number[]): SchTable | null {
  const n = t.columnCount;
  if (n <= 0) return t;
  const gone = new Set(cols.filter((c) => c >= 0 && c < n));
  if (gone.size === 0) return t;
  if (gone.size >= n) return null;
  const at = tableOrigin(t);
  const cells = t.cells.filter((_, i) => !gone.has(colOf(t, i)));
  const colWidths = t.colWidths.filter((_, c) => !gone.has(c));
  return normalizeTable({ ...t, columnCount: n - gone.size, cells, colWidths }, at);
}

/** What the row/column menu entries do, as one operation over a selection. */
export type RowColOp =
  | 'addRowAbove'
  | 'addRowBelow'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteRows'
  | 'deleteColumns';

/**
 * Apply a row/column operation to the tables the selection touches.
 *
 * Add uses the topmost (or leftmost) selected cell as the source, matching
 * `doAddRowAbove`'s `topmost` and `doAddRowBelow`'s `bottommost`. Delete takes
 * every row or column holding a selected cell, and drops the whole table when
 * that is all of them.
 */
export function rowColCommand(
  doc: Schematic,
  ids: Iterable<string>,
  op: RowColOp,
): EditCommand | null {
  const groups = byTable(doc, ids);
  if (groups.size === 0) return null;
  let changed = false;
  const tables: SchTable[] = [];
  doc.tables.forEach((t, i) => {
    const indices = groups.get(i);
    if (!indices) {
      tables.push(t);
      return;
    }
    const rowsSel = indices.map((k) => rowOf(t, k));
    const colsSel = indices.map((k) => colOf(t, k));
    let next: SchTable | null = t;
    switch (op) {
      case 'addRowAbove':
        next = addRow(t, Math.min(...rowsSel), 'above');
        break;
      case 'addRowBelow':
        next = addRow(t, Math.max(...rowsSel), 'below');
        break;
      case 'addColumnBefore':
        next = addColumn(t, Math.min(...colsSel), 'before');
        break;
      case 'addColumnAfter':
        next = addColumn(t, Math.max(...colsSel), 'after');
        break;
      case 'deleteRows':
        next = deleteRows(t, [...new Set(rowsSel)]);
        break;
      case 'deleteColumns':
        next = deleteColumns(t, [...new Set(colsSel)]);
        break;
    }
    // null means every row or column went, so the table itself goes: it is
    // simply not pushed (commit.Remove( table )).
    if (next === null) {
      changed = true;
      return;
    }
    if (next !== t) changed = true;
    tables.push(next);
  });
  if (!changed) return null;
  return tablesCommand(ROWCOL_LABELS[op], tables);
}

const ROWCOL_LABELS: Record<RowColOp, string> = {
  addRowAbove: 'Add Row Above',
  addRowBelow: 'Add Row Below',
  addColumnBefore: 'Add Column Before',
  addColumnAfter: 'Add Column After',
  deleteRows: 'Delete Rows',
  deleteColumns: 'Delete Columns',
};
