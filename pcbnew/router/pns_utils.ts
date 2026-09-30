// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Obstacle hulls: the shape a router has to stay outside of.
 * Counterpart: `pcbnew/router/pns_utils.cpp`, whole — this file used to be
 * split into three (`pns_hull.ts`, `pns_item_hull.ts`, plus `HullIntersection`
 * inside `pns_chain.ts`); merged back 2026-09-29 to match the single upstream
 * file (the router file-structure parity pass).
 *
 * A hull is not the obstacle. It is the obstacle *grown* by the clearance the
 * rules demand plus half the width of the track being routed, so that a path
 * whose **centreline** merely touches the hull leaves a track whose **edge**
 * sits exactly at the clearance. Working in hull space is what lets the router
 * treat a fat track as a zero-width line, and it is why every walkaround and
 * shove decision below this layer is about a polygon rather than a distance.
 *
 * ## Why octagons rather than true offsets
 *
 * A true offset of a rectangle has rounded corners, and of a segment has round
 * caps. Both would make the router's paths curve, and its whole geometry is
 * 45°. So the growth is approximated by an octagon whose chamfer is chosen to
 * touch the true rounding — never inside it, so the approximation is
 * conservative in the direction that matters: a path outside the octagon is
 * outside the real clearance too.
 *
 * ## The kink rule
 *
 * A segment shorter than a tenth of the clearance has no reliable direction —
 * its perpendicular is rounding noise, and the hull built from it comes out
 * twisted. Upstream snaps such a segment to whichever axis or diagonal it is
 * nearly on before building anything, and widens the clearance a unit or two to
 * cover the lie. That is a real routing situation, not a pathological one:
 * every corner a router lays down leaves a tiny segment behind while the mouse
 * is between grid points.
 *
 * ## `viaHull`/`circleHull`/`rectHull`
 *
 * Not free functions in `pns_utils.cpp` under these names — they are `VIA::Hull`
 * and two branches of `BuildHullForPrimitiveShape` reproduced as plain
 * parametrised geometry rather than bound to an item, because `pns_obstacles.ts`
 * (the walkaround-only board-query path, which never touches a live `PNS::NODE`
 * or a `PNS::ITEM`) needs the same math over board summaries it has no item to
 * call a method on. Kept here rather than invented a fourth file for three
 * functions.
 *
 * ## `HullIntersection`
 *
 * Ported from `pns_chain.ts`, which otherwise carries `libs/kimath`'s
 * `SHAPE_LINE_CHAIN` operations (`PointInside`, `EdgeContainingPoint`, `Find`,
 * `Split`) — the one piece of that file that is actually this file's own
 * upstream function. `pointInside`/`pointOnEdge` are still imported from
 * `pns_chain.ts`, which is where the rest of that KiCad class lives (a
 * different package, `libs/kimath`, out of scope for this pass).
 *
 * ## What stayed out: `itemHull`
 *
 * `ITEM::Hull` is a pure virtual in `pns_item.h`; every concrete override —
 * `ARC::Hull`, `VIA::Hull`, `SOLID::Hull`, `HOLE::Hull`, and `SEGMENT::Hull`
 * (defined in `pns_line.cpp`, since there is no `pns_segment.cpp`) — is now a
 * thin per-kind wrapper in that class's own file
 * (`pns_arc.ts`/`pns_via.ts`/`pns_solid.ts`/`pns_hole.ts`/`pns_line.ts`)
 * calling the geometry here. The `switch` that used to hold their bodies is
 * still needed — this repo has no virtual dispatch to replace it with — and
 * stays in `pns_item_hull.ts`, now just that dispatcher: it would otherwise
 * have to import all five item files *and* this one, and if any of them ever
 * needed to ask "what shape am I" back, this file and `pns_item_hull.ts` would
 * both be reaching into each other.
 *
 * ## `ChangedArea`
 *
 * Also declared in `pns_utils.cpp`. Not ported (out of scope for the hull
 * move).
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { intersectLines, type Seg } from './pns_line.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import {
  arcCentralAngle,
  arcConvertToPolyline,
  arcRadius,
  shapeArcCenter,
} from '@ziroeda/kimath/src/geometry/shape_arc.js';
import type { ShapeArc } from './pns_arc.js';
import type { Shape } from '../drc/drc_geometry.js';
import { pointInside, pointOnEdge } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { PnsKind } from './pns_item.js';
import type { PnsItem } from './pns_item.js';
import { getRouterIface } from './pns_collision.js';
import type { PnsArc } from './pns_arc.js';
import type { PnsSegment } from './pns_segment.js';
import type { PnsVia } from './pns_via.js';

