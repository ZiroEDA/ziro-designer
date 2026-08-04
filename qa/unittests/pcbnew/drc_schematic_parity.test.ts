// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB to schematic parity.
 * Counterpart: `drc_test_provider_schematic_parity.cpp`.
 *
 * These run only when a netlist is supplied — with no schematic there is
 * nothing to be out of parity with, which is upstream's behaviour too.
 *
 * The `board_only` attribute is what makes the check usable: fiducials,
 * mounting hardware and test points live on the PCB by design and have no
 * symbol. Without honouring it, every real board reports a row of extras.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { COMPONENT, NETLIST } from '@ziroeda/pcbnew/src/netlist_reader/pcb_netlist.js';
import type { Board, PcbFootprint, PcbPad } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const pad = (number: string, net: number): PcbPad => ({
  number,
  type: 'smd',
  shape: 'rect',
  at: { x: MM(5), y: MM(5) },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
  net,
  source: EMPTY,
});

const fp = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'Lib:R_0603',
  reference: 'R1',
  value: '10k',
  at: { x: MM(5), y: MM(5) },
  angle: 0,
  layer: 'F.Cu',
  pads: [],
  shapes: [],
  texts: [],
  models: [],
  attributes: ['allow_missing_courtyard'],
  source: EMPTY,
  ...over,
});

const board = (footprints: PcbFootprint[], nets: [number, string][] = []): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, ''], ...nets]),
  footprints,
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  groups: [],
  source: EMPTY,
});

/** One symbol, with whatever pin/net pairs the caller wants. */
const component = (
  ref: string,
  value: string,
  fpid: string,
  nets: [string, string][] = [],
  props: string[] = [],
): COMPONENT => {
  const c = new COMPONENT(fpid, ref, value, '/', []);
  for (const [pin, net] of nets) c.AddNet(pin, net, '', '');
  for (const p of props) c.GetProperties().set(p, '');
  return c;
};

const netlistOf = (...cs: COMPONENT[]): NETLIST => {
  const n = new NETLIST();
  for (const c of cs) n.AddComponent(c);
  return n;
};

const OPTS: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const codes = (b: Board, netlist: NETLIST | undefined, code: string) =>
  runDrc(b, { ...OPTS, netlist }).filter((v) => v.code === code);

describe('no netlist', () => {
  it('runs none of the parity checks', () => {
    const b = board([fp(), fp({ reference: 'R1' })]);

    for (const code of ['duplicate_footprints', 'missing_footprint', 'extra_footprint'])
      expect(codes(b, undefined, code)).toHaveLength(0);
  });
});

describe('missing and extra footprints', () => {
  it('reports a symbol with no footprint on the board', () => {
    const v = codes(
      board([]),
      netlistOf(component('R1', '10k', 'Lib:R_0603')),
      'missing_footprint',
    );

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('R1');
    expect(v[0]!.message).toContain('10k');
  });

  it('reports a footprint no symbol accounts for', () => {
    const v = codes(board([fp()]), netlistOf(), 'extra_footprint');

    expect(v).toHaveLength(1);
  });

  it('excuses a board_only footprint from being extra', () => {
    // Fiducials and mounting hardware live on the PCB by design.
    const only = fp({ attributes: ['board_only', 'allow_missing_courtyard'] });

    expect(codes(board([only]), netlistOf(), 'extra_footprint')).toHaveLength(0);
  });

  it('says nothing when the two agree', () => {
    const b = board([fp()]);
    const n = netlistOf(component('R1', '10k', 'Lib:R_0603'));

    expect(codes(b, n, 'missing_footprint')).toHaveLength(0);
    expect(codes(b, n, 'extra_footprint')).toHaveLength(0);
  });
});

describe('duplicate footprints', () => {
  it('reports two footprints sharing a reference', () => {
    const b = board([fp(), fp()]);

    expect(
      codes(b, netlistOf(component('R1', '10k', 'Lib:R_0603')), 'duplicate_footprints'),
    ).toHaveLength(1);
  });

  it('compares references without case', () => {
    const b = board([fp(), fp({ reference: 'r1' })]);

    expect(codes(b, netlistOf(), 'duplicate_footprints')).toHaveLength(1);
  });

  it('excuses a board_only duplicate', () => {
    const b = board([fp(), fp({ attributes: ['board_only'] })]);

    expect(codes(b, netlistOf(), 'duplicate_footprints')).toHaveLength(0);
  });
});

