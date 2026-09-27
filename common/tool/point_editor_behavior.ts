// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/tool/point_editor_behavior.h` + `common/tool/point_editor_behavior.cpp`:
 * `POINT_EDIT_BEHAVIOR`, the interface a point editor drives to turn a set of
 * dragged {@link EDIT_POINT}s back into a shape, and the "standard" behaviours
 * KiCad ships for the item kinds every point editor sees - a polygon outline
 * (raw or as an `EDA_SHAPE`), a segment, a circle, a bezier, a table cell and
 * an arc, plus the free `KI_ARC_EDIT` helpers an arc's four edit modes share.
 *
 * These operate on a live, mutable `EDA_SHAPE` plus a `COMMIT`, the way
 * upstream's `SCH_POINT_EDITOR` / `PCB_POINT_EDITOR` do: `MakePoints` fills an
 * `EDIT_POINTS`, dragging a handle calls `UpdateItem` which reads every point
 * back and rewrites the shape, and `FinalizeItem` runs once when the drag ends.
 *
 * `eeschema/tools/point_editor.ts` and `pcbnew/point_editor.ts` do not call
 * these classes: both editors instead derive handles from an immutable
 * document and return a *new* document from a drag (`editHandles` /
 * `dragHandle`), so a drag is a pure function of (document, handle, cursor)
 * and the live preview and the committed result cannot disagree - a design
 * documented at the top of `eeschema/tools/point_editor.ts`. Re-platforming
 * either editor onto mutable `EDIT_POINTS` + `COMMIT` is a rearchitecture, not
 * a swap, so their own per-behaviour ports (`eeschema/tools/arc_edit.ts` and the
 * handle builders/draggers in both `point_editor.ts` files) stay as they are;
 * this file is the faithful, class-shaped port of the C++ for anything that
 * *can* use it directly (a future mutable-model canvas, or a unit test that
 * wants to drive the same shape KiCad's own point editor does).
 */

import type { COMMIT } from '../commit.js';
import type { EDA_ITEM } from '../eda_item.js';
import { type EDA_SHAPE, SHAPE_T } from '../eda_shape.js';
import { ADVANCED_CFG } from '../advanced_config.js';
import type { EdaIuScale } from '../eda_units.js';
import { ARC_EDIT_MODE } from '../frame_type.js';
import type { VIEW_CONTROLS } from '../view/view_controls.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SEG, type OPT_VECTOR2I } from '@ziroeda/kimath/src/geometry/seg.js';
import { INT_MAX, KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  add,
  ECOORD_MAX,
  EuclideanNorm,
  EuclideanNormI,
  Perpendicular,
  ResizeI,
  sub,
  toVECTOR2I,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { EC_CONVERGING } from './edit_constraints.js';
import type { EDIT_POINT, EDIT_POINTS } from './edit_points.js';

/**
 * `CHECK_POINT_COUNT( aPoints, aExpected )`: `wxCHECK( aPoints.PointsSize() ==
 * aExpected, rc )`, which logs and returns `rc` - here, the caller returns on
 * `false`. Still a bug if it fires, but at least it will not run off the end
 * of the list.
 */
function CHECK_POINT_COUNT(aPoints: EDIT_POINTS, aExpected: number): boolean {
  const ok = aPoints.PointsSize() === aExpected;
  console.assert(ok, `EDIT_POINTS has ${aPoints.PointsSize()} points, expected ${aExpected}`);
  return ok;
}

/** `CHECK_POINT_COUNT_GE( aPoints, aExpected )`. */
function CHECK_POINT_COUNT_GE(aPoints: EDIT_POINTS, aExpected: number): boolean {
  const ok = aPoints.PointsSize() >= aExpected;
  console.assert(ok, `EDIT_POINTS has ${aPoints.PointsSize()} points, expected >= ${aExpected}`);
  return ok;
}

/** `VECTOR2<int>::operator/( double )` with the divisor fixed at 2: KiROUND each component. */
function halveRounded(v: VECTOR2I): VECTOR2I {
  return { x: KiROUND(v.x / 2), y: KiROUND(v.y / 2) };
}

/**
 * A helper class interface to manage the edit points for a single item.
 * Create one of these, and it will provide a way to keep a list of points updated.
 *
 * For the moment this is implemented such that it mutates an external #EDIT_POINTS object,
 * but it might be able to also own the points.
 */
export abstract class POINT_EDIT_BEHAVIOR {
  /**
   * Construct the initial set of edit points for the item
   * and append to the given list.
   *
   * @param aPoints The list of edit points to fill.
   */
  abstract MakePoints(aPoints: EDIT_POINTS): void;

  /**
   * Update the list of the edit points for the item.
   *
   * Be very careful not to overrun the list of points - this class knows how big they are
   * because it made them in the first place.
   *
   * If item has changed such that that number of points needs to change, this method has to
   * handle that (probably by clearing the list and refilling it).
   *
   * If the behavior itself must change (for instance, a rectangle is non-cardinallly rotated
   * to a polygon), the method should return false.
   *
   * @param aPoints The list of edit points to update.
   */
  abstract UpdatePoints(aPoints: EDIT_POINTS): boolean;

  /**
   * Finalize the edit operation. (optional)
   *
   * This is called once, after the user has finished editing a point (e.g. released the
   * mouse button).
   *
   * @param aPoints The final positions of the edit points.
   * @param aCommit The commit object to use to modify the item.
   */
  FinalizeItem(_aPoints: EDIT_POINTS, _aCommit: COMMIT): void {}

  /**
   * Update the item with the new positions of the edit points.
   *
   * This method should all commit and add to the update list anything that is NOT the
   * parent item of the EDIT_POINTs. For example, connected lines, parent tables, etc. The
   * item itself is already handled (most behaviors don't need more than that).
   *
   * @param aEditedPoint The point that was dragged.
   *                     You can use this to check by address which point to update.
   * @param aPoints The new positions of the edit points.
   * @param aCommit The commit object to use to modify the item.
   * @param aUpdatedItems The list of items that were updated by the edit (not only the
   *                      item that was being edited, but also any other items that were
   *                      affected, e.g. by being conneted to the edited item).
   */
  abstract UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void;

  /**
   * Get the 45-degree constrainer for the item, when the given point is moved.
   * Return undefined if not, and the caller can decide.
   *
   * If you want to actively disable constraining, return the aEditedPoint
   * position.
   */
  Get45DegreeConstrainer(_aEditedPoint: EDIT_POINT, _aPoints: EDIT_POINTS): OPT_VECTOR2I {
    // By default, no constrainer is defined and the caller must decide
    return undefined;
  }

  /**
   * Checks if two points are the same instance - which means the point is being edited.
   */
  protected static isModified(aEditedPoint: EDIT_POINT, aPoint: EDIT_POINT): boolean {
    return aEditedPoint === aPoint;
  }
}

/**
 * Class that implements "standard" polygon editing behavior.
 *
 * You still need to implement the POINT_EDIT_BEHAVIOR interface (in particular, you may
 * need to construct a poly set from or apply the poly set to an actual object) but you can
 * use the helper methods in this class to do the actual work.
 */
export class POLYGON_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_polygon: SHAPE_POLY_SET;

  constructor(aPolygon: SHAPE_POLY_SET) {
    super();
    this.m_polygon = aPolygon;
  }

  /**
   * Build the edit points for the given polygon outline.
   */
  static BuildForPolyOutline(aPoints: EDIT_POINTS, aOutline: SHAPE_POLY_SET): void {
    const cornersCount = aOutline.TotalVertices();

    if (cornersCount === 0) return;

    for (const iterator = aOutline.CIterateWithHoles(); iterator.valid(); iterator.Advance()) {
      aPoints.AddPoint(iterator.Get());

      if (iterator.IsEndContour()) aPoints.AddBreak();
    }

    // Lines have to be added after creating edit points, as they use EDIT_POINT references
    for (let i = 0; i < cornersCount - 1; ++i) {
      if (aPoints.IsContourEnd(i))
        aPoints.AddLine(aPoints.Point(i), aPoints.Point(aPoints.GetContourStartIdx(i)));
      else aPoints.AddLine(aPoints.Point(i), aPoints.Point(i + 1));

      aPoints.Line(i).SetConstraint(new EC_CONVERGING(aPoints.Line(i), aPoints));
    }

    // The last missing line, connecting the last and the first polygon point
    aPoints.AddLine(
      aPoints.Point(cornersCount - 1),
      aPoints.Point(aPoints.GetContourStartIdx(cornersCount - 1)),
    );

    aPoints
      .Line(aPoints.LinesSize() - 1)
      .SetConstraint(new EC_CONVERGING(aPoints.Line(aPoints.LinesSize() - 1), aPoints));
  }

  /**
   * Update the edit points with the current polygon outline.
   *
   * If the point sizes differ, the points are rebuilt entirely (in-place)
   */
  static UpdatePointsFromOutline(aOutline: SHAPE_POLY_SET, aPoints: EDIT_POINTS): void {
    // No size check here, as we can and will rebuild if that fails
    if (aPoints.PointsSize() !== aOutline.TotalVertices()) {
      // Rebuild the points list
      aPoints.Clear();
      POLYGON_POINT_EDIT_BEHAVIOR.BuildForPolyOutline(aPoints, aOutline);
    } else {
      for (let i = 0; i < aOutline.TotalVertices(); ++i)
        aPoints.Point(i).SetPosition(aOutline.CVertex(i));
    }
  }

  /**
   * Update the polygon outline with the new positions of the edit points.
   */
  static UpdateOutlineFromPoints(
    aOutline: SHAPE_POLY_SET,
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
  ): void {
    if (!CHECK_POINT_COUNT_GE(aPoints, aOutline.TotalVertices())) return;

    for (let i = 0; i < aOutline.TotalVertices(); ++i)
      aOutline.SetVertex(i, aPoints.Point(i).GetPosition());

    for (let i = 0; i < aPoints.LinesSize(); ++i) {
      // `isModified`: reference identity, inlined (the base class helper is
      // `protected`, for subclasses' own UpdateItem to call).
      if (aEditedPoint !== aPoints.Line(i))
        aPoints.Line(i).SetConstraint(new EC_CONVERGING(aPoints.Line(i), aPoints));
    }
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    POLYGON_POINT_EDIT_BEHAVIOR.BuildForPolyOutline(aPoints, this.m_polygon);
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    POLYGON_POINT_EDIT_BEHAVIOR.UpdatePointsFromOutline(this.m_polygon, aPoints);
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    POLYGON_POINT_EDIT_BEHAVIOR.UpdateOutlineFromPoints(this.m_polygon, aEditedPoint, aPoints);
  }

  override FinalizeItem(_aPoints: EDIT_POINTS, _aCommit: COMMIT): void {
    this.m_polygon.RemoveNullSegments();
  }
}

/**
 * "Standard" polygon editing behavior for EDA_SHAPE polygons.
 *
 * This class resolves the SHAPE_POLY_SET from the EDA_SHAPE on each call rather than
 * caching a reference, because the EDA_SHAPE's internal SHAPE_POLY_SET can be
 * reallocated (e.g. by operator=) while the behavior is still alive.
 */
export class EDA_POLYGON_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_shape: EDA_SHAPE;

  constructor(aPolygon: EDA_SHAPE) {
    super();
    this.m_shape = aPolygon;
    console.assert(aPolygon.GetShape() === SHAPE_T.POLY);
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    POLYGON_POINT_EDIT_BEHAVIOR.BuildForPolyOutline(aPoints, this.m_shape.GetPolyShape());
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    POLYGON_POINT_EDIT_BEHAVIOR.UpdatePointsFromOutline(this.m_shape.GetPolyShape(), aPoints);
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    POLYGON_POINT_EDIT_BEHAVIOR.UpdateOutlineFromPoints(
      this.m_shape.GetPolyShape(),
      aEditedPoint,
      aPoints,
    );
  }

  override FinalizeItem(_aPoints: EDIT_POINTS, _aCommit: COMMIT): void {
    this.m_shape.GetPolyShape().RemoveNullSegments();
  }
}

