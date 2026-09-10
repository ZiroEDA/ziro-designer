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

/** `KiROUND`: half away from zero, where `Math.round` is half up. */
const kiround = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));

/**
 * `EDA_ANGLE`'s trig, in degrees, with its exact answers at the multiples of
 * 45° that `sin`/`cos` would return a last-ulp off — the difference between
 * a vertex landing on 152400 and on 152399.999 before it is rounded.
 */
function edaSin(deg: number): number {
  const t = ((deg % 360) + 360) % 360;
  if (t === 0 || t === 180) return 0;
  if (t === 45 || t === 135) return Math.SQRT1_2;
  if (t === 225 || t === 315) return -Math.SQRT1_2;
  if (t === 90) return 1;
  if (t === 270) return -1;
  return Math.sin((deg * Math.PI) / 180);
}
function edaCos(deg: number): number {
  const t = ((deg % 360) + 360) % 360;
  if (t === 0) return 1;
  if (t === 180) return -1;
  if (t === 90 || t === 270) return 0;
  if (t === 45 || t === 315) return Math.SQRT1_2;
  if (t === 135 || t === 225) return -Math.SQRT1_2;
  return Math.cos((deg * Math.PI) / 180);
}
/** `EDA_ANGLE( const VECTOR2D& )`, degrees, with the same axis special cases. */
function edaAngleOf(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  if (y === 0) return x >= 0 ? 0 : -180;
  if (x === 0) return y >= 0 ? 90 : -90;
  if (x === y) return x >= 0 ? 45 : -135;
  if (x === -y) return x >= 0 ? -45 : 135;
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** `CircleToEndSegmentDeltaRadius` (geometry_utils.cpp:67). */
function circleToEndSegmentDeltaRadius(radius: number, segCount: number): number {
  const n = segCount <= 2 ? 3 : segCount;
  return kiround(Math.abs(radius * (1 - 1 / Math.cos(Math.PI / n))));
}

/**
 * `ARC_CHORD_PARAMS` (arc_chord_params.cpp): the circle an arc's polygon is
 * built on — and it is NOT the circle through the three points.
 *
 * The radius comes from the chord and the SAGITTA, and the sagitta is the
 * mid point's distance from the chord: `r = ( h² + s² ) / 2s`. That is exact
 * only when the mid point is the arc's true midpoint. CM5's board corner
 * stores a mid 7.6° off the bisector, so upstream's radius comes out 3101197
 * for a 3100000 arc and its centre lands 29 µm further from the chord —
 * and its knockout polygon sags by that much in the middle. The exact
 * circumcircle, which this used, is the better circle and the wrong pour.
 */
interface ArcChordParams {
  radius: number;
  sagitta: number;
  halfChord: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  centerOffset: number;
  midx: number;
  midy: number;
}

function arcChordParams(start: Vec2, mid: Vec2, end: Vec2): ArcChordParams | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLen = Math.sqrt(dx * dx + dy * dy);
  if (chordLen <= 0) return null;
  const mx = mid.x - start.x;
  const my = mid.y - start.y;
  const cross = mx * dy - my * dx;
  if (cross === 0) return null;
  const sagitta = Math.abs(cross) / chordLen;
  if (sagitta <= 0) return null;
  const halfChord = chordLen / 2;
  const radius = (halfChord * halfChord + sagitta * sagitta) / (2 * sagitta);
  if (radius <= 0) return null;
  const ux = dx / chordLen;
  const uy = dy / chordLen;
  let nx = -uy;
  let ny = ux;
  if (cross < 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    radius,
    sagitta,
    halfChord,
    ux,
    uy,
    nx,
    ny,
    centerOffset: radius - sagitta,
    midx: (start.x + end.x) * 0.5,
    midy: (start.y + end.y) * 0.5,
  };
}

