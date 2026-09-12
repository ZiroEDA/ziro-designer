// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SEG` (`libs/kimath/include/geometry/seg.h`, `src/geometry/seg.cpp`): a
 * line segment `A -> B` with the index it has inside a parent shape.
 *
 * ## Exact-integer throughout, as upstream
 *
 * `SEG::ecoord` is `int64_t`. With 1e6 IU/mm a coordinate near the edge of
 * KiCad's design space reaches ~1e9, a determinant ~1e18 and `det * det`
 * ~1e36 - far past the 2^53 where a double stops representing consecutive
 * integers. Every product that the C++ forms in `ecoord` is formed in BigInt
 * here, `rescale( a, b, d )` is the `__int128` arm (`rescale64`), and the
 * integer square root is `isqrt`, seeded from the double and corrected
 * exactly as `seg.cpp:57` does. A double anywhere in this chain would judge
 * two metre-long segments collinear or not essentially at random.
 *
 * ## The `seg*` functions at the bottom
 *
 * Before the class existed the same bodies were exported as free functions
 * over a `{ a, b }` record, and ~600 call sites use them. They are now
 * one-line delegates onto the class - the ONLY implementation is the method -
 * and go away as their callers move onto `SEG`.
 */

import { KiROUND, rescale64 } from '../math/util.js';
import { divideI, EuclideanNormI } from '../math/vector2.js';
import type { Vec2, VECTOR2I } from '../math/vector2.js';
import { EDA_ANGLE } from './eda_angle.js';
import type { Seg } from './corner_operations.js';

/** `OPT_VECTOR2I`. */
export type OPT_VECTOR2I = VECTOR2I | undefined;

/**
 * A board coordinate as an exact integer. Upstream's VECTOR2I *is* an integer,
 * so the rounding only formalises what the C++ type already guarantees - but it
 * is not optional here: `BigInt()` throws on a fractional number, and a Vec2
 * that has been through a floating-point transform can carry one.
 */
const big = (v: number): bigint => BigInt(KiROUND(v));

/** `-0` reads as a different value to `0` in a deep-equality assertion. */
const noNegZero = (v: number): number => (v === 0 ? 0 : v);

/** A number back out of BigInt. Board coordinates fit a double exactly. */
const num = (v: bigint): number => noNegZero(Number(v));

const absB = (v: bigint): bigint => (v < 0n ? -v : v);

/** `sgn` (`seg.cpp:31`): `( T( 0 ) < aVal ) - ( aVal < T( 0 ) )`. */
const sgnB = (v: bigint): bigint => (v > 0n ? 1n : v < 0n ? -1n : 0n);

/** `VECTOR2L::Cross`. */
const bigCross = (ax: bigint, ay: bigint, bx: bigint, by: bigint): bigint => ax * by - ay * bx;

/** `std::numeric_limits<VECTOR2I::coord_type>` - the range an intersection must land in. */
const COORD_MAX = 2147483647n;
const COORD_MIN = -2147483648n;

/** `VECTOR2I::ECOORD_MAX`. */
const ECOORD_MAX = 9223372036854775807n;

/**
 * `isqrt` (`seg.cpp:57`): the largest integer whose square does not exceed `x`,
 * computed exactly.
 *
 * Upstream seeds from `(T) std::sqrt( (double) x )` and then corrects with two
 * `while` loops, precisely because the double is not trustworthy at int64
 * scale. The seed here is the same double; the corrections are the same, in
 * BigInt. `x` is a *squared* distance, so it reaches ~1e18 and the double's
 * ~1e-16 relative error puts the seed a unit or two either side of the truth -
 * which is exactly what the loops are for.
 *
 * Upstream's `x < 0` arm returns `sqrt_max`.
 */
export function isqrt64(x: bigint): bigint {
  const SQRT_INT64_MAX = 3037000499n;

  if (x < 0n) return SQRT_INT64_MAX;

  let r = BigInt(Math.trunc(Math.sqrt(Number(x))));

  while (r < SQRT_INT64_MAX && r * r < x) r++;
  while (r > SQRT_INT64_MAX || r * r > x) r--;

  return r;
}

export class SEG {
  /* Start and the of the segment. Public, to make access simpler. */
  A: VECTOR2I;
  B: VECTOR2I;

  ///< index within the parent shape (used when m_is_local == false)
  private m_index: number;

  constructor();
  constructor(aX1: number, aY1: number, aX2: number, aY2: number);
  constructor(aA: Vec2, aB: Vec2, aIndex?: number);
  constructor(aSeg: SEG);
  constructor(a?: number | Vec2 | SEG, b?: number | Vec2, c?: number, d?: number) {
    if (a === undefined) {
      this.A = { x: 0, y: 0 };
      this.B = { x: 0, y: 0 };
      this.m_index = -1;
    } else if (a instanceof SEG) {
      this.A = { x: a.A.x, y: a.A.y };
      this.B = { x: a.B.x, y: a.B.y };
      this.m_index = a.m_index;
    } else if (typeof a === 'number') {
      this.A = { x: a, y: b as number };
      this.B = { x: c as number, y: d as number };
      this.m_index = -1;
    } else {
      const bb = b as Vec2;
      this.A = { x: a.x, y: a.y };
      this.B = { x: bb.x, y: bb.y };
      this.m_index = c ?? -1;
    }
  }

  /** `operator=`. */
  assign(aSeg: SEG): this {
    this.A = { x: aSeg.A.x, y: aSeg.A.y };
    this.B = { x: aSeg.B.x, y: aSeg.B.y };
    this.m_index = aSeg.m_index;
    return this;
  }

  /** `operator==`: same endpoints (the index does not take part). */
  equals(aSeg: SEG): boolean {
    return (
      this.A.x === aSeg.A.x &&
      this.A.y === aSeg.A.y &&
      this.B.x === aSeg.B.x &&
      this.B.y === aSeg.B.y
    );
  }

