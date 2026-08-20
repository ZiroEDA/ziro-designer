// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Exact DRC shape geometry. Counterparts: the SHAPE classes KiCad's DRC
 * collides (`libs/kimath/src/geometry/shape_*.cpp`):
 *
 *  - circle  = SHAPE_CIRCLE
 *  - stadium = SHAPE_SEGMENT (segment + half-width)
 *  - arc     = SHAPE_ARC (center/radius/angle-range + half-width), exact
 *              closest-approach: candidates are the radial projection when it
 *              falls inside the angular range, the endpoints both ways, and
 *              circle intersections (distance 0) inside the range.
 *  - poly    = SHAPE_SIMPLE / SHAPE_POLY_SET outline (any simple polygon,
 *              ray-cast containment) with an outward inflation `r`, which
 *              represents rounded-rect pads exactly (deflated rect + corner
 *              radius) and stroked poly primitives (width/2).
 *
 * All distances return the free gap between copper boundaries (0 when the
 * shapes touch or overlap).
 *
 * ## Coordinates are integers, because `VECTOR2I` is
 *
 * Every segment measurement here comes from `@ziroeda/kimath`'s `SEG`, the
 * exact-integer port of `libs/kimath/src/geometry/seg.cpp`, and not from a copy
 * in doubles. There is no third implementation: `SEG::SquaredDistance` and
 * `SEG::Distance` are the same routines `SHAPE::Collide` measures with, so
 * `shapeDist` and `pcbnew/src/drc/shape_collisions.ts` now agree by
 * construction rather than by coincidence.
 *
 * Three consequences, all of them upstream's:
 *
 *  1. **Coordinates quantise to 1 IU.** `Shape` carries doubles because
 *     `arcShape` computes a centre and `padShapes` rotates vertices; kimath
 *     `KiROUND`s them on the way into a `SEG`, which reproduces the rounding
 *     KiCad already did when it built the `SHAPE_POLY_SET` of `VECTOR2I`s.
 *  2. **The gap is a whole number of IU.** `SHAPE::Collide` writes its `aActual`
 *     through an `int*` after `(int) sqrt( dist_sq )` — see
 *     {@link truncSqrt} — so a fractional gap is a divergence and not extra
 *     precision. `mm( gap )` in a DRC message therefore prints what KiCad's
 *     prints.
 *  3. **An exact touch is exactly zero.** The old `Math.hypot` of a projected
 *     point came back at ~1e-9 for a point genuinely on a segment, so
 *     `shapeDist(…) === 0` — the *shorting* test, and the touch test in a dozen
 *     other places — silently answered false.
 *
 * ## The one thing still measured in doubles
 *
 * {@link pointArc}, {@link segArc} and {@link arcArc} measure a **curve**, and
 * kimath has no integer counterpart: `SHAPE_ARC::Collide` is not a distance
 * function but a verdict over a candidate list that keeps the *last* colliding
 * candidate rather than the nearest (`shape_arc.cpp`, transcribed in
 * `shape_collisions.ts`'s `arcCollideSeg`), so it cannot answer "how far apart
 * are these two". Upstream's own arc distance is a double as well — it is
 * `KiROUND( nearestPt.Distance( aP ) )`, a `hypot` rounded on the way into an
 * `int` — so the double is where upstream keeps one too. It is truncated at the
 * same place every other pair is, by {@link gapFromDistance}.
 *
 * The other double upstream keeps is `drc_creepage_utils.h:67`'s `VECTOR2D`
 * `CREEP_SHAPE` world, mirrored in `drc/creepage_shapes.ts`; it is not reached
 * from here.
 */

import {
  segDistance,
  segDistanceToPoint,
  segSquaredDistanceToPoint,
  segSquaredDistanceToSeg,
} from '@ziroeda/kimath/src/geometry/seg.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export type Shape =
  | { kind: 'circle'; c: Vec2; r: number }
  | { kind: 'stadium'; a: Vec2; b: Vec2; r: number }
  | { kind: 'arc'; c: Vec2; rad: number; a0: number; sweep: number; r: number }
  | { kind: 'poly'; pts: Vec2[]; r: number };

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * `(int) sqrt( dist_sq )` — the cast `SHAPE::Collide` applies to the skeleton
 * distance **before** either shape's radius comes off it
 * (`shape_collisions.cpp:55`, `shape_circle.h:100`, `shape_segment.h:97/117`).
 * `Math.trunc( Math.sqrt( … ) )` is bit-exact with it and is deliberately not
 * `isqrt`; the same helper and the same reasoning live in
 * `shape_collisions.ts`.
 */
const truncSqrt = (aSquaredDist: number): number => Math.trunc(Math.sqrt(aSquaredDist));

/**
 * `std::max( 0, (int) sqrt( dist_sq ) - rA - rB )`, the whole of
 * `SHAPE::Collide`'s `aActual` in one place.
 *
 * The order is upstream's and is not interchangeable: truncating the whole
 * `sqrt - r` expression instead moves the answer by an IU whenever a radius is
 * half-integral, which is every odd-width track — Ziro's `stadium.r` is
 * `width / 2` untruncated.
 */
const gap = (aSquaredDist: number, aR1: number, aR2: number): number =>
  Math.max(0, truncSqrt(aSquaredDist) - aR1 - aR2);

/** {@link gap} for the arc pairs, whose curve distance is already a length. */
const gapFromDistance = (aDist: number, aR1: number, aR2: number): number =>
  Math.max(0, Math.trunc(aDist) - aR1 - aR2);

/**
 * `SEG::SquaredDistance( const VECTOR2I& )` between two bare points: a
 * zero-length `SEG` takes the `e <= 0` arm, which is `|ap|²` in exact integer
 * arithmetic — `VECTOR2I::SquaredEuclideanNorm( aB - aA )`, the `ecoord` the
 * circle pair of `shape_collisions.cpp:55` measures with.
 */
const pointPointSq = (a: Vec2, b: Vec2): number => segSquaredDistanceToPoint({ a, b: a }, b);

/** `SEG::SquaredDistance( const VECTOR2I& )` (`seg.cpp:714`). */
const pointSegSq = (p: Vec2, a: Vec2, b: Vec2): number => segSquaredDistanceToPoint({ a, b }, p);

/** `SEG::SquaredDistance( const SEG& )` (`seg.cpp:80`). */
const segSegSq = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number =>
  segSquaredDistanceToSeg({ a: a1, b: a2 }, { a: b1, b: b2 });

/**
 * `SEG::Distance( const VECTOR2I& )` (`seg.cpp:708`): `isqrt` of the exact
 * squared distance, so it **floors**.
 *
 * Not `truncSqrt`: this is the `SEG` member, which upstream spells `isqrt`,
 * where `SHAPE::Collide`'s `aActual` spells `(int) sqrt`. The two disagree only
 * on a squared distance whose true root rounds up to an integer in double,
 * and keeping them apart is what makes each one traceable to its own line of
 * C++.
 */
export const pointSeg = (p: Vec2, a: Vec2, b: Vec2): number => segDistanceToPoint({ a, b }, p);

/**
 * `SEG::Distance( const SEG& )` (`seg.cpp:702`).
 *
 * Crossing segments answer 0 through `SEG::Intersects`, which is upstream's own
 * exact-integer predicate — where the four hand-rolled cross products this
 * replaced tested only for a *proper* crossing, and so reported a positive
 * distance for two segments that merely touched at a vertex or overlapped
 * collinearly.
 */
export const segSeg = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number =>
  segDistance({ a: a1, b: a2 }, { a: b1, b: b2 });

/** Even-odd point-in-polygon (any simple polygon). */
export function pointInPoly(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

const TAU = 2 * Math.PI;
const norm = (a: number): number => ((a % TAU) + TAU) % TAU;

/** Is angle `a` within the arc's swept range? (sweep may be negative.) */
function angleInArc(a: number, a0: number, sweep: number): boolean {
  if (sweep >= 0) return norm(a - a0) <= sweep + 1e-12;
  return norm(a0 - a) <= -sweep + 1e-12;
}

export interface ArcGeom {
  c: Vec2;
  rad: number;
  a0: number;
  sweep: number;
}

export function arcPoint(g: ArcGeom, a: number): Vec2 {
  return { x: g.c.x + g.rad * Math.cos(a), y: g.c.y + g.rad * Math.sin(a) };
}
export const arcStart = (g: ArcGeom): Vec2 => arcPoint(g, g.a0);
export const arcEnd = (g: ArcGeom): Vec2 => arcPoint(g, g.a0 + g.sweep);

/** Exact distance from a point to the arc curve. */
export function pointArc(p: Vec2, g: ArcGeom): number {
  const a = Math.atan2(p.y - g.c.y, p.x - g.c.x);
  const candidates = [dist(p, arcStart(g)), dist(p, arcEnd(g))];
  if (angleInArc(a, g.a0, g.sweep)) candidates.push(Math.abs(dist(p, g.c) - g.rad));
  return Math.min(...candidates);
}

/** Exact distance from a segment to the arc curve (0 when crossing). */
export function segArc(a: Vec2, b: Vec2, g: ArcGeom): number {
  // Circle-line intersections inside the angular range mean contact.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - g.c.x;
  const fy = a.y - g.c.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - g.rad * g.rad;
  if (A > 0) {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
        if (t >= 0 && t <= 1) {
          const p = { x: a.x + t * dx, y: a.y + t * dy };
          if (angleInArc(Math.atan2(p.y - g.c.y, p.x - g.c.x), g.a0, g.sweep)) return 0;
        }
      }
    }
  }
  const candidates = [
    pointArc(a, g),
    pointArc(b, g),
    pointSeg(arcStart(g), a, b),
    pointSeg(arcEnd(g), a, b),
  ];
  // Radial projection of the segment's closest point to the center.
  const len2 = A;
  if (len2 > 0) {
    const t = Math.max(0, Math.min(1, -(fx * dx + fy * dy) / len2));
    const p = { x: a.x + t * dx, y: a.y + t * dy };
    if (angleInArc(Math.atan2(p.y - g.c.y, p.x - g.c.x), g.a0, g.sweep))
      candidates.push(Math.abs(dist(p, g.c) - g.rad));
  }
  return Math.min(...candidates);
}

