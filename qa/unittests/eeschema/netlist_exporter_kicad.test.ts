/**
 * The KiCad (s-expression) netlist NETLIST_EXPORTER_KICAD writes and pcbnew reads —
 * the schematic half of "Update PCB from Schematic". The round trip through
 * loadKicadNetlist is the real assertion: whatever the exporter emits, the board's
 * parser has to see the same components, pads and nets.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, netlistKicad, type NetlistSheet } from '@ziroeda/eeschema';
import { loadKicadNetlist } from '@ziroeda/pcbnew';

/** A 2-pin resistor and a 2-pin capacitor, both with named pins. */
const LIB = `(symbol "Device:R" (pin_names (offset 0))
    (property "Reference" "R" (at 0 0 0))
    (property "Value" "R" (at 0 0 0))
    (property "Footprint" "" (at 0 0 0))
    (property "ki_keywords" "R res resistor" (at 0 0 0))
    (property "ki_fp_filters" "R_*" (at 0 0 0))
    (symbol "R_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27) (name "~" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1)))))
      (pin passive line (at 0 -3.81 90) (length 1.27) (name "~" (effects (font (size 1 1)))) (number "2" (effects (font (size 1 1)))))))
  (symbol "Device:C" (pin_names (offset 0))
    (property "Reference" "C" (at 0 0 0))
    (property "Value" "C" (at 0 0 0))
    (property "Footprint" "" (at 0 0 0))
    (symbol "C_1_1"
      (pin passive line (at 0 3.81 270) (length 2.54) (name "A" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1)))))
      (pin passive line (at 0 -3.81 90) (length 2.54) (name "K" (effects (font (size 1 1)))) (number "2" (effects (font (size 1 1)))))))`;

const resistor = (ref: string, x: number, y: number, uuid: string): string =>
  `(symbol (lib_id "Device:R") (at ${x} ${y} 0) (unit 1)
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "10k" (at ${x} ${y} 0))
    (property "Footprint" "Resistor_SMD:R_0805" (at ${x} ${y} 0))
    (property "MPN" "RES-10K" (at ${x} ${y} 0))
    (uuid "${uuid}"))`;

const capacitor = (ref: string, x: number, y: number, uuid: string): string =>
  `(symbol (lib_id "Device:C") (at ${x} ${y} 0) (unit 1)
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "100nF" (at ${x} ${y} 0))
    (property "Footprint" "Capacitor_SMD:C_0805" (at ${x} ${y} 0))
    (uuid "${uuid}"))`;

// R1 pin 2 sits at y=103.81 and R2 pin 1 at y=106.19; a wire between exactly those
// points joins them, and a local label at the wire's end names the result. (A label
// in the middle of a single wire does not attach — upstream only enforces that when
// two or more lines overlap the label position, see updateItemConnectivity.)
const doc = readSchematic(
  parse(`(kicad_sch (version 20230121) (generator eeschema)
    (uuid "00000000-0000-4000-8000-00000000root")
    (lib_symbols ${LIB})
    ${resistor('R1', 100, 100, 'aaaaaaaa-0000-4000-8000-000000000001')}
    ${resistor('R2', 100, 110, 'aaaaaaaa-0000-4000-8000-000000000002')}
    ${capacitor('C1', 120, 110, 'aaaaaaaa-0000-4000-8000-000000000003')}
    (wire (pts (xy 100 103.81) (xy 100 106.19)) (uuid "w1"))
    (label "VOUT" (at 100 103.81 0) (uuid "l1"))
    (title_block (title "Divider") (rev "A") (comment 1 "first")))`),
);

const SHEETS: NetlistSheet[] = [{ path: '/', namePath: '/', file: 'divider.kicad_sch', doc }];

const netlistText = netlistKicad({
  sheets: SHEETS,
  libsFor: (s) => new Map(s.doc.libSymbols.map((l) => [l.libId, l])),
  source: 'divider.kicad_sch',
  date: '2026-07-25T00:00:00.000Z',
  netClassFor: () => 'Default',
});