describe('attribute and value parity', () => {
  const withSymbol = (c: COMPONENT, f = fp()) =>
    codes(board([f]), netlistOf(c), 'footprint_symbol_mismatch');

  it('reports a value that differs from the symbol', () => {
    const v = withSymbol(component('R1', '22k', 'Lib:R_0603'));

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('22k');
  });

  it('reports a footprint id that differs from the symbol', () => {
    const v = withSymbol(component('R1', '10k', 'Lib:R_0805'));

    expect(v[0]!.message).toContain('R_0805');
  });

  it('reports a DNP flag set on one side only', () => {
    const v = withSymbol(component('R1', '10k', 'Lib:R_0603', [], ['dnp']));

    expect(v.some((x) => x.message.includes('Do not populate'))).toBe(true);
  });

  it('accepts a DNP flag set on both sides', () => {
    const dnp = fp({ attributes: ['dnp', 'allow_missing_courtyard'] });
    const v = withSymbol(component('R1', '10k', 'Lib:R_0603', [], ['dnp']), dnp);

    expect(v.some((x) => x.message.includes('Do not populate'))).toBe(false);
  });

  it('reports an exclude-from-BOM flag set on one side only', () => {
    const v = withSymbol(component('R1', '10k', 'Lib:R_0603', [], ['exclude_from_bom']));

    expect(v.some((x) => x.message.includes('bill of materials'))).toBe(true);
  });
});

describe('custom field parity', () => {
  const withFields = (symbolFields: [string, string][], boardFields: [string, string][]) => {
    const c = component('R1', '10k', 'Lib:R_0603');
    for (const [k, v] of symbolFields) c.GetFields().set(k, v);

    const f = fp({
      fields: boardFields.map(([name, value]) => ({ name, value, source: EMPTY })),
    });

    return codes(board([f]), netlistOf(c), 'footprint_symbol_field_mismatch');
  };

  it('reports a symbol field the footprint does not carry', () => {
    const v = withFields([['MPN', 'ABC123']], []);

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("Missing symbol field 'MPN'");
  });

  it('reports a field whose value differs', () => {
    const v = withFields([['MPN', 'ABC123']], [['MPN', 'XYZ789']]);

    expect(v[0]!.message).toContain("Field 'MPN' differs");
    expect(v[0]!.message).toContain('XYZ789');
    expect(v[0]!.message).toContain('ABC123');
  });

  it('accepts fields that agree', () => {
    expect(withFields([['MPN', 'ABC123']], [['MPN', 'ABC123']])).toHaveLength(0);
  });

  it('ignores extra fields the footprint carries but the symbol does not', () => {
    // The comparison is symbol-driven: the schematic is the source of truth,
    // and a footprint may legitimately carry more.
    expect(withFields([], [['Internal', 'x']])).toHaveLength(0);
  });

  it('does not treat Reference, Value or Footprint as user fields', () => {
    // Those three are compared as their own things, not as custom fields.
    const v = withFields(
      [
        ['Reference', 'R99'],
        ['Value', '47k'],
        ['Footprint', 'Other:Thing'],
      ],
      [],
    );

    expect(v).toHaveLength(0);
  });

  it('reports only the first mismatch, not one per field', () => {
    const v = withFields(
      [
        ['A', '1'],
        ['B', '2'],
        ['C', '3'],
      ],
      [],
    );

    expect(v).toHaveLength(1);
  });
});

describe('net conflicts', () => {
  const withPads = (pads: PcbPad[], c: COMPONENT, nets: [number, string][]) =>
    codes(board([fp({ pads })], nets), netlistOf(c), 'net_conflict');

  it('reports a pad whose net differs from the schematic', () => {
    const v = withPads([pad('1', 1)], component('R1', '10k', 'Lib:R_0603', [['1', 'VCC']]), [
      [1, 'GND'],
    ]);

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('VCC');
  });

  it('accepts a pad whose net matches', () => {
    const v = withPads([pad('1', 1)], component('R1', '10k', 'Lib:R_0603', [['1', 'GND']]), [
      [1, 'GND'],
    ]);

    expect(v).toHaveLength(0);
  });

  it('reports a pad with no net where the schematic gives one', () => {
    const v = withPads([pad('1', 0)], component('R1', '10k', 'Lib:R_0603', [['1', 'GND']]), []);

    expect(v[0]!.message).toContain('Pad missing net');
  });

  it('reports a padded net with no matching pin in the schematic', () => {
    const v = withPads([pad('1', 1)], component('R1', '10k', 'Lib:R_0603'), [[1, 'GND']]);

    expect(v[0]!.message).toContain('No corresponding pin');
  });

  it('reports a schematic pin with no pad in the footprint', () => {
    const v = withPads([], component('R1', '10k', 'Lib:R_0603', [['3', 'GND']]), []);

    expect(v.some((x) => x.message.includes('schematic pin 3'))).toBe(true);
  });

  it('treats an unconnected- board net as matching its schematic stem', () => {
    // A no-connect pin gets a generated name, and the board carries a longer
    // form of it. Comparing the strings directly reports every one of them.
    const v = withPads(
      [pad('1', 1)],
      component('R1', '10k', 'Lib:R_0603', [['1', 'unconnected-(R1-Pad1)']]),
      [[1, 'unconnected-(R1-Pad1)-extended']],
    );

    expect(v).toHaveLength(0);
  });

  it('treats a suffixed board net as matching its schematic stem', () => {
    const v = withPads([pad('1', 1)], component('R1', '10k', 'Lib:R_0603', [['1', 'GND']]), [
      [1, 'GND_1'],
    ]);

    expect(v).toHaveLength(0);
  });
});
