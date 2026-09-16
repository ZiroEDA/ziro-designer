// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_BASE`, `SHAPE` and `SHAPE_LINE_CHAIN_BASE` (`geometry/shape.h`,
 * `src/geometry/shape.cpp`, the `SHAPE_LINE_CHAIN_BASE` bodies in
 * `shape_line_chain.cpp`): the abstract geometry every collision, distance
 * and polygonisation query is written against.
 *
 * ## Output parameters
 *
 * The C++ hands `int* aActual` and `VECTOR2I* aLocation` around and writes
 * through them when non-null. Here `aActual` is `{ value: number }` and
 * `aLocation` a mutable `VECTOR2I`, both optional; a method writes into them
 * exactly where the C++ dereferences the pointer, and their presence carries
 * the same meaning ("the caller wants this"), which several algorithms use to
 * decide when they may stop early.
 *
 * The `SHAPE`-vs-`SHAPE` `Collide` dispatch lives in `shape_collisions.ts`,
 * `NearestPoints` in `shape_nearest_points.ts`, as upstream splits them.
 */

import { ECOORD_MAX, type Vec2, type VECTOR2I } from '../math/vector2.js';
import type { EDA_ANGLE } from './eda_angle.js';
import type { ERROR_LOC } from '../convert_basic_shapes_to_polygon.js';
import { BOX2I } from '../math/box2.js';
import { SEG } from './seg.js';
import type { SHAPE_POLY_SET } from './shape_poly_set.js';
import { INT_MAX, rescale64 } from '../math/util.js';

/**
 * The three things the base class calls that live in modules which define
 * (or import every) subclass: `shape_collisions.ts`, `shape_nearest_points.ts`
 * and `shape_poly_set.ts`. Importing them here would evaluate the subclass
 * modules before `SHAPE` exists (`class X extends SHAPE` on an undefined
 * binding), so each registers itself when it loads and every concrete shape
 * module imports all three.
 */
export const SHAPE_HOOKS: {
  collideShapes?: (
    aA: SHAPE,
    aB: SHAPE,
    aClearance: number,
    aActual?: OutInt,
    aLocation?: VECTOR2I,
    aMTV?: VECTOR2I,
  ) => boolean;
  nearestPointsShapes?: (aA: SHAPE, aB: SHAPE, aPtA: VECTOR2I, aPtB: VECTOR2I) => boolean;
  newPolySet?: () => SHAPE_POLY_SET;
} = {};

export enum SHAPE_TYPE {
  SH_RECT = 0, ///< axis-aligned rectangle
  SH_SEGMENT, ///< line segment
  SH_LINE_CHAIN, ///< line chain (polyline)
  SH_CIRCLE, ///< circle
  SH_SIMPLE, ///< simple polygon
  SH_POLY_SET, ///< set of polygons (with holes, etc.)
  SH_COMPOUND, ///< compound shape, consisting of multiple simple shapes
  SH_ARC, ///< circular arc
  SH_NULL, ///< empty shape (no shape...),
  SH_POLY_SET_TRIANGLE, ///< a single triangle belonging to a POLY_SET triangulation
}

export const {
  SH_RECT,
  SH_SEGMENT,
  SH_LINE_CHAIN,
  SH_CIRCLE,
  SH_SIMPLE,
  SH_POLY_SET,
  SH_COMPOUND,
  SH_ARC,
  SH_NULL,
  SH_POLY_SET_TRIANGLE,
} = SHAPE_TYPE;

export function SHAPE_TYPE_asString(a: SHAPE_TYPE): string {
  switch (a) {
    case SHAPE_TYPE.SH_RECT:
      return 'SH_RECT';
    case SHAPE_TYPE.SH_SEGMENT:
      return 'SH_SEGMENT';
    case SHAPE_TYPE.SH_LINE_CHAIN:
      return 'SH_LINE_CHAIN';
    case SHAPE_TYPE.SH_CIRCLE:
      return 'SH_CIRCLE';
    case SHAPE_TYPE.SH_SIMPLE:
      return 'SH_SIMPLE';
    case SHAPE_TYPE.SH_POLY_SET:
      return 'SH_POLY_SET';
    case SHAPE_TYPE.SH_COMPOUND:
      return 'SH_COMPOUND';
    case SHAPE_TYPE.SH_ARC:
      return 'SH_ARC';
    case SHAPE_TYPE.SH_NULL:
      return 'SH_NULL';
    case SHAPE_TYPE.SH_POLY_SET_TRIANGLE:
      return 'SH_POLY_SET_TRIANGLE';
  }

  return ''; // Just to quiet GCC.
}

