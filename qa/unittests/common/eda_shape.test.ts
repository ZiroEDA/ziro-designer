// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/common/test_eda_shape.cpp` (EdaShape), transcribed against
 * `EDA_SHAPE`. `ArcEditKeepsSmallSchematicRadius` and the point-editor half of
 * `PolygonBehaviorSurvivesAssignment` need KI_ARC_EDIT and
 * EDA_POLYGON_POINT_EDIT_BEHAVIOR, which arrive with the tools.
 */
import { describe, expect, it } from 'vitest';
import { EDA_SHAPE, FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });

/** `KI_TEST::IsWithin`. */
const IsWithin = (aValue: number, aNominal: number, aError: number): boolean =>
  aValue >= aNominal - aError && aValue <= aNominal + aError;

/** `KI_TEST::IsVecWithinTol`. */
const IsVecWithinTol = (aVec: Vec2, aExp: Vec2, aTol: number): boolean =>
  IsWithin(aVec.x, aExp.x, aTol) && IsWithin(aVec.y, aExp.y, aTol);

/** `KI_TEST::IsWithinWrapped`. */
function IsWithinWrapped(aValue: number, aNominal: number, aWrap: number, aError: number): boolean {
  let diff = (aValue - aNominal) % aWrap;
  if (diff > aWrap / 2.0) diff -= aWrap;
  else if (diff < -aWrap / 2.0) diff += aWrap;
  return Math.abs(diff) <= aError;
}

class EDA_SHAPE_MOCK extends EDA_SHAPE {
  constructor(aShapeType: SHAPE_T);
  constructor(aOther: EDA_SHAPE_MOCK);
  constructor(a: SHAPE_T | EDA_SHAPE_MOCK) {
    super();
    if (a instanceof EDA_SHAPE_MOCK) this.initEdaShapeFrom(a);
    else this.initEdaShape(a, 0, FILL_T.NO_FILL);
  }

  // the protected accessors the C++ test reaches (EDA_SHAPE_MOCK is a friend of nothing;
  // `getCenter` is public upstream)
}

