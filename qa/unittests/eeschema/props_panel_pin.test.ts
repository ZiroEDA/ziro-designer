// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The properties panel's rows for a placed symbol's pin.
 *
 * A pin is a selectable item in eeschema — `SCH_SELECTION_TOOL::Selectable`
 * has a SCH_PIN_T case, gated only on the Pins filter and on visibility — so
 * clicking one is not a mis-click and the panel is expected to describe it.
 *
 * Counterpart: SCH_PIN's PROPERTY_MANAGER registrations (eeschema/sch_pin.cpp).
 * Every one of them is either `.SetWriteableFunc( isSymbolEditor )` or
 * `.SetAvailableFunc( isSymbolEditor )`, so in the *schematic* editor the rows
 * are read-only and the geometry ones (Position X/Y, the two text sizes,
 * Visible) do not appear at all.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { schPropertiesFor } from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById, collectPinSegments } from '@ziroeda/eeschema/src/tools/hittest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

const doc: Schematic = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
    (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
      (property "Reference" "R1" (at 0 0 0))
      (property "Value" "10k" (at 0 0 0))))`),
);

const pinIds = collectPinSegments(doc, LIB).map((s) => s.id);
const rows = (id: string) => schPropertiesFor(doc, LIB, itemRefById(doc, id)!);

describe('a placed pin has properties rows', () => {
  it('resolves to a pin ref rather than nothing', () => {
    expect(pinIds.length).toBe(2);
    expect(itemRefById(doc, pinIds[0]!)?.kind).toBe('pin');
  });

  it('used to be empty — schPropertiesFor had no pin arm, so the panel went blank', () => {
    expect(rows(pinIds[0]!).length).toBeGreaterThan(0);
  });

  it('lists exactly the properties available outside the symbol editor', () => {
    expect(rows(pinIds[0]!).map((r) => r.name)).toEqual([
      'Pin Name',
      'Pin Number',
      'Electrical Type',
      'Graphic Style',
      'Orientation',
      'Length',
    ]);
  });

  it('reads the library pin, in KiCad wording', () => {
    const by = new Map(rows(pinIds[0]!).map((r) => [r.name, r.value]));
    expect(by.get('Pin Number')).toBe('1');
    expect(by.get('Electrical Type')).toBe('Passive');
    expect(by.get('Graphic Style')).toBe('Line');
  });

  it('makes every row read-only: pin geometry belongs to the library symbol', () => {
    expect(rows(pinIds[1]!).every((r) => r.set === undefined)).toBe(true);
  });

  it('gives nothing for a pin index the symbol does not have', () => {
    expect(rows('r1:pin99')).toEqual([]);
  });
});
