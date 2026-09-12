// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_SEGMENT` (`geometry/shape_segment.h`, `src/geometry/shape_segment.cpp`):
 * a segment with a width - a track.
 */

import type { Vec2, VECTOR2I } from '../math/vector2.js';
import { EDA_ANGLE } from './eda_angle.js';
import type { ERROR_LOC } from '../convert_basic_shapes_to_polygon.js';
import { BOX2I } from '../math/box2.js';
import { RotatePoint } from '../trigo.js';
import { divideI } from '../math/vector2.js';
import { SEG } from './seg.js';
import { type OutInt, SHAPE, SHAPE_TYPE } from './shape.js';
// the base class dispatches through these; see SHAPE_HOOKS
import './shape_collisions.js';
import './shape_nearest_points.js';
import './shape_poly_set.js';
import type { SHAPE_POLY_SET } from './shape_poly_set.js';
import { TransformOvalToPolygon } from './shape_poly_set.js';

export class SHAPE_SEGMENT extends SHAPE {
  private m_seg: SEG;
  private m_width: number;

  constructor();
  constructor(aA: Vec2, aB: Vec2, aWidth?: number);
  constructor(aSeg: SEG, aWidth?: number);
  constructor(a?: Vec2 | SEG, b?: Vec2 | number, c?: number) {
    super(SHAPE_TYPE.SH_SEGMENT);

    if (a === undefined) {
      this.m_seg = new SEG();
      this.m_width = 0;
    } else if (a instanceof SEG) {
      this.m_seg = new SEG(a);
      this.m_width = (b as number | undefined) ?? 0;
    } else {
      this.m_seg = new SEG(a, b as Vec2);
      this.m_width = c ?? 0;
    }
  }

  /**
   * Create a segment from an overall size, a centre and a rotation: the
   * major axis is the segment, the minor axis the width.
   */
  static BySizeAndCenter(aOverallSize: Vec2, aCenter: Vec2, aRotation: EDA_ANGLE): SHAPE_SEGMENT {
    let segVec: VECTOR2I = { x: 0, y: 0 };
    let width: number;

    // Find the major axis, without endcaps
    if (aOverallSize.x > aOverallSize.y) {
      width = aOverallSize.y;
      segVec.x = aOverallSize.x - width;
    } else {
      width = aOverallSize.x;
      segVec.y = aOverallSize.y - width;
    }

    segVec = RotatePoint(segVec, aRotation);

    const half = divideI(segVec, 2);

    return new SHAPE_SEGMENT(
      { x: aCenter.x - half.x, y: aCenter.y - half.y },
      { x: aCenter.x + half.x, y: aCenter.y + half.y },
      width,
    );
  }

  override Clone(): SHAPE {
    return new SHAPE_SEGMENT(this.m_seg, this.m_width);
  }

  BBox(aClearance = 0): BOX2I {
    return new BOX2I(this.m_seg.A, {
      x: this.m_seg.B.x - this.m_seg.A.x,
      y: this.m_seg.B.y - this.m_seg.A.y,
    }).Inflate(aClearance + Math.trunc((this.m_width + 1) / 2));
  }

  CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    if (aSeg.A.x === aSeg.B.x && aSeg.A.y === aSeg.B.y)
      return this.CollidePoint(aSeg.A, aClearance, aActual, aLocation);

    const min_dist = Math.trunc((this.m_width + 1) / 2) + aClearance;
    const dist_sq = this.m_seg.SquaredDistance(aSeg);

    if (dist_sq === 0 || dist_sq < min_dist * min_dist) {
      if (aLocation) {
        const p = this.m_seg.NearestPoint(aSeg);
        aLocation.x = p.x;
        aLocation.y = p.y;
      }

      if (aActual)
        aActual.value = Math.max(
          0,
          Math.trunc(Math.sqrt(dist_sq)) - Math.trunc((this.m_width + 1) / 2),
        );

      return true;
    }

    return false;
  }

  override CollidePoint(aP: Vec2, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    const min_dist = Math.trunc((this.m_width + 1) / 2) + aClearance;
    const dist_sq = this.m_seg.SquaredDistance(aP);

    if (dist_sq === 0 || dist_sq < min_dist * min_dist) {
      if (aLocation) {
        const p = this.m_seg.NearestPoint(aP);
        aLocation.x = p.x;
        aLocation.y = p.y;
      }

      if (aActual)
        aActual.value = Math.max(
          0,
          Math.trunc(Math.sqrt(dist_sq)) - Math.trunc((this.m_width + 1) / 2),
        );

      return true;
    }

    return false;
  }

  SetSeg(aSeg: SEG): void {
    this.m_seg = new SEG(aSeg);
  }

  GetSeg(): SEG {
    return this.m_seg;
  }

  override GetStart(): VECTOR2I {
    return this.m_seg.A;
  }
  override GetEnd(): VECTOR2I {
    return this.m_seg.B;
  }

  override SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }

  override GetWidth(): number {
    return this.m_width;
  }

  GetTotalLength(): number {
    return this.m_seg.Length() + this.m_width;
  }

  GetCenter(): VECTOR2I {
    return this.m_seg.Center();
  }

  GetAngle(): EDA_ANGLE {
    return EDA_ANGLE.fromVector({
      x: this.m_seg.B.x - this.m_seg.A.x,
      y: this.m_seg.B.y - this.m_seg.A.y,
    });
  }

  IsSolid(): boolean {
    return true;
  }

  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {
    this.m_seg.A = RotatePoint(this.m_seg.A, aCenter, aAngle);
    this.m_seg.B = RotatePoint(this.m_seg.B, aCenter, aAngle);
  }

  Move(aVector: Vec2): void {
    this.m_seg.A.x += aVector.x;
    this.m_seg.A.y += aVector.y;
    this.m_seg.B.x += aVector.x;
    this.m_seg.B.y += aVector.y;
  }

  Is45Degree(aTollerance: EDA_ANGLE = new EDA_ANGLE(1.0)): boolean {
    const mag = EDA_ANGLE.fromVector({
      x: this.m_seg.A.x - this.m_seg.B.x,
      y: this.m_seg.A.y - this.m_seg.B.y,
    }).Normalize180();

    const f = mag.AsDegrees() % 45.0;
    const d = aTollerance.AsDegrees();

    if (f >= 45.0 - d || f <= d) {
      return true;
    }

    return false;
  }

  override Format(aCplusPlus = true): string {
    if (aCplusPlus) {
      return `SHAPE_SEGMENT( VECTOR2I( ${this.m_seg.A.x}, ${this.m_seg.A.y}), VECTOR2I( ${this.m_seg.B.x}, ${this.m_seg.B.y}), ${this.m_width}); `;
    }

    return `${super.Format(aCplusPlus)} ${this.m_seg.A.x} ${this.m_seg.A.y} ${this.m_seg.B.x} ${this.m_seg.B.y} ${this.m_width}`;
  }

  TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void {
    TransformOvalToPolygon(aBuffer, this.m_seg.A, this.m_seg.B, this.m_width, aError, aErrorLoc);
  }
}
