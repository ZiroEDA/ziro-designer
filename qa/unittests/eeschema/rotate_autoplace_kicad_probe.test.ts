// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What R / Shift+R / X / Y do to a symbol's fields, pinned against one run of
 * /usr/bin/eeschema 10.0.5 on this machine.
 *
 * The probe: one sheet, eight `Device:D` symbols, all at angle 0 with the
 * library's own field offsets — Reference (0, -2.54), Value (0, +2.54), both
 * stored at angle 0, no justify. Four of them carry `(fields_autoplaced yes)`
 * and four do not. Each got exactly one operation, then File > Save. The file
 * eeschema wrote back is the whole table below; nothing here is derived from
 * our own code.
 *
 *   op                     flag   symbol      Reference        Value
 *   R       (rotate CCW)   none   at 90       (-2.54,  0) a0   (+2.54,  0) a0
 *   R       (rotate CCW)   auto   at 90       (+2.54, -1.27) a90 right
 *                                             (+2.54, +1.27) a90 right
 *   Shift+R (rotate CW)    none   at 270      (+2.54,  0) a0   (-2.54,  0) a0
 *   Shift+R (rotate CW)    auto   at 270      (+2.54, -1.27) a90 left
 *                                             (+2.54, +1.27) a90 left
 *   X       (mirror H)     auto   mirror y    (0, -2.54) a0    (0, +2.54) a0
 *                                             and the flag is GONE
 *   Y       (mirror V)     none   mirror x    (0, +2.54) a0    (0, -2.54) a0
 *
 * Three separate rules meet here, and each of the three has been wrong at some
 * point in this file's history:
 *
 * 1. **The unflagged rows are not a no-op.** `SCH_SYMBOL::Rotate` only
 *    translates its fields by the symbol's own move vector, which is zero when
 *    a single symbol turns about itself — but a symbol field's stored position
 *    is symbol-local and the position that is drawn and written is that mapped
 *    through the parent transform (`SCH_FIELD::GetPosition`,
 *    sch_field.cpp:1425-1438). So the offset turns even though no code touches
 *    it. Their *angle* stays 0, which is why they end up reading vertically:
 *    `GetDrawRotation` flips a horizontal field on a 90°/270° symbol. That is
 *    genuinely what eeschema draws — verified on the same probe run.
 * 2. **The flagged rows re-run the autoplacer**, because
 *    `SCH_EDIT_TOOL::Rotate` does so for `AUTOPLACE_AUTO`/`AUTOPLACE_MANUAL`
 *    only (sch_edit_tool.cpp:1022-1029). The row pitch that comes out is
 *    2.54 mm, not the 5.71 mm we produced before: `computeFBoxSize` measures
 *    each field with its angle *temporarily* set to `m_field_angle`
 *    (autoplace_fields.cpp:203-211), so the box is the horizontal-display box.
 *    Measuring at the stored angle measures the text sideways and the pitch
 *    becomes the text *width*.
 * 3. **The justification is stored flipped where the transform flips it.**
 *    `justifyField` sets `ToHAlignment(-side.x)` and then flips it again if
 *    `IsHorizJustifyFlipped()` (autoplace_fields.cpp:552-560), which is why the
 *    two rotations disagree: `right` at 90°, `left` at 270°, both so the text
 *    reads away from the body. Storing the unflipped value throws the 90° case
 *    back across the symbol.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { transformItems } from '@ziroeda/eeschema/src/tools/transform.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { Schematic, SchSymbol, TransformOp } from '@ziroeda/eeschema/src/types.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

/**
 * `Device:D` as the probe file carried it — the same polylines, the same two
 * pins at ±3.81 mm, so the body box and the pin sides are the ones eeschema
 * saw.
 */
const LIB = `(lib_symbols
  (symbol "Device:D" (pin_numbers hide) (pin_names (offset 1.016) hide)
    (property "Reference" "D" (at 0 2.54 0))
    (property "Value" "D" (at 0 -2.54 0))
    (symbol "D_0_1"
      (polyline (pts (xy -1.27 1.27) (xy -1.27 -1.27)) (stroke (width 0.254)))
      (polyline (pts (xy 1.27 1.27) (xy 1.27 -1.27) (xy -1.27 0) (xy 1.27 1.27))
        (stroke (width 0.254)))
      (polyline (pts (xy 1.27 0) (xy -1.27 0)) (stroke (width 0))))
    (symbol "D_1_1"
      (pin passive line (at -3.81 0 0) (length 2.54) (name "K") (number "1"))
      (pin passive line (at 3.81 0 180) (length 2.54) (name "A") (number "2")))))`;

