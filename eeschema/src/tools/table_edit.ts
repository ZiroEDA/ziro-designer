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
import { cellRowCol, normalizeTable } from './table_layout.js';
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
