// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Minimum connection width.
 * Counterpart: `POLYGON_TEST` in `drc_test_provider_connection_width.cpp`.
 *
 * A neck is where one connected piece of copper is pinched thin. Nothing about
 * clearance is violated — the copper is continuous — it is simply too narrow to
 * carry what it is meant to.
 *
 * Two things distinguish it from the sliver check next door and get most of the
 * attention below:
 *
 * - **Both sides of the cut must be substantial**, and substantial means the
 *   piece wanders more than the limit in *both* axes. A long thin arm is not
 *   substantial however long it is, because it is itself a neck seen end-on.
 *   Drop the both-axes rule and every straight run of copper reports.
 * - **One neck, one report.** Both shoulders of a pinch qualify on their own,
 *   so upstream strikes out each match and its immediate neighbours. Without
 *   that a channel reports once per vertex along both of its sides.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { findNecks } from '@ziroeda/pcbnew/src/drc/drc_connection_width.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbTrack, PcbZone } from '@ziroeda/pcbnew/src/types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });
const EMPTY = { kind: 'list' as const, items: [] };

/** Two 10 mm pads joined by a 0.5 mm channel — the textbook neck. */
const DUMBBELL = [
  P(0, 0),
  P(10, 0),
  P(10, 4.75),
  P(20, 4.75),
  P(20, 0),
  P(30, 0),
  P(30, 10),
  P(20, 10),
  P(20, 5.25),
  P(10, 5.25),
  P(10, 10),
  P(0, 10),
];

describe('a pinched connection', () => {
  it('is reported when the channel is narrower than the limit', () => {
    const necks = findNecks(DUMBBELL, MM(1));

    expect(necks).toHaveLength(1);
    expect(necks[0]?.width).toBe(MM(0.5));
  });

  it('is reported once, not once per shoulder', () => {
    // Both ends of the channel are a valid pinch on their own. Upstream strikes
    // out each match and its neighbours so the pair is only found once.
    expect(findNecks(DUMBBELL, MM(3))).toHaveLength(1);
  });

  it('says where it is, at the middle of the span', () => {
    expect(findNecks(DUMBBELL, MM(1))[0]?.at).toEqual(P(10, 5));
  });

  it('is not reported once the limit drops below the channel', () => {
    expect(findNecks(DUMBBELL, MM(0.4))).toEqual([]);
  });

  it('is not reported at a limit of zero, which is how the check is switched off', () => {
    expect(findNecks(DUMBBELL, 0)).toEqual([]);
    expect(findNecks(DUMBBELL, -MM(1))).toEqual([]);
  });
});

describe('what is not a neck', () => {
  it('is a plain rectangle', () => {
    expect(findNecks([P(0, 0), P(30, 0), P(30, 10), P(0, 10)], MM(1))).toEqual([]);
  });

  it('is a bar thinner than the limit along its whole length', () => {
    // The bar is 2 mm across and the limit is 3, so every chord across it is
    // "too narrow" — but neither side of such a cut is substantial, because
    // neither wanders more than the limit in *both* axes. This is the case the
    // both-axes rule exists for; without it the whole bar reports.
    expect(findNecks([P(0, 0), P(30, 0), P(30, 2), P(0, 2)], MM(3))).toEqual([]);
  });

  it('is a channel ending in a blob too small to be a connected piece', () => {
    // The both-axes rule, isolated. Cutting at the channel mouth leaves a piece
    // that runs 10 mm in x but never 1 mm in y — long, but a neck seen end-on
    // rather than copper the neck connects. Requiring only one axis, or either
    // axis, reports this.
    const stub = [
      P(0, 0),
      P(10, 0),
      P(10, 4.75),
      P(20, 4.75),
      P(20, 4.6),
      P(20.4, 4.6),
      P(20.4, 5.4),
      P(20, 5.4),
      P(20, 5.25),
      P(10, 5.25),
      P(10, 10),
      P(0, 10),
    ];

    expect(findNecks(stub, MM(1))).toEqual([]);
  });

  it('is a shallow dent in an edge', () => {
    // A 1 mm-wide notch cut 4.75 mm into a 10 mm block: the two sides of the
    // notch are close, but the piece between them is a wrinkle, not copper the
    // neck connects.
    const dented = [
      P(0, 0),
      P(10, 0),
      P(10, 4.75),
      P(11, 4.75),
      P(11, 0),
      P(30, 0),
      P(30, 10),
      P(0, 10),
    ];

    expect(findNecks(dented, MM(1.5))).toEqual([]);
  });

  it('is an outline too small to have one', () => {
    expect(findNecks([P(0, 0), P(10, 0), P(10, 10)], MM(1))).toEqual([]);
  });
});

