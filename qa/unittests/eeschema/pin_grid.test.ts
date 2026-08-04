// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Properties dialog's Pin Functions grid, counterpart
 * SCH_PIN_TABLE_DATA_MODEL in dialog_symbol_properties.cpp.
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { writeSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/write-schematic.js';
import {
  PIN_GRID_COLUMNS,
  pinGridRows,
  setPinAlternate,
  unitPins,
} from '@ziroeda/eeschema/src/tools/pin_grid.js';
import { editSymbolProperties } from '@ziroeda/eeschema/src/tools/properties.js';
import type { LibSymbol, Schematic, SchSymbol } from '@ziroeda/eeschema/src/types.js';

/**
 * A two-unit part. Pin 1 (unit 1) has no alternates; pin 2 (unit 1) has two;
 * pin 3 belongs to unit 2 and must not appear under a unit-1 placement.
 */
const LIB = `(kicad_symbol_lib (version 20250114)
  (symbol "MCU:U"
    (symbol "U_1_1"
      (pin power_in line (at 0 2.54 270) (length 2.54) (name "VCC") (number "1"))
      (pin bidirectional line (at 0 -2.54 90) (length 2.54)
        (name "PA0") (number "2")
        (alternate "SCK" output clock)
        (alternate "NRST" input inverted)))
    (symbol "U_2_1"
      (pin passive line (at 5 0 0) (length 2.54) (name "GND") (number "3")))))`;

const lib = (): LibSymbol => readSymbolLib(parse(LIB))[0]!;

const sheet = (unit: number, pinBlock = ''): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
      (symbol (lib_id "MCU:U") (at 50.8 50.8 0) (unit ${unit}) (uuid "s-1")
        (property "Reference" "U1" (at 50.8 45.72 0) (effects (font (size 1.27 1.27))))
        ${pinBlock}))`),
  );

const sym = (unit = 1, pinBlock = ''): SchSymbol => sheet(unit, pinBlock).symbols[0]!;

describe('the grid shows the placed unit', () => {
  it('has upstream five columns in order', () => {
    expect(PIN_GRID_COLUMNS).toEqual([
      'Number',
      'Base Name',
      'Alternate Assignment',
      'Electrical Type',
      'Graphic Style',
    ]);
  });

  it('lists only the pins of the unit the symbol is placed as', () => {
    expect(unitPins(sym(1), lib()).map((p) => p.number)).toEqual(['1', '2']);
    expect(unitPins(sym(2), lib()).map((p) => p.number)).toEqual(['3']);
  });

  it('is empty when the library symbol is missing', () => {
    expect(pinGridRows(sym(1), undefined)).toEqual([]);
  });
});

describe('the Alternate Assignment cell', () => {
  it('is empty for a pin with no alternates to choose between', () => {
    // Not the pin's own name: the cell means "which function is in force", and
    // a pin with one function has no such choice.
    const row = pinGridRows(sym(1), lib()).find((r) => r.number === '1')!;
    expect(row.alternate).toBe('');
    expect(row.choices).toEqual([]);
  });

  it('shows the base name when the pin has alternates but none is chosen', () => {
    const row = pinGridRows(sym(1), lib()).find((r) => r.number === '2')!;
    expect(row.alternate).toBe('PA0');
    expect(row.choices).toEqual(['PA0', 'SCK', 'NRST']);
  });

  it('shows the chosen alternate, and the type and style follow it', () => {
    const row = pinGridRows(sym(1, `(pin "2" (uuid "p-2") (alternate "SCK"))`), lib()).find(
      (r) => r.number === '2',
    )!;
    expect(row.alternate).toBe('SCK');
    expect(row.baseName).toBe('PA0'); // the base name column never changes
    expect(row.electricalType).toBe('output');
    expect(row.shape).toBe('clock');
  });

  it('falls back to the base row for an alternate the library dropped', () => {
    const row = pinGridRows(sym(1, `(pin "2" (uuid "p-2") (alternate "SDA"))`), lib()).find(
      (r) => r.number === '2',
    )!;
    expect(row.alternate).toBe('PA0');
    expect(row.electricalType).toBe('bidirectional');
  });
});

describe('setting a pin function', () => {
  it('stores the chosen alternate on the placement', () => {
    const out = setPinAlternate(sym(1, `(pin "2" (uuid "p-2"))`), lib(), '2', 'NRST');
    expect(out.pins).toEqual([{ number: '2', uuid: 'p-2', alternate: 'NRST' }]);
  });

  it('choosing the base name clears rather than stores it', () => {
    // SetValue: `if( aValue == pin.GetLibPin()->GetName() ) pin.SetAlt( "" )`.
    // Storing "PA0" would be exactly the value the format works around.
    const before = sym(1, `(pin "2" (uuid "p-2") (alternate "SCK"))`);
    const out = setPinAlternate(before, lib(), '2', 'PA0');
    expect(out.pins).toEqual([{ number: '2', uuid: 'p-2' }]);
    expect(serialize(writeSchematic({ ...sheet(1), symbols: [out] }))).not.toContain('alternate');
  });

  it('keeps the pin uuid when clearing', () => {
    const out = setPinAlternate(sym(1, `(pin "2" (uuid "p-2") (alternate "SCK"))`), lib(), '2', '');
    expect(out.pins![0]!.uuid).toBe('p-2');
  });

  it('creates an entry for a pin the file never listed, and it reaches the file', () => {
    // No uuid: only KiCad's writer mints those, and inventing one would claim
    // an identity the file never had. The writer still gives it a node, or the
    // selection would vanish on save.
    const out = setPinAlternate(sym(1), lib(), '2', 'SCK');
    expect(out.pins).toEqual([{ number: '2', alternate: 'SCK' }]);
    expect(serialize(writeSchematic({ ...sheet(1), symbols: [out] }))).toContain(
      '(alternate "SCK")',
    );
  });

  it('ignores a name the library does not declare', () => {
    const before = sym(1, `(pin "2" (uuid "p-2"))`);
    expect(setPinAlternate(before, lib(), '2', 'SDA')).toBe(before);
  });

  it('ignores a pin that is not in the placed unit', () => {
    const before = sym(1);
    expect(setPinAlternate(before, lib(), '3', 'SCK')).toBe(before);
  });

  it('is a no-op when the value is already in force', () => {
    const before = sym(1, `(pin "2" (uuid "p-2") (alternate "SCK"))`);
    expect(setPinAlternate(before, lib(), '2', 'SCK')).toBe(before);
    const plain = sym(1, `(pin "2" (uuid "p-2"))`);
    expect(setPinAlternate(plain, lib(), '2', 'PA0')).toBe(plain);
  });
});

describe('the selections reach the symbol through OK', () => {
  it('applies the pin list the dialog hands back', () => {
    const doc = sheet(1, `(pin "2" (uuid "p-2"))`);
    const s0 = doc.symbols[0]!;
    const edited = setPinAlternate(s0, lib(), '2', 'NRST');
    const after = editSymbolProperties('s-1', {
      fields: s0.fields,
      angle: s0.angle,
      unit: s0.unit,
      bodyStyle: s0.bodyStyle,
      inBom: s0.inBom,
      onBoard: s0.onBoard,
      dnp: s0.dnp,
      pins: edited.pins,
    }).apply(doc);
    expect(after.symbols[0]!.pins).toEqual([{ number: '2', uuid: 'p-2', alternate: 'NRST' }]);
    expect(serialize(writeSchematic(after))).toContain('(alternate "NRST")');
  });

  it('leaves the pin list alone when the page was never touched', () => {
    // `pins: undefined` is how the dialog says "no pin edits"; treating it as
    // an empty list would wipe every alternate on the symbol.
    const doc = sheet(1, `(pin "2" (uuid "p-2") (alternate "SCK"))`);
    const s0 = doc.symbols[0]!;
    const after = editSymbolProperties('s-1', {
      fields: s0.fields,
      angle: s0.angle,
      unit: s0.unit,
      bodyStyle: s0.bodyStyle,
      inBom: s0.inBom,
      onBoard: s0.onBoard,
      dnp: s0.dnp,
    }).apply(doc);
    expect(after.symbols[0]!.pins).toEqual([{ number: '2', uuid: 'p-2', alternate: 'SCK' }]);
  });
});
