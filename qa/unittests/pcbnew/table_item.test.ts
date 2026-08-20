// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tables as real board items, and the lines they draw.
 * Counterparts: `PCB_TABLE::GetBoundingBox`, `HitTest`, `DrawBorders`,
 * `GetRowCount` / `GetCell`.
 *
 * Three rules in `DrawBorders` are easy to miss and are what these tests are
 * mostly for:
 *
 * - **The header separator uses the *border* stroke**, not the separators
 *   stroke, on both axes. The check is `row == 0 && StrokeHeaderSeparator()`
 *   *before* the `StrokeColumns()` / `StrokeRows()` fallthrough, so a table with
 *   the header flag on and both separator flags off still draws the line under
 *   its header row — in the heavier weight.
 * - **A cell with a zero span has been merged away** and draws nothing.
 * - **A cell whose span reaches the last column or row draws no separator on
 *   that side** — there is nothing beyond it to separate from. That is what
 *   makes a merged cell look merged instead of merely wide.
 *
 * A 2x2 grid is the smallest fixture that can show all of them. Note the counts
 * are per *cell*, not per visible divider: a column separator is a cell's right
 * edge, so the one vertical divider of a 2-row table is two segments. I had that
 * backwards at first and the counts are stated explicitly below because of it.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  allBoardItemIds,
  boardItemBBox,
  boardItemsInBox,
  deleteBoardItems,
  hitTestBoard,
  isBoardItemLocked,
  moveBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';
import { itemAnchorPoint } from '@ziroeda/pcbnew/src/move_exact.js';
import {
  DEFAULT_SELECTION_FILTER,
  itemPassesFilter,
} from '@ziroeda/pcbnew/src/filter_selection.js';
import { tableBBox, tableBorderSegments, tableCell } from '@ziroeda/pcbnew/src/table_geometry.js';
import { tableRowCount } from '@ziroeda/common/src/table.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const TB = 'table:0';

/** A 2x2 grid at (0,0)-(20,10), cells 10x5, in row-major order. */
const cell = (
  text: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  span = '(span 1 1)',
): string => `(table_cell "${text}"
        (start ${x0} ${y0}) (end ${x1} ${y1})
        (margins 1 1 1 1)
        ${span}
        (layer "F.SilkS")
        (uuid "aaaaaaaa-0000-0000-0000-00000000000${text}")
        (effects (font (size 1 1))))`;

const TABLE = (opts = '', spans: string[] = []): string => `(table
    (column_count 2)
    (uuid "d6f049b1-ff3f-4087-ba96-404a150d1c9b")
    (layer "F.SilkS")
    ${opts || '(border (external yes) (header no) (stroke (width 0.2) (type solid)))\n    (separators (rows yes) (cols yes) (stroke (width 0.05) (type solid)))'}
    (column_widths 10 10)
    (row_heights 5 5)
    (cells
      ${cell('1', 0, 0, 10, 5, spans[0] ?? '(span 1 1)')}
      ${cell('2', 10, 0, 20, 5, spans[1] ?? '(span 1 1)')}
      ${cell('3', 0, 5, 10, 10, spans[2] ?? '(span 1 1)')}
      ${cell('4', 10, 5, 20, 10, spans[3] ?? '(span 1 1)')}))`;

const read = (...extra: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );

describe('the grid', () => {
  it('derives the row count from the cell count and columns', () => {
    expect(tableRowCount(read(TABLE()).tables[0]!)).toBe(2);
  });

  it('is nothing when there are no columns', () => {
    const t = { ...read(TABLE()).tables[0]!, columnCount: 0 };

    expect(tableRowCount(t)).toBe(0);
  });

  it('indexes cells row-major', () => {
    const t = read(TABLE()).tables[0]!;

    expect(tableCell(t, 0, 0)!.text).toBe('1');
    expect(tableCell(t, 0, 1)!.text).toBe('2');
    expect(tableCell(t, 1, 0)!.text).toBe('3');
    expect(tableCell(t, 1, 1)!.text).toBe('4');
  });

  it('has no cell outside the column range', () => {
    expect(tableCell(read(TABLE()).tables[0]!, 0, 2)).toBeUndefined();
    expect(tableCell(read(TABLE()).tables[0]!, 0, -1)).toBeUndefined();
  });
});

