// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Turning Canvas2D path constructs into the three GPU primitives.
 *
 * Three jobs, each of which has to keep the "geometry does not depend on the
 * zoom" property that makes the retained buffer worth having (see `scene.ts`).
 *
 *  - **Arcs** become polylines. Their facet count is chosen from the radius in
 *    world units, not from the current zoom, so a buffer recorded once stays
 *    correct at every zoom. Zooming very deep into a small arc will eventually
 *    show facets, which is the price of not re-recording; the tolerance below
 *    puts that well past any zoom a schematic is read at.
 *  - **Dashes** are split at record time. `setLineDash` is given world-unit
 *    lengths, so the split is scale-independent too.
 *  - **Polygons** are triangulated by ear clipping.
 */

export interface Pt {
  x: number;
  y: number;
}

/**
 * Facets per full circle for a given world radius.
 *
 * Chosen so the sagitta (the bulge between chord and arc) stays under
 * `TOLERANCE` world units. Bounded at both ends: three facets is the least that
 * is a shape at all, and beyond 256 the extra vertices buy nothing a reader
 * will see.
 */
const TOLERANCE = 500; // internal units; 1 mm is 1e6, so this is 0.0005 mm.
const MIN_FACETS = 3;
const MAX_FACETS = 256;

export function facetsForRadius(radius: number): number {
  const r = Math.abs(radius);
  if (!Number.isFinite(r) || r <= TOLERANCE) return MIN_FACETS;
  // sagitta = r (1 - cos(pi/n)), solved for n.
  const n = Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - TOLERANCE / r))));
  return Math.max(MIN_FACETS, Math.min(MAX_FACETS, n));
}

/**
 * An arc as a polyline, matching `CanvasRenderingContext2D.arc` including its
 * direction rule.
 *
 * Canvas sweeps counter-clockwise from `a0` to `a1` unless `ccw`, and a sweep
 * that would be zero or negative is taken the long way round; that is what the
 * normalisation below reproduces. Getting it wrong shows up as an arc drawn as
 * its own complement, which is very visible and completely silent.
 */
export function arcToPolyline(
  cx: number,
  cy: number,
  radius: number,
  a0: number,
  a1: number,
  ccw = false,
): Pt[] {
  const TWO_PI = Math.PI * 2;
  let sweep = a1 - a0;
  if (!ccw) {
    if (sweep <= 0) sweep = ((sweep % TWO_PI) + TWO_PI) % TWO_PI || TWO_PI;
    else sweep = Math.min(sweep, TWO_PI);
  } else {
    if (sweep >= 0) sweep = -(((-sweep % TWO_PI) + TWO_PI) % TWO_PI || TWO_PI);
    else sweep = Math.max(sweep, -TWO_PI);
  }
  const full = facetsForRadius(radius);
  const steps = Math.max(1, Math.ceil((Math.abs(sweep) / TWO_PI) * full));
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}

/**
 * An ellipse as a polyline, matching `CanvasRenderingContext2D.ellipse`.
 *
 * Same direction rule as `arcToPolyline` — Canvas sweeps counter-clockwise from
 * `a0` to `a1` unless `ccw`, and a zero or negative sweep goes the long way
 * round — with two differences: each axis has its own radius, and the whole
 * thing is turned by `rotation` about the centre.
 *
 * The facet count comes from the *larger* radius, so the flatter end of a very
 * elongated ellipse is over-tessellated rather than visibly faceted.
 */
export function ellipseToPolyline(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  a0: number,
  a1: number,
  ccw = false,
): Pt[] {
  const TWO_PI = Math.PI * 2;
  let sweep = a1 - a0;
  if (!ccw) {
    if (sweep <= 0) sweep = ((sweep % TWO_PI) + TWO_PI) % TWO_PI || TWO_PI;
    else sweep = Math.min(sweep, TWO_PI);
  } else {
    if (sweep >= 0) sweep = -(((-sweep % TWO_PI) + TWO_PI) % TWO_PI || TWO_PI);
    else sweep = Math.max(sweep, -TWO_PI);
  }
  const full = facetsForRadius(Math.max(Math.abs(rx), Math.abs(ry)));
  const steps = Math.max(1, Math.ceil((Math.abs(sweep) / TWO_PI) * full));
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    out.push({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
  }
  return out;
}

/**
 * Split a polyline into the "on" runs of a dash pattern.
 *
 * The pattern is consumed by arc length across the whole polyline, so a dash
 * carries across a corner exactly as Canvas2D does rather than restarting at
 * each vertex. An empty or all-zero pattern means solid, which is Canvas2D's
 * rule and also stops a zero-length pattern spinning forever.
 */
export function dashPolyline(points: readonly Pt[], pattern: readonly number[]): Pt[][] {
  const pat = pattern.filter((d) => Number.isFinite(d) && d >= 0);
  const total = pat.reduce((a, b) => a + b, 0);
  if (pat.length === 0 || total <= 0) return points.length > 1 ? [points.slice()] : [];

  const runs: Pt[][] = [];
  let idx = 0;
  let remaining = pat[0]!;
  let on = true;
  let current: Pt[] = on ? [points[0]!] : [];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    let segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    let t = 0;
    while (segLen - remaining > 1e-9) {
      t += remaining / Math.hypot(b.x - a.x, b.y - a.y);
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (on) {
        current.push(p);
        if (current.length > 1) runs.push(current);
        current = [];
      } else {
        current = [p];
      }
      on = !on;
      segLen -= remaining;
      idx = (idx + 1) % pat.length;
      remaining = pat[idx]!;
      // A zero-length entry would otherwise loop without consuming anything.
      if (remaining <= 0) remaining = 1e-9;
    }
    remaining -= segLen;
    if (on) current.push(b);
  }
  if (on && current.length > 1) runs.push(current);
  return runs;
}

/** Twice the signed area of a polygon; positive when counter-clockwise. */
function signedArea2(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j]!.x - poly[i]!.x) * (poly[j]!.y + poly[i]!.y);
  }
  return s;
}

function pointInTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Triangulate a simple polygon by ear clipping. Returns flat index triples.
 *
 * Ear clipping rather than something stronger because a schematic's filled
 * areas are symbol bodies and note boxes: small, simple, usually convex. It
 * does not handle holes or self-intersection, and it degrades by dropping
 * triangles rather than by looping, which is the right failure for a renderer.
 */
export function triangulatePolygon(poly: readonly Pt[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];

  // Work counter-clockwise so the convexity test has one sign to check.
  const idx = [...poly.keys()];
  if (signedArea2(poly) > 0) idx.reverse();

  const out: number[] = [];
  let guard = idx.length * idx.length;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!;
      const ib = idx[i]!;
      const ic = idx[(i + 1) % idx.length]!;
      const a = poly[ia]!;
      const b = poly[ib]!;
      const c = poly[ic]!;
      // Convex corner?
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) >= 0) continue;
      // No other vertex inside the candidate ear?
      let contains = false;
      for (const other of idx) {
        if (other === ia || other === ib || other === ic) continue;
        if (pointInTriangle(poly[other]!, a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    // Degenerate or self-intersecting: emit a fan over what is left rather
    // than spinning. A slightly wrong fill beats a hung frame.
    if (!clipped) break;
  }
  for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0]!, idx[i]!, idx[i + 1]!);
  return out;
}