  static Square(a: number): number {
    return a * a;
  }

  /**
   * Compute the perpendicular projection point of aP on a line passing through
   * ends of the segment.
   *
   * A zero-length segment has no line, and upstream answers `A` rather than
   * dividing by zero. `l_squared = d.Dot( d )` for a segment 10 cm long at
   * 1e6 IU/mm is already 1e16, past 2^53, and `rescale` then forms `t * d.x`
   * on top of it - order 1e24 - hence BigInt.
   */
  LineProject(aP: Vec2): VECTOR2I {
    const dx = big(this.B.x) - big(this.A.x);
    const dy = big(this.B.y) - big(this.A.y);
    const l_squared = dx * dx + dy * dy;

    if (l_squared === 0n) return { x: this.A.x, y: this.A.y };

    const t = dx * (big(aP.x) - big(this.A.x)) + dy * (big(aP.y) - big(this.A.y));

    return {
      x: num(big(this.A.x) + rescale64(t, dx, l_squared)),
      y: num(big(this.A.y) + rescale64(t, dy, l_squared)),
    };
  }

  /**
   * Determine on which side of directed line passing via segment ends point aP lies.
   *
   * @return: <0: left, 0 : on the line, >0 : right
   */
  Side(aP: Vec2): number {
    const det = bigCross(
      big(this.B.x) - big(this.A.x),
      big(this.B.y) - big(this.A.y),
      big(aP.x) - big(this.A.x),
      big(aP.y) - big(this.A.y),
    );
    return det < 0n ? -1 : det > 0n ? 1 : 0;
  }

  /**
   * Return the closest Euclidean distance between point aP and the line defined by
   * the ends of segment (this).
   *
   * The sign is `sgn( det )`, the same determinant `Side` uses, so the two
   * agree on left and right. A degenerate segment gives `dist_sq = 0`, and
   * upstream still applies the sign of `det` - which is itself 0.
   */
  LineDistance(aP: Vec2, aDetermineSide = false): number {
    const p = big(this.A.y) - big(this.B.y);
    const q = big(this.B.x) - big(this.A.x);
    const r = -p * big(this.A.x) - q * big(this.A.y);
    const l = p * p + q * q;
    const det = p * big(aP.x) + q * big(aP.y) + r;

    // `rescale( det, det, l )`: the numerator is a square and `l` is positive, so
    // the half-away-from-zero correction is always added.
    const dist_sq = l > 0n ? rescale64(det, det, l) : 0n;
    const dist = isqrt64(dist_sq);

    return num(aDetermineSide ? sgnB(det) * dist : absB(dist));
  }

  /**
   * Determine the smallest angle between two segments
   */
  Angle(aOther: SEG): EDA_ANGLE {
    const thisAngle = EDA_ANGLE.fromVector({
      x: this.A.x - this.B.x,
      y: this.A.y - this.B.y,
    }).Normalize180();
    const otherAngle = EDA_ANGLE.fromVector({
      x: aOther.A.x - aOther.B.x,
      y: aOther.A.y - aOther.B.y,
    }).Normalize180();

    return thisAngle.sub(otherAngle).Normalize180().abs();
  }

  /**
   * Compute a point on the segment (this) that is closest to point aP.
   */
  NearestPoint(aP: Vec2): VECTOR2I;
  /**
   * Compute closest points between this segment and aSeg.
   */
  NearestPoint(aSeg: SEG): VECTOR2I;
  NearestPoint(a: Vec2 | SEG): VECTOR2I {
    if (a instanceof SEG) return this.nearestPointToSeg(a);

    // Inlined for performance reasons
    const dx = big(this.B.x) - big(this.A.x);
    const dy = big(this.B.y) - big(this.A.y);
    const l_squared = dx * dx + dy * dy;

    if (l_squared === 0n) return { x: this.A.x, y: this.A.y };

    // Inlined for performance reasons
    const t = dx * (big(a.x) - big(this.A.x)) + dy * (big(a.y) - big(this.A.y));

    if (t < 0n) return { x: this.A.x, y: this.A.y };
    if (t > l_squared) return { x: this.B.x, y: this.B.y };

    return {
      x: num(big(this.A.x) + rescale64(t, dx, l_squared)),
      y: num(big(this.A.y) + rescale64(t, dy, l_squared)),
    };
  }

  private nearestPointToSeg(aSeg: SEG): VECTOR2I {
    const p = this.Intersect(aSeg);

    if (p !== undefined) return p;

    const pts_origin = [
      aSeg.NearestPoint(this.A),
      aSeg.NearestPoint(this.B),
      this.NearestPoint(aSeg.A),
      this.NearestPoint(aSeg.B),
    ] as const;

    const pts_out = [this.A, this.B, pts_origin[2], pts_origin[3]] as const;

    const pts_dist = [
      squaredDistance(pts_origin[0], this.A),
      squaredDistance(pts_origin[1], this.B),
      squaredDistance(pts_origin[2], aSeg.A),
      squaredDistance(pts_origin[3], aSeg.B),
    ] as const;

    let min_i = 0;

    for (let i = 0; i < 4; i++) {
      if (pts_dist[i]! < pts_dist[min_i]!) min_i = i;
    }

    const out = pts_out[min_i]!;
    return { x: out.x, y: out.y };
  }