// ---------------------------------------------------------------------------
// Hull type, resize, and the OctagonalHull/SegmentHull family (was pns_hull.ts)
// ---------------------------------------------------------------------------
export type Hull = Vec2[];

const SQRT1_2 = Math.SQRT1_2;

/** KiCad's KiROUND: round half away from zero. */
const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const perpendicular = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });
const sgn = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** `VECTOR2I::Resize`: same direction, given length, rounded to internal units. */
export function resize(v: Vec2, len: number): Vec2 {
  const n = Math.hypot(v.x, v.y);
  if (n === 0) return { x: 0, y: 0 };
  return { x: kiRound((v.x * len) / n) || 0, y: kiRound((v.y * len) / n) || 0 };
}

/**
 * `OctagonalHull`: a box grown by `clearance`, with its corners cut back by
 * `chamfer`.
 *
 * A zero chamfer degenerates to a plain rectangle, which is what a rectangular
 * pad wants — its true offset has rounded corners, but the router is happy to
 * treat those as square and stay further away than it must.
 */
export function octagonalHull(p0: Vec2, size: Vec2, clearance: number, chamfer: number): Hull {
  const s: Hull = [];
  const x0 = p0.x - clearance;
  const y0 = p0.y - clearance;
  const x1 = p0.x + size.x + clearance;
  const y1 = p0.y + size.y + clearance;

  s.push({ x: x0, y: y0 + chamfer });
  if (chamfer) s.push({ x: x0 + chamfer, y: y0 });

  s.push({ x: x1 - chamfer, y: y0 });
  if (chamfer) s.push({ x: x1, y: y0 + chamfer });

  s.push({ x: x1, y: y1 - chamfer });
  if (chamfer) s.push({ x: x1 - chamfer, y: y1 });

  s.push({ x: x0 + chamfer, y: y1 });
  if (chamfer) s.push({ x: x0, y: y1 - chamfer });

  return s;
}

/**
 * `IsSegment45Degree`: is this segment on an axis or a diagonal, to within an
 * internal unit?
 *
 * The tolerance is what makes it useful: a segment the user drew at 45° will
 * miss by a nanometre after rounding, and treating that as a general-direction
 * segment is what produces the twisted hulls the kink rule exists to prevent.
 */
export function isSegment45Degree(a: Vec2, b: Vec2): boolean {
  const dir = sub(b, a);
  if (Math.abs(dir.x) <= 1) return true;
  if (Math.abs(dir.y) <= 1) return true;
  const delta = Math.abs(dir.x) - Math.abs(dir.y);
  return delta >= -1 && delta <= 1;
}

/** Twice the signed area of the triangle o-a-b; the sign is the turn direction. */
const side = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * `SegmentHull`: the octagonal envelope of a track segment.
 *
 * `walkaroundThickness` is the width of the track being routed *past* this one,
 * and only half of it enters the growth — the other half is on the far side of
 * that track's own centreline. So the total separation between two track edges
 * comes out at exactly the clearance, which is the arithmetic the whole layer
 * rests on.
 *
 * The result is always wound **clockwise**. Walkaround picks a direction to
 * traverse the hull in, so a hull that came out either way round depending on
 * which end of the segment happened to be first would send paths round the
 * wrong side.
 */
