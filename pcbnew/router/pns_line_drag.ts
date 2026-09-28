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
 * `LINE::DragArc` **is** ported, and does not go through the point array at
 * all: it works on the chain's arc directly and rebuilds prefix/arc/suffix with
 * `Slice`/`Append`, exactly as upstream. `CIRCLE::ConstructFromTanTanPt`, the
 * piece it was waiting on, now lives in `libs/kimath/src/geometry/circle.ts`.
 */

import { circleNearestPoint, constructFromTanTanPt } from '@ziroeda/kimath/src/geometry/circle.js';
import { Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import {
  segDistanceToPoint,
  segIntersectLines,
  segLineProject,
} from '@ziroeda/kimath/src/geometry/seg.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { CalcArcMid } from '@ziroeda/kimath/src/trigo.js';
import type { ShapeArc } from './pns_arc.js';
import {
  PNS_IU_PER_MM,
  PNS_MAX_TANGENT_ANGLE_DEVIATION_DEG,
  PNS_MAX_TRACK_LENGTH_TO_KEEP_MM,
} from './pns_drag_algo.js';
import { type PnsLine, PnsLineChain } from './pns_line_item.js';
import { segNearestPoint, segSide } from './pns_meander_placer_base.js';
import { dragCorner, dragSegment45 } from './pns_line.js';
import type { Seg } from './pns_line.js';
import { shapeArcCenter } from './shape_arc_ops.js';

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
 * `LINE::DragArc( aP, aIndex )` (`pcbnew/router/pns_line.cpp:863-1092`).
 *
 * Rebuild the arc at `aIndex` as the circle tangent to the two lines its ends
 * run into and passing through the cursor, via
 * `CIRCLE::ConstructFromTanTanPt` — now available as
 * {@link constructFromTanTanPt} in kimath.
 *
 * ## The shape of it
 *
 * 1. **Which lines are the tangents.** Each arc end either continues into a
 *    neighbouring straight segment that is (within
 *    `ADVANCED_CFG::m_MaxTangentAngleDeviation`, 1°) collinear with the arc's
 *    own tangent there — in which case *that* segment is the tangent line and
 *    the drag is allowed to eat into it — or it does not, in which case the
 *    tangent line runs from the arc's own two tangents' meeting point out to
 *    the arc endpoint, and the endpoint stays put while a stub grows.
 * 2. **Clamping the cursor.** The cursor is confined to the triangle bounded by
 *    the two tangent segments and the chord of the *largest* circle that fits
 *    the angle while still touching the further tangent point; outside it, the
 *    nearest point on those three segments is used instead, and inside the
 *    maximal circle the cursor is pushed back out onto its circumference.
 *    Without this the tangent circle flips to the far solution or blows up.
 * 3. **Rebuild.** Prefix, new arc, suffix. Two short-circuits: a new arc
 *    shorter than `m_MaxTrackLengthToKeep` (500 IU) is dropped entirely rather
 *    than emitted as a sliver, and a new endpoint within that distance of the
 *    neighbouring vertex snaps onto it and swallows the stub.
 *
 * ## Faithfulness notes
 *
 * - Five early returns leave the line **untouched**, which is what the
 *   pre-port default did for all of them: bad index, no arc at the index,
 *   an arc whose own tangents are parallel and are needed, tangent segments
 *   that do not meet, and a degenerate circle (`Radius <= 0`).
 * - `SHAPE_LINE_CHAIN` here carries no width, so upstream's
 *   `rebuilt.SetWidth( m_line.Width() )` has nothing to port: the width lives
 *   on `PnsLine` and survives `setShape`.
 * - `isCollinearTo` is upstream's `asin` of the normalised cross product, in
 *   degrees — an *unsigned* angle, so a neighbour running the opposite way
 *   along the same line counts as collinear.
 */
export const lineDragArc: LineDragArcFn = (aLine, aP, aIndex) => {
  const chain = aLine.line();

  if (aIndex < 0 || aIndex >= chain.pointCount()) return;

  const arcIdx = chain.arcIndex(aIndex);

  if (arcIdx < 0) return;

  let firstArcPt = -1;
  let lastArcPt = -1;

  for (let i = 0; i < chain.pointCount(); i++) {
    if (chain.arcIndex(i) === arcIdx) {
      if (firstArcPt < 0) firstArcPt = i;

      lastArcPt = i;
    }
  }

  if (firstArcPt < 0 || lastArcPt < 0) return;

  const oldArc = chain.arc(arcIdx);
  const width = oldArc.width;

  const tangentLineAtArcEndpoint = (aEndpoint: Vec2): Seg => {
    const center = shapeArcCenter(oldArc);
    const radial = { x: aEndpoint.x - center.x, y: aEndpoint.y - center.y };
    const perp = { x: -radial.y, y: radial.x };

    return {
      a: { x: aEndpoint.x - perp.x, y: aEndpoint.y - perp.y },
      b: { x: aEndpoint.x + perp.x, y: aEndpoint.y + perp.y },
    };
  };

  const isCollinearTo = (aA: Seg, aB: Seg, aMaxDeviationDeg: number): boolean => {
    const dirA = { x: aA.b.x - aA.a.x, y: aA.b.y - aA.a.y };
    const dirB = { x: aB.b.x - aB.a.x, y: aB.b.y - aB.a.y };
    const magA = Math.hypot(dirA.x, dirA.y);
    const magB = Math.hypot(dirB.x, dirB.y);

    if (magA <= 0 || magB <= 0) return false;

    const crossMag = Math.abs(dirA.x * dirB.y - dirA.y * dirB.x);
    const sinAngle = crossMag / (magA * magB);
    const angleDeg = (Math.asin(Math.min(Math.max(sinAngle, 0), 1)) * 180) / Math.PI;

    return angleDeg <= aMaxDeviationDeg;
  };

  const maxDeviation = PNS_MAX_TANGENT_ANGLE_DEVIATION_DEG;
  const arcLineStart = tangentLineAtArcEndpoint(oldArc.p0);
  const arcLineEnd = tangentLineAtArcEndpoint(oldArc.p1);

  let useChainStart = false;
  let useChainEnd = false;

  if (firstArcPt > 0) {
    const candidate: Seg = { a: chain.cPoint(firstArcPt - 1), b: chain.cPoint(firstArcPt) };

    if (isCollinearTo(candidate, arcLineStart, maxDeviation)) useChainStart = true;
  }

  if (lastArcPt < chain.pointCount() - 1) {
    const candidate: Seg = { a: chain.cPoint(lastArcPt), b: chain.cPoint(lastArcPt + 1) };

    if (isCollinearTo(candidate, arcLineEnd, maxDeviation)) useChainEnd = true;
  }

  const arcOwnTanIntersect = segIntersectLines(arcLineStart, arcLineEnd);

  let tanStartSeg: Seg;
  let tanEndSeg: Seg;

  if (useChainStart) {
    tanStartSeg = { a: chain.cPoint(firstArcPt - 1), b: chain.cPoint(firstArcPt) };
  } else {
    if (!arcOwnTanIntersect) return;

    tanStartSeg = { a: arcOwnTanIntersect, b: oldArc.p0 };
  }

  if (useChainEnd) {
    tanEndSeg = { a: chain.cPoint(lastArcPt), b: chain.cPoint(lastArcPt + 1) };
  } else {
    if (!arcOwnTanIntersect) return;

    tanEndSeg = { a: arcOwnTanIntersect, b: oldArc.p1 };
  }

  const tanIntersect = segIntersectLines(tanStartSeg, tanEndSeg);

  if (!tanIntersect) return; // parallel tangents have no tangent-circle solution

  // Reorient tangent segments so they emanate from the intersection point, so
  // the constraint math below operates on the (intersect, arc-endpoint)
  // directed segments.
  const tanStartFromIntersect: Seg = { a: tanIntersect, b: oldArc.p0 };
  const tanEndFromIntersect: Seg = { a: tanIntersect, b: oldArc.p1 };

  const furthestFromIntersect = (aA: Vec2, aB: Vec2): Vec2 =>
    EuclideanNormI({ x: aA.x - tanIntersect.x, y: aA.y - tanIntersect.y }) >
    EuclideanNormI({ x: aB.x - tanIntersect.x, y: aB.y - tanIntersect.y })
      ? aA
      : aB;

  const tanStartFar = furthestFromIntersect(tanStartSeg.a, tanStartSeg.b);
  const tanEndFar = furthestFromIntersect(tanEndSeg.a, tanEndSeg.b);
  // The *nearer* of the two far points, expressed as upstream expresses it.
  const tempTangentPoint = samePoint(furthestFromIntersect(tanStartFar, tanEndFar), tanEndFar)
    ? tanStartFar
    : tanEndFar;

  const maxTanCircle = constructFromTanTanPt(
    tanStartFromIntersect,
    tanEndFromIntersect,
    tempTangentPoint,
  );

  const maxTanPtStart = segLineProject(tanStartFromIntersect, maxTanCircle.c);
  const maxTanPtEnd = segLineProject(tanEndFromIntersect, maxTanCircle.c);

  const cSegTanStart: Seg = { a: maxTanPtStart, b: tanIntersect };
  const cSegTanEnd: Seg = { a: maxTanPtEnd, b: tanIntersect };
  const cSegChord: Seg = { a: maxTanPtStart, b: maxTanPtEnd };

  const oldMid = oldArc.arcMid;
  const cSegTanStartSide = segSide(cSegTanStart, oldMid);
  const cSegTanEndSide = segSide(cSegTanEnd, oldMid);
  const cSegChordSide = segSide(cSegChord, oldMid);

  let cursor: Vec2 = aP;

  if (
    cSegTanStartSide !== segSide(cSegTanStart, cursor) ||
    cSegTanEndSide !== segSide(cSegTanEnd, cursor) ||
    cSegChordSide !== segSide(cSegChord, cursor)
  ) {
    let best = segNearestPoint(cSegTanStart, cursor);

    for (const candidate of [
      segNearestPoint(cSegTanEnd, cursor),
      segNearestPoint(cSegChord, cursor),
    ]) {
      if (distSq(candidate, cursor) < distSq(best, cursor)) best = candidate;
    }

    cursor = best;
  }

  if (
    EuclideanNormI({ x: cursor.x - maxTanCircle.c.x, y: cursor.y - maxTanCircle.c.y }) <
    maxTanCircle.r
  ) {
    cursor = circleNearestPoint(maxTanCircle, cursor);
  }

  const c = constructFromTanTanPt(tanStartSeg, tanEndSeg, cursor);

  if (c.r <= 0) return;

  const newCenter = c.c;
  let newStart = segLineProject(tanStartSeg, newCenter);
  let newEnd = segLineProject(tanEndSeg, newCenter);

  // Non-tangent side keeps the original arc endpoint in the chain so the corner
  // stays put while a new tangent stub grows out to newStart.
  const maxStubIU = KiROUND(PNS_MAX_TRACK_LENGTH_TO_KEEP_MM * PNS_IU_PER_MM);

  let prefixCutoff = useChainStart ? firstArcPt - 1 : firstArcPt;
  let suffixCutoff = useChainEnd ? lastArcPt + 1 : lastArcPt;

  if (EuclideanNormI({ x: newEnd.x - newStart.x, y: newEnd.y - newStart.y }) <= maxStubIU) {
    const rebuilt = new PnsLineChain();

    if (prefixCutoff >= 0) rebuilt.appendChain(chain.slice(0, prefixCutoff));

    if (suffixCutoff <= chain.pointCount() - 1) {
      rebuilt.appendChain(chain.slice(suffixCutoff, chain.pointCount() - 1));
    }

    aLine.setShape(rebuilt);

    return;
  }

  if (firstArcPt > 0) {
    const anchor = useChainStart ? chain.cPoint(firstArcPt - 1) : chain.cPoint(firstArcPt);

    if (EuclideanNormI({ x: anchor.x - newStart.x, y: anchor.y - newStart.y }) <= maxStubIU) {
      newStart = anchor;
      prefixCutoff = useChainStart ? firstArcPt - 2 : firstArcPt - 1;
    }
  }

  if (lastArcPt < chain.pointCount() - 1) {
    const anchor = useChainEnd ? chain.cPoint(lastArcPt + 1) : chain.cPoint(lastArcPt);

    if (EuclideanNormI({ x: anchor.x - newEnd.x, y: anchor.y - newEnd.y }) <= maxStubIU) {
      newEnd = anchor;
      suffixCutoff = useChainEnd ? lastArcPt + 2 : lastArcPt + 1;
    }
  }

  const newMid = CalcArcMid(newStart, newEnd, newCenter);
  const newArc: ShapeArc = { p0: newStart, arcMid: newMid, p1: newEnd, width };

  const rebuilt = new PnsLineChain();

  if (prefixCutoff >= 0) rebuilt.appendChain(chain.slice(0, prefixCutoff));

  rebuilt.appendArcShape(newArc);

  if (suffixCutoff <= chain.pointCount() - 1) {
    rebuilt.appendChain(chain.slice(suffixCutoff, chain.pointCount() - 1));
  }

  aLine.setShape(rebuilt);
};

/** `( a - b ).SquaredEuclideanNorm()`, over cursor-scale offsets. */
const distSq = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

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
 * The arc branch (`IsArcSegment( ii )` → `splitArc`) is ported now that
 * `SHAPE_ARC::ConstructFromStartEndCenter` is; it goes through
 * `PnsLineChain.insertPointOnArcSegment`, which is the shared copy of it.
 * Returns −1 when nothing was split, as upstream.
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

    if (aChain.isArcSegment(ii)) aChain.insertPointOnArcSegment(ii, aP);
    else aChain.insertPoint(newIndex, aP);

    return newIndex;
  }

  return -1;
}

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