describe('the limit', () => {
  it('is what decides, so widening it finds a wider channel', () => {
    const wider = [
      P(0, 0),
      P(10, 0),
      P(10, 4),
      P(20, 4),
      P(20, 0),
      P(30, 0),
      P(30, 10),
      P(20, 10),
      P(20, 6),
      P(10, 6),
      P(10, 10),
      P(0, 10),
    ];

    expect(findNecks(wider, MM(1))).toEqual([]);
    expect(findNecks(wider, MM(3))).toHaveLength(1);
    expect(findNecks(wider, MM(3))[0]?.width).toBe(MM(2));
  });
});

// ---------------------------------------------------------------------------
// Through the engine
// ---------------------------------------------------------------------------

const zone = (polys: Vec2[][], net = 1): PcbZone => ({
  net,
  layers: ['F.Cu'],
  fills: [{ layer: 'F.Cu', polys }],
  outline: [P(-10, -10), P(50, -10), P(50, 50), P(-10, 50)],
  source: EMPTY,
});

const track = (a: Vec2, b: Vec2, width: number, net = 1): PcbTrack => ({
  start: a,
  end: b,
  width,
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

const necks = (b: Board, minConnectionWidth?: number) =>
  runDrc(b, { ...OPTS, minConnectionWidth }).filter((v) => v.code === 'connection_width');

describe('through the DRC engine', () => {
  it('is off unless a minimum connection width is set', () => {
    // Upstream's default is 0, and a board that has not set one is not asking
    // for the test.
    expect(necks(board({ zones: [zone([DUMBBELL])] }))).toHaveLength(0);
    expect(necks(board({ zones: [zone([DUMBBELL])] }), 0)).toHaveLength(0);
  });

  it('reports a pinched zone fill once the width is set', () => {
    const found = necks(board({ zones: [zone([DUMBBELL])] }), MM(2));

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('actual');
  });

  it('says nothing about a pour with no constriction', () => {
    const square = [P(0, 0), P(30, 0), P(30, 30), P(0, 30)];

    expect(necks(board({ zones: [zone([square])] }), MM(2))).toHaveLength(0);
  });

  it('groups by net, so another net cannot fill in this net’s neck', () => {
    // Net 2's pour sits right over net 1's channel. Merge the two and the
    // constriction vanishes; keep them apart, as upstream does, and net 1 is
    // still pinched — which it is, because that copper belongs to something
    // else. (Whether the two may sit that close is clearance's question.)
    const overlaps = [P(9, 3), P(21, 3), P(21, 7), P(9, 7)];

    const alone = board({ zones: [zone([DUMBBELL], 1)] });
    const withOther = board({ zones: [zone([DUMBBELL], 1), zone([overlaps], 2)] });

    expect(necks(alone, MM(2))).toHaveLength(1);
    expect(necks(withOther, MM(2))).toHaveLength(1);
  });

  it('merges one net’s separate items before looking', () => {
    // Two tracks meeting at a point make a connection that neither has on its
    // own; the union is what turns them into one shape with a pinch in it.
    const b = board({
      tracks: [track(P(0, 5), P(10, 5), MM(6)), track(P(10, 5), P(20, 5), MM(6))],
    });

    // Nothing to report on a uniform pair, but it must not crash or invent one.
    expect(necks(b, MM(2))).toHaveLength(0);
  });

  it('leaves unconnected copper alone', () => {
    expect(necks(board({ tracks: [track(P(0, 0), P(20, 0), MM(1))] }), MM(0.5))).toHaveLength(0);
  });

  it('does not look at net 0', () => {
    // No net means no connection to be too narrow.
    const b = board({ zones: [zone([DUMBBELL], 0)] });

    expect(necks(b, MM(2))).toHaveLength(0);
  });
});