export function segmentHull(
  a: Vec2,
  bIn: Vec2,
  width: number,
  clearance: number,
  walkaroundThickness: number,
): Hull {
  const kinkThreshold = clearance / 10;

  let cl = clearance + Math.trunc(walkaroundThickness / 2);
  const d = width / 2 + cl;
  const x = (2.0 / (1.0 + Math.SQRT2)) * d;
  const dr = kiRound(d);
  const xr2 = kiRound(x / 2.0);

  let b = bIn;
  let w = b.x - a.x;
  let h = b.y - a.y;
  const len = Math.hypot(w, h);

  // The kink rule. A segment this short has a direction made of rounding
  // noise, so it is snapped to the axis or diagonal it is nearly on before its
  // perpendicular is taken.
  if (a.x !== b.x || a.y !== b.y) {
    if (!isSegment45Degree(a, b)) {
      if (len <= kinkThreshold && len > 0) {
        const ll = Math.max(Math.abs(w), Math.abs(h));
        b = { x: a.x + sgn(w) * ll, y: a.y + sgn(h) * ll };
        w = b.x - a.x;
        h = b.y - a.y;
      }
    } else if (len <= kinkThreshold) {
      const delta45 = Math.abs(Math.abs(w) - Math.abs(h));

      // The clearance bumps below are upstream's and are *dead* in this
      // branch: `d` was computed from `cl` before the kink block, and nothing
      // after it reads `cl` again unless the segment degenerated to a point,
      // which snapping cannot cause. Kept because upstream has them and the
      // intent — pay a little clearance for the lie about the direction — is
      // worth preserving if `d` ever moves below this.
      if (Math.abs(w) <= 1) {
        // Almost vertical: make it exactly so.
        w = 0;
        cl += 1;
      } else if (Math.abs(h) <= 1) {
        h = 0;
        cl += 1;
      } else if (delta45 <= 2) {
        const longer = Math.max(Math.abs(w), Math.abs(h));
        w = sgn(w) * longer;
        h = sgn(h) * longer;
        cl += 2;
      }

      b = { x: a.x + w, y: a.y + h };
    }
  }

  // A zero-length segment is a dot, and its hull is the octagon of its own
  // square rather than anything derived from a direction it does not have.
  if (a.x === b.x && a.y === b.y) {
    const xx2 = kiRound(2.0 * (1.0 - SQRT1_2) * d);
    return octagonalHull(
      { x: a.x - Math.trunc(width / 2), y: a.y - Math.trunc(width / 2) },
      { x: width, y: width },
      cl,
      xx2,
    );
  }

  const dir = sub(b, a);
  const p0 = resize(perpendicular(dir), dr);
  const ds = resize(perpendicular(dir), xr2);
  const pd = resize(dir, xr2);
  const dp = resize(dir, dr);

  const s: Hull = [
    add(add(b, p0), pd),
    add(add(b, dp), ds),
    sub(add(b, dp), ds),
    add(sub(b, p0), pd),
    sub(sub(a, p0), pd),
    sub(sub(a, dp), ds),
    add(sub(a, dp), ds),
    sub(add(a, p0), pd),
  ];

  // Wind it clockwise, whichever way the segment happened to run.
  return side(s[0]!, s[1]!, a) < 0 ? [...s].reverse() : s;
}

/**
 * `VIA::Hull`: an octagon around the via's diameter.
 *
 * The chamfer is `(2·cl + width)·(1 − √½)`, which is the cut that makes the
 * octagon touch the true circular offset at its corners rather than crossing
 * inside it.
 */
export function viaHull(
  pos: Vec2,
  diameter: number,
  clearance: number,
  walkaroundThickness: number,
): Hull {
  const cl = clearance + Math.trunc(walkaroundThickness / 2);
  const half = Math.trunc(diameter / 2);

  return octagonalHull(
    { x: pos.x - half, y: pos.y - half },
    { x: diameter, y: diameter },
    cl,
    kiRound((2 * cl + diameter) * (1.0 - SQRT1_2)),
  );
}

