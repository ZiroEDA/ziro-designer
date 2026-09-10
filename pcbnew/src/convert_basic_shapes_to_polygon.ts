// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Basic shapes as integer polygons. Counterpart:
 * `libs/kimath/src/convert_basic_shapes_to_polygon.cpp` and
 * `GetArcToSegmentCount` (`geometry_utils.cpp`).
 *
 * These are the polygons the zone filler knocks out and the text hull is
 * measured from, so they live in one place: a vertex the pour puts on an arc
 * has to be the vertex the text's rendered stroke has.
 */

import type { Ring } from 'polygon-clipping';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * `GetArcToSegmentCount` (geometry_utils.cpp:42): enough segments that the
 * sagitta — the gap between the middle of a chord and the arc — stays under
 * `maxError`.
 *
 * `arc_increment` is the angle one segment spans, floored at 360/8 so a tiny
 * radius still gets a recognisable circle, and the count is the arc over that,
 * ROUNDED rather than ceilinged.
 */
export function segmentsForRadius(radius: number, maxError: number, arcAngleDeg = 360): number {
  const r = Math.max(1, radius);
  const err = Math.max(1, maxError);
  const arcIncrement = Math.min(360 / 8, (180 / Math.PI) * Math.acos(1 - err / r) * 2 || 360 / 8);
  return Math.max(2, Math.round(Math.abs(arcAngleDeg) / arcIncrement));
}

/**
 * A circle as a polygon, inscribed the way TransformCircleToPolygon does.
 *
 * The vertices are ROUNDED to whole internal units. KiCad's `SHAPE_POLY_SET`
 * is `VECTOR2I` — Clipper is an integer library and every polygon reaching it
 * has integer corners — and ours had been handing `polygon-clipping` raw
 * `cos`/`sin` output. Two knockouts whose arcs very nearly touch then differ in
 * the fifteenth decimal, and its sweep line fails outright with "Unable to find
 * segment … in SweepLine tree" rather than returning a wrong answer. Rounding
 * is both the faithful thing and the robust one.
 */
export function circlePoly(c: Vec2, r: number, maxError: number): Ring {
  // "Round up to 8 to make segment approximations align properly at 45-degrees".
  const n = Math.floor((segmentsForRadius(r, maxError) + 7) / 8) * 8;

  // ERROR_OUTSIDE: "The outer radius should be radius+aError" — the polygon is
  // pushed out until it is TANGENT to the true circle at each edge's middle,
  // so a clearance knockout is never smaller than the clearance asked for.
  // Inscribing it instead, as this did, leaves the copper up to one maxError
  // too close on every arc; at the scale of a zone's minimum thickness that is
  // the difference between a web that survives the prune and one that does not.
  const alpha = Math.PI / n;
  const radius = r + Math.round(Math.abs(r * (1 - 1 / Math.cos(alpha))));

  const ring: Ring = [];
  // `for( angle = delta / 2; angle < ANGLE_360; angle += delta )` — the first
  // vertex is half a step round, which is what puts an edge MIDDLE on each
  // axis rather than a vertex.
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / n;
    ring.push([Math.round(c.x + radius * Math.cos(a)), Math.round(c.y + radius * Math.sin(a))]);
  }
  return dedupeRing(ring);
}

/**
 * Drop consecutive duplicates left by the rounding above, and the wrap-around
 * pair. `SHAPE_LINE_CHAIN::Append` does the same for the same reason: a
 * zero-length edge is not geometry, and a clipper is entitled to reject one.
 */
export function dedupeRing(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) break;
    out.pop();
  }
  return out;
}

/**
 * `TransformOvalToPolygon` with ERROR_OUTSIDE: a segment thickened by `r`.
 *
 * The caps take the same outward radius correction as `circlePoly`, but the
 * straight SIDES do not — upstream builds the whole shape at the corrected
 * radius and then clips it back to a rectangle of the exact half-width, "to
 * avoid creating useless corner at segment ends". With the vertices at
 * half-step offsets the extreme cap vertex sits at exactly ±r, so that clip
 * takes nothing off the caps and this builds the clipped shape directly.
 */
export function stadiumPoly(a: Vec2, b: Vec2, r: number, maxError: number): Ring {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return circlePoly(a, r, maxError);

  const n = Math.floor((segmentsForRadius(r, maxError) + 7) / 8) * 8;
  const alpha = Math.PI / n;
  const radius = r + Math.round(Math.abs(r * (1 - 1 / Math.cos(alpha))));
  const delta = (2 * Math.PI) / n;

  // The local frame upstream works in: x along the segment, y across it.
  const ux = dx / len;
  const uy = dy / len;
  const put = (lx: number, ly: number): [number, number] => [
    Math.round(a.x + lx * ux - ly * uy),
    Math.round(a.y + lx * uy + ly * ux),
  ];

  const ring: Ring = [];
  ring.push(put(len, r)); // right arc start
  for (let angle = delta / 2; angle < Math.PI; angle += delta)
    ring.push(put(len + radius * Math.sin(angle), radius * Math.cos(angle)));
  ring.push(put(len, -r)); // finish right arc
  ring.push(put(0, -r)); // left arc start
  for (let angle = delta / 2; angle < Math.PI; angle += delta)
    ring.push(put(-radius * Math.sin(angle), -radius * Math.cos(angle)));
  ring.push(put(0, r)); // finish left arc
  return dedupeRing(ring);
}
