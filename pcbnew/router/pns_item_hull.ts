// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ITEM::Hull` and the two hull builders it is written on top of.
 * Counterparts: `ArcHull`, `ConvexHull`, `MoveDiagonal` and
 * `BuildHullForPrimitiveShape` (`pcbnew/router/pns_utils.cpp`), plus the five
 * `Hull()` overrides — `SEGMENT::Hull` (`pns_line.cpp:620`), `ARC::Hull`
 * (`pns_arc.cpp:28`), `VIA::Hull` (`pns_via.cpp:235`), `SOLID::Hull`
 * (`pns_solid.cpp:39`) and `HOLE::Hull` (`pns_hole.cpp:57`).
 *
 * ## Why this is a free function and not an item virtual
 *
 * `pns_item.ts` deliberately left `Hull` off `PnsItem`, because the octagon
 * builders already existed as pure functions in `pns_hull.ts` and re-exposing
 * them as a virtual would have forked that module. The note there says the only
 * upstream caller that would notice is `RULE_RESOLVER::HullCache`, whose
 * consumer is `NODE::NearestObstacle`. That consumer is now here, so the
 * dispatch has to exist — as a function over the kind tag, which is what a
 * virtual is anyway.
 *
 * ## Two clearance conventions, one unit apart, and both are upstream's
 *
 * `BuildHullForPrimitiveShape` opens with `cl = aClearance + (aWalkaroundThickness + 1) / 2`
 * — C++ integer division, so a **round-half-up** of half the thickness.
 * `VIA::Hull` and `HOLE::Hull`'s circle branch open with `cl = aClearance + aWalkaroundThickness / 2`,
 * which **truncates**. For an odd walkaround thickness the two differ by one
 * internal unit, and a round pad therefore gets a hull one unit wider than a
 * via of exactly the same diameter. That is not worth unifying: it is the sort
 * of difference that shows up as a route that fits in one build and not the
 * other, and reproducing it costs nothing.
 *
 * A third convention hides inside `BuildHullForPrimitiveShape` itself: the
 * `SEGMENT` and `ARC` arms pass the **raw** `aClearance` and thickness down to
 * `SegmentHull`/`ArcHull` rather than the `cl` computed at the top, because
 * those two builders do their own halving. `cl` is simply unused on those two
 * paths.
 *
 * ## What this repo's shape model cannot reach
 *
 * `SOLID::Hull` and `HOLE::Hull` both branch on `SH_COMPOUND` and, for a
 * compound of several shapes, union the per-primitive hulls through a
 * `SHAPE_POLY_SET`. There is no compound in this repo's {@link Shape} union —
 * a pad is one primitive — so those branches have nothing to dispatch on and
 * are not written. `SH_ELLIPSE` is likewise absent. Both are noted rather than
 * silently dropped: a future compound pad shape needs the union path, and the
 * `Simplify()` it runs is not optional (the outlines genuinely overlap).
 */
import {
  ARC_HIGH_DEF,
  arcCentralAngle,
  arcConvertToPolyline,
  arcRadius,
  shapeArcCenter,
} from './shape_arc_ops.js';
import { intersectLines, type Seg } from './pns_line.js';
import { octagonalHull, resize, segmentHull, type Hull } from './pns_hull.js';
import { PnsKind } from './pns_item.js';
import { getRouterIface } from './pns_collision.js';
import type { PnsArc, ShapeArc } from './pns_arc.js';
import type { PnsItem } from './pns_item.js';
import type { PnsSegment } from './pns_segment.js';
import type { PnsVia } from './pns_via.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `ARC_LOW_DEF` (`include/base_units.h:127,136`): 0.02 mm in PCB internal units. */
export const ARC_LOW_DEF = 20000;

const SQRT1_2 = Math.SQRT1_2;

const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });
const perpendicular = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

