// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `SHAPE_LINE_CHAIN` operations the router walks hulls with.
 * Counterparts: `PointInside`, `EdgeContainingPoint`, `Find`, `Split` and
 * `HullIntersection`.
 *
 * Walkaround builds a graph from a path's points and a hull's points together,
 * classifies each as inside the hull, outside it, or exactly *on* its edge, and
 * walks from one end of the path to the other. Two things here decide whether
 * that walk can work at all:
 *
 * 1. **"On the edge" is a third answer, not a tie-break.** It is where a path
 *    enters or leaves an obstacle, and therefore where the route switches
 *    between following the path and following the hull. Fold it into either of
 *    the other two and the walk either cuts the corner or refuses to leave.
 * 2. **A graze is not a crossing.** A path running along the outside of a hull
 *    registers a hit at every corner it touches. Counting those as entries
 *    sends the router round an obstacle it was already clear of — there is a
 *    test below where the raw count is two and the real one is zero.
 */
import { describe, expect, it } from 'vitest';
import {
  edgeContainingPoint,
  findPoint,
  hullIntersection,
  pointInside,
  pointOnEdge,
  rawIntersections,
  splitAt,
} from '@ziroeda/pcbnew/src/router/pns_chain.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const P = (x: number, y: number): Vec2 => ({ x, y });
const SQUARE = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)];
const at = (c: readonly Vec2[]): string[] => c.map((p) => `${p.x},${p.y}`);

describe('in, out, or on the edge', () => {
  it('are three answers, not two', () => {
    // The distinction the whole walk turns on.
    expect([pointInside(SQUARE, P(50, 50)), pointOnEdge(SQUARE, P(50, 50))]).toEqual([true, false]);
    expect([pointInside(SQUARE, P(150, 50)), pointOnEdge(SQUARE, P(150, 50))]).toEqual([
      false,
      false,
    ]);
    expect([pointInside(SQUARE, P(50, 0)), pointOnEdge(SQUARE, P(50, 0))]).toEqual([false, true]);
  });

  it('put a corner on the edge, not inside', () => {
    expect(pointInside(SQUARE, P(0, 0))).toBe(false);
    expect(pointOnEdge(SQUARE, P(0, 0))).toBe(true);
  });

  it('report which edge a point is on', () => {
    expect(edgeContainingPoint(SQUARE, P(50, 0))).toBe(0);
    expect(edgeContainingPoint(SQUARE, P(100, 50))).toBe(1);
    expect(edgeContainingPoint(SQUARE, P(50, 50))).toBe(-1);
  });

  it('count the wrapping edge only for a closed chain', () => {
    // A hull wraps and a path does not, and the last edge is the difference.
    expect(edgeContainingPoint(SQUARE, P(0, 50), 0, true)).toBe(3);
    expect(edgeContainingPoint(SQUARE, P(0, 50), 0, false)).toBe(-1);
  });

  it('accept a point one internal unit off the edge', () => {
    // The threshold is `accuracy + 1` and never zero. Both the hull and the
    // path have been through rounding, so a point that misses by a nanometre
    // must still count as on the edge — classified inside or outside it would
    // send the walk the wrong way.
    expect(pointOnEdge(SQUARE, P(50, 1))).toBe(true);
    expect(pointOnEdge(SQUARE, P(50, 5))).toBe(false);
    expect(pointOnEdge(SQUARE, P(50, 5), 10)).toBe(true);
  });

  it('call nothing inside a chain too small to enclose anything', () => {
    // True by arithmetic rather than by the guard: a doubled segment is
    // crossed twice or not at all, so the toggle always lands back where it
    // started. The guard is there to say so, not to make it so.
    expect(pointInside([P(0, 0), P(0, 100)], P(-50, 50))).toBe(false);
    expect(pointInside([P(0, 0), P(100, 0)], P(50, 0))).toBe(false);
  });
});

describe('finding a vertex', () => {
  it('is exact by default, because a near miss means a duplicate', () => {
    // The caller uses this to ask whether a point it just spliced in is
    // already present; treating "close" as "found" leaves two vertices a
    // nanometre apart.
    expect(findPoint(SQUARE, P(100, 0))).toBe(1);
    expect(findPoint(SQUARE, P(100, 1))).toBe(-1);
  });

  it('takes a tolerance when the caller wants one', () => {
    expect(findPoint(SQUARE, P(100, 1), 5)).toBe(1);
  });
});

