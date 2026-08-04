// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Alternate pin functions: the model, the round trip, and the resolution rules
 * from SCH_PIN::GetName/GetType/GetShape and DIALOG_CHANGE_SYMBOLS's
 * "Clear alternate pins as required" pass.
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { writeSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/write-schematic.js';
import {
  clearAlternates,
  isUsableAlternate,
  pinAlternate,
  resolvePin,
  symbolPin,
} from '@ziroeda/eeschema/src/tools/pin_alternates.js';
import type { LibPin, Schematic } from '@ziroeda/eeschema/src/types.js';

/**
 * A two-pin part whose pin 2 can also serve as an SPI clock or a reset — and,
 * deliberately, as an alternate named after the pin itself. That last one is
 * the old-KiCad bug the writer and the change-symbols pass both work around,
 * and declaring it is what keeps the rule that rejects it from passing merely
 * because the lookup failed.
 */
const LIB = `(kicad_symbol_lib (version 20250114)
  (symbol "MCU:U"
    (symbol "U_1_1"
      (pin passive line (at 0 2.54 270) (length 2.54)
        (name "VCC") (number "1"))
      (pin bidirectional line (at 0 -2.54 90) (length 2.54)
        (name "PA0") (number "2")
        (alternate "SCK" output clock)
        (alternate "NRST" input inverted)
        (alternate "PA0" input line)))))`;

const pins = (): readonly LibPin[] => readSymbolLib(parse(LIB))[0]!.units[0]!.pins;
const pin2 = (): LibPin => pins().find((p) => p.number === '2')!;

const sheet = (pinBlock: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
      (symbol (lib_id "MCU:U") (at 50.8 50.8 0) (unit 1) (uuid "s-1")
        (property "Reference" "U1" (at 50.8 45.72 0) (effects (font (size 1.27 1.27))))
        ${pinBlock}))`),
  );

const PLAIN = `(pin "1" (uuid "p-1")) (pin "2" (uuid "p-2"))`;
const WITH_SCK = `(pin "1" (uuid "p-1")) (pin "2" (uuid "p-2") (alternate "SCK"))`;

describe('the library pin carries its alternates', () => {
  it('reads each (alternate "NAME" type shape) positionally', () => {
    const alts = pin2().alternates!;
    expect(alts).toEqual([
      { name: 'SCK', electricalType: 'output', shape: 'clock' },
      { name: 'NRST', electricalType: 'input', shape: 'inverted' },
      { name: 'PA0', electricalType: 'input', shape: 'line' },
    ]);
    // A pin that declares none stays undefined rather than an empty array, so
    // the common case adds nothing to the model.
    expect(pins().find((p) => p.number === '1')!.alternates).toBeUndefined();
  });

  it('finds one by name and nothing by a name it does not have', () => {
    expect(pinAlternate(pin2(), 'NRST')?.shape).toBe('inverted');
    expect(pinAlternate(pin2(), 'SDA')).toBeUndefined();
    expect(pinAlternate(pin2(), undefined)).toBeUndefined();
  });
});

describe('the placement carries its selection', () => {
  it('reads (pin "N" (uuid …) (alternate "X"))', () => {
    const sym = sheet(WITH_SCK).symbols[0]!;
    expect(symbolPin(sym, '2')).toEqual({ number: '2', uuid: 'p-2', alternate: 'SCK' });
    // No (alternate …): the key is absent, not an empty string.
    expect(symbolPin(sym, '1')).toEqual({ number: '1', uuid: 'p-1' });
  });

  it('a sheet pin is not a symbol pin', () => {
    // Both are `(pin …)`, and a sheet's are a different item entirely — reading
    // one as the other would give every sheet a bogus pin list.
    const doc = readSchematic(
      parse(`(kicad_sch (version 20250114)
        (sheet (at 10 10) (size 20 20) (uuid "sh-1")
          (property "Sheetname" "sub" (at 10 9 0))
          (property "Sheetfile" "sub.kicad_sch" (at 10 31 0))
          (pin "IN" input (at 10 15 180) (uuid "sp-1"))))`),
    );
    expect(doc.sheets[0]!.pins).toHaveLength(1);
    expect(doc.symbols).toHaveLength(0);
  });
});

describe('the round trip', () => {
  it('keeps an alternate untouched through a read and a write', () => {
    const doc = sheet(WITH_SCK);
    expect(serialize(writeSchematic(doc))).toContain('(alternate "SCK")');
  });

  it('clearing the model removes the child rather than writing an empty one', () => {
    // saveSymbol writes the bare (pin "N" (uuid …)) form for a pin with no alt.
    const doc = sheet(WITH_SCK);
    const sym = doc.symbols[0]!;
    const out = serialize(
      writeSchematic({
        ...doc,
        symbols: [{ ...sym, pins: clearAlternates(sym, pins(), true).pins }],
      }),
    );
    expect(out).not.toContain('alternate');
    expect(out).toContain('(pin "2"');
  });

  it('sets an alternate on a placement that had none', () => {
    const doc = sheet(PLAIN);
    const sym = doc.symbols[0]!;
    const out = serialize(
      writeSchematic({
        ...doc,
        symbols: [
          {
            ...sym,
            pins: sym.pins!.map((p) => (p.number === '2' ? { ...p, alternate: 'NRST' } : p)),
          },
        ],
      }),
    );
    expect(out).toContain('(alternate "NRST")');
  });
});

describe('resolution falls back rather than failing', () => {
  it('an alternate replaces the name, type and shape together', () => {
    const r = resolvePin(sheet(WITH_SCK).symbols[0]!, pin2());
    expect(r).toEqual({
      name: 'SCK',
      electricalType: 'output',
      shape: 'clock',
      alternate: 'SCK',
    });
  });

  it('no selection resolves to the base function', () => {
    expect(resolvePin(sheet(PLAIN).symbols[0]!, pin2())).toEqual({
      name: 'PA0',
      electricalType: 'bidirectional',
      shape: 'line',
    });
  });

  it('an alternate the library dropped resolves to the base function', () => {
    // The library moved on; the placement still names SDA. Upstream renders the
    // base pin rather than a blank one.
    const doc = sheet(`(pin "2" (uuid "p-2") (alternate "SDA"))`);
    expect(resolvePin(doc.symbols[0]!, pin2()).name).toBe('PA0');
  });

  it('an alternate equal to the base name is no alternate at all', () => {
    // The old-KiCad bug the writer works around: "PA0" as an alt means the same
    // as none, and treating it as real breaks library comparison. The library
    // *does* declare it here, so the rejection cannot come from a failed lookup.
    expect(pinAlternate(pin2(), 'PA0')).toBeDefined();
    expect(isUsableAlternate(pin2(), 'PA0')).toBe(false);
    const doc = sheet(`(pin "2" (uuid "p-2") (alternate "PA0"))`);
    const r = resolvePin(doc.symbols[0]!, pin2());
    expect(r.alternate).toBeUndefined();
    // And it resolves to the *base* shape, not the alternate's.
    expect(r.shape).toBe('line');
    expect(r.electricalType).toBe('bidirectional');
  });
});

describe('clearAlternates, the change-symbols pass', () => {
  it('with the reset option off, keeps an alternate the library still declares', () => {
    const sym = sheet(WITH_SCK).symbols[0]!;
    const out = clearAlternates(sym, pins(), false);
    expect(out).toBe(sym); // unchanged, by identity
  });

  it('with the reset option off, still clears a stale one', () => {
    // "Clear the alternate pin name if it no longer exists in the alternate pin
    // map" — upstream does this whether or not the box is checked.
    const sym = sheet(`(pin "2" (uuid "p-2") (alternate "SDA"))`).symbols[0]!;
    expect(clearAlternates(sym, pins(), false).pins![0]!.alternate).toBeUndefined();
  });

  it('with the reset option off, still clears one equal to the base name', () => {
    const sym = sheet(`(pin "2" (uuid "p-2") (alternate "PA0"))`).symbols[0]!;
    expect(clearAlternates(sym, pins(), false).pins![0]!.alternate).toBeUndefined();
  });

  it('with the reset option on, clears a perfectly valid one', () => {
    const sym = sheet(WITH_SCK).symbols[0]!;
    const out = clearAlternates(sym, pins(), true);
    expect(out.pins!.find((p) => p.number === '2')!.alternate).toBeUndefined();
    // The uuid is the pin's identity and must not go with it.
    expect(out.pins!.find((p) => p.number === '2')!.uuid).toBe('p-2');
  });

  it('clears an alternate on a pin the library no longer has', () => {
    const sym = sheet(`(pin "9" (uuid "p-9") (alternate "SCK"))`).symbols[0]!;
    expect(clearAlternates(sym, pins(), false).pins![0]!.alternate).toBeUndefined();
  });
});
