// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_LINE_CHAIN` operations that have no other home.
 * Counterpart: `libs/kimath/src/geometry/shape_line_chain.cpp`.
 *
 * The chain itself is a plain `Vec2[]` here — the intersection and area queries
 * already live in {@link ./seg.ts}, which is where upstream's `Intersect` and
 * `Area` were ported to. Only the members a caller actually needs get added.
 */

import { TestSegmentHit } from '../trigo.js';
import type { Vec2 } from '../math/vector2.js';

/**
 * `SHAPE_LINE_CHAIN::Simplify( int aTolerance )`
 * (`shape_line_chain.cpp:2749-2841`): drop every vertex that lies within
 * `tolerance` of the chord spanning it.
 *
 * Not a "remove exactly collinear points" pass — it is a greedy run collapse.
 * From each kept vertex the end is walked forward as far as every intermediate
 * point still hits the chord (`TestSegmentHit`), and the walk restarts at the
 * last vertex that survived. A tolerance of 0 still removes duplicates, since a
 * duplicate is trivially on the chord.
 *
 * `ZONE_CREATE_HELPER::OnComplete` calls this as `chain.Simplify( true )` — the
 * `bool` converting to a **tolerance of 1 IU**, not to a flag; the other
 * overload with a `bool` parameter is `Simplify2`. That 1 IU is what tidies the
 * duplicate corner a 45°-constrained leader leaves behind when its dogleg
 * degenerates.
 *
 * Arcs are not modelled, so upstream's `SHAPE_IS_PT` guards fall away.
 */
export function simplifyLineChain(points: readonly Vec2[], closed: boolean, tolerance = 0): Vec2[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ x: p.x, y: p.y }));

  const out: Vec2[] = [];

  for (let startIdx = 0; startIdx < n; ) {
    out.push({ x: points[startIdx]!.x, y: points[startIdx]!.y });

    // An open chain needs three points left to have anything to collapse.
    if (!closed && startIdx === n - 2) break;

    let endIdx = (startIdx + 2) % n;
    let canSimplify = true;

    while (canSimplify && endIdx !== startIdx && (endIdx > startIdx || closed)) {
      for (let testIdx = (startIdx + 1) % n; testIdx !== endIdx; testIdx = (testIdx + 1) % n) {
        if (!TestSegmentHit(points[testIdx]!, points[startIdx]!, points[endIdx]!, tolerance)) {
          canSimplify = false;
          break;
        }
      }

      if (canSimplify) endIdx = (endIdx + 1) % n;
    }

    if (endIdx === (startIdx + 2) % n) {
      startIdx++;
    } else {
      const newStartIdx = (endIdx + n - 1) % n;
      // Looped all the way around.
      if (newStartIdx <= startIdx) break;
      startIdx = newStartIdx;
    }
  }

  const last = points[n - 1]!;

  if (out.length === 1) out.push({ x: last.x, y: last.y });

  // An open chain must keep its original end point.
  const outLast = out[out.length - 1]!;
  if (!closed && (outLast.x !== last.x || outLast.y !== last.y)) out.push({ x: last.x, y: last.y });

  return out;
}