describe('splicing a point into a chain', () => {
  it('inserts it on the segment it lies on', () => {
    const { chain, index } = splitAt(SQUARE, P(50, 0), true);

    expect(index).toBe(1);
    expect(at(chain)).toEqual(['0,0', '50,0', '100,0', '100,100', '0,100']);
  });

  it('leaves an existing vertex alone', () => {
    const { chain, index } = splitAt(SQUARE, P(100, 0), true);

    expect(index).toBe(1);
    expect(chain).toHaveLength(4);
  });

  it('refuses a point that is not on the chain at all', () => {
    // Appending it would move the chain's end, which is never what the caller
    // meant.
    const { chain, index } = splitAt(SQUARE, P(500, 500), true);

    expect(index).toBe(-1);
    expect(chain).toHaveLength(4);
  });

  it('splices a point just past a segment’s end into that segment', () => {
    // The threshold of 2 is a search *radius*, not a minimum separation from
    // existing vertices — so a point a unit beyond the corner really does go
    // into the preceding edge, spur and all. I had this backwards until the
    // test disagreed; upstream does the same thing.
    const { chain, index } = splitAt(SQUARE, P(101, 0), true);

    expect(index).toBe(1);
    expect(at(chain)).toEqual(['0,0', '101,0', '100,0', '100,100', '0,100']);
  });

  it('short-circuits on an existing vertex only when asked to be exact', () => {
    // The router calls this with `exact` off, so a point that is already a
    // vertex still runs the search — which is what lets an earlier segment
    // passing near the same place win. On a self-touching path that is the
    // difference between splicing into the right lobe of the loop and the
    // wrong one.
    expect(splitAt(SQUARE, P(100, 0), true, true).index).toBe(1);
    expect(splitAt(SQUARE, P(100, 0), true, false).index).toBe(1);
  });

  it('prefers an earlier segment passing near the same place', () => {
    // The reason `exact` is off. This path ends a hair above its own first
    // segment, so the point (50, 1) is both the last *vertex* and within a
    // unit of segment 0. Upstream splices it into the earlier segment rather
    // than resolving to the later vertex — on a self-touching path that is the
    // difference between the right lobe of the loop and the wrong one.
    const loop = [P(0, 0), P(100, 0), P(100, 100), P(50, 1)];

    expect(splitAt(loop, P(50, 1), false, false).index).toBe(1);
    // Asked to be exact, it takes the vertex it already has.
    expect(splitAt(loop, P(50, 1), false, true).index).toBe(3);
  });

  it('refuses a *later* segment passing near an earlier vertex', () => {
    // The other half of the same rule, and the half that actually needs the
    // index comparison. Here the near segment comes after the vertex, so it
    // must lose — splicing there would move a crossing to the far end of a
    // path that doubles back on itself.
    const doubled = [P(50, 1), P(200, 1), P(200, 100), P(0, 100), P(0, 0), P(100, 0)];

    expect(splitAt(doubled, P(50, 1), false, false).index).toBe(0);
    expect(splitAt(doubled, P(50, 1), false, false).chain).toHaveLength(doubled.length);
  });

  it('uses the wrapping edge only when the chain is closed', () => {
    expect(splitAt(SQUARE, P(0, 50), true).index).toBe(4);
    expect(splitAt(SQUARE, P(0, 50), false).index).toBe(-1);
  });
});

describe('where a path crosses a hull', () => {
  it('finds both crossings of a path straight through', () => {
    const hits = hullIntersection(SQUARE, [P(-50, 50), P(150, 50)]);

    expect(hits.map((h) => `${h.p.x},${h.p.y}`).sort()).toEqual(['0,50', '100,50']);
  });

  it('finds nothing at all when the path misses', () => {
    expect(hullIntersection(SQUARE, [P(-50, -50), P(-50, 150)])).toEqual([]);
  });

  it('counts a graze along an edge as no crossing whatsoever', () => {
    // The headline case. A path running exactly along the hull's top edge
    // registers a raw hit at each corner it touches; neither takes it from one
    // side to the other. Count them and the router walks around an obstacle it
    // was already clear of.
    const along = [P(-50, 0), P(150, 0)];

    expect(rawIntersections(SQUARE, along).length).toBeGreaterThan(0);
    expect(hullIntersection(SQUARE, along)).toEqual([]);
  });

  it('does count a path that goes in through a corner', () => {
    // Same kind of hit — landing exactly on a vertex — but this one really
    // does pass from outside to inside.
    const hits = hullIntersection(SQUARE, [P(-50, -50), P(50, 50)]);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.p).toEqual(P(0, 0));
  });

  it('says which hull edge and which path segment met', () => {
    // Walkaround splices crossings into both chains, so it needs to know where
    // in each the crossing belongs.
    const [hit] = hullIntersection(SQUARE, [P(50, -50), P(50, 50)]);

    expect(hit?.indexOur).toBe(0);
    expect(hit?.indexTheir).toBe(0);
  });

  it('does not count a path that ends *on* the hull', () => {
    // Regression. A path that reaches the boundary and stops has not crossed
    // it — that is what routing up to a pad looks like. The corner test used
    // to sample "just after" the hit toward the very vertex the hit sat on,
    // which is the hit again, and read the boundary as the far side. The
    // walkaround driver then found the same obstacle for ever.
    expect(hullIntersection(SQUARE, [P(-50, 50), P(0, 50)])).toEqual([]);
  });

  it('does not count a path that starts on the hull and leaves', () => {
    // The mirror case: no near side to compare against.
    expect(hullIntersection(SQUARE, [P(0, 50), P(-50, 50)])).toEqual([]);
  });

  it('does not count a path that arrives and turns along the edge', () => {
    // Both samples land on the boundary, where ray casting answers whichever
    // way the rounding fell — so "on the edge" has to be a third answer here
    // too, not folded into inside or outside.
    expect(hullIntersection(SQUARE, [P(-50, 50), P(0, 50), P(0, 20)])).toEqual([]);
  });

  it('reports nothing for a path with no segments', () => {
    expect(hullIntersection(SQUARE, [P(50, 50)])).toEqual([]);
  });

  it('reports each crossing point once', () => {
    // A path passing exactly through a hull vertex meets two hull edges there.
    const hits = hullIntersection(SQUARE, [P(-50, -50), P(150, 150)]);
    const keys = hits.map((h) => `${h.p.x},${h.p.y}`);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
