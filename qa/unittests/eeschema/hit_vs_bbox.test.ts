// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What you can click matches where the item is, for every item kind.
 *
 * Two separate implementations decide that. `alignBoxes` says where an item is
 * — it drives align, distribute, zoom-to-selection and the selection halo —
 * and `hitTest` decides what a click lands on. They are written independently
 * and nothing has ever required them to agree.
 *
 * When they drift, nothing throws. The item draws in one place and answers
 * clicks in another, or answers none at all: the failure is a user saying "it
 * won't let me select that".
 *
 * The check is deliberately coarse, and it is worth being precise about how
 * coarse. It asserts that the item answers a click **somewhere inside the box
 * the rest of the app thinks it occupies** — the centre or an edge midpoint,
 * because an unfilled shape is clickable only on its stroke, which is KiCad's
 * rule and correct.
 *
 * So it catches an item that is not clickable in its own box at all — removing
 * the text-box arm from `hitTest` fails it. It does **not** verify that the box
 * is tight: a box several times too large still contains the item, so a probe
 * still finds it. That was measured, not assumed — inflating label boxes
 * eightfold does not fail this test.
 *
 * A hit on one of the item's own sub-items counts, because for several kinds
 * that *is* the correct answer: since #390 a click inside a table's grid gives
 * a cell, and the table itself answers only on its border.
 *
 * It exists because nothing else asks the two sides the same question, and the
 * last time nobody did, `measureText` and `layoutText` disagreed by 4.8x for
 * multi-line text and every geometric consumer was wrong for it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { hitTest } from '@ziroeda/eeschema/src/tools/hittest.js';
import { alignBoxes } from '@ziroeda/eeschema/src/tools/sch_align_tool.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const FIXTURE = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "L:R" (pin_numbers (hide yes)) (pin_names (offset 0))
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
        (stroke (width 0) (type default)) (fill (type none))))))
  (junction (at 10 10) (diameter 0.9) (color 0 0 0 0) (uuid "j-1"))
  (no_connect (at 30 10) (uuid "nc-1"))
  (bus_entry (at 50 10) (size 2.54 2.54)
    (stroke (width 0.1) (type solid) (color 0 0 0 0)) (uuid "be-1"))
  (wire (pts (xy 70 10) (xy 90 10))
    (stroke (width 0.2) (type solid)) (uuid "w-1"))
  (label "NET" (at 110 10 0) (effects (font (size 1.27 1.27)) (justify left bottom))
    (uuid "l-1"))
  (global_label "GBL" (shape input) (at 140 10 0) (fields_autoplaced yes)
    (effects (font (size 1.27 1.27)) (justify left)) (uuid "gl-1"))
  (netclass_flag "HS" (length 2.54) (shape round) (at 170 10 0)
    (effects (font (size 1.27 1.27))) (uuid "d-1")
    (property "Netclass" "HS" (at 170 10 0) (effects (font (size 1.27 1.27)))))
  (rectangle (start 10 30) (end 25 40)
    (stroke (width 0.1) (type solid)) (fill (type none)) (uuid "g-1"))
  (text_box "boxed text" (exclude_from_sim no) (at 40 30 0) (size 25 12)
    (margins 0.5 0.5 0.5 0.5)
    (stroke (width 0.1) (type solid)) (fill (type none))
    (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb-1"))
  (table (column_count 2) (border (external yes) (header yes))
    (separators (rows yes) (cols yes))
    (column_widths 20 20) (row_heights 10) (uuid "t-1")
    (cells
      (table_cell "a" (exclude_from_sim no) (at 80 30 0) (size 20 10) (span 1 1)
        (margins 0.5 0.5 0.5 0.5) (effects (font (size 1.27 1.27)) (justify left top)))
      (table_cell "b" (exclude_from_sim no) (at 100 30 0) (size 20 10) (span 1 1)
        (margins 0.5 0.5 0.5 0.5) (effects (font (size 1.27 1.27)) (justify left top)))))
  (symbol (lib_id "L:R") (at 20 60 0) (unit 1)
    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-1")
    (property "Reference" "R1" (at 24 58 0) (effects (font (size 1.27 1.27)))))
  (sheet (at 60 60) (size 25 20) (stroke (width 0.1) (type solid))
    (fill (color 0 0 0 0.0)) (uuid "sh-1")
    (property "Sheetname" "sub" (at 60 59 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 60 81 0)
      (effects (font (size 1.27 1.27))))))`;

const doc = (): Schematic => readSchematic(parse(FIXTURE));
const libById = (d: Schematic): Map<string, LibSymbol> =>
  new Map(d.libSymbols.map((l) => [l.libId, l]));

/** A click this far off is a miss by any reasonable accuracy. */
const FAR = 5_000_000;

describe('a click at an item’s centre lands on that item', () => {
  const d = doc();
  const libs = libById(d);
  const boxes = alignBoxes(d, null, libs);

  it('the fixture covers a spread of kinds', () => {
    // A sweep over an empty box list passes while testing nothing.
    expect(new Set(boxes.map((b) => b.kind)).size).toBeGreaterThan(8);
  });

  for (const box of boxes) {
    it(`${box.kind} ${box.id}`, () => {
      const b = box.box;
      const centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      // NaN coordinates would make every case fail identically, which is what a
      // first draft of this test did by reading the wrong field.
      expect(Number.isFinite(centre.x) && Number.isFinite(centre.y)).toBe(true);
      // The centre, then the four edge midpoints. An *unfilled* shape is only
      // clickable on its stroke — KiCad's rule, and correct — so requiring the
      // centre would fail a rectangle that behaves exactly as it should. What
      // this asserts is that the item answers a click *somewhere* in the box
      // the rest of the app thinks it occupies.
      const probes = [
        centre,
        { x: centre.x, y: b.minY },
        { x: centre.x, y: b.maxY },
        { x: b.minX, y: centre.y },
        { x: b.maxX, y: centre.y },
      ];
      // The hit has to be *this* item, or one of its own sub-items — a table's
      // box overlaps its cells, so "something is clickable here" would pass
      // even with the table itself unhittable. Sub-item ids are the parent's
      // id plus a suffix (`:cell0`, `:field0`, `:sheetpin0`).
      const mine = (id: string): boolean => id === box.id || id.startsWith(`${box.id}:`);
      const hit = probes.some((p) => {
        const h = hitTest(d, libs, p, 0);
        return h !== null && mine(h.id);
      });
      expect(hit, `this ${box.kind} answers no click inside its own box`).toBe(true);
    });
  }

  it('and nothing is clickable far away from everything', () => {
    // The inverse: if hitTest answered everywhere, every case above would pass
    // for the wrong reason.
    expect(hitTest(d, libById(d), { x: FAR, y: FAR }, 0)).toBeNull();
  });
});
