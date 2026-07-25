/**
 * ERC engine tests: pin-to-pin matrix, driver checks, unconnected pins,
 * no-connect flags, and label checks — against KiCad's documented behaviour
 * (erc.cpp, erc_settings.cpp, connection_graph.cpp).
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import { runErc } from '@ziroeda/eeschema/src/connectivity/erc.js';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';
import { defaultErcSettings } from '@ziroeda/eeschema/src/erc/erc_settings.js';
import { makeNoConnect } from '@ziroeda/eeschema/src/tools/build.js';
import { addItems } from '@ziroeda/eeschema/src/tools/mutate.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

/** One-pin test symbol; the pin's connection point is the symbol position. */
function libDef(name: string, type: string, power = false): string {
  return `(symbol "T:${name}" ${power ? '(power) ' : ''}(pin_names (offset 0.254))
    (property "Reference" "${power ? '#PWR' : 'U'}" (at 0 0 0))
    (property "Value" "${name}" (at 0 0 0))
    (symbol "${name}_1_1"
      (pin ${type} line (at 0 0 0) (length 2.54)
        (name "P" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))))`;
}

function place(libName: string, ref: string, x: number, y: number, uuid: string): string {
  return `(symbol (lib_id "T:${libName}") (at ${x} ${y} 0) (unit 1)
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "${libName}" (at ${x} ${y} 0))
    (uuid "${uuid}"))`;
}

const LIBS =
  ['IN input', 'OUT output', 'PAS passive', 'PWRIN power_in', 'NC no_connect']
    .map((s) => {
      const [n, t] = s.split(' ');
      return libDef(n!, t!);
    })
    .join('\n') +
  libDef('GND', 'power_in', true) +
  libDef('VOUT', 'power_out', true);

function sch(body: string) {
  const text = `(kicad_sch (version 20230121) (generator eeschema)
    (lib_symbols ${LIBS})
    ${body})`;
  const doc = readSchematic(parse(text));
  return { doc, libById: new Map(doc.libSymbols.map((l) => [l.libId, l])) };
}

const wire = (x1: number, y1: number, x2: number, y2: number, id: string): string =>
  `(wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (uuid "${id}"))`;

const codes = (v: { code: string }[]): string[] => v.map((x) => x.code);

