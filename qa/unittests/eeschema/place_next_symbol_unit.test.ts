// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Place Next Symbol Unit, counterpart SCH_DRAWING_TOOLS::PlaceNextSymbolUnit:
 * which unit the next placement is, and the copy of the symbol that carries it.
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import {
  cloneSymbolForUnit,
  planNextSymbolUnit,
  unplacedUnits,
  PLACE_NEXT_UNIT_MESSAGES,
} from '@ziroeda/eeschema/src/tools/symbol_unit.js';
import { placeSymbolInstance } from '@ziroeda/eeschema/src/tools/mutate.js';
import { moveSymbolTo } from '@ziroeda/eeschema/src/tools/move.js';
import { transformSymbol } from '@ziroeda/eeschema/src/tools/transform.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

/** A four-unit part; unit 3 carries a name of its own. */
const LIB = `(symbol "Amp:LM324"
  (property "Reference" "U" (at 0 0 0))
  (property "Value" "LM324" (at 0 2 0))
  (symbol "LM324_1_1")
  (symbol "LM324_2_1")
  (symbol "LM324_3_1" (unit_name "Power"))
  (symbol "LM324_4_1"))`;

/** A single-unit part, for the "only one unit" refusal. */
const R_LIB = `(symbol "Device:R"
  (property "Reference" "R" (at 0 0 0))
  (symbol "R_1_1"))`;

/**
 * A placed symbol. Positions are on the 1.27 mm grid, as schematic items are;
 * the `(instances ...)` block is the per-sheet annotation a copy must not
 * inherit.
 */
const place = (
  uuid: string,
  ref: string,
  unit: number,
  opts: { libId?: string; at?: string; dnp?: boolean } = {},
): string => `
  (symbol (lib_id "${opts.libId ?? 'Amp:LM324'}") (at ${opts.at ?? '25.4 20.32'} 0)
    (unit ${unit}) (uuid "${uuid}")${opts.dnp ? ' (dnp yes)' : ''}
    (property "Reference" "${ref}" (at 27.94 19.05 0))
    (property "Value" "LM324" (at 27.94 21.59 0))
    (pin "1" (uuid "${uuid}-p1"))
    (instances (project "board" (path "/abcd" (reference "${ref}") (unit ${unit})))))`;

