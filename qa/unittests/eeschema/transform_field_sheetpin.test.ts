// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A field or a sheet pin selected *without* its parent — audit finding 8.
 *
 * Both are items in their own right (`SCH_COLLECTOR::EditableItems` lists
 * SCH_FIELD_T, and SCH_SHEET_PIN is a SCH_LABEL_BASE), both are hit-testable
 * ahead of their parent, and `transformItems` walked neither: R, X and Y on a
 * clicked reference designator or on a hierarchical port did nothing.
 *
 * Counterparts: `SCH_EDIT_TOOL::Rotate`'s SCH_FIELD_T arm
 * (sch_edit_tool.cpp:1088-1100) and SCH_SHEET_PIN_T arm (:1045-1057), and
 * `::Mirror`'s (:1360-1375 and :1345-1358), plus `SCH_SHEET_PIN::Rotate` /
 * `::MirrorHorizontally` / `::MirrorVertically` (sch_sheet_pin.cpp:250/235/220).
 *
 * Where upstream then calls `SetFieldsAutoplaced( AUTOPLACE_NONE )` we cannot
 * follow: the flag is not on the model at all (audit finding 11).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { transformItems, type TransformOp } from '@ziroeda/eeschema/src/tools/transform.js';
import { fieldId, refId, sheetPinId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const mm = mmToIU;
const doc = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));
const run = (d: Schematic, ids: Set<string>, op: TransformOp): Schematic =>
  transformItems(ids, op).apply(d);

describe('a symbol field on its own', () => {
  const SYM = `(lib_symbols
      (symbol "Device:R"
        (symbol "R_0_1"
          (rectangle (start -1.02 2.54) (end 1.02 -2.54)
            (stroke (width 0.254) (type default)) (fill (type none))))))
    (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1) (uuid "r-1")
      (property "Reference" "R1" (at 53 50 0)
        (effects (font (size 1.27 1.27)) (justify left)))
      (property "Value" "10k" (at 53 52 0) (effects (font (size 1.27 1.27)))))`;
  const d = () => doc(SYM);
  const ref = (): Set<string> => new Set([fieldId(refId('symbol', 'r-1', 0), 0)]);

  it('toggles its text angle and does not move', () => {
    // "if( field->GetTextAngle().IsHorizontal() ) SetTextAngle( ANGLE_VERTICAL )"
    // — and nothing else. The field stays exactly where the user put it.
    const before = d();
    const after = run(before, ref(), 'rotateCW').symbols[0]!.fields[0]!;
    expect(after.angle).toBe(90);
    expect(after.at).toEqual(before.symbols[0]!.fields[0]!.at);
  });

  it('toggles back on the second turn', () => {
    let s = d();
    s = run(s, ref(), 'rotateCW');
    s = run(s, ref(), 'rotateCW');
    expect(s.symbols[0]!.fields[0]!.angle).toBe(0);
  });

  it('leaves the symbol and its other fields alone', () => {
    const before = d();
    const after = run(before, ref(), 'rotateCW').symbols[0]!;
    expect(after.at).toEqual(before.symbols[0]!.at);
    expect(after.angle).toBe(before.symbols[0]!.angle);
    expect(after.fields[1]).toEqual(before.symbols[0]!.fields[1]);
  });

  it('flips horizontal justify on the left-right mirror, and does not move', () => {
    // `field->SetHorizJustify( GetFlippedAlignment( GetHorizJustify() ) )`.
    const before = d();
    const after = run(before, ref(), 'mirrorY').symbols[0]!.fields[0]!;
    expect(after.effects?.justify).toEqual(['right']);
    expect(after.at).toEqual(before.symbols[0]!.fields[0]!.at);
  });

  it('flips vertical justify on the up-down mirror instead', () => {
    const before = doc(
      SYM.replace('(justify left)', '(justify left top)').replace(
        '(property "Reference" "R1" (at 53 50 0)',
        '(property "Reference" "R1" (at 53 50 0)',
      ),
    );
    const after = run(before, ref(), 'mirrorX').symbols[0]!.fields[0]!;
    expect(after.effects?.justify).toEqual(['left', 'bottom']);
  });

  it('did nothing at all before: R now changes it', () => {
    const before = d();
    expect(run(before, ref(), 'rotateCW').symbols[0]!.fields[0]).not.toEqual(
      before.symbols[0]!.fields[0],
    );
  });

  it('but the parent rotates it when the parent is selected too', () => {
    // "parent will rotate us" — the field must not be transformed twice.
    const before = d();
    const both = new Set([refId('symbol', 'r-1', 0), fieldId(refId('symbol', 'r-1', 0), 0)]);
    const after = run(before, both, 'rotateCW').symbols[0]!;
    // The parent turns the field exactly once. `SCH_SYMBOL::Rotate` never
    // touches a field's angle, and the position it draws swings round the body
    // because it is the local one mapped through the new transform
    // (SCH_FIELD::GetPosition, sch_field.cpp:1425-1438) — measured in KiCad
    // 10.0.5, a reference 2.54 mm above a diode sits 2.54 mm beside it after R.
    //
    // Here the offset from the anchor is (+22000, -8000) and CW in +Y-down
    // screen space is (x, y) -> (-y, x), so once is (+8000, +22000):
    expect(after.fields[0]!.angle).toBe(0);
    expect(after.fields[0]!.at).toEqual({ x: mm(51.6), y: mm(53) });
    // ...and once is not twice, which would be (-22000, +8000).
    expect(after.fields[0]!.at).toEqual(
      run(before, new Set([refId('symbol', 'r-1', 0)]), 'rotateCW').symbols[0]!.fields[0]!.at,
    );
  });
});

