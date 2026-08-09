// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';
import {
  addItems,
  makeWire,
  makeJunction,
  makeLabel,
  makeBus,
  placeSymbol,
} from '@ziroeda/eeschema/src/tools/index.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Schematic, LibSymbol } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const libMap = (sch: Schematic) =>
  new Map<string, LibSymbol>(sch.libSymbols.map((l) => [l.libId, l]));

// A 2-pin part (R) so we have real pins to connect.
const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;

describe('computeNetlist', () => {
  it('joins two wires that share an endpoint into one net', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(10, 10))],
    }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets).toHaveLength(1);
    expect(nets[0]!.items).toHaveLength(2);
  });

  it('keeps two wires that merely cross (no junction) on separate nets', () => {
    let sch = EMPTY();
    // Horizontal wire and a vertical wire crossing its middle, no junction.
    sch = addItems({ lines: [makeWire(at(0, 5), at(10, 5)), makeWire(at(5, 0), at(5, 10))] }).apply(
      sch,
    );
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets).toHaveLength(2);
  });

  it('a junction ties wires that cross at its position into one net', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 5), at(10, 5)), makeWire(at(5, 0), at(5, 10))],
      junctions: [makeJunction(at(5, 5))],
    }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets).toHaveLength(1);
  });

  it('names the net from a label sharing a wire endpoint', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0))],
      labels: [makeLabel('label', 'CLK', at(0, 0))],
    }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets).toHaveLength(1);
    // A local label names a net local to its sheet, so the name carries the
    // sheet path (SCH_CONNECTION::recacheName).
    expect(nets[0]!.name).toBe('/CLK');
    expect(nets[0]!.localName).toBe('CLK');
  });

  it('a global label outranks a local label on the same net', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0))],
      labels: [makeLabel('label', 'LOCAL', at(0, 0)), makeLabel('global_label', 'VBUS', at(10, 0))],
    }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets[0]!.name).toBe('VBUS');
  });

  // SCH_LABEL_BASE::UpdateDanglingState hit-tests the label against whole wire
  // and bus segments and hands the result to the connection graph itself, since
  // connection_map only ties items that share an exact point. Without it a label
  // dropped anywhere but a wire end sits on a net of its own.
  describe('a label lying on a wire segment', () => {
    it('joins that wire even away from its endpoints', () => {
      let sch = EMPTY();
      sch = addItems({
        lines: [makeWire(at(0, 0), at(30, 0))],
        labels: [makeLabel('label', 'SIG', at(12, 0))],
      }).apply(sch);
      const { nets } = computeNetlist(sch, libMap(sch));
      expect(nets).toHaveLength(1);
      expect(nets[0]!.name).toBe('/SIG'); // the label names the wire's net
      expect(nets[0]!.items).toHaveLength(2);
    });

    it('carries the wire net across to the pins on it', () => {
      let sch = EMPTY();
      sch = placeSymbol(R, at(0, 0)).apply(sch);
      const symId = refId('symbol', sch.symbols[0]!.uuid, 0);
      sch = addItems({
        lines: [makeWire(at(0, -3.81), at(20, -3.81))],
        labels: [makeLabel('label', 'TOP', at(9, -3.81))],
      }).apply(sch);
      const { nets, netByItem } = computeNetlist(sch, libMap(sch));
      const top = nets.find((n) => n.name === '/TOP');
      expect(top).toBeDefined();
      expect(netByItem.get(`${symId}:pin0`)).toBe(top!.code);
    });

    it('does not join a wire it only sits near', () => {
      let sch = EMPTY();
      sch = addItems({
        lines: [makeWire(at(0, 0), at(30, 0))],
        labels: [makeLabel('label', 'SIG', at(12, 1))],
      }).apply(sch);
      const { nets } = computeNetlist(sch, libMap(sch));
      expect(nets).toHaveLength(2);
    });

    // Upstream tests BUS_END before WIRE_END and stops at the first hit, so a
    // label over both takes the bus and leaves the wire's net alone.
    it('takes a bus over a wire crossing the same point', () => {
      let sch = EMPTY();
      sch = addItems({
        lines: [makeBus(at(0, 0), at(30, 0)), makeWire(at(12, -10), at(12, 10))],
        labels: [makeLabel('label', 'SIG', at(12, 0))],
      }).apply(sch);
      const { netByItem } = computeNetlist(sch, libMap(sch));
      const wireId = refId('line', sch.lines[1]!.uuid, 1);
      const labelId = refId('label', sch.labels[0]!.uuid, 0);
      expect(netByItem.get(wireId)).not.toBe(netByItem.get(labelId));
    });

    // An exact-position pin settles the label first (upstream breaks out of
    // UpdateDanglingState before the segment tests), so a wire that merely runs
    // through that point is not pulled in.
    it('leaves a passing wire alone when a pin already anchors the label', () => {
      let sch = EMPTY();
      sch = placeSymbol(R, at(0, 0)).apply(sch); // pins at (0, ±3.81)
      // The wire's *interior* covers the pin, so nothing but the label rule
      // could join the two.
      sch = addItems({
        lines: [makeWire(at(-10, 3.81), at(10, 3.81))],
        labels: [makeLabel('label', 'SIG', at(0, 3.81))],
      }).apply(sch);
      const { netByItem } = computeNetlist(sch, libMap(sch));
      const symId = refId('symbol', sch.symbols[0]!.uuid, 0);
      const wireId = refId('line', sch.lines[0]!.uuid, 0);
      const labelId = refId('label', sch.labels[0]!.uuid, 0);
      // The label is on the pin's net…
      expect(netByItem.get(labelId)).toBe(netByItem.get(`${symId}:pin1`));
      // …and the wire is not.
      expect(netByItem.get(wireId)).not.toBe(netByItem.get(labelId));
    });
  });

  it('connects a symbol pin to a wire at the pin position and reports its net', () => {
    let sch = EMPTY();
    // Place R at (0,0): R has pins at (0, +3.81) and (0, -3.81) in IU (vertical).
    sch = placeSymbol(R, at(0, 0)).apply(sch);
    const sym = sch.symbols[0]!;
    const symId = refId('symbol', sym.uuid, 0);
    // Wire from pin 1 (top, at y=-3.81 after inversion) outward, and label it.
    sch = addItems({
      lines: [makeWire(at(0, -3.81), at(20, -3.81))],
      labels: [makeLabel('label', 'TOP', at(20, -3.81))],
    }).apply(sch);
    const { nets, netByItem } = computeNetlist(sch, libMap(sch));
    const topNet = nets.find((n) => n.name === '/TOP');
    expect(topNet).toBeDefined();
    // The symbol's first pin node should be on the TOP net.
    expect(netByItem.get(`${symId}:pin0`)).toBe(topNet!.code);
  });
});