  /**
   * Compute closest points between this segment and aSeg.
   *
   * @param aPtA point on this segment (output)
   * @param aPtB point on the other segment (output)
   * @param aDistSq squared distance between points (output)
   * @return true if the operation was successful
   */
  NearestPoints(aSeg: SEG, aPtA: VECTOR2I, aPtB: VECTOR2I, aDistSq: { value: number }): boolean {
    const p = this.Intersect(aSeg);

    if (p !== undefined) {
      aPtA.x = aPtB.x = p.x;
      aPtA.y = aPtB.y = p.y;
      aDistSq.value = 0;
      return true;
    }

    const pts_origin = [
      aSeg.NearestPoint(this.A),
      aSeg.NearestPoint(this.B),
      this.NearestPoint(aSeg.A),
      this.NearestPoint(aSeg.B),
    ] as const;

    const pts_a_out = [this.A, this.B, pts_origin[2], pts_origin[3]] as const;
    const pts_b_out = [pts_origin[0], pts_origin[1], aSeg.A, aSeg.B] as const;

    const pts_dist = [
      squaredDistance(pts_origin[0], this.A),
      squaredDistance(pts_origin[1], this.B),
      squaredDistance(pts_origin[2], aSeg.A),
      squaredDistance(pts_origin[3], aSeg.B),
    ] as const;

    let min_i = 0;

    for (let i = 0; i < 4; i++) {
      if (pts_dist[i]! < pts_dist[min_i]!) min_i = i;
    }

    aPtA.x = pts_a_out[min_i]!.x;
    aPtA.y = pts_a_out[min_i]!.y;
    aPtB.x = pts_b_out[min_i]!.x;
    aPtB.y = pts_b_out[min_i]!.y;
    aDistSq.value = pts_dist[min_i]!;

    return true;
  }

  /**
   * Reflect a point using this segment as axis.
   */
  ReflectPoint(aP: Vec2): VECTOR2I {
    const dx = big(this.B.x) - big(this.A.x);
    const dy = big(this.B.y) - big(this.A.y);
    const l_squared = dx * dx + dy * dy;
    const t = dx * (big(aP.x) - big(this.A.x)) + dy * (big(aP.y) - big(this.A.y));
    let cx: bigint;
    let cy: bigint;

    if (l_squared === 0n) {
      cx = big(aP.x);
      cy = big(aP.y);
    } else {
      cx = big(this.A.x) + rescale64(t, dx, l_squared);
      cy = big(this.A.y) + rescale64(t, dy, l_squared);
    }

    return { x: num(2n * cx - big(aP.x)), y: num(2n * cy - big(aP.y)) };
  }

  /**
   * Compute intersection point of segment (this) with segment aSeg.
   *
   * @param aSeg: segment to intersect with
   * @param aIgnoreEndpoints: don't treat corner cases (i.e. end of one segment touching the
   * other) as intersections.
   * @param aLines: treat segments as infinite lines
   * @return intersection point, if exists
   */
  Intersect(aSeg: SEG, aIgnoreEndpoints = false, aLines = false): OPT_VECTOR2I {
    const ip: VECTOR2I = { x: 0, y: 0 };

    if (this.intersects(aSeg, aIgnoreEndpoints, aLines, ip)) return ip;
    return undefined;
  }

  Intersects(aSeg: SEG): boolean {
    return this.intersects(aSeg);
  }

  /**
   * Compute the intersection point of lines passing through ends of (this) and aSeg.
   */
  IntersectLines(aSeg: SEG): OPT_VECTOR2I {
    return this.Intersect(aSeg, false, true);
  }

  /**
   * Check if this segment intersects a line defined by slope aSlope and offset aOffset.
   */
  IntersectsLine(aSlope: number, aOffset: number, aIntersection: VECTOR2I): boolean {
    const segDirX = this.B.x - this.A.x;
    const segDirY = this.B.y - this.A.y;

    // Handle vertical segment case
    if (segDirX === 0) {
      // Vertical segment: x = A.x, find y on the line
      const intersect_y = aSlope * this.A.x + aOffset;
      const intersect_y_int = KiROUND(intersect_y);

      // Check if intersection is within segment's y-range
      const seg_min_y = Math.min(this.A.y, this.B.y);
      const seg_max_y = Math.max(this.A.y, this.B.y);

      if (intersect_y_int >= seg_min_y && intersect_y_int <= seg_max_y) {
        aIntersection.x = this.A.x;
        aIntersection.y = intersect_y_int;
        return true;
      }

      return false;
    }

    const lineDirX = 1000n;
    const lineDirY = BigInt(Math.trunc(aSlope * 1000));
    const cross_product = bigCross(BigInt(segDirX), BigInt(segDirY), lineDirX, lineDirY);

    if (cross_product === 0n) {
      // Parallel lines - check if segment lies on the line
      const expected_y = aSlope * this.A.x + aOffset;
      const diff = Math.abs(this.A.y - expected_y);

      if (diff < 0.5) {
        // Collinear: segment lies on the line, return midpoint
        const mid = divideI({ x: this.A.x + this.B.x, y: this.A.y + this.B.y }, 2);
        aIntersection.x = mid.x;
        aIntersection.y = mid.y;
        return true;
      }

      return false; // Parallel but not collinear
    }

    // Find intersection using parametric equations
    // Segment: P = segA + t * segDir
    // Line: y = aSlope * x + aOffset
    //
    // At intersection: segA.y + t * segDir.y = aSlope * (segA.x + t * segDir.x) + aOffset
    // Solving for t: t = (aSlope * segA.x + aOffset - segA.y) / (segDir.y - aSlope * segDir.x)
    const numerator = aSlope * this.A.x + aOffset - this.A.y;
    const denominator = segDirY - aSlope * segDirX;
    const t = numerator / denominator;

    // Check if intersection is within segment bounds
    if (t >= 0.0 && t <= 1.0) {
      aIntersection.x = KiROUND(this.A.x + t * segDirX);
      aIntersection.y = KiROUND(this.A.y + t * segDirY);
      return true;
    }

    return false;
  }

  /**
   * Compute a segment perpendicular to this one, passing through point aP.
   *
   * `VECTOR2I::Perpendicular()` is `(-y, x)`, a quarter turn one specific way.
   */
  PerpendicularSeg(aP: Vec2): SEG {
    const slope = { x: this.B.x - this.A.x, y: this.B.y - this.A.y };
    const endPoint = { x: -slope.y + aP.x, y: slope.x + aP.y };

    return new SEG(aP, endPoint);
  }

