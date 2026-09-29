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
import { loadProjectSchematic } from '@ziroeda/eeschema/cross-probing.js';
import {
  CompareSymbolRef,
  extractTailNumber,
  formatDevice,
  formatPin,
  formatText,
  removeTailDigits,
} from '@ziroeda/eeschema/netlist_exporters/netlist_exporter_allegro.js';
import {
  WriteNetListText,
  type NetlistFormat,
} from '@ziroeda/eeschema/netlist_exporters/netlist_generator.js';
import type { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';

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
  (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1) (uuid "aaaaaaaa-0000-4000-8000-000000000001")
    (property "Reference" "R1" (at 53 50 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 53 52 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0805" (at 50.8 50.8 0)
      (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "Device:R") (at 50.8 63.5 0) (unit 1) (uuid "aaaaaaaa-0000-4000-8000-000000000002")
    (property "Reference" "R2" (at 53 63 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 53 65 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0805" (at 50.8 63.5 0)
      (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "Device:C") (at 76.2 50.8 0) (unit 1) (uuid "aaaaaaaa-0000-4000-8000-000000000003")
    (property "Reference" "C1" (at 78 50 0) (effects (font (size 1.27 1.27))))
    (property "Value" "100n" (at 78 52 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Capacitor_SMD:C_0603" (at 76.2 50.8 0)
      (effects (font (size 1.27 1.27)) (hide yes))))
  (symbol (lib_id "Device:D") (at 101.6 50.8 0) (unit 1) (uuid "aaaaaaaa-0000-4000-8000-000000000004")
    (property "Reference" "D1" (at 104 50 0) (effects (font (size 1.27 1.27))))
    (property "Value" "1N4148" (at 104 52 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Diode_SMD:D_SOD-123" (at 101.6 50.8 0)
      (effects (font (size 1.27 1.27)) (hide yes))))
  (wire (pts (xy 50.8 46.99) (xy 76.2 46.99)) (uuid "aaaaaaaa-0000-4000-8000-000000000005")))`;

/** Load `aText` as a one-sheet project and export it in `aFormat`, every file. */
function exportFiles(aFormat: NetlistFormat, aText: string, aFileName = 'test.txt') {
  const schematic = loadProjectSchematic(
    [{ name: 'test.kicad_sch', text: aText }],
    'test.kicad_sch',
  );
  if (!schematic) throw new Error('test.kicad_sch did not load');
  return WriteNetListText(aFormat, schematic, aFileName);
}

const exportAllegro = (aText: string) => {
  const [netlist, ...devices] = exportFiles('allegro', aText);
  return { netlist: netlist!.text, devices };
};
const run = () => exportAllegro(SCH);

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
    expect(CompareSymbolRef('R9', 'R10')).toBe(true);
    expect(CompareSymbolRef('R10', 'R9')).toBe(false);
    // Different prefix: plain string order, not natural order.
    expect(CompareSymbolRef('C1', 'R1')).toBe(true);
    expect(CompareSymbolRef('R1', 'C1')).toBe(false);
  });
});

describe('the sanitising rules', () => {
  it('quotes only what needs quoting, and folds the micro sign', () => {
    expect(formatText('NET1')).toBe('NET1');
    expect(formatText('a/b_C')).toBe('a/b_C');
    expect(formatText('10 uF')).toBe("'10 uF'");
    expect(formatText('4µ7')).toBe('4u7');
    // Byte-wise, as upstream's std::regex over the UTF-8 string is: 'é' is two
    // bytes and becomes two '?', not one.
    expect(formatText('caf\u00e9')).toBe("'caf??'");
    // ! and ' are themselves replaced, which then forces the quoting.
    expect(formatText("do!n't")).toBe("'do?n?t'");
    expect(formatText('')).toBe('');
  });

  it('lower-cases and underscores a device type', () => {
    expect(formatDevice('10k_R_0805')).toBe('10k_r_0805');
    // "µ" survives MakeLower and is two UTF-8 bytes, so it contributes two
    // underscores — three in total with the space.
    expect(formatDevice('4.7 µF')).toBe('4_7___f');
  });

  it('builds the Telesis pin name as name__number', () => {
    const pin = (name: string, number: string) =>
      ({ GetName: () => name, GetNumber: () => number }) as unknown as SCH_PIN;
    expect(formatPin(pin('A0', '3'))).toBe('A0__3');
    expect(formatPin(pin('~', '1'))).toBe('?__1');
  });
});

describe('the netlist file', () => {
  it('opens with the header and closes with $END', () => {
    const { netlist } = run();
    // SCHEMATIC::GetFileName(): the project folder ("/" with none open) and the file.
    expect(netlist.startsWith('(NETLIST)\n(Source: /test.kicad_sch)\n')).toBe(true);
    expect(netlist).toMatch(/\n\(Date: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\)\n/);
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
    // 10.0.6's formatRoom names the root's room after the root file, "test" - what
    // kicad-cli writes for this schematic (10.0.5 wrote the path, '/').
    expect(netlist).toContain("'ROOM' 'test' ; C1,\n\tD1,\n\tR1,\n\tR2");
  });

  it('writes the net with its nodes, upper-cased', () => {
    const { netlist } = run();
    const nets = netlist.slice(netlist.indexOf('$NETS'));
    // R1 pin 1 and C1 pin 1 share the wire; R2 sits on its own.
    expect(nets).toContain("'NET-(C1-PAD1)'; C1.1,\n\tR1.1");
    // An auto-named net is quoted because of its parentheses and hyphens.
    // R2 pin 1 alone on its net: unconnected-(R2-Pad1) (connection_graph.cpp:2650),
    // upper-cased like every Allegro net.
    expect(nets).toContain("'UNCONNECTED-(R2-PAD1)'; R2.1");
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
    // A "~" pin name is read as no name at all, so the Telesis name is "__<number>" -
    // kicad-cli's device file for this schematic.
    expect(r.text).toContain('PINORDER MAIN ,\n\t__1,\n\t__2');
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
    const { netlist, devices } = exportAllegro(src);
    expect(netlist).toContain("! '10k' ! '10k' ;");
    expect(devices.some((f) => f.path === 'devices/10k.txt')).toBe(true);
  });

  it('falls back to the first footprint filter when the symbol has no footprint', () => {
    const src = SCH.replace('"Resistor_SMD:R_0805"', '""');
    const f = exportAllegro(src).devices.find((x) => x.path.includes('10k'))!;
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
    const { netlist } = exportAllegro(src);
    // Q1 has a different reference prefix, so it is its own group — but the
    // same device type. Only one $PACKAGES line survives, and it is the first
    // group's: Q1 sorts before R1, so the resistors are the ones dropped.
    const packages = netlist.slice(netlist.indexOf('$PACKAGES'), netlist.indexOf('$A_PROPERTIES'));
    expect(packages.match(/! '10k_resistor_smd_r_0805'/g)).toHaveLength(1);
    expect(packages).toContain('; Q1');
    expect(packages).not.toContain('R1');
    // The dropped group is still in the ROOM list, which is built from the
    // groups directly rather than from the deduplicated map.
    expect(netlist).toContain("'ROOM' 'test' ; D1,\n\tQ1,\n\tR1,\n\tR2");
  });
});

describe('the multi-file export API', () => {
  it('gives Allegro the netlist plus its devices, and others a single file', () => {
    const files = exportFiles('allegro', SCH, 'board.txt');
    expect(files[0]!.path).toBe('board.txt');
    expect(files).toHaveLength(4);
    const pads = exportFiles('pads', SCH, 'board.asc');
    expect(pads).toHaveLength(1);
    expect(pads[0]!.text.startsWith('*PADS-PCB*')).toBe(true);
  });
});
