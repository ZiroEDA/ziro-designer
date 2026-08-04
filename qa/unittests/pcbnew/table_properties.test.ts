// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading and writing a table's properties.
 * Counterpart: `DIALOG_TABLE_PROPERTIES`.
 *
 * The rule worth most of these tests: **the editing grid is mirrored on a back
 * layer.** `TransferDataFromWindow` reads it with
 * `GetCell(row, colCount - 1 - col)` when the table is on a back layer, because
 * the board is being seen from the other side. Get it wrong and every
 * back-layer table has its columns reversed the moment someone opens its
 * dialog — and *only* on a back layer, so a test written against a front-layer
 * table proves nothing about it. Every mirroring test below therefore checks
 * both sides.
 *
 * Two more: setting the layer moves **every cell** onto it, not just the table;
 * and a merged-away cell (zero span) has no text of its own to set.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyTableValues,
  collectTableValues,
  displayToStoredCol,
  isBackLayer,
  tableAt,
  type TableValues,
} from '@ziroeda/pcbnew/src/table_properties.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

const cell = (t: string, x0: number, y0: number, x1: number, y1: number, span = '(span 1 1)') =>
  `(table_cell "${t}" (start ${x0} ${y0}) (end ${x1} ${y1}) (margins 1 1 1 1) ${span}
     (layer "L") (uuid "u-${t}") (effects (font (size 1 1))))`;

/** A 2x2 grid whose cells are named by their stored position. */
const TABLE = (layer = 'F.SilkS', spans: string[] = []): string =>
  `(table
    (column_count 2)
    (uuid "d6f049b1-ff3f-4087-ba96-404a150d1c9b")
    (layer "${layer}")
    (border (external yes) (header no) (stroke (width 0.2) (type solid)))
    (separators (rows yes) (cols yes) (stroke (width 0.05) (type solid)))
    (column_widths 10 10)
    (row_heights 5 5)
    (cells
      ${cell('r0c0', 0, 0, 10, 5, spans[0] ?? '(span 1 1)')}
      ${cell('r0c1', 10, 0, 20, 5, spans[1] ?? '(span 1 1)')}
      ${cell('r1c0', 0, 5, 10, 10, spans[2] ?? '(span 1 1)')}
      ${cell('r1c1', 10, 5, 20, 10, spans[3] ?? '(span 1 1)')}))`.replace(
    /\(layer "L"\)/g,
    `(layer "${layer}")`,
  );

