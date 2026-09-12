// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `SHAPE_COMPOUND` (`geometry/shape_compound.h`, `src/geometry/shape_compound.cpp`). */

import type { Vec2, VECTOR2I } from '../math/vector2.js';
import { INT_MAX } from '../math/util.js';
import type { EDA_ANGLE } from './eda_angle.js';
import type { ERROR_LOC } from '../convert_basic_shapes_to_polygon.js';
import { BOX2I } from '../math/box2.js';
import type { SEG } from './seg.js';
import { type OutInt, SHAPE, SHAPE_TYPE } from './shape.js';
// the base class dispatches through these; see SHAPE_HOOKS
import './shape_collisions.js';
import './shape_nearest_points.js';
import './shape_poly_set.js';
import type { SHAPE_POLY_SET } from './shape_poly_set.js';

export class SHAPE_COMPOUND extends SHAPE {
  private m_cachedBBox: BOX2I = new BOX2I();
  private m_dirty: boolean;
  private m_shapes: SHAPE[];

  constructor();
  constructor(aShapes: SHAPE[]);
  constructor(aOther: SHAPE_COMPOUND);
  constructor(a?: SHAPE[] | SHAPE_COMPOUND) {
    super(SHAPE_TYPE.SH_COMPOUND);
    this.m_dirty = true;

    if (a === undefined) this.m_shapes = [];
    else if (a instanceof SHAPE_COMPOUND) this.m_shapes = a.Shapes().map((s) => s.Clone());
    else this.m_shapes = a;
  }

  override Clone(): SHAPE_COMPOUND {
    return new SHAPE_COMPOUND(this);
  }

  override Format(aCplusPlus = true): string {
    let ss = 'compound( ';

    for (const shape of this.m_shapes) ss += `${shape.Format()} `;

    return ss;
  }

  CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    let closest_dist = INT_MAX;
    let nearest: VECTOR2I = { x: 0, y: 0 };

    for (const item of this.m_shapes) {
      const actual = { value: 0 };
      const pn: VECTOR2I = { x: 0, y: 0 };

      if (
        item.CollideSeg(
          aSeg,
          aClearance,
          aActual || aLocation ? actual : undefined,
          aLocation ? pn : undefined,
        )
      ) {
        if (actual.value < closest_dist) {
          nearest = pn;
          closest_dist = actual.value;

          if (!aLocation && !aActual) break;
        } else if (aLocation && actual.value === closest_dist) {
          const dpn = (pn.x - aSeg.A.x) * (pn.x - aSeg.A.x) + (pn.y - aSeg.A.y) * (pn.y - aSeg.A.y);
          const dn =
            (nearest.x - aSeg.A.x) * (nearest.x - aSeg.A.x) +
            (nearest.y - aSeg.A.y) * (nearest.y - aSeg.A.y);

          if (dpn < dn) {
            nearest = pn;
          }
        }
      }
    }

    if (closest_dist === 0 || closest_dist < aClearance) {
      if (aLocation) {
        aLocation.x = nearest.x;
        aLocation.y = nearest.y;
      }

      if (aActual) aActual.value = closest_dist;

      return true;
    }

    return false;
  }

  Shapes(): readonly SHAPE[] {
    return this.m_shapes;
  }

  BBox(aClearance = 0): BOX2I {
    let bb = new BOX2I();

    if (this.m_shapes.length < 1) return bb;

    bb = this.m_shapes[0]!.BBox();

    for (let i = 1; i < this.m_shapes.length; i++) bb.Merge(this.m_shapes[i]!.BBox());

    return bb;
  }

  /** `Distance( const SEG& )`: `assert( false )` upstream. */
  DistanceSeg(aSeg: SEG): number {
    throw new Error('SHAPE_COMPOUND::Distance( SEG ) is not implemented upstream');
  }

  Move(aVector: Vec2): void {
    for (const item of this.m_shapes) item.Move(aVector);
  }

  AddShape(aShape: SHAPE): void {
    // Don't make clients deal with nested SHAPE_COMPOUNDs
    if (aShape instanceof SHAPE_COMPOUND) {
      const subshapes: SHAPE[] = [];
      aShape.GetIndexableSubshapes(subshapes);

      for (const subshape of subshapes) this.m_shapes.push(subshape.Clone());
    } else {
      this.m_shapes.push(aShape);
    }

    this.m_dirty = true;
  }

  Empty(): boolean {
    return this.m_shapes.length === 0;
  }

  Size(): number {
    return this.m_shapes.length;
  }

  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {
    for (const item of this.m_shapes) item.Rotate(aAngle, aCenter);
  }

  IsSolid(): boolean {
    return true;
  }

  UniqueSubshape(): SHAPE | null {
    return this.m_shapes.length !== 1 ? null : this.m_shapes[0]!;
  }

  override HasIndexableSubshapes(): boolean {
    return true;
  }

  override GetIndexableSubshapeCount(): number {
    return this.m_shapes.length;
  }

  override GetIndexableSubshapes(aSubshapes: SHAPE[]): void {
    aSubshapes.length = 0;
    for (const s of this.m_shapes) aSubshapes.push(s);
  }

  TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void {
    for (const item of this.m_shapes) item.TransformToPolygon(aBuffer, aError, aErrorLoc);
  }
}
