// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CIRCLE` (`libs/kimath/include/geometry/circle.h`, `src/geometry/circle.cpp`):
 * a centre and an integer radius, public members as upstream has them.
 *
 * The `circle*` functions at the bottom are one-line delegates over the
 * `{ c, r }` record the older callers pass; the class is the implementation.
 */

import { KiROUND } from '../math/util.js';
import { EuclideanNormI, ResizeI, type Vec2, type VECTOR2I } from '../math/vector2.js';
import { CalcArcMid, RotatePoint } from '../trigo.js';
import { EDA_ANGLE } from './eda_angle.js';
import type { Seg } from './corner_operations.js';
import { SEG } from './seg.js';

/** `SHAPE::MIN_PRECISION_IU`. */
const MIN_PRECISION_IU = 4;

const sub = (a: Vec2, b: Vec2): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** `( a - b ).SquaredEuclideanNorm()` in `int64`, exact. */
const squaredDistance = (a: Vec2, b: Vec2): bigint => {
  const dx = BigInt(KiROUND(a.x)) - BigInt(KiROUND(b.x));
  const dy = BigInt(KiROUND(a.y)) - BigInt(KiROUND(b.y));
  return dx * dx + dy * dy;
};

/** `VECTOR2L( v ).EuclideanNorm()`: the int64 instantiation, `KiROUND( hypot )`. */
const norm64 = (v: Vec2): number => EuclideanNormI(v);

export class CIRCLE {
  Radius: number; ///< Public to make access simpler
  Center: VECTOR2I; ///< Public to make access simpler

  constructor();
  constructor(aCenter: Vec2, aRadius: number);
  constructor(aOther: CIRCLE);
  constructor(a?: Vec2 | CIRCLE, aRadius?: number) {
    if (a === undefined) {
      this.Center = { x: 0, y: 0 };
      this.Radius = 0;
    } else if (a instanceof CIRCLE) {
      this.Center = { x: a.Center.x, y: a.Center.y };
      this.Radius = a.Radius;
    } else {
      this.Center = { x: a.x, y: a.y };
      // `int aRadius`: a double (SHAPE_ARC::GetRadius()) truncates on the way in
      this.Radius = Math.trunc(aRadius as number);
    }
  }

  /** `operator==`. */
  equals(aOther: CIRCLE): boolean {
    return this.Radius === aOther.Radius && samePoint(this.Center, aOther.Center);
  }

