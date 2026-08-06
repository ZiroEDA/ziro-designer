// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The adapter that hands `PNS::ITEM` the real `SHAPE::Collide`.
 *
 * Upstream has no counterpart, because upstream has no seam here: `ITEM` calls
 * `SHAPE::Collide` directly and `shape_collisions.cpp` is linked in. The seam
 * exists in this repo because the item model landed before the collision table
 * did, with a stand-in collider that reproduces the verdict but reports
 * `location: null`. This file closes it.
 *
 * Nothing here changes {@link defaultShapeCollider}: a collider that cannot say
 * *where* two shapes met is still the honest default for a caller that has not
 * installed one, and `ITEM::collideSimple`'s throw is what makes that honesty
 * audible rather than silent. Installing this one is what makes the castellation
 * and net-tie paths work.
 */

import { collideShapes } from '../drc/shape_collisions.js';
import { setShapeCollider, type ShapeCollider } from './pns_collision.js';

/**
 * `SHAPE::Collide`, in the shape the item model asks for.
 *
 * The argument order is preserved, not normalised: several of upstream's pairs
 * report a location that lies on the *first* shape, so `collideSimple`'s
 * `collider( shapeH, shapeI, … )` — head first — is what puts the obstacle's
 * location on the head.
 */
export const locatingShapeCollider: ShapeCollider = (aA, aB, aClearance) =>
  collideShapes(aA, aB, aClearance);

/** Install {@link locatingShapeCollider} as the process-wide shape collider. */
export function installLocatingShapeCollider(): void {
  setShapeCollider(locatingShapeCollider);
}
