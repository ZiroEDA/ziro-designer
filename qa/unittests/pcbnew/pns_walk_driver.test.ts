// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Walking around *every* obstacle, not just one.
 * Counterparts: `WALKAROUND::Route` and `WALKAROUND::singleStep`.
 *
 * `LINE::Walkaround` gets a path past one hull. This is the loop around it, and
 * the loop exists because a detour around one obstacle routinely puts the path
 * into another — on a dense board that is the ordinary case, not an edge case.
 *
 * Two things are worth testing beyond "it finishes":
 *
 * 1. **Obstacles are taken in the order the route meets them.** Any other order
 *    makes each detour invalidate the last, and the loop never settles.
 * 2. **Giving up is a decision with two answers.** A route that cannot get past
 *    an obstacle is `stuck`; one that is merely growing out of all proportion
 *    is `almost-done`, and its path so far is still usable. Collapsing them
 *    loses the difference between "no route exists" and "this is taking too
 *    long".
 */
import { describe, expect, it } from 'vitest';
import {
  nearestObstacle,
  routeAround,
  routeShortest,
} from '@ziroeda/pcbnew/src/router/pns_walkaround.js';
import { viaHull } from '@ziroeda/pcbnew/src/router/pns_hull.js';
import { pointInside, pointOnEdge } from '@ziroeda/pcbnew/src/router/pns_chain.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const P = (x: number, y: number): Vec2 => ({ x, y });

/** A via hull reaches 325 either side of its centre at these numbers. */
const via = (x: number, y: number, d = 300): Vec2[] => viaHull(P(x, y), d, 100, 150);

/** Three obstacles in a row, spaced so their hulls do not overlap. */
const THREE = [via(1000, 500), via(2000, 500), via(3000, 500)];
/** The same, nudged off the route so the two ways round differ in length. */
const LOPSIDED = [via(1000, 620), via(2000, 620), via(3000, 620)];
const ACROSS = [P(0, 500), P(4000, 500)];

/** Does the route clear every hull, sampled along each segment? */
function staysClear(path: readonly Vec2[], hulls: readonly Vec2[][]): boolean {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;

    for (let t = 0; t <= 30; t++) {
      const p = {
        x: Math.round(a.x + ((b.x - a.x) * t) / 30),
        y: Math.round(a.y + ((b.y - a.y) * t) / 30),
      };
      for (const h of hulls) if (pointInside(h, p) && !pointOnEdge(h, p)) return false;
    }
  }
  return true;
}

describe('which obstacle comes first', () => {
  it('is the one the route meets soonest, not the nearest to anything else', () => {
    // Taking them in any other order makes each detour invalidate the last.
    expect(nearestObstacle(ACROSS, THREE)).toBe(0);
  });

  it('follows the direction of travel', () => {
    expect(nearestObstacle([P(4000, 500), P(0, 500)], THREE)).toBe(2);
  });

  it('is nothing when the route is clear', () => {
    expect(nearestObstacle([P(0, 0), P(4000, 0)], THREE)).toBeNull();
  });

  it('is nothing for a path with no segments', () => {
    expect(nearestObstacle([P(0, 500)], THREE)).toBeNull();
  });

  it('treats a route already inside a hull as the most urgent of all', () => {
    // It has no crossing to measure the distance to, and it is the one thing
    // that has to be dealt with before anything else.
    const inside = [P(1000, 500), P(4000, 500)];

    expect(nearestObstacle(inside, THREE)).toBe(0);
  });

  it('finds a route buried wholly inside a hull, which crosses nothing', () => {
    // The worst collision to miss, and the only one the crossing test cannot
    // see: both ends are in the copper, so the path meets no boundary at all.
    const buried = [P(900, 500), P(1100, 500)];

    expect(nearestObstacle(buried, THREE)).toBe(0);
  });
});

