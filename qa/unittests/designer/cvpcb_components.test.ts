// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Footprints (cvpcb) component list: the netlist view CVPCB_MAINFRAME
 * is handed, one row per symbol with the units of a multi-unit part merged,
 * power/virtual symbols left out, and the exact row texts of
 * CVPCB_MAINFRAME::formatSymbolDesc / FOOTPRINTS_LISTBOX::SetFootprints.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { makeSymbol } from '@ziroeda/eeschema/src/tools/build.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  collectCvpcbComponents,
  firstUnassignedComponent,
  formatFootprintDesc,
  formatSymbolDesc,
  nextUnassociated,
  type CvpcbComponent,
} from '@ziroeda/designer/src/editors/schematic/cvpcb_components.js';

// A dual triode (two units + a power unit), a resistor, and a power symbol.
const SHEET_A = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (property "ki_fp_filters" "R_*" (at 0 0 0))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))))
    (symbol "Valve:ECC83" (property "Reference" "U" (at 0 0 0))
      (symbol "ECC83_1_1"
        (pin input line (at 0 5 270) (length 1) (name "A") (number "1"))
        (pin input line (at 0 -5 90) (length 1) (name "K") (number "3")))
      (symbol "ECC83_2_1"
        (pin input line (at 0 5 270) (length 1) (name "A") (number "6"))
        (pin input line (at 0 -5 90) (length 1) (name "K") (number "8"))))
    (symbol "power:GND" (power) (property "Reference" "#PWR" (at 0 0 0))
      (symbol "GND_1_1" (pin power_in line (at 0 0 90) (length 0) (name "GND") (number "1")))))
  (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 0 0 0)) (property "Value" "1.5K" (at 0 0 0))
    (property "Footprint" "Resistor_THT:R_Axial_DIN0207" (at 0 0 0)))
  (symbol (lib_id "Valve:ECC83") (at 100 50 0) (unit 1) (uuid "u1a")
    (property "Reference" "U1" (at 0 0 0)) (property "Value" "ECC83" (at 0 0 0))
    (property "Footprint" "Valve:Valve_ECC-83-1" (at 0 0 0)))
  (symbol (lib_id "Valve:ECC83") (at 130 50 0) (unit 2) (uuid "u1b")
    (property "Reference" "U1" (at 0 0 0)) (property "Value" "ECC83" (at 0 0 0))
    (property "Footprint" "Valve:Valve_ECC-83-1" (at 0 0 0)))
  (symbol (lib_id "power:GND") (at 60 60 0) (unit 1) (uuid "gnd1")
    (property "Reference" "#PWR01" (at 0 0 0)) (property "Value" "GND" (at 0 0 0))))`;

// A second design in the same folder, not part of the first one's hierarchy.
const SHEET_B = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:C" (property "Reference" "C" (at 0 0 0))
      (symbol "C_1_1" (pin passive line (at 0 3 270) (length 1) (name "~") (number "1")))))
  (symbol (lib_id "Device:C") (at 20 20 0) (unit 1) (uuid "c9")
    (property "Reference" "C9" (at 0 0 0)) (property "Value" "100n" (at 0 0 0))))`;

const docs = new Map([
  ['a.kicad_sch', readSchematic(parse(SHEET_A))],
  ['b.kicad_sch', readSchematic(parse(SHEET_B))],
]);

describe('cvpcb component list', () => {
  it('merges the units of a multi-unit symbol into one row', () => {
    const comps = collectCvpcbComponents(docs, ['a.kicad_sch']);
    expect(comps.map((c) => c.reference)).toEqual(['R1', 'U1']);
    const u1 = comps.find((c) => c.reference === 'U1')!;
    expect(u1.instances).toHaveLength(2); // both units carry the assignment
    expect(u1.pinCount).toBe(4); // two pins per unit
    expect(u1.footprint).toBe('Valve:Valve_ECC-83-1');
  });

  it('drops power/virtual symbols (references starting with #)', () => {
    const comps = collectCvpcbComponents(docs, ['a.kicad_sch']);
    expect(comps.some((c) => c.reference.startsWith('#'))).toBe(false);
  });

  it('reads only the sheets of the given hierarchy', () => {
    const own = collectCvpcbComponents(docs, ['a.kicad_sch']);
    expect(own.some((c) => c.reference === 'C9')).toBe(false);
    const both = collectCvpcbComponents(docs);
    expect(both.map((c) => c.reference)).toEqual(['C9', 'R1', 'U1']);
  });

  it('carries the symbol footprint filters for the keyword filter', () => {
    const r1 = collectCvpcbComponents(docs, ['a.kicad_sch']).find((c) => c.reference === 'R1')!;
    expect(r1.fpFilters).toEqual(['R_*']);
    expect(r1.pinCount).toBe(2);
  });
});