function chordArcAngle(p: ArcChordParams): number {
  const ratio = Math.min(1, Math.max(0, p.halfChord / p.radius));
  const base = 2 * Math.asin(ratio);
  return p.sagitta > p.radius ? 2 * Math.PI - base : base;
}
function chordStartAngle(p: ArcChordParams): number {
  const sinHalf = p.halfChord / p.radius;
  const cosHalf = p.centerOffset / p.radius;
  return edaAngleOf(-sinHalf * p.ux - cosHalf * p.nx, -sinHalf * p.uy - cosHalf * p.ny);
}
function chordEndAngle(p: ArcChordParams): number {
  const sinHalf = p.halfChord / p.radius;
  const cosHalf = p.centerOffset / p.radius;
  return edaAngleOf(sinHalf * p.ux - cosHalf * p.nx, sinHalf * p.uy - cosHalf * p.ny);
}

export type ErrorLoc = 'inside' | 'outside';

/**
 * `ConvertArcToPolyline( aPolyline, aStart, aMid, aEnd, aAccuracy, aErrorLoc,
 * aRadialOffset )` (convert_basic_shapes_to_polygon.cpp:524-626): one edge of
 * a thick arc, at the chord circle's radius plus `radialOffset`, appended to
 * `out`.
 */
function arcEdge(
  out: [number, number][],
  start: Vec2,
  mid: Vec2,
  end: Vec2,
  accuracy: number,
  errorLoc: ErrorLoc,
  radialOffset: number,
): void {
  const p = arcChordParams(start, mid, end);
  if (!p) {
    out.push([start.x, start.y]);
    if (end.x !== start.x || end.y !== start.y) out.push([end.x, end.y]);
    return;
  }
  const arcAngle = chordArcAngle(p);
  if (arcAngle <= 0) {
    out.push([start.x, start.y], [end.x, end.y]);
    return;
  }
  const MAX = 2147483647;
  const append = (alpha: number, effRadius: number): boolean => {
    const u = effRadius * Math.sin(alpha);
    const nOff = p.centerOffset - effRadius * Math.cos(alpha);
    const x = p.midx + p.ux * u + p.nx * nOff;
    const y = p.midy + p.uy * u + p.ny * nOff;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX || Math.abs(y) > MAX) {
      out.length = 0;
      out.push([start.x, start.y], [end.x, end.y]);
      return false;
    }
    out.push([kiround(x), kiround(y)]);
    return true;
  };

  const effectiveRadius = p.radius + radialOffset;
  const arcAngleDeg = (arcAngle * 180) / Math.PI;
  const radiusForSeg = kiround(Math.min(Math.abs(effectiveRadius), MAX));
  let n = 2;
  if (radiusForSeg >= accuracy) n = segmentsForRadius(radiusForSeg, accuracy, arcAngleDeg) + 1;
  const halfAngle = arcAngle / 2;
  const delta = arcAngle / n;

  if (errorLoc === 'inside') {
    for (let i = 0; i <= n; i++) if (!append(-halfAngle + delta * i, effectiveRadius)) return;
    return;
  }
  const seg360 = Math.abs(kiround((n * 360) / arcAngleDeg));
  if (seg360 <= 0) {
    for (let i = 0; i <= n; i++) if (!append(-halfAngle + delta * i, effectiveRadius)) return;
    return;
  }
  const errorRadius = effectiveRadius + circleToEndSegmentDeltaRadius(radiusForSeg, seg360);
  if (!append(-halfAngle, effectiveRadius)) return;
  for (let i = 0; i < n; i++) if (!append(-halfAngle + delta * (i + 0.5), errorRadius)) return;
  append(halfAngle, effectiveRadius);
}

/**
 * `ConvertArcToPolyline( aPolyline, aCenter, aRadius, aStartAngle, aArcAngle,
 * aAccuracy, aErrorLoc )` (:628-690): an arc about a centre, angles in
 * DEGREES, appended to `out`. The end caps of a thick arc.
 */
