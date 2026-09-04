// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Overlapping copper zones.
 * Counterpart: `DRC_TEST_PROVIDER_COPPER_CLEARANCE::testZonesToZones`.
 *
 * The check is narrower than "two zones overlap", and every one of the
 * narrowings matters: the filler resolves an overlap by priority, so two
 * same-net zones with *distinct* priorities are perfectly legal. Only equal
 * priorities leave the result ambiguous, which is what the marker says.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbZone } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: MM(x0), y: MM(y0) },
  { x: MM(x1), y: MM(y0) },
  { x: MM(x1), y: MM(y1) },
  { x: MM(x0), y: MM(y1) },
];

const zone = (outline: ReturnType<typeof box>, over: Partial<PcbZone> = {}): PcbZone => ({
  net: 1,
  layers: ['F.Cu'],
  fills: [],
  outline,
  priority: 0,
  source: EMPTY,
  ...over,
});

const board = (zones: PcbZone[]): Board => ({
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
  zones,
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  groups: [],
  source: EMPTY,
});

const OPTS: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const intersects = (b: Board) => runDrc(b, OPTS).filter((v) => v.code === 'zones_intersect');

describe('zones intersect', () => {
  it('reports two same-net zones of equal priority that overlap', () => {
    const b = board([zone(box(0, 0, 10, 10)), zone(box(5, 5, 15, 15))]);

    expect(intersects(b)).toHaveLength(1);
  });

  it('accepts the same overlap once the priorities differ', () => {
    // The filler resolves it: the higher priority knocks the other out.
    const b = board([zone(box(0, 0, 10, 10)), zone(box(5, 5, 15, 15), { priority: 1 })]);

    expect(intersects(b)).toHaveLength(0);
  });

  it('leaves two zones that do not overlap alone', () => {
    const b = board([zone(box(0, 0, 10, 10)), zone(box(20, 20, 30, 30))]);

    expect(intersects(b)).toHaveLength(0);
  });

  it('says nothing about zones on different nets', () => {
    // Different nets are a clearance question, not an ambiguity one.
    const b = board([zone(box(0, 0, 10, 10)), zone(box(5, 5, 15, 15), { net: 2 })]);

    expect(intersects(b)).toHaveLength(0);
  });

  it('says nothing about zones that share no layer', () => {
    const b = board([zone(box(0, 0, 10, 10)), zone(box(5, 5, 15, 15), { layers: ['B.Cu'] })]);

    expect(intersects(b)).toHaveLength(0);
  });

  it('lets rule areas overlap at will', () => {
    const keepout = {
      tracks: true,
      vias: false,
      pads: false,
      copperPour: false,
      footprints: false,
    };
    const b = board([zone(box(0, 0, 10, 10)), zone(box(5, 5, 15, 15), { ruleArea: keepout })]);

    expect(intersects(b)).toHaveLength(0);
  });

  it('tests the outlines, not the poured copper', () => {
    // Two overlapping zones are ambiguous before either is filled — and after
    // filling the overlap is exactly what the filler has resolved away.
    const b = board([zone(box(0, 0, 10, 10)), zone(box(5, 5, 15, 15))]);

    expect(b.zones.every((z) => z.fills.length === 0)).toBe(true);
    expect(intersects(b)).toHaveLength(1);
  });

  it('reports a pair once, not once per direction', () => {
    const b = board([zone(box(0, 0, 10, 10)), zone(box(5, 5, 15, 15))]);

    expect(intersects(b)).toHaveLength(1);
  });

  it('counts a zone wholly inside another as intersecting', () => {
    const b = board([zone(box(0, 0, 20, 20)), zone(box(5, 5, 10, 10))]);

    expect(intersects(b)).toHaveLength(1);
  });
});
