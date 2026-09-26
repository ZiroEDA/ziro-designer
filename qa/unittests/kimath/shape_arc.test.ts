// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_shape_arc.cpp` (ShapeArc), transcribed
 * against the `SHAPE_ARC` class.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_TYPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  SHAPE_POLY_SET,
  TransformArcToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { INT_MAX } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type Vec2, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { IsWithin } from './fixtures_geometry.js';
import { ArePointsNearCircle } from './geom_test_utils.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });
const DEG = (d: number): EDA_ANGLE => new EDA_ANGLE(d, EDA_ANGLE_T.DEGREES_T);

/** `KI_TEST::IsVecWithinTol`. */
const IsVecWithinTol = (aVec: Vec2, aExp: Vec2, aTol: number): boolean =>
  IsWithin(aVec.x, aExp.x, aTol) && IsWithin(aVec.y, aExp.y, aTol);

/** `KI_TEST::IsBoxWithinTol`. */
const IsBoxWithinTol = (aBox: BOX2I, aExp: BOX2I, aTol: number): boolean =>
  IsVecWithinTol(aBox.GetPosition(), aExp.GetPosition(), aTol) &&
  IsVecWithinTol(aBox.GetSize(), aExp.GetSize(), aTol * 2);

/** `KI_TEST::IsWithinWrapped`. */
function IsWithinWrapped(aValue: number, aNominal: number, aWrap: number, aError: number): boolean {
  // Compute shortest signed distance on a ring
  let diff = (aValue - aNominal) % aWrap;

  if (diff > aWrap / 2.0) diff -= aWrap;
  else if (diff < -aWrap / 2.0) diff += aWrap;

  return Math.abs(diff) <= aError;
}

/**
 * All properties of an arc (depending on how it's constructed, some of these
 * might be the same as the constructor params)
 */
interface ARC_PROPERTIES {
  m_center_point: VECTOR2I;
  m_start_point: VECTOR2I;
  m_end_point: VECTOR2I;
  m_center_angle: number;
  m_start_angle: number;
  m_end_angle: number;
  m_radius: number;
  m_bbox: BOX2I;
}

const props = (
  center: [number, number],
  start: [number, number],
  end: [number, number],
  centerAngle: number,
  startAngle: number,
  endAngle: number,
  radius: number,
  bbox: [[number, number], [number, number]] = [
    [0, 0],
    [0, 0],
  ],
): ARC_PROPERTIES => ({
  m_center_point: V(center[0], center[1]),
  m_start_point: V(start[0], start[1]),
  m_end_point: V(end[0], end[1]),
  m_center_angle: centerAngle,
  m_start_angle: startAngle,
  m_end_angle: endAngle,
  m_radius: radius,
  m_bbox: new BOX2I(V(bbox[0][0], bbox[0][1]), V(bbox[1][0], bbox[1][1])),
});

/**
 * Check a #SHAPE_ARC against a given set of geometric properties
 * @param aArc Arc to test
 * @param aProps Properties to test against
 * @param aSynErrIU Permitted error for synthetic points and dimensions (currently radius and center)
 */
function CheckArcGeom(aArc: SHAPE_ARC, aProps: ARC_PROPERTIES, aSynErrIU = 1, ctx = ''): void {
  // Angular error - note this can get quite large for very small arcs,
  // as the integral position rounding has a relatively greater effect
  const angle_tol_deg = 2.0;

  // Position error - rounding to nearest integer
  const pos_tol = 1;

  expect(IsVecWithinTol(aProps.m_start_point, aProps.m_start_point, pos_tol), `${ctx} start`).toBe(
    true,
  );

  expect(
    IsVecWithinTol(aArc.GetP1(), aProps.m_end_point, pos_tol),
    `${ctx} end ${JSON.stringify(aArc.GetP1())}`,
  ).toBe(true);

  expect(
    IsVecWithinTol(aArc.GetCenter(), aProps.m_center_point, aSynErrIU),
    `${ctx} center ${JSON.stringify(aArc.GetCenter())}`,
  ).toBe(true);

  expect(
    IsWithinWrapped(
      aArc.GetCentralAngle().AsDegrees(),
      aProps.m_center_angle,
      360.0,
      angle_tol_deg,
    ),
    `${ctx} central angle ${aArc.GetCentralAngle().AsDegrees()}`,
  ).toBe(true);

  expect(
    IsWithinWrapped(aArc.GetStartAngle().AsDegrees(), aProps.m_start_angle, 360.0, angle_tol_deg),
    `${ctx} start angle ${aArc.GetStartAngle().AsDegrees()}`,
  ).toBe(true);

  expect(
    IsWithinWrapped(aArc.GetEndAngle().AsDegrees(), aProps.m_end_angle, 360.0, angle_tol_deg),
    `${ctx} end angle ${aArc.GetEndAngle().AsDegrees()}`,
  ).toBe(true);

  expect(
    IsWithin(aArc.GetRadius(), aProps.m_radius, aSynErrIU),
    `${ctx} radius ${aArc.GetRadius()}`,
  ).toBe(true);

  // Angle normalization contracts
  expect(aArc.GetStartAngle().AsDegrees(), ctx).toBeGreaterThanOrEqual(0.0);
  expect(aArc.GetStartAngle().AsDegrees(), ctx).toBeLessThanOrEqual(360.0);

  expect(aArc.GetEndAngle().AsDegrees(), ctx).toBeGreaterThanOrEqual(0.0);
  expect(aArc.GetEndAngle().AsDegrees(), ctx).toBeLessThanOrEqual(360.0);

  expect(aArc.GetCentralAngle().AsDegrees(), ctx).toBeGreaterThanOrEqual(-360.0);
  expect(aArc.GetCentralAngle().AsDegrees(), ctx).toBeLessThanOrEqual(360.0);

  /// Check the chord agrees
  const chord = aArc.GetChord();

  expect(IsVecWithinTol(chord.A, aProps.m_start_point, pos_tol), `${ctx} chord A`).toBe(true);

  expect(IsVecWithinTol(chord.B, aProps.m_end_point, pos_tol), `${ctx} chord B`).toBe(true);

  /// All arcs are solid
  expect(aArc.IsSolid(), ctx).toBe(true);

  expect(
    IsBoxWithinTol(aArc.BBox(), aProps.m_bbox, pos_tol),
    `${ctx} bbox ${aArc.BBox().Format()}`,
  ).toBe(true);

  /// Collisions will be checked elsewhere.
}

/**
 * Check an arcs geometry and other class functions
 */
function CheckArc(aArc: SHAPE_ARC, aProps: ARC_PROPERTIES, aSynErrIU = 1, ctx = ''): void {
  // Check the original arc
  CheckArcGeom(aArc, aProps, aSynErrIU, ctx);

  // Test the Clone function (also tests copy-ctor)
  const new_shape = aArc.Clone();

  expect(new_shape.Type(), ctx).toBe(SHAPE_TYPE.SH_ARC);

  const new_arc = new_shape as SHAPE_ARC;

  expect(new_arc instanceof SHAPE_ARC, ctx).toBe(true);

  /// Should have identical geom props
  CheckArcGeom(new_arc, aProps, aSynErrIU, `${ctx} (clone)`);
}