  /**
   * Compute a segment parallel to this one, passing through point aP.
   *
   * With this segment's *length* - upstream adds the whole `B - A` vector, it
   * does not normalise.
   */
  ParallelSeg(aP: Vec2): SEG {
    const slope = { x: this.B.x - this.A.x, y: this.B.y - this.A.y };
    const endPoint = { x: slope.x + aP.x, y: slope.y + aP.y };

    return new SEG(aP, endPoint);
  }

  /**
   * `Collide( aSeg, aClearance, aActual )`: the two segments come within
   * `aClearance` of each other. The actual distance is written to
   * `aActual.value` when given.
   */
  Collide(aSeg: SEG, aClearance: number, aActual?: { value: number }): boolean {
    // Handle negative clearance
    if (aClearance < 0) {
      if (aActual) aActual.value = 0;
      return false;
    }

    // Handle zero-length segments (points) specially.
    // The intersects() check below doesn't handle this case correctly because
    // the cross product with a zero vector is always zero, causing false positives.
    if (this.A.x === this.B.x && this.A.y === this.B.y) {
      const dist = aSeg.Distance(this.A);
      if (aActual) aActual.value = dist;
      return dist === 0 || dist < aClearance;
    }

    if (aSeg.A.x === aSeg.B.x && aSeg.A.y === aSeg.B.y) {
      const dist = this.Distance(aSeg.A);
      if (aActual) aActual.value = dist;
      return dist === 0 || dist < aClearance;
    }

    // Check for exact intersection first
    if (this.intersects(aSeg, false, false)) {
      if (aActual) aActual.value = 0;
      return true;
    }

    const clearance_sq = big(aClearance) * big(aClearance);
    let min_dist_sq = ECOORD_MAX;

    // There are 4 points to check: start and end of this segment, and
    // start and end of the other segment.
    for (const dist of [
      this.squaredDistanceToPoint(aSeg.A),
      this.squaredDistanceToPoint(aSeg.B),
      aSeg.squaredDistanceToPoint(this.A),
      aSeg.squaredDistanceToPoint(this.B),
    ]) {
      if (dist === 0n) {
        if (aActual) aActual.value = 0;
        return true;
      }

      if (dist < min_dist_sq) min_dist_sq = dist;
    }

    if (min_dist_sq < clearance_sq) {
      if (aActual) aActual.value = num(isqrt64(min_dist_sq));
      return true;
    }

    if (aActual) aActual.value = num(isqrt64(min_dist_sq));

    return false;
  }

  /**
   * Compute minimum Euclidean distance to segment aSeg (or to point aP).
   */
  SquaredDistance(aSeg: SEG): number;
  SquaredDistance(aP: Vec2): number;
  SquaredDistance(a: SEG | Vec2): number {
    if (a instanceof SEG) return num(this.squaredDistanceToSeg(a));
    return num(this.squaredDistanceToPoint(a));
  }

  private squaredDistanceToSeg(aSeg: SEG): bigint {
    // Handle zero-length segments (points) specially.
    // The Intersects() check below doesn't handle this case correctly because
    // the cross product with a zero vector is always zero, causing false positives.
    if (this.A.x === this.B.x && this.A.y === this.B.y) return aSeg.squaredDistanceToPoint(this.A);

    if (aSeg.A.x === aSeg.B.x && aSeg.A.y === aSeg.B.y) return this.squaredDistanceToPoint(aSeg.A);

    if (this.Intersects(aSeg)) return 0n;

    const pts = [
      squaredDistance(aSeg.NearestPoint(this.A), this.A),
      squaredDistance(aSeg.NearestPoint(this.B), this.B),
      squaredDistance(this.NearestPoint(aSeg.A), aSeg.A),
      squaredDistance(this.NearestPoint(aSeg.B), aSeg.B),
    ];

    let m = ECOORD_MAX;

    for (let i = 0; i < 4; i++) {
      const v = big(pts[i]!);
      if (v < m) m = v;
    }

    return m;
  }

  private squaredDistanceToPoint(aP: Vec2): bigint {
    const abx = big(this.B.x) - big(this.A.x);
    const aby = big(this.B.y) - big(this.A.y);
    const apx = big(aP.x) - big(this.A.x);
    const apy = big(aP.y) - big(this.A.y);

    const e = apx * abx + apy * aby;

    if (e <= 0n) return apx * apx + apy * apy;

    const f = abx * abx + aby * aby;

    if (e >= f) {
      const bpx = big(aP.x) - big(this.B.x);
      const bpy = big(aP.y) - big(this.B.y);
      return bpx * bpx + bpy * bpy;
    }

    const eD = Number(e);
    const g = Number(apx * apx + apy * apy) - (eD * eD) / Number(f);

    // The only way g can be negative is if there was a rounding error since
    // e is the projection of aP onto ab and therefore cannot be greater than
    // the length of ap and f is guaranteed to be greater than e, meaning
    // e * e / f cannot be greater than ap.SquaredEuclideanNorm()
    if (g < 0 || g > 2 ** 63) return 0n;

    return BigInt(KiROUND(g));
  }

  Distance(aSeg: SEG): number;
  Distance(aP: Vec2): number;
  Distance(a: SEG | Vec2): number {
    if (a instanceof SEG) return num(isqrt64(this.squaredDistanceToSeg(a)));
    return num(isqrt64(this.squaredDistanceToPoint(a)));
  }