  /**
   * Construct this circle such that it is tangent to the given segments and passes through the
   * given point, generating the solution which can be used to fillet both segments.
   *
   * The caller is responsible for ensuring it is possible to construct a circle from the
   * given parameters.
   *
   * @param aLineA is the first tangent line. Treated as an infinite line except for the
   *               purpose of selecting the solution to return.
   * @param aLineB is the second tangent line. Treated as an infinite line except for the
   *               purpose of selecting the solution to return.
   * @param aP is the point to pass through.
   * @return this circle.
   */
  ConstructFromTanTanPt(aLineA: SEG, aLineB: SEG, aP: Vec2): this {
    //fixme: There might be more efficient / accurate solution than using geometrical constructs

    let anglebisector: SEG;
    let intersectPoint: VECTOR2I = { x: 0, y: 0 };

    // A tie ( `>` ) goes to the second argument here and ( `<=` ) to the first
    // below; deliberately not mirrors of each other, as upstream writes them.
    const furthestFromIntersect = (aPt1: VECTOR2I, aPt2: VECTOR2I): VECTOR2I =>
      norm64(sub(aPt1, intersectPoint)) > norm64(sub(aPt2, intersectPoint)) ? aPt1 : aPt2;

    const closestToIntersect = (aPt1: VECTOR2I, aPt2: VECTOR2I): VECTOR2I =>
      norm64(sub(aPt1, intersectPoint)) <= norm64(sub(aPt2, intersectPoint)) ? aPt1 : aPt2;

    if (aLineA.ApproxParallel(aLineB)) {
      // Special case, no intersection point between the two lines
      // The center will be in the line equidistant between the two given lines
      // The radius will be half the distance between the two lines
      // The possible centers can be found by intersection

      const perpendicularAtoB = new SEG(aLineA.A, aLineB.LineProject(aLineA.A));
      const midPt = perpendicularAtoB.Center();

      this.Radius = norm64(sub(midPt, aLineA.A));

      anglebisector = aLineA.ParallelSeg(midPt);

      this.Center = { x: aP.x, y: aP.y }; // use this circle as a construction to find the actual centers
      const possibleCenters = this.IntersectLine(anglebisector);

      if (possibleCenters.length === 0) return this; // wxCHECK_MSG( ..., "No solutions exist!" )

      intersectPoint = { x: aLineA.A.x, y: aLineA.A.y }; // just for the purpose of deciding which solution to return

      // For the special case of the two segments being parallel, we will return the solution
      // whose center is closest to aLineA.A
      this.Center = closestToIntersect(
        possibleCenters[0]!,
        possibleCenters[possibleCenters.length - 1]!,
      );
    } else {
      // General case, using homothety.
      // All circles inscribed in the same angle are homothetic with center at the intersection
      // In this code, the prefix "h" denotes "the homothetic image"
      const intersectCalc = aLineA.IntersectLines(aLineB);

      if (!intersectCalc) return this; // "Lines do not intersect but are not parallel?"

      intersectPoint = intersectCalc;

      if (samePoint(aP, intersectPoint)) {
        //Special case: The point is at the intersection of the two lines
        this.Center = { x: aP.x, y: aP.y };
        this.Radius = 0;
        return this;
      }

      // Calculate bisector
      const lineApt = furthestFromIntersect(aLineA.A, aLineA.B);
      const lineBpt = furthestFromIntersect(aLineB.A, aLineB.B);
      const bisectorPt = CalcArcMid(lineApt, lineBpt, intersectPoint, true);

      anglebisector = new SEG(intersectPoint, bisectorPt);

      // Create an arbitrary circle that is tangent to both lines
      const hSolution = new CIRCLE();
      hSolution.Center = anglebisector.LineProject(aP);
      hSolution.Radius = aLineA.LineDistance(hSolution.Center);

      // Find the homothetic image of aP in the construction circle (hSolution)
      const throughaP = new SEG(intersectPoint, aP);
      const hProjections = hSolution.IntersectLine(throughaP);

      if (hProjections.length === 0) return this; // "No solutions exist!"

      // We want to create a fillet, so the projection of homothetic projection of aP
      // should be the one closest to the intersection
      const hSelected = closestToIntersect(
        hProjections[0]!,
        hProjections[hProjections.length - 1]!,
      );

      const hTanLineA = aLineA.LineProject(hSolution.Center);
      const hTanLineB = aLineB.LineProject(hSolution.Center);

      // To minimise errors, use the furthest away tangent point from aP
      if (squaredDistance(hTanLineA, aP) > squaredDistance(hTanLineB, aP)) {
        // Find the tangent at line A by homothetic inversion
        const hT = new SEG(hTanLineA, hSelected);
        const actTanA = hT.ParallelSeg(aP).IntersectLines(aLineA);

        if (!actTanA) return this; // "No solutions exist!"

        // Find circle center by perpendicular intersection with the angle bisector
        const perpendicularToTanA = aLineA.PerpendicularSeg(actTanA);
        const actCenter = perpendicularToTanA.IntersectLines(anglebisector);

        if (!actCenter) return this; // "No solutions exist!"

        this.Center = actCenter;
        this.Radius = aLineA.LineDistance(this.Center);
      } else {
        // Find the tangent at line B by inversion
        const hT = new SEG(hTanLineB, hSelected);
        const actTanB = hT.ParallelSeg(aP).IntersectLines(aLineB);

        if (!actTanB) return this; // "No solutions exist!"

        // Find circle center by perpendicular intersection with the angle bisector
        const perpendicularToTanB = aLineB.PerpendicularSeg(actTanB);
        const actCenter = perpendicularToTanB.IntersectLines(anglebisector);

        if (!actCenter) return this; // "No solutions exist!"

        this.Center = actCenter;
        this.Radius = aLineB.LineDistance(this.Center);
      }
    }

    return this;
  }

