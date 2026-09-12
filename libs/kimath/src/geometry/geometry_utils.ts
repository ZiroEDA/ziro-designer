// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Free functions from `libs/kimath/include/geometry/geometry_utils.h`.
 *
 * These live in kimath upstream because half of KiCad reaches for them:
 * `GetVectorSnapped45` alone is used by the polygon geometry manager, by
 * `EC_45DEGREE` — the constraint every point-editor handle with a 45° rule goes
 * through — by the two-point geometry manager's `LEADER_MODE::DEG45`, and by
 * `DRAWING_TOOL::constrainDimension`. A copy parked next to any one of those
 * callers is a copy the other three will drift from.
 */
import { acos } from '../math/libm.js';
import type { BOX2I } from '../math/box2.js';
import { KiROUND } from '../math/util.js';
import type { Vec2, VECTOR2I } from '../math/vector2.js';
import type { EDA_ANGLE } from './eda_angle.js';
import type { SHAPE } from './shape.js';
import { SHAPE_COMPOUND } from './shape_compound.js';
import { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import { SHAPE_RECT } from './shape_rect.js';
import { SHAPE_SIMPLE } from './shape_simple.js';

/** MIN_SEGCOUNT_FOR_CIRCLE. */
const MIN_SEGCOUNT_FOR_CIRCLE = 8;

/**
 * GetArcToSegmentCount: segments needed so the sagitta stays under aErrorMax.
 *
 * @param aArcAngleDeg the arc's span in degrees; 360 for a full circle.
 */
export function getArcToSegmentCount(
  aRadius: number,
  aErrorMax: number,
  aArcAngleDeg: number,
): number {
  // Avoid divide-by-zero.
  const radius = Math.max(1, aRadius);
  const errorMax = Math.max(1, aErrorMax);

  const relError = errorMax / radius;

  // An error budget larger than the diameter drives acos out of its domain.
  // Upstream leaves this to the platform, where the resulting NaN falls through
  // `std::min` and lands on the 8-segment floor; clamping to -1 reaches the
  // same floor deliberately instead of by accident.
  let arcIncrement = (180 / Math.PI) * acos(Math.max(-1.0, 1.0 - relError)) * 2;

  // A minimum increment keeps very small radii sane.
  arcIncrement = Math.min(360.0 / MIN_SEGCOUNT_FOR_CIRCLE, arcIncrement);

  const segCount = KiROUND(Math.abs(aArcAngleDeg) / arcIncrement);

  return Math.max(segCount, 2);
}

/**
 * `LEADER_MODE` (`geometry_utils.h:42-51`) — the kind of the leader line.
 *
 * It lives in kimath, not in any one preview item, because three geometry
 * managers and a tool all read it: `POLYGON_GEOM_MANAGER::SetLeaderMode`,
 * `TWO_POINT_GEOMETRY_MANAGER::SetAngleSnap`, `ARC_GEOM_MANAGER` (as a bool),
 * and `PCB_TOOL_BASE::GetAngleSnapMode`, which returns
 * `PCBNEW_SETTINGS::m_AngleSnapMode` — the left toolbar's line-mode group.
 */
export enum LeaderMode {
  /** Unconstrained point-to-point. */
  DIRECT = 0,
  /** 45 degree only. */
  DEG45 = 1,
  /** 90 degree only. */
  DEG90 = 2,
}

/**
 * `GetVectorSnapped45( aVec, only45 )` (geometry_utils.h:112-140): the nearest
 * 0°, 45° or 90° line.
 *
 * The magnitude is deliberately **not** preserved — components are zeroed or
 * made equal in size instead — "so that if the starting vector is on a square
 * grid, the resulting snapped vector will still be on the same grid". Resizing
 * to the original length would put the far end off-grid, which is the whole
 * thing this function exists to avoid.
 *
 * `only45` drops the two axis arms, leaving the true diagonals.
 */
export function vectorSnapped45(aVec: Vec2, only45 = false): Vec2 {
  const ax = Math.abs(aVec.x);
  const ay = Math.abs(aVec.y);

  if (!only45 && ax > ay * 2) return { x: aVec.x, y: 0 };
  if (!only45 && ay > ax * 2) return { x: 0, y: aVec.y };

  // `std::copysign( a, b )`: the magnitude of a, the sign of b. A zero
  // component counts as positive, as copysign treats +0.
  if (ax > ay) return { x: aVec.x, y: aVec.y < 0 ? -ax : ax };
  return { x: aVec.x < 0 ? -ay : ay, y: aVec.y };
}

/**
 * `GetVectorSnapped90( aVec )` (geometry_utils.h:152-164): the nearest
 * horizontal or vertical line, keeping whichever component is larger.
 *
 * The tie goes to horizontal — upstream's test is `absVec.x >= absVec.y`, so a
 * perfect diagonal snaps flat, not upright.
 */
export function vectorSnapped90(aVec: Vec2): Vec2 {
  return Math.abs(aVec.x) >= Math.abs(aVec.y) ? { x: aVec.x, y: 0 } : { x: 0, y: aVec.y };
}

/**
 * `GetArcToSegmentCount( int aRadius, int aErrorMax, const EDA_ANGLE& aArcAngle )`:
 * the header's form; {@link getArcToSegmentCount} takes the angle in degrees.
 */
export function GetArcToSegmentCount(
  aRadius: number,
  aErrorMax: number,
  aArcAngle: EDA_ANGLE,
): number {
  return getArcToSegmentCount(aRadius, aErrorMax, aArcAngle.AsDegrees());
}

/**
 * `CircleToEndSegmentDeltaRadius`: the radius correction between a circle
 * tangent to the middle of each segment and the circle through the segment
 * ends, when the circle is approximated by aSegCount segments.
 */
export function CircleToEndSegmentDeltaRadius(aRadius: number, aSegCount: number): number {
  // The minimal seg count is 3, otherwise we cannot calculate the result
  // in practice, the min count is clamped to 8 in kicad
  if (aSegCount <= 2) aSegCount = 3;

  // The angle between the center of the segment and one end of the segment
  // when the circle is approximated by aSegCount segments
  const alpha = Math.PI / aSegCount;

  // aRadius is the radius of the circle tangent to the middle of each segment
  // and aRadius/cos(aplha) is the radius of the circle defined by seg ends
  const delta = KiROUND(Math.abs(aRadius * (1 - 1 / Math.cos(alpha))));

  return delta;
}

// When creating polygons to create a clearance polygonal area, the polygon must
// be same or bigger than the original shape.
// Polygons are bigger if the original shape has arcs (round rectangles, ovals,
// circles...).  However, when building the solder mask layer modifying the shapes
// when converting them to polygons is not acceptable (the modification can break
// calculations).
// So one can disable the shape expansion within a particular scope by allocating
// a DISABLE_ARC_CORRECTION.

let s_disable_arc_correction = false;

/**
 * `DISABLE_ARC_RADIUS_CORRECTION`: a scope guard; construct it, and call
 * `dispose()` where the C++ destructor would run.
 */
export class DISABLE_ARC_RADIUS_CORRECTION {
  constructor() {
    s_disable_arc_correction = true;
  }

  dispose(): void {
    s_disable_arc_correction = false;
  }
}

export function GetCircleToPolyCorrection(aMaxError: number): number {
  // Push all the error to the outside by increasing the radius
  return s_disable_arc_correction ? 0 : aMaxError;
}

/**
 * Utility for the line clipping code, returns the boundary code of
 * a point. Bit allocation is arbitrary
 */
function clipOutCode(aClipBox: BOX2I, x: number, y: number): number {
  let code: number;

  if (y < aClipBox.GetY()) code = 2;
  else if (y > aClipBox.GetBottom()) code = 1;
  else code = 0;

  if (x < aClipBox.GetX()) code |= 4;
  else if (x > aClipBox.GetRight()) code |= 8;

  return code;
}

/** The `int& x1, y1, x2, y2` of `ClipLine`. */
export interface ClipLineEnds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Test if any part of a line falls within the bounds of a rectangle.
 *
 * Please note that this is only accurate for lines that are one pixel wide.
 *
 * @param aClipBox - The rectangle to test.
 * @param aEnds - the line ends; clipped in place when the line crosses the box.
 * @return - False if any part of the line lies within the rectangle.
 */
export function ClipLine(aClipBox: BOX2I, aEnds: ClipLineEnds): boolean {
  // Stock Cohen-Sutherland algorithm; check *any* CG book for details
  let outcode1 = clipOutCode(aClipBox, aEnds.x1, aEnds.y1);
  let outcode2 = clipOutCode(aClipBox, aEnds.x2, aEnds.y2);

  while (outcode1 || outcode2) {
    // Fast reject
    if (outcode1 & outcode2) return true;

    // Choose a side to clip
    let thisoutcode: number;
    let x: number;
    let y: number;

    if (outcode1) thisoutcode = outcode1;
    else thisoutcode = outcode2;

    /* One clip round
     * Since we use the full range of 32 bit ints, the proportion
     * computation has to be done in 64 bits to avoid horrible
     * results */
    if (thisoutcode & 1) {
      // Clip the bottom
      y = aClipBox.GetBottom();
      x =
        aEnds.x1 +
        Number((BigInt(aEnds.x2 - aEnds.x1) * BigInt(y - aEnds.y1)) / BigInt(aEnds.y2 - aEnds.y1));
    } else if (thisoutcode & 2) {
      // Clip the top
      y = aClipBox.GetY();
      x =
        aEnds.x1 +
        Number((BigInt(aEnds.x2 - aEnds.x1) * BigInt(y - aEnds.y1)) / BigInt(aEnds.y2 - aEnds.y1));
    } else if (thisoutcode & 8) {
      // Clip the right
      x = aClipBox.GetRight();
      y =
        aEnds.y1 +
        Number((BigInt(aEnds.y2 - aEnds.y1) * BigInt(x - aEnds.x1)) / BigInt(aEnds.x2 - aEnds.x1));
    } // if( thisoutcode & 4), obviously, clip the left
    else {
      x = aClipBox.GetX();
      y =
        aEnds.y1 +
        Number((BigInt(aEnds.y2 - aEnds.y1) * BigInt(x - aEnds.x1)) / BigInt(aEnds.x2 - aEnds.x1));
    }

    // Put the result back and update the boundary code
    // No ambiguity, otherwise it would have been a fast reject
    if (thisoutcode === outcode1) {
      aEnds.x1 = x;
      aEnds.y1 = y;
      outcode1 = clipOutCode(aClipBox, aEnds.x1, aEnds.y1);
    } else {
      aEnds.x2 = x;
      aEnds.y2 = y;
      outcode2 = clipOutCode(aClipBox, aEnds.x2, aEnds.y2);
    }
  }

  return false;
}

/**
 * `KIGEOM::BoxHitTest( const VECTOR2I& aHitter, const BOX2I& aHittee, int aAccuracy )`:
 * check that the box contains the point.
 */
export function KIGEOM_BoxHitTestPoint(aHitter: Vec2, aHittee: BOX2I, aAccuracy: number): boolean {
  const hittee = aHittee.GetInflated(aAccuracy);
  return hittee.Contains(aHitter);
}

/**
 * `KIGEOM::BoxHitTest( const BOX2I& aHitter, const BOX2I& aHittee, bool aHitteeContained, int aAccuracy )`:
 * check that the hitter box intersects (or contains) the hittee.
 */
export function KIGEOM_BoxHitTestBox(
  aHitter: BOX2I,
  aHittee: BOX2I,
  aHitteeContained: boolean,
  aAccuracy: number,
): boolean {
  const hitter = aHitter.GetInflated(aAccuracy);

  if (aHitteeContained) return hitter.Contains(aHittee);

  return hitter.Intersects(aHittee);
}

/**
 * `KIGEOM::BoxHitTest( const SHAPE_LINE_CHAIN& aHitter, const BOX2I& aHittee, bool aHitteeContained )`.
 */
export function KIGEOM_BoxHitTestChain(
  aHitter: SHAPE_LINE_CHAIN,
  aHittee: BOX2I,
  aHitteeContained: boolean,
): boolean {
  const bbox = new SHAPE_RECT(aHittee);

  return KIGEOM_ShapeHitTest(aHitter, bbox, aHitteeContained);
}

/**
 * `KIGEOM::BoxHitTest( const SHAPE_LINE_CHAIN&, const BOX2I&, const EDA_ANGLE&, const VECTOR2I&, bool )`:
 * the hittee box rotated about a centre.
 */
export function KIGEOM_BoxHitTestChainRotated(
  aHitter: SHAPE_LINE_CHAIN,
  aHittee: BOX2I,
  aHitteeRotation: EDA_ANGLE,
  aHitteeRotationCenter: Vec2,
  aHitteeContained: boolean,
): boolean {
  // Optimization: use SHAPE_RECT collision test if possible
  if (aHitteeRotation.IsZero()) {
    return KIGEOM_BoxHitTestChain(aHitter, aHittee, aHitteeContained);
  }
  if (aHitteeRotation.IsCardinal()) {
    const box = aHittee.GetBoundingBoxRotated(aHitteeRotationCenter, aHitteeRotation);
    return KIGEOM_BoxHitTestChain(aHitter, box, aHitteeContained);
  }

  // Non-cardinal angle: convert to simple polygon and rotate
  const corners: VECTOR2I[] = [
    aHittee.GetOrigin(),
    { x: aHittee.GetRight(), y: aHittee.GetTop() },
    aHittee.GetEnd(),
    { x: aHittee.GetLeft(), y: aHittee.GetBottom() },
  ];

  // `SHAPE_SIMPLE shape( corners )`: the vector converts through SHAPE_LINE_CHAIN
  const shape = new SHAPE_SIMPLE(new SHAPE_LINE_CHAIN(corners));
  shape.Rotate(aHitteeRotation, aHitteeRotationCenter);

  return KIGEOM_ShapeHitTest(aHitter, shape, aHitteeContained);
}

/**
 * `KIGEOM::ShapeHitTest`: check that a shape is hit by a selection polygon
 * (closed) or polyline (open).
 */
export function KIGEOM_ShapeHitTest(
  aHitter: SHAPE_LINE_CHAIN,
  aHittee: SHAPE,
  aHitteeContained: boolean,
): boolean {
  // Check if the selection polygon collides with any of the hittee's subshapes.
  const collidesAny = (): boolean => aHittee.Collide(aHitter);

  // Check if the selection polygon collides with all of the hittee's subshapes.
  const collidesAll = (): boolean => {
    if (aHittee instanceof SHAPE_COMPOUND) {
      // If the hittee is a compound shape, all subshapes must collide.
      return aHittee.Shapes().every((subshape) => subshape && subshape.Collide(aHitter));
    }
    // If the hittee is a simple shape, we can check it directly.
    return aHittee.Collide(aHitter);
  };

  // Check if the selection polygon outline collides with the hittee's shape.
  const intersectsAny = (): boolean => {
    const count = aHitter.SegmentCount();

    for (let i = 0; i < count; ++i) {
      if (aHittee.Collide(aHitter.CSegment(i))) return true;
    }

    return false;
  };

  if (aHitter.IsClosed()) {
    if (aHitteeContained)
      // Containing polygon - all of the subshapes must collide with the selection polygon,
      // but none of them can intersect its outline.
      return collidesAll() && !intersectsAny();
    // Touching polygon - any of the subshapes should collide with the selection polygon.
    return collidesAny();
  }
  // Touching (poly)line - any of the subshapes should intersect the selection polyline.
  return intersectsAny();
}
