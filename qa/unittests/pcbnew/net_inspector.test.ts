// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Net Inspector's rows.
 * Counterpart: `PCB_NET_INSPECTOR_PANEL` and its data model.
 *
 * The counting columns only. Upstream's four length columns are measured with
 * its optimised-path length calculator and are deliberately absent here — a
 * length that quietly disagrees with the one KiCad shows for the same board is
 * worse than a column that is honestly missing.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { netInspectorRows, netInspectorSummary } from '@ziroeda/pcbnew/src/net_inspector.js';
import type { Board, PcbPad } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const pad = (number: string, net: number): PcbPad => ({
  number,
  type: 'smd',
  shape: 'rect',
  at: { x: 0, y: 0 },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
  net,
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'GND'],
    [2, 'VCC'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  groups: [],
  source: EMPTY,
  ...over,
});

const track = (net: number) => ({
  start: { x: 0, y: 0 },
  end: { x: MM(10), y: 0 },
  width: MM(0.2),
  layer: 'F.Cu',
  net,
  source: EMPTY,
});

const via = (net: number) => ({
  at: { x: MM(3), y: 0 },
  size: MM(0.6),
  drill: MM(0.3),
  layers: ['F.Cu', 'B.Cu'] as [string, string],
  kind: 'through' as const,
  net,
  source: EMPTY,
});

const fp = (pads: PcbPad[]) => ({
  lib: 'L:R',
  reference: 'R1',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  models: [],
  source: EMPTY,
});

describe('rows', () => {
  it('lists one row per real net', () => {
    const rows = netInspectorRows(board());

    expect(rows.map((r) => r.name)).toEqual(['GND', 'VCC']);
  });

  it('excludes the unconnected pseudo-net', () => {
    // Net 0 is not something a user assigns a netclass to or routes.
    expect(netInspectorRows(board()).some((r) => r.net === 0)).toBe(false);
  });

  it('lists a net that has no copper on it at all', () => {
    // An unrouted net with zero of everything is exactly what the panel is
    // used to find, so it must not be omitted for having nothing.
    const rows = netInspectorRows(board());

    expect(rows.find((r) => r.name === 'VCC')).toMatchObject({
      padCount: 0,
      viaCount: 0,
      trackCount: 0,
    });
  });

  it('counts pads, vias and tracks per net', () => {
    const b = board({
      footprints: [fp([pad('1', 1), pad('2', 1), pad('3', 2)])],
      tracks: [track(1), track(1)],
      vias: [via(1)],
    });
    const gnd = netInspectorRows(b).find((r) => r.name === 'GND');

    expect(gnd).toMatchObject({ padCount: 2, viaCount: 1, trackCount: 2 });
  });

  it('counts arcs as tracks', () => {
    const b = board({
      arcs: [
        {
          start: { x: 0, y: 0 },
          mid: { x: MM(5), y: MM(1) },
          end: { x: MM(10), y: 0 },
          width: MM(0.2),
          layer: 'F.Cu',
          net: 1,
          source: EMPTY,
        },
      ],
    });

    expect(netInspectorRows(b).find((r) => r.name === 'GND')?.trackCount).toBe(1);
  });

  it('keeps each net’s counts separate', () => {
    const b = board({ tracks: [track(1), track(2), track(2)] });
    const rows = netInspectorRows(b);

    expect(rows.find((r) => r.name === 'GND')?.trackCount).toBe(1);
    expect(rows.find((r) => r.name === 'VCC')?.trackCount).toBe(2);
  });

  it('joins every netclass the net belongs to', () => {
    const rows = netInspectorRows(board(), (n) => (n === 'GND' ? ['Default', 'Power'] : []));

    expect(rows.find((r) => r.name === 'GND')?.netclass).toBe('Default, Power');
  });

  it('sorts by name, not by net code', () => {
    // Nets are looked up by name far more often than by the code the file
    // happened to assign.
    const b = board({
      nets: new Map([
        [0, ''],
        [1, 'ZZZ'],
        [2, 'AAA'],
      ]),
    });

    expect(netInspectorRows(b).map((r) => r.name)).toEqual(['AAA', 'ZZZ']);
  });
});

describe('summary', () => {
  it('counts a net with pads but no copper as unrouted', () => {
    const b = board({ footprints: [fp([pad('1', 1), pad('2', 1)])] });

    expect(netInspectorSummary(netInspectorRows(b))).toMatchObject({ nets: 2, unrouted: 1 });
  });

  it('does not count a routed net as unrouted', () => {
    const b = board({ footprints: [fp([pad('1', 1), pad('2', 1)])], tracks: [track(1)] });

    expect(netInspectorSummary(netInspectorRows(b)).unrouted).toBe(0);
  });

  it('does not call a single-pad net unrouted', () => {
    // One pad has nothing to connect to; that is not a missing connection.
    const b = board({ footprints: [fp([pad('1', 1)])] });

    expect(netInspectorSummary(netInspectorRows(b)).unrouted).toBe(0);
  });

  it('does not call a net with no pads unrouted', () => {
    // A stray net entry with nothing on it is not an unrouted connection.
    expect(netInspectorSummary(netInspectorRows(board())).unrouted).toBe(0);
  });

  it('counts a net joined only by vias as routed', () => {
    const b = board({ footprints: [fp([pad('1', 1), pad('2', 1)])], vias: [via(1)] });

    expect(netInspectorSummary(netInspectorRows(b)).unrouted).toBe(0);
  });
});