describe('routing past several obstacles', () => {
  it('gets past all of them', () => {
    const { path, status } = routeAround(ACROSS, THREE, true);

    expect(status).toBe('done');
    expect(staysClear(path, THREE)).toBe(true);
  });

  it('does it either way round', () => {
    const cw = routeAround(ACROSS, THREE, true);
    const ccw = routeAround(ACROSS, THREE, false);

    expect(cw.status).toBe('done');
    expect(ccw.status).toBe('done');
    expect(staysClear(cw.path, THREE)).toBe(true);
    expect(staysClear(ccw.path, THREE)).toBe(true);
  });

  it('keeps the endpoints it was given', () => {
    const { path } = routeAround(ACROSS, THREE, true);

    expect(path[0]).toEqual(P(0, 500));
    expect(path[path.length - 1]).toEqual(P(4000, 500));
  });

  it('leaves a clear route completely alone', () => {
    const clear = [P(0, 0), P(4000, 0)];

    expect(routeAround(clear, THREE, true)).toEqual({ path: clear, status: 'done' });
  });

  it('needs no obstacles to succeed', () => {
    expect(routeAround(ACROSS, [], true).status).toBe('done');
  });
});

describe('giving up', () => {
  it('reports almost-done when the route grows out of proportion', () => {
    // Not stuck — the path so far is usable. Continuing to the iteration limit
    // would only make the editor lag while the user waits for a route that was
    // never going to be good.
    const { status } = routeAround(ACROSS, THREE, true, { lengthExpansionFactor: 1.0001 });

    expect(status).toBe('almost-done');
  });

  it('keeps going when the length limit is switched off', () => {
    const { status } = routeAround(ACROSS, THREE, true, {
      lengthLimit: false,
      lengthExpansionFactor: 1.0001,
    });

    expect(status).toBe('done');
  });

  it('reports almost-done when it runs out of iterations', () => {
    // Distinct again from stuck: nothing said the route was impossible, only
    // that the loop was told to stop looking.
    expect(routeAround(ACROSS, THREE, true, { iterationLimit: 1 }).status).toBe('almost-done');
  });

  it('reports stuck when there is no way round at all', () => {
    // A route beginning inside an obstacle: `LINE::Walkaround` refuses it, and
    // that refusal is a different thing from running out of patience.
    const fromInside = [P(1000, 500), P(4000, 500)];

    expect(routeAround(fromInside, THREE, true).status).toBe('stuck');
  });
});

describe('trying both ways and keeping the better', () => {
  it('prefers a route that clears everything over a shorter one that does not', () => {
    // A short path through a pad is not a path. Length only decides between
    // two routes that both work, or two that both fail.
    //
    // This obstacle field was found by search rather than drawn: it needs the
    // *working* route to be the longer one, which is the only arrangement that
    // can tell the preference apart from simply taking the shorter path. Going
    // clockwise here gives up at 4527 units; anticlockwise finishes at 4770,
    // and 4770 is the right answer.
    const awkward = [via(2726, 521, 212), via(3204, 695, 380), via(3294, 472, 208)];

    const cw = routeAround(ACROSS, awkward, true);
    const ccw = routeAround(ACROSS, awkward, false);
    const best = routeShortest(ACROSS, awkward);

    expect(cw.status).not.toBe('done');
    expect(ccw.status).toBe('done');
    expect(best.status).toBe('done');
    expect(best.cw).toBe(false);
  });

  it('falls back to length when both directions fail alike', () => {
    const fromInside = [P(1000, 500), P(4000, 500)];

    expect(routeShortest(fromInside, THREE).status).toBe('stuck');
  });

  it('picks the shorter when both work', () => {
    // Deliberately *asymmetric*: with obstacles centred on the route the two
    // directions come out the same length and the comparison proves nothing.
    const cw = routeAround(ACROSS, LOPSIDED, true);
    const ccw = routeAround(ACROSS, LOPSIDED, false);
    const best = routeShortest(ACROSS, LOPSIDED);

    const len = (c: readonly Vec2[]): number => {
      let l = 0;
      for (let i = 0; i + 1 < c.length; i++)
        l += Math.hypot(c[i + 1]!.x - c[i]!.x, c[i + 1]!.y - c[i]!.y);
      return l;
    };

    expect(len(cw.path)).not.toBeCloseTo(len(ccw.path), -3); // genuinely lopsided
    expect(len(best.path)).toBeCloseTo(Math.min(len(cw.path), len(ccw.path)), -3);
    expect(best.status).toBe('done');
  });

  it('says which way round it went', () => {
    // The caller needs it: the two directions are two different routes, and a
    // result that did not say which would be unusable for anything downstream.
    expect(typeof routeShortest(ACROSS, THREE).cw).toBe('boolean');
  });

  it('still clears every obstacle', () => {
    expect(staysClear(routeShortest(ACROSS, THREE).path, THREE)).toBe(true);
  });
});
