// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `src/geometry/shape_collisions.cpp`: `SHAPE::Collide( const SHAPE* )`, the
 * pairwise collision table over every shape type, and the compound walk.
 *
 * `aMTV` (the minimum translation vector) is written into a mutable
 * `VECTOR2I` when the caller passes one, as the C++ writes through the
 * pointer; where the C++ negates `*aMTV` the point is negated in place.
 */

import { ECOORD_MAX, EuclideanNormI, ResizeI, type VECTOR2I } from '../math/vector2.js';
import { INT_MAX, KiROUND } from '../math/util.js';
import { divideI } from '../math/vector2.js';
import { SEG } from './seg.js';
import {
  type OutInt,
  SHAPE,
  SHAPE_HOOKS,
  SHAPE_LINE_CHAIN_BASE,
  SHAPE_TYPE,
  SHAPE_TYPE_asString,
} from './shape.js';
import { SHAPE_ARC } from './shape_arc.js';
import { SHAPE_CIRCLE } from './shape_circle.js';
import { SHAPE_COMPOUND } from './shape_compound.js';
import { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import { SHAPE_POLY_SET } from './shape_poly_set.js';
import { SHAPE_RECT } from './shape_rect.js';
import { SHAPE_SEGMENT } from './shape_segment.js';

const setPt = (dst: VECTOR2I, x: number, y: number): void => {
  dst.x = x;
  dst.y = y;
};
const sqNorm = (x: number, y: number): number => x * x + y * y;

function collideCircleCircle(
  aA: SHAPE_CIRCLE,
  aB: SHAPE_CIRCLE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  const min_dist = aClearance + aA.GetRadius() + aB.GetRadius();
  const min_dist_sq = min_dist * min_dist;

  const delta = { x: aB.GetCenter().x - aA.GetCenter().x, y: aB.GetCenter().y - aA.GetCenter().y };

  const dist_sq = sqNorm(delta.x, delta.y);

  if (dist_sq === 0 || dist_sq < min_dist_sq) {
    if (aActual)
      aActual.value = Math.max(0, Math.trunc(Math.sqrt(dist_sq)) - aA.GetRadius() - aB.GetRadius());

    if (aLocation) {
      const c = divideI(
        { x: aA.GetCenter().x + aB.GetCenter().x, y: aA.GetCenter().y + aB.GetCenter().y },
        2,
      );
      setPt(aLocation, c.x, c.y);
    }

    if (aMTV) {
      // fixme: apparent rounding error
      const r = ResizeI(delta, Math.trunc(min_dist - Math.sqrt(dist_sq) + 3));
      setPt(aMTV, r.x, r.y);
    }

    return true;
  }

  return false;
}

function collideRectCircle(
  aA: SHAPE_RECT,
  aB: SHAPE_CIRCLE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aA.GetRadius() > 0) {
    // wxASSERT_MSG( !aMTV, "MTV not implemented for SHAPE_RECT to SHAPE_CIRCLE collisions when rect has rounded corners" );
    const outline = aA.Outline();
    return outline.CollideShape(aB, aClearance, aActual, aLocation);
  }

  const c = aB.GetCenter();
  const p0 = aA.GetPosition();
  const size = aA.GetSize();
  const r = aB.GetRadius();
  const min_dist = aClearance + r;
  const min_dist_sq = min_dist * min_dist;

  const vts: VECTOR2I[] = [
    { x: p0.x, y: p0.y },
    { x: p0.x, y: p0.y + size.y },
    { x: p0.x + size.x, y: p0.y + size.y },
    { x: p0.x + size.x, y: p0.y },
    { x: p0.x, y: p0.y },
  ];

  let nearest_side_dist_sq = ECOORD_MAX;
  let nearest: VECTOR2I = { x: 0, y: 0 };

  const inside = c.x >= p0.x && c.x <= p0.x + size.x && c.y >= p0.y && c.y <= p0.y + size.y;

  // If we're not looking for MTV or actual, short-circuit once we find a hard collision
  if (inside && !aActual && !aLocation && !aMTV) return true;

  for (let i = 0; i < 4; i++) {
    const side = new SEG(vts[i]!, vts[i + 1]!);
    const pn = side.NearestPoint(c);

    const side_dist_sq = sqNorm(pn.x - c.x, pn.y - c.y);

    if (side_dist_sq < nearest_side_dist_sq) {
      nearest = pn;
      nearest_side_dist_sq = side_dist_sq;

      if (aMTV) continue;

      if (nearest_side_dist_sq === 0) break;

      // If we're not looking for aActual then any collision will do
      if (nearest_side_dist_sq < min_dist_sq && !aActual) break;
    }
  }

  if (inside || nearest_side_dist_sq === 0 || nearest_side_dist_sq < min_dist_sq) {
    if (aLocation) setPt(aLocation, nearest.x, nearest.y);

    if (aActual) aActual.value = Math.max(0, Math.trunc(Math.sqrt(nearest_side_dist_sq)) - r);

    if (aMTV) {
      const delta = { x: c.x - nearest.x, y: c.y - nearest.y };

      if (inside) {
        const v = ResizeI(
          delta,
          Math.trunc(Math.abs(min_dist + 1 + Math.sqrt(nearest_side_dist_sq)) + 1),
        );
        setPt(aMTV, -v.x, -v.y);
      } else {
        const v = ResizeI(
          delta,
          Math.trunc(Math.abs(min_dist + 1 - Math.sqrt(nearest_side_dist_sq)) + 1),
        );
        setPt(aMTV, v.x, v.y);
      }
    }

    return true;
  }

  return false;
}

