// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LINE::DragCorner`, `LINE::DragSegment` and `LINE::DragArc`
 * (`pcbnew/router/pns_line.cpp:836-966`), as free functions over
 * {@link PnsLine}, plus `SHAPE_LINE_CHAIN::Split`.
 *
 * The *geometry* of a drag already lives in `pns_line.ts` as pure functions
 * over a point array (`dragCorner` / `dragCorner45` / `dragCornerFree` /
 * `dragSegment45`). What was missing was the half that upstream spells as a
 * method on `LINE`: take the line's own chain, run the geometry, put the result
 * back. That is what this module is, and it is a separate file rather than new
 * methods on `PnsLine` so that `pns_line_item.ts` — a 1 500-line file several
 * ports share — does not move.
 *
 * ## The arc gap, stated plainly
 *
 * `PnsLineChain` carries arcs; the drag geometry in `pns_line.ts` is a plain
 * `Vec2[]`. Bridging through `points()` therefore **flattens any arc in the
 * line to its polyline** — the untouched prefix and suffix included, which
 * upstream preserves via `SHAPE_LINE_CHAIN::Slice`/`Append`. Every function
 * here that goes through the point array says so at its own docblock. Fixing it
 * means re-deriving `dragCorner45`/`dragSegment45` over `PnsLineChain`, which
 * would fork geometry that is already ported and tested; it is recorded as a
 * gap instead.
 *
 * `LINE::DragArc` itself is **not ported**: it needs
 * `CIRCLE::ConstructFromTanTanPt`, which kimath does not have here. See
 * {@link lineDragArc}.
 */

import { Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { type PnsLine, PnsLineChain } from './pns_line_item.js';
import { dragCorner, dragSegment45 } from './pns_line.js';

/**
 * `LINE::DragCorner( aP, aIndex, aFreeAngle, aPreferredEndingDirection )`.
 *
 * The `wxCHECK_RET( aIndex >= 0 )` is upstream's and it is **load-bearing**:
 * `COMPONENT_DRAGGER::Drag` feeds it `CLine().Find( p_orig )`, which is −1
 * whenever the pad's anchor is not a vertex of the assembled line, and relies
 * on the resulting no-op to leave the connection alone. Ported as an early
 * return, not as a throw.
 *
 * Flattens arcs; see the module docblock.
 */
export function lineDragCorner(
  aLine: PnsLine,
  aP: Vec2,
  aIndex: number,
  aFreeAngle = false,
  aPreferredEndingDirection: Direction45 = Direction45.UNDEFINED,
): void {
  if (aIndex < 0) return;

  const out = dragCorner(
    aLine.cLine().points(),
    aP,
    aIndex,
    aFreeAngle,
    aLine.snapThreshhold(),
    aPreferredEndingDirection,
  );

  aLine.setShape(PnsLineChain.fromPoints(out));
}

/**
 * `LINE::DragSegment( aP, aIndex, aFreeAngle )`.
 *
 * Upstream's free-angle branch is a bare `assert( false )` with no code behind
 * it — a release build simply falls through and leaves the line untouched. No
 * caller in the router passes `aFreeAngle` here (`DRAGGER::dragMarkObstacles`
 * routes free-angle drags to `DragCorner` instead), so the assert is
 * unreachable in practice. Reproduced as "leave the line alone", which is what
 * the release build does.
 *
 * Flattens arcs; see the module docblock.
 */
export function lineDragSegment(
  aLine: PnsLine,
  aP: Vec2,
  aIndex: number,
  aFreeAngle = false,
): void {
  if (aFreeAngle) return;

  const out = dragSegment45(aLine.cLine().points(), aP, aIndex, aLine.snapThreshhold());

  aLine.setShape(PnsLineChain.fromPoints(out));
}

/**
 * The signature of `LINE::DragArc`, which is what a caller must supply to make
 * `DM_ARC` dragging do anything.
 */
export type LineDragArcFn = (aLine: PnsLine, aP: Vec2, aIndex: number) => void;

/**
 * `LINE::DragArc( aP, aIndex )` — **not ported**.
 *
 * Upstream (`pns_line.cpp:863-966`) rebuilds the arc as the tangent circle
 * touching the two tangent lines at the arc's ends and passing through the
 * cursor, via `CIRCLE::ConstructFromTanTanPt`. kimath here has no `CIRCLE` at
 * all, so the geometry has no floor to stand on; writing an approximation would
 * be exactly the kind of "improvement" this port does not make.
 *
 * This default therefore leaves the line **unchanged**, which is also what
 * upstream does on each of its own four early returns (index out of range, no
 * arc at the index, parallel tangents, degenerate circle). Every `DM_ARC`
 * control-flow path in `DRAGGER` *is* ported and is exercised with an injected
 * {@link LineDragArcFn} in the tests.
 */
export const lineDragArc: LineDragArcFn = (_aLine, _aP, _aIndex) => {
  // Deliberately empty. See the docblock.
};

/**
 * `SHAPE_LINE_CHAIN::Split( aP, aExact = false )`
 * (`libs/kimath/src/geometry/shape_line_chain.cpp`).
 *
 * Insert `aP` as a vertex on whichever segment passes within 2 IU of it, and
 * answer the index it ended up at. Three details are upstream's and are easy to
 * lose:
 *
 * - `min_dist` starts at **2**, so the search is a 2 IU tolerance, not "the
 *   nearest segment". A point further than that from every segment falls
 *   through to `found_index`, which is −1 unless `aP` was already a vertex.
 * - A segment whose *own* endpoint is `aP` is skipped (`seg.A != aP &&
 *   seg.B != aP`), so splitting at an existing corner never produces the
 *   near-zero-length sliver the comment warns about.
 * - When `aP` is already a vertex and some segment is also within tolerance,
 *   the earlier of the two indices wins — and with `aExact` false (the
 *   dragger's call) the vertex does *not* short-circuit the scan.
 *
 * The arc branch (`IsArcSegment( ii )` → `splitArc`) is **not ported**;
 * splitting inside an arc falls back to inserting a plain point, which is
 * consistent with the module-wide arc gap above. Returns −1 when nothing was
 * split, as upstream.
 */
export function chainSplit(aChain: PnsLineChain, aP: Vec2, aExact = false): number {
  const foundIndex = aChain.find(aP);

  if (foundIndex >= 0 && aExact) return foundIndex;

  let ii = -1;
  let minDist = 2;

  for (let s = 0; s < aChain.segmentCount(); s++) {
    const seg = aChain.cSegment(s);
    const dist = segDistanceToPoint(seg, aP);

    if (dist < minDist && !samePoint(seg.a, aP) && !samePoint(seg.b, aP)) {
      minDist = dist;

      if (foundIndex < 0) ii = s;
      else if (s < foundIndex) ii = s;
    }
  }

  if (ii < 0) ii = foundIndex;

  if (ii >= 0) {
    if (samePoint(aChain.cPoint(ii), aP)) return ii;

    const newIndex = ii + 1;

    aChain.insertPoint(newIndex, aP);

    return newIndex;
  }

  return -1;
}

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * `SEG::Distance( const VECTOR2I& )`: the rounded distance to the segment,
 * clamped to the endpoints.
 */
function segDistanceToPoint(aSeg: { a: Vec2; b: Vec2 }, aP: Vec2): number {
  const dx = aSeg.b.x - aSeg.a.x;
  const dy = aSeg.b.y - aSeg.a.y;
  const len2 = dx * dx + dy * dy;

  if (len2 === 0) return Math.round(Math.hypot(aP.x - aSeg.a.x, aP.y - aSeg.a.y));

  let t = ((aP.x - aSeg.a.x) * dx + (aP.y - aSeg.a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  return Math.round(Math.hypot(aP.x - (aSeg.a.x + dx * t), aP.y - (aSeg.a.y + dy * t)));
}