/** `int* aActual`: an out-parameter for a distance. */
export interface OutInt {
  value: number;
}

/**
 * An abstract shape on 2D plane.
 */
export abstract class SHAPE_BASE {
  ///< type of our shape
  protected m_type: SHAPE_TYPE;

  constructor(aType: SHAPE_TYPE) {
    this.m_type = aType;
  }

  /**
   * Return the type of the shape.
   */
  Type(): SHAPE_TYPE {
    return this.m_type;
  }

  TypeName(): string {
    return SHAPE_TYPE_asString(this.m_type);
  }

  HasIndexableSubshapes(): boolean {
    return false;
  }

  GetIndexableSubshapeCount(): number {
    return 0;
  }

  GetIndexableSubshapes(aSubshapes: SHAPE[]): void {}
}

/**
 * An abstract shape on 2D plane.
 */
export abstract class SHAPE extends SHAPE_BASE {
  /**
   * This is the minimum precision for a shape in internal units.
   */
  static readonly MIN_PRECISION_IU = 4;

  /**
   * Return a dynamically allocated copy of the shape.
   */
  Clone(): SHAPE {
    throw new Error('SHAPE::Clone not implemented');
  }

  /**
   * Return the actual minimum distance between two shapes.
   */
  GetClearance(aOther: SHAPE): number {
    let actual_clearance = INT_MAX;
    const a_shapes: SHAPE[] = [];
    const b_shapes: SHAPE[] = [];

    /// POLY_SETs contain a bunch of polygons that are triangulated.
    /// But there are way more triangles than necessary for collision detection.
    /// Triangles check three vertices each but for the outline, we only need one.
    /// These are also fractured, so we don't need to worry about holes
    if (this.Type() === SHAPE_TYPE.SH_POLY_SET) {
      const polySet = this as unknown as SHAPE_POLY_SET;

      if (polySet.OutlineCount() > 0) a_shapes.push(polySet.COutline(0));
    } else {
      this.GetIndexableSubshapes(a_shapes);
    }

    if (aOther.Type() === SHAPE_TYPE.SH_POLY_SET) {
      const polySet = aOther as unknown as SHAPE_POLY_SET;

      if (polySet.OutlineCount() > 0) b_shapes.push(polySet.COutline(0));
    } else {
      aOther.GetIndexableSubshapes(b_shapes);
    }

    if (this.GetIndexableSubshapeCount() === 0) a_shapes.push(this);

    if (aOther.GetIndexableSubshapeCount() === 0) b_shapes.push(aOther);

    for (const a of a_shapes) {
      for (const b of b_shapes) {
        const temp_dist = { value: 0 };
        a.Collide(b, Math.trunc(INT_MAX / 2), temp_dist);

        if (temp_dist.value < actual_clearance) actual_clearance = temp_dist.value;
      }
    }

    return actual_clearance;
  }

  /**
   * Return true if the shape is a null shape.
   */
  IsNull(): boolean {
    return this.m_type === SHAPE_TYPE.SH_NULL;
  }