/**
 * "Standard" segment editing behavior for EDA_SHAPE segments.
 */
export class EDA_SEGMENT_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private static readonly SEGMENT_START = 0;
  private static readonly SEGMENT_END = 1;
  private static readonly SEGMENT_MAX_POINTS = 2;

  private readonly m_segment: EDA_SHAPE;

  constructor(aSegment: EDA_SHAPE) {
    super();
    this.m_segment = aSegment;
    console.assert(aSegment.GetShape() === SHAPE_T.SEGMENT);
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    aPoints.AddPoint(this.m_segment.GetStart());
    aPoints.AddPoint(this.m_segment.GetEnd());
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    if (!CHECK_POINT_COUNT(aPoints, EDA_SEGMENT_POINT_EDIT_BEHAVIOR.SEGMENT_MAX_POINTS))
      return false;

    aPoints
      .Point(EDA_SEGMENT_POINT_EDIT_BEHAVIOR.SEGMENT_START)
      .SetPosition(this.m_segment.GetStart());
    aPoints.Point(EDA_SEGMENT_POINT_EDIT_BEHAVIOR.SEGMENT_END).SetPosition(this.m_segment.GetEnd());
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    if (!CHECK_POINT_COUNT(aPoints, EDA_SEGMENT_POINT_EDIT_BEHAVIOR.SEGMENT_MAX_POINTS)) return;

    const start = aPoints.Point(EDA_SEGMENT_POINT_EDIT_BEHAVIOR.SEGMENT_START);
    const end = aPoints.Point(EDA_SEGMENT_POINT_EDIT_BEHAVIOR.SEGMENT_END);

    if (aEditedPoint === start) this.m_segment.SetStart(start.GetPosition());
    else if (aEditedPoint === end) this.m_segment.SetEnd(end.GetPosition());
  }

  override Get45DegreeConstrainer(aEditedPoint: EDIT_POINT, aPoints: EDIT_POINTS): OPT_VECTOR2I {
    // Select the other end of line
    return aPoints.Next(aEditedPoint)?.GetPosition();
  }
}