/**
 * `BuildHullForPrimitiveShape` for a circle — a round pad, or a hole.
 *
 * Upstream writes the chamfer here as `2·(1−√½)·(r + cl)` and a via's as
 * `(2·cl + d)·(1−√½)`, which look like different rules and are the same one:
 * `d = 2r`, so both are `(2r + 2cl)(1−√½)`. Kept as two functions because
 * upstream has two and a via may yet grow a stack-dependent diameter, but a
 * round pad and a via of the same size get identical hulls, and a test says so
 * — I had assumed otherwise until the numbers disagreed.
 */
export function circleHull(center: Vec2, radius: number, clearance: number): Hull {
  return octagonalHull(
    { x: center.x - radius, y: center.y - radius },
    { x: 2 * radius, y: 2 * radius },
    clearance,
    kiRound(2.0 * (1.0 - SQRT1_2) * (radius + clearance)),
  );
}

/**
 * `BuildHullForPrimitiveShape` for a rectangle — a rectangular pad.
 *
 * No chamfer at all: the hull is the box grown by the clearance, corners
 * square. The true offset is rounded there, so this stays *outside* it, which
 * is the safe direction to be wrong in.
 */
export function rectHull(p0: Vec2, size: Vec2, clearance: number): Hull {
  return octagonalHull(p0, size, clearance, 0);
}

// ---------------------------------------------------------------------------
// ConvexHull, ArcHull, BuildHullForPrimitiveShape (was pns_item_hull.ts)
// ---------------------------------------------------------------------------
/** `ARC_LOW_DEF` (`include/base_units.h:127,136`): 0.02 mm in PCB internal units. */
export const ARC_LOW_DEF = 20000;

const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });
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

// ---------------------------------------------------------------------------
// HullIntersection (was pns_chain.ts's one piece of pns_utils.cpp)
// ---------------------------------------------------------------------------
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
/** One crossing of a hull by a path. */
export interface HullIntersect {
  p: Vec2;
  /** Which hull segment was crossed. */
  indexOur: number;
  /** Which path segment did the crossing. */
  indexTheir: number;
  /** The crossing landed exactly on a hull vertex. */
  isCornerOur: boolean;
  /** ...or on a path vertex. */
  isCornerTheir: boolean;
}

/** Where two segments properly cross, or null. Endpoints count as crossings. */
function segIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = r.x * s.y - r.y * s.x;
  if (denom === 0) return null;

  const qp = sub(b1, a1);
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: Math.round(a1.x + r.x * t), y: Math.round(a1.y + r.y * t) };
}

/**
 * Every crossing of a closed `hull` by an open `line`, classified.
 *
 * The corner flags are the point of the exercise. A crossing that lands exactly
 * on a vertex of either shape is ambiguous — the path may be passing through or
 * merely grazing — and `hullIntersection` below uses the flags to tell those
 * apart. Recording the raw hit without them makes a graze look like an entry,
 * and the walk then tries to route around an obstacle it never touched.
 */
export function rawIntersections(hull: readonly Vec2[], line: readonly Vec2[]): HullIntersect[] {
  const out: HullIntersect[] = [];
  const hn = hull.length;

  for (let j = 0; j + 1 < line.length; j++) {
    const l1 = line[j]!;
    const l2 = line[j + 1]!;

    for (let i = 0; i < hn; i++) {
      const h1 = hull[i]!;
      const h2 = hull[i + 1 === hn ? 0 : i + 1]!;
      const p = segIntersection(h1, h2, l1, l2);
      if (!p) continue;

      out.push({
        p,
        indexOur: i,
        indexTheir: j,
        isCornerOur: same(p, h1) || same(p, h2),
        isCornerTheir: same(p, l1) || same(p, l2),
      });
    }
  }

  return out;
}

/**
 * `HullIntersection`: the crossings that actually take the path through the
 * hull's boundary.
 *
 * A crossing away from any corner always counts. One *at* a corner only counts
 * when the path really passes from one side to the other there, which is
 * decided by looking at the two edges meeting at that corner: if the path's
 * direction lies strictly between them, it went through; if it lies outside,
 * it touched and carried on.
 *
 * Without this, a path routed exactly along the outside of a hull registers an
 * entry at every corner it grazes, and the walk sends it round an obstacle it
 * was already clear of.
 */
