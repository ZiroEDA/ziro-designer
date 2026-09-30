// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint courtyards.
 * Counterparts: `pcbnew/footprint.cpp` (`FOOTPRINT::BuildCourtyardCaches`) and
 * `pcbnew/convert_shape_list_to_polygon.cpp` (`ConvertOutlineToPolygon`).
 *
 * A courtyard is not stored in the file. It is *derived* from the graphics a
 * footprint draws on `F.CrtYd` / `B.CrtYd`: the segments are chained end to end
 * into closed outlines, and a footprint whose graphics will not close has a
 * malformed courtyard rather than none.
 *
 * Three constants from upstream carry the whole behaviour:
 *
 *   - `maxError` 0.005 mm — how far a tessellated arc may deviate.
 *   - `chainingEpsilon` 0.02 mm — how far one segment's end may sit from the
 *     next one's start and still be the same outline. Courtyard graphics are
 *     drawn by hand and rarely meet exactly.
 *   - the finished outline is deflated by `maxError`, so courtyards that touch,
 *     or sit exactly at the clearance distance, are legal.
 */

import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { getArcToSegmentCount } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { PcbFootprint, PcbShape } from './types.js';

// ---------------------------------------------------------------------------
// `SHAPE_POLY_SET::Deflate` for a simple ring (was `drc/drc_areas.ts`; the
// courtyard builder is its only caller).

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

/** ConvertOutlineToPolygon's aErrorMax for a courtyard. */
export const COURTYARD_MAX_ERROR = mmToIU(0.005);
/** …and its aChainingEpsilon. */
export const COURTYARD_CHAINING_EPSILON = mmToIU(0.02);

export type CourtyardLayer = 'F.CrtYd' | 'B.CrtYd';

