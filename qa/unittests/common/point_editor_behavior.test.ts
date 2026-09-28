// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/point_editor_behavior.cpp`. `ArcEditKeepsSmallSchematicRadius`
 * and the point-editor half of `PolygonBehaviorSurvivesAssignment` are
 * transcribed from `qa/tests/common/test_eda_shape.cpp`, which is where
 * upstream exercises this file (there is no dedicated
 * `test_point_editor_behavior.cpp`). The rest of the module - segment, circle,
 * bezier, table-cell and the arc mode cycle - has no upstream unit test, so
 * those cases are worked by hand from `point_editor_behavior.cpp` itself.
 */
import { describe, expect, it } from 'vitest';
import { EDA_SHAPE, FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { ARC_EDIT_MODE } from '@ziroeda/common/frame_type.js';
import {
  EDA_ARC_POINT_EDIT_BEHAVIOR,
  EDA_BEZIER_POINT_EDIT_BEHAVIOR,
  EDA_CIRCLE_POINT_EDIT_BEHAVIOR,
  EDA_POLYGON_POINT_EDIT_BEHAVIOR,
  EDA_SEGMENT_POINT_EDIT_BEHAVIOR,
  EDA_TABLECELL_POINT_EDIT_BEHAVIOR,
  IncrementArcEditMode,
  KI_ARC_EDIT,
} from '@ziroeda/common/tool/point_editor_behavior.js';
import { EDIT_POINTS } from '@ziroeda/common/tool/edit_points.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });

/** A minimal instantiable `EDA_SHAPE`, the way `EDA_SHAPE_MOCK` in
 *  `eda_shape.test.ts` is - a bare mixin host, nothing else. */
class EDA_SHAPE_MOCK extends EDA_SHAPE {
  constructor(aShapeType: SHAPE_T) {
    super();
    this.initEdaShape(aShapeType, 0, FILL_T.NO_FILL);
  }
}

/** A `VIEW_CONTROLS` whose cursor position is fixed, for the arc behavior's UpdateItem. */
function fixedCursor(aCursor: VECTOR2I): VIEW_CONTROLS {
  return {
    GetCursorPosition: (_aEnableSnapping?: boolean) => aCursor,
  } as unknown as VIEW_CONTROLS;
}

describe('KI_ARC_EDIT', () => {
  /**
   * `ArcEditKeepsSmallSchematicRadius`: a 50 mil radius (well under the
   * previously-buggy 100 mil floor upstream's minimum-radius clamp used) must
   * stay under 100 mil after dragging an endpoint or the midpoint by a few IU.
   */
  it('keeps a small schematic arc radius under the 100 mil regression floor', () => {
    const radius = schIUScale.milsToIU(50);
    const center = V(0, 0);
    const start = V(radius, 0);
    const end = V(0, radius);
    const mid = V(KiROUND(radius / Math.sqrt(2.0)), KiROUND(radius / Math.sqrt(2.0)));

    const arc = new EDA_SHAPE_MOCK(SHAPE_T.ARC);
    arc.SetArcGeometry(start, mid, end);

    expect(arc.GetRadius()).toBeLessThan(schIUScale.milsToIU(100));

    // Drag the endpoint a few IU; with the bug the radius snaps up to 100 mil.
    const newEnd = V(5, radius);

    KI_ARC_EDIT.EditArcEndpointKeepCenter(arc, center, start, mid, newEnd, newEnd, schIUScale);
    expect(arc.GetRadius()).toBeLessThan(schIUScale.milsToIU(100));

    // Same for the mid-point helper, which has its own minimum-radius clamp.
    const smallerMid = V(
      KiROUND((radius - 100) / Math.sqrt(2.0)),
      KiROUND((radius - 100) / Math.sqrt(2.0)),
    );

    const arc2 = new EDA_SHAPE_MOCK(SHAPE_T.ARC);
    arc2.SetArcGeometry(start, mid, end);

    KI_ARC_EDIT.EditArcMidKeepCenter(arc2, center, start, mid, end, smallerMid, schIUScale);
    expect(arc2.GetRadius()).toBeLessThan(schIUScale.milsToIU(100));
  });

  it('cycles KEEP_CENTER_ADJUST_ANGLE_RADIUS -> KEEP_CENTER_ENDS_ADJUST_ANGLE -> KEEP_ENDPOINTS_OR_START_DIRECTION -> back', () => {
    expect(IncrementArcEditMode(ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS)).toBe(
      ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE,
    );
    expect(IncrementArcEditMode(ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE)).toBe(
      ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION,
    );
    expect(IncrementArcEditMode(ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION)).toBe(
      ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS,
    );
  });
});

describe('EDA_ARC_POINT_EDIT_BEHAVIOR', () => {
  it('MakePoints lists start, mid, end, center, in that order', () => {
    const arc = new EDA_SHAPE_MOCK(SHAPE_T.ARC);
    arc.SetArcGeometry(V(100, 0), V(0, 100), V(-100, 0));

    const mode = { value: ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS };
    const behavior = new EDA_ARC_POINT_EDIT_BEHAVIOR(arc, mode, fixedCursor(V(0, 0)), schIUScale);
    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);

    expect(points.PointsSize()).toBe(4);
    expect(points.Point(0).GetPosition()).toEqual(arc.GetStart());
    expect(points.Point(1).GetPosition()).toEqual(arc.GetArcMid());
    expect(points.Point(2).GetPosition()).toEqual(arc.GetEnd());
    expect(points.Point(3).GetPosition()).toEqual(arc.getCenter());
  });

  it('KEEP_CENTER_ADJUST_ANGLE_RADIUS: dragging the center moves the whole arc by the same vector', () => {
    const arc = new EDA_SHAPE_MOCK(SHAPE_T.ARC);
    arc.SetArcGeometry(V(100, 0), V(0, 100), V(-100, 0));
    const startBefore = arc.GetStart();
    const endBefore = arc.GetEnd();

    const mode = { value: ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS };
    const behavior = new EDA_ARC_POINT_EDIT_BEHAVIOR(arc, mode, fixedCursor(V(0, 0)), schIUScale);
    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);

    const centerPoint = points.Point(3);
    centerPoint.SetPosition(V(10, 10));
    behavior.UpdateItem(centerPoint, points, undefined as never, []);

    expect(arc.GetStart()).toEqual({ x: startBefore.x + 10, y: startBefore.y + 10 });
    expect(arc.GetEnd()).toEqual({ x: endBefore.x + 10, y: endBefore.y + 10 });
  });

  it('Get45DegreeConstrainer is always the center point', () => {
    const arc = new EDA_SHAPE_MOCK(SHAPE_T.ARC);
    arc.SetArcGeometry(V(100, 0), V(0, 100), V(-100, 0));

    const mode = { value: ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS };
    const behavior = new EDA_ARC_POINT_EDIT_BEHAVIOR(arc, mode, fixedCursor(V(0, 0)), schIUScale);
    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);

    expect(behavior.Get45DegreeConstrainer(points.Point(0), points)).toEqual(arc.getCenter());
  });
});

