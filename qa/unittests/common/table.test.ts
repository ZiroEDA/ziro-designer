// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_TABLE::GetRowCount` (eeschema/sch_table.h:122) and `PCB_TABLE::GetRowCount`
 * (pcbnew/pcb_table.h:125) are the same statement, `m_cells.size() / m_colCount`,
 * and this is the one place we implement it. The schematic copy used to round the
 * division *up* and to floor the answer at one row, which showed the Table
 * Properties grid a row that has no cells behind it; these cases pin the C++.
 */
import { describe, expect, it } from 'vitest';
import { tableRowCount } from '@ziroeda/common';

const grid = (cells: number, columnCount: number): { cells: number[]; columnCount: number } => ({
  cells: Array.from({ length: cells }, (_, i) => i),
  columnCount,
});

describe('tableRowCount', () => {
  it('divides the cell count by the column count', () => {
    expect(tableRowCount(grid(6, 3))).toBe(2);
    expect(tableRowCount(grid(12, 4))).toBe(3);
    expect(tableRowCount(grid(1, 1))).toBe(1);
  });

  it('does not count a ragged final row', () => {
    // Integer division in C++: 7 / 3 == 2. A third row would index past the end
    // of m_cells, and the dialog would show a row of blanks that is not a row.
    expect(tableRowCount(grid(7, 3))).toBe(2);
    expect(tableRowCount(grid(2, 3))).toBe(0);
  });

  it('is zero rows for an empty table, not one', () => {
    expect(tableRowCount(grid(0, 3))).toBe(0);
  });

  it('is zero rows when there are no columns', () => {
    // Division by zero upstream; unreachable from a file the reader accepted,
    // and answered rather than left as Infinity here.
    expect(tableRowCount(grid(6, 0))).toBe(0);
    expect(tableRowCount(grid(6, -1))).toBe(0);
  });
});
