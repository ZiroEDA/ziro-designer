// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copper slivers.
 * Counterpart: `DRC_TEST_PROVIDER_SLIVER_CHECKER`.
 *
 * A sliver is a needle of copper — a tapering finger too thin for the
 * fabricator to hold. Upstream finds them by walking the outline of the merged
 * copper on a layer and testing each vertex's two arms, which is how the marker
 * lands on the needle rather than merely announcing that one exists.
 *
 * Five conditions must all hold before a vertex is reported, and each gets a
 * fixture of its own below, because dropping any one either floods a real board
 * with false positives or silences the check outright:
 *
 * | condition | what binds it |
 * | --- | --- |
 * | arms point the same way | a barely-bent edge, ~180° |
 * | the vertex is a convex point of copper | the same taper cut *into* a pour |
 * | the angle is sharper than the tolerance | the same wedge opened to 36.9° |
 * | the vertex is not degenerate | two arms lying on one ray |
 * | the opposite side beats the width tolerance | `WEDGE` at a raised tolerance |
 *
 * plus the five-point floor and the two arm-growing walks, which are what keep
 * a filled zone from reporting hundreds of phantoms.
 *
 * Every fixture here was found by running the real algorithm against each guard
 * removed in turn, rather than reasoned out — the first three attempts at a
 * "sliver" fixture were all shapes this check is deliberately silent about.
 */
import { describe, expect, it } from 'vitest';
import { booleanAdd } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  SLIVER_ANGLE_TOLERANCE_DEG,
  SLIVER_MINIMUM_LENGTH,
  SLIVER_WIDTH_TOLERANCE,
  findSliverPoints,
} from '@ziroeda/pcbnew/src/drc/drc_sliver.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbZone } from '@ziroeda/pcbnew/src/types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });

/**
 * A block with a long tapering finger of copper on its right: base 2 mm at
 * x = 10, tip 20 mm away, so the included angle is 2·atan(1/20) ≈ 5.7°.
 */
const WEDGE = [P(0, 0), P(10, 0), P(10, 4), P(30, 5), P(10, 6), P(10, 10), P(0, 10)];

/** The same taper, cut *into* a pour instead of standing out of it. */
const SLOT = [P(0, 0), P(40, 0), P(40, 4), P(20, 5), P(40, 6), P(40, 20), P(0, 20)];

/** A rectangle, with extra collinear points so it clears the five-point floor. */
const RECT = [P(0, 0), P(5, 0), P(10, 0), P(10, 5), P(10, 10), P(0, 10), P(0, 5)];

describe('the tolerances', () => {
  it('are upstream’s advanced-config defaults', () => {
    // Literals, so that nothing below can move with them.
    expect(SLIVER_WIDTH_TOLERANCE).toBe(MM(0.08));
    expect(SLIVER_ANGLE_TOLERANCE_DEG).toBe(20);
    expect(SLIVER_MINIMUM_LENGTH).toBe(MM(0.0008));
  });
});

describe('a tapering finger of copper', () => {
  it('is a sliver', () => {
    expect(findSliverPoints(WEDGE)).toEqual([P(30, 5)]);
  });

  it('is reported at its tip, not merely somewhere on the board', () => {
    // The whole reason upstream walks vertices instead of offsetting the
    // polygon: the marker has to be findable.
    expect(findSliverPoints(WEDGE)[0]).toEqual(P(30, 5));
  });

  it('is not one once the taper opens past the angle tolerance', () => {
    // 2·atan(1/3) ≈ 36.9°, comfortably outside the 20° tolerance.
    const blunt = [P(0, 0), P(10, 0), P(10, 4), P(13, 5), P(10, 6), P(10, 10), P(0, 10)];

    expect(findSliverPoints(blunt)).toEqual([]);
    expect(findSliverPoints(blunt, { angleToleranceDeg: 45 })).toEqual([P(13, 5)]);
  });
});