/** Exact distance between two arc curves (0 when crossing). */
export function arcArc(g1: ArcGeom, g2: ArcGeom): number {
  const d = dist(g1.c, g2.c);
  // Circle-circle intersections inside both ranges mean contact.
  if (d > 1e-9 && d <= g1.rad + g2.rad && d >= Math.abs(g1.rad - g2.rad)) {
    const a = (g1.rad * g1.rad - g2.rad * g2.rad + d * d) / (2 * d);
    const h2 = g1.rad * g1.rad - a * a;
    const h = Math.sqrt(Math.max(0, h2));
    const mx = g1.c.x + ((g2.c.x - g1.c.x) * a) / d;
    const my = g1.c.y + ((g2.c.y - g1.c.y) * a) / d;
    for (const sgn of [1, -1]) {
      const p = {
        x: mx + (sgn * h * (g2.c.y - g1.c.y)) / d,
        y: my - (sgn * h * (g2.c.x - g1.c.x)) / d,
      };
      if (
        angleInArc(Math.atan2(p.y - g1.c.y, p.x - g1.c.x), g1.a0, g1.sweep) &&
        angleInArc(Math.atan2(p.y - g2.c.y, p.x - g2.c.x), g2.a0, g2.sweep)
      )
        return 0;
    }
  }
  const candidates = [
    pointArc(arcStart(g1), g2),
    pointArc(arcEnd(g1), g2),
    pointArc(arcStart(g2), g1),
    pointArc(arcEnd(g2), g1),
  ];
  // Closest/farthest radial configuration along the center line.
  if (d > 1e-9) {
    const ang12 = Math.atan2(g2.c.y - g1.c.y, g2.c.x - g1.c.x);
    for (const [a1c, a2c] of [
      [ang12, ang12 + Math.PI], // facing points (external gap)
      [ang12, ang12], // g2 behind its center (internal)
      [ang12 + Math.PI, ang12 + Math.PI],
    ] as const) {
      if (angleInArc(a1c, g1.a0, g1.sweep) && angleInArc(a2c, g2.a0, g2.sweep))
        candidates.push(dist(arcPoint(g1, a1c), arcPoint(g2, a2c)));
    }
  }
  return Math.min(...candidates);
}