/** Info to set up an arc by start, mid and end points */
interface ARC_START_MID_END {
  m_start_point: VECTOR2I;
  m_mid_point: VECTOR2I;
  m_end_point: VECTOR2I;
}

/** Info to set up an arc by centre, start point and angle */
interface ARC_CENTRE_PT_ANGLE {
  m_center_point: VECTOR2I;
  m_start_point: VECTOR2I;
  m_center_angle: number;
}

describe('ShapeArc', () => {
  /** Check correct handling of filter strings (as used by WX) */
  it('NullCtor', () => {
    const arc = new SHAPE_ARC();

    expect(arc.GetWidth()).toBe(0);

    const null_props = props([0, 0], [0, 0], [0, 0], 0, 0, 0, 0);

    CheckArc(arc, null_props);
  });

  interface ARC_SME_CASE {
    m_case_name: string;
    m_geom: ARC_START_MID_END;
    m_width: number;
    m_properties: ARC_PROPERTIES;
  }

  const arc_sme_cases: ARC_SME_CASE[] = [
    {
      m_case_name: 'S(-100,0), M(0,100), E(100,0)',
      m_geom: { m_start_point: V(-100, 0), m_mid_point: V(0, 100), m_end_point: V(100, 0) },
      m_width: 0,
      m_properties: props([0, 0], [-100, 0], [100, 0], 180, 180, 0, 100, [
        [-100, 0],
        [200, 100],
      ]),
    },
    {
      m_case_name: 'S(100,0), M(0,100), E(-100,0) (reversed)',
      m_geom: { m_start_point: V(100, 0), m_mid_point: V(0, 100), m_end_point: V(-100, 0) },
      m_width: 0,
      m_properties: props([0, 0], [100, 0], [-100, 0], -180, 0, 180, 100, [
        [-100, 0],
        [200, 100],
      ]),
    },
    {
      // This data has a midpoint not exactly at the midway point of the arc.
      // This should be corrected by the constructor.
      // The mid point should be at about (-71, -71) for a 270 degree arc, with the
      // bottom right quadrant open.
      m_case_name: 'S(100,0), M(-100,0), E(0,100) (bad midpoint)',
      m_geom: { m_start_point: V(100, 0), m_mid_point: V(-100, 0), m_end_point: V(0, 100) },
      m_width: 0,
      m_properties: props([0, 0], [100, 0], [0, 100], -270, 0, 90, 100, [
        [-100, -100],
        [200, 200],
      ]),
    },
  ];

  it('BasicSMEGeom', () => {
    for (const c of arc_sme_cases) {
      const this_arc = new SHAPE_ARC(
        c.m_geom.m_start_point,
        c.m_geom.m_mid_point,
        c.m_geom.m_end_point,
        c.m_width,
      );

      CheckArc(this_arc, c.m_properties, 1, c.m_case_name);
    }
  });

  interface ARC_CPA_CASE {
    m_case_name: string;
    m_geom: ARC_CENTRE_PT_ANGLE;
    m_width: number;
    m_properties: ARC_PROPERTIES;
  }

  const arc_cases: ARC_CPA_CASE[] = [
    {
      m_case_name: 'C(0,0) 114 + 360 degree',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(-306451, 687368), m_center_angle: 360 },
      m_width: 0,
      m_properties: props(
        [0, 0],
        [-306451, 687368],
        [-306451, 687368],
        360,
        113.95929,
        113.95929,
        752587,
        [
          [-752587, -752587],
          [1505174, 1505174],
        ],
      ),
    },
    {
      m_case_name: 'C(0,0) 180 + 360 degree',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(-100, 0), m_center_angle: 360 },
      m_width: 0,
      m_properties: props([0, 0], [-100, 0], [-100, 0], 360, 180, 180, 100, [
        [-100, -100],
        [200, 200],
      ]),
    },
    {
      m_case_name: 'C(0,0) 180 + 90 degree',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(-100, 0), m_center_angle: 90 },
      m_width: 0,
      m_properties: props([0, 0], [-100, 0], [0, -100], 90, 180, 270, 100, [
        [-100, -100],
        [100, 100],
      ]),
    },
    {
      m_case_name: 'C(100,200)  0 - 30 degree',
      m_geom: { m_center_point: V(100, 200), m_start_point: V(300, 200), m_center_angle: -30 },
      m_width: 0,
      // 200 * sin(30) = 100, 200* cos(30) = 173
      m_properties: props([100, 200], [300, 200], [273, 100], -30, 0, 330, 200, [
        [273, 100],
        [27, 100],
      ]),
    },
    {
      // This is a "fan shape" which includes the top quadrant point,
      // so it exercises the bounding box code (centre and end points
      // do not contain the top quadrant)
      m_case_name: 'C(0,0) 30 + 120 degree',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(17320, 10000), m_center_angle: 120 },
      m_width: 0,
      // bbox defined by: centre, top quadrant point, two endpoints
      m_properties: props([0, 0], [17320, 10000], [-17320, 10000], 120, 30, 150, 20000, [
        [-17320, 10000],
        [17320 * 2, 10000],
      ]),
    },
    {
      // An arc that covers three quadrant points (L/R, bottom)
      m_case_name: 'C(0,0) 150 + 240 degree',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(-17320, 10000), m_center_angle: 240 },
      m_width: 0,
      // bbox defined by: L/R quads, bottom quad and start/end
      m_properties: props([0, 0], [-17320, 10000], [17320, 10000], 240, 150, 30, 20000, [
        [-20000, -20000],
        [40000, 30000],
      ]),
    },
    {
      // Same as above but reverse direction
      m_case_name: 'C(0,0) 30 - 300 degree',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(17320, 10000), m_center_angle: -240 },
      m_width: 0,
      // bbox defined by: L/R quads, bottom quad and start/end
      m_properties: props([0, 0], [17320, 10000], [-17320, 10000], -240, 30, 150, 20000, [
        [-20000, -20000],
        [40000, 30000],
      ]),
    },
  ];

  it('BasicCPAGeom', () => {
    for (const c of arc_cases) {
      const this_arc = new SHAPE_ARC(
        c.m_geom.m_center_point,
        c.m_geom.m_start_point,
        DEG(c.m_geom.m_center_angle),
        c.m_width,
      );

      CheckArc(this_arc, c.m_properties, 1, c.m_case_name);
    }
  });

  /** Info to set up an arc by tangent to two segments and a radius */
  interface ARC_TTR_CASE {
    m_case_name: string;
    m_geom: { m_segment_1: SEG; m_segment_2: SEG; m_radius: number };
    m_width: number;
    m_properties: ARC_PROPERTIES;
  }

  const arc_ttr_cases: ARC_TTR_CASE[] = [
    {
      m_case_name: '90 degree segments intersecting',
      m_geom: {
        m_segment_1: new SEG(0, 0, 0, 1000),
        m_segment_2: new SEG(0, 0, 1000, 0),
        m_radius: 1000,
      },
      m_width: 0,
      m_properties: props(
        [1000, 1000],
        [0, 1000], //start on first segment
        [1000, 0], //end on second segment
        90, //positive angle due to start/end
        180,
        270,
        1000,
        [
          [0, 0],
          [1000, 1000],
        ],
      ),
    },
    {
      m_case_name: '45 degree segments intersecting',
      m_geom: {
        m_segment_1: new SEG(0, 0, 0, 1000),
        m_segment_2: new SEG(0, 0, 1000, 1000),
        m_radius: 1000,
      },
      m_width: 0,
      m_properties: props(
        [1000, 2414],
        [0, 2414], //start on first segment
        [1707, 1707], //end on second segment
        135, //positive angle due to start/end
        180,
        315,
        1000,
        [
          [0, 1414],
          [1707, 1000],
        ],
      ),
    },
    {
      m_case_name: '135 degree segments intersecting',
      m_geom: {
        m_segment_1: new SEG(0, 0, 0, 1000),
        m_segment_2: new SEG(0, 0, 1000, -1000),
        m_radius: 1000,
      },
      m_width: 0,
      m_properties: props(
        [1000, 414],
        [0, 414], //start on first segment ( radius * tan(45 /2) )
        [293, -293], //end on second segment (radius * 1-cos(45)) )
        45, //positive angle due to start/end
        180,
        225,
        1000,
        [
          [0, -293],
          [293, 707],
        ],
      ),
    },
  ];

  it('BasicTTRGeom', () => {
    for (const c of arc_ttr_cases) {
      for (let testCase = 0; testCase < 8; ++testCase) {
        let seg1 = new SEG(c.m_geom.m_segment_1);
        let seg2 = new SEG(c.m_geom.m_segment_2);
        const p = { ...c.m_properties };

        if (testCase > 3) {
          //Swap input segments.
          seg1 = new SEG(c.m_geom.m_segment_2);
          seg2 = new SEG(c.m_geom.m_segment_1);

          //The result should swap start and end points and invert the angles:
          p.m_end_point = c.m_properties.m_start_point;
          p.m_start_point = c.m_properties.m_end_point;
          p.m_start_angle = c.m_properties.m_end_angle;
          p.m_end_angle = c.m_properties.m_start_angle;
          p.m_center_angle = -c.m_properties.m_center_angle;
        }

        //Test all combinations of start and end points for the segments
        if (testCase % 4 === 1 || testCase % 4 === 3) {
          //Swap start and end points for seg1
          const temp = seg1.A;
          seg1.A = seg1.B;
          seg1.B = temp;
        }

        if (testCase % 4 === 2 || testCase % 4 === 3) {
          //Swap start and end points for seg2
          const temp = seg2.A;
          seg2.A = seg2.B;
          seg2.B = temp;
        }

        const this_arc = new SHAPE_ARC(seg1, seg2, c.m_geom.m_radius, c.m_width);

        // Error of 4 IU permitted for the center and radius calculation
        CheckArc(this_arc, p, SHAPE_ARC.MIN_PRECISION_IU, `${c.m_case_name} #${testCase}`);
      }
    }
  });

  /** Info to set up an arc start, end and center */
  interface ARC_SEC_CASE {
    m_case_name: string;
    m_geom: { m_start: VECTOR2I; m_end: VECTOR2I; m_center: VECTOR2I };
    /// clockwise or anti-clockwise?
    m_clockwise: boolean;
    /// Expected mid-point of the arc
    m_expected_mid: VECTOR2I;
  }

  const arc_sec_cases: ARC_SEC_CASE[] = [
    {
      m_case_name: '180 deg, clockwise',
      m_geom: { m_start: V(100, 0), m_end: V(0, 0), m_center: V(50, 0) },
      m_clockwise: true,
      m_expected_mid: V(50, -50),
    },
    {
      m_case_name: '180 deg, anticlockwise',
      m_geom: { m_start: V(100, 0), m_end: V(0, 0), m_center: V(50, 0) },
      m_clockwise: false,
      m_expected_mid: V(50, 50),
    },
    {
      m_case_name: '180 deg flipped, clockwise',
      m_geom: { m_start: V(0, 0), m_end: V(100, 0), m_center: V(50, 0) },
      m_clockwise: true,
      m_expected_mid: V(50, 50),
    },
    {
      m_case_name: '180 deg flipped, anticlockwise',
      m_geom: { m_start: V(0, 0), m_end: V(100, 0), m_center: V(50, 0) },
      m_clockwise: false,
      m_expected_mid: V(50, -50),
    },
    {
      m_case_name: '90 deg, clockwise',
      m_geom: { m_start: V(-100, 0), m_end: V(0, 100), m_center: V(0, 0) },
      m_clockwise: true,
      m_expected_mid: V(-71, 71),
    },
    {
      m_case_name: '90 deg, anticlockwise',
      m_geom: { m_start: V(-100, 0), m_end: V(0, 100), m_center: V(0, 0) },
      m_clockwise: false,
      m_expected_mid: V(71, -71),
    },
  ];

  it('BasicSECGeom', () => {
    for (const c of arc_sec_cases) {
      const start = c.m_geom.m_start;
      const end = c.m_geom.m_end;
      const center = c.m_geom.m_center;
      const cw = c.m_clockwise;

      const this_arc = new SHAPE_ARC();
      this_arc.ConstructFromStartEndCenter(start, end, center, cw);

      expect(this_arc.GetArcMid(), c.m_case_name).toEqual(c.m_expected_mid);
    }
  });

  interface ARC_CICLE_COLLIDE_CASE {
    m_case_name: string;
    m_geom: ARC_START_MID_END;
    m_arc_clearance: number;
    m_circle_center: VECTOR2I;
    m_circle_radius: number;
    m_exp_result: boolean;
    m_exp_distance: number;
  }

  const arc_circle_collide_cases: ARC_CICLE_COLLIDE_CASE[] = [
    {
      m_case_name: ' Issue 20336, large arc',
      m_geom: {
        m_start_point: V(183000000, 65710001),
        m_mid_point: V(150496913, 147587363),
        m_end_point: V(116291153, 66406583),
      },
      m_arc_clearance: 2000000 / 2,
      m_circle_center: V(116300000, 133100000),
      m_circle_radius: 300000,
      m_exp_result: true,
      m_exp_distance: 53319,
    },
  ];

  it('CollideCircle', () => {
    for (const c of arc_circle_collide_cases) {
      const arc = new SHAPE_ARC(
        c.m_geom.m_start_point,
        c.m_geom.m_mid_point,
        c.m_geom.m_end_point,
        0,
      );
      const circle = new SHAPE_CIRCLE(c.m_circle_center, c.m_circle_radius);

      // Test a zero width arc (distance should equal the clearance)
      {
        const dist = { value: -1 };
        expect(
          arc.Collide(circle, c.m_arc_clearance, dist),
          `${c.m_case_name}: Test Clearance`,
        ).toBe(c.m_exp_result);
        expect(dist.value, `${c.m_case_name}: Test Clearance`).toBe(c.m_exp_distance);
      }

      // Test by changing the width of the arc (distance should equal zero)
      {
        const dist = { value: -1 };
        arc.SetWidth(c.m_arc_clearance * 2);
        expect(arc.Collide(circle, 0, dist), `${c.m_case_name}: Test Width`).toBe(c.m_exp_result);

        if (c.m_exp_result) expect(dist.value, `${c.m_case_name}: Test Width`).toBe(0);
        else expect(dist.value, `${c.m_case_name}: Test Width`).toBe(-1);
      }
    }
  });

  interface ARC_PT_COLLIDE_CASE {
    m_case_name: string;
    m_geom: ARC_CENTRE_PT_ANGLE;
    m_arc_clearance: number;
    m_point: VECTOR2I;
    m_exp_result: boolean;
    m_exp_distance: number;
  }

  const ptCase = (
    name: string,
    geom: [[number, number], [number, number], number],
    cl: number,
    pt: [number, number],
    res: boolean,
    dist: number,
  ): ARC_PT_COLLIDE_CASE => ({
    m_case_name: name,
    m_geom: {
      m_center_point: V(geom[0][0], geom[0][1]),
      m_start_point: V(geom[1][0], geom[1][1]),
      m_center_angle: geom[2],
    },
    m_arc_clearance: cl,
    m_point: V(pt[0], pt[1]),
    m_exp_result: res,
    m_exp_distance: dist,
  });

  const arc_pt_collide_cases: ARC_PT_COLLIDE_CASE[] = [
    ptCase(' 270deg, 0 cl, 0   deg    ', [[0, 0], [100, 0], 270.0], 0, [100, 0], true, 0),
    ptCase(' 270deg, 0 cl, 90  deg    ', [[0, 0], [100, 0], 270.0], 0, [0, 100], true, 0),
    ptCase(' 270deg, 0 cl, 180 deg    ', [[0, 0], [100, 0], 270.0], 0, [-100, 0], true, 0),
    ptCase(' 270deg, 0 cl, 270 deg    ', [[0, 0], [100, 0], 270.0], 0, [0, -100], true, 0),
    ptCase(' 270deg, 0 cl, 45  deg    ', [[0, 0], [100, 0], 270.0], 0, [71, 71], true, 0),
    ptCase(' 270deg, 0 cl, -45 deg    ', [[0, 0], [100, 0], 270.0], 0, [71, -71], false, -1),
    ptCase('-270deg, 0 cl, 0   deg    ', [[0, 0], [100, 0], -270.0], 0, [100, 0], true, 0),
    ptCase('-270deg, 0 cl, 90  deg    ', [[0, 0], [100, 0], -270.0], 0, [0, 100], true, 0),
    ptCase('-270deg, 0 cl, 180 deg    ', [[0, 0], [100, 0], -270.0], 0, [-100, 0], true, 0),
    ptCase('-270deg, 0 cl, 270 deg    ', [[0, 0], [100, 0], -270.0], 0, [0, -100], true, 0),
    ptCase('-270deg, 0 cl, 45  deg    ', [[0, 0], [100, 0], -270.0], 0, [71, 71], false, -1),
    ptCase('-270deg, 0 cl, -45 deg    ', [[0, 0], [100, 0], -270.0], 0, [71, -71], true, 0),
    ptCase(' 270deg, 5 cl, 0   deg, 5 pos X', [[0, 0], [100, 0], 270.0], 5, [105, 0], true, 5),
    ptCase(' 270deg, 5 cl, 0  deg, 5 pos Y', [[0, 0], [100, 0], 270.0], 5, [100, -5], true, 5),
    ptCase(' 270deg, 5 cl, 90  deg, 5 pos', [[0, 0], [100, 0], 270.0], 5, [0, 105], true, 5),
    ptCase(' 270deg, 5 cl, 180 deg, 5 pos', [[0, 0], [100, 0], 270.0], 5, [-105, 0], true, 5),
    ptCase(' 270deg, 5 cl, 270 deg, 5 pos', [[0, 0], [100, 0], 270.0], 5, [0, -105], true, 5),
    ptCase(' 270deg, 5 cl, 0   deg, 5 neg', [[0, 0], [100, 0], 270.0], 5, [105, 0], true, 5),
    ptCase(' 270deg, 5 cl, 90  deg, 5 neg', [[0, 0], [100, 0], 270.0], 5, [0, 105], true, 5),
    ptCase(' 270deg, 5 cl, 180 deg, 5 neg', [[0, 0], [100, 0], 270.0], 5, [-105, 0], true, 5),
    ptCase(' 270deg, 5 cl, 270 deg, 5 neg', [[0, 0], [100, 0], 270.0], 5, [0, -105], true, 5),
    ptCase(' 270deg, 5 cl, 45  deg, 5 pos', [[0, 0], [100, 0], 270.0], 5, [74, 75], true, 5), // 74.246, -74.246
    ptCase(' 270deg, 5 cl, -45 deg, 5 pos', [[0, 0], [100, 0], 270.0], 5, [74, -75], false, -1), //74.246, -74.246
    ptCase(' 270deg, 5 cl, 45  deg, 5 neg', [[0, 0], [100, 0], 270.0], 5, [67, 67], true, 5), // 67.17, 67.17
    ptCase(' 270deg, 5 cl, -45 deg, 5 neg', [[0, 0], [100, 0], 270.0], 5, [67, -67], false, -1), // 67.17, -67.17
    ptCase(' 270deg, 4 cl, 0   deg pos', [[0, 0], [100, 0], 270.0], 4, [105, 0], false, -1),
    ptCase(' 270deg, 4 cl, 90  deg pos', [[0, 0], [100, 0], 270.0], 4, [0, 105], false, -1),
    ptCase(' 270deg, 4 cl, 180 deg pos', [[0, 0], [100, 0], 270.0], 4, [-105, 0], false, -1),
    ptCase(' 270deg, 4 cl, 270 deg pos', [[0, 0], [100, 0], 270.0], 4, [0, -105], false, -1),
    ptCase('  90deg, 0 cl,   0 deg    ', [[0, 0], [71, -71], 90.0], 0, [71, -71], true, 0),
    ptCase('  90deg, 0 cl,  45 deg    ', [[0, 0], [71, -71], 90.0], 0, [100, 0], true, 0),
    ptCase('  90deg, 0 cl,  90 deg    ', [[0, 0], [71, -71], 90.0], 0, [71, 71], true, 0),
    ptCase('  90deg, 0 cl, 135 deg    ', [[0, 0], [71, -71], 90.0], 0, [0, -100], false, -1),
    ptCase('  90deg, 0 cl, -45 deg    ', [[0, 0], [71, -71], 90.0], 0, [0, 100], false, -1),
    ptCase(' -90deg, 0 cl,   0 deg    ', [[0, 0], [71, 71], -90.0], 0, [71, -71], true, 0),
    ptCase(' -90deg, 0 cl,  45 deg    ', [[0, 0], [71, 71], -90.0], 0, [100, 0], true, 0),
    ptCase(' -90deg, 0 cl,  90 deg    ', [[0, 0], [71, 71], -90.0], 0, [71, 71], true, 0),
    ptCase(' -90deg, 0 cl, 135 deg    ', [[0, 0], [71, 71], -90.0], 0, [0, -100], false, -1),
    ptCase(' -90deg, 0 cl, -45 deg    ', [[0, 0], [71, 71], -90.0], 0, [0, 100], false, -1),
    ptCase(
      'issue 11358 collide',
      [[119888000, 60452000], [120904000, 60452000], 360.0],
      0,
      [120395500, 59571830],
      true,
      0,
    ),
    ptCase(
      'issue 11358 dist',
      [[119888000, 60452000], [120904000, 60452000], 360.0],
      100,
      [118872050, 60452000],
      true,
      50,
    ),
  ];

  it('CollidePt', () => {
    for (const c of arc_pt_collide_cases) {
      const arc = new SHAPE_ARC(
        c.m_geom.m_center_point,
        c.m_geom.m_start_point,
        DEG(c.m_geom.m_center_angle),
      );

      // Test a zero width arc (distance should equal the clearance)
      {
        const dist = { value: -1 };
        expect(
          arc.Collide(c.m_point, c.m_arc_clearance, dist),
          `${c.m_case_name}: Test Clearance`,
        ).toBe(c.m_exp_result);
        expect(dist.value, `${c.m_case_name}: Test Clearance`).toBe(c.m_exp_distance);
      }

      // Test by changing the width of the arc (distance should equal zero)
      {
        const dist = { value: -1 };
        arc.SetWidth(c.m_arc_clearance * 2);
        expect(arc.Collide(c.m_point, 0, dist), `${c.m_case_name}: Test Width`).toBe(
          c.m_exp_result,
        );

        if (c.m_exp_result) expect(dist.value, `${c.m_case_name}: Test Width`).toBe(0);
        else expect(dist.value, `${c.m_case_name}: Test Width`).toBe(-1);
      }
    }
  });

  interface ARC_SEG_COLLIDE_CASE {
    m_case_name: string;
    m_geom: ARC_CENTRE_PT_ANGLE;
    m_arc_clearance: number;
    m_seg: SEG;
    m_exp_result: boolean;
    m_exp_distance: number;
    m_collide_point: VECTOR2I;
  }

  const segCase = (
    name: string,
    geom: [[number, number], [number, number], number],
    cl: number,
    seg: [[number, number], [number, number]],
    res: boolean,
    dist: number,
    pt: [number, number],
  ): ARC_SEG_COLLIDE_CASE => ({
    m_case_name: name,
    m_geom: {
      m_center_point: V(geom[0][0], geom[0][1]),
      m_start_point: V(geom[1][0], geom[1][1]),
      m_center_angle: geom[2],
    },
    m_arc_clearance: cl,
    m_seg: new SEG(V(seg[0][0], seg[0][1]), V(seg[1][0], seg[1][1])),
    m_exp_result: res,
    m_exp_distance: dist,
    m_collide_point: V(pt[0], pt[1]),
  });

  const arc_seg_collide_cases: ARC_SEG_COLLIDE_CASE[] = [
    segCase(
      '0   deg    ',
      [[0, 0], [100, 0], 270.0],
      0,
      [
        [100, 0],
        [50, 0],
      ],
      true,
      0,
      [100, 0],
    ),
    segCase(
      '90  deg    ',
      [[0, 0], [100, 0], 270.0],
      0,
      [
        [0, 100],
        [0, 50],
      ],
      true,
      0,
      [0, 100],
    ),
    segCase(
      '180 deg    ',
      [[0, 0], [100, 0], 270.0],
      0,
      [
        [-100, 0],
        [-50, 0],
      ],
      true,
      0,
      [-100, 0],
    ),
    segCase(
      '270 deg    ',
      [[0, 0], [100, 0], 270.0],
      0,
      [
        [0, -100],
        [0, -50],
      ],
      true,
      0,
      [0, -100],
    ),
    segCase(
      '45  deg    ',
      [[0, 0], [100, 0], 270.0],
      0,
      [
        [71, 71],
        [35, 35],
      ],
      true,
      0,
      [70, 70],
    ),
    segCase(
      '-45 deg    ',
      [[0, 0], [100, 0], 270.0],
      0,
      [
        [71, -71],
        [35, -35],
      ],
      false,
      -1,
      [0, 0],
    ),
    segCase(
      'seg inside arc start',
      [[0, 0], [71, -71], 90.0],
      10,
      [
        [90, 0],
        [-35, 0],
      ],
      true,
      10,
      [100, 0],
    ),
    segCase(
      'seg inside arc end',
      [[0, 0], [71, -71], 90.0],
      10,
      [
        [-35, 0],
        [90, 0],
      ],
      true,
      10,
      [100, 0],
    ),
    segCase(
      'large diameter arc',
      [[172367922, 82282076], [162530000, 92120000], -45.0],
      433300,
      [
        [162096732, 92331236],
        [162096732, 78253268],
      ],
      true,
      433268,
      [162530000, 92120000],
    ),
    segCase(
      'upside down collide',
      [[26250000, 16520000], [28360000, 16520000], 90.0],
      0,
      [
        [27545249, 18303444],
        [27545249, 18114500],
      ],
      true,
      0,
      [27545249, 18185662],
    ),
  ];

  it('CollideSeg', () => {
    for (const c of arc_seg_collide_cases) {
      const arc = new SHAPE_ARC(
        c.m_geom.m_center_point,
        c.m_geom.m_start_point,
        DEG(c.m_geom.m_center_angle),
      );

      // Test a zero width arc (distance should equal the clearance)
      {
        const dist = { value: -1 };
        expect(
          arc.Collide(c.m_seg, c.m_arc_clearance, dist),
          `${c.m_case_name}: Test Clearance`,
        ).toBe(c.m_exp_result);
        expect(dist.value, `${c.m_case_name}: Test Clearance`).toBe(c.m_exp_distance);
      }

      // Test by changing the width of the arc (distance should equal zero)
      {
        const dist = { value: -1 };
        arc.SetWidth(c.m_arc_clearance * 2);
        expect(arc.Collide(c.m_seg, 0, dist), `${c.m_case_name}: Test Width`).toBe(c.m_exp_result);

        if (c.m_exp_result) expect(dist.value, `${c.m_case_name}: Test Width`).toBe(0);
        else expect(dist.value, `${c.m_case_name}: Test Width`).toBe(-1);
      }

      // Test Collide Point
      {
        const collide_point = V(0, 0);
        const dist = { value: -1 };

        if (c.m_exp_result) {
          arc.Collide(c.m_seg, c.m_arc_clearance, dist, collide_point);
          expect(collide_point, `${c.m_case_name}: Test Collide Point`).toEqual(c.m_collide_point);
        }
      }
    }
  });

  interface ARC_DATA_MM {
    // Coordinates and dimensions in millimeters
    m_center_x: number;
    m_center_y: number;
    m_start_x: number;
    m_start_y: number;
    m_center_angle: number;
    m_width: number;
  }

  const GenerateArc = (d: ARC_DATA_MM): SHAPE_ARC =>
    new SHAPE_ARC(
      V(pcbIUScale.mmToIU(d.m_center_x), pcbIUScale.mmToIU(d.m_center_y)),
      V(pcbIUScale.mmToIU(d.m_start_x), pcbIUScale.mmToIU(d.m_start_y)),
      DEG(d.m_center_angle),
      pcbIUScale.mmToIU(d.m_width),
    );

  const mm = (
    cx: number,
    cy: number,
    sx: number,
    sy: number,
    angle: number,
    width: number,
  ): ARC_DATA_MM => ({
    m_center_x: cx,
    m_center_y: cy,
    m_start_x: sx,
    m_start_y: sy,
    m_center_angle: angle,
    m_width: width,
  });

  interface ARC_ARC_COLLIDE_CASE {
    m_case_name: string;
    m_arc1: ARC_DATA_MM;
    m_arc2: ARC_DATA_MM;
    m_clearance: number;
    m_exp_result: boolean;
  }

  const arc_arc_collide_cases: ARC_ARC_COLLIDE_CASE[] = [
    {
      m_case_name: 'case 1: No intersection',
      m_arc1: mm(73.843527, 74.355869, 71.713528, 72.965869, -76.36664803, 0.2),
      m_arc2: mm(71.236473, 74.704131, 73.366472, 76.094131, -76.36664803, 0.2),
      m_clearance: 0,
      m_exp_result: false,
    },
    {
      m_case_name: 'case 2: No intersection',
      m_arc1: mm(82.542335, 74.825975, 80.413528, 73.435869, -76.4, 0.2),
      m_arc2: mm(76.491192, 73.839894, 78.619999, 75.23, -76.4, 0.2),
      m_clearance: 0,
      m_exp_result: false,
    },
    {
      m_case_name: 'case 3: No intersection',
      m_arc1: mm(89.318807, 74.810106, 87.19, 73.42, -76.4, 0.2),
      m_arc2: mm(87.045667, 74.632941, 88.826472, 75.794131, -267.9, 0.2),
      m_clearance: 0,
      m_exp_result: false,
    },
    {
      m_case_name: 'case 4: Co-centered not intersecting',
      m_arc1: mm(94.665667, 73.772941, 96.446472, 74.934131, -267.9, 0.2),
      m_arc2: mm(94.665667, 73.772941, 93.6551, 73.025482, -255.5, 0.2),
      m_clearance: 0,
      m_exp_result: false,
    },
    {
      m_case_name: 'case 5: Not intersecting, but end points very close',
      m_arc1: mm(72.915251, 80.493054, 73.570159, 81.257692, -260.5, 0.2),
      m_arc2: mm(73.063537, 82.295989, 71.968628, 81.581351, -255.5, 0.2),
      m_clearance: 0,
      m_exp_result: false,
    },
    {
      m_case_name: 'case 6: Coincident centers, colliding due to arc thickness',
      m_arc1: mm(79.279991, 80.67988, 80.3749, 81.394518, -255.5, 0.3),
      m_arc2: mm(79.279991, 80.67988, 80.3749, 81.694518, -255.5, 0.3),
      m_clearance: 0,
      m_exp_result: true,
    },
    {
      m_case_name: 'case 7: Single intersection',
      m_arc1: mm(88.495265, 81.766089, 90.090174, 82.867869, -255.5, 0.2),
      m_arc2: mm(86.995265, 81.387966, 89.090174, 82.876887, -255.5, 0.2),
      m_clearance: 0,
      m_exp_result: true,
    },
    {
      m_case_name: 'case 8: Double intersection',
      m_arc1: mm(96.149734, 81.792126, 94.99, 83.37, -347.2, 0.2),
      m_arc2: mm(94.857156, 81.240589, 95.91, 83.9, -288.5, 0.2),
      m_clearance: 0,
      m_exp_result: true,
    },
    {
      m_case_name: 'case 9: Endpoints within arc width',
      m_arc1: mm(72.915251, 86.493054, 73.970159, 87.257692, -260.5, 0.2),
      m_arc2: mm(73.063537, 88.295989, 71.968628, 87.581351, -255.5, 0.2),
      m_clearance: 0,
      m_exp_result: true,
    },
    {
      m_case_name: 'case 10: Endpoints close, outside, no collision',
      m_arc1: mm(78.915251, 86.393054, 79.970159, 87.157692, 99.5, 0.2),
      m_arc2: mm(79.063537, 88.295989, 77.968628, 87.581351, -255.5, 0.2),
      m_clearance: 0,
      m_exp_result: false,
    },
    {
      m_case_name: 'case 11: Endpoints close, inside, collision due to arc width',
      m_arc1: mm(85.915251, 86.993054, 86.970159, 87.757692, 99.5, 0.2),
      m_arc2: mm(86.063537, 88.295989, 84.968628, 87.581351, -255.5, 0.2),
      m_clearance: 0,
      m_exp_result: true,
    },
    {
      m_case_name: 'case 12: Simulated differential pair length-tuning',
      m_arc1: mm(94.6551, 88.296, 95.6551, 88.296, 90.0, 0.1),
      m_arc2: mm(94.6551, 88.296, 95.8551, 88.296, 90.0, 0.1),
      m_clearance: 0.1,
      m_exp_result: false,
    },
    {
      m_case_name: 'case 13: One arc fully enclosed in other, non-concentric',
      m_arc1: mm(73.77532, 93.413654, 75.70532, 93.883054, 60.0, 0.1),
      m_arc2: mm(73.86532, 93.393054, 75.86532, 93.393054, 90.0, 0.3),
      m_clearance: 0,
      m_exp_result: true,
    },
    {
      m_case_name: 'case 14: One arc fully enclosed in other, concentric',
      m_arc1: mm(79.87532, 93.413654, 81.64532, 94.113054, 60.0, 0.1),
      m_arc2: mm(79.87532, 93.413654, 81.86532, 93.393054, 90.0, 0.3),
      m_clearance: 0,
      m_exp_result: true,
    },
    {
      m_case_name: 'case 15: Arcs separated by clearance',
      m_arc1: mm(303.7615, 149.9252, 303.695968, 149.925237, 90.0262, 0.065),
      m_arc2: mm(303.6345, 149.2637, 303.634523, 148.85619, 89.9957, 0.065),
      m_clearance: 0.15,
      m_exp_result: false,
    },
  ];

  it('CollideArc', () => {
    for (const c of arc_arc_collide_cases) {
      const arc1 = GenerateArc(c.m_arc1);
      const arc2 = GenerateArc(c.m_arc2);

      const arc1_slc = new SHAPE_LINE_CHAIN(GenerateArc(c.m_arc1));
      arc1_slc.SetWidth(0);

      const arc2_slc = new SHAPE_LINE_CHAIN(GenerateArc(c.m_arc2));
      arc2_slc.SetWidth(0);

      const actual = { value: 0 };
      const location = V(0, 0);

      const result_arc_to_arc = arc1.Collide(
        arc2,
        pcbIUScale.mmToIU(c.m_clearance),
        actual,
        location,
      );

      // For arc to chain collisions, we need to re-calculate the clearances because the
      // SHAPE_LINE_CHAIN is zero width
      let clearance = pcbIUScale.mmToIU(c.m_clearance) + Math.trunc(arc2.GetWidth() / 2);

      const result_arc_to_chain = arc1.Collide(arc2_slc, clearance, actual, location);

      clearance = pcbIUScale.mmToIU(c.m_clearance) + Math.trunc(arc1.GetWidth() / 2);
      const result_chain_to_arc = arc1_slc.Collide(arc2, clearance, actual, location);

      clearance = Math.trunc(arc1.GetWidth() / 2) + Math.trunc(arc2.GetWidth() / 2);
      const result_chain_to_chain = arc1_slc.Collide(arc2_slc, clearance, actual, location);

      expect(result_arc_to_arc, `${c.m_case_name}: arc to arc`).toBe(c.m_exp_result);
      expect(result_arc_to_chain, `${c.m_case_name}: arc to chain`).toBe(c.m_exp_result);
      expect(result_chain_to_arc, `${c.m_case_name}: chain to arc`).toBe(c.m_exp_result);
      expect(result_chain_to_chain, `${c.m_case_name}: chain to chain`).toBe(c.m_exp_result);
    }
  });

  it('CollideArcToShapeLineChain', () => {
    const arc = new SHAPE_ARC(
      V(206000000, 140110000),
      V(201574617, 139229737),
      V(197822958, 136722959),
      250000,
    );

    const lc = new SHAPE_LINE_CHAIN(
      [
        V(159600000, 142500000),
        V(159600000, 142600000),
        V(166400000, 135800000),
        V(166400000, 111600000),
        V(190576804, 111600000),
        V(192242284, 113265480),
        V(192255720, 113265480),
        V(203682188, 124691948),
        V(203682188, 140332188),
        V(206000000, 142650000),
      ],
      false,
    );

    expect(arc.Collide(lc, 100000)).toBe(true);
    expect(lc.Collide(arc, 100000)).toBe(true);

    const seg = new SEG(V(203682188, 124691948), V(203682188, 140332188));
    expect(arc.Collide(seg, 0)).toBe(true);
  });

  it('CollideArcToPolygonApproximation', () => {
    const arc = new SHAPE_ARC(
      V(73843527, 74355869),
      V(71713528, 72965869),
      DEG(-76.36664803),
      1000000,
    );

    // Create a polyset approximation from the arc - error outside (simulating the zone filler)
    const arcBuffer = new SHAPE_POLY_SET();
    const clearance = Math.trunc((arc.GetWidth() * 3) / 2);
    const polygonApproximationError = SHAPE_ARC.DefaultAccuracyForPCB();

    TransformArcToPolygon(
      arcBuffer,
      arc.GetP0(),
      arc.GetArcMid(),
      arc.GetP1(),
      arc.GetWidth() + 2 * clearance,
      polygonApproximationError,
      ERROR_LOC.ERROR_OUTSIDE,
    );

    expect(arcBuffer.OutlineCount()).toBe(1);
    expect(arcBuffer.HoleCount(0)).toBe(0);

    // Make a reasonably large rectangular outline around the arc shape
    const arcbbox = arc.BBox(clearance * 4);

    const pos = arcbbox.GetPosition();
    const end = arcbbox.GetEnd();
    const zoneOutline = new SHAPE_LINE_CHAIN(
      [
        V(pos.x, pos.y),
        V(pos.x + arcbbox.GetWidth(), pos.y),
        V(end.x, end.y),
        V(end.x - arcbbox.GetWidth(), end.y),
      ],
      true,
    );

    // Create a synthetic "zone fill" polygon
    const zoneFill = new SHAPE_POLY_SET();
    zoneFill.AddOutline(zoneOutline);
    zoneFill.AddHole(arcBuffer.Outline(0));
    zoneFill.CacheTriangulation(false);

    const actual = { value: 0 };
    const location = V(0, 0);
    const epsilon = Math.trunc(polygonApproximationError / 10);

    expect(zoneFill.Collide(arc, clearance + epsilon, actual, location)).toBe(true);

    expect(zoneFill.Collide(arc, clearance - epsilon, actual, location)).toBe(false);
  });

  /**
   * Predicate for checking a polyline has all the points on (near) a circle of
   * given centre and radius
   */
  function ArePolylineEndPointsNearCircle(
    aPolyline: SHAPE_LINE_CHAIN,
    aCentre: VECTOR2I,
    aRad: number,
    aTolerance: number,
  ): boolean {
    const points: VECTOR2I[] = [];

    for (let i = 0; i < aPolyline.PointCount(); ++i) {
      points.push(aPolyline.CPoint(i));
    }

    return ArePointsNearCircle(points, aCentre, aRad, aTolerance);
  }

  /**
   * Predicate for checking a polyline has all the segment mid points on
   * (near) a circle of given centre and radius
   */
  function ArePolylineMidPointsNearCircle(
    aPolyline: SHAPE_LINE_CHAIN,
    aCentre: VECTOR2I,
    aRad: number,
    aTolerance: number,
  ): boolean {
    const points: VECTOR2I[] = [];

    for (let i = 0; i < aPolyline.PointCount() - 1; ++i) {
      const a = aPolyline.CPoint(i);
      const b = aPolyline.CPoint(i + 1);
      // `( a + b ) / 2`: VECTOR2I over an int is KiROUND per component
      const mid_pt = V(Math.round((a.x + b.x) / 2), Math.round((a.y + b.y) / 2));
      points.push(mid_pt);
    }

    return ArePointsNearCircle(points, aCentre, aRad, aTolerance);
  }

  interface ARC_TO_POLYLINE_CASE {
    m_case_name: string;
    m_geom: ARC_CENTRE_PT_ANGLE;
  }

  const ArcToPolyline_cases: ARC_TO_POLYLINE_CASE[] = [
    {
      m_case_name: 'Zero rad',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(0, 0), m_center_angle: 180 },
    },
    {
      m_case_name: 'Semicircle',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(-1000000, 0), m_center_angle: 180 },
    },
    {
      // check that very small circles don't fall apart and that reverse angles
      // work too
      m_case_name: 'Extremely small semicircle',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(-1000, 0), m_center_angle: -180 },
    },
    {
      // Make sure it doesn't only work for "easy" angles
      m_case_name: 'Non-round geometry',
      m_geom: { m_center_point: V(0, 0), m_start_point: V(1234567, 0), m_center_angle: 42.22 },
    },
  ];

  it('ArcToPolyline', () => {
    for (const c of ArcToPolyline_cases) {
      const width = 0;

      // Note: do not expect accuracies around 1 to work.  We use integers internally so we're
      // liable to rounding errors.  In PCBNew accuracy defaults to 5000 and we don't recommend
      // anything lower than 1000 (for performance reasons).
      const accuracy = 100;
      const epsilon = 1;

      const this_arc = new SHAPE_ARC(
        c.m_geom.m_center_point,
        c.m_geom.m_start_point,
        DEG(c.m_geom.m_center_angle),
        width,
      );

      const chain = this_arc.ConvertToPolyline(accuracy);

      // Start point (exactly) where expected
      expect(chain.CPoint(0), c.m_case_name).toEqual(c.m_geom.m_start_point);

      // End point (exactly) where expected
      expect(chain.CLastPoint(), c.m_case_name).toEqual(this_arc.GetP1());

      const radius = EuclideanNormI({
        x: c.m_geom.m_center_point.x - c.m_geom.m_start_point.x,
        y: c.m_geom.m_center_point.y - c.m_geom.m_start_point.y,
      });

      // Other points within accuracy + epsilon (for rounding) of where they should be
      expect(
        ArePolylineEndPointsNearCircle(chain, c.m_geom.m_center_point, radius, accuracy + epsilon),
        c.m_case_name,
      ).toBe(true);

      expect(
        ArePolylineMidPointsNearCircle(chain, c.m_geom.m_center_point, radius, accuracy + epsilon),
        c.m_case_name,
      ).toBe(true);
    }
  });

  /**
   * Test that TransformArcToPolygon handles shallow arcs (where the mid-point is nearly
   * collinear with start and end points) without producing invalid geometry due to
   * integer overflow from extremely large radii.
   *
   * This is a regression test for issue #22475 where shallow-radius arc segments
   * caused polygon pour rendering artifacts.
   */
  it('TransformShallowArcToPolygon', () => {
    const buffer = new SHAPE_POLY_SET();

    // Create an arc where the mid-point is only slightly off the start-end line.
    // This creates a very large radius arc that previously caused integer overflow.
    const start = V(0, 0);
    const end = V(10000000, 0); // 10mm chord length
    const mid = V(5000000, 5); // Mid-point only 5nm off the line

    const width = 250000; // 0.25mm track width
    const aError = 5000; // Default error tolerance

    // This should not crash or produce invalid geometry
    TransformArcToPolygon(buffer, start, mid, end, width, aError, ERROR_LOC.ERROR_INSIDE);

    // Should produce at least one outline
    expect(buffer.OutlineCount()).toBeGreaterThanOrEqual(1);

    // The outline should be valid (closed, has points)
    if (buffer.OutlineCount() > 0) {
      const outline = buffer.COutline(0);
      expect(outline.IsClosed()).toBe(true);
      expect(outline.PointCount()).toBeGreaterThanOrEqual(3);

      // The bounding box should be reasonable (roughly the track width around the chord)
      const bbox = outline.BBox();
      expect(bbox.GetWidth()).toBeLessThanOrEqual(end.x + width * 2);
      expect(bbox.GetHeight()).toBeLessThanOrEqual(width * 2 + 100); // Allow some tolerance
    }
  });

  /**
   * Test that arcs with extremely large radii (greater than INT_MAX/2) are
   * properly converted to line segments.
   */
  it('TransformVeryShallowArcToPolygon', () => {
    const buffer = new SHAPE_POLY_SET();

    // Create an arc that is effectively a straight line - mid-point essentially on the line.
    // This should be detected by IsEffectiveLine() and handled as a line segment.
    const start = V(0, 0);
    const end = V(50000000, 0); // 50mm chord length
    const mid = V(25000000, 1); // Mid-point only 1nm off the line

    const width = 250000; // 0.25mm track width
    const aError = 5000;

    // This should not crash and should produce valid geometry
    TransformArcToPolygon(buffer, start, mid, end, width, aError, ERROR_LOC.ERROR_INSIDE);

    expect(buffer.OutlineCount()).toBeGreaterThanOrEqual(1);

    if (buffer.OutlineCount() > 0) {
      const outline = buffer.COutline(0);
      expect(outline.IsClosed()).toBe(true);
      expect(outline.PointCount()).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * Test arc with values similar to problematic arcs in issue #22475 board.
   * These arcs have distToMid around 12-13µm with radius around 24mm.
   */
  it('TransformIssue22475ArcToPolygon', () => {
    const buffer = new SHAPE_POLY_SET();

    // Values approximating one of the problematic arcs from issue #22475:
    // radius=24.35 mm, distToMid=12960 nm, chord=1.62 mm, angle=-3.8 deg
    // Compute start, mid, end points for such an arc
    const start = V(0, 0);
    const end = V(1620000, 0); // 1.62mm chord length
    const mid = V(810000, 12960); // Mid-point 12960nm (12.96µm) off the line

    const width = 200000; // 0.2mm track width
    const aError = 5000;

    // Before the fix, this should create a polygon with very large extent
    // After the fix, it should create a reasonable oval-shaped polygon
    TransformArcToPolygon(buffer, start, mid, end, width, aError, ERROR_LOC.ERROR_INSIDE);

    expect(buffer.OutlineCount()).toBeGreaterThanOrEqual(1);

    const outline = buffer.COutline(0);
    expect(outline.IsClosed()).toBe(true);
    expect(outline.PointCount()).toBeGreaterThanOrEqual(3);

    const bbox = outline.BBox();

    // The bounding box should be reasonable - roughly chord + 2*width wide, 2*width high
    // With the fix (treating as oval), width should be ~1620000 + 2*200000 = 2020000
    // Height should be ~2*200000 = 400000
    // Without the fix, the height could be enormous due to the large arc radius

    // Check that the polygon isn't ridiculously large
    expect(
      bbox.GetWidth(),
      `Polygon width ${bbox.GetWidth()} is too large (expected ~2020000)`,
    ).toBeLessThanOrEqual(3000000);
    expect(
      bbox.GetHeight(),
      `Polygon height ${bbox.GetHeight()} is too large (expected ~400000)`,
    ).toBeLessThanOrEqual(1000000);
  });

  /**
   * Test that SHAPE_ARC::Collide handles arcs with near-INT_MAX radius without crashing.
   * Reproduces a crash during PADS ASCII import where a near-collinear arc produced a
   * radius exceeding INT_MAX, overflowing the CIRCLE(int) constructor and KiROUND.
   */
  it('CollideNearlyFlatArcDoesNotOverflow', () => {
    // Values from the core dump: a nearly-flat arc with enormous radius
    const start = V(68208364, -8000);
    const mid = V(771364, 500000);
    const end = V(35224335, -7999);
    const width = 1270000;

    const arc = new SHAPE_ARC(start, mid, end, width);

    // Radius should be near or above INT_MAX/2, triggering the segment fallback
    expect(arc.GetRadius()).toBeGreaterThanOrEqual(INT_MAX / 2.0);

    // Point near the arc endpoints.  Must not crash.
    const testPt = V(35224298, -5381);
    const actual = { value: 0 };
    const location = V(0, 0);

    expect(() => arc.Collide(testPt, 635000, actual, location)).not.toThrow();

    // Segment near the arc.  Must not crash.
    const testSeg = new SEG(V(35224298, -5381), V(35696364, -32988651));

    expect(() => arc.Collide(testSeg, 635000, actual, location)).not.toThrow();
  });

  /**
   * Three near-coincident points must not fabricate a multi-metre circumcircle.
   *
   *   (arc (start 135.674 84.576744)
   *        (mid   135.673999 84.576744)
   *        (end   135.673998 84.576744) ...)
   *
   * Previously CalcArcCenter() slope-epsilon fallback for colinear inputs
   * produced a centre ~2 m away and a radius ~2 m, and the PNS drag preview
   * drew a board-spanning ghost circle through the three coincident points.
   */
  it('DegenerateArcCoincidentPoints', () => {
    const arc = new SHAPE_ARC(
      V(135674000, 84576744),
      V(135673999, 84576744),
      V(135673998, 84576744),
      100000,
    );

    expect(arc.GetRadius()).toBeLessThan(10.0);

    const poly = arc.ConvertToPolyline();
    expect(poly.BBox().GetWidth()).toBeLessThan(1000); // < 1 µm
    expect(poly.BBox().GetHeight()).toBeLessThan(1000);
    expect(arc.GetLength()).toBeLessThan(1000.0);
  });
});
