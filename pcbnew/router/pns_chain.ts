// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `SHAPE_LINE_CHAIN` operations the router walks hulls with.
 * Counterparts: `PointInside`, `EdgeContainingPoint` / `PointOnEdge`, `Find`
 * and `Split` (libs/kimath/src/geometry/shape_line_chain.cpp).
 * `HullIntersection` (pcbnew/router/pns_utils.cpp) moved to `pns_utils.ts`
 * 2026-09-29 (the router file-structure parity pass), which imports
 * `pointInside`/`pointOnEdge` back from here — the one direction that avoids
 * a cycle, since nothing here needs anything from there.
 *
 * Walkaround works by building a graph out of a path's points and a hull's
 * points together, classifying each as inside the hull, outside it, or exactly
 * on its edge, and then walking from one end of the path to the other. All
 * three classifications and the splicing that makes the two point sets line up
 * come from here, which is why this lands before the walk itself.
 *
 * ## Everything hinges on "exactly on the edge" being its own answer
 *
 * A point that lies on the hull boundary is neither in nor out, and the walk
 * treats it as a third thing — it is where a path enters or leaves an obstacle,
 * and therefore where the route has to switch between following the path and
 * following the hull. Collapsing it into either of the other two answers is
 * what makes a walkaround either cut the corner or refuse to leave.
 *
 * These live in pcbnew rather than kimath because the ones kimath already has
 * do not carry the corner classification `HullIntersection` needs, and that
 * package is additive-only for this work.
 *
 * ## Guards here that decide nothing
 *
 * Five of upstream's checks turn out to be unobservable once the code around
 * them is in place, and mutation testing says so. Named so the gap in the tests
 * is not mistaken for a gap in the cover:
 *
 * - **skipping horizontal edges in `pointInside`** — the crossing test compares
 *   an edge's two endpoints against the same value there, so it can never fire
 *   anyway; the skip is guarding the division, not the answer;
 * - **matching a segment's endpoints in `edgeContainingPoint`** — an endpoint
 *   is at distance zero, which the threshold test accepts a line later;
 * - **the exact branch of `findPoint`** — a tolerance of zero already means
 *   exact equality;
 * - **deduplicating non-corner crossings** — two hull edges can only be met at
 *   one point at a corner, which takes the other branch;
 * - **the two-point minimum in `hullIntersection`** — a one-point line has no
 *   segments to iterate;
 * - **the three-point minimum in `pointInside`** — a degenerate chain is a
 *   doubled segment, which a ray crosses twice or not at all, so it answers
 *   `false` by arithmetic rather than by the guard.
 *
 * Each is kept because it says something true about the intent, and the first
 * is load bearing against a division by zero even though the result is
 * discarded.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** A polyline, or — where noted — a closed polygon whose last edge wraps. */
export type Chain = Vec2[];

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** `SEG::SquaredDistance` from a point to a segment. */
function squaredDistanceToSeg(a: Vec2, b: Vec2, p: Vec2): number {
  const d = sub(b, a);
  const len2 = dot(d, d);
  if (len2 === 0) return dot(sub(p, a), sub(p, a));
  let t = dot(sub(p, a), d) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const q = { x: a.x + d.x * t, y: a.y + d.y * t };
  return dot(sub(p, q), sub(p, q));
}

/**
 * `SHAPE_LINE_CHAIN::PointInside` for a closed chain.
 *
 * A ray cast, with two details worth keeping as upstream has them: horizontal
 * edges are skipped outright rather than special-cased, and the crossing test
 * is strict on one side (`>=` against `<`), which is what stops a ray passing
 * exactly through a vertex from counting it twice.
 *
 * A point *on* the boundary gets no promise here — that is `pointOnEdge`'s
 * question, and the walk asks both.
 */
export function pointInside(chain: readonly Vec2[], p: Vec2): boolean {
  const n = chain.length;
  if (n < 3) return false;

  let inside = false;

  for (let i = 0; i < n; i++) {
    const p1 = chain[i]!;
    const p2 = chain[i + 1 === n ? 0 : i + 1]!;
    const diff = sub(p2, p1);

    if (diff.y === 0) continue;

    const d = (diff.x * (p.y - p1.y)) / diff.y;
    if (p1.y >= p.y !== p2.y >= p.y && p.x - p1.x < d) inside = !inside;
  }

  return inside;
}

