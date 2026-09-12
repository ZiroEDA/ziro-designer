// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `SHAPE_CIRCLE` (`geometry/shape_circle.h`, the two bodies in `shape_segment.cpp`). */

import type { Vec2, VECTOR2I } from '../math/vector2.js';
import type { EDA_ANGLE } from './eda_angle.js';
import type { ERROR_LOC } from '../convert_basic_shapes_to_polygon.js';
import { BOX2I } from '../math/box2.js';
import { RotatePoint } from '../trigo.js';
import { CIRCLE } from './circle.js';
import type { SEG } from './seg.js';
import { type OutInt, SHAPE, SHAPE_TYPE } from './shape.js';
// the base class dispatches through these; see SHAPE_HOOKS
import './shape_collisions.js';
import './shape_nearest_points.js';
import './shape_poly_set.js';
import type { SHAPE_POLY_SET } from './shape_poly_set.js';
import { TransformCircleToPolygon } from './shape_poly_set.js';

export class SHAPE_CIRCLE extends SHAPE {
  private m_circle: CIRCLE;

  constructor();
  constructor(aCenter: Vec2, aRadius: number);
  constructor(aCircle: CIRCLE);
  constructor(aOther: SHAPE_CIRCLE);
  constructor(a?: Vec2 | CIRCLE | SHAPE_CIRCLE, aRadius?: number) {
    super(SHAPE_TYPE.SH_CIRCLE);

    if (a === undefined) this.m_circle = new CIRCLE();
    else if (a instanceof SHAPE_CIRCLE) this.m_circle = new CIRCLE(a.m_circle);
    else if (a instanceof CIRCLE) this.m_circle = new CIRCLE(a);
    else this.m_circle = new CIRCLE(a, aRadius as number);
  }

  override Clone(): SHAPE {
    return new SHAPE_CIRCLE(this);
  }

  BBox(aClearance = 0): BOX2I {
    const rc = this.m_circle.Radius + aClearance;

    return new BOX2I(
      { x: this.m_circle.Center.x - rc, y: this.m_circle.Center.y - rc },
      { x: rc * 2, y: rc * 2 },
    );
  }

  CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    const minDist = aClearance + this.m_circle.Radius;
    const pn = aSeg.NearestPoint(this.m_circle.Center);
    const dx = pn.x - this.m_circle.Center.x;
    const dy = pn.y - this.m_circle.Center.y;
    const dist_sq = dx * dx + dy * dy;

    if (dist_sq === 0 || dist_sq < minDist * minDist) {
      if (aLocation) {
        const pts = this.m_circle.Intersect(aSeg);

        if (pts.length > 0 && dist_sq === 0) {
          aLocation.x = pts[0]!.x;
          aLocation.y = pts[0]!.y;
        } else {
          aLocation.x = pn.x;
          aLocation.y = pn.y;
        }
      }

      if (aActual)
        aActual.value = Math.max(0, Math.trunc(Math.sqrt(dist_sq)) - this.m_circle.Radius);

      return true;
    }

    return false;
  }

  SetRadius(aRadius: number): void {
    this.m_circle.Radius = aRadius;
  }

  SetCenter(aCenter: Vec2): void {
    this.m_circle.Center = { x: aCenter.x, y: aCenter.y };
  }

  GetRadius(): number {
    return this.m_circle.Radius;
  }

  GetCenter(): VECTOR2I {
    return this.m_circle.Center;
  }

  GetCircle(): CIRCLE {
    return this.m_circle;
  }

  Move(aVector: Vec2): void {
    this.m_circle.Center.x += aVector.x;
    this.m_circle.Center.y += aVector.y;
  }

  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {
    this.m_circle.Center = RotatePoint(this.m_circle.Center, aCenter, aAngle);
  }

  IsSolid(): boolean {
    return true;
  }

  override Format(aCplusPlus = true): string {
    if (aCplusPlus)
      return `SHAPE_CIRCLE( VECTOR2I( ${this.m_circle.Center.x}, ${this.m_circle.Center.y}), ${this.m_circle.Radius}); `;

    return `${super.Format(aCplusPlus)} ${this.m_circle.Center.x} ${this.m_circle.Center.y} ${this.m_circle.Radius}`;
  }

  TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void {
    TransformCircleToPolygon(
      aBuffer,
      this.m_circle.Center,
      this.m_circle.Radius,
      aError,
      aErrorLoc,
    );
  }
}