  /** `CanonicalCoefs`: `qA * x + qB * y + qC = 0` for the segment's line. */
  CanonicalCoefs(): { qA: bigint; qB: bigint; qC: bigint } {
    const qA = big(this.A.y) - big(this.B.y);
    const qB = big(this.B.x) - big(this.A.x);
    const qC = -qA * big(this.A.x) - qB * big(this.A.y);
    return { qA, qB, qC };
  }

  /**
   * Check if segment aSeg lies on the same line as (this).
   */
  Collinear(aSeg: SEG): boolean {
    const { qA, qB, qC } = this.CanonicalCoefs();

    const d1 = absB(big(aSeg.A.x) * qA + big(aSeg.A.y) * qB + qC);
    const d2 = absB(big(aSeg.B.x) * qA + big(aSeg.B.y) * qB + qC);

    return d1 <= 1n && d2 <= 1n;
  }

  /**
   * `mutualDistanceSquared`: the two *signed* squared distances from the
   * shorter segment's endpoints to the longer segment's line, or `null` when
   * the longer segment is degenerate and defines no line.
   *
   * The longer segment supplies the line; ties keep `this`, because upstream
   * swaps only on a strict `<`. The `rescale( det, det, l )` is upstream's
   * int64 specialisation: round-half-away-from-zero, which for a non-negative
   * numerator and a positive denominator is `(det² + l/2) / l` truncated - and
   * `l / 2` is itself an integer division. That is why the effective
   * threshold is not exactly 1 IU of perpendicular offset but about 1.22 IU.
   */
  private mutualDistanceSquared(aSeg: SEG): { d1: bigint; d2: bigint } | null {
    let a: SEG = this;
    let b: SEG = aSeg;

    if (a.squaredLengthB() < b.squaredLengthB()) {
      const t = a;
      a = b;
      b = t;
    }

    const p = big(a.A.y) - big(a.B.y);
    const q = big(a.B.x) - big(a.A.x);
    const r = -p * big(a.A.x) - q * big(a.A.y);
    const l = p * p + q * q;

    if (l === 0n) return null;

    const det1 = p * big(b.A.x) + q * big(b.A.y) + r;
    const det2 = p * big(b.B.x) + q * big(b.B.y) + r;

    const dsq1 = rescale64(det1, det1, l);
    const dsq2 = rescale64(det2, det2, l);

    return { d1: sgnB(det1) * dsq1, d2: sgnB(det2) * dsq2 };
  }

  ApproxCollinear(aSeg: SEG, aDistanceThreshold = 1): boolean {
    const thresholdSquared = big(aDistanceThreshold) * big(aDistanceThreshold);
    const d = this.mutualDistanceSquared(aSeg);

    if (!d) return false;

    return absB(d.d1) <= thresholdSquared && absB(d.d2) <= thresholdSquared;
  }

  /**
   * Signed is what makes this "parallel" rather than "collinear or crossing":
   * a segment that crosses the other's line has endpoints at equal magnitude
   * but opposite sign when it crosses at its midpoint, and the subtraction
   * then gives twice the distance rather than zero.
   */
  ApproxParallel(aSeg: SEG, aDistanceThreshold = 1): boolean {
    const thresholdSquared = big(aDistanceThreshold) * big(aDistanceThreshold);
    const d = this.mutualDistanceSquared(aSeg);

    if (!d) return false;

    return absB(d.d1 - d.d2) <= thresholdSquared;
  }

  ApproxPerpendicular(aSeg: SEG): boolean {
    const perp = this.PerpendicularSeg(this.A);
    return aSeg.ApproxParallel(perp);
  }

  Overlaps(aSeg: SEG): boolean {
    if (aSeg.A.x === aSeg.B.x && aSeg.A.y === aSeg.B.y) {
      // single point corner case
      if (samePoint(this.A, aSeg.A) || samePoint(this.B, aSeg.A)) return false;

      return this.Contains(aSeg.A);
    }

    if (!this.Collinear(aSeg)) return false;

    if (this.Contains(aSeg.A) || this.Contains(aSeg.B)) return true;

    if (aSeg.Contains(this.A) || aSeg.Contains(this.B)) return true;

    return false;
  }

  /**
   * Return the length (this).
   */
  Length(): number {
    return EuclideanNormI({ x: this.A.x - this.B.x, y: this.A.y - this.B.y });
  }

  SquaredLength(): number {
    return num(this.squaredLengthB());
  }

  private squaredLengthB(): bigint {
    const dx = big(this.A.x) - big(this.B.x);
    const dy = big(this.A.y) - big(this.B.y);
    return dx * dx + dy * dy;
  }

  TCoef(aP: Vec2): number {
    const dx = big(this.B.x) - big(this.A.x);
    const dy = big(this.B.y) - big(this.A.y);
    return num(dx * (big(aP.x) - big(this.A.x)) + dy * (big(aP.y) - big(this.A.y)));
  }

  /**
   * Return the index of this segment in its parent shape (applicable only to non-local
   * segments).
   */
  Index(): number {
    return this.m_index;
  }

  /** `Contains( const SEG& )`: the whole of `aSeg` lies on this segment. */
  Contains(aSeg: SEG): boolean;
  /** `Contains( const VECTOR2I& )`: within `sqrt( 3 )` of the segment. */
  Contains(aP: Vec2): boolean;
  Contains(a: SEG | Vec2): boolean {
    if (a instanceof SEG) {
      if (samePoint(a.A, a.B)) return this.Contains(a.A); // single point corner case

      if (!this.Collinear(a)) return false;

      if (this.Contains(a.A) && this.Contains(a.B)) return true;

      return false;
    }

    return this.squaredDistanceToPoint(a) <= 3n;
  }

  Reverse(): void {
    const t = this.A;
    this.A = this.B;
    this.B = t;
  }

  Reversed(): SEG {
    return new SEG(this.B, this.A);
  }