describe('the bounding box', () => {
  it('covers every cell', () => {
    const b = tableBBox(read(TABLE()).tables[0]!);

    expect(b.minX).toBeLessThanOrEqual(MM(0));
    expect(b.maxX).toBeGreaterThanOrEqual(MM(20));
    expect(b.maxY).toBeGreaterThanOrEqual(MM(10));
  });

  it('adds half the external border, and only when it is drawn', () => {
    const withBorder = tableBBox(read(TABLE()).tables[0]!);
    const noBorder = tableBBox(
      read(
        TABLE(
          '(border (external no) (header no))\n    (separators (rows yes) (cols yes) (stroke (width 0.05) (type solid)))',
        ),
      ).tables[0]!,
    );

    expect(withBorder.minX).toBe(MM(0) - MM(0.2) / 2);
    expect(noBorder.minX).toBe(MM(0));
  });

  it('ignores a border width that is present but not drawn', () => {
    // The `external no` fixture above carries no stroke at all, so it cannot
    // tell "ignored because external is off" from "ignored because there is no
    // width". Header on and external off puts a real width in the file that
    // must still not widen the box.
    const b = tableBBox(
      read(
        TABLE(
          '(border (external no) (header yes) (stroke (width 0.2) (type solid)))\n    (separators (rows no) (cols no))',
        ),
      ).tables[0]!,
    );

    expect(b.minX).toBe(MM(0));
  });

  it('is nothing for a table with no cells', () => {
    const t = { ...read(TABLE()).tables[0]!, cells: [] };

    expect(tableBBox(t)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe('the lines a table draws', () => {
  const segs = (opts?: string, spans?: string[]) =>
    tableBorderSegments(read(TABLE(opts, spans)).tables[0]!);

  it('draws each interior divider as one segment per cell, plus four outer edges', () => {
    // A column separator is a *cell's right edge*, so a 2-row table gets two
    // vertical segments that together form one visible divider; likewise two
    // horizontal ones across the two columns. 2 + 2 + 4 frame = 8.
    expect(segs()).toHaveLength(8);
  });

  it('drops the outer frame when external is off', () => {
    const s = segs(
      '(border (external no) (header no))\n    (separators (rows yes) (cols yes) (stroke (width 0.05) (type solid)))',
    );

    expect(s).toHaveLength(4);
  });

  it('draws nothing at all with every flag off', () => {
    expect(
      segs('(border (external no) (header no))\n    (separators (rows no) (cols no))'),
    ).toHaveLength(0);
  });

  it('draws the header line in the border weight, not the separator weight', () => {
    // The rule: `row == 0 && StrokeHeaderSeparator()` wins before the
    // StrokeColumns/StrokeRows fallthrough.
    const s = segs(
      '(border (external no) (header yes) (stroke (width 0.2) (type solid)))\n    (separators (rows no) (cols no))',
    );

    // Row 0 only: one column-separator segment (col 0) and two row-separator
    // segments (one per column) = 3, every one in the border weight.
    expect(s).toHaveLength(3);
    for (const seg of s) expect(seg.width).toBe(MM(0.2));
  });

  it('uses the separator weight for the rest', () => {
    const s = segs(
      '(border (external no) (header no))\n    (separators (rows yes) (cols yes) (stroke (width 0.05) (type solid)))',
    );

    for (const seg of s) expect(seg.width).toBe(MM(0.05));
  });

  it('carries the stroke style through', () => {
    const s = segs(
      '(border (external no) (header no))\n    (separators (rows yes) (cols yes) (stroke (width 0.05) (type dash)))',
    );

    expect(s[0]!.style).toBe('dash');
  });

  const NOEXT =
    '(border (external no) (header no))\n    (separators (rows yes) (cols yes) (stroke (width 0.05) (type solid)))';
  /** [vertical, horizontal] segment counts. */
  const vh = (s: ReturnType<typeof segs>): [number, number] => [
    s.filter((x) => x.a.x === x.b.x).length,
    s.filter((x) => x.a.y === x.b.y).length,
  ];

  it('skips a cell that was merged away', () => {
    // colSpan 0 means a neighbour swallowed it, so its right edge is not drawn:
    // the vertical count drops from 2 to 1 while the horizontals are untouched.
    expect(vh(segs(NOEXT))).toEqual([2, 2]);
    expect(vh(segs(NOEXT, ['(span 1 1)', '(span 1 1)', '(span 0 1)', '(span 1 1)']))).toEqual([
      1, 2,
    ]);
  });

  it('draws no column separator for a cell spanning to the last column', () => {
    // Nothing beyond it to separate from — this is what makes a merged cell
    // look merged rather than merely wide. Again only the verticals change.
    expect(vh(segs(NOEXT, ['(span 2 1)', '(span 1 1)', '(span 1 1)', '(span 1 1)']))).toEqual([
      1, 2,
    ]);
  });
});

describe('tables as board items', () => {
  it('are enumerated', () => {
    expect(allBoardItemIds(read(TABLE()))).toContain(TB);
  });

  it('report a bounding box through the board', () => {
    expect(boardItemBBox(read(TABLE()), TB)).not.toBeNull();
    expect(boardItemBBox(read(TABLE()), 'table:9')).toBeNull();
  });

  it('are clickable anywhere inside, like a text box', () => {
    expect(hitTestBoard(read(TABLE()), { x: MM(5), y: MM(2) }, 0)).toBe(TB);
  });

  it('are not clickable outside', () => {
    expect(hitTestBoard(read(TABLE()), { x: MM(50), y: MM(50) }, MM(0.2))).toBeNull();
  });

  it('are taken by a box that crosses them', () => {
    expect(boardItemsInBox(read(TABLE()), MM(-1), MM(-1), MM(2), MM(2), false)).toContain(TB);
  });

  it('follow the text selection filter', () => {
    const b = read(TABLE());
    const f = (over = {}) => ({ ...DEFAULT_SELECTION_FILTER, ...over });

    expect(itemPassesFilter(b, TB, f({ text: true }))).toBe(true);
    expect(itemPassesFilter(b, TB, f({ text: false }))).toBe(false);
  });

  it('anchor on the first cell', () => {
    expect(itemAnchorPoint(read(TABLE()), TB)).toEqual({ x: MM(0), y: MM(0) });
  });

  it('read the locked flag', () => {
    const locked = TABLE().replace('(column_count 2)', '(column_count 2) (locked yes)');

    expect(isBoardItemLocked(read(locked), TB)).toBe(true);
    expect(isBoardItemLocked(read(TABLE()), TB)).toBe(false);
  });
});

describe('moving a table', () => {
  it('moves every cell', () => {
    const b = moveBoardItems(read(TABLE()), new Set([TB]), { x: MM(5), y: MM(3) });
    const t = b.tables[0]!;

    expect(t.cells[0]!.start).toEqual({ x: MM(5), y: MM(3) });
    expect(t.cells[3]!.end).toEqual({ x: MM(25), y: MM(13) });
  });

  it('survives a save and reload', () => {
    const moved = moveBoardItems(read(TABLE()), new Set([TB]), { x: MM(5), y: 0 });
    const back = readBoard(parse(serializeBoard(moved)));

    expect(back.tables[0]!.cells[0]!.start).toEqual({ x: MM(5), y: MM(0) });
    expect(back.tables[0]!.cells).toHaveLength(4);
  });

  it('leaves the column widths alone, which are sizes not positions', () => {
    const b = moveBoardItems(read(TABLE()), new Set([TB]), { x: MM(5), y: 0 });

    expect(b.tables[0]!.columnWidths).toEqual([MM(10), MM(10)]);
  });
});

describe('deleting a table', () => {
  it('removes it from the model and the file', () => {
    const out = serializeBoard(deleteBoardItems(read(TABLE()), new Set([TB])));

    expect(readBoard(parse(out)).tables).toHaveLength(0);
    expect(out).not.toContain('(table');
  });
});