  /**
   * Check if the boundary of shape (this) lies closer to the point aP than aClearance,
   * indicating a collision.
   */
  Collide(aP: Vec2, aClearance?: number, aActual?: OutInt, aLocation?: VECTOR2I): boolean;
  /**
   * Check if the boundary of shape (this) lies closer to the shape aShape than aClearance,
   * indicating a collision.
   *
   * With `aMTV` (the third argument a mutable point and no `aActual`), the
   * minimum translation vector is written instead; that is the
   * `Collide( const SHAPE*, int, VECTOR2I* aMTV )` overload.
   */
  Collide(aShape: SHAPE, aClearance?: number, aActual?: OutInt, aLocation?: VECTOR2I): boolean;
  Collide(aShape: SHAPE, aClearance: number, aMTV: VECTOR2I): boolean;
  /**
   * Check if the boundary of shape (this) lies closer to the segment aSeg than aClearance,
   * indicating a collision.
   */
  Collide(aSeg: SEG, aClearance?: number, aActual?: OutInt, aLocation?: VECTOR2I): boolean;
  Collide(
    a: Vec2 | SHAPE | SEG,
    aClearance = 0,
    aActual?: OutInt | VECTOR2I,
    aLocation?: VECTOR2I,
  ): boolean {
    if (a instanceof SEG)
      return this.CollideSeg(a, aClearance, aActual as OutInt | undefined, aLocation);

    if (a instanceof SHAPE) {
      if (aActual !== undefined && !('value' in aActual))
        return this.CollideShapeMTV(a, aClearance, aActual);

      return this.CollideShape(a, aClearance, aActual as OutInt | undefined, aLocation);
    }

    return this.CollidePoint(a, aClearance, aActual as OutInt | undefined, aLocation);
  }

  /** `Collide( const VECTOR2I& aP, ... )`: the default is the degenerate segment. */
  CollidePoint(aP: Vec2, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    return this.CollideSeg(new SEG(aP, aP), aClearance, aActual, aLocation);
  }

  /** `Collide( const SHAPE* aShape, int aClearance, VECTOR2I* aMTV )`. */
  CollideShapeMTV(aShape: SHAPE, aClearance: number, aMTV: VECTOR2I): boolean {
    return SHAPE_HOOKS.collideShapes!(this, aShape, aClearance, undefined, undefined, aMTV);
  }

  /** `Collide( const SHAPE* aShape, int aClearance, int* aActual, VECTOR2I* aLocation )`. */
  CollideShape(aShape: SHAPE, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    return SHAPE_HOOKS.collideShapes!(this, aShape, aClearance, aActual, aLocation, undefined);
  }

  /** `Collide( const SEG& aSeg, ... )`: pure virtual. */
  abstract CollideSeg(
    aSeg: SEG,
    aClearance?: number,
    aActual?: OutInt,
    aLocation?: VECTOR2I,
  ): boolean;

  /**
   * Compute a bounding box of the shape, with a margin of aClearance a collision.
   */
  abstract BBox(aClearance?: number): BOX2I;

  /**
   * Compute a center-of-mass of the shape.
   */
  Centre(): VECTOR2I {
    return this.BBox(0).Centre(); // if nothing better is available....
  }

  /**
   * Returns the minimum distance from a given point to this shape.
   */
  Distance(aP: Vec2): number {
    return Math.trunc(Math.sqrt(this.SquaredDistance(aP, false)));
  }

  SquaredDistance(aP: Vec2, aOutlineOnly = false): number {
    const buffer = SHAPE_HOOKS.newPolySet!();
    this.TransformToPolygon(buffer, 0, 1 /* ERROR_INSIDE */);

    if (buffer.OutlineCount() < 1) return ECOORD_MAX;

    return buffer.COutline(0).SquaredDistance(aP, aOutlineOnly);
  }

  /**
   * Compute the nearest points between this shape and aOther.
   */
  NearestPoints(aOther: SHAPE, aPtThis: VECTOR2I, aPtOther: VECTOR2I): boolean {
    return SHAPE_HOOKS.nearestPointsShapes!(this, aOther, aPtThis, aPtOther);
  }

  /**
   * Check if point aP lies inside a closed shape.  Always false for open shapes.
   */
  PointInside(aPt: Vec2, aAccuracy = 0, aUseBBoxCache = false): boolean {
    const buffer = SHAPE_HOOKS.newPolySet!();
    this.TransformToPolygon(buffer, aAccuracy, 1 /* ERROR_INSIDE */);

    if (buffer.OutlineCount() < 1) return false;

    return buffer.COutline(0).PointInside(aPt, aAccuracy, aUseBBoxCache);
  }

  /**
   * Fills a SHAPE_POLY_SET with a polygon representation of this shape.
   */
  abstract TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void;

  abstract Rotate(aAngle: EDA_ANGLE, aCenter?: Vec2): void;

  GetStart(): VECTOR2I {
    return { x: 0, y: 0 };
  }
  GetEnd(): VECTOR2I {
    return { x: 0, y: 0 };
  }
  GetWidth(): number {
    return 0;
  }
  SetWidth(aWidth: number): void {}

