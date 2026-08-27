// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A placed symbol carries every field its library symbol defines.
 *
 * `SCH_SYMBOL`'s library constructor ends in `UpdateFields( aSheet, true, …)`
 * (sch_symbol.cpp:97-101), and the `aUpdateStyle` arm of that runs for EVERY
 * field the library has (sch_symbol.cpp:1438-1442):
 *
 *     schField->ImportValues( *libField );
 *     schField->SetTextPos( m_pos + libField->GetTextPos() );
 *
 * So Footprint, Datasheet and Description exist on the placement from the
 * moment it is made, hidden, at the offsets the library gives them — and
 * `AUTOPLACER` never moves them, because it skips a field that is not visible
 * (`if( !field->IsVisible() || !field->CanAutoplace() ) continue;`,
 * autoplace_fields.cpp:152-154 and :200-202).
 *
 * That is the whole of why KiCad draws a visible Footprint string below a
 * capacitor rather than beside its reference: `Device:C` puts the field at
 * (0.9652, -3.81) in library coordinates, the reference and value are the only
 * two the autoplacer ever touched, and showing the field afterwards does not
 * autoplace anything. Ours created no such field, so whatever first needed one
 * made it at the symbol's own anchor and the string ran through the body.
 *
 * `ki_keywords`, `ki_description`, `ki_fp_filters` and `ki_locked` are the
 * exception: `parseProperty` turns each into a LIB_SYMBOL member and returns
 * `nullptr` instead of a field (sch_io_kicad_sexpr_parser.cpp:1168-1201), so
 * they never reach a placement. We keep them on `LibSymbol.properties` because
 * that is where the library file put them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSymbolLib } from '@ziroeda/eeschema/src/index.js';
import { makeSymbol } from '@ziroeda/eeschema/src/tools/build.js';
import { autoplacePlacedSymbol } from '@ziroeda/eeschema/src/tools/autoplace_fields.js';
import { transformSymbol } from '@ziroeda/eeschema/src/tools/transform.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { SchField, SchSymbol, Vec2 } from '@ziroeda/eeschema/src/types.js';

/** Stock `Device:C`, copied from /usr/share/kicad/symbols/Device.kicad_sym. */
const C = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/C.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;

const AT: Vec2 = { x: mmToIU(100), y: mmToIU(100) };
const field = (s: SchSymbol, key: string): SchField | undefined =>
  s.fields.find((f) => f.key === key);
const offset = (s: SchSymbol, key: string): Vec2 | undefined => {
  const f = field(s, key);
  return f?.at ? { x: f.at.x - s.at.x, y: f.at.y - s.at.y } : undefined;
};

