// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading and writing a table's properties.
 * Counterpart: `DIALOG_TABLE_PROPERTIES` (pcbnew/dialogs/dialog_table_properties.cpp).
 *
 * ## The grid is mirrored on a back layer
 *
 * `TransferDataFromWindow` reads the editing grid with
 * `GetCell(row, colCount - 1 - col)` when the table is on a back layer, and
 * `GetCell(row, col)` otherwise. A table on B.Cu is seen from the *other side*
 * of the board, so its leftmost visible column is the last one in storage.
 * Getting this wrong reverses the columns of every back-layer table the moment
 * anyone opens its dialog — and only on a back layer, so it would pass every
 * test written against a front one.
 *
 * ## The layer is set on the table *and* every cell
 *
 * Upstream assigns the chosen layer to each cell inside the same loop, then to
 * the table. A cell left behind on the old layer would still be drawn, just on
 * the wrong one.
 *
 * ## A stroke width is only meaningful while its flags are on
 *
 * Upstream stores -1 as "no stroke" when both of a pair's flags are off. That
 * sentinel never reaches the file — the serializer omits the whole stroke in
 * that case — so it is not modelled; the flags alone carry it, and the width is
 * kept so switching a border back on restores what was there.
 */
import { parseBoardItemId } from './edit-board.js';
import { tableRowCount } from '@ziroeda/common/src/table.js';
import type { Board, PcbTable, PcbTableCell, StrokeType } from './types.js';

/** Every control on the dialog, flattened. The cell texts are the grid. */
export interface TableValues {
  layer: string;
  locked: boolean;
  borderExternal: boolean;
  borderHeader: boolean;
  borderWidth: number;
  borderStyle: StrokeType;
  separatorRows: boolean;
  separatorCols: boolean;
  separatorWidth: number;
  separatorStyle: StrokeType;
  /** Cell text in *display* order: `[row][col]` as the grid shows it. */
  cellText: string[][];
}

/**
 * The single selected table's index, or null. `EDIT_TOOL::Properties`
 * (pcbnew/tools/edit_tool.cpp:2142-2145) opens the dialog only for a selection
 * of one board item.
 *
 * eeschema has a `tableAt` too and it stays separate: upstream's equivalent test
 * lives in each editor's own edit tool, and the two read different selection-id
 * namespaces -- board ids through `parseBoardItemId` here, `refId('table', ...)`
 * there. There is no shared question for a shared function to answer.
 */
export function tableAt(board: Board, selection: Iterable<string>): number | null {
  const ids = [...selection];
  if (ids.length !== 1) return null;
  const ref = parseBoardItemId(ids[0]!);
  if (!ref || ref.kind !== 'table') return null;
  return board.tables[ref.index] ? ref.index : null;
}

/**
 * `BOARD::IsBackLayer` for the standard layer set: a back layer is one whose
 * name starts with `B.`.
 */
export function isBackLayer(layer: string): boolean {
  return layer.startsWith('B.');
}

/**
 * Which stored column a display column maps to.
 *
 * Identity on a front layer; mirrored on a back one, because the board is being
 * seen from the other side.
 */
export function displayToStoredCol(col: number, colCount: number, back: boolean): number {
  return back ? colCount - 1 - col : col;
}

/** `TransferDataToWindow`: the dialog's starting values. */
export function collectTableValues(t: PcbTable): TableValues {
  const back = isBackLayer(t.layer);
  const rows = tableRowCount(t);
  const cellText: string[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: string[] = [];
    for (let col = 0; col < t.columnCount; col++) {
      const stored = displayToStoredCol(col, t.columnCount, back);
      line.push(t.cells[row * t.columnCount + stored]?.text ?? '');
    }
    cellText.push(line);
  }
  return {
    layer: t.layer,
    locked: t.locked ?? false,
    borderExternal: t.borderExternal,
    borderHeader: t.borderHeader,
    borderWidth: t.borderWidth ?? 0,
    borderStyle: t.borderStyle ?? 'solid',
    separatorRows: t.separatorRows,
    separatorCols: t.separatorCols,
    separatorWidth: t.separatorWidth ?? 0,
    separatorStyle: t.separatorStyle ?? 'solid',
    cellText,
  };
}

/** `TransferDataFromWindow`, plus the source patching that makes it stick. */
export function applyTableValues(board: Board, index: number, v: TableValues): Board {
  const t = board.tables[index];
  if (!t) return board;

  const before = collectTableValues(t);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  // The grid is written back through the *new* layer's handedness: changing a
  // table from front to back in the same edit flips which column is which.
  const back = isBackLayer(v.layer);
  const rows = tableRowCount(t);

  const cells: PcbTableCell[] = t.cells.map((c) => ({ ...c, layer: v.layer }));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < t.columnCount; col++) {
      const stored = displayToStoredCol(col, t.columnCount, back);
      const cell = cells[row * t.columnCount + stored];
      if (!cell) continue;
      // A merged-away cell has no text of its own to set.
      if (cell.colSpan === 0 || cell.rowSpan === 0) continue;
      cell.text = v.cellText[row]?.[col] ?? cell.text;
    }
  }

  const next: PcbTable = {
    ...t,
    layer: v.layer,
    locked: v.locked,
    borderExternal: v.borderExternal,
    borderHeader: v.borderHeader,
    borderWidth: v.borderWidth,
    borderStyle: v.borderStyle,
    separatorRows: v.separatorRows,
    separatorCols: v.separatorCols,
    separatorWidth: v.separatorWidth,
    separatorStyle: v.separatorStyle,
    cells,
  };

  return {
    ...board,
    tables: board.tables.map((cur, i) => (i === index ? next : cur)),
  };
}
