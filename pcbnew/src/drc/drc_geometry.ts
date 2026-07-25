/**
 * Exact DRC shape geometry. Counterparts: the SHAPE classes KiCad's DRC
 * collides (`libs/kimath/src/geometry/shape_*.cpp`):
 *
 *  - circle  = SHAPE_CIRCLE
 *  - stadium = SHAPE_SEGMENT (segment + half-width)
 *  - arc     = SHAPE_ARC (center/radius/angle-range + half-width) — exact
 *              closest-approach: candidates are the radial projection when it
 *              falls inside the angular range, the endpoints both ways, and
 *              circle intersections (distance 0) inside the range.
 *  - poly    = SHAPE_SIMPLE / SHAPE_POLY_SET outline (any simple polygon,
 *              ray-cast containment) with an outward inflation `r` — which
 *              represents rounded-rect pads exactly (deflated rect + corner
 *              radius) and stroked poly primitives (width/2).
 *
 * All distances return the free gap between copper boundaries (0 when the
 * shapes touch or overlap).
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export type Shape =
  | { kind: 'circle'; c: Vec2; r: number }
  | { kind: 'stadium'; a: Vec2; b: Vec2; r: number }
  | { kind: 'arc'; c: Vec2; rad: number; a0: number; sweep: number; r: number }
  | { kind: 'poly'; pts: Vec2[]; r: number };

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function pointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return dist(p, { x: a.x + t * abx, y: a.y + t * aby });
}

export function segSeg(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
  const d1 = (b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x);
  const d2 = (b2.x - b1.x) * (a2.y - b1.y) - (b2.y - b1.y) * (a2.x - b1.x);
  const d3 = (a2.x - a1.x) * (b1.y - a1.y) - (a2.y - a1.y) * (b1.x - a1.x);
  const d4 = (a2.x - a1.x) * (b2.y - a1.y) - (a2.y - a1.y) * (b2.x - a1.x);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    pointSeg(a1, b1, b2),
    pointSeg(a2, b1, b2),
    pointSeg(b1, a1, a2),
    pointSeg(b2, a1, a2),
  );
}

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

/** Free gap between two shapes (0 when touching/overlapping). */
export function shapeDist(s1: Shape, s2: Shape): number {
  // Normalize order: circle < stadium < arc < poly.
  const order = { circle: 0, stadium: 1, arc: 2, poly: 3 } as const;
  if (order[s1.kind] > order[s2.kind]) return shapeDist(s2, s1);

  if (s1.kind === 'circle' && s2.kind === 'circle')
    return Math.max(0, dist(s1.c, s2.c) - s1.r - s2.r);
  if (s1.kind === 'circle' && s2.kind === 'stadium')
    return Math.max(0, pointSeg(s1.c, s2.a, s2.b) - s1.r - s2.r);
  if (s1.kind === 'circle' && s2.kind === 'arc')
    return Math.max(0, pointArc(s1.c, s2) - s1.r - s2.r);
  if (s1.kind === 'circle' && s2.kind === 'poly') {
    if (pointInPoly(s1.c, s2.pts)) return 0;
    let best = Infinity;
    for (const [a, b] of polyEdges(s2.pts)) best = Math.min(best, pointSeg(s1.c, a, b));
    return Math.max(0, best - s1.r - s2.r);
  }
  if (s1.kind === 'stadium' && s2.kind === 'stadium')
    return Math.max(0, segSeg(s1.a, s1.b, s2.a, s2.b) - s1.r - s2.r);
  if (s1.kind === 'stadium' && s2.kind === 'arc')
    return Math.max(0, segArc(s1.a, s1.b, s2) - s1.r - s2.r);
  if (s1.kind === 'stadium' && s2.kind === 'poly') {
    if (pointInPoly(s1.a, s2.pts) || pointInPoly(s1.b, s2.pts)) return 0;
    let best = Infinity;
    for (const [a, b] of polyEdges(s2.pts)) best = Math.min(best, segSeg(s1.a, s1.b, a, b));
    return Math.max(0, best - s1.r - s2.r);
  }
  if (s1.kind === 'arc' && s2.kind === 'arc') return Math.max(0, arcArc(s1, s2) - s1.r - s2.r);
  if (s1.kind === 'arc' && s2.kind === 'poly') {
    if (pointInPoly(arcStart(s1), s2.pts) || pointInPoly(arcEnd(s1), s2.pts)) return 0;
    let best = Infinity;
    for (const [a, b] of polyEdges(s2.pts)) best = Math.min(best, segArc(a, b, s1));
    return Math.max(0, best - s1.r - s2.r);
  }
  // poly-poly
  if (s1.kind === 'poly' && s2.kind === 'poly') {
    if (s1.pts.some((p) => pointInPoly(p, s2.pts))) return 0;
    if (s2.pts.some((p) => pointInPoly(p, s1.pts))) return 0;
    let best = Infinity;
    for (const [a1, a2] of polyEdges(s1.pts))
      for (const [b1, b2] of polyEdges(s2.pts)) best = Math.min(best, segSeg(a1, a2, b1, b2));
    return Math.max(0, best - s1.r - s2.r);
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
