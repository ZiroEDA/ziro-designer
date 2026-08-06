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
 * points alone. What is **not** ported is `SHAPE_ARC::ConvertToPolyline`: turning
 * an arc into points is a `libs/kimath` job this repo has not done, so
 * {@link PnsLineChain.appendArc} takes the polyline as an argument instead of
 * computing it. Everything downstream of that — how the arc is filed, which
 * segments then report as arc segments, how a shared endpoint is folded into the
 * previous point — is upstream's `Append( const SHAPE_LINE_CHAIN& )` verbatim.
 *
 * Closed chains are not modelled: `SegmentCount`, `IsArcSegment` and
 * `mergeFirstLastPointIfNeeded` all branch on `m_closed`, and no line the router
 * hands to a node is closed. The branches are noted at their sites rather than
 * written.
 */
import { PnsKind, PnsLinkHolder, type PnsItem } from './pns_item.js';
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

  /** A chain over a copy of the given points, none of them on an arc. */
  static fromPoints(aPoints: readonly Vec2[]): PnsLineChain {
    const c = new PnsLineChain();

    for (const p of aPoints) c.appendPoint(p);

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

  /** `Append( const VECTOR2I& )`. */
  appendPoint(aPoint: Vec2): void {
    this.mPoints.push({ x: aPoint.x, y: aPoint.y });
    this.mShapes.push(shapesArePt());
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
}

/**
 * `LINE`: a track connecting two non-trivial joints, assembled on the fly from
 * whatever the node holds rather than stored in it.
 *
 * Ported to the extent `NODE`'s add/remove/replace paths need. Not here, and
 * belonging to the PRs that need them: `Walkaround`, `ClipVertexRange`,
 * `Reverse`, `CountCorners`, `Rank` propagation to links, the blocking-obstacle
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