describe('a sheet pin on its own', () => {
  const SHEET = `(sheet (at 0 0) (size 25.4 12.7) (stroke (width 0) (type solid))
      (fill (color 0 0 0 0.0)) (uuid "sh-1")
      (property "Sheetname" "sub" (at 0 -1 0) (effects (font (size 1.27 1.27))))
      (property "Sheetfile" "sub.kicad_sch" (at 0 14 0) (effects (font (size 1.27 1.27))))
      (pin "IN" input (at 0 5.08 180) (uuid "p-1")
        (effects (font (size 1.27 1.27)) (justify right))))`;
  const pinIds = new Set([sheetPinId(refId('sheet', 'sh-1', 0), 0)]);

  it('rotates within its parent, about the sheet body centre', () => {
    // `pin->Rotate( sheet->GetBoundingBox().GetCenter(), !clockwise )`, then
    // ConstrainOnEdge drops it onto whichever border it landed nearest.
    const before = doc(SHEET);
    const after = run(before, pinIds, 'rotateCW').sheets[0]!;
    expect(after.pins[0]!.angle).toBe(90); // TOP
    expect(after.pins[0]!.at).toEqual({ x: mm(13.97), y: 0 });
  });

  it('does not move the sheet it belongs to', () => {
    const before = doc(SHEET);
    const after = run(before, pinIds, 'rotateCW').sheets[0]!;
    expect(after.at).toEqual(before.sheets[0]!.at);
    expect(after.size).toEqual(before.sheets[0]!.size);
    expect(after.fields).toEqual(before.sheets[0]!.fields);
  });

  it('swaps sides on the mirror that crosses its edge', () => {
    // `SetSide( SHEET_SIDE::RIGHT )` on MirrorHorizontally, and SetSide plants
    // the pin on that border.
    const before = doc(SHEET);
    const after = run(before, pinIds, 'mirrorY').sheets[0]!.pins[0]!;
    expect(after.angle).toBe(0); // RIGHT
    expect(after.at).toEqual({ x: mm(25.4), y: mm(5.08) });
  });

  it('keeps its side on the mirror that does not, and reflects along the edge', () => {
    // MirrorVertically has no LEFT/RIGHT case, so the pin stays on the left and
    // only its y mirrors about the sheet's centre line.
    const before = doc(SHEET);
    const after = run(before, pinIds, 'mirrorX').sheets[0]!.pins[0]!;
    expect(after.angle).toBe(180); // still LEFT
    expect(after.at).toEqual({ x: 0, y: mm(7.62) }); // 2*6.35 - 5.08
  });

  it('never leaves the border, however many times it is turned', () => {
    // Four turns are deliberately *not* the identity: the sheet does not move,
    // so a pin turned inside a rectangle that is not square is re-constrained
    // onto an edge every time and cannot retrace its steps. What must hold is
    // that it is always on the border — a port that has slid off connects to
    // nothing.
    let s = doc(SHEET);
    for (let i = 0; i < 6; i++) {
      s = run(s, pinIds, 'rotateCW');
      const p = s.sheets[0]!.pins[0]!;
      const onEdge =
        (p.angle === 180 && p.at.x === 0) ||
        (p.angle === 0 && p.at.x === mm(25.4)) ||
        (p.angle === 90 && p.at.y === 0) ||
        (p.angle === 270 && p.at.y === mm(12.7));
      expect(onEdge, `turn ${i + 1}: ${p.angle} at ${p.at.x},${p.at.y}`).toBe(true);
      expect(p.at.x >= 0 && p.at.x <= mm(25.4)).toBe(true);
      expect(p.at.y >= 0 && p.at.y <= mm(12.7)).toBe(true);
    }
  });

  it('did nothing at all before: every op now changes it', () => {
    const before = doc(SHEET);
    for (const op of ['rotateCW', 'rotateCCW', 'mirrorX', 'mirrorY'] as const) {
      expect(run(before, pinIds, op).sheets[0]!.pins[0], op).not.toEqual(before.sheets[0]!.pins[0]);
    }
  });

  it('but the sheet moves it when the sheet is selected too', () => {
    // "parent will rotate us": selecting both must not transform the pin twice.
    const before = doc(SHEET);
    const both = new Set([refId('sheet', 'sh-1', 0), ...pinIds]);
    expect(run(before, both, 'rotateCW').sheets[0]).toEqual(
      run(before, new Set([refId('sheet', 'sh-1', 0)]), 'rotateCW').sheets[0],
    );
  });
});