/** `SEG::Side`: which side of the directed segment the point falls on. */
const segSide = (s: Seg, p: Vec2): number => {
  const c = (s.b.x - s.a.x) * (p.y - s.a.y) - (s.b.y - s.a.y) * (p.x - s.a.x);
  return c > 0 ? 1 : c < 0 ? -1 : 0;
};

/** C++ `int / int`: truncates towards zero, unlike JS `/`. */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

/** Distance from a point to a segment, and the closest point on it. */
function pointToSeg(s: Seg, p: Vec2): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const lSq = dx * dx + dy * dy;

  if (lSq === 0) return Math.hypot(p.x - s.a.x, p.y - s.a.y);

  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / lSq));

  return Math.hypot(p.x - (s.a.x + dx * t), p.y - (s.a.y + dy * t));
}

/**
 * `SHAPE_LINE_CHAIN::NearestPoint( const SEG&, int& aDist )`, reduced to the
 * distance — the point itself is discarded by this file's only caller.
 *
 * The chain is the *closed* outline of a convex shape, so the wrap-around edge
 * is included. A polygon that is not closed here would let a diagonal slide
 * past the very edge that was meant to stop it.
 */
function chainDistanceToSeg(aVertices: readonly Vec2[], aSeg: Seg): number {
  let best = Number.POSITIVE_INFINITY;
  const n = aVertices.length;

  for (let i = 0; i < n; i++) {
    const a = aVertices[i] as Vec2;
    const b = aVertices[(i + 1) % n] as Vec2;

    // The closest approach between two segments is attained at an endpoint of
    // one of them whenever they do not cross, and a hull diagonal cannot cross
    // the shape it is being slid onto.
    best = Math.min(
      best,
      pointToSeg(aSeg, a),
      pointToSeg(aSeg, b),
      pointToSeg({ a, b }, aSeg.a),
      pointToSeg({ a, b }, aSeg.b),
    );
  }

  return best;
}

/**
 * `MoveDiagonal`: slide one of the octagon's four diagonals inwards until it
 * sits exactly `aClearance` away from the shape.
 *
 * The move is `perpendicular( A - B ).Resize( dist - clearance )`, where `dist`
 * is the chain's current distance to the diagonal. Note the perpendicular is
 * taken of `A - B` and not `B - A`, which is what points the move *inwards*
 * for the winding the four diagonals are built with; swapping them pushes every
 * diagonal out and produces an octagon larger than its own bounding box.
 */
function moveDiagonal(aDiagonal: Seg, aVertices: readonly Vec2[], aClearance: number): Seg {
  const dist = chainDistanceToSeg(aVertices, aDiagonal);
  const moveBy = resize(perpendicular(sub(aDiagonal.a, aDiagonal.b)), dist - aClearance);

  return { a: add(aDiagonal.a, moveBy), b: add(aDiagonal.b, moveBy) };
}

/**
 * `ConvexHull`: the octagon around an arbitrary convex outline.
 *
 * The four axis-aligned sides come straight off the inflated bounding box; the
 * four diagonals start out at 45° through the box's corners and are then slid
 * in against the real outline. The result is the eight pairwise intersections,
 * in the order upstream appends them.
 *
 * The diagonals are seeded with a length of `box.GetHeight()` in each
 * direction — the *height*, for the horizontal reach as well. That is upstream,
 * and it is harmless because {@link intersectLines} works on the infinite
 * lines, so only the diagonals' direction matters.
 */
