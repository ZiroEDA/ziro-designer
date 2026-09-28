// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table cells as selectable items (`SCH_TABLECELL`). The first layer of #178:
 * a table is currently one item, and everything after this — the cell point
 * editor, cell properties, `SCH_EDIT_TABLE_TOOL` — needs a cell to be
 * addressable before it can do anything.
 *
 * Two rules from `SCH_SELECTION_TOOL`, both easy to miss and both here:
 *
 *  - **A spanned-over cell is not selectable.** `Selectable()` rejects a cell
 *    whose `colSpan` or `rowSpan` is 0. Those are the cells a merged neighbour
 *    swallowed: they still exist in the file, holding the grid's shape, but
 *    there is nothing on screen to click.
 *  - **Move and rotate promote a cell selection to its table.** Those two call
 *    `RequestSelection( …, aPromoteCellSelections = true )`, which unselects
 *    every cell and selects its parent instead. A cell cannot be moved out of
 *    the table it belongs to, so dragging with one selected drags the table —
 *    while an edit that *is* per-cell keeps the cell.
 *
 * Cell rectangles come straight from the model: each `SchTableCell` carries its
 * own `start`/`end`, which the reader fills and the renderer already draws
 * from. There is no need to re-derive them from `colWidths`/`rowHeights`, and
 * re-deriving would risk disagreeing with what is on screen.
 */

import type { SchTable, SchTableCell, Schematic } from '../types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { refId } from './hittest.js';

/** The id of a table's cell, in the sheet-pin style: `<tableRefId>:cell<k>`. */
export const tableCellId = (tableRefId: string, index: number): string =>
  `${tableRefId}:cell${index}`;

/** The table id a cell id belongs to, or null when it is not a cell id. */
export function tableOfCellId(id: string): string | null {
  const m = /^(.*):cell\d+$/.exec(id);
  return m ? m[1]! : null;
}

/** The cell's index within its table, or null when the id is not a cell id. */
export function cellIndexOfId(id: string): number | null {
  const m = /:cell(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * `SCH_SELECTION_TOOL::Selectable` for a cell: a span of 0 means a merged
 * neighbour covers this cell, so there is nothing to click.
 */
export const isSelectableCell = (c: SchTableCell): boolean => c.colSpan > 0 && c.rowSpan > 0;

/** A cell's rectangle, normalized so start is the top-left whichever way it was written. */
export function cellBox(c: SchTableCell): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(c.start.x, c.end.x),
    y0: Math.min(c.start.y, c.end.y),
    x1: Math.max(c.start.x, c.end.x),
    y1: Math.max(c.start.y, c.end.y),
  };
}

/**
 * The selectable cell of `table` containing `p`, as an index, or -1.
 *
 * Selectable cells of a well-formed table do not overlap — the ones a merge
 * covers are exactly the ones the span rule rejects — so a tie means malformed
 * input. Later wins, matching the renderer, which draws cells in order and so
 * leaves the last one on top: whatever the user can see is what they get.
 */
export function cellAt(table: SchTable, p: Vec2): number {
  let found = -1;
  table.cells.forEach((c, i) => {
    if (!isSelectableCell(c)) return;
    const b = cellBox(c);
    if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) found = i;
  });
  return found;
}

/** Every table in the document, with the id the selection addresses it by. */
function tablesWithIds(doc: Schematic): { table: SchTable; id: string }[] {
  return doc.tables.map((t, i) => ({ table: t, id: refId('table', t.uuid, i) }));
}

/**
 * The cell id at a world point, or null. Tables later in the document win, as
 * they are drawn later and so sit on top.
 */
export function cellIdAt(doc: Schematic, p: Vec2): string | null {
  let found: string | null = null;
  for (const { table, id } of tablesWithIds(doc)) {
    const k = cellAt(table, p);
    if (k !== -1) found = tableCellId(id, k);
  }
  return found;
}

/**
 * `RequestSelection( …, aPromoteCellSelections = true )`: every cell id becomes
 * its parent table's id. Used by move and rotate, which cannot act on a cell
 * alone.
 *
 * Ids that are not cell ids pass through, and a table already in the selection
 * is not added twice.
 */
export function promoteCellSelection(ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) out.add(tableOfCellId(id) ?? id);
  return out;
}

/** Whether a selection holds any cell id at all. */
export const hasCellSelection = (ids: Iterable<string>): boolean => {
  for (const id of ids) if (tableOfCellId(id) !== null) return true;
  return false;
};

/** Resolve a cell id back to its table and cell, or null if either is gone. */
export function resolveCell(
  doc: Schematic,
  id: string,
): { table: SchTable; tableIndex: number; cell: SchTableCell; cellIndex: number } | null {
  const tableId = tableOfCellId(id);
  const k = cellIndexOfId(id);
  if (tableId === null || k === null) return null;
  const tableIndex = doc.tables.findIndex((t, i) => refId('table', t.uuid, i) === tableId);
  if (tableIndex === -1) return null;
  const table = doc.tables[tableIndex]!;
  const cell = table.cells[k];
  if (!cell) return null;
  return { table, tableIndex, cell, cellIndex: k };
}
