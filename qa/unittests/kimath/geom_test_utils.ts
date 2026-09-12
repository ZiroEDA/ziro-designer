// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/geom_test_utils.h`: the `GEOM_TEST`
 * predicates the geometry suites share.
 */
import { ANGLE_180, ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { EuclideanNormI, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { IsWithin } from './fixtures_geometry.js';

/**
 * Geometric quadrants, from top-right, anti-clockwise
 *
 *     ^ y
 *     |
 *  Q2 | Q1
 *  -------> x
 *  Q3 | Q4
 */
export enum QUADRANT {
  Q1 = 0,
  Q2 = 1,
  Q3 = 2,
  Q4 = 3,
}

/** Check value in Quadrant 1 (x and y both >= 0) */
export function IsInQuadrant(aPoint: VECTOR2I, aQuadrant: QUADRANT): boolean {
  let isInQuad = false;

  switch (aQuadrant) {
    case QUADRANT.Q1:
      isInQuad = aPoint.x >= 0 && aPoint.y >= 0;
      break;
    case QUADRANT.Q2:
      isInQuad = aPoint.x <= 0 && aPoint.y >= 0;
      break;
    case QUADRANT.Q3:
      isInQuad = aPoint.x <= 0 && aPoint.y <= 0;
      break;
    case QUADRANT.Q4:
      isInQuad = aPoint.x >= 0 && aPoint.y <= 0;
      break;
  }

  return isInQuad;
}

/** Check if both ends of a segment are in Quadrant 1 */
export const SegmentCompletelyInQuadrant = (aSeg: SEG, aQuadrant: QUADRANT): boolean =>
  IsInQuadrant(aSeg.A, aQuadrant) && IsInQuadrant(aSeg.B, aQuadrant);

/** Check if at least one end of the segment is in Quadrant 1 */
export const SegmentEndsInQuadrant = (aSeg: SEG, aQuadrant: QUADRANT): boolean =>
  IsInQuadrant(aSeg.A, aQuadrant) || IsInQuadrant(aSeg.B, aQuadrant);

/** Check if a segment is entirely within a certain radius of a point. */
export const SegmentCompletelyWithinRadius = (aSeg: SEG, aPt: VECTOR2I, aRadius: number): boolean =>
  // This is true iff both ends of the segment are within the radius
  EuclideanNormI({ x: aSeg.A.x - aPt.x, y: aSeg.A.y - aPt.y }) < aRadius &&
  EuclideanNormI({ x: aSeg.B.x - aPt.x, y: aSeg.B.y - aPt.y }) < aRadius;

/**
 * Check that two points are the given distance apart, within the given tolerance.
 */
export function IsPointAtDistance(
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
  aExpDist: number,
  aTol: number,
): boolean {
  const dist = EuclideanNormI({ x: aPtB.x - aPtA.x, y: aPtB.y - aPtA.y });
  return IsWithin(dist, aExpDist, aTol);
}

/**
 * Predicate for checking a set of points is within a certain tolerance of
 * a circle
 */
export function ArePointsNearCircle(
  aPoints: readonly VECTOR2I[],
  aCentre: VECTOR2I,
  aRad: number,
  aTol: number,
): boolean {
  let ok = true;

  for (let i = 0; i < aPoints.length; ++i) {
    if (!IsPointAtDistance(aPoints[i]!, aCentre, aRad, aTol)) ok = false;
  }

  return ok;
}

/**
 * Check if two vectors are perpendicular
 *
 * @param aTolerance: the allowed deviation from PI/2 (e.g. when rounding)
 */
export function ArePerpendicular(a: VECTOR2I, b: VECTOR2I, aTolerance: EDA_ANGLE): boolean {
  let angle = EDA_ANGLE.fromVector(a).sub(EDA_ANGLE.fromVector(b)).abs();

  // Normalise: angles of 3*pi/2 are also perpendicular
  if (angle.gt(ANGLE_180)) angle = angle.sub(ANGLE_180);

  return IsWithin(angle.AsRadians(), ANGLE_90.AsRadians(), aTolerance.AsRadians());
}

/** Fillet every polygon in a set and return a new set */
export function FilletPolySet(
  aPolySet: SHAPE_POLY_SET,
  aRadius: number,
  aError: number,
): SHAPE_POLY_SET {
  const filletedPolySet = new SHAPE_POLY_SET();

  for (let i = 0; i < aPolySet.OutlineCount(); ++i) {
    const filleted = aPolySet.FilletPolygon(aRadius, aError, i);

    filletedPolySet.AddOutline(filleted[0]!);
  }

  return filletedPolySet;
}

const samePoint = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/**
 * Verify that a SHAPE_LINE_CHAIN has been assembled correctly by ensuring that the
 * arc start and end points match points on the chain and that any points inside the arcs
 * actually collide with the arc segments (with an error margin of 5000 IU)
 */
export function IsOutlineValid(aChain: SHAPE_LINE_CHAIN): boolean {
  let prevArcIdx = -1;
  const testedArcs = new Set<number>();

  if (aChain.PointCount() > 0 && !aChain.IsClosed() && aChain.IsSharedPt(0)) return false; //can't have first point being shared on an open chain

  for (let i = 0; i < aChain.PointCount(); i++) {
    const arcIdx = aChain.ArcIndex(i);

    if (arcIdx >= 0) {
      // Point on arc, lets make sure it collides with the arc shape and we haven't
      // previously seen the same arc index

      if (prevArcIdx !== arcIdx && testedArcs.has(arcIdx)) return false; // we've already seen this arc before, not contiguous

      if (!aChain.Arc(arcIdx).Collide(aChain.CPoint(i), SHAPE_ARC.DefaultAccuracyForPCB())) {
        return false;
      }

      testedArcs.add(arcIdx);
    }

    if (prevArcIdx !== arcIdx) {
      // we have changed arc shapes, run a few extra tests

      if (prevArcIdx >= 0) {
        // prev point on arc, test that the last arc point on the chain
        // matches the end point of the arc
        let pointToTest = aChain.CPoint(i);

        if (!aChain.IsSharedPt(i)) pointToTest = aChain.CPoint(i - 1);

        const lastArc = aChain.Arc(prevArcIdx);

        if (!samePoint(lastArc.GetP1(), pointToTest)) return false;
      }

      if (arcIdx >= 0) {
        // new arc, test that the start point of the arc matches the point on the chain
        const pointToTest = aChain.CPoint(i);
        const currentArc = aChain.Arc(arcIdx);

        if (!samePoint(currentArc.GetP0(), pointToTest)) return false;
      }
    }

    prevArcIdx = arcIdx;
  }

  // Make sure last arc point matches the end of the arc
  if (prevArcIdx >= 0) {
    if (aChain.IsClosed() && aChain.IsSharedPt(0)) {
      if (aChain.CShapes()[0]![0] !== prevArcIdx) return false;

      if (!samePoint(aChain.Arc(prevArcIdx).GetP1(), aChain.CPoint(0))) return false;
    } else {
      if (!samePoint(aChain.Arc(prevArcIdx).GetP1(), aChain.CLastPoint())) return false;
    }
  }

  return true;
}

/**
 * Verify that a SHAPE_POLY_SET has been assembled correctly by verifying each of the outlines
 * and holes contained within
 */
export function IsPolySetValid(aSet: SHAPE_POLY_SET): boolean {
  for (let i = 0; i < aSet.OutlineCount(); i++) {
    if (!IsOutlineValid(aSet.Outline(i))) return false;

    for (let j = 0; j < aSet.HoleCount(i); j++) {
      if (!IsOutlineValid(aSet.CHole(i, j))) return false;
    }
  }

  return true;
}

/**
 * Check that two SEGs have the same end points, in either order
 *
 * That is to say SEG(A, B) == SEG(A, B), but also SEG(A, B) == SEG(B, A)
 */
export const SegmentsHaveSameEndPoints = (aSeg1: SEG, aSeg2: SEG): boolean =>
  (samePoint(aSeg1.A, aSeg2.A) && samePoint(aSeg1.B, aSeg2.B)) ||
  (samePoint(aSeg1.A, aSeg2.B) && samePoint(aSeg1.B, aSeg2.A));

/**
 * `KI_TEST::CheckUnorderedMatches`: every expected item matches some found
 * item and every found item matches some expected item.
 */
export function CheckUnorderedMatches<E, F>(
  aExpected: readonly E[],
  aFound: readonly F[],
  aMatchPredicate: (e: E, f: F) => boolean,
): { unmatchedExpected: E[]; unmatchedFound: F[] } {
  const matched = new Set<number>();
  const unmatchedFound: F[] = [];

  for (const found of aFound) {
    let hit = false;
    for (let i = 0; i < aExpected.length; i++) {
      if (aMatchPredicate(aExpected[i]!, found)) {
        matched.add(i);
        hit = true;
        break;
      }
    }
    if (!hit) unmatchedFound.push(found);
  }

  const unmatchedExpected = aExpected.filter((_, i) => !matched.has(i));

  return { unmatchedExpected, unmatchedFound };
}
