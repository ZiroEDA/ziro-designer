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
import { PnsKind, PnsLinkHolder, type PnsItem } from './pns_item.js';
import { segReflectPoint } from './pns_seg_ops.js';
import { arcLength, convertArcToPolyline, reversedArc } from './pns_arc.js';
import { ARC_HIGH_DEF } from '../graphics_cleaner.js';
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
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
   * ### Disclosed gap: cutting through the middle of an arc
   *
   * Upstream's two arc-*splitting* arms (`shape_line_chain.cpp:1437-1464` and
   * `:1486-1513`) rebuild a partial arc with
   * `SHAPE_ARC::ConstructFromStartEndCenter`, which this repo has not ported
   * and which is a `libs/kimath` job of its own. Both arms throw here.
   *
   * They are reached only when a cut index falls strictly inside an arc, which
   * `LINE::ClipVertexRange` — the only caller in this port — documents as
   * impossible: *"It is assumed that anything calling this method will have
   * determined the vertex range to clip based on joints, meaning we will never
   * clip in the middle of an arc."* Flagged rather than faked.
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
      throw new Error('PNS: SHAPE_LINE_CHAIN::Slice() starting inside an arc is not ported');
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

          throw new Error('PNS: SHAPE_LINE_CHAIN::Slice() ending inside an arc is not ported');
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
   * The one point of `SHAPE_LINE_CHAIN::Remove` that
   * {@link removeDuplicatePoints} reaches.
   *
   * Upstream's `Remove( int, int )` also splits arcs that the range cuts
   * through and renumbers the arc list; that is a `libs/kimath` port of its
   * own, and the only call that gets here is `Remove( 1 )` on a three-point
   * chain whose first two points coincide. A point on an arc therefore throws
   * rather than silently corrupting the shape indices.
   */
  private removeAt(aIndex: number): void {
    if (this.isPtOnArc(aIndex)) {
      throw new Error('PNS: SHAPE_LINE_CHAIN::Remove() of a point on an arc is not ported');
    }

    this.mPoints.splice(aIndex, 1);
    this.mShapes.splice(aIndex, 1);
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
}
