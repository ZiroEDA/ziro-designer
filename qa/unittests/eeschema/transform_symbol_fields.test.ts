// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a symbol's fields end up after R / X / Y.
 *
 * `SCH_SYMBOL::Rotate` (sch_symbol.cpp:2837), `::MirrorHorizontally` (:2801) and
 * `::MirrorVertically` (:2819) all do the same two things: transform `m_pos`,
 * then move every field by the symbol's *own* move vector — "move the fields to
 * the new position because the symbol itself has moved". The fields never orbit
 * the transform centre, so their offset from the body is an invariant of the op.
 *
 * The property that pins that down: a single symbol turns about its own position,
 * the move vector is zero, and the fields therefore do not move at all. We used
 * to map each field through the same rotation as the body, which threw the
 * reference to a different side of the symbol on every press of R.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { transformItems, transformSymbol } from '@ziroeda/eeschema/src/tools/transform.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { Schematic, SchSymbol, Vec2 } from '@ziroeda/eeschema/src/types.js';

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** A resistor with its reference above the body and its value below it. */
const resistor = (uuid: string, x: number, y: number): string =>
  `(symbol (lib_id "Device:R") (at ${x} ${y} 0) (unit 1) (uuid "${uuid}")
     (property "Reference" "R1" (at ${x + 2} ${y - 2} 0)
       (effects (font (size 1.27 1.27)) (justify left)))
     (property "Value" "10k" (at ${x + 2} ${y + 2} 0)
       (effects (font (size 1.27 1.27)) (justify left))))`;

const one = (): Schematic => sheet(resistor('s-1', 100, 100));
const id = (d: Schematic, i = 0): string => refId('symbol', d.symbols[i]!.uuid, i);

/** Each field's offset from its own symbol's anchor. */
const offsets = (s: SchSymbol): Vec2[] =>
  s.fields.filter((f) => f.at).map((f) => ({ x: f.at!.x - s.at.x, y: f.at!.y - s.at.y }));

describe('one selected symbol', () => {
  for (const op of ['rotateCW', 'rotateCCW', 'mirrorX', 'mirrorY'] as const) {
    it(`${op} leaves every field exactly where it was`, () => {
      // The centre is the symbol's own position, so upstream's move vector is
      // (0,0) and the field loop is a no-op. Orbiting the centre instead moved
      // them, which is the whole defect.
      const d = one();
      const after = transformItems(new Set([id(d)]), op).apply(d);
      expect(after.symbols[0]!.at).toEqual(d.symbols[0]!.at);
      expect(after.symbols[0]!.fields.map((f) => f.at)).toEqual(
        d.symbols[0]!.fields.map((f) => f.at),
      );
    });
  }

  it('still advances the orientation — the fields staying put is not a no-op', () => {
    const d = one();
    const after = transformItems(new Set([id(d)]), 'rotateCW').apply(d);
    expect(after.symbols[0]!.angle).not.toBe(d.symbols[0]!.angle);
  });

  it('four turns of R leave the reference on the side it started on', () => {
    let d = one();
    const ids = new Set([id(d)]);
    for (let i = 0; i < 4; i++) d = transformItems(ids, 'rotateCCW').apply(d);
    expect(d.symbols[0]!.fields[0]!.at).toEqual(one().symbols[0]!.fields[0]!.at);
  });
});

describe('two symbols turned together', () => {
  const pair = (): Schematic =>
    sheet([resistor('s-1', 100, 100), resistor('s-2', 120, 100)].join('\n'));

  it('translates the fields by each symbol’s own delta, keeping the offset', () => {
    // Here the centre is not either symbol's anchor, so both bodies move — and
    // each field must ride along by exactly its own symbol's move vector. If the
    // fields orbited the centre instead, the offset would come back rotated.
    const d = pair();
    const ids = new Set([id(d, 0), id(d, 1)]);
    const after = transformItems(ids, 'rotateCW').apply(d);
    for (const i of [0, 1]) {
      expect(after.symbols[i]!.at).not.toEqual(d.symbols[i]!.at); // it really moved
      expect(offsets(after.symbols[i]!)).toEqual(offsets(d.symbols[i]!));
    }
  });

  it('keeps the offset under a mirror too', () => {
    const d = pair();
    const ids = new Set([id(d, 0), id(d, 1)]);
    const after = transformItems(ids, 'mirrorY').apply(d);
    for (const i of [0, 1]) {
      expect(after.symbols[i]!.at).not.toEqual(d.symbols[i]!.at);
      expect(offsets(after.symbols[i]!)).toEqual(offsets(d.symbols[i]!));
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

  it('reaches the file — the reference keeps its offset after a save', () => {
    const d = pair();
    const ids = new Set([id(d, 0), id(d, 1)]);
    const after = transformItems(ids, 'rotateCW').apply(d);
    const s = after.symbols[0]!;
    const ref = s.fields[0]!;
    const text = serializeSchematic(after);
    // Round-trip rather than matching mm text: the offset is what must survive.
    const back = readSchematic(parse(text));
    expect(back.symbols[0]!.fields[0]!.at).toEqual(ref.at);
    expect(offsets(back.symbols[0]!)).toEqual(offsets(one().symbols[0]!));
  });
});

describe('the attached-symbol placement path', () => {
  it('R on a symbol on the cursor does not move its fields', () => {
    // SchematicCanvas passes the instance's own position as the centre, exactly
    // as SCH_EDIT_TOOL does for a single selected symbol.
    const inst = one().symbols[0]!;
    const turned = transformSymbol(inst, 'rotateCCW', inst.at);
    expect(turned.fields.map((f) => f.at)).toEqual(inst.fields.map((f) => f.at));
    expect(turned.angle).not.toBe(inst.angle);
  });
});