function arcAboutCentre(
  out: [number, number][],
  c: Vec2,
  radius: number,
  startDeg: number,
  arcDeg: number,
  accuracy: number,
  errorLoc: ErrorLoc,
): void {
  let n = 2;
  if (radius >= accuracy) n = segmentsForRadius(radius, accuracy, arcDeg) + 1;
  const delta = arcDeg / n;
  if (errorLoc === 'inside') {
    let rot = startDeg;
    for (let i = 0; i <= n; i++, rot += delta)
      out.push([kiround(c.x + radius * edaCos(rot)), kiround(c.y + radius * edaSin(rot))]);
    return;
  }
  const seg360 = Math.abs(kiround((n * 360) / arcDeg));
  const errorRadius = radius + circleToEndSegmentDeltaRadius(radius, seg360);
  out.push([kiround(c.x + radius * edaCos(startDeg)), kiround(c.y + radius * edaSin(startDeg))]);
  let rot = startDeg + delta / 2;
  for (let i = 0; i < n; i++, rot += delta)
    out.push([kiround(c.x + errorRadius * edaCos(rot)), kiround(c.y + errorRadius * edaSin(rot))]);
  out.push([
    kiround(c.x + radius * edaCos(startDeg + arcDeg)),
    kiround(c.y + radius * edaSin(startDeg + arcDeg)),
  ]);
}

/**
 * `TransformArcToPolygon( aBuffer, aStart, aMid, aEnd, aWidth, aError,
 * aErrorLoc )` (:692-760): a thick arc as ONE polygon — start cap, outer
 * edge, end cap, inner edge — on the chord circle. `width` is the full
 * width, clearance included, as `EDA_SHAPE::TransformShapeToPolygon` hands it
 * over (`width += 2 * aClearance`).
 *
 * A mid within one unit of the chord is "not an arc but essentially a
 * straight line with a small error" and becomes an oval of `width +
 * distanceToMid`.
 */
export function arcToPolygon(
  start: Vec2,
  mid: Vec2,
  end: Vec2,
  width: number,
  maxError: number,
  errorLoc: ErrorLoc = 'outside',
): Ring {
  // `SEG::Distance( aMid )`, an integer.
  const ex = end.x - start.x;
  const ey = end.y - start.y;
  const len2 = ex * ex + ey * ey;
  let distanceToMid: number;
  if (len2 === 0) distanceToMid = Math.floor(Math.hypot(mid.x - start.x, mid.y - start.y));
  else {
    const t = Math.max(0, Math.min(1, ((mid.x - start.x) * ex + (mid.y - start.y) * ey) / len2));
    distanceToMid = Math.floor(Math.hypot(mid.x - start.x - t * ex, mid.y - start.y - t * ey));
  }
  if (distanceToMid <= 1) return stadiumPoly(start, end, (width + distanceToMid) / 2, maxError);

  // "For consistent polygon winding, ensure we always process a CCW arc by
  // swapping endpoints if needed."
  const cross = (mid.x - start.x) * ey - (mid.y - start.y) * ex;
  let p0 = start;
  let p1 = end;
  if (cross < 0) {
    p0 = end;
    p1 = start;
  }
  const params = arcChordParams(p0, mid, p1);
  if (!params) return stadiumPoly(start, end, width / 2, maxError);

  const startAngle = chordStartAngle(params);
  const endAngle = chordEndAngle(params);
  const radialOffset = Math.trunc(width / 2);
  const innerRadius = params.radius - radialOffset;
  const errorLocInner: ErrorLoc = errorLoc === 'inside' ? 'outside' : 'inside';
  const errorLocOuter: ErrorLoc = errorLoc === 'inside' ? 'inside' : 'outside';

  const out: [number, number][] = [];
  // Starting end cap (semicircle at p0)
  arcAboutCentre(out, p0, radialOffset, startAngle - 180, 180, maxError, errorLoc);
  // Outside edge
  arcEdge(out, p0, mid, p1, maxError, errorLocOuter, radialOffset);
  // Ending end cap (semicircle at p1)
  arcAboutCentre(out, p1, radialOffset, endAngle, 180, maxError, errorLoc);
  // Inside edge (reversed direction)
  if (innerRadius > 0) arcEdge(out, p1, mid, p0, maxError, errorLocInner, -radialOffset);
  return dedupeRing(out);
}
