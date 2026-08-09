// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Hierarchy-wide connectivity (counterpart CONNECTION_GRAPH::propagateToNeighbors):
 * a sheet pin and the child sheet's matching hierarchical label put both
 * subgraphs on one net, named by the chain's best driver.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { computeHierarchyNetlist } from '@ziroeda/eeschema/src/connectivity/hierarchy.js';
import { runErc, type ExternalPin } from '@ziroeda/eeschema/src/connectivity/erc.js';
import { enumeratePins } from '@ziroeda/eeschema/src/connectivity/nets.js';
import type { Schematic } from '@ziroeda/eeschema';

const LIB = `(symbol "T:PAS" (pin_names (offset 0.254))
    (property "Reference" "U" (at 0 0 0))
    (property "Value" "PAS" (at 0 0 0))
    (symbol "PAS_1_1"
      (pin passive line (at 0 0 0) (length 2.54)
        (name "P" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))))`;

const doc = (body: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${LIB}) ${body})`),
  );

const libsFor = (s: { doc: Schematic }) => new Map(s.doc.libSymbols.map((l) => [l.libId, l]));

/** The net a given item id sits on, in one sheet's netlist. */
const netNameOf = (
  netlist: { nets: { code: number; name: string }[]; netByItem: Map<string, number> },
  id: string,
): string | undefined => {
  const code = netlist.netByItem.get(id);
  return netlist.nets.find((n) => n.code === code)?.name;
};

describe('computeHierarchyNetlist', () => {
  // Root: a local label "MAIN" on a wire that reaches sheet S1's pin "IN".
  const root = doc(`
    (label "MAIN" (at 20 10 0) (uuid "l-main"))
    (wire (pts (xy 20 10) (xy 40 10)) (uuid "w-root"))
    (sheet (at 40 5) (size 20 20) (uuid "s1")
      (property "Sheetname" "Child" (at 40 4 0))
      (property "Sheetfile" "child.kicad_sch" (at 40 26 0))
      (pin "IN" input (at 40 10 180) (uuid "sp-in")))`);

  // Child: a hierarchical label "IN" on a wire reaching a passive pin.
  const child = doc(`
    (hierarchical_label "IN" (shape input) (at 10 10 0) (uuid "hl-in"))
    (wire (pts (xy 10 10) (xy 30 10)) (uuid "w-child"))
    (symbol (lib_id "T:PAS") (at 30 10 0) (unit 1)
      (property "Reference" "R1" (at 30 10 0))
      (property "Value" "PAS" (at 30 10 0))
      (uuid "r1"))`);

  const sheets = [
    { path: '/', file: 'root.kicad_sch', doc: root },
    { path: '/s1/', file: 'child.kicad_sch', doc: child },
  ];

  it('names the child subgraph after the parent net it hangs off', () => {
    const { bySheet } = computeHierarchyNetlist(sheets, libsFor);
    // The child's hier-label net takes the parent's local-label name: the local
    // label (LOCAL_LABEL) outranks the hierarchical label (HIER_LABEL).
    // The winning driver is the parent's local label, so the whole chain takes
    // that driver's name *and* its sheet path, the root's, here "/".
    expect(netNameOf(bySheet.get('/s1/')!, 'hl-in')).toBe('/MAIN');
    expect(netNameOf(bySheet.get('/')!, 'l-main')).toBe('/MAIN');
    // …and the pin on the child sheet is on that same net.
    expect(netNameOf(bySheet.get('/s1/')!, 'r1:pin0')).toBe('/MAIN');
  });

  it('leaves an unconnected sheet pin name alone', () => {
    const lonely = [
      { path: '/', file: 'root.kicad_sch', doc: root },
      // A child with no matching hierarchical label.
      {
        path: '/s1/',
        file: 'child.kicad_sch',
        doc: doc('(label "OTHER" (at 10 10 0) (uuid "l-o"))'),
      },
    ];
    const { bySheet } = computeHierarchyNetlist(lonely, libsFor);
    // Nothing propagates, so each label keeps its own sheet's path.
    expect(netNameOf(bySheet.get('/s1/')!, 'l-o')).toBe('/Child/OTHER');
    expect(netNameOf(bySheet.get('/')!, 'l-main')).toBe('/MAIN');
  });

  it('a global driver in the child wins over the parent label', () => {
    // The child's net also carries a power symbol: GLOBAL_POWER_PIN outranks
    // everything, so the whole chain becomes GND.
    const GND = `(symbol "T:GND" (power) (pin_names (offset 0))
        (property "Reference" "#PWR" (at 0 0 0))
        (property "Value" "GND" (at 0 0 0))
        (symbol "GND_1_1"
          (pin power_in line (at 0 0 0) (length 0)
            (name "GND" (effects (font (size 1.27 1.27))))
            (number "1" (effects (font (size 1.27 1.27)))))))`;
    const withPower = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema)
        (lib_symbols ${LIB} ${GND})
        (hierarchical_label "IN" (shape input) (at 10 10 0) (uuid "hl-in"))
        (wire (pts (xy 10 10) (xy 30 10)) (uuid "w-child"))
        (symbol (lib_id "T:GND") (at 30 10 0) (unit 1)
          (property "Reference" "#PWR01" (at 30 10 0))
          (property "Value" "GND" (at 30 10 0))
          (uuid "g1")))`),
    );
    const { bySheet } = computeHierarchyNetlist(
      [
        { path: '/', file: 'root.kicad_sch', doc: root },
        { path: '/s1/', file: 'child.kicad_sch', doc: withPower },
      ],
      libsFor,
    );
    expect(netNameOf(bySheet.get('/')!, 'l-main')).toBe('GND');
    expect(netNameOf(bySheet.get('/s1/')!, 'hl-in')).toBe('GND');
  });
});

