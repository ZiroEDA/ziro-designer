// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/src/drc/drc_geometry.ts` — the geometry our DRC clearance path runs
 * on. Counterparts: `libs/kimath/src/geometry/seg.cpp` (`SEG::Distance`,
 * `SEG::SquaredDistance`) and the `aActual` expression every pair function of
 * `libs/kimath/src/geometry/shape_collisions.cpp` shares.
 *
 * These used to be a third implementation in doubles, alongside kimath's `SEG`
 * and `shape_collisions.ts`'s transcription of it. The tests here are about the
 * three things that changes:
 *
 *  - the answer is a whole number of IU, because `aActual` is an `int*`;
 *  - the truncation happens before the radii come off, not after;
 *  - a shape genuinely touching another measures exactly zero, where a `hypot`
 *    of a projected point came back at up to 2e-8.
 *
 * Every expectation is worked out from the C++ or from an independent
 * measurement. None is read off what the implementation prints.
 */
import { describe, expect, it } from 'vitest';
import { collideShapes } from '@ziroeda/pcbnew/src/drc/shape_collisions.js';
import { pointSeg, segSeg, shapeDist, type Shape } from '@ziroeda/pcbnew/src/drc/drc_geometry.js';

const circle = (x: number, y: number, r: number): Shape => ({ kind: 'circle', c: { x, y }, r });

const stadium = (ax: number, ay: number, bx: number, by: number, r = 0): Shape => ({
  kind: 'stadium',
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  r,
});

const poly = (pts: [number, number][], r = 0): Shape => ({
  kind: 'poly',
  pts: pts.map(([x, y]) => ({ x, y })),
  r,
});

describe('pointSeg is SEG::Distance( VECTOR2I )', () => {
  it('floors, because SEG::Distance is isqrt and not a rounded hypot', () => {
    // `SEG::SquaredDistance( (10,0) )` against the diagonal (0,0)-(100,100) is
    // `|ap|² - e²/f` = 100 - 1000000/20000 = 50 (`seg.cpp:714`). `SEG::Distance`
    // is `isqrt( 50 )`, the largest integer whose square does not exceed 50.
    // The true root is 7.0710678…, so a rounded hypot would have said 7 here
    // and 8 for a root of 7.6.
    expect(pointSeg({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 100 })).toBe(7);

    // A root of 7.6: `SquaredDistance` = 58 gives isqrt 7 where rounding gives 8.
    // (0,0)-(300,100) with the point (0,60): e = 6000, f = 100000,
    // |ap|² = 3600, g = 3600 - 36000000/100000 = 3240; isqrt( 3240 ) = 56,
    // the true root being 56.9209…
    expect(pointSeg({ x: 0, y: 60 }, { x: 0, y: 0 }, { x: 300, y: 100 })).toBe(56);
  });

  it('answers exactly zero for a point genuinely on the segment', () => {
    // A lattice point one third of the way along a board-scale segment:
    // p - a is (-43558850, 47577691) and b - a is exactly three times that.
    //
    // The doubles this replaced projected `p` back onto the segment and took a
    // `hypot` of the residue, which for this case is 2.1073424255447017e-8 and
    // not zero. That number is why `shapeDist( … ) === 0` — the shorting test,
    // and the touch test in a dozen other places — could answer false for two
    // items that were touching. Sampling exact-on-segment lattice points at
    // board scale, 1418 of 16879 came back non-zero that way.
    const a = { x: 78802173, y: -99210462 };
    const b = { x: -51874377, y: 43522611 };
    const p = { x: 35243323, y: -51632771 };

    expect(b.x - a.x).toBe(3 * (p.x - a.x));
    expect(b.y - a.y).toBe(3 * (p.y - a.y));
    expect(pointSeg(p, a, b)).toBe(0);
  });
});