export function convexHull(aVertices: readonly Vec2[], aClearance: number): Hull {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const v of aVertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }

  // `BBox( aClearance )` inflates by the clearance on every side.
  const x = minX - aClearance;
  const y = minY - aClearance;
  const w = maxX - minX + 2 * aClearance;
  const h = maxY - minY + 2 * aClearance;

  const topline: Seg = { a: { x, y: y + h }, b: { x: x + w, y: y + h } };
  const rightline: Seg = { a: { x: x + w, y: y + h }, b: { x: x + w, y } };
  const bottomline: Seg = { a: { x: x + w, y }, b: { x, y } };
  const leftline: Seg = { a: { x, y }, b: { x, y: y + h } };

  const toprightline = moveDiagonal(
    { a: { x: x + w, y: y + h }, b: { x: x + w + h, y: y + h - h } },
    aVertices,
    aClearance,
  );
  const bottomrightline = moveDiagonal(
    { a: { x: x + w + h, y: y + h }, b: { x: x + w, y } },
    aVertices,
    aClearance,
  );
  const bottomleftline = moveDiagonal(
    { a: { x, y }, b: { x: x - h, y: y + h } },
    aVertices,
    aClearance,
  );
  const topleftline = moveDiagonal(
    { a: { x: x - h, y: y + h - h }, b: { x, y: y + h } },
    aVertices,
    aClearance,
  );

  const octagon: Hull = [];
  const append = (s1: Seg, s2: Seg): void => {
    const p = intersectLines(s1, s2);

    // Upstream dereferences the optional; two of these eight are parallel only
    // for a degenerate (zero-area) box, which a real shape cannot produce.
    if (p) octagon.push({ x: Math.trunc(p.x), y: Math.trunc(p.y) });
  };

  append(leftline, bottomleftline);
  append(bottomline, bottomleftline);
  append(bottomline, bottomrightline);
  append(rightline, bottomrightline);
  append(rightline, toprightline);
  append(topline, toprightline);
  append(topline, topleftline);
  append(leftline, topleftline);

  return octagon;
}

/**
 * `ArcHull`: the envelope of a curved track.
 *
 * The arc is polygonised at `ARC_LOW_DEF` and then offset on both sides — the
 * outer boundary is appended as the walk goes forward, the inner one is
 * collected and appended in reverse at the end, which is what closes the ring.
 * The two ends get the same four-point cap `SegmentHull` uses.
 *
 * ### The "can't route through it" shortcut
 *
 * An arc sweeping more than 180° whose **chord** is shorter than the clearance
 * has no gap a track could pass through, so it is treated as the full circle.
 * Note the test is on the chord and not on the radius: a nearly-closed arc of
 * any size qualifies, and a 190° arc of a large radius does not.
 *
 * ### Vertex normals, not segment offsets
 *
 * At each interior vertex the two adjacent offset segments are *intersected*
 * rather than joined at their endpoints, so the outer boundary comes out mitred
 * instead of notched. That is why the loop keeps both `sa_*` and `sb_*` around.
 */
