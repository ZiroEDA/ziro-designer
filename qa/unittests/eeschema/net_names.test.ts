/**
 * How a net gets its name. Counterparts: `SCH_CONNECTION::recacheName` (which
 * drivers qualify a name with the sheet path) and `SCH_PIN::GetDefaultNetName`
 * (the auto name an otherwise-unnamed net takes).
 *
 * These are the names that reach the board through the netlist, so they have to
 * match KiCad exactly: a board KiCad wrote must survive "Update PCB from Schematic"
 * with no net re-connected.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { computeNetlist, computeHierarchyNetlist, readSchematic } from '@ziroeda/eeschema';
import type { Schematic } from '@ziroeda/eeschema';

const doc = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20230121) (generator eeschema) ${body})`));

const libsOf = (d: Schematic): Map<string, import('@ziroeda/eeschema').LibSymbol> =>
  new Map(d.libSymbols.map((l) => [l.libId, l]));

/** A 2-pin part whose pins are named, plus a power symbol and a global-power part. */
const LIB = `(lib_symbols
  (symbol "T:U" (property "Reference" "U" (at 0 0 0)) (property "Value" "U" (at 0 0 0))
    (symbol "U_1_1"
      (pin passive line (at 0 0 0) (length 0)
        (name "SDA/A4" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1)))))
      (pin no_connect line (at 0 -2.54 0) (length 0)
        (name "Pin_2" (effects (font (size 1 1)))) (number "2" (effects (font (size 1 1)))))))
  (symbol "T:R" (property "Reference" "R" (at 0 0 0)) (property "Value" "R" (at 0 0 0))
    (symbol "R_1_1"
      (pin passive line (at 0 0 0) (length 0)
        (name "~" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1)))))
      (pin passive line (at 0 -2.54 0) (length 0)
        (name "~" (effects (font (size 1 1)))) (number "2" (effects (font (size 1 1)))))))
  (symbol "T:GNDSYM" (power) (property "Reference" "#PWR" (at 0 0 0))
    (property "Value" "GND" (at 0 0 0))
    (symbol "GNDSYM_1_1"
      (pin power_in line (at 0 0 0) (length 0)
        (name "GND" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1)))))))) `;

const netNames = (d: Schematic): string[] =>
  computeNetlist(d, libsOf(d))
    .nets.map((n) => n.name)
    .sort();

describe('SCH_CONNECTION::recacheName — the sheet path prefix', () => {
  it('qualifies a local label with its sheet path', () => {
    const d = doc(`${LIB}
      (wire (pts (xy 0 0) (xy 10 0)) (uuid "w1"))
      (label "IOREF" (at 0 0 0) (uuid "l1"))`);
    const net = computeNetlist(d, libsOf(d)).nets[0]!;
    expect(net.name).toBe('/IOREF');
    // …but the driver's own name is kept for comparing against label text.
    expect(net.localName).toBe('IOREF');
  });

  it('leaves a global label and a power net unqualified', () => {
    const global = doc(`${LIB}
      (wire (pts (xy 0 0) (xy 10 0)) (uuid "w1"))
      (global_label "RESET" (at 0 0 0) (uuid "g1"))`);
    expect(netNames(global)).toEqual(['RESET']);

    const power = doc(`${LIB}
      (symbol (lib_id "T:GNDSYM") (at 0 0 0) (unit 1)
        (property "Reference" "#PWR01" (at 0 0 0)) (property "Value" "GND" (at 0 0 0))
        (uuid "g1"))`);
    expect(netNames(power)).toEqual(['GND']);
  });

  it('escapes a slash in a label, as the file already stores it', () => {
    // KiCad writes the label pre-escaped, so "SDA/A4" is "SDA{slash}A4" on disk and
    // the net name is the sheet path plus that.
    const d = doc(`${LIB}
      (wire (pts (xy 0 0) (xy 10 0)) (uuid "w1"))
      (label "SDA{slash}A4" (at 0 0 0) (uuid "l1"))`);
    expect(netNames(d)).toEqual(['/SDA{slash}A4']);
  });

  it('qualifies each sheet of a hierarchy with its own escaped path', () => {
    const child = doc(`${LIB}
      (wire (pts (xy 0 0) (xy 10 0)) (uuid "w1"))
      (label "CLK" (at 0 0 0) (uuid "l1"))`);
    const root = doc(`${LIB}
      (sheet (at 0 0) (size 10 10) (uuid "s1")
        (property "Sheetname" "Power/Rails" (at 0 0 0))
        (property "Sheetfile" "child.kicad_sch" (at 0 0 0)))`);
    const sheets = [
      { path: '/', file: 'root.kicad_sch', doc: root },
      { path: '/s1/', file: 'child.kicad_sch', doc: child },
    ];
    const { bySheet, humanPaths } = computeHierarchyNetlist(sheets, (s) => libsOf(s.doc));
    // The sheet name's '/' is escaped, so it cannot be mistaken for a separator.
    expect(humanPaths.get('/s1/')).toBe('/Power{slash}Rails/');
    expect(bySheet.get('/s1/')!.nets.map((n) => n.name)).toEqual(['/Power{slash}Rails/CLK']);
  });
});

describe('SCH_PIN::GetDefaultNetName — the auto name', () => {
  const place = (libId: string, ref: string, uuid: string): string =>
    `(symbol (lib_id "${libId}") (at 0 0 0) (unit 1)
      (property "Reference" "${ref}" (at 0 0 0)) (property "Value" "V" (at 0 0 0))
      (uuid "${uuid}"))`;

  it('uses the pad number when the pin has no name', () => {
    const d = doc(`${LIB} ${place('T:R', 'R1', 'r1')}`);
    expect(netNames(d)).toEqual(['Net-(R1-Pad1)', 'Net-(R1-Pad2)']);
  });

  it('uses the pin name when it differs from the number', () => {
    const d = doc(`${LIB} ${place('T:U', 'U1', 'u1')}`);
    // Pin 1 is named and connected-shaped: no pad suffix. Pin 2 is a no-connect
    // type, so it takes the "unconnected-" prefix and the pad number.
    expect(netNames(d)).toEqual(['Net-(U1-SDA{slash}A4)', 'unconnected-(U1-Pin_2-Pad2)']);
  });

  it('switches to "unconnected-" when the net carries a no-connect flag', () => {
    const d = doc(`${LIB} ${place('T:R', 'R1', 'r1')}
      (no_connect (at 0 0) (uuid "nc1"))`);
    expect(netNames(d)).toContain('unconnected-(R1-Pad1)');
  });

  it('names an unannotated symbol after its UUID', () => {
    const d = doc(`${LIB} ${place('T:R', 'R?', 'r-uuid-1')}`);
    expect(netNames(d)).toEqual(['Net-(r-uuid-1-Pad1)', 'Net-(r-uuid-1-Pad2)']);
  });
});