/**
 * The point of all this: a net driven on one sheet and consumed on another is
 * one net, so the consuming sheet must not report it as undriven
 * (TestPinToPin's needsDriver/hasDriver over the merged m_nets entry).
 */
describe('ERC over a hierarchy', () => {
  const LIBS = `${LIB}
    (symbol "T:OUT" (pin_names (offset 0.254))
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "OUT" (at 0 0 0))
      (symbol "OUT_1_1"
        (pin output line (at 0 0 0) (length 2.54)
          (name "O" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))))
    (symbol "T:IN" (pin_names (offset 0.254))
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "IN" (at 0 0 0))
      (symbol "IN_1_1"
        (pin input line (at 0 0 0) (length 2.54)
          (name "I" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))))`;

  const sheet = (body: string): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${LIBS}) ${body})`),
    );

  // Root drives SIG from an output pin and passes it down through sheet S1.
  const parent = sheet(`
    (symbol (lib_id "T:OUT") (at 10 10 0) (unit 1)
      (property "Reference" "U1" (at 10 10 0))
      (property "Value" "OUT" (at 10 10 0))
      (uuid "u-out"))
    (wire (pts (xy 10 10) (xy 40 10)) (uuid "w-p"))
    (label "SIG" (at 20 10 0) (uuid "l-sig"))
    (sheet (at 40 5) (size 20 20) (uuid "s1")
      (property "Sheetname" "Child" (at 40 4 0))
      (property "Sheetfile" "child.kicad_sch" (at 40 26 0))
      (pin "SIG" input (at 40 10 180) (uuid "sp-sig")))`);

  // The child only consumes it, through a hierarchical label of the same name.
  const kid = sheet(`
    (hierarchical_label "SIG" (shape input) (at 10 10 0) (uuid "hl-sig"))
    (wire (pts (xy 10 10) (xy 30 10)) (uuid "w-c"))
    (symbol (lib_id "T:IN") (at 30 10 0) (unit 1)
      (property "Reference" "U2" (at 30 10 0))
      (property "Value" "IN" (at 30 10 0))
      (uuid "u-in"))`);

  const sheets = [
    { path: '/', file: 'root.kicad_sch', doc: parent },
    { path: '/s1/', file: 'child.kicad_sch', doc: kid },
  ];

  /** The editor's wiring: merged names, then each sheet's external pin list. */
  const runAll = (): string[] => {
    const { bySheet, humanPaths, hierNetNames } = computeHierarchyNetlist(sheets, libsFor);
    const byNet = new Map<string, { file: string; pin: ExternalPin }[]>();
    for (const s of sheets) {
      const netlist = bySheet.get(s.path)!;
      const libs = libsFor(s);
      for (const p of enumeratePins(s.doc, libs)) {
        const code = netlist.netByItem.get(p.id);
        const name = netlist.nets.find((n) => n.code === code)?.name;
        if (name === undefined) continue;
        const arr = byNet.get(name) ?? [];
        arr.push({
          file: s.file,
          pin: { electricalType: p.electricalType, ref: p.ref, number: p.number, hidden: p.hidden },
        });
        byNet.set(name, arr);
      }
    }
    const out: string[] = [];
    for (const s of sheets) {
      const external = new Map<string, ExternalPin[]>();
      for (const [name, entries] of byNet) {
        const others = entries.filter((e) => e.file !== s.file).map((e) => e.pin);
        if (others.length) external.set(name, others);
      }
      out.push(
        ...runErc(s.doc, libsFor(s), undefined, {
          // ERC re-graphs one sheet, so it needs the same sheet path the
          // hierarchy named its nets with (the editor wires it the same way).
          sheetPath: humanPaths.get(s.path) ?? '/',
          externalNetPins: external,
          externalNetNoConnects: new Set<string>(),
          // …and the renames the hierarchy applied, since a sheet graphed alone
          // names its nets before knowing what a parent's driver settled on.
          hierNetNames: hierNetNames.get(s.path) ?? new Map(),
        }).map((v) => v.code),
      );
    }
    return out;
  };

  it('does not report an input driven from the parent sheet as undriven', () => {
    expect(runAll()).not.toContain('pin_not_driven');
  });

  it('still reports it when nothing drives the net anywhere', () => {
    const undriven = [
      {
        path: '/',
        file: 'root.kicad_sch',
        doc: sheet(`
          (wire (pts (xy 10 10) (xy 40 10)) (uuid "w-p"))
          (label "SIG" (at 20 10 0) (uuid "l-sig"))
          (sheet (at 40 5) (size 20 20) (uuid "s1")
            (property "Sheetname" "Child" (at 40 4 0))
            (property "Sheetfile" "child.kicad_sch" (at 40 26 0))
            (pin "SIG" input (at 40 10 180) (uuid "sp-sig")))`),
      },
      { path: '/s1/', file: 'child.kicad_sch', doc: kid },
    ];
    const { bySheet } = computeHierarchyNetlist(undriven, libsFor);
    const netlist = bySheet.get('/s1/')!;
    const code = netlist.netByItem.get('u-in:pin0');
    const name = netlist.nets.find((n) => n.code === code)?.name;
    // The child's own run sees no driver anywhere on the merged net.
    const v = runErc(kid, libsFor({ doc: kid }), undefined, {
      externalNetPins: new Map([[name!, []]]),
      externalNetNoConnects: new Set<string>(),
    });
    expect(v.map((x) => x.code)).toContain('pin_not_driven');
  });
});

/**
 * Buses across the hierarchy: a bus-shaped sheet pin belongs to the *bus*
 * graph (SCH_SHEET_PIN::ConfigureFromLabel makes it a BUS connection), and it
 * pairs with the child sheet's bus port of the same name, upstream's
 * GetNameForDriver comparison, so the bus connection travels between them.
 */
describe('hierarchical buses', () => {
  const busSheet = (body: string): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${LIB}) ${body})`),
    );

  // Parent: an unlabelled bus whose only name comes from the sheet pin.
  const parent = busSheet(`
    (bus (pts (xy 10 10) (xy 40 10)) (uuid "b-p"))
    (sheet (at 40 5) (size 20 20) (uuid "s1")
      (property "Sheetname" "Child" (at 40 4 0))
      (property "Sheetfile" "child.kicad_sch" (at 40 26 0))
      (pin "D[0..1]" input (at 40 10 180) (uuid "sp-bus")))`);

  // Child: the matching bus port, with D0 broken out onto a wire.
  const kid = busSheet(`
    (bus (pts (xy 10 10) (xy 30 10)) (uuid "b-c"))
    (hierarchical_label "D[0..1]" (shape input) (at 10 10 0) (uuid "hl-bus"))
    (bus_entry (at 20 10) (size 2.54 2.54) (uuid "be-c"))
    (wire (pts (xy 22.54 12.54) (xy 40 12.54)) (uuid "w-c"))
    (label "D0" (at 30 12.54 0) (uuid "l-d0"))`);

  it('puts a bus-shaped sheet pin on the bus, and names the bus from it', () => {
    const { bySheet } = computeHierarchyNetlist(
      [
        { path: '/', file: 'root.kicad_sch', doc: parent },
        { path: '/s1/', file: 'child.kicad_sch', doc: kid },
      ],
      libsFor,
    );
    const root = bySheet.get('/')!;
    // The pin is a bus item, not a wire net of its own.
    expect(root.buses[0]?.name).toBe('D[0..1]');
    expect(root.buses[0]?.members).toEqual(['D0', 'D1']);
    expect(root.buses[0]?.sheetPins.map((p) => p.name)).toEqual(['D[0..1]']);
    expect(root.netByItem.has('s1:sheetpin0')).toBe(false);
    // The child keeps its own members; both sides name them the same way, which
    // is what puts them on one net.
    expect(netNameOf(bySheet.get('/s1/')!, 'l-d0')).toBe('/Child/D0');
  });

  it('leaves a bus alone when no sheet pin matches its port', () => {
    const lonely = busSheet(`
      (bus (pts (xy 10 10) (xy 30 10)) (uuid "b-c"))
      (hierarchical_label "OTHER[0..1]" (shape input) (at 10 10 0) (uuid "hl-o"))`);
    const { bySheet } = computeHierarchyNetlist(
      [
        { path: '/', file: 'root.kicad_sch', doc: parent },
        { path: '/s1/', file: 'child.kicad_sch', doc: lonely },
      ],
      libsFor,
    );
    expect(bySheet.get('/s1/')!.buses[0]?.name).toBe('OTHER[0..1]');
    expect(bySheet.get('/')!.buses[0]?.name).toBe('D[0..1]');
  });
});

