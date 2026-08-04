// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Routing a line around an obstacle.
 * Counterpart: `LINE::Walkaround`.
 *
 * The first piece of the router with behaviour anyone can see: a track that
 * meets a pad and bends past it rather than through it.
 *
 * The property that matters is not the exact list of points — several routes
 * are legitimate — but that **the result stays clear of the hull**. Most tests
 * below assert that directly, with `staysClear`, rather than pinning
 * coordinates that a better route would change. The coordinates are pinned in
 * one place only, where the shape of the detour is itself the claim.
 *
 * The second property is that the two directions really are two *sides*. A
 * router asks for both and keeps the shorter, so a `cw` flag that changed the
 * answer without changing which way round it went would be worse than useless.
 */
import { describe, expect, it } from 'vitest';
import { walkaround } from '@ziroeda/pcbnew/src/router/pns_walkaround.js';
import { pointInside, pointOnEdge } from '@ziroeda/pcbnew/src/router/pns_chain.js';
import { segmentHull, viaHull } from '@ziroeda/pcbnew/src/router/pns_hull.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const P = (x: number, y: number): Vec2 => ({ x, y });
const at = (c: readonly Vec2[] | null): string[] => (c ?? []).map((p) => `${p.x},${p.y}`);

/** A square obstacle in the middle of the board. */
const HULL = [P(40, 40), P(60, 40), P(60, 60), P(40, 60)];

/**
 * Does the route keep out of the obstacle?
 *
 * Sampled along each segment rather than at the corners: a route whose points
 * are all outside can still cut straight through, which is precisely the
 * failure a walkaround has to avoid.
 */
function staysClear(path: readonly Vec2[] | null, hull: readonly Vec2[]): boolean {
  if (!path) return false;

  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;

    for (let t = 0; t <= 20; t++) {
      const p = {
        x: Math.round(a.x + ((b.x - a.x) * t) / 20),
        y: Math.round(a.y + ((b.y - a.y) * t) / 20),
      };
      if (pointInside(hull, p) && !pointOnEdge(hull, p)) return false;
    }
  }

  return true;
}

describe('a path that runs into an obstacle', () => {
  const THROUGH = [P(0, 50), P(100, 50)];

  it('comes back clear of it', () => {
    expect(staysClear(walkaround(THROUGH, HULL, true), HULL)).toBe(true);
  });

  it('still starts and ends where it was asked to', () => {
    // A detour that moves the endpoints is not a detour, it is a different
    // route.
    const path = walkaround(THROUGH, HULL, true)!;

    expect(path[0]).toEqual(P(0, 50));
    expect(path[path.length - 1]).toEqual(P(100, 50));
  });

  it('takes the shape of the obstacle it is passing', () => {
    // The one place coordinates are pinned, because the detour's shape is the
    // claim: out to the hull, along two of its edges, and back.
    expect(at(walkaround(THROUGH, HULL, true))).toEqual([
      '0,50',
      '40,50',
      '40,40',
      '60,40',
      '60,50',
      '100,50',
    ]);
  });
});

describe('the two directions are two sides', () => {
  const THROUGH = [P(0, 50), P(100, 50)];

  it('go round opposite ways', () => {
    // A router asks for both and keeps the shorter, so a flag that changed the
    // answer without changing the side would be worse than useless.
    const cw = walkaround(THROUGH, HULL, true)!;
    const ccw = walkaround(THROUGH, HULL, false)!;

    expect(cw.some((p) => p.y < 50)).toBe(true);
    expect(cw.some((p) => p.y > 50)).toBe(false);
    expect(ccw.some((p) => p.y > 50)).toBe(true);
    expect(ccw.some((p) => p.y < 50)).toBe(false);
  });

  it('are both clear of the obstacle', () => {
    expect(staysClear(walkaround(THROUGH, HULL, true), HULL)).toBe(true);
    expect(staysClear(walkaround(THROUGH, HULL, false), HULL)).toBe(true);
  });
});

describe('a path that does not need a detour', () => {
  it('comes back unchanged', () => {
    const clear = [P(0, 0), P(100, 0)];

    expect(at(walkaround(clear, HULL, true))).toEqual(['0,0', '100,0']);
  });

  it('is left alone even when it grazes the hull’s edge', () => {
    // Running along the boundary is legal — that is what a track hugging its
    // clearance looks like — and the graze filter is what stops it being
    // treated as an entry.
    const grazing = [P(0, 40), P(100, 40)];

    expect(at(walkaround(grazing, HULL, true))).toEqual(['0,40', '100,40']);
  });
});

