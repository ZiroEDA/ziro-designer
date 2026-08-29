// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a symbol's fields end up after R / Shift+R / X / Y.
 *
 * `SCH_SYMBOL::Rotate` (sch_symbol.cpp:2837), `::MirrorHorizontally` (:2801) and
 * `::MirrorVertically` (:2819) each transform `m_pos` and then move every field
 * by the symbol's *own* move vector — "move the fields to the new position
 * because the symbol itself has moved". Read alone that says the fields never
 * move when a single symbol turns about its own anchor, and this file used to
 * assert exactly that.
 *
 * It is wrong, because the position those loops move is `GetTextPos()`, which
 * for a symbol's field is **symbol-local and un-transformed**. What is drawn and
 * written to file is `SCH_FIELD::GetPosition()` (sch_field.cpp:1425-1438), the
 * local offset mapped through the parent's transform. Advancing the orientation
 * therefore swings every field round the body with no code touching it.
 *
 * Every expectation below is the file KiCad 10.0.5 wrote in a probe run
 * (/usr/bin/eeschema, GTK, this machine). Six `Device:D` symbols, each at
 * (X, Y) with `Reference` at (X, Y-2.54) and `Value` at (X, Y+2.54), angle 0,
 * no mirror and **no `fields_autoplaced`** so nothing re-places them; one
 * operation each, then Save:
 *
 *   op                       symbol            Reference offset   Value offset
 *   ---------------------------------------------------------------------------
 *   (start)                  angle 0           (0, -2.54)         (0, +2.54)
 *   R        rotate CCW      angle 90          (-2.54, 0)         (+2.54, 0)
 *   Shift+R  rotate CW       angle 270         (+2.54, 0)         (-2.54, 0)
 *   X        mirror H        mirror y          (0, -2.54)         (0, +2.54)
 *   Y        mirror V        mirror x          (0, +2.54)         (0, -2.54)
 *   R on two symbols at (50.8, 88.9) and (63.5, 88.9) selected together:
 *            both land at angle 90, at (57.15, 95.25) and (57.15, 82.55),
 *            each with Reference (-2.54, 0) and Value (+2.54, 0).
 *
 * The stored text angle stayed 0 throughout: the vertical *look* of a rotated
 * symbol's reference is `GetDrawRotation`'s flip, not a stored angle, and only
 * the autoplacer (which needs the flag) stores the 90 that cancels it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { transformItems, transformSymbol } from '@ziroeda/eeschema/src/tools/transform.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic, SchSymbol, Vec2 } from '@ziroeda/eeschema/src/types.js';

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** The probe's symbol: reference 2.54 mm above the body, value 2.54 mm below. */
const diode = (uuid: string, ref: string, x: number, y: number): string =>
  `(symbol (lib_id "Device:D") (at ${x} ${y} 0) (unit 1) (uuid "${uuid}")
     (property "Reference" "${ref}" (at ${x} ${y - 2.54} 0)
       (effects (font (size 1.27 1.27))))
     (property "Value" "1N4001" (at ${x} ${y + 2.54} 0)
       (effects (font (size 1.27 1.27)))))`;

const one = (): Schematic => sheet(diode('s-1', 'D1', 50.8, 50.8));
const id = (d: Schematic, i = 0): string => refId('symbol', d.symbols[i]!.uuid, i);

/** Each field's offset from its own symbol's anchor. */
const offsets = (s: SchSymbol): Vec2[] =>
  s.fields.filter((f) => f.at).map((f) => ({ x: f.at!.x - s.at.x, y: f.at!.y - s.at.y }));

const mm = (x: number, y: number): Vec2 => ({ x: mmToIU(x), y: mmToIU(y) });

