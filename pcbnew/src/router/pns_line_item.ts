// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A track between two non-trivial joints, and the point chain it is drawn on.
 * Counterparts: `pcbnew/router/pns_line.h` (`LINE`, `PNS_HULL_MARGIN`) and the
 * slice of `libs/kimath/include/geometry/shape_line_chain.h` (`SHAPE_LINE_CHAIN`)
 * that `NODE::Add( LINE& )` reads.
 *
 * ## Why this is not `pns_line.ts`
 *
 * `pns_line.ts` in this directory is already a port of *part* of the same
 * upstream file: `LINE::DragCorner` / `LINE::DragSegment` and their geometry
 * helpers, written as free functions over a plain point array, because the
 * interactive drag never needed the item. This file is the other part — the
 * `ITEM` — and it needs identity, links and a node, so it is a class. The two
 * are not rivals: the drag geometry operates on a chain, this owns one.
 *
 * ## A LINE is not in the node, and that is the whole point
 *
 * `NODE::Add( LINE& )` does not store the line. It walks the line's chain,
 * makes a `SEGMENT` or an `ARC` for each piece, adds *those*, and records
 * back-references in the line via `LINK_HOLDER::Link`. Five things follow, and
 * all five are observable:
 *
 *  1. Each new primitive inherits the line's width, layers, net, marker and rank
 *     from the `SEGMENT( const LINE&, const SEG& )` /
 *     `ARC( const LINE&, const SHAPE_ARC& )` constructors — not from the chain.
 *  2. Redundancy is resolved against what the node already holds, and an
 *     existing primitive is *reused and linked* rather than duplicated.
 *  3. **The line's via is not added.** `Remove( LINE& )` does remove it. The
 *     asymmetry is upstream's and callers add the via themselves.
 *  4. Arcs are added before segments, so `links()` is not in geometric order for
 *     a line containing arcs.
 *  5. Zero-length segments are skipped, so `links().length` can be less than
 *     `segmentCount()`.
 *
 * ## What of `SHAPE_LINE_CHAIN` is here, and what is not
 *
 * {@link PnsLineChain} carries upstream's exact arc representation — a point
 * array, a per-point pair of shape indices, and an arc array — because
 * `IsArcSegment` is read by `Add( LINE& )` and cannot be reconstructed from
 * points alone. `SHAPE_ARC::ConvertToPolyline` now exists twice over — as
 * `convertArcToPolyline` here and as `arcConvertToPolyline` in
 * `shape_arc_ops.ts`, ported independently and merged together; they are left
 * side by side deliberately rather than reconciled during a merge.
 * {@link PnsLineChain.appendArc} still takes the polyline as an argument, and
 * {@link PnsLineChain.appendArcShape} is the overload that computes it.
 * Everything downstream of that — how the arc is filed, which
 * segments then report as arc segments, how a shared endpoint is folded into the
 * previous point — is upstream's `Append( const SHAPE_LINE_CHAIN& )` verbatim.
 *
 * Closed chains are not modelled: `SegmentCount`, `IsArcSegment` and
 * `mergeFirstLastPointIfNeeded` all branch on `m_closed`, and no line the router
 * hands to a node is closed. The branches are noted at their sites rather than
 * written.
 */
