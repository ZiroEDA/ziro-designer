// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table layout. Counterpart: `SCH_TABLE::Normalize` and
 * `SCH_TABLECELL_POINT_EDIT_BEHAVIOR` — the third layer of #178.
 *
 * Up to now a table's geometry has only ever been *read*: each cell carries its
 * own rectangle, the reader fills it and the renderer draws it. Nothing has
 * needed to put the cells back where the column widths say they belong. Every
 * remaining piece of #178 does — the point editor, merge/unmerge, and inserting
 * or deleting a row — because each of them changes a width or a span and then
 * has to re-lay the grid out.
 *
 * `normalizeTable` is that step, and it is deliberately the *only* place cell
 * rectangles are computed. Two sources of truth for where a cell sits is how a
 * table ends up drawn one way and clicked another.
 *
 * ### The resize rule, which is not the obvious one
 *
 * Dragging a cell's right edge does not set "this cell's width". It sets the
 * width of the **last column the cell spans**, after subtracting the columns
 * before it:
 *
 * ```
 * colWidth = draggedWidth - sum(width of each earlier spanned column)
 * ```
 *
 * For an unspanned cell those are the same thing. For a merged one they are
 * not, and setting the whole span's width on the first column would move every
 * cell to its right. Rows work the same way.
 *
 * ### Rotated tables
 *
 * Upstream swaps the two axes when the cell text is not horizontal
 * (`!GetTextAngle().IsHorizontal()`), because the grid is drawn turned on its
 * side. We do not model a rotated table — `transformItems` has no table arm at
 * all yet (see #178) — so there is nothing here to swap. When rotation lands,
 * this is the function that has to learn about it.
 */

import type { SchTable, SchTableCell } from '../types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Which edge of a cell was dragged. */
export type CellEdge = 'right' | 'bottom';

/** The table's origin: where `Normalize` starts laying cells out. */
export function tableOrigin(t: SchTable): Vec2 {
  const first = t.cells[0];
  if (!first) return { x: 0, y: 0 };
  return { x: Math.min(first.start.x, first.end.x), y: Math.min(first.start.y, first.end.y) };
}

/** The row and column a cell index falls on, given the table's column count. */
export const cellRowCol = (t: SchTable, index: number): { row: number; col: number } => ({
  row: Math.floor(index / t.columnCount),
  col: index % t.columnCount,
});

/**
 * `SCH_TABLE::Normalize`: put every cell where the column widths and row
 * heights say it belongs, growing a spanned cell over the columns and rows it
 * covers.
 *
 * Cells are laid out in document order, row-major, which is the order the file
 * writes them in and the order the reader keeps.
 */
export function normalizeTable(t: SchTable): SchTable {
  if (t.cells.length === 0 || t.columnCount <= 0) return t;
  const origin = tableOrigin(t);
  const rows = Math.ceil(t.cells.length / t.columnCount);
  const colWidth = (c: number): number => t.colWidths[c] ?? 0;
  const rowHeight = (r: number): number => t.rowHeights[r] ?? 0;

  let changed = false;
  const cells: SchTableCell[] = [];
  let y = origin.y;
  for (let row = 0; row < rows; row++) {
    let x = origin.x;
    for (let col = 0; col < t.columnCount; col++) {
      const index = row * t.columnCount + col;
      const cell = t.cells[index];
      if (!cell) break;
      let w = colWidth(col);
      let h = rowHeight(row);
      // A merged cell reaches across the columns and rows it swallowed.
      for (let ii = col + 1; ii < col + cell.colSpan; ii++) w += colWidth(ii);
      for (let ii = row + 1; ii < row + cell.rowSpan; ii++) h += rowHeight(ii);
      const start = { x, y };
      const end = { x: x + w, y: y + h };
      if (
        cell.start.x !== start.x ||
        cell.start.y !== start.y ||
        cell.end.x !== end.x ||
        cell.end.y !== end.y
      ) {
        changed = true;
        cells.push({ ...cell, start, end });
      } else {
        cells.push(cell);
      }
      x += colWidth(col);
    }
    y += rowHeight(row);
  }
  // Any trailing cells the row walk did not reach (a ragged final row) keep
  // what they had rather than being dropped.
  for (let i = cells.length; i < t.cells.length; i++) cells.push(t.cells[i]!);
  return changed ? { ...t, cells } : t;
}

/**
 * The point-editor drag: the cell's `edge` was moved so that the cell now
 * measures `size` across. Returns the table with the affected column width or
 * row height updated and the grid re-laid-out.
 *
 * `size` is the cell's new full width or height, spans included — that is what
 * the drag produces. Splitting it back across the span is this function's job.
 *
 * A drag that would make the column narrower than nothing is clamped to zero
 * rather than folding the grid inside out.
 */
export function resizeCellEdge(t: SchTable, index: number, edge: CellEdge, size: number): SchTable {
  const cell = t.cells[index];
  if (!cell || t.columnCount <= 0) return t;
  const { row, col } = cellRowCol(t, index);

  if (edge === 'right') {
    let width = size;
    for (let ii = 0; ii < cell.colSpan - 1; ii++) width -= t.colWidths[col + ii] ?? 0;
    const target = col + cell.colSpan - 1;
    if (target >= t.colWidths.length) return t;
    const colWidths = t.colWidths.map((w, i) => (i === target ? Math.max(0, width) : w));
    return normalizeTable({ ...t, colWidths });
  }

  let height = size;
  for (let ii = 0; ii < cell.rowSpan - 1; ii++) height -= t.rowHeights[row + ii] ?? 0;
  const target = row + cell.rowSpan - 1;
  if (target >= t.rowHeights.length) return t;
  const rowHeights = t.rowHeights.map((h, i) => (i === target ? Math.max(0, height) : h));
  return normalizeTable({ ...t, rowHeights });
}
