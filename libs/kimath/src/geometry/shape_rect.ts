// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `SHAPE_RECT` (`geometry/shape_rect.h`, `src/geometry/shape_rect.cpp`). */

import type { Vec2, VECTOR2I } from '../math/vector2.js';
import { ECOORD_MAX, EuclideanNormI } from '../math/vector2.js';
import type { EDA_ANGLE } from './eda_angle.js';
import { ERROR_LOC } from '../convert_basic_shapes_to_polygon.js';
import { BOX2I } from '../math/box2.js';
import { RotatePoint } from '../trigo.js';
import { SEG } from './seg.js';
import { type OutInt, SHAPE, SHAPE_TYPE } from './shape.js';
// the base class dispatches through these; see SHAPE_HOOKS
import './shape_collisions.js';
import './shape_nearest_points.js';
import './shape_poly_set.js';
import { SHAPE_ARC } from './shape_arc.js';
import { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import { SHAPE_POLY_SET } from './shape_poly_set.js';
import { ROUNDRECT } from './roundrect.js';

export class SHAPE_RECT extends SHAPE {
  private m_p0: VECTOR2I; ///< Top-left corner
  private m_w: number; ///< Width
  private m_h: number; ///< Height
  private m_radius: number; ///< Corner radius

  constructor();
  constructor(aBox: BOX2I);
  constructor(aX0: number, aY0: number, aW: number, aH: number);
  constructor(aP0: Vec2, aW: number, aH: number);
  constructor(aP0: Vec2, aP1: Vec2);
  constructor(aOther: SHAPE_RECT);
  constructor(a?: BOX2I | number | Vec2 | SHAPE_RECT, b?: number | Vec2, c?: number, d?: number) {
    super(SHAPE_TYPE.SH_RECT);

    if (a === undefined) {
      this.m_p0 = { x: 0, y: 0 };
      this.m_w = 0;
      this.m_h = 0;
      this.m_radius = 0;
    } else if (a instanceof SHAPE_RECT) {
      this.m_p0 = { x: a.m_p0.x, y: a.m_p0.y };
      this.m_w = a.m_w;
      this.m_h = a.m_h;
      this.m_radius = a.m_radius;
    } else if (a instanceof BOX2I) {
      const p = a.GetPosition();
      this.m_p0 = { x: p.x, y: p.y };
      this.m_w = a.GetWidth();
      this.m_h = a.GetHeight();
      this.m_radius = 0;
    } else if (typeof a === 'number') {
      this.m_p0 = { x: a, y: b as number };
      this.m_w = c as number;
      this.m_h = d as number;
      this.m_radius = 0;
    } else if (typeof b === 'number') {
      this.m_p0 = { x: a.x, y: a.y };
      this.m_w = b;
      this.m_h = c as number;
      this.m_radius = 0;
    } else {
      const p1 = b as Vec2;
      this.m_p0 = { x: a.x, y: a.y };
      this.m_w = p1.x - a.x;
      this.m_h = p1.y - a.y;
      this.m_radius = 0;
    }
  }

  override Clone(): SHAPE {
    return new SHAPE_RECT(this);
  }

  /// @copydoc SHAPE::BBox()
  BBox(aClearance = 0): BOX2I {
    return new BOX2I(
      { x: this.m_p0.x - aClearance, y: this.m_p0.y - aClearance },
      { x: this.m_w + 2 * aClearance, y: this.m_h + 2 * aClearance },
    );
  }

  GetInflated(aOffset: number): SHAPE_RECT {
    const r = new SHAPE_RECT(
      { x: this.m_p0.x - aOffset, y: this.m_p0.y - aOffset },
      this.m_w + 2 * aOffset,
      this.m_h + 2 * aOffset,
    );
    r.SetRadius(this.m_radius + aOffset);
    return r;
  }

  /**
   * @return the length of the diagonal of the rectangle.
   */
  Diagonal(): number {
    return EuclideanNormI({ x: this.m_w, y: this.m_h });
  }

  MajorDimension(): number {
    return Math.max(this.m_w, this.m_h);
  }

  MinorDimension(): number {
    return Math.min(this.m_w, this.m_h);
  }

  /// @copydoc SHAPE::Collide()
  CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    if (this.m_radius > 0) {
      const lineChain = new SHAPE_LINE_CHAIN(this.Outline());
      return lineChain.CollideSeg(aSeg, aClearance, aActual, aLocation);
    }

    const bbox = this.BBox();

    if (bbox.Contains(aSeg.A)) {
      if (aLocation) {
        aLocation.x = aSeg.A.x;
        aLocation.y = aSeg.A.y;
      }

      if (aActual) aActual.value = 0;

      return true;
    }

    if (bbox.Contains(aSeg.B)) {
      if (aLocation) {
        aLocation.x = aSeg.B.x;
        aLocation.y = aSeg.B.y;
      }

      if (aActual) aActual.value = 0;

      return true;
    }

    const corners: VECTOR2I[] = [
      { x: this.m_p0.x, y: this.m_p0.y },
      { x: this.m_p0.x, y: this.m_p0.y + this.m_h },
      { x: this.m_p0.x + this.m_w, y: this.m_p0.y + this.m_h },
      { x: this.m_p0.x + this.m_w, y: this.m_p0.y },
      { x: this.m_p0.x, y: this.m_p0.y },
    ];

    let closest_dist_sq = ECOORD_MAX;
    let nearest: VECTOR2I = { x: 0, y: 0 };

    for (let i = 0; i < 4; i++) {
      const side = new SEG(corners[i]!, corners[i + 1]!);
      const dist_sq = side.SquaredDistance(aSeg);

      if (dist_sq < closest_dist_sq) {
        if (aLocation) {
          nearest = side.NearestPoint(aSeg);
        }

        closest_dist_sq = dist_sq;
      } else if (aLocation && dist_sq === closest_dist_sq) {
        const near = side.NearestPoint(aSeg);

        if (
          sqNorm(near.x - aSeg.A.x, near.y - aSeg.A.y) <
          sqNorm(nearest.x - aSeg.A.x, nearest.y - aSeg.A.y)
        ) {
          nearest = near;
        }
      }
    }

    if (closest_dist_sq === 0 || closest_dist_sq < aClearance * aClearance) {
      if (aActual) aActual.value = Math.trunc(Math.sqrt(closest_dist_sq));

      if (aLocation) {
        aLocation.x = nearest.x;
        aLocation.y = nearest.y;
      }

      return true;
    }

    return false;
  }

  /**
   * @return the top left corner of the rectangle.
   */
  GetPosition(): VECTOR2I {
    return this.m_p0;
  }

  /**
   * @return the size of the rectangle.
   */
  GetSize(): VECTOR2I {
    return { x: this.m_w, y: this.m_h };
  }

  override GetWidth(): number {
    return this.m_w;
  }

  GetHeight(): number {
    return this.m_h;
  }

  GetRadius(): number {
    return this.m_radius;
  }

  SetRadius(aRadius: number): void {
    this.m_radius = aRadius;
  }

  Move(aVector: Vec2): void {
    this.m_p0.x += aVector.x;
    this.m_p0.y += aVector.y;
  }

  /**
   * This function has limited utility for SHAPE_RECT as non-cartesian rotations will distort
   * the rectangle.  If you might need to handle non-90° rotations then the SHAPE_RECT should
   * first be converted to a SHAPE_SIMPLE which can then be free-rotated.
   */
  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {
    const c1 = RotatePoint(this.m_p0, aCenter, aAngle);
    const c2 = RotatePoint(
      { x: this.m_p0.x + this.m_w, y: this.m_p0.y + this.m_h },
      aCenter,
      aAngle,
    );

    this.m_p0 = { x: Math.min(c1.x, c2.x), y: Math.min(c1.y, c2.y) };
    this.m_w = Math.abs(c2.x - c1.x);
    this.m_h = Math.abs(c2.y - c1.y);
  }

  IsSolid(): boolean {
    return true;
  }

  Outline(): SHAPE_LINE_CHAIN {
    // TODO: we're DEPENDING on clients of this routine to use the actual arcs (if any)
    // inserted into the SHAPE_LINE_CHAIN.  They must NOT use the approximated segments
    // because we don't know what IUScale to generate them in.
    const buffer = new SHAPE_POLY_SET();
    this.TransformToPolygon(buffer, SHAPE_ARC.DefaultAccuracyForPCB(), ERROR_LOC.ERROR_INSIDE);
    return buffer.Outline(0);
  }

  override Format(aCplusPlus = true): string {
    return `SHAPE_RECT( ${this.m_p0.x}, ${this.m_p0.y}, ${this.m_w}, ${this.m_h}, ${this.m_radius});`;
  }

  TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void {
    if (this.m_radius > 0) {
      const rr = new ROUNDRECT(this, this.m_radius);
      rr.TransformToPolygon(aBuffer, aError);
      return;
    }

    const idx = aBuffer.NewOutline();
    const outline = aBuffer.Outline(idx);

    outline.Append(this.m_p0);
    outline.Append({ x: this.m_p0.x + this.m_w, y: this.m_p0.y });
    outline.Append({ x: this.m_p0.x + this.m_w, y: this.m_p0.y + this.m_h });
    outline.Append({ x: this.m_p0.x, y: this.m_p0.y + this.m_h });
    outline.SetClosed(true);
  }

  /**
   * Ensure that the height and width are positive.
   */
  Normalize(): void {
    if (this.m_w < 0) {
      this.m_w = -this.m_w;
      this.m_p0.x -= this.m_w;
    }

    if (this.m_h < 0) {
      this.m_h = -this.m_h;
      this.m_p0.y -= this.m_h;
    }
  }
}

const sqNorm = (dx: number, dy: number): number => dx * dx + dy * dy;