function pushoutForce(aA: SHAPE_CIRCLE, aB: SEG, aClearance: number): VECTOR2I {
  let f: VECTOR2I = { x: 0, y: 0 };

  const c = aA.GetCenter();
  const nearest = aB.NearestPoint(c);

  const r = aA.GetRadius();
  const dist = EuclideanNormI({ x: nearest.x - c.x, y: nearest.y - c.y });
  const min_dist = aClearance + r;

  if (dist < min_dist) {
    for (let corr = 0; corr < 5; corr++) {
      f = ResizeI(
        { x: aA.GetCenter().x - nearest.x, y: aA.GetCenter().y - nearest.y },
        min_dist - dist + corr,
      );

      if (aB.Distance({ x: c.x + f.x, y: c.y + f.y }) >= min_dist) break;
    }
  }

  return f;
}

function collideCircleChainBase(
  aA: SHAPE_CIRCLE,
  aB: SHAPE_LINE_CHAIN_BASE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  let closest_dist = INT_MAX;
  let closest_mtv_dist = INT_MAX;
  let nearest: VECTOR2I = { x: 0, y: 0 };
  let closest_mtv_seg = -1;

  if (aB.IsClosed() && aB.PointInside(aA.GetCenter())) {
    nearest = aA.GetCenter();
    closest_dist = 0;

    if (aMTV) {
      for (let s = 0; s < aB.GetSegmentCount(); s++) {
        const dist = aB.GetSegment(s).Distance(aA.GetCenter());

        if (dist < closest_mtv_dist) {
          closest_mtv_dist = dist;
          closest_mtv_seg = s;
        }
      }
    }
  } else {
    for (let s = 0; s < aB.GetSegmentCount(); s++) {
      const collision_dist = { value: 0 };
      const pn: VECTOR2I = { x: 0, y: 0 };

      if (
        aA.CollideSeg(
          aB.GetSegment(s),
          aClearance,
          aActual || aLocation ? collision_dist : undefined,
          aLocation ? pn : undefined,
        )
      ) {
        if (collision_dist.value < closest_dist) {
          nearest = pn;
          closest_dist = collision_dist.value;
        }

        if (closest_dist === 0) break;

        // If we're not looking for aActual then any collision will do
        if (!aActual) break;
      }
    }
  }

  if (closest_dist === 0 || closest_dist < aClearance) {
    if (aLocation) setPt(aLocation, nearest.x, nearest.y);

    if (aActual) aActual.value = closest_dist;

    if (aMTV) {
      const cmoved = new SHAPE_CIRCLE(aA);
      const f_total: VECTOR2I = { x: 0, y: 0 };
      let f: VECTOR2I = { x: 0, y: 0 };

      if (closest_mtv_seg >= 0) {
        const cs = aB.GetSegment(closest_mtv_seg);
        const np = cs.NearestPoint(aA.GetCenter());
        const d = { x: np.x - aA.GetCenter().x, y: np.y - aA.GetCenter().y };
        const r = ResizeI(d, aA.GetRadius());
        f = { x: d.x + r.x, y: d.y + r.y };
      }

      cmoved.SetCenter({ x: cmoved.GetCenter().x + f.x, y: cmoved.GetCenter().y + f.y });
      f_total.x += f.x;
      f_total.y += f.y;

      for (let s = 0; s < aB.GetSegmentCount(); s++) {
        f = pushoutForce(cmoved, aB.GetSegment(s), aClearance);
        cmoved.SetCenter({ x: cmoved.GetCenter().x + f.x, y: cmoved.GetCenter().y + f.y });
        f_total.x += f.x;
        f_total.y += f.y;
      }

      setPt(aMTV, f_total.x, f_total.y);
    }

    return true;
  }

  return false;
}

