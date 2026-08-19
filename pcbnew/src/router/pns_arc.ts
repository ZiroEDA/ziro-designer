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
import {
  circleToEndSegmentDeltaRadius,
  getArcToSegmentCount,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { segDistanceToPoint } from '@ziroeda/kimath/src/geometry/seg.js';
import { arcShape } from '../drc/drc_engine.js';
import { ARC_HIGH_DEF } from '../graphics_cleaner.js';
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

/** `SHAPE_ARC::Reversed()`: the same curve, walked the other way. */
export const reversedArc = (a: ShapeArc): ShapeArc => ({
  p0: { ...a.p1 },
  arcMid: { ...a.arcMid },
  p1: { ...a.p0 },
  width: a.width,
});

/**
 * `SHAPE_ARC::ConvertToPolyline` — `libs/kimath/src/geometry/shape_arc.cpp:1003-1064`.
 *
 * The one piece of `SHAPE_ARC` that `NODE::AssembleLine` cannot do without:
 * appending an arc to a chain means appending the points it polygonizes to.
 *
 * Three details that are easy to lose and that change every vertex:
 *
 *  - The segment count comes from the **external** radius, `r + width/2`, not
 *    from the radius. For a fat arc of small radius those differ a lot.
 *  - The radius the interior points are placed at is then grown by *half* the
 *    effective error, so the polyline straddles the true arc rather than
 *    sitting inside it — while the first and last points are the arc's own
 *    endpoints, untouched, which is what makes the end segments shorter.
 *  - The loop steps `i += 2` over `n = 2 × segments`, so it samples the
 *    *midpoint* of each segment's angular span.
 *
 * `if( n != 0 )` inside the loop is dead — `n === 0` means the body never runs
 * — and is kept.
 *
 * A degenerate arc (three collinear points, so there is no centre) has no
 * upstream counterpart: `GetCenter` divides by zero there. This port's
 * `arcShape` reports a stadium instead, and the polyline is then the two
 * endpoints, which is what the `n = 0` path would have produced anyway.
 */
export function convertArcToPolyline(aArc: ShapeArc, aMaxError = ARC_HIGH_DEF): Vec2[] {
  const g = arcShape(aArc.p0, aArc.arcMid, aArc.p1, aArc.width);

  if (g.kind !== 'arc') return [{ ...aArc.p0 }, { ...aArc.p1 }];

  let r = g.rad;
  const sa = g.a0;
  const c = { x: KiROUND(g.c.x), y: KiROUND(g.c.y) };
  const ca = g.sweep;
  const caDeg = (ca * 180) / Math.PI;
  const halfMaxError = Math.max(1.0, aMaxError / 2.0);

  let n: number;

  // To calculate the arc to segment count, use the external radius instead of
  // the radius: for an arc with small radius and large width the difference can
  // be significant.
  const externalRadius = r + aArc.width / 2.0;
  let effectiveError: number;

  if (
    externalRadius < halfMaxError ||
    segDistanceToPoint({ a: aArc.p0, b: aArc.p1 }, aArc.arcMid) < halfMaxError // Should be a very rare case
  ) {
    // In this case the arc is approximated by one segment, with an effective
    // error between -aMaxError/2 and +aMaxError/2, as expected.
    n = 0;
    effectiveError = externalRadius;
  } else {
    n = getArcToSegmentCount(externalRadius, aMaxError, caDeg);

    // Recalculate the effective error of approximation, which can be < aMaxError.
    const seg360 = Math.trunc((n * 360.0) / Math.abs(caDeg));
    effectiveError = circleToEndSegmentDeltaRadius(externalRadius, seg360);
  }

  // Split the error on either side of the arc. Since we want the start and end
  // points to be exactly on the arc, the first and last segments need to be
  // shorter to stay within the error band.
  r += effectiveError / 2;
  n = n * 2;

  const rv: Vec2[] = [{ ...aArc.p0 }];

  for (let i = 1; i < n; i += 2) {
    let a = sa;

    if (n !== 0) a += (ca * i) / n;

    rv.push({ x: KiROUND(c.x + r * Math.cos(a)), y: KiROUND(c.y + r * Math.sin(a)) });
  }

  rv.push({ ...aArc.p1 });

  return rv;
}

/** `SHAPE_ARC::GetLength()`: the radius times the swept angle. */
export const arcLength = (a: ShapeArc): number => {
  const g = arcShape(a.p0, a.arcMid, a.p1, a.width);

  if (g.kind !== 'arc') return Math.hypot(a.p1.x - a.p0.x, a.p1.y - a.p0.y);

  return Math.abs(g.rad * g.sweep);
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
