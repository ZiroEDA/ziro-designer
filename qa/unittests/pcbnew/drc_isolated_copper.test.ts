// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Isolated copper: an island of zone fill that reaches nothing on its net.
 * Counterpart: the "starved zones" pass of
 * `drc_test_provider_connectivity.cpp`.
 *
 * Upstream reports from `m_ZoneIsolatedIslandsMap`, which holds the islands the
 * *filler kept*. Under ISLAND_REMOVAL_MODE ALWAYS — the default — the filler
 * removed them all, so there is nothing left to report; only a zone set to
 * NEVER or AREA can have one.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbTrack, PcbZone } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: MM(x0), y: MM(y0) },
  { x: MM(x1), y: MM(y0) },
  { x: MM(x1), y: MM(y1) },
  { x: MM(x0), y: MM(y1) },
];

/** A zone whose fill is whatever polygons the caller gives it. */
const zone = (polys: ReturnType<typeof box>[], over: Partial<PcbZone> = {}): PcbZone => ({
  net: 1,
  layers: ['F.Cu'],
  fills: [{ layer: 'F.Cu', polys }],
  outline: box(0, 0, 100, 100),
  islandRemovalMode: 'never',
  source: EMPTY,
  ...over,
});

const track = (x0: number, y0: number, x1: number, y1: number, net = 1): PcbTrack => ({
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.2),
  layer: 'F.Cu',
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
    [1, 'N1'],
    [2, 'N2'],
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
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
  ...over,
});

const OPTS: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const isolated = (b: Board) => runDrc(b, OPTS).filter((v) => v.code === 'isolated_copper');

describe('isolated copper', () => {
  it('reports a fill island that touches nothing on its net', () => {
    const b = board({ zones: [zone([box(0, 0, 10, 10)])] });

    expect(isolated(b)).toHaveLength(1);
  });

  it('says nothing once a same-net track reaches it', () => {
    const b = board({ zones: [zone([box(0, 0, 10, 10)])], tracks: [track(5, 5, 20, 20)] });

    expect(isolated(b)).toHaveLength(0);
  });

  it('does not count a track of another net as a connection', () => {
    const b = board({ zones: [zone([box(0, 0, 10, 10)])], tracks: [track(5, 5, 20, 20, 2)] });

    expect(isolated(b)).toHaveLength(1);
  });

  it('does not let a zone’s own islands vouch for each other', () => {
    // Two disjoint halves of one pour, one of them connected. Without the
    // self-exclusion the unconnected half would count the connected one as
    // its neighbour and neither would be reported.
    const b = board({
      zones: [zone([box(0, 0, 10, 10), box(50, 50, 60, 60)])],
      tracks: [track(5, 5, 8, 8)],
    });

    const v = isolated(b);
    expect(v).toHaveLength(1);
    expect(v[0]!.pos).toEqual({ x: MM(50), y: MM(50) });
  });

  it('is skipped entirely when island removal is ALWAYS', () => {
    // The filler already dropped them, so there is nothing to report — and
    // this is the default, which is what keeps the scan off a normal board.
    const b = board({ zones: [zone([box(0, 0, 10, 10)], { islandRemovalMode: 'always' })] });

    expect(isolated(b)).toHaveLength(0);
  });

  it('runs under AREA mode as well as NEVER', () => {
    const b = board({ zones: [zone([box(0, 0, 10, 10)], { islandRemovalMode: 'area' })] });

    expect(isolated(b)).toHaveLength(1);
  });

  it('exempts a copper-thieving fill, where every stamp is an island', () => {
    const b = board({ zones: [zone([box(0, 0, 10, 10)], { fillMode: 'thieving' })] });

    expect(isolated(b)).toHaveLength(0);
  });

  it('exempts a rule area, which has no copper to isolate', () => {
    const keepout = {
      tracks: true,
      vias: false,
      pads: false,
      copperPour: false,
      footprints: false,
    };
    const b = board({ zones: [zone([box(0, 0, 10, 10)], { ruleArea: keepout })] });

    expect(isolated(b)).toHaveLength(0);
  });

  it('ignores a netless zone', () => {
    const b = board({ zones: [zone([box(0, 0, 10, 10)], { net: 0 })] });

    expect(isolated(b)).toHaveLength(0);
  });

  it('does not connect across layers', () => {
    const b = board({
      zones: [zone([box(0, 0, 10, 10)])],
      tracks: [{ ...track(5, 5, 20, 20), layer: 'B.Cu' }],
    });

    expect(isolated(b)).toHaveLength(1);
  });
});
