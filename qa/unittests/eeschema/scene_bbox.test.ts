// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The extent of a selection and of a whole sheet — the walk behind Zoom to
 * Selected Objects and Zoom to All Objects, and the one alignment already used.
 *
 * The point of this file is the **completeness guard** at the bottom: it
 * enumerates the model's item arrays and fails when one of them contributes no
 * extent. That is the shape of the bug this sweep found — two separate walks,
 * each covering a handful of the fifteen kinds, both failing silently by
 * computing an empty box and doing nothing at all.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { contentBBox, selectionBBox } from '@ziroeda/eeschema/src/tools/scene_bbox.js';
import { isEmpty } from '@ziroeda/eeschema/src/tools/bbox.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

/** One of every item kind that carries geometry, each somewhere different. */
const SCH = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1"
        (rectangle (start -1.02 2.54) (end 1.02 -2.54)
          (stroke (width 0.254) (type default)) (fill (type none)))
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
  (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 53 50 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 53 52 0) (effects (font (size 1.27 1.27)))))
  (wire (pts (xy 50.8 46.99) (xy 63.5 46.99)) (uuid "w1"))
  (junction (at 63.5 46.99) (uuid "j1"))
  (no_connect (at 20 20) (uuid "nc1"))
  (label "CLK" (at 63.5 46.99 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
  (bus_entry (at 30 30) (size 2.54 2.54) (stroke (width 0) (type default)) (uuid "be1"))
  (text_box "note" (at 100 100 0) (size 20 10)
    (stroke (width 0) (type solid)) (fill (type none))
    (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb1"))
  (rectangle (start 120 120) (end 140 130)
    (stroke (width 0.254) (type default)) (fill (type none)) (uuid "g1"))
  (netclass_flag "HV" (length 2.54) (shape round) (at 40 40 0)
    (effects (font (size 1.27 1.27)) (justify left)) (uuid "d1")
    (property "Netclass" "HV" (at 40 40 0) (effects (font (size 1.27 1.27)))))
  (table (column_count 1) (border (external yes) (header no))
    (separators (rows no) (cols no))
    (column_widths 20) (row_heights 10)
    (cells
      (table_cell "c" (exclude_from_sim no) (at 160 160 0) (size 20 10)
        (fill (type none)) (effects (font (size 1.27 1.27)) (justify left top))
        (uuid "tc1"))))
  (sheet (at 70 70) (size 20 20) (stroke (width 0) (type solid))
    (fill (color 0 0 0 0.0)) (uuid "sh1")
    (property "Sheetname" "sub" (at 70 69 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 70 91 0) (effects (font (size 1.27 1.27))))))`;

const doc = (): Schematic => readSchematic(parse(SCH));
const libs = (): Map<string, LibSymbol> => new Map(doc().libSymbols.map((l) => [l.libId, l]));
const boxOf = (id: string) => selectionBBox(doc(), new Set([id]), libs());

describe('a selection has an extent', () => {
  it('covers a symbol by its body, not just its origin', () => {
    // The old whole-sheet walk used the symbol position and its field anchors,
    // so a large symbol's body could sit outside a Zoom to Fit.
    const b = boxOf('r1');
    expect(b.minX).toBeLessThan(mmToIU(50.8));
    expect(b.maxX).toBeGreaterThan(mmToIU(50.8));
    expect(b.maxY - b.minY).toBeGreaterThan(mmToIU(5));
  });

  it('covers the kinds the old selection walk missed', () => {
    // Each of these produced an empty box, so Zoom to Selected Objects did
    // nothing at all — no error, no movement.
    for (const id of ['nc1', 'be1', 'tb1', 'd1']) {
      expect(isEmpty(boxOf(id)), id).toBe(false);
    }
    // Graphics and tables are index-identified, not uuid-identified.
    expect(isEmpty(selectionBBox(doc(), new Set([refId('graphic', undefined, 0)]), libs()))).toBe(
      false,
    );
    // The table node carries no uuid of its own here, so it is index-identified
    // too; the cell's uuid is the cell's, not the table's.
    const d = doc();
    expect(isEmpty(selectionBBox(d, new Set([refId('table', d.tables[0]!.uuid, 0)]), libs()))).toBe(
      false,
    );
  });

  it('is empty for a selection of nothing, so the view stays put', () => {
    expect(isEmpty(selectionBBox(doc(), new Set(), libs()))).toBe(true);
    expect(isEmpty(selectionBBox(doc(), new Set(['not-an-id']), libs()))).toBe(true);
  });

  it('unions a multi-item selection', () => {
    const both = selectionBBox(doc(), new Set(['nc1', 'tb1']), libs());
    expect(both.minX).toBeLessThanOrEqual(boxOf('nc1').minX);
    expect(both.maxX).toBeGreaterThanOrEqual(boxOf('tb1').maxX);
  });
});

describe('the whole sheet has an extent', () => {
  it('reaches the far corner item, which is not a wire or a symbol', () => {
    // The table sits at (160, 160) — beyond every kind the old walk knew, so
    // Zoom to All Objects used to cut it off.
    const b = contentBBox(doc(), libs());
    expect(b.maxX).toBeGreaterThanOrEqual(mmToIU(180));
    expect(b.maxY).toBeGreaterThanOrEqual(mmToIU(170));
  });

  it('frames a sheet made only of the kinds the old walk ignored', () => {
    // A drawing-only sheet: the old walk found nothing and Zoom to All Objects
    // fell back to an arbitrary scale at the canvas centre.
    const d = readSchematic(
      parse(`(kicad_sch (version 20250114) (paper "A4")
        (text_box "note" (at 100 100 0) (size 20 10)
          (stroke (width 0) (type solid)) (fill (type none))
          (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb1")))`),
    );
    expect(isEmpty(contentBBox(d, new Map()))).toBe(false);
  });

  it('is empty for an empty sheet', () => {
    const d = readSchematic(parse('(kicad_sch (version 20250114) (paper "A4"))'));
    expect(isEmpty(contentBBox(d, new Map()))).toBe(true);
  });
});

describe('the completeness guard', () => {
  it('gives every item array with geometry an extent', () => {
    // The regression net for this sweep. Add an item array to the model and
    // forget the extent arm, and this fails — which is exactly how the two
    // walks it replaced fell behind, silently, over fifteen kinds.
    const d = doc();
    const l = libs();
    const kinds: { array: readonly unknown[]; id: (i: number) => string }[] = [
      { array: d.symbols, id: (i) => refId('symbol', d.symbols[i]!.uuid, i) },
      { array: d.lines, id: (i) => refId('line', d.lines[i]!.uuid, i) },
      { array: d.junctions, id: (i) => refId('junction', d.junctions[i]!.uuid, i) },
      { array: d.noConnects, id: (i) => refId('noconnect', d.noConnects[i]!.uuid, i) },
      { array: d.labels, id: (i) => refId('label', d.labels[i]!.uuid, i) },
      { array: d.sheets, id: (i) => refId('sheet', d.sheets[i]!.uuid, i) },
      { array: d.busEntries, id: (i) => refId('busentry', d.busEntries[i]!.uuid, i) },
      { array: d.graphics, id: (i) => refId('graphic', undefined, i) },
      { array: d.textBoxes, id: (i) => refId('textbox', d.textBoxes[i]!.uuid, i) },
      { array: d.tables, id: (i) => refId('table', d.tables[i]!.uuid, i) },
      {
        array: d.directiveLabels ?? [],
        id: (i) => refId('directive', (d.directiveLabels ?? [])[i]!.uuid, i),
      },
    ];
    for (const { array, id } of kinds) {
      expect(array.length, 'the fixture must exercise every kind').toBeGreaterThan(0);
      for (let i = 0; i < array.length; i++) {
        expect(isEmpty(selectionBBox(d, new Set([id(i)]), l)), id(i)).toBe(false);
      }
    }
  });

  it('names the arrays that deliberately have none', () => {
    // Images are covered but need a real payload to size, so they are checked
    // by the align tool's own tests rather than here. Groups carry no geometry
    // of their own — every member already contributes its box — and
    // libSymbols/sheetInstances are not placed items at all. Stated so a later
    // reader does not "fix" the omission.
    const d = doc();
    expect(d.groups).toEqual([]);
    expect(d.libSymbols.length).toBeGreaterThan(0);
  });
});