  /**
   * Returns the center point of the line.
   *
   * `VECTOR2I` has exactly one division operator, `operator/( double )`, whose
   * integral body is `KiROUND( x / aFactor )`: the halving **rounds half away
   * from zero**, it does not truncate.
   */
  Center(): VECTOR2I {
    const half = divideI({ x: this.B.x - this.A.x, y: this.B.y - this.A.y }, 2);

    return { x: this.A.x + half.x, y: this.A.y + half.y };
  }

  /** `operator<`: by `A`, then `B` (each by x, then y). */
  lessThan(aSeg: SEG): boolean {
    if (samePoint(this.A, aSeg.A)) return lessPoint(this.B, aSeg.B);

    return lessPoint(this.A, aSeg.A);
  }

  /** `operator<<`. */
  Format(): string {
    return `[ (${this.A.x}, ${this.A.y}) - (${this.B.x}, ${this.B.y}) ]`;
  }

  private checkCollinearOverlap(
    aSeg: SEG,
    useXAxis: boolean,
    aIgnoreEndpoints: boolean,
    aPt: VECTOR2I | undefined,
  ): boolean {
    // Extract coordinates based on the chosen axis
    let seg1_start: number;
    let seg1_end: number;
    let seg2_start: number;
    let seg2_end: number;
    let coord1_start: number; // For calculating other axis coordinate
    let coord1_end: number;

    if (useXAxis) {
      seg1_start = this.A.x;
      seg1_end = this.B.x;
      seg2_start = aSeg.A.x;
      seg2_end = aSeg.B.x;
      coord1_start = this.A.y;
      coord1_end = this.B.y;
    } else {
      seg1_start = this.A.y;
      seg1_end = this.B.y;
      seg2_start = aSeg.A.y;
      seg2_end = aSeg.B.y;
      coord1_start = this.A.x;
      coord1_end = this.B.x;
    }

    // Find segment ranges on the projection axis
    const seg1_min = Math.min(seg1_start, seg1_end);
    const seg1_max = Math.max(seg1_start, seg1_end);
    const seg2_min = Math.min(seg2_start, seg2_end);
    const seg2_max = Math.max(seg2_start, seg2_end);

    // Check for overlap
    const overlaps = seg1_max >= seg2_min && seg2_max >= seg1_min;

    if (!overlaps) return false;

    // Check if intersection is only at endpoints when aIgnoreEndpoints is true
    if (aIgnoreEndpoints) {
      // Calculate overlap region
      const overlap_start = Math.max(seg1_min, seg2_min);
      const overlap_end = Math.min(seg1_max, seg2_max);

      // If overlap region has zero length, segments only touch at endpoint
      if (overlap_start === overlap_end) {
        // Check if this endpoint touching involves actual segment endpoints
        // (not just projected endpoints due to min/max calculation)
        let isEndpointTouch = false;

        // Check if the touch point corresponds to actual segment endpoints
        if (overlap_start === seg1_min || overlap_start === seg1_max) {
          // Touch point is at seg1's endpoint, check if it's also at seg2's endpoint
          if (overlap_start === seg2_min || overlap_start === seg2_max) {
            isEndpointTouch = true;
          }
        }

        if (isEndpointTouch) return false; // Ignore endpoint-only intersection
      }
    }

    // Calculate intersection point if requested
    if (aPt) {
      // Find midpoint of overlap region
      const overlap_start = Math.max(seg1_min, seg2_min);
      const overlap_end = Math.min(seg1_max, seg2_max);
      const intersection_proj = Math.trunc((overlap_start + overlap_end) / 2);

      // Calculate corresponding coordinate on the other axis
      let intersection_other: number;

      if (seg1_end !== seg1_start) {
        // Use this segment's line equation to find other coordinate
        intersection_other =
          coord1_start +
          Number(
            rescale64(
              big(intersection_proj - seg1_start),
              big(coord1_end - coord1_start),
              big(seg1_end - seg1_start),
            ),
          );
      } else {
        // Degenerate segment (point) or perpendicular to projection axis
        intersection_other = coord1_start;
      }

      // Set result based on projection axis
      if (useXAxis) {
        aPt.x = intersection_proj;
        aPt.y = intersection_other;
      } else {
        aPt.x = intersection_other;
        aPt.y = intersection_proj;
      }
    }

    return true;
  }

