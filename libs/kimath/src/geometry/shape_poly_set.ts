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

import ClipperLib from 'clipper-lib';
import type { Vec2 } from '../math/vector2.js';

/** An outline followed by its holes, KiCad's SHAPE_POLY_SET::POLYGON. */
export type Polygon = Vec2[][];

/** FractureEdgeSlow: one directed edge of the working chain. */
interface FractureEdge {
  connected: boolean;
  p1: Vec2;
  p2: Vec2;
  next: FractureEdge | null;
}

const edge = (connected: boolean, p1: Vec2, p2: Vec2): FractureEdge => ({
  connected,
  p1,
  p2,
  next: null,
});

/** FractureEdgeSlow::matches: does the horizontal line at `y` cross this edge? */
const matches = (e: FractureEdge, y: number): boolean =>
  (y >= e.p1.y || y >= e.p2.y) && (y <= e.p1.y || y <= e.p2.y);

/** KiCad's rescale( a, b, c ) = a * b / c, rounded. */
const rescale = (a: number, b: number, c: number): number => Math.round((a * b) / c);

/**
 * processEdge: cut `edge`'s hole open to the nearest connected edge to its left,
 * along the horizontal at its first point, and splice the hole into the chain.
 * Returns how many edges became connected, or 0 if the polygon is broken.
 */
