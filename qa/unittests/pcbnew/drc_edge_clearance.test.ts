// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copper to board edge. Counterpart: `drc_test_provider_edge_clearance.cpp`.
 *
 * Board Setup has carried a "copper to edge" value since the Board Setup work
 * and nothing consumed it. The edges themselves are the graphics on Edge.Cuts
 * and Margin, and the two are not treated alike: an Edge.Cuts stroke collapses
 * to its centreline, because the router cuts along the line the user drew, not
 * along the outside of it.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { Board, PcbFootprint, PcbPad, PcbShape, PcbTrack } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/** A vertical board edge at x, drawn wide so the centreline rule can be seen. */
const edge = (x: number, layer = 'Edge.Cuts', width = 1): PcbShape => ({
  kind: 'line',
  start: { x: MM(x), y: MM(-10) },
  end: { x: MM(x), y: MM(10) },
  width: MM(width),
  fillMode: 'none',
  layer,
  source: EMPTY,
});

const track = (x0: number, x1: number, over: Partial<PcbTrack> = {}): PcbTrack => ({
  start: { x: MM(x0), y: 0 },
  end: { x: MM(x1), y: 0 },
  width: MM(0.2),
  layer: 'F.Cu',
  net: 1,
  source: EMPTY,
  ...over,
});

const pad = (x: number, over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'thru_hole',
  shape: 'circle',
  at: { x: MM(x), y: 0 },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  drill: { oblong: false, w: MM(0.6), h: MM(0.6) },
  layers: ['*.Cu'],
  net: 1,
  source: EMPTY,
  ...over,
});

const fp = (pads: PcbPad[]): PcbFootprint => ({
  lib: 'L:F',
  reference: 'U1',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  attributes: ['allow_missing_courtyard'],
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

const opts = (minCopperToEdge: number, dru?: string): DrcOptions => ({
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
  minCopperToEdge,
  ...(dru ? { customRules: parseDrcRules(dru) } : {}),
});

const edgeErrors = (b: Board, o: DrcOptions) =>
  runDrc(b, o).filter((v) => v.code === 'copper_edge_clearance');

describe('copper to edge', () => {
  it('reports a track running too close to the edge', () => {
    // Edge at x = 10, track ends at 9.8 with a 0.1 mm half-width: 0.1 mm gap.
    const b = board({ shapes: [edge(10)], tracks: [track(0, 9.8)] });

    expect(edgeErrors(b, opts(MM(0.5)))).toHaveLength(1);
    expect(edgeErrors(b, opts(MM(0.05)))).toHaveLength(0);
  });

  it('is off when the setting is zero and the copper does not reach the edge', () => {
    const b = board({ shapes: [edge(10)], tracks: [track(0, 5)] });

    expect(edgeErrors(b, opts(0))).toHaveLength(0);
  });

  it('measures from the Edge.Cuts centreline, not the stroke', () => {
    // A 1 mm wide edge line: its drawn edge reaches x = 9.5, but the cut is at
    // x = 10. A track ending at 9.6 is 0.3 mm from the cut and would look like
    // a collision if the stroke width counted.
    const b = board({ shapes: [edge(10, 'Edge.Cuts', 1)], tracks: [track(0, 9.6)] });

    expect(edgeErrors(b, opts(MM(0.25)))).toHaveLength(0);
    expect(edgeErrors(b, opts(MM(0.5)))).toHaveLength(1);
  });

  it('keeps the stroke width on a Margin line, which is a real band', () => {
    // Same geometry on Margin: the band's own width counts, so the track is
    // already touching it.
    const b = board({ shapes: [edge(10, 'Margin', 1)], tracks: [track(0, 9.6)] });

    expect(edgeErrors(b, opts(MM(0.25)))).toHaveLength(1);
  });

  it('reports each item once however many edges it is near', () => {
    // A track between two close edges violates both; upstream reports one.
    const b = board({ shapes: [edge(9.9), edge(10.1)], tracks: [track(0, 9.95)] });

    expect(edgeErrors(b, opts(MM(0.5)))).toHaveLength(1);
  });

  it('checks pads and vias, not only tracks', () => {
    const b = board({ shapes: [edge(10)], footprints: [fp([pad(9.7)])] });

    expect(edgeErrors(b, opts(MM(0.5)))).toHaveLength(1);
  });

  it('exempts copper meeting an edge inside a castellated pad', () => {
    // A castellation is meant to be cut through.
    const plain = board({ shapes: [edge(10)], footprints: [fp([pad(10)])] });
    const cast = board({
      shapes: [edge(10)],
      footprints: [fp([pad(10, { padProperty: 'pad_prop_castellated' })])],
    });

    expect(edgeErrors(plain, opts(MM(0.5)))).toHaveLength(1);
    expect(edgeErrors(cast, opts(MM(0.5)))).toHaveLength(0);
  });

  it('lets a custom rule override the board value', () => {
    const b = board({ shapes: [edge(10)], tracks: [track(0, 9.8)] });
    const dru = `(version 1) (rule "edge" (constraint edge_clearance (min 1mm)))`;

    expect(edgeErrors(b, opts(MM(0.05)))).toHaveLength(0);
    const v = edgeErrors(b, opts(MM(0.05), dru));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("rule 'edge'");
  });

  it('says nothing on a board with no edge graphics at all', () => {
    expect(edgeErrors(board({ tracks: [track(0, 9.8)] }), opts(MM(0.5)))).toHaveLength(0);
  });

  it('reads edges drawn inside a footprint too', () => {
    const withEdge: PcbFootprint = { ...fp([]), shapes: [edge(10)] };
    const b = board({ footprints: [withEdge], tracks: [track(0, 9.8)] });

    expect(edgeErrors(b, opts(MM(0.5)))).toHaveLength(1);
  });
});
