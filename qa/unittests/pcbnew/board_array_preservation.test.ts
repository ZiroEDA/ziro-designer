// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every board operation leaves the item arrays it does not own alone.
 *
 * This exists because of a real bug. Adding `textBoxes` to `Board` meant adding
 * the field to ~50 object literals, and the sweep that did it matched
 * `groups:` — which appears in *update* literals as well as fresh ones. Seven
 * `{ ...board, textBoxes: [], groups: … }` spread-then-override sites resulted,
 * silently emptying every text box on any delete, lock or netlist update.
 *
 * Nothing caught it: the field was new, so no existing test looked at it after
 * an unrelated operation, and `{ ...board, textBoxes: [] }` typechecks
 * perfectly. The next item kind added will face exactly the same hazard, so the
 * check here is deliberately **generic** — it walks every array on the board
 * rather than naming text boxes, and a new kind is covered the day it is added.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  deleteBoardItems,
  groupBoardItems,
  moveBoardItems,
  setBoardItemsLocked,
  ungroupBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

/** A board carrying one of everything the model can hold. */
const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 0)
    (uuid "11111111-0000-0000-0000-000000000001"))
  (via (at 30 30) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0)
    (uuid "11111111-0000-0000-0000-000000000002"))
  (gr_line (start 0 0) (end 5 5) (stroke (width 0.1) (type solid)) (layer "F.SilkS")
    (uuid "11111111-0000-0000-0000-000000000003"))
  (gr_text "label" (at 40 40) (layer "F.SilkS")
    (uuid "11111111-0000-0000-0000-000000000004")
    (effects (font (size 1 1) (thickness 0.15))))
  (gr_text_box "boxed"
    (start 50 50) (end 60 55)
    (margins 1 1 1 1)
    (layer "F.SilkS")
    (uuid "11111111-0000-0000-0000-000000000005")
    (effects (font (size 1 1) (thickness 0.15)))
    (border yes)
    (stroke (width 0.12) (type solid))
    (knockout no))
  (table
    (column_count 1)
    (uuid "11111111-0000-0000-0000-000000000007")
    (layer "F.SilkS")
    (border (external yes) (header no) (stroke (width 0.05) (type solid)))
    (separators (rows no) (cols no))
    (column_widths 10)
    (row_heights 5)
    (cells
      (table_cell "c"
        (start 90 90) (end 100 95)
        (margins 1 1 1 1)
        (span 1 1)
        (layer "F.SilkS")
        (uuid "11111111-0000-0000-0000-000000000008")
        (effects (font (size 1 1))))))
  (dimension (type orthogonal) (layer "Dwgs.User")
    (uuid "11111111-0000-0000-0000-000000000006")
    (pts (xy 70 70) (xy 80 70)) (height 5) (orientation 0)
    (format (prefix "") (suffix "") (units 3) (units_format 0) (precision 4))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (extension_height 0.5) (extension_offset 0.5)))
)`;

const read = (): Board => readBoard(parse(BOARD));

/** Every item array on the board, by name, with its length. */
const counts = (b: Board): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(b)) if (Array.isArray(v)) out[k] = v.length;
  return out;
};

/** The arrays an operation is *supposed* to shrink, removed from the compare. */
const except = (c: Record<string, number>, ...keys: string[]): Record<string, number> => {
  const out = { ...c };
  for (const k of keys) delete out[k];
  return out;
};

describe('the board starts with one of everything', () => {
  it('reads every kind, so the checks below are not vacuous', () => {
    const c = counts(read());

    // If a kind is missing here the operations below cannot prove anything
    // about it, which is exactly how the original bug slipped through.
    expect(c.tracks).toBe(1);
    expect(c.vias).toBe(1);
    expect(c.shapes).toBe(1);
    expect(c.texts).toBe(1);
    expect(c.textBoxes).toBe(1);
    expect(c.tables).toBe(1);
    expect(c.dimensions).toBe(1);
  });
});

describe('deleting one item', () => {
  it('leaves every other array untouched', () => {
    const b = read();
    const after = deleteBoardItems(b, new Set(['track:0']));

    expect(except(counts(after), 'tracks')).toEqual(except(counts(b), 'tracks'));
    expect(after.tracks).toHaveLength(0);
  });

  it('leaves every other array untouched when deleting a text box', () => {
    const b = read();
    const after = deleteBoardItems(b, new Set(['textbox:0']));

    expect(except(counts(after), 'textBoxes')).toEqual(except(counts(b), 'textBoxes'));
  });
});

describe('moving one item', () => {
  it('leaves every array the same length', () => {
    const b = read();
    const after = moveBoardItems(b, new Set(['track:0']), { x: MM(1), y: 0 });

    expect(counts(after)).toEqual(counts(b));
  });
});

describe('locking an item', () => {
  it('leaves every array the same length', () => {
    const b = read();
    const after = setBoardItemsLocked(b, new Set(['track:0']), true);

    expect(counts(after)).toEqual(counts(b));
  });
});

describe('grouping and ungrouping', () => {
  it('leaves every array but groups the same length', () => {
    const b = read();
    const { board: after } = groupBoardItems(b, new Set(['track:0', 'via:0']), 'g');

    expect(except(counts(after), 'groups')).toEqual(except(counts(b), 'groups'));
  });

  it('leaves every array but groups the same length on ungroup', () => {
    const b = read();
    const { board: grouped, id } = groupBoardItems(b, new Set(['track:0', 'via:0']), 'g');
    const after = ungroupBoardItems(grouped, new Set([id!]));

    expect(except(counts(after), 'groups')).toEqual(except(counts(b), 'groups'));
  });
});
