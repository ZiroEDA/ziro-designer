// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a rotated symbol's fields land when there are THREE OR MORE of them,
 * pinned against files that `/usr/bin/eeschema` 10.0.5 wrote on this machine.
 *
 * `rotate_autoplace_kicad_probe.test.ts` next door pins the same operations on a
 * symbol with exactly two visible fields, Reference and Value. Two is the one
 * count that hides three separate things, because the autoplacer stacks the
 * fields in a column: a wrong row pitch, a wrong stacking order and a wrong
 * column centring all still land a pair symmetrically about the body. Everything
 * below therefore shows the Footprint field — the third row — and two of the
 * cases add a fourth.
 *
 * The probe: one symbol per file, at angle 0 with `(fields_autoplaced yes)` and
 * every field anchored on the symbol origin, so nothing here can be a leftover
 * of where the fields started. Each file was opened in eeschema, selected with
 * Ctrl+A — one principal item, which is the only arm of `SCH_EDIT_TOOL::Rotate`
 * that re-runs the autoplacer (sch_edit_tool.cpp:1005-1029) — then given one
 * operation and File > Save. The offsets below are read off the files that came
 * back; nothing here is derived from our own code.
 *
 *   symbol / fields shown          op        side    field offsets from the symbol
 *   Device:D  Ref Val Fp           R    90   right   (+2.54, -2.5401) (+2.54, -0.0001)
 *                                                    (+2.54, +2.5399)  all a90 right
 *   Device:D  Ref Val Fp           RR  180   top     (0, -8.89) (0, -6.35) (0, -3.81)
 *                                                    all a0, no justify
 *   Device:D  Ref Val Fp Ds        R    90   right   (+2.54, -3.8101) … 2.54 apart
 *   Device:R  Ref Val Fp           R    90   top     (0, -8.89) (0, -6.35) (0, -3.81) a90
 *   Device:R  Ref Val Fp MPN       RR  180   right   (+2.54, -3.8101) … 2.54 apart
 *
 * Three things this pins that two fields could not:
 *
 * 1. **The pitch is one 100 mil row per field, and the column is centred on the
 *    body.** Three rows at 2.54 mm put the middle one on the body's own centre
 *    line; a pitch derived from the text height alone, or a column measured from
 *    the wrong end, moves the first and third rows in opposite directions.
 * 2. **The stacking order is the order the fields are declared**, Reference,
 *    Value, Footprint, then any user field — `SCH_SYMBOL::GetFields` sorts by
 *    ordinal (sch_symbol.cpp:1345-1349) and `DoAutoplace` walks that list top
 *    to bottom. The `MPN` case is the one that can tell a user field apart from
 *    a mandatory one.
 * 3. **A symbol whose pins leave no free side puts its fields somewhere else
 *    entirely**, because `fieldBoxPlacement` steps the box clear of the pins
 *    (autoplace_fields.cpp:604-618). That case is `QUAD` below.
 *
 * The odd-looking `-2.5401` / `-0.0001` are eeschema's, not a typo: the
 * autoplacer works in integer IU and halves `padding` and `field_height`
 * separately, so a row whose height is odd lands one IU — 0.0001 mm — short of
 * the round number. Doing that arithmetic in floating point and rounding once
 * puts every row on a left- or right-hand side 1 IU out.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { transformItems, type TransformOp } from '@ziroeda/eeschema/src/tools/transform.js';
import { autoplaceFields } from '@ziroeda/eeschema/src/tools/autoplace_fields.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { Schematic, SchSymbol } from '@ziroeda/eeschema/src/types.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

/** `Device:D` as the probe file carried it, straight out of Device.kicad_sym. */
const DIODE = `(symbol "Device:D" (pin_numbers (hide yes)) (pin_names (offset 1.016) (hide yes))
    (property "Reference" "D" (at 0 2.54 0))
    (property "Value" "D" (at 0 -2.54 0))
    (symbol "D_0_1"
      (polyline (pts (xy -1.27 1.27) (xy -1.27 -1.27)) (stroke (width 0.254)))
      (polyline (pts (xy 1.27 1.27) (xy 1.27 -1.27) (xy -1.27 0) (xy 1.27 1.27))
        (stroke (width 0.254)))
      (polyline (pts (xy 1.27 0) (xy -1.27 0)) (stroke (width 0))))
    (symbol "D_1_1"
      (pin passive line (at -3.81 0 0) (length 2.54) (name "K") (number "1"))
      (pin passive line (at 3.81 0 180) (length 2.54) (name "A") (number "2"))))`;