/**
 * CONNECTION_GRAPH::processSubGraphs' absorption: two strongly-driven subgraphs
 * on one sheet whose driver names match are one net. Matching is on *every*
 * driver the subgraph carries, not just the one that won the naming, so a wire
 * labelled both "VCCA" and "VRH" pulls in whatever else is called "VRH".
 */
describe('same-sheet absorption', () => {
  const twoWires = (a: string[], b: string[]) => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(0, 20), at(20, 20))],
      labels: [
        ...a.map((t, i) => makeLabel('label', t, at(i * 5, 0))),
        ...b.map((t, i) => makeLabel('label', t, at(i * 5, 20))),
      ],
    }).apply(sch);
    return { sch, nl: computeNetlist(sch, libMap(sch)) };
  };

  it('joins two disconnected wires that carry the same label', () => {
    const { nl } = twoWires(['CLK'], ['CLK']);
    expect(nl.nets).toHaveLength(1);
    expect(nl.nets[0]!.name).toBe('/CLK');
  });

  it('leaves differently-named wires alone', () => {
    const { nl } = twoWires(['CLK'], ['RST']);
    expect(nl.nets.map((n) => n.name).sort()).toEqual(['/CLK', '/RST']);
  });

  it('matches on a secondary driver, not just the winning name', () => {
    // The first wire is named "/VCCA" (alphabetically first of its two labels),
    // but it answers to "VRH" too, so the second wire joins it.
    const { sch, nl } = twoWires(['VCCA', 'VRH'], ['VRH']);
    expect(nl.nets).toHaveLength(1);
    expect(nl.nets[0]!.name).toBe('/VCCA');
    expect(nl.nets[0]!.items).toContain(refId('line', sch.lines[1]!.uuid, 1));
  });

  it('does not absorb across a weak driver', () => {
    // A net named only by a pin auto-name is not a strong driver, so it never
    // takes part (upstream's m_strong_driver gate).
    let sch = EMPTY();
    sch = placeSymbol(R, at(0, 0)).apply(sch);
    sch = addItems({ lines: [makeWire(at(0, -3.81), at(20, -3.81))] }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets.every((n) => n.driverPriority < 3 || n.name.startsWith('/'))).toBe(true);
  });
});

/** CONNECTION_SUBGRAPH::driverName escapes a label for use as a net name. */
describe('net-name escaping', () => {
  it('escapes a slash in a label, as EscapeString CTX_NETNAME does', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [makeLabel('label', 'CLKIN/EXTAL', at(0, 0))],
    }).apply(sch);
    const { nets } = computeNetlist(sch, libMap(sch));
    expect(nets[0]!.name).toBe('/CLKIN{slash}EXTAL');
    expect(nets[0]!.localName).toBe('CLKIN{slash}EXTAL');
  });
});
