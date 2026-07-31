// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Andrew's monotone chain 2D convex hull.
 * Counterpart: `libs/kimath/src/geometry/convex_hull.cpp`.
 */

import type { VECTOR2I } from '../math/vector2.js';

/** compare_point: lexicographic, x then y. */
const comparePoint = (ref: VECTOR2I, p: VECTOR2I): boolean =>
  ref.x < p.x || (ref.x === p.x && ref.y < p.y);

/**
 * cross_product: z of OA x OB. Positive for a counter-clockwise turn, negative
 * for clockwise, zero when collinear.
 */
const crossProduct = (O: VECTOR2I, A: VECTOR2I, B: VECTOR2I): number =>
  (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);

/**
 * BuildConvexHull: the hull of aPoly, counter-clockwise.
 *
 * The `<= 0` test drops collinear points, so the result carries only true
 * corners — which is what makes the teardrop anchor search able to say "the
 * neighbour of the track point in the hull" and get a meaningful pad point.
 */
export function buildConvexHull(aPoly: readonly VECTOR2I[]): VECTOR2I[] {
  const poly = aPoly.slice();
  const pointCount = poly.length;

  if (pointCount < 2) return [];

  poly.sort((a, b) => (comparePoint(a, b) ? -1 : comparePoint(b, a) ? 1 : 0));

  const result: VECTOR2I[] = new Array<VECTOR2I>(2 * pointCount);
  let k = 0;

  // Lower hull.
  for (let ii = 0; ii < pointCount; ++ii) {
    while (k >= 2 && crossProduct(result[k - 2]!, result[k - 1]!, poly[ii]!) <= 0) k--;
    result[k++] = poly[ii]!;
  }

  // Upper hull.
  for (let ii = pointCount - 2, t = k + 1; ii >= 0; ii--) {
    while (k >= t && crossProduct(result[k - 2]!, result[k - 1]!, poly[ii]!) <= 0) k--;
    result[k++] = poly[ii]!;
  }

  // The closing point repeats the first; drop it so no zero-length segment forms.
  if (k > 1 && result[0]!.x === result[k - 1]!.x && result[0]!.y === result[k - 1]!.y) k -= 1;

  return result.slice(0, k);
}