/** The probe's starting symbol: angle 0, Reference above the body, Value below. */
const doc = (flagged: boolean): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "x") ${LIB}
      (symbol (lib_id "Device:D") (at 50.8 50.8 0) (unit 1)
        ${flagged ? '(fields_autoplaced yes)' : ''} (uuid "d1")
        (property "Reference" "D1" (at 50.8 48.26 0) (effects (font (size 1.27 1.27))))
        (property "Value" "1N4001" (at 50.8 53.34 0) (effects (font (size 1.27 1.27))))))`),
  );

/** One operation on the one symbol, i.e. upstream's `selection.GetSize() == 1`. */
const run = (flagged: boolean, op: TransformOp): SchSymbol => {
  const d = doc(flagged);
  const libById = new Map(d.libSymbols.map((s) => [s.libId, s]));
  return transformItems(new Set([refId('symbol', 'd1', 0)]), op, undefined, undefined, {
    // `m_frame->eeconfig()->m_AutoplaceFields` — the shipped defaults, which are
    // what the probe's eeschema was running.
    enable: true,
    libById,
    opts: { allowRejustify: true, alignToGrid: true },
  }).apply(d).symbols[0]!;
};

/** A field as the file records it: offset from the symbol, angle, justify. */
const field = (s: SchSymbol, key: string): [number, number, number, string | undefined] => {
  const f = s.fields.find((x) => x.key === key)!;
  return [
    f.at!.x - s.at.x,
    f.at!.y - s.at.y,
    f.angle,
    f.effects?.justify?.find((t) => t === 'left' || t === 'right'),
  ];
};

const MM = mmToIU(2.54);
const HALF = mmToIU(1.27);

describe('a symbol with no (fields_autoplaced)', () => {
  it('turns its fields with the body on R, and leaves them reading vertically', () => {
    const s = run(false, 'rotateCCW');
    expect([s.angle, s.mirror, s.fieldsAutoplaced]).toEqual([90, undefined, undefined]);
    // (0, -2.54) -> (-2.54, 0): +Y is down, so CCW is (x, y) -> (y, -x).
    expect(field(s, 'Reference')).toEqual([-MM, 0, 0, undefined]);
    expect(field(s, 'Value')).toEqual([MM, 0, 0, undefined]);
  });

  it('turns them the other way on Shift+R', () => {
    const s = run(false, 'rotateCW');
    expect([s.angle, s.mirror, s.fieldsAutoplaced]).toEqual([270, undefined, undefined]);
    expect(field(s, 'Reference')).toEqual([MM, 0, 0, undefined]);
    expect(field(s, 'Value')).toEqual([-MM, 0, 0, undefined]);
  });

  it('flips them across the body on Y (mirror vertically)', () => {
    // Our `mirrorX` is the mirrorV command: it sets SYM_MIRROR_X and flips Y.
    const s = run(false, 'mirrorX');
    expect([s.angle, s.mirror]).toEqual([0, 'x']);
    expect(field(s, 'Reference')).toEqual([0, MM, 0, undefined]);
    expect(field(s, 'Value')).toEqual([0, -MM, 0, undefined]);
  });

  it('leaves them where they are on X (mirror horizontally)', () => {
    // The offsets are on the mirror axis, so only the body turns over.
    const s = run(false, 'mirrorY');
    expect([s.angle, s.mirror]).toEqual([0, 'y']);
    expect(field(s, 'Reference')).toEqual([0, -MM, 0, undefined]);
    expect(field(s, 'Value')).toEqual([0, MM, 0, undefined]);
  });
});

describe('a symbol with (fields_autoplaced yes)', () => {
  it('re-autoplaces to the right of a symbol turned CCW, one 100 mil row apart', () => {
    const s = run(true, 'rotateCCW');
    expect([s.angle, s.fieldsAutoplaced]).toEqual([90, 'auto']);
    // The row pitch is the field's *height* rounded up to 50 mil, so 100 mil
    // between the two rows and the pair centred on the body. Measuring the
    // field sideways gave 5.715 mm here, and put the pair 0.955 mm off centre.
    expect(field(s, 'Reference')).toEqual([MM, -HALF, 90, 'right']);
    expect(field(s, 'Value')).toEqual([MM, HALF, 90, 'right']);
  });

  it('stores the other justification on a symbol turned CW', () => {
    const s = run(true, 'rotateCW');
    expect([s.angle, s.fieldsAutoplaced]).toEqual([270, 'auto']);
    // Same side, same offsets — only the stored justify differs, because
    // IsHorizJustifyFlipped() is true at 90° and false at 270°.
    expect(field(s, 'Reference')).toEqual([MM, -HALF, 90, 'left']);
    expect(field(s, 'Value')).toEqual([MM, HALF, 90, 'left']);
  });

  it('drops the flag on a mirror, and does not re-place anything', () => {
    // `symbol->SetFieldsAutoplaced( AUTOPLACE_NONE )` right after the mirror
    // (sch_edit_tool.cpp:1331) — so the fields keep the offsets the transform
    // gave them, and no later rotate will autoplace either.
    const x = run(true, 'mirrorY');
    expect([x.mirror, x.fieldsAutoplaced]).toEqual(['y', undefined]);
    expect(field(x, 'Reference')).toEqual([0, -MM, 0, undefined]);

    const y = run(true, 'mirrorX');
    expect([y.mirror, y.fieldsAutoplaced]).toEqual(['x', undefined]);
    expect(field(y, 'Reference')).toEqual([0, MM, 0, undefined]);
  });
});