export function hullIntersection(hull: readonly Vec2[], line: readonly Vec2[]): HullIntersect[] {
  if (line.length < 2) return [];

  const out: HullIntersect[] = [];
  const seen = new Set<string>();

  for (const hit of rawIntersections(hull, line)) {
    const key = `${hit.p.x},${hit.p.y}`;

    if (!hit.isCornerOur && !hit.isCornerTheir) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(hit);
      }
      continue;
    }

    // At a corner, ask whether the path crosses the boundary or grazes it. A
    // path that *ends* at the hit has no far side and so has crossed nothing —
    // which is exactly what reaching a pad and stopping looks like.
    const { before, after } = samplesAround(line, hit);
    if (before === null || after === null) continue;

    // The same three-way answer as everywhere else here, and for the same
    // reason: a sample sitting *on* the boundary is neither in nor out, and
    // ray casting there answers whichever way the rounding fell. A real
    // crossing needs one sample genuinely inside and the other genuinely
    // outside — anything less is a path running along the edge.
    const sideOf = (q: Vec2): number => (pointOnEdge(hull, q) ? 0 : pointInside(hull, q) ? 1 : -1);

    const sBefore = sideOf(before);
    const sAfter = sideOf(after);

    if (sBefore !== 0 && sAfter !== 0 && sBefore !== sAfter && !seen.has(key)) {
      seen.add(key);
      out.push(hit);
    }
  }

  return out;
}

/**
 * Sample the path just before and just after a crossing.
 *
 * Both are found by stepping to the nearest *distinct* path point on each side
 * and taking the midpoint. Stepping to the segment's own endpoints is not
 * enough: when the crossing lands exactly on a path vertex, one of those
 * endpoints **is** the crossing, and the midpoint toward it is the crossing
 * again — which reads as being on the boundary and makes a path that merely
 * *reaches* the hull look like one that passes through it.
 *
 * `null` on either side means the path ends there, and a path that ends on the
 * boundary has not crossed it.
 *
 * Skipping points identical to the crossing is what makes this work, and it is
 * *also* unobservable on its own: without it the midpoint comes out as the
 * crossing itself, which the on-edge test then classifies as neither side —
 * the same answer by a different route. Both are kept, because relying on one
 * to cover for the other is how the bug this function exists to fix got in.
 */
function samplesAround(
  line: readonly Vec2[],
  hit: HullIntersect,
): { before: Vec2 | null; after: Vec2 | null } {
  const p = hit.p;

  let before: Vec2 | null = null;
  for (let i = hit.indexTheir; i >= 0; i--) {
    if (!same(line[i]!, p)) {
      before = midpointToward(p, line[i]!);
      break;
    }
  }

  let after: Vec2 | null = null;
  for (let i = hit.indexTheir + 1; i < line.length; i++) {
    if (!same(line[i]!, p)) {
      after = midpointToward(p, line[i]!);
      break;
    }
  }

  return { before, after };
}

/**
 * Halfway from `p` towards `q`.
 *
 * Halfway rather than a fixed small step on purpose: a fixed step has to be
 * small enough not to overshoot a short segment and large enough to escape the
 * rounding around the crossing, and no single value is both on a board whose
 * features span six orders of magnitude.
 */
function midpointToward(p: Vec2, q: Vec2): Vec2 {
  return { x: Math.round((p.x + q.x) / 2), y: Math.round((p.y + q.y) / 2) };
}

// ============================================================================
// Folded in from pns_item_hull.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================
/**
 * `ITEM::Hull( aClearance, aWalkaroundThickness, aLayer )`, dispatched on the
 * kind tag — the switch this repo uses in place of virtual dispatch (there is
 * no single upstream file for a virtual method's dispatch site; the base
 * declaration is `pns_item.h`, and every override now lives in its own item's
 * file — see `pns_utils.ts`'s own doc comment for the full reasoning and the
 * cycle this avoids). The base implementation returns an empty chain, which is
 * what a `LINE`, a `JOINT` or a diff pair gets.
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