  private intersects(aSeg: SEG, aIgnoreEndpoints = false, aLines = false, aPt?: VECTOR2I): boolean {
    // Quick rejection: check if segment bounding boxes overlap
    // (Skip for line mode since infinite lines can intersect anywhere)
    if (!aLines) {
      const this_min_x = Math.min(this.A.x, this.B.x);
      const this_max_x = Math.max(this.A.x, this.B.x);
      const this_min_y = Math.min(this.A.y, this.B.y);
      const this_max_y = Math.max(this.A.y, this.B.y);
      const other_min_x = Math.min(aSeg.A.x, aSeg.B.x);
      const other_max_x = Math.max(aSeg.A.x, aSeg.B.x);
      const other_min_y = Math.min(aSeg.A.y, aSeg.B.y);
      const other_max_y = Math.max(aSeg.A.y, aSeg.B.y);

      if (
        this_max_x < other_min_x ||
        other_max_x < this_min_x ||
        this_max_y < other_min_y ||
        other_max_y < this_min_y
      ) {
        return false;
      }
    }

    // Calculate direction vectors and offset vector using VECTOR2 operations
    // Using parametric form: P₁ = A + t*dir1, P₂ = aSeg.A + s*dir2
    const dir1x = big(this.B.x) - big(this.A.x); // direction vector e
    const dir1y = big(this.B.y) - big(this.A.y);
    const dir2x = big(aSeg.B.x) - big(aSeg.A.x); // direction vector f
    const dir2y = big(aSeg.B.y) - big(aSeg.A.y);
    const offsetx = big(aSeg.A.x) - big(this.A.x); // offset vector ac
    const offsety = big(aSeg.A.y) - big(this.A.y);

    const determinant = bigCross(dir2x, dir2y, dir1x, dir1y);

    // Handle parallel/collinear case
    if (determinant === 0n) {
      // Check if lines are collinear (not just parallel) using cross product
      // Lines are collinear if offset vector is also parallel to direction vector
      const collinear_test = bigCross(dir1x, dir1y, offsetx, offsety);

      if (collinear_test !== 0n) return false; // Parallel but not collinear

      // Lines are collinear - for infinite lines, they always intersect
      if (aLines) {
        // For infinite collinear lines, intersection point is ambiguous
        // Use the midpoint between the two segment start points as a reasonable choice
        if (aPt) {
          if (samePoint(aSeg.A, aSeg.B)) {
            // If aSeg is degenerate (point), use its start point
            aPt.x = aSeg.A.x;
            aPt.y = aSeg.A.y;
          } else if (samePoint(this.A, this.B)) {
            // If this segment is degenerate (point), use its start point
            aPt.x = this.A.x;
            aPt.y = this.A.y;
          } else {
            const midpoint = divideI({ x: this.A.x + aSeg.A.x, y: this.A.y + aSeg.A.y }, 2);
            aPt.x = midpoint.x;
            aPt.y = midpoint.y;
          }
        }

        return true;
      }

      // For segments, check overlap using the axis with larger coordinate range
      const use_x_axis = absB(dir1x) >= absB(dir1y);
      return this.checkCollinearOverlap(aSeg, use_x_axis, aIgnoreEndpoints, aPt);
    }

    // param2_num = f × ac (parameter for second segment: s = p/d)
    // param1_num = e × ac (parameter for first segment: t = q/d)
    const param2_num = bigCross(dir2x, dir2y, offsetx, offsety);
    const param1_num = bigCross(dir1x, dir1y, offsetx, offsety);

    // For segments (not infinite lines), check if intersection is within both segments
    if (!aLines) {
      // Parameters must be in [0,1] for intersection within segments
      // Since we're comparing t = q/d and s = p/d to [0,1], we need to handle sign of d
      if (determinant > 0n) {
        // d > 0: check 0 ≤ q ≤ d and 0 ≤ p ≤ d
        if (
          param1_num < 0n ||
          param1_num > determinant ||
          param2_num < 0n ||
          param2_num > determinant
        )
          return false;
      } else {
        // d < 0: check d ≤ q ≤ 0 and d ≤ p ≤ 0
        if (
          param1_num > 0n ||
          param1_num < determinant ||
          param2_num > 0n ||
          param2_num < determinant
        )
          return false;
      }

      // Optionally exclude endpoint intersections (when segments share vertices)
      if (
        aIgnoreEndpoints &&
        (param1_num === 0n || param1_num === determinant) &&
        (param2_num === 0n || param2_num === determinant)
      ) {
        return false;
      }
    }

    if (aPt) {
      // Use parametric equation: intersection = aSeg.A + (q/d) * f
      const resultx = big(aSeg.A.x) + rescale64(param1_num, dir2x, determinant);
      const resulty = big(aSeg.A.y) + rescale64(param1_num, dir2y, determinant);

      // Verify result fits in coordinate type range
      if (
        resultx > COORD_MAX ||
        resultx < COORD_MIN ||
        resulty > COORD_MAX ||
        resulty < COORD_MIN
      ) {
        return false; // Intersection exists but coordinates overflow
      }

      aPt.x = num(resultx);
      aPt.y = num(resulty);
    }

    return true;
  }
}

const samePoint = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

/** `VECTOR2I::operator<`: by x, then y. */
const lessPoint = (p: Vec2, q: Vec2): boolean => (p.x === q.x ? p.y < q.y : p.x < q.x);