/**
 * "Standard" circle editing behavior for EDA_SHAPE circles.
 */
export class EDA_CIRCLE_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private static readonly CIRC_CENTER = 0;
  private static readonly CIRC_END = 1;
  private static readonly CIRC_MAX_POINTS = 2;

  private readonly m_circle: EDA_SHAPE;

  constructor(aCircle: EDA_SHAPE) {
    super();
    this.m_circle = aCircle;
    console.assert(aCircle.GetShape() === SHAPE_T.CIRCLE);
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    aPoints.AddPoint(this.m_circle.getCenter());
    aPoints.AddPoint(this.m_circle.GetEnd());
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    if (!CHECK_POINT_COUNT(aPoints, EDA_CIRCLE_POINT_EDIT_BEHAVIOR.CIRC_MAX_POINTS)) return false;

    aPoints
      .Point(EDA_CIRCLE_POINT_EDIT_BEHAVIOR.CIRC_CENTER)
      .SetPosition(this.m_circle.getCenter());
    aPoints.Point(EDA_CIRCLE_POINT_EDIT_BEHAVIOR.CIRC_END).SetPosition(this.m_circle.GetEnd());
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    if (!CHECK_POINT_COUNT(aPoints, EDA_CIRCLE_POINT_EDIT_BEHAVIOR.CIRC_MAX_POINTS)) return;

    const centerPoint = aPoints.Point(EDA_CIRCLE_POINT_EDIT_BEHAVIOR.CIRC_CENTER);
    const endPoint = aPoints.Point(EDA_CIRCLE_POINT_EDIT_BEHAVIOR.CIRC_END);
    const center = centerPoint.GetPosition();
    const end = endPoint.GetPosition();

    if (aEditedPoint === centerPoint) this.m_circle.SetCenter(center);
    else this.m_circle.SetEnd({ x: end.x, y: end.y });
  }

  override Get45DegreeConstrainer(_aEditedPoint: EDIT_POINT, aPoints: EDIT_POINTS): OPT_VECTOR2I {
    return aPoints.Point(EDA_CIRCLE_POINT_EDIT_BEHAVIOR.CIRC_CENTER).GetPosition();
  }
}

