// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tidying a route after it has been found.
 * Counterparts: `COST_ESTIMATOR::CornerCost` and `OPTIMIZER`'s merge passes.
 *
 * Walkaround produces a route that is correct and rarely one anybody would
 * draw: it hugs every hull it passes, so three obstacles come back as twenty
 * points. The end-to-end test at the bottom is the point of the whole file —
 * that same route comes out as four.
 *
 * The rule that has to survive is that **a shortcut is only taken if it is
 * still clear**. Without the collision check every pass here would happily undo
 * the detours walkaround just found, because the cheapest route between two
 * points either side of a pad goes straight through the pad. Each pass gets a
 * test for that on its own, not only the combined one.
 */
import { describe, expect, it } from 'vitest';
import {
  chainCornerCost,
  cornerCost,
  mergeColinear,
  mergeFull,
  mergeObtuse,
  optimize,
} from '@ziroeda/pcbnew/src/router/pns_optimizer.js';
import { routeShortest } from '@ziroeda/pcbnew/src/router/pns_walkaround.js';
import { viaHull } from '@ziroeda/pcbnew/src/router/pns_hull.js';
import { pointInside, pointOnEdge } from '@ziroeda/pcbnew/src/router/pns_chain.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const P = (x: number, y: number): Vec2 => ({ x, y });
const at = (c: readonly Vec2[]): string[] => c.map((p) => `${p.x},${p.y}`);

/** Nothing is ever in the way. */
const clear = (): boolean => false;

describe('what a corner costs', () => {
  it('is cheapest straight and dearest undefined', () => {
    // The ordering is the whole content: a route that turns less wins, and a
    // degenerate join is never chosen.
    expect(cornerCost(P(0, 0), P(10, 0), P(20, 0))).toBe(5);
    expect(cornerCost(P(0, 0), P(10, 0), P(20, 10))).toBe(10);
    expect(cornerCost(P(0, 0), P(10, 0), P(10, 10))).toBe(30);
    expect(cornerCost(P(0, 0), P(10, 0), P(0, 10))).toBe(50);
  });

  it('punishes a zero-length segment hardest of all', () => {
    expect(cornerCost(P(0, 0), P(0, 0), P(10, 0))).toBe(100);
  });

  it('sums over the whole chain', () => {
    // Two straight joins.
    expect(chainCornerCost([P(0, 0), P(10, 0), P(20, 0), P(30, 0)])).toBe(10);
  });

  it('is zero for a chain with no corners to have', () => {
    expect(chainCornerCost([P(0, 0), P(10, 0)])).toBe(0);
    expect(chainCornerCost([P(0, 0)])).toBe(0);
  });
});

describe('dropping points inside a straight run', () => {
  it('removes the middle of three collinear points', () => {
    expect(at(mergeColinear([P(0, 0), P(5, 0), P(10, 0), P(10, 10)]))).toEqual([
      '0,0',
      '10,0',
      '10,10',
    ]);
  });

  it('removes several in a row', () => {
    expect(at(mergeColinear([P(0, 0), P(2, 0), P(4, 0), P(6, 0), P(6, 5)]))).toEqual([
      '0,0',
      '6,0',
      '6,5',
    ]);
  });

  it('keeps a genuine corner', () => {
    expect(at(mergeColinear([P(0, 0), P(10, 0), P(10, 10)]))).toEqual(['0,0', '10,0', '10,10']);
  });

  it('leaves a zero-length segment alone rather than merging through it', () => {
    // It has no direction to be collinear with, so treating it as collinear
    // would remove a real point on the strength of a meaningless answer.
    expect(mergeColinear([P(0, 0), P(0, 0), P(10, 10)])).toHaveLength(3);
  });
});

