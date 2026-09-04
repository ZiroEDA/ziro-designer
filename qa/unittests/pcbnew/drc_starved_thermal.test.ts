// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Starved thermals: a thermally-relieved pad the pour could only reach with
 * too few spokes. Counterpart: `drc_test_provider_zone_connections.cpp`.
 *
 * Spokes are counted geometrically rather than looked up. The pad outline
 * inflated by *half* the thermal gap sits in the middle of the relief ring, so
 * a spoke crossing that ring cuts the outline twice — which is why the count is
 * intersections / 2.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbFootprint, PcbPad, PcbZone } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/**
 * A pour plus `count` spoke polygons bridging the relief ring into the pad.
 *
 * The spokes are separate polygons rather than part of a fractured outer ring.
 * Either shape crosses the inflated pad outline the same way, and separate
 * polygons make the count obvious from reading the fixture.
 */
const pourWithSpokes = (count: number): { x: number; y: number }[][] => {
  // The pad sits at (10, 10), 2 mm square, with a 1 mm relief gap: the opening
  // runs from 8.5 to 11.5.
  const outer = [
    { x: MM(0), y: MM(0) },
    { x: MM(20), y: MM(0) },
    { x: MM(20), y: MM(20) },
    { x: MM(0), y: MM(20) },
  ];

  // Each spoke is its own little bridge polygon from the pour into the pad.
  const spokes: { x: number; y: number }[][] = [];
  const arms = [
    [
      { x: MM(11.5), y: MM(9.8) },
      { x: MM(13), y: MM(9.8) },
      { x: MM(13), y: MM(10.2) },
      { x: MM(11.5), y: MM(10.2) },
    ],
    [
      { x: MM(7), y: MM(9.8) },
      { x: MM(8.5), y: MM(9.8) },
      { x: MM(8.5), y: MM(10.2) },
      { x: MM(7), y: MM(10.2) },
    ],
    [
      { x: MM(9.8), y: MM(11.5) },
      { x: MM(10.2), y: MM(11.5) },
      { x: MM(10.2), y: MM(13) },
      { x: MM(9.8), y: MM(13) },
    ],
    [
      { x: MM(9.8), y: MM(7) },
      { x: MM(10.2), y: MM(7) },
      { x: MM(10.2), y: MM(8.5) },
      { x: MM(9.8), y: MM(8.5) },
    ],
  ];

  for (let i = 0; i < count; i++) spokes.push(arms[i]!);

  return [outer, ...spokes];
};

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: { x: MM(10), y: MM(10) },
  angle: 0,
  size: { x: MM(2), y: MM(2) },
  layers: ['F.Cu'],
  net: 1,
  source: EMPTY,
  ...over,
});

const fp = (pads: PcbPad[], over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'L:F',
  reference: 'U1',
  at: { x: MM(10), y: MM(10) },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  points: [],
  models: [],
  attributes: ['allow_missing_courtyard'],
  source: EMPTY,
  ...over,
});

const zone = (polys: { x: number; y: number }[][], over: Partial<PcbZone> = {}): PcbZone => ({
  net: 1,
  layers: ['F.Cu'],
  fills: [{ layer: 'F.Cu', polys }],
  outline: [
    { x: MM(0), y: MM(0) },
    { x: MM(20), y: MM(0) },
    { x: MM(20), y: MM(20) },
    { x: MM(0), y: MM(20) },
  ],
  padConnection: 'thermal',
  thermalGap: MM(1),
  islandRemovalMode: 'always',
  source: EMPTY,
  ...over,
});

const board = (zones: PcbZone[], footprints: PcbFootprint[]): Board => ({
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
  footprints,
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

const opts = (minResolvedSpokes = 2): DrcOptions => ({
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
  minResolvedSpokes,
});

const starved = (b: Board, o = opts()) => runDrc(b, o).filter((v) => v.code === 'starved_thermal');

describe('starved thermals', () => {
  it('reports a pad the pour reaches with only one spoke', () => {
    const b = board([zone(pourWithSpokes(1))], [fp([pad()])]);

    expect(starved(b)).toHaveLength(1);
  });

  it('accepts a pad with the required two', () => {
    const b = board([zone(pourWithSpokes(2))], [fp([pad()])]);

    expect(starved(b)).toHaveLength(0);
  });

  it('honours a higher required count', () => {
    const b = board([zone(pourWithSpokes(2))], [fp([pad()])]);

    expect(starved(b, opts(4))).toHaveLength(1);
    expect(starved(board([zone(pourWithSpokes(4))], [fp([pad()])]), opts(4))).toHaveLength(0);
  });

  it('is off entirely when the required count is zero', () => {
    const b = board([zone(pourWithSpokes(1))], [fp([pad()])]);

    expect(starved(b, opts(0))).toHaveLength(0);
  });

  it('says nothing about a pad the pour does not reach at all', () => {
    // No spokes is a connectivity question, not a thermal one.
    const b = board([zone(pourWithSpokes(0))], [fp([pad()])]);

    expect(starved(b)).toHaveLength(0);
  });

  it('ignores a pad that is not thermally relieved', () => {
    const b = board([zone(pourWithSpokes(1), { padConnection: 'full' })], [fp([pad()])]);

    expect(starved(b)).toHaveLength(0);
  });

  it('lets the pad’s own zone connection override the zone’s', () => {
    // Pad beats footprint beats zone.
    const solid = pad({ zoneConnection: 'full' });
    const b = board([zone(pourWithSpokes(1))], [fp([solid])]);

    expect(starved(b)).toHaveLength(0);
  });

  it('lets the footprint’s setting override the zone’s', () => {
    const b = board([zone(pourWithSpokes(1))], [fp([pad()], { zoneConnection: 'full' })]);

    expect(starved(b)).toHaveLength(0);
  });

  it('treats an inherited pad setting as deferring, not as solid', () => {
    const inherited = pad({ zoneConnection: 'inherited' });
    const b = board([zone(pourWithSpokes(1))], [fp([inherited])]);

    expect(starved(b)).toHaveLength(1);
  });

  it('ignores a pad on another net', () => {
    const b = board([zone(pourWithSpokes(1))], [fp([pad({ net: 2 })])]);

    expect(starved(b)).toHaveLength(0);
  });

  it('ignores a pad that is not on the fill’s layer', () => {
    const b = board([zone(pourWithSpokes(1))], [fp([pad({ layers: ['B.Cu'] })])]);

    expect(starved(b)).toHaveLength(0);
  });

  it('says nothing about a rule area, which pours nothing', () => {
    const keepout = {
      tracks: false,
      vias: false,
      pads: false,
      copperPour: true,
      footprints: false,
    };
    const b = board([zone(pourWithSpokes(1), { ruleArea: keepout })], [fp([pad()])]);

    expect(starved(b)).toHaveLength(0);
  });
});