describe('segSeg is SEG::Distance( SEG )', () => {
  it('is zero for segments that touch without properly crossing', () => {
    // `SEG::Intersects` is upstream's exact-integer predicate and counts a
    // shared endpoint. The four hand-rolled cross products this replaced asked
    // for a *proper* crossing — `d1 * d2 < 0 && d3 * d4 < 0`, both strict — so a
    // T-junction fell through to the endpoint minimisation instead.
    expect(segSeg({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 50 }, { x: 90, y: 10 })).toBe(0);
  });

  it('floors the distance between two skew segments', () => {
    // The four `SEG::SquaredDistance( const SEG& )` candidates for the diagonal
    // (0,0)-(100,100) against (10,0)-(20,0) are 100, 16400, 50 and 200; they do
    // not cross, so the answer is `isqrt( 50 )` = 7.
    expect(segSeg({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe(7);
  });
});

describe('shapeDist is SHAPE::Collide-s aActual', () => {
  it('truncates the root before the radii come off', () => {
    // `shape_collisions.cpp:55`: centres (0,0) and (10,10) put `dist_sq` at
    // exactly 200, `(int) sqrt( 200 )` is 14, and 14 - 5 - 5 is 4. The doubles
    // this replaced returned 4.142135623730951.
    expect(shapeDist(circle(0, 0, 5), circle(10, 10, 5))).toBe(4);
  });

  it('subtracts after the truncation, not before', () => {
    // Only observable when what comes off is fractional, and a Ziro shape makes
    // it so: `r` is `width / 2` untruncated, so an odd-diameter via has a
    // half-integral radius.
    //
    //   C++ order   `(int) sqrt( 200 ) - 2.5 - 5`    = 14 - 7.5     = 6.5
    //   wrong order `trunc( sqrt( 200 ) - 2.5 - 5 )` = trunc(6.642) = 6
    expect(shapeDist(circle(0, 0, 2.5), circle(10, 10, 5))).toBe(6.5);
  });

  it('truncates rather than rounds', () => {
    // Invisible on a root whose fraction is below a half, which is why the case
    // above does not catch it: `sqrt( 200 )` is 14.142… and both spellings give
    // 14. Centres (0,0) and (4,14) put `dist_sq` at 16 + 196 = 212, whose root
    // is 14.560219778561036 — `(int)` keeps 14, rounding would give 15.
    expect(shapeDist(circle(0, 0, 5), circle(4, 14, 5))).toBe(4);
  });

  it('truncates the arc pairs at the same place', () => {
    // The arc trio measures a curve in doubles — kimath has no integer
    // counterpart and `SHAPE_ARC::Collide` is a verdict rather than a distance —
    // but the answer is still an `int*` and is truncated where every other pair
    // is truncated.
    //
    // A quarter arc of radius 100 from bearing 0, against a point at (0,-50).
    // The point's bearing is -pi/2, outside the sweep, so the radial projection
    // is not a candidate and the nearer endpoint (100,0) wins:
    // `sqrt( 100² + 50² )` = `sqrt( 12500 )` = 111.8033988749895, and the `int`
    // keeps 111.
    const quarter: Shape = {
      kind: 'arc',
      c: { x: 0, y: 0 },
      rad: 100,
      a0: 0,
      sweep: Math.PI / 2,
      r: 0,
    };

    expect(shapeDist(circle(0, -50, 0), quarter)).toBe(111);
  });

  it('rounds a fractional coordinate onto the IU grid, as VECTOR2I does', () => {
    // `Shape` carries doubles because `arcShape` computes a centre and
    // `padShapes` rotates vertices; kimath `KiROUND`s them into a `SEG`, which
    // reproduces the rounding KiCad already did when it stored the shape as
    // `VECTOR2I`. Centres at x = 0.4 and x = 10.6 are 10.2 apart as doubles and
    // 11 apart on the grid — 0 and 11 — so the gap is 11, not 10.
    expect(shapeDist(circle(0.4, 0, 0), circle(10.6, 0, 0))).toBe(11);
  });

  it('minimises squared distances and truncates once, not the other way round', () => {
    // The square 0..1000 against a point 10 to its left of the mid-height. The
    // four edges are 500.0999…, 1010, 500 and 10 away in list order, so the
    // winner is the *last* edge — a truncate-then-minimise would have compared
    // 500, 1010, 500 and 10 and still found 10, but a minimisation that stopped
    // early, or a bounding-box rejection that was too tight, would answer 500.
    const square = poly([
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [0, 1000],
    ]);

    expect(shapeDist(circle(-10, 500, 0), square)).toBe(10);
  });

  it('keeps an edge that only just improves on the running best', () => {
    // The bounding-box rejection in front of the exact-integer measurement is a
    // pure optimisation, and its 2 IU margin over the running best is what makes
    // it one. A thin rectangle whose two long sides sit at x = 103 and x = 102,
    // the far one first in winding order: the near side improves on the best by
    // a single IU, and its bounding box is separated from the probe by its full
    // distance, so a margin of zero — or a negative one — rejects the winner and
    // answers 103.
    //
    // `SEG::SquaredDistance` of (0,0) against the side at x = 103 is 10609 and
    // against the side at x = 102 is 10404; the two short sides are 1000 away.
    const thin = poly([
      [103, -1000],
      [103, 1000],
      [102, 1000],
      [102, -1000],
    ]);

    expect(shapeDist(circle(0, 0, 0), thin)).toBe(102);
  });

  it('never reports a fraction of an IU for integer input', () => {
    // `aActual` is an `int*`. Anything fractional coming out of a pair with
    // integer coordinates and integer radii is a divergence.
    const cases: [Shape, Shape][] = [
      [circle(0, 0, 5), circle(37, 91, 3)],
      [circle(0, 0, 5), stadium(30, 40, 90, 17, 2)],
      [stadium(0, 0, 100, 100, 2), stadium(133, 71, 210, 33, 4)],
      [
        stadium(0, 0, 100, 100, 2),
        poly([
          [300, 17],
          [411, 90],
          [355, 260],
        ]),
      ],
      [
        poly([
          [0, 0],
          [100, 0],
          [50, 90],
        ]),
        poly([
          [300, 17],
          [411, 90],
          [355, 260],
        ]),
      ],
    ];

    for (const [a, b] of cases) expect(Number.isInteger(shapeDist(a, b))).toBe(true);
  });
});

describe('shapeDist and SHAPE::Collide now answer the same question', () => {
  /**
   * The point of removing the third implementation: `shapeDist( a, b ) < c` and
   * `SHAPE::Collide( a, b, c )` must agree, because both are now
   * `(int) sqrt( dist_sq )` against the same exact-integer `SEG`.
   *
   * The equivalence is *because of* the truncation, and not despite it.
   * Upstream's verdict is `dist_sq < min_dist_sq`, a comparison on squares;
   * ours is `(int) sqrt( dist_sq ) - r < c`, which for integer `c + r` is the
   * same inequality only once the root has been floored. A fractional gap
   * disagrees with the verdict on every pair whose root falls between `c + r`
   * and the next integer.
   *
   * Arcs are excluded on purpose: `SHAPE_ARC::Collide` keeps the *last*
   * colliding candidate rather than the nearest, so it is not a distance and
   * there is nothing for a distance to agree with.
   */
  const mulberry = (aSeed: number) => {
    let state = aSeed;

    return (): number => {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  it('agrees on every non-arc pair over a deterministic sweep', () => {
    const rnd = mulberry(20260820);
    const coord = (): number => Math.floor(rnd() * 4000) - 2000;
    const radius = (): number => Math.floor(rnd() * 40);

    const shape = (): Shape => {
      const k = Math.floor(rnd() * 3);
      if (k === 0) return circle(coord(), coord(), radius());
      if (k === 1) return stadium(coord(), coord(), coord(), coord(), radius());
      const n = 3 + Math.floor(rnd() * 4);
      const cx = coord();
      const cy = coord();
      const rad = 50 + Math.floor(rnd() * 400);
      return poly(
        Array.from({ length: n }, (_, i) => {
          const a = (2 * Math.PI * i) / n;
          return [Math.round(cx + rad * Math.cos(a)), Math.round(cy + rad * Math.sin(a))] as [
            number,
            number,
          ];
        }),
      );
    };

    let checked = 0;
    let collided = 0;
    const disagreements: string[] = [];

    for (let i = 0; i < 1500; i++) {
      const a = shape();
      const b = shape();
      const d = shapeDist(a, b);

      // A clearance of 0 is left out: upstream's `dist_sq == 0` arm fires on a
      // co-centred pair whatever the clearance, and a clamped gap cannot tell
      // "co-centred" from "overlapping".
      for (const c of [1, 5, 17, 64, 250, 1000]) {
        checked++;
        const collides = collideShapes(a, b, c).collides;

        if (collides) collided++;

        if (collides !== d < c) {
          disagreements.push(
            `${a.kind}/${b.kind} clearance=${c} shapeDist=${d} collide=${collides}`,
          );
        }
      }
    }

    expect(checked).toBe(9000);
    expect(disagreements).toEqual([]);

    // The sweep is worthless if nothing ever collides: agreeing on 9000 "no"
    // answers would survive any mistake that only moves a boundary. A quarter
    // of the pairs collide at the widest clearance and none at the narrowest,
    // so the sweep straddles the verdict on both sides.
    expect(collided).toBeGreaterThan(500);
    expect(collided).toBeLessThan(8500);
  });
});