describe('EDA_POLYGON_POINT_EDIT_BEHAVIOR', () => {
  /**
   * The point-editor half of `PolygonBehaviorSurvivesAssignment`: the
   * behavior resolves `GetPolyShape()` fresh on each call, so it survives
   * `EDA_SHAPE::operator=` replacing `m_poly` with a new allocation
   * (gitlab#23648) instead of caching a stale `SHAPE_POLY_SET&`.
   */
  it('survives EDA_SHAPE assignment reallocating the polygon', () => {
    const shape = new EDA_SHAPE_MOCK(SHAPE_T.POLY);

    const poly = shape.GetPolyShape();
    poly.NewOutline();
    poly.Append(V(0, 0));
    poly.Append(V(1000000, 0));
    poly.Append(V(1000000, 1000000));

    const behavior = new EDA_POLYGON_POINT_EDIT_BEHAVIOR(shape);

    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);
    expect(points.PointsSize()).toBe(3);

    const copy = new EDA_SHAPE_MOCK(SHAPE_T.POLY);
    copy.initEdaShapeFrom(shape);
    shape.assignEdaShape(copy);

    // After assignment, shape's polygon is a fresh allocation; the behavior
    // must still work (not use-after-stale-reference).
    const points2 = new EDIT_POINTS(null);
    behavior.MakePoints(points2);
    expect(points2.PointsSize()).toBe(3);

    expect(behavior.UpdatePoints(points)).toBe(true);
  });
});