/** `( p - q ).SquaredEuclideanNorm()` in `ecoord`, back as a number. */
function squaredDistance(p: Vec2, q: Vec2): number {
  const dx = big(p.x) - big(q.x);
  const dy = big(p.y) - big(q.y);
  return num(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// The `{ a, b }`-record functions: delegates onto SEG, kept only until their
// callers move onto the class. Each is `new SEG( s.a, s.b ).Method( ... )`
// and nothing else; do not add a body here.

const S = (s: Seg): SEG => new SEG(s.a, s.b);

/** @deprecated use `SEG.ApproxCollinear` */
export function segApproxCollinear(
  aA: VECTOR2I,
  aB: VECTOR2I,
  bA: VECTOR2I,
  bB: VECTOR2I,
  aDistanceThreshold = 1,
): boolean {
  return new SEG(aA, aB).ApproxCollinear(new SEG(bA, bB), aDistanceThreshold);
}
/** @deprecated use `SEG.LineProject` */
export const segLineProject = (aSeg: Seg, aP: Vec2): Vec2 => S(aSeg).LineProject(aP);
/** @deprecated use `SEG.ApproxParallel` */
export const segApproxParallel = (aA: Seg, aB: Seg, aDistanceThreshold = 1): boolean =>
  S(aA).ApproxParallel(S(aB), aDistanceThreshold);
/** @deprecated use `SEG.LineDistance` */
export const segLineDistance = (aSeg: Seg, aP: Vec2, aDetermineSide = false): number =>
  S(aSeg).LineDistance(aP, aDetermineSide);
/** @deprecated use `SEG.Center` */
export const segCenter = (aSeg: Seg): Vec2 => S(aSeg).Center();
/** @deprecated use `SEG.ParallelSeg` */
export const segParallelSeg = (aSeg: Seg, aP: Vec2): Seg => {
  const s = S(aSeg).ParallelSeg(aP);
  return { a: s.A, b: s.B };
};
/** @deprecated use `SEG.PerpendicularSeg` */
export const segPerpendicularSeg = (aSeg: Seg, aP: Vec2): Seg => {
  const s = S(aSeg).PerpendicularSeg(aP);
  return { a: s.A, b: s.B };
};
/** @deprecated use `SEG.Intersect` */
export const segIntersect = (
  aSeg: Seg,
  aOther: Seg,
  aIgnoreEndpoints = false,
  aLines = false,
): Vec2 | null => S(aSeg).Intersect(S(aOther), aIgnoreEndpoints, aLines) ?? null;
/** @deprecated use `SEG.Intersects` */
export const segIntersects = (aSeg: Seg, aOther: Seg): boolean => S(aSeg).Intersects(S(aOther));
/** @deprecated use `SEG.IntersectLines` */
export const segIntersectLines = (aSeg: Seg, aOther: Seg): Vec2 | null =>
  S(aSeg).IntersectLines(S(aOther)) ?? null;
/** @deprecated use `SEG.Collinear` */
export const segCollinear = (aSeg: Seg, aOther: Seg): boolean => S(aSeg).Collinear(S(aOther));
/** @deprecated use `SEG.NearestPoint` */
export const segNearestPoint = (aSeg: Seg, aP: Vec2): Vec2 => S(aSeg).NearestPoint(aP);
/** @deprecated use `SEG.SquaredDistance` */
export const segSquaredDistanceToPoint = (aSeg: Seg, aP: Vec2): number =>
  S(aSeg).SquaredDistance(aP);
/** @deprecated use `SEG.Distance` */
export const segDistanceToPoint = (aSeg: Seg, aP: Vec2): number => S(aSeg).Distance(aP);
/** @deprecated use `SEG.Contains` */
export const segContains = (aSeg: Seg, aP: Vec2): boolean => S(aSeg).Contains(aP);
/** @deprecated use `SEG.SquaredDistance` */
export const segSquaredDistanceToSeg = (aSeg: Seg, aOther: Seg): number =>
  S(aSeg).SquaredDistance(S(aOther));
/** @deprecated use `SEG.Distance` */
export const segDistance = (aSeg: Seg, aOther: Seg): number => S(aSeg).Distance(S(aOther));
/** @deprecated use `SEG.NearestPoint` */
export const segNearestPointToSeg = (aSeg: Seg, aOther: Seg): Vec2 =>
  S(aSeg).NearestPoint(S(aOther));
/** @deprecated use `SEG.Collide` */
export function segCollide(
  aSeg: Seg,
  aOther: Seg,
  aClearance: number,
): { collides: boolean; actual: number } {
  const actual = { value: 0 };
  const collides = S(aSeg).Collide(S(aOther), aClearance, actual);
  return { collides, actual: actual.value };
}

// ---------------------------------------------------------------------------
// SHAPE_LINE_CHAIN queries over a bare point ring. These belong to
// SHAPE_LINE_CHAIN and move there when it lands.

/** One crossing found by {@link chainIntersect}. */
export interface Intersection {
  /** The crossing point. */
  p: VECTOR2I;
  /** Index of the chain segment that was crossed. */
  indexOur: number;
}

/**
 * SHAPE_LINE_CHAIN::Intersect( const SEG&, INTERSECTIONS& ) over a closed chain.
 *
 * Results come back sorted by distance from `segA`, which is what lets the
 * caller take `pts[0]` as "where the track first enters the pad".
 */
export function chainIntersect(
  chain: readonly VECTOR2I[],
  segA: VECTOR2I,
  segB: VECTOR2I,
): Intersection[] {
  const out: Intersection[] = [];
  const n = chain.length;

  const segMinX = Math.min(segA.x, segB.x);
  const segMaxX = Math.max(segA.x, segB.x);
  const segMinY = Math.min(segA.y, segB.y);
  const segMaxY = Math.max(segA.y, segB.y);
  const seg = new SEG(segA, segB);

  for (let s = 0; s < n; s++) {
    const ptA = chain[s]!;
    const ptB = chain[s + 1 < n ? s + 1 : 0]!;

    if (
      Math.max(ptA.x, ptB.x) < segMinX ||
      Math.min(ptA.x, ptB.x) > segMaxX ||
      Math.max(ptA.y, ptB.y) < segMinY ||
      Math.min(ptA.y, ptB.y) > segMaxY
    ) {
      continue;
    }

    const p = new SEG(ptA, ptB).Intersect(seg);

    if (p) out.push({ p, indexOur: s });
  }

  out.sort(
    (a, b) =>
      Math.hypot(a.p.x - segA.x, a.p.y - segA.y) - Math.hypot(b.p.x - segA.x, b.p.y - segA.y),
  );

  return out;
}

/** Crossings of a closed chain against a polyline, in polyline order. */
export function chainIntersectChain(
  chain: readonly VECTOR2I[],
  poly: readonly VECTOR2I[],
): Intersection[] {
  const out: Intersection[] = [];

  for (let ii = 0; ii + 1 < poly.length; ii++) {
    for (const hit of chainIntersect(chain, poly[ii]!, poly[ii + 1]!)) out.push(hit);
  }

  return out;
}

/**
 * SHAPE_LINE_CHAIN::Area.
 *
 * `aAbsolute` defaults to true, as upstream's declaration does - and it matters:
 * the teardrop anchor search picks between two candidate corner assignments by
 * comparing areas, and the correct assignment is the one that encloses more
 * regardless of winding. Comparing signed areas there picks the self-crossing
 * bowtie, whose partial cancellation leaves it *algebraically* larger.
 */
export function chainArea(points: readonly VECTOR2I[], absolute = true): number {
  let area = 0.0;
  const size = points.length;

  for (let i = 0, j = size - 1; i < size; ++i) {
    area += (points[j]!.x + points[i]!.x) * (points[j]!.y - points[i]!.y);
    j = i;
  }

  // Negative when the points run anti-clockwise.
  return absolute ? Math.abs(area * 0.5) : -area * 0.5;
}