const read = (src: string): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (39 "F.SilkS" user "F.Silkscreen") (38 "B.SilkS" user "B.Silkscreen"))
  (net 0 "")
  ${src}
)`),
  );

const roundTrip = (over: Partial<TableValues>, src = TABLE()): Board => {
  const b = read(src);
  const v = { ...collectTableValues(b.tables[0]!), ...over };
  return readBoard(parse(serializeBoard(applyTableValues(b, 0, v))));
};

describe('which layers count as back', () => {
  it('is the B. prefix', () => {
    expect(isBackLayer('B.Cu')).toBe(true);
    expect(isBackLayer('B.SilkS')).toBe(true);
  });

  it('is not a front or user layer', () => {
    expect(isBackLayer('F.Cu')).toBe(false);
    expect(isBackLayer('F.SilkS')).toBe(false);
    expect(isBackLayer('Dwgs.User')).toBe(false);
    expect(isBackLayer('Edge.Cuts')).toBe(false);
  });
});

describe('mapping a display column to a stored one', () => {
  it('is the identity on a front layer', () => {
    expect(displayToStoredCol(0, 3, false)).toBe(0);
    expect(displayToStoredCol(2, 3, false)).toBe(2);
  });

  it('mirrors on a back layer', () => {
    expect(displayToStoredCol(0, 3, true)).toBe(2);
    expect(displayToStoredCol(1, 3, true)).toBe(1);
    expect(displayToStoredCol(2, 3, true)).toBe(0);
  });

  it('is its own inverse, so a read-then-write is stable', () => {
    for (const back of [false, true])
      for (let c = 0; c < 4; c++)
        expect(displayToStoredCol(displayToStoredCol(c, 4, back), 4, back)).toBe(c);
  });
});

describe('finding the selected table', () => {
  it('takes a single selected one', () => {
    expect(tableAt(read(TABLE()), ['table:0'])).toBe(0);
  });

  it('takes nothing from a multiple selection, another kind or a stale id', () => {
    expect(tableAt(read(TABLE()), ['table:0', 'table:1'])).toBeNull();
    expect(tableAt(read(TABLE()), ['textbox:0'])).toBeNull();
    expect(tableAt(read(TABLE()), ['table:9'])).toBeNull();
  });
});

describe('reading the grid', () => {
  it('reads it in storage order on a front layer', () => {
    expect(collectTableValues(read(TABLE('F.SilkS')).tables[0]!).cellText).toEqual([
      ['r0c0', 'r0c1'],
      ['r1c0', 'r1c1'],
    ]);
  });

  it('reads it mirrored on a back layer', () => {
    // Same file, same stored order — only the layer differs.
    expect(collectTableValues(read(TABLE('B.SilkS')).tables[0]!).cellText).toEqual([
      ['r0c1', 'r0c0'],
      ['r1c1', 'r1c0'],
    ]);
  });

  it('reads the border and separator settings', () => {
    const v = collectTableValues(read(TABLE()).tables[0]!);

    expect(v.borderExternal).toBe(true);
    expect(v.borderHeader).toBe(false);
    expect(v.borderWidth).toBe(MM(0.2));
    expect(v.separatorRows).toBe(true);
    expect(v.separatorWidth).toBe(MM(0.05));
  });
});

describe('writing the grid back', () => {
  it('leaves the board alone when nothing moved', () => {
    const b = read(TABLE());

    expect(applyTableValues(b, 0, collectTableValues(b.tables[0]!))).toBe(b);
  });

  it('does nothing for an index that is not there', () => {
    const b = read(TABLE());

    expect(applyTableValues(b, 9, collectTableValues(b.tables[0]!))).toBe(b);
  });

  it('writes cell text in storage order on a front layer', () => {
    const back = roundTrip({
      cellText: [
        ['A', 'B'],
        ['C', 'D'],
      ],
    });

    expect(back.tables[0]!.cells.map((c) => c.text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('writes cell text mirrored on a back layer', () => {
    // Display column 0 is stored column 1 there, so "A" lands second.
    const back = roundTrip(
      {
        cellText: [
          ['A', 'B'],
          ['C', 'D'],
        ],
      },
      TABLE('B.SilkS'),
    );

    expect(back.tables[0]!.cells.map((c) => c.text)).toEqual(['B', 'A', 'D', 'C']);
  });

  it('round-trips the grid unchanged through collect and apply', () => {
    // The real safety property: opening the dialog and pressing OK must not
    // reverse a back-layer table.
    for (const layer of ['F.SilkS', 'B.SilkS']) {
      const b = read(TABLE(layer));
      const v = collectTableValues(b.tables[0]!);
      const after = applyTableValues(b, 0, { ...v, locked: true });

      expect(
        after.tables[0]!.cells.map((c) => c.text),
        layer,
      ).toEqual(['r0c0', 'r0c1', 'r1c0', 'r1c1']);
    }
  });

  it('uses the new layer handedness when the layer changes in the same edit', () => {
    // Moving a table front-to-back flips which stored column the grid's first
    // column is.
    const b = read(TABLE('F.SilkS'));
    const v = collectTableValues(b.tables[0]!);
    const after = applyTableValues(b, 0, {
      ...v,
      layer: 'B.SilkS',
      cellText: [
        ['A', 'B'],
        ['C', 'D'],
      ],
    });

    expect(after.tables[0]!.cells.map((c) => c.text)).toEqual(['B', 'A', 'D', 'C']);
  });

  it('leaves a merged-away cell alone', () => {
    // A zero span means a neighbour swallowed it; it has no text of its own.
    const b = read(TABLE('F.SilkS', ['(span 1 1)', '(span 1 1)', '(span 0 1)', '(span 1 1)']));
    const v = collectTableValues(b.tables[0]!);
    const after = applyTableValues(b, 0, {
      ...v,
      cellText: [
        ['A', 'B'],
        ['C', 'D'],
      ],
    });

    expect(after.tables[0]!.cells[2]!.text).toBe('r1c0');
  });
});

describe('the layer', () => {
  it('moves the table and every cell', () => {
    // A cell left behind would still be drawn, just on the wrong layer.
    const back = roundTrip({ layer: 'F.Cu' });

    expect(back.tables[0]!.layer).toBe('F.Cu');
    for (const c of back.tables[0]!.cells) expect(c.layer).toBe('F.Cu');
  });
});

describe('borders and separators through the file', () => {
  it('writes the flags and strokes', () => {
    const t = roundTrip({
      borderExternal: true,
      borderHeader: true,
      borderWidth: MM(0.3),
      borderStyle: 'dash',
      separatorRows: false,
      separatorCols: true,
      separatorWidth: MM(0.08),
    }).tables[0]!;

    expect(t.borderHeader).toBe(true);
    expect(t.borderWidth).toBe(MM(0.3));
    expect(t.borderStyle).toBe('dash');
    expect(t.separatorRows).toBe(false);
    expect(t.separatorWidth).toBe(MM(0.08));
  });

  it('drops the stroke when both of a pair are off', () => {
    // KiCad writes no stroke there at all, so writing one adds a token it never
    // produces.
    const out = serializeBoard(
      applyTableValues(read(TABLE()), 0, {
        ...collectTableValues(read(TABLE()).tables[0]!),
        separatorRows: false,
        separatorCols: false,
      }),
    );
    const seps = out.slice(out.indexOf('(separators'));

    expect(seps.slice(0, seps.indexOf('(column_widths'))).not.toContain('stroke');
  });

  it('keeps the width in the model so switching back on restores it', () => {
    const b = read(TABLE());
    const v = collectTableValues(b.tables[0]!);
    const off = applyTableValues(b, 0, { ...v, separatorRows: false, separatorCols: false });

    expect(off.tables[0]!.separatorWidth).toBe(MM(0.05));
  });
});

describe('locking', () => {
  it('writes and clears the flag', () => {
    expect(roundTrip({ locked: true }).tables[0]!.locked).toBe(true);

    const lockedSrc = TABLE().replace('(column_count 2)', '(column_count 2) (locked yes)');
    expect(roundTrip({ locked: false }, lockedSrc).tables[0]!.locked).toBeFalsy();
  });
});