/**
 * A7: the pin count "Filter by pin count" matches against a footprint's unique
 * pad count. `netlist_exporter_xml.cpp:1040-1060` dedupes the whole part's pins
 * by *number* and then expands stacked-pin notation; we used to key the set on
 * `unit + number`, which multiplied every pin a multi-unit part repeats.
 */
describe('symbol pin count (netlist <pins>)', () => {
  // A quad op-amp drawn the way real ones are: V+ (4) and V- (11) appear on
  // every one of the four units, and the netlist counts them once each. 14
  // distinct numbers, which is exactly the DIP-14 the part ships in.
  const QUAD = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Amplifier_Operational:LM324" (property "Reference" "U" (at 0 0 0))
      (symbol "LM324_1_1"
        (pin output line (at 0 0 0) (length 1) (name "~") (number "1"))
        (pin input line (at 0 0 0) (length 1) (name "-") (number "2"))
        (pin input line (at 0 0 0) (length 1) (name "+") (number "3"))
        (pin power_in line (at 0 0 0) (length 1) (name "V+") (number "4"))
        (pin power_in line (at 0 0 0) (length 1) (name "V-") (number "11")))
      (symbol "LM324_2_1"
        (pin output line (at 0 0 0) (length 1) (name "~") (number "7"))
        (pin input line (at 0 0 0) (length 1) (name "-") (number "6"))
        (pin input line (at 0 0 0) (length 1) (name "+") (number "5"))
        (pin power_in line (at 0 0 0) (length 1) (name "V+") (number "4"))
        (pin power_in line (at 0 0 0) (length 1) (name "V-") (number "11")))
      (symbol "LM324_3_1"
        (pin output line (at 0 0 0) (length 1) (name "~") (number "8"))
        (pin input line (at 0 0 0) (length 1) (name "-") (number "9"))
        (pin input line (at 0 0 0) (length 1) (name "+") (number "10"))
        (pin power_in line (at 0 0 0) (length 1) (name "V+") (number "4"))
        (pin power_in line (at 0 0 0) (length 1) (name "V-") (number "11")))
      (symbol "LM324_4_1"
        (pin output line (at 0 0 0) (length 1) (name "~") (number "14"))
        (pin input line (at 0 0 0) (length 1) (name "-") (number "13"))
        (pin input line (at 0 0 0) (length 1) (name "+") (number "12"))
        (pin power_in line (at 0 0 0) (length 1) (name "V+") (number "4"))
        (pin power_in line (at 0 0 0) (length 1) (name "V-") (number "11"))))
    (symbol "Logic:74LS00" (property "Reference" "U" (at 0 0 0))
      (symbol "74LS00_1_1"
        (pin input line (at 0 0 0) (length 1) (name "A") (number "1"))
        (pin input line (at 0 0 0) (length 1) (name "B") (number "2"))
        (pin output line (at 0 0 0) (length 1) (name "Y") (number "3")))
      (symbol "74LS00_1_2"
        (pin input line (at 0 0 0) (length 1) (name "A") (number "1"))
        (pin input line (at 0 0 0) (length 1) (name "B") (number "2"))
        (pin output line (at 0 0 0) (length 1) (name "Y") (number "3"))))
    (symbol "Connector:Shield" (property "Reference" "J" (at 0 0 0))
      (symbol "Shield_1_1"
        (pin passive line (at 0 0 0) (length 1) (name "S") (number "[1-4]"))
        (pin passive line (at 0 0 0) (length 1) (name "T") (number "[MP1,MP2]"))
        (pin passive line (at 0 0 0) (length 1) (name "U") (number "5")))))
  (symbol (lib_id "Amplifier_Operational:LM324") (at 10 10 0) (unit 1) (uuid "u1a")
    (property "Reference" "U1" (at 0 0 0)) (property "Value" "LM324" (at 0 0 0)))
  (symbol (lib_id "Amplifier_Operational:LM324") (at 30 10 0) (unit 2) (uuid "u1b")
    (property "Reference" "U1" (at 0 0 0)) (property "Value" "LM324" (at 0 0 0)))
  (symbol (lib_id "Amplifier_Operational:LM324") (at 50 10 0) (unit 3) (uuid "u1c")
    (property "Reference" "U1" (at 0 0 0)) (property "Value" "LM324" (at 0 0 0)))
  (symbol (lib_id "Amplifier_Operational:LM324") (at 70 10 0) (unit 4) (uuid "u1d")
    (property "Reference" "U1" (at 0 0 0)) (property "Value" "LM324" (at 0 0 0)))
  (symbol (lib_id "Logic:74LS00") (at 10 40 0) (unit 1) (uuid "u2a")
    (property "Reference" "U2" (at 0 0 0)) (property "Value" "74LS00" (at 0 0 0)))
  (symbol (lib_id "Connector:Shield") (at 10 70 0) (unit 1) (uuid "j1")
    (property "Reference" "J1" (at 0 0 0)) (property "Value" "Shield" (at 0 0 0))))`;

  const quad = new Map([['q.kicad_sch', readSchematic(parse(QUAD))]]);
  const byRef = (ref: string): number =>
    collectCvpcbComponents(quad, ['q.kicad_sch']).find((c) => c.reference === ref)!.pinCount;

  it('counts a pin shared between units once, not once per unit', () => {
    // 4 units x 5 drawn pins = 20 pin items, but only 14 distinct numbers:
    // V+ (4) and V- (11) are drawn on all four units. Keying the set on
    // `unit + number` gave 20 and no 20-pad footprint exists, so the filter
    // silently matched nothing.
    expect(byRef('U1')).toBe(14);
  });

  it('counts a De Morgan body style once as well', () => {
    // 74LS00_1_2 repeats 1/2/3 with different shapes; upstream's comment names
    // this as the other reason a pin appears twice in GetGraphicalPins(0,0).
    expect(byRef('U2')).toBe(3);
  });

  it('expands stacked-pin notation into individual pins', () => {
    // "[1-4]" is four pads, "[MP1,MP2]" is two, "5" is one: 7 <pin> nodes.
    expect(byRef('J1')).toBe(7);
  });
});

describe('cvpcb row formats', () => {
  it('formatSymbolDesc lays the columns out like KiCad', () => {
    // "%3d " + reference right-aligned in 8 + " - " + value right-aligned in
    // 16 + " : " + footprint.
    expect(formatSymbolDesc(1, 'C1', '10uF', 'Capacitor_THT:CP_Radial_D10.0mm_P5.0mm')).toBe(
      '  1       C1 -             10uF : Capacitor_THT:CP_Radial_D10.0mm_P5.0mm',
    );
    expect(formatSymbolDesc(15, 'U1', 'ECC83', 'Footprints:Valve_ECC-83-1')).toBe(
      ' 15       U1 -            ECC83 : Footprints:Valve_ECC-83-1',
    );
  });

  it('formatFootprintDesc numbers the footprint list', () => {
    expect(formatFootprintDesc(1, 'Audio_Module:Reverb_BTDR-1H')).toBe(
      '  1 Audio_Module:Reverb_BTDR-1H',
    );
  });
});

/**
 * `CVPCB_CONTROL::ToNA`, the next/previous unassociated component.
 *
 * Recorded on #88 as a divergence rather than a bug: ours wrapped, upstream
 * stops. Settled in favour of upstream — the point of this app is to be the
 * application, and a wrap silently returns you to the top of a board you
 * thought you had finished.
 */
describe('walking to the next unassociated component', () => {
  // Four components; 0 and 2 are assigned, 1 and 3 are not.
  const assigned = (i: number): boolean => i === 0 || i === 2;

  it('goes forward to the next one that has no footprint', () => {
    expect(nextUnassociated(4, 0, 1, assigned)).toBe(1);
    expect(nextUnassociated(4, 1, 1, assigned)).toBe(3);
  });

  it('goes backward the same way', () => {
    expect(nextUnassociated(4, 3, -1, assigned)).toBe(1);
  });

  it('stops at the end rather than wrapping', () => {
    // `changeSel` stays false, so the selection holds and the button is dead.
    // This is the whole decision: ours used to return 1 here.
    expect(nextUnassociated(4, 3, 1, assigned)).toBe(null);
  });

  it('and stops at the start rather than wrapping', () => {
    expect(nextUnassociated(4, 1, -1, assigned)).toBe(null);
  });

  it('does nothing when every component is assigned', () => {
    // `if( naComp.empty() ) return 0;`
    expect(nextUnassociated(4, 0, 1, () => true)).toBe(null);
    expect(nextUnassociated(4, 3, -1, () => true)).toBe(null);
  });

  it('skips over assigned ones rather than stepping by one', () => {
    // 0 assigned, 1..3 assigned, 4 not: forward from 0 lands on 4, not 1.
    const onlyLast = (i: number): boolean => i !== 4;
    expect(nextUnassociated(5, 0, 1, onlyLast)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// B1: the row the window opens on (readwrite_dlgs.cpp:255-274)
// ---------------------------------------------------------------------------

describe('firstUnassignedComponent', () => {
  const comp = (reference: string, footprint = ''): CvpcbComponent => ({
    reference,
    value: '',
    footprint,
    fpFilters: [],
    pinCount: 0,
    instances: [],
  });

  it('is the first symbol with no footprint, not row 0', () => {
    // The whole point: the window lands on the job you opened it to do.
    const sheet = [comp('C1', 'Capacitor_SMD:C_0805'), comp('C2'), comp('R1')];
    expect(firstUnassignedComponent(sheet)).toBe(1);
  });

  it('is the FIRST such symbol, not the last', () => {
    const sheet = [comp('C1'), comp('C2'), comp('R1')];
    expect(firstUnassignedComponent(sheet)).toBe(0);
  });

  it('is -1 when every symbol already has a footprint', () => {
    // `if( firstUnassigned >= 0 )` fails, so SetSelection never runs and the
    // real window opens with no row highlighted at all. Ours selected row 0
    // regardless, which also dragged the footprint pane onto C1's footprint.
    const done = [comp('C1', 'Capacitor_SMD:C_0805'), comp('R1', 'Resistor_SMD:R_0805')];
    expect(firstUnassignedComponent(done)).toBe(-1);
  });

  it('is -1 for an empty netlist', () => {
    expect(firstUnassignedComponent([])).toBe(-1);
  });
});

/**
 * The bug Akshay reported: a diode placed from the library showed
 * `D1 - 1N4001 :` with nothing after the colon in Assign Footprints, while the
 * same part in KiCad reads
 * `1N4007 : Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal`.
 *
 * Nothing was wrong in cvpcb. `collectCvpcbComponents` has always read
 * `fieldOf( sym, 'Footprint' )`, which is what CVPCB is handed by the netlist
 * (`netlist_exporter_xml.cpp` emits the symbol's Footprint field). The placed
 * symbol simply had no such field: `makeSymbol` created Reference and Value and
 * stopped, where `SCH_SYMBOL`'s library constructor ends in
 * `UpdateFields( aSheet, true, … )` (sch_symbol.cpp:97-101) and copies EVERY
 * field the library defines — Footprint included, hidden, at the library's own
 * offset. Stock `Diode:1N4007` ships `(property "Footprint"
 * "Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal")`, so in KiCad the assignment
 * is there before CvPcb ever opens.
 *
 * This is the two halves joined up, which neither half's own tests cover:
 * `placed_symbol_library_fields.test.ts` pins that makeSymbol makes the field,
 * and the block above pins that cvpcb reads one. Only this pins that a symbol
 * placed from a library that names a footprint ARRIVES in this window carrying
 * it — the sentence the report is about.
 */
describe('a symbol placed from a library that names a footprint', () => {
  // A diode library symbol shaped like the stock one: the Footprint property
  // is on the LIBRARY part, hidden, and nothing in the placement flow types it.
  const DIODE_SHEET = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
    (lib_symbols
      (symbol "Diode:1N4007" (property "Reference" "D" (at 0 0 0))
        (property "Value" "1N4007" (at 0 0 0))
        (property "Footprint" "Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal" (at 0 -3.81 0))
        (property "Datasheet" "" (at 0 0 0))
        (property "Description" "" (at 0 0 0))
        (property "ki_fp_filters" "D*DO?41*" (at 0 0 0))
        (symbol "1N4007_0_1"
          (pin passive line (at -3.81 0 0) (length 1.27) (name "K") (number "1"))
          (pin passive line (at 3.81 0 180) (length 1.27) (name "A") (number "2"))))))`;

  const sheet = readSchematic(parse(DIODE_SHEET));
  const lib = sheet.libSymbols[0]!;
  // Exactly what the place tool does with the part the chooser handed it.
  const placed = makeSymbol(lib, { x: mmToIU(100), y: mmToIU(100) });
  const withRef = {
    ...placed,
    fields: placed.fields.map((f) => (f.key === 'Reference' ? { ...f, value: 'D1' } : f)),
  };
  const docs = new Map([['d.kicad_sch', { ...sheet, symbols: [withRef] }]]);

  it('reaches the assignment list with the library’s footprint already set', () => {
    const comps = collectCvpcbComponents(docs, ['d.kicad_sch']);
    expect(comps).toHaveLength(1);
    expect(comps[0]!.footprint).toBe('Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal');
  });

  it('shows it after the colon in the row, not an empty tail', () => {
    const c = collectCvpcbComponents(docs, ['d.kicad_sch'])[0]!;
    // The whole row, so a footprint that arrived in the wrong column fails too.
    expect(formatSymbolDesc(1, c.reference, c.value, c.footprint)).toBe(
      '  1       D1 -           1N4007 : Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal',
    );
    expect(formatSymbolDesc(1, c.reference, c.value, c.footprint)).not.toMatch(/: *$/);
  });

  it('is therefore not the row the window opens on', () => {
    // readwrite_dlgs.cpp:260-282 — the window lands on the first symbol with no
    // footprint, and selects nothing when there is none. An already-assigned
    // diode must not be counted as work outstanding.
    expect(firstUnassignedComponent(collectCvpcbComponents(docs, ['d.kicad_sch']))).toBe(-1);
  });
});