/**
 * "Standard" bezier editing behavior for EDA_SHAPE beziers.
 */
export class EDA_BEZIER_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private static readonly BEZIER_START = 0;
  private static readonly BEZIER_CTRL_PT1 = 1;
  private static readonly BEZIER_CTRL_PT2 = 2;
  private static readonly BEZIER_END = 3;
  private static readonly BEZIER_MAX_POINTS = 4;

  private readonly m_bezier: EDA_SHAPE;
  private readonly m_maxError: number;

  constructor(aBezier: EDA_SHAPE, aMaxError: number) {
    super();
    this.m_bezier = aBezier;
    this.m_maxError = aMaxError;
    console.assert(aBezier.GetShape() === SHAPE_T.BEZIER);
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    aPoints.AddPoint(this.m_bezier.GetStart());
    aPoints.AddPoint(this.m_bezier.GetBezierC1());
    aPoints.AddPoint(this.m_bezier.GetBezierC2());
    aPoints.AddPoint(this.m_bezier.GetEnd());

    aPoints.AddIndicatorLine(
      aPoints.Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_START),
      aPoints.Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_CTRL_PT1),
    );
    aPoints.AddIndicatorLine(
      aPoints.Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_CTRL_PT2),
      aPoints.Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_END),
    );
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    if (!CHECK_POINT_COUNT(aPoints, EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_MAX_POINTS)) return false;

    aPoints
      .Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_START)
      .SetPosition(this.m_bezier.GetStart());
    aPoints
      .Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_CTRL_PT1)
      .SetPosition(this.m_bezier.GetBezierC1());
    aPoints
      .Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_CTRL_PT2)
      .SetPosition(this.m_bezier.GetBezierC2());
    aPoints.Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_END).SetPosition(this.m_bezier.GetEnd());
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    if (!CHECK_POINT_COUNT(aPoints, EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_MAX_POINTS)) return;

    const start = aPoints.Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_START);
    const c1 = aPoints.Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_CTRL_PT1);
    const c2 = aPoints.Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_CTRL_PT2);
    const end = aPoints.Point(EDA_BEZIER_POINT_EDIT_BEHAVIOR.BEZIER_END);

    if (aEditedPoint === start) {
      this.m_bezier.SetStart(start.GetPosition());
    } else if (aEditedPoint === c1) {
      this.m_bezier.SetBezierC1(c1.GetPosition());
    } else if (aEditedPoint === c2) {
      this.m_bezier.SetBezierC2(c2.GetPosition());
    } else if (aEditedPoint === end) {
      this.m_bezier.SetEnd(end.GetPosition());
    }

    this.m_bezier.RebuildBezierToSegmentsPointsList(this.m_maxError);
  }
}