/**
 * `EdgeContainingPoint`: which segment `p` lies on, or -1.
 *
 * The threshold is `accuracy + 1`, upstream's — never zero. Exact coincidence
 * is not something to rely on when both the hull and the path have been through
 * rounding, and a point that misses the edge by a nanometre would otherwise be
 * classified as inside or outside and send the walk the wrong way.
 *
 * `closed` decides whether the wrapping edge exists, which is the difference
 * between a hull and a path.
 */
export function edgeContainingPoint(
  chain: readonly Vec2[],
  p: Vec2,
  accuracy = 0,
  closed = true,
): number {
  const n = chain.length;
  if (n === 0) return -1;
  if (n === 1) return squaredDistanceToSeg(chain[0]!, chain[0]!, p) <= (accuracy + 1) ** 2 ? 0 : -1;

  const thresholdSq = (accuracy + 1) ** 2;
  const segCount = closed ? n : n - 1;

  for (let i = 0; i < segCount; i++) {
    const a = chain[i]!;
    const b = chain[i + 1 === n ? 0 : i + 1]!;
    if (same(a, p) || same(b, p)) return i;
    if (squaredDistanceToSeg(a, b, p) <= thresholdSq) return i;
  }

  return -1;
}

/** `PointOnEdge`: is `p` on the boundary at all? */
export const pointOnEdge = (
  chain: readonly Vec2[],
  p: Vec2,
  accuracy = 0,
  closed = true,
): boolean => edgeContainingPoint(chain, p, accuracy, closed) >= 0;

/**
 * `SHAPE_LINE_CHAIN::Find`: the index of a *vertex* at `p`, or -1.
 *
 * A threshold of zero means exact equality — not "very close" — because the
 * caller uses this to ask whether a point it just spliced in is already
 * present, and a near-miss there means a duplicate vertex rather than a match.
 */
export function findPoint(chain: readonly Vec2[], p: Vec2, threshold = 0): number {
  for (let i = 0; i < chain.length; i++) {
    if (threshold === 0) {
      if (same(chain[i]!, p)) return i;
    } else if (Math.hypot(chain[i]!.x - p.x, chain[i]!.y - p.y) <= threshold) {
      return i;
    }
  }
  return -1;
}

/**
 * `SHAPE_LINE_CHAIN::Split`: insert `p` as a vertex on the edge it lies on.
 *
 * Returns the chain with the point inserted and the index it landed at. A point
 * more than a couple of units from every edge is refused rather than appended,
 * since appending would move the chain's end.
 *
 * ## `exact` defaults to false, and that is not a detail
 *
 * With it off — which is how the router calls this — a point that is *already*
 * a vertex does not short-circuit. The search still runs, and it prefers an
 * *earlier* segment that also passes within a couple of units of `p`. That
 * matters only when the chain comes near the same place twice, which is exactly
 * what a self-touching path does; splitting at the later occurrence there would
 * splice the crossing into the wrong lobe of the loop.
 *
 * The threshold of 2 is the search radius, not a minimum separation from
 * existing vertices — a point a unit beyond the end of a segment really is
 * spliced into it, spur and all, as upstream does. The guard against a
 * near-coincident vertex is the exact-inequality test inside the loop.
 */
export function splitAt(
  chain: readonly Vec2[],
  p: Vec2,
  closed = false,
  exact = false,
): { chain: Chain; index: number } {
  const foundIndex = findPoint(chain, p);
  if (foundIndex >= 0 && exact) return { chain: [...chain], index: foundIndex };

  const n = chain.length;
  const segCount = closed ? n : n - 1;
  let ii = -1;
  let minDist = 2;

  for (let s = 0; s < segCount; s++) {
    const a = chain[s]!;
    const b = chain[s + 1 === n ? 0 : s + 1]!;
    if (same(a, p) || same(b, p)) continue;

    const dist = Math.sqrt(squaredDistanceToSeg(a, b, p));

    if (dist < minDist) {
      minDist = dist;
      if (foundIndex < 0 || s < foundIndex) ii = s;
    }
  }

  if (ii < 0) ii = foundIndex;
  if (ii < 0) return { chain: [...chain], index: -1 };

  // Already the vertex we would have inserted after: nothing to do.
  if (same(chain[ii]!, p)) return { chain: [...chain], index: ii };

  const out = [...chain];
  out.splice(ii + 1, 0, p);
  return { chain: out, index: ii + 1 };
}
