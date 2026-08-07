// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Basic shapes to polygons.
 * Counterparts: `libs/kimath/src/convert_basic_shapes_to_polygon.cpp` and
 * `GetArcToSegmentCount` from `libs/kimath/src/geometry/geometry_utils.cpp`.
 */

import { KiROUND } from './math/util.js';
import type { VECTOR2I } from './math/vector2.js';

/** MIN_SEGCOUNT_FOR_CIRCLE. */
const MIN_SEGCOUNT_FOR_CIRCLE = 8;

/** Where the approximation error is spent relative to the true shape. */
export enum ErrorLoc {
  /** The polygon lies inside the shape: vertices sit on the true outline. */
  ERROR_INSIDE = 0,
  /** The polygon encloses the shape: the radius is grown to compensate. */
  ERROR_OUTSIDE = 1,
}

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
  let arcIncrement = (180 / Math.PI) * Math.acos(Math.max(-1.0, 1.0 - relError)) * 2;

  // A minimum increment keeps very small radii sane.
  arcIncrement = Math.min(360.0 / MIN_SEGCOUNT_FOR_CIRCLE, arcIncrement);

  const segCount = KiROUND(Math.abs(aArcAngleDeg) / arcIncrement);

  return Math.max(segCount, 2);
}

/**
 * `CircleToEndSegmentDeltaRadius` (geometry_utils.cpp): how far the polygon's
 * *vertices* stand outside the circle its edges are tangent to.
 *
 * `aRadius` is the radius of the circle tangent to the middle of each segment,
 * so `aRadius / cos(alpha)` is the radius through the segment ends and the
 * difference between them is `r * (1 - 1/cos alpha)`. That is a **secant**
 * relationship, not a cosine one: `r * (1 - cos alpha)` is the sagitta — how
 * far a chord's midpoint falls *inside* the circle — which is a different
 * quantity and always the smaller of the two.
 *
 * Getting this wrong is invisible except in size: the sole caller adds the
 * result back to the radius for `ERROR_OUTSIDE`, so a sagitta under-inflates
 * the polygon and it no longer encloses the circle it is standing in for. The
 * ratio is exactly `1 / cos alpha`, so the shortfall is ~8.2% of the
 * correction at the 8-segment floor, ~2.0% at 16 and ~0.5% at 32.
 */
export function circleToEndSegmentDeltaRadius(aRadius: number, aSegCount: number): number {
  // The minimum is 3, or the result cannot be computed; in practice KiCad
  // clamps to 8.
  const segCount = aSegCount <= 2 ? 3 : aSegCount;
  const alpha = Math.PI / segCount;
  return KiROUND(Math.abs(aRadius * (1.0 - 1.0 / Math.cos(alpha))));
}

/**
 * TransformCircleToPolygon, the SHAPE_LINE_CHAIN form.
 *
 * The vertex phase (`delta / 2`) and the round-up to a multiple of 8 are not
 * cosmetic: they put vertices symmetrically about the axes and land segment
 * boundaries on the 45° diagonals, so a track entering a via along an axis
 * meets an edge rather than a corner. Sampling from angle 0 instead shifts
 * every teardrop anchor by half a segment.
 */
export function transformCircleToPolygon(
  aCenter: VECTOR2I,
  aRadius: number,
  aError: number,
  aErrorLoc: ErrorLoc = ErrorLoc.ERROR_INSIDE,
  aMinSegCount = 0,
): VECTOR2I[] {
  let numSegs = getArcToSegmentCount(aRadius, aError, 360);
  numSegs = Math.max(aMinSegCount, numSegs);

  // Round up to 8 so the approximation aligns at 45 degrees.
  numSegs = Math.ceil(numSegs / 8) * 8;

  const delta = 360 / numSegs;
  let radius = aRadius;

  if (aErrorLoc === ErrorLoc.ERROR_OUTSIDE) {
    const actualDeltaRadius = circleToEndSegmentDeltaRadius(radius, numSegs);
    // GetCircleToPolyCorrection: the whole delta is added back.
    radius += actualDeltaRadius;
  }

  const buffer: VECTOR2I[] = [];

  for (let angle = delta / 2; angle < 360; angle += delta) {
    // RotatePoint's sense: KiCad's y axis points down, so a positive angle
    // turns clockwise on screen. (radius, 0) rotated by `angle` is therefore
    // (r cos a, -r sin a).
    const rad = (angle * Math.PI) / 180;
    buffer.push({
      x: aCenter.x + KiROUND(radius * Math.cos(rad)),
      y: aCenter.y - KiROUND(radius * Math.sin(rad)),
    });
  }

  return buffer;
}
