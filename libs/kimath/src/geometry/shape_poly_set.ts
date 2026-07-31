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
