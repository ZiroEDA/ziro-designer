/**
 * Assign Footprints (cvpcb) component list: the netlist view CVPCB_MAINFRAME
 * is handed, one row per symbol with the units of a multi-unit part merged,
 * power/virtual symbols left out, and the exact row texts of
 * CVPCB_MAINFRAME::formatSymbolDesc / FOOTPRINTS_LISTBOX::SetFootprints.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  collectCvpcbComponents,
  formatFootprintDesc,
  formatSymbolDesc,
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