function collideCircleSegment(
  aA: SHAPE_CIRCLE,
  aSeg: SHAPE_SEGMENT,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  const hw = Math.trunc(aSeg.GetWidth() / 2);

  if (aA.CollideSeg(aSeg.GetSeg(), aClearance + hw, aActual, aLocation)) {
    if (aMTV) {
      const f = pushoutForce(aA, aSeg.GetSeg(), aClearance + hw);
      setPt(aMTV, -f.x, -f.y);
    }

    if (aActual) aActual.value = Math.max(0, aActual.value - hw);

    return true;
  }

  return false;
}

function collideChainBaseChainBase(
  aA: SHAPE_LINE_CHAIN_BASE,
  aB: SHAPE_LINE_CHAIN_BASE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  // wxASSERT_MSG( !aMTV, "MTV not implemented for %s : %s collisions" );

  let closest_dist = INT_MAX;
  let nearest: VECTOR2I = { x: 0, y: 0 };

  if (aB.IsClosed() && aA.GetPointCount() > 0 && aB.PointInside(aA.GetPoint(0))) {
    closest_dist = 0;
    nearest = aA.GetPoint(0);
  } else if (aA.IsClosed() && aB.GetPointCount() > 0 && aA.PointInside(aB.GetPoint(0))) {
    closest_dist = 0;
    nearest = aB.GetPoint(0);
  } else {
    const a_segs: SEG[] = [];
    const b_segs: SEG[] = [];

    for (let ii = 0; ii < aA.GetSegmentCount(); ii++) {
      if (aA.Type() !== SHAPE_TYPE.SH_LINE_CHAIN || !(aA as SHAPE_LINE_CHAIN).IsArcSegment(ii)) {
        a_segs.push(aA.GetSegment(ii));
      }
    }

    for (let ii = 0; ii < aB.GetSegmentCount(); ii++) {
      if (aB.Type() !== SHAPE_TYPE.SH_LINE_CHAIN || !(aB as SHAPE_LINE_CHAIN).IsArcSegment(ii)) {
        b_segs.push(aB.GetSegment(ii));
      }
    }

    const seg_sort = (a: SEG, b: SEG): number =>
      a.A.x < b.A.x || (a.A.x === b.A.x && a.A.y < b.A.y)
        ? -1
        : b.A.x < a.A.x || (b.A.x === a.A.x && b.A.y < a.A.y)
          ? 1
          : 0;

    a_segs.sort(seg_sort);
    b_segs.sort(seg_sort);

    for (const a_seg of a_segs) {
      for (const b_seg of b_segs) {
        const dist = { value: 0 };

        if (a_seg.Collide(b_seg, aClearance, aActual || aLocation ? dist : undefined)) {
          if (dist.value < closest_dist) {
            nearest = a_seg.NearestPoint(b_seg);
            closest_dist = dist.value;
          }

          if (closest_dist === 0) break;

          // If we're not looking for aActual then any collision will do
          if (!aActual) break;
        }
      }

      // the C++ `break`s only leave the inner loop; the outer loop carries on
    }
  }

  if ((!aActual && !aLocation) || closest_dist > 0) {
    const chains: (SHAPE_LINE_CHAIN | null)[] = [
      aA instanceof SHAPE_LINE_CHAIN ? aA : null,
      aB instanceof SHAPE_LINE_CHAIN ? aB : null,
    ];

    const shapes: SHAPE[] = [aA, aB];

    for (let ii = 0; ii < 2; ii++) {
      const chain = chains[ii]!;
      const other = shapes[(ii + 1) % 2]!;

      if (!chain) continue;

      for (let jj = 0; jj < chain.ArcCount(); jj++) {
        const arc = chain.Arc(jj);

        if (arc.CollideShape(other, aClearance, aActual, aLocation)) return true;
      }
    }
  }

  if (closest_dist === 0 || closest_dist < aClearance) {
    if (aLocation) setPt(aLocation, nearest.x, nearest.y);

    if (aActual) aActual.value = closest_dist;

    return true;
  }

  return false;
}