export function arcHull(aArc: ShapeArc, aClearance: number, aWalkaroundThickness: number): Hull {
  const cl = aClearance + idiv(aWalkaroundThickness + 1, 2);

  const chordLength = Math.hypot(aArc.p1.x - aArc.p0.x, aArc.p1.y - aArc.p0.y);

  if (Math.abs(arcCentralAngle(aArc).AsDegrees()) > 180.0 && chordLength < cl) {
    const r = arcRadius(aArc);

    return octagonalHull(
      { x: shapeArcCenter(aArc).x - r, y: shapeArcCenter(aArc).y - r },
      { x: 2 * r, y: 2 * r },
      cl,
      2.0 * (1.0 - SQRT1_2) * (r + cl),
    );
  }

  const d = idiv(aArc.width, 2) + cl + ARC_HIGH_DEF;
  const x = idiv(Math.trunc((2.0 / (1.0 + Math.SQRT2)) * d), 2);

  const line = arcConvertToPolyline(aArc, ARC_LOW_DEF);
  const segment = (i: number): Seg => {
    const n = line.length - 1;
    const k = i < 0 ? n + i : i;
    return { a: line[k] as Vec2, b: line[k + 1] as Vec2 };
  };
  const segmentCount = line.length - 1;

  const s: Hull = [];
  const reverseLine: Vec2[] = [];

  let seg = segment(0);
  let dir = sub(seg.b, seg.a);
  let p0 = neg(resize(perpendicular(dir), d));
  let ds = neg(resize(perpendicular(dir), x));
  let pd = resize(dir, x);
  let dp = resize(dir, d);

  s.push(sub(add(seg.a, p0), pd));
  s.push(add(sub(seg.a, dp), ds));
  s.push(sub(sub(seg.a, dp), ds));
  s.push(sub(sub(seg.a, p0), pd));

  for (let i = 1; i < segmentCount; i++) {
    const prev = segment(i - 1);
    const cur = segment(i);
    const pp = resize(perpendicular(sub(prev.b, prev.a)), d);
    const pp2 = resize(perpendicular(sub(cur.b, cur.a)), d);

    const saOut: Seg = { a: add(prev.a, pp), b: add(prev.b, pp) };
    const sbOut: Seg = { a: add(cur.a, pp2), b: add(cur.b, pp2) };
    const saIn: Seg = { a: sub(prev.a, pp), b: sub(prev.b, pp) };
    const sbIn: Seg = { a: sub(cur.a, pp2), b: sub(cur.b, pp2) };

    const ipOut = intersectLines(saOut, sbOut);
    const ipIn = intersectLines(saIn, sbIn);

    // Upstream dereferences both optionals unguarded. Two consecutive polyline
    // segments of an arc are never collinear unless the polygonisation
    // degenerated to the chord, which is the `n == 0` case the builder above
    // cannot reach with a segment count above one.
    if (ipOut) s.push({ x: Math.trunc(ipOut.x), y: Math.trunc(ipOut.y) });
    if (ipIn) reverseLine.push({ x: Math.trunc(ipIn.x), y: Math.trunc(ipIn.y) });
  }

  seg = segment(-1);
  dir = sub(seg.b, seg.a);
  p0 = neg(resize(perpendicular(dir), d));
  ds = neg(resize(perpendicular(dir), x));
  pd = resize(dir, x);
  dp = resize(dir, d);

  s.push(add(sub(seg.b, p0), pd));
  s.push(sub(add(seg.b, dp), ds));
  s.push(add(add(seg.b, dp), ds));
  s.push(add(add(seg.b, p0), pd));

  for (let i = reverseLine.length - 1; i >= 0; i--) s.push(reverseLine[i] as Vec2);

  // Make sure the hull outline is always clockwise.
  const first = segment(0);

  if (segSide({ a: s[0] as Vec2, b: s[1] as Vec2 }, first.a) < 0) return [...s].reverse();

  return s;
}

/**
 * `BuildHullForPrimitiveShape`.
 *
 * The `SEGMENT` and `ARC` arms pass the **raw** clearance and walkaround
 * thickness through — `cl` above them is dead on those two paths, because
 * `SegmentHull` and `ArcHull` each halve the thickness themselves.
 */
export function buildHullForPrimitiveShape(
  aShape: Shape,
  aClearance: number,
  aWalkaroundThickness: number,
): Hull {
  const cl = aClearance + idiv(aWalkaroundThickness + 1, 2);

  switch (aShape.kind) {
    case 'circle': {
      const r = aShape.r;

      return octagonalHull(
        { x: aShape.c.x - r, y: aShape.c.y - r },
        { x: 2 * r, y: 2 * r },
        cl,
        kiRound(2.0 * (1.0 - SQRT1_2) * (r + cl)),
      );
    }

    case 'stadium':
      // `SHAPE_SEGMENT`: the stadium's radius is half the track width.
      return segmentHull(aShape.a, aShape.b, 2 * aShape.r, aClearance, aWalkaroundThickness);

    case 'arc':
      return arcHull(shapeToArc(aShape), aClearance, aWalkaroundThickness);

    case 'poly':
      // `SH_SIMPLE` has no width of its own, so this repo's outward inflation
      // `r` — which is how a rounded-rect pad is modelled — is folded into the
      // clearance rather than dropped.
      return convexHull(aShape.pts, cl + aShape.r);

    default:
      return [];
  }
}