/**
 * CONNECTION_GRAPH::buildConnectionGraph's global equivalence classes: global
 * driver names that meet on one subgraph merge every subgraph carrying either
 * name, anywhere in the hierarchy. Tying power rails together with a wire is the
 * everyday case — KiCad's own kit-dev-coldfire demo does it, and its board file
 * has no VDD or VCC net at all, only the merged +3.3V.
 */
describe('global equivalence classes', () => {
  const PWR = (name: string, value: string) => `(symbol "T:${name}" (power) (pin_names (offset 0))
    (property "Reference" "#PWR" (at 0 0 0))
    (property "Value" "${value}" (at 0 0 0))
    (symbol "${name}_1_1"
      (pin power_in line (at 0 0 0) (length 0) (hide yes)
        (name "${value}" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))))`;

  // A plain (non-power) symbol with a legacy invisible power pin named VCC.
  const LOGIC = `(symbol "T:LOGIC" (pin_names (offset 0.254))
    (property "Reference" "U" (at 0 0 0))
    (property "Value" "LOGIC" (at 0 0 0))
    (symbol "LOGIC_1_1"
      (pin power_in line (at 0 0 0) (length 0) (hide yes)
        (name "VCC" (effects (font (size 1.27 1.27))))
        (number "14" (effects (font (size 1.27 1.27)))))))`;

  const PAS = `(symbol "T:PAS" (pin_names (offset 0.254))
    (property "Reference" "U" (at 0 0 0))
    (property "Value" "PAS" (at 0 0 0))
    (symbol "PAS_1_1"
      (pin passive line (at 0 0 0) (length 2.54)
        (name "P" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))))`;

  const libs = [PWR('V33', '+3.3V'), PWR('VDD', 'VDD'), PWR('VCC', 'VCC'), LOGIC, PAS].join('\n');
  const mk = (body: string): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${libs}) ${body})`),
    );
  const pwr = (lib: string, value: string, ref: string, x: number, y: number, uuid: string) =>
    `(symbol (lib_id "T:${lib}") (at ${x} ${y} 0) (unit 1)
      (property "Reference" "${ref}" (at ${x} ${y} 0))
      (property "Value" "${value}" (at ${x} ${y} 0)) (uuid "${uuid}"))`;

  // Root: two wires meeting at (20,10) tie +3.3V, VDD and VCC together. A second,
  // physically separate VDD net feeds a passive pin.
  const root = mk(`
    (wire (pts (xy 10 10) (xy 20 10)) (uuid "w-a"))
    (wire (pts (xy 20 10) (xy 30 10)) (uuid "w-b"))
    ${pwr('V33', '+3.3V', '#PWR01', 10, 10, 'p1')}
    ${pwr('VDD', 'VDD', '#PWR02', 20, 10, 'p2')}
    ${pwr('VCC', 'VCC', '#PWR03', 30, 10, 'p3')}
    (wire (pts (xy 10 30) (xy 30 30)) (uuid "w-c"))
    ${pwr('VDD', 'VDD', '#PWR04', 10, 30, 'p4')}
    (symbol (lib_id "T:PAS") (at 30 30 0) (unit 1)
      (property "Reference" "R1" (at 30 30 0))
      (property "Value" "PAS" (at 30 30 0)) (uuid "r1"))`);

  // Child: a logic part whose invisible VCC pin joins the global VCC net.
  const child = mk(`
    (symbol (lib_id "T:LOGIC") (at 10 10 0) (unit 1)
      (property "Reference" "U1" (at 10 10 0))
      (property "Value" "LOGIC" (at 10 10 0)) (uuid "u1"))`);

  const sheets = [
    { path: '/', file: 'root.kicad_sch', doc: root },
    { path: '/s1/', file: 'child.kicad_sch', doc: child },
  ];

  it('merges rails tied on one subgraph, and everything named by either rail', () => {
    const { bySheet } = computeHierarchyNetlist(sheets, libsFor);
    const rootNl = bySheet.get('/')!;
    // The tie itself takes the name compareDrivers ranks first of the three.
    expect(netNameOf(rootNl, 'p2:pin0')).toBe('+3.3V');
    // The physically separate VDD net merges in, and carries its passive with it.
    expect(netNameOf(rootNl, 'p4:pin0')).toBe('+3.3V');
    expect(netNameOf(rootNl, 'r1:pin0')).toBe('+3.3V');
    // …as does the invisible VCC pin on the other sheet.
    expect(netNameOf(bySheet.get('/s1/')!, 'u1:pin0')).toBe('+3.3V');
    // Nothing is left under either of the absorbed names.
    const names = new Set<string>();
    for (const s of sheets) for (const n of bySheet.get(s.path)!.nets) names.add(n.name);
    expect(names.has('VDD')).toBe(false);
    expect(names.has('VCC')).toBe(false);
  });

  it('leaves unrelated global rails apart', () => {
    // The same schematic without the tie: VDD and +3.3V stay separate nets.
    const untied = mk(`
      (wire (pts (xy 10 10) (xy 30 10)) (uuid "w-a"))
      ${pwr('V33', '+3.3V', '#PWR01', 10, 10, 'p1')}
      (symbol (lib_id "T:PAS") (at 30 10 0) (unit 1)
        (property "Reference" "R1" (at 30 10 0))
        (property "Value" "PAS" (at 30 10 0)) (uuid "r1"))
      (wire (pts (xy 10 30) (xy 30 30)) (uuid "w-c"))
      ${pwr('VDD', 'VDD', '#PWR04', 10, 30, 'p4')}
      (symbol (lib_id "T:PAS") (at 30 30 0) (unit 1)
        (property "Reference" "R2" (at 30 30 0))
        (property "Value" "PAS" (at 30 30 0)) (uuid "r2"))`);
    const { bySheet } = computeHierarchyNetlist(
      [{ path: '/', file: 'root.kicad_sch', doc: untied }],
      libsFor,
    );
    const nl = bySheet.get('/')!;
    expect(netNameOf(nl, 'p1:pin0')).toBe('+3.3V');
    expect(netNameOf(nl, 'p4:pin0')).toBe('VDD');
  });
});

/**
 * propagate_bus_neighbors (connection_graph.cpp): a bus that crosses a sheet
 * boundary carries its *members* across with it. Which net is a member is
 * decided by name — processSubGraphs feeds the bus's expanded members into
 * connections_to_check and matches them against every other subgraph's driver
 * name on that sheet — so a plain "D0" label counts even when it hangs off a
 * different bus segment than the sheet pin does.
 */
describe('bus members across the hierarchy', () => {
  const BUSLIB = `${LIB}
    (symbol "T:OUT2" (pin_names (offset 0.254))
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "OUT2" (at 0 0 0))
      (symbol "OUT2_1_1"
        (pin output line (at 0 0 0) (length 2.54)
          (name "O" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))))`;
  const mk = (body: string): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols ${BUSLIB}) ${body})`),
    );

  // Root: a D[0..1] bus reaching sheet S1's bus pin, plus D0/D1 broken out on
  // their own wires to pins — deliberately on a *separate* bus segment, the way
  // these schematics are actually drawn.
  const root = mk(`
    (bus (pts (xy 60 10) (xy 80 10)) (uuid "b-root"))
    (label "D[0..1]" (at 60 10 0) (uuid "bl-root"))
    (sheet (at 80 5) (size 20 20) (uuid "s1")
      (property "Sheetname" "Child" (at 80 4 0))
      (property "Sheetfile" "child.kicad_sch" (at 80 26 0))
      (pin "D[0..1]" input (at 80 10 180) (uuid "sp-bus")))
    (symbol (lib_id "T:OUT2") (at 10 30 0) (unit 1)
      (property "Reference" "U1" (at 10 30 0))
      (property "Value" "OUT2" (at 10 30 0)) (uuid "u1"))
    (wire (pts (xy 10 30) (xy 30 30)) (uuid "w-d0"))
    (label "D0" (at 30 30 0) (uuid "l-d0"))
    (symbol (lib_id "T:OUT2") (at 10 40 0) (unit 1)
      (property "Reference" "U2" (at 10 40 0))
      (property "Value" "OUT2" (at 10 40 0)) (uuid "u2"))
    (wire (pts (xy 10 40) (xy 30 40)) (uuid "w-d1"))
    (label "D1" (at 30 40 0) (uuid "l-d1"))`);

  // Child: the matching bus port, and D0 broken out to a passive pin.
  const child = mk(`
    (bus (pts (xy 10 10) (xy 30 10)) (uuid "b-child"))
    (hierarchical_label "D[0..1]" (shape input) (at 10 10 0) (uuid "hl-bus"))
    (wire (pts (xy 10 30) (xy 30 30)) (uuid "w-c0"))
    (label "D0" (at 10 30 0) (uuid "l-c0"))
    (symbol (lib_id "T:PAS") (at 30 30 0) (unit 1)
      (property "Reference" "R1" (at 30 30 0))
      (property "Value" "PAS" (at 30 30 0)) (uuid "r1"))`);

  const sheets = [
    { path: '/', file: 'root.kicad_sch', doc: root },
    { path: '/s1/', file: 'child.kicad_sch', doc: child },
  ];

  it('puts the child member net on the parent member net', () => {
    const { bySheet, hierNetNames } = computeHierarchyNetlist(sheets, libsFor);
    // D0 is one net across both sheets, named from the shallower sheet.
    expect(netNameOf(bySheet.get('/')!, 'u1:pin0')).toBe('/D0');
    expect(netNameOf(bySheet.get('/s1/')!, 'r1:pin0')).toBe('/D0');
    // The rename is recorded, so a single-sheet ERC run can still find the net.
    expect(hierNetNames.get('/s1/')?.get('/Child/D0')).toBe('/D0');
    // A member with nothing on the child side is untouched.
    expect(netNameOf(bySheet.get('/')!, 'u2:pin0')).toBe('/D1');
  });

  it('does not merge members of a bus that never crosses a sheet', () => {
    // Same sheet symbol, so the child still resolves its "/Child/" path — only
    // the bus sheet pin is gone, so nothing carries D0 across.
    const lone = mk(`
      (bus (pts (xy 60 10) (xy 80 10)) (uuid "b-root"))
      (label "D[0..1]" (at 60 10 0) (uuid "bl-root"))
      (sheet (at 80 5) (size 20 20) (uuid "s1")
        (property "Sheetname" "Child" (at 80 4 0))
        (property "Sheetfile" "child.kicad_sch" (at 80 26 0)))
      (symbol (lib_id "T:OUT2") (at 10 30 0) (unit 1)
        (property "Reference" "U1" (at 10 30 0))
        (property "Value" "OUT2" (at 10 30 0)) (uuid "u1"))
      (wire (pts (xy 10 30) (xy 30 30)) (uuid "w-d0"))
      (label "D0" (at 30 30 0) (uuid "l-d0"))`);
    const { bySheet } = computeHierarchyNetlist(
      [
        { path: '/', file: 'root.kicad_sch', doc: lone },
        { path: '/s1/', file: 'child.kicad_sch', doc: child },
      ],
      libsFor,
    );
    // No bus pin/port pair, so the child keeps its own sheet-qualified name.
    expect(netNameOf(bySheet.get('/s1/')!, 'r1:pin0')).toBe('/Child/D0');
  });
});
