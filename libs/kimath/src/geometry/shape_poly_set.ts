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

  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, amount);
  return importTree(tree);
}

/**
 * A ring with whole-IU corners, consecutive duplicates dropped.
 *
 * `SHAPE_POLY_SET` is `VECTOR2I`: every polygon KiCad hands Clipper, and every
 * one it takes back, has integer corners, and `SHAPE_LINE_CHAIN::Append`
 * refuses a zero-length edge. An offset works in floating point, so without
 * this the result carries fractional vertices — and a later boolean on two
 * shapes that very nearly coincide fails outright ("Unable to find segment …
 * in SweepLine tree") rather than answering wrongly. Rounding here is both the
 * faithful thing and the robust one.
 */
function roundRing(ring: { X: number; Y: number }[]): Vec2[] {
  const out: Vec2[] = [];

  for (const p of ring) {
    const q = { x: Math.round(p.X), y: Math.round(p.Y) };
    const last = out[out.length - 1];
    if (last && last.x === q.x && last.y === q.y) continue;
    out.push(q);
  }

  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first.x !== last.x || first.y !== last.y) break;
    out.pop();
  }

  return out;
}

/**
 * `SHAPE_POLY_SET::importTree` — keep the hierarchy Clipper already worked out,
 * rather than deriving it again from containment.
 *
 * A PolyTree node that is not a hole is an outline, the hole children under it
 * are its holes, and an outline nested inside one of those holes starts a
 * polygon of its own. Asking Clipper for a flat list instead and nesting it by
 * point-in-polygon is O(rings²), which on a pour with thousands of rings is the
 * difference between two seconds and not finishing.
 */
interface PolyNode {
  Contour: () => { X: number; Y: number }[];
  IsHole: () => boolean;
  Childs: () => PolyNode[];
}

function importTree(tree: { Childs: () => PolyNode[] }): Polygon[] {
  const out: Polygon[] = [];

  const visitOutline = (node: PolyNode): void => {
    const outer = roundRing(node.Contour());
    const poly: Polygon = outer.length >= 3 ? [outer] : [];

    for (const hole of node.Childs()) {
      const ring = roundRing(hole.Contour());
      if (poly.length > 0 && ring.length >= 3) poly.push(ring);
      // An outline nested inside a hole is a separate polygon.
      for (const inner of hole.Childs()) visitOutline(inner);
    }

    if (poly.length > 0) out.push(poly);
  };

  for (const child of tree.Childs()) visitOutline(child);

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
 * `FillRule::NonZero`, which is what `SHAPE_POLY_SET::booleanOp` declares
 * (shape_poly_set.cpp:859).
 *
 * It was even-odd here, on the reasoning that the two rules agree for single
 * rings and for Clipper's own output — which they do. They part company the
 * moment a caller hands in shapes that OVERLAP EACH OTHER: the zone filler
 * subtracts a list of knockouts that overlap constantly (two pads of one part,
 * a track ending on a pad), and under even-odd the overlap between two holes
 * cancels back to copper.
 */
export function booleanOp(subject: Polygon[], clip: Polygon[], op: BooleanOp): Polygon[] {
  const toPaths = (polys: Polygon[]): { X: number; Y: number }[][] =>
    polys.flatMap((poly) =>
      poly.map((ring, i) => oriented(ring, i === 0).map((p) => ({ X: p.x, Y: p.y }))),
    );

  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(toPaths(subject), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(toPaths(clip), ClipperLib.PolyType.ptClip, true);

  const clipType =
    op === BooleanOp.ADD
      ? ClipperLib.ClipType.ctUnion
      : op === BooleanOp.SUBTRACT
        ? ClipperLib.ClipType.ctDifference
        : ClipperLib.ClipType.ctIntersection;

  const tree = new ClipperLib.PolyTree();
  clipper.Execute(
    clipType,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );

  return importTree(tree);
}

/** Twice the signed area of a ring; its sign is the ring's orientation. */
function signedArea2(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
  return a;
}

/**
 * The ring wound the way `SHAPE_POLY_SET` keeps it: an outline one way, its
 * holes the other.
 *
 * The non-zero rule counts windings, so two overlapping paths only union if
 * they turn the same way — wind one of them backwards and the overlap sums to
 * zero and disappears. Upstream never hits this because a SHAPE_POLY_SET is
 * always oriented; a caller handing in rings it built itself (a knockout circle,
 * a stadium along a pad edge) has no such guarantee, so they are oriented here.
 */
function oriented(ring: Vec2[], outline: boolean): Vec2[] {
  const positive = signedArea2(ring) > 0;
  return positive === outline ? ring : [...ring].reverse();
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
  const clipper = new ClipperLib.Clipper();

  clipper.AddPaths(
    paths.map((ring) => ring.map((p) => ({ X: p.x, Y: p.y }))),
    ClipperLib.PolyType.ptSubject,
    true,
  );

  const fillRule = evenOdd
    ? ClipperLib.PolyFillType.pftEvenOdd
    : ClipperLib.PolyFillType.pftNonZero;
  const tree = new ClipperLib.PolyTree();

  clipper.Execute(ClipperLib.ClipType.ctUnion, tree, fillRule, fillRule);

  return importTree(tree);
}