/**
 * `Device:R`. Taller than it is wide, pins on the top and bottom, and — unlike
 * the diode — its library fields are stored at 90°, so the autoplacer has to
 * turn them to `m_field_angle` before it measures anything.
 */
const RESISTOR = `(symbol "Device:R" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "R" (at 2.032 0 90))
    (property "Value" "R" (at 0 0 90))
    (symbol "R_0_1"
      (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254))))
    (symbol "R_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27) (name "") (number "1"))
      (pin passive line (at 0 -3.81 90) (length 1.27) (name "") (number "2"))))`;

/**
 * A pin on every side. `chooseSideForFields` then cannot find a side with no
 * pins on it, and the `pins > 0` arms of `fieldBoxPlacement` and `justifyField`
 * are the ones that run.
 */
const QUAD = `(symbol "Test:QUAD" (pin_numbers (hide yes)) (pin_names (offset 0.254))
    (property "Reference" "U" (at 0 5.08 0))
    (property "Value" "QUAD" (at 0 -5.08 0))
    (symbol "QUAD_0_1"
      (rectangle (start -3.81 3.81) (end 3.81 -3.81) (stroke (width 0.254))))
    (symbol "QUAD_1_1"
      (pin passive line (at -6.35 0 0) (length 2.54) (name "L") (number "1"))
      (pin passive line (at 6.35 0 180) (length 2.54) (name "R") (number "2"))
      (pin passive line (at 0 6.35 270) (length 2.54) (name "T") (number "3"))
      (pin passive line (at 0 -6.35 90) (length 2.54) (name "B") (number "4"))))`;

/** The symbol sat here in every probe file. */
const AT = { x: 101.6, y: 76.2 };
const FOOTPRINT = 'Resistor_SMD:R_0805_2012Metric';
const DATASHEET = 'https://example.com/datasheet.pdf';

/**
 * One probe file: the symbol at angle 0, flagged autoplaced, every field
 * anchored on the symbol origin so no expectation below can be a leftover.
 */
