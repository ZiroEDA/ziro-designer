// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `geometry/oval.h` / `src/geometry/oval.cpp`: utility functions for ovals
 * (oblongs/stadiums).
 *
 * An "oval" is represented by SHAPE_SEGMENT, but these functions
 * aren't required for most users of SHAPE_SEGMENT.
 */

import { ResizeI, type VECTOR2I } from '../math/vector2.js';
import { GetRotated, RotatePoint } from '../trigo.js';
import { ANGLE_180, ANGLE_90, type EDA_ANGLE } from './eda_angle.js';
import { POINT_TYPE, TYPED_POINT2I } from './point_types.js';
import { SHAPE_ARC } from './shape_arc.js';
import { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import type { SHAPE_SEGMENT } from './shape_segment.js';

export function KIGEOM_ConvertToChain(aOval: SHAPE_SEGMENT): SHAPE_LINE_CHAIN {
  const seg = aOval.GetSeg();
  const perp = ResizeI(
    GetRotated({ x: seg.B.x - seg.A.x, y: seg.B.y - seg.A.y }, ANGLE_90),
    Math.trunc(aOval.GetWidth() / 2),
  );

  const chain = new SHAPE_LINE_CHAIN();
  chain.Append({ x: seg.A.x - perp.x, y: seg.A.y - perp.y });
  chain.Append(new SHAPE_ARC(seg.A, { x: seg.A.x - perp.x, y: seg.A.y - perp.y }, ANGLE_180));
  chain.Append({ x: seg.B.x + perp.x, y: seg.B.y + perp.y });
  chain.Append(new SHAPE_ARC(seg.B, { x: seg.B.x + perp.x, y: seg.B.y + perp.y }, ANGLE_180));
  chain.SetClosed(true);
  return chain;
}

export enum OVAL_KEY_POINTS {
  OVAL_CENTER = 1 << 0,
  OVAL_CAP_TIPS = 1 << 1,
  OVAL_CAP_CENTERS = 1 << 2,
  OVAL_SIDE_MIDPOINTS = 1 << 3,
  OVAL_SIDE_ENDS = 1 << 4,
  OVAL_CARDINAL_EXTREMES = 1 << 5,
  OVAL_ALL_KEY_POINTS = 0xff,
}

export type OVAL_KEY_POINT_FLAGS = number;

/**
 * Get a list of interesting points on an oval (rectangle
 * with semicircular end caps)
 *
 * This may includes:
 * - The middles of the sides
 * - The tips of the end caps
 * - The extreme cardinal points of the whole oval (if rotated non-cardinally)
 *
 * @param aOval  - The oval to get the points from
 * @param aFlags - The flags indicating which points to return
 *
 * @return The list of points and their geomtrical types
 */
export function KIGEOM_GetOvalKeyPoints(
  aOval: SHAPE_SEGMENT,
  aFlags: OVAL_KEY_POINT_FLAGS,
): TYPED_POINT2I[] {
  const half_width = Math.trunc(aOval.GetWidth() / 2);
  const half_len = Math.trunc(aOval.GetTotalLength() / 2);
  const rotation: EDA_ANGLE = aOval.GetAngle().sub(ANGLE_90);

  // Points on a non-rotated pad at the origin, long-axis is y
  // (so for now, width is left/right, len is up/down)
  const pts: TYPED_POINT2I[] = [];

  if (aFlags & OVAL_KEY_POINTS.OVAL_CENTER) {
    // Centre is easy
    pts.push(new TYPED_POINT2I({ x: 0, y: 0 }, POINT_TYPE.PT_CENTER));
  }

  if (aFlags & OVAL_KEY_POINTS.OVAL_SIDE_MIDPOINTS) {
    // Side midpoints
    pts.push(new TYPED_POINT2I({ x: half_width, y: 0 }, POINT_TYPE.PT_MID));
    pts.push(new TYPED_POINT2I({ x: -half_width, y: 0 }, POINT_TYPE.PT_MID));
  }

  if (aFlags & OVAL_KEY_POINTS.OVAL_CAP_TIPS) {
    // If the oval is square-on, the tips are quadrants
    const pt_type = rotation.IsCardinal() ? POINT_TYPE.PT_QUADRANT : POINT_TYPE.PT_END;

    // Cap ends
    pts.push(new TYPED_POINT2I({ x: 0, y: half_len }, pt_type));
    pts.push(new TYPED_POINT2I({ x: 0, y: -half_len }, pt_type));
  }

  // Distance from centre to cap centres
  const d_centre_to_cap_centre = half_len - half_width;

  if (aFlags & OVAL_KEY_POINTS.OVAL_CAP_CENTERS) {
    // Cap centres
    pts.push(new TYPED_POINT2I({ x: 0, y: d_centre_to_cap_centre }, POINT_TYPE.PT_CENTER));
    pts.push(new TYPED_POINT2I({ x: 0, y: -d_centre_to_cap_centre }, POINT_TYPE.PT_CENTER));
  }

  if (aFlags & OVAL_KEY_POINTS.OVAL_SIDE_ENDS) {
    const add_end = (aPt: VECTOR2I): void => {
      pts.push(new TYPED_POINT2I(aPt, POINT_TYPE.PT_END));
    };

    // End points of flat sides (always vertical)
    add_end({ x: half_width, y: d_centre_to_cap_centre });
    add_end({ x: half_width, y: -d_centre_to_cap_centre });
    add_end({ x: -half_width, y: d_centre_to_cap_centre });
    add_end({ x: -half_width, y: -d_centre_to_cap_centre });
  }

  // Add the quadrant points to the caps only if rotated
  // (otherwise they're just the tips)
  if (aFlags & OVAL_KEY_POINTS.OVAL_CARDINAL_EXTREMES && !rotation.IsCardinal()) {
    // We need to find two perpendicular lines from the centres
    // of each cap to the cap edge, which will hit the points
    // where the cap is tangent to H/V lines when rotated into place.
    //
    // Because we know the oval is always vertical, this means the
    // two lines are formed between _|, through \/ to |_
    // where the apex is the cap centre.

    // The vector from a cap centre to the tip (i.e. vertical)
    const cap_radial: VECTOR2I = { x: 0, y: half_width };

    // Rotate in the opposite direction to the oval's rotation
    // (that will be unwound later)
    const radial_line_rotation = rotation.Clone();

    radial_line_rotation.Normalize90();

    const cap_radial_to_x_axis = RotatePoint(cap_radial, radial_line_rotation);

    // Find the other line - it's 90 degrees away, but re-normalise
    // as it could be to the left or right
    const radial_line_rotation2 = radial_line_rotation.sub(ANGLE_90);
    radial_line_rotation2.Normalize90();

    const cap_radial_to_y_axis = RotatePoint(cap_radial, radial_line_rotation2);

    const add_quadrant = (aPt: VECTOR2I): void => {
      pts.push(new TYPED_POINT2I(aPt, POINT_TYPE.PT_QUADRANT));
    };

    // The quadrant points are then the relevant offsets from each cap centre
    add_quadrant({ x: cap_radial_to_y_axis.x, y: d_centre_to_cap_centre + cap_radial_to_y_axis.y });
    add_quadrant({ x: cap_radial_to_x_axis.x, y: d_centre_to_cap_centre + cap_radial_to_x_axis.y });
    // The opposite cap offsets go from the other cap centre, the other way
    add_quadrant({
      x: -cap_radial_to_y_axis.x,
      y: -d_centre_to_cap_centre - cap_radial_to_y_axis.y,
    });
    add_quadrant({
      x: -cap_radial_to_x_axis.x,
      y: -d_centre_to_cap_centre - cap_radial_to_x_axis.y,
    });
  }

  for (const pt of pts) {
    // Transform to the actual orientation
    pt.m_point = RotatePoint(pt.m_point, rotation.negate());

    // Translate to the actual position
    const c = aOval.GetCenter();
    pt.m_point.x += c.x;
    pt.m_point.y += c.y;
  }

  return pts;
}
