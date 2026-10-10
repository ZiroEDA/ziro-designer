// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `libs/kimath/include/geometry/ellipse.h` / `src/geometry/ellipse.cpp`: an ellipse or
 * elliptical arc, for importers of formats that have them natively (KiCad turns them into
 * Beziers, `TransformEllipseToBeziers`).
 *
 * `ELLIPSE<int>` and `ELLIPSE<double>` are one class here; the integer form's DXF-style
 * constructor narrows its minor radius, as `NumericType( MajorRadius * aRatio )` does.
 */
import { EDA_ANGLE, EDA_ANGLE_T, ANGLE_0, FULL_CIRCLE } from './eda_angle.js';
import type { Vec2 } from '../math/vector2.js';

export class ELLIPSE {
  Center: Vec2 = { x: 0, y: 0 };
  MajorRadius = 0;
  MinorRadius = 0;
  Rotation: EDA_ANGLE = ANGLE_0;
  StartAngle: EDA_ANGLE = ANGLE_0;
  EndAngle: EDA_ANGLE = FULL_CIRCLE;

  /**
   * Constructs an ellipse or elliptical arc.  The ellipse sweeps from aStartAngle to aEndAngle
   * in a counter-clockwise direction.
   */
  static fromRadii(
    aCenter: Vec2,
    aMajorRadius: number,
    aMinorRadius: number,
    aRotation: EDA_ANGLE,
    aStartAngle: EDA_ANGLE = ANGLE_0,
    aEndAngle: EDA_ANGLE = FULL_CIRCLE,
  ): ELLIPSE {
    const e = new ELLIPSE();
    e.Center = { x: aCenter.x, y: aCenter.y };
    e.MajorRadius = aMajorRadius;
    e.MinorRadius = aMinorRadius;
    e.Rotation = aRotation;
    e.StartAngle = aStartAngle;
    e.EndAngle = aEndAngle;
    return e;
  }

  /**
   * Constructs a DXF-style ellipse or elliptical arc, where the major axis is given by a point
   * rather than a radius, and therefore defines not only the major radius but also the rotation
   * of the ellipse. \a aInteger is `NumericType = int`: the radii are narrowed.
   */
  static fromMajorAxis(
    aCenter: Vec2,
    aMajor: Vec2,
    aRatio: number,
    aStartAngle: EDA_ANGLE = ANGLE_0,
    aEndAngle: EDA_ANGLE = FULL_CIRCLE,
    aInteger = false,
  ): ELLIPSE {
    const e = new ELLIPSE();
    e.Center = { x: aCenter.x, y: aCenter.y };
    e.StartAngle = aStartAngle;
    e.EndAngle = aEndAngle;
    const major = Math.hypot(aMajor.x, aMajor.y);
    e.MajorRadius = aInteger ? Math.trunc(major) : major;
    e.MinorRadius = aInteger ? Math.trunc(e.MajorRadius * aRatio) : e.MajorRadius * aRatio;
    e.Rotation = new EDA_ANGLE(Math.atan2(aMajor.y, aMajor.x), EDA_ANGLE_T.RADIANS_T);
    return e;
  }
}