// Note: these static arc functions don't have to be in here - we could ship them out
// to a utils area for use by other code (e.g. polygon fillet editing).

/**
 * Move an end point of the arc, while keeping the tangent at the other endpoint.
 */
function editArcEndpointKeepTangent(
  aArc: EDA_SHAPE,
  aCenter: VECTOR2I,
  aStart: VECTOR2I,
  aMid: VECTOR2I,
  aEnd: VECTOR2I,
  _aCursor: VECTOR2I,
): void {
  let movingStart: boolean;
  let arcValid = true;

  let p1: VECTOR2I;
  let p2: VECTOR2I;
  let p3: VECTOR2I;
  // p1 does not move, p2 does.

  if (aStart.x !== aArc.GetStart().x || aStart.y !== aArc.GetStart().y) {
    p1 = aEnd;
    p2 = aStart;
    p3 = aMid;
    movingStart = true;
  } else if (aEnd.x !== aArc.GetEnd().x || aEnd.y !== aArc.GetEnd().y) {
    p1 = aStart;
    p2 = aEnd;
    p3 = aMid;
    movingStart = false;
  } else {
    return;
  }

  // Move the coordinate system
  let v1 = sub(p1, aCenter);
  let v2 = sub(p2, aCenter);
  const v3 = sub(p3, aCenter);

  // A point cannot be both the center and on the arc.
  if (EuclideanNorm(v1) === 0 || EuclideanNorm(v2) === 0) return;

  const u1 = { x: v1.x / EuclideanNorm(v1), y: v1.y / EuclideanNorm(v1) };
  const u2raw = {
    x: v3.x - (u1.x * v3.x + u1.y * v3.y) * u1.x,
    y: v3.y - (u1.x * v3.x + u1.y * v3.y) * u1.y,
  };
  const u2 = { x: u2raw.x / EuclideanNorm(u2raw), y: u2raw.y / EuclideanNorm(u2raw) };

  // [ u1, u3 ] is a base centered on the circle with:
  //  u1 : unit vector toward the point that does not move
  //  u2 : unit vector toward the mid point.

  // Get vectors v1, and v2 in that coordinate system.

  const det = u1.x * u2.y - u2.x * u1.y;

  // u1 and u2 are unit vectors, and perpendicular.
  // det should not be 0. In case it is, do not change the arc.
  if (det === 0) return;

  v1 = {
    x: (v1.x * u2.y - v1.y * u2.x) / det,
    y: (-v1.x * u1.y + v1.y * u1.x) / det,
  };

  v2 = {
    x: (v2.x * u2.y - v2.y * u2.x) / det,
    y: (-v2.x * u1.y + v2.y * u1.x) / det,
  };

  const R = EuclideanNorm(v1);
  let transformCircle = false;

  /*                 p2
   *                     X***
   *                         **  <---- This is the arc
   *            y ^            **
   *              |      R       *
   *              | <-----------> *
   *       x------x------>--------x p1
   *     C' <----> C      x
   *         delta
   *
   * p1 does not move, and the tangent at p1 remains the same.
   *  => The new center, C', will be on the C-p1 axis.
   * p2 moves
   *
   * The radius of the new circle is delta + R
   *
   * || C' p2 || = || C' P1 ||
   * is the same as :
   * ( delta + p2.x ) ^ 2 + p2.y ^ 2 = ( R + delta ) ^ 2
   *
   * delta = ( R^2  - p2.x ^ 2 - p2.y ^2 ) / ( 2 * p2.x - 2 * R )
   *
   * We can use this equation for any point p2 with p2.x < R
   */

  if (v2.x === R) {
    // Straight line, do nothing
    return;
  }

  if (v2.x > R) {
    // If we need to invert the curvature.
    // We modify the input so we can use the same equation
    transformCircle = true;
    v2 = { x: 2 * R - v2.x, y: v2.y };
  }

  // We can keep the tangent constraint.
  const delta = (R * R - v2.x * v2.x - v2.y * v2.y) / (2 * v2.x - 2 * R);

  // This is just to limit the radius, so nothing overflows later when drawing.
  if (Math.abs(v2.y / (R - v2.x)) > ADVANCED_CFG.GetCfg().m_DrawArcCenterMaxAngle) arcValid = false;

  // Never recorded a problem, but still checking.
  if (!Number.isFinite(delta)) arcValid = false;

  // v4 is the new center
  const v4raw = !transformCircle ? { x: -delta, y: 0 } : { x: 2 * R + delta, y: 0 };

  const v4 = {
    x: v4raw.x * u1.x + v4raw.y * u2.x,
    y: v4raw.x * u1.y + v4raw.y * u2.y,
  };

  // `v4 + aCenter`: VECTOR2D + VECTOR2I promotes to VECTOR2D, and the result is
  // narrowed back to the VECTOR2I `center` by truncation toward zero, not
  // rounding (`VECTOR2<int>( const VECTOR2<double>& )`).
  const center = toVECTOR2I(add(v4, aCenter));

  if (arcValid) {
    aArc.SetCenter(center);

    if (movingStart) aArc.SetStart(aStart);
    else aArc.SetEnd(aEnd);
  }
}

