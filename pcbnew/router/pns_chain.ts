// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `SHAPE_LINE_CHAIN` operations the router walks hulls with.
 * Counterparts: `PointInside`, `EdgeContainingPoint` / `PointOnEdge`, `Find`
 * and `Split` (libs/kimath/src/geometry/shape_line_chain.cpp), plus
 * `HullIntersection` (pcbnew/router/pns_utils.cpp).
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

/** One crossing of a hull by a path. */
export interface HullIntersect {
  p: Vec2;
  /** Which hull segment was crossed. */
  indexOur: number;
  /** Which path segment did the crossing. */
  indexTheir: number;
  /** The crossing landed exactly on a hull vertex. */
  isCornerOur: boolean;
  /** ...or on a path vertex. */
  isCornerTheir: boolean;
}

/** Where two segments properly cross, or null. Endpoints count as crossings. */
function segIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = r.x * s.y - r.y * s.x;
  if (denom === 0) return null;

  const qp = sub(b1, a1);
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: Math.round(a1.x + r.x * t), y: Math.round(a1.y + r.y * t) };
}

/**
 * Every crossing of a closed `hull` by an open `line`, classified.
 *
 * The corner flags are the point of the exercise. A crossing that lands exactly
 * on a vertex of either shape is ambiguous — the path may be passing through or
 * merely grazing — and `hullIntersection` below uses the flags to tell those
 * apart. Recording the raw hit without them makes a graze look like an entry,
 * and the walk then tries to route around an obstacle it never touched.
 */
export function rawIntersections(hull: readonly Vec2[], line: readonly Vec2[]): HullIntersect[] {
  const out: HullIntersect[] = [];
  const hn = hull.length;

  for (let j = 0; j + 1 < line.length; j++) {
    const l1 = line[j]!;
    const l2 = line[j + 1]!;

    for (let i = 0; i < hn; i++) {
      const h1 = hull[i]!;
      const h2 = hull[i + 1 === hn ? 0 : i + 1]!;
      const p = segIntersection(h1, h2, l1, l2);
      if (!p) continue;

      out.push({
        p,
        indexOur: i,
        indexTheir: j,
        isCornerOur: same(p, h1) || same(p, h2),
        isCornerTheir: same(p, l1) || same(p, l2),
      });
    }
  }

  return out;
}

/**
 * `HullIntersection`: the crossings that actually take the path through the
 * hull's boundary.
 *
 * A crossing away from any corner always counts. One *at* a corner only counts
 * when the path really passes from one side to the other there, which is
 * decided by looking at the two edges meeting at that corner: if the path's
 * direction lies strictly between them, it went through; if it lies outside,
 * it touched and carried on.
 *
 * Without this, a path routed exactly along the outside of a hull registers an
 * entry at every corner it grazes, and the walk sends it round an obstacle it
 * was already clear of.
 */
export function hullIntersection(hull: readonly Vec2[], line: readonly Vec2[]): HullIntersect[] {
  if (line.length < 2) return [];

  const out: HullIntersect[] = [];
  const seen = new Set<string>();

  for (const hit of rawIntersections(hull, line)) {
    const key = `${hit.p.x},${hit.p.y}`;

    if (!hit.isCornerOur && !hit.isCornerTheir) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(hit);
      }
      continue;
    }

    // At a corner, ask whether the path crosses the boundary or grazes it. A
    // path that *ends* at the hit has no far side and so has crossed nothing —
    // which is exactly what reaching a pad and stopping looks like.
    const { before, after } = samplesAround(line, hit);
    if (before === null || after === null) continue;

    // The same three-way answer as everywhere else here, and for the same
    // reason: a sample sitting *on* the boundary is neither in nor out, and
    // ray casting there answers whichever way the rounding fell. A real
    // crossing needs one sample genuinely inside and the other genuinely
    // outside — anything less is a path running along the edge.
    const sideOf = (q: Vec2): number => (pointOnEdge(hull, q) ? 0 : pointInside(hull, q) ? 1 : -1);

    const sBefore = sideOf(before);
    const sAfter = sideOf(after);

    if (sBefore !== 0 && sAfter !== 0 && sBefore !== sAfter && !seen.has(key)) {
      seen.add(key);
      out.push(hit);
    }
  }

  return out;
}

/**
 * Sample the path just before and just after a crossing.
 *
 * Both are found by stepping to the nearest *distinct* path point on each side
 * and taking the midpoint. Stepping to the segment's own endpoints is not
 * enough: when the crossing lands exactly on a path vertex, one of those
 * endpoints **is** the crossing, and the midpoint toward it is the crossing
 * again — which reads as being on the boundary and makes a path that merely
 * *reaches* the hull look like one that passes through it.
 *
 * `null` on either side means the path ends there, and a path that ends on the
 * boundary has not crossed it.
 *
 * Skipping points identical to the crossing is what makes this work, and it is
 * *also* unobservable on its own: without it the midpoint comes out as the
 * crossing itself, which the on-edge test then classifies as neither side —
 * the same answer by a different route. Both are kept, because relying on one
 * to cover for the other is how the bug this function exists to fix got in.
 */
function samplesAround(
  line: readonly Vec2[],
  hit: HullIntersect,
): { before: Vec2 | null; after: Vec2 | null } {
  const p = hit.p;

  let before: Vec2 | null = null;
  for (let i = hit.indexTheir; i >= 0; i--) {
    if (!same(line[i]!, p)) {
      before = midpointToward(p, line[i]!);
      break;
    }
  }

  let after: Vec2 | null = null;
  for (let i = hit.indexTheir + 1; i < line.length; i++) {
    if (!same(line[i]!, p)) {
      after = midpointToward(p, line[i]!);
      break;
    }
  }

  return { before, after };
}

/**
 * Halfway from `p` towards `q`.
 *
 * Halfway rather than a fixed small step on purpose: a fixed step has to be
 * small enough not to overshoot a short segment and large enough to escape the
 * rounding around the crossing, and no single value is both on a board whose
 * features span six orders of magnitude.
 */
function midpointToward(p: Vec2, q: Vec2): Vec2 {
  return { x: Math.round((p.x + q.x) / 2), y: Math.round((p.y + q.y) / 2) };
}