function doc(lib: string, libId: string, fields: [string, string, number, boolean][]): Schematic {
  const props = fields
    .map(
      ([key, value, angle, hidden]) =>
        `(property "${key}" "${value}" (at ${AT.x} ${AT.y} ${angle}) (show_name no)
           (do_not_autoplace no) (effects (font (size 1.27 1.27)) ${hidden ? '(hide yes)' : ''}))`,
    )
    .join('\n        ');
  return readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "x") (lib_symbols ${lib})
      (symbol (lib_id "${libId}") (at ${AT.x} ${AT.y} 0) (unit 1)
        (fields_autoplaced yes) (uuid "d1")
        ${props}))`),
  );
}

const DIODE_FIELDS = (fp: boolean, ds: boolean): [string, string, number, boolean][] => [
  ['Reference', 'D1', 0, false],
  ['Value', '1N4001', 0, false],
  ['Footprint', FOOTPRINT, 0, !fp],
  ['Datasheet', DATASHEET, 0, !ds],
  ['Description', 'Diode', 0, true],
];

const RES_FIELDS = (mpn: boolean): [string, string, number, boolean][] => {
  const base: [string, string, number, boolean][] = [
    ['Reference', 'R1', 90, false],
    ['Value', '10k', 90, false],
    ['Footprint', FOOTPRINT, 90, false],
    ['Datasheet', DATASHEET, 0, true],
    ['Description', 'Resistor', 0, true],
  ];
  return mpn ? [...base, ['MPN', 'RC0805FR-0710KL', 0, false]] : base;
};

const QUAD_FIELDS: [string, string, number, boolean][] = [
  ['Reference', 'U1', 0, false],
  ['Value', 'QUAD', 0, false],
  ['Footprint', FOOTPRINT, 0, false],
  ['Datasheet', DATASHEET, 0, true],
  ['Description', 'Quad', 0, true],
];

const ID = refId('symbol', 'd1', 0);
/** `m_frame->eeconfig()->m_AutoplaceFields` at its shipped defaults. */
const OPTS = { allowRejustify: true, alignToGrid: true };

/** `n` presses of one hotkey on the one symbol, i.e. `principalItemCount == 1`. */
function press(d: Schematic, op: TransformOp, n = 1): SchSymbol {
  const libById = new Map(d.libSymbols.map((s) => [s.libId, s]));
  let cur = d;
  for (let i = 0; i < n; i++)
    cur = transformItems(new Set([ID]), op, undefined, undefined, {
      enable: true,
      libById,
      opts: OPTS,
    }).apply(cur);
  return cur.symbols[0]!;
}

/** The O hotkey: `SCH_ACTIONS::autoplaceFields`, an AUTOPLACE_MANUAL run. */
function autoplace(d: Schematic): SchSymbol {
  const libById = new Map(d.libSymbols.map((s) => [s.libId, s]));
  return autoplaceFields(d, new Set([ID]), libById, OPTS)!.apply(d).symbols[0]!;
}

/** Every visible field as `[dx, dy, angle, justify]` in mm, as the file records it. */
function rows(s: SchSymbol): [string, number, number, number, string][] {
  return s.fields
    .filter((f) => !f.effects?.hidden)
    .map((f) => [
      f.key,
      Math.round((f.at!.x - s.at.x) * 1e4) / 1e4 / mmToIU(1),
      Math.round((f.at!.y - s.at.y) * 1e4) / 1e4 / mmToIU(1),
      f.angle,
      f.effects?.justify?.find((t) => t === 'left' || t === 'right') ?? '',
    ]);
}

/** mm, to the 0.0001 mm the file records — which is one internal unit. */
const mm = (v: number): number => Math.round(v * 1e4) / 1e4;

describe('a rotated Device:D showing Reference, Value and Footprint', () => {
  const d = (): Schematic => doc(DIODE, 'Device:D', DIODE_FIELDS(true, false));

  it('stacks all three down the right of a symbol turned CCW, 2.54 mm apart', () => {
    const s = press(d(), 'rotateCCW');
    expect(s.angle).toBe(90);
    expect(rows(s)).toEqual([
      ['Reference', 2.54, -2.5401, 90, 'right'],
      ['Value', 2.54, -0.0001, 90, 'right'],
      ['Footprint', 2.54, 2.5399, 90, 'right'],
    ]);
  });

  it('stacks them above a symbol turned upside down, Footprint nearest the body', () => {
    // Two presses of R. At 180° the diode's pins are back on the left and right,
    // so the highest-ranked pin-free side is TOP and the column goes above the
    // body — with the *last* field, Footprint, at the bottom of the stack and so
    // closest to it.
    const s = press(d(), 'rotateCCW', 2);
    expect(s.angle).toBe(180);
    expect(rows(s)).toEqual([
      ['Reference', 0, -8.89, 0, ''],
      ['Value', 0, -6.35, 0, ''],
      ['Footprint', 0, -3.81, 0, ''],
    ]);
  });

  it('keeps the same three offsets on Shift+R and only swaps the stored justify', () => {
    const s = press(d(), 'rotateCW');
    expect(s.angle).toBe(270);
    expect(rows(s)).toEqual([
      ['Reference', 2.54, -2.5401, 90, 'left'],
      ['Value', 2.54, -0.0001, 90, 'left'],
      ['Footprint', 2.54, 2.5399, 90, 'left'],
    ]);
  });

  it('puts the same column above the body when O is pressed at angle 0', () => {
    const s = autoplace(d());
    expect(rows(s)).toEqual([
      ['Reference', 0, -8.89, 0, ''],
      ['Value', 0, -6.35, 0, ''],
      ['Footprint', 0, -3.81, 0, ''],
    ]);
  });
});

describe('a rotated Device:D showing four fields', () => {
  const d = (): Schematic => doc(DIODE, 'Device:D', DIODE_FIELDS(true, true));

  it('adds a fourth row at the same pitch and re-centres the column', () => {
    // Four rows of 2.54 mm are 10.16 mm tall, so the pair straddling the centre
    // sits at ±1.27 and the outer pair at ±3.81 — every row moved by half a
    // pitch relative to the three-field case, which is what "centred" means.
    const s = press(d(), 'rotateCCW');
    expect(rows(s)).toEqual([
      ['Reference', 2.54, -3.8101, 90, 'right'],
      ['Value', 2.54, -1.2701, 90, 'right'],
      ['Footprint', 2.54, 1.2699, 90, 'right'],
      ['Datasheet', 2.54, 3.8099, 90, 'right'],
    ]);
  });

  it('stacks four above an upside-down symbol', () => {
    const s = press(d(), 'rotateCCW', 2);
    expect(rows(s)).toEqual([
      ['Reference', 0, -11.43, 0, ''],
      ['Value', 0, -8.89, 0, ''],
      ['Footprint', 0, -6.35, 0, ''],
      ['Datasheet', 0, -3.81, 0, ''],
    ]);
  });
});

describe('a rotated Device:R, whose library fields are stored vertical', () => {
  it('stacks three above a symbol turned CCW, all stored at 90°', () => {
    // The resistor's pins are on its top and bottom, so at 90° they are on the
    // left and right and TOP is the first pin-free side. The stored angle is 90
    // because `m_field_angle` counteracts the transform: the text still reads
    // horizontally.
    const s = press(doc(RESISTOR, 'Device:R', RES_FIELDS(false)), 'rotateCCW');
    expect(s.angle).toBe(90);
    expect(rows(s)).toEqual([
      ['Reference', 0, -8.89, 90, ''],
      ['Value', 0, -6.35, 90, ''],
      ['Footprint', 0, -3.81, 90, ''],
    ]);
  });

  it('puts a user field last in the column, after the mandatory three', () => {
    // `MPN` is declared after Description and is the only visible user field.
    // It must come out at the *bottom* of the stack: `GetFields` sorts by
    // ordinal, and a user field's ordinal is above every mandatory one.
    const s = press(doc(RESISTOR, 'Device:R', RES_FIELDS(true)), 'rotateCCW', 2);
    expect(s.angle).toBe(180);
    expect(rows(s)).toEqual([
      ['Reference', 2.54, -3.8101, 0, 'right'],
      ['Value', 2.54, -1.2701, 0, 'right'],
      ['Footprint', 2.54, 1.2699, 0, 'right'],
      ['MPN', 2.54, 3.8099, 0, 'right'],
    ]);
  });
});

describe('the body box the field column is measured from', () => {
  it('stops at the pin roots, so a long-pinned symbol does not push its fields out', () => {
    // `m_symbol_bbox` is `GetBodyBoundingBox()`, which merges each pin's *root*
    // rather than its connection point (lib_symbol.cpp:1442-1455). QUAD's body
    // is 7.62 mm across and its pins reach 12.7 mm; measured in eeschema the
    // column lands 21.59 mm out, which is the body half-width and not the pin
    // half-length. Taking the pins in put it at 24.13 mm.
    const s = press(doc(QUAD, 'Test:QUAD', QUAD_FIELDS), 'rotateCCW');
    expect(rows(s).map((r) => r[1])).toEqual([21.59, 21.59, 21.59]);
  });

  it('centres the text on a side it had to share with a pin', () => {
    // `pins > 0`, so `justifyField( field, SIDE_TOP )` runs instead of
    // `justifyField( field, field_side )` and `ToHAlignment( -0 )` is CENTER —
    // no justify token at all (autoplace_fields.cpp:167-176).
    const s = press(doc(QUAD, 'Test:QUAD', QUAD_FIELDS), 'rotateCCW');
    expect(rows(s).map((r) => r[4])).toEqual(['', '', '']);
  });
});

describe('the internal-unit arithmetic the offsets expose', () => {
  it('lands the rows one IU short, exactly as eeschema does', () => {
    // Not cosmetic: 0.0001 mm is one schematic internal unit, and it is there
    // because `fieldVPlacement` truncates `padding / 2` and `field_height / 2`
    // separately (autoplace_fields.cpp:726-741). A row whose height is odd
    // therefore loses the two half-remainders. Rounding once at the end instead
    // gives -2.5400 and 0.0000 here.
    const s = press(doc(DIODE, 'Device:D', DIODE_FIELDS(true, false)), 'rotateCCW');
    const ys = rows(s).map((r) => mm(r[2]));
    expect(ys).toEqual([-2.5401, -0.0001, 2.5399]);
    // The pitch is exact even though the endpoints are not.
    expect(mm(ys[1]! - ys[0]!)).toBe(2.54);
    expect(mm(ys[2]! - ys[1]!)).toBe(2.54);
  });
});