describe('what walkaround refuses', () => {
  it('refuses a path that begins inside the obstacle', () => {
    // There is nowhere to walk *from*. Null is the honest answer; the router's
    // response is to reject the move, not to invent a route out of copper.
    expect(walkaround([P(50, 50), P(100, 50)], HULL, true)).toBeNull();
  });

  it('accepts one that begins exactly on the edge', () => {
    // The ordinary case of leaving a pad. Treating the boundary as inside
    // would make a great many legitimate routes unroutable.
    const path = walkaround([P(40, 50), P(100, 50)], HULL, true);

    expect(path).not.toBeNull();
    expect(staysClear(path, HULL)).toBe(true);
  });

  it('refuses a path with no segments at all', () => {
    expect(walkaround([P(0, 50)], HULL, true)).toBeNull();
  });
});

describe('a path that ends inside the obstacle', () => {
  // The cursor is over the pad. Rather than circle the hull forever, the walk
  // stops at the point nearest where the path was trying to reach.
  const INTO = [P(0, 50), P(50, 50)];

  it('still produces a route', () => {
    expect(walkaround(INTO, HULL, true)).not.toBeNull();
  });

  it('stops on the hull rather than going in', () => {
    const path = walkaround(INTO, HULL, true)!;
    const end = path[path.length - 1]!;

    expect(pointInside(HULL, end) && !pointOnEdge(HULL, end)).toBe(false);
    expect(staysClear(path, HULL)).toBe(true);
  });

  it('stops near where the path was heading, not at an arbitrary corner', () => {
    // The projection onto the hull edge: the path wanted (50, 50), and the
    // nearest reachable point on the way round is directly above it.
    const end = walkaround(INTO, HULL, true)!.slice(-1)[0]!;

    expect(end.x).toBe(50);
  });
});

describe('a path with a corner inside the obstacle', () => {
  // Distinct from a path that merely passes through: here one of the path's
  // own vertices is buried in the hull, so the walk has to step over it rather
  // than route to it. Nothing else in the file produces an inside vertex,
  // because a path split only at its crossings has none.
  const OVER = [P(0, 50), P(50, 50), P(100, 50)];

  it('leaves the buried corner out of the route', () => {
    const path = walkaround(OVER, HULL, true)!;

    expect(at(path)).not.toContain('50,50');
    expect(staysClear(path, HULL)).toBe(true);
  });

  it('still routes round, both ways', () => {
    expect(staysClear(walkaround(OVER, HULL, true), HULL)).toBe(true);
    expect(staysClear(walkaround(OVER, HULL, false), HULL)).toBe(true);
  });

  it('keeps the endpoints', () => {
    const path = walkaround(OVER, HULL, true)!;

    expect(path[0]).toEqual(P(0, 50));
    expect(path[path.length - 1]).toEqual(P(100, 50));
  });

  it('handles a corner that pokes in at an angle', () => {
    const angled = [P(0, 45), P(50, 55), P(100, 45)];

    expect(staysClear(walkaround(angled, HULL, true), HULL)).toBe(true);
  });
});

describe('against the hulls the router actually builds', () => {
  // A square is a convenient fixture and not a realistic one: real hulls are
  // octagons with chamfered corners, and the walk has to hand over between
  // path and hull at points that are not axis-aligned.
  const VIA = viaHull(P(500, 500), 400, 150, 200);
  const SEG = segmentHull(P(400, 300), P(400, 700), 200, 150, 200);

  it('routes round a via hull', () => {
    expect(staysClear(walkaround([P(0, 500), P(1000, 500)], VIA, true), VIA)).toBe(true);
  });

  it('routes round it diagonally too', () => {
    const diag = walkaround([P(0, 0), P(1000, 1000)], VIA, true);

    expect(staysClear(diag, VIA)).toBe(true);
    expect(diag![0]).toEqual(P(0, 0));
    expect(diag![diag!.length - 1]).toEqual(P(1000, 1000));
  });

  it('routes a zig-zag round it', () => {
    const zig = [P(0, 500), P(500, 200), P(500, 800), P(1000, 500)];

    expect(staysClear(walkaround(zig, VIA, true), VIA)).toBe(true);
  });

  it('routes round a track hull, on either side', () => {
    const cw = walkaround([P(0, 500), P(1000, 500)], SEG, true)!;
    const ccw = walkaround([P(0, 500), P(1000, 500)], SEG, false)!;

    expect(staysClear(cw, SEG)).toBe(true);
    expect(staysClear(ccw, SEG)).toBe(true);
    // Genuinely opposite sides of the track.
    expect(cw.some((p) => p.y < 0)).toBe(true);
    expect(ccw.some((p) => p.y > 1000)).toBe(true);
  });
});

describe('an obstacle met more than once', () => {
  it('is cleared every time', () => {
    // A zig-zag that enters, leaves and re-enters. The clipping approach —
    // cut at the first crossing, splice, done — gets this wrong; the graph
    // walk does not have to special-case it.
    const zigzag = [P(0, 50), P(50, 30), P(50, 70), P(100, 50)];

    expect(staysClear(walkaround(zigzag, HULL, true), HULL)).toBe(true);
  });
});