function collideRectChainBase(
  aA: SHAPE_RECT,
  aB: SHAPE_LINE_CHAIN_BASE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aA.GetRadius() > 0)
    return collideChainBaseChainBase(aA.Outline(), aB, aClearance, aActual, aLocation, aMTV);

  // wxASSERT_MSG( !aMTV, "MTV not implemented for %s : %s collisions" );

  let closest_dist = INT_MAX;
  let nearest: VECTOR2I = { x: 0, y: 0 };

  if (aB.IsClosed() && aB.PointInside(aA.Centre())) {
    nearest = aA.Centre();
    closest_dist = 0;
  } else {
    for (let s = 0; s < aB.GetSegmentCount(); s++) {
      const collision_dist = { value: 0 };
      const pn: VECTOR2I = { x: 0, y: 0 };

      if (
        aA.CollideSeg(
          aB.GetSegment(s),
          aClearance,
          aActual || aLocation ? collision_dist : undefined,
          aLocation ? pn : undefined,
        )
      ) {
        if (collision_dist.value < closest_dist) {
          nearest = pn;
          closest_dist = collision_dist.value;
        }

        if (closest_dist === 0) break;

        // If we're not looking for aActual then any collision will do
        if (!aActual) break;
      }
    }
  }

  if (closest_dist === 0 || closest_dist < aClearance) {
    if (aLocation) setPt(aLocation, nearest.x, nearest.y);

    if (aActual) aActual.value = closest_dist;

    return true;
  }

  return false;
}

function collideSegmentSegment(
  aA: SHAPE_SEGMENT,
  aB: SHAPE_SEGMENT,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  // wxASSERT_MSG( !aMTV, "MTV not implemented for %s : %s collisions" );

  const hw = Math.trunc(aB.GetWidth() / 2);
  const rv = aA.CollideSeg(aB.GetSeg(), aClearance + hw, aActual, aLocation);

  if (rv && aActual) aActual.value = Math.max(0, aActual.value - hw);

  return rv;
}

function collideChainBaseSegment(
  aA: SHAPE_LINE_CHAIN_BASE,
  aB: SHAPE_SEGMENT,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  // wxASSERT_MSG( !aMTV, "MTV not implemented for %s : %s collisions" );

  const hw = Math.trunc(aB.GetWidth() / 2);
  const rv = aA.CollideSeg(aB.GetSeg(), aClearance + hw, aActual, aLocation);

  if (rv && aActual) aActual.value = Math.max(0, aActual.value - hw);

  return rv;
}

function collideRectSegment(
  aA: SHAPE_RECT,
  aB: SHAPE_SEGMENT,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aA.GetRadius() > 0)
    return collideChainBaseSegment(aA.Outline(), aB, aClearance, aActual, aLocation, aMTV);

  // wxASSERT_MSG( !aMTV, "MTV not implemented for %s : %s collisions" );

  const hw = Math.trunc(aB.GetWidth() / 2);
  const rv = aA.CollideSeg(aB.GetSeg(), aClearance + hw, aActual, aLocation);

  if (rv && aActual) aActual.value = Math.max(0, aActual.value - hw);

  return rv;
}

function collideRectRect(
  aA: SHAPE_RECT,
  aB: SHAPE_RECT,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aClearance || aActual || aLocation || aMTV || aA.GetRadius() > 0 || aB.GetRadius() > 0) {
    return collideChainBaseChainBase(
      aA.Outline(),
      aB.Outline(),
      aClearance,
      aActual,
      aLocation,
      aMTV,
    );
  }

  const bboxa = aA.BBox();
  const bboxb = aB.BBox();

  return bboxa.Intersects(bboxb);
}

function collideArcCircle(
  aA: SHAPE_ARC,
  aB: SHAPE_CIRCLE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aA.IsEffectiveLine()) {
    const tmp = new SHAPE_SEGMENT(aA.GetP0(), aA.GetP1(), aA.GetWidth());
    const retval = collideCircleSegment(aB, tmp, aClearance, aActual, aLocation, aMTV);

    if (retval && aMTV) setPt(aMTV, -aMTV.x, -aMTV.y);

    return retval;
  }

  const ptA: VECTOR2I = { x: 0, y: 0 };
  const ptB: VECTOR2I = { x: 0, y: 0 };
  const dist_sq = { value: ECOORD_MAX };

  aA.NearestPoints(aB, ptA, ptB, dist_sq);

  if (dist_sq.value === 0 || dist_sq.value < aClearance * aClearance) {
    if (aLocation) {
      const c = divideI({ x: ptA.x + ptB.x, y: ptA.y + ptB.y }, 2);
      setPt(aLocation, c.x, c.y);
    }

    if (aActual) aActual.value = Math.max(0, KiROUND(Math.sqrt(dist_sq.value)));

    if (aMTV) {
      const delta = { x: ptB.x - ptA.x, y: ptB.y - ptA.y };
      const v = ResizeI(delta, Math.trunc(aClearance - Math.sqrt(dist_sq.value) + 3));
      setPt(aMTV, v.x, v.y);
    }

    return true;
  }

  return false;
}

