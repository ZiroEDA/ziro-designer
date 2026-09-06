// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_POLY_SET::GenerateHatchLines` (shape_poly_set.cpp:3510-3642) and the
 * `SEG::IntersectsLine` (seg.cpp:457-521) it is built on.
 *
 * A hatched fill is not a texture: it is a set of real segments, clipped to the
 * shape, that the renderer strokes at the shape's own line width and that hit
 * testing, plotting and the 3D viewer all use. The lines are `y = slope*x + a`
 * for a family of offsets `a` one `spacing` apart — 45 degrees each way, because
 * the only slopes EDA_SHAPE asks for are ±1.
 *
 * Ported rather than approximated because the geometry is observable: the count
 * and position of the lines is what a hatched zone or graphic LOOKS like, and
 * "some diagonal lines" would differ from KiCad's on every shape.
 */

import type { VECTOR2I } from '../math/vector2.js';
import { KiROUND } from '../math/util.js';

/** One clipped hatch line. */
export interface HatchSeg {
  a: VECTOR2I;
  b: VECTOR2I;
}

/**
 * `SEG::IntersectsLine( aSlope, aOffset, aIntersection )`: where the segment
 * `p`-`q` meets the infinite line `y = slope*x + offset`, or null.
 *
 * The vertical-segment and the parallel cases are the two the parametric form
 * cannot answer, and both are upstream's: a vertical segment is solved for y
 * directly, and a segment lying ON the line (within half an internal unit)
 * reports its own midpoint rather than nothing.
 */
export function segIntersectsLine(
  p: VECTOR2I,
  q: VECTOR2I,
  slope: number,
  offset: number,
): VECTOR2I | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;

  // Upstream's own first branch (seg.cpp:463-480). It agrees with the general
  // solution below for every input — a vertical segment is not parallel to a
  // finite-slope line, so `t` is well defined — and is kept because it is what
  // the C++ does and because it holds x exactly rather than through `t`.
  if (dx === 0) {
    const y = KiROUND(slope * p.x + offset);
    return y >= Math.min(p.y, q.y) && y <= Math.max(p.y, q.y) ? { x: p.x, y } : null;
  }

  // `segDir.Cross( lineDir )` with lineDir = (1000, slope*1000): zero means the
  // segment is parallel to the line.
  const cross = dx * KiROUND(slope * 1000) - dy * 1000;

  if (cross === 0) {
    const expectedY = slope * p.x + offset;
    if (Math.abs(p.y - expectedY) < 0.5)
      return { x: Math.trunc((p.x + q.x) / 2), y: Math.trunc((p.y + q.y) / 2) };
    return null;
  }

  const t = (slope * p.x + offset - p.y) / (dy - slope * dx);
  if (t < 0 || t > 1) return null;
  return { x: KiROUND(p.x + t * dx), y: KiROUND(p.y + t * dy) };
}

/** Even-odd point-in-polygon, the test `SHAPE_POLY_SET::Contains` reduces to
 *  for a single outline with no holes. */
function contains(polys: readonly (readonly VECTOR2I[])[], p: VECTOR2I): boolean {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i] as VECTOR2I;
      const b = poly[j] as VECTOR2I;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
  }
  return inside;
}

/**
 * `GenerateHatchLines( aSlopes, aSpacing, aLineLength )`.
 *
 * `lineLength` of -1 — the only value EDA_SHAPE passes — means "one line per
 * crossing"; a positive one splits each crossing into two stubs of that length,
 * which is how a zone's border hatching is drawn.
 */
export function generateHatchLines(
  outline: readonly (readonly VECTOR2I[])[],
  slopes: readonly number[],
  spacing: number,
  lineLength = -1,
): HatchSeg[] {
  const out: HatchSeg[] = [];
  const pts = outline.flat();
  if (pts.length === 0 || spacing <= 0) return out;

  let minX = pts[0]!.x;
  let maxX = pts[0]!.x;
  let minY = pts[0]!.y;
  let maxY = pts[0]!.y;
  for (const v of pts) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  for (const slope of slopes) {
    // The offsets the family has to span so every line that can cross the shape
    // is tried: the extreme corners for this slope's sign.
    const maxA = KiROUND(slope > 0 ? maxY - slope * minX : maxY - slope * maxX);
    const minARaw = KiROUND(slope > 0 ? minY - slope * maxX : minY - slope * minX);
    // Snapped DOWN to a multiple of the spacing, so two shapes side by side
    // hatch on the same grid rather than each from its own corner.
    const minA = Math.trunc(minARaw / spacing) * spacing;

    for (let a = minA; a < maxA; a += spacing) {
      const buf: VECTOR2I[] = [];

      for (const poly of outline) {
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i] as VECTOR2I;
          const q = poly[(i + 1) % poly.length] as VECTOR2I;
          const hit = segIntersectsLine(p, q, slope, a);
          // Upstream drops an intersection outside the outline's own bounding
          // box: a nearly-parallel edge can solve to a point far off the shape.
          if (!hit || hit.x < minX || hit.x > maxX || hit.y < minY || hit.y > maxY) continue;
          buf.push(hit);
        }
      }

      // Descending x, so the two ends of one crossing sit next to each other.
      if (buf.length > 2) buf.sort((r, t) => t.x - r.x);

      for (let ip = 0; ip + 1 < buf.length; ip++) {
        const p1 = buf[ip] as VECTOR2I;
        const p2 = buf[ip + 1] as VECTOR2I;
        if (p1.x === p2.x && p1.y === p2.y) continue;

        const mid = {
          x: Math.trunc((p1.x + p2.x) / 2),
          y: Math.trunc((p1.y + p2.y) / 2),
        };
        // The midpoint decides whether this crossing is inside the shape or in
        // the gap between two of its parts.
        if (!contains(outline, mid)) continue;

        const dx = p2.x - p1.x;
        if (lineLength === -1 || Math.abs(dx) < 2 * lineLength) {
          out.push({ a: p1, b: p2 });
        } else {
          const m = (p2.y - p1.y) / dx;
          const step = dx > 0 ? lineLength : -lineLength;
          out.push({ a: p1, b: { x: KiROUND(p1.x + step), y: KiROUND(p1.y + step * m) } });
          out.push({ a: p2, b: { x: KiROUND(p2.x - step), y: KiROUND(p2.y - step * m) } });
        }
      }
    }
  }

  return out;
}

/**
 * `EDA_SHAPE::UpdateHatching`'s two numbers, and the slopes each FILL_T asks
 * for (eda_shape.cpp:668-694).
 *
 *   HATCH          one family at -1
 *   REVERSE_HATCH  one family at +1
 *   CROSS_HATCH    both
 *
 * `GetHatchLineWidth()` is the shape's effective stroke width and
 * `GetHatchLineSpacing()` is ten times it (eda_shape.h:171-172). The spacing is
 * then capped so the shape never carries more than about 100 lines across its
 * major axis, which is what keeps a metre-wide hatched polygon from generating
 * a hundred thousand segments.
 */
export function hatchSlopes(mode: 'hatch' | 'reverse_hatch' | 'cross_hatch'): number[] {
  if (mode === 'cross_hatch') return [1.0, -1.0];
  return mode === 'hatch' ? [-1.0] : [1.0];
}

/** `spacing`, with UpdateHatching's `majorAxis / spacing > 100` cap applied. */
export function hatchSpacing(lineWidth: number, majorAxis: number): number {
  const spacing = lineWidth * 10;
  if (spacing <= 0) return 0;
  return majorAxis / spacing > 100 ? Math.trunc(majorAxis / 100) : spacing;
}
