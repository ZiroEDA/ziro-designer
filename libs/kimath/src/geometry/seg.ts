// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SEG intersection and the SHAPE_LINE_CHAIN queries built on it.
 * Counterparts: `libs/kimath/src/geometry/seg.cpp` (`SEG::intersects`) and
 * `libs/kimath/src/geometry/shape_line_chain.cpp` (`Intersect( const SEG& )`,
 * `Area`).
 *
 * Exact-integer throughout, as upstream: the cross products decide inclusion by
 * comparing against the determinant rather than dividing, so a crossing exactly
 * on a vertex is classified the same way KiCad classifies it.
 */

import { rescale } from '../math/util.js';
import type { VECTOR2I } from '../math/vector2.js';

/** One crossing found by {@link chainIntersect}. */
export interface Intersection {
  /** The crossing point. */
  p: VECTOR2I;
  /** Index of the chain segment that was crossed. */
  indexOur: number;
}

const cross = (a: VECTOR2I, b: VECTOR2I): number => a.x * b.y - a.y * b.x;

/**
 * SEG::Intersect for two closed segments, returning null when they miss.
 *
 * `aLines`/`aIgnoreEndpoints` are not ported: the teardrop code only ever asks
 * the plain segment-vs-segment question.
 */
export function segIntersect(
  a1: VECTOR2I,
  a2: VECTOR2I,
  b1: VECTOR2I,
  b2: VECTOR2I,
): VECTOR2I | null {
  // Bounding-box rejection, as upstream.
  if (
    Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x) ||
    Math.max(b1.x, b2.x) < Math.min(a1.x, a2.x) ||
    Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y) ||
    Math.max(b1.y, b2.y) < Math.min(a1.y, a2.y)
  ) {
    return null;
  }

  const dir1 = { x: a2.x - a1.x, y: a2.y - a1.y };
  const dir2 = { x: b2.x - b1.x, y: b2.y - b1.y };
  const offset = { x: b1.x - a1.x, y: b1.y - a1.y };
  const determinant = cross(dir2, dir1);

  if (determinant === 0) {
    // Parallel: upstream walks the collinear-overlap path here. The teardrop
    // caller treats a collinear graze as "no crossing" either way, because a
    // crossing point on an edge it runs along carries no usable direction.
    return null;
  }

  const param2Num = cross(dir2, offset);
  const param1Num = cross(dir1, offset);

  if (determinant > 0) {
    if (param1Num < 0 || param1Num > determinant || param2Num < 0 || param2Num > determinant) {
      return null;
    }
  } else {
    if (param1Num > 0 || param1Num < determinant || param2Num > 0 || param2Num < determinant) {
      return null;
    }
  }

  return {
    x: b1.x + rescale(param1Num, dir2.x, determinant),
    y: b1.y + rescale(param1Num, dir2.y, determinant),
  };
}

/**
 * SHAPE_LINE_CHAIN::Intersect( const SEG&, INTERSECTIONS& ) over a closed chain.
 *
 * Results come back sorted by distance from `segA`, which is what lets the
 * caller take `pts[0]` as "where the track first enters the pad".
 */
export function chainIntersect(
  chain: readonly VECTOR2I[],
  segA: VECTOR2I,
  segB: VECTOR2I,
): Intersection[] {
  const out: Intersection[] = [];
  const n = chain.length;

  const segMinX = Math.min(segA.x, segB.x);
  const segMaxX = Math.max(segA.x, segB.x);
  const segMinY = Math.min(segA.y, segB.y);
  const segMaxY = Math.max(segA.y, segB.y);

  for (let s = 0; s < n; s++) {
    const ptA = chain[s]!;
    const ptB = chain[s + 1 < n ? s + 1 : 0]!;

    if (
      Math.max(ptA.x, ptB.x) < segMinX ||
      Math.min(ptA.x, ptB.x) > segMaxX ||
      Math.max(ptA.y, ptB.y) < segMinY ||
      Math.min(ptA.y, ptB.y) > segMaxY
    ) {
      continue;
    }

    const p = segIntersect(ptA, ptB, segA, segB);

    if (p) out.push({ p, indexOur: s });
  }

  out.sort(
    (a, b) =>
      Math.hypot(a.p.x - segA.x, a.p.y - segA.y) - Math.hypot(b.p.x - segA.x, b.p.y - segA.y),
  );

  return out;
}

/** Crossings of a closed chain against a polyline, in polyline order. */
export function chainIntersectChain(
  chain: readonly VECTOR2I[],
  poly: readonly VECTOR2I[],
): Intersection[] {
  const out: Intersection[] = [];

  for (let ii = 0; ii + 1 < poly.length; ii++) {
    for (const hit of chainIntersect(chain, poly[ii]!, poly[ii + 1]!)) out.push(hit);
  }

  return out;
}

/**
 * SHAPE_LINE_CHAIN::Area.
 *
 * `aAbsolute` defaults to true, as upstream's declaration does — and it matters:
 * the teardrop anchor search picks between two candidate corner assignments by
 * comparing areas, and the correct assignment is the one that encloses more
 * regardless of winding. Comparing signed areas there picks the self-crossing
 * bowtie, whose partial cancellation leaves it *algebraically* larger.
 */
export function chainArea(points: readonly VECTOR2I[], absolute = true): number {
  let area = 0.0;
  const size = points.length;

  for (let i = 0, j = size - 1; i < size; ++i) {
    area += (points[j]!.x + points[i]!.x) * (points[j]!.y - points[i]!.y);
    j = i;
  }

  // Negative when the points run anti-clockwise.
  return absolute ? Math.abs(area * 0.5) : -area * 0.5;
}