function collideArcChain(
  aA: SHAPE_ARC,
  aB: SHAPE_LINE_CHAIN,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  // wxASSERT_MSG( !aMTV, "MTV not implemented for %s : %s collisions" );

  let closest_dist = INT_MAX;
  let nearest: VECTOR2I = { x: 0, y: 0 };

  if (aB.IsClosed() && aB.PointInside(aA.GetP0())) {
    closest_dist = 0;
    nearest = aA.GetP0();
  } else {
    const collision_dist = { value: 0 };
    const pn: VECTOR2I = { x: 0, y: 0 };

    for (let i = 0; i < aB.GetSegmentCount(); i++) {
      // ignore arcs - we will collide these separately
      if (aB.IsArcSegment(i)) continue;

      if (
        aA.CollideSeg(
          aB.GetSegment(i),
          aClearance,
          aActual || aLocation ? collision_dist : undefined,
          aLocation ? pn : undefined,
        )
      ) {
        if (collision_dist.value < closest_dist) {
          nearest = { x: pn.x, y: pn.y };
          closest_dist = collision_dist.value;
        }

        if (closest_dist === 0) break;

        // If we're not looking for aActual then any collision will do
        if (!aActual) break;
      }
    }

    for (let i = 0; i < aB.ArcCount(); i++) {
      const arc = aB.Arc(i);

      // The arcs in the chain should have zero width
      // wxASSERT_MSG( arc.GetWidth() == 0, wxT( "Invalid arc width - should be zero" ) );

      if (
        aA.CollideShape(
          arc,
          aClearance,
          aActual || aLocation ? collision_dist : undefined,
          aLocation ? pn : undefined,
        )
      ) {
        if (collision_dist.value < closest_dist) {
          nearest = { x: pn.x, y: pn.y };
          closest_dist = collision_dist.value;
        }

        if (closest_dist === 0) break;

        if (!aActual) break;
      }
    }
  }

  if (closest_dist === 0 || closest_dist < aClearance) {
    if (aLocation) setPt(aLocation, nearest.x, nearest.y);

    if (aActual) aActual.value = closest_dist;

    return true;
  }

  return false;
}

function collideArcRect(
  aA: SHAPE_ARC,
  aB: SHAPE_RECT,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aB.GetRadius() > 0)
    return collideArcChain(aA, aB.Outline(), aClearance, aActual, aLocation, aMTV);

  if (aA.IsEffectiveLine()) {
    const tmp = new SHAPE_SEGMENT(aA.GetP0(), aA.GetP1(), aA.GetWidth());
    const retval = collideRectSegment(aB, tmp, aClearance, aActual, aLocation, aMTV);

    if (retval && aMTV) setPt(aMTV, -aMTV.x, -aMTV.y);

    return retval;
  }

  const ptA: VECTOR2I = { x: 0, y: 0 };
  const ptB: VECTOR2I = { x: 0, y: 0 };
  const dist_sq = { value: ECOORD_MAX };

  aA.NearestPoints(aB, ptA, ptB, dist_sq);

  if (dist_sq.value === 0 || dist_sq.value < aClearance * aClearance) {
    if (aLocation) {
      const c = divideI({ x: ptA.x + ptB.x, y: ptA.y + ptB.y }, 2);
      setPt(aLocation, c.x, c.y);
    }

    if (aActual) aActual.value = Math.max(0, KiROUND(Math.sqrt(dist_sq.value)));

    if (aMTV) {
      const delta = { x: ptB.x - ptA.x, y: ptB.y - ptA.y };
      const v = ResizeI(delta, Math.trunc(aClearance - Math.sqrt(dist_sq.value) + 3));
      setPt(aMTV, v.x, v.y);
    }

    return true;
  }

  return false;
}

function collideArcSegment(
  aA: SHAPE_ARC,
  aB: SHAPE_SEGMENT,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  // wxASSERT_MSG( !aMTV, "MTV not implemented for %s : %s collisions" );

  // If the arc radius is too large, it is effectively a line segment
  if (aA.IsEffectiveLine()) {
    const tmp = new SHAPE_SEGMENT(aA.GetP0(), aA.GetP1(), aA.GetWidth());
    return collideSegmentSegment(tmp, aB, aClearance, aActual, aLocation, aMTV);
  }

  const hw = Math.trunc(aB.GetWidth() / 2);
  const rv = aA.CollideSeg(aB.GetSeg(), aClearance + hw, aActual, aLocation);

  if (rv && aActual) aActual.value = Math.max(0, aActual.value - hw);

  return rv;
}