/**
 * Move the arc center but keep endpoint locations.
 */
function editArcCenterKeepEndpoints(
  aArc: EDA_SHAPE,
  aCenter: VECTOR2I,
  aStart: VECTOR2I,
  _aMid: VECTOR2I,
  aEnd: VECTOR2I,
): void {
  const c_snapEpsilon_sq = 4;

  // `aStart / 2 + aEnd / 2`: `VECTOR2<int>::operator/( double )` KiROUNDs each
  // component (not the plain truncating `aStart + aEnd) / 2` of the midpoint
  // sibling below).
  const m = add(halveRounded(aStart), halveRounded(aEnd));
  const perp = ResizeI(Perpendicular(sub(aEnd, aStart)), Math.trunc(INT_MAX / 2));

  const legal = new SEG(sub(m, perp), add(m, perp));

  const testSegments = [
    new SEG(aCenter, add(aCenter, { x: 1, y: 0 })),
    new SEG(aCenter, add(aCenter, { x: 0, y: 1 })),
  ];

  const points: VECTOR2I[] = [legal.A, legal.B];

  for (const seg of testSegments) {
    const vec = legal.IntersectLines(seg);

    if (vec && legal.SquaredDistance(vec) <= c_snapEpsilon_sq) points.push(vec);
  }

  let nearest: VECTOR2I | undefined;
  let min_d_sq = ECOORD_MAX;

  // Snap by distance between cursor and intersections
  for (const pt of points) {
    const d = sub(pt, aCenter);
    const d_sq = d.x * d.x + d.y * d.y;

    if (d_sq < min_d_sq - c_snapEpsilon_sq) {
      min_d_sq = d_sq;
      nearest = pt;
    }
  }

  if (nearest) aArc.SetCenter(nearest);
}

/**
 * Move an end point of the arc around the circumference.
 */
export function EditArcEndpointKeepCenter(
  aArc: EDA_SHAPE,
  aCenter: VECTOR2I,
  aStart: VECTOR2I,
  _aMid: VECTOR2I,
  aEnd: VECTOR2I,
  _aCursor: VECTOR2I,
  aIuScale: EdaIuScale,
): void {
  // 1 mil floor in the caller's units keeps the arc non-degenerate without
  // snapping small eeschema arcs that are legitimately under 100 mils.
  const minRadius = aIuScale.milsToIU(1);
  let movingStart: boolean;

  let p1: VECTOR2I;
  let p2: VECTOR2I;
  let prev_p1: VECTOR2I;

  // user is moving p1, we want to move p2 to the new radius.

  if (aStart.x !== aArc.GetStart().x || aStart.y !== aArc.GetStart().y) {
    prev_p1 = aArc.GetStart();
    p1 = aStart;
    p2 = aEnd;
    movingStart = true;
  } else {
    prev_p1 = aArc.GetEnd();
    p1 = aEnd;
    p2 = aStart;
    movingStart = false;
  }

  p1 = sub(p1, aCenter);
  p2 = sub(p2, aCenter);

  if (p1.x === 0 && p1.y === 0) p1 = sub(prev_p1, aCenter);

  if (p2.x === 0 && p2.y === 0) p2 = { x: 1, y: 0 };

  let radius = EuclideanNorm(p1);

  if (radius < minRadius) radius = minRadius;

  p1 = add(aCenter, ResizeI(p1, KiROUND(radius)));
  p2 = add(aCenter, ResizeI(p2, KiROUND(radius)));

  aArc.SetCenter(aCenter);

  if (movingStart) {
    aArc.SetStart(p1);
    aArc.SetEnd(p2);
  } else {
    aArc.SetStart(p2);
    aArc.SetEnd(p1);
  }
}

function editArcEndpointKeepCenterAndRadius(
  aArc: EDA_SHAPE,
  aCenter: VECTOR2I,
  aStart: VECTOR2I,
  _aMid: VECTOR2I,
  aEnd: VECTOR2I,
): void {
  let p1: VECTOR2I;
  let movingStart = false;

  // User is moving p1, we need to update whichever end that is
  // The other end won't move.

  if (aStart.x !== aArc.GetStart().x || aStart.y !== aArc.GetStart().y) {
    p1 = aStart;
    movingStart = true;
  } else {
    p1 = aEnd;
    movingStart = false;
  }

  // Do not change the radius
  p1 = sub(p1, aCenter);
  p1 = add(aCenter, ResizeI(p1, aArc.GetRadius()));

  if (movingStart) {
    aArc.SetStart(p1);
  } else {
    aArc.SetEnd(p1);
  }
}

