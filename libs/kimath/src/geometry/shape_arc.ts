// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_ARC` (`geometry/shape_arc.h`, `src/geometry/shape_arc.cpp`): an arc
 * as its start, mid and end points with a width; centre, radius and bounding
 * box are derived (`update_values`).
 */

import { ECOORD_MAX, EuclideanNormI, ResizeI, type Vec2, type VECTOR2I } from '../math/vector2.js';
import { INT_MAX, KiROUND } from '../math/util.js';
import { ANGLE_0, ANGLE_90, ANGLE_180, ANGLE_360, EDA_ANGLE } from './eda_angle.js';
import { FLIP_DIRECTION } from '../core/mirror.js';
import { BOX2I } from '../math/box2.js';
import { CalcArcCenterFromAngle, CalcArcCenterI, RotatePoint, RotatePointD } from '../trigo.js';
import { ARC_HIGH_DEF } from '../base_units.js';
import { CIRCLE } from './circle.js';
import { SEG } from './seg.js';
import { type OutInt, SHAPE, SHAPE_TYPE } from './shape.js';
// the base class dispatches through these; see SHAPE_HOOKS
import './shape_collisions.js';
import './shape_nearest_points.js';
import './shape_poly_set.js';
import { SHAPE_CIRCLE } from './shape_circle.js';
import { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import type { SHAPE_RECT } from './shape_rect.js';
import type { SHAPE_POLY_SET } from './shape_poly_set.js';
import { TransformArcToPolygon } from './shape_poly_set.js';
import type { ERROR_LOC } from '../convert_basic_shapes_to_polygon.js';
import { circleToEndSegmentDeltaRadius } from '../convert_basic_shapes_to_polygon.js';
import { getArcToSegmentCount } from './geometry_utils.js';

/** `int64_t& aDistSq` out-parameter. */
export interface OutDistSq {
  value: number;
}

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const sqDist = (a: Vec2, b: Vec2): number => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const copyInto = (dst: VECTOR2I, src: Vec2): void => {
  dst.x = src.x;
  dst.y = src.y;
};

export class SHAPE_ARC extends SHAPE {
  private m_start: VECTOR2I;
  private m_mid: VECTOR2I;
  private m_end: VECTOR2I;
  private m_width: number;

  private m_bbox: BOX2I; // Calculated value
  private m_center: VECTOR2I; // Calculated value
  private m_radius: number; // Calculated value

  constructor();
  /**
   * Construct and arc from center, start point, and a central angle.
   */
  constructor(aArcCenter: Vec2, aArcStartPoint: Vec2, aCenterAngle: EDA_ANGLE, aWidth?: number);
  /**
   * Construct an arc from three points.
   */
  constructor(aArcStart: Vec2, aArcMid: Vec2, aArcEnd: Vec2, aWidth: number);
  /**
   * Build a SHAPE_ARC which is tangent to two segments and a given radius.
   */
  constructor(aSegmentA: SEG, aSegmentB: SEG, aRadius: number, aWidth?: number);
  constructor(aOther: SHAPE_ARC, aWidth?: number);
  constructor(
    a?: Vec2 | SEG | SHAPE_ARC,
    b?: Vec2 | SEG | number,
    c?: EDA_ANGLE | Vec2 | number,
    d?: number,
  ) {
    super(SHAPE_TYPE.SH_ARC);
    this.m_start = { x: 0, y: 0 };
    this.m_mid = { x: 0, y: 0 };
    this.m_end = { x: 0, y: 0 };
    this.m_width = 0;
    this.m_bbox = new BOX2I();
    this.m_center = { x: 0, y: 0 };
    this.m_radius = 0;

    if (a === undefined) return;

    if (a instanceof SHAPE_ARC) {
      this.m_start = { x: a.m_start.x, y: a.m_start.y };
      this.m_end = { x: a.m_end.x, y: a.m_end.y };
      this.m_mid = { x: a.m_mid.x, y: a.m_mid.y };
      this.m_width = a.m_width;
      this.m_bbox = a.m_bbox.Clone();
      this.m_center = { x: a.m_center.x, y: a.m_center.y };
      this.m_radius = a.m_radius;

      if (typeof b === 'number') this.m_width = b;

      return;
    }

    if (a instanceof SEG) {
      this.constructTangent(a, b as SEG, c as number, d ?? 0);
      return;
    }

    if (c instanceof EDA_ANGLE) {
      // SHAPE_ARC( aArcCenter, aArcStartPoint, aCenterAngle, aWidth )
      const aArcCenter = a;
      const aArcStartPoint = b as Vec2;
      const aCenterAngle = c;
      this.m_width = d ?? 0;

      this.m_start = { x: aArcStartPoint.x, y: aArcStartPoint.y };

      const mid = RotatePointD(aArcStartPoint, aArcCenter, aCenterAngle.negate().divide(2.0));
      const end = RotatePointD(aArcStartPoint, aArcCenter, aCenterAngle.negate());

      this.m_mid = { x: KiROUND(mid.x), y: KiROUND(mid.y) };
      this.m_end = { x: KiROUND(end.x), y: KiROUND(end.y) };

      this.update_values();
      return;
    }

    // SHAPE_ARC( aArcStart, aArcMid, aArcEnd, aWidth )
    const aArcMid = b as Vec2;
    const aArcEnd = c as Vec2;
    this.m_start = { x: a.x, y: a.y };
    this.m_mid = { x: aArcMid.x, y: aArcMid.y };
    this.m_end = { x: aArcEnd.x, y: aArcEnd.y };
    this.m_width = d ?? 0;

    this.update_values();
  }

  private constructTangent(aSegmentA: SEG, aSegmentB: SEG, aRadius: number, aWidth: number): void {
    this.m_width = aWidth;

    /*
     * Construct a series of segments to represent the arc
     */
    const p = aSegmentA.Intersect(aSegmentB, true, true);

    if (!p || aSegmentA.Length() === 0 || aSegmentB.Length() === 0) {
      // Catch bugs in debug
      // wxASSERT_MSG( false, "The input segments do not intersect or one is zero length." );

      // Make a 180 degree arc around aSegmentA in case we end up here in release
      this.m_start = { x: aSegmentA.A.x, y: aSegmentA.A.y };
      this.m_end = { x: aSegmentA.B.x, y: aSegmentA.B.y };
      this.m_mid = { x: this.m_start.x, y: this.m_start.y };

      const arcCenter = aSegmentA.Center();
      this.m_mid = RotatePoint(this.m_mid, arcCenter, ANGLE_90); // mid point at 90 degrees
    } else {
      let pToA = { x: aSegmentA.B.x - p.x, y: aSegmentA.B.y - p.y };
      let pToB = { x: aSegmentB.B.x - p.x, y: aSegmentB.B.y - p.y };

      if (EuclideanNormI(pToA) === 0) pToA = { x: aSegmentA.A.x - p.x, y: aSegmentA.A.y - p.y };

      if (EuclideanNormI(pToB) === 0) pToB = { x: aSegmentB.A.x - p.x, y: aSegmentB.A.y - p.y };

      const pToAangle = EDA_ANGLE.fromVector(pToA);
      const pToBangle = EDA_ANGLE.fromVector(pToB);

      const alpha = pToAangle.sub(pToBangle).Normalize180();

      const distPC = aRadius / Math.abs(Math.sin(alpha.AsRadians() / 2));
      const angPC = pToAangle.sub(alpha.divide(2));

      const arcCenter = {
        x: p.x + KiROUND(distPC * angPC.Cos()),
        y: p.y + KiROUND(distPC * angPC.Sin()),
      };

      // The end points of the arc are the orthogonal projected lines from the line segments
      // to the center of the arc
      this.m_start = aSegmentA.LineProject(arcCenter);
      this.m_end = aSegmentB.LineProject(arcCenter);

      //The mid point is rotated start point around center, half the angle of the arc.
      const startVector = { x: this.m_start.x - arcCenter.x, y: this.m_start.y - arcCenter.y };
      const endVector = { x: this.m_end.x - arcCenter.x, y: this.m_end.y - arcCenter.y };

      const startAngle = EDA_ANGLE.fromVector(startVector);
      const endAngle = EDA_ANGLE.fromVector(endVector);
      const midPointRotAngle = startAngle.sub(endAngle).Normalize180().divide(2);

      this.m_mid = RotatePoint(this.m_start, arcCenter, midPointRotAngle);
    }

    this.update_values();
  }

  override Clone(): SHAPE {
    return new SHAPE_ARC(this);
  }

  /**
   * Construct this arc from the given start, end and angle.
   *
   * @param aStart is the arc starting point
   * @param aEnd is the arc endpoint
   * @param aAngle is the arc included angle
   * @param aWidth is the arc line thickness
   * @return *this
   */
  ConstructFromStartEndAngle(aStart: Vec2, aEnd: Vec2, aAngle: EDA_ANGLE, aWidth = 0): this {
    this.m_start = { x: aStart.x, y: aStart.y };
    this.m_mid = { x: aStart.x, y: aStart.y };
    this.m_end = { x: aEnd.x, y: aEnd.y };
    this.m_width = aWidth;

    const dc = CalcArcCenterFromAngle(aStart, aEnd, aAngle);
    const center: VECTOR2I = { x: KiROUND(dc.x), y: KiROUND(dc.y) };

    this.m_mid = RotatePoint(this.m_mid, center, aAngle.negate().divide(2.0));

    this.update_values();

    return this;
  }

  /**
   * Constructs this arc from the given start, end and center.
   *
   * @param aStart is the arc starting point
   * @param aEnd is the arc endpoint
   * @param aCenter is the arc center
   * @param aClockwise determines which of the two solutions to construct
   * @param aWidth is the arc line thickness
   * @return *this
   */
  ConstructFromStartEndCenter(
    aStart: Vec2,
    aEnd: Vec2,
    aCenter: Vec2,
    aClockwise = false,
    aWidth = 0,
  ): this {
    const startLine = { x: aStart.x - aCenter.x, y: aStart.y - aCenter.y };
    const endLine = { x: aEnd.x - aCenter.x, y: aEnd.y - aCenter.y };

    const startAngle = EDA_ANGLE.fromVector(startLine);
    const endAngle = EDA_ANGLE.fromVector(endLine);

    startAngle.Normalize();
    endAngle.Normalize();

    let angle = endAngle.sub(startAngle);

    if (aClockwise) angle = angle.Normalize().sub(ANGLE_360);
    else angle = angle.Normalize();

    this.m_start = { x: aStart.x, y: aStart.y };
    this.m_end = { x: aEnd.x, y: aEnd.y };
    this.m_mid = { x: aStart.x, y: aStart.y };
    this.m_width = aWidth;

    this.m_mid = RotatePoint(this.m_mid, aCenter, angle.negate().divide(2.0));

    this.update_values();

    return this;
  }

  GetP0(): VECTOR2I {
    return this.m_start;
  }
  GetP1(): VECTOR2I {
    return this.m_end;
  }
  GetArcMid(): VECTOR2I {
    return this.m_mid;
  }
  GetCenter(): VECTOR2I {
    return this.m_center;
  }

  BBox(aClearance = 0): BOX2I {
    const bbox = this.m_bbox.Clone();

    if (this.m_width !== 0) bbox.Inflate(KiROUND(this.m_width / 2.0) + 1);

    if (aClearance !== 0) bbox.Inflate(aClearance);

    return bbox;
  }

  /**
   * Compute closest points between this arc and another shape.
   */
  NearestPoint(aP: Vec2): VECTOR2I {
    const s_epsilon = 8;

    const fullCircle = new CIRCLE(this.GetCenter(), this.GetRadius());
    const nearestPt = fullCircle.NearestPoint(aP);

    if (sqDist(nearestPt, this.m_start) <= s_epsilon) return this.m_start;

    if (sqDist(nearestPt, this.m_end) <= s_epsilon) return this.m_end;

    if (this.sliceContainsPoint(nearestPt)) return nearestPt;

    if (sqDist(aP, this.m_start) <= sqDist(aP, this.m_end)) return this.m_start;
    return this.m_end;
  }

  // The C++ overloads hide SHAPE::NearestPoints( const SHAPE* ); TS keeps the
  // base form reachable as the three-argument call.
  override NearestPoints(aOther: SHAPE, aPtThis: VECTOR2I, aPtOther: VECTOR2I): boolean;
  override NearestPoints(
    aArc: SHAPE_ARC,
    aPtA: VECTOR2I,
    aPtB: VECTOR2I,
    aDistSq: OutDistSq,
  ): boolean;
  override NearestPoints(
    aCircle: SHAPE_CIRCLE,
    aPtA: VECTOR2I,
    aPtB: VECTOR2I,
    aDistSq: OutDistSq,
  ): boolean;
  override NearestPoints(aSeg: SEG, aPtA: VECTOR2I, aPtB: VECTOR2I, aDistSq: OutDistSq): boolean;
  override NearestPoints(
    aRect: SHAPE_RECT,
    aPtA: VECTOR2I,
    aPtB: VECTOR2I,
    aDistSq: OutDistSq,
  ): boolean;
  override NearestPoints(
    a: SHAPE | SEG,
    aPtA: VECTOR2I,
    aPtB: VECTOR2I,
    aDistSq?: OutDistSq,
  ): boolean {
    if (aDistSq === undefined) return super.NearestPoints(a as SHAPE, aPtA, aPtB);
    if (a instanceof SHAPE_ARC) return this.nearestPointsArc(a, aPtA, aPtB, aDistSq);
    if (a instanceof SHAPE_CIRCLE) return this.nearestPointsCircle(a, aPtA, aPtB, aDistSq);
    if (a instanceof SEG) return this.nearestPointsSeg(a, aPtA, aPtB, aDistSq);
    return this.nearestPointsRect(a as SHAPE_RECT, aPtA, aPtB, aDistSq);
  }

  private nearestPointsCircle(
    aCircle: SHAPE_CIRCLE,
    aPtA: VECTOR2I,
    aPtB: VECTOR2I,
    aDistSq: OutDistSq,
  ): boolean {
    if (
      samePoint(this.GetCenter(), aCircle.GetCenter()) &&
      this.GetRadius() === aCircle.GetRadius()
    ) {
      copyInto(aPtA, this.GetP0());
      copyInto(aPtB, this.GetP0());
      aDistSq.value = 0;
      return true;
    }

    aDistSq.value = ECOORD_MAX;

    const circle1 = new CIRCLE(this.GetCenter(), this.GetRadius());
    const circle2 = new CIRCLE(aCircle.GetCircle());

    const intersections = circle1.Intersect(circle2);

    for (const pt of intersections) {
      if (this.sliceContainsPoint(pt)) {
        copyInto(aPtA, pt);
        copyInto(aPtB, pt);
        aDistSq.value = 0;
        return true;
      }
    }

    const pts = [this.m_start, this.m_end, circle1.NearestPoint(aCircle.GetCenter())];

    for (const pt of pts) {
      if (this.sliceContainsPoint(pt)) {
        const nearestPt2 = circle2.NearestPoint(pt);
        const distSq = sqDist(pt, nearestPt2);

        if (distSq < aDistSq.value) {
          aDistSq.value = distSq;
          copyInto(aPtA, pt);
          copyInto(aPtB, nearestPt2);
        }
      }
    }

    // Adjust point A by half the arc width towards point B
    const dir = ResizeI(
      { x: aPtB.x - aPtA.x, y: aPtB.y - aPtA.y },
      Math.trunc(this.GetWidth() / 2),
    );
    aPtA.x += dir.x;
    aPtA.y += dir.y;

    const hw = Math.trunc(this.GetWidth() / 2);

    if (aDistSq.value < hw * hw) aDistSq.value = 0;
    else aDistSq.value = sqDist(aPtA, aPtB);

    return true;
  }

  private nearestPointsSeg(aSeg: SEG, aPtA: VECTOR2I, aPtB: VECTOR2I, aDistSq: OutDistSq): boolean {
    aDistSq.value = ECOORD_MAX;

    const circle = new CIRCLE(this.GetCenter(), this.GetRadius());

    // First check for intersections on the circle
    const intersections = circle.Intersect(aSeg);

    for (const pt of intersections) {
      if (this.sliceContainsPoint(pt)) {
        copyInto(aPtA, pt);
        copyInto(aPtB, pt);
        aDistSq.value = 0;
        return true;
      }
    }

    // Check the endpoints of the segment against the nearest point on the arc
    for (const pt of [aSeg.A, aSeg.B]) {
      if (this.sliceContainsPoint(pt)) {
        const nearestPt = circle.NearestPoint(pt);
        const distSq = sqDist(pt, nearestPt);

        if (distSq < aDistSq.value) {
          aDistSq.value = distSq;
          copyInto(aPtA, nearestPt);
          copyInto(aPtB, pt);
        }
      }
    }

    // Check the endpoints of the arc against the nearest point on the segment
    for (const pt of [this.m_start, this.m_end]) {
      const nearestPt = aSeg.NearestPoint(pt);
      const distSq = sqDist(pt, nearestPt);

      if (distSq < aDistSq.value) {
        aDistSq.value = distSq;
        copyInto(aPtA, pt);
        copyInto(aPtB, nearestPt);
      }
    }

    // Check the closest points on the segment to the circle (for segments outside the arc)
    const segNearestPt = aSeg.NearestPoint(this.GetCenter());

    if (this.sliceContainsPoint(segNearestPt)) {
      const circleNearestPt = circle.NearestPoint(segNearestPt);
      const distSq = sqDist(segNearestPt, circleNearestPt);

      if (distSq < aDistSq.value) {
        aDistSq.value = distSq;
        copyInto(aPtA, segNearestPt);
        copyInto(aPtB, circleNearestPt);
      }
    }

    // Adjust point A by half the arc width towards point B
    const dir = ResizeI(
      { x: aPtB.x - aPtA.x, y: aPtB.y - aPtA.y },
      Math.trunc(this.GetWidth() / 2),
    );
    aPtA.x += dir.x;
    aPtA.y += dir.y;

    const hw = Math.trunc(this.GetWidth() / 2);

    if (aDistSq.value < hw * hw) aDistSq.value = 0;
    else aDistSq.value = sqDist(aPtA, aPtB);

    return true;
  }

  private nearestPointsRect(
    aRect: SHAPE_RECT,
    aPtA: VECTOR2I,
    aPtB: VECTOR2I,
    aDistSq: OutDistSq,
  ): boolean {
    aDistSq.value = ECOORD_MAX;

    const lineChain = new SHAPE_LINE_CHAIN(aRect.Outline());

    // Reverse the output points to match the rect_outline/arc order
    lineChain.NearestPoints(this, aPtB, aPtA);
    aDistSq.value = sqDist(aPtA, aPtB);

    return true;
  }

  private nearestPointsArc(
    aArc: SHAPE_ARC,
    aPtA: VECTOR2I,
    aPtB: VECTOR2I,
    aDistSq: OutDistSq,
  ): boolean {
    const adjustForArcWidths = (): void => {
      // Adjust point A by half the arc-width towards point B
      let dir = ResizeI(
        { x: aPtB.x - aPtA.x, y: aPtB.y - aPtA.y },
        Math.trunc(this.GetWidth() / 2),
      );
      aPtA.x += dir.x;
      aPtA.y += dir.y;

      // Adjust point B by half the other arc-width towards point A
      dir = ResizeI({ x: aPtA.x - aPtB.x, y: aPtA.y - aPtB.y }, Math.trunc(aArc.GetWidth() / 2));
      aPtB.x += dir.x;
      aPtB.y += dir.y;

      const hw = Math.trunc(this.GetWidth() / 2) + Math.trunc(aArc.GetWidth() / 2);

      if (aDistSq.value < hw * hw) aDistSq.value = 0;
      else aDistSq.value = sqDist(aPtA, aPtB);
    };

    aDistSq.value = ECOORD_MAX;

    const center1 = this.GetCenter();
    const center2 = aArc.GetCenter();

    // Centers aren't exact, so center_dist_sq won't be exact either
    const center_dist_sq = sqDist(center1, center2);
    const center_epsilon = KiROUND(Math.min(this.m_radius, aArc.GetRadius()) / 1000);
    const colocated = center_dist_sq < center_epsilon * center_epsilon;

    // Start by checking endpoints
    const pts1 = [this.m_start, this.m_end];
    const pts2 = [aArc.GetP0(), aArc.GetP1()];

    for (const pt1 of pts1) {
      for (const pt2 of pts2) {
        const distSq = sqDist(pt1, pt2);

        if (distSq < aDistSq.value) {
          aDistSq.value = distSq;
          copyInto(aPtA, pt1);
          copyInto(aPtB, pt2);

          if (aDistSq.value === 0) return true;
        }
      }
    }

    for (const pt of pts1) {
      if (aArc.sliceContainsPoint(pt)) {
        const circle = new CIRCLE(center2, aArc.GetRadius());
        copyInto(aPtA, pt);
        copyInto(aPtB, circle.NearestPoint(pt));
        aDistSq.value = sqDist(aPtA, aPtB);

        if (colocated || aDistSq.value === 0) {
          if (aDistSq.value !== 0) adjustForArcWidths();

          return true;
        }
      }
    }

    for (const pt of pts2) {
      if (this.sliceContainsPoint(pt)) {
        const circle = new CIRCLE(center1, this.GetRadius());
        copyInto(aPtA, circle.NearestPoint(pt));
        copyInto(aPtB, pt);
        aDistSq.value = sqDist(aPtA, aPtB);

        if (colocated || aDistSq.value === 0) {
          if (aDistSq.value !== 0) adjustForArcWidths();

          return true;
        }
      }
    }

    // The remaining checks are require the arcs to be on non-concentric circles
    if (colocated) return true;

    const circle1 = new CIRCLE(center1, this.GetRadius());
    const circle2 = new CIRCLE(center2, aArc.GetRadius());

    // First check for intersections on the circles
    const intersections = circle1.Intersect(circle2);

    for (const pt of intersections) {
      if (this.sliceContainsPoint(pt) && aArc.sliceContainsPoint(pt)) {
        copyInto(aPtA, pt);
        copyInto(aPtB, pt);
        aDistSq.value = 0;
        return true;
      }
    }

    // Closest pair of points on the two full circles. For external the pair
    // faces each other between the centers, so each is the nearest point on
    // its circle to the other center. For one circle strictly inside the
    // other the pair lies on the same side, so the outer circle's pt is
    // nearest to the inner center and the inner circle's pt is furthest
    // from the outer center. Intersecting is handled by Intersect() above.
    const r1 = this.GetRadius();
    const r2 = aArc.GetRadius();
    const contained = center_dist_sq < (r1 - r2) * (r1 - r2);

    let pt1: VECTOR2I;
    let pt2: VECTOR2I;

    if (contained && r1 > r2) {
      pt1 = circle1.NearestPoint(center2);
      pt2 = circle2.FurthestPoint(center1);
    } else if (contained) {
      pt1 = circle1.FurthestPoint(center2);
      pt2 = circle2.NearestPoint(center1);
    } else {
      pt1 = circle1.NearestPoint(center2);
      pt2 = circle2.NearestPoint(center1);
    }

    const pt1InSlice = this.sliceContainsPoint(pt1);
    const pt2InSlice = aArc.sliceContainsPoint(pt2);

    if (pt1InSlice && pt2InSlice) {
      const distSq = sqDist(pt1, pt2);

      if (distSq < aDistSq.value) {
        aDistSq.value = distSq;
        copyInto(aPtA, pt1);
        copyInto(aPtB, pt2);
      }

      adjustForArcWidths();
      return true;
    }

    // Check the endpoints of arc 1 against the nearest point on arc 2
    if (pt2InSlice) {
      for (const pt of pts1) {
        const distSq = sqDist(pt, pt2);

        if (distSq < aDistSq.value) {
          aDistSq.value = distSq;
          copyInto(aPtA, pt);
          copyInto(aPtB, pt2);
        }
      }
    }

    // Check the endpoints of arc 2 against the nearest point on arc 1
    if (pt1InSlice) {
      for (const pt of pts2) {
        const distSq = sqDist(pt, pt1);

        if (distSq < aDistSq.value) {
          aDistSq.value = distSq;
          copyInto(aPtA, pt1);
          copyInto(aPtB, pt);
        }
      }
    }

    adjustForArcWidths();

    return true;
  }

  CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    const center = this.GetCenter();
    const radius = Math.hypot(center.x - this.m_start.x, center.y - this.m_start.y);

    // CIRCLE and SHAPE_CIRCLE store radius as int.  When the radius exceeds representable
    // range, fall back to segment-based candidate generation to avoid integer overflow.
    if (radius >= INT_MAX / 2.0) {
      const arcSeg1 = new SEG(this.m_start, this.m_mid);
      const arcSeg2 = new SEG(this.m_mid, this.m_end);

      const candidatePts: VECTOR2I[] = [
        aSeg.NearestPoint(this.m_start),
        aSeg.NearestPoint(this.m_mid),
        aSeg.NearestPoint(this.m_end),
        arcSeg1.NearestPoint(aSeg.A),
        arcSeg1.NearestPoint(aSeg.B),
        arcSeg2.NearestPoint(aSeg.A),
        arcSeg2.NearestPoint(aSeg.B),
        aSeg.A,
        aSeg.B,
      ];

      let any_collides = false;

      for (const candidate of candidatePts) {
        const collides = this.CollidePoint(candidate, aClearance, aActual, aLocation);
        any_collides ||= collides;

        if (collides && (!aActual || aActual.value === 0)) return true;
      }

      return any_collides;
    }

    const circle = new SHAPE_CIRCLE(center, radius);
    const clearance_sq = aClearance * aClearance;

    // Circle or at least an arc with less space remaining than the clearance
    if (
      this.GetCentralAngle().AsDegrees() > 180.0 &&
      sqDist(this.m_start, this.m_end) < clearance_sq
    ) {
      const a_dist_sq = sqDist(aSeg.A, center);
      const b_dist_sq = sqDist(aSeg.B, center);
      const radius_sq = (radius - aClearance) * (radius - aClearance);

      if (a_dist_sq < radius_sq && b_dist_sq < radius_sq) return false;

      return circle.CollideSeg(aSeg, aClearance, aActual, aLocation);
    }

    // Possible points of the collision are:
    // 1. Intersetion of the segment with the full circle
    // 2. Closest point on the segment to the center of the circle
    // 3. Closest point on the segment to the end points of the arc
    // 4. End points of the segment
    const candidatePts = circle.GetCircle().Intersect(aSeg);

    candidatePts.push(aSeg.NearestPoint(center));
    candidatePts.push(aSeg.NearestPoint(this.m_start));
    candidatePts.push(aSeg.NearestPoint(this.m_end));
    candidatePts.push(aSeg.A);
    candidatePts.push(aSeg.B);

    let any_collides = false;

    for (const candidate of candidatePts) {
      const collides = this.CollidePoint(candidate, aClearance, aActual, aLocation);
      any_collides ||= collides;

      if (collides && (!aActual || aActual.value === 0)) return true;
    }

    return any_collides;
  }

  override CollidePoint(aP: Vec2, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    const minDist = aClearance + Math.trunc(this.m_width / 2);
    const bbox = this.BBox(minDist);

    // Fast check using bounding box:
    if (!bbox.Contains(aP)) return false;

    const center = this.GetCenter();
    const radius = Math.hypot(center.x - this.m_start.x, center.y - this.m_start.y);

    // CIRCLE stores radius as int.  When the radius exceeds representable range the arc is
    // nearly straight, so approximate it as two segments through the midpoint.
    if (radius >= INT_MAX / 2.0) {
      const seg1 = new SEG(this.m_start, this.m_mid);
      const seg2 = new SEG(this.m_mid, this.m_end);
      const dist1 = seg1.Distance(aP);
      const dist2 = seg2.Distance(aP);
      const dist = Math.min(dist1, dist2);

      if (dist <= minDist) {
        if (aActual) aActual.value = Math.max(0, dist - Math.trunc(this.m_width / 2));

        if (aLocation)
          copyInto(aLocation, dist1 <= dist2 ? seg1.NearestPoint(aP) : seg2.NearestPoint(aP));

        return true;
      }

      return false;
    }

    const fullCircle = new CIRCLE(center, radius);
    let nearestPt: Vec2 = fullCircle.NearestPointD(aP);
    let dist = KiROUND(Math.hypot(nearestPt.x - aP.x, nearestPt.y - aP.y));
    const angleToPt = EDA_ANGLE.fromVector({
      x: aP.x - fullCircle.Center.x,
      y: aP.y - fullCircle.Center.y,
    }); // Angle from center to the point

    if (!dist) {
      // Be sure to keep the sqrt of the squared distance instead of allowing a EuclideanNorm
      // because this trucates the distance to an integer before subtracting
      dist = KiROUND(radius - Math.sqrt(sqDist(aP, center)));
      nearestPt = RotatePointD({ x: center.x + radius, y: center.y }, center, angleToPt.negate());
    }

    // If not a 360 degree arc, need to use arc angles to decide if point collides
    if (!samePoint(this.m_start, this.m_end)) {
      const ccw = this.GetCentralAngle().gt(ANGLE_0);
      const rotatedPtAngle = angleToPt.Normalize().sub(this.GetStartAngle()).Normalize();
      const rotatedEndAngle = this.GetEndAngle().sub(this.GetStartAngle()).Normalize();

      if (
        (ccw && rotatedPtAngle.gt(rotatedEndAngle)) ||
        (!ccw && rotatedPtAngle.lt(rotatedEndAngle))
      ) {
        const distStartpt = EuclideanNormI({ x: aP.x - this.m_start.x, y: aP.y - this.m_start.y });
        const distEndpt = EuclideanNormI({ x: aP.x - this.m_end.x, y: aP.y - this.m_end.y });

        if (distStartpt < distEndpt) {
          dist = distStartpt;
          nearestPt = this.m_start;
        } else {
          dist = distEndpt;
          nearestPt = this.m_end;
        }
      }
    }

    if (dist <= minDist) {
      // `*aLocation = nearestPt` narrows the VECTOR2D to VECTOR2I: truncation
      if (aLocation) {
        aLocation.x = Math.trunc(nearestPt.x);
        aLocation.y = Math.trunc(nearestPt.y);
      }

      if (aActual) aActual.value = Math.max(0, dist - Math.trunc(this.m_width / 2));

      return true;
    }

    return false;
  }

  /**
   * Find intersection points between this arc and a line segment (treated as an infinite line).
   */
  IntersectLine(aSeg: SEG, aIpsBuffer: VECTOR2I[]): number {
    if (samePoint(aSeg.A, aSeg.B)) return 0; // One point does not define a line....

    if (this.GetRadius() >= INT_MAX / 2.0) return 0;

    const circ = new CIRCLE(this.GetCenter(), Math.trunc(this.GetRadius()));

    const intersections = circ.IntersectLine(aSeg);

    const originalSize = aIpsBuffer.length;

    for (const intersection of intersections) {
      if (this.sliceContainsPoint(intersection)) aIpsBuffer.push(intersection);
    }

    return aIpsBuffer.length - originalSize;
  }

  /**
   * Find intersection points between this arc and a CIRCLE or another SHAPE_ARC.
   */
  Intersect(aCircle: CIRCLE, aIpsBuffer: VECTOR2I[]): number;
  Intersect(aArc: SHAPE_ARC, aIpsBuffer: VECTOR2I[]): number;
  Intersect(a: CIRCLE | SHAPE_ARC, aIpsBuffer: VECTOR2I[]): number {
    if (a instanceof CIRCLE) {
      if (this.GetRadius() >= INT_MAX / 2.0) return 0;

      const thiscirc = new CIRCLE(this.GetCenter(), Math.trunc(this.GetRadius()));

      const intersections = thiscirc.Intersect(a);

      const originalSize = aIpsBuffer.length;

      for (const intersection of intersections) {
        if (this.sliceContainsPoint(intersection)) aIpsBuffer.push(intersection);
      }

      return aIpsBuffer.length - originalSize;
    }

    if (this.GetRadius() >= INT_MAX / 2.0 || a.GetRadius() >= INT_MAX / 2.0) {
      return 0;
    }

    const thiscirc = new CIRCLE(this.GetCenter(), Math.trunc(this.GetRadius()));
    const othercirc = new CIRCLE(a.GetCenter(), Math.trunc(a.GetRadius()));

    const intersections = thiscirc.Intersect(othercirc);

    const originalSize = aIpsBuffer.length;

    for (const intersection of intersections) {
      if (this.sliceContainsPoint(intersection) && a.sliceContainsPoint(intersection))
        aIpsBuffer.push(intersection);
    }

    return aIpsBuffer.length - originalSize;
  }

  override GetStart(): VECTOR2I {
    return this.m_start;
  }
  override GetEnd(): VECTOR2I {
    return this.m_end;
  }

  override SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }

  override GetWidth(): number {
    return this.m_width;
  }

  IsSolid(): boolean {
    return true;
  }

  /**
   * Check if the arc is effectively a line (its three points are collinear and
   * the mid point lies between the ends).
   */
  IsEffectiveLine(): boolean {
    const v1 = new SEG(this.m_start, this.m_mid);
    const v2 = new SEG(this.m_mid, this.m_end);
    return (
      v1.ApproxCollinear(v2) &&
      (v1.B.x - v1.A.x) * (v2.B.x - v2.A.x) + (v1.B.y - v1.A.y) * (v2.B.y - v2.A.y) > 0
    );
  }

  Move(aVector: Vec2): void {
    this.m_start.x += aVector.x;
    this.m_start.y += aVector.y;
    this.m_end.x += aVector.x;
    this.m_end.y += aVector.y;
    this.m_mid.x += aVector.x;
    this.m_mid.y += aVector.y;
    this.update_values();
  }

  /**
   * Rotate the arc by a given angle about a point.
   */
  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {
    this.m_start = RotatePoint(this.m_start, aCenter, aAngle);
    this.m_end = RotatePoint(this.m_end, aCenter, aAngle);
    this.m_mid = RotatePoint(this.m_mid, aCenter, aAngle);

    this.update_values();
  }

  Mirror(aRef: Vec2, aFlipDirection: FLIP_DIRECTION): void;
  Mirror(axis: SEG): void;
  Mirror(a: Vec2 | SEG, aFlipDirection?: FLIP_DIRECTION): void {
    if (a instanceof SEG) {
      this.m_start = a.ReflectPoint(this.m_start);
      this.m_end = a.ReflectPoint(this.m_end);
      this.m_mid = a.ReflectPoint(this.m_mid);

      this.update_values();
      return;
    }

    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      this.m_start.x = -this.m_start.x + 2 * a.x;
      this.m_end.x = -this.m_end.x + 2 * a.x;
      this.m_mid.x = -this.m_mid.x + 2 * a.x;
    } else {
      this.m_start.y = -this.m_start.y + 2 * a.y;
      this.m_end.y = -this.m_end.y + 2 * a.y;
      this.m_mid.y = -this.m_mid.y + 2 * a.y;
    }

    this.update_values();
  }

  Reverse(): void {
    const t = this.m_start;
    this.m_start = this.m_end;
    this.m_end = t;
  }

  Reversed(): SHAPE_ARC {
    return new SHAPE_ARC(this.m_end, this.m_mid, this.m_start, this.m_width);
  }

  GetRadius(): number {
    return this.m_radius;
  }

  GetChord(): SEG {
    return new SEG(this.m_start, this.m_end);
  }

  GetCentralAngle(): EDA_ANGLE {
    // Arcs with same start and end points can be 0 deg or 360 deg arcs.
    // However, they are expected to be circles.
    // So return 360 degrees as central arc:
    if (samePoint(this.m_start, this.m_end)) return ANGLE_360.Clone();

    const center = this.GetCenter();

    let angle = EDA_ANGLE.fromVector({
      x: this.m_end.x - center.x,
      y: this.m_end.y - center.y,
    }).sub(EDA_ANGLE.fromVector({ x: this.m_start.x - center.x, y: this.m_start.y - center.y }));

    // Using only m_start and m_end arc points to calculate the central arc is not enough
    // there are 2 arcs having the same center and end points.
    // Using the middle point is mandatory to know what arc is the right one.
    // IsCCW() uses m_start, m_middle and m_end arc points to know the arc orientation
    if (this.IsCCW()) {
      if (angle.lt(ANGLE_0)) angle = angle.add(ANGLE_360);
    } else {
      if (angle.gt(ANGLE_0)) angle = angle.sub(ANGLE_360);
    }

    return angle;
  }

  GetStartAngle(): EDA_ANGLE {
    const center = this.GetCenter();
    const angle = EDA_ANGLE.fromVector({
      x: this.m_start.x - center.x,
      y: this.m_start.y - center.y,
    });
    return angle.Normalize();
  }

  GetEndAngle(): EDA_ANGLE {
    const center = this.GetCenter();
    const angle = EDA_ANGLE.fromVector({ x: this.m_end.x - center.x, y: this.m_end.y - center.y });
    return angle.Normalize();
  }

  GetLength(): number {
    const radius = this.GetRadius();
    const includedAngle = this.GetCentralAngle();

    return Math.abs(radius * includedAngle.AsRadians());
  }

  /**
   * @return the default accuracy value for the arc to segment conversion
   *
   * @note The default is #ARC_HIGH_DEF in Pcbnew units.  This is to allow common geometry
   *       collision functions.  Other programs should call this using explicit accuracy values
   *       until we decide on a better way to handle those requirements.
   */
  static DefaultAccuracyForPCB(): number {
    return ARC_HIGH_DEF;
  }

  /**
   * Construct a SHAPE_LINE_CHAIN of segments from a given arc.
   *
   * @param aMaxError maximum divergence from true arc given in internal units.
   * @param aActualError is filled with the actual error.
   */
  ConvertToPolyline(
    aMaxError: number = SHAPE_ARC.DefaultAccuracyForPCB(),
    aActualError?: OutInt,
  ): SHAPE_LINE_CHAIN {
    const rv = new SHAPE_LINE_CHAIN();
    let r = this.GetRadius();
    const sa = this.GetStartAngle();
    const c = this.GetCenter();
    const ca = this.GetCentralAngle();

    const startToEnd = new SEG(this.GetP0(), this.GetP1());
    const halfMaxError = Math.max(1.0, aMaxError / 2.0);
    let n: number;

    // To calculate the arc to segment count, use the external radius instead of the radius.
    // for a arc with small radius and large width, the difference can be significant
    const external_radius = r + this.m_width / 2.0;
    let effectiveError: number;

    if (external_radius < halfMaxError || startToEnd.Distance(this.GetArcMid()) < halfMaxError) {
      // Should be a very rare case
      // In this case, the arc is approximated by one segment, with a effective error
      // between -aMaxError/2 and +aMaxError/2, as expected.
      n = 0;
      effectiveError = external_radius;
    } else {
      n = getArcToSegmentCount(external_radius, aMaxError, ca.AsDegrees());

      // Recalculate the effective error of approximation, that can be < aMaxError
      const seg360 = Math.trunc((n * 360.0) / Math.abs(ca.AsDegrees()));
      effectiveError = circleToEndSegmentDeltaRadius(external_radius, seg360);
    }

    // Split the error on either side of the arc.  Since we want the start and end points
    // to be exactly on the arc, the first and last segments need to be shorter to stay within
    // the error band (since segments normally start 1/2 the error band outside the arc).
    r += effectiveError / 2;
    n = n * 2;

    rv.Append(this.m_start);

    for (let i = 1; i < n; i += 2) {
      let a = sa.Clone();

      if (n !== 0) a = a.add(ca.multiply(i).divide(n));

      const x = c.x + r * a.Cos();
      const y = c.y + r * a.Sin();

      rv.Append(KiROUND(x), KiROUND(y));
    }

    rv.Append(this.m_end);

    if (aActualError) aActualError.value = KiROUND(effectiveError);

    return rv;
  }

  /** `operator==`. */
  equals(aArc: SHAPE_ARC): boolean {
    return (
      samePoint(aArc.m_start, this.m_start) &&
      samePoint(aArc.m_end, this.m_end) &&
      samePoint(aArc.m_mid, this.m_mid) &&
      aArc.m_width === this.m_width
    );
  }

  TransformToPolygon(aBuffer: SHAPE_POLY_SET, aMaxError: number, aErrorLoc: ERROR_LOC): void {
    TransformArcToPolygon(
      aBuffer,
      this.m_start,
      this.m_mid,
      this.m_end,
      this.m_width,
      aMaxError,
      aErrorLoc,
    );
  }

  IsCCW(): boolean {
    const v1x = this.m_end.x - this.m_mid.x;
    const v1y = this.m_end.y - this.m_mid.y;
    const v2x = this.m_start.x - this.m_mid.x;
    const v2y = this.m_start.y - this.m_mid.y;

    // VECTOR2L::Cross, exact in BigInt
    return BigInt(v1x) * BigInt(v2y) - BigInt(v1y) * BigInt(v2x) > 0n;
  }

  IsClockwise(): boolean {
    return !this.IsCCW();
  }

  private update_values(): void {
    this.m_center = CalcArcCenterI(this.m_start, this.m_mid, this.m_end);
    this.m_radius = Math.sqrt(sqDist(this.m_start, this.m_center));

    const points: VECTOR2I[] = [];
    // Put start, mid, and end points in the point list
    points.push(this.m_start);
    points.push(this.m_mid);
    points.push(this.m_end);

    let start_angle = this.GetStartAngle();
    let end_angle = start_angle.add(this.GetCentralAngle());

    // we always count quadrants clockwise (increasing angle)
    if (start_angle.gt(end_angle)) [start_angle, end_angle] = [end_angle, start_angle];

    const quad_angle_start = Math.ceil(start_angle.AsDegrees() / 90.0);
    const quad_angle_end = Math.floor(end_angle.AsDegrees() / 90.0);

    // very large radius means the arc is similar to a segment
    // so do not try to add more points, center cannot be handled
    // Very large is here > INT_MAX/2
    if (this.m_radius < INT_MAX / 2.0) {
      const radius = KiROUND(this.m_radius);

      // count through quadrants included in arc
      for (let quad_angle = quad_angle_start; quad_angle <= quad_angle_end; ++quad_angle) {
        const quad_pt = { x: this.m_center.x, y: this.m_center.y };

        switch (quad_angle % 4) {
          case 0:
            quad_pt.x += radius;
            break;
          case 1:
          case -3:
            quad_pt.y += radius;
            break;
          case 2:
          case -2:
            quad_pt.x -= radius;
            break;
          case 3:
          case -1:
            quad_pt.y -= radius;
            break;
          default:
            throw new Error('unreachable');
        }

        points.push(quad_pt);
      }
    }

    this.m_bbox.Compute(points);
  }

  private sliceContainsPoint(p: Vec2): boolean {
    const sa = this.GetStartAngle().Normalize();
    const ca = this.GetCentralAngle();
    const ea = sa.add(ca);

    const phi = EDA_ANGLE.fromVector({ x: p.x - this.GetCenter().x, y: p.y - this.GetCenter().y }); // Angle from center to the point
    phi.Normalize();

    if (ca.ge(ANGLE_0)) {
      let ph = phi;
      while (ph.lt(sa)) ph = ph.add(ANGLE_360);

      return ph.ge(sa) && ph.le(ea);
    }

    let ph = phi;
    while (ph.gt(sa)) ph = ph.sub(ANGLE_360);

    return ph.le(sa) && ph.ge(ea);
  }

  /** `operator<<`. */
  override Format(): string {
    return `Arc( P0=(${this.m_start.x}, ${this.m_start.y}) P1=(${this.m_end.x}, ${this.m_end.y}) Mid=(${this.m_mid.x}, ${this.m_mid.y}) Width=${this.m_width} )`;
  }
}