function processEdge(edges: FractureEdge[], e: FractureEdge): number {
  const x = e.p1.x;
  const y = e.p1.y;
  let minDist = Number.POSITIVE_INFINITY;
  let xNearest = 0;
  let nearest: FractureEdge | null = null;

  for (const candidate of edges) {
    if (!matches(candidate, y)) continue;

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
  const lead1 = edge(true, { x: xNearest, y }, { x, y });
  const lead2 = edge(true, { x, y }, { x: xNearest, y });
  const split2 = edge(true, { x: xNearest, y }, nearest.p2);

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
export function fractureSingle(paths: Polygon): Polygon {
  if (paths.length <= 1) return paths.map((p) => p.map((q) => ({ ...q })));

  const edges: FractureEdge[] = [];
  const borderEdges: FractureEdge[] = [];
  let root: FractureEdge | null = null;
  let first = true;
  let numUnconnected = 0;

  for (const path of paths) {
    const points = path;
    const pointCount = points.length;
    let prev: FractureEdge | null = null;
    let firstEdge: FractureEdge | null = null;
    let xMin = Number.POSITIVE_INFINITY;

    for (const p of points) xMin = Math.min(xMin, p.x);

    for (let i = 0; i < pointCount; i++) {
      // The first path is the outline, and starts out connected.
      const fe = edge(first, points[i]!, points[i + 1 === pointCount ? 0 : i + 1]!);

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
    let smallestX: FractureEdge | null = null;

    for (const borderEdge of borderEdges) {
      const xt = borderEdge.p1.x;
      if (xt <= xMin && !borderEdge.connected) {
        xMin = xt;
        smallestX = borderEdge;
      }
    }

    if (!smallestX) break;
    const processed = processEdge(edges, smallestX);

    // A polygon we cannot join is broken; upstream warns and drops it.
    if (!processed) return [];

    numUnconnected -= processed;
  }

  const out: Vec2[] = [];
  let e = root!;
  for (; e.next !== root; e = e.next!) out.push({ ...e.p1 });
  out.push({ ...e.p1 });

  return [out];
}

/**
 * SHAPE_POLY_SET::Fracture: fracture every polygon of the set, leaving a list of
 * simple rings.
 */
export function fracture(polygons: Polygon[]): Vec2[][] {
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
 * SHAPE_POLY_SET::Inflate. Offsets every polygon by `amount` (negative
 * deflates), with the join type and miter limit upstream maps each corner
 * strategy to, and the arc tolerance it derives from the segment count:
 *
 *   ArcTolerance = |amount| * (1 - cos(pi / circleSegCount))
 *
 * Clipper works in integers, which our internal units already are.
 */
export function inflate(
  polygons: Polygon[],
  amount: number,
  strategy: CornerStrategy = CornerStrategy.ROUND_ALL_CORNERS,
  circleSegCount = 16,
): Polygon[] {
  if (amount === 0 || polygons.length === 0) return polygons.map((p) => p.map((r) => [...r]));

  let joinType: number;
  let miterLimit = 2.0;

  switch (strategy) {
    case CornerStrategy.ALLOW_ACUTE_CORNERS:
      joinType = ClipperLib.JoinType.jtMiter;
      miterLimit = 10; // allows large spikes
      break;
    case CornerStrategy.CHAMFER_ACUTE_CORNERS:
    case CornerStrategy.ROUND_ACUTE_CORNERS:
      joinType = ClipperLib.JoinType.jtMiter;
      break;
    case CornerStrategy.CHAMFER_ALL_CORNERS:
      joinType = ClipperLib.JoinType.jtSquare;
      break;
    default:
      joinType = ClipperLib.JoinType.jtRound;
      break;
  }

  // Guard the segment count the way upstream does before deriving the tolerance.
  const segs = circleSegCount < 6 ? 6 : circleSegCount;
  const coeff = 1.0 - Math.cos(Math.PI / segs);

  const co = new ClipperLib.ClipperOffset(miterLimit, Math.abs(amount) * coeff);

  for (const poly of polygons) {
    co.AddPaths(
      poly.map((ring) => ring.map((p) => ({ X: p.x, Y: p.y }))),
      joinType,
      ClipperLib.EndType.etClosedPolygon,
    );
  }

  const solution: { X: number; Y: number }[][] = [];
  co.Execute(solution, amount);

  // Clipper hands back a flat list of rings, holes wound the other way from
  // their outline (SHAPE_POLY_SET regroups the same way when it imports from
  // Clipper).
  return nestRings(solution);
}

/**
 * Rebuild `Polygon[]` from Clipper's flat list of rings.
 *
 * Clipper returns outlines and holes mixed together, distinguished only by
 * winding. Rather than trust a winding convention, rings are nested: a ring
 * inside an even number of others is an outline, an odd one is a hole belonging
 * to the smallest outline containing it. Shared by the offset and the boolean
 * ops, which get the same shape of answer back.
 */
function nestRings(solution: { X: number; Y: number }[][]): Polygon[] {
  const rings = solution
    .map((ring) => ring.map((p) => ({ x: p.X, y: p.Y })))
    .filter((ring) => ring.length >= 3);

  const containers = rings.map((ring, i) =>
    rings.filter((other, j) => j !== i && pointInRing(ring[0]!, other)),
  );

  const out: Polygon[] = [];
  const indexOfOutline = new Map<Vec2[], number>();

  rings.forEach((ring, i) => {
    if (containers[i]!.length % 2 === 0) {
      indexOfOutline.set(ring, out.length);
      out.push([ring]);
    }
  });

  rings.forEach((ring, i) => {
    if (containers[i]!.length % 2 === 0) return;
    let best: Vec2[] | null = null;
    let bestArea = Number.POSITIVE_INFINITY;
    for (const candidate of containers[i]!) {
      if (!indexOfOutline.has(candidate)) continue;
      const a = Math.abs(signedArea(candidate));
      if (a < bestArea) {
        bestArea = a;
        best = candidate;
      }
    }
    if (best) out[indexOfOutline.get(best)!]!.push(ring);
  });

  return out;
}

/** `SHAPE_POLY_SET`'s three boolean operations. */
export enum BooleanOp {
  ADD = 0,
  SUBTRACT = 1,
  INTERSECT = 2,
}

/**
 * `SHAPE_POLY_SET::BooleanAdd` / `BooleanSubtract` / `BooleanIntersection`.
 *
 * Both sides are declared even-odd filled, mirroring how SHAPE_POLY_SET hands
 * its polygons to Clipper: it stores holes as separate rings and leans on the
 * fill rule rather than on winding to tell them from outlines.
 *
 * For the inputs this actually receives the non-zero rule would give the same
 * answers — sources are always single rings, and Clipper orients its own output
 * (holes wound against their outline), so both rules read them alike. Checked,
 * rather than assumed: swapping the rule changes nothing measurable, including
 * for a fractured ring fed back through a second operation. Even-odd is kept
 * because it is what upstream declares, not because the difference is load
 * bearing here.
 */
export function booleanOp(subject: Polygon[], clip: Polygon[], op: BooleanOp): Polygon[] {
  const toPaths = (polys: Polygon[]): { X: number; Y: number }[][] =>
    polys.flatMap((poly) => poly.map((ring) => ring.map((p) => ({ X: p.x, Y: p.y }))));

  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(toPaths(subject), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(toPaths(clip), ClipperLib.PolyType.ptClip, true);

  const clipType =
    op === BooleanOp.ADD
      ? ClipperLib.ClipType.ctUnion
      : op === BooleanOp.SUBTRACT
        ? ClipperLib.ClipType.ctDifference
        : ClipperLib.ClipType.ctIntersection;

  const solution: { X: number; Y: number }[][] = [];
  clipper.Execute(
    clipType,
    solution,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd,
  );

  return nestRings(solution);
}

/** `SHAPE_POLY_SET::BooleanAdd`. */
export const booleanAdd = (a: Polygon[], b: Polygon[]): Polygon[] => booleanOp(a, b, BooleanOp.ADD);

/** `SHAPE_POLY_SET::BooleanSubtract`. */
export const booleanSubtract = (a: Polygon[], b: Polygon[]): Polygon[] =>
  booleanOp(a, b, BooleanOp.SUBTRACT);

/** `SHAPE_POLY_SET::BooleanIntersection`. */
export const booleanIntersection = (a: Polygon[], b: Polygon[]): Polygon[] =>
  booleanOp(a, b, BooleanOp.INTERSECT);

/** Twice the signed area; the sign gives the winding. */
function signedArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
  return a / 2;
}

/** Ray-cast containment. */
function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

// ----- corner smoothing (corner_operations.cpp) --------------------------------

/** CORNER_MODE for chamferFilletPolygon. */
export enum CornerMode {
  CHAMFERED = 0,
  FILLETED = 1,
}

/** KiCad's KiROUND: round half away from zero. */
const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/**
 * GetArcToSegmentCount: segments needed to hold an arc of `radius` sweeping
 * `angleRad` within `errorMax`.
 */
function arcToSegmentCount(radius: number, errorMax: number, angleRad: number): number {
  if (radius < 10 || angleRad === 0) return 1;
  const arcAngle = Math.abs(angleRad);
  const maxSegs = Math.ceil((2 * Math.PI) / arcAngle) * 8;
  const argument = 1.0 - errorMax / radius;
  let segCount = argument <= -1 ? maxSegs : Math.ceil((2 * Math.PI) / Math.acos(argument) / 2);
  segCount = Math.ceil((segCount * arcAngle) / (2 * Math.PI));
  return Math.max(1, Math.min(segCount, maxSegs));
}

/**
 * SHAPE_POLY_SET::chamferFilletPolygon (corner_operations.cpp): replace every
 * corner of every contour with either a straight cut (chamfer) or an arc
 * (fillet). Both are limited to half of the shorter adjacent edge, so a corner
 * can never eat its neighbour, and both leave parallel edges alone.
 */
export function chamferFilletPolygon(
  poly: Polygon,
  mode: CornerMode,
  distance: number,
  errorMax = 0,
): Polygon {
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

      const lena = Math.hypot(xa, ya);
      const lenb = Math.hypot(xb, yb);

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
      const lenab = Math.hypot(xa / lena + xb / lenb, ya / lena + yb / lenb);
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

      const arcAngle = Math.acos(argument);
      const segments = arcToSegmentCount(radius, errorMax, arcAngle);
      let deltaAngle = arcAngle / segments;
      const startAngle = Math.atan2(-ys, xs);

      // Flip the arc for inner corners.
      if (xa * yb - ya * xb <= 0) deltaAngle *= -1;

      let nx = xc + xs;
      let ny = yc + ys;
      if (Number.isNaN(nx) || Number.isNaN(ny)) continue;

      newContour.push({ x: kiRound(nx), y: kiRound(ny) });

      let prevX = kiRound(nx);
      let prevY = kiRound(ny);

      for (let j = 0; j < segments; j++) {
        nx = xc + Math.cos(startAngle + (j + 1) * deltaAngle) * radius;
        ny = yc - Math.sin(startAngle + (j + 1) * deltaAngle) * radius;
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
