// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGEOM::ShapeHitTest` / `KIGEOM::BoxHitTest` — hit-testing an item against a
 * closed selection polygon (`libs/kimath/src/geometry/geometry_utils.cpp:221-318`).
 *
 * This is what a LASSO selects with. Both editors' selection tools call it
 * through `EDA_ITEM::HitTest( const SHAPE_LINE_CHAIN&, bool aContained )`, and
 * the pair of modes is the whole behaviour:
 *
 *     if( aHitter.IsClosed() )
 *     {
 *         if( aHitteeContained )
 *             return collidesAll() && !intersectsAny();
 *         else
 *             return collidesAny();
 *     }
 *
 * `collidesAny` is "the shape meets the FILLED polygon" — a closed
 * `SHAPE_LINE_CHAIN` collides on its interior, not just its outline — and
 * `intersectsAny` is "some segment of the polygon crosses the shape". So:
 *
 *  - **touching**: any part of the item is inside the lasso.
 *  - **contained**: the item is inside the lasso AND the lasso's outline does
 *    not cross it. Not the same as "every corner is inside": a lasso pinched
 *    into a C around a box has all four corners inside its own region only if
 *    the outline stays clear, and the second half of the test is what says so.
 *
 * Which mode a lasso is in comes from its WINDING, not from a modifier — see
 * `lassoIsInside` in `common/src/preview_items/selection_area.ts`.
 *
 * Kept here rather than beside either editor because both need it: eeschema's
 * `boxselect.ts` had a private copy of the touching half and no contained half
 * at all, which is why a clockwise lasso there drew the yellow window outline
 * and then selected as though it were blue.
 */

import type { Vec2 } from '../math/vector2.js';

/** An axis-aligned box, the shape both editors carry bounding boxes in. */
export interface HitBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * `SHAPE_LINE_CHAIN::PointInside` — the even-odd ray cast that makes a CLOSED
 * chain collide on its interior.
 */
export function pointInPolygon(poly: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Do segments a-b and c-d meet, collinear overlap included? */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2): number =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  const onSeg = (o: Vec2, p: Vec2, q: Vec2): boolean =>
    cross(o, p, q) === 0 &&
    Math.min(o.x, p.x) <= q.x &&
    q.x <= Math.max(o.x, p.x) &&
    Math.min(o.y, p.y) <= q.y &&
    q.y <= Math.max(o.y, p.y);
  return onSeg(c, d, a) || onSeg(c, d, b) || onSeg(a, b, c) || onSeg(a, b, d);
}

/** `intersectsAny`: does any segment of the polygon cross segment a-b? */
function outlineCrossesSegment(poly: readonly Vec2[], a: Vec2, b: Vec2): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j];
    const q = poly[i];
    if (p && q && segmentsIntersect(a, b, p, q)) return true;
  }
  return false;
}

const corners = (box: HitBox): Vec2[] => [
  { x: box.minX, y: box.minY },
  { x: box.maxX, y: box.minY },
  { x: box.maxX, y: box.maxY },
  { x: box.minX, y: box.maxY },
];

/**
 * `KIGEOM::ShapeHitTest` for a segment: a track, a graphic line, a bus entry.
 */
export function polyHitsSegment(
  poly: readonly Vec2[],
  a: Vec2,
  b: Vec2,
  contained: boolean,
): boolean {
  if (poly.length < 3) return false;
  const crosses = outlineCrossesSegment(poly, a, b);

  if (contained) {
    // `collidesAll() && !intersectsAny()`: both ends inside the region and the
    // outline clear of it. Testing the ends alone would take a segment that
    // leaves and re-enters a concave lasso.
    return !crosses && pointInPolygon(poly, a) && pointInPolygon(poly, b);
  }
  return crosses || pointInPolygon(poly, a) || pointInPolygon(poly, b);
}

/** `KIGEOM::BoxHitTest( const SHAPE_LINE_CHAIN&, const BOX2I&, bool )`. */
export function polyHitsBox(poly: readonly Vec2[], box: HitBox, contained: boolean): boolean {
  if (poly.length < 3) return false;
  const pts = corners(box);
  let crosses = false;
  for (let e = 0; e < 4 && !crosses; e++) {
    crosses = outlineCrossesSegment(poly, pts[e]!, pts[(e + 1) % 4]!);
  }

  if (contained) return !crosses && pts.every((c) => pointInPolygon(poly, c));

  if (crosses) return true;
  if (pts.some((c) => pointInPolygon(poly, c))) return true;
  // The remaining touching case is a lasso drawn entirely INSIDE the box, whose
  // outline therefore crosses nothing and whose corners are all outside it.
  return poly.some((v) => v.x >= box.minX && v.x <= box.maxX && v.y >= box.minY && v.y <= box.maxY);
}

/** …and for a closed ring: a zone outline, a filled polygon, a courtyard. */
export function polyHitsPolygon(
  poly: readonly Vec2[],
  ring: readonly Vec2[],
  contained: boolean,
): boolean {
  if (poly.length < 3 || ring.length === 0) return false;
  let crosses = false;
  for (let i = 0, j = ring.length - 1; i < ring.length && !crosses; j = i++) {
    crosses = outlineCrossesSegment(poly, ring[j]!, ring[i]!);
  }

  if (contained) return !crosses && ring.every((p) => pointInPolygon(poly, p));

  if (crosses) return true;
  if (ring.some((p) => pointInPolygon(poly, p))) return true;
  return poly.some((v) => pointInPolygon(ring, v));
}

/** A point item — a junction, a no-connect, a `PCB_POINT`'s anchor. */
export function polyHitsPoint(poly: readonly Vec2[], p: Vec2): boolean {
  return poly.length >= 3 && pointInPolygon(poly, p);
}
