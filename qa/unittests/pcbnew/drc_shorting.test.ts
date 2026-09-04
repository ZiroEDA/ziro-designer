// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Shorting items and crossing tracks: the two things the clearance test is
 * supposed to say *instead of* "clearance violation".
 * Counterpart: `DRC_TEST_PROVIDER_COPPER_CLEARANCE::testSingleLayerItemAgainstItem`.
 *
 * Both are classifications rather than new geometry. Copper of two nets that
 * actually touches is a short, and two track centrelines that intersect are
 * crossing — in neither case is "how close are they" the useful answer.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbTrack } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const track = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  net: number,
  over: Partial<PcbTrack> = {},
): PcbTrack => ({
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.2),
  layer: 'F.Cu',
  net,
  source: EMPTY,
  ...over,
});

const board = (tracks: PcbTrack[], over: Partial<Board> = {}): Board => ({
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
  tracks,
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
  groups: [],
  source: EMPTY,
  ...over,
});

const OPTS: DrcOptions = {
  minClearance: MM(0.2),
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const codes = (b: Board, code: string) => runDrc(b, OPTS).filter((v) => v.code === code);

describe('shorting items', () => {
  it('reports two nets whose copper touches', () => {
    // Touching, but not centreline-to-centreline: the two tracks are 0.1 mm
    // apart on y and their 0.2 mm widths close the gap exactly.
    const b = board([track(0, 0, 5, 0, 1), track(0, 0.2, 5, 0.2, 2)]);

    expect(codes(b, 'shorting_items')).toHaveLength(1);
  });

  it('calls two collinear tracks meeting end to end a crossing, not a short', () => {
    // `trackSeg.Intersect( otherSeg )` is tested first and returns immediately
    // (`drc_test_provider_copper_clearance.cpp:263-278`), and `SEG::Intersect`
    // resolves a collinear overlap — a zero-extent one included — to a point.
    // So the marker upstream raises here is TRACKS_CROSSING.
    const b = board([track(0, 0, 5, 0, 1), track(5, 0, 10, 0, 2)]);

    expect(codes(b, 'tracks_crossing')).toHaveLength(1);
    expect(codes(b, 'shorting_items')).toHaveLength(0);
  });

  it('says shorting instead of clearance, not as well as', () => {
    const b = board([track(0, 0, 5, 0, 1), track(0, 0.2, 5, 0.2, 2)]);

    expect(codes(b, 'clearance')).toHaveLength(0);
  });

  it('names both nets, as upstream does', () => {
    const b = board([track(0, 0, 5, 0, 1), track(0, 0.2, 5, 0.2, 2)]);

    expect(codes(b, 'shorting_items')[0]!.message).toContain('N1');
    expect(codes(b, 'shorting_items')[0]!.message).toContain('N2');
  });

  it('still calls a near miss a clearance violation', () => {
    // The gap is between the *shapes*, so the centrelines have to clear each
    // other by both half-widths plus the gap: 0.1 + 0.1 + 0.1 = 0.3 mm.
    const b = board([track(0, 0, 5, 0, 1), track(5.3, 0, 10, 0, 2)]);

    expect(codes(b, 'clearance')).toHaveLength(1);
    expect(codes(b, 'shorting_items')).toHaveLength(0);
  });

  it('leaves two touching tracks of the same net alone', () => {
    const b = board([track(0, 0, 5, 0, 1), track(5, 0, 10, 0, 1)]);

    expect(codes(b, 'shorting_items')).toHaveLength(0);
  });

  it('does not short across layers', () => {
    const b = board([track(0, 0, 5, 0, 1), track(5, 0, 10, 0, 2, { layer: 'B.Cu' })]);

    expect(codes(b, 'shorting_items')).toHaveLength(0);
  });
});

describe('tracks crossing', () => {
  it('reports two different-net tracks whose centrelines intersect', () => {
    const b = board([track(0, 5, 10, 5, 1), track(5, 0, 5, 10, 2)]);

    expect(codes(b, 'tracks_crossing')).toHaveLength(1);
  });

  it('marks the crossing point, not either track end', () => {
    const b = board([track(0, 5, 10, 5, 1), track(5, 0, 5, 10, 2)]);

    expect(codes(b, 'tracks_crossing')[0]!.pos).toEqual({ x: MM(5), y: MM(5) });
  });

  it('reports crossing instead of shorting or clearance', () => {
    const b = board([track(0, 5, 10, 5, 1), track(5, 0, 5, 10, 2)]);

    expect(codes(b, 'shorting_items')).toHaveLength(0);
    expect(codes(b, 'clearance')).toHaveLength(0);
  });

  it('leaves two same-net tracks crossing alone', () => {
    // Same net is skipped before the crossing test, as it is for clearance.
    const b = board([track(0, 5, 10, 5, 1), track(5, 0, 5, 10, 1)]);

    expect(codes(b, 'tracks_crossing')).toHaveLength(0);
  });

  it('does not cross tracks on different layers', () => {
    const b = board([track(0, 5, 10, 5, 1), track(5, 0, 5, 10, 2, { layer: 'B.Cu' })]);

    expect(codes(b, 'tracks_crossing')).toHaveLength(0);
  });

  it('does not treat two tracks that merely pass close as crossing', () => {
    const b = board([track(0, 5, 10, 5, 1), track(5, 0, 5, 4.9, 2)]);

    expect(codes(b, 'tracks_crossing')).toHaveLength(0);
  });

  it('leaves an arc out of the crossing test', () => {
    // Upstream's test is PCB_TRACE_T against PCB_TRACE_T; an arc crossing a
    // track is a clearance or shorting problem, not a "tracks crossing" one.
    const b = board([track(0, 5, 10, 5, 1)], {
      arcs: [
        {
          start: { x: MM(5), y: MM(0) },
          mid: { x: MM(6), y: MM(5) },
          end: { x: MM(5), y: MM(10) },
          width: MM(0.2),
          layer: 'F.Cu',
          net: 2,
          source: EMPTY,
        },
      ],
    });

    expect(codes(b, 'tracks_crossing')).toHaveLength(0);
    // …but it is still reported as something.
    expect(codes(b, 'shorting_items').length + codes(b, 'clearance').length).toBeGreaterThan(0);
  });
});