import { LineMarker, PnsKind, PnsLinkHolder, type PnsItem } from './pns_item.js';
import { segContains, segReflectPoint, segSquaredDistanceToPointExact } from './pns_seg_ops.js';
import { segDistanceToPoint } from '@ziroeda/kimath/src/geometry/seg.js';
import { intersectSegs } from './pns_line.js';
import { arcLength, convertArcToPolyline, reversedArc } from './pns_arc.js';
import { Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import { arcShape } from '../drc/drc_engine.js';
import { arcIsClockwise, constructArcFromStartEndCenter, shapeArcCenter } from './shape_arc_ops.js';
import { ARC_HIGH_DEF } from '../graphics_cleaner.js';
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { ShapeArc } from './pns_arc.js';
import type { PnsVia } from './pns_via.js';
import type { Seg } from './pns_line.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `PNS_HULL_MARGIN` (`pns_line.h:45`): the slack a virtual via's hull is given. */
export const PNS_HULL_MARGIN = 10;

/** `SHAPE_LINE_CHAIN::SHAPE_IS_PT`: this point belongs to no arc. */
const SHAPE_IS_PT = -1;

/** `SHAPE_LINE_CHAIN::SHAPES_ARE_PT`. */
const shapesArePt = (): [number, number] => [SHAPE_IS_PT, SHAPE_IS_PT];

/** `VECTOR2I::operator==`. */
const samePt = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * The point chain a `LINE` is drawn on, with upstream's arc bookkeeping.
 *
 * `m_shapes[i]` says which arc (if any) point *i* belongs to. The second element
 * is used only for a point shared by two arcs, and is `SHAPE_IS_PT` whenever the
 * first is — the invariant `IsSharedPt` and `ArcIndex` are written against.
 */
export class PnsLineChain {
  private mPoints: Vec2[] = [];
  private mShapes: [number, number][] = [];
  private mArcs: ShapeArc[] = [];
  /**
   * `m_closed`. Only `area()` and the posture solver that calls it read this;
   * `segmentCount()` deliberately still reports the open count (see the class
   * docblock — closed chains are otherwise not modelled).
   */
  private mClosed = false;

  /**
   * A chain over a copy of the given points, none of them on an arc.
   *
   * `aAllowDuplication` is `true` here because this stands in for
   * `SHAPE_LINE_CHAIN( const std::vector<VECTOR2I>& )`, which assigns the
   * vector wholesale and does *not* drop repeated points — unlike `Append`.
   */
  static fromPoints(aPoints: readonly Vec2[]): PnsLineChain {
    const c = new PnsLineChain();

    for (const p of aPoints) c.appendPoint(p, true);

    return c;
  }

  clone(): PnsLineChain {
    const c = new PnsLineChain();
    c.mPoints = this.mPoints.map((p) => ({ ...p }));
    c.mShapes = this.mShapes.map((s) => [s[0], s[1]]);
    c.mArcs = this.mArcs.map((a) => ({
      ...a,
      p0: { ...a.p0 },
      arcMid: { ...a.arcMid },
      p1: { ...a.p1 },
    }));
    c.mClosed = this.mClosed;
    return c;
  }

  pointCount(): number {
    return this.mPoints.length;
  }

  /** `CLastPoint`. */
  cLastPoint(): Vec2 {
    return this.cPoint(-1);
  }

  /** `CPoint`: negative indices count back from the end. */
  cPoint(aIndex: number): Vec2 {
    const i = aIndex < 0 ? this.mPoints.length + aIndex : aIndex;
    const p = this.mPoints[i];

    if (!p) throw new Error('PNS: SHAPE_LINE_CHAIN::CPoint() out of range');

    return p;
  }

  /** `SegmentCount`. Open chains only; a closed one would have one more. */
  segmentCount(): number {
    return Math.max(0, this.mPoints.length - 1);
  }

  /** `CSegment`: negative indices count back from the end. */
  cSegment(aIndex: number): Seg {
    const i = aIndex < 0 ? this.segmentCount() + aIndex : aIndex;
    const a = this.mPoints[i];
    const b = this.mPoints[i + 1];

    if (!a || !b) throw new Error('PNS: SHAPE_LINE_CHAIN::CSegment() out of range');

    return { a, b };
  }

  arcCount(): number {
    return this.mArcs.length;
  }

  arc(aArc: number): ShapeArc {
    const a = this.mArcs[aArc];

    if (!a) throw new Error('PNS: SHAPE_LINE_CHAIN::Arc() out of range');

    return a;
  }

  /** `IsSharedPt`: the point sits where two arcs meet. */
  isSharedPt(aIndex: number): boolean {
    const s = this.mShapes[aIndex];
    return s !== undefined && s[0] !== SHAPE_IS_PT && s[1] !== SHAPE_IS_PT;
  }

  /** `IsPtOnArc`. */
  isPtOnArc(aIndex: number): boolean {
    const s = this.mShapes[aIndex];
    return s !== undefined && !(s[0] === SHAPE_IS_PT && s[1] === SHAPE_IS_PT);
  }

  /** `ArcIndex`: for a shared point the *second* arc is the one that starts here. */
  arcIndex(aIndex: number): number {
    const s = this.mShapes[aIndex];

    if (!s) return SHAPE_IS_PT;

    return this.isSharedPt(aIndex) ? s[1] : s[0];
  }

  /**
   * `IsArcSegment`. Every segment between two points of one arc belongs to it;
   * the exception upstream's comment names is two arcs that abut *without* a
   * shared vertex, where the segment bridging them belongs to neither.
   */
  isArcSegment(aSegment: number): boolean {
    const nextIdx = aSegment + 1;

    // Upstream also folds the wrap-around segment of a closed chain in here.
    if (nextIdx > this.mShapes.length - 1) return false;

    const next = this.mShapes[nextIdx];

    return this.isPtOnArc(aSegment) && next !== undefined && this.arcIndex(aSegment) === next[0];
  }

  /**
   * `Append( const VECTOR2I& aP, bool aAllowDuplication )`.
   *
   * The default matters and is upstream's: **a point identical to the current
   * last one is silently dropped**. The meander turtle relies on it — a mitre
   * whose correction works out to zero appends the point it is already standing
   * on, and a chamfered corner would otherwise come out as three doubled
   * vertices rather than three.
   */
  appendPoint(aPoint: Vec2, aAllowDuplication = false): void {
    const last = this.mPoints[this.mPoints.length - 1];

    if (last !== undefined && last.x === aPoint.x && last.y === aPoint.y && !aAllowDuplication) {
      return;
    }

    this.mPoints.push({ x: aPoint.x, y: aPoint.y });
    this.mShapes.push(shapesArePt());
  }

  /** `IsArcStart`: this point is where an arc begins. */
  isArcStart(aIndex: number): boolean {
    if (!this.isArcSegment(aIndex)) return false; // also does bound checking

    if (this.isSharedPt(aIndex)) return true;

    const arc = this.arc(this.arcIndex(aIndex));
    const p = this.mPoints[aIndex] as Vec2;

    return arc.p0.x === p.x && arc.p0.y === p.y;
  }

  /**
   * `IsArcEnd`: this point is where an arc finishes.
   *
   * Not the mirror of {@link isArcStart}: it looks at the segment *before* the
   * index, and index 0 wraps round to the last point — so on an open chain
   * `isArcEnd( 0 )` asks about the final segment, which is upstream's closed-
   * chain assumption showing through. An index past the end answers false.
   */
  isArcEnd(aIndex: number): boolean {
    let prevIndex = aIndex - 1;

    if (aIndex === 0) prevIndex = this.mPoints.length - 1;
    else if (aIndex > this.mPoints.length - 1) return false; // invalid index requested

    if (!this.isArcSegment(prevIndex)) return false;

    if (this.isSharedPt(aIndex)) return true;

    const arc = this.arc(this.arcIndex(aIndex));
    const p = this.mPoints[aIndex] as Vec2;

    return arc.p1.x === p.x && arc.p1.y === p.y;
  }

  /**
   * `Find`: the index of a **vertex**, or -1.
   *
   * A vertex search, not a hit test: a point lying halfway along a segment is
   * not found. `FindLinesBetweenJoints` depends on that — a joint that is not a
   * corner of the assembled line is simply not in it.
   */
  find(aP: Vec2, aThreshold = 0): number {
    for (let s = 0; s < this.pointCount(); s++) {
      const p = this.cPoint(s);

      if (aThreshold === 0) {
        if (p.x === aP.x && p.y === aP.y) return s;
      } else if (Math.hypot(p.x - aP.x, p.y - aP.y) <= aThreshold) {
        return s;
      }
    }

    return -1;
  }

  /**
   * `Length`: straight segments plus whole arcs.
   *
   * Note the arc terms are the arcs' *true* lengths, not the lengths of the
   * polylines standing in for them, and every arc in the chain contributes
   * whether or not the range being measured covers it.
   *
   * The accumulator is a `long long` upstream and every term is an integer
   * distance (`SEG::Length` rounds; `SHAPE_ARC::GetLength` is a double that the
   * `+=` truncates), so the arithmetic is reproduced integer-wise. It matters
   * because `TOPOLOGY::followBranch` keeps the strictly longest path and a
   * fractional difference would change which branch wins a near-tie.
   */
  length(): number {
    let l = 0;

    for (let i = 0; i < this.segmentCount(); i++) {
      // Only include segments that aren't part of arc shapes.
      if (!this.isArcSegment(i)) {
        const s = this.cSegment(i);
        l += Math.round(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y));
      }
    }

    for (const a of this.mArcs) l = Math.trunc(l + arcLength(a));

    return l;
  }

  /**
   * `PathLength( aP, aIndex )` (`shape_line_chain.cpp:1952`): how far along the
   * chain a point lying on segment `aIndex` is.
   *
   * Whole segments before the named one are summed at full length, and the
   * named one contributes the distance from **its A end** to the point — which
   * is the only place the point is used, so a point that is not actually on
   * that segment is measured to anyway rather than rejected.
   *
   * Three details are easy to lose and all three are upstream's:
   *
   *  - `aIndex < 0` does **not** count back from the end. The index test is
   *    skipped entirely, so `indexMatch` stays true on the very first segment
   *    and the answer is "distance from the start of segment 0". Every other
   *    negative index in this class means "from the end"; this one does not.
   *  - `aIndex === segmentCount()` — one past the last segment — is remapped
   *    onto the **last** segment rather than running off the end. That is what
   *    lets a caller pass a point index where a segment index is expected.
   *  - a chain with no segments, or an `aIndex` past the remap, returns **-1**,
   *    not 0. `NODE::NearestObstacle` compares that against `INT_MAX` and so
   *    treats it as the *nearest possible* obstacle, which is upstream's
   *    behaviour and not a defensive zero.
   */
  pathLength(aP: Vec2, aIndex: number): number {
    let sum = 0;

    for (let i = 0; i < this.segmentCount(); i++) {
      const seg = this.cSegment(i);
      let indexMatch = true;

      if (aIndex >= 0) {
        indexMatch = aIndex === this.segmentCount() ? i === this.segmentCount() - 1 : i === aIndex;
      }

      if (indexMatch) {
        return sum + EuclideanNormI({ x: aP.x - seg.a.x, y: aP.y - seg.a.y });
      }

      sum += EuclideanNormI({ x: seg.a.x - seg.b.x, y: seg.a.y - seg.b.y });
    }

    return -1;
  }

  /**
   * `Reverse`. The arc list is reversed too, so every stored shape index has to
   * be renumbered, and a shared point's two indices swap round — the arc that
   * *ended* there now starts there.
   */
  reverse(): PnsLineChain {
    const a = this.clone();

    a.mPoints.reverse();
    a.mShapes.reverse();
    a.mArcs.reverse();

    const renumber = (i: number): number =>
      i === SHAPE_IS_PT ? SHAPE_IS_PT : a.mArcs.length - i - 1;

    for (const sh of a.mShapes) {
      if (sh[0] === SHAPE_IS_PT && sh[1] === SHAPE_IS_PT) continue;

      sh[0] = renumber(sh[0]);
      sh[1] = renumber(sh[1]);

      if (sh[1] !== SHAPE_IS_PT) {
        const first = sh[0];
        sh[0] = sh[1];
        sh[1] = first;
      }
    }

    // Upstream also reverses each SHAPE_ARC in place, so the curve is walked
    // the other way round.
    a.mArcs = a.mArcs.map(reversedArc);

    return a;
  }

  /**
   * `NextShape`: the index of the point where the next straight segment or arc
   * begins, or -1 at the end of the chain.
   *
   * Walking a chain by `NextShape` rather than by `i++` is what makes an arc
   * count as *one* shape however many points stand in for it, and it is the
   * loop `LINE::ClipVertexRange` counts links with.
   *
   * The closed-chain arms (`m_closed` at `shape_line_chain.cpp:1320` and
   * `:1352`) are not written: no line the router hands a node is closed.
   */
  nextShape(aPointIndex: number): number {
    let i = aPointIndex;

    if (i < 0) i += this.pointCount();

    if (i < 0) return -1;

    const lastIndex = this.pointCount() - 1;

    // Last point? We don't want to wrap around.
    if (i >= lastIndex) return -1;

    const sh = this.mShapes[i] as [number, number];

    if (sh[0] === SHAPE_IS_PT && sh[1] === SHAPE_IS_PT) {
      return i === lastIndex - 1 ? -1 : i + 1;
    }

    const arcStart = i;

    // The second element only gets populated when the point is shared between
    // two shapes; otherwise the index is always on the first.
    if (sh[0] === SHAPE_IS_PT) return -1; // malformed chain

    const currentArcIdx = this.arcIndex(i);

    // Now skip the rest of the arc.
    while (i < lastIndex && this.arcIndex(i) === currentArcIdx) i += 1;

    const at = this.mShapes[i] as [number, number];
    const indexStillOnArc = at[0] === currentArcIdx || at[1] === currentArcIdx;

    // We want the last vertex of the arc if the initial point was the start of
    // one. Well-formed arcs generate more than one point to travel above.
    if (i - arcStart > 1 && !indexStillOnArc) i -= 1;

    if (i === lastIndex) return -1;

    return i;
  }

  /**
   * `Slice( aStartIndex, aEndIndex, aMaxError )`: the sub-chain between two
   * **vertex** indices, inclusive at both ends.
   *
   * ### Cutting through the middle of an arc
   *
   * Upstream's two arc-*splitting* arms (`shape_line_chain.cpp:1437-1464` and
   * `:1486-1513`) rebuild a partial arc with
   * `SHAPE_ARC::ConstructFromStartEndCenter`. Both are ported now that it is.
   *
   * They are reached only when a cut index falls strictly inside an arc, which
   * `LINE::ClipVertexRange` — the only caller in this port — documents as
   * impossible: *"It is assumed that anything calling this method will have
   * determined the vertex range to clip based on joints, meaning we will never
   * clip in the middle of an arc."*
   *
   * Two details in these arms are easy to lose:
   *
   *  - the copied points are tagged with `rv.m_arcs.size()`, the index the
   *    partial arc is *about to* take, not with the index it had here; and the
   *    start arm then advances the loop's start by `rv.PointCount()`, which is
   *    how the main loop resumes after a partial arc rather than re-walking it;
   *  - the end arm's new endpoint is `m_points[aEndIndex]`, **not** the last
   *    point it copied. Those differ whenever the requested end is the arc's
   *    own last point.
   */
  slice(aStartIndex: number, aEndIndex: number, aMaxError = ARC_HIGH_DEF): PnsLineChain {
    const rv = new PnsLineChain();

    let start = aStartIndex;
    let end = aEndIndex;

    if (end < 0) end += this.pointCount();

    if (start < 0) start += this.pointCount();

    // Bad programmer checks.
    if (start < 0 || end < 0 || start >= this.pointCount() || end >= this.pointCount()) return rv;

    if (end < start) return rv;

    const numPoints = this.mPoints.length;

    if (this.isArcSegment(start) && !this.isArcStart(start)) {
      // Cutting in middle of an arc, lets split it.
      const arcToSplitIndex = this.arcIndex(start);
      const arcToSplit = this.arc(arcToSplitIndex);

      // Copy the points as arc points.
      for (let i = start; i < this.mPoints.length && arcToSplitIndex === this.arcIndex(i); i++) {
        rv.mPoints.push({ ...(this.mPoints[i] as Vec2) });
        rv.mShapes.push([rv.mArcs.length, SHAPE_IS_PT]);
      }

      // Create a new arc from the existing one, with a different start point.
      rv.mArcs.push(
        constructArcFromStartEndCenter(
          this.mPoints[start] as Vec2,
          arcToSplit.p1,
          shapeArcCenter(arcToSplit),
          arcIsClockwise(arcToSplit),
        ),
      );

      // Not covered by a test: dropping this advance survives the suite. The
      // main loop would then re-walk the arc points already copied above and
      // append a duplicate of the first of them as a plain point. The slice's
      // arc, its endpoints and its first and last points all stay correct, and
      // those are what the test asserts; only the interior vertex count moves.
      start += rv.pointCount();
    }

    for (let i = start; i <= end && i < numPoints; i = this.nextShape(i)) {
      if (i === -1) return rv; // NextShape reached the end

      const nextShape = this.nextShape(i);
      const isLastShape = nextShape < 0;

      if (this.isArcStart(i)) {
        if ((isLastShape && end !== numPoints - 1) || nextShape > end) {
          if (i === end) {
            // Single point on an arc, just append the single point.
            rv.appendPoint(this.mPoints[i] as Vec2);
            return rv;
          }

          // Cutting in middle of an arc, lets split it.
          const cutArcIndex = this.arcIndex(i);
          const currentArc = this.arc(cutArcIndex);

          // Copy the points as arc points.
          for (let j = i; j <= end && j < numPoints; j++) {
            if (cutArcIndex !== this.arcIndex(j)) break;

            rv.mPoints.push({ ...(this.mPoints[j] as Vec2) });
            rv.mShapes.push([rv.mArcs.length, SHAPE_IS_PT]);
          }

          // Create a new arc from the existing one, with a different end point.
          rv.mArcs.push(
            constructArcFromStartEndCenter(
              currentArc.p0,
              this.mPoints[end] as Vec2,
              shapeArcCenter(currentArc),
              arcIsClockwise(currentArc),
            ),
          );

          return rv;
        }

        // Append the whole arc.
        rv.appendArcShape(this.arc(this.arcIndex(i)), aMaxError);

        if (isLastShape) return rv;
      } else {
        if (i === start) rv.appendPoint(this.mPoints[i] as Vec2);

        const nextPointIsArc = isLastShape ? false : this.isArcSegment(nextShape);

        if (!nextPointIsArc && i < this.segmentCount() && i < end) {
          rv.appendPoint(this.cSegment(i).b);
        }
      }
    }

    return rv;
  }

  /**
   * `RemoveDuplicatePoints`: collapse runs of identical vertices.
   *
   * `AssembleLine` calls this and **only** this — never `Simplify`. Upstream's
   * comment is emphatic (`pns_node.cpp:1203`): *"Remove duplicate verts, but do
   * NOT remove colinear segments here!"* Simplifying would break the 1:1
   * correspondence between the chain's vertices and the line's `Links()`, on
   * which everything downstream of assembly depends.
   *
   * A run collapses only while the points are equal **and** either they carry
   * the same shape indices or one of them is on no shape at all — so a vertex
   * where an arc meets a coincident straight point survives with the arc's
   * indices, not the plain one's.
   *
   * Chains shorter than three points are left alone: *"Always try to keep at
   * least 2 points otherwise, we're not really a line."*
   */
  removeDuplicatePoints(): void {
    const same = (a: [number, number], b: [number, number]): boolean =>
      a[0] === b[0] && a[1] === b[1];
    const isPt = (a: [number, number]): boolean => a[0] === SHAPE_IS_PT && a[1] === SHAPE_IS_PT;

    if (this.pointCount() < 3) return;

    if (this.pointCount() === 3) {
      const p0 = this.mPoints[0] as Vec2;
      const p1 = this.mPoints[1] as Vec2;

      if (p0.x === p1.x && p0.y === p1.y) this.removeAt(1);

      return;
    }

    const ptsUnique: Vec2[] = [];
    const shapesUnique: [number, number][] = [];

    let i = 0;

    while (i < this.pointCount()) {
      let j = i + 1;

      const pi = this.mPoints[i] as Vec2;
      const si = this.mShapes[i] as [number, number];

      // Duplicate vertices can be eliminated as long as they are part of the
      // same shape, OR one of them is part of a shape and one is not.
      while (j < this.pointCount()) {
        const pj = this.mPoints[j] as Vec2;
        const sj = this.mShapes[j] as [number, number];

        if (!(pi.x === pj.x && pi.y === pj.y && (same(si, sj) || isPt(si) || isPt(sj)))) break;

        j++;
      }

      let shapeToKeep = si;

      if (isPt(shapeToKeep)) shapeToKeep = this.mShapes[j - 1] as [number, number];

      ptsUnique.push(this.cPoint(i));
      shapesUnique.push([shapeToKeep[0], shapeToKeep[1]]);

      i = j;
    }

    this.mPoints = ptsUnique;
    this.mShapes = shapesUnique;
  }

  /**
   * `Remove( int aIndex )`, which upstream defines as `Remove( aIndex, aIndex )`
   * — the single-vertex spelling {@link removeDuplicatePoints} reaches.
   *
   * It used to throw on a point that sits on an arc, because the range form
   * needs `splitArc` and `splitArc` needed
   * `SHAPE_ARC::ConstructFromStartEndCenter`. Both are ported, so this is now
   * upstream's own one-liner and a coincident duplicate on an arc is trimmed
   * with the arc re-cut around it instead of the shape indices being corrupted.
   */
  private removeAt(aIndex: number): void {
    this.remove(aIndex, aIndex);
  }

  /**
   * The arc arm of `SHAPE_LINE_CHAIN::Split` (`shape_line_chain.cpp:1218-1224`),
   * as a method so that the two ports of `Split` in this tree —
   * `chainSplit` in `pns_line_drag.ts` and `chainSplitAt` in
   * `pns_meander_placer_base.ts` — share one copy of it rather than growing a
   * third.
   *
   * `aP` goes in at `aSegIndex + 1` carrying the *first* half's arc index, and
   * then {@link splitArc} is asked for a **coincident** split, which is what
   * makes the inserted point shared between the two halves: its `.first` stays
   * the arc it was given here and its `.second` becomes the new arc.
   */
  insertPointOnArcSegment(aSegIndex: number, aP: Vec2): void {
    const newIndex = aSegIndex + 1;

    this.mPoints.splice(newIndex, 0, { x: aP.x, y: aP.y });
    this.mShapes.splice(newIndex, 0, [this.arcIndex(aSegIndex), SHAPE_IS_PT]);

    this.splitArc(newIndex, true); // Make the inserted point a shared point
  }

  /**
   * `Append( const SHAPE_ARC&, int aMaxError )`: polygonize, then append.
   *
   * The counterpart of {@link appendArc} that upstream actually has. PR 2 made
   * the polyline a parameter because `SHAPE_ARC::ConvertToPolyline` was not
   * ported; it is now, in `pns_arc.ts`, and `AssembleLine` needs this spelling.
   */
  appendArcShape(aArc: ShapeArc, aMaxError = ARC_HIGH_DEF): void {
    this.appendArc(aArc, convertArcToPolyline(aArc, aMaxError));
  }

  /**
   * `Append( const SHAPE_ARC&, int aMaxError )`, with the polygonization handed
   * in rather than computed — see the module note.
   *
   * The stored copy of the arc has its width zeroed, exactly as upstream does:
   * the chain holds geometry, and the width belongs to whatever is stroked along
   * it. And an arc whose polyline came out as two points or fewer is *not*
   * recorded as an arc at all — its points are appended as plain points.
   */
  appendArc(aArc: ShapeArc, aPolyline: readonly Vec2[]): void {
    if (aPolyline.length === 0) return;

    const isArc = aPolyline.length > 2;
    const numArcs = this.mArcs.length;

    if (isArc) {
      this.mArcs.push({
        p0: { ...aArc.p0 },
        arcMid: { ...aArc.arcMid },
        p1: { ...aArc.p1 },
        width: 0,
      });
    }

    // The sub-chain upstream builds: every point tagged with local arc 0.
    const otherShapes: [number, number][] = aPolyline.map(() =>
      isArc ? [0, SHAPE_IS_PT] : shapesArePt(),
    );
    const fix = (s: [number, number]): [number, number] => [
      s[0] === SHAPE_IS_PT ? SHAPE_IS_PT : s[0] + numArcs,
      s[1] === SHAPE_IS_PT ? SHAPE_IS_PT : s[1] + numArcs,
    ];

    const first = aPolyline[0] as Vec2;
    const last = this.mPoints[this.mPoints.length - 1];
    const shareFirst = last !== undefined && last.x === first.x && last.y === first.y;

    if (!shareFirst) {
      this.mPoints.push({ ...first });
      this.mShapes.push(fix(otherShapes[0] as [number, number]));
    } else if (isArc) {
      // Associate the new arc with the point already there.
      const back = this.mShapes[this.mShapes.length - 1] as [number, number];

      if (back[0] === SHAPE_IS_PT && back[1] === SHAPE_IS_PT) back[0] = numArcs;
      else back[1] = numArcs;
    }

    for (let i = 1; i < aPolyline.length; i++) {
      this.mPoints.push({ ...(aPolyline[i] as Vec2) });

      const s = otherShapes[i] as [number, number];
      const localArc = s[0] !== SHAPE_IS_PT && s[1] !== SHAPE_IS_PT ? s[1] : s[0];

      this.mShapes.push(localArc !== SHAPE_IS_PT ? fix(s) : shapesArePt());
    }
  }

  // ----- added for the meander geometry (pns_meander.ts) ------------------------

  /** `Clear()`. The accuracy and width upstream also resets live elsewhere. */
  clear(): void {
    this.mPoints = [];
    this.mShapes = [];
    this.mArcs = [];
    this.mClosed = false;
  }

  /**
   * `Append( const SHAPE_LINE_CHAIN& aOtherLine )`.
   *
   * The same three moves as {@link appendArc}, which is upstream's arc overload
   * expressed through this one: renumber the incoming arcs past ours, fold the
   * joint point away when the two chains already meet there, and copy the rest.
   * The one difference is the test for "does the incoming chain *start* on an
   * arc" — the arc overload knows the answer from its polyline length, while
   * here it has to be asked of the chain, because a chain arriving from
   * `makeMiterShape` is a plain point followed by an arc.
   *
   * `mergeFirstLastPointIfNeeded` is not called: its open-chain arm only fires
   * when point 0 is shared between two arcs, which cannot happen to a chain
   * being appended *to* — that point came from this chain, not the other.
   */
  appendChain(aOther: PnsLineChain): void {
    if (aOther.mPoints.length === 0) return;

    const numArcs = this.mArcs.length;

    for (const a of aOther.mArcs) {
      this.mArcs.push({
        p0: { ...a.p0 },
        arcMid: { ...a.arcMid },
        p1: { ...a.p1 },
        width: a.width,
      });
    }

    const fix = (s: [number, number]): [number, number] => [
      s[0] === SHAPE_IS_PT ? SHAPE_IS_PT : s[0] + numArcs,
      s[1] === SHAPE_IS_PT ? SHAPE_IS_PT : s[1] + numArcs,
    ];

    const first = aOther.mPoints[0] as Vec2;
    const last = this.mPoints[this.mPoints.length - 1];

    if (
      this.mPoints.length === 0 ||
      last === undefined ||
      last.x !== first.x ||
      last.y !== first.y
    ) {
      this.mPoints.push({ ...first });
      this.mShapes.push(fix(aOther.mShapes[0] as [number, number]));
    } else if (aOther.isArcSegment(0)) {
      const back = this.mShapes[this.mShapes.length - 1] as [number, number];
      const incoming = (aOther.mShapes[0] as [number, number])[0] + numArcs;

      if (back[0] === SHAPE_IS_PT && back[1] === SHAPE_IS_PT) back[0] = incoming;
      else back[1] = incoming;
    }

    for (let i = 1; i < aOther.mPoints.length; i++) {
      this.mPoints.push({ ...(aOther.mPoints[i] as Vec2) });

      this.mShapes.push(
        aOther.arcIndex(i) !== SHAPE_IS_PT
          ? fix(aOther.mShapes[i] as [number, number])
          : shapesArePt(),
      );
    }
  }

  /**
   * `Mirror( const SEG& axis )`: every point and every arc reflected across the
   * axis. The shape indices are untouched, so which segments belong to which
   * arc survives the flip — a mirrored arc is still the same arc, traversed the
   * other way round.
   */
  mirror(aAxis: Seg): void {
    this.mPoints = this.mPoints.map((p) => segReflectPoint(aAxis, p));

    this.mArcs = this.mArcs.map((a) => ({
      p0: segReflectPoint(aAxis, a.p0),
      arcMid: segReflectPoint(aAxis, a.arcMid),
      p1: segReflectPoint(aAxis, a.p1),
      width: a.width,
    }));
  }

  // ----- the chain surface SHOVE needs -------------------------------------------

  /**
   * The raw points, for the free functions in `pns_chain.ts` that speak
   * `Vec2[]`. Copies, so a caller cannot reach past the arc bookkeeping and
   * desynchronise `mShapes`.
   */
  points(): Vec2[] {
    return this.mPoints.map((p) => ({ x: p.x, y: p.y }));
  }

  /** `SHAPE_LINE_CHAIN::BBox()`, with no clearance argument. */
  bbox(): { x: number; y: number; w: number; h: number } {
    if (this.mPoints.length === 0) return { x: 0, y: 0, w: 0, h: 0 };

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const p of this.mPoints) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** `Insert( aVertex, aP )`: a plain point, belonging to no arc. */
  insertPoint(aIndex: number, aP: Vec2): void {
    this.mPoints.splice(aIndex, 0, { x: aP.x, y: aP.y });
    this.mShapes.splice(aIndex, 0, shapesArePt());
  }

  /** `Remove( aIndex )`, single vertex. */
  removePoint(aIndex: number): void {
    if (aIndex < 0 || aIndex >= this.mPoints.length) return;

    this.mPoints.splice(aIndex, 1);
    this.mShapes.splice(aIndex, 1);
  }

  // ----- added for the diff-pair optimizer (pns_optimizer_diff_pair.ts) --------

  /**
   * `Insert( size_t aVertex, const VECTOR2I& aP )`, upstream's full spelling.
   *
   * {@link insertPoint} above is a *partial* one — it has neither the append
   * arm (which drops a duplicate of the current last point, because `Append`
   * does) nor the arc split. Its two callers (`pns_shove.ts`,
   * `pns_meander_placer_base.ts`) reach neither arm, and turning a currently
   * silent splice into a throw for them is not this change's business, so the
   * faithful version goes in beside it rather than over it. Used only by
   * {@link replace}.
   */
  private insertVertex(aVertex: number, aP: Vec2): void {
    if (aVertex === this.mPoints.length) {
      this.appendPoint(aP);
      return;
    }

    if (aVertex >= this.mPoints.length) return; // wxCHECK

    if (aVertex > 0 && this.isPtOnArc(aVertex)) this.splitArc(aVertex, false);

    // Upstream's `//@todo need to check we aren't creating duplicate points`.
    this.mPoints.splice(aVertex, 0, { x: aP.x, y: aP.y });
    this.mShapes.splice(aVertex, 0, shapesArePt());
  }

  /**
   * `convertArc( ssize_t aArcIndex )`: forget that an arc was ever an arc.
   *
   * Pure index bookkeeping and therefore fully portable. Two things about it
   * are load-bearing and easy to lose:
   *
   *  - the two tests run in sequence on the *same* slot, so a slot equal to
   *    `aArcIndex` is first set to `SHAPE_IS_PT` and then fails the `>` test
   *    (`-1 > idx` is false for any real arc index). Writing them as an
   *    `else if` would be equivalent here and is not what upstream wrote;
   *  - the swap afterwards restores the class invariant that `second` is
   *    `SHAPE_IS_PT` whenever `first` is. Without it a point whose *first* arc
   *    was the one converted would report `IsPtOnArc() == true` with a
   *    meaningless `ArcIndex()`.
   */
  private convertArc(aArcIndex: number): void {
    let idx = aArcIndex;

    if (idx < 0) idx += this.mArcs.length;

    if (idx >= this.mArcs.length) return;

    for (const sh of this.mShapes) {
      for (const k of [0, 1] as const) {
        if (sh[k] === idx) sh[k] = SHAPE_IS_PT;

        if (sh[k] > idx) sh[k] -= 1;
      }

      if (sh[1] !== SHAPE_IS_PT && sh[0] === SHAPE_IS_PT) {
        const t = sh[0];
        sh[0] = sh[1];
        sh[1] = t;
      }
    }

    this.mArcs.splice(idx, 1);
  }

  /**
   * `amendArc( size_t aArcIndex, const VECTOR2I& aNewStart, const VECTOR2I&
   * aNewEnd )` (`shape_line_chain.cpp:274-289`).
   *
   * Re-cut an arc to new endpoints **keeping its centre and its handedness**.
   * Upstream's comment says "try to preserve the centre of the original arc",
   * and that is the whole design: the new endpoints come from points that were
   * already on the old arc, so a construction through the same centre lands on
   * the same curve, whereas a three-point construction through a fresh midpoint
   * would drift.
   *
   * The width is *not* carried over — upstream default-constructs the
   * replacement and calls `ConstructFromStartEndCenter` with its default zero
   * width. Chain-held arcs already have zero width ({@link appendArc} strips
   * it), so the loss is invisible here, but it is upstream's behaviour and not
   * a simplification.
   *
   * **Not covered by a test:** negating `arcIsClockwise( theArc )` here survives
   * the whole PNS suite. `amendArc` is reached only from {@link splitArc}'s
   * shared-point / arc-end arm, and that arm needs a chain whose split index is
   * where two arcs *meet* — which nothing in this tree builds yet, because the
   * only producer of abutting arcs would be the `LINE_PLACER` that has not
   * landed. The interior arm, which every current caller takes, is covered.
   */
  private amendArc(aArcIndex: number, aNewStart: Vec2, aNewEnd: Vec2): void {
    const theArc = this.mArcs[aArcIndex];

    if (!theArc) return; // wxCHECK_MSG( "Invalid arc index requested." )

    this.mArcs[aArcIndex] = constructArcFromStartEndCenter(
      aNewStart,
      aNewEnd,
      shapeArcCenter(theArc),
      arcIsClockwise(theArc),
    );
  }

  /**
   * `splitArc( ssize_t aPtIndex, bool aCoincident )`
   * (`shape_line_chain.cpp:292-365`).
   *
   * Cut the arc that owns point `aPtIndex` in two there. `aCoincident` says
   * whether the point is to be *shared* by the two halves (both halves touch
   * it) or whether the first half is to stop at the previous point instead —
   * which is the difference between splitting a chain at a vertex that must
   * survive and trimming an arc back off a vertex that is about to go away.
   *
   * Four early-outs, then two arms.
   *
   * ### The shared-point / arc-end arm
   *
   * There is no arc to cut *after* the index — the point is already the end of
   * one — so all that happens is that the first arc is amended back to the
   * previous point and the index stops pointing at it. `aCoincident` (or index
   * 0, where there is no previous point) makes even that unnecessary.
   *
   * ### The interior arm
   *
   * Both halves are built from the *original* arc's centre and handedness, so
   * they lie on the same circle. Then either:
   *
   *  - the point is the first of its arc's run and not coincident, so the first
   *    half would have zero points — upstream's comment — and only the second
   *    half is kept, in place; or
   *  - both halves are kept, the second inserted directly after the first, and
   *    **only the shape indices from `aPtIndex` onward** are bumped past the
   *    insertion. Renumbering the whole chain would corrupt the first half.
   *
   * In the coincident case `m_shapes[aPtIndex].second` is set to the new arc
   * *before* the index is advanced, so the split point ends up genuinely shared
   * — first arc in `.first`, second in `.second` — and the renumbering starts
   * past it.
   *
   * `arcIndex( aPtIndex - 1 )` at index 0 reads off the front of the array;
   * upstream indexes a `std::vector` with `-1` there and gets whatever is in
   * front of it, and {@link arcIndex} answers `SHAPE_IS_PT`, which is `-1` and
   * so compares unequal to any real arc index — the same branch upstream takes
   * in practice.
   */
  private splitArc(aPtIndex: number, aCoincident: boolean): void {
    let idx = aPtIndex;

    if (idx < 0) idx += this.mShapes.length;

    if (!this.isSharedPt(idx) && this.isArcStart(idx)) return; // Nothing to do

    if (!this.isPtOnArc(idx)) return; // Nothing to do

    if (idx >= this.mShapes.length) return; // wxCHECK_MSG( "Invalid point index requested." )

    if (this.isSharedPt(idx) || this.isArcEnd(idx)) {
      if (aCoincident || idx === 0) return; // nothing to do

      const shape = this.mShapes[idx] as [number, number];
      const firstArcIndex = shape[0];
      const firstArc = this.mArcs[firstArcIndex] as ShapeArc;

      // Don't amend the start.
      this.amendArc(firstArcIndex, firstArc.p0, this.mPoints[idx - 1] as Vec2);

      if (this.isSharedPt(idx)) {
        shape[0] = shape[1];
        shape[1] = SHAPE_IS_PT;
      } else {
        this.mShapes[idx] = shapesArePt();
      }

      return;
    }

    const currArcIdx = this.arcIndex(idx);
    const currentArc = this.arc(currArcIdx);
    const centre = shapeArcCenter(currentArc);
    const clockwise = arcIsClockwise(currentArc);

    const arc1End = aCoincident ? (this.mPoints[idx] as Vec2) : (this.mPoints[idx - 1] as Vec2);
    const arc2Start = this.mPoints[idx] as Vec2;

    const newArc1 = constructArcFromStartEndCenter(currentArc.p0, arc1End, centre, clockwise);
    const newArc2 = constructArcFromStartEndCenter(arc2Start, currentArc.p1, centre, clockwise);

    if (!aCoincident && this.arcIndex(idx - 1) !== currArcIdx) {
      // Ignore newArc1 as it has zero points.
      this.mArcs[currArcIdx] = newArc2;

      return;
    }

    this.mArcs[currArcIdx] = newArc1;
    this.mArcs.splice(currArcIdx + 1, 0, newArc2);

    if (aCoincident) {
      (this.mShapes[idx] as [number, number])[1] = currArcIdx + 1;

      // Not covered by a test: dropping this `idx++` survives the suite. Without
      // it the renumbering below also bumps the split point's own pair, so its
      // `.first` stops naming the arc that ends there and its `.second` names an
      // arc index one past the end. Nothing currently reads the split point's
      // indices — the `Split` test asserts `IsSharedPt` (still true either way)
      // and the two halves' endpoints, which live in `m_arcs`, not `m_shapes`.
      idx++;
    }

    // Only change the arc indices for the second half of the point range.
    for (let i = idx; i < this.pointCount(); i++) {
      const sh = this.mShapes[i] as [number, number];

      for (const k of [0, 1] as const) {
        if (sh[k] !== SHAPE_IS_PT) sh[k] += 1;
      }
    }
  }

  /**
   * `Remove( int aStartIndex, int aEndIndex )`: drop a **vertex** range,
   * inclusive at both ends, converting away any arc the range touches.
   *
   * Upstream brackets the whole body in `SetClosed(false)` / restore so that an
   * arc wrapping the seam of a closed chain is handled; closed chains are not
   * modelled here (see the module note) and the bracketing is a no-op, so it is
   * named rather than written.
   *
   * Three of upstream's own quirks are reproduced:
   *
   *  - **a shared point strictly inside the range logs no arc at all.** The
   *    `if( IsSharedPt( i ) )` block only `continue`s on the two ends; a shared
   *    point in the middle falls out of it *and* skips the `else`, so neither
   *    of its arcs is converted before the points vanish underneath them;
   *  - **`extra_arcs` is collected before any conversion happens**, and every
   *    {@link convertArc} renumbers the arcs above it downwards. Converting 1
   *    and then 3 therefore converts what *was* arc 4;
   *  - the two `IsSharedPt` adjustments move the range's ends inwards so a
   *    shared point survives, which is how the range can come out empty
   *    (`start > end`) and the call become a no-op.
   */
  remove(aStartIndex: number, aEndIndex: number): void {
    let start = aStartIndex;
    let end = aEndIndex;

    if (end < 0) end += this.pointCount();

    if (start < 0) start += this.pointCount();

    if (start >= this.pointCount() || end >= this.pointCount() || start > end) return;

    // Split arcs, making arcs coincident.
    if (!this.isArcStart(start) && this.isPtOnArc(start)) this.splitArc(start, false);

    if (this.isSharedPt(start)) start += 1; // Don't delete the shared point

    if (!this.isArcEnd(end) && this.isPtOnArc(end) && end < this.pointCount() - 1) {
      this.splitArc(end + 1, true);
    }

    if (this.isSharedPt(end)) end -= 1; // Don't delete the shared point

    if (start > end) return;

    const extraArcs = new Set<number>();
    const logArcIdxRemoval = (aShapeIndex: number): void => {
      if (aShapeIndex !== SHAPE_IS_PT) extraArcs.add(aShapeIndex);
    };

    // Remove any overlapping arcs in the point range.
    for (let i = start; i <= end; i++) {
      const sh = this.mShapes[i] as [number, number];

      if (this.isSharedPt(i)) {
        if (i === start) {
          logArcIdxRemoval(sh[1]); // Only remove the arc on the second index
        } else if (i === end) {
          logArcIdxRemoval(sh[0]); // Only remove the arc on the first index
        }
      } else {
        logArcIdxRemoval(sh[0]);
        logArcIdxRemoval(sh[1]);
      }
    }

    // `std::set<size_t>` iterates ascending; a JS Set iterates in insertion
    // order, and the difference is observable through convertArc's renumbering.
    for (const arc of [...extraArcs].sort((a, b) => a - b)) this.convertArc(arc);

    this.mShapes.splice(start, end - start + 1);
    this.mPoints.splice(start, end - start + 1);
  }

  /**
   * `Replace( aStartIndex, aEndIndex, const VECTOR2I& )` and
   * `Replace( aStartIndex, aEndIndex, const SHAPE_LINE_CHAIN& )`.
   *
   * Both take **vertex** indices, inclusive at both ends.
   *
   * The chain overload's shape is entirely about not doubling a point that is
   * already there: if the replacement starts where the range starts, the range
   * is narrowed by one and the replacement loses its first point; likewise at
   * the far end, and there guarded by `aEndIndex > 0`. That is what lets the
   * diff-pair optimizer hand in a bypass whose two ends *are* the chain's own
   * vertices and get back a chain with only the bypass's interior spliced in.
   *
   * The arc indices of the incoming chain are rebased by the arc count **after**
   * the removal, not before — `prev_arc_count` is read once the hole has been
   * made, so an arc that the removal converted away has already stopped
   * counting.
   *
   * Upstream's `wxASSERT( aStartIndex <= aEndIndex )` and
   * `wxASSERT( aEndIndex < m_points.size() )` are assertions, not guards: a
   * release build falls through them into {@link remove}, which has real guards
   * of its own and returns without doing anything. Not re-spelled as throws.
   */
  replace(aStartIndex: number, aEndIndex: number, aP: Vec2): void;
  replace(aStartIndex: number, aEndIndex: number, aLine: PnsLineChain): void;
  replace(aStartIndex: number, aEndIndex: number, aPOrLine: Vec2 | PnsLineChain): void {
    if (!(aPOrLine instanceof PnsLineChain)) {
      this.remove(aStartIndex, aEndIndex);
      this.insertVertex(aStartIndex, aPOrLine);
      return;
    }

    let start = aStartIndex;
    let end = aEndIndex;

    if (end < 0) end += this.pointCount();

    if (start < 0) start += this.pointCount();

    // The argument is copied, never mutated — callers reuse it.
    const newLine = aPOrLine.clone();

    // Zero points to add?
    if (newLine.pointCount() === 0) {
      this.remove(start, end);
      return;
    }

    // Remove coincident points in the new line.
    const atStart = this.mPoints[start];

    if (atStart !== undefined && samePt(newLine.mPoints[0] as Vec2, atStart)) {
      start++;
      newLine.remove(0, 0);

      // Zero points to add?
      if (newLine.pointCount() === 0) {
        this.remove(start, end);
        return;
      }
    }

    const atEnd = this.mPoints[end];
    const back = newLine.mPoints[newLine.mPoints.length - 1] as Vec2;

    if (atEnd !== undefined && samePt(back, atEnd) && end > 0) {
      end--;
      newLine.remove(-1, -1);
    }

    this.remove(start, end);

    // Zero points to add?
    if (newLine.pointCount() === 0) return;

    // The total new arcs index is added to the new arc indices.
    const prevArcCount = this.mArcs.length;
    const newShapes = newLine.mShapes.map((s): [number, number] => [
      s[0] === SHAPE_IS_PT ? SHAPE_IS_PT : s[0] + prevArcCount,
      s[1] === SHAPE_IS_PT ? SHAPE_IS_PT : s[1] + prevArcCount,
    ]);

    this.mShapes.splice(start, 0, ...newShapes);
    this.mPoints.splice(start, 0, ...newLine.mPoints.map((p) => ({ x: p.x, y: p.y })));
    this.mArcs.push(...newLine.mArcs);
  }

  /**
   * `SHAPE_LINE_CHAIN::Simplify2( aRemoveColinear )`.
   *
   * Two stages, and the early returns before them are not an optimisation:
   * a chain of fewer than three points is left alone entirely, and a chain of
   * exactly three has only its leading duplicate removed. Upstream returns
   * `*this`; so does this, so `chain.simplify2()` reads the same either way.
   *
   * Stage 1 collapses runs of identical points, but only while the run belongs
   * to one shape — or one end of it is a plain point. The kept shape index is
   * the *first* point's unless that is a plain point, in which case it is the
   * last of the run: a duplicate that straddles the boundary between a segment
   * and an arc is folded into the arc, never the other way round.
   *
   * Stage 2 drops collinear runs, and only between plain points
   * (`shapes[i]` and `shapes[i+1]` both `SHAPES_ARE_PT`) — an arc is never
   * flattened. The `LineDistance <= 1` test is upstream's tolerance for integer
   * rounding; the `Collinear` disjunct catches the exactly-parallel case the
   * distance test misses when the outer points coincide.
   */
  simplify2(aRemoveColinear = true): PnsLineChain {
    if (this.pointCount() < 3) return this;

    if (this.pointCount() === 3) {
      const p0 = this.mPoints[0] as Vec2;
      const p1 = this.mPoints[1] as Vec2;

      if (p0.x === p1.x && p0.y === p1.y) this.removePoint(1);

      return this;
    }

    const ptsUnique: Vec2[] = [];
    const shapesUnique: [number, number][] = [];

    let i = 0;
    let np = this.pointCount();

    // stage 1: eliminate duplicate vertices
    while (i < np) {
      let j = i + 1;

      const pi = this.mPoints[i] as Vec2;
      const si = this.mShapes[i] as [number, number];

      while (j < np) {
        const pj = this.mPoints[j] as Vec2;
        const sj = this.mShapes[j] as [number, number];

        if (pi.x !== pj.x || pi.y !== pj.y) break;

        const sameShape = si[0] === sj[0] && si[1] === sj[1];
        const iIsPt = si[0] === SHAPE_IS_PT && si[1] === SHAPE_IS_PT;
        const jIsPt = sj[0] === SHAPE_IS_PT && sj[1] === SHAPE_IS_PT;

        if (!sameShape && !iIsPt && !jIsPt) break;

        j++;
      }

      let shapeToKeep = si;

      if (shapeToKeep[0] === SHAPE_IS_PT && shapeToKeep[1] === SHAPE_IS_PT)
        shapeToKeep = this.mShapes[j - 1] as [number, number];

      ptsUnique.push({ ...(this.mPoints[i] as Vec2) });
      shapesUnique.push([shapeToKeep[0], shapeToKeep[1]]);

      i = j;
    }

    this.mPoints = [];
    this.mShapes = [];
    np = ptsUnique.length;
    i = 0;

    const isPt = (s: [number, number]): boolean => s[0] === SHAPE_IS_PT && s[1] === SHAPE_IS_PT;

    // stage 2: eliminate colinear segments
    while (i < np - 2) {
      const p0 = ptsUnique[i] as Vec2;
      let n = i;
      const next = shapesUnique[i + 1];

      if (aRemoveColinear && isPt(shapesUnique[i] as [number, number]) && next && isPt(next)) {
        while (
          n < np - 2 &&
          (segLineDistance(p0, ptsUnique[n + 2] as Vec2, ptsUnique[n + 1] as Vec2) <= 1 ||
            segCollinear(p0, ptsUnique[n + 2] as Vec2, p0, ptsUnique[n + 1] as Vec2))
        )
          n++;
      }

      this.mPoints.push({ ...p0 });
      this.mShapes.push([...(shapesUnique[i] as [number, number])] as [number, number]);

      if (n > i) i = n;

      if (n === np - 2) {
        this.mPoints.push({ ...(ptsUnique[np - 1] as Vec2) });
        this.mShapes.push([...(shapesUnique[np - 1] as [number, number])] as [number, number]);

        return this;
      }

      i++;
    }

    if (np > 1) {
      this.mPoints.push({ ...(ptsUnique[np - 2] as Vec2) });
      this.mShapes.push([...(shapesUnique[np - 2] as [number, number])] as [number, number]);
    }

    this.mPoints.push({ ...(ptsUnique[np - 1] as Vec2) });
    this.mShapes.push([...(shapesUnique[np - 1] as [number, number])] as [number, number]);

    return this;
  }

  /**
   * `SHAPE_LINE_CHAIN::Simplify( aTolerance = 0 )`: greedily extend a run of
   * points that all lie within `aTolerance` of the chord from the run's start,
   * and keep only the endpoints of each such run.
   *
   * A point that belongs to an arc terminates a run — only the *intermediate*
   * test points are required to be plain, so a run may start or end on an arc
   * endpoint and the arc itself survives. The two tail fix-ups matter: a chain
   * that collapsed to a single point gets the original last point appended
   * back, and an open chain always ends where it began ending.
   *
   * The closed-chain arms of upstream's modular arithmetic are unreachable
   * here — no line the router builds is closed — so the `endIdx > startIdx`
   * guard is written without the `|| m_closed` disjunct.
   */
  simplify(aTolerance = 0): void {
    if (this.pointCount() < 3) return;

    const newPoints: Vec2[] = [];
    const newShapes: [number, number][] = [];
    const n = this.mPoints.length;

    for (let startIdx = 0; startIdx < n; ) {
      newPoints.push({ ...(this.mPoints[startIdx] as Vec2) });
      newShapes.push([...(this.mShapes[startIdx] as [number, number])] as [number, number]);

      // Not closed: we need at least 3 points before simplifying.
      if (startIdx === n - 2) break;

      let endIdx = (startIdx + 2) % n;
      let canSimplify = true;

      while (canSimplify && endIdx !== startIdx && endIdx > startIdx) {
        for (let testIdx = (startIdx + 1) % n; testIdx !== endIdx; testIdx = (testIdx + 1) % n) {
          if ((this.mShapes[testIdx] as [number, number])[0] !== SHAPE_IS_PT) {
            canSimplify = false;
            break;
          }

          if (
            !testSegmentHit(
              this.mPoints[testIdx] as Vec2,
              this.mPoints[startIdx] as Vec2,
              this.mPoints[endIdx] as Vec2,
              aTolerance,
            )
          ) {
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

        if (newStartIdx <= startIdx) break;

        startIdx = newStartIdx;
      }
    }

    const last = this.mPoints[n - 1] as Vec2;
    const lastShape = this.mShapes[n - 1] as [number, number];

    if (newPoints.length === 1) {
      newPoints.push({ ...last });
      newShapes.push([...lastShape] as [number, number]);
    }

    const tail = newPoints[newPoints.length - 1] as Vec2;

    if (tail.x !== last.x || tail.y !== last.y) {
      newPoints.push({ ...last });
      newShapes.push([...lastShape] as [number, number]);
    }

    this.mPoints = newPoints;
    this.mShapes = newShapes;
  }

  /**
   * `SHAPE_LINE_CHAIN::CompareGeometry( aOther, aCyclicalCompare = false, aEpsilon = 0 )`,
   * non-cyclical arm only — no caller in `SHOVE` passes `true`, and the cyclical
   * arm sorts by angle about the centroid, which is meaningless for an open
   * track.
   *
   * Both sides are `Simplify()`-ed first (the tolerance-0 pass, **not**
   * `Simplify2`), so two chains that differ only by a redundant mid-point
   * compare equal. That is the whole reason `reconstructHeads` uses it to decide
   * `geometryModified` — a head that was merely re-vertexed did not move.
   */
  compareGeometry(aOther: PnsLineChain, aEpsilon = 0): boolean {
    const a = this.clone();
    const b = aOther.clone();

    a.simplify();
    b.simplify();

    if (a.pointCount() !== b.pointCount()) return false;

    for (let i = 0; i < a.pointCount(); i++) {
      const pa = a.cPoint(i);
      const pb = b.cPoint(i);

      if (Math.abs(pa.x - pb.x) > aEpsilon || Math.abs(pa.y - pb.y) > aEpsilon) return false;
    }

    return true;
  }

  /**
   * `SHAPE_LINE_CHAIN::SelfIntersecting()`: the first crossing between two
   * non-adjacent segments, or null.
   *
   * `shoveLineToHullSet` uses it purely as a rejection test, so only the
   * presence of a crossing and its point are ported; upstream's `INTERSECTION`
   * also carries the two segment indices, which no caller in `SHOVE` reads.
   * Segments sharing an endpoint are not a self-intersection — hence the
   * `s2 === s1 + 1` arm, which still reports the degenerate case where the pair
   * folds straight back on itself.
   */
  selfIntersecting(): Vec2 | null {
    const segCount = this.segmentCount();

    if (segCount < 2) return null;

    for (let s1 = 0; s1 < segCount; s1++) {
      const a1 = this.mPoints[s1] as Vec2;
      const b1 = this.mPoints[s1 + 1] as Vec2;

      for (let s2 = s1 + 1; s2 < segCount; s2++) {
        const a2 = this.mPoints[s2] as Vec2;
        const b2 = this.mPoints[s2 + 1] as Vec2;

        if (s2 === s1 + 1) {
          if (a1.x === b2.x && a1.y === b2.y) return { x: a1.x, y: a1.y };

          continue;
        }

        const ip = segIntersect(a1, b1, a2, b2);

        if (ip) return ip;
      }
    }

    return null;
  }

  /**
   * `SHAPE_LINE_CHAIN::NearestPoint( aP, aAllowInternalShapePoints )`.
   *
   * `shoveLineToHullSet` calls it with `true`; `SHAPE_LINE_CHAIN::Split( aStart,
   * aEnd, … )`, and so the meander placers, call it with `false`. The two arms
   * differ **only when the nearest segment belongs to an arc**: with internal
   * shape points disallowed, the answer is snapped out to one end of that arc
   * rather than landing on the curve, so that a cut made there does not have to
   * bisect the arc.
   *
   * Two details of that snapping are upstream's and easy to lose:
   *
   *  - the walk to the arc's far end goes through the *segment's* endpoints
   *    first (`nearest++` when `aP` is nearer to B than to A), and only then
   *    asks whether the point it landed on is an arc start or end;
   *  - the guard is `nearest > 0`, so a nearest segment of index 0 is never
   *    snapped even when it is an arc.
   */
  nearestPoint(aP: Vec2, aAllowInternalShapePoints = true): Vec2 {
    if (this.pointCount() === 0) return { x: 0, y: 0 }; // upstream: "don't crash"

    let minD = Number.POSITIVE_INFINITY;
    let nearest = 0;

    for (let i = 0; i < this.segmentCount(); i++) {
      const d = segDistance(this.mPoints[i] as Vec2, this.mPoints[i + 1] as Vec2, aP);

      if (d < minD) {
        minD = d;
        nearest = i;
      }
    }

    if (this.segmentCount() === 0) return { ...(this.mPoints[0] as Vec2) };

    if (!aAllowInternalShapePoints) {
      // Snap to arc end points if the closest found segment is part of an arc.
      if (nearest > 0 && nearest < this.pointCount() && this.isArcSegment(nearest)) {
        const s = this.cSegment(nearest);
        const toStart = Math.hypot(s.a.x - aP.x, s.a.y - aP.y);
        const toEnd = Math.hypot(s.b.x - aP.x, s.b.y - aP.y);

        // NOT PINNED. Flipping this comparison survives the suite, and for
        // an arc of less than 180 degrees it is genuinely equivalent: the
        // vertex either way is an arc terminus (returned directly) or an
        // interior point (which falls through to the same nearer-terminus
        // comparison below), and for a non-reflex arc both roads reach the same
        // end. A reflex arc, where P1 curls back near P0, could separate them.
        // Not investigated further.
        if (toStart > toEnd) nearest++;

        // Is this the start or end of an arc? If so, return it directly.
        if (this.isArcStart(nearest) || this.isArcEnd(nearest)) {
          return { ...(this.mPoints[nearest] as Vec2) };
        }

        const arc = this.arc(this.arcIndex(nearest));
        const toArcStart = Math.hypot(arc.p0.x - aP.x, arc.p0.y - aP.y);
        const toArcEnd = Math.hypot(arc.p1.x - aP.x, arc.p1.y - aP.y);

        return toArcStart > toArcEnd ? { ...arc.p1 } : { ...arc.p0 };
      }
    }

    return nearestOnSegment(this.mPoints[nearest] as Vec2, this.mPoints[nearest + 1] as Vec2, aP);
  }

  // ----- the chain surface LINE_PLACER needs ------------------------------------
  //
  // Upstream's arc bookkeeping in `Remove`, `Split` and `Replace` splits an arc
  // that a cut lands inside; that path is NOT ported. Shape indices are carried
  // along with the points so an arc-bearing chain is never *corrupted*, but a
  // cut through the middle of an arc leaves the arc's remaining points pointing
  // at it rather than splitting it in two. LINE_PLACER's own chains are
  // arc-free — `Direction45` builds no arcs in the ported corner modes — and
  // the one place arcs do reach it (`FixRoute` reading `arcIndex`) only reads.
  //
  // Deliberately absent: `points()`, `bbox()`, `nearestPoint()`, `insertPoint()`
  // and `simplify()`/`simplify2()`. This port had its own of each and SHOVE's
  // are the ones kept. `simplify` matters most: SHOVE's is
  // `SHAPE_LINE_CHAIN::Simplify( int aTolerance )` (`shape_line_chain.h:358`),
  // which is what `LINE_PLACER` actually calls, where this port had bound the
  // name to `Simplify2( bool aRemoveColinear )` (`:362`) — a different function
  // with a fixed one-IU band. SHOVE's is the faithful one.

  /** `IsClosed()`. */
  isClosed(): boolean {
    return this.mClosed;
  }

  /**
   * `SetClosed`. Only a flag: it does not append the wrap-around point, and
   * `segmentCount()` here deliberately still reports the open count, matching
   * how the ported callers use it.
   */
  setClosed(aClosed: boolean): void {
    this.mClosed = aClosed;
  }

  /**
   * `Area( aAbsolute = true )` (`shape_line_chain.cpp:2696-2718`): the shoelace
   * area, **zero unless the chain is closed**. The posture solver leans on that
   * — it closes its two candidate polygons before measuring, and a chain it
   * forgot to close would silently compare 0 against 0.
   */
  area(aAbsolute = true): number {
    if (!this.mClosed) return 0.0;

    let area = 0.0;
    const size = this.mPoints.length;

    for (let i = 0, j = size - 1; i < size; ++i) {
      const pi = this.mPoints[i] as Vec2;
      const pj = this.mPoints[j] as Vec2;
      area += (pj.x + pi.x) * (pj.y - pi.y);
      j = i;
    }

    return aAbsolute ? Math.abs(area * 0.5) : -area * 0.5;
  }

  /** `SetPoint`: negative indices count back from the end. */
  setPoint(aIndex: number, aPos: Vec2): void {
    const i = aIndex < 0 ? this.mPoints.length + aIndex : aIndex;

    if (i < 0 || i >= this.mPoints.length) return;

    this.mPoints[i] = { x: aPos.x, y: aPos.y };
  }

  /**
   * `ShapeCount()` (`shape_line_chain.cpp:1269-1281`): how many *shapes* — a
   * segment run or a whole arc counting as one — the chain is made of.
   *
   * This is the quantity `mergeHead` thresholds on, and it is **not** the
   * segment count: an arc of forty polyline segments is one shape. Fewer than
   * two points is zero shapes, not one.
   */
  shapeCount(): number {
    if (this.mPoints.length < 2) return 0;

    let numShapes = 1;

    for (let i = this.nextShape(0); i !== -1; i = this.nextShape(i)) numShapes++;

    return numShapes;
  }

  /**
   * `EdgeContainingPoint( aPt, aAccuracy )` (`shape_line_chain.cpp:2080-...`):
   * the index of the segment the point lies on, or -1.
   *
   * The threshold is `aAccuracy + 1`, not `aAccuracy` — a point exactly on the
   * edge of an exactly-zero-accuracy query still counts.
   */
  edgeContainingPoint(aPt: Vec2, aAccuracy = 0): number {
    const threshold = aAccuracy + 1;
    const thresholdSq = threshold * threshold;

    if (this.mPoints.length === 0) return -1;

    if (this.mPoints.length === 1) {
      const p = this.mPoints[0] as Vec2;
      const dSq = (p.x - aPt.x) ** 2 + (p.y - aPt.y) ** 2;
      return dSq <= thresholdSq ? 0 : -1;
    }

    for (let i = 0; i < this.segmentCount(); i++) {
      if (segSquaredDistanceToPointExact(this.cSegment(i), aPt) <= thresholdSq) return i;
    }

    return -1;
  }

  /** `PointOnEdge`. */
  pointOnEdge(aPt: Vec2, aAccuracy = 0): boolean {
    return this.edgeContainingPoint(aPt, aAccuracy) >= 0;
  }

  /**
   * `RemoveShape( aPointIndex )` (`shape_line_chain.cpp:1380-1409`): remove the
   * whole shape this point belongs to — one point if it is a plain vertex, the
   * entire arc if it is on one.
   *
   * `handlePullback` calls this with -1 rather than `Remove(-1, -1)` precisely
   * so that pulling back over an arc drops the arc rather than one of its
   * polyline vertices.
   */
  removeShape(aPointIndex: number): void {
    let idx = aPointIndex;

    if (idx < 0) idx += this.pointCount();
    if (idx >= this.pointCount() || idx < 0) return;

    if (!this.isPtOnArc(idx)) {
      this.remove(idx, idx);
      return;
    }

    let start = idx;
    let end = idx;
    const arcIdx = this.arcIndex(idx);

    if (!this.isArcStart(start)) {
      while (start > 0 && this.arcIndex(start - 1) === arcIdx) start--;
    }

    const isArcEnd = this.isPtOnArc(end) && !this.isArcSegment(end);

    if (!isArcEnd || start === end) {
      const next = this.nextShape(end);
      end = next === -1 ? this.pointCount() - 1 : next;
    }

    this.remove(start, end);
  }

  // `Replace` and `Remove` are ported in full above, both overloads, with the
  // arc bookkeeping upstream maintains. A second narrower spelling landed here
  // independently; main's is kept.

  /**
   * `Split( aP, aExact = false )` (`shape_line_chain.cpp:1181-1236`): insert
   * `aP` as a vertex and return its index, or -1 if it is nowhere near the
   * chain.
   *
   * `min_dist` starts at **2**, so the point must be within 1 IU of a segment —
   * this is a snap onto an existing edge, not a projection. And a candidate
   * segment is rejected when `aP` equals either of its ends (`:1195`), with the
   * comment *"make sure we are not producing a 'slightly concave' primitive"*;
   * the already-a-vertex case is then picked up by the `found_index` fallback,
   * which returns that vertex's index without inserting anything.
   */
  split(aP: Vec2, aExact = false): number {
    let ii = -1;
    let minDist = 2;

    const foundIndex = this.find(aP);

    if (foundIndex >= 0 && aExact) return foundIndex;

    for (let s = 0; s < this.segmentCount(); s++) {
      const seg = this.cSegment(s);
      // `seg.Distance( aP )` (`shape_line_chain.cpp:1198`), which is
      // `isqrt( SquaredDistance )` and therefore **floors**. Rounding instead
      // pushes a point 1.74 IU off a segment to 2, which fails `dist < 2` and
      // silently declines a split KiCad performs.
      const dist = segDistanceToPoint(seg, aP);

      if (
        dist < minDist &&
        !(seg.a.x === aP.x && seg.a.y === aP.y) &&
        !(seg.b.x === aP.x && seg.b.y === aP.y)
      ) {
        minDist = dist;

        if (foundIndex < 0) ii = s;
        else if (s < foundIndex) ii = s;
      }
    }

    if (ii < 0) ii = foundIndex;

    if (ii >= 0) {
      const at = this.mPoints[ii];

      // Don't create duplicate points.
      if (at !== undefined && at.x === aP.x && at.y === aP.y) return ii;

      const newIndex = ii + 1;

      // Splitting inside an arc is upstream's `splitArc` path, which is not
      // ported; the point is inserted as a plain vertex instead.
      this.insertPoint(newIndex, aP);

      return newIndex;
    }

    return -1;
  }

  /**
   * `Intersect( const SHAPE_LINE_CHAIN& aChain, INTERSECTIONS& aIp )`
   * (`shape_line_chain.cpp:1802-1948`), the non-collinear arm plus the
   * collinear-overlap arm.
   *
   * `index_our` is a *segment* index that is incremented to a *point* index when
   * the hit lands on that segment's B end — the two index spaces are mixed on
   * purpose, and `handleSelfIntersections` reads the result as a point index
   * when it clips the tail.
   */
  intersect(aChain: PnsLineChain, aExcludeColinearAndTouching = false): ChainIntersection[] {
    const out: ChainIntersection[] = [];
    const ourSegCount = this.segmentCount();
    const theirSegCount = aChain.segmentCount();

    if (ourSegCount === 0 || theirSegCount === 0) return out;

    for (let s1 = 0; s1 < ourSegCount; s1++) {
      const a = this.cSegment(s1);

      for (let s2 = 0; s2 < theirSegCount; s2++) {
        const b = aChain.cSegment(s2);
        const p = intersectSegs(a, b);
        const base = {
          indexOur: s1,
          indexTheir: s2,
          isCornerOur: false,
          isCornerTheir: false,
        };

        if (!aExcludeColinearAndTouching && segCollinear(a.a, a.b, b.a, b.b)) {
          if (segContains(a, b.a)) out.push({ ...base, p: { ...b.a }, isCornerTheir: true });
          if (segContains(a, b.b))
            out.push({ ...base, p: { ...b.b }, indexTheir: s2 + 1, isCornerTheir: true });
          if (segContains(b, a.a)) out.push({ ...base, p: { ...a.a }, isCornerOur: true });
          if (segContains(b, a.b))
            out.push({ ...base, p: { ...a.b }, indexOur: s1 + 1, isCornerOur: true });
        } else if (p) {
          const is: ChainIntersection = { ...base, p };

          if (p.x === a.a.x && p.y === a.a.y) is.isCornerOur = true;
          if (p.x === a.b.x && p.y === a.b.y) {
            is.isCornerOur = true;
            is.indexOur = s1 + 1;
          }
          if (p.x === b.a.x && p.y === b.a.y) is.isCornerTheir = true;
          if (p.x === b.b.x && p.y === b.b.y) {
            is.isCornerTheir = true;
            is.indexTheir = s2 + 1;
          }

          out.push(is);
        }
      }
    }

    return out;
  }
}

/** `SHAPE_LINE_CHAIN::INTERSECTION` (`shape_line_chain.h:86-110`). */
export interface ChainIntersection {
  p: Vec2;
  indexOur: number;
  indexTheir: number;
  isCornerOur: boolean;
  isCornerTheir: boolean;
}

/** `SEG::LineDistance`: distance from `p` to the infinite line through a-b. */
function segLineDistance(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return EuclideanNormI({ x: p.x - a.x, y: p.y - a.y });

  return Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
}

/** `SEG::Collinear`: both endpoints of the second segment on the first's line. */
function segCollinear(a1: Vec2, b1: Vec2, a2: Vec2, b2: Vec2): boolean {
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;

  const c1 = dx * (a2.y - a1.y) - dy * (a2.x - a1.x);
  const c2 = dx * (b2.y - a1.y) - dy * (b2.x - a1.x);

  return c1 === 0 && c2 === 0;
}

/** The point on segment a-b nearest `p`. */
function nearestOnSegment(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;

  if (len2 === 0) return { x: a.x, y: a.y };

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  return { x: Math.round(a.x + dx * t), y: Math.round(a.y + dy * t) };
}

/** `SEG::Distance`. */
function segDistance(a: Vec2, b: Vec2, p: Vec2): number {
  const n = nearestOnSegment(a, b, p);

  return EuclideanNormI({ x: p.x - n.x, y: p.y - n.y });
}

/** `TestSegmentHit`: is `p` within `tolerance` of the segment a-b? */
function testSegmentHit(p: Vec2, a: Vec2, b: Vec2, tolerance: number): boolean {
  return segDistance(a, b, p) <= tolerance;
}

/** `SEG::Intersect`, proper crossings only. */
function segIntersect(a1: Vec2, b1: Vec2, a2: Vec2, b2: Vec2): Vec2 | null {
  const d1x = b1.x - a1.x;
  const d1y = b1.y - a1.y;
  const d2x = b2.x - a2.x;
  const d2y = b2.y - a2.y;

  const denom = d1x * d2y - d1y * d2x;

  if (denom === 0) return null;

  const ex = a2.x - a1.x;
  const ey = a2.y - a1.y;

  const t = (ex * d2y - ey * d2x) / denom;
  const u = (ex * d1y - ey * d1x) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return { x: Math.round(a1.x + d1x * t), y: Math.round(a1.y + d1y * t) };
}

/**
 * `LINE`: a track connecting two non-trivial joints, assembled on the fly from
 * whatever the node holds rather than stored in it.
 *
 * Ported to the extent `NODE`'s add/remove/replace and line-assembly paths
 * need. Not here, and belonging to the PRs that need them: `Walkaround`,
 * `CountCorners`, `Rank` propagation to links, the blocking-obstacle
 * bookkeeping, and the drag entry points — the last of which already exist as
 * free functions in `pns_line.ts`.
 */
export class PnsLine extends PnsLinkHolder {
  private mLine = new PnsLineChain();
  private mWidth = 1; // Dummy value, as upstream's default constructor
  private mVia: PnsVia | null = null;
  private mSnapThreshhold = 0;

  constructor() {
    super(PnsKind.LINE_T);
  }

  static classOf(aItem: PnsItem | null): boolean {
    return aItem !== null && aItem.kind() === PnsKind.LINE_T;
  }

  /**
   * `LINE( const LINE& aBase, const SHAPE_LINE_CHAIN& aLine )`: keep a base
   * line's properties, take a new shape. Note the via is *not* carried over and
   * the links are — `LINK_HOLDER`'s copy constructor shares the parent's list.
   */
  static fromBase(aBase: PnsLine, aLine: PnsLineChain): PnsLine {
    const l = new PnsLine();
    l.copyLinks(aBase);
    l.mLine = aLine;
    l.mWidth = aBase.mWidth;
    l.mSnapThreshhold = aBase.mSnapThreshhold;
    l.setNet(aBase.net());
    l.setLayers(aBase.layers());
    l.mVia = null;
    return l;
  }

  /** `LINE::Clone()`. */
  clone(): PnsLine {
    const l = new PnsLine();
    l.copyFrom(this);
    l.copyLinks(this);
    l.mLine = this.mLine.clone();
    l.mWidth = this.mWidth;
    l.mSnapThreshhold = this.mSnapThreshhold;
    l.mVia = this.mVia;
    return l;
  }

  /** The mutable chain, as upstream's `Line()` hands back a reference. */
  line(): PnsLineChain {
    return this.mLine;
  }

  cLine(): PnsLineChain {
    return this.mLine;
  }

  setShape(aLine: PnsLineChain): void {
    this.mLine = aLine;
  }

  pointCount(): number {
    return this.mLine.pointCount();
  }

  segmentCount(): number {
    return this.mLine.segmentCount();
  }

  cPoint(aIndex: number): Vec2 {
    return this.mLine.cPoint(aIndex);
  }

  cLastPoint(): Vec2 {
    return this.mLine.cLastPoint();
  }

  /** `LINE::Reverse()`: the chain and the link list both turn round. */
  reverse(): void {
    this.mLine = this.mLine.reverse();
    this.mLinks.reverse();
  }

  /**
   * `LINE::ClipVertexRange( aStart, aEnd )`: keep the vertices between two
   * indices, and the links that span them.
   *
   * The link bookkeeping is the whole difficulty. The chain is walked one
   * *shape* at a time — `nextShape`, so an arc counts once however many points
   * represent it — and the walk records which link index is current when the
   * walk passes `aStart`, and which when it reaches `aEnd - 1` or runs out of
   * links. The surviving links are then rotated to the front and the list
   * truncated.
   *
   * Upstream's own comment says the range is only ever chosen from joints, so a
   * clip never lands inside an arc; {@link PnsLineChain.slice} throws if one
   * ever does rather than silently producing a mangled arc.
   *
   * Note the walk starts at vertex **0**, not at `aStart`, and the loop
   * condition already rejects `i < 0` — so the `i < 0` disjunct inside the body
   * is dead. Both are upstream's and both are kept.
   *
   * ### Upstream bug: the rotate is one short, so clipping off the front
   * ### produces the wrong links
   *
   * `pns_line.cpp:1457-1461` is
   * `std::rotate( begin, begin + firstLink, begin + lastLink )` followed by
   * `resize( lastLink - firstLink + 1 )`. The rotate's *last* iterator should
   * be `begin + lastLink + 1` (or just `end()`): as written, the element at
   * index `lastLink` never takes part in the rotation, so it is not brought
   * into the kept prefix.
   *
   * With `firstLink === 0` — every caller that clips from the line's start —
   * the rotate is a no-op and the result is right, which is why this survives.
   * With `firstLink > 0` it is wrong: clipping a four-link line to vertices
   * 1..3 keeps `[links[1], links[0]]` where the segments between those
   * vertices are `links[1]` and `links[2]`. The clipped line's chain is
   * correct and its `links()` are not.
   *
   * `NODE::FindLinesBetweenJoints` is the caller that reaches it, so a loop
   * removal that starts mid-line reads a link list that includes a segment
   * outside the clip and misses one inside it. Reproduced exactly, pinned by a
   * test, and **not** corrected: the router's behaviour on those boards is what
   * this port has to match.
   */
  clipVertexRange(aStart: number, aEnd: number): void {
    let firstLink = 0;
    let lastLink = Math.max(0, this.mLinks.length - 1);
    let linkIdx = 0;

    for (let i = 0; i >= 0 && i < this.mLine.pointCount(); i = this.mLine.nextShape(i)) {
      if (i <= aStart) firstLink = linkIdx;

      if (i < 0 || i >= aEnd - 1 || linkIdx >= lastLink) {
        lastLink = linkIdx;
        break;
      }

      linkIdx++;
    }

    this.mLine = this.mLine.slice(aStart, aEnd);

    if (this.isLinked()) {
      // Note: the range includes aEnd, but we have n-1 segments.
      const rotated = [
        ...this.mLinks.slice(firstLink, lastLink),
        ...this.mLinks.slice(0, firstLink),
        ...this.mLinks.slice(lastLink),
      ];

      this.mLinks = rotated.slice(0, lastLink - firstLink + 1);
    }
  }

  /** `LINE::Width()`. `LINK_HOLDER` has none to override; `LINKED_ITEM` does. */
  width(): number {
    return this.mWidth;
  }

  setWidth(aWidth: number): void {
    this.mWidth = aWidth;
  }

  snapThreshhold(): number {
    return this.mSnapThreshhold;
  }

  setSnapThreshhold(aThreshold: number): void {
    this.mSnapThreshhold = aThreshold;
  }

  /** A LINE has no shape of its own that the index would take. */
  override shape(_aLayer: number): null {
    return null;
  }

  /**
   * `LINE::Shape()`: `return &m_line;` — the chain the line is drawn on.
   *
   * Upstream that is one `SHAPE_LINE_CHAIN*` and `ITEM::collideSimple` hands it
   * straight to `SHAPE::Collide`. This repo's `Shape` union has no open
   * polyline, so the chain arrives as the list of primitives it is made of; see
   * {@link PnsItem.shapes}. `shape()` still answers null, exactly as before,
   * because that is what the spatial index reads and upstream does not index a
   * LINE either.
   *
   * **Zero width, and that is not an oversight.** `collideSimple` computes
   * `lineWidthI`/`lineWidthH` from `LINE::Width()` and adds them to the
   * clearance, because — its own comment — *"collision routines ignore polyline
   * widths, so we have to pass them in as part of the clearance value"*. Giving
   * these primitives `r = width / 2` as well would count the width twice.
   *
   * **Arcs are emitted as arcs, and their polyline stand-ins are skipped.**
   * That is upstream's split too: `Collide( SHAPE_LINE_CHAIN_BASE&,
   * SHAPE_LINE_CHAIN_BASE& )` walks the segments with `IsArcSegment( i )`
   * segments filtered out, then collides each `Arc( j )` against the other
   * shape whole. Measuring the approximation *and* the true curve would report
   * the approximation's error as geometry.
   *
   * The skip is not pinned and a mutant that deletes it survives, by
   * construction: the stand-in is a run of chords *inside* the curve, so
   * measuring it as well can only shorten a distance by up to `ARC_HIGH_DEF`.
   * It changes how many primitives are measured, not the verdict.
   */
  override shapes(_aLayer: number): readonly Shape[] {
    const out: Shape[] = [];

    for (let i = 0; i < this.mLine.segmentCount(); i++) {
      if (this.mLine.isArcSegment(i)) continue;

      const s = this.mLine.cSegment(i);

      out.push({ kind: 'stadium', a: s.a, b: s.b, r: 0 });
    }

    for (let i = 0; i < this.mLine.arcCount(); i++) {
      const a = this.mLine.arc(i);

      out.push(arcShape(a.p0, a.arcMid, a.p1, 0));
    }

    return out;
  }

  // ----- the via at the end -----------------------------------------------------

  appendVia(aVia: PnsVia): void {
    this.mVia = aVia;
  }

  removeVia(): void {
    this.mVia = null;
  }

  via(): PnsVia {
    if (!this.mVia) throw new Error('PNS: LINE::Via() with no via attached');

    return this.mVia;
  }

  endsWithVia(): boolean {
    return this.mVia !== null;
  }

  // ----- added for LINE_PLACER (pns_line_placer.ts) -----------------------------

  /**
   * `LINE::Clear()` (`pns_line.cpp:1589-1594`): links, via, points — in that
   * order, and **all three**.
   *
   * `splitHeadTail` leans on the fact that this leaves the width, layers and net
   * alone: it builds the new head as a copy of the *old tail* and then clears
   * it, precisely so the head inherits those three attributes from the tail
   * rather than from the walked line it is about to be given.
   */
  clear(): void {
    this.clearLinks();
    this.removeVia();
    this.mLine.clear();
  }

  /**
   * `LINE::CountCorners( aAngles )` (`pns_line.cpp:218-237`): how many corners
   * of this line form one of the angle types in the mask.
   *
   * `mergeHead` uses it as a veto — a head containing any acute, 180° or
   * undefined corner is never promoted into the tail, because such a corner
   * cannot be routed and would be frozen in place by the promotion.
   *
   * Arcs are not special-cased here, upstream included: the polyline segments
   * standing in for an arc are compared like any others, so a polygonised arc
   * contributes a run of obtuse corners.
   */
  countCorners(aAngles: number): number {
    let count = 0;

    for (let i = 0; i < this.mLine.segmentCount() - 1; i++) {
      const seg1 = this.mLine.cSegment(i);
      const seg2 = this.mLine.cSegment(i + 1);

      const dir1 = Direction45.fromSeg(seg1.a, seg1.b);
      const dir2 = Direction45.fromSeg(seg2.a, seg2.b);

      if (dir1.angle(dir2) & aAngles) count++;
    }

    return count;
  }

  // ----- the LINE surface SHOVE needs ---------------------------------------------

  /**
   * `LINE::LinkVia( VIA* )`: attach a via *and* link it as a constituent item.
   *
   * The reversal is the part that matters. A line's via is by convention at its
   * **end**, and every consumer — `SHOVE::pushOrShoveVia`'s `segIndex == 0`
   * normalisation, `replaceLine`'s via unlink, `unwindLineStack`'s tadpole
   * branch — is written against that. So if the via turns out to sit on the
   * line's *first* point, the whole line is turned round first. The
   * `PointCount() > 1` guard means a one-point line is left alone: there is no
   * "other end" to move the via to.
   */
  linkVia(aVia: PnsVia): void {
    if (this.mLine.pointCount() > 1) {
      const p0 = this.mLine.cPoint(0);
      const vp = aVia.pos();

      if (vp.x === p0.x && vp.y === p0.y) this.reverse();
    }

    this.mVia = aVia;
    this.link(aVia);
  }

  /**
   * `LINE::Mark`: the line's own marker *and* every link's are set to `aMarker`
   * — assignment, not an OR.
   */
  override mark(aMarker: number): void {
    super.mark(aMarker);

    for (const s of this.mLinks) s.mark(aMarker);
  }

  /**
   * `LINE::Unmark`: clear the given bits on every link, then zero the line's own
   * marker outright. Note the asymmetry with `ITEM::Unmark` — the links get
   * `&= ~aMarker`, the line gets `= 0` regardless of `aMarker`. Upstream's.
   */
  override unmark(aMarker = -1): void {
    for (const s of this.mLinks) s.unmark(aMarker);

    super.mark(0);
  }

  /** `LINE::Marker`: the line's own bits OR-ed with every link's. */
  override marker(): number {
    let m = super.marker();

    for (const s of this.mLinks) m |= s.marker();

    return m;
  }

  /** `LINE::SetRank`: written through to every link as well as to the line. */
  override setRank(aRank: number): void {
    super.setRank(aRank);

    for (const s of this.mLinks) s.setRank(aRank);
  }

  /**
   * `LINE::Rank`: the **minimum** rank over the links when the line is linked,
   * the line's own field when it is not, and `-1` when the minimum came out as
   * `INT_MAX` (an empty link list, which `IsLinked()` has already excluded — so
   * that arm is dead upstream and dead here).
   *
   * The minimum, not the maximum: a line is only as high-ranking as its
   * weakest segment, which is what makes `shoveIteration`'s
   * `ni->Rank() > currentLine.Rank()` test conservative about calling something
   * a reverse collision.
   */
  override rank(): number {
    let minRank = Number.MAX_SAFE_INTEGER;

    if (this.isLinked()) {
      for (const item of this.mLinks) minRank = Math.min(minRank, item.rank());
    } else {
      minRank = super.rank();
    }

    return minRank === Number.MAX_SAFE_INTEGER ? -1 : minRank;
  }

  /** `LINE::HasLoops`: any two points at least two apart that coincide. */
  hasLoops(): boolean {
    for (let i = 0; i < this.pointCount(); i++) {
      for (let j = i + 2; j < this.pointCount(); j++) {
        const a = this.cPoint(i);
        const b = this.cPoint(j);

        if (a.x === b.x && a.y === b.y) return true;
      }
    }

    return false;
  }

  /** `LINE::HasLockedSegments`: any link carrying `MK_LOCKED`. */
  hasLockedSegments(): boolean {
    for (const seg of this.mLinks) {
      if (seg.marker() & LineMarker.MK_LOCKED) return true;
    }

    return false;
  }

  /** `LINE::CompareGeometry`, delegating to the chain. */
  compareGeometry(aOther: PnsLine): boolean {
    return this.mLine.compareGeometry(aOther.mLine);
  }
}