  abstract Move(aVector: Vec2): void;

  abstract IsSolid(): boolean;

  Parse(aStream: string): boolean {
    throw new Error('SHAPE::Parse not implemented');
  }

  Format(aCplusPlus = true): string {
    return `shape ${this.m_type}`;
  }
}

export abstract class SHAPE_LINE_CHAIN_BASE extends SHAPE {
  /**
   * Check if point aP lies closer to us than aClearance.
   */
  override CollidePoint(aP: Vec2, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    if (this.IsClosed() && this.PointInside(aP, aClearance)) {
      if (aLocation) {
        aLocation.x = aP.x;
        aLocation.y = aP.y;
      }

      if (aActual) aActual.value = 0;

      return true;
    }

    let closest_dist_sq = ECOORD_MAX;
    const clearance_sq = aClearance * aClearance;
    let nearest: VECTOR2I = { x: 0, y: 0 };

    for (let i = 0; i < this.GetSegmentCount(); i++) {
      const s = this.GetSegment(i);
      const pn = s.NearestPoint(aP);

      const dist_sq = squaredNorm(pn.x - aP.x, pn.y - aP.y);

      if (dist_sq < closest_dist_sq) {
        nearest = pn;
        closest_dist_sq = dist_sq;

        if (closest_dist_sq === 0) break;

        // If we're not looking for aActual then any collision will do
        if (closest_dist_sq < clearance_sq && !aActual) break;
      }
    }

    if (closest_dist_sq === 0 || closest_dist_sq < clearance_sq) {
      if (aLocation) {
        aLocation.x = nearest.x;
        aLocation.y = nearest.y;
      }

      if (aActual) aActual.value = Math.trunc(Math.sqrt(closest_dist_sq));

      return true;
    }

    return false;
  }

  /**
   * Check if segment aSeg lies closer to us than aClearance.
   */
  CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    if (this.IsClosed() && this.PointInside(aSeg.A)) {
      if (aLocation) {
        aLocation.x = aSeg.A.x;
        aLocation.y = aSeg.A.y;
      }

      if (aActual) aActual.value = 0;

      return true;
    }

    let closest_dist_sq = ECOORD_MAX;
    const clearance_sq = aClearance * aClearance;
    let nearest: VECTOR2I = { x: 0, y: 0 };

    for (let i = 0; i < this.GetSegmentCount(); i++) {
      const s = this.GetSegment(i);
      const dist_sq = s.SquaredDistance(aSeg);

      if (dist_sq < closest_dist_sq) {
        if (aLocation) nearest = s.NearestPoint(aSeg);

        closest_dist_sq = dist_sq;

        if (closest_dist_sq === 0) break;

        // If we're not looking for aActual then any collision will do
        if (closest_dist_sq < clearance_sq && !aActual) break;
      }
    }

    if (closest_dist_sq === 0 || closest_dist_sq < clearance_sq) {
      if (aLocation) {
        aLocation.x = nearest.x;
        aLocation.y = nearest.y;
      }

      if (aActual) aActual.value = Math.trunc(Math.sqrt(closest_dist_sq));

      return true;
    }

