// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One straight piece of track.
 * Counterparts: `pcbnew/router/pns_segment.h` and `pns_segment.cpp` (`SEGMENT`).
 *
 * The router's atom. A `LINE` is a view assembled by walking joints; what the
 * node actually stores, indexes and links is segments, one per straight run.
 * Its two anchors are its endpoints, and `NODE::addSegment` links a joint at
 * each — which is the entire mechanism by which tracks become a connected graph.
 *
 * Its shape is a stadium: the segment swept by a disc of half its width. That is
 * `SHAPE_SEGMENT` exactly, including the integer halving — a 3-unit-wide track
 * gets a radius of 1, not 1.5, because upstream's `GetWidth() / 2` is integer
 * division and every clearance computed from it inherits the truncation.
 */
import { PnsKind, PnsLinkedItem, type PnsItem } from './pns_item.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { Chain, Seg } from './pns_line.js';
import type { NetHandle } from './pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `SHAPE_SEGMENT`: a segment plus the width it is stroked with. */
export interface ShapeSegment {
  seg: Seg;
  width: number;
}

const copySeg = (s: Seg): Seg => ({ a: { ...s.a }, b: { ...s.b } });

/** `SEGMENT`. */
export class PnsSegment extends PnsLinkedItem {
  private mSeg: ShapeSegment = { seg: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }, width: 0 };

  /**
   * `SEGMENT( const SEG&, NET_HANDLE )` — a zero-width segment on a net — and
   * `SEGMENT( const SHAPE_SEGMENT&, NET_HANDLE )` when a width is given.
   *
   * The two `LINE`-derived constructors upstream also has are absent: `LINE` is
   * not ported yet. When it lands they add nothing new here beyond copying the
   * parent line's net, layers, marker and rank across.
   */
  constructor(aSeg?: Seg | ShapeSegment, aNet: NetHandle = null) {
    super(PnsKind.SEGMENT_T);

    if (aSeg) {
      this.mSeg =
        'width' in aSeg
          ? { seg: copySeg(aSeg.seg), width: aSeg.width }
          : { seg: copySeg(aSeg), width: 0 };
      this.mNet = aNet;
    }
  }

  static classOf(aItem: PnsItem | null): boolean {
    return aItem !== null && aItem.kind() === PnsKind.SEGMENT_T;
  }

  clone(): PnsSegment {
    const s = new PnsSegment();
    s.copyFrom(this);
    s.mSeg = { seg: copySeg(this.mSeg.seg), width: this.mSeg.width };
    s.mUid = this.mUid;
    return s;
  }

  /** The stadium `SHAPE_SEGMENT` collides as, with upstream's integer halving. */
  override shape(_aLayer: number): Shape | null {
    return {
      kind: 'stadium',
      a: this.mSeg.seg.a,
      b: this.mSeg.seg.b,
      r: Math.trunc(this.mSeg.width / 2),
    };
  }

  override setWidth(aWidth: number): void {
    this.mSeg = { ...this.mSeg, width: aWidth };
  }

  override width(): number {
    return this.mSeg.width;
  }

  seg(): Seg {
    return this.mSeg.seg;
  }

  /** `CLine()`: the two-point chain the segment spans. */
  cLine(): Chain {
    return [{ ...this.mSeg.seg.a }, { ...this.mSeg.seg.b }];
  }

  setEnds(a: Vec2, b: Vec2): void {
    this.mSeg = { ...this.mSeg, seg: { a: { ...a }, b: { ...b } } };
  }

  swapEnds(): void {
    const { a, b } = this.mSeg.seg;
    this.mSeg = { ...this.mSeg, seg: { a: { ...b }, b: { ...a } } };
  }

  /** Anchor 0 is the A end; *any* other index is the B end, as upstream. */
  override anchor(n: number): Vec2 {
    return n === 0 ? this.mSeg.seg.a : this.mSeg.seg.b;
  }

  override anchorCount(): number {
    return 2;
  }

  setShape(aShape: ShapeSegment): void {
    this.mSeg = { seg: copySeg(aShape.seg), width: aShape.width };
  }
}