  /**
   * `Contains( const VECTOR2I& ) const`: on the circumference, within
   * `MIN_PRECISION_IU`.
   */
  Contains(aP: Vec2): boolean {
    const distance = norm64(sub(aP, this.Center));

    return distance <= this.Radius + MIN_PRECISION_IU && distance >= this.Radius - MIN_PRECISION_IU;
  }

  /** The non-const `Contains`: strictly inside. */
  ContainsInside(aP: Vec2): boolean {
    return EuclideanNormI(sub(aP, this.Center)) < this.Radius;
  }

  /**
   * Compute the point on the circumference of the circle that is the closest to aP.
   */
  NearestPoint(aP: Vec2): VECTOR2I {
    const vec = {
      x: KiROUND(aP.x) - KiROUND(this.Center.x),
      y: KiROUND(aP.y) - KiROUND(this.Center.y),
    };

    // Handle special case where aP is equal to this circle's center
    if (vec.x === 0 && vec.y === 0) vec.x = 1; // Arbitrary, to ensure the return value is always on the circumference

    return add(ResizeI(vec, this.Radius), this.Center);
  }

  /**
   * `NearestPoint( const VECTOR2D& )`: the double instantiation, no rounding.
   */
  NearestPointD(aP: Vec2): Vec2 {
    const vec = { x: aP.x - this.Center.x, y: aP.y - this.Center.y };

    if (vec.x === 0 && vec.y === 0) vec.x = 1;

    // VECTOR2D::Resize: `v * ( aNewLength / |v| )`
    const l = Math.hypot(vec.x, vec.y);
    const s = this.Radius / l;
    return { x: vec.x * s + this.Center.x, y: vec.y * s + this.Center.y };
  }

  /**
   * Compute the point on the circumference of the circle that is the furthest from aP.
   */
  FurthestPoint(aP: Vec2): VECTOR2I {
    const vec = {
      x: KiROUND(this.Center.x) - KiROUND(aP.x),
      y: KiROUND(this.Center.y) - KiROUND(aP.y),
    };

    if (vec.x === 0 && vec.y === 0) vec.x = 1;

    return add(ResizeI(vec, this.Radius), this.Center);
  }

  /**
   * Compute the intersection points between this circle and aCircle.
   *
   * @return std::vector containing the intersection points (0, 1 or 2 points)
   */
  Intersect(aCircle: CIRCLE): VECTOR2I[];
  /**
   * Compute the intersection points between this circle and aSeg.
   */
  Intersect(aSeg: SEG): VECTOR2I[];
  Intersect(a: CIRCLE | SEG): VECTOR2I[] {
    if (a instanceof SEG) {
      const retval: VECTOR2I[] = [];

      for (const intersection of this.IntersectLine(a)) {
        if (a.Contains(intersection)) retval.push(intersection);
      }

      return retval;
    }

    // From https://mathworld.wolfram.com/Circle-CircleIntersection.html
    //
    // Simplify the problem:
    // Let this circle be centered at (0,0), with radius r1
    // Let aCircle be centered at (d, 0), with radius r2
    // (i.e. d is the distance between the two circle centers)
    //
    // The equations of the two circles are
    // (1)   x^2 + y^2 = r1^2
    // (2)   (x - d)^2 + y^2 = r2^2
    //
    // Combining (1) into (2):
    //       (x - d)^2 + r1^2 - x^2 = r2^2
    // Expanding:
    //       x^2 - 2*d*x + d^2 + r1^2 - x^2 = r2^2
    // Rearranging for x:
    // (3)   x = (d^2 + r1^2 - r2^2) / (2 * d)
    //
    // Rearranging (1) gives:
    // (4)   y = sqrt(r1^2 - x^2)

    const retval: VECTOR2I[] = [];

    const vecCtoC = sub(a.Center, this.Center);
    const d = BigInt(norm64(vecCtoC));
    const r1 = BigInt(this.Radius);
    const r2 = BigInt(a.Radius);

    const absDiff = r1 - r2 < 0n ? r2 - r1 : r1 - r2;

    if (d > r1 + r2 || d < absDiff) return retval; //circles do not intersect

    if (d === 0n) return retval; // circles are co-centered. Don't return intersection points

    // Equation (3)
    const x = (d * d + r1 * r1 - r2 * r2) / (2n * d);

    const r1sqMinusXsq = r1 * r1 - x * x;

    if (r1sqMinusXsq < 0n) return retval; //circles do not intersect

    // Equation (4)
    const y = KiROUND(Math.sqrt(Number(r1sqMinusXsq)));

    // Now correct back to original coordinates
    const rotAngle = EDA_ANGLE.fromVector(vecCtoC);
    const solution1 = RotatePoint({ x: Number(x), y }, rotAngle.negate());
    retval.push(add(solution1, this.Center));

    if (y !== 0) {
      const solution2 = RotatePoint({ x: Number(x), y: -y }, rotAngle.negate());
      retval.push(add(solution2, this.Center));
    }

    return retval;
  }