describe('the fields a freshly placed symbol is made with', () => {
  it('are the library’s five mandatory ones, in KiCad’s order', () => {
    // `LIB_SYMBOL::GetFields` yields the mandatory fields first, and
    // `UpdateFields` walks that list, so this is the order a placement gets.
    expect(makeSymbol(C, AT).fields.map((f) => f.key)).toEqual([
      'Reference',
      'Value',
      'Footprint',
      'Datasheet',
      'Description',
    ]);
  });

  it('do not include the library-only `ki_*` properties', () => {
    // They ARE on the library symbol — this is not vacuous.
    expect(C.properties.map((p) => p.key)).toContain('ki_keywords');
    expect(C.properties.map((p) => p.key)).toContain('ki_fp_filters');
    expect(makeSymbol(C, AT).fields.map((f) => f.key)).not.toContain('ki_keywords');
    expect(makeSymbol(C, AT).fields.map((f) => f.key)).not.toContain('ki_fp_filters');
  });

  /**
   * `Device:C`'s Footprint property is `(at 0.9652 -3.81 0)` in library
   * coordinates, which the reader flips to +Y-down: 0.9652 mm right of the
   * anchor and 3.81 mm BELOW it — under the body, which is 0.762 mm tall
   * either side of the origin. That is where KiCad draws the footprint string.
   */
  it('put Footprint at the library’s own offset, below the body', () => {
    expect(offset(makeSymbol(C, AT), 'Footprint')).toEqual({
      x: mmToIU(0.9652),
      y: mmToIU(3.81),
    });
  });

  /** `(hide yes)` on all three, which is why the offset goes unnoticed. */
  it('keep the library’s visibility', () => {
    const s = makeSymbol(C, AT);
    expect(field(s, 'Footprint')?.effects?.hidden).toBe(true);
    expect(field(s, 'Datasheet')?.effects?.hidden).toBe(true);
    expect(field(s, 'Description')?.effects?.hidden).toBe(true);
    expect(field(s, 'Reference')?.effects?.hidden).toBe(false);
    expect(field(s, 'Value')?.effects?.hidden).toBe(false);
  });

  /** Description carries the library's text; Footprint and Datasheet are empty. */
  it('take the library’s text for the three they do not compute', () => {
    const s = makeSymbol(C, AT);
    expect(field(s, 'Description')?.value).toBe('Unpolarized capacitor');
    expect(field(s, 'Footprint')?.value).toBe('');
    expect(field(s, 'Datasheet')?.value).toBe('');
  });

  /** The hidden fields have to reach the file, or a reload loses the offset. */
  it('reach the symbol’s serialized node', () => {
    const s = makeSymbol(C, AT);
    const names = s.source.items
      .filter((i) => i.kind === 'list' && i.items[0]?.kind === 'atom')
      .map((i) => (i as { items: { value?: string }[] }).items[1]?.value);
    expect(names).toContain('Footprint');
    expect(names).toContain('Description');
  });
});

describe('what the autoplacer does with them', () => {
  const opts = { allowRejustify: true, alignToGrid: true };

  /**
   * `if( !field->IsVisible() || !field->CanAutoplace() ) continue;` — a hidden
   * Footprint is not in the stacked column at all, so it keeps the library's
   * offset while the reference and value are moved beside the body.
   */
  it('leaves the hidden ones exactly where the library put them', () => {
    const placed = autoplacePlacedSymbol(makeSymbol(C, AT), C, true, opts);
    expect(offset(placed, 'Footprint')).toEqual({ x: mmToIU(0.9652), y: mmToIU(3.81) });
    expect(offset(placed, 'Datasheet')).toEqual({ x: 0, y: 0 });
    // ...while the two visible ones did move, so the run was not a no-op.
    expect(offset(placed, 'Reference')).not.toEqual(offset(makeSymbol(C, AT), 'Reference'));
  });

  /**
   * Made visible, it joins the column like any other field — the same loop,
   * gated only on `IsVisible()`. This is the half that says the skip above is
   * about visibility and not about the field's name.
   */
  it('places a Footprint the user has made visible', () => {
    const shown = makeSymbol(C, AT);
    const withShown: SchSymbol = {
      ...shown,
      fields: shown.fields.map((f) =>
        f.key === 'Footprint'
          ? { ...f, value: 'C_Radial_D8.0mm', effects: { ...f.effects, hidden: false } }
          : f,
      ),
    };
    const placed = autoplacePlacedSymbol(withShown, C, true, opts);
    expect(offset(placed, 'Footprint')).not.toEqual({ x: mmToIU(0.9652), y: mmToIU(3.81) });
    // It lands in the same column as the reference: one x, three stacked rows.
    expect(offset(placed, 'Footprint')?.x).toBe(offset(placed, 'Reference')?.x);
  });
});

describe('what a rotation does with them', () => {
  /**
   * Nothing special: a hidden field's drawn position is still the local one
   * mapped through the symbol's transform (`SCH_FIELD::GetPosition`,
   * sch_field.cpp:1425-1438), so it swings round the body with the rest. CCW in
   * +Y-down screen space is (x, y) -> (y, -x).
   */
  it('turns the hidden Footprint with the body, like any other field', () => {
    const s = makeSymbol(C, AT);
    const turned = transformSymbol(s, 'rotateCCW', s.at);
    expect(offset(turned, 'Footprint')).toEqual({ x: mmToIU(3.81), y: mmToIU(-0.9652) });
  });
});
