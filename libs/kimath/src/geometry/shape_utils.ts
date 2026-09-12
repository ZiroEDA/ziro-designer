// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGEOM` (`geometry/shape_utils.h`, `src/geometry/shape_utils.cpp`): the
 * free helpers over shapes. The namespace is spelled as a `KIGEOM_` prefix.
 */

import type { VECTOR2I } from '../math/vector2.js';
import { ANGLE_90, ANGLE_180 } from './eda_angle.js';
import { Directions } from './direction45.js';
import { SHAPE_ARC } from './shape_arc.js';
import type { SHAPE_RECT } from './shape_rect.js';

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
