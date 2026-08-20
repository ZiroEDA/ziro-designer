// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The per-shape-pair collision table.
 * Counterpart: `libs/kimath/src/geometry/shape_collisions.cpp`, plus the
 * `Collide`/`NearestPoint`/`Intersect` members it reaches for in `seg.cpp`,
 * `circle.cpp`, `shape_arc.cpp`, `shape_line_chain.cpp`, `shape_circle.h` and
 * `shape_segment.h`.
 *
 * ## Why this exists: `aLocation`
 *
 * `SHAPE::Collide` answers three questions at once — *do they collide*, *by how
 * much*, and *where*. The repo already had the first two: `shapeDist` is an
 * exact clamped gap for every pair of shapes Ziro models, and
 * `defaultShapeCollider` in `pns_collision.ts` turns it into upstream's verdict.
 * What it could not answer is *where*, and `ITEM::collideSimple` needs that to
 * decide castellation and net-tie exclusions.
 *
 * **`aLocation` is not the point of closest approach, and it is not the same
 * kind of point from one pair to the next.** Circle against circle returns the
 * midpoint of the two *centres*, which can lie outside both discs. Segment
 * against segment returns a point on the *first* argument's segment, so
 * swapping the arguments moves the answer. A chain that contains the other
 * shape's first point returns that point rather than anything on the chain.
 * Every case below states which of these it is; a "sensible" or "consistent"
 * location would be a wrong location, silently.
 *
 * ## Ziro's shapes against KiCad's classes
 *
 * | Ziro `Shape`  | KiCad                                            |
 * |---------------|--------------------------------------------------|
 * | `circle`      | `SHAPE_CIRCLE( c, r )`                           |
 * | `stadium`     | `SHAPE_SEGMENT( a, b, width = 2r )`              |
 * | `arc`         | `SHAPE_ARC` with `width = 2r`                    |
 * | `poly, r = 0` | `SHAPE_SIMPLE`, a closed `SHAPE_LINE_CHAIN_BASE` |
 * | `poly, r > 0` | nothing — see {@link collideShapes}              |
 *
 * `SHAPE_RECT`, `SHAPE_ELLIPSE`, `SHAPE_COMPOUND` and `SHAPE_POLY_SET` have no
 * counterpart in Ziro's union, so their rows of upstream's dispatch table are
 * not ported. Rectangles reach this code as `poly`s.
 *
 * ## Coordinates
 *
 * KiCad works in `int` nanometres and truncates or `KiROUND`s every
 * intermediate. Ziro's `Shape` carries floating-point coordinates — `arcShape`
 * yields a float centre, radius and radians, `padShapes` yields float vertices —
 * so there is no integer grid to round onto, and the representational rounding
 * is dropped. Rounding that *drives a branch* is kept, because dropping it would
 * change control flow: `KiROUND` on the distance in {@link arcCollidePoint}
 * decides whether its `if( !dist )` recomputation runs, the same routine's
 * snap-to-endpoint path measures with `VECTOR2<int>::EuclideanNorm`, and the two
 * arc pairs round `sqrt( dist_sq )` before clamping it. `SEG::Contains`'s `<= 3`
 * and `MIN_PRECISION_IU`'s `4` are absolute tolerances in IU and are kept
 * verbatim.
 *
 * ## `aMTV` and the unrequested out-parameters
 *
 * Upstream threads a fourth out-parameter, the minimum translation vector, and
 * asserts it away in every pair but the two circle ones. The `ShapeCollider`
 * interface has no MTV, so it is dropped entirely rather than computed and
 * discarded.
 *
 * `aActual` and `aLocation`, on the other hand, are *always* wanted here, which
 * makes upstream's `if( !aActual ) break` fast paths unreachable. They are
 * marked at each site rather than deleted, because their absence is the kind of
 * thing a reader would otherwise have to re-derive from the C++.
 */

import type { Seg } from '@ziroeda/kimath/src/geometry/corner_operations.js';
import {
  segCollide,
  segContains,
  segLineProject,
  segNearestPoint,
  segNearestPointToSeg,
  segSquaredDistanceToPoint,
  segSquaredDistanceToSeg,
} from '@ziroeda/kimath/src/geometry/seg.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { Shape } from './drc_geometry.js';

// ----- the result --------------------------------------------------------------

/** One `SHAPE::Collide( other, aClearance, &aActual, &aLocation )` answer. */
export interface ShapeCollisionResult {
  collides: boolean;
  /** `aActual`: the measured gap, clamped at 0 where upstream clamps it. */
  actual: number;
  /** `aLocation`: null exactly when `collides` is false. */
  location: Vec2 | null;
}

/**
 * The two out-parameters, as one mutable record.
 *
 * Upstream passes `int*` and `VECTOR2I*` and writes through them only on the
 * paths that return true — so a routine that tries several candidates leaves
 * the *last successful* one behind, not the best one. {@link arcCollideSeg}
 * depends on exactly that, so the out-parameters are modelled as a record that
 * is mutated rather than as a return value that is composed.
 */
interface Out {
  actual: number;
  location: Vec2;
}

const newOut = (): Out => ({ actual: 0, location: { x: 0, y: 0 } });

// ----- vector helpers ----------------------------------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const norm2 = (v: Vec2): number => v.x * v.x + v.y * v.y;
const distSq = (a: Vec2, b: Vec2): number => norm2(sub(a, b));
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const sq = (v: number): number => v * v;

/**
 * `VECTOR2::Resize`: the same direction, the given length.
 *
 * The integer instantiation computes each component as
 * `sqrt( rescale( len², x², l² ) )` carrying the sign of the component, which is
 * algebraically `len·x / l`; the difference is the integer rounding, which this
 * port drops. A zero vector stays zero, as upstream.
 */
const resize = (v: Vec2, aNewLength: number): Vec2 => {
  if (v.x === 0 && v.y === 0) return { x: 0, y: 0 };

  const l = Math.hypot(v.x, v.y);
  return { x: (v.x * aNewLength) / l, y: (v.y * aNewLength) / l };
};

// ----- SEG ---------------------------------------------------------------------
//
// There is no `SEG` here. Upstream's `shape_collisions.cpp` builds its segments
// out of the same `SEG` the PNS router uses — `SEG trackSeg( track->GetStart(),
// track->GetEnd() )` in `pcbnew/drc/drc_test_provider_copper_clearance.cpp:269`
// is literally the class `libs/kimath/src/geometry/seg.cpp` defines — so this
// module uses ours, `@ziroeda/kimath/src/geometry/seg.ts`, rather than a second
// copy in doubles.
//
// That single change is not cosmetic and is the whole risk of this file: kimath
// is exact-integer, as `VECTOR2I` is, where the copies deleted from here were
// floating point. Three consequences, all of them upstream's behaviour:
//
//  1. **Coordinates are quantised to 1 IU.** `VECTOR2I` cannot hold a fraction,
//     and neither can any shape KiCad collides — `SHAPE_ARC::GetCenter()`
//     returns a `const VECTOR2I&` (`shape_arc.h:121`), pad outlines are
//     `SHAPE_POLY_SET`s of `VECTOR2I`. Ziro's `Shape` carries doubles because
//     `arcShape` computes a centre and `padShapes` rotates vertices, so passing
//     one to a `SEG` rounds it — which reproduces the rounding KiCad already did
//     when it built the SHAPE, rather than inventing one.
//  2. **`actual` floors instead of rounding.** `SEG::Distance` is `isqrt`, the
//     largest integer whose square does not exceed the argument, not
//     `round( hypot(…) )`.
//  3. **An exact touch is now exactly zero.** `SEG::Collide` short-circuits on
//     `SquaredDistance == 0`; in doubles, a point genuinely on the segment came
//     back as ~1e-9 instead and took the clearance branch, reporting a non-zero
//     `actual` for a touching pair.
//
// The one thing that is *not* an integer here is the clearance and the
// half-widths the callers below add to it — `aClearance + halfWidth` is
// upstream's own `int` arithmetic, but Ziro's `stadium.r` is `width / 2` and so
// half-integral on an odd width. That is a `Shape`-construction divergence, not
// a `SEG` one, and is left alone.