describe('EdaShape', () => {
  interface SET_ANGLE_END_CASE {
    m_CaseName: string;
    m_Start: VECTOR2I;
    m_Center: VECTOR2I;
    m_Angle: number;
    m_ExpectedEndBeforeSwap: VECTOR2I;
    m_ExpectedStartEndSwapped: boolean;
  }

  const set_angle_end_cases: SET_ANGLE_END_CASE[] = [
    {
      m_CaseName: 'Issue 13626: clockwise semicircle',
      m_Start: V(-428880000, 117229160),
      m_Center: V(-430060565, 113472820),
      m_Angle: 180.0,
      m_ExpectedEndBeforeSwap: V(-431241130, 109716480),
      m_ExpectedStartEndSwapped: false,
    },
    {
      m_CaseName: 'Issue 13626: anticlockwise arc',
      m_Start: V(-431241130, 109716480),
      m_Center: V(-434923630, 112954230),
      m_Angle: -138.46654568595355,
      m_ExpectedEndBeforeSwap: V(-439827050, 112936200),
      m_ExpectedStartEndSwapped: true,
    },
  ];

  it('SetAngleAndEnd', () => {
    for (const c of set_angle_end_cases) {
      const shape = new EDA_SHAPE_MOCK(SHAPE_T.ARC);
      shape.SetStart(c.m_Start);
      shape.SetCenter(c.m_Center);

      shape.SetArcAngleAndEnd(new EDA_ANGLE(c.m_Angle, EDA_ANGLE_T.DEGREES_T), true);

      expect(shape.EndsSwapped(), c.m_CaseName).toBe(c.m_ExpectedStartEndSwapped);

      const newEnd = shape.EndsSwapped() ? shape.GetStart() : shape.GetEnd();

      expect(
        IsVecWithinTol(newEnd, c.m_ExpectedEndBeforeSwap, SHAPE_ARC.DefaultAccuracyForPCB()),
        `${c.m_CaseName}: end ${JSON.stringify(newEnd)}`,
      ).toBe(true);
    }
  });

  interface SET_ARC_GEOMETRY_CASE {
    m_CaseName: string;
    m_Start: VECTOR2I;
    m_Mid: VECTOR2I;
    m_End: VECTOR2I;
    m_ExpectedCenter: VECTOR2I;
    m_ExpectedRadius: number;
    m_ExpectedStartEndSwapped: boolean;
    m_ExpectedEndAfterSwap: VECTOR2I;
    m_ExpectedAngleAfterSwapDeg: number;
  }

  const set_arc_geometry_cases: SET_ARC_GEOMETRY_CASE[] = [
    {
      // Test that when setting an arc by start/mid/end, the winding
      // direction is correctly determined (in 15694, this was in FP_SHAPE,
      // but the logic has since been merged with EDA_SHAPE).
      m_CaseName: 'Issue 15694: clockwise arc',
      m_Start: V(10000000, 0),
      m_Mid: V(0, 10000000),
      m_End: V(-10000000, 0),
      m_ExpectedCenter: V(0, 0),
      m_ExpectedRadius: 10000000,
      m_ExpectedStartEndSwapped: false,
      m_ExpectedEndAfterSwap: V(-10000000, 0), // unchanged
      m_ExpectedAngleAfterSwapDeg: 180.0,
    },
    {
      m_CaseName: 'Issue 15694: anticlockwise arc',
      m_Start: V(-10000000, 0),
      m_Mid: V(0, 10000000),
      m_End: V(10000000, 0),
      m_ExpectedCenter: V(0, 0),
      m_ExpectedRadius: 10000000,
      m_ExpectedStartEndSwapped: true,
      m_ExpectedEndAfterSwap: V(10000000, 0), // the start is the end after swapping
      m_ExpectedAngleAfterSwapDeg: 180.0, // angle is positive after swapping
    },
  ];

  it('SetArcGeometry', () => {
    const angle_tol = 0.1;

    for (const c of set_arc_geometry_cases) {
      const shape = new EDA_SHAPE_MOCK(SHAPE_T.ARC);

      shape.SetArcGeometry(c.m_Start, c.m_Mid, c.m_End);

      const center = shape.getCenter();

      expect(
        IsVecWithinTol(center, c.m_ExpectedCenter, SHAPE_ARC.DefaultAccuracyForPCB()),
        c.m_CaseName,
      ).toBe(true);

      const radius = shape.GetRadius();

      expect(
        IsWithin(radius, c.m_ExpectedRadius, SHAPE_ARC.DefaultAccuracyForPCB()),
        c.m_CaseName,
      ).toBe(true);

      expect(shape.EndsSwapped(), c.m_CaseName).toBe(c.m_ExpectedStartEndSwapped);

      const newEnd = shape.EndsSwapped() ? shape.GetStart() : shape.GetEnd();

      expect(
        IsVecWithinTol(newEnd, c.m_ExpectedEndAfterSwap, SHAPE_ARC.DefaultAccuracyForPCB()),
        c.m_CaseName,
      ).toBe(true);

      const angle = shape.GetArcAngle();

      expect(
        IsWithinWrapped(angle.AsDegrees(), c.m_ExpectedAngleAfterSwapDeg, 360.0, angle_tol),
        c.m_CaseName,
      ).toBe(true);
    }
  });

  /**
   * `PolygonBehaviorSurvivesAssignment`, the EDA_SHAPE half: `operator=`
   * replaces m_poly with a fresh allocation and the points survive.
   */
  it('PolygonSurvivesAssignment', () => {
    const shape = new EDA_SHAPE_MOCK(SHAPE_T.POLY);

    const poly = shape.GetPolyShape();
    poly.NewOutline();
    poly.Append(V(0, 0));
    poly.Append(V(1000000, 0));
    poly.Append(V(1000000, 1000000));

    expect(shape.GetPointCount()).toBe(3);

    const copy = new EDA_SHAPE_MOCK(shape);
    shape.assignEdaShape(copy);

    // After assignment, shape.m_poly is a fresh allocation.
    expect(shape.GetPolyShape()).not.toBe(poly);
    expect(shape.GetPointCount()).toBe(3);
    expect(shape.GetPolyShape().CVertex(2)).toEqual(V(1000000, 1000000));
    expect(shape.equalsEdaShape(copy)).toBe(true);
  });
});