/**
 * `ITEM::Hull( aClearance, aWalkaroundThickness, aLayer )`, dispatched on the
 * kind tag. The base implementation returns an empty chain, which is what a
 * `LINE`, a `JOINT` or a diff pair gets.
 */
export function itemHull(
  aItem: PnsItem,
  aClearance: number,
  aWalkaroundThickness: number,
  aLayer: number,
): Hull {
  switch (aItem.kind()) {
    case PnsKind.SEGMENT_T: {
      const seg = (aItem as PnsSegment).seg();

      return segmentHull(
        seg.a,
        seg.b,
        (aItem as PnsSegment).width(),
        aClearance,
        aWalkaroundThickness,
      );
    }

    case PnsKind.ARC_T:
      return arcHull((aItem as PnsArc).cArc(), aClearance, aWalkaroundThickness);

    case PnsKind.VIA_T: {
      const via = aItem as PnsVia;
      const cl = aClearance + idiv(aWalkaroundThickness, 2);
      const hole = via.hole();
      const iface = getRouterIface();

      // A via that is present but *not flashed* on this layer has no annular
      // ring there, so its obstacle is the hole rather than the pad. Upstream
      // reaches the router singleton for the answer; with no router running the
      // `&&` cannot short-circuit there (the call is unconditional), so a null
      // iface is a crash upstream and is treated as "flashed" here — the
      // conservative direction, giving the larger hull.
      const width =
        hole && iface && !iface.isFlashedOnLayer(via, aLayer)
          ? holeRadius(hole) * 2
          : via.diameter(aLayer);

      return octagonalHull(
        { x: via.pos().x - idiv(width, 2), y: via.pos().y - idiv(width, 2) },
        { x: width, y: width },
        cl,
        kiRound((2 * cl + width) * (1.0 - SQRT1_2)),
      );
    }

    case PnsKind.HOLE_T: {
      const shape = aItem.shape(aLayer);

      if (!shape) return [];

      // `HOLE::Hull`'s circle branch is *not* `BuildHullForPrimitiveShape`'s:
      // it truncates half the walkaround thickness where the generic builder
      // rounds it up. See the module docblock.
      if (shape.kind === 'circle') {
        const cl = aClearance + idiv(aWalkaroundThickness, 2);
        const width = shape.r * 2;

        return octagonalHull(
          { x: shape.c.x - idiv(width, 2), y: shape.c.y - idiv(width, 2) },
          { x: width, y: width },
          cl,
          kiRound((2 * cl + width) * (1.0 - SQRT1_2)),
        );
      }

      return buildHullForPrimitiveShape(shape, aClearance, aWalkaroundThickness);
    }

    case PnsKind.SOLID_T: {
      const shape = aItem.shape(aLayer);

      if (!shape) return [];

      return buildHullForPrimitiveShape(shape, aClearance, aWalkaroundThickness);
    }

    default:
      return [];
  }
}

/** A hole's radius, whatever concrete class is carrying it. */
function holeRadius(aHole: PnsItem): number {
  const withRadius = aHole as PnsItem & { radius?: () => number };

  return withRadius.radius?.() ?? 0;
}

/** `SHAPE_ARC` from this repo's angular arc shape. */
function shapeToArc(aShape: Extract<Shape, { kind: 'arc' }>): ShapeArc {
  const at = (angle: number): Vec2 => ({
    x: kiRound(aShape.c.x + aShape.rad * Math.cos(angle)),
    y: kiRound(aShape.c.y + aShape.rad * Math.sin(angle)),
  });

  return {
    p0: at(aShape.a0),
    arcMid: at(aShape.a0 + aShape.sweep / 2),
    p1: at(aShape.a0 + aShape.sweep),
    width: 2 * aShape.r,
  };
}
