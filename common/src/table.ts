// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The grid arithmetic a table's flat cell list implies.
 *
 * Upstream there is no common table base: `SCH_TABLE` derives from `SCH_ITEM`
 * and `PCB_TABLE` from `BOARD_ITEM_CONTAINER`, and each declares its own
 * `GetRowCount()`. But the two bodies are the *same statement* —
 * `eeschema/sch_table.h:122` and `pcbnew/pcb_table.h:125` both read
 *
 *     int GetRowCount() const { return m_cells.size() / m_colCount; }
 *
 * — so it is copy-paste upstream rather than an editor-specific rule, and the
 * two copies we grew from it had already drifted apart. One implementation here
 * keeps them from drifting again.
 *
 * Only the arithmetic is shared. Everything a row count is *used* for — which
 * stroke draws a separator, how a back layer mirrors the columns, what a cell
 * looks like — stays with its editor, because those genuinely differ.
 */

/** Whatever a table is made of, this is all the row count needs to see. */
export interface TableGrid {
  /** Cells in row-major order, `row * columnCount + col`. */
  readonly cells: readonly unknown[];
  readonly columnCount: number;
}

/**
 * `SCH_TABLE::GetRowCount` / `PCB_TABLE::GetRowCount`: the cell count divided by
 * the column count.
 *
 * Integer division, so a ragged final row does not count as a row — upstream
 * would index past the end of `m_cells` if it did. A column count of zero is
 * division by zero upstream (undefined behaviour, unreachable from a file the
 * reader accepted); it answers zero rows here rather than `Infinity`.
 */
export function tableRowCount(aTable: TableGrid): number {
  if (aTable.columnCount <= 0) return 0;
  return Math.floor(aTable.cells.length / aTable.columnCount);
}