function collideArcChainBase(
  aA: SHAPE_ARC,
  aB: SHAPE_LINE_CHAIN_BASE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  // If the arc radius is too large, it is effectively a line segment
  if (aA.IsEffectiveLine()) {
    const tmp = new SHAPE_SEGMENT(aA.GetP0(), aA.GetP1(), aA.GetWidth());
    return collideChainBaseSegment(aB, tmp, aClearance, aActual, aLocation, aMTV);
  }

  // wxASSERT_MSG( !aMTV, "MTV not implemented for %s : %s collisions" );

  let closest_dist = INT_MAX;
  let nearest: VECTOR2I = { x: 0, y: 0 };

  if (aB.IsClosed() && aB.PointInside(aA.GetP0())) {
    closest_dist = 0;
    nearest = aA.GetP0();
  } else {
    for (let i = 0; i < aB.GetSegmentCount(); i++) {
      const collision_dist = { value: 0 };
      const pn: VECTOR2I = { x: 0, y: 0 };

      if (
        aA.CollideSeg(
          aB.GetSegment(i),
          aClearance,
          aActual || aLocation ? collision_dist : undefined,
          aLocation ? pn : undefined,
        )
      ) {
        if (collision_dist.value < closest_dist) {
          nearest = pn;
          closest_dist = collision_dist.value;
        }

        if (closest_dist === 0) break;

        // If we're not looking for aActual then any collision will do
        if (!aActual) break;
      }
    }
  }

  if (closest_dist === 0 || closest_dist < aClearance) {
    if (aLocation) setPt(aLocation, nearest.x, nearest.y);

    if (aActual) aActual.value = closest_dist;

    return true;
  }

  return false;
}

function collideArcArc(
  aA: SHAPE_ARC,
  aB: SHAPE_ARC,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aA.IsEffectiveLine()) {
    const tmp = new SHAPE_SEGMENT(aA.GetP0(), aA.GetP1(), aA.GetWidth());
    const retval = collideArcSegment(aB, tmp, aClearance, aActual, aLocation, aMTV);

    if (retval && aMTV) setPt(aMTV, -aMTV.x, -aMTV.y);

    return retval;
  }

  if (aB.IsEffectiveLine()) {
    const tmp = new SHAPE_SEGMENT(aB.GetP0(), aB.GetP1(), aB.GetWidth());
    return collideArcSegment(aA, tmp, aClearance, aActual, aLocation, aMTV);
  }

  const ptA: VECTOR2I = { x: 0, y: 0 };
  const ptB: VECTOR2I = { x: 0, y: 0 };
  const dist_sq = { value: ECOORD_MAX };

  aA.NearestPoints(aB, ptA, ptB, dist_sq);

  if (dist_sq.value === 0 || dist_sq.value < aClearance * aClearance) {
    if (aLocation) {
      const c = divideI({ x: ptA.x + ptB.x, y: ptA.y + ptB.y }, 2);
      setPt(aLocation, c.x, c.y);
    }

    if (aActual) aActual.value = Math.max(0, KiROUND(Math.sqrt(dist_sq.value)));

    if (aMTV) {
      const delta = { x: ptB.x - ptA.x, y: ptB.y - ptA.y };
      const v = ResizeI(delta, Math.trunc(aClearance - Math.sqrt(dist_sq.value) + 3));
      setPt(aMTV, v.x, v.y);
    }

    return true;
  }

  return false;
}

type CollFn<A, B> = (
  a: A,
  b: B,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
) => boolean;

/** `CollCaseReversed`: swap the operands and negate the MTV. */
function collCaseReversed<A, B>(
  fn: CollFn<B, A>,
  aA: A,
  aB: B,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  const rv = fn(aB, aA, aClearance, aActual, aLocation, aMTV);

  if (rv && aMTV) setPt(aMTV, -aMTV.x, -aMTV.y);

  return rv;
}