describe('EDA_SEGMENT_POINT_EDIT_BEHAVIOR', () => {
  it('MakePoints is [start, end]; UpdateItem writes back whichever end moved', () => {
    const seg = new EDA_SHAPE_MOCK(SHAPE_T.SEGMENT);
    seg.SetStart(V(0, 0));
    seg.SetEnd(V(100, 0));

    const behavior = new EDA_SEGMENT_POINT_EDIT_BEHAVIOR(seg);
    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);

    expect(points.Point(0).GetPosition()).toEqual(V(0, 0));
    expect(points.Point(1).GetPosition()).toEqual(V(100, 0));

    points.Point(1).SetPosition(V(200, 50));
    behavior.UpdateItem(points.Point(1), points, undefined as never, []);

    expect(seg.GetStart()).toEqual(V(0, 0));
    expect(seg.GetEnd()).toEqual(V(200, 50));
  });

  it('Get45DegreeConstrainer is the other end of the segment', () => {
    const seg = new EDA_SHAPE_MOCK(SHAPE_T.SEGMENT);
    seg.SetStart(V(0, 0));
    seg.SetEnd(V(100, 0));

    const behavior = new EDA_SEGMENT_POINT_EDIT_BEHAVIOR(seg);
    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);

    expect(behavior.Get45DegreeConstrainer(points.Point(0), points)).toEqual(V(100, 0));
    expect(behavior.Get45DegreeConstrainer(points.Point(1), points)).toEqual(V(0, 0));
  });
});

describe('EDA_CIRCLE_POINT_EDIT_BEHAVIOR', () => {
  it('MakePoints is [center, end]; dragging the center moves it, dragging end resizes', () => {
    const circle = new EDA_SHAPE_MOCK(SHAPE_T.CIRCLE);
    circle.SetCenter(V(0, 0));
    circle.SetEnd(V(50, 0));

    const behavior = new EDA_CIRCLE_POINT_EDIT_BEHAVIOR(circle);
    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);

    expect(points.Point(0).GetPosition()).toEqual(V(0, 0));
    expect(points.Point(1).GetPosition()).toEqual(V(50, 0));

    points.Point(1).SetPosition(V(80, 0));
    behavior.UpdateItem(points.Point(1), points, undefined as never, []);
    expect(circle.getCenter()).toEqual(V(0, 0));
    expect(circle.GetEnd()).toEqual(V(80, 0));

    points.Point(0).SetPosition(V(10, 10));
    behavior.UpdateItem(points.Point(0), points, undefined as never, []);
    expect(circle.getCenter()).toEqual(V(10, 10));
  });

  it('Get45DegreeConstrainer is always the center', () => {
    const circle = new EDA_SHAPE_MOCK(SHAPE_T.CIRCLE);
    circle.SetCenter(V(5, 5));
    circle.SetEnd(V(55, 5));

    const behavior = new EDA_CIRCLE_POINT_EDIT_BEHAVIOR(circle);
    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);

    expect(behavior.Get45DegreeConstrainer(points.Point(1), points)).toEqual(V(5, 5));
  });
});

describe('EDA_BEZIER_POINT_EDIT_BEHAVIOR', () => {
  it('MakePoints is [start, C1, C2, end]; UpdateItem writes the dragged control point', () => {
    const bezier = new EDA_SHAPE_MOCK(SHAPE_T.BEZIER);
    bezier.SetStart(V(0, 0));
    bezier.SetBezierC1(V(10, 10));
    bezier.SetBezierC2(V(20, 10));
    bezier.SetEnd(V(30, 0));

    const behavior = new EDA_BEZIER_POINT_EDIT_BEHAVIOR(bezier, 5000);
    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);

    expect(points.PointsSize()).toBe(4);
    expect(points.Point(1).GetPosition()).toEqual(V(10, 10));

    points.Point(1).SetPosition(V(15, 15));
    behavior.UpdateItem(points.Point(1), points, undefined as never, []);

    expect(bezier.GetBezierC1()).toEqual(V(15, 15));
    // Unmoved control points are untouched.
    expect(bezier.GetStart()).toEqual(V(0, 0));
    expect(bezier.GetBezierC2()).toEqual(V(20, 10));
    expect(bezier.GetEnd()).toEqual(V(30, 0));
  });
});

describe('EDA_TABLECELL_POINT_EDIT_BEHAVIOR', () => {
  it('MakePoints is [half-height above the bottom-right, half-width left of it]', () => {
    const cell = new EDA_SHAPE_MOCK(SHAPE_T.RECTANGLE);
    cell.SetStart(V(0, 0));
    cell.SetEnd(V(100, 40));

    const behavior = new EDA_TABLECELL_POINT_EDIT_BEHAVIOR(cell);
    const points = new EDIT_POINTS(null);
    behavior.MakePoints(points);

    expect(points.PointsSize()).toBe(2);
    // GetRectangleHeight()/Width() is (end - start); half of each, integer division.
    expect(points.Point(0).GetPosition()).toEqual(V(100, 40 - 20));
    expect(points.Point(1).GetPosition()).toEqual(V(100 - 50, 40));
  });
});
