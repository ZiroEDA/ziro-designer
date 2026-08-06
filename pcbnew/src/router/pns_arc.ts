// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One curved piece of track.
 * Counterparts: `pcbnew/router/pns_arc.h` and `pns_arc.cpp` (`ARC`).
 *
 * A segment that bends. It is a `LINKED_ITEM` like `SEGMENT`, joints link to
 * both of its ends the same way, and `JOINT` counts arcs and segments together
 * in every one of its predicates — a corner between an arc and a segment of the
 * same width is as trivial as one between two segments.
 *
 * The arc is stored the way `SHAPE_ARC` stores it and the way the board file
 * writes it: start, a point on the curve, end. Centre and radius are derived,
 * not kept, so the three points remain the truth and rounding never accumulates
 * into a curve that no longer passes through its own endpoints.
 *
 * ## `Clone()` does not preserve the uid, and `SEGMENT::Clone()` does
 *
 * Upstream's `SEGMENT::Clone` copy-constructs, which carries `LINKED_ITEM`'s
 * `m_uid` across; `ARC::Clone` builds a fresh `ARC` and then assigns seven
 * fields by hand, and the uid is not among them, so a cloned arc gets a *new*
 * one. That asymmetry is not obviously intentional, but it is what the router
 * runs on, and code that matches a branch's items back to the root's by uid
 * behaves differently for the two. Reproduced deliberately.
 */
import { arcShape } from '../drc/drc_engine.js';
import { PnsKind, PnsLinkedItem, type PnsItem } from './pns_item.js';
import type { PnsLine } from './pns_line_item.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { NetHandle } from './pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `SHAPE_ARC`: three points on the curve, plus the width it is stroked with. */
export interface ShapeArc {
  p0: Vec2;
  arcMid: Vec2;
  p1: Vec2;
  width: number;
}

const copyArc = (a: ShapeArc): ShapeArc => ({
  p0: { ...a.p0 },
  arcMid: { ...a.arcMid },
  p1: { ...a.p1 },
  width: a.width,
});

const ZERO_ARC: ShapeArc = {
  p0: { x: 0, y: 0 },
  arcMid: { x: 0, y: 0 },
  p1: { x: 0, y: 0 },
  width: 0,
};

/** `ARC`. */
export class PnsArc extends PnsLinkedItem {
  private mArc: ShapeArc = ZERO_ARC;

  constructor(aArc?: ShapeArc, aNet: NetHandle = null) {
    super(PnsKind.ARC_T);

    if (aArc) {
      this.mArc = copyArc(aArc);
      this.mNet = aNet;
    }
  }

  /**
   * `ARC( const ARC& aParentArc, const SHAPE_ARC& aArc )`: a new arc geometry
   * carrying a parent arc's net, layers, marker and rank.
   */
  static fromParentArc(aParentArc: PnsArc, aArc: ShapeArc): PnsArc {
    const a = new PnsArc(aArc, aParentArc.net());
    a.setLayers(aParentArc.layers());
    a.mark(aParentArc.marker());
    a.setRank(aParentArc.rank());
    return a;
  }

  /**
   * `ARC( const LINE& aParentLine, const SHAPE_ARC& aArc )`: one curved piece of
   * a line. The arc geometry is rebuilt from the three points with the *line's*
   * width, discarding whatever width the chain's stored copy had — the chain
   * zeroes it, and the stroke belongs to the line.
   *
   * Unlike `SEGMENT`'s equivalent, neither the parent nor the source item is
   * touched. Upstream's asymmetry, kept.
   */
  static fromParentLine(aParentLine: PnsLine, aArc: ShapeArc): PnsArc {
    const a = new PnsArc(
      { p0: aArc.p0, arcMid: aArc.arcMid, p1: aArc.p1, width: aParentLine.width() },
      aParentLine.net(),
    );

    a.setLayers(aParentLine.layers());
    a.mark(aParentLine.marker());
    a.setRank(aParentLine.rank());

    return a;
  }

  static classOf(aItem: PnsItem | null): boolean {
    return aItem !== null && aItem.kind() === PnsKind.ARC_T;
  }

  /** Note: the uid is *not* carried over. See the module docblock. */
  clone(): PnsArc {
    const a = new PnsArc(this.mArc, this.mNet);

    a.mParent = this.mParent;
    a.mSourceItem = this.mSourceItem;
    a.mMovable = this.mMovable;
    a.setLayers(this.mLayers);
    a.mMarker = this.mMarker;
    a.mRank = this.mRank;
    a.mRoutable = this.mRoutable;

    return a;
  }

  /**
   * The stroked arc, as the DRC geometry models it.
   *
   * The width is halved with truncation before being handed over, because every
   * upstream use of `SHAPE_ARC::GetWidth()` in a collision or a bounding box is
   * `GetWidth() / 2` in integer arithmetic. Doubling the truncated half back up
   * is how that truncation is forced through a helper that halves in floating
   * point.
   */
  override shape(_aLayer: number): Shape | null {
    return arcShape(
      this.mArc.p0,
      this.mArc.arcMid,
      this.mArc.p1,
      2 * Math.trunc(this.mArc.width / 2),
    );
  }

  override setWidth(aWidth: number): void {
    this.mArc = { ...this.mArc, width: aWidth };
  }

  override width(): number {
    return this.mArc.width;
  }

  /** Anchor 0 is the start; *any* other index is the end, as upstream. */
  override anchor(n: number): Vec2 {
    return n === 0 ? this.mArc.p0 : this.mArc.p1;
  }

  override anchorCount(): number {
    return 2;
  }

  arc(): ShapeArc {
    return this.mArc;
  }

  cArc(): ShapeArc {
    return this.mArc;
  }

  setArc(aArc: ShapeArc): void {
    this.mArc = copyArc(aArc);
  }
}
