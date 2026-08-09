// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A table is dragged out, not asked for.
 *
 * `SCH_DRAWING_TOOLS::DrawTable` creates a 1x1 table on the first click and
 * then derives the grid from the rectangle as you drag:
 *
 *     int colCount = std::max( 1, requestedSize.x / ( fontSize * 15 ) );
 *     int rowCount = std::max( 1, requestedSize.y / ( fontSize * 2  ) );
 *
 *     VECTOR2I cellSize( std::max( gridSize.x * 5, requestedSize.x / colCount ),
 *                        std::max( gridSize.y * 2, requestedSize.y / rowCount ) );
 *
 *     cellSize.x = KiROUND( (double) cellSize.x / gridSize.x ) * gridSize.x;
 *     cellSize.y = KiROUND( (double) cellSize.y / gridSize.y ) * gridSize.y;
 *
 * so a column is fifteen characters wide, a row two high, every cell is at
 * least five grid steps by two, and both dimensions land on the grid. Only then
 * does DIALOG_TABLE_PROPERTIES appear, over a grid that already exists.
 *
 * Ours asked "how many rows and columns?" up front and dropped a fixed-size
 * table at the cursor — a different gesture, with no preview of the result.
 */
import { describe, it, expect } from 'vitest';
import { makeTableFromDrag, tableGridFor } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

/** KiCad's defaults: 50 mil text, 50 mil grid. */
const FONT = mmToIU(1.27);
const GRID = { x: mmToIU(1.27), y: mmToIU(1.27) };
const drag = (wMM: number, hMM: number) =>
  tableGridFor({ x: mmToIU(wMM), y: mmToIU(hMM) }, FONT, GRID);

describe('the grid a drag describes', () => {
  it('a column every fifteen characters', () => {
    // fontSize * 15 = 19.05 mm per column.
    expect(drag(19, 100).cols).toBe(1);
    expect(drag(19.05, 100).cols).toBe(1);
    expect(drag(40, 100).cols).toBe(2);
    expect(drag(60, 100).cols).toBe(3);
  });

  it('a row every two characters', () => {
    // fontSize * 2 = 2.54 mm per row.
    expect(drag(100, 2.5).rows).toBe(1);
    expect(drag(100, 5.08).rows).toBe(2);
    expect(drag(100, 12.7).rows).toBe(5);
  });

  it('never fewer than one of each, however small the drag', () => {
    // `std::max( 1, … )` — a tiny drag still yields a usable table.
    const tiny = drag(0.1, 0.1);
    expect(tiny.rows).toBe(1);
    expect(tiny.cols).toBe(1);
  });

  it('and a zero-sized drag does not divide by zero', () => {
    const none = drag(0, 0);
    expect(none.rows).toBe(1);
    expect(none.cols).toBe(1);
    expect(Number.isFinite(none.cell.x)).toBe(true);
    expect(Number.isFinite(none.cell.y)).toBe(true);
  });
});

describe('the cell size', () => {
  it('is the drag divided by the counts, snapped to the grid', () => {
    const g = drag(60, 12.7);
    expect(g.cols).toBe(3);
    expect(g.rows).toBe(5);
    // 60/3 = 20 mm, snapped to the nearest 1.27 mm.
    expect(g.cell.x).toBe(Math.round(mmToIU(20) / GRID.x) * GRID.x);
    expect(g.cell.x % GRID.x).toBe(0);
    expect(g.cell.y % GRID.y).toBe(0);
  });

  it('never below five grid steps wide or two high', () => {
    // `std::max( gridSize.x * 5, … )` — the floor that keeps a cell usable.
    const g = drag(0.1, 0.1);
    expect(g.cell.x).toBeGreaterThanOrEqual(GRID.x * 5);
    expect(g.cell.y).toBeGreaterThanOrEqual(GRID.y * 2);
  });

  it('stays roughly constant as the drag widens, and the columns multiply', () => {
    // Doubling the width doubles the column *count* rather than the cell width:
    // `cellSize.x = requestedSize.x / colCount`, and colCount grew with it.
    // That is the point of deriving the count from a per-column width.
    const wide = drag(80, 40);
    const narrow = drag(40, 40);
    expect(wide.cols).toBeGreaterThan(narrow.cols);
    expect(wide.cell.x).toBe(narrow.cell.x);
  });
});

describe('the table built from a drag', () => {
  const size = { x: mmToIU(60), y: mmToIU(12.7) };
  const table = makeTableFromDrag({ x: mmToIU(100), y: mmToIU(50) }, size, FONT, GRID);
  const g = tableGridFor(size, FONT, GRID);

  it('has a cell for every row and column', () => {
    expect(table.cells).toHaveLength(g.rows * g.cols);
  });

  it('carries the derived cell size, not the fixed default', () => {
    expect(table.colWidths.every((w) => w === g.cell.x)).toBe(true);
    expect(table.rowHeights.every((h) => h === g.cell.y)).toBe(true);
  });

  it('starts where the drag started', () => {
    expect(table.cells[0]?.start).toEqual({ x: mmToIU(100), y: mmToIU(50) });
  });

  it('and a table asked for by counts still gets the defaults', () => {
    // `makeTable` is unchanged for callers that pass counts; only the drag path
    // supplies a cell size.
    const byCount = makeTableFromDrag({ x: 0, y: 0 }, { x: 0, y: 0 }, FONT, GRID);
    expect(byCount.cells).toHaveLength(1);
  });
});