/**
 * Move the mid point of the arc, while keeping the two endpoints.
 */
export function EditArcMidKeepCenter(
  aArc: EDA_SHAPE,
  aCenter: VECTOR2I,
  aStart: VECTOR2I,
  _aMid: VECTOR2I,
  aEnd: VECTOR2I,
  aCursor: VECTOR2I,
  aIuScale: EdaIuScale,
): void {
  // See EditArcEndpointKeepCenter for why we use the caller's IU scale.
  const minRadius = aIuScale.milsToIU(1);

  // Now, update the edit point position
  // Express the point in a circle-centered coordinate system.
  let start = sub(aStart, aCenter);
  let end = sub(aEnd, aCenter);

  let radius = EuclideanNorm(sub(aCursor, aCenter));

  if (radius < minRadius) radius = minRadius;

  start = ResizeI(start, KiROUND(radius));
  end = ResizeI(end, KiROUND(radius));

  start = add(start, aCenter);
  end = add(end, aCenter);

  aArc.SetStart(start);
  aArc.SetEnd(end);
}

/**
 * Move the mid point of the arc, while keeping the angle.
 */
function editArcMidKeepEndpoints(
  aArc: EDA_SHAPE,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aCursor: VECTOR2I,
): void {
  // Let 'm' be the middle point of the chord between the start and end points.
  // `( aStart + aEnd ) / 2`: integer add, then KiROUND-divide (see the m
  // computation in editArcCenterKeepEndpoints for the two-step sibling).
  const m = halveRounded(add(aStart, aEnd));

  // Legal midpoints lie on a vector starting just off the chord midpoint and extending out
  // past the existing midpoint.  We do not allow arc inflection while point editing.
  // `T::EuclideanNorm()` on a VECTOR2I is the KiROUNDing integer norm, then a
  // plain (truncating) `int / int` divides it by 100.
  const JUST_OFF = Math.trunc(EuclideanNormI(sub(aStart, aEnd)) / 100);
  const v = sub(aArc.GetArcMid(), m);
  const legal = new SEG(add(m, ResizeI(v, JUST_OFF)), add(m, ResizeI(v, Math.trunc(INT_MAX / 2))));
  const mid = legal.NearestPoint(aCursor);

  aArc.SetArcGeometry(aStart, mid, aEnd);
}

/**
 * "Standard" arc editing behavior.
 */
export class EDA_ARC_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private static readonly ARC_START = 0;
  private static readonly ARC_MID = 1;
  private static readonly ARC_END = 2;
  private static readonly ARC_CENTER = 3;

  private readonly m_arc: EDA_SHAPE;
  // The arc edit mode, which is injected from the editor
  private readonly m_arcEditMode: { value: ARC_EDIT_MODE };
  private readonly m_viewControls: VIEW_CONTROLS;
  // IU scale of the owning editor, used to derive the minimum arc radius
  private readonly m_iuScale: EdaIuScale;

  constructor(
    aArc: EDA_SHAPE,
    aArcEditMode: { value: ARC_EDIT_MODE },
    aViewControls: VIEW_CONTROLS,
    aIuScale: EdaIuScale,
  ) {
    super();
    this.m_arc = aArc;
    this.m_arcEditMode = aArcEditMode;
    this.m_viewControls = aViewControls;
    this.m_iuScale = aIuScale;
    console.assert(this.m_arc.GetShape() === SHAPE_T.ARC);
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    aPoints.AddPoint(this.m_arc.GetStart());
    aPoints.AddPoint(this.m_arc.GetArcMid());
    aPoints.AddPoint(this.m_arc.GetEnd());
    aPoints.AddPoint(this.m_arc.getCenter());

    aPoints.AddIndicatorLine(
      aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_CENTER),
      aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_START),
    );
    aPoints.AddIndicatorLine(
      aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_CENTER),
      aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_END),
    );
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    if (!CHECK_POINT_COUNT(aPoints, 4)) return false;

    aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_START).SetPosition(this.m_arc.GetStart());
    aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_MID).SetPosition(this.m_arc.GetArcMid());
    aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_END).SetPosition(this.m_arc.GetEnd());
    aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_CENTER).SetPosition(this.m_arc.getCenter());
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    if (!CHECK_POINT_COUNT(aPoints, 4)) return;

    const centerPoint = aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_CENTER);
    const midPoint = aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_MID);
    const startPoint = aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_START);
    const endPoint = aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_END);

    const center = centerPoint.GetPosition();
    const mid = midPoint.GetPosition();
    const start = startPoint.GetPosition();
    const end = endPoint.GetPosition();

    if (aEditedPoint === centerPoint) {
      switch (this.m_arcEditMode.value) {
        case ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION:
          editArcCenterKeepEndpoints(this.m_arc, center, start, mid, end);
          break;

        case ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS:
        case ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE: {
          // Both these modes just move the arc
          const moveVector = sub(center, this.m_arc.getCenter());

          this.m_arc.SetArcGeometry(
            add(this.m_arc.GetStart(), moveVector),
            add(this.m_arc.GetArcMid(), moveVector),
            add(this.m_arc.GetEnd(), moveVector),
          );
          break;
        }
      }
    } else if (aEditedPoint === midPoint) {
      // `const VECTOR2I& cursorPos = m_viewControls.GetCursorPosition( false );`:
      // GetCursorPosition returns VECTOR2D, and binding it to a VECTOR2I&
      // materialises a temporary through the truncating (not rounding) int
      // conversion - see the same conversion in editArcEndpointKeepTangent.
      const cursor = toVECTOR2I(this.m_viewControls.GetCursorPosition(false));

      switch (this.m_arcEditMode.value) {
        case ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION:
          editArcMidKeepEndpoints(this.m_arc, start, end, cursor);
          break;
        case ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE:
        case ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS:
          EditArcMidKeepCenter(this.m_arc, center, start, mid, end, cursor, this.m_iuScale);
          break;
      }
    } else if (aEditedPoint === startPoint || aEditedPoint === endPoint) {
      const cursor = toVECTOR2I(this.m_viewControls.GetCursorPosition());

      switch (this.m_arcEditMode.value) {
        case ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS:
          EditArcEndpointKeepCenter(this.m_arc, center, start, mid, end, cursor, this.m_iuScale);
          break;
        case ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE:
          editArcEndpointKeepCenterAndRadius(this.m_arc, center, start, mid, end);
          break;
        case ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION:
          editArcEndpointKeepTangent(this.m_arc, center, start, mid, end, cursor);
          break;
      }
    }
  }

  override Get45DegreeConstrainer(_aEditedPoint: EDIT_POINT, aPoints: EDIT_POINTS): OPT_VECTOR2I {
    return aPoints.Point(EDA_ARC_POINT_EDIT_BEHAVIOR.ARC_CENTER).GetPosition();
  }
}