describe('one selected symbol', () => {
  // The centre is the symbol's own anchor, so the body does not move; what the
  // fields do is entirely the transform's doing.
  const cases: ReadonlyArray<
    readonly [op: 'rotateCCW' | 'rotateCW' | 'mirrorY' | 'mirrorX', angle: number, offs: Vec2[]]
  > = [
    // D1, hotkey R
    ['rotateCCW', 90, [mm(-2.54, 0), mm(2.54, 0)]],
    // D2, hotkey Shift+R
    ['rotateCW', 270, [mm(2.54, 0), mm(-2.54, 0)]],
    // D3, hotkey X (MirrorHorizontally). A field on the body's centre line has
    // no x offset to flip, so it is the one op that leaves the numbers alone.
    ['mirrorY', 0, [mm(0, -2.54), mm(0, 2.54)]],
    // D4, hotkey Y (MirrorVertically): reference and value swap sides.
    ['mirrorX', 0, [mm(0, 2.54), mm(0, -2.54)]],
  ];

  for (const [op, angle, offs] of cases) {
    it(`${op} puts the fields where KiCad's file says`, () => {
      const d = one();
      const after = transformItems(new Set([id(d)]), op).apply(d);
      expect(after.symbols[0]!.at).toEqual(d.symbols[0]!.at);
      expect(after.symbols[0]!.angle).toBe(angle);
      expect(offsets(after.symbols[0]!)).toEqual(offs);
    });
  }

  it('leaves the stored text angle alone — the vertical look is the draw flip', () => {
    const d = one();
    const after = transformItems(new Set([id(d)]), 'rotateCCW').apply(d);
    expect(after.symbols[0]!.fields.map((f) => f.angle)).toEqual([0, 0]);
  });

  it('four turns of R bring the reference back to where it started', () => {
    let d = one();
    const ids = new Set([id(d)]);
    for (let i = 0; i < 4; i++) d = transformItems(ids, 'rotateCCW').apply(d);
    expect(d.symbols[0]!.fields[0]!.at).toEqual(one().symbols[0]!.fields[0]!.at);
    expect(d.symbols[0]!.angle).toBe(0);
  });
});

describe('two symbols turned together', () => {
  // The probe's D5/D6 pair, rubber-band selected and turned with one R.
  const pair = (): Schematic =>
    sheet([diode('s-1', 'D5', 50.8, 88.9), diode('s-2', 'D6', 63.5, 88.9)].join('\n'));

  it('lands both bodies and both field sets where KiCad’s file says', () => {
    const d = pair();
    const ids = new Set([id(d, 0), id(d, 1)]);
    const after = transformItems(ids, 'rotateCCW').apply(d);
    expect(after.symbols[0]!.at).toEqual(mm(57.15, 95.25));
    expect(after.symbols[1]!.at).toEqual(mm(57.15, 82.55));
    for (const i of [0, 1]) {
      expect(after.symbols[i]!.angle).toBe(90);
      expect(offsets(after.symbols[i]!)).toEqual([mm(-2.54, 0), mm(2.54, 0)]);
    }
  });

  it('a mirror of the pair flips each body’s offsets about its own anchor', () => {
    // Y / MirrorVertically, so each symbol's own fields swap sides exactly as
    // D4's did, on top of the bodies moving about the selection centre.
    const d = pair();
    const ids = new Set([id(d, 0), id(d, 1)]);
    const after = transformItems(ids, 'mirrorX').apply(d);
    for (const i of [0, 1]) {
      expect(offsets(after.symbols[i]!)).toEqual([mm(0, 2.54), mm(0, -2.54)]);
    }
  });

  it('undoes exactly, fields included', () => {
    const d = pair();
    const ids = new Set([id(d, 0), id(d, 1)]);
    const cmd = transformItems(ids, 'rotateCW');
    const back = cmd.invert(d).apply(cmd.apply(d));
    for (const i of [0, 1]) {
      expect(back.symbols[i]!.at).toEqual(d.symbols[i]!.at);
      expect(back.symbols[i]!.fields.map((f) => f.at)).toEqual(
        d.symbols[i]!.fields.map((f) => f.at),
      );
    }
  });

  it('reaches the file — the turned offsets survive a save', () => {
    const d = pair();
    const ids = new Set([id(d, 0), id(d, 1)]);
    const after = transformItems(ids, 'rotateCCW').apply(d);
    // Round-trip rather than matching mm text: the offset is what must survive.
    const back = readSchematic(parse(serializeSchematic(after)));
    expect(back.symbols[0]!.at).toEqual(mm(57.15, 95.25));
    expect(offsets(back.symbols[0]!)).toEqual([mm(-2.54, 0), mm(2.54, 0)]);
  });
});

describe('the attached-symbol placement path', () => {
  it('R on a symbol on the cursor swings its fields round the body', () => {
    // SchematicCanvas passes the instance's own position as the centre, exactly
    // as SCH_EDIT_TOOL does for a single selected symbol — and upstream reaches
    // the same code, because PlaceSymbol answers rotateCW/rotateCCW with
    // `evt->SetPassEvent()` (sch_drawing_tools.cpp:659-663).
    const inst = one().symbols[0]!;
    const turned = transformSymbol(inst, 'rotateCCW', inst.at);
    expect(turned.at).toEqual(inst.at);
    expect(turned.angle).toBe(90);
    expect(offsets(turned)).toEqual([mm(-2.54, 0), mm(2.54, 0)]);
  });
});