/**
 * `SEG::Collide( const SEG&, int, int* )`, adapted to the {@link Out} record.
 *
 * kimath returns `actual` as a field because upstream writes through `aActual`
 * on every path including the false one (`seg.cpp:620`); this wrapper copies it
 * across unconditionally for the same reason.
 */
function segCollideOut(aA: Seg, aB: Seg, aClearance: number, aOut: Out): boolean {
  const { collides, actual } = segCollide(aA, aB, aClearance);

  aOut.actual = actual;

  return collides;
}

// ----- CIRCLE ------------------------------------------------------------------

/** `CIRCLE`: what `SHAPE_CIRCLE` wraps, and what the arc code borrows. */
export interface CollideCircle {
  c: Vec2;
  r: number;
}

/** `SHAPE::MIN_PRECISION_IU`. */
const MIN_PRECISION_IU = 4;

/**
 * `CIRCLE::NearestPoint`. A point at the centre has no nearest point, and
 * upstream picks `+x` arbitrarily rather than returning the centre.
 */
export function circleNearestPoint(aCircle: CollideCircle, aP: Vec2): Vec2 {
  const vec = sub(aP, aCircle.c);

  if (vec.x === 0 && vec.y === 0) return add({ x: aCircle.r, y: 0 }, aCircle.c);

  return add(resize(vec, aCircle.r), aCircle.c);
}

/** `CIRCLE::FurthestPoint`, the same with the vector reversed. */
export function circleFurthestPoint(aCircle: CollideCircle, aP: Vec2): Vec2 {
  const vec = sub(aCircle.c, aP);

  if (vec.x === 0 && vec.y === 0) return add({ x: aCircle.r, y: 0 }, aCircle.c);

  return add(resize(vec, aCircle.r), aCircle.c);
}

/** `CIRCLE::IntersectLine`: 0, 1 (tangent) or 2 points on the *infinite* line. */
function circleIntersectLine(aCircle: CollideCircle, aLine: Seg): Vec2[] {
  const m = segLineProject(aLine, aCircle.c);
  const omDist = Math.hypot(m.x - aCircle.c.x, m.y - aCircle.c.y);

  if (omDist > aCircle.r + MIN_PRECISION_IU) return [];

  if (omDist >= aCircle.r - MIN_PRECISION_IU) return [m]; // tangent

  const mTo1dist = Math.sqrt(aCircle.r * aCircle.r - omDist * omDist);
  const mTo1vec = resize(sub(aLine.b, aLine.a), mTo1dist);

  return [add(mTo1vec, m), add({ x: -mTo1vec.x, y: -mTo1vec.y }, m)];
}

/** `CIRCLE::Intersect( const SEG& )`: the line intersections that are on the segment. */
export function circleIntersectSeg(aCircle: CollideCircle, aSeg: Seg): Vec2[] {
  return circleIntersectLine(aCircle, aSeg).filter((p) => segContains(aSeg, p));
}

/**
 * `CIRCLE::Intersect( const CIRCLE& )`.
 *
 * Co-centred circles return nothing even when their radii match, because there
 * is no isolated intersection to report.
 */
