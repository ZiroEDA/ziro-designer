// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_SIMPLE` (`geometry/shape_simple.h`): a simple closed polygon, a
 * `SHAPE_LINE_CHAIN` that is always closed.
 */

import type { Vec2, VECTOR2I } from '../math/vector2.js';
import type { EDA_ANGLE } from './eda_angle.js';
import type { ERROR_LOC } from '../convert_basic_shapes_to_polygon.js';
import type { BOX2I } from '../math/box2.js';
import type { SEG } from './seg.js';
import { type OutInt, SHAPE, SHAPE_LINE_CHAIN_BASE, SHAPE_TYPE } from './shape.js';
// the base class dispatches through these; see SHAPE_HOOKS
import './shape_collisions.js';
import './shape_nearest_points.js';
import './shape_poly_set.js';
import { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import type { SHAPE_POLY_SET } from './shape_poly_set.js';

export class SHAPE_SIMPLE extends SHAPE_LINE_CHAIN_BASE {
  // vertices
  private m_points: SHAPE_LINE_CHAIN;

  constructor();
  constructor(aPoly: SHAPE_LINE_CHAIN);
  constructor(aOther: SHAPE_SIMPLE);
  constructor(a?: SHAPE_LINE_CHAIN | SHAPE_SIMPLE) {
    super(SHAPE_TYPE.SH_SIMPLE);

    if (a === undefined) {
      this.m_points = new SHAPE_LINE_CHAIN();
      this.m_points.SetClosed(true);
    } else if (a instanceof SHAPE_SIMPLE) {
      this.m_points = new SHAPE_LINE_CHAIN(a.m_points);
    } else {
      this.m_points = new SHAPE_LINE_CHAIN(a);
      this.m_points.SetClosed(true);
    }
  }

  override Clone(): SHAPE {
    return new SHAPE_SIMPLE(this);
  }

  Clear(): void {
    this.m_points.Clear();
  }

  BBox(aClearance = 0): BOX2I {
    return this.m_points.BBox(aClearance);
  }

  PointCount(): number {
    return this.m_points.PointCount();
  }

  CPoint(aIndex: number): VECTOR2I {
    return this.m_points.CPoint(aIndex);
  }

  CDPoint(aIndex: number): Vec2 {
    const v = this.CPoint(aIndex);
    return { x: v.x, y: v.y };
  }

  Vertices(): SHAPE_LINE_CHAIN {
    return this.m_points;
  }

  Append(aX: number, aY: number): void;
  Append(aP: Vec2): void;
  Append(a: number | Vec2, aY?: number): void {
    if (typeof a === 'number') this.m_points.Append({ x: a, y: aY as number });
    else this.m_points.Append(a);
  }

  override CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    return this.m_points.CollideSeg(aSeg, aClearance, aActual, aLocation);
  }

  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {
    this.m_points.Rotate(aAngle, aCenter);
  }

  Move(aVector: Vec2): void {
    this.m_points.Move(aVector);
  }

  IsSolid(): boolean {
    return true;
  }

  GetPoint(aIndex: number): VECTOR2I {
    return this.m_points.CPoint(aIndex);
  }
  GetSegment(aIndex: number): SEG {
    return this.m_points.CSegment(aIndex);
  }
  GetPointCount(): number {
    return this.m_points.PointCount();
  }
  GetSegmentCount(): number {
    return this.m_points.SegmentCount();
  }

  IsClosed(): boolean {
    return true;
  }

  override TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void {
    aBuffer.AddOutline(this.m_points);
  }
}
