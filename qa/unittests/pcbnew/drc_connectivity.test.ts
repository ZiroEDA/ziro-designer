// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The connectivity checks: unconnected items, dangling tracks, dangling vias.
 * Counterpart: `drc_test_provider_connectivity.cpp` and
 * `CONNECTIVITY_DATA::TestTrackEndpointDangling`.
 *
 * The dangling test is the fiddly one, and upstream says why: "be wary of
 * short segments which can be connected to the *same* other item on each end".
 * A fat, short track is covered end-to-end by everything it touches, so the
 * question of which end a hit belongs to is decided by distance to the
 * neighbour's nearest *endpoint*, not to its shape.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbFootprint, PcbPad, PcbTrack, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const track = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  over: Partial<PcbTrack> = {},
): PcbTrack => ({
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.25),
  layer: 'F.Cu',
  net: 1,
  source: EMPTY,
  ...over,
});

const via = (x: number, y: number, over: Partial<PcbVia> = {}): PcbVia => ({
  at: { x: MM(x), y: MM(y) },
  size: MM(0.6),
  drill: MM(0.3),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  source: EMPTY,
  ...over,
});

const pad = (x: number, y: number, over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: { x: MM(x), y: MM(y) },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
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
  groups: [],
  source: EMPTY,
  ...over,
});

const BASE: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const codes = (b: Board, code: string) => runDrc(b, BASE).filter((v) => v.code === code);

describe('unconnected items', () => {
  it('reports a net whose two pads are not joined', () => {
    const b = board({ footprints: [fp([pad(0, 0), pad(20, 0, { number: '2' })])] });

    expect(codes(b, 'unconnected_items')).toHaveLength(1);
  });

  it('says nothing once a track joins them', () => {
    const b = board({
      footprints: [fp([pad(0, 0), pad(20, 0, { number: '2' })])],
      tracks: [track(0, 0, 20, 0)],
    });

    expect(codes(b, 'unconnected_items')).toHaveLength(0);
  });

  it('ignores items with no net', () => {
    const b = board({
      footprints: [fp([pad(0, 0, { net: 0 }), pad(20, 0, { number: '2', net: 0 })])],
    });

    expect(codes(b, 'unconnected_items')).toHaveLength(0);
  });
});

describe('dangling tracks', () => {
  it('reports a track that reaches nothing at one end', () => {
    const b = board({
      footprints: [fp([pad(0, 0)])],
      tracks: [track(0, 0, 20, 0)],
    });

    const v = codes(b, 'track_dangling');
    expect(v).toHaveLength(1);
    // The marker sits on the loose end, not the connected one.
    expect(v[0]!.pos).toEqual({ x: MM(20), y: 0 });
  });

  it('says nothing when both ends land on copper', () => {
    const b = board({
      footprints: [fp([pad(0, 0), pad(20, 0, { number: '2' })])],
      tracks: [track(0, 0, 20, 0)],
    });

    expect(codes(b, 'track_dangling')).toHaveLength(0);
  });

  it('does not connect a track to copper on another layer', () => {
    const b = board({
      footprints: [fp([pad(0, 0), pad(20, 0, { number: '2', layers: ['B.Cu'] })])],
      tracks: [track(0, 0, 20, 0)],
    });

    expect(codes(b, 'track_dangling')).toHaveLength(1);
  });

  it('does not connect a track to copper on another net', () => {
    const b = board({
      footprints: [fp([pad(0, 0), pad(20, 0, { number: '2', net: 2 })])],
      tracks: [track(0, 0, 20, 0)],
    });

    expect(codes(b, 'track_dangling')).toHaveLength(1);
  });

  it('leaves a short fat stub alone when a neighbour meets each end', () => {
    // The regression this whole check turns on: a track shorter than its own
    // width is covered end-to-end by both neighbours, so a shape-distance test
    // ties and credits both hits to the same end. Upstream measures to the
    // neighbour's nearest *endpoint* instead, which separates them.
    // Pads anchor the far ends so the stub is the only thing in question.
    const b = board({
      footprints: [fp([pad(9, 9), pad(12, 10, { number: '2' })])],
      tracks: [
        track(10, 10, 10.1, 10, { width: MM(0.8) }),
        track(9, 9, 10, 10, { width: MM(0.8) }),
        track(10.1, 10, 12, 10, { width: MM(0.8) }),
      ],
    });

    expect(codes(b, 'track_dangling')).toHaveLength(0);
  });

  it('still reports a short stub that only touches one neighbour', () => {
    // The other half of upstream's warning: if the same item is its only
    // connection, it *is* dangling.
    const b = board({
      footprints: [fp([pad(9, 9)])],
      tracks: [
        track(10, 10, 10.1, 10, { width: MM(0.8) }),
        track(9, 9, 10, 10, { width: MM(0.8) }),
      ],
    });

    const v = codes(b, 'track_dangling');
    expect(v).toHaveLength(1);
    expect(v[0]!.pos).toEqual({ x: MM(10.1), y: MM(10) });
  });

  it('treats a track buried in one pad as connected, not dangling', () => {
    // aIgnoreTracksInPads: both ends under a single pad is deliberate wiring,
    // not a loose end.
    const b = board({
      footprints: [fp([pad(0, 0, { size: { x: MM(4), y: MM(4) } })])],
      tracks: [track(-1, 0, 1, 0)],
    });

    expect(codes(b, 'track_dangling')).toHaveLength(0);
  });

  it('treats a track with both ends in a zone as redundant, not dangling', () => {
    const b = board({
      tracks: [track(2, 2, 8, 2)],
      zones: [
        {
          net: 1,
          layers: ['F.Cu'],
          outline: [
            { x: 0, y: 0 },
            { x: MM(10), y: 0 },
            { x: MM(10), y: MM(10) },
            { x: 0, y: MM(10) },
          ],
          fills: [
            {
              layer: 'F.Cu',
              polys: [
                [
                  { x: 0, y: 0 },
                  { x: MM(10), y: 0 },
                  { x: MM(10), y: MM(10) },
                  { x: 0, y: MM(10) },
                ],
              ],
            },
          ],
          source: EMPTY,
        },
      ],
    });

    expect(codes(b, 'track_dangling')).toHaveLength(0);
  });
});

describe('dangling vias', () => {
  it('reports a via connected on only one layer', () => {
    const b = board({ vias: [via(5, 5)], tracks: [track(5, 5, 15, 5, { layer: 'F.Cu' })] });

    expect(codes(b, 'via_dangling')).toHaveLength(1);
  });

  it('says nothing once it connects on both', () => {
    const b = board({
      vias: [via(5, 5)],
      tracks: [track(5, 5, 15, 5, { layer: 'F.Cu' }), track(5, 5, 15, 15, { layer: 'B.Cu' })],
    });

    expect(codes(b, 'via_dangling')).toHaveLength(0);
  });

  it('reports a via that connects to nothing at all', () => {
    expect(codes(board({ vias: [via(5, 5)] }), 'via_dangling')).toHaveLength(1);
  });

  it('excuses an unconnected via with no net', () => {
    // "No connections AND no-net is not an error."
    expect(codes(board({ vias: [via(5, 5, { net: 0 })] }), 'via_dangling')).toHaveLength(0);
  });
});