export function circleIntersectCircle(aA: CollideCircle, aB: CollideCircle): Vec2[] {
  const vecCtoC = sub(aB.c, aA.c);
  const d = Math.hypot(vecCtoC.x, vecCtoC.y);
  const r1 = aA.r;
  const r2 = aB.r;

  if (d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  if (d === 0) return [];

  const x = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const r1sqMinusXsq = r1 * r1 - x * x;

  if (r1sqMinusXsq < 0) return [];

  const y = Math.sqrt(r1sqMinusXsq);

  // `RotatePoint( solution, -rotAngle )` where `rotAngle = EDA_ANGLE( vecCtoC )`.
  // EDA_ANGLE measures from a vector with the y axis negated, and rotating by
  // its negation is exactly aligning the +x axis with `vecCtoC` — which in
  // plain screen coordinates is this 2x2 rotation by `atan2( dy, dx )`.
  const cosA = vecCtoC.x / d;
  const sinA = vecCtoC.y / d;
  const place = (px: number, py: number): Vec2 => ({
    x: aA.c.x + px * cosA - py * sinA,
    y: aA.c.y + px * sinA + py * cosA,
  });

  const retval = [place(x, y)];

  if (y !== 0) retval.push(place(x, -y));

  return retval;
}

// ----- SHAPE_CIRCLE ------------------------------------------------------------

/**
 * `SHAPE_CIRCLE::Collide( const SEG& )` — a **location** source.
 *
 * The location is a point on **the segment**, except when the segment passes
 * exactly through the centre (`dist_sq == 0`) *and* the circle actually cuts it,
 * in which case it is the first of the two circle/segment intersections. Note
 * that upstream computes that intersection list twice, once to test it and once
 * to read `[0]`; the second call is what the value comes from.
 */
export function shapeCircleCollideSeg(
  aCircle: CollideCircle,
  aSeg: Seg,
  aClearance: number,
  aOut: Out,
): boolean {
  const minDist = aClearance + aCircle.r;
  const pn = segNearestPoint(aSeg, aCircle.c);
  const dSq = distSq(pn, aCircle.c);

  if (dSq === 0 || dSq < sq(minDist)) {
    const pts = circleIntersectSeg(aCircle, aSeg);

    aOut.location = pts.length > 0 && dSq === 0 ? (pts[0] as Vec2) : pn;
    aOut.actual = Math.max(0, Math.sqrt(dSq) - aCircle.r);

    return true;
  }

  return false;
}

// ----- SHAPE_SEGMENT -----------------------------------------------------------

/**
 * `SHAPE_SEGMENT`. Ziro's `stadium` stores the half-width directly, so
 * upstream's two spellings of it — `( m_width + 1 ) / 2` in
 * `SHAPE_SEGMENT::Collide` and `GetWidth() / 2` in the pair functions, which
 * differ by one for an odd width — collapse to the same number here. Ziro's
 * `PNS::SEGMENT` builds `r` as `width / 2` without truncating, so an odd-width
 * track sits half a unit inside upstream's `( w + 1 ) / 2` and half a unit
 * outside its `w / 2`; that is a property of the `stadium` shape, not of this
 * port.
 */
export interface CollideSegment {
  seg: Seg;
  /** `GetWidth() / 2`. */
  halfWidth: number;
}

/** `SHAPE_SEGMENT::Collide( const VECTOR2I& )` — location on **this** segment. */
function shapeSegmentCollidePoint(
  aA: CollideSegment,
  aP: Vec2,
  aClearance: number,
  aOut: Out,
): boolean {
  const minDist = aA.halfWidth + aClearance;
  const dSq = segSquaredDistanceToPoint(aA.seg, aP);

  if (dSq === 0 || dSq < sq(minDist)) {
    aOut.location = segNearestPoint(aA.seg, aP);
    aOut.actual = Math.max(0, Math.sqrt(dSq) - aA.halfWidth);

    return true;
  }

  return false;
}

/**
 * `SHAPE_SEGMENT::Collide( const SEG& )` — a **location** source.
 *
 * The location is `m_seg.NearestPoint( aSeg )`, i.e. a point on **this** shape's
 * segment, never on the segment it was handed. That is what makes segment
 * against segment asymmetric.
 */
export function shapeSegmentCollideSeg(
  aA: CollideSegment,
  aSeg: Seg,
  aClearance: number,
  aOut: Out,
): boolean {
  if (same(aSeg.a, aSeg.b)) return shapeSegmentCollidePoint(aA, aSeg.a, aClearance, aOut);

  const minDist = aA.halfWidth + aClearance;
  const dSq = segSquaredDistanceToSeg(aA.seg, aSeg);

  if (dSq === 0 || dSq < sq(minDist)) {
    aOut.location = segNearestPointToSeg(aA.seg, aSeg);
    aOut.actual = Math.max(0, Math.sqrt(dSq) - aA.halfWidth);

    return true;
  }

  return false;
}

// ----- SHAPE_LINE_CHAIN_BASE ---------------------------------------------------

/**
 * A closed `SHAPE_LINE_CHAIN_BASE` — upstream's `SHAPE_SIMPLE`, which is what a
 * Ziro `poly` is. Open chains are not constructible from the `Shape` union, so
 * every `aB.IsClosed() && …` in the C++ has a constant `true` on its left and is
 * transcribed as the right-hand side alone. That is the one place a future open
 * chain would have to re-add a test rather than merely pass a flag.
 */
export interface CollideChain {
  pts: readonly Vec2[];
}

const chainSegmentCount = (aChain: CollideChain): number => aChain.pts.length;

const chainSegment = (aChain: CollideChain, aIndex: number): Seg => ({
  a: aChain.pts[aIndex] as Vec2,
  b: aChain.pts[(aIndex + 1) % aChain.pts.length] as Vec2,
});

/**
 * `SHAPE_LINE_CHAIN_BASE::PointInside` with the default accuracy.
 *
 * Not `drc_geometry`'s `pointInPoly`: upstream casts its ray in the **positive
 * x** direction and brackets with `p1.y >= aPt.y != p2.y >= aPt.y`, where
 * `pointInPoly` uses strict `>`. The two disagree on a point level with a
 * vertex, and containment here is not a tie-breaker — it decides both the
 * verdict and the reported location.
 *
 * The `aAccuracy > 1` arm, which falls back to `PointOnEdge`, is not reachable:
 * every caller in `shape_collisions.cpp` takes the default accuracy of 0.
 */
export function chainPointInside(aChain: CollideChain, aPt: Vec2): boolean {
  const pointCount = aChain.pts.length;

  if (pointCount < 3) return false;

  let inside = false;

  for (let i = 0; i < pointCount; ) {
    const p1 = aChain.pts[i++] as Vec2;
    const p2 = aChain.pts[i === pointCount ? 0 : i] as Vec2;
    const diff = sub(p2, p1);

    if (diff.y === 0) continue;

    const d = (diff.x * (aPt.y - p1.y)) / diff.y;

    if (p1.y >= aPt.y !== p2.y >= aPt.y && aPt.x - p1.x < d) inside = !inside;
  }

  return inside;
}

/**
 * `SHAPE_LINE_CHAIN_BASE::Collide( const SEG& )` — a **location** source.
 *
 * Two different kinds of point come out of this. When the chain encloses the
 * segment's *first* endpoint the location is that endpoint — a point on the
 * segment, and specifically `A` rather than whichever end is deeper inside.
 * Otherwise it is `NearestPoint` on the winning chain segment, a point on the
 * chain.
 */
export function chainCollideSeg(
  aChain: CollideChain,
  aSeg: Seg,
  aClearance: number,
  aOut: Out,
): boolean {
  if (chainPointInside(aChain, aSeg.a)) {
    aOut.location = aSeg.a;
    aOut.actual = 0;
    return true;
  }

  let closestDistSq = Number.POSITIVE_INFINITY;
  const clearanceSq = sq(aClearance);
  let nearest: Vec2 = { x: 0, y: 0 };

  for (let i = 0; i < chainSegmentCount(aChain); i++) {
    const s = chainSegment(aChain, i);
    const dSq = segSquaredDistanceToSeg(s, aSeg);

    if (dSq < closestDistSq) {
      nearest = segNearestPointToSeg(s, aSeg);
      closestDistSq = dSq;

      if (closestDistSq === 0) break;

      // `closest_dist_sq < clearance_sq && !aActual` — unreachable, aActual is
      // always wanted here.
    }
  }

  if (closestDistSq === 0 || closestDistSq < clearanceSq) {
    aOut.location = nearest;
    aOut.actual = Math.sqrt(closestDistSq);

    return true;
  }

  return false;
}

// ----- the pair table ----------------------------------------------------------

/**
 * `Collide( const SHAPE_CIRCLE&, const SHAPE_CIRCLE& )`.
 *
 * **Location: the midpoint of the two centres.** Not a point of contact, not on
 * either circumference — for two large discs barely touching it sits deep inside
 * both, and for two small circles it sits in the empty space between them.
 *
 * The verdict is `dist_sq == 0 || dist_sq < min_dist_sq` where `dist_sq` is the
 * squared distance between the **centres**, so the `== 0` arm means *co-centred*
 * rather than *overlapping*. That is a real difference from
 * `defaultShapeCollider`, which reads `d === 0` off the clamped gap and so calls
 * two exactly-touching circles a collision at any clearance. Here they collide
 * only when `rA + rB < clearance + rA + rB`, i.e. when the clearance is
 * positive — and `collideSimple` does hand this routine a clearance of `-1`.
 */
export function collideCircleCircle(
  aA: CollideCircle,
  aB: CollideCircle,
  aClearance: number,
  aOut: Out,
): boolean {
  const minDist = aClearance + aA.r + aB.r;
  const minDistSq = sq(minDist);

  const dSq = distSq(aB.c, aA.c);

  if (dSq === 0 || dSq < minDistSq) {
    aOut.actual = Math.max(0, Math.sqrt(dSq) - aA.r - aB.r);
    aOut.location = { x: (aA.c.x + aB.c.x) / 2, y: (aA.c.y + aB.c.y) / 2 };

    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_CIRCLE&, const SHAPE_SEGMENT& )`.
 *
 * **Location: on the segment** (see {@link shapeCircleCollideSeg}). The
 * segment's half-width is folded into the clearance and taken back off the
 * actual afterwards, so it never moves the location off the segment's
 * centreline.
 */
export function collideCircleSegment(
  aA: CollideCircle,
  aSeg: CollideSegment,
  aClearance: number,
  aOut: Out,
): boolean {
  if (shapeCircleCollideSeg(aA, aSeg.seg, aClearance + aSeg.halfWidth, aOut)) {
    aOut.actual = Math.max(0, aOut.actual - aSeg.halfWidth);
    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_CIRCLE&, const SHAPE_LINE_CHAIN_BASE& )`.
 *
 * **Location: the circle's own centre** when the chain encloses it, otherwise a
 * point on whichever chain segment gave the smallest `collision_dist` — which by
 * {@link shapeCircleCollideSeg}'s rule is a point on *that segment*.
 *
 * Ties keep the earlier segment (strict `<`), so the chain's winding order is
 * observable in the answer.
 */
export function collideCircleChain(
  aA: CollideCircle,
  aB: CollideChain,
  aClearance: number,
  aOut: Out,
): boolean {
  let closestDist = Number.POSITIVE_INFINITY;
  let nearest: Vec2 = { x: 0, y: 0 };

  if (chainPointInside(aB, aA.c)) {
    nearest = aA.c;
    closestDist = 0;
  } else {
    for (let s = 0; s < chainSegmentCount(aB); s++) {
      const local = newOut();

      if (shapeCircleCollideSeg(aA, chainSegment(aB, s), aClearance, local)) {
        if (local.actual < closestDist) {
          nearest = local.location;
          closestDist = local.actual;
        }

        if (closestDist === 0) break;

        // `if( !aActual ) break` — unreachable, aActual is always wanted.
      }
    }
  }

  if (closestDist === 0 || closestDist < aClearance) {
    aOut.location = nearest;
    aOut.actual = closestDist;

    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_SEGMENT&, const SHAPE_SEGMENT& )`.
 *
 * **Location: on `aA`'s segment.** Swapping the two arguments moves the answer
 * to the other segment, and `ITEM::collideSimple` calls the collider with the
 * *head* first, so the location a router obstacle carries is a point on the head.
 */
export function collideSegmentSegment(
  aA: CollideSegment,
  aB: CollideSegment,
  aClearance: number,
  aOut: Out,
): boolean {
  const rv = shapeSegmentCollideSeg(aA, aB.seg, aClearance + aB.halfWidth, aOut);

  if (rv) aOut.actual = Math.max(0, aOut.actual - aB.halfWidth);

  return rv;
}

/**
 * `Collide( const SHAPE_LINE_CHAIN_BASE&, const SHAPE_SEGMENT& )`.
 *
 * **Location: on the chain**, or the segment's `A` endpoint when the chain
 * encloses it. The dispatch always puts the chain first, so this is the answer
 * for a `poly` against a `stadium` whichever order the caller used.
 */
export function collideChainSegment(
  aA: CollideChain,
  aB: CollideSegment,
  aClearance: number,
  aOut: Out,
): boolean {
  const rv = chainCollideSeg(aA, aB.seg, aClearance + aB.halfWidth, aOut);

  if (rv) aOut.actual = Math.max(0, aOut.actual - aB.halfWidth);

  return rv;
}

/**
 * `Collide( const SHAPE_LINE_CHAIN_BASE&, const SHAPE_LINE_CHAIN_BASE& )`.
 *
 * **Location: on `aA`'s segment** in the general case, or one of the two
 * chains' *first point* when one encloses the other's — note that it is
 * `GetPoint( 0 )` and not any kind of deepest or nearest point.
 *
 * The two segment lists are sorted by `( A.x, A.y )` before the double loop, and
 * that sort is load-bearing: the winner is chosen with a strict `<`, so among
 * segments at equal distance it is the sort that decides which point comes back.
 *
 * Upstream follows the loop with a block that re-collides any true arcs held by
 * a `SHAPE_LINE_CHAIN`. A Ziro `poly` is a `SHAPE_SIMPLE` with `ArcCount() == 0`,
 * so that block cannot fire and is not ported.
 */
export function collideChainChain(
  aA: CollideChain,
  aB: CollideChain,
  aClearance: number,
  aOut: Out,
): boolean {
  let closestDist = Number.POSITIVE_INFINITY;
  let nearest: Vec2 = { x: 0, y: 0 };

  if (aA.pts.length > 0 && chainPointInside(aB, aA.pts[0] as Vec2)) {
    closestDist = 0;
    nearest = aA.pts[0] as Vec2;
  } else if (aB.pts.length > 0 && chainPointInside(aA, aB.pts[0] as Vec2)) {
    closestDist = 0;
    nearest = aB.pts[0] as Vec2;
  } else {
    // `IsArcSegment` filtering does not apply: these chains carry no arcs.
    const segSort = (a: Seg, b: Seg): number => (a.a.x !== b.a.x ? a.a.x - b.a.x : a.a.y - b.a.y);

    const aSegs: Seg[] = [];
    const bSegs: Seg[] = [];

    for (let ii = 0; ii < chainSegmentCount(aA); ii++) aSegs.push(chainSegment(aA, ii));
    for (let ii = 0; ii < chainSegmentCount(aB); ii++) bSegs.push(chainSegment(aB, ii));

    aSegs.sort(segSort);
    bSegs.sort(segSort);

    for (const aSeg of aSegs) {
      for (const bSeg of bSegs) {
        const local = newOut();

        if (segCollideOut(aSeg, bSeg, aClearance, local)) {
          if (local.actual < closestDist) {
            nearest = segNearestPointToSeg(aSeg, bSeg);
            closestDist = local.actual;
          }

          // Upstream breaks the *inner* loop only, so an exact touch found early
          // does not stop the outer walk.
          if (closestDist === 0) break;

          // `if( !aActual ) break` — unreachable, aActual is always wanted.
        }
      }
    }
  }

  if (closestDist === 0 || closestDist < aClearance) {
    aOut.location = nearest;
    aOut.actual = closestDist;

    return true;
  }

  return false;
}

// ----- SHAPE_ARC ---------------------------------------------------------------

/**
 * `SHAPE_ARC`, in Ziro's parameterisation.
 *
 * Upstream stores three points — start, mid, end — and derives the centre, the
 * radius and the angles from them on demand. Ziro's `arc` shape stores the
 * centre, the radius and a signed angular sweep, and derives the three points.
 * The two describe the same curve, and every routine below is written against
 * whichever of the two the C++ actually reads.
 *
 * ## The sign of an angle
 *
 * `EDA_ANGLE( VECTOR2I )` is `atan2( -v.y, v.x )` — KiCad negates y so that
 * angles run anticlockwise on a screen whose y axis points down. Ziro's
 * `arcShape` uses a plain `atan2( v.y, v.x )`. **Every Ziro angle is therefore
 * the negation of the corresponding KiCad angle**, `GetCentralAngle() > 0`
 * becomes `sweep < 0`, and each `<` in an angular comparison becomes a `>`.
 * Both flips are applied together at each site, with a note; applying one
 * without the other silently mirrors the arc.
 */
export interface CollideArc {
  c: Vec2;
  rad: number;
  /** `GetStartAngle()`, negated: Ziro measures in the plain screen plane. */
  a0: number;
  /** `GetCentralAngle()`, negated. */
  sweep: number;
  /** `GetWidth() / 2`. */
  halfWidth: number;
}

const TAU = 2 * Math.PI;
const normTau = (a: number): number => ((a % TAU) + TAU) % TAU;

const arcPointAt = (aArc: CollideArc, aAngle: number): Vec2 => ({
  x: aArc.c.x + aArc.rad * Math.cos(aAngle),
  y: aArc.c.y + aArc.rad * Math.sin(aAngle),
});

/** `GetP0()` / `m_start`. */
const arcP0 = (aArc: CollideArc): Vec2 => arcPointAt(aArc, aArc.a0);
/** `GetP1()` / `m_end`. */
const arcP1 = (aArc: CollideArc): Vec2 => arcPointAt(aArc, aArc.a0 + aArc.sweep);
/** `m_mid`. */
const arcMid = (aArc: CollideArc): Vec2 => arcPointAt(aArc, aArc.a0 + aArc.sweep / 2);

/**
 * Upstream's `m_start != m_end` test, which is how `SHAPE_ARC::Collide` asks
 * "is this a full circle?".
 *
 * Asking it of the two *recomputed* endpoints would be the obvious
 * transcription and it is not this, because `cos( a0 )` and `cos( a0 ± 2π )`
 * differ in the last bit and a closed arc would report two distinct ends.
 * Asking it of the parameters — is the sweep a whole number of turns — is exact:
 * `arcShape` emits `0 - TAU` for a closed arc, and `-TAU % TAU` is `-0`.
 *
 * How much that is worth is worth being precise about, because it is less than
 * it looks. For the **negative** full turn `arcShape` actually produces, the
 * naive endpoint comparison is harmless by accident: it makes this false, the
 * angular test in {@link arcCollidePoint} then runs with `ccw` true and
 * `rotatedEndAngle` normalising to `0`, and its `rotatedPtAngle < 0` can never
 * hold, so nothing is rejected after all. It is a **positive** full turn — legal
 * in the `Shape` union, though no current producer emits one — where the two
 * disagree: there `ccw` is false, the test becomes `rotatedPtAngle > 0`, and
 * every point but the start snaps to an endpoint. That case is what the test
 * over this guard pins.
 */
const arcIsFullCircle = (aArc: CollideArc): boolean => normTau(aArc.sweep) === 0;

/**
 * `SHAPE_ARC::sliceContainsPoint`: is the point's bearing from the centre inside
 * the swept range? Nothing to do with the radius.
 *
 * `drc_geometry`'s `angleInArc` asks the same question but allows a `1e-12`
 * slop; upstream has none, and the boundary decides both the verdict and the
 * location in {@link arcNearestPointsCircle}, so this is written out rather than
 * reused.
 */
export function arcSliceContainsPoint(aArc: CollideArc, aP: Vec2): boolean {
  const phi = Math.atan2(aP.y - aArc.c.y, aP.x - aArc.c.x);

  // `if( ca >= ANGLE_0 )` — with the sign flip, KiCad's non-negative central
  // angle is Ziro's non-positive sweep.
  if (aArc.sweep <= 0) return normTau(aArc.a0 - phi) <= -aArc.sweep;

  return normTau(phi - aArc.a0) <= aArc.sweep;
}

/**
 * `SEG::ApproxCollinear`, in floating point.
 *
 * `libs/kimath/src/geometry/seg.ts` has an exact-integer `segApproxCollinear`,
 * but it converts through `BigInt` and an arc's derived start/mid/end are not
 * integers. The int64 version's `rescale` rounding — which that file documents
 * as widening the effective threshold from 1 IU to about 1.22 — is what is lost
 * here; the perpendicular distances themselves are the same quantity.
 *
 * The longer segment supplies the line, ties keep `a`, and a zero-length longer
 * segment is not collinear with anything.
 */
function approxCollinear(aA: Seg, aB: Seg, aDistanceThreshold = 1): boolean {
  let a1 = aA.a;
  let a2 = aA.b;
  let b1 = aB.a;
  let b2 = aB.b;

  if (distSq(a1, a2) < distSq(b1, b2)) {
    [a1, a2, b1, b2] = [b1, b2, a1, a2];
  }

  const p = a1.y - a2.y;
  const q = a2.x - a1.x;
  const r = -p * a1.x - q * a1.y;
  const l = p * p + q * q;

  if (l === 0) return false;

  const det1 = p * b1.x + q * b1.y + r;
  const det2 = p * b2.x + q * b2.y + r;

  const thresholdSquared = aDistanceThreshold * aDistanceThreshold;

  return (det1 * det1) / l <= thresholdSquared && (det2 * det2) / l <= thresholdSquared;
}

/**
 * `SHAPE_ARC::IsEffectiveLine`: an arc so flat that its three points are
 * collinear to within a unit, *and* that does not double back on itself.
 *
 * Every arc pair tests this first and, when it holds, re-dispatches through a
 * `SHAPE_SEGMENT` — which means the reported location changes from an
 * arc-flavoured one to a segment-flavoured one. It is not a performance
 * shortcut.
 */
export function arcIsEffectiveLine(aArc: CollideArc): boolean {
  const start = arcP0(aArc);
  const mid = arcMid(aArc);
  const end = arcP1(aArc);

  const v1: Seg = { a: start, b: mid };
  const v2: Seg = { a: mid, b: end };

  return approxCollinear(v1, v2) && dot(sub(v1.b, v1.a), sub(v2.b, v2.a)) > 0;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * `SHAPE_ARC::BBox( aClearance )`, over the exact arc box rather than the whole
 * circle's: the two endpoints plus whichever of the four axis extremes the sweep
 * actually reaches.
 *
 * `drc_geometry`'s `shapeBBox` deliberately returns the looser full-circle box,
 * which would be *behaviour-identical* here — the box is only ever used to
 * reject, and a superset can only reject things that are genuinely out of range.
 * The exact one is used anyway, because the inflation below is upstream's and
 * pairing it with a different box would make the numbers unreadable.
 *
 * A full turn needs no special case: {@link arcSliceContainsPoint} answers true
 * for every bearing when `|sweep|` is `2π`, so all four extremes are collected
 * on their own. Short-circuiting on {@link arcIsFullCircle} here would also
 * catch a *zero* sweep, and hand a degenerate arc the whole circle's box.
 */
function arcBBox(aArc: CollideArc, aClearance: number): Box {
  const pts: Vec2[] = [arcP0(aArc), arcP1(aArc)];

  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const p = arcPointAt(aArc, a);

    if (arcSliceContainsPoint(aArc, p)) pts.push(p);
  }

  const box: Box = {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };

  // `if( m_width != 0 ) bbox.Inflate( KiROUND( m_width / 2.0 ) + 1 )`, where
  // `m_width / 2.0` is this shape's half-width.
  const inflate = (d: number): void => {
    box.minX -= d;
    box.minY -= d;
    box.maxX += d;
    box.maxY += d;
  };

  if (aArc.halfWidth !== 0) inflate(KiROUND(aArc.halfWidth) + 1);
  if (aClearance !== 0) inflate(aClearance);

  return box;
}

const boxContains = (aBox: Box, aP: Vec2): boolean =>
  aP.x >= aBox.minX && aP.x <= aBox.maxX && aP.y >= aBox.minY && aP.y <= aBox.maxY;

/**
 * `SHAPE_ARC::Collide( const VECTOR2I& )` — a **location** source.
 *
 * The location is a point on the arc: the radial projection of `aP` onto the
 * arc's circle when the bearing is inside the sweep, and otherwise the nearer of
 * the two *endpoints*, snapped to. It is never `aP` itself.
 *
 * Two of upstream's integer roundings are kept here because they change control
 * flow rather than just precision. `dist` is `KiROUND`ed, and a rounded-to-zero
 * distance sends the routine down a branch that recomputes it as the *signed*
 * `radius - |aP - centre|` — which can come out negative for a point just
 * outside the circle, and then clamps to a zero actual. The snap-to-endpoint
 * measurements use `VECTOR2<int>::EuclideanNorm`, which rounds half away from
 * zero rather than truncating, and the two endpoints are compared with a strict
 * `<` so a point equidistant from both snaps to the *end*.
 *
 * The `radius >= INT_MAX / 2` fallback is not ported: it exists because `CIRCLE`
 * stores its radius as an `int` and the arithmetic below would overflow, and a
 * JavaScript number has no such edge. Such an arc is flat enough that
 * {@link arcIsEffectiveLine} has already diverted every pair function that could
 * reach here.
 */
export function arcCollidePoint(
  aArc: CollideArc,
  aP: Vec2,
  aClearance: number,
  aOut: Out,
): boolean {
  const minDist = aClearance + aArc.halfWidth;

  if (!boxContains(arcBBox(aArc, minDist), aP)) return false;

  const fullCircle: CollideCircle = { c: aArc.c, r: aArc.rad };
  let nearestPt = circleNearestPoint(fullCircle, aP);
  let dist = KiROUND(Math.hypot(nearestPt.x - aP.x, nearestPt.y - aP.y));

  // Angle from centre to the point.
  const angleToPt = Math.atan2(aP.y - aArc.c.y, aP.x - aArc.c.x);

  if (!dist) {
    // Keep the sqrt of the squared distance rather than a EuclideanNorm, which
    // would truncate to an integer before the subtraction.
    dist = KiROUND(aArc.rad - Math.sqrt(distSq(aP, aArc.c)));
    nearestPt = arcPointAt(aArc, angleToPt);
  }

  // If not a 360 degree arc, need to use arc angles to decide if point collides.
  if (!arcIsFullCircle(aArc)) {
    // `ccw = GetCentralAngle() > ANGLE_0`, and both the sign and the two
    // comparisons flip into Ziro's convention together.
    const ccw = aArc.sweep < 0;
    const rotatedPtAngle = normTau(angleToPt - aArc.a0);
    const rotatedEndAngle = normTau(aArc.sweep);

    if ((ccw && rotatedPtAngle < rotatedEndAngle) || (!ccw && rotatedPtAngle > rotatedEndAngle)) {
      const distStartpt = EuclideanNormI(sub(aP, arcP0(aArc)));
      const distEndpt = EuclideanNormI(sub(aP, arcP1(aArc)));

      if (distStartpt < distEndpt) {
        dist = distStartpt;
        nearestPt = arcP0(aArc);
      } else {
        dist = distEndpt;
        nearestPt = arcP1(aArc);
      }
    }
  }

  if (dist <= minDist) {
    aOut.location = nearestPt;
    aOut.actual = Math.max(0, dist - aArc.halfWidth);

    return true;
  }

  return false;
}

/**
 * `SHAPE_ARC::Collide( const SEG& )` — a **location** source, and the sharpest
 * edge in this file.
 *
 * Upstream builds a list of candidate points and calls
 * {@link arcCollidePoint} on each. **There is no minimisation**: every candidate
 * that collides overwrites `aActual` and `aLocation`, so what comes back is the
 * *last* colliding candidate in list order, not the nearest one. The early
 * return only fires on an exact zero. Reordering the candidate list, or picking
 * the closest instead, would produce a location that looks entirely reasonable
 * and is not the one KiCad reports.
 *
 * The list is: the circle/segment intersections first, then the segment's
 * nearest points to the centre and to the two arc endpoints, then the segment's
 * own two ends.
 *
 * The leading branch is a different routine altogether: an arc of more than a
 * half turn whose ends are closer together than the clearance is treated as a
 * *disc*, because a segment cannot pass between its ends without touching it —
 * unless it is entirely inside the hole, which is what the two-endpoint test
 * above it checks.
 */
export function arcCollideSeg(aArc: CollideArc, aSeg: Seg, aClearance: number, aOut: Out): boolean {
  const circle: CollideCircle = { c: aArc.c, r: aArc.rad };
  const clearanceSq = sq(aClearance);

  // `GetCentralAngle().AsDegrees() > 180.0` — KiCad's central angle is the
  // negation of Ziro's sweep, so a KiCad angle above half a turn is a Ziro sweep
  // below minus half a turn.
  const centralAngle = -aArc.sweep;

  if (centralAngle > Math.PI && distSq(arcP0(aArc), arcP1(aArc)) < clearanceSq) {
    const aDistSq = distSq(aSeg.a, aArc.c);
    const bDistSq = distSq(aSeg.b, aArc.c);
    const radiusSq = sq(aArc.rad - aClearance);

    if (aDistSq < radiusSq && bDistSq < radiusSq) return false;

    return shapeCircleCollideSeg(circle, aSeg, aClearance, aOut);
  }

  // Possible points of the collision are:
  // 1. Intersection of the segment with the full circle
  // 2. Closest point on the segment to the center of the circle
  // 3. Closest point on the segment to the end points of the arc
  // 4. End points of the segment
  const candidatePts: Vec2[] = [
    ...circleIntersectSeg(circle, aSeg),
    segNearestPoint(aSeg, aArc.c),
    segNearestPoint(aSeg, arcP0(aArc)),
    segNearestPoint(aSeg, arcP1(aArc)),
    aSeg.a,
    aSeg.b,
  ];

  let anyCollides = false;

  for (const candidate of candidatePts) {
    const collides = arcCollidePoint(aArc, candidate, aClearance, aOut);

    anyCollides = anyCollides || collides;

    // `if( collides && ( !aActual || *aActual == 0 ) )` — aActual is always
    // wanted, so only an exact zero stops the walk.
    if (collides && aOut.actual === 0) return true;
  }

  return anyCollides;
}

/** The three things a `NearestPoints` overload writes. */
interface NearestPoints {
  ptA: Vec2;
  ptB: Vec2;
  distSq: number;
}

/**
 * `SHAPE_ARC::NearestPoints( const SHAPE_CIRCLE& )`.
 *
 * Note the tail, which runs unconditionally: `ptA` is pushed half the arc's
 * width towards `ptB`, and the distance is then *zeroed* if it was inside that
 * half-width.
 *
 * Upstream has a latent bug there: if no candidate passed the slice test, `ptA`
 * and `ptB` are still the default `(0, 0)`, the push is a no-op on a zero
 * vector, `Infinity < (width/2)²` is false, and the routine reports a zero
 * distance between two origins — a collision at the origin. It is transcribed
 * rather than fixed, but it is **not** reachable and so is not pinned by a test:
 * two of the three candidates are the arc's own endpoints, and an arc's
 * endpoints are always inside its own slice. Only a floating-point disagreement
 * between `a0` and `atan2` applied to the point `a0` generated could get here.
 */
export function arcNearestPointsCircle(aArc: CollideArc, aCircle: CollideCircle): NearestPoints {
  if (same(aArc.c, aCircle.c) && aArc.rad === aCircle.r) {
    const p = arcP0(aArc);
    return { ptA: p, ptB: p, distSq: 0 };
  }

  let out: NearestPoints = { ptA: { x: 0, y: 0 }, ptB: { x: 0, y: 0 }, distSq: Infinity };

  const circle1: CollideCircle = { c: aArc.c, r: aArc.rad };

  for (const pt of circleIntersectCircle(circle1, aCircle)) {
    if (arcSliceContainsPoint(aArc, pt)) return { ptA: pt, ptB: pt, distSq: 0 };
  }

  for (const pt of [arcP0(aArc), arcP1(aArc), circleNearestPoint(circle1, aCircle.c)]) {
    if (arcSliceContainsPoint(aArc, pt)) {
      const nearestPt2 = circleNearestPoint(aCircle, pt);
      const d = distSq(pt, nearestPt2);

      if (d < out.distSq) out = { ptA: pt, ptB: nearestPt2, distSq: d };
    }
  }

  // Adjust point A by half the arc width towards point B.
  const dir = resize(sub(out.ptB, out.ptA), aArc.halfWidth);
  const ptA = add(out.ptA, dir);

  return {
    ptA,
    ptB: out.ptB,
    distSq: out.distSq < sq(aArc.halfWidth) ? 0 : distSq(ptA, out.ptB),
  };
}

/**
 * `SHAPE_ARC::NearestPoints( const SHAPE_ARC& )`.
 *
 * Four things here are easy to "tidy" and must not be:
 *
 * - the endpoint-against-endpoint sweep returns immediately on an exact zero
 *   **without** the width adjustment, so two arcs sharing a vertex report that
 *   vertex and a zero distance whatever their widths;
 * - the two endpoint-against-circle passes *overwrite* the running best rather
 *   than comparing against it, so a worse pair can replace a better one;
 * - concentric arcs (`colocated`) return whatever those passes left behind,
 *   again without the width adjustment;
 * - a genuine circle/circle intersection inside both slices returns a zero
 *   distance without the width adjustment as well.
 */
export function arcNearestPointsArc(aA: CollideArc, aB: CollideArc): NearestPoints {
  const state: NearestPoints = { ptA: { x: 0, y: 0 }, ptB: { x: 0, y: 0 }, distSq: Infinity };

  const adjustForArcWidths = (): void => {
    // Adjust point A by half the arc-width towards point B.
    let dir = resize(sub(state.ptB, state.ptA), aA.halfWidth);
    state.ptA = add(state.ptA, dir);

    // Adjust point B by half the other arc-width towards point A.
    dir = resize(sub(state.ptA, state.ptB), aB.halfWidth);
    state.ptB = add(state.ptB, dir);

    state.distSq =
      state.distSq < sq(aA.halfWidth + aB.halfWidth) ? 0 : distSq(state.ptA, state.ptB);
  };

  const center1 = aA.c;
  const center2 = aB.c;

  // Centers aren't exact, so center_dist_sq won't be exact either.
  const centerDistSq = distSq(center1, center2);
  const centerEpsilon = KiROUND(Math.min(aA.rad, aB.rad) / 1000);
  const colocated = centerDistSq < sq(centerEpsilon);

  const pts1 = [arcP0(aA), arcP1(aA)];
  const pts2 = [arcP0(aB), arcP1(aB)];

  // Start by checking endpoints.
  for (const pt1 of pts1) {
    for (const pt2 of pts2) {
      const d = distSq(pt1, pt2);

      if (d < state.distSq) {
        state.distSq = d;
        state.ptA = pt1;
        state.ptB = pt2;

        // No width adjustment on this path.
        if (state.distSq === 0) return { ...state };
      }
    }
  }

  for (const pt of pts1) {
    if (arcSliceContainsPoint(aB, pt)) {
      const circle: CollideCircle = { c: center2, r: aB.rad };

      // Unconditional: this can replace a better pair found above.
      state.ptA = pt;
      state.ptB = circleNearestPoint(circle, pt);
      state.distSq = distSq(state.ptA, state.ptB);

      if (colocated || state.distSq === 0) {
        if (state.distSq !== 0) adjustForArcWidths();

        return { ...state };
      }
    }
  }

  for (const pt of pts2) {
    if (arcSliceContainsPoint(aA, pt)) {
      const circle: CollideCircle = { c: center1, r: aA.rad };

      state.ptA = circleNearestPoint(circle, pt);
      state.ptB = pt;
      state.distSq = distSq(state.ptA, state.ptB);

      if (colocated || state.distSq === 0) {
        if (state.distSq !== 0) adjustForArcWidths();

        return { ...state };
      }
    }
  }

  // The remaining checks require the arcs to be on non-concentric circles.
  if (colocated) return { ...state };

  const circle1: CollideCircle = { c: center1, r: aA.rad };
  const circle2: CollideCircle = { c: center2, r: aB.rad };

  // First check for intersections on the circles.
  for (const pt of circleIntersectCircle(circle1, circle2)) {
    if (arcSliceContainsPoint(aA, pt) && arcSliceContainsPoint(aB, pt)) {
      return { ptA: pt, ptB: pt, distSq: 0 };
    }
  }

  // Closest pair of points on the two full circles. For external the pair faces
  // each other between the centers, so each is the nearest point on its circle
  // to the other center. For one circle strictly inside the other the pair lies
  // on the same side, so the outer circle's pt is nearest to the inner center
  // and the inner circle's pt is furthest from the outer center.
  const r1 = aA.rad;
  const r2 = aB.rad;
  const contained = centerDistSq < sq(r1 - r2);

  let pt1: Vec2;
  let pt2: Vec2;

  if (contained && r1 > r2) {
    pt1 = circleNearestPoint(circle1, center2);
    pt2 = circleFurthestPoint(circle2, center1);
  } else if (contained) {
    pt1 = circleFurthestPoint(circle1, center2);
    pt2 = circleNearestPoint(circle2, center1);
  } else {
    pt1 = circleNearestPoint(circle1, center2);
    pt2 = circleNearestPoint(circle2, center1);
  }

  const pt1InSlice = arcSliceContainsPoint(aA, pt1);
  const pt2InSlice = arcSliceContainsPoint(aB, pt2);

  if (pt1InSlice && pt2InSlice) {
    const d = distSq(pt1, pt2);

    if (d < state.distSq) {
      state.distSq = d;
      state.ptA = pt1;
      state.ptB = pt2;
    }

    adjustForArcWidths();
    return { ...state };
  }

  // Check the endpoints of arc 1 against the nearest point on arc 2.
  if (pt2InSlice) {
    for (const pt of pts1) {
      const d = distSq(pt, pt2);

      if (d < state.distSq) {
        state.distSq = d;
        state.ptA = pt;
        state.ptB = pt2;
      }
    }
  }

  // Check the endpoints of arc 2 against the nearest point on arc 1.
  if (pt1InSlice) {
    for (const pt of pts2) {
      const d = distSq(pt1, pt);

      if (d < state.distSq) {
        state.distSq = d;
        state.ptA = pt1;
        state.ptB = pt;
      }
    }
  }

  adjustForArcWidths();
  return { ...state };
}

/** `SHAPE_SEGMENT( aA.GetP0(), aA.GetP1(), aA.GetWidth() )`, the flat-arc stand-in. */
const arcAsSegment = (aArc: CollideArc): CollideSegment => ({
  seg: { a: arcP0(aArc), b: arcP1(aArc) },
  halfWidth: aArc.halfWidth,
});

/**
 * `Collide( const SHAPE_ARC&, const SHAPE_CIRCLE& )`.
 *
 * **Location: the midpoint of the two nearest points**, which is a third kind of
 * answer again — not a centre midpoint as for two circles, and not a point on
 * either shape. It lands inside the gap between them.
 *
 * The verdict compares against `aClearance` alone, with nothing added for either
 * shape's thickness — both are already inside `dist_sq`, which
 * {@link arcNearestPointsCircle} measures between a point pushed half the arc's
 * width outwards and a point on the circle's *circumference*. So `dist_sq` is
 * the copper gap and the comparison is `gap² < clearance²`, unlike the circle
 * and segment pairs, which fold a half-width into the clearance and subtract it
 * again.
 */
export function collideArcCircle(
  aA: CollideArc,
  aB: CollideCircle,
  aClearance: number,
  aOut: Out,
): boolean {
  if (arcIsEffectiveLine(aA)) {
    return collideCircleSegment(aB, arcAsSegment(aA), aClearance, aOut);
  }

  const { ptA, ptB, distSq: dSq } = arcNearestPointsCircle(aA, aB);

  if (dSq === 0 || dSq < sq(aClearance)) {
    aOut.location = { x: (ptA.x + ptB.x) / 2, y: (ptA.y + ptB.y) / 2 };
    aOut.actual = Math.max(0, KiROUND(Math.sqrt(dSq)));

    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_ARC&, const SHAPE_SEGMENT& )`.
 *
 * **Location: on the arc** — {@link arcCollideSeg}'s last colliding candidate,
 * which {@link arcCollidePoint} always resolves onto the arc itself.
 */
export function collideArcSegment(
  aA: CollideArc,
  aB: CollideSegment,
  aClearance: number,
  aOut: Out,
): boolean {
  if (arcIsEffectiveLine(aA)) {
    return collideSegmentSegment(arcAsSegment(aA), aB, aClearance, aOut);
  }

  const rv = arcCollideSeg(aA, aB.seg, aClearance + aB.halfWidth, aOut);

  if (rv) aOut.actual = Math.max(0, aOut.actual - aB.halfWidth);

  return rv;
}

/**
 * `Collide( const SHAPE_ARC&, const SHAPE_LINE_CHAIN_BASE& )`.
 *
 * **Location: the arc's `P0`** when the chain encloses it — its *start* point,
 * not the deepest or the nearest — and otherwise the winning chain segment's
 * answer from {@link arcCollideSeg}, which is a point on the arc.
 *
 * Upstream also has a `SHAPE_LINE_CHAIN` overload that walks the chain's own
 * arcs and shares its `pn` across two loops. Ziro polys are `SHAPE_SIMPLE`s and
 * dispatch to this one, so that variant is not ported.
 */
export function collideArcChain(
  aA: CollideArc,
  aB: CollideChain,
  aClearance: number,
  aOut: Out,
): boolean {
  if (arcIsEffectiveLine(aA)) {
    return collideChainSegment(aB, arcAsSegment(aA), aClearance, aOut);
  }

  let closestDist = Number.POSITIVE_INFINITY;
  let nearest: Vec2 = { x: 0, y: 0 };

  if (chainPointInside(aB, arcP0(aA))) {
    closestDist = 0;
    nearest = arcP0(aA);
  } else {
    for (let i = 0; i < chainSegmentCount(aB); i++) {
      const local = newOut();

      if (arcCollideSeg(aA, chainSegment(aB, i), aClearance, local)) {
        if (local.actual < closestDist) {
          nearest = local.location;
          closestDist = local.actual;
        }

        if (closestDist === 0) break;

        // `if( !aActual ) break` — unreachable, aActual is always wanted.
      }
    }
  }

  if (closestDist === 0 || closestDist < aClearance) {
    aOut.location = nearest;
    aOut.actual = closestDist;

    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_ARC&, const SHAPE_ARC& )`.
 *
 * **Location: the midpoint of the two nearest points.** Note which way round the
 * two flat-arc diversions go: a flat `aA` re-enters as `Collide( aB, segment )`,
 * putting the *other* arc first, while a flat `aB` keeps `aA` first. So a pair
 * with one flat arc reports a location on whichever arc is still curved.
 */
export function collideArcArc(
  aA: CollideArc,
  aB: CollideArc,
  aClearance: number,
  aOut: Out,
): boolean {
  if (arcIsEffectiveLine(aA)) return collideArcSegment(aB, arcAsSegment(aA), aClearance, aOut);
  if (arcIsEffectiveLine(aB)) return collideArcSegment(aA, arcAsSegment(aB), aClearance, aOut);

  const { ptA, ptB, distSq: dSq } = arcNearestPointsArc(aA, aB);

  if (dSq === 0 || dSq < sq(aClearance)) {
    aOut.location = { x: (ptA.x + ptB.x) / 2, y: (ptA.y + ptB.y) / 2 };
    aOut.actual = Math.max(0, KiROUND(Math.sqrt(dSq)));

    return true;
  }

  return false;
}

// ----- bridging Ziro's Shape onto the classes ----------------------------------

const asCircle = (s: Shape & { kind: 'circle' }): CollideCircle => ({ c: s.c, r: s.r });

const asSegment = (s: Shape & { kind: 'stadium' }): CollideSegment => ({
  seg: { a: s.a, b: s.b },
  halfWidth: s.r,
});

const asChain = (s: Shape & { kind: 'poly' }): CollideChain => ({ pts: s.pts });

const asArc = (s: Shape & { kind: 'arc' }): CollideArc => ({
  c: s.c,
  rad: s.rad,
  a0: s.a0,
  sweep: s.sweep,
  halfWidth: s.r,
});

/**
 * `collideSingleShapes`' dispatch, restricted to the pairs Ziro can build.
 *
 * Upstream's table reaches each pair function through `CollCase<Ta,Tb>`, which
 * calls `Collide( Ta, Tb )` in argument order, or `CollCaseReversed`, which
 * swaps them. Both are written out here as explicit calls, because *which*
 * argument ends up first is exactly what decides where the location lands.
 *
 * The arc always ends up first when it meets a circle, a segment or a chain —
 * upstream has no `Collide( X, SHAPE_ARC )` at all, only the reversed dispatch
 * entries — so those three pairs are symmetric in the caller's argument order,
 * while segment/segment and chain/chain are not.
 */
function collideSingleShapes(aA: Shape, aB: Shape, aClearance: number, aOut: Out): boolean {
  if (aA.kind === 'circle') {
    if (aB.kind === 'circle')
      return collideCircleCircle(asCircle(aA), asCircle(aB), aClearance, aOut);
    if (aB.kind === 'stadium')
      return collideCircleSegment(asCircle(aA), asSegment(aB), aClearance, aOut);
    if (aB.kind === 'poly') return collideCircleChain(asCircle(aA), asChain(aB), aClearance, aOut);
    // `CollCaseReversed<SHAPE_CIRCLE, SHAPE_ARC>`: the arc goes first.
    return collideArcCircle(asArc(aB), asCircle(aA), aClearance, aOut);
  }

  if (aA.kind === 'stadium') {
    // `CollCaseReversed<SHAPE_SEGMENT, SHAPE_CIRCLE>`: the circle goes first.
    if (aB.kind === 'circle')
      return collideCircleSegment(asCircle(aB), asSegment(aA), aClearance, aOut);
    if (aB.kind === 'stadium')
      return collideSegmentSegment(asSegment(aA), asSegment(aB), aClearance, aOut);
    // `CollCase<SHAPE_LINE_CHAIN_BASE, SHAPE_SEGMENT>( aB, aA )`: chain first.
    if (aB.kind === 'poly')
      return collideChainSegment(asChain(aB), asSegment(aA), aClearance, aOut);
    // `CollCaseReversed<SHAPE_SEGMENT, SHAPE_ARC>`: the arc goes first.
    return collideArcSegment(asArc(aB), asSegment(aA), aClearance, aOut);
  }

  if (aA.kind === 'poly') {
    // `CollCase<SHAPE_CIRCLE, SHAPE_LINE_CHAIN_BASE>( aB, aA )`: circle first.
    if (aB.kind === 'circle')
      return collideCircleChain(asCircle(aB), asChain(aA), aClearance, aOut);
    if (aB.kind === 'stadium')
      return collideChainSegment(asChain(aA), asSegment(aB), aClearance, aOut);
    if (aB.kind === 'poly') return collideChainChain(asChain(aA), asChain(aB), aClearance, aOut);
    // `CollCaseReversed<SHAPE_LINE_CHAIN_BASE, SHAPE_ARC>`: the arc goes first.
    return collideArcChain(asArc(aB), asChain(aA), aClearance, aOut);
  }

  // `case SH_ARC:` — every entry is a plain `CollCase<SHAPE_ARC, X>`, arc first.
  if (aB.kind === 'circle') return collideArcCircle(asArc(aA), asCircle(aB), aClearance, aOut);
  if (aB.kind === 'stadium') return collideArcSegment(asArc(aA), asSegment(aB), aClearance, aOut);
  if (aB.kind === 'poly') return collideArcChain(asArc(aA), asChain(aB), aClearance, aOut);

  return collideArcArc(asArc(aA), asArc(aB), aClearance, aOut);
}

/**
 * `SHAPE::Collide( const SHAPE*, int, int*, VECTOR2I* )`.
 *
 * ### The `poly.r` bridge
 *
 * Ziro's `poly` carries an outward inflation that KiCad has no SHAPE for:
 * upstream would model a rounded-rect pad as a `SHAPE_RECT` with a corner radius
 * or as a `SHAPE_COMPOUND`, and would model a stroked polygon primitive as a
 * chain of `SHAPE_SEGMENT`s. Rather than invent a shape class, the inflation is
 * folded into the clearance and taken back off the actual — which is precisely
 * what upstream does for a `SHAPE_SEGMENT`'s half-width in
 * `Collide( SHAPE_LINE_CHAIN_BASE, SHAPE_SEGMENT )`:
 *
 * ```
 * rv = aA.Collide( aB.GetSeg(), aClearance + aB.GetWidth() / 2, aActual, aLocation );
 * if( rv && aActual ) *aActual = std::max( 0, *aActual - aB.GetWidth() / 2 );
 * ```
 *
 * The consequence for the location is upstream's too: it stays on the
 * *un-inflated skeleton*, the polygon outline, rather than on the inflated
 * boundary the copper actually has.
 */
export function collideShapes(aA: Shape, aB: Shape, aClearance: number): ShapeCollisionResult {
  const rA = aA.kind === 'poly' ? aA.r : 0;
  const rB = aB.kind === 'poly' ? aB.r : 0;

  const out = newOut();
  const collides = collideSingleShapes(aA, aB, aClearance + rA + rB, out);

  if (!collides) return { collides: false, actual: 0, location: null };

  return { collides: true, actual: Math.max(0, out.actual - rA - rB), location: out.location };
}
