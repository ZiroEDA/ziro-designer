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
import type { Vec2 } from '../math/vector2.js';

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