function polyEdges(pts: Vec2[]): [Vec2, Vec2][] {
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]!] as [Vec2, Vec2]);
}

/**
 * A running minimum over squared distances, with a bounding-box rejection in
 * front of it.
 *
 * The exact-integer `SEG` routines are `BigInt` arithmetic and cost roughly
 * four times what the doubles they replaced did — which does not matter for one
 * pair and matters a great deal in these loops, where a copper item is measured
 * against every edge of a board outline or a zone fill. Two segments whose
 * bounding boxes are separated by more than the current best distance along
 * *either* axis cannot beat it, and that test is four comparisons of doubles.
 *
 * The rejection is a pure optimisation: `limit` is the square root of the best
 * squared distance so far plus a margin of 2 IU, which is many orders of
 * magnitude more than the rounding in either `Math.sqrt` or the `BigInt` to
 * `Number` conversion that produced it, so nothing within reach is ever
 * rejected. `Infinity` before the first candidate rejects nothing at all.
 */
class NearestSq {
  best = Number.POSITIVE_INFINITY;
  private limit = Number.POSITIVE_INFINITY;

  /** Can no point in this box beat the running best? */
  outOfReach(aMinX: number, aMinY: number, aMaxX: number, aMaxY: number): boolean {
    return (
      this.boxMinX - aMaxX > this.limit ||
      aMinX - this.boxMaxX > this.limit ||
      this.boxMinY - aMaxY > this.limit ||
      aMinY - this.boxMaxY > this.limit
    );
  }

