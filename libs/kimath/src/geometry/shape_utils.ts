// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGEOM` (`geometry/shape_utils.h`, `src/geometry/shape_utils.cpp`): the
 * free helpers over shapes. The namespace is spelled as a `KIGEOM_` prefix.
 */

import type { BOX2I } from '../math/box2.js';
import { KiROUND } from '../math/util.js';
import { LexicographicalCompare, type VECTOR2I } from '../math/vector2.js';
import type { CIRCLE } from './circle.js';
import { Directions } from './direction45.js';
import { ANGLE_90, ANGLE_180, type EDA_ANGLE, FULL_CIRCLE } from './eda_angle.js';
import type { HALF_LINE } from './half_line.js';
import type { LINE } from './line.js';
import { POINT_TYPE, TYPED_POINT2I } from './point_types.js';
import { type OPT_VECTOR2I, SEG } from './seg.js';
import { SHAPE_ARC } from './shape_arc.js';
import { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import type { SHAPE_POLY_SET } from './shape_poly_set.js';
import type { SHAPE_RECT } from './shape_rect.js';
import { GetRotated, RotatePointD } from '../trigo.js';

/**
 * Returns a SEG such that the start point is smaller or equal
 * in x and y compared to the end point.
 */
export function KIGEOM_NormalisedSeg(aSeg: SEG): SEG {
  if (LexicographicalCompare(aSeg.A, aSeg.B) <= 0) return aSeg;

  return aSeg.Reversed();
}

/**
 * Get the end point of the segment that is _not_ the given point.
 */
export function KIGEOM_GetOtherEnd(aSeg: SEG, aPoint: VECTOR2I): VECTOR2I {
  return aSeg.A.x === aPoint.x && aSeg.A.y === aPoint.y ? aSeg.B : aSeg.A;
}

/**
 * Get the shared endpoint of two segments, if any, or std::nullopt if the segments are not
 * connected end-to-end.
 */
export function KIGEOM_GetSharedEndpoint(aSegA: SEG, aSegB: SEG): OPT_VECTOR2I {
  const eq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

  if (eq(aSegA.A, aSegB.A) || eq(aSegA.A, aSegB.B)) return aSegA.A;
  else if (eq(aSegA.B, aSegB.A) || eq(aSegA.B, aSegB.B)) return aSegA.B;

  return undefined;
}

/**
 * Decompose a BOX2 into four segments.
 *
 * Segments are returned in the order: Top, Right, Bottom, Left.
 */
export function KIGEOM_BoxToSegs(aBox: BOX2I): [SEG, SEG, SEG, SEG] {
  const corners: [VECTOR2I, VECTOR2I, VECTOR2I, VECTOR2I] = [
    { x: aBox.GetLeft(), y: aBox.GetTop() },
    { x: aBox.GetRight(), y: aBox.GetTop() },
    { x: aBox.GetRight(), y: aBox.GetBottom() },
    { x: aBox.GetLeft(), y: aBox.GetBottom() },
  ];

  return [
    new SEG(corners[0], corners[1]),
    new SEG(corners[1], corners[2]),
    new SEG(corners[2], corners[3]),
    new SEG(corners[3], corners[0]),
  ];
}

/**
 * Add the 4 corners of a BOX2I to a vector.
 */
export function KIGEOM_CollectBoxCorners(aBox: BOX2I, aCorners: VECTOR2I[]): void {
  aCorners.push({ x: aBox.GetLeft(), y: aBox.GetTop() });
  aCorners.push({ x: aBox.GetRight(), y: aBox.GetTop() });
  aCorners.push({ x: aBox.GetRight(), y: aBox.GetBottom() });
  aCorners.push({ x: aBox.GetLeft(), y: aBox.GetBottom() });
}

/**
 * Get the line chain of a BOX2I.
 */
export function KIGEOM_BoxToLineChain(aBox: BOX2I): SHAPE_LINE_CHAIN {
  const result = new SHAPE_LINE_CHAIN();
  result.Append({ x: aBox.GetLeft(), y: aBox.GetTop() });
  result.Append({ x: aBox.GetRight(), y: aBox.GetTop() });
  result.Append({ x: aBox.GetRight(), y: aBox.GetBottom() });
  result.Append({ x: aBox.GetLeft(), y: aBox.GetBottom() });
  result.SetClosed(true);
  return result;
}

/**
 * Get the segments of a box that are in the given direction.
 *
 * Segments are returned in the order: Top, Right, Bottom, Left,
 * and the direction is the direction of the segment relative to the box.
 */
export function KIGEOM_GetSegsInDirection(aBox: BOX2I, aDir: Directions): SEG[] {
  switch (aDir) {
    case Directions.N:
      return [
        new SEG({ x: aBox.GetLeft(), y: aBox.GetTop() }, { x: aBox.GetRight(), y: aBox.GetTop() }),
      ];
    case Directions.E:
      return [
        new SEG(
          { x: aBox.GetRight(), y: aBox.GetTop() },
          { x: aBox.GetRight(), y: aBox.GetBottom() },
        ),
      ];
    case Directions.S:
      return [
        new SEG(
          { x: aBox.GetLeft(), y: aBox.GetBottom() },
          { x: aBox.GetRight(), y: aBox.GetBottom() },
        ),
      ];
    case Directions.W:
      return [
        new SEG(
          { x: aBox.GetLeft(), y: aBox.GetTop() },
          { x: aBox.GetLeft(), y: aBox.GetBottom() },
        ),
      ];
    case Directions.NE:
      return [
        new SEG({ x: aBox.GetLeft(), y: aBox.GetTop() }, { x: aBox.GetRight(), y: aBox.GetTop() }),
        new SEG(
          { x: aBox.GetRight(), y: aBox.GetTop() },
          { x: aBox.GetRight(), y: aBox.GetBottom() },
        ),
      ];
    case Directions.SE:
      return [
        new SEG(
          { x: aBox.GetLeft(), y: aBox.GetBottom() },
          { x: aBox.GetRight(), y: aBox.GetBottom() },
        ),
        new SEG(
          { x: aBox.GetRight(), y: aBox.GetTop() },
          { x: aBox.GetRight(), y: aBox.GetBottom() },
        ),
      ];
    case Directions.SW:
      return [
        new SEG(
          { x: aBox.GetLeft(), y: aBox.GetBottom() },
          { x: aBox.GetRight(), y: aBox.GetBottom() },
        ),
        new SEG(
          { x: aBox.GetLeft(), y: aBox.GetTop() },
          { x: aBox.GetLeft(), y: aBox.GetBottom() },
        ),
      ];
    case Directions.NW:
      return [
        new SEG({ x: aBox.GetLeft(), y: aBox.GetTop() }, { x: aBox.GetRight(), y: aBox.GetTop() }),
        new SEG(
          { x: aBox.GetLeft(), y: aBox.GetTop() },
          { x: aBox.GetLeft(), y: aBox.GetBottom() },
        ),
      ];
    case Directions.LAST:
    case Directions.UNDEFINED:
      break;
  }

  console.assert(false);
  return [];
}

/**
 * Get the segment of a half-line that is inside a box, if any.
 */
export function KIGEOM_ClipHalfLineToBox(aRay: HALF_LINE, aBox: BOX2I): SEG | undefined {
  // Do the naive implementation - if this really is done in a tight loop,
  // the Cohen-Sutherland implementation in ClipLine could be faster, but
  // needs to be adapted to work with half-lines.
  const boxSegs = KIGEOM_BoxToSegs(aBox);

  let ptA: VECTOR2I | undefined;
  let ptB: VECTOR2I | undefined;

  for (const boxSeg of boxSegs) {
    const intersection = aRay.Intersect(boxSeg);

    if (!intersection) continue;

    // Init the first point or eat it if it's the same
    if (!ptA || (intersection.x === ptA.x && intersection.y === ptA.y)) {
      ptA = intersection;
    } else {
      ptB = intersection;
    }
  }

  // If we have exactly two intersections, the ray crossed twice
  // so take the segment between the two points
  if (ptA && ptB) return new SEG(ptA, ptB);

  // It only crosses once, so the start is in the box. Take the segment from
  // the start point to the intersection
  if (ptA && !(ptA.x === aRay.GetStart().x && ptA.y === aRay.GetStart().y))
    return new SEG(aRay.GetStart(), ptA);

  // It didn't cross at all
  return undefined;
}

/**
 * Get the segment of a line that is inside a box, if any.
 */
export function KIGEOM_ClipLineToBox(aLine: LINE, aBox: BOX2I): SEG | undefined {
  // As above, maybe can be optimised?
  const boxSegs = KIGEOM_BoxToSegs(aBox);

  let ptA: VECTOR2I | undefined;
  let ptB: VECTOR2I | undefined;

  for (const boxSeg of boxSegs) {
    const intersection = aLine.Intersect(boxSeg);

    // Reject intersections that are not on the actual box boundary
    if (intersection && boxSeg.Contains(intersection)) {
      // Init the first point or eat it if it's the same
      if (!ptA || (intersection.x === ptA.x && intersection.y === ptA.y)) {
        ptA = intersection;
      } else {
        ptB = intersection;
      }
    }
  }

  // If we have exactly two intersections, we have a segment
  // (zero is no intersection, and one is a just crossing a corner exactly)
  if (ptA && ptB) return new SEG(ptA, ptB);

  return undefined;
}

/**
 * Get a SHAPE_ARC representing a 90-degree arc in the clockwise direction with the
 * midpoint in the given direction from the center.
 *
 * E.g. for the NW direction, this is the top left corner of a rectangle
 */
export function KIGEOM_MakeArcCw90(
  aCenter: VECTOR2I,
  aRadius: number,
  aDir: Directions,
): SHAPE_ARC {
  switch (aDir) {
    case Directions.NW:
      return new SHAPE_ARC(aCenter, { x: aCenter.x - aRadius, y: aCenter.y }, ANGLE_90);
    case Directions.NE:
      return new SHAPE_ARC(aCenter, { x: aCenter.x, y: aCenter.y - aRadius }, ANGLE_90);
    case Directions.SW:
      return new SHAPE_ARC(aCenter, { x: aCenter.x, y: aCenter.y + aRadius }, ANGLE_90);
    case Directions.SE:
      return new SHAPE_ARC(aCenter, { x: aCenter.x + aRadius, y: aCenter.y }, ANGLE_90);
    default:
      // wxFAIL_MSG( "Invalid direction" )
      return new SHAPE_ARC();
  }
}

/**
 * Get a SHAPE_ARC representing a 180-degree arc in the clockwise direction with the
 * midpoint in the given direction from the center.
 */
export function KIGEOM_MakeArcCw180(
  aCenter: VECTOR2I,
  aRadius: number,
  aDir: Directions,
): SHAPE_ARC {
  switch (aDir) {
    case Directions.N:
      return new SHAPE_ARC(aCenter, { x: aCenter.x - aRadius, y: aCenter.y }, ANGLE_180);
    case Directions.E:
      return new SHAPE_ARC(aCenter, { x: aCenter.x, y: aCenter.y - aRadius }, ANGLE_180);
    case Directions.S:
      return new SHAPE_ARC(aCenter, { x: aCenter.x + aRadius, y: aCenter.y }, ANGLE_180);
    case Directions.W:
      return new SHAPE_ARC(aCenter, { x: aCenter.x, y: aCenter.y + aRadius }, ANGLE_180);
    default:
      // wxFAIL_MSG( "Invalid direction" )
      break;
  }

  return new SHAPE_ARC();
}

/**
 * Get the point on a rectangle that corresponds to a given direction.
 *
 * For directions N, E, S, W, the point is the center of the side.
 * For directions NW, NE, SW, SE, the point is the corner.
 */
export function KIGEOM_GetPoint(aRect: SHAPE_RECT, aDir: Directions, aOutset = 0): VECTOR2I {
  const nw = aRect.GetPosition();
  const w = aRect.GetWidth();
  const h = aRect.GetHeight();

  switch (aDir) {
    case Directions.N:
      return { x: nw.x + Math.trunc(w / 2), y: nw.y - aOutset };
    case Directions.E:
      return { x: nw.x + w + aOutset, y: nw.y + Math.trunc(h / 2) };
    case Directions.S:
      return { x: nw.x + Math.trunc(w / 2), y: nw.y + h + aOutset };
    case Directions.W:
      return { x: nw.x - aOutset, y: nw.y + Math.trunc(h / 2) };
    case Directions.NW:
      return { x: nw.x - aOutset, y: nw.y - aOutset };
    case Directions.NE:
      return { x: nw.x + w + aOutset, y: nw.y - aOutset };
    case Directions.SW:
      return { x: nw.x - aOutset, y: nw.y + h + aOutset };
    case Directions.SE:
      return { x: nw.x + w + aOutset, y: nw.y + h + aOutset };
    default:
      // wxFAIL_MSG( "Invalid direction" )
      break;
  }

  return { x: 0, y: 0 };
}

/**
 * Get key points of an CIRCLE.
 *
 * - The four cardinal points
 * - Optionally the center
 */
export function KIGEOM_GetCircleKeyPoints(
  aCircle: CIRCLE,
  aIncludeCenter: boolean,
): TYPED_POINT2I[] {
  const pts: TYPED_POINT2I[] = [];

  if (aIncludeCenter) pts.push(new TYPED_POINT2I({ x: 0, y: 0 }, POINT_TYPE.PT_CENTER));

  pts.push(new TYPED_POINT2I({ x: 0, y: aCircle.Radius }, POINT_TYPE.PT_QUADRANT));
  pts.push(new TYPED_POINT2I({ x: aCircle.Radius, y: 0 }, POINT_TYPE.PT_QUADRANT));
  pts.push(new TYPED_POINT2I({ x: 0, y: -aCircle.Radius }, POINT_TYPE.PT_QUADRANT));
  pts.push(new TYPED_POINT2I({ x: -aCircle.Radius, y: 0 }, POINT_TYPE.PT_QUADRANT));

  // Shift the points to the circle center
  for (const pt of pts)
    pt.m_point = { x: pt.m_point.x + aCircle.Center.x, y: pt.m_point.y + aCircle.Center.y };

  return pts;
}

/**
 * Rectify a polygon: make all the segments horizontal or vertical, taking the
 * corner that lies inside the polygon (or outside if not).
 */
export function KIGEOM_RectifyPolygon(aPoly: SHAPE_LINE_CHAIN): SHAPE_LINE_CHAIN {
  const raOutline = new SHAPE_LINE_CHAIN();

  const handleSegment = (aSeg: SEG): void => {
    const p0: VECTOR2I = { x: aSeg.A.x, y: aSeg.B.y };
    const p1: VECTOR2I = { x: aSeg.B.x, y: aSeg.A.y };

    raOutline.Append(aSeg.A);

    if (!aPoly.PointInside(p0)) raOutline.Append(p0);
    else raOutline.Append(p1);
  };

  for (let i = 0; i < aPoly.SegmentCount(); i++) handleSegment(aPoly.CSegment(i));

  // Manually handle the last segment if not closed
  if (!aPoly.IsClosed() && aPoly.PointCount() >= 2)
    handleSegment(new SEG(aPoly.CLastPoint(), aPoly.CPoint(0)));

  raOutline.SetClosed(true);
  raOutline.Simplify();

  return raOutline;
}

/**
 * Adds a hole to a polygon, if it is valid (i.e. it has 3 or more points
 * and a non-zero area.)
 *
 * @param aOutline The polygon to add the hole to.
 * @param aHole The hole to add.
 * @return true if the hole was added, false if it was not.
 */
export function KIGEOM_AddHoleIfValid(aOutline: SHAPE_POLY_SET, aHole: SHAPE_LINE_CHAIN): boolean {
  if (aHole.PointCount() < 3 || aHole.Area() === 0) return false;

  aOutline.AddHole(aHole);
  return true;
}

/**
 * Get the corners of a regular polygon from the centre, one point
 * and the number of sides.
 */
export function KIGEOM_MakeRegularPolygonPoints(
  aCenter: VECTOR2I,
  aN: number,
  aPt0: VECTOR2I,
): VECTOR2I[];
/**
 * Make a regular polygon of the given size across the corners.
 *
 * @param aCenter the center of the polygon
 * @param aN the number of sides
 * @param aRadius the radius of the polygon
 * @param aAcrossCorners if true, the radius is across the corners, otherwise across the flats
 * @param aAngle the angle of the first corner
 */
export function KIGEOM_MakeRegularPolygonPoints(
  aCenter: VECTOR2I,
  aN: number,
  aRadius: number,
  aAcrossCorners: boolean,
  aAngle: EDA_ANGLE,
): VECTOR2I[];
export function KIGEOM_MakeRegularPolygonPoints(
  aCenter: VECTOR2I,
  aN: number,
  c: VECTOR2I | number,
  aAcrossCorners?: boolean,
  aAngle?: EDA_ANGLE,
): VECTOR2I[] {
  if (typeof c === 'number') {
    let aRadius = c;

    if (!aAcrossCorners) {
      // if across flats, increase the radius
      aRadius = Math.trunc(aRadius / FULL_CIRCLE.divide(aN * 2).Cos());
    }

    const rot = GetRotated({ x: aRadius, y: 0 }, aAngle!);
    const pt0: VECTOR2I = { x: aCenter.x + rot.x, y: aCenter.y + rot.y };

    return KIGEOM_MakeRegularPolygonPoints(aCenter, aN, pt0);
  }

  const aPt0 = c;
  const pt0FromC = { x: aPt0.x - aCenter.x, y: aPt0.y - aCenter.y };
  const pts: VECTOR2I[] = [];

  for (let i = 0; i < aN; i++) {
    const pt = RotatePointD(pt0FromC, FULL_CIRCLE.divide(aN).multiply(i));
    pts.push({ x: KiROUND(pt.x + aCenter.x), y: KiROUND(pt.y + aCenter.y) });
  }

  return pts;
}

/**
 * Create the two segments for a cross
 *
 * @param aCenter the center of the cross
 * @param aSize the size of the cross (can be a rectangle)
 * @param aAngle the angle of the cross
 */
export function KIGEOM_MakeCrossSegments(
  aCenter: VECTOR2I,
  aSize: VECTOR2I,
  aAngle: EDA_ANGLE,
): SEG[] {
  const segs: SEG[] = [];

  let rot = GetRotated({ x: Math.trunc(aSize.x / 2), y: 0 }, aAngle);
  let pt0: VECTOR2I = { x: aCenter.x - rot.x, y: aCenter.y - rot.y };

  segs.push(
    new SEG(pt0, { x: aCenter.x - (pt0.x - aCenter.x), y: aCenter.y - (pt0.y - aCenter.y) }),
  );

  rot = GetRotated({ x: 0, y: Math.trunc(aSize.y / 2) }, aAngle);
  pt0 = { x: aCenter.x - rot.x, y: aCenter.y - rot.y };

  segs.push(
    new SEG(pt0, { x: aCenter.x - (pt0.x - aCenter.x), y: aCenter.y - (pt0.y - aCenter.y) }),
  );

  return segs;
}