  /**
   * Compute the intersection points between this circle and aLine.
   *
   * @param aLine is the line to intersect with this circle (end points ignored)
   * @return std::vector containing the intersection points (0, 1 or 2 points)
   */
  IntersectLine(aLine: SEG): VECTOR2I[] {
    const retval: VECTOR2I[] = [];

    //
    //           .   *   .
    //         *           *
    //  -----1-------m-------2----
    //      *                 *
    //     *         O         *
    //     *                   *
    //      *                 *
    //       *               *
    //         *           *
    //           '   *   '
    // Let O be the center of this circle, 1 and 2 the intersection points of the line
    // and M be the center of the chord connecting points 1 and 2
    //
    // M will be O projected perpendicularly to the line since a chord is always perpendicular
    // to the radius.
    //
    // The distance M1 = M2 can be computed by pythagoras since O1 = O2 = Radius
    //
    // M1= M2 = sqrt( Radius^2 - OM^2)
    //
    const m = aLine.LineProject(this.Center); // O projected perpendicularly to the line
    const omDist = norm64(sub(m, this.Center));

    if (omDist > this.Radius + MIN_PRECISION_IU) {
      return retval; // does not intersect
    } else if (
      omDist <= this.Radius + MIN_PRECISION_IU &&
      omDist >= this.Radius - MIN_PRECISION_IU
    ) {
      retval.push(m);
      return retval; //tangent
    }

    const radiusSquared = BigInt(this.Radius) * BigInt(this.Radius);
    const omDistSquared = BigInt(omDist) * BigInt(omDist);

    const mTo1dist = Math.trunc(Math.sqrt(Number(radiusSquared - omDistSquared)));

    const mTo1vec = ResizeI(
      { x: KiROUND(aLine.B.x) - KiROUND(aLine.A.x), y: KiROUND(aLine.B.y) - KiROUND(aLine.A.y) },
      mTo1dist,
    );
    const mTo2vec = { x: -mTo1vec.x, y: -mTo1vec.y };

    retval.push(add(mTo1vec, m));
    retval.push(add(mTo2vec, m));

    return retval;
  }
}

// ---------------------------------------------------------------------------
// The `{ c, r }`-record functions: delegates onto CIRCLE, kept only until
// their callers move onto the class.

/** @deprecated use `CIRCLE` */
export interface Circle {
  c: Vec2;
  r: number;
}

const C = (c: Circle): CIRCLE => new CIRCLE(c.c, c.r);
const S = (s: Seg): SEG => new SEG(s.a, s.b);

/** @deprecated use `CIRCLE.IntersectLine` */
export const circleIntersectLine = (aCircle: Circle, aLine: Seg): Vec2[] =>
  C(aCircle).IntersectLine(S(aLine));
/** @deprecated use `CIRCLE.NearestPoint` */
export const circleNearestPoint = (aCircle: Circle, aP: Vec2): Vec2 => C(aCircle).NearestPoint(aP);
/** @deprecated use `CIRCLE.ConstructFromTanTanPt` */
export function constructFromTanTanPt(aLineA: Seg, aLineB: Seg, aP: Vec2): Circle {
  const c = new CIRCLE().ConstructFromTanTanPt(S(aLineA), S(aLineB), aP);
  return { c: c.Center, r: c.Radius };
}
