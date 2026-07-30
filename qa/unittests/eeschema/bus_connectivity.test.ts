// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Bus connectivity in the netlist: bus subgraphs form from bus lines + labels,
 * wire-to-bus entries carry their wire's net, and member nets join ACROSS a
 * bus (CONNECTION_GRAPH's bus neighbor propagation).
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';

const doc = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20230121) (generator eeschema) ${body})`));

// A bus running along y=0 with two entries dropping to wires at y=10; each
// wire carries a local label. Geometry (mm): bus 0,0 -> 60,0; entries at
// x=10 and x=40 (2.54mm 45-degree stubs), wires below them.
const BUS_WITH_TWO_TAPS = (busLabel: string, left: string, right: string) => `
  (bus (pts (xy 0 0) (xy 60 0)) (uuid "b1"))
  (label "${busLabel}" (at 30 0 0) (uuid "bl"))
  (bus_entry (at 10 0) (size 2.54 2.54) (uuid "e1"))
  (bus_entry (at 40 0) (size 2.54 2.54) (uuid "e2"))
  (wire (pts (xy 12.54 2.54) (xy 12.54 10)) (uuid "w1"))
  (wire (pts (xy 42.54 2.54) (xy 42.54 10)) (uuid "w2"))
  (label "${left}" (at 12.54 10 0) (uuid "l1"))
  (label "${right}" (at 42.54 10 0) (uuid "l2"))`;

describe('bus connectivity', () => {
  it('joins same-member nets across a vector bus', () => {
    const nl = computeNetlist(doc(BUS_WITH_TWO_TAPS('D[0..3]', 'D0', 'D0')), new Map());
    const d0 = nl.nets.filter((n) => n.name === '/D0');
    expect(d0.length).toBe(1); // one net spanning both taps
    expect(d0[0]!.items).toContain('w1');
    expect(d0[0]!.items).toContain('w2');
  });

  it('keeps different members apart', () => {
    const nl = computeNetlist(doc(BUS_WITH_TWO_TAPS('D[0..3]', 'D0', 'D1')), new Map());
    expect(nl.nets.filter((n) => n.name === '/D0').length).toBe(1);
    expect(nl.nets.filter((n) => n.name === '/D1').length).toBe(1);
  });

  it('does not join a net that is not a member of the bus', () => {
    const nl = computeNetlist(doc(BUS_WITH_TWO_TAPS('D[0..3]', 'CLK', 'CLK')), new Map());
    // CLK is no member of D[0..3]: the two taps stay separate nets.
    expect(nl.nets.filter((n) => n.name === '/CLK').length).toBe(2);
  });

  it('exposes the bus subgraph with its expanded members', () => {
    const nl = computeNetlist(doc(BUS_WITH_TWO_TAPS('D[0..1]', 'D0', 'D1')), new Map());
    expect(nl.buses.length).toBe(1);
    expect(nl.buses[0]!.name).toBe('D[0..1]');
    expect(nl.buses[0]!.members).toEqual(['D0', 'D1']);
    expect(nl.buses[0]!.items).toContain('b1');
    expect(nl.buses[0]!.items).toContain('e1');
  });

  it('expands alias group buses via the provided alias map', () => {
    const aliases = new Map<string, readonly string[]>([['MEM', ['D0', 'WE']]]);
    const nl = computeNetlist(doc(BUS_WITH_TWO_TAPS('{MEM}', 'WE', 'WE')), new Map(), {
      busAliases: aliases,
    });
    expect(nl.buses[0]!.members).toEqual(['D0', 'WE']);
    expect(nl.nets.filter((n) => n.name === '/WE').length).toBe(1); // joined
  });

  it('a bus label does not create a stray wire net', () => {
    const nl = computeNetlist(doc(BUS_WITH_TWO_TAPS('D[0..3]', 'D0', 'D1')), new Map());
    expect(nl.nets.some((n) => n.name === '/D[0..3]')).toBe(false);
  });

  it('bus segments joined end-to-end share one subgraph', () => {
    const nl = computeNetlist(
      doc(`
        (bus (pts (xy 0 0) (xy 30 0)) (uuid "b1"))
        (bus (pts (xy 30 0) (xy 60 0)) (uuid "b2"))
        (label "A[0..1]" (at 10 0 0) (uuid "bl"))`),
      new Map(),
    );
    expect(nl.buses.length).toBe(1);
    expect(nl.buses[0]!.name).toBe('A[0..1]');
  });
});