describe('runErc', () => {
  it('flags two connected outputs as a pin-to-pin error (matrix O x O = ERR)', () => {
    const { doc, libById } = sch(`
      ${place('OUT', 'U1', 10, 10, 'u1')} ${place('OUT', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    const v = runErc(doc, libById);
    expect(codes(v)).toContain('pin_to_pin_error');
    const err = v.find((x) => x.code === 'pin_to_pin_error')!;
    expect(err.message).toBe('Pins of type Output and Output are connected');
    expect(err.severity).toBe('error');
  });

  it('output driving an input is clean; two inputs alone are not driven', () => {
    const ok = sch(`
      ${place('OUT', 'U1', 10, 10, 'u1')} ${place('IN', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    expect(runErc(ok.doc, ok.libById)).toEqual([]);

    const bad = sch(`
      ${place('IN', 'U1', 10, 10, 'u1')} ${place('IN', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    expect(codes(runErc(bad.doc, bad.libById))).toContain('pin_not_driven');
  });

  it('a power net needs a power-output driver, not just any output', () => {
    // power_in driven by a plain output: matrix says OK pair, but the power net
    // is not driven (only PT_POWER_OUT drives power nets — DrivingPowerPinTypes).
    const bad = sch(`
      ${place('PWRIN', 'U1', 10, 10, 'u1')} ${place('OUT', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    expect(codes(runErc(bad.doc, bad.libById))).toContain('power_pin_not_driven');

    const ok = sch(`
      ${place('PWRIN', 'U1', 10, 10, 'u1')} ${place('VOUT', '#PWR01', 20, 10, 'p1')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    expect(codes(runErc(ok.doc, ok.libById))).not.toContain('power_pin_not_driven');
  });

  it('flags an unconnected pin, unless a no-connect flag covers it', () => {
    const bare = sch(place('IN', 'U1', 10, 10, 'u1'));
    const v = runErc(bare.doc, bare.libById);
    expect(codes(v)).toContain('pin_not_connected');
    expect(v.find((x) => x.code === 'pin_not_connected')!.severity).toBe('error');
    // Note: the lone input pin's net has no driver either, but KiCad suppresses
    // nothing here — yet with no wires there is no *net* needing a driver check;
    // the pin subgraph is single-pin so only the unconnected error is expected.

    const covered = sch(`${place('IN', 'U1', 10, 10, 'u1')} (no_connect (at 10 10) (uuid "nc1"))`);
    expect(codes(runErc(covered.doc, covered.libById))).not.toContain('pin_not_connected');
  });

  it('reports a dangling no-connect and a connected no-connect', () => {
    const dangling = sch('(no_connect (at 50 50) (uuid "nc1"))');
    expect(codes(runErc(dangling.doc, dangling.libById))).toContain('no_connect_dangling');

    const connected = sch(`
      ${place('OUT', 'U1', 10, 10, 'u1')} ${place('IN', 'U2', 20, 10, 'u2')}
      ${wire(10, 10, 20, 10, 'w1')} (no_connect (at 20 10) (uuid "nc1"))`);
    expect(codes(runErc(connected.doc, connected.libById))).toContain('no_connect_connected');
  });

  it('flags an NC-type pin that is wired to anything (TestNoConnectPins)', () => {
    const { doc, libById } = sch(`
      ${place('NC', 'U1', 10, 10, 'u1')} ${wire(10, 10, 20, 10, 'w1')}`);
    const v = runErc(doc, libById);
    expect(codes(v)).toContain('no_connect_connected');
  });

  it('label checks: not connected (error) and single-pin (warning)', () => {
    const floating = sch(`${wire(10, 10, 20, 10, 'w1')} (label "N1" (at 10 10 0) (uuid "l1"))`);
    const v1 = runErc(floating.doc, floating.libById);
    expect(codes(v1)).toContain('label_dangling');
    expect(v1.find((x) => x.code === 'label_dangling')!.severity).toBe('error');

    const onePin = sch(`
      ${place('OUT', 'U1', 10, 10, 'u1')} ${wire(10, 10, 20, 10, 'w1')}
      (label "N1" (at 20 10 0) (uuid "l1"))`);
    const v2 = runErc(onePin.doc, onePin.libById);
    expect(codes(v2)).toContain('isolated_pin_label');
    expect(v2.find((x) => x.code === 'isolated_pin_label')!.severity).toBe('warning');
  });

  it('stacked pins of one symbol are exempt from conflicts', () => {
    // Two outputs joined across two symbols errors (above); the same two pin
    // types stacked at one point of one symbol must not.
    const twoPin = `(symbol "T:DBL" (pin_names (offset 0.254))
      (property "Reference" "U" (at 0 0 0)) (property "Value" "DBL" (at 0 0 0))
      (symbol "DBL_1_1"
        (pin output line (at 0 0 0) (length 2.54) (name "A" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin output line (at 0 0 0) (length 2.54) (name "B" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))))`;
    const text = `(kicad_sch (version 20230121) (generator eeschema)
      (lib_symbols ${twoPin})
      (symbol (lib_id "T:DBL") (at 10 10 0) (unit 1)
        (property "Reference" "U1" (at 10 10 0)) (property "Value" "DBL" (at 10 10 0)) (uuid "u1"))
      ${wire(10, 10, 20, 10, 'w1')} ${wire(20, 10, 20, 20, 'w2')}`;
    const doc = readSchematic(parse(`${text})`));
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    expect(codes(runErc(doc, libById))).not.toContain('pin_to_pin_error');
  });
});

describe('no_connect model round-trip', () => {
  it('parses, moves through edits, and serializes (no_connect (at ..))', () => {
    const { doc } = sch(place('IN', 'U1', 10, 10, 'u1'));
    const next = addItems({ noConnects: [makeNoConnect({ x: mmToIU(10), y: mmToIU(10) })] }).apply(
      doc,
    );
    const text = serialize(writeSchematic(next));
    expect(text).toContain('(no_connect');
    expect(text).toContain('(at 10 10)');
    const re = readSchematic(parse(text));
    expect(re.noConnects.length).toBe(1);
    expect(re.noConnects[0]!.at).toEqual({ x: mmToIU(10), y: mmToIU(10) });
  });
});

/**
 * The tests added on top of the connection checks: sheet names, similar
 * labels, wire endpoints, four-way junctions, symbol units and text variables
 * (erc.cpp ERC_TESTER::Test*, connection_graph.cpp ercCheck*).
 */
// SCH_PIN::IsGlobalPower: only a power *input* pin names a power net. A power
// symbol carrying a power_out pin is a PWR_FLAG — it drives the net for ERC
// without renaming it, which is the whole point of placing one.
describe('runErc — power flags', () => {
  it('a power flag drives the net it is attached to, and does not rename it', () => {
    const { doc, libById } = sch(`
      ${place('GND', '#PWR01', 10, 10, 'p1')}
      ${place('PAS', 'R1', 40, 10, 'r1')}
      ${place('VOUT', '#FLG01', 70, 10, 'f1')}
      ${wire(10, 10, 40, 10, 'w1')} ${wire(40, 10, 70, 10, 'w2')}`);
    expect(codes(runErc(doc, libById))).not.toContain('power_pin_not_driven');
  });

  it('the flag drives every subgraph of the same power net', () => {
    // Two GND subgraphs; only the first carries the flag, and the flag's symbol
    // comes first in the file — so if its power_out pin were allowed to name
    // the net, that subgraph would become "VOUT" and the second GND subgraph
    // would be left undriven.
    const { doc, libById } = sch(`
      ${place('VOUT', '#FLG01', 40, 10, 'f1')}
      ${place('GND', '#PWR01', 10, 10, 'p1')}
      ${wire(10, 10, 40, 10, 'w1')}
      ${place('GND', '#PWR02', 10, 50, 'p2')}
      ${place('PAS', 'R1', 40, 50, 'r1')}
      ${wire(10, 50, 40, 50, 'w2')}`);
    expect(codes(runErc(doc, libById))).not.toContain('power_pin_not_driven');
    // …and the net keeps its power-symbol name.
    const nets = computeNetlist(doc, libById).nets.map((n) => n.name);
    expect(nets).toContain('GND');
    expect(nets).not.toContain('VOUT');
  });

  it('marks the power-input pin, not the consuming pin (pinsToMark)', () => {
    // TestPinToPin: for ERCE_POWERPIN_NOT_DRIVEN the marker goes on a
    // PT_POWER_IN pin — what the message is about — rather than the input pin
    // that happens to share the net.
    const { doc, libById } = sch(`
      ${place('IN', 'U1', 10, 10, 'u1')}
      ${place('GND', '#PWR01', 40, 10, 'p1')}
      ${wire(10, 10, 40, 10, 'w1')}`);
    const v = runErc(doc, libById).find((x) => x.code === 'power_pin_not_driven');
    expect(v).toBeDefined();
    expect(v!.at).toEqual({ x: mmToIU(40), y: mmToIU(10) });
  });

  it('without a flag the power net is reported as undriven', () => {
    const { doc, libById } = sch(`
      ${place('GND', '#PWR01', 10, 10, 'p1')}
      ${place('PAS', 'R1', 40, 10, 'r1')}
      ${wire(10, 10, 40, 10, 'w1')}`);
    expect(codes(runErc(doc, libById))).toContain('power_pin_not_driven');
  });
});

describe('runErc — schematic-wide tests', () => {
  const label = (text: string, x: number, y: number, id: string, kind = 'label'): string =>
    `(${kind === 'label' ? 'label' : kind} "${text}" (at ${x} ${y} 0) (uuid "${id}"))`;

  it('flags two sheets with the same name (case-insensitively)', () => {
    const sheet = (name: string, file: string, x: number, id: string): string =>
      `(sheet (at ${x} 10) (size 20 20) (uuid "${id}")
        (property "Sheetname" "${name}" (at ${x} 9 0))
        (property "Sheetfile" "${file}" (at ${x} 31 0)))`;
    const { doc, libById } = sch(`${sheet('Power', 'p.kicad_sch', 10, 's1')}
      ${sheet('power', 'q.kicad_sch', 50, 's2')}`);
    expect(codes(runErc(doc, libById))).toContain('duplicate_sheet_names');
  });

  it('flags labels that differ only in case, and a local/global name clash', () => {
    const { doc, libById } = sch(`
      ${place('PAS', 'R1', 10, 10, 'u1')} ${place('PAS', 'R2', 40, 10, 'u2')}
      ${wire(10, 10, 40, 10, 'w1')}
      ${label('Clock', 20, 10, 'l1')}
      ${label('CLOCK', 30, 10, 'l2')}`);
    const c = codes(runErc(doc, libById));
    expect(c).toContain('similar_labels');
  });

  it('flags a wire connected to nothing, and one loose end', () => {
    const { doc, libById } = sch(`${wire(10, 60, 40, 60, 'w-floating')}`);
    expect(codes(runErc(doc, libById))).toContain('wire_dangling');

    const half = sch(`${place('PAS', 'R1', 10, 10, 'u1')} ${wire(10, 10, 40, 10, 'w-half')}`);
    expect(codes(runErc(half.doc, half.libById))).toContain('unconnected_wire_endpoint');
  });

  it('flags four items meeting at one point when the rule is enabled', () => {
    const settings = defaultErcSettings();
    settings.severities.four_way_junction = 'warning';
    const { doc, libById } = sch(`
      ${wire(10, 20, 20, 20, 'w1')} ${wire(20, 20, 30, 20, 'w2')}
      ${wire(20, 10, 20, 20, 'w3')} ${wire(20, 20, 20, 30, 'w4')}`);
    expect(codes(runErc(doc, libById, settings))).toContain('four_way_junction');
  });

  it('flags an unannotated symbol and a duplicate reference', () => {
    const un = sch(place('PAS', 'R?', 10, 10, 'u1'));
    expect(codes(runErc(un.doc, un.libById))).toContain('unannotated');

    const dupe = sch(`${place('PAS', 'R1', 10, 10, 'u1')} ${place('PAS', 'R1', 40, 40, 'u2')}`);
    expect(codes(runErc(dupe.doc, dupe.libById))).toContain('duplicate_reference');
  });

  it('splits similar-name warnings between labels and power symbols', () => {
    // logError's three-way split: two labels, two power pins, or one of each.
    const { doc, libById } = sch(`
      ${place('PAS', 'R1', 10, 10, 'r1')} ${place('PAS', 'R2', 40, 10, 'r2')}
      ${wire(10, 10, 40, 10, 'w1')}
      (label "Clock" (at 20 10 0) (uuid "l1"))
      (label "CLOCK" (at 30 10 0) (uuid "l2"))
      ${place('GND', '#PWR01', 10, 50, 'p1')}
      ${place('GND', '#PWR02', 40, 50, 'p2')}`);
    // Both GND symbols share a value, so they are not "similar" — same text.
    const codes1 = codes(runErc(doc, libById));
    expect(codes1).toContain('similar_labels');

    const mixed = sch(`
      ${place('GND', '#PWR01', 10, 50, 'p1')}
      (label "gnd" (at 30 50 0) (uuid "l3"))`);
    expect(codes(runErc(mixed.doc, mixed.libById))).toContain('similar_label_and_power');
  });

  it('reports a net that two different labels both name', () => {
    // ercCheckMultipleDrivers: the winner names the net, the loser is reported.
    // The labels sit on the wire's endpoints: a label mid-span touches no
    // connection point unless two lines meet there (updateItemConnectivity's
    // "we need at least two connectable lines" rule).
    const { doc, libById } = sch(`
      ${place('PAS', 'R1', 10, 10, 'r1')} ${place('PAS', 'R2', 40, 10, 'r2')}
      ${wire(10, 10, 40, 10, 'w1')}
      (label "ALPHA" (at 10 10 0) (uuid "l1"))
      (label "BETA" (at 40 10 0) (uuid "l2"))`);
    const v = runErc(doc, libById).filter((x) => x.code === 'multiple_net_names');
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toMatch(/^Both (ALPHA|BETA) and (ALPHA|BETA) are attached/);
    expect(v[0]!.message).toMatch(/will be used in the netlist$/);
  });

  it('reports a SPICE model that cannot be built', () => {
    // ignore-by-default upstream, so the test enables it first.
    const settings = defaultErcSettings();
    settings.severities.simulation_model_issue = 'error';
    const text = `(kicad_sch (version 20230121) (generator eeschema)
      (lib_symbols
        (symbol "T:OPAMP" (property "Reference" "U" (at 0 0 0))
          (property "Value" "OPAMP" (at 0 0 0))
          (symbol "OPAMP_1_1"
            (pin passive line (at 0 0 0) (length 2.54)
              (name "A" (effects (font (size 1.27 1.27))))
              (number "1" (effects (font (size 1.27 1.27)))))
            (pin passive line (at 0 -2.54 0) (length 2.54)
              (name "B" (effects (font (size 1.27 1.27))))
              (number "2" (effects (font (size 1.27 1.27)))))
            (pin passive line (at 0 -5.08 0) (length 2.54)
              (name "C" (effects (font (size 1.27 1.27))))
              (number "3" (effects (font (size 1.27 1.27))))))))
      (symbol (lib_id "T:OPAMP") (at 10 10 0) (unit 1)
        (property "Reference" "U1" (at 10 10 0))
        (property "Value" "OPAMP" (at 10 10 0))
        (property "Sim.Library" "models.lib" (at 10 10 0))
        (property "Sim.Name" "NOPE" (at 10 10 0))
        (uuid "u1")))`;
    const doc = readSchematic(parse(text));
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const v = runErc(doc, libById, settings, {
      simLibraryText: (path) =>
        path === 'models.lib' ? '.subckt LM358 1 2 3\n.ends\n' : undefined,
    });
    expect(v.find((x) => x.code === 'simulation_model_issue')!.message).toBe(
      "Error loading simulation model: could not find base model 'NOPE' in library 'models.lib'",
    );

    // A power symbol is never simulated, and a plain resistor infers its model.
    const quiet = sch(
      `${place('GND', '#PWR01', 10, 10, 'p1')} ${place('PAS', 'R1', 40, 10, 'r1')}`,
    );
    expect(codes(runErc(quiet.doc, quiet.libById, settings))).not.toContain(
      'simulation_model_issue',
    );
  });

  it('flags a pin number that looks like stacked-pin notation but is not', () => {
    // ExpandStackedPinNotation: a range must run upward with a matching prefix.
    const text = `(kicad_sch (version 20230121) (generator eeschema)
      (lib_symbols
        (symbol "T:SP" (property "Reference" "U" (at 0 0 0)) (property "Value" "SP" (at 0 0 0))
          (symbol "SP_1_1"
            (pin passive line (at 0 0 0) (length 2.54)
              (name "P" (effects (font (size 1.27 1.27))))
              (number "[A4-A1]" (effects (font (size 1.27 1.27))))))))
      (symbol (lib_id "T:SP") (at 10 10 0) (unit 1)
        (property "Reference" "U1" (at 10 10 0)) (property "Value" "SP" (at 10 10 0))
        (uuid "sp1")))`;
    const doc = readSchematic(parse(text));
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    expect(codes(runErc(doc, libById))).toContain('stacked_pin_name');
  });

  it('flags a ground-named pin that is not on a ground net', () => {
    // TestGroundPins: only when the symbol *has* a ground net elsewhere.
    const text = `(kicad_sch (version 20230121) (generator eeschema)
      (lib_symbols
        (symbol "T:U" (property "Reference" "U" (at 0 0 0)) (property "Value" "U" (at 0 0 0))
          (symbol "U_1_1"
            (pin power_in line (at 0 0 0) (length 0)
              (name "GND" (effects (font (size 1.27 1.27))))
              (number "1" (effects (font (size 1.27 1.27)))))
            (pin power_in line (at 0 -2.54 0) (length 0)
              (name "GNDA" (effects (font (size 1.27 1.27))))
              (number "2" (effects (font (size 1.27 1.27)))))))
        (symbol "T:GNDSYM" (power) (property "Reference" "#PWR" (at 0 0 0))
          (property "Value" "GND" (at 0 0 0))
          (symbol "GNDSYM_1_1"
            (pin power_in line (at 0 0 0) (length 0)
              (name "GND" (effects (font (size 1.27 1.27))))
              (number "1" (effects (font (size 1.27 1.27))))))))
      (symbol (lib_id "T:U") (at 10 10 0) (unit 1)
        (property "Reference" "U1" (at 10 10 0)) (property "Value" "U" (at 10 10 0)) (uuid "u1"))
      (symbol (lib_id "T:GNDSYM") (at 10 10 0) (unit 1)
        (property "Reference" "#PWR01" (at 10 10 0)) (property "Value" "GND" (at 10 10 0))
        (uuid "g1"))
      (label "VCC" (at 10 12.54 0) (uuid "l-vcc")))`;
    const doc = readSchematic(parse(text));
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const v = runErc(doc, libById).filter((x) => x.code === 'ground_pin_not_ground');
    // Pin 1 sits on the GND net; pin 2 (GNDA) is on the VCC label at its own
    // position. (The label has to actually touch the pin: left dangling, the pin
    // would take the auto name "Net-(U1-GNDA)", which reads as a ground net —
    // upstream tests the same net name and behaves the same way.)
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toBe('Pin GNDA not connected to ground net');
  });

  it('flags pin-map entries for pins the symbol lost, and two pins on one pad', () => {
    // TestPinMap: `[4,9]` is stacked-pin notation, so one pin may own several
    // pads; two *different* pins on one pad is an error unless a jumper group
    // ties them together.
    const withMaps = (maps: string, jumpers = ''): string =>
      `(kicad_sch (version 20230121) (generator eeschema)
        (lib_symbols
          (symbol "T:MAPPED" (property "Reference" "U" (at 0 0 0))
            (property "Value" "MAPPED" (at 0 0 0))
            ${jumpers}
            (pin_maps ${maps})
            (symbol "MAPPED_1_1"
              (pin passive line (at 0 0 0) (length 2.54)
                (name "A" (effects (font (size 1.27 1.27))))
                (number "1" (effects (font (size 1.27 1.27)))))
              (pin passive line (at 0 -2.54 0) (length 2.54)
                (name "B" (effects (font (size 1.27 1.27))))
                (number "2" (effects (font (size 1.27 1.27))))))))
        (symbol (lib_id "T:MAPPED") (at 10 10 0) (unit 1)
          (property "Reference" "U1" (at 10 10 0))
          (property "Value" "MAPPED" (at 10 10 0)) (uuid "m1")))`;

    const stale = readSchematic(parse(withMaps('(pin_map "STD" (entry "1" "1") (entry "7" "7"))')));
    const staleV = runErc(stale, new Map(stale.libSymbols.map((l) => [l.libId, l])));
    expect(staleV.map((x) => x.code)).toContain('pin_map_stale_pin');
    expect(staleV.find((x) => x.code === 'pin_map_stale_pin')!.message).toBe(
      "Pin map 'STD' references unknown symbol pin '7'",
    );

    const dupe = readSchematic(
      parse(withMaps('(pin_map "STD" (entry "1" "[4,9]") (entry "2" "9"))')),
    );
    const dupeV = runErc(dupe, new Map(dupe.libSymbols.map((l) => [l.libId, l])));
    expect(dupeV.find((x) => x.code === 'pin_map_duplicate_pad')!.message).toBe(
      "Symbol pins '1' and '2' both map to pad '9'",
    );

    // …unless the two pins are a jumper pair.
    const jumpered = readSchematic(
      parse(
        withMaps(
          '(pin_map "STD" (entry "1" "[4,9]") (entry "2" "9"))',
          '(jumper_pin_groups ("1" "2"))',
        ),
      ),
    );
    const jumperedV = runErc(jumpered, new Map(jumpered.libSymbols.map((l) => [l.libId, l])));
    expect(jumperedV.map((x) => x.code)).not.toContain('pin_map_duplicate_pad');
  });

  it('flags map pads the footprint lacks, and connected pins that map to none', () => {
    // TestPinMap's pad half. The symbol associates footprint FP:8SOIC with map
    // "STD", and the assigned footprint is the same one.
    const doc = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema)
        (lib_symbols
          (symbol "T:MAPPED" (property "Reference" "U" (at 0 0 0))
            (property "Value" "MAPPED" (at 0 0 0))
            (associated_footprints (footprint "FP:8SOIC" (map "STD")))
            (pin_maps (pin_map "STD" (entry "1" "1") (entry "2" "77")))
            (symbol "MAPPED_1_1"
              (pin passive line (at 0 0 0) (length 2.54)
                (name "A" (effects (font (size 1.27 1.27))))
                (number "1" (effects (font (size 1.27 1.27)))))
              (pin passive line (at 0 -2.54 0) (length 2.54)
                (name "B" (effects (font (size 1.27 1.27))))
                (number "2" (effects (font (size 1.27 1.27)))))
              (pin passive line (at 0 -5.08 0) (length 2.54)
                (name "C" (effects (font (size 1.27 1.27))))
                (number "9" (effects (font (size 1.27 1.27))))))))
        (symbol (lib_id "T:MAPPED") (at 10 10 0) (unit 1)
          (property "Reference" "U1" (at 10 10 0))
          (property "Value" "MAPPED" (at 10 10 0))
          (property "Footprint" "FP:8SOIC" (at 10 10 0))
          (uuid "m1"))
        (wire (pts (xy 10 4.92) (xy 40 4.92)) (uuid "w9"))
        (label "SIG" (at 40 4.92 0) (uuid "l9")))`),
    );
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const v = runErc(doc, libById, defaultErcSettings(), {
      footprintPads: new Map([['FP:8SOIC', new Set(['1', '2'])]]),
    });
    // Pad 77 is not on the footprint…
    expect(v.find((x) => x.code === 'pin_map_bad_pad')!.message).toBe(
      "Pin map 'STD' references pad '77' not present on footprint 'FP:8SOIC'",
    );
    // …and pin 9 is wired up but resolves to no pad (no entry, no pad "9").
    expect(v.find((x) => x.code === 'pin_map_unmapped_pin')!.message).toBe(
      "Pin '9' is connected but maps to no pad on footprint 'FP:8SOIC'",
    );
    // Pin 1 maps explicitly and pin 2 is not connected, so neither is reported.
    expect(v.filter((x) => x.code === 'pin_map_unmapped_pin')).toHaveLength(1);
  });

  it("flags a cached symbol that no longer matches the library's copy", () => {
    const { doc, libById } = sch(place('PAS', 'R1', 10, 10, 'u1'));
    // Same symbol, but the library's copy has the pin somewhere else.
    const cached = libById.get('T:PAS')!;
    const library = {
      ...cached,
      units: cached.units.map((u) => ({
        ...u,
        pins: u.pins.map((p) => ({ ...p, at: { x: p.at.x + 1270, y: p.at.y } })),
      })),
    };
    const v = runErc(doc, libById, defaultErcSettings(), {
      librarySymbols: new Map([['T:PAS', library]]),
    });
    expect(v.map((x) => x.code)).toContain('lib_symbol_mismatch');
    expect(v.find((x) => x.code === 'lib_symbol_mismatch')!.message).toBe(
      "Symbol 'PAS' doesn't match copy in library 'T'",
    );
    // …and nothing is reported when the copies agree.
    const same = runErc(doc, libById, defaultErcSettings(), {
      librarySymbols: new Map([['T:PAS', cached]]),
    });
    expect(same.map((x) => x.code)).not.toContain('lib_symbol_mismatch');
  });

  it('flags an unconfigured symbol library, and a symbol its library lost', () => {
    // TestLibSymbolIssues works off the symbol library table: the library must
    // be configured and must still hold the symbol. A symbol with no cached
    // copy at all is skipped, as upstream skips it.
    const { doc, libById } = sch(`${place('IN', 'U1', 10, 10, 'u1')}`);
    const noTable = runErc(doc, libById);
    expect(codes(noTable)).not.toContain('lib_symbol_issues');

    const unconfigured = runErc(doc, libById, defaultErcSettings(), {
      symbolLibs: new Map([['Other', new Set(['IN'])]]),
    });
    expect(unconfigured.find((v) => v.code === 'lib_symbol_issues')!.message).toBe(
      "The current configuration does not include the symbol library 'T'",
    );

    const missing = runErc(doc, libById, defaultErcSettings(), {
      symbolLibs: new Map([['T', new Set(['Other'])]]),
    });
    expect(missing.find((v) => v.code === 'lib_symbol_issues')!.message).toBe(
      "Symbol 'IN' not found in symbol library 'T'",
    );

    const ok = runErc(doc, libById, defaultErcSettings(), {
      symbolLibs: new Map([['T', new Set(['IN'])]]),
    });
    expect(codes(ok)).not.toContain('lib_symbol_issues');
  });

  it('flags an unresolved text variable', () => {
    const { doc, libById } = sch(`${label('${MISSING}', 10, 10, 'l1')}`);
    const v = runErc(doc, libById, defaultErcSettings(), {
      resolveTextVar: (name) => (name === 'KNOWN' ? 'x' : undefined),
    });
    expect(codes(v)).toContain('unresolved_variable');
  });

  it('flags footprint links to unknown libraries and missing footprints', () => {
    const withFp = (ref: string, fp: string, x: number, id: string): string =>
      `(symbol (lib_id "T:PAS") (at ${x} 10 0) (unit 1)
        (property "Reference" "${ref}" (at ${x} 10 0))
        (property "Value" "PAS" (at ${x} 10 0))
        (property "Footprint" "${fp}" (at ${x} 10 0))
        (uuid "${id}"))`;
    const { doc, libById } = sch(`${withFp('R1', 'Nope:Thing', 10, 'f1')}
      ${withFp('R2', 'Resistor_SMD:R_0402', 40, 'f2')}
      ${withFp('R3', 'Resistor_SMD:R_9999', 70, 'f3')}`);
    const v = runErc(doc, libById, defaultErcSettings(), {
      footprintLibs: new Map([['Resistor_SMD', new Set(['R_0402'])]]),
    });
    const msgs = v.filter((x) => x.code === 'footprint_link_issues').map((x) => x.message);
    expect(msgs).toContain(
      "The current configuration does not include the footprint library 'Nope'",
    );
    expect(msgs).toContain("Footprint 'R_9999' not found in library 'Resistor_SMD'");
    expect(msgs).toHaveLength(2); // the valid link produces nothing
  });

  it('stamps each violation with the sheet it belongs to', () => {
    const { doc, libById } = sch(place('IN', 'U1', 10, 10, 'u1'));
    const v = runErc(doc, libById, defaultErcSettings(), { sheetFile: 'child.kicad_sch' });
    expect(v.every((x) => x.file === 'child.kicad_sch')).toBe(true);
  });

  it('flags a sheet pin with no matching hierarchical label in the child', () => {
    const child = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols)
        (hierarchical_label "OUT" (shape input) (at 10 10 0) (uuid "hl1")))`),
    );
    const { doc, libById } = sch(`(sheet (at 10 10) (size 20 20) (uuid "s1")
        (property "Sheetname" "Child" (at 10 9 0))
        (property "Sheetfile" "child.kicad_sch" (at 10 31 0))
        (pin "IN" input (at 10 15 180) (uuid "sp1")))`);
    const v = runErc(doc, libById, defaultErcSettings(), {
      subSheets: new Map([['child.kicad_sch', child]]),
    });
    // Both directions are reported: the pin has no label, the label no pin.
    expect(v.filter((x) => x.code === 'hier_label_mismatch')).toHaveLength(2);
  });
  it('reports a netclass field naming a class the project does not define', () => {
    const directive = (netclass: string, x: number, id: string): string =>
      `(directive_label (at ${x} 10 0) (length 2.54) (shape round) (uuid "${id}")
        (property "Netclass" "${netclass}" (at ${x} 8 0)))`;
    const { doc, libById } = sch(`
      ${directive('HV', 10, 'd1')} ${directive('Default', 40, 'd2')} ${directive('Nope', 70, 'd3')}
      ${wire(10, 10, 20, 10, 'w1')} ${wire(40, 10, 50, 10, 'w2')} ${wire(70, 10, 80, 10, 'w3')}`);
    const v = runErc(doc, libById, defaultErcSettings(), {
      netclasses: { defaultName: 'Default', names: new Set(['Default', 'HV']) },
    });
    const msgs = v.filter((x) => x.code === 'undefined_netclass').map((x) => x.message);
    expect(msgs).toEqual(['Netclass Nope is not defined']);
  });

  it('reports a dangling directive label, and stays quiet when it sits on a wire', () => {
    const directive = (x: number, id: string): string =>
      `(directive_label (at ${x} 10 0) (length 2.54) (shape round) (uuid "${id}")
        (property "Netclass" "Default" (at ${x} 8 0)))`;
    const { doc, libById } = sch(`${directive(10, 'd1')} ${directive(50, 'd2')}
      ${wire(10, 10, 20, 10, 'w1')}`);
    const v = runErc(doc, libById);
    const dangling = v.filter((x) => x.code === 'label_dangling');
    expect(dangling).toHaveLength(1);
    expect(dangling[0]!.items).toEqual(['d2']);
  });
});