/**
 * "Standard" table-cell editing behavior.
 *
 * This works over the #EDA_SHAPE basis of a SCH/PCB_TABLECELL.
 * The cells and tables themselves aren't (yet) polymorphic, so the implmentation
 * has to provide UpdateItem() to handle the actual update.
 */
export class EDA_TABLECELL_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private static readonly COL_WIDTH = 0;
  private static readonly ROW_HEIGHT = 1;

  private readonly m_cell: EDA_SHAPE;

  constructor(aCell: EDA_SHAPE) {
    super();
    this.m_cell = aCell;
    // Point editor only supports cardinally-rotated table cells.
    console.assert(aCell.GetShape() === SHAPE_T.RECTANGLE);
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    const end = this.m_cell.GetEnd();
    // `GetRectangleHeight() / 2` / `GetRectangleWidth() / 2`: plain `int / int`
    // division (both sides are already `int`), so it truncates toward zero.
    aPoints.AddPoint({ x: end.x, y: end.y - Math.trunc(this.m_cell.GetRectangleHeight() / 2) });
    aPoints.AddPoint({ x: end.x - Math.trunc(this.m_cell.GetRectangleWidth() / 2), y: end.y });
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    const end = this.m_cell.GetEnd();
    aPoints
      .Point(EDA_TABLECELL_POINT_EDIT_BEHAVIOR.COL_WIDTH)
      .SetPosition({ x: end.x, y: end.y - Math.trunc(this.m_cell.GetRectangleHeight() / 2) });
    aPoints
      .Point(EDA_TABLECELL_POINT_EDIT_BEHAVIOR.ROW_HEIGHT)
      .SetPosition({ x: end.x - Math.trunc(this.m_cell.GetRectangleWidth() / 2), y: end.y });
    return true;
  }

  override UpdateItem(
    _aEditedPoint: EDIT_POINT,
    _aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    // Upstream leaves UpdateItem to the concrete SCH_/PCB_TABLECELL subclass,
    // since neither cell type is polymorphic over EDA_SHAPE here either.
  }
}

/**
 * `IncrementArcEditMode`.
 */
export function IncrementArcEditMode(aMode: ARC_EDIT_MODE): ARC_EDIT_MODE {
  switch (aMode) {
    case ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS:
      return ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE;
    case ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE:
      return ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION;
    case ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION:
      return ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS;
    default:
      console.assert(false, 'Invalid arc edit mode');
      return aMode;
  }
}

/**
 * `KI_ARC_EDIT` namespace: exposed for unit testing, as upstream's comment says.
 */
export const KI_ARC_EDIT = {
  EditArcEndpointKeepCenter,
  EditArcMidKeepCenter,
};
