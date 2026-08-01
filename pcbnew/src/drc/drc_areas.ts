// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The rule-area predicates a condition can ask about.
 * Counterparts: `pcbnew/pcbexpr_functions.cpp` — `searchAreas`,
 * `collidesWithArea`, `intersectsAreaFunc`, `enclosedByAreaFunc`.
 *
 *   (condition "A.intersectsArea('keepout')")
 *   (condition "!A.enclosedByArea('safe')")
 *
 * `insideArea` is upstream's deprecated spelling of `intersectsArea` and
 * resolves to the same function, not to enclosure — a rule using it means
 * "touches", and reading it as "is contained by" would silently invert.
 *
 * The area outline is deflated by the DRC epsilon before any collision test.
 * Collisions include touching, so without it a copper fill that the filler has
 * just carved out along a keepout border would report as colliding with the
 * very area that shaped it.
 */

import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { PcbZone } from '../types.js';
import { pointInPoly, pointSeg, segSeg, type Shape, shapeBBox, shapeDist } from './drc_geometry.js';

/** ADVANCED_CFG::m_DRCEpsilon, 0.5 µm — "small enough not to materially violate". */
export const DRC_EPSILON = pcbIUScale.mmToIU(0.0005);

// ---------------------------------------------------------------------------
// Selecting areas.

/** EDA_COMBINED_MATCHER's wildcard mode: `*` and `?`, anchored. */
function wildcardMatch(pattern: string, text: string): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) return pattern === text;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(text);
  } catch {
    return false;
  }
}

/**
 * `searchAreas`: the argument is a zone uuid, or a zone *name* matched with
 * wildcards. A uuid is exact; a name may select several zones at once, and the
 * predicate holds if any of them does.
 */
export function areasMatching(zones: readonly PcbZone[], selector: string): PcbZone[] {
  // A KIID is tried first and, being exact, never falls through to a name.
  const byUuid = zones.filter((z) => z.uuid === selector);
  if (byUuid.length > 0) return byUuid;

  return zones.filter((z) => z.name !== undefined && wildcardMatch(selector, z.name));
}

// ---------------------------------------------------------------------------
// Deflating the outline.

/** Twice the signed area; negative when the points run anti-clockwise. */
function signedArea2(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += pts[j]!.x * pts[i]!.y - pts[i]!.x * pts[j]!.y;
  return a;
}

/**
 * Shrink a simple polygon by `d`, by offsetting each edge inward and
 * re-intersecting the neighbours.
 *
 * This is not a general offsetter — a deep enough concave notch would fold —
 * but `d` here is the DRC epsilon, 0.5 µm against features measured in
 * millimetres, so nothing on a real board comes close to folding. Returning the
 * outline unchanged when the maths degenerates keeps a pathological outline
 * from silently losing its area.
 */
export function deflatePolygon(pts: readonly Vec2[], d: number): Vec2[] {
  if (pts.length < 3 || d <= 0) return [...pts];

  // Offset direction depends on the winding: for a clockwise ring the inward
  // normal is on the other side.
  const sign = signedArea2(pts) >= 0 ? 1 : -1;
  const lines: { p: Vec2; dx: number; dy: number }[] = [];

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return [...pts];

    // Unit normal, pointing into the polygon.
    const nx = (-dy / len) * sign;
    const ny = (dx / len) * sign;
    lines.push({ p: { x: a.x + nx * d, y: a.y + ny * d }, dx, dy });
  }

  const out: Vec2[] = [];

  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[(i + lines.length - 1) % lines.length]!;
    const l2 = lines[i]!;
    const det = l1.dx * l2.dy - l1.dy * l2.dx;

    if (Math.abs(det) < 1e-9) {
      // Collinear neighbours: the offset edges are the same line, so the
      // shared vertex simply moves with it.
      out.push(l2.p);
      continue;
    }

    const t = ((l2.p.x - l1.p.x) * l2.dy - (l2.p.y - l1.p.y) * l2.dx) / det;
    out.push({ x: l1.p.x + l1.dx * t, y: l1.p.y + l1.dy * t });
  }

  return out;
}

/** The area's collision outline: its boundary, deflated by the DRC epsilon. */
export function areaOutline(zone: PcbZone): Vec2[] | undefined {
  if (!zone.outline || zone.outline.length < 3) return undefined;
  return deflatePolygon(zone.outline, DRC_EPSILON);
}

// ---------------------------------------------------------------------------
// The predicates.

/** Distance from a shape to a polygon's *boundary*, ignoring its interior. */
function distToBoundary(s: Shape, pts: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;

  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j]!;
    const b = pts[i]!;

    switch (s.kind) {
      case 'circle':
        best = Math.min(best, pointSeg(s.c, a, b) - s.r);
        break;
      case 'stadium':
        best = Math.min(best, segSeg(s.a, s.b, a, b) - s.r);
        break;
      case 'poly': {
        for (let m = 0, n = s.pts.length - 1; m < s.pts.length; n = m++)
          best = Math.min(best, segSeg(s.pts[n]!, s.pts[m]!, a, b) - s.r);
        break;
      }
      case 'arc':
        // Arcs fall back to the filled-polygon distance, which is exact for
        // the crossing case and conservative for the rest.
        best = Math.min(best, shapeDist(s, { kind: 'poly', pts: [...pts], r: 0 }) - s.r);
        break;
    }
  }

  return best;
}

/** A point that is inside the shape, for the containment test. */
function representativePoint(s: Shape): Vec2 {
  switch (s.kind) {
    case 'circle':
      return s.c;
    case 'stadium':
      return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
    case 'arc':
      return {
        x: s.c.x + s.rad * Math.cos(s.a0 + s.sweep / 2),
        y: s.c.y + s.rad * Math.sin(s.a0 + s.sweep / 2),
      };
    case 'poly': {
      let x = 0;
      let y = 0;
      for (const p of s.pts) {
        x += p.x;
        y += p.y;
      }
      return { x: x / s.pts.length, y: y / s.pts.length };
    }
  }
}

/**
 * `intersectsArea` (and its deprecated alias `insideArea`): does any of the
 * item's shapes touch the area?
 *
 * `collidesWithArea` collides the item's effective shape against the deflated
 * outline, so overlapping and containment both count — only "entirely outside"
 * is false.
 */
export function shapesIntersectArea(shapes: readonly Shape[], outline: readonly Vec2[]): boolean {
  const poly: Shape = { kind: 'poly', pts: [...outline], r: 0 };
  const box = shapeBBox(poly);

  for (const s of shapes) {
    const sb = shapeBBox(s);
    if (sb.maxX < box.minX || sb.minX > box.maxX || sb.maxY < box.minY || sb.minY > box.maxY)
      continue;
    if (shapeDist(s, poly) === 0) return true;
  }

  return false;
}

/**
 * `enclosedByArea`: is the item *wholly* inside?
 *
 * Upstream subtracts the area from the item and asks whether anything is left.
 * The equivalent here is that no shape reaches the boundary and a point of each
 * lies inside it — which for a shape that does not cross the boundary is the
 * same question.
 */
export function shapesEnclosedByArea(shapes: readonly Shape[], outline: readonly Vec2[]): boolean {
  if (shapes.length === 0) return false;

  const pts = [...outline];

  for (const s of shapes) {
    if (!pointInPoly(representativePoint(s), pts)) return false;
    // Reaching the boundary at all means part of the item is outside it.
    if (distToBoundary(s, pts) <= 0) return false;
  }

  return true;
}