    return false;
  }

  override SquaredDistance(aP: Vec2, aOutlineOnly = false): number {
    let d = ECOORD_MAX;

    if (this.IsClosed() && this.PointInside(aP) && !aOutlineOnly) return 0;

    for (let s = 0; s < this.GetSegmentCount(); s++)
      d = Math.min(d, this.GetSegment(s).SquaredDistance(aP));

    return d;
  }

  /**
   * Check if point aP lies inside a polygon (any type) defined by the line chain.
   * For closed shapes only.
   *
   * @param aPt point to check
   * @param aUseBBoxCache gives better performance if the bounding box caches have been
   *                      generated.
   * @return true if the point is inside the shape (edge is not treated as being inside).
   */
  override PointInside(aPt: Vec2, aAccuracy = 0, aUseBBoxCache = false): boolean {
    const cached = this.GetCachedBBox();

    if (aUseBBoxCache && cached && !cached.Contains(aPt)) return false;

    if (!this.IsClosed() || this.GetPointCount() < 3) return false;

    /*
     * To check for interior points, we draw a line in the positive x direction from
     * the point.  If it intersects an even number of segments, the point is outside the
     * line chain (it had to first enter and then exit).  Otherwise, it is inside the chain.
     *
     * Note: slope might be denormal here in the case of a horizontal line but we require our
     * y to move from above to below the point (or vice versa)
     *
     * Note: we open-code CPoint() here so that we don't end up calculating the size of the
     * vector number-of-points times.  This has a non-trivial impact on zone fill times.
     */
    const pointCount = this.GetPointCount();
    let inside = false;

    for (let i = 0; i < pointCount; ) {
      const p1 = this.GetPoint(i++);
      const p2 = this.GetPoint(i === pointCount ? 0 : i);
      const diffx = p2.x - p1.x;
      const diffy = p2.y - p1.y;

      if (diffy === 0) continue;

      const d = rescaleInt(diffx, aPt.y - p1.y, diffy);

      if (p1.y >= aPt.y !== p2.y >= aPt.y && aPt.x - p1.x < d) inside = !inside;
    }

    // If accuracy is <= 1 (nm) then we skip the accuracy test for performance.  Otherwise
    // we use "OnEdge(accuracy)" as a proxy for "Inside(accuracy)".
    if (aAccuracy <= 1) return inside;
    return inside || this.PointOnEdge(aPt, aAccuracy);
  }

  /**
   * Check if point aP lies on an edge or vertex of the line chain.
   */
  PointOnEdge(aP: Vec2, aAccuracy = 0): boolean {
    return this.EdgeContainingPoint(aP, aAccuracy) >= 0;
  }

  /**
   * Check if point aP lies on an edge or vertex of the line chain.
   *
   * @return index of the first edge containing the point, otherwise negative
   */
  EdgeContainingPoint(aP: Vec2, aAccuracy = 0): number {
    const threshold = aAccuracy + 1;
    const thresholdSq = threshold * threshold;
    const pointCount = this.GetPointCount();

    if (!pointCount) {
      return -1;
    } else if (pointCount === 1) {
      const p0 = this.GetPoint(0);
      const distSq = squaredNorm(p0.x - aP.x, p0.y - aP.y);
      return distSq <= thresholdSq ? 0 : -1;
    }

    const segCount = this.GetSegmentCount();

    for (let i = 0; i < segCount; i++) {
      const s = this.GetSegment(i);

      if ((s.A.x === aP.x && s.A.y === aP.y) || (s.B.x === aP.x && s.B.y === aP.y)) return i;

      if (s.SquaredDistance(aP) <= thresholdSq) return i;
    }

    return -1;
  }

  abstract GetPoint(aIndex: number): VECTOR2I;
  abstract GetSegment(aIndex: number): SEG;
  abstract GetPointCount(): number;
  abstract GetSegmentCount(): number;

  abstract IsClosed(): boolean;

  GetCachedBBox(): BOX2I | null {
    return null;
  }

  TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void {}
}

/** `( pn - aP ).SquaredEuclideanNorm()` in `ecoord`; exact in a double up to 2^53. */
function squaredNorm(dx: number, dy: number): number {
  return dx * dx + dy * dy;
}

/**
 * `rescale( int, int, int )` (`math/util.cpp`): `int64` product, the
 * half-away-from-zero correction by the sign of the PRODUCT, truncating
 * division - the same arithmetic as the int64 arm, so `rescale64` is it.
 */
function rescaleInt(numerator: number, value: number, denominator: number): number {
  const product = numerator * value;

  // A product below 2^53 (less the half-denominator headroom) is an exact
  // double, and a truncating division of exact integers below 2^53 rounds
  // to the C++ quotient: `Math.trunc` is the int64 `/`. Only a larger product
  // needs BigInt to be the int64 arithmetic.
  if (product > -RESCALE_EXACT_LIMIT && product < RESCALE_EXACT_LIMIT) {
    const half = Math.trunc(denominator / 2);
    return Math.trunc(
      (product < 0 !== denominator < 0 ? product - half : product + half) / denominator,
    );
  }

  return Number(rescale64(BigInt(numerator), BigInt(value), BigInt(denominator)));
}

// 2^53 less the largest |denominator / 2| an int can add.
const RESCALE_EXACT_LIMIT = 2 ** 53 - 2 ** 31;