const sch = (body: string, extraLib = ''): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20231120) (lib_symbols ${LIB} ${extraLib}) ${body})`));
const libs = (d: Schematic): Map<string, LibSymbol> =>
  new Map(d.libSymbols.map((l) => [l.libId, l]));

describe('choosing the unit to place next', () => {
  it('takes the lowest unit still missing', () => {
    const d = sch(`${place('s0', 'U1', 2)} ${place('s1', 'U1', 1)}`);
    const plan = planNextSymbolUnit(d, 0, libs(d));
    expect(plan.ok && plan.unit).toBe(3);
  });

  it('takes the unit the menu entry asked for', () => {
    const d = sch(place('s0', 'U1', 1));
    const plan = planNextSymbolUnit(d, 0, libs(d), 4);
    expect(plan.ok && plan.unit).toBe(4);
  });

  it('refuses a requested unit that is already down', () => {
    const d = sch(`${place('s0', 'U1', 1)} ${place('s1', 'U1', 2)}`);
    const plan = planNextSymbolUnit(d, 0, libs(d), 2);
    expect(plan).toEqual({ ok: false, message: PLACE_NEXT_UNIT_MESSAGES.requestedPlaced });
  });

  it('refuses a part that has only one unit', () => {
    const d = sch(place('r0', 'R1', 1, { libId: 'Device:R' }), R_LIB);
    const plan = planNextSymbolUnit(d, 0, libs(d));
    expect(plan).toEqual({ ok: false, message: PLACE_NEXT_UNIT_MESSAGES.singleUnit });
  });

  it('refuses once every unit is placed', () => {
    const d = sch(
      [1, 2, 3, 4].map((u) => place(`s${u}`, 'U1', u, { at: `${25.4 * u} 20.32` })).join(' '),
    );
    const plan = planNextSymbolUnit(d, 0, libs(d));
    expect(plan).toEqual({ ok: false, message: PLACE_NEXT_UNIT_MESSAGES.allPlaced });
  });

  it('refuses when nothing resolves to a symbol', () => {
    const d = sch(place('s0', 'U1', 1));
    const plan = planNextSymbolUnit(d, 7, libs(d));
    expect(plan).toEqual({ ok: false, message: PLACE_NEXT_UNIT_MESSAGES.needsSingleSymbol });
  });

  it('counts units placed on other sheets of the hierarchy', () => {
    // GetUnplacedUnitsForSymbol walks schematic->Hierarchy(), not one screen:
    // U1B on the power sheet is placed even while you are looking at the root.
    const root = sch(place('s0', 'U1', 1));
    const other = sch(place('s1', 'U1', 2));
    expect([...unplacedUnits(root, 0, libs(root))].sort()).toEqual([2, 3, 4]);
    expect([...unplacedUnits(root, 0, libs(root), [root, other])].sort()).toEqual([3, 4]);
    const plan = planNextSymbolUnit(root, 0, libs(root), 0, [root, other]);
    expect(plan.ok && plan.unit).toBe(3);
  });
});

describe('the symbol the placement carries', () => {
  it('is the same part, one unit on', () => {
    const d = sch(place('s0', 'U1', 1, { dnp: true }));
    const plan = planNextSymbolUnit(d, 0, libs(d), 3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const src = d.symbols[0]!;
    // Everything that makes it the same package rides along; only the unit moves.
    expect(plan.symbol.unit).toBe(3);
    expect(plan.symbol.libId).toBe(src.libId);
    expect(plan.symbol.dnp).toBe(true);
    expect(plan.symbol.fields.map((f) => [f.key, f.value])).toEqual(
      src.fields.map((f) => [f.key, f.value]),
    );
    // Not re-annotated: the new unit joins U1 rather than becoming U2.
    expect(plan.symbol.fields.find((f) => f.key === 'Reference')!.value).toBe('U1');
  });

  it('gets an identity of its own, in the file as well as the model', () => {
    // writeSymbol patches geometry and fields back into the item's own node but
    // never its uuid, so a copy that kept the original node would save under
    // the original's uuid and the two would be one item on reload.
    const d = sch(place('s0', 'U1', 1));
    const plan = planNextSymbolUnit(d, 0, libs(d), 2);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.symbol.uuid).not.toBe(d.symbols[0]!.uuid);

    const after = placeSymbolInstance(libs(d).get('Amp:LM324')!, plan.symbol).apply(d);
    const reread = readSchematic(parse(serialize(writeSchematic(after))));
    expect(reread.symbols).toHaveLength(2);
    expect(new Set(reread.symbols.map((s) => s.uuid)).size).toBe(2);
    expect(reread.symbols.map((s) => s.unit).sort()).toEqual([1, 2]);
    // The pins are items too, and get their own uuids.
    const [a, b] = reread.symbols.map((s) => serialize(s.source));
    expect(a).not.toBe(b);
  });

  it('leaves the original symbol’s per-sheet instances behind', () => {
    // (instances ...) keys reference and unit by the *original* symbol, so a
    // copy that inherited it would claim the original's annotation.
    const d = sch(place('s0', 'U1', 1));
    const clone = cloneSymbolForUnit(d.symbols[0]!, 2);
    expect(serialize(d.symbols[0]!.source)).toContain('instances');
    expect(serialize(clone.source)).not.toContain('instances');
  });

  it('rides the cursor and turns as a placed symbol does', () => {
    const d = sch(place('s0', 'U1', 1));
    const plan = planNextSymbolUnit(d, 0, libs(d), 2);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    // Dropped where the cursor is, fields keeping their offsets from the body.
    const at = { x: mmToIU(50.8), y: mmToIU(38.1) };
    const moved = moveSymbolTo(plan.symbol, at);
    expect(moved.at).toEqual(at);
    const dx = at.x - plan.symbol.at.x;
    const dy = at.y - plan.symbol.at.y;
    expect(moved.fields[0]!.at).toEqual({
      x: plan.symbol.fields[0]!.at!.x + dx,
      y: plan.symbol.fields[0]!.at!.y + dy,
    });

    // R turns the copy about its own position. `SCH_SYMBOL::Rotate`'s explicit
    // field loop is therefore a no-op (sch_symbol.cpp:2837), but the field still
    // swings round the body: its stored position is symbol-local and the drawn
    // one is that mapped through the new transform (SCH_FIELD::GetPosition,
    // sch_field.cpp:1425-1438). Measured in KiCad 10.0.5: a diode's reference
    // 2.54 mm above the body sits 2.54 mm to its left after one R.
    //
    // Here the offset is (+25400, -12700), and CCW in +Y-down screen space is
    // (x, y) -> (y, -x), so it becomes (-12700, -25400).
    const turned = transformSymbol(moved, 'rotateCCW', moved.at);
    expect(turned.at).toEqual(at);
    expect(turned.angle).toBe(90);
    expect(turned.fields[0]!.at).toEqual({
      x: at.x + (moved.fields[0]!.at!.y - at.y),
      y: at.y - (moved.fields[0]!.at!.x - at.x),
    });
    expect(turned.fields[0]!.at).toEqual({ x: mmToIU(49.53), y: mmToIU(35.56) });
  });

  it('is added undoably, leaving the original untouched', () => {
    const d = sch(place('s0', 'U1', 1));
    const plan = planNextSymbolUnit(d, 0, libs(d), 2);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const cmd = placeSymbolInstance(libs(d).get('Amp:LM324')!, plan.symbol);
    const after = cmd.apply(d);
    expect(after.symbols).toHaveLength(2);
    expect(after.symbols[0]).toEqual(d.symbols[0]);
    expect(cmd.invert(d).apply(after)).toEqual(d);
  });
});