  constructor(
    private readonly boxMinX: number,
    private readonly boxMinY: number,
    private readonly boxMaxX: number,
    private readonly boxMaxY: number,
  ) {}

  offer(aSquaredDist: number): void {
    if (aSquaredDist < this.best) {
      this.best = aSquaredDist;
      this.limit = Math.sqrt(aSquaredDist) + 2;
    }
  }
}

/** {@link NearestSq} keyed on a single point. */
const nearestToPoint = (p: Vec2): NearestSq => new NearestSq(p.x, p.y, p.x, p.y);

/** {@link NearestSq} keyed on a segment. */
const nearestToSeg = (a: Vec2, b: Vec2): NearestSq =>
  new NearestSq(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));

/** Is this edge out of the running best's reach? */
const edgeOutOfReach = (aNear: NearestSq, a: Vec2, b: Vec2): boolean =>
  aNear.outOfReach(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));

/**
 * Free gap between two shapes (0 when touching/overlapping), as
 * `SHAPE::Collide` would have reported it in `aActual`.
 *
 * Every pair below minimises a **squared** distance and truncates once at the
 * end, which is where upstream's `(int)` sits. Minimising the truncated
 * distances instead and subtracting afterwards would be the same answer only by
 * luck: `std::min` over `(int) sqrt( … )` loses the ordering between two
 * candidates less than an IU apart, and the radii would come off the wrong side
 * of the cast.
 */
