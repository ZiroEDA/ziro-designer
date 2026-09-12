// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `SHAPE_NULL` (`geometry/shape_null.h`): the empty shape. */

import type { Vec2, VECTOR2I } from '../math/vector2.js';
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

export class SHAPE_NULL extends SHAPE {
  constructor() {
    super(SHAPE_TYPE.SH_NULL);
  }

  override Clone(): SHAPE {
    return new SHAPE_NULL();
  }

  BBox(aClearance = 0): BOX2I {
    return new BOX2I();
  }

  CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    return false;
  }

  Move(aVector: Vec2): void {}

  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {}

  IsSolid(): boolean {
    return false;
  }

  TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void {}
}