describe('a slot of the same taper', () => {
  it('is not a sliver', () => {
    // Sharp, but it is a *gap*. Thin gaps are clearance's business; this test
    // is only about copper too thin to survive. Drop the locally-inside guard
    // and every notch in every pour reports.
    expect(findSliverPoints(SLOT)).toEqual([]);
  });
});

describe('ordinary geometry', () => {
  it('does not report a rectangle', () => {
    expect(findSliverPoints(RECT)).toEqual([]);
  });

  it('does not report a barely-bent edge', () => {
    // A vertex 1 µm off a straight run is ~180°, and the angle test takes an
    // absolute value — so to that test it looks exactly as sharp as a
    // doubled-back needle. Only the dot product tells them apart.
    const nudged = [
      P(0, 0),
      { x: MM(5), y: MM(-0.001) },
      P(10, 0),
      P(10, 5),
      P(10, 10),
      P(0, 10),
      P(0, 5),
    ];

    expect(findSliverPoints(nudged)).toEqual([]);
  });

  it('does not report a vertex whose arms lie on one ray', () => {
    // Fully degenerate: zero included angle. Upstream excludes it explicitly
    // rather than let a cosine of exactly 2 through.
    const sameRay = [P(0, 0), P(20, 0), P(20, 10), P(5, 10), P(15, 10), P(25, 10), P(0, 10)];

    expect(findSliverPoints(sameRay)).toEqual([]);
  });

  it('skips any outline of five points or fewer', () => {
    // This triangle is a textbook sliver — 18.9° with a 10 mm base — and
    // upstream declines to look at it at all: too few points to walk.
    const triangle = [P(0, 0), P(30, 5), P(0, 10)];

    expect(findSliverPoints(triangle)).toEqual([]);
  });
});

describe('the width tolerance', () => {
  it('ignores a feature narrower than the tolerance', () => {
    // Below the tolerance upstream stops trusting the outline at all: at that
    // scale a wedge is indistinguishable from noise in the fill.
    expect(findSliverPoints(WEDGE, { widthTolerance: MM(4) })).toEqual([]);
  });

  it('reports the same wedge once the tolerance is lowered again', () => {
    expect(findSliverPoints(WEDGE, { widthTolerance: MM(1) })).toEqual([P(30, 5)]);
  });
});

describe('sub-micron vertices', () => {
  // A filled zone carries vertices only nanometres apart, whose direction is
  // numerical noise. Both arms are grown past them before any angle is
  // measured; without that, one wedge reports as several.
  const denseTip = (offsets: readonly [number, number][]): Vec2[] => [
    P(0, 0),
    P(10, 0),
    P(10, 4),
    ...offsets.map(([dx, dy]) => ({ x: MM(30) + dx, y: MM(5) + dy })),
    P(10, 6),
    P(10, 10),
    P(0, 10),
  ];

  it('collapses a densely-sampled tip to one sliver, not several', () => {
    // Three points spread ±3 nm about the tip. Ungrown, the backward arm is a
    // few nanometres of noise and the wedge reports twice.
    const found = findSliverPoints(
      denseTip([
        [-3, 0],
        [3, 0],
        [-2, 0],
      ]),
    );

    expect(found).toHaveLength(1);
  });

  it('still finds the tip when the forward arm is the noisy one', () => {
    const found = findSliverPoints(
      denseTip([
        [-4, -2],
        [-2, -1],
        [0, 0],
        [-2, 1],
        [-4, 2],
      ]),
    );

    // Growing the backward arm advances `pt` as well, so the marker settles on
    // the first point of the dense run rather than the tip itself — four
    // nanometres away, which no one will ever notice.
    expect(found).toEqual([{ x: MM(30) - 4, y: MM(5) - 2 }]);
  });
});