describe('netlistKicad', () => {
  it('emits the export root and the design header', () => {
    // The formatter pretty-prints, so match tokens rather than whole lines.
    expect(netlistText.startsWith('(export')).toBe(true);
    expect(netlistText).toContain('(version "E")');
    expect(netlistText).toContain('(source "divider.kicad_sch")');
    expect(netlistText).toContain('(date "2026-07-25T00:00:00.000Z")');
    expect(netlistText).toContain('(tool "Eeschema")');
    expect(netlistText).toContain('(title "Divider")');
    expect(netlistText).toContain('(rev "A")');
    expect(netlistText).toContain('(value "first")');
  });

  it("emits every section pcbnew's parser looks for, in order", () => {
    const order = ['(design', '(components', '(groups', '(libparts', '(libraries', '(nets'].map(
      (section) => netlistText.indexOf(section),
    );
    for (const index of order) expect(index).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('carries the library part, its filters and its pins', () => {
    // The output is pretty-printed, so assert on the tokens rather than one line.
    expect(netlistText).toContain('(libpart');
    expect(netlistText).toContain('(part "R")');
    expect(netlistText).toContain('(fp "R_*")');
    expect(netlistText).toContain('(library');
    expect(netlistText).toContain('(logical "Device")');
    // An unnamed pin ("~") is emitted with an empty name.
    expect(netlistText).toContain('(name "")');
    expect(netlistText).toContain('(name "K")');
  });
});

describe('netlistKicad -> loadKicadNetlist', () => {
  const netlist = loadKicadNetlist(netlistText);

  it('round-trips every board-bound symbol, in reference order', () => {
    expect(netlist.GetCount()).toBe(3);
    expect([0, 1, 2].map((i) => netlist.GetComponent(i)!.GetReference())).toEqual([
      'C1',
      'R1',
      'R2',
    ]);
  });

  it('round-trips footprint, value, library source and symbol UUID', () => {
    const r1 = netlist.GetComponentByReference('R1')!;
    expect(r1.GetFPID()).toBe('Resistor_SMD:R_0805');
    expect(r1.GetValue()).toBe('10k');
    expect(r1.GetLibrary()).toBe('Device');
    expect(r1.GetName()).toBe('R');
    expect(r1.kiids).toEqual(['aaaaaaaa-0000-4000-8000-000000000001']);
    expect(r1.path).toBe('/');
  });

  it('round-trips user fields and the ki_ properties', () => {
    const r1 = netlist.GetComponentByReference('R1')!;
    expect(r1.GetFields().get('MPN')).toBe('RES-10K');
    expect(r1.GetProperties().get('MPN')).toBe('RES-10K');
    expect(r1.GetProperties().get('ki_fp_filters')).toBe('R_*');
    expect(r1.GetProperties().get('ki_keywords')).toBe('R res resistor');
  });

  it('puts the labelled net on both pins that share the wire', () => {
    const r1 = netlist.GetComponentByReference('R1')!;
    const r2 = netlist.GetComponentByReference('R2')!;
    // A local label names a sheet-local net, so the name carries the sheet path.
    expect(r1.GetNet('2').netName).toBe('/VOUT');
    expect(r2.GetNet('1').netName).toBe('/VOUT');
    expect(r1.GetNet('2').pinType).toBe('passive');
  });

  it('names the pin function after the pin, suffixed with the pad number', () => {
    const c1 = netlist.GetComponentByReference('C1')!;
    // C1's pins are named A and K, so pinfunction is "<name>_<pad>".
    expect(c1.GetNet('2').pinFunction).toBe('K_2');
    // R's pins are unnamed, so no pin function is emitted at all.
    expect(netlist.GetComponentByReference('R1')!.GetNet('2').pinFunction).toBe('');
  });

  it('gives an unconnected pin its own auto-named net', () => {
    const r1 = netlist.GetComponentByReference('R1')!;
    // R1 pin 1 is dangling: the connection graph auto-names it Net-(R1-Pad1).
    expect(r1.GetNet('1').netName).toBe('Net-(R1-Pad1)');
  });

  it('leaves a symbol excluded from the board out of the netlist', () => {
    const offBoard = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${LIB})
        ${resistor('R1', 100, 100, 'aaaaaaaa-0000-4000-8000-000000000001').replace(
          '(uuid "aaaaaaaa-0000-4000-8000-000000000001"))',
          '(on_board no) (uuid "aaaaaaaa-0000-4000-8000-000000000001"))',
        )}
        ${resistor('R2', 100, 110, 'aaaaaaaa-0000-4000-8000-000000000002')})`),
    );
    const text = netlistKicad({
      sheets: [{ path: '/', namePath: '/', file: 'off.kicad_sch', doc: offBoard }],
      libsFor: (s) => new Map(s.doc.libSymbols.map((l) => [l.libId, l])),
      source: 'off.kicad_sch',
    });
    const parsed = loadKicadNetlist(text);
    expect(parsed.GetCount()).toBe(1);
    expect(parsed.GetComponent(0)!.GetReference()).toBe('R2');
  });

  it('marks a DNP symbol with the dnp property', () => {
    const dnpDoc = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${LIB})
        ${resistor('R1', 100, 100, 'aaaaaaaa-0000-4000-8000-000000000001').replace(
          '(uuid "aaaaaaaa-0000-4000-8000-000000000001"))',
          '(dnp yes) (in_bom no) (uuid "aaaaaaaa-0000-4000-8000-000000000001"))',
        )})`),
    );
    const parsed = loadKicadNetlist(
      netlistKicad({
        sheets: [{ path: '/', namePath: '/', file: 'dnp.kicad_sch', doc: dnpDoc }],
        libsFor: (s) => new Map(s.doc.libSymbols.map((l) => [l.libId, l])),
        source: 'dnp.kicad_sch',
      }),
    );
    const r1 = parsed.GetComponentByReference('R1')!;
    expect(r1.GetProperties().has('dnp')).toBe(true);
    expect(r1.GetProperties().has('exclude_from_bom')).toBe(true);
  });
});