export function shapeDist(s1: Shape, s2: Shape): number {
  // Normalize order: circle < stadium < arc < poly.
  const order = { circle: 0, stadium: 1, arc: 2, poly: 3 } as const;
  if (order[s1.kind] > order[s2.kind]) return shapeDist(s2, s1);

  if (s1.kind === 'circle' && s2.kind === 'circle')
    return gap(pointPointSq(s1.c, s2.c), s1.r, s2.r);
  if (s1.kind === 'circle' && s2.kind === 'stadium')
    return gap(pointSegSq(s1.c, s2.a, s2.b), s1.r, s2.r);
  if (s1.kind === 'circle' && s2.kind === 'arc')
    return gapFromDistance(pointArc(s1.c, s2), s1.r, s2.r);
  if (s1.kind === 'circle' && s2.kind === 'poly') {
    if (pointInPoly(s1.c, s2.pts)) return 0;
    const near = nearestToPoint(s1.c);
    for (const [a, b] of polyEdges(s2.pts)) {
      if (edgeOutOfReach(near, a, b)) continue;
      near.offer(pointSegSq(s1.c, a, b));
    }
    return gap(near.best, s1.r, s2.r);
  }
  if (s1.kind === 'stadium' && s2.kind === 'stadium')
    return gap(segSegSq(s1.a, s1.b, s2.a, s2.b), s1.r, s2.r);
  if (s1.kind === 'stadium' && s2.kind === 'arc')
    return gapFromDistance(segArc(s1.a, s1.b, s2), s1.r, s2.r);
  if (s1.kind === 'stadium' && s2.kind === 'poly') {
    if (pointInPoly(s1.a, s2.pts) || pointInPoly(s1.b, s2.pts)) return 0;
    const near = nearestToSeg(s1.a, s1.b);
    for (const [a, b] of polyEdges(s2.pts)) {
      if (edgeOutOfReach(near, a, b)) continue;
      near.offer(segSegSq(s1.a, s1.b, a, b));
    }
    return gap(near.best, s1.r, s2.r);
  }
  if (s1.kind === 'arc' && s2.kind === 'arc') return gapFromDistance(arcArc(s1, s2), s1.r, s2.r);
  if (s1.kind === 'arc' && s2.kind === 'poly') {
    if (pointInPoly(arcStart(s1), s2.pts) || pointInPoly(arcEnd(s1), s2.pts)) return 0;
    let best = Infinity;
    for (const [a, b] of polyEdges(s2.pts)) best = Math.min(best, segArc(a, b, s1));
    return gapFromDistance(best, s1.r, s2.r);
  }
  // poly-poly
  if (s1.kind === 'poly' && s2.kind === 'poly') {
    if (s1.pts.some((p) => pointInPoly(p, s2.pts))) return 0;
    if (s2.pts.some((p) => pointInPoly(p, s1.pts))) return 0;
    const bEdges = polyEdges(s2.pts);
    let best = Number.POSITIVE_INFINITY;
    for (const [a1, a2] of polyEdges(s1.pts)) {
      const near = nearestToSeg(a1, a2);
      near.offer(best);
      for (const [b1, b2] of bEdges) {
        if (edgeOutOfReach(near, b1, b2)) continue;
        near.offer(segSegSq(a1, a2, b1, b2));
      }
      best = Math.min(best, near.best);
    }
    return gap(best, s1.r, s2.r);
  }
  return 0; // unreachable
}

export function shapeBBox(s: Shape): { minX: number; minY: number; maxX: number; maxY: number } {
  if (s.kind === 'circle')
    return { minX: s.c.x - s.r, minY: s.c.y - s.r, maxX: s.c.x + s.r, maxY: s.c.y + s.r };
  if (s.kind === 'stadium')
    return {
      minX: Math.min(s.a.x, s.b.x) - s.r,
      minY: Math.min(s.a.y, s.b.y) - s.r,
      maxX: Math.max(s.a.x, s.b.x) + s.r,
      maxY: Math.max(s.a.y, s.b.y) + s.r,
    };
  if (s.kind === 'arc') {
    // Conservative: the full circle's box (exact per-quadrant not needed for
    // a broad-phase box).
    const R = s.rad + s.r;
    return { minX: s.c.x - R, minY: s.c.y - R, maxX: s.c.x + R, maxY: s.c.y + R };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of s.pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - s.r, minY: minY - s.r, maxX: maxX + s.r, maxY: maxY + s.r };
}

/** `SHAPE::Move`: the same shape, translated. */
export function moveShape(s: Shape, delta: Vec2): Shape {
  const mv = (p: Vec2): Vec2 => ({ x: p.x + delta.x, y: p.y + delta.y });

  if (s.kind === 'circle') return { ...s, c: mv(s.c) };
  if (s.kind === 'stadium') return { ...s, a: mv(s.a), b: mv(s.b) };
  if (s.kind === 'arc') return { ...s, c: mv(s.c) };
  return { ...s, pts: s.pts.map(mv) };
}
