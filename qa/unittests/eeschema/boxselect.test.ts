// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rubber-band and lasso selection, counterpart SCH_SELECTION_TOOL's
 * selectMultiple / selectLasso.
 *
 * The completeness guard at the bottom is the point. Both walks had fallen
 * behind the model — the drag missed five item kinds and the lasso four — and
 * the failure was invisible: box a region holding an image, press Delete, and
 * the image stays with nothing to say why.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { boxSelect, lassoSelect } from '@ziroeda/eeschema/src/tools/boxselect.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

/** Every kind that can be dragged over, each in its own 20 mm cell. */
const SCH = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1"
        (rectangle (start -1.02 2.54) (end 1.02 -2.54)
          (stroke (width 0.254) (type default)) (fill (type none)))
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1")))))
  (symbol (lib_id "Device:R") (at 10 10 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 12 9 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 12 11 0) (effects (font (size 1.27 1.27)))))
  (wire (pts (xy 30 8) (xy 38 12)) (uuid "w1"))
  (junction (at 50 10) (uuid "j1"))
  (no_connect (at 70 10) (uuid "nc1"))
  (label "CLK" (at 90 10 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
  (bus_entry (at 110 8) (size 2.54 2.54) (stroke (width 0) (type default)) (uuid "be1"))
  (text_box "note" (at 10 30 0) (size 10 6)
    (stroke (width 0) (type solid)) (fill (type none))
    (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb1"))
  (rectangle (start 30 30) (end 40 36)
    (stroke (width 0.254) (type default)) (fill (type none)) (uuid "g1"))
  (netclass_flag "HV" (length 2.54) (shape round) (at 50 30 0)
    (effects (font (size 1.27 1.27)) (justify left)) (uuid "d1")
    (property "Netclass" "HV" (at 50 30 0) (effects (font (size 1.27 1.27)))))
  (table (column_count 1) (border (external yes) (header no))
    (separators (rows no) (cols no))
    (column_widths 10) (row_heights 6)
    (cells
      (table_cell "c" (exclude_from_sim no) (at 70 30 0) (size 10 6)
        (fill (type none)) (effects (font (size 1.27 1.27)) (justify left top))
        (uuid "tc1"))))
  (sheet (at 90 30) (size 10 6) (stroke (width 0) (type solid))
    (fill (color 0 0 0 0.0)) (uuid "sh1")
    (property "Sheetname" "sub" (at 90 29 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 90 37 0) (effects (font (size 1.27 1.27))))))`;

const doc = (): Schematic => readSchematic(parse(SCH));
const libs = (): Map<string, LibSymbol> => new Map(doc().libSymbols.map((l) => [l.libId, l]));
const mm = (x: number, y: number): Vec2 => ({ x: mmToIU(x), y: mmToIU(y) });

/** Left-to-right drag = contained ("window") mode. */
const window_ = (a: Vec2, b: Vec2): Set<string> => boxSelect(doc(), libs(), a, b);
/** Right-to-left drag = touching mode; same rectangle, dragged the other way. */
const touching = (a: Vec2, b: Vec2): Set<string> =>
  boxSelect(doc(), libs(), { x: b.x, y: a.y }, { x: a.x, y: b.y });

/** A rectangle traced as a lasso polygon. */
const lasso = (a: Vec2, b: Vec2): Set<string> =>
  lassoSelect(doc(), libs(), [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]);

describe('the drag direction still picks the mode', () => {
  it('contains left-to-right and touches right-to-left', () => {
    // The diagonal wire runs (30,8) to (38,12). A rectangle over its left half
    // crosses it but does not contain it.
    const a = mm(28, 6);
    const b = mm(34, 14);
    expect(window_(a, b).has('w1')).toBe(false);
    expect(touching(a, b).has('w1')).toBe(true);
  });
});

describe('the kinds the drag used to skip', () => {
  it('selects a bus entry, an image-like extent, a graphic, a table and a directive', () => {
    // Each of these was absent from the walk, so a drag over it selected
    // nothing at all — and a following Delete left it behind.
    const cases: [string, Vec2, Vec2][] = [
      ['be1', mm(105, 4), mm(118, 16)],
      [refId('graphic', undefined, 0), mm(28, 28), mm(42, 38)],
      ['d1', mm(44, 24), mm(60, 38)],
      ['tb1', mm(8, 28), mm(22, 38)],
    ];
    for (const [id, a, b] of cases) {
      expect(window_(a, b).has(id), `${id} contained`).toBe(true);
      expect(touching(a, b).has(id), `${id} touching`).toBe(true);
    }
    // The table is index-identified here, since its node carries no uuid.
    const tableId = refId('table', doc().tables[0]!.uuid, 0);
    expect(window_(mm(68, 28), mm(82, 38)).has(tableId)).toBe(true);
  });

  it('a bus entry is tested as a stub, not as its bounding box', () => {
    // The 45 degree stub runs (110,8) to (112.54,10.54). A rectangle over the
    // corner of its bounding box that the stub never enters must not select it.
    const a = mm(112.0, 8.0);
    const b = mm(112.6, 8.6);
    expect(touching(a, b).has('be1')).toBe(false);
  });
});

describe('the lasso reaches them too', () => {
  it('takes the graphic, the table and the directive label', () => {
    expect(lasso(mm(28, 28), mm(42, 38)).has(refId('graphic', undefined, 0))).toBe(true);
    expect(lasso(mm(44, 24), mm(60, 38)).has('d1')).toBe(true);
    const tableId = refId('table', doc().tables[0]!.uuid, 0);
    expect(lasso(mm(68, 28), mm(82, 38)).has(tableId)).toBe(true);
  });
});

describe('the completeness guard', () => {
  it('lets a drag over the whole sheet select every placed item', () => {
    // The regression net. A drag that covers everything must return every id
    // the model holds — that is what "select all in this region" means, and it
    // is what both walks silently stopped doing as the model grew.
    const d = doc();
    const all = boxSelect(d, libs(), mm(-10, -10), mm(400, 400));
    const expected = [
      ...d.symbols.map((x, i) => refId('symbol', x.uuid, i)),
      ...d.lines.map((x, i) => refId('line', x.uuid, i)),
      ...d.junctions.map((x, i) => refId('junction', x.uuid, i)),
      ...d.noConnects.map((x, i) => refId('noconnect', x.uuid, i)),
      ...d.labels.map((x, i) => refId('label', x.uuid, i)),
      ...d.sheets.map((x, i) => refId('sheet', x.uuid, i)),
      ...d.busEntries.map((x, i) => refId('busentry', x.uuid, i)),
      ...d.textBoxes.map((x, i) => refId('textbox', x.uuid, i)),
      ...d.graphics.map((_x, i) => refId('graphic', undefined, i)),
      ...d.tables.map((x, i) => refId('table', x.uuid, i)),
      ...(d.directiveLabels ?? []).map((x, i) => refId('directive', x.uuid, i)),
    ];
    expect(expected.length).toBeGreaterThan(10);
    for (const id of expected) expect(all.has(id), id).toBe(true);
  });

  it('and so does a lasso around the whole sheet', () => {
    const d = doc();
    const all = lassoSelect(d, libs(), [mm(-10, -10), mm(400, -10), mm(400, 400), mm(-10, 400)]);
    for (const id of [
      refId('graphic', undefined, 0),
      refId('table', d.tables[0]!.uuid, 0),
      'd1',
      'be1',
      'tb1',
    ]) {
      expect(all.has(id), id).toBe(true);
    }
  });
});