export interface Courtyard {
  /** Closed outlines, board coordinates. Empty when the footprint draws none. */
  outlines: Vec2[][];
  /**
   * The graphics are present but will not form a closed shape. Upstream sets
   * MALFORMED_F_COURTYARD / MALFORMED_B_COURTYARD, which is a *different*
   * violation from having no courtyard at all.
   */
  malformed: boolean;
  /** Upstream's OUTLINE_ERROR_HANDLER text, for the marker detail. */
  error?: string;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Tessellate an arc from start through mid to end. */
function arcPoints(start: Vec2, mid: Vec2, end: Vec2, maxError: number): Vec2[] {
  const d = 2 * (start.x * (mid.y - end.y) + mid.x * (end.y - start.y) + end.x * (start.y - mid.y));
  if (d === 0) return [start, end];

  const s2 = start.x * start.x + start.y * start.y;
  const m2 = mid.x * mid.x + mid.y * mid.y;
  const e2 = end.x * end.x + end.y * end.y;
  const c: Vec2 = {
    x: (s2 * (mid.y - end.y) + m2 * (end.y - start.y) + e2 * (start.y - mid.y)) / d,
    y: (s2 * (end.x - mid.x) + m2 * (start.x - end.x) + e2 * (mid.x - start.x)) / d,
  };

  const rad = dist(start, c);
  if (rad === 0) return [start, end];

  const TAU = 2 * Math.PI;
  const norm = (a: number): number => ((a % TAU) + TAU) % TAU;
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const am = Math.atan2(mid.y - c.y, mid.x - c.x);
  const a1 = Math.atan2(end.y - c.y, end.x - c.x);

  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= TAU;

  const segs = Math.max(
    2,
    Math.ceil((getArcToSegmentCount(rad, maxError, 360) * Math.abs(sweep)) / TAU),
  );
  const out: Vec2[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (sweep * i) / segs;
    out.push({ x: c.x + rad * Math.cos(a), y: c.y + rad * Math.sin(a) });
  }
  return out;
}

/**
 * A graphic as an open polyline, or as a closed contour of its own.
 *
 * Circles, rectangles and polygons are already closed and become outlines
 * directly; lines, arcs and curves are open and have to be chained.
 */
export function shapePoints(
  s: PcbShape,
  maxError: number,
): { pts: Vec2[]; closed: boolean } | undefined {
  switch (s.kind) {
    case 'line':
      return s.start && s.end ? { pts: [s.start, s.end], closed: false } : undefined;

    case 'arc':
      return s.start && s.mid && s.end
        ? { pts: arcPoints(s.start, s.mid, s.end, maxError), closed: false }
        : undefined;

    case 'circle': {
      if (!s.center || !s.end) return undefined;
      const rad = dist(s.center, s.end);
      const segs = getArcToSegmentCount(rad, maxError, 360);
      const pts: Vec2[] = [];
      for (let i = 0; i < segs; i++) {
        const a = (TAU_ * i) / segs;
        pts.push({ x: s.center.x + rad * Math.cos(a), y: s.center.y + rad * Math.sin(a) });
      }
      return { pts, closed: true };
    }

    case 'rect':
      if (!s.start || !s.end) return undefined;
      return {
        pts: [s.start, { x: s.end.x, y: s.start.y }, s.end, { x: s.start.x, y: s.end.y }],
        closed: true,
      };

    case 'poly':
      return s.pts && s.pts.length >= 3 ? { pts: s.pts, closed: true } : undefined;

    // A Bezier's control points are not its curve; chaining the hull would
    // close an outline the user never drew.
    case 'curve':
      return undefined;
  }
}

const TAU_ = 2 * Math.PI;

/**
 * `ConvertOutlineToPolygon`: chain open segments end to end until each run
 * closes on itself. Shared with the board-outline check, which asks the same
 * question of Edge.Cuts that this asks of F.CrtYd.
 *
 * Any endpoint within `epsilon` of another counts as the same point, in either
 * direction — a courtyard drawn clockwise in one place and anticlockwise in
 * another still closes, which is how hand-drawn footprints behave.
 */
export function chainOutlines(
  open: Vec2[][],
  epsilon: number,
): { outlines: Vec2[][]; error?: string } {
  const remaining = open.map((pts) => [...pts]);
  const outlines: Vec2[][] = [];

  while (remaining.length > 0) {
    const chain = remaining.shift()!;

    for (;;) {
      const tail = chain[chain.length - 1]!;

      // Closed on itself: done with this run.
      if (chain.length > 2 && dist(tail, chain[0]!) <= epsilon) break;

      const idx = remaining.findIndex(
        (seg) => dist(tail, seg[0]!) <= epsilon || dist(tail, seg[seg.length - 1]!) <= epsilon,
      );

      if (idx < 0) {
        // Nothing reaches this end and it has not come back to the start.
        return { outlines, error: '(not a closed shape)' };
      }

      const next = remaining.splice(idx, 1)[0]!;
      // Take it in whichever direction meets the chain.
      if (dist(tail, next[0]!) > epsilon) next.reverse();
      chain.push(...next.slice(1));
    }

    // The closing point duplicates the first; outlines here are implicit.
    if (dist(chain[chain.length - 1]!, chain[0]!) <= epsilon) chain.pop();
    if (chain.length >= 3) outlines.push(chain);
  }

  return { outlines };
}

/**
 * FOOTPRINT::BuildCourtyardCaches, for one side.
 *
 * Only graphics count — "graphic texts are ignored" — and a footprint that
 * draws nothing on the layer gets an empty courtyard, not a malformed one.
 */
export function buildCourtyard(fp: PcbFootprint, layer: CourtyardLayer): Courtyard {
  const onLayer = fp.shapes.filter((s) => s.layer === layer);
  if (onLayer.length === 0) return { outlines: [], malformed: false };

  const closed: Vec2[][] = [];
  const open: Vec2[][] = [];

  for (const s of onLayer) {
    const pts = shapePoints(s, COURTYARD_MAX_ERROR);
    if (!pts) continue;
    (pts.closed ? closed : open).push(pts.pts);
  }

  const chained = chainOutlines(open, COURTYARD_CHAINING_EPSILON);

  if (chained.error) return { outlines: [], malformed: true, error: chained.error };

  const outlines = [...closed, ...chained.outlines];
  if (outlines.length === 0) return { outlines: [], malformed: false };

  // "Touching courtyards, or courtyards -at- the clearance distance are legal."
  // The deflation is by maxError, the same amount an arc may have bulged out
  // when it was tessellated.
  return {
    outlines: outlines.map((o) => deflatePolygon(o, COURTYARD_MAX_ERROR)),
    malformed: false,
  };
}

/**
 * FOOTPRINT::AllowMissingCourtyard — `(attr allow_missing_courtyard)`, which
 * excuses a footprint from the missing-courtyard check.
 */
export function allowsMissingCourtyard(fp: PcbFootprint): boolean {
  return fp.attributes?.includes('allow_missing_courtyard') ?? false;
}
