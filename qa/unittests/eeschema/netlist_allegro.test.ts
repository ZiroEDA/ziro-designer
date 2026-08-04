// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Cadence Allegro / Telesis netlist, counterpart
 * netlist_exporter_allegro.cpp: the grouping into device types, the two files
 * it produces, and the sanitising rules a diff against an Allegro-written file
 * depends on.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  allegroFormatDevice,
  allegroFormatPin,
  allegroFormatText,
  compareSymbolRef,
  extractTailNumber,
  netlistAllegro,
  removeTailDigits,
} from '@ziroeda/eeschema/src/exporters/netlist_exporter_allegro.js';
import { netlistFiles } from '@ziroeda/eeschema/src/exporters/netlist.js';
import type { LibPin, LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

/** Two resistors on one net plus a capacitor, so grouping has something to do. */
const SCH = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (property "ki_fp_filters" "R_0805 R_0603 R_*" (at 0 0 0)
        (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "R_0_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))))
    (symbol "Device:C"
      (property "Reference" "C" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "C" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "C_0_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))))
    (symbol "Device:D"
      (property "Reference" "D" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "D" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "D_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "A") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "K") (number "2")))
      (symbol "D_1_2"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "A") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "K") (number "2")))))
  (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 53 50 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 53 52 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0805" (at 50.8 50.8 0)
      (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "Device:R") (at 50.8 63.5 0) (unit 1) (uuid "r2")
    (property "Reference" "R2" (at 53 63 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 53 65 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0805" (at 50.8 63.5 0)
      (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "Device:C") (at 76.2 50.8 0) (unit 1) (uuid "c1")
    (property "Reference" "C1" (at 78 50 0) (effects (font (size 1.27 1.27))))
    (property "Value" "100n" (at 78 52 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Capacitor_SMD:C_0603" (at 76.2 50.8 0)
      (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "Device:D") (at 101.6 50.8 0) (unit 1) (uuid "d1")
    (property "Reference" "D1" (at 104 50 0) (effects (font (size 1.27 1.27))))
    (property "Value" "1N4148" (at 104 52 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Diode_SMD:D_SOD-123" (at 101.6 50.8 0)
      (effects (font (size 1.27 1.27)) (hide yes))))
  (wire (pts (xy 50.8 46.99) (xy 76.2 46.99)) (uuid "w1")))`;

const doc = (): Schematic => readSchematic(parse(SCH));
const libs = (): Map<string, LibSymbol> => new Map(doc().libSymbols.map((l) => [l.libId, l]));
const meta = { source: 'test.kicad_sch', date: '2026-08-04T00:00:00Z' };
const run = () => netlistAllegro(doc(), libs(), meta);

describe('reference splitting', () => {
  it('separates the prefix from the trailing number', () => {
    expect(removeTailDigits('R12')).toBe('R');
    expect(extractTailNumber('R12')).toBe(12);
    // ToULong on an empty string leaves the value at 0.
    expect(extractTailNumber('R')).toBe(0);
    expect(removeTailDigits('U1A')).toBe('U1A');
  });

  it('compares by number within a prefix and lexically across prefixes', () => {
    // Same prefix: numeric, so R9 really does come before R10.
    expect(compareSymbolRef('R9', 'R10')).toBeLessThan(0);
    // Different prefix: plain string order, not natural order.
    expect(compareSymbolRef('C1', 'R1')).toBeLessThan(0);
  });
});

describe('the sanitising rules', () => {
  it('quotes only what needs quoting, and folds the micro sign', () => {
    expect(allegroFormatText('NET1')).toBe('NET1');
    expect(allegroFormatText('a/b_C')).toBe('a/b_C');
    expect(allegroFormatText('10 uF')).toBe("'10 uF'");
    expect(allegroFormatText('4µ7')).toBe('4u7');
    // Byte-wise, as upstream's std::regex over the UTF-8 string is: 'é' is two
    // bytes and becomes two '?', not one.
    expect(allegroFormatText('caf\u00e9')).toBe("'caf??'");
    // ! and ' are themselves replaced, which then forces the quoting.
    expect(allegroFormatText("do!n't")).toBe("'do?n?t'");
    expect(allegroFormatText('')).toBe('');
  });

  it('lower-cases and underscores a device type', () => {
    expect(allegroFormatDevice('10k_R_0805')).toBe('10k_r_0805');
    // "µ" survives MakeLower and is two UTF-8 bytes, so it contributes two
    // underscores — three in total with the space.
    expect(allegroFormatDevice('4.7 µF')).toBe('4_7___f');
  });

  it('builds the Telesis pin name as name__number', () => {
    const pin = { name: 'A0', number: '3' } as LibPin;
    expect(allegroFormatPin(pin)).toBe('A0__3');
    expect(allegroFormatPin({ name: '~', number: '1' } as LibPin)).toBe('?__1');
  });
});

describe('the netlist file', () => {
  it('opens with the header and closes with $END', () => {
    const { netlist } = run();
    expect(netlist.startsWith('(NETLIST)\n(Source: test.kicad_sch)\n')).toBe(true);
    expect(netlist).toContain('(Date: 2026-08-04T00:00:00Z)');
    expect(netlist.endsWith('$END\n')).toBe(true);
    // The three sections, in order.
    expect(netlist.indexOf('$PACKAGES')).toBeLessThan(netlist.indexOf('$A_PROPERTIES'));
    expect(netlist.indexOf('$A_PROPERTIES')).toBeLessThan(netlist.indexOf('$NETS'));
  });

  it('groups the two identical resistors under one device type', () => {
    // Same Value, same Footprint, same reference prefix.
    const { netlist } = run();
    expect(netlist).toContain("! '10k_resistor_smd_r_0805' ! '10k' ; R1,\n\tR2");
    expect(netlist).toContain("! '100n_capacitor_smd_c_0603' ! '100n' ; C1");
  });

  it('puts every reference in one ROOM group, since there is one sheet', () => {
    const { netlist } = run();
    expect(netlist).toContain("'ROOM' '/' ; C1,\n\tD1,\n\tR1,\n\tR2");
  });

  it('writes the net with its nodes, upper-cased', () => {
    const { netlist } = run();
    const nets = netlist.slice(netlist.indexOf('$NETS'));
    // R1 pin 1 and C1 pin 1 share the wire; R2 sits on its own.
    expect(nets).toContain("'NET-(C1-PAD1)'; C1.1,\n\tR1.1");
    // An auto-named net is quoted because of its parentheses and hyphens.
    expect(nets).toContain("'NET-(R2-PAD1)'; R2.1");
  });
});

describe('the devices directory', () => {
  it('writes one file per group, named after the device type', () => {
    const { devices } = run();
    expect(devices.map((d) => d.path).sort()).toEqual([
      'devices/100n_capacitor_smd_c_0603.txt',
      'devices/10k_resistor_smd_r_0805.txt',
      'devices/1n4148_diode_smd_d_sod-123.txt',
    ]);
  });

  it('describes the package, its pin count and its two pin lists', () => {
    const r = run().devices.find((d) => d.path.includes('10k'))!;
    expect(r.text).toContain("PACKAGE 'r_0805'"); // the bare footprint name
    expect(r.text).toContain('CLASS IC');
    expect(r.text).toContain('PINCOUNT 2');
    expect(r.text).toContain('PINORDER MAIN ,\n\t?__1,\n\t?__2');
    expect(r.text).toContain('FUNCTION MAIN MAIN ,\n\t1,\n\t2');
    expect(r.text.endsWith('END\n')).toBe(true);
  });

  it('counts a DeMorgan pin once, not once per body style', () => {
    // "We must erase redundant Pins references": the diode declares both body
    // styles, so pins 1 and 2 each appear twice in the raw list.
    const d = run().devices.find((x) => x.path.includes('1n4148'))!;
    expect(d.text).toContain('PINCOUNT 2');
    expect(d.text).toContain('PINORDER MAIN ,\n\tA__1,\n\tK__2');
    expect(d.text).toContain('FUNCTION MAIN MAIN ,\n\t1,\n\t2');
  });

  it('offers the non-wildcard footprint filters as ALT_SYMBOLS', () => {
    // "R_*" is a pattern, not a footprint name, so it is not a candidate.
    const r = run().devices.find((d) => d.path.includes('10k'))!;
    expect(r.text).toContain("PACKAGEPROP ALT_SYMBOLS '(R_0805,R_0603)'");
    // The part with no filters says nothing at all.
    const c = run().devices.find((d) => d.path.includes('100n'))!;
    expect(c.text).not.toContain('ALT_SYMBOLS');
  });
});

describe('the quirks that a byte-diff depends on', () => {
  it('trims the trailing underscore before sanitising, for a footprintless part', () => {
    // "10k_" -> "10k", not "10k_". The trim happens on the raw string.
    const src = SCH.replace(
      '(property "Footprint" "Resistor_SMD:R_0805" (at 50.8 50.8 0)\n      (effects (font (size 1.27 1.27)) (hide yes))))',
      '(property "Footprint" "" (at 50.8 50.8 0)\n      (effects (font (size 1.27 1.27)) (hide yes))))',
    );
    const d = readSchematic(parse(src));
    const l = new Map(d.libSymbols.map((s) => [s.libId, s]));
    const { netlist, devices } = netlistAllegro(d, l, meta);
    expect(netlist).toContain("! '10k' ! '10k' ;");
    expect(devices.some((f) => f.path === 'devices/10k.txt')).toBe(true);
  });

  it('falls back to the first footprint filter when the symbol has no footprint', () => {
    const src = SCH.replace('"Resistor_SMD:R_0805"', '""');
    const d = readSchematic(parse(src));
    const l = new Map(d.libSymbols.map((s) => [s.libId, s]));
    const f = netlistAllegro(d, l, meta).devices.find((x) => x.path.includes('10k'))!;
    expect(f.text).toContain("PACKAGE 'r_0805'");
    // …and that filter is no longer offered as an alternative.
    expect(f.text).toContain("PACKAGEPROP ALT_SYMBOLS '(R_0603)'");
  });

  it('keeps only the first group when two collapse to one device type', () => {
    // std::map::insert does not overwrite: the second group vanishes from
    // $PACKAGES while its device file is still written.
    const src = SCH.replace('"Reference" "C1"', '"Reference" "Q1"')
      .replace('"Value" "100n"', '"Value" "10k"')
      .replace('"Capacitor_SMD:C_0603"', '"Resistor_SMD:R_0805"');
    const d = readSchematic(parse(src));
    const l = new Map(d.libSymbols.map((s) => [s.libId, s]));
    const { netlist } = netlistAllegro(d, l, meta);
    // Q1 has a different reference prefix, so it is its own group — but the
    // same device type. Only one $PACKAGES line survives, and it is the first
    // group's: Q1 sorts before R1, so the resistors are the ones dropped.
    const packages = netlist.slice(netlist.indexOf('$PACKAGES'), netlist.indexOf('$A_PROPERTIES'));
    expect(packages.match(/! '10k_resistor_smd_r_0805'/g)).toHaveLength(1);
    expect(packages).toContain('; Q1');
    expect(packages).not.toContain('R1');
    // The dropped group is still in the ROOM list, which is built from the
    // groups directly rather than from the deduplicated map.
    expect(netlist).toContain("'ROOM' '/' ; D1,\n\tQ1,\n\tR1,\n\tR2");
  });
});

describe('the multi-file export API', () => {
  it('gives Allegro the netlist plus its devices, and others a single file', () => {
    const files = netlistFiles('allegro', 'board.txt', doc(), libs(), meta);
    expect(files[0]!.path).toBe('board.txt');
    expect(files).toHaveLength(4);
    const pads = netlistFiles('pads', 'board.asc', doc(), libs(), meta);
    expect(pads).toHaveLength(1);
    expect(pads[0]!.text.startsWith('*PADS-PCB*')).toBe(true);
  });
});
