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
import { parse } from '@ziroeda/sexpr/index.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { serializeBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  displayToStoredCol,
  isBackLayer,
  tableAt,
  type TableValues,
} from '@ziroeda/pcbnew/dialogs/dialog_table_properties.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/types.js';

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
