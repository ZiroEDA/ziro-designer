// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `libs/kimath/include/geometry/nearest.h` / `src/geometry/nearest.cpp`: the
 * nearest point on a `NEARABLE_GEOM` - a variant of LINE, HALF_LINE, SEG,
 * CIRCLE, SHAPE_ARC, BOX2I and a bare point - and over a list of them.
 */
import { BOX2I } from '../math/box2.js';
import type { VECTOR2I } from '../math/vector2.js';
import { CIRCLE } from './circle.js';
import { HALF_LINE } from './half_line.js';
import { LINE } from './line.js';
import { SEG } from './seg.js';
import { SHAPE_ARC } from './shape_arc.js';
import { KIGEOM_BoxToSegs } from './shape_utils.js';

export type NEARABLE_GEOM = LINE | HALF_LINE | SEG | CIRCLE | SHAPE_ARC | BOX2I | VECTOR2I;

/** `VECTOR2I::Distance`: the Euclidean distance, as an int (truncated). */
const distanceI = (a: VECTOR2I, b: VECTOR2I): number =>
  Math.trunc(Math.hypot(a.x - b.x, a.y - b.y));

/** The anonymous-namespace `NearestPoint( const BOX2I&, const VECTOR2I& )` (nearest.cpp:31-49). */
function nearestPointOnBox(aBox: BOX2I, aPt: VECTOR2I): VECTOR2I {
  let nearest: VECTOR2I = { x: 0, y: 0 };
  let bestDistance = 2_147_483_647;

  for (const seg of KIGEOM_BoxToSegs(aBox)) {
    const nearestSegPt = seg.NearestPoint(aPt);
    const thisDistance = distanceI(nearestSegPt, aPt);

    if (thisDistance <= bestDistance) {
      nearest = nearestSegPt;
      bestDistance = thisDistance;
    }
  }

  return nearest;
}

/** `GetNearestPoint( const NEARABLE_GEOM&, const VECTOR2I& )` (nearest.cpp:53-89). */
export function GetNearestPoint(aGeom: NEARABLE_GEOM, aPt: VECTOR2I): VECTOR2I {
  if (
    aGeom instanceof LINE ||
    aGeom instanceof HALF_LINE ||
    aGeom instanceof SEG ||
    aGeom instanceof CIRCLE ||
    aGeom instanceof SHAPE_ARC
  )
    return aGeom.NearestPoint(aPt);

  if (aGeom instanceof BOX2I) return nearestPointOnBox(aGeom, aPt);

  return { x: aGeom.x, y: aGeom.y };
}

/** `GetNearestPoint( const std::vector<NEARABLE_GEOM>&, const VECTOR2I& )` (nearest.cpp:92-111). */
export function GetNearestPointOfAny(
  aGeoms: readonly NEARABLE_GEOM[],
  aPt: VECTOR2I,
): VECTOR2I | null {
  let nearestPointOnAny: VECTOR2I | null = null;
  let bestDistance = 2_147_483_647;

  for (const geom of aGeoms) {
    const thisNearest = GetNearestPoint(geom, aPt);
    const thisDistance = distanceI(thisNearest, aPt);

    if (!nearestPointOnAny || thisDistance < bestDistance) {
      nearestPointOnAny = thisNearest;
      bestDistance = thisDistance;
    }
  }

  return nearestPointOnAny;
}