function collideSingleShapes(
  aA: SHAPE,
  aB: SHAPE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aA.Type() === SHAPE_TYPE.SH_POLY_SET) {
    const polySetA = aA as SHAPE_POLY_SET;

    // wxASSERT( !aMTV );
    return polySetA.CollideShape(aB, aClearance, aActual, aLocation);
  } else if (aB.Type() === SHAPE_TYPE.SH_POLY_SET) {
    const polySetB = aB as SHAPE_POLY_SET;

    // wxASSERT( !aMTV );
    return polySetB.CollideShape(aA, aClearance, aActual, aLocation);
  }

  const T = SHAPE_TYPE;

  switch (aA.Type()) {
    case T.SH_NULL:
      return false;

    case T.SH_RECT:
      switch (aB.Type()) {
        case T.SH_RECT:
          return collideRectRect(
            aA as SHAPE_RECT,
            aB as SHAPE_RECT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_CIRCLE:
          return collideRectCircle(
            aA as SHAPE_RECT,
            aB as SHAPE_CIRCLE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_LINE_CHAIN:
          return collideRectChainBase(
            aA as SHAPE_RECT,
            aB as SHAPE_LINE_CHAIN,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SEGMENT:
          return collideRectSegment(
            aA as SHAPE_RECT,
            aB as SHAPE_SEGMENT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return collideRectChainBase(
            aA as SHAPE_RECT,
            aB as SHAPE_LINE_CHAIN_BASE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_ARC:
          return collCaseReversed(
            collideArcRect,
            aA as SHAPE_RECT,
            aB as SHAPE_ARC,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_NULL:
          return false;
        default:
          break;
      }
      break;

    case T.SH_CIRCLE:
      switch (aB.Type()) {
        case T.SH_RECT:
          return collCaseReversed(
            collideRectCircle,
            aA as SHAPE_CIRCLE,
            aB as SHAPE_RECT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_CIRCLE:
          return collideCircleCircle(
            aA as SHAPE_CIRCLE,
            aB as SHAPE_CIRCLE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_LINE_CHAIN:
          return collideCircleChainBase(
            aA as SHAPE_CIRCLE,
            aB as SHAPE_LINE_CHAIN,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SEGMENT:
          return collideCircleSegment(
            aA as SHAPE_CIRCLE,
            aB as SHAPE_SEGMENT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return collideCircleChainBase(
            aA as SHAPE_CIRCLE,
            aB as SHAPE_LINE_CHAIN_BASE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_ARC:
          return collCaseReversed(
            collideArcCircle,
            aA as SHAPE_CIRCLE,
            aB as SHAPE_ARC,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_NULL:
          return false;
        default:
          break;
      }
      break;

    case T.SH_LINE_CHAIN:
      switch (aB.Type()) {
        case T.SH_RECT:
          return collideRectChainBase(
            aB as SHAPE_RECT,
            aA as SHAPE_LINE_CHAIN,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_CIRCLE:
          return collideCircleChainBase(
            aB as SHAPE_CIRCLE,
            aA as SHAPE_LINE_CHAIN,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_LINE_CHAIN:
          return collideChainBaseChainBase(
            aA as SHAPE_LINE_CHAIN,
            aB as SHAPE_LINE_CHAIN,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SEGMENT:
          return collideChainBaseSegment(
            aA as SHAPE_LINE_CHAIN,
            aB as SHAPE_SEGMENT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return collideChainBaseChainBase(
            aA as SHAPE_LINE_CHAIN,
            aB as SHAPE_LINE_CHAIN_BASE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_ARC:
          return collCaseReversed(
            collideArcChain,
            aA as SHAPE_LINE_CHAIN,
            aB as SHAPE_ARC,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_NULL:
          return false;
        default:
          break;
      }
      break;

    case T.SH_SEGMENT:
      switch (aB.Type()) {
        case T.SH_RECT:
          return collideRectSegment(
            aB as SHAPE_RECT,
            aA as SHAPE_SEGMENT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_CIRCLE:
          return collCaseReversed(
            collideCircleSegment,
            aA as SHAPE_SEGMENT,
            aB as SHAPE_CIRCLE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_LINE_CHAIN:
          return collideChainBaseSegment(
            aB as SHAPE_LINE_CHAIN,
            aA as SHAPE_SEGMENT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SEGMENT:
          return collideSegmentSegment(
            aA as SHAPE_SEGMENT,
            aB as SHAPE_SEGMENT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return collideChainBaseSegment(
            aB as SHAPE_LINE_CHAIN_BASE,
            aA as SHAPE_SEGMENT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_ARC:
          return collCaseReversed(
            collideArcSegment,
            aA as SHAPE_SEGMENT,
            aB as SHAPE_ARC,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_NULL:
          return false;
        default:
          break;
      }
      break;

    case T.SH_SIMPLE:
    case T.SH_POLY_SET_TRIANGLE:
      switch (aB.Type()) {
        case T.SH_RECT:
          return collideRectChainBase(
            aB as SHAPE_RECT,
            aA as SHAPE_LINE_CHAIN_BASE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_CIRCLE:
          return collideCircleChainBase(
            aB as SHAPE_CIRCLE,
            aA as SHAPE_LINE_CHAIN_BASE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_LINE_CHAIN:
          return collideChainBaseChainBase(
            aB as SHAPE_LINE_CHAIN,
            aA as SHAPE_LINE_CHAIN_BASE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SEGMENT:
          return collideChainBaseSegment(
            aA as SHAPE_LINE_CHAIN_BASE,
            aB as SHAPE_SEGMENT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return collideChainBaseChainBase(
            aA as SHAPE_LINE_CHAIN_BASE,
            aB as SHAPE_LINE_CHAIN_BASE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_ARC:
          return collCaseReversed(
            collideArcChainBase,
            aA as SHAPE_LINE_CHAIN_BASE,
            aB as SHAPE_ARC,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_NULL:
          return false;
        default:
          break;
      }
      break;

    case T.SH_ARC:
      switch (aB.Type()) {
        case T.SH_RECT:
          return collideArcRect(
            aA as SHAPE_ARC,
            aB as SHAPE_RECT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_CIRCLE:
          return collideArcCircle(
            aA as SHAPE_ARC,
            aB as SHAPE_CIRCLE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_LINE_CHAIN:
          return collideArcChain(
            aA as SHAPE_ARC,
            aB as SHAPE_LINE_CHAIN,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SEGMENT:
          return collideArcSegment(
            aA as SHAPE_ARC,
            aB as SHAPE_SEGMENT,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return collideArcChainBase(
            aA as SHAPE_ARC,
            aB as SHAPE_LINE_CHAIN_BASE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_ARC:
          return collideArcArc(
            aA as SHAPE_ARC,
            aB as SHAPE_ARC,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_NULL:
          return false;
        default:
          break;
      }
      break;

    default:
      break;
  }

  // wxFAIL_MSG( "Unsupported collision: %s with %s" )
  console.warn(
    `Unsupported collision: ${SHAPE_TYPE_asString(aA.Type())} with ${SHAPE_TYPE_asString(aB.Type())}`,
  );

  return false;
}

/** `collideShapes`: the compound walk over `collideSingleShapes`. */
export function collideShapes(
  aA: SHAPE,
  aB: SHAPE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  let currentActual = INT_MAX;
  let currentLocation: VECTOR2I = { x: 0, y: 0 };
  let currentMTV: VECTOR2I = { x: 0, y: 0 };
  let colliding = false;

  const canExit = (): boolean => {
    if (!colliding) return false;

    if (aActual && currentActual > 0) return false;

    if (aMTV) return false;

    return true;
  };

  const collideCompoundSubshapes = (elemA: SHAPE, elemB: SHAPE, clearance: number): boolean => {
    const actual = { value: 0 };
    const location: VECTOR2I = { x: 0, y: 0 };
    const mtv: VECTOR2I = { x: 0, y: 0 };

    if (
      collideSingleShapes(
        elemA,
        elemB,
        clearance,
        aActual || aLocation ? actual : undefined,
        aLocation ? location : undefined,
        aMTV ? mtv : undefined,
      )
    ) {
      if (actual.value < currentActual) {
        currentActual = actual.value;
        currentLocation = location;
      }

      if (aMTV && sqNorm(mtv.x, mtv.y) > sqNorm(currentMTV.x, currentMTV.y)) {
        currentMTV = mtv;
      }

      return true;
    }

    return false;
  };

  if (aA.Type() === SHAPE_TYPE.SH_COMPOUND && aB.Type() === SHAPE_TYPE.SH_COMPOUND) {
    const cmpA = aA as SHAPE_COMPOUND;
    const cmpB = aB as SHAPE_COMPOUND;

    for (const elemA of cmpA.Shapes()) {
      for (const elemB of cmpB.Shapes()) {
        if (collideCompoundSubshapes(elemA, elemB, aClearance)) {
          colliding = true;

          if (canExit()) break;
        }
      }

      if (canExit()) break;
    }
  } else if (aA.Type() === SHAPE_TYPE.SH_COMPOUND) {
    const cmpA = aA as SHAPE_COMPOUND;

    for (const elemA of cmpA.Shapes()) {
      if (collideCompoundSubshapes(elemA, aB, aClearance)) {
        colliding = true;

        if (canExit()) break;
      }
    }
  } else if (aB.Type() === SHAPE_TYPE.SH_COMPOUND) {
    const cmpB = aB as SHAPE_COMPOUND;

    for (const elemB of cmpB.Shapes()) {
      if (collideCompoundSubshapes(aA, elemB, aClearance)) {
        colliding = true;

        if (canExit()) break;
      }
    }
  } else {
    return collideSingleShapes(aA, aB, aClearance, aActual, aLocation, aMTV);
  }

  if (colliding) {
    if (aLocation) setPt(aLocation, currentLocation.x, currentLocation.y);

    if (aActual) aActual.value = currentActual;

    if (aMTV) setPt(aMTV, currentMTV.x, currentMTV.y);
  }

  return colliding;
}

SHAPE_HOOKS.collideShapes = collideShapes;