describe('collapsing obtuse pairs', () => {
  // Four segments minimum: upstream starts its span at `PointCount() - 3` and
  // gives up below two, so a shorter chain is returned untouched. A six-point
  // staircase is the smallest thing this pass can do anything with.
  const STAIR = [P(0, 0), P(10, 0), P(20, 10), P(30, 10), P(40, 20), P(50, 20)];

  it('replaces a staircase with the corner it is really turning', () => {
    expect(at(mergeObtuse(STAIR, clear))).toEqual(['0,0', '20,0', '40,20', '50,20']);
  });

  it('refuses a shortcut that would collide', () => {
    // The rule that keeps the optimiser from undoing walkaround's work.
    expect(at(mergeObtuse(STAIR, () => true))).toEqual(at(STAIR));
  });

  it('refuses a shortcut whose corner would be sharper than what it replaces', () => {
    // Two segments can be obtuse to each other and still meet *behind* the
    // first one's start. Here (0,0)->(10,0) heads east and (10,50)->(60,100)
    // heads north-east — obtuse — but their lines cross at (-40,0), so the
    // "shortcut" would double back to x=-40, away from both endpoints, and
    // turn acutely to get there. Nothing is in the way; it is rejected on the
    // angle alone.
    const backwards = [P(0, 0), P(10, 0), P(10, 50), P(60, 100), P(110, 100)];

    expect(at(mergeObtuse(backwards, clear))).toEqual(at(backwards));
  });

  it('will not extend an acute pair into an obtuse one', () => {
    // The pair has to be obtuse *before* extending, not just after. Here
    // (0,0)->(10,0) heads east and the fourth segment heads north-west: acute,
    // so it is never considered. It matters that the check happens up front,
    // because extending flips a direction by 180 degrees and an acute pair can
    // come out obtuse on the far side — these two lines meet at (-50,0) and
    // the extended pair reads as a legal obtuse bend. Judging it after the
    // fact would accept a route that runs backwards past its own start.
    const trap = [P(0, 0), P(10, 0), P(-40, 50), P(-100, 50), P(-110, 60), P(-110, 100)];

    expect(at(mergeObtuse(trap, clear))).toEqual(at(trap));
  });

  it('leaves a chain with too few segments to span', () => {
    // Not a failure — the span has nowhere to start.
    const short = [P(0, 0), P(10, 0), P(20, 10), P(30, 10)];

    expect(at(mergeObtuse(short, clear))).toEqual(at(short));
  });

  it('leaves a chain too short to have a span alone', () => {
    expect(at(mergeObtuse([P(0, 0), P(10, 0)], clear))).toEqual(['0,0', '10,0']);
  });
});

describe('replacing runs with cheaper traces', () => {
  it('turns a detour into a two-segment trace when nothing is in the way', () => {
    const detour = [P(0, 0), P(10, 0), P(10, 10), P(20, 10), P(20, 20), P(30, 20)];
    const merged = mergeFull(detour, clear);

    expect(chainCornerCost(merged)).toBeLessThan(chainCornerCost(detour));
    expect(merged[0]).toEqual(P(0, 0));
    expect(merged[merged.length - 1]).toEqual(P(30, 20));
  });

  it('leaves it alone when every shortcut collides', () => {
    const detour = [P(0, 0), P(10, 0), P(10, 10), P(20, 10), P(20, 20), P(30, 20)];

    expect(at(mergeFull(detour, () => true))).toEqual(at(mergeColinear(detour)));
  });

  // Why both postures get built. A run can be replaced by leaving along an
  // axis and turning, or by turning first and running diagonally; the two
  // sweep different ground, so one can be blocked where the other is not.
  // Neither of these fails outright when only one posture is tried, which is
  // what makes them worth pinning — it quietly settles for a worse route.
  const blocker = (x0: number, x1: number, y0: number, y1: number) => {
    const inside = (p: Vec2): boolean => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    return (path: readonly Vec2[]): boolean => {
      for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        for (let t = 0; t <= 200; t++)
          if (inside({ x: a.x + ((b.x - a.x) * t) / 200, y: a.y + ((b.y - a.y) * t) / 200 }))
            return true;
      }
      return false;
    };
  };

  it('finds the diagonal-first route when the axis-first one is blocked', () => {
    // A low box across the axis-first exit from (0,0); the diagonal climbs
    // straight over it. Axis-first alone settles for cost 40.
    const blocked = blocker(20, 80, -10, 10);
    const detour = [P(0, 0), P(0, 20), P(60, 80), P(100, 40), P(140, 40)];
    expect(chainCornerCost(detour)).toBe(50);

    const merged = mergeFull(detour, blocked);

    expect(at(merged)).toEqual(['0,0', '40,40', '140,40']);
    expect(chainCornerCost(merged)).toBe(10);
    expect(blocked(merged)).toBe(false);
  });

  it('finds the axis-first route when the diagonal-first one is blocked', () => {
    // The mirror, so the pair pins *both* postures rather than either one. A
    // tall box now sits over the diagonal exit and the axis route runs under
    // it. Diagonal-first alone settles for cost 30.
    const blocked = blocker(10, 60, 25, 90);
    const detour = [P(0, 0), P(20, 0), P(20, 20), P(80, 20), P(100, 40), P(140, 40)];
    expect(chainCornerCost(detour)).toBe(80);
    expect(blocked(detour)).toBe(false);

    const merged = mergeFull(detour, blocked);

    expect(at(merged)).toEqual(['0,0', '100,0', '140,40']);
    expect(chainCornerCost(merged)).toBe(10);
    expect(blocked(merged)).toBe(false);
  });
});

