// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The parts of SHAPE_POLY_SET a filled zone needs. Counterpart:
 * `libs/kimath/src/geometry/shape_poly_set.cpp`.
 *
 * A polygon here is an outline followed by its holes, the same shape
 * SHAPE_POLY_SET::POLYGON has. {@link fracture} is the transformation that
 * matters for files: KiCad stores a zone's fill as simple closed rings with no
 * holes, so before writing it cuts each hole open to the outline along a
 * horizontal slit. A reader that fills every ring it finds (KiCad's own) then
 * draws the pour correctly; rings left as holes would be filled in solid.
 */

import {
  ClipType,
  EndType,
  FillRule,
  JoinType,
  PI,
  type Path64,
  type Paths64,
} from '../clipper2/clipper.core.js';
import { Clipper64, PolyPath64, type PolyTree64 } from '../clipper2/clipper.engine.js';
import { stdSort } from '../clipper2/clipper.core.js';
import { simplifyLineChain } from './shape_line_chain.js';
import { ClipperOffset } from '../clipper2/clipper.offset.js';
import { acos, atan2, cos, hypot, sin } from '../math/libm.js';
import { EDA_ANGLE, EDA_ANGLE_T } from './eda_angle.js';
import { getArcToSegmentCount } from './geometry_utils.js';
import type { Vec2 } from '../math/vector2.js';
import { rescale64 } from '../math/util.js';

/** An outline followed by its holes, KiCad's SHAPE_POLY_SET::POLYGON. */
export type Polygon = Vec2[][];

/** `FractureEdge`: one directed edge of the working chain, `m_next` an index. */
interface FractureEdge {
  p1: Vec2;
  p2: Vec2;
  next: number;
}

/** `FractureEdge::matches`: does the horizontal line at `y` cross this edge? */
const matches = (e: FractureEdge, y: number): boolean =>
  (y >= e.p1.y || y >= e.p2.y) && (y <= e.p1.y || y <= e.p2.y);

/**
 * `rescale<int>( a, b, c )` (math/util.cpp:66): `a * b` in 64 bits, then a
 * round-to-nearest integer division. The product of two board-sized deltas
 * passes 2^53, so it is done in BigInt.
 */
function rescale(a: number, b: number, c: number): number {
  const numerator = BigInt(a) * BigInt(b);
  const denominator = BigInt(c);
  const half = denominator / 2n; // C++ `/`: truncates toward zero, as BigInt's does
  if (numerator < 0n !== denominator < 0n) return Number((numerator - half) / denominator);
  return Number((numerator + half) / denominator);
}

/**
 * `processHole`: cut the hole open to the nearest edge to the left of its
 * leftmost point, along the horizontal through that point. Every edge before
 * the hole's own is a candidate — the holes are taken left to right, so all
 * of those are already part of the outline.
 */
function processHole(
  edges: FractureEdge[],
  provokingIndex: number,
  edgeIndex: number,
  bridgeIndex: number,
): boolean {
  const e0 = edges[edgeIndex]!;
  const x = e0.p1.x;
  const y = e0.p1.y;
  let min_dist = 2147483647;
  let x_nearest = 0;
  let e_nearest = -1;

  for (let i = 0; i < provokingIndex; i++) {
    const e = edges[i]!;
    if (!matches(e, y)) continue;

    let x_intersect: number;
    if (e.p1.y === e.p2.y)
      x_intersect = Math.max(e.p1.x, e.p2.x); // horizontal edge
    else x_intersect = e.p1.x + rescale(e.p2.x - e.p1.x, y - e.p1.y, e.p2.y - e.p1.y);

    const dist = x - x_intersect;
    if (dist >= 0 && dist < min_dist) {
      min_dist = dist;
      x_nearest = x_intersect;
      e_nearest = i;
    }
  }

  if (e_nearest < 0) return false;

  const outline2hole_index = bridgeIndex;
  const hole2outline_index = bridgeIndex + 1;
  const split_index = bridgeIndex + 2;
  const near = edges[e_nearest]!;
  // Make an edge between the split outline edge and the hole...
  edges[outline2hole_index] = { p1: { x: x_nearest, y }, p2: e0.p1, next: edgeIndex };
  // ...between the hole and the edge...
  edges[hole2outline_index] = { p1: e0.p1, p2: { x: x_nearest, y }, next: split_index };
  // ...and between the split outline edge and the rest.
  edges[split_index] = { p1: { x: x_nearest, y }, p2: near.p2, next: near.next };

  // Perform the actual outline edge split
  near.p2 = { x: x_nearest, y };
  near.next = outline2hole_index;

  let last = e0;
  for (; last.next !== edgeIndex; last = edges[last.next]!);
  last.next = hole2outline_index;
  return true;
}

/**
 * `SHAPE_POLY_SET::fractureSingle` — `fractureSingleCacheFriendly`, which is
 * what `m_EnableCacheFriendlyFracture` (default true) selects: turn one
 * outline-plus-holes polygon into a single ring, joining each hole to the
 * outline with a zero-width slit at the hole's leftmost point (the FIRST of
 * equal-x points), holes taken in order of that x, then their top y.
 */
export function fractureSingle(paths: Polygon): Polygon {
  if (paths.length === 1) return paths.map((p) => p.map((q) => ({ ...q })));
  if (paths.length === 0) return [];

  const edges: FractureEdge[] = [];

  interface PathInfo {
    path_or_provoking_index: number;
    leftmost: number;
    x: number;
    y_or_bridge: number;
  }
  const sorted_paths: PathInfo[] = [];

  for (let path_index = 0; path_index < paths.length; path_index++) {
    const points = paths[path_index]!;
    let x_min = 2147483647;
    let y_min = 2147483647;
    let leftmost = -1;
    for (let point_index = 0; point_index < points.length; point_index++) {
      const point = points[point_index]!;
      if (point.x < x_min) {
        x_min = point.x;
        leftmost = point_index;
      }
      if (point.y < y_min) y_min = point.y;
    }
    sorted_paths.push({
      path_or_provoking_index: path_index,
      leftmost,
      x: x_min,
      y_or_bridge: y_min,
    });
  }

  // `std::sort( begin + 1, end )` — the outline stays first.
  const holesSorted = sorted_paths.slice(1);
  stdSort(holesSorted, (a, b) => (a.x === b.x ? a.y_or_bridge < b.y_or_bridge : a.x < b.x));
  sorted_paths.splice(1, holesSorted.length, ...holesSorted);

  let edge_index = 0;
  let outline = true;

  for (const path_info of sorted_paths) {
    const points = paths[path_info.path_or_provoking_index]!;
    const point_count = points.length;
    const provoking_edge = edge_index;

    for (let i = 0; i < point_count - 1; i++) {
      edges.push({ p1: points[i]!, p2: points[i + 1]!, next: edge_index + 1 });
      edge_index++;
    }
    // Create last edge looping back to the provoking one.
    edges.push({ p1: points[point_count - 1]!, p2: points[0]!, next: provoking_edge });
    edge_index++;

    if (!outline) {
      path_info.path_or_provoking_index = provoking_edge;
      path_info.y_or_bridge = edge_index;
      // Reserve 3 additional edges to bridge with the outline.
      edge_index += 3;
      edges.length = edge_index;
    }
    outline = false;
  }

  for (let k = 1; k < sorted_paths.length; k++) {
    const it = sorted_paths[k]!;
    if (
      !processHole(
        edges,
        it.path_or_provoking_index,
        it.path_or_provoking_index + it.leftmost,
        it.y_or_bridge,
      )
    )
      return []; // "Broken polygon, dropping path"
  }

  // `newPath.Append( e->m_p1 )`: a point equal to the previous one is dropped.
  const out: Vec2[] = [];
  const append = (p: Vec2): void => {
    const l = out[out.length - 1];
    if (!l || l.x !== p.x || l.y !== p.y) out.push({ x: p.x, y: p.y });
  };
  let e = edges[0]!;
  for (; e.next !== 0; e = edges[e.next]!) append(e.p1);
  append(e.p1);
  return [out];
}

/** FractureEdgeSlow: one directed edge of the working chain. */
interface FractureEdgeSlow {
  connected: boolean;
  p1: Vec2;
  p2: Vec2;
  next: FractureEdgeSlow | null;
}

const edgeSlow = (connected: boolean, p1: Vec2, p2: Vec2): FractureEdgeSlow => ({
  connected,
  p1,
  p2,
  next: null,
});

/** FractureEdgeSlow::matches: does the horizontal line at `y` cross this edge? */
const matchesSlow = (e: FractureEdgeSlow, y: number): boolean =>
  (y >= e.p1.y || y >= e.p2.y) && (y <= e.p1.y || y <= e.p2.y);

/** KiCad's rescale( a, b, c ) = a * b / c, rounded. */

/**
 * processEdge: cut `edge`'s hole open to the nearest connected edge to its left,
 * along the horizontal at its first point, and splice the hole into the chain.
 * Returns how many edges became connected, or 0 if the polygon is broken.
 */
function processEdgeSlow(edges: FractureEdgeSlow[], e: FractureEdgeSlow): number {
  const x = e.p1.x;
  const y = e.p1.y;
  let minDist = Number.POSITIVE_INFINITY;
  let xNearest = 0;
  let nearest: FractureEdgeSlow | null = null;

  for (const candidate of edges) {
    if (!matchesSlow(candidate, y)) continue;

    const xIntersect =
      candidate.p1.y === candidate.p2.y
        ? Math.max(candidate.p1.x, candidate.p2.x) // horizontal edge
        : candidate.p1.x +
          rescale(
            candidate.p2.x - candidate.p1.x,
            y - candidate.p1.y,
            candidate.p2.y - candidate.p1.y,
          );

    const dist = x - xIntersect;

    if (dist >= 0 && dist < minDist && candidate.connected) {
      minDist = dist;
      xNearest = xIntersect;
      nearest = candidate;
    }
  }

  if (!nearest?.connected) return 0;

  let count = 0;
  const lead1 = edgeSlow(true, { x: xNearest, y }, { x, y });
  const lead2 = edgeSlow(true, { x, y }, { x: xNearest, y });
  const split2 = edgeSlow(true, { x: xNearest, y }, nearest.p2);

  edges.push(split2, lead1, lead2);

  const link = nearest.next;

  nearest.p2 = { x: xNearest, y };
  nearest.next = lead1;
  lead1.next = e;

  let last = e;
  for (; last.next !== e; last = last.next!) {
    last.connected = true;
    count++;
  }

  last.connected = true;
  last.next = lead2;
  lead2.next = split2;
  split2.next = link;

  return count + 1;
}

/**
 * SHAPE_POLY_SET::fractureSingle: turn one outline-plus-holes polygon into a
 * single ring, joining each hole to the outline with a zero-width slit. Holes
 * are taken left-most first, which is what keeps the slits from crossing.
 */
export function fractureSingleSlow(paths: Polygon): Polygon {
  if (paths.length <= 1) return paths.map((p) => p.map((q) => ({ ...q })));

  const edges: FractureEdgeSlow[] = [];
  const borderEdges: FractureEdgeSlow[] = [];
  let root: FractureEdgeSlow | null = null;
  let first = true;
  let numUnconnected = 0;

  for (const path of paths) {
    const points = path;
    const pointCount = points.length;
    let prev: FractureEdgeSlow | null = null;
    let firstEdge: FractureEdgeSlow | null = null;
    let xMin = Number.POSITIVE_INFINITY;

    for (const p of points) xMin = Math.min(xMin, p.x);

    for (let i = 0; i < pointCount; i++) {
      // The first path is the outline, and starts out connected.
      const fe = edgeSlow(first, points[i]!, points[i + 1 === pointCount ? 0 : i + 1]!);

      root ??= fe;
      firstEdge ??= fe;
      if (prev) prev.next = fe;
      if (i === pointCount - 1) fe.next = firstEdge;

      prev = fe;
      edges.push(fe);

      if (!first && fe.p1.x === xMin) borderEdges.push(fe);
      if (!fe.connected) numUnconnected++;
    }

    first = false;
  }

  // Keep connecting holes to the main outline until none are left.
  while (numUnconnected > 0) {
    let xMin = Number.POSITIVE_INFINITY;
    let smallestX: FractureEdgeSlow | null = null;

    for (const borderEdge of borderEdges) {
      const xt = borderEdge.p1.x;
      if (xt <= xMin && !borderEdge.connected) {
        xMin = xt;
        smallestX = borderEdge;
      }
    }

    if (!smallestX) break;
    const processed = processEdgeSlow(edges, smallestX);

    // A polygon we cannot join is broken; upstream warns and drops it.
    if (!processed) return [];

    numUnconnected -= processed;
  }

  const out: Vec2[] = [];
  const append = (p: Vec2): void => {
    const l = out[out.length - 1];
    if (!l || l.x !== p.x || l.y !== p.y) out.push({ x: p.x, y: p.y });
  };
  let e = root!;
  for (; e.next !== root; e = e.next!) append(e.p1);
  append(e.p1);

  return [out];
}

/**
 * `SHAPE_POLY_SET::unfractureSingle` (shape_poly_set.cpp:1675), as it
 * actually behaves.
 *
 * It simplifies the ring (`SHAPE_LINE_CHAIN::Simplify`, tolerance 0) and
 * then means to cut out every edge that has an exact reverse twin — the
 * slits — by looking each edge up in an `unordered_set<EDGE, EDGE::HASH>`
 * whose equality is "reverse of". But `EDGE::HASH` hashes (A.x, B.x, A.y,
 * B.y) in order, so an edge and its twin hash differently and `find` only
 * meets the twin when the two happen to share a bucket. In practice nothing
 * is cut, the ring comes back whole, and it is the `Simplify()` that
 * `Unfracture` runs next — a union — that turns the slits back into holes.
 * So this is the simplification alone; the union follows in `unfracture`.
 */
function unfractureSingle(paths: Polygon): Polygon {
  if (paths.length !== 1) return paths;
  return [simplifyLineChain(paths[0]!, true, 0)];
}

/** `SHAPE_POLY_SET::Unfracture`: every polygon unfractured, then `Simplify()`. */
export function unfracture(polygons: Polygon[]): Polygon[] {
  return booleanAdd(polygons.map(unfractureSingle), []);
}

/**
 * `SHAPE_POLY_SET::InflateWithLinkedHoles( aFactor, aCornerStrategy, aMaxError )`:
 * `Unfracture`, `Inflate`, `Fracture` — how a zone's fill, which is stored
 * fractured, is grown when it knocks out another zone.
 */
export function inflateWithLinkedHoles(
  polygons: Polygon[],
  amount: number,
  strategy: CornerStrategy,
  circleSegCount: number,
): Vec2[][] {
  return fracture(inflate(unfracture(polygons), amount, strategy, circleSegCount));
}

/** `SEG::SquaredLength()`, in BigInt as `ecoord` is 64-bit. */
const segSquaredLength = (a: Vec2, b: Vec2): bigint => {
  const dx = BigInt(b.x - a.x);
  const dy = BigInt(b.y - a.y);
  return dx * dx + dy * dy;
};

const bsgn = (v: bigint): bigint => (v > 0n ? 1n : v < 0n ? -1n : 0n);
const babs = (v: bigint): bigint => (v < 0n ? -v : v);

/**
 * `SEG::mutualDistanceSquared` + `SEG::ApproxCollinear( aSeg, aThreshold )`:
 * both ends of the shorter segment within the threshold of the longer
 * segment's line, the squared distances in `rescale`d 64-bit integers.
 */
function segApproxCollinear(aA: Vec2, aB: Vec2, bA: Vec2, bB: Vec2, threshold: number): boolean {
  let a = { A: aA, B: aB };
  let b = { A: bA, B: bB };
  if (segSquaredLength(a.A, a.B) < segSquaredLength(b.A, b.B)) [a, b] = [b, a];
  const p = BigInt(a.A.y) - BigInt(a.B.y);
  const q = BigInt(a.B.x) - BigInt(a.A.x);
  const r = -p * BigInt(a.A.x) - q * BigInt(a.A.y);
  const l = p * p + q * q;
  if (l === 0n) return false;
  const det1 = p * BigInt(b.A.x) + q * BigInt(b.A.y) + r;
  const det2 = p * BigInt(b.B.x) + q * BigInt(b.B.y) + r;
  const d1 = bsgn(det1) * rescale64(det1, det1, l);
  const d2 = bsgn(det2) * rescale64(det2, det2, l);
  const thr = BigInt(threshold) * BigInt(threshold);
  return babs(d1) <= thr && babs(d2) <= thr;
}

/**
 * `SHAPE_LINE_CHAIN_BASE::PointInside( aPt, 0, false )`: the +x ray cast,
 * the crossing abscissa in `rescale` integer arithmetic.
 */
function chainPointInside(ring: readonly Vec2[], pt: Vec2): boolean {
  if (ring.length < 3) return false;
  const n = ring.length;
  let inside = false;
  for (let i = 0; i < n; ) {
    const p1 = ring[i++]!;
    const p2 = ring[i === n ? 0 : i]!;
    const dy = p2.y - p1.y;
    if (dy === 0) continue;
    const d = Number(rescale64(BigInt(p2.x - p1.x), BigInt(pt.y - p1.y), BigInt(dy)));
    if (p1.y >= pt.y !== p2.y >= pt.y && pt.x - p1.x < d) inside = !inside;
  }
  return inside;
}

/** `VECTOR2I::EuclideanNorm()`: an integer, `KiROUND( hypot )` (45° and axis cases exact). */
function euclideanNormI(v: Vec2): number {
  if (Math.abs(v.x) === Math.abs(v.y)) return kiRound(Math.abs(v.x) * Math.SQRT2);
  if (v.x === 0) return Math.abs(v.y);
  if (v.y === 0) return Math.abs(v.x);
  return kiRound(hypot(v.x, v.y));
}

/** `VECTOR2I::Resize( aNewLength )`. */
function resizeI(v: Vec2, newLength: number): Vec2 {
  if (v.x === 0 && v.y === 0) return { x: 0, y: 0 };
  let newX: number;
  let newY: number;
  if (Math.abs(v.x) === Math.abs(v.y)) newX = newY = Math.abs(newLength) * Math.SQRT1_2;
  else {
    const xSq = BigInt(v.x) * BigInt(v.x);
    const ySq = BigInt(v.y) * BigInt(v.y);
    const lSq = xSq + ySq;
    const nSq = BigInt(newLength) * BigInt(newLength);
    newX = Math.sqrt(Number(rescale64(nSq, xSq, lSq)));
    newY = Math.sqrt(Number(rescale64(nSq, ySq, lSq)));
  }
  const sign = newLength > 0 ? 1 : newLength < 0 ? -1 : 0;
  return {
    x: (v.x < 0 ? -kiRound(newX) : kiRound(newX)) * sign,
    y: (v.y < 0 ? -kiRound(newY) : kiRound(newY)) * sign,
  };
}

/**
 * `SHAPE_POLY_SET::isExteriorWaist( aSegA, aSegB )`: the overlap of two
 * collinear segments, tested a little either side — an exterior waist has
 * polygon material on neither side (`PointInside` asks every OUTLINE of the
 * set, holes not consulted).
 */
function isExteriorWaist(polys: Polygon[], segA: [Vec2, Vec2], segB: [Vec2, Vec2]): boolean {
  const da = { x: segA[1].x - segA[0].x, y: segA[1].y - segA[0].y };
  const axis = Math.abs(da.x) >= Math.abs(da.y) ? 0 : 1;
  const pts = [segA[0], segA[1], segB[0], segB[1]].sort((p, q) =>
    axis === 0 ? p.x - q.x || p.y - q.y : p.y - q.y || p.x - q.x,
  );
  const s = pts[1]!;
  const e = pts[2]!;
  // `( s + e ) / 2`: a VECTOR2I over a scalar is KiROUND per component.
  const midpoint = { x: kiRound((s.x + e.x) / 2), y: kiRound((s.y + e.y) / 2) };
  const segDir = { x: e.x - s.x, y: e.y - s.y };
  if (euclideanNormI(segDir) > 25) {
    const perp = resizeI({ x: -segDir.y, y: segDir.x }, 10);
    const inside = (pt: Vec2): boolean => polys.some((poly) => chainPointInside(poly[0]!, pt));
    const side1 = inside({ x: midpoint.x + perp.x, y: midpoint.y + perp.y });
    const side2 = inside({ x: midpoint.x - perp.x, y: midpoint.y - perp.y });
    if (!side1 && !side2) return true;
  }
  return false;
}

/**
 * `SHAPE_POLY_SET::splitCollinearOutlines()`: an outline that runs along the
 * same line twice with nothing on either side — two lobes joined by a
 * zero-width waist — is cut into two outlines there, until none is left.
 * (Upstream finds the pair through an R-tree; the first pair in segment order
 * is what a sound polygon yields either way.)
 */
function splitCollinearOutlines(polygons: Polygon[]): Polygon[] {
  const polys = polygons.map((poly) => poly.map((r) => [...r]));
  for (let polyIdx = 0; polyIdx < polys.length; ++polyIdx) {
    let changed = true;
    while (changed) {
      changed = false;
      const outline = polys[polyIdx]![0]!;
      const count = outline.length;
      let segA = -1;
      let segB = -1;
      let found = false;
      for (let i = 0; i < count && !found; ++i) {
        const a = outline[i]!;
        const b = outline[(i + 1) % count]!;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        for (let j = 0; j < count; ++j) {
          if (j === i || j === (i + 1) % count || j === (i + count - 1) % count) continue;
          const oa = outline[j]!;
          const ob = outline[(j + 1) % count]!;
          // the R-tree search: only segments whose boxes overlap
          if (
            Math.max(oa.x, ob.x) < minX ||
            Math.min(oa.x, ob.x) > maxX ||
            Math.max(oa.y, ob.y) < minY ||
            Math.min(oa.y, ob.y) > maxY
          )
            continue;
          // "Skip segments that share start/end points. This is the case for
          // fractured segments"
          if (oa.x === a.x && oa.y === a.y && ob.x === b.x && ob.y === b.y) continue;
          if (oa.x === b.x && oa.y === b.y && ob.x === a.x && ob.y === a.y) continue;
          if (segApproxCollinear(a, b, oa, ob, 10) && isExteriorWaist(polys, [a, b], [oa, ob])) {
            segA = i;
            segB = j;
            found = true;
            break;
          }
        }
      }
      if (!found) break;

      const a0 = segA;
      const a1 = (segA + 1) % count;
      const b0 = segB;
      const b1 = (segB + 1) % count;
      const lc1: Vec2[] = [];
      let idx = a1;
      lc1.push(outline[idx]!);
      while (idx !== b0) {
        idx = (idx + 1) % count;
        chainAppend(lc1, outline[idx]!);
      }
      chainSetClosed(lc1);
      const lc2: Vec2[] = [];
      idx = b1;
      lc2.push(outline[idx]!);
      while (idx !== a0) {
        idx = (idx + 1) % count;
        chainAppend(lc2, outline[idx]!);
      }
      chainSetClosed(lc2);
      polys[polyIdx]![0] = lc1;
      polys.push([lc2]);
      changed = true;
    }
  }
  return polys;
}

/** `SHAPE_LINE_CHAIN::Append( pt )`: a point equal to the last is not repeated. */
function chainAppend(ring: Vec2[], p: Vec2): void {
  const last = ring[ring.length - 1];
  if (!last || last.x !== p.x || last.y !== p.y) ring.push(p);
}

/** `SHAPE_LINE_CHAIN::SetClosed( true )`: a last point equal to the first is dropped. */
function chainSetClosed(ring: Vec2[]): void {
  if (ring.length > 1) {
    const f = ring[0]!;
    const l = ring[ring.length - 1]!;
    if (f.x === l.x && f.y === l.y) ring.pop();
  }
}

/**
 * `SHAPE_POLY_SET::Simplify()`: `splitCollinearOutlines()` and then a union
 * with an empty set — a Clipper pass, which is what re-starts every ring at
 * the vertex Clipper picks.
 */
export const simplify = (polygons: Polygon[]): Polygon[] =>
  booleanAdd(splitCollinearOutlines(polygons), []);

/**
 * `SHAPE_POLY_SET::Fracture( aSimplify = true )`: `Simplify()` — "remove
 * overlapping holes/degeneracy" — and then every polygon fractured into one
 * simple ring. The default is what every caller in the zone filler uses, and
 * the Simplify is load-bearing for parity: it is a Clipper pass, so the
 * fractured ring starts where Clipper's union starts it.
 */
export function fracture(polygons: Polygon[]): Vec2[][] {
  return fractureNoSimplify(simplify(polygons));
}

/** `SHAPE_POLY_SET::Fracture( false )`: the fracture alone. */
export function fractureNoSimplify(polygons: Polygon[]): Vec2[][] {
  const out: Vec2[][] = [];
  for (const poly of polygons) {
    for (const ring of fractureSingle(poly)) out.push(ring);
  }
  return out;
}

// ----- offsetting (SHAPE_POLY_SET::Inflate) -----------------------------------

/**
 * CORNER_STRATEGY (shape_poly_set.h): how a corner is treated when a polygon is
 * inflated. Deflating never spikes, but inflating can throw long spikes off an
 * acute corner, which is why the zone filler picks its strategy deliberately.
 */
export enum CornerStrategy {
  /** Just extend the edges; leaves large spikes on acute angles. */
  ALLOW_ACUTE_CORNERS = 0,
  /** Acute angles are chamfered. */
  CHAMFER_ACUTE_CORNERS = 1,
  /** Acute angles are rounded. */
  ROUND_ACUTE_CORNERS = 2,
  /** Every angle is chamfered. */
  CHAMFER_ALL_CORNERS = 3,
  /** Every angle is rounded; the nicest shape, and the most segments. */
  ROUND_ALL_CORNERS = 4,
}

/**
 * `SHAPE_LINE_CHAIN::Area( false )`: `-area * 0.5`, negative for a ring wound
 * anti-clockwise, with the terms cast in the order the C++ casts them.
 */
function chainArea(ring: Vec2[]): number {
  let area = 0.0;
  const size = ring.length;
  for (let i = 0, j = size - 1; i < size; ++i) {
    area += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
    j = i;
  }
  return -area * 0.5;
}

/**
 * `SHAPE_LINE_CHAIN::convertToClipper2`: the ring reversed when its winding is
 * not the one asked for — an outline one way, a hole the other. Clipper2's
 * non-zero rule counts windings, so this is what makes two overlapping paths
 * union rather than cancel.
 */
function convertToClipper2(ring: Vec2[], aRequiredOrientation: boolean): Path64 {
  const orientation = chainArea(ring) >= 0;
  const input = orientation !== aRequiredOrientation ? [...ring].reverse() : ring;
  // A SHAPE_LINE_CHAIN is VECTOR2I; a caller here may still hold a fraction,
  // and Clipper2 is an integer engine. KiROUND is what fills a VECTOR2I.
  return input.map((p) => ({ x: kiRound(p.x), y: kiRound(p.y) }));
}

/**
 * `SHAPE_LINE_CHAIN( const Path64& )`: `Append` refuses a point equal to the
 * one before it, and nothing else is touched.
 */
function chainFromPath(path: Path64): Vec2[] {
  const out: Vec2[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * `SHAPE_POLY_SET::importTree` / `importPolyPath`: a PolyPath that is not a
 * hole is an outline, its children are its holes, and an outline nested inside
 * one of those holes starts a polygon of its own.
 */
function importTree(tree: PolyTree64): Polygon[] {
  const out: Polygon[] = [];

  const importPolyPath = (node: PolyPath64): void => {
    if (node.isHole()) return;
    const paths: Polygon = [chainFromPath(node.polygon)];
    for (const child of node.childs) {
      paths.push(chainFromPath(child.polygon));
      for (const grandchild of child.childs) importPolyPath(grandchild);
    }
    out.push(paths);
  };

  for (const n of tree.childs) importPolyPath(n);
  return out;
}

/**
 * `SHAPE_POLY_SET::inflate2`. Offsets every polygon by `amount` (negative
 * deflates) with the join type and miter limit upstream maps each corner
 * strategy to, and the arc tolerance it derives from the segment count:
 *
 *   ArcTolerance = |amount| * (1 - cos(pi / circleSegCount))
 *
 * `simplify` is upstream's `aSimplify`: `SimplifyPaths` is called and its
 * result discarded (shape_poly_set.cpp:1009), so what it actually does is run
 * the offset's own union a second time, `FillRule::Positive`, un-reversed.
 * Clipper works in integers, which our internal units already are.
 */
export function inflate(
  polygons: Polygon[],
  amount: number,
  strategy: CornerStrategy = CornerStrategy.ROUND_ALL_CORNERS,
  circleSegCount = 16,
  simplify = false,
): Polygon[] {
  const c = new ClipperOffset();

  let joinType = JoinType.Round;
  let miterLimit = 2.0;

  switch (strategy) {
    case CornerStrategy.ALLOW_ACUTE_CORNERS:
      joinType = JoinType.Miter;
      miterLimit = 10; // Allows large spikes
      break;
    case CornerStrategy.CHAMFER_ACUTE_CORNERS:
    case CornerStrategy.ROUND_ACUTE_CORNERS:
      joinType = JoinType.Miter;
      break;
    case CornerStrategy.CHAMFER_ALL_CORNERS:
      joinType = JoinType.Square;
      break;
    case CornerStrategy.ROUND_ALL_CORNERS:
      joinType = JoinType.Round;
      break;
  }

  for (const poly of polygons)
    c.addPaths(
      poly.map((ring, i) => convertToClipper2(ring, i === 0)),
      joinType,
      EndType.Polygon,
    );

  if (circleSegCount < 6) circleSegCount = 6; // avoid incorrect aCircleSegCount values
  const coeff = 1.0 - cos(PI / circleSegCount);

  c.arcTolerance(Math.abs(amount) * coeff);
  c.miterLimit(miterLimit);

  const tree = new PolyPath64();

  if (simplify) {
    const paths = c.executePaths(amount);
    const c2 = new Clipper64();
    c2.preserveCollinear(false);
    c2.reverseSolution(false);
    c2.addSubject(paths);
    c2.executeTree(ClipType.Union, FillRule.Positive, tree);
  } else {
    c.executeTree(amount, tree);
  }

  return importTree(tree);
}

/** `SHAPE_POLY_SET`'s three boolean operations. */
export enum BooleanOp {
  ADD = 0,
  SUBTRACT = 1,
  INTERSECT = 2,
}

/**
 * `SHAPE_POLY_SET::booleanOp`: `Clipper64`, `FillRule::NonZero`, the answer
 * read back through its PolyTree.
 *
 * It was even-odd here once, on the reasoning that the two rules agree for
 * single rings and for Clipper's own output — which they do. They part company
 * the moment a caller hands in shapes that OVERLAP EACH OTHER: the zone filler
 * subtracts a list of knockouts that overlap constantly (two pads of one part,
 * a track ending on a pad), and under even-odd the overlap between two holes
 * cancels back to copper.
 */
export function booleanOp(subject: Polygon[], clip: Polygon[], op: BooleanOp): Polygon[] {
  const c = new Clipper64();

  const paths: Paths64 = [];
  const clips: Paths64 = [];
  for (const poly of subject)
    poly.forEach((ring, i) => void paths.push(convertToClipper2(ring, i === 0)));
  for (const poly of clip)
    poly.forEach((ring, i) => void clips.push(convertToClipper2(ring, i === 0)));

  c.addSubject(paths);
  c.addClip(clips);

  const clipType =
    op === BooleanOp.ADD
      ? ClipType.Union
      : op === BooleanOp.SUBTRACT
        ? ClipType.Difference
        : ClipType.Intersection;

  const solution = new PolyPath64();
  c.executeTree(clipType, FillRule.NonZero, solution);
  return importTree(solution);
}

/** `SHAPE_POLY_SET::BooleanAdd`. */
export const booleanAdd = (a: Polygon[], b: Polygon[]): Polygon[] => booleanOp(a, b, BooleanOp.ADD);

/** `SHAPE_POLY_SET::BooleanSubtract`. */
export const booleanSubtract = (a: Polygon[], b: Polygon[]): Polygon[] =>
  booleanOp(a, b, BooleanOp.SUBTRACT);

/** `SHAPE_POLY_SET::BooleanIntersection`. */
export const booleanIntersection = (a: Polygon[], b: Polygon[]): Polygon[] =>
  booleanOp(a, b, BooleanOp.INTERSECT);

// ----- corner smoothing (corner_operations.cpp) --------------------------------

/** CORNER_MODE for chamferFilletPolygon. */
export enum CornerMode {
  CHAMFERED = 0,
  FILLETED = 1,
}

/** KiCad's KiROUND: round half away from zero. */
const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/**
 * `SHAPE_POLY_SET::RemoveNullSegments` on one polygon: a vertex equal to the
 * one after it (the last wrapping to the first) is dropped.
 */
function removeNullSegments(poly: Polygon): Polygon {
  return poly.map((ring) =>
    ring.filter((p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      return p.x !== q.x || p.y !== q.y;
    }),
  );
}

/**
 * SHAPE_POLY_SET::chamferFilletPolygon (corner_operations.cpp): replace every
 * corner of every contour with either a straight cut (chamfer) or an arc
 * (fillet). Both are limited to half of the shorter adjacent edge, so a corner
 * can never eat its neighbour, and both leave parallel edges alone.
 */
export function chamferFilletPolygon(
  aPoly: Polygon,
  mode: CornerMode,
  distance: number,
  errorMax = 0,
): Polygon {
  // "Null segments create serious issues in calculations. Remove them" —
  // before the zero-distance early return, as upstream orders it.
  const poly = removeNullSegments(aPoly);
  if (distance === 0) return poly.map((ring) => ring.map((p) => ({ ...p })));

  const out: Polygon = [];

  for (const contour of poly) {
    const newContour: Vec2[] = [];
    const count = contour.length;

    for (let currVertex = 0; currVertex < count; currVertex++) {
      const x1 = contour[currVertex]!.x;
      const y1 = contour[currVertex]!.y;
      const prevVertex = currVertex === 0 ? count - 1 : currVertex - 1;
      const nextVertex = currVertex === count - 1 ? 0 : currVertex + 1;

      const xa = contour[prevVertex]!.x - x1;
      const ya = contour[prevVertex]!.y - y1;
      const xb = contour[nextVertex]!.x - x1;
      const yb = contour[nextVertex]!.y - y1;

      // Avoid segments that would generate NaNs below.
      if (Math.abs(xa + xb) < Number.EPSILON && Math.abs(ya + yb) < Number.EPSILON) continue;

      const lena = hypot(xa, ya);
      const lenb = hypot(xb, yb);

      if (mode === CornerMode.CHAMFERED) {
        let d = distance;
        // Chamfer one half of an edge at most.
        if (0.5 * lena < d) d = 0.5 * lena;
        if (0.5 * lenb < d) d = 0.5 * lenb;

        newContour.push({ x: x1 + kiRound((d * xa) / lena), y: y1 + kiRound((d * ya) / lena) });
        newContour.push({ x: x1 + kiRound((d * xb) / lenb), y: y1 + kiRound((d * yb) / lenb) });
        continue;
      }

      const cosine = (xa * xb + ya * yb) / (lena * lenb);
      let radius = distance;
      const denom = Math.sqrt(2.0 / (1 + cosine) - 1);

      // Parallel edges have nothing to round.
      if (!Number.isFinite(denom)) continue;

      // Limit the rounding to one half of an edge.
      if (0.5 * lena * denom < radius) radius = 0.5 * lena * denom;
      if (0.5 * lenb * denom < radius) radius = 0.5 * lenb * denom;

      // The fillet arc's centre.
      let k = radius / Math.sqrt(0.5 * (1 - cosine));
      const lenab = Math.sqrt(
        (xa / lena + xb / lenb) * (xa / lena + xb / lenb) +
          (ya / lena + yb / lenb) * (ya / lena + yb / lenb),
      );
      const xc = x1 + (k * (xa / lena + xb / lenb)) / lenab;
      const yc = y1 + (k * (ya / lena + yb / lenb)) / lenab;

      // Arc start and end vectors.
      k = radius / Math.sqrt(2 / (1 + cosine) - 1);
      const xs = x1 + (k * xa) / lena - xc;
      const ys = y1 + (k * ya) / lena - yc;
      const xe = x1 + (k * xb) / lenb - xc;
      const ye = y1 + (k * yb) / lenb - yc;

      let argument = (xs * xe + ys * ye) / (radius * radius);
      argument = Math.max(-1, Math.min(1, argument));

      const arcAngle = acos(argument);
      // `GetArcToSegmentCount( radius, aErrorMax, EDA_ANGLE( arcAngle, RADIANS_T ) )`
      // takes `int aRadius`: the double radius truncates on the way in.
      const segments = getArcToSegmentCount(
        Math.trunc(radius),
        errorMax,
        new EDA_ANGLE(arcAngle, EDA_ANGLE_T.RADIANS_T).AsDegrees(),
      );
      let deltaAngle = arcAngle / segments;
      const startAngle = atan2(-ys, xs);

      // Flip the arc for inner corners.
      if (xa * yb - ya * xb <= 0) deltaAngle *= -1;

      let nx = xc + xs;
      let ny = yc + ys;
      if (Number.isNaN(nx) || Number.isNaN(ny)) continue;

      newContour.push({ x: kiRound(nx), y: kiRound(ny) });

      let prevX = kiRound(nx);
      let prevY = kiRound(ny);

      for (let j = 0; j < segments; j++) {
        nx = xc + cos(startAngle + (j + 1) * deltaAngle) * radius;
        ny = yc - sin(startAngle + (j + 1) * deltaAngle) * radius;
        if (Number.isNaN(nx) || Number.isNaN(ny)) continue;

        // Rounding can repeat a corner; do not add it twice.
        if (kiRound(nx) !== prevX || kiRound(ny) !== prevY) {
          newContour.push({ x: kiRound(nx), y: kiRound(ny) });
          prevX = kiRound(nx);
          prevY = kiRound(ny);
        }
      }
    }

    if (newContour.length >= 3) out.push(newContour);
  }

  return out;
}

/** SHAPE_POLY_SET::Chamfer: cut every corner back by `distance`. */
export const chamfer = (polygons: Polygon[], distance: number): Polygon[] =>
  polygons.map((poly) => chamferFilletPolygon(poly, CornerMode.CHAMFERED, distance));

/** SHAPE_POLY_SET::Fillet: round every corner to `radius`. */
export const fillet = (polygons: Polygon[], radius: number, errorMax: number): Polygon[] =>
  polygons.map((poly) => chamferFilletPolygon(poly, CornerMode.FILLETED, radius, errorMax));

/**
 * `SHAPE_POLY_SET::BuildPolysetFromOrientedPaths`.
 *
 * A union of closed paths under a *chosen* fill rule, rather than the even-odd
 * rule the rest of this file assumes. That choice is the whole point: an SVG
 * says which of `nonzero` and `evenodd` decides what is inside its sub-paths,
 * and two concentric rings wound the same way are a filled disc under one rule
 * and an annulus under the other.
 *
 * The outline/hole nesting comes from Clipper's own PolyTree, as
 * `SHAPE_POLY_SET::importTree` reads it.
 */
export function buildPolysetFromOrientedPaths(paths: Vec2[][], evenOdd: boolean): Polygon[] {
  const clipper = new Clipper64();
  const tree = new PolyPath64();

  clipper.addSubject(paths.map((ring) => ring.map((p) => ({ x: p.x, y: p.y }))));
  clipper.executeTree(ClipType.Union, evenOdd ? FillRule.EvenOdd : FillRule.NonZero, tree);

  return importTree(tree);
}
