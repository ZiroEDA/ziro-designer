// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A table's extent and the lines it draws.
 * Counterparts: `PCB_TABLE::GetBoundingBox`, `PCB_TABLE::DrawBorders` and
 * `PCB_TABLE::GetRowCount` / `GetCell` (pcbnew/pcb_table.cpp).
 *
 * ## The header separator uses the *border* stroke
 *
 * Not the separators stroke, on both axes. `DrawBorders` checks
 * `row == 0 && StrokeHeaderSeparator()` first and only then falls through to
 * `StrokeColumns()` / `StrokeRows()`. So a table with the header flag on and
 * both separator flags off still draws the line under its header row — in the
 * heavier border weight.
 *
 * ## Spans suppress the lines they swallow
 *
 * A cell with `colSpan == 0` has been merged away by a neighbour and draws
 * nothing. A cell whose span reaches the last column (or row) draws no
 * separator on that side, because there is nothing beyond it to separate from —
 * that is what makes a merged cell look merged rather than merely wide.
 */
import { textBoxCorners } from './textbox_geometry.js';
import type { PcbTable, PcbTableCell, StrokeType } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** One drawn line of a table, with the stroke it uses. */
export interface TableSegment {
  a: Vec2;
  b: Vec2;
  width: number;
  style: StrokeType;
}

/** `PCB_TABLE::GetRowCount`: the cell count divided by the column count. */
export function tableRowCount(t: PcbTable): number {
  if (t.columnCount <= 0) return 0;
  return Math.floor(t.cells.length / t.columnCount);
}

/** `PCB_TABLE::GetCell`: row-major indexing into the flat cell list. */
export function tableCell(t: PcbTable, row: number, col: number): PcbTableCell | undefined {
  if (col < 0 || col >= t.columnCount) return undefined;
  return t.cells[row * t.columnCount + col];
}

/**
 * The table's extent.
 *
 * Upstream merges only the **first and last** cell's boxes, which is equivalent
 * for a well-formed row-major table because the first is top-left and the last
 * bottom-right. Every cell is unioned here instead: it gives the same answer
 * for such a table without depending on the ordering, and a bounding box that
 * comes out too small silently makes the table unclickable and lets Zoom to Fit
 * clip it.
 */
export function tableBBox(t: PcbTable): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const c of t.cells) {
    for (const p of textBoxCorners(c)) {
      any = true;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!any) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const half = (t.borderExternal ? (t.borderWidth ?? 0) : 0) / 2;
  return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
}

/** `PCB_TABLE::DrawBorders`: every separator and the outer frame. */
export function tableBorderSegments(t: PcbTable): TableSegment[] {
  const out: TableSegment[] = [];
  const rows = tableRowCount(t);
  const cols = t.columnCount;
  if (rows === 0 || cols === 0) return out;

  const border = { width: t.borderWidth ?? 0, style: t.borderStyle ?? 'solid' };
  const sep = { width: t.separatorWidth ?? 0, style: t.separatorStyle ?? 'solid' };

  // Column separators: each cell's right edge, corners[1] -> corners[2].
  for (let col = 0; col < cols - 1; col++) {
    for (let row = 0; row < rows; row++) {
      let stroke: { width: number; style: StrokeType } | null = null;
      if (row === 0 && t.borderHeader) stroke = border;
      else if (t.separatorCols) stroke = sep;
      if (!stroke) continue;

      const cell = tableCell(t, row, col);
      if (!cell) continue;
      if (cell.colSpan === 0) continue; // merged away by a neighbour
      if (col + cell.colSpan === cols) continue; // spans to the edge

      const c = textBoxCorners(cell);
      if (c.length === 4) out.push({ a: c[1]!, b: c[2]!, ...stroke });
    }
  }

  // Row separators: each cell's bottom edge, corners[2] -> corners[3].
  for (let row = 0; row < rows - 1; row++) {
    let stroke: { width: number; style: StrokeType } | null = null;
    if (row === 0 && t.borderHeader) stroke = border;
    else if (t.separatorRows) stroke = sep;
    if (!stroke) continue;

    for (let col = 0; col < cols; col++) {
      const cell = tableCell(t, row, col);
      if (!cell) continue;
      if (cell.rowSpan === 0) continue;
      if (row + cell.rowSpan === rows) continue;

      const c = textBoxCorners(cell);
      if (c.length === 4) out.push({ a: c[2]!, b: c[3]!, ...stroke });
    }
  }

  // The outer frame, from the four corner cells.
  if (t.borderExternal && (t.borderWidth ?? 0) >= 0) {
    const tl = textBoxCorners(tableCell(t, 0, 0) ?? t.cells[0]!);
    const tr = textBoxCorners(tableCell(t, 0, cols - 1) ?? t.cells[0]!);
    const br = textBoxCorners(tableCell(t, rows - 1, cols - 1) ?? t.cells[t.cells.length - 1]!);
    const bl = textBoxCorners(tableCell(t, rows - 1, 0) ?? t.cells[t.cells.length - 1]!);
    if (tl.length === 4 && tr.length === 4 && br.length === 4 && bl.length === 4) {
      out.push({ a: tl[0]!, b: tr[1]!, ...border });
      out.push({ a: tr[1]!, b: br[2]!, ...border });
      out.push({ a: br[2]!, b: bl[3]!, ...border });
      out.push({ a: bl[3]!, b: tl[0]!, ...border });
    }
  }

  return out;
}