describe('running the passes together', () => {
  it('does nothing to a chain with no corners', () => {
    expect(at(optimize([P(0, 0), P(10, 0)], clear))).toEqual(['0,0', '10,0']);
  });

  it('still tidies a chain with only one corner', () => {
    expect(at(optimize([P(0, 0), P(5, 0), P(10, 0)], clear))).toEqual(['0,0', '10,0']);
  });

  it('runs each pass only when it is asked for', () => {
    const stair = [P(0, 0), P(10, 0), P(20, 10), P(30, 10), P(40, 20), P(50, 20)];

    // Each flag reaches a different answer, which is how we know the pass is
    // actually wired to its flag rather than another pass doing the work.
    // The staircase has no straight run in it, so the collinear flag needs a
    // chain that does or it would assert nothing.
    expect(
      at(optimize([P(0, 0), P(5, 0), P(10, 0), P(10, 10)], clear, { mergeColinear: true })),
    ).toEqual(['0,0', '10,0', '10,10']);
    expect(at(optimize(stair, clear, { mergeColinear: true }))).toEqual(at(stair));

    // ...and the same chain must come back untouched when the collinear flag
    // is *not* set, or "wired to its flag" is only half checked. Four points
    // is below what the obtuse pass can span, so nothing else touches it.
    expect(
      at(optimize([P(0, 0), P(5, 0), P(10, 0), P(10, 10)], clear, { mergeObtuse: true })),
    ).toEqual(['0,0', '5,0', '10,0', '10,10']);

    expect(at(optimize(stair, clear, { mergeObtuse: true }))).toEqual([
      '0,0',
      '20,0',
      '40,20',
      '50,20',
    ]);
    expect(at(optimize(stair, clear, { mergeSegments: true }))).toEqual(['0,0', '20,20', '50,20']);
  });

  it('never leaves a repeated point behind', () => {
    // The caller lays a track segment between each pair, and a repeated point
    // is a zero-length segment on the board. Nothing may merge here — every
    // shortcut collides — so the duplicate survives every pass and only the
    // final trim removes it.
    const out = optimize([P(0, 0), P(10, 0), P(10, 0), P(20, 0)], () => true);

    expect(at(out)).toEqual(['0,0', '10,0', '20,0']);
    for (let i = 1; i < out.length; i++) expect(out[i]).not.toEqual(out[i - 1]);
  });
});

describe('on a route walkaround actually produced', () => {
  // The reason the file exists. Three vias in a row, routed past, then tidied.
  const HULLS = [
    viaHull(P(1000, 500), 300, 100, 150),
    viaHull(P(2000, 500), 300, 100, 150),
    viaHull(P(3000, 500), 300, 100, 150),
  ];

  const collides = (path: readonly Vec2[]): boolean => {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      for (let t = 0; t <= 40; t++) {
        const p = {
          x: Math.round(a.x + ((b.x - a.x) * t) / 40),
          y: Math.round(a.y + ((b.y - a.y) * t) / 40),
        };
        for (const h of HULLS) if (pointInside(h, p) && !pointOnEdge(h, p)) return true;
      }
    }
    return false;
  };

  const walked = routeShortest([P(0, 500), P(4000, 500)], HULLS).path;

  it('starts from a route that hugs every hull it passes', () => {
    // Correct, and not what anyone would draw: it traces octagon corners that
    // stop mattering the moment the path is clear of them.
    expect(walked.length).toBeGreaterThan(15);
  });

  it('cuts it down to a handful of points', () => {
    expect(optimize(walked, collides).length).toBeLessThan(6);
  });

  it('makes it turn far less', () => {
    expect(chainCornerCost(optimize(walked, collides))).toBeLessThan(chainCornerCost(walked) / 5);
  });

  it('keeps it clear of every obstacle', () => {
    // The whole exercise is worthless if the tidy-up routes back through the
    // copper walkaround went round.
    expect(collides(optimize(walked, collides))).toBe(false);
  });

  it('keeps the endpoints the route was asked for', () => {
    const out = optimize(walked, collides);

    expect(out[0]).toEqual(P(0, 500));
    expect(out[out.length - 1]).toEqual(P(4000, 500));
  });

  it('would cut straight through if the collision test were ignored', () => {
    // Stated so the previous test is visibly load bearing: with nothing in the
    // way the optimiser reduces the same route to the straight line, which on
    // this board goes through all three vias.
    const reckless = optimize(walked, clear);

    expect(reckless.length).toBeLessThan(4);
    expect(collides(reckless)).toBe(true);
  });
});