describe('the winding the test depends on', () => {
  it('is what booleanAdd produces, whichever way the input was wound', () => {
    // The locally-inside guard is orientation-sensitive: reverse the outline
    // and it reports slots instead of fingers. Nothing in the type system says
    // which way rings arrive, so pin it — the engine feeds this straight out of
    // booleanAdd.
    const clockwise = booleanAdd([[[...WEDGE]]], []);
    const counter = booleanAdd([[[...WEDGE].reverse()]], []);

    expect(findSliverPoints(clockwise[0]![0]!)).toEqual([P(30, 5)]);
    expect(findSliverPoints(counter[0]![0]!)).toEqual([P(30, 5)]);
  });

  it('reports slots rather than fingers if an outline arrives reversed', () => {
    // Stated so the dependency above is visibly load-bearing rather than
    // decorative.
    expect(findSliverPoints([...WEDGE].reverse())).toEqual([]);
    expect(findSliverPoints([...SLOT].reverse())).toEqual([P(20, 5)]);
  });
});

// ---------------------------------------------------------------------------
// Through the engine
// ---------------------------------------------------------------------------

const EMPTY = { kind: 'list' as const, items: [] };

const zone = (polys: Vec2[][]): PcbZone => ({
  net: 1,
  layers: ['F.Cu'],
  fills: [{ layer: 'F.Cu', polys }],
  outline: [P(0, 0), P(100, 0), P(100, 100), P(0, 100)],
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
    { id: 44, name: 'Edge.Cuts', kind: 'user' },
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

const slivers = (b: Board) => runDrc(b, OPTS).filter((v) => v.code === 'copper_sliver');

describe('through the DRC engine', () => {
  it('reports a wedge of zone fill', () => {
    const found = slivers(board({ zones: [zone([WEDGE])] }));

    expect(found).toHaveLength(1);
    expect(found[0]?.pos).toEqual(P(30, 5));
    expect(found[0]?.message).toBe('Copper sliver on F.Cu');
  });

  it('says nothing about a plain rectangular pour', () => {
    expect(slivers(board({ zones: [zone([RECT])] }))).toHaveLength(0);
  });

  it('stops reporting a wedge that a second pour fills back in', () => {
    // This is what the union buys. Merging can only ever *blunt* a convex
    // point — a union's new sharp vertices are all reflex, and those are
    // rejected anyway — so its whole job is suppressing needles that are not
    // really there once the neighbouring copper is accounted for. Test each
    // pour on its own and this board reports a sliver that does not exist.
    const swallows = [P(8, 2), P(34, 2), P(34, 8), P(8, 8)];

    expect(slivers(board({ zones: [zone([WEDGE])] }))).toHaveLength(1);
    expect(slivers(board({ zones: [zone([WEDGE]), zone([swallows])] }))).toHaveLength(0);
  });

  it('does not look inside a hole, as upstream does not', () => {
    // Four bars union into a square annulus; the fifth pour drives a needle
    // into the void from the inner wall. Physically that is every bit a
    // sliver, but upstream walks `Outline( jj )`, which is outer rings only,
    // so it never sees it — and a hole is wound the other way, which would
    // invert the convex/concave test if we walked one anyway.
    const bars = [
      [P(0, 0), P(40, 0), P(40, 10), P(0, 10)],
      [P(0, 30), P(40, 30), P(40, 40), P(0, 40)],
      [P(0, 0), P(10, 0), P(10, 40), P(0, 40)],
      [P(30, 0), P(40, 0), P(40, 40), P(30, 40)],
    ];
    const intoTheHole = [P(10, 19), P(28, 20), P(10, 21)];

    expect(slivers(board({ zones: [zone([...bars, intoTheHole])] }))).toHaveLength(0);
  });

  it('ignores a rule area, which is not copper at all', () => {
    const keepout = {
      tracks: true,
      vias: true,
      pads: true,
      copperPour: true,
      footprints: true,
    };
    const b = board({ zones: [{ ...zone([WEDGE]), ruleArea: keepout }] });

    expect(slivers(b)).toHaveLength(0);
  });

  it('does not look at non-copper layers', () => {
    const b = board({
      zones: [
        {
          ...zone([WEDGE]),
          layers: ['Edge.Cuts'],
          fills: [{ layer: 'Edge.Cuts', polys: [WEDGE] }],
        },
      ],
    });

    expect(slivers(b)).toHaveLength(0);
  });
});
