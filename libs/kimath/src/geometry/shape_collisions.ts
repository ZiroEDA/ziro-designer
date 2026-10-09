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

import { ECOORD_MAX, EuclideanNormI, ResizeI, type VECTOR2I, type Vec2 } from '../math/vector2.js';
import { INT_MAX, KiROUND } from '../math/util.js';
import { divideI } from '../math/vector2.js';
import type { Seg } from './corner_operations.js';
import {
  SEG,
  segCollide,
  segContains,
  segDistance,
  segDistanceToPoint,
  segLineProject,
  segNearestPoint,
  segNearestPointToSeg,
  segSquaredDistanceToPoint,
  segSquaredDistanceToSeg,
} from './seg.js';
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

function collideCircleCircleObjects(
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

function collideCircleSegmentObjects(
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

function collideSegmentSegmentObjects(
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

function collideArcCircleObjects(
  aA: SHAPE_ARC,
  aB: SHAPE_CIRCLE,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aA.IsEffectiveLine()) {
    const tmp = new SHAPE_SEGMENT(aA.GetP0(), aA.GetP1(), aA.GetWidth());
    const retval = collideCircleSegmentObjects(aB, tmp, aClearance, aActual, aLocation, aMTV);

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

function collideArcChainObjects(
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
    return collideArcChainObjects(aA, aB.Outline(), aClearance, aActual, aLocation, aMTV);

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

function collideArcSegmentObjects(
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
    return collideSegmentSegmentObjects(tmp, aB, aClearance, aActual, aLocation, aMTV);
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

function collideArcArcObjects(
  aA: SHAPE_ARC,
  aB: SHAPE_ARC,
  aClearance: number,
  aActual?: OutInt,
  aLocation?: VECTOR2I,
  aMTV?: VECTOR2I,
): boolean {
  if (aA.IsEffectiveLine()) {
    const tmp = new SHAPE_SEGMENT(aA.GetP0(), aA.GetP1(), aA.GetWidth());
    const retval = collideArcSegmentObjects(aB, tmp, aClearance, aActual, aLocation, aMTV);

    if (retval && aMTV) setPt(aMTV, -aMTV.x, -aMTV.y);

    return retval;
  }

  if (aB.IsEffectiveLine()) {
    const tmp = new SHAPE_SEGMENT(aB.GetP0(), aB.GetP1(), aB.GetWidth());
    return collideArcSegmentObjects(aA, tmp, aClearance, aActual, aLocation, aMTV);
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

function collideSingleShapesObjects(
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
          return collideCircleCircleObjects(
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
          return collideCircleSegmentObjects(
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
            collideArcCircleObjects,
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
            collideArcChainObjects,
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
            collideCircleSegmentObjects,
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
          return collideSegmentSegmentObjects(
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
            collideArcSegmentObjects,
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
          return collideArcCircleObjects(
            aA as SHAPE_ARC,
            aB as SHAPE_CIRCLE,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_LINE_CHAIN:
          return collideArcChainObjects(
            aA as SHAPE_ARC,
            aB as SHAPE_LINE_CHAIN,
            aClearance,
            aActual,
            aLocation,
            aMTV,
          );
        case T.SH_SEGMENT:
          return collideArcSegmentObjects(
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
          return collideArcArcObjects(
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

/** `collideShapeObjects`: the compound walk over `collideSingleShapesObjects`. */
export function collideShapeObjects(
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
      collideSingleShapesObjects(
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
    return collideSingleShapesObjects(aA, aB, aClearance, aActual, aLocation, aMTV);
  }

  if (colliding) {
    if (aLocation) setPt(aLocation, currentLocation.x, currentLocation.y);

    if (aActual) aActual.value = currentActual;

    if (aMTV) setPt(aMTV, currentMTV.x, currentMTV.y);
  }

  return colliding;
}

SHAPE_HOOKS.collideShapes = collideShapeObjects;

// ===========================================================================
// The value-typed `Shape` seam (formerly pcbnew/drc/drc_geometry.ts and pcbnew/drc/shape_collisions.ts)
// ===========================================================================

// Everything below this banner is the plain-object sibling of the SHAPE classes
// above: the router (`pcbnew/router/`) still runs on `Shape` values (#636 stage
// 3) and calls these instead of `SHAPE::Collide`. Same C++ file, same routines.

/**
 * Exact DRC shape geometry. Counterparts: the SHAPE classes KiCad's DRC
 * collides (`libs/kimath/src/geometry/shape_*.cpp`):
 *
 *  - circle  = SHAPE_CIRCLE
 *  - stadium = SHAPE_SEGMENT (segment + half-width)
 *  - arc     = SHAPE_ARC (center/radius/angle-range + half-width), exact
 *              closest-approach: candidates are the radial projection when it
 *              falls inside the angular range, the endpoints both ways, and
 *              circle intersections (distance 0) inside the range.
 *  - poly    = SHAPE_SIMPLE / SHAPE_POLY_SET outline (any simple polygon,
 *              ray-cast containment) with an outward inflation `r`, which
 *              represents rounded-rect pads exactly (deflated rect + corner
 *              radius) and stroked poly primitives (width/2).
 *
 * All distances return the free gap between copper boundaries (0 when the
 * shapes touch or overlap).
 *
 * ## Coordinates are integers, because `VECTOR2I` is
 *
 * Every segment measurement here comes from `@ziroeda/kimath`'s `SEG`, the
 * exact-integer port of `libs/kimath/src/geometry/seg.cpp`, and not from a copy
 * in doubles. There is no third implementation: `SEG::SquaredDistance` and
 * `SEG::Distance` are the same routines `SHAPE::Collide` measures with, so
 * `shapeDist` and `pcbnew/drc/shape_collisions.ts` now agree by
 * construction rather than by coincidence.
 *
 * Three consequences, all of them upstream's:
 *
 *  1. **Coordinates quantise to 1 IU.** `Shape` carries doubles because
 *     `arcShape` computes a centre and `padShapes` rotates vertices; kimath
 *     `KiROUND`s them on the way into a `SEG`, which reproduces the rounding
 *     KiCad already did when it built the `SHAPE_POLY_SET` of `VECTOR2I`s.
 *  2. **The gap is a whole number of IU.** `SHAPE::Collide` writes its `aActual`
 *     through an `int*` after `(int) sqrt( dist_sq )` — see
 *     {@link truncSqrt} — so a fractional gap is a divergence and not extra
 *     precision. `mm( gap )` in a DRC message therefore prints what KiCad's
 *     prints.
 *  3. **An exact touch is exactly zero.** The old `Math.hypot` of a projected
 *     point came back at ~1e-9 for a point genuinely on a segment, so
 *     `shapeDist(…) === 0` — the *shorting* test, and the touch test in a dozen
 *     other places — silently answered false.
 *
 * ## The one thing still measured in doubles
 *
 * {@link pointArc}, {@link segArc} and {@link arcArc} measure a **curve**, and
 * kimath has no integer counterpart: `SHAPE_ARC::Collide` is not a distance
 * function but a verdict over a candidate list that keeps the *last* colliding
 * candidate rather than the nearest (`shape_arc.cpp`, transcribed in
 * `shape_collisions.ts`'s `arcCollideSeg`), so it cannot answer "how far apart
 * are these two". Upstream's own arc distance is a double as well — it is
 * `KiROUND( nearestPt.Distance( aP ) )`, a `hypot` rounded on the way into an
 * `int` — so the double is where upstream keeps one too. It is truncated at the
 * same place every other pair is, by {@link gapFromDistance}.
 *
 * The other double upstream keeps is `drc_creepage_utils.h:67`'s `VECTOR2D`
 * `CREEP_SHAPE` world, mirrored in `drc/creepage_shapes.ts`; it is not reached
 * from here.
 */

export type Shape =
  | { kind: 'circle'; c: Vec2; r: number }
  | { kind: 'stadium'; a: Vec2; b: Vec2; r: number }
  | {
      kind: 'arc';
      c: Vec2;
      rad: number;
      a0: number;
      sweep: number;
      r: number;
      /**
       * The three points the arc was drawn from, when it has them. A polygon
       * of the arc is built on `ARC_CHORD_PARAMS`' circle through THESE, which
       * is not the circumcircle when the mid is off the bisector, and the pour
       * has to sag where upstream's sags.
       */
      chord?: { s: Vec2; m: Vec2; e: Vec2 };
    }
  | { kind: 'poly'; pts: Vec2[]; r: number };

/** Circumcenter of the arc through start/mid/end (null when collinear). */
function arcCenter(s: Vec2, m: Vec2, e: Vec2): Vec2 | null {
  const d = 2 * (s.x * (m.y - e.y) + m.x * (e.y - s.y) + e.x * (s.y - m.y));
  if (d === 0) return null;
  const s2 = s.x * s.x + s.y * s.y;
  const m2 = m.x * m.x + m.y * m.y;
  const e2 = e.x * e.x + e.y * e.y;
  return {
    x: (s2 * (m.y - e.y) + m2 * (e.y - s.y) + e2 * (s.y - m.y)) / d,
    y: (s2 * (e.x - m.x) + m2 * (s.x - e.x) + e2 * (m.x - s.x)) / d,
  };
}

/** SHAPE_ARC from a track arc's start/mid/end + width. */
export function arcShape(s: Vec2, m: Vec2, e: Vec2, width: number): Shape {
  const c = arcCenter(s, m, e);
  if (!c) return { kind: 'stadium', a: s, b: e, r: width / 2 };
  const rad = Math.hypot(s.x - c.x, s.y - c.y);
  const a0 = Math.atan2(s.y - c.y, s.x - c.x);
  const am = Math.atan2(m.y - c.y, m.x - c.x);
  const a1 = Math.atan2(e.y - c.y, e.x - c.x);
  const TAU = 2 * Math.PI;
  const norm = (a: number): number => ((a % TAU) + TAU) % TAU;
  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= TAU; // the mid point picks the direction
  return { kind: 'arc', c, rad, a0, sweep, r: width / 2, chord: { s, m, e } };
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * `std::max( 0, (int) sqrt( dist_sq ) - rA - rB )`, the whole of
 * `SHAPE::Collide`'s `aActual` in one place.
 *
 * The order is upstream's and is not interchangeable: truncating the whole
 * `sqrt - r` expression instead moves the answer by an IU whenever a radius is
 * half-integral, which is every odd-width track — Ziro's `stadium.r` is
 * `width / 2` untruncated.
 */
const gap = (aSquaredDist: number, aR1: number, aR2: number): number =>
  Math.max(0, truncSqrt(aSquaredDist) - aR1 - aR2);

/** {@link gap} for the arc pairs, whose curve distance is already a length. */
const gapFromDistance = (aDist: number, aR1: number, aR2: number): number =>
  Math.max(0, Math.trunc(aDist) - aR1 - aR2);

/**
 * `SEG::SquaredDistance( const VECTOR2I& )` between two bare points: a
 * zero-length `SEG` takes the `e <= 0` arm, which is `|ap|²` in exact integer
 * arithmetic — `VECTOR2I::SquaredEuclideanNorm( aB - aA )`, the `ecoord` the
 * circle pair of `shape_collisions.cpp:55` measures with.
 */
const pointPointSq = (a: Vec2, b: Vec2): number => segSquaredDistanceToPoint({ a, b: a }, b);

/** `SEG::SquaredDistance( const VECTOR2I& )` (`seg.cpp:714`). */
const pointSegSq = (p: Vec2, a: Vec2, b: Vec2): number => segSquaredDistanceToPoint({ a, b }, p);

/** `SEG::SquaredDistance( const SEG& )` (`seg.cpp:80`). */
const segSegSq = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number =>
  segSquaredDistanceToSeg({ a: a1, b: a2 }, { a: b1, b: b2 });

/**
 * `SEG::Distance( const VECTOR2I& )` (`seg.cpp:708`): `isqrt` of the exact
 * squared distance, so it **floors**.
 *
 * Not `truncSqrt`: this is the `SEG` member, which upstream spells `isqrt`,
 * where `SHAPE::Collide`'s `aActual` spells `(int) sqrt`. The two disagree only
 * on a squared distance whose true root rounds up to an integer in double,
 * and keeping them apart is what makes each one traceable to its own line of
 * C++.
 */
export const pointSeg = (p: Vec2, a: Vec2, b: Vec2): number => segDistanceToPoint({ a, b }, p);

/**
 * `SEG::Distance( const SEG& )` (`seg.cpp:702`).
 *
 * Crossing segments answer 0 through `SEG::Intersects`, which is upstream's own
 * exact-integer predicate — where the four hand-rolled cross products this
 * replaced tested only for a *proper* crossing, and so reported a positive
 * distance for two segments that merely touched at a vertex or overlapped
 * collinearly.
 */
export const segSeg = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number =>
  segDistance({ a: a1, b: a2 }, { a: b1, b: b2 });

/** Even-odd point-in-polygon (any simple polygon). */
export function pointInPoly(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

const TAU = 2 * Math.PI;
const norm = (a: number): number => ((a % TAU) + TAU) % TAU;

/** Is angle `a` within the arc's swept range? (sweep may be negative.) */
function angleInArc(a: number, a0: number, sweep: number): boolean {
  if (sweep >= 0) return norm(a - a0) <= sweep + 1e-12;
  return norm(a0 - a) <= -sweep + 1e-12;
}

export interface ArcGeom {
  c: Vec2;
  rad: number;
  a0: number;
  sweep: number;
}

export function arcPoint(g: ArcGeom, a: number): Vec2 {
  return { x: g.c.x + g.rad * Math.cos(a), y: g.c.y + g.rad * Math.sin(a) };
}
export const arcStart = (g: ArcGeom): Vec2 => arcPoint(g, g.a0);
export const arcEnd = (g: ArcGeom): Vec2 => arcPoint(g, g.a0 + g.sweep);

/** Exact distance from a point to the arc curve. */
export function pointArc(p: Vec2, g: ArcGeom): number {
  const a = Math.atan2(p.y - g.c.y, p.x - g.c.x);
  const candidates = [dist(p, arcStart(g)), dist(p, arcEnd(g))];
  if (angleInArc(a, g.a0, g.sweep)) candidates.push(Math.abs(dist(p, g.c) - g.rad));
  return Math.min(...candidates);
}

/** Exact distance from a segment to the arc curve (0 when crossing). */
export function segArc(a: Vec2, b: Vec2, g: ArcGeom): number {
  // Circle-line intersections inside the angular range mean contact.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - g.c.x;
  const fy = a.y - g.c.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - g.rad * g.rad;
  if (A > 0) {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
        if (t >= 0 && t <= 1) {
          const p = { x: a.x + t * dx, y: a.y + t * dy };
          if (angleInArc(Math.atan2(p.y - g.c.y, p.x - g.c.x), g.a0, g.sweep)) return 0;
        }
      }
    }
  }
  const candidates = [
    pointArc(a, g),
    pointArc(b, g),
    pointSeg(arcStart(g), a, b),
    pointSeg(arcEnd(g), a, b),
  ];
  // Radial projection of the segment's closest point to the center.
  const len2 = A;
  if (len2 > 0) {
    const t = Math.max(0, Math.min(1, -(fx * dx + fy * dy) / len2));
    const p = { x: a.x + t * dx, y: a.y + t * dy };
    if (angleInArc(Math.atan2(p.y - g.c.y, p.x - g.c.x), g.a0, g.sweep))
      candidates.push(Math.abs(dist(p, g.c) - g.rad));
  }
  return Math.min(...candidates);
}

/** Exact distance between two arc curves (0 when crossing). */
export function arcArc(g1: ArcGeom, g2: ArcGeom): number {
  const d = dist(g1.c, g2.c);
  // Circle-circle intersections inside both ranges mean contact.
  if (d > 1e-9 && d <= g1.rad + g2.rad && d >= Math.abs(g1.rad - g2.rad)) {
    const a = (g1.rad * g1.rad - g2.rad * g2.rad + d * d) / (2 * d);
    const h2 = g1.rad * g1.rad - a * a;
    const h = Math.sqrt(Math.max(0, h2));
    const mx = g1.c.x + ((g2.c.x - g1.c.x) * a) / d;
    const my = g1.c.y + ((g2.c.y - g1.c.y) * a) / d;
    for (const sgn of [1, -1]) {
      const p = {
        x: mx + (sgn * h * (g2.c.y - g1.c.y)) / d,
        y: my - (sgn * h * (g2.c.x - g1.c.x)) / d,
      };
      if (
        angleInArc(Math.atan2(p.y - g1.c.y, p.x - g1.c.x), g1.a0, g1.sweep) &&
        angleInArc(Math.atan2(p.y - g2.c.y, p.x - g2.c.x), g2.a0, g2.sweep)
      )
        return 0;
    }
  }
  const candidates = [
    pointArc(arcStart(g1), g2),
    pointArc(arcEnd(g1), g2),
    pointArc(arcStart(g2), g1),
    pointArc(arcEnd(g2), g1),
  ];
  // Closest/farthest radial configuration along the center line.
  if (d > 1e-9) {
    const ang12 = Math.atan2(g2.c.y - g1.c.y, g2.c.x - g1.c.x);
    for (const [a1c, a2c] of [
      [ang12, ang12 + Math.PI], // facing points (external gap)
      [ang12, ang12], // g2 behind its center (internal)
      [ang12 + Math.PI, ang12 + Math.PI],
    ] as const) {
      if (angleInArc(a1c, g1.a0, g1.sweep) && angleInArc(a2c, g2.a0, g2.sweep))
        candidates.push(dist(arcPoint(g1, a1c), arcPoint(g2, a2c)));
    }
  }
  return Math.min(...candidates);
}

function polyEdges(pts: Vec2[]): [Vec2, Vec2][] {
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]!] as [Vec2, Vec2]);
}

/**
 * A running minimum over squared distances, with a bounding-box rejection in
 * front of it.
 *
 * The exact-integer `SEG` routines are `BigInt` arithmetic and cost roughly
 * four times what the doubles they replaced did — which does not matter for one
 * pair and matters a great deal in these loops, where a copper item is measured
 * against every edge of a board outline or a zone fill. Two segments whose
 * bounding boxes are separated by more than the current best distance along
 * *either* axis cannot beat it, and that test is four comparisons of doubles.
 *
 * The rejection is a pure optimisation: `limit` is the square root of the best
 * squared distance so far plus a margin of 2 IU, which is many orders of
 * magnitude more than the rounding in either `Math.sqrt` or the `BigInt` to
 * `Number` conversion that produced it, so nothing within reach is ever
 * rejected. `Infinity` before the first candidate rejects nothing at all.
 */
class NearestSq {
  best = Number.POSITIVE_INFINITY;
  private limit = Number.POSITIVE_INFINITY;

  /** Can no point in this box beat the running best? */
  outOfReach(aMinX: number, aMinY: number, aMaxX: number, aMaxY: number): boolean {
    return (
      this.boxMinX - aMaxX > this.limit ||
      aMinX - this.boxMaxX > this.limit ||
      this.boxMinY - aMaxY > this.limit ||
      aMinY - this.boxMaxY > this.limit
    );
  }

  constructor(
    private readonly boxMinX: number,
    private readonly boxMinY: number,
    private readonly boxMaxX: number,
    private readonly boxMaxY: number,
  ) {}

  offer(aSquaredDist: number): void {
    if (aSquaredDist < this.best) {
      this.best = aSquaredDist;
      this.limit = Math.sqrt(aSquaredDist) + 2;
    }
  }
}

/** {@link NearestSq} keyed on a single point. */
const nearestToPoint = (p: Vec2): NearestSq => new NearestSq(p.x, p.y, p.x, p.y);

/** {@link NearestSq} keyed on a segment. */
const nearestToSeg = (a: Vec2, b: Vec2): NearestSq =>
  new NearestSq(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));

/** Is this edge out of the running best's reach? */
const edgeOutOfReach = (aNear: NearestSq, a: Vec2, b: Vec2): boolean =>
  aNear.outOfReach(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));

/**
 * Free gap between two shapes (0 when touching/overlapping), as
 * `SHAPE::Collide` would have reported it in `aActual`.
 *
 * Every pair below minimises a **squared** distance and truncates once at the
 * end, which is where upstream's `(int)` sits.
 *
 * Truncating inside the loop and minimising the truncated distances would give
 * the *same* answer — `Math.trunc( Math.sqrt( … ) )` is monotone, so it commutes
 * with `min` — and is only wasteful. What must not move is the **subtraction**:
 * taking a radius off inside the loop puts it on the wrong side of the cast, and
 * a half-integral radius then shifts the answer by an IU. The single
 * {@link gap} call at each `return` is what keeps that impossible.
 */
export function shapeDist(s1: Shape, s2: Shape): number {
  // Normalize order: circle < stadium < arc < poly.
  const order = { circle: 0, stadium: 1, arc: 2, poly: 3 } as const;
  if (order[s1.kind] > order[s2.kind]) return shapeDist(s2, s1);

  if (s1.kind === 'circle' && s2.kind === 'circle')
    return gap(pointPointSq(s1.c, s2.c), s1.r, s2.r);
  if (s1.kind === 'circle' && s2.kind === 'stadium')
    return gap(pointSegSq(s1.c, s2.a, s2.b), s1.r, s2.r);
  if (s1.kind === 'circle' && s2.kind === 'arc')
    return gapFromDistance(pointArc(s1.c, s2), s1.r, s2.r);
  if (s1.kind === 'circle' && s2.kind === 'poly') {
    if (pointInPoly(s1.c, s2.pts)) return 0;
    const near = nearestToPoint(s1.c);
    for (const [a, b] of polyEdges(s2.pts)) {
      if (edgeOutOfReach(near, a, b)) continue;
      near.offer(pointSegSq(s1.c, a, b));
    }
    return gap(near.best, s1.r, s2.r);
  }
  if (s1.kind === 'stadium' && s2.kind === 'stadium')
    return gap(segSegSq(s1.a, s1.b, s2.a, s2.b), s1.r, s2.r);
  if (s1.kind === 'stadium' && s2.kind === 'arc')
    return gapFromDistance(segArc(s1.a, s1.b, s2), s1.r, s2.r);
  if (s1.kind === 'stadium' && s2.kind === 'poly') {
    if (pointInPoly(s1.a, s2.pts) || pointInPoly(s1.b, s2.pts)) return 0;
    const near = nearestToSeg(s1.a, s1.b);
    for (const [a, b] of polyEdges(s2.pts)) {
      if (edgeOutOfReach(near, a, b)) continue;
      near.offer(segSegSq(s1.a, s1.b, a, b));
    }
    return gap(near.best, s1.r, s2.r);
  }
  if (s1.kind === 'arc' && s2.kind === 'arc') return gapFromDistance(arcArc(s1, s2), s1.r, s2.r);
  if (s1.kind === 'arc' && s2.kind === 'poly') {
    if (pointInPoly(arcStart(s1), s2.pts) || pointInPoly(arcEnd(s1), s2.pts)) return 0;
    let best = Infinity;
    for (const [a, b] of polyEdges(s2.pts)) best = Math.min(best, segArc(a, b, s1));
    return gapFromDistance(best, s1.r, s2.r);
  }
  // poly-poly
  if (s1.kind === 'poly' && s2.kind === 'poly') {
    if (s1.pts.some((p) => pointInPoly(p, s2.pts))) return 0;
    if (s2.pts.some((p) => pointInPoly(p, s1.pts))) return 0;
    const bEdges = polyEdges(s2.pts);
    let best = Number.POSITIVE_INFINITY;
    for (const [a1, a2] of polyEdges(s1.pts)) {
      const near = nearestToSeg(a1, a2);
      near.offer(best);
      for (const [b1, b2] of bEdges) {
        if (edgeOutOfReach(near, b1, b2)) continue;
        near.offer(segSegSq(a1, a2, b1, b2));
      }
      best = Math.min(best, near.best);
    }
    return gap(best, s1.r, s2.r);
  }
  return 0; // unreachable
}

export function shapeBBox(s: Shape): { minX: number; minY: number; maxX: number; maxY: number } {
  if (s.kind === 'circle')
    return { minX: s.c.x - s.r, minY: s.c.y - s.r, maxX: s.c.x + s.r, maxY: s.c.y + s.r };
  if (s.kind === 'stadium')
    return {
      minX: Math.min(s.a.x, s.b.x) - s.r,
      minY: Math.min(s.a.y, s.b.y) - s.r,
      maxX: Math.max(s.a.x, s.b.x) + s.r,
      maxY: Math.max(s.a.y, s.b.y) + s.r,
    };
  if (s.kind === 'arc') {
    // Conservative: the full circle's box (exact per-quadrant not needed for
    // a broad-phase box).
    const R = s.rad + s.r;
    return { minX: s.c.x - R, minY: s.c.y - R, maxX: s.c.x + R, maxY: s.c.y + R };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of s.pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - s.r, minY: minY - s.r, maxX: maxX + s.r, maxY: maxY + s.r };
}

/** `SHAPE::Move`: the same shape, translated. */
export function moveShape(s: Shape, delta: Vec2): Shape {
  const mv = (p: Vec2): Vec2 => ({ x: p.x + delta.x, y: p.y + delta.y });

  if (s.kind === 'circle') return { ...s, c: mv(s.c) };
  if (s.kind === 'stadium') return { ...s, a: mv(s.a), b: mv(s.b) };
  if (s.kind === 'arc') return { ...s, c: mv(s.c) };
  return { ...s, pts: s.pts.map(mv) };
}

/**
 * The per-shape-pair collision table.
 * Counterpart: `libs/kimath/src/geometry/shape_collisions.cpp`, plus the
 * `Collide`/`NearestPoint`/`Intersect` members it reaches for in `seg.cpp`,
 * `circle.cpp`, `shape_arc.cpp`, `shape_line_chain.cpp`, `shape_circle.h` and
 * `shape_segment.h`.
 *
 * ## Why this exists: `aLocation`
 *
 * `SHAPE::Collide` answers three questions at once — *do they collide*, *by how
 * much*, and *where*. The repo already had the first two: `shapeDist` is an
 * exact clamped gap for every pair of shapes Ziro models, and
 * `defaultShapeCollider`, below, turns it into upstream's verdict.
 * What it could not answer is *where*, and `ITEM::collideSimple` needs that to
 * decide castellation and net-tie exclusions.
 *
 * **`aLocation` is not the point of closest approach, and it is not the same
 * kind of point from one pair to the next.** Circle against circle returns the
 * midpoint of the two *centres*, which can lie outside both discs. Segment
 * against segment returns a point on the *first* argument's segment, so
 * swapping the arguments moves the answer. A chain that contains the other
 * shape's first point returns that point rather than anything on the chain.
 * Every case below states which of these it is; a "sensible" or "consistent"
 * location would be a wrong location, silently.
 *
 * ## Ziro's shapes against KiCad's classes
 *
 * | Ziro `Shape`  | KiCad                                            |
 * |---------------|--------------------------------------------------|
 * | `circle`      | `SHAPE_CIRCLE( c, r )`                           |
 * | `stadium`     | `SHAPE_SEGMENT( a, b, width = 2r )`              |
 * | `arc`         | `SHAPE_ARC` with `width = 2r`                    |
 * | `poly, r = 0` | `SHAPE_SIMPLE`, a closed `SHAPE_LINE_CHAIN_BASE` |
 * | `poly, r > 0` | nothing — see {@link collideShapes}              |
 *
 * `SHAPE_RECT`, `SHAPE_ELLIPSE`, `SHAPE_COMPOUND` and `SHAPE_POLY_SET` have no
 * counterpart in Ziro's union, so their rows of upstream's dispatch table are
 * not ported. Rectangles reach this code as `poly`s.
 *
 * ## Coordinates
 *
 * KiCad works in `int` nanometres and truncates or `KiROUND`s every
 * intermediate. Ziro's `Shape` carries floating-point coordinates — `arcShape`
 * yields a float centre, radius and radians, `padShapes` yields float vertices —
 * so there is no integer grid to round onto, and the representational rounding
 * is dropped. Rounding that *drives a branch* is kept, because dropping it would
 * change control flow: `KiROUND` on the distance in {@link arcCollidePoint}
 * decides whether its `if( !dist )` recomputation runs, the same routine's
 * snap-to-endpoint path measures with `VECTOR2<int>::EuclideanNorm`, and the two
 * arc pairs round `sqrt( dist_sq )` before clamping it. `SEG::Contains`'s `<= 3`
 * and `MIN_PRECISION_IU`'s `4` are absolute tolerances in IU and are kept
 * verbatim.
 *
 * ## `aMTV` and the unrequested out-parameters
 *
 * Upstream threads a fourth out-parameter, the minimum translation vector, and
 * asserts it away in every pair but the two circle ones. The `ShapeCollider`
 * interface has no MTV, so it is dropped entirely rather than computed and
 * discarded.
 *
 * `aActual` and `aLocation`, on the other hand, are *always* wanted here, which
 * makes upstream's `if( !aActual ) break` fast paths unreachable. They are
 * marked at each site rather than deleted, because their absence is the kind of
 * thing a reader would otherwise have to re-derive from the C++.
 */

// ----- the result --------------------------------------------------------------

/** One `SHAPE::Collide( other, aClearance, &aActual, &aLocation )` answer. */
export interface ShapeCollisionResult {
  collides: boolean;
  /** `aActual`: the measured gap, clamped at 0 where upstream clamps it. */
  actual: number;
  /** `aLocation`: null exactly when `collides` is false. */
  location: Vec2 | null;
}

/**
 * The two out-parameters, as one mutable record.
 *
 * Upstream passes `int*` and `VECTOR2I*` and writes through them only on the
 * paths that return true — so a routine that tries several candidates leaves
 * the *last successful* one behind, not the best one. {@link arcCollideSeg}
 * depends on exactly that, so the out-parameters are modelled as a record that
 * is mutated rather than as a return value that is composed.
 */
interface Out {
  actual: number;
  location: Vec2;
}

const newOut = (): Out => ({ actual: 0, location: { x: 0, y: 0 } });

// ----- vector helpers ----------------------------------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const norm2 = (v: Vec2): number => v.x * v.x + v.y * v.y;
const distSq = (a: Vec2, b: Vec2): number => norm2(sub(a, b));
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const sq = (v: number): number => v * v;

/**
 * `(int) sqrt( dist_sq )` — upstream's cast, which every one of the five
 * `aActual` sites in this file applies to the **square root alone**, before any
 * radius or half-width is taken off it:
 *
 * ```cpp
 * *aActual = std::max( 0, (int) sqrt( dist_sq ) - aA.GetRadius() - aB.GetRadius() );
 * ```
 *
 * — `shape_collisions.cpp:55`, and the same expression at `shape_circle.h:100`,
 * `shape_segment.h:97` and `shape_segment.h:117`. `shape_line_chain.cpp:420`
 * writes `*aActual = sqrt( closest_dist_sq )` with no subtraction, which narrows
 * to the `int*` and so truncates in exactly the same place.
 *
 * **`aActual` is an `int*` in all five.** Upstream cannot report a fractional
 * actual, so neither may we; a fractional one is a divergence, not extra
 * precision.
 *
 * **The order of operations is the point.** Truncating the whole `sqrt - r`
 * expression instead agrees only when the subtracted radii are integral *and*
 * the root's fraction survives the subtraction — for a root of 250.6 against a
 * clearance whose half-width is 125.5 (Ziro's odd-width `stadium`, whose `r` is
 * `width / 2` untruncated) the C++ order gives `250 - 125.5 = 124.5` and the
 * other order gives 125. It matters again wherever the caller compares the
 * actual against a threshold: {@link collideArcChain} ranks candidates by
 * `local.actual` and breaks on an exact zero.
 *
 * `Math.trunc( Math.sqrt( … ) )` is bit-exact with the C++: both take an IEEE
 * double square root of the same double and truncate toward zero. It is
 * deliberately **not** kimath's `isqrt`, the exact integer floor — for a large
 * `k`, `(int) sqrt( k * k - 1 )` returns `k` because the true root rounds up to
 * `k` in double, where `isqrt` returns `k - 1`. `SEG::Distance` uses `isqrt`;
 * these five sites do not, and the two spellings are kept apart on purpose.
 */
const truncSqrt = (aSquaredDist: number): number => Math.trunc(Math.sqrt(aSquaredDist));

/**
 * `VECTOR2::Resize`: the same direction, the given length.
 *
 * The integer instantiation computes each component as
 * `sqrt( rescale( len², x², l² ) )` carrying the sign of the component, which is
 * algebraically `len·x / l`; the difference is the integer rounding, which this
 * port drops. A zero vector stays zero, as upstream.
 */
const resize = (v: Vec2, aNewLength: number): Vec2 => {
  if (v.x === 0 && v.y === 0) return { x: 0, y: 0 };

  const l = Math.hypot(v.x, v.y);
  return { x: (v.x * aNewLength) / l, y: (v.y * aNewLength) / l };
};

// ----- SEG ---------------------------------------------------------------------
//
// There is no `SEG` here. Upstream's `shape_collisions.cpp` builds its segments
// out of the same `SEG` the PNS router uses — `SEG trackSeg( track->GetStart(),
// track->GetEnd() )` in `pcbnew/drc/drc_test_provider_copper_clearance.cpp:269`
// is literally the class `libs/kimath/src/geometry/seg.cpp` defines — so this
// module uses ours, `@ziroeda/kimath/src/geometry/seg.ts`, rather than a second
// copy in doubles.
//
// That single change is not cosmetic and is the whole risk of this file: kimath
// is exact-integer, as `VECTOR2I` is, where the copies deleted from here were
// floating point. Three consequences, all of them upstream's behaviour:
//
//  1. **Coordinates are quantised to 1 IU.** `VECTOR2I` cannot hold a fraction,
//     and neither can any shape KiCad collides — `SHAPE_ARC::GetCenter()`
//     returns a `const VECTOR2I&` (`shape_arc.h:121`), pad outlines are
//     `SHAPE_POLY_SET`s of `VECTOR2I`. Ziro's `Shape` carries doubles because
//     `arcShape` computes a centre and `padShapes` rotates vertices, so passing
//     one to a `SEG` rounds it — which reproduces the rounding KiCad already did
//     when it built the SHAPE, rather than inventing one.
//  2. **`actual` floors instead of rounding.** `SEG::Distance` is `isqrt`, the
//     largest integer whose square does not exceed the argument, not
//     `round( hypot(…) )`.
//  3. **An exact touch is now exactly zero.** `SEG::Collide` short-circuits on
//     `SquaredDistance == 0`; in doubles, a point genuinely on the segment came
//     back as ~1e-9 instead and took the clearance branch, reporting a non-zero
//     `actual` for a touching pair.
//
// The one thing that is *not* an integer here is the clearance and the
// half-widths the callers below add to it — `aClearance + halfWidth` is
// upstream's own `int` arithmetic, but Ziro's `stadium.r` is `width / 2` and so
// half-integral on an odd width. That is a `Shape`-construction divergence, not
// a `SEG` one, and is left alone.

/**
 * `SEG::Collide( const SEG&, int, int* )`, adapted to the {@link Out} record.
 *
 * kimath returns `actual` as a field because upstream writes through `aActual`
 * on every path including the false one (`seg.cpp:620`); this wrapper copies it
 * across unconditionally for the same reason.
 */
function segCollideOut(aA: Seg, aB: Seg, aClearance: number, aOut: Out): boolean {
  const { collides, actual } = segCollide(aA, aB, aClearance);

  aOut.actual = actual;

  return collides;
}

// ----- CIRCLE ------------------------------------------------------------------

/** `CIRCLE`: what `SHAPE_CIRCLE` wraps, and what the arc code borrows. */
export interface CollideCircle {
  c: Vec2;
  r: number;
}

/** `SHAPE::MIN_PRECISION_IU`. */
const MIN_PRECISION_IU = 4;

/**
 * `CIRCLE::NearestPoint`. A point at the centre has no nearest point, and
 * upstream picks `+x` arbitrarily rather than returning the centre.
 */
export function circleNearestPoint(aCircle: CollideCircle, aP: Vec2): Vec2 {
  const vec = sub(aP, aCircle.c);

  if (vec.x === 0 && vec.y === 0) return add({ x: aCircle.r, y: 0 }, aCircle.c);

  return add(resize(vec, aCircle.r), aCircle.c);
}

/** `CIRCLE::FurthestPoint`, the same with the vector reversed. */
export function circleFurthestPoint(aCircle: CollideCircle, aP: Vec2): Vec2 {
  const vec = sub(aCircle.c, aP);

  if (vec.x === 0 && vec.y === 0) return add({ x: aCircle.r, y: 0 }, aCircle.c);

  return add(resize(vec, aCircle.r), aCircle.c);
}

/** `CIRCLE::IntersectLine`: 0, 1 (tangent) or 2 points on the *infinite* line. */
function circleIntersectLine(aCircle: CollideCircle, aLine: Seg): Vec2[] {
  const m = segLineProject(aLine, aCircle.c);
  const omDist = Math.hypot(m.x - aCircle.c.x, m.y - aCircle.c.y);

  if (omDist > aCircle.r + MIN_PRECISION_IU) return [];

  if (omDist >= aCircle.r - MIN_PRECISION_IU) return [m]; // tangent

  const mTo1dist = Math.sqrt(aCircle.r * aCircle.r - omDist * omDist);
  const mTo1vec = resize(sub(aLine.b, aLine.a), mTo1dist);

  return [add(mTo1vec, m), add({ x: -mTo1vec.x, y: -mTo1vec.y }, m)];
}

/** `CIRCLE::Intersect( const SEG& )`: the line intersections that are on the segment. */
export function circleIntersectSeg(aCircle: CollideCircle, aSeg: Seg): Vec2[] {
  return circleIntersectLine(aCircle, aSeg).filter((p) => segContains(aSeg, p));
}

/**
 * `CIRCLE::Intersect( const CIRCLE& )`.
 *
 * Co-centred circles return nothing even when their radii match, because there
 * is no isolated intersection to report.
 */
export function circleIntersectCircle(aA: CollideCircle, aB: CollideCircle): Vec2[] {
  const vecCtoC = sub(aB.c, aA.c);
  const d = Math.hypot(vecCtoC.x, vecCtoC.y);
  const r1 = aA.r;
  const r2 = aB.r;

  if (d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  if (d === 0) return [];

  const x = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const r1sqMinusXsq = r1 * r1 - x * x;

  if (r1sqMinusXsq < 0) return [];

  const y = Math.sqrt(r1sqMinusXsq);

  // `RotatePoint( solution, -rotAngle )` where `rotAngle = EDA_ANGLE( vecCtoC )`.
  // EDA_ANGLE measures from a vector with the y axis negated, and rotating by
  // its negation is exactly aligning the +x axis with `vecCtoC` — which in
  // plain screen coordinates is this 2x2 rotation by `atan2( dy, dx )`.
  const cosA = vecCtoC.x / d;
  const sinA = vecCtoC.y / d;
  const place = (px: number, py: number): Vec2 => ({
    x: aA.c.x + px * cosA - py * sinA,
    y: aA.c.y + px * sinA + py * cosA,
  });

  const retval = [place(x, y)];

  if (y !== 0) retval.push(place(x, -y));

  return retval;
}

// ----- SHAPE_CIRCLE ------------------------------------------------------------

/**
 * `SHAPE_CIRCLE::Collide( const SEG& )` — a **location** source.
 *
 * The location is a point on **the segment**, except when the segment passes
 * exactly through the centre (`dist_sq == 0`) *and* the circle actually cuts it,
 * in which case it is the first of the two circle/segment intersections. Note
 * that upstream computes that intersection list twice, once to test it and once
 * to read `[0]`; the second call is what the value comes from.
 */
export function shapeCircleCollideSeg(
  aCircle: CollideCircle,
  aSeg: Seg,
  aClearance: number,
  aOut: Out,
): boolean {
  const minDist = aClearance + aCircle.r;
  const pn = segNearestPoint(aSeg, aCircle.c);
  const dSq = distSq(pn, aCircle.c);

  if (dSq === 0 || dSq < sq(minDist)) {
    const pts = circleIntersectSeg(aCircle, aSeg);

    aOut.location = pts.length > 0 && dSq === 0 ? (pts[0] as Vec2) : pn;
    aOut.actual = Math.max(0, truncSqrt(dSq) - aCircle.r);

    return true;
  }

  return false;
}

// ----- SHAPE_SEGMENT -----------------------------------------------------------

/**
 * `SHAPE_SEGMENT`. Ziro's `stadium` stores the half-width directly, so
 * upstream's two spellings of it — `( m_width + 1 ) / 2` in
 * `SHAPE_SEGMENT::Collide` and `GetWidth() / 2` in the pair functions, which
 * differ by one for an odd width — collapse to the same number here. Ziro's
 * `PNS::SEGMENT` builds `r` as `width / 2` without truncating, so an odd-width
 * track sits half a unit inside upstream's `( w + 1 ) / 2` and half a unit
 * outside its `w / 2`; that is a property of the `stadium` shape, not of this
 * port.
 */
export interface CollideSegment {
  seg: Seg;
  /** `GetWidth() / 2`. */
  halfWidth: number;
}

/** `SHAPE_SEGMENT::Collide( const VECTOR2I& )` — location on **this** segment. */
function shapeSegmentCollidePoint(
  aA: CollideSegment,
  aP: Vec2,
  aClearance: number,
  aOut: Out,
): boolean {
  const minDist = aA.halfWidth + aClearance;
  const dSq = segSquaredDistanceToPoint(aA.seg, aP);

  if (dSq === 0 || dSq < sq(minDist)) {
    aOut.location = segNearestPoint(aA.seg, aP);
    aOut.actual = Math.max(0, truncSqrt(dSq) - aA.halfWidth);

    return true;
  }

  return false;
}

/**
 * `SHAPE_SEGMENT::Collide( const SEG& )` — a **location** source.
 *
 * The location is `m_seg.NearestPoint( aSeg )`, i.e. a point on **this** shape's
 * segment, never on the segment it was handed. That is what makes segment
 * against segment asymmetric.
 */
export function shapeSegmentCollideSeg(
  aA: CollideSegment,
  aSeg: Seg,
  aClearance: number,
  aOut: Out,
): boolean {
  if (same(aSeg.a, aSeg.b)) return shapeSegmentCollidePoint(aA, aSeg.a, aClearance, aOut);

  const minDist = aA.halfWidth + aClearance;
  const dSq = segSquaredDistanceToSeg(aA.seg, aSeg);

  if (dSq === 0 || dSq < sq(minDist)) {
    aOut.location = segNearestPointToSeg(aA.seg, aSeg);
    aOut.actual = Math.max(0, truncSqrt(dSq) - aA.halfWidth);

    return true;
  }

  return false;
}

// ----- SHAPE_LINE_CHAIN_BASE ---------------------------------------------------

/**
 * A closed `SHAPE_LINE_CHAIN_BASE` — upstream's `SHAPE_SIMPLE`, which is what a
 * Ziro `poly` is. Open chains are not constructible from the `Shape` union, so
 * every `aB.IsClosed() && …` in the C++ has a constant `true` on its left and is
 * transcribed as the right-hand side alone. That is the one place a future open
 * chain would have to re-add a test rather than merely pass a flag.
 */
export interface CollideChain {
  pts: readonly Vec2[];
}

const chainSegmentCount = (aChain: CollideChain): number => aChain.pts.length;

const chainSegment = (aChain: CollideChain, aIndex: number): Seg => ({
  a: aChain.pts[aIndex] as Vec2,
  b: aChain.pts[(aIndex + 1) % aChain.pts.length] as Vec2,
});

/**
 * `SHAPE_LINE_CHAIN_BASE::PointInside` with the default accuracy.
 *
 * Not `drc_geometry`'s `pointInPoly`: upstream casts its ray in the **positive
 * x** direction and brackets with `p1.y >= aPt.y != p2.y >= aPt.y`, where
 * `pointInPoly` uses strict `>`. The two disagree on a point level with a
 * vertex, and containment here is not a tie-breaker — it decides both the
 * verdict and the reported location.
 *
 * The `aAccuracy > 1` arm, which falls back to `PointOnEdge`, is not reachable:
 * every caller in `shape_collisions.cpp` takes the default accuracy of 0.
 */
export function chainPointInside(aChain: CollideChain, aPt: Vec2): boolean {
  const pointCount = aChain.pts.length;

  if (pointCount < 3) return false;

  let inside = false;

  for (let i = 0; i < pointCount; ) {
    const p1 = aChain.pts[i++] as Vec2;
    const p2 = aChain.pts[i === pointCount ? 0 : i] as Vec2;
    const diff = sub(p2, p1);

    if (diff.y === 0) continue;

    const d = (diff.x * (aPt.y - p1.y)) / diff.y;

    if (p1.y >= aPt.y !== p2.y >= aPt.y && aPt.x - p1.x < d) inside = !inside;
  }

  return inside;
}

/**
 * `SHAPE_LINE_CHAIN_BASE::Collide( const SEG& )` — a **location** source.
 *
 * Two different kinds of point come out of this. When the chain encloses the
 * segment's *first* endpoint the location is that endpoint — a point on the
 * segment, and specifically `A` rather than whichever end is deeper inside.
 * Otherwise it is `NearestPoint` on the winning chain segment, a point on the
 * chain.
 */
export function chainCollideSeg(
  aChain: CollideChain,
  aSeg: Seg,
  aClearance: number,
  aOut: Out,
): boolean {
  if (chainPointInside(aChain, aSeg.a)) {
    aOut.location = aSeg.a;
    aOut.actual = 0;
    return true;
  }

  let closestDistSq = Number.POSITIVE_INFINITY;
  const clearanceSq = sq(aClearance);
  let nearest: Vec2 = { x: 0, y: 0 };

  for (let i = 0; i < chainSegmentCount(aChain); i++) {
    const s = chainSegment(aChain, i);
    const dSq = segSquaredDistanceToSeg(s, aSeg);

    if (dSq < closestDistSq) {
      nearest = segNearestPointToSeg(s, aSeg);
      closestDistSq = dSq;

      if (closestDistSq === 0) break;

      // `closest_dist_sq < clearance_sq && !aActual` — unreachable, aActual is
      // always wanted here.
    }
  }

  if (closestDistSq === 0 || closestDistSq < clearanceSq) {
    aOut.location = nearest;
    aOut.actual = truncSqrt(closestDistSq);

    return true;
  }

  return false;
}

// ----- the pair table ----------------------------------------------------------

/**
 * `Collide( const SHAPE_CIRCLE&, const SHAPE_CIRCLE& )`.
 *
 * **Location: the midpoint of the two centres.** Not a point of contact, not on
 * either circumference — for two large discs barely touching it sits deep inside
 * both, and for two small circles it sits in the empty space between them.
 *
 * The verdict is `dist_sq == 0 || dist_sq < min_dist_sq` where `dist_sq` is the
 * squared distance between the **centres**, so the `== 0` arm means *co-centred*
 * rather than *overlapping*. That is a real difference from
 * `defaultShapeCollider`, which reads `d === 0` off the clamped gap and so calls
 * two exactly-touching circles a collision at any clearance. Here they collide
 * only when `rA + rB < clearance + rA + rB`, i.e. when the clearance is
 * positive — and `collideSimple` does hand this routine a clearance of `-1`.
 */
export function collideCircleCircle(
  aA: CollideCircle,
  aB: CollideCircle,
  aClearance: number,
  aOut: Out,
): boolean {
  const minDist = aClearance + aA.r + aB.r;
  const minDistSq = sq(minDist);

  const dSq = distSq(aB.c, aA.c);

  if (dSq === 0 || dSq < minDistSq) {
    aOut.actual = Math.max(0, truncSqrt(dSq) - aA.r - aB.r);
    aOut.location = { x: (aA.c.x + aB.c.x) / 2, y: (aA.c.y + aB.c.y) / 2 };

    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_CIRCLE&, const SHAPE_SEGMENT& )`.
 *
 * **Location: on the segment** (see {@link shapeCircleCollideSeg}). The
 * segment's half-width is folded into the clearance and taken back off the
 * actual afterwards, so it never moves the location off the segment's
 * centreline.
 */
export function collideCircleSegment(
  aA: CollideCircle,
  aSeg: CollideSegment,
  aClearance: number,
  aOut: Out,
): boolean {
  if (shapeCircleCollideSeg(aA, aSeg.seg, aClearance + aSeg.halfWidth, aOut)) {
    aOut.actual = Math.max(0, aOut.actual - aSeg.halfWidth);
    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_CIRCLE&, const SHAPE_LINE_CHAIN_BASE& )`.
 *
 * **Location: the circle's own centre** when the chain encloses it, otherwise a
 * point on whichever chain segment gave the smallest `collision_dist` — which by
 * {@link shapeCircleCollideSeg}'s rule is a point on *that segment*.
 *
 * Ties keep the earlier segment (strict `<`), so the chain's winding order is
 * observable in the answer.
 */
export function collideCircleChain(
  aA: CollideCircle,
  aB: CollideChain,
  aClearance: number,
  aOut: Out,
): boolean {
  let closestDist = Number.POSITIVE_INFINITY;
  let nearest: Vec2 = { x: 0, y: 0 };

  if (chainPointInside(aB, aA.c)) {
    nearest = aA.c;
    closestDist = 0;
  } else {
    for (let s = 0; s < chainSegmentCount(aB); s++) {
      const local = newOut();

      if (shapeCircleCollideSeg(aA, chainSegment(aB, s), aClearance, local)) {
        if (local.actual < closestDist) {
          nearest = local.location;
          closestDist = local.actual;
        }

        if (closestDist === 0) break;

        // `if( !aActual ) break` — unreachable, aActual is always wanted.
      }
    }
  }

  if (closestDist === 0 || closestDist < aClearance) {
    aOut.location = nearest;
    aOut.actual = closestDist;

    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_SEGMENT&, const SHAPE_SEGMENT& )`.
 *
 * **Location: on `aA`'s segment.** Swapping the two arguments moves the answer
 * to the other segment, and `ITEM::collideSimple` calls the collider with the
 * *head* first, so the location a router obstacle carries is a point on the head.
 */
export function collideSegmentSegment(
  aA: CollideSegment,
  aB: CollideSegment,
  aClearance: number,
  aOut: Out,
): boolean {
  const rv = shapeSegmentCollideSeg(aA, aB.seg, aClearance + aB.halfWidth, aOut);

  if (rv) aOut.actual = Math.max(0, aOut.actual - aB.halfWidth);

  return rv;
}

/**
 * `Collide( const SHAPE_LINE_CHAIN_BASE&, const SHAPE_SEGMENT& )`.
 *
 * **Location: on the chain**, or the segment's `A` endpoint when the chain
 * encloses it. The dispatch always puts the chain first, so this is the answer
 * for a `poly` against a `stadium` whichever order the caller used.
 */
export function collideChainSegment(
  aA: CollideChain,
  aB: CollideSegment,
  aClearance: number,
  aOut: Out,
): boolean {
  const rv = chainCollideSeg(aA, aB.seg, aClearance + aB.halfWidth, aOut);

  if (rv) aOut.actual = Math.max(0, aOut.actual - aB.halfWidth);

  return rv;
}

/**
 * `Collide( const SHAPE_LINE_CHAIN_BASE&, const SHAPE_LINE_CHAIN_BASE& )`.
 *
 * **Location: on `aA`'s segment** in the general case, or one of the two
 * chains' *first point* when one encloses the other's — note that it is
 * `GetPoint( 0 )` and not any kind of deepest or nearest point.
 *
 * The two segment lists are sorted by `( A.x, A.y )` before the double loop, and
 * that sort is load-bearing: the winner is chosen with a strict `<`, so among
 * segments at equal distance it is the sort that decides which point comes back.
 *
 * Upstream follows the loop with a block that re-collides any true arcs held by
 * a `SHAPE_LINE_CHAIN`. A Ziro `poly` is a `SHAPE_SIMPLE` with `ArcCount() == 0`,
 * so that block cannot fire and is not ported.
 */
export function collideChainChain(
  aA: CollideChain,
  aB: CollideChain,
  aClearance: number,
  aOut: Out,
): boolean {
  let closestDist = Number.POSITIVE_INFINITY;
  let nearest: Vec2 = { x: 0, y: 0 };

  if (aA.pts.length > 0 && chainPointInside(aB, aA.pts[0] as Vec2)) {
    closestDist = 0;
    nearest = aA.pts[0] as Vec2;
  } else if (aB.pts.length > 0 && chainPointInside(aA, aB.pts[0] as Vec2)) {
    closestDist = 0;
    nearest = aB.pts[0] as Vec2;
  } else {
    // `IsArcSegment` filtering does not apply: these chains carry no arcs.
    const segSort = (a: Seg, b: Seg): number => (a.a.x !== b.a.x ? a.a.x - b.a.x : a.a.y - b.a.y);

    const aSegs: Seg[] = [];
    const bSegs: Seg[] = [];

    for (let ii = 0; ii < chainSegmentCount(aA); ii++) aSegs.push(chainSegment(aA, ii));
    for (let ii = 0; ii < chainSegmentCount(aB); ii++) bSegs.push(chainSegment(aB, ii));

    aSegs.sort(segSort);
    bSegs.sort(segSort);

    for (const aSeg of aSegs) {
      for (const bSeg of bSegs) {
        const local = newOut();

        if (segCollideOut(aSeg, bSeg, aClearance, local)) {
          if (local.actual < closestDist) {
            nearest = segNearestPointToSeg(aSeg, bSeg);
            closestDist = local.actual;
          }

          // Upstream breaks the *inner* loop only, so an exact touch found early
          // does not stop the outer walk.
          if (closestDist === 0) break;

          // `if( !aActual ) break` — unreachable, aActual is always wanted.
        }
      }
    }
  }

  if (closestDist === 0 || closestDist < aClearance) {
    aOut.location = nearest;
    aOut.actual = closestDist;

    return true;
  }

  return false;
}

// ----- SHAPE_ARC ---------------------------------------------------------------

/**
 * `SHAPE_ARC`, in Ziro's parameterisation.
 *
 * Upstream stores three points — start, mid, end — and derives the centre, the
 * radius and the angles from them on demand. Ziro's `arc` shape stores the
 * centre, the radius and a signed angular sweep, and derives the three points.
 * The two describe the same curve, and every routine below is written against
 * whichever of the two the C++ actually reads.
 *
 * ## The sign of an angle
 *
 * `EDA_ANGLE( VECTOR2I )` is `atan2( -v.y, v.x )` — KiCad negates y so that
 * angles run anticlockwise on a screen whose y axis points down. Ziro's
 * `arcShape` uses a plain `atan2( v.y, v.x )`. **Every Ziro angle is therefore
 * the negation of the corresponding KiCad angle**, `GetCentralAngle() > 0`
 * becomes `sweep < 0`, and each `<` in an angular comparison becomes a `>`.
 * Both flips are applied together at each site, with a note; applying one
 * without the other silently mirrors the arc.
 */
export interface CollideArc {
  c: Vec2;
  rad: number;
  /** `GetStartAngle()`, negated: Ziro measures in the plain screen plane. */
  a0: number;
  /** `GetCentralAngle()`, negated. */
  sweep: number;
  /** `GetWidth() / 2`. */
  halfWidth: number;
}

const normTau = (a: number): number => ((a % TAU) + TAU) % TAU;

const arcPointAt = (aArc: CollideArc, aAngle: number): Vec2 => ({
  x: aArc.c.x + aArc.rad * Math.cos(aAngle),
  y: aArc.c.y + aArc.rad * Math.sin(aAngle),
});

/** `GetP0()` / `m_start`. */
const arcP0 = (aArc: CollideArc): Vec2 => arcPointAt(aArc, aArc.a0);
/** `GetP1()` / `m_end`. */
const arcP1 = (aArc: CollideArc): Vec2 => arcPointAt(aArc, aArc.a0 + aArc.sweep);
/** `m_mid`. */
const arcMid = (aArc: CollideArc): Vec2 => arcPointAt(aArc, aArc.a0 + aArc.sweep / 2);

/**
 * Upstream's `m_start != m_end` test, which is how `SHAPE_ARC::Collide` asks
 * "is this a full circle?".
 *
 * Asking it of the two *recomputed* endpoints would be the obvious
 * transcription and it is not this, because `cos( a0 )` and `cos( a0 ± 2π )`
 * differ in the last bit and a closed arc would report two distinct ends.
 * Asking it of the parameters — is the sweep a whole number of turns — is exact:
 * `arcShape` emits `0 - TAU` for a closed arc, and `-TAU % TAU` is `-0`.
 *
 * How much that is worth is worth being precise about, because it is less than
 * it looks. For the **negative** full turn `arcShape` actually produces, the
 * naive endpoint comparison is harmless by accident: it makes this false, the
 * angular test in {@link arcCollidePoint} then runs with `ccw` true and
 * `rotatedEndAngle` normalising to `0`, and its `rotatedPtAngle < 0` can never
 * hold, so nothing is rejected after all. It is a **positive** full turn — legal
 * in the `Shape` union, though no current producer emits one — where the two
 * disagree: there `ccw` is false, the test becomes `rotatedPtAngle > 0`, and
 * every point but the start snaps to an endpoint. That case is what the test
 * over this guard pins.
 */
const arcIsFullCircle = (aArc: CollideArc): boolean => normTau(aArc.sweep) === 0;

/**
 * `SHAPE_ARC::sliceContainsPoint`: is the point's bearing from the centre inside
 * the swept range? Nothing to do with the radius.
 *
 * `drc_geometry`'s `angleInArc` asks the same question but allows a `1e-12`
 * slop; upstream has none, and the boundary decides both the verdict and the
 * location in {@link arcNearestPointsCircle}, so this is written out rather than
 * reused.
 */
export function arcSliceContainsPoint(aArc: CollideArc, aP: Vec2): boolean {
  const phi = Math.atan2(aP.y - aArc.c.y, aP.x - aArc.c.x);

  // `if( ca >= ANGLE_0 )` — with the sign flip, KiCad's non-negative central
  // angle is Ziro's non-positive sweep.
  if (aArc.sweep <= 0) return normTau(aArc.a0 - phi) <= -aArc.sweep;

  return normTau(phi - aArc.a0) <= aArc.sweep;
}

/**
 * `SEG::ApproxCollinear`, in floating point.
 *
 * `libs/kimath/src/geometry/seg.ts` has an exact-integer `segApproxCollinear`,
 * but it converts through `BigInt` and an arc's derived start/mid/end are not
 * integers. The int64 version's `rescale` rounding — which that file documents
 * as widening the effective threshold from 1 IU to about 1.22 — is what is lost
 * here; the perpendicular distances themselves are the same quantity.
 *
 * The longer segment supplies the line, ties keep `a`, and a zero-length longer
 * segment is not collinear with anything.
 */
function approxCollinear(aA: Seg, aB: Seg, aDistanceThreshold = 1): boolean {
  let a1 = aA.a;
  let a2 = aA.b;
  let b1 = aB.a;
  let b2 = aB.b;

  if (distSq(a1, a2) < distSq(b1, b2)) {
    [a1, a2, b1, b2] = [b1, b2, a1, a2];
  }

  const p = a1.y - a2.y;
  const q = a2.x - a1.x;
  const r = -p * a1.x - q * a1.y;
  const l = p * p + q * q;

  if (l === 0) return false;

  const det1 = p * b1.x + q * b1.y + r;
  const det2 = p * b2.x + q * b2.y + r;

  const thresholdSquared = aDistanceThreshold * aDistanceThreshold;

  return (det1 * det1) / l <= thresholdSquared && (det2 * det2) / l <= thresholdSquared;
}

/**
 * `SHAPE_ARC::IsEffectiveLine`: an arc so flat that its three points are
 * collinear to within a unit, *and* that does not double back on itself.
 *
 * Every arc pair tests this first and, when it holds, re-dispatches through a
 * `SHAPE_SEGMENT` — which means the reported location changes from an
 * arc-flavoured one to a segment-flavoured one. It is not a performance
 * shortcut.
 */
export function arcIsEffectiveLine(aArc: CollideArc): boolean {
  const start = arcP0(aArc);
  const mid = arcMid(aArc);
  const end = arcP1(aArc);

  const v1: Seg = { a: start, b: mid };
  const v2: Seg = { a: mid, b: end };

  return approxCollinear(v1, v2) && dot(sub(v1.b, v1.a), sub(v2.b, v2.a)) > 0;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * `SHAPE_ARC::BBox( aClearance )`, over the exact arc box rather than the whole
 * circle's: the two endpoints plus whichever of the four axis extremes the sweep
 * actually reaches.
 *
 * `drc_geometry`'s `shapeBBox` deliberately returns the looser full-circle box,
 * which would be *behaviour-identical* here — the box is only ever used to
 * reject, and a superset can only reject things that are genuinely out of range.
 * The exact one is used anyway, because the inflation below is upstream's and
 * pairing it with a different box would make the numbers unreadable.
 *
 * A full turn needs no special case: {@link arcSliceContainsPoint} answers true
 * for every bearing when `|sweep|` is `2π`, so all four extremes are collected
 * on their own. Short-circuiting on {@link arcIsFullCircle} here would also
 * catch a *zero* sweep, and hand a degenerate arc the whole circle's box.
 */
function arcBBox(aArc: CollideArc, aClearance: number): Box {
  const pts: Vec2[] = [arcP0(aArc), arcP1(aArc)];

  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const p = arcPointAt(aArc, a);

    if (arcSliceContainsPoint(aArc, p)) pts.push(p);
  }

  const box: Box = {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };

  // `if( m_width != 0 ) bbox.Inflate( KiROUND( m_width / 2.0 ) + 1 )`, where
  // `m_width / 2.0` is this shape's half-width.
  const inflate = (d: number): void => {
    box.minX -= d;
    box.minY -= d;
    box.maxX += d;
    box.maxY += d;
  };

  if (aArc.halfWidth !== 0) inflate(KiROUND(aArc.halfWidth) + 1);
  if (aClearance !== 0) inflate(aClearance);

  return box;
}

const boxContains = (aBox: Box, aP: Vec2): boolean =>
  aP.x >= aBox.minX && aP.x <= aBox.maxX && aP.y >= aBox.minY && aP.y <= aBox.maxY;

/**
 * `SHAPE_ARC::Collide( const VECTOR2I& )` — a **location** source.
 *
 * The location is a point on the arc: the radial projection of `aP` onto the
 * arc's circle when the bearing is inside the sweep, and otherwise the nearer of
 * the two *endpoints*, snapped to. It is never `aP` itself.
 *
 * Two of upstream's integer roundings are kept here because they change control
 * flow rather than just precision. `dist` is `KiROUND`ed, and a rounded-to-zero
 * distance sends the routine down a branch that recomputes it as the *signed*
 * `radius - |aP - centre|` — which can come out negative for a point just
 * outside the circle, and then clamps to a zero actual. The snap-to-endpoint
 * measurements use `VECTOR2<int>::EuclideanNorm`, which rounds half away from
 * zero rather than truncating, and the two endpoints are compared with a strict
 * `<` so a point equidistant from both snaps to the *end*.
 *
 * The `radius >= INT_MAX / 2` fallback is not ported: it exists because `CIRCLE`
 * stores its radius as an `int` and the arithmetic below would overflow, and a
 * JavaScript number has no such edge. Such an arc is flat enough that
 * {@link arcIsEffectiveLine} has already diverted every pair function that could
 * reach here.
 */
export function arcCollidePoint(
  aArc: CollideArc,
  aP: Vec2,
  aClearance: number,
  aOut: Out,
): boolean {
  const minDist = aClearance + aArc.halfWidth;

  if (!boxContains(arcBBox(aArc, minDist), aP)) return false;

  const fullCircle: CollideCircle = { c: aArc.c, r: aArc.rad };
  let nearestPt = circleNearestPoint(fullCircle, aP);
  let dist = KiROUND(Math.hypot(nearestPt.x - aP.x, nearestPt.y - aP.y));

  // Angle from centre to the point.
  const angleToPt = Math.atan2(aP.y - aArc.c.y, aP.x - aArc.c.x);

  if (!dist) {
    // Keep the sqrt of the squared distance rather than a EuclideanNorm, which
    // would truncate to an integer before the subtraction.
    dist = KiROUND(aArc.rad - Math.sqrt(distSq(aP, aArc.c)));
    nearestPt = arcPointAt(aArc, angleToPt);
  }

  // If not a 360 degree arc, need to use arc angles to decide if point collides.
  if (!arcIsFullCircle(aArc)) {
    // `ccw = GetCentralAngle() > ANGLE_0`, and both the sign and the two
    // comparisons flip into Ziro's convention together.
    const ccw = aArc.sweep < 0;
    const rotatedPtAngle = normTau(angleToPt - aArc.a0);
    const rotatedEndAngle = normTau(aArc.sweep);

    if ((ccw && rotatedPtAngle < rotatedEndAngle) || (!ccw && rotatedPtAngle > rotatedEndAngle)) {
      const distStartpt = EuclideanNormI(sub(aP, arcP0(aArc)));
      const distEndpt = EuclideanNormI(sub(aP, arcP1(aArc)));

      if (distStartpt < distEndpt) {
        dist = distStartpt;
        nearestPt = arcP0(aArc);
      } else {
        dist = distEndpt;
        nearestPt = arcP1(aArc);
      }
    }
  }

  if (dist <= minDist) {
    aOut.location = nearestPt;
    aOut.actual = Math.max(0, dist - aArc.halfWidth);

    return true;
  }

  return false;
}

/**
 * `SHAPE_ARC::Collide( const SEG& )` — a **location** source, and the sharpest
 * edge in this file.
 *
 * Upstream builds a list of candidate points and calls
 * {@link arcCollidePoint} on each. **There is no minimisation**: every candidate
 * that collides overwrites `aActual` and `aLocation`, so what comes back is the
 * *last* colliding candidate in list order, not the nearest one. The early
 * return only fires on an exact zero. Reordering the candidate list, or picking
 * the closest instead, would produce a location that looks entirely reasonable
 * and is not the one KiCad reports.
 *
 * The list is: the circle/segment intersections first, then the segment's
 * nearest points to the centre and to the two arc endpoints, then the segment's
 * own two ends.
 *
 * The leading branch is a different routine altogether: an arc of more than a
 * half turn whose ends are closer together than the clearance is treated as a
 * *disc*, because a segment cannot pass between its ends without touching it —
 * unless it is entirely inside the hole, which is what the two-endpoint test
 * above it checks.
 */
export function arcCollideSeg(aArc: CollideArc, aSeg: Seg, aClearance: number, aOut: Out): boolean {
  const circle: CollideCircle = { c: aArc.c, r: aArc.rad };
  const clearanceSq = sq(aClearance);

  // `GetCentralAngle().AsDegrees() > 180.0` — KiCad's central angle is the
  // negation of Ziro's sweep, so a KiCad angle above half a turn is a Ziro sweep
  // below minus half a turn.
  const centralAngle = -aArc.sweep;

  if (centralAngle > Math.PI && distSq(arcP0(aArc), arcP1(aArc)) < clearanceSq) {
    const aDistSq = distSq(aSeg.a, aArc.c);
    const bDistSq = distSq(aSeg.b, aArc.c);
    const radiusSq = sq(aArc.rad - aClearance);

    if (aDistSq < radiusSq && bDistSq < radiusSq) return false;

    return shapeCircleCollideSeg(circle, aSeg, aClearance, aOut);
  }

  // Possible points of the collision are:
  // 1. Intersection of the segment with the full circle
  // 2. Closest point on the segment to the center of the circle
  // 3. Closest point on the segment to the end points of the arc
  // 4. End points of the segment
  const candidatePts: Vec2[] = [
    ...circleIntersectSeg(circle, aSeg),
    segNearestPoint(aSeg, aArc.c),
    segNearestPoint(aSeg, arcP0(aArc)),
    segNearestPoint(aSeg, arcP1(aArc)),
    aSeg.a,
    aSeg.b,
  ];

  let anyCollides = false;

  for (const candidate of candidatePts) {
    const collides = arcCollidePoint(aArc, candidate, aClearance, aOut);

    anyCollides = anyCollides || collides;

    // `if( collides && ( !aActual || *aActual == 0 ) )` — aActual is always
    // wanted, so only an exact zero stops the walk.
    if (collides && aOut.actual === 0) return true;
  }

  return anyCollides;
}

/** The three things a `NearestPoints` overload writes. */
interface NearestPoints {
  ptA: Vec2;
  ptB: Vec2;
  distSq: number;
}

/**
 * `SHAPE_ARC::NearestPoints( const SHAPE_CIRCLE& )`.
 *
 * Note the tail, which runs unconditionally: `ptA` is pushed half the arc's
 * width towards `ptB`, and the distance is then *zeroed* if it was inside that
 * half-width.
 *
 * Upstream has a latent bug there: if no candidate passed the slice test, `ptA`
 * and `ptB` are still the default `(0, 0)`, the push is a no-op on a zero
 * vector, `Infinity < (width/2)²` is false, and the routine reports a zero
 * distance between two origins — a collision at the origin. It is transcribed
 * rather than fixed, but it is **not** reachable and so is not pinned by a test:
 * two of the three candidates are the arc's own endpoints, and an arc's
 * endpoints are always inside its own slice. Only a floating-point disagreement
 * between `a0` and `atan2` applied to the point `a0` generated could get here.
 */
export function arcNearestPointsCircle(aArc: CollideArc, aCircle: CollideCircle): NearestPoints {
  if (same(aArc.c, aCircle.c) && aArc.rad === aCircle.r) {
    const p = arcP0(aArc);
    return { ptA: p, ptB: p, distSq: 0 };
  }

  let out: NearestPoints = { ptA: { x: 0, y: 0 }, ptB: { x: 0, y: 0 }, distSq: Infinity };

  const circle1: CollideCircle = { c: aArc.c, r: aArc.rad };

  for (const pt of circleIntersectCircle(circle1, aCircle)) {
    if (arcSliceContainsPoint(aArc, pt)) return { ptA: pt, ptB: pt, distSq: 0 };
  }

  for (const pt of [arcP0(aArc), arcP1(aArc), circleNearestPoint(circle1, aCircle.c)]) {
    if (arcSliceContainsPoint(aArc, pt)) {
      const nearestPt2 = circleNearestPoint(aCircle, pt);
      const d = distSq(pt, nearestPt2);

      if (d < out.distSq) out = { ptA: pt, ptB: nearestPt2, distSq: d };
    }
  }

  // Adjust point A by half the arc width towards point B.
  const dir = resize(sub(out.ptB, out.ptA), aArc.halfWidth);
  const ptA = add(out.ptA, dir);

  return {
    ptA,
    ptB: out.ptB,
    distSq: out.distSq < sq(aArc.halfWidth) ? 0 : distSq(ptA, out.ptB),
  };
}

/**
 * `SHAPE_ARC::NearestPoints( const SHAPE_ARC& )`.
 *
 * Four things here are easy to "tidy" and must not be:
 *
 * - the endpoint-against-endpoint sweep returns immediately on an exact zero
 *   **without** the width adjustment, so two arcs sharing a vertex report that
 *   vertex and a zero distance whatever their widths;
 * - the two endpoint-against-circle passes *overwrite* the running best rather
 *   than comparing against it, so a worse pair can replace a better one;
 * - concentric arcs (`colocated`) return whatever those passes left behind,
 *   again without the width adjustment;
 * - a genuine circle/circle intersection inside both slices returns a zero
 *   distance without the width adjustment as well.
 */
export function arcNearestPointsArc(aA: CollideArc, aB: CollideArc): NearestPoints {
  const state: NearestPoints = { ptA: { x: 0, y: 0 }, ptB: { x: 0, y: 0 }, distSq: Infinity };

  const adjustForArcWidths = (): void => {
    // Adjust point A by half the arc-width towards point B.
    let dir = resize(sub(state.ptB, state.ptA), aA.halfWidth);
    state.ptA = add(state.ptA, dir);

    // Adjust point B by half the other arc-width towards point A.
    dir = resize(sub(state.ptA, state.ptB), aB.halfWidth);
    state.ptB = add(state.ptB, dir);

    state.distSq =
      state.distSq < sq(aA.halfWidth + aB.halfWidth) ? 0 : distSq(state.ptA, state.ptB);
  };

  const center1 = aA.c;
  const center2 = aB.c;

  // Centers aren't exact, so center_dist_sq won't be exact either.
  const centerDistSq = distSq(center1, center2);
  const centerEpsilon = KiROUND(Math.min(aA.rad, aB.rad) / 1000);
  const colocated = centerDistSq < sq(centerEpsilon);

  const pts1 = [arcP0(aA), arcP1(aA)];
  const pts2 = [arcP0(aB), arcP1(aB)];

  // Start by checking endpoints.
  for (const pt1 of pts1) {
    for (const pt2 of pts2) {
      const d = distSq(pt1, pt2);

      if (d < state.distSq) {
        state.distSq = d;
        state.ptA = pt1;
        state.ptB = pt2;

        // No width adjustment on this path.
        if (state.distSq === 0) return { ...state };
      }
    }
  }

  for (const pt of pts1) {
    if (arcSliceContainsPoint(aB, pt)) {
      const circle: CollideCircle = { c: center2, r: aB.rad };

      // Unconditional: this can replace a better pair found above.
      state.ptA = pt;
      state.ptB = circleNearestPoint(circle, pt);
      state.distSq = distSq(state.ptA, state.ptB);

      if (colocated || state.distSq === 0) {
        if (state.distSq !== 0) adjustForArcWidths();

        return { ...state };
      }
    }
  }

  for (const pt of pts2) {
    if (arcSliceContainsPoint(aA, pt)) {
      const circle: CollideCircle = { c: center1, r: aA.rad };

      state.ptA = circleNearestPoint(circle, pt);
      state.ptB = pt;
      state.distSq = distSq(state.ptA, state.ptB);

      if (colocated || state.distSq === 0) {
        if (state.distSq !== 0) adjustForArcWidths();

        return { ...state };
      }
    }
  }

  // The remaining checks require the arcs to be on non-concentric circles.
  if (colocated) return { ...state };

  const circle1: CollideCircle = { c: center1, r: aA.rad };
  const circle2: CollideCircle = { c: center2, r: aB.rad };

  // First check for intersections on the circles.
  for (const pt of circleIntersectCircle(circle1, circle2)) {
    if (arcSliceContainsPoint(aA, pt) && arcSliceContainsPoint(aB, pt)) {
      return { ptA: pt, ptB: pt, distSq: 0 };
    }
  }

  // Closest pair of points on the two full circles. For external the pair faces
  // each other between the centers, so each is the nearest point on its circle
  // to the other center. For one circle strictly inside the other the pair lies
  // on the same side, so the outer circle's pt is nearest to the inner center
  // and the inner circle's pt is furthest from the outer center.
  const r1 = aA.rad;
  const r2 = aB.rad;
  const contained = centerDistSq < sq(r1 - r2);

  let pt1: Vec2;
  let pt2: Vec2;

  if (contained && r1 > r2) {
    pt1 = circleNearestPoint(circle1, center2);
    pt2 = circleFurthestPoint(circle2, center1);
  } else if (contained) {
    pt1 = circleFurthestPoint(circle1, center2);
    pt2 = circleNearestPoint(circle2, center1);
  } else {
    pt1 = circleNearestPoint(circle1, center2);
    pt2 = circleNearestPoint(circle2, center1);
  }

  const pt1InSlice = arcSliceContainsPoint(aA, pt1);
  const pt2InSlice = arcSliceContainsPoint(aB, pt2);

  if (pt1InSlice && pt2InSlice) {
    const d = distSq(pt1, pt2);

    if (d < state.distSq) {
      state.distSq = d;
      state.ptA = pt1;
      state.ptB = pt2;
    }

    adjustForArcWidths();
    return { ...state };
  }

  // Check the endpoints of arc 1 against the nearest point on arc 2.
  if (pt2InSlice) {
    for (const pt of pts1) {
      const d = distSq(pt, pt2);

      if (d < state.distSq) {
        state.distSq = d;
        state.ptA = pt;
        state.ptB = pt2;
      }
    }
  }

  // Check the endpoints of arc 2 against the nearest point on arc 1.
  if (pt1InSlice) {
    for (const pt of pts2) {
      const d = distSq(pt1, pt);

      if (d < state.distSq) {
        state.distSq = d;
        state.ptA = pt1;
        state.ptB = pt;
      }
    }
  }

  adjustForArcWidths();
  return { ...state };
}

/** `SHAPE_SEGMENT( aA.GetP0(), aA.GetP1(), aA.GetWidth() )`, the flat-arc stand-in. */
const arcAsSegment = (aArc: CollideArc): CollideSegment => ({
  seg: { a: arcP0(aArc), b: arcP1(aArc) },
  halfWidth: aArc.halfWidth,
});

/**
 * `Collide( const SHAPE_ARC&, const SHAPE_CIRCLE& )`.
 *
 * **Location: the midpoint of the two nearest points**, which is a third kind of
 * answer again — not a centre midpoint as for two circles, and not a point on
 * either shape. It lands inside the gap between them.
 *
 * The verdict compares against `aClearance` alone, with nothing added for either
 * shape's thickness — both are already inside `dist_sq`, which
 * {@link arcNearestPointsCircle} measures between a point pushed half the arc's
 * width outwards and a point on the circle's *circumference*. So `dist_sq` is
 * the copper gap and the comparison is `gap² < clearance²`, unlike the circle
 * and segment pairs, which fold a half-width into the clearance and subtract it
 * again.
 */
export function collideArcCircle(
  aA: CollideArc,
  aB: CollideCircle,
  aClearance: number,
  aOut: Out,
): boolean {
  if (arcIsEffectiveLine(aA)) {
    return collideCircleSegment(aB, arcAsSegment(aA), aClearance, aOut);
  }

  const { ptA, ptB, distSq: dSq } = arcNearestPointsCircle(aA, aB);

  if (dSq === 0 || dSq < sq(aClearance)) {
    aOut.location = { x: (ptA.x + ptB.x) / 2, y: (ptA.y + ptB.y) / 2 };
    aOut.actual = Math.max(0, KiROUND(Math.sqrt(dSq)));

    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_ARC&, const SHAPE_SEGMENT& )`.
 *
 * **Location: on the arc** — {@link arcCollideSeg}'s last colliding candidate,
 * which {@link arcCollidePoint} always resolves onto the arc itself.
 */
export function collideArcSegment(
  aA: CollideArc,
  aB: CollideSegment,
  aClearance: number,
  aOut: Out,
): boolean {
  if (arcIsEffectiveLine(aA)) {
    return collideSegmentSegment(arcAsSegment(aA), aB, aClearance, aOut);
  }

  const rv = arcCollideSeg(aA, aB.seg, aClearance + aB.halfWidth, aOut);

  if (rv) aOut.actual = Math.max(0, aOut.actual - aB.halfWidth);

  return rv;
}

/**
 * `Collide( const SHAPE_ARC&, const SHAPE_LINE_CHAIN_BASE& )`.
 *
 * **Location: the arc's `P0`** when the chain encloses it — its *start* point,
 * not the deepest or the nearest — and otherwise the winning chain segment's
 * answer from {@link arcCollideSeg}, which is a point on the arc.
 *
 * Upstream also has a `SHAPE_LINE_CHAIN` overload that walks the chain's own
 * arcs and shares its `pn` across two loops. Ziro polys are `SHAPE_SIMPLE`s and
 * dispatch to this one, so that variant is not ported.
 */
export function collideArcChain(
  aA: CollideArc,
  aB: CollideChain,
  aClearance: number,
  aOut: Out,
): boolean {
  if (arcIsEffectiveLine(aA)) {
    return collideChainSegment(aB, arcAsSegment(aA), aClearance, aOut);
  }

  let closestDist = Number.POSITIVE_INFINITY;
  let nearest: Vec2 = { x: 0, y: 0 };

  if (chainPointInside(aB, arcP0(aA))) {
    closestDist = 0;
    nearest = arcP0(aA);
  } else {
    for (let i = 0; i < chainSegmentCount(aB); i++) {
      const local = newOut();

      if (arcCollideSeg(aA, chainSegment(aB, i), aClearance, local)) {
        if (local.actual < closestDist) {
          nearest = local.location;
          closestDist = local.actual;
        }

        if (closestDist === 0) break;

        // `if( !aActual ) break` — unreachable, aActual is always wanted.
      }
    }
  }

  if (closestDist === 0 || closestDist < aClearance) {
    aOut.location = nearest;
    aOut.actual = closestDist;

    return true;
  }

  return false;
}

/**
 * `Collide( const SHAPE_ARC&, const SHAPE_ARC& )`.
 *
 * **Location: the midpoint of the two nearest points.** Note which way round the
 * two flat-arc diversions go: a flat `aA` re-enters as `Collide( aB, segment )`,
 * putting the *other* arc first, while a flat `aB` keeps `aA` first. So a pair
 * with one flat arc reports a location on whichever arc is still curved.
 */
export function collideArcArc(
  aA: CollideArc,
  aB: CollideArc,
  aClearance: number,
  aOut: Out,
): boolean {
  if (arcIsEffectiveLine(aA)) return collideArcSegment(aB, arcAsSegment(aA), aClearance, aOut);
  if (arcIsEffectiveLine(aB)) return collideArcSegment(aA, arcAsSegment(aB), aClearance, aOut);

  const { ptA, ptB, distSq: dSq } = arcNearestPointsArc(aA, aB);

  if (dSq === 0 || dSq < sq(aClearance)) {
    aOut.location = { x: (ptA.x + ptB.x) / 2, y: (ptA.y + ptB.y) / 2 };
    aOut.actual = Math.max(0, KiROUND(Math.sqrt(dSq)));

    return true;
  }

  return false;
}

// ----- bridging Ziro's Shape onto the classes ----------------------------------

const asCircle = (s: Shape & { kind: 'circle' }): CollideCircle => ({ c: s.c, r: s.r });

const asSegment = (s: Shape & { kind: 'stadium' }): CollideSegment => ({
  seg: { a: s.a, b: s.b },
  halfWidth: s.r,
});

const asChain = (s: Shape & { kind: 'poly' }): CollideChain => ({ pts: s.pts });

const asArc = (s: Shape & { kind: 'arc' }): CollideArc => ({
  c: s.c,
  rad: s.rad,
  a0: s.a0,
  sweep: s.sweep,
  halfWidth: s.r,
});

/**
 * `collideSingleShapes`' dispatch, restricted to the pairs Ziro can build.
 *
 * Upstream's table reaches each pair function through `CollCase<Ta,Tb>`, which
 * calls `Collide( Ta, Tb )` in argument order, or `CollCaseReversed`, which
 * swaps them. Both are written out here as explicit calls, because *which*
 * argument ends up first is exactly what decides where the location lands.
 *
 * The arc always ends up first when it meets a circle, a segment or a chain —
 * upstream has no `Collide( X, SHAPE_ARC )` at all, only the reversed dispatch
 * entries — so those three pairs are symmetric in the caller's argument order,
 * while segment/segment and chain/chain are not.
 */
function collideSingleShapes(aA: Shape, aB: Shape, aClearance: number, aOut: Out): boolean {
  if (aA.kind === 'circle') {
    if (aB.kind === 'circle')
      return collideCircleCircle(asCircle(aA), asCircle(aB), aClearance, aOut);
    if (aB.kind === 'stadium')
      return collideCircleSegment(asCircle(aA), asSegment(aB), aClearance, aOut);
    if (aB.kind === 'poly') return collideCircleChain(asCircle(aA), asChain(aB), aClearance, aOut);
    // `CollCaseReversed<SHAPE_CIRCLE, SHAPE_ARC>`: the arc goes first.
    return collideArcCircle(asArc(aB), asCircle(aA), aClearance, aOut);
  }

  if (aA.kind === 'stadium') {
    // `CollCaseReversed<SHAPE_SEGMENT, SHAPE_CIRCLE>`: the circle goes first.
    if (aB.kind === 'circle')
      return collideCircleSegment(asCircle(aB), asSegment(aA), aClearance, aOut);
    if (aB.kind === 'stadium')
      return collideSegmentSegment(asSegment(aA), asSegment(aB), aClearance, aOut);
    // `CollCase<SHAPE_LINE_CHAIN_BASE, SHAPE_SEGMENT>( aB, aA )`: chain first.
    if (aB.kind === 'poly')
      return collideChainSegment(asChain(aB), asSegment(aA), aClearance, aOut);
    // `CollCaseReversed<SHAPE_SEGMENT, SHAPE_ARC>`: the arc goes first.
    return collideArcSegment(asArc(aB), asSegment(aA), aClearance, aOut);
  }

  if (aA.kind === 'poly') {
    // `CollCase<SHAPE_CIRCLE, SHAPE_LINE_CHAIN_BASE>( aB, aA )`: circle first.
    if (aB.kind === 'circle')
      return collideCircleChain(asCircle(aB), asChain(aA), aClearance, aOut);
    if (aB.kind === 'stadium')
      return collideChainSegment(asChain(aA), asSegment(aB), aClearance, aOut);
    if (aB.kind === 'poly') return collideChainChain(asChain(aA), asChain(aB), aClearance, aOut);
    // `CollCaseReversed<SHAPE_LINE_CHAIN_BASE, SHAPE_ARC>`: the arc goes first.
    return collideArcChain(asArc(aB), asChain(aA), aClearance, aOut);
  }

  // `case SH_ARC:` — every entry is a plain `CollCase<SHAPE_ARC, X>`, arc first.
  if (aB.kind === 'circle') return collideArcCircle(asArc(aA), asCircle(aB), aClearance, aOut);
  if (aB.kind === 'stadium') return collideArcSegment(asArc(aA), asSegment(aB), aClearance, aOut);
  if (aB.kind === 'poly') return collideArcChain(asArc(aA), asChain(aB), aClearance, aOut);

  return collideArcArc(asArc(aA), asArc(aB), aClearance, aOut);
}

/**
 * `SHAPE::Collide( const SHAPE*, int, int*, VECTOR2I* )`.
 *
 * ### The `poly.r` bridge
 *
 * Ziro's `poly` carries an outward inflation that KiCad has no SHAPE for:
 * upstream would model a rounded-rect pad as a `SHAPE_RECT` with a corner radius
 * or as a `SHAPE_COMPOUND`, and would model a stroked polygon primitive as a
 * chain of `SHAPE_SEGMENT`s. Rather than invent a shape class, the inflation is
 * folded into the clearance and taken back off the actual — which is precisely
 * what upstream does for a `SHAPE_SEGMENT`'s half-width in
 * `Collide( SHAPE_LINE_CHAIN_BASE, SHAPE_SEGMENT )`:
 *
 * ```
 * rv = aA.Collide( aB.GetSeg(), aClearance + aB.GetWidth() / 2, aActual, aLocation );
 * if( rv && aActual ) *aActual = std::max( 0, *aActual - aB.GetWidth() / 2 );
 * ```
 *
 * The consequence for the location is upstream's too: it stays on the
 * *un-inflated skeleton*, the polygon outline, rather than on the inflated
 * boundary the copper actually has.
 */
export function collideShapes(aA: Shape, aB: Shape, aClearance: number): ShapeCollisionResult {
  const rA = aA.kind === 'poly' ? aA.r : 0;
  const rB = aB.kind === 'poly' ? aB.r : 0;

  const out = newOut();
  const collides = collideSingleShapes(aA, aB, aClearance + rA + rB, out);

  if (!collides) return { collides: false, actual: 0, location: null };

  return { collides: true, actual: Math.max(0, out.actual - rA - rB), location: out.location };
}

// ----- the shape collision seam ------------------------------------------------

/** One `SHAPE::Collide( other, clearance, &actual, &location )` result. */
export interface ShapeCollision {
  collides: boolean;
  /** The measured gap, clamped at 0 when the shapes touch or overlap. */
  actual: number;
  /**
   * Where the collision happened. Null when the collider cannot say — see
   * {@link defaultShapeCollider}.
   */
  location: Vec2 | null;
}

export type ShapeCollider = (a: Shape, b: Shape, clearance: number) => ShapeCollision;

/**
 * The stand-in for `SHAPE::Collide`.
 *
 * The **verdict** is exact. Upstream's generic answer, repeated at the bottom of
 * every pair-specific routine in `shape_collisions.cpp`, is
 * `closest_dist == 0 || closest_dist < aClearance`, over a distance that is
 * clamped at zero when the shapes overlap. `shapeDist` from the DRC geometry is
 * that same clamped distance, computed exactly for every pair of shapes this
 * repo models, so the condition transfers verbatim. Note the consequence at the
 * boundary: a *zero* clearance still collides on touching shapes but not on
 * shapes exactly one unit apart, and that asymmetry is upstream's, not a typo.
 *
 * The **location** is not exact and is therefore not guessed. Upstream's
 * `aLocation` is defined per shape pair and is frequently not the point of
 * closest approach at all — circle against circle hands back the midpoint of the
 * two *centres*, which can lie well outside both. Inventing a plausible point
 * would put a number into `QueryEdgeExclusions` and `IsNetTieExclusion` that
 * looks right and answers wrong. So this collider reports `location: null`, and
 * {@link PnsItem.collide} throws rather than proceed if a rule resolver claims a
 * castellation or net-tie case that needs one. Installing a location-capable
 * collider — the job of a real `shape_collisions` port — makes that path work
 * with no change to the item model.
 */
export const defaultShapeCollider: ShapeCollider = (a, b, clearance) => {
  const d = shapeDist(a, b);
  return { collides: d === 0 || d < clearance, actual: d, location: null };
};

let shapeCollider: ShapeCollider = defaultShapeCollider;

export const getShapeCollider = (): ShapeCollider => shapeCollider;

/** Install a collider; passing null restores {@link defaultShapeCollider}. */
export function setShapeCollider(aCollider: ShapeCollider | null): void {
  shapeCollider = aCollider ?? defaultShapeCollider;
}

/**
 * One `SHAPE::Collide` between two *composite* shapes.
 *
 * Upstream a `SHAPE*` may be one primitive or many — a `SHAPE_LINE_CHAIN` is a
 * run of segments and arcs, a `SHAPE_COMPOUND` an arbitrary bag. This repo's
 * `Shape` union has only primitives, so "a shape that may be composite" is a
 * *list* of them here, and this is the `Collide` that takes two of those.
 *
 * The verdict is upstream's, and it is upstream's for a reason that is worth
 * stating: `Collide( SHAPE_LINE_CHAIN_BASE&, SHAPE_LINE_CHAIN_BASE& )` tracks
 * `closest_dist` across every primitive pair and finishes on
 * `closest_dist == 0 || closest_dist < aClearance`. The per-pair collider here
 * answers that same predicate over an exact distance, and the predicate is
 * monotone in the distance, so "some pair collides" and "the predicate holds of
 * the minimum" are the same answer. Taking the disjunction lets a pair that
 * collides settle it without the rest being measured being *observable* — it
 * is not, because `actual` and `location` are still reported from the minimum.
 *
 * `location` comes from the minimising pair, first one winning a tie, which is
 * upstream's `nearest`. Two empty lists, or one, collide with nothing: an empty
 * chain has no segments to measure and upstream's `closest_dist` stays at its
 * sentinel.
 */
export function collideShapeLists(
  aA: readonly Shape[],
  aB: readonly Shape[],
  aClearance: number,
): ShapeCollision {
  const collider = getShapeCollider();

  let collides = false;
  let actual = Number.POSITIVE_INFINITY;
  let location: Vec2 | null = null;

  for (const a of aA) {
    for (const b of aB) {
      const hit = collider(a, b, aClearance);

      collides = hit.collides || collides;

      if (hit.actual < actual) {
        actual = hit.actual;
        location = hit.location;
      }
    }
  }

  return { collides, actual, location };
}

/**
 * The adapter that hands `PNS::ITEM` the real `SHAPE::Collide`.
 *
 * Upstream has no counterpart, because upstream has no seam here: `ITEM` calls
 * `SHAPE::Collide` directly and `shape_collisions.cpp` is linked in. The seam
 * exists in this repo because the item model landed before the collision table
 * did, with a stand-in collider that reproduces the verdict but reports
 * `location: null`. This file closes it.
 *
 * Nothing here changes {@link defaultShapeCollider}: a collider that cannot say
 * *where* two shapes met is still the honest default for a caller that has not
 * installed one, and `ITEM::collideSimple`'s throw is what makes that honesty
 * audible rather than silent. Installing this one is what makes the castellation
 * and net-tie paths work.
 */

/**
 * `SHAPE::Collide`, in the shape the item model asks for.
 *
 * The argument order is preserved, not normalised: several of upstream's pairs
 * report a location that lies on the *first* shape, so `collideSimple`'s
 * `collider( shapeH, shapeI, … )` — head first — is what puts the obstacle's
 * location on the head.
 */
export const locatingShapeCollider: ShapeCollider = (aA, aB, aClearance) =>
  collideShapes(aA, aB, aClearance);

/** Install {@link locatingShapeCollider} as the process-wide shape collider. */
export function installLocatingShapeCollider(): void {
  setShapeCollider(locatingShapeCollider);
}
