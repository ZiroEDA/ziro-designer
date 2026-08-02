// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Outset Items: draw a shape a fixed distance outside another one.
 * Counterpart: `OUTSET_ROUTINE` in `pcbnew/tools/item_modification_routine.cpp`.
 *
 * The point of the tool is making a courtyard from a footprint's pads, so the
 * result wants to be a *clean* shape — a rectangle that is still a rectangle, a
 * circle still a circle — not a many-sided approximation.
 *
 * That is why this does exact per-shape outsetting rather than offsetting
 * through Clipper, which is upstream's choice and its stated reason: "This
 * attempts to do exact outsetting, rather than punting to Clipper. So it can't
 * do all shapes, but it can do the most obvious ones, which are probably the
 * ones you want to outset anyway." Shapes it cannot do exactly fall back to
 * their bounding box, which is honest about being an approximation in a way
 * that a 200-sided polygon is not.
 */

import { boardItemBBox, parseBoardItemId } from './edit-board.js';
import { tessellateArc } from './read-board.js';
import type { Board, PcbShape } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export interface OutsetOptions {
  /** How far outside the source to draw, in IU. */
  distance: number;
  /**
   * Round the corners the outset introduces. A rectangle outset with rounded
   * corners becomes a rounded rectangle — which is what a courtyard around a
   * rectangular pad actually wants — while a square outset stays a rectangle.
   */
  roundCorners?: boolean;
  /** Layer for the new shapes; the source item's own layer when absent. */
  layer?: string;
  /** Width for the new shapes; the source item's own width when absent. */
  lineWidth?: number;
  /** Snap the result outwards onto a grid of this pitch, `gridRounding`. */
  gridRounding?: number;
  /** `deleteSourceItems`. */
  deleteSourceItems?: boolean;
}

export interface OutsetResult {
  board: Board;
  successes: number;
  /** Items whose outset would collapse to nothing, or which are not supported. */
  failures: number;
}

const roundDown = (v: number, grid: number): number => Math.floor(v / grid) * grid;
const roundUp = (v: number, grid: number): number => Math.ceil(v / grid) * grid;

/**
 * `GetRectRoundedToGridOutwards`: grow the box to the nearest grid lines that
 * contain it. Outwards on both corners, never inwards — a courtyard snapped
 * inwards would be smaller than the clearance asked for.
 */
export function roundRectOutwards(min: Vec2, max: Vec2, grid: number): { min: Vec2; max: Vec2 } {
  return {
    min: { x: roundDown(min.x, grid), y: roundDown(min.y, grid) },
    max: { x: roundUp(max.x, grid), y: roundUp(max.y, grid) },
  };
}

/** A rounded rectangle as a point ring: four corner arcs joined by four sides. */
function roundedRectRing(min: Vec2, max: Vec2, radius: number): Vec2[] {
  const r = Math.min(radius, (max.x - min.x) / 2, (max.y - min.y) / 2);
  if (r <= 0) {
    return [
      { x: min.x, y: min.y },
      { x: max.x, y: min.y },
      { x: max.x, y: max.y },
      { x: min.x, y: max.y },
    ];
  }

  // Each corner is a quarter turn about a centre inset by the radius; the arc's
  // mid point is at 45°, which is what the tessellator needs to know the sweep.
  const arcAt = (cx: number, cy: number, a0: number, a1: number): Vec2[] => {
    const mid = (a0 + a1) / 2;
    return tessellateArc(
      { x: Math.round(cx + r * Math.cos(a0)), y: Math.round(cy + r * Math.sin(a0)) },
      { x: Math.round(cx + r * Math.cos(mid)), y: Math.round(cy + r * Math.sin(mid)) },
      { x: Math.round(cx + r * Math.cos(a1)), y: Math.round(cy + r * Math.sin(a1)) },
    );
  };

  const H = Math.PI / 2;
  return [
    // Top-left corner, sweeping from pointing left to pointing up.
    ...arcAt(min.x + r, min.y + r, Math.PI, Math.PI + H),
    ...arcAt(max.x - r, min.y + r, Math.PI + H, 2 * Math.PI).slice(1),
    ...arcAt(max.x - r, max.y - r, 0, H).slice(1),
    ...arcAt(min.x + r, max.y - r, H, Math.PI).slice(1, -1),
  ];
}

/**
 * A segment's outset: the stadium around it, or its bounding rectangle.
 *
 * Upstream builds the whole closed shape rather than only the side the user
 * might want — "make the whole stadium shape and let the user delete the
 * unwanted bits" — because which side is wanted cannot be known from the
 * geometry alone.
 */
export function outsetSegmentRing(a: Vec2, b: Vec2, distance: number, round: boolean): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0 || distance <= 0) return [];

  const ex = (dx * distance) / len;
  const ey = (dy * distance) / len;
  // `GetRotated( ext, ANGLE_90 )` in the board's y-down frame.
  const px = ey;
  const py = -ex;

  if (!round) {
    return [
      { x: Math.round(a.x - ex + px), y: Math.round(a.y - ey + py) },
      { x: Math.round(a.x - ex - px), y: Math.round(a.y - ey - py) },
      { x: Math.round(b.x + ex - px), y: Math.round(b.y + ey - py) },
      { x: Math.round(b.x + ex + px), y: Math.round(b.y + ey + py) },
    ];
  }

  // The stadium: a half turn round each end, joined by the two parallel sides.
  const capA = tessellateArc(
    { x: Math.round(a.x - px), y: Math.round(a.y - py) },
    { x: Math.round(a.x - ex), y: Math.round(a.y - ey) },
    { x: Math.round(a.x + px), y: Math.round(a.y + py) },
  );
  const capB = tessellateArc(
    { x: Math.round(b.x + px), y: Math.round(b.y + py) },
    { x: Math.round(b.x + ex), y: Math.round(b.y + ey) },
    { x: Math.round(b.x - px), y: Math.round(b.y - py) },
  );

  return [...capA, ...capB];
}

const blank = { kind: 'list' as const, items: [] };

/** `OUTSET_ROUTINE::ProcessItem`. */
export function outsetItems(
  board: Board,
  selection: Iterable<string>,
  opts: OutsetOptions,
): OutsetResult {
  const { distance } = opts;
  const round = opts.roundCorners ?? false;

  const added: PcbShape[] = [];
  const consumed = new Set<number>();
  let successes = 0;
  let failures = 0;

  const emit = (
    src: PcbShape | null,
    shape: Omit<PcbShape, 'source' | 'layer' | 'width'>,
  ): void => {
    added.push({
      ...shape,
      layer: opts.layer ?? src?.layer ?? 'F.CrtYd',
      width: opts.lineWidth ?? src?.width ?? 0,
      source: blank,
    });
  };

  /** The outset box of an axis-aligned extent, or null if it collapses. */
  const boxOutset = (min: Vec2, max: Vec2): { min: Vec2; max: Vec2 } | null => {
    let lo = { x: min.x - distance, y: min.y - distance };
    let hi = { x: max.x + distance, y: max.y + distance };
    // A negative distance can shrink the box past nothing.
    if (hi.x <= lo.x || hi.y <= lo.y) return null;
    if (opts.gridRounding && opts.gridRounding > 0) {
      const g = roundRectOutwards(lo, hi, opts.gridRounding);
      lo = g.min;
      hi = g.max;
    }
    return { min: lo, max: hi };
  };

  for (const id of selection) {
    const r = parseBoardItemId(id);
    const s = r?.kind === 'shape' ? board.shapes[r.index] : undefined;

    // A rectangle stays a rectangle, unless rounded corners are asked for.
    if (s?.kind === 'rect' && s.start && s.end) {
      const min = { x: Math.min(s.start.x, s.end.x), y: Math.min(s.start.y, s.end.y) };
      const max = { x: Math.max(s.start.x, s.end.x), y: Math.max(s.start.y, s.end.y) };
      const box = boxOutset(min, max);
      if (!box) {
        failures++;
        continue;
      }

      if (round && distance > 0) {
        emit(s, { kind: 'poly', pts: roundedRectRing(box.min, box.max, distance), fill: false });
      } else {
        emit(s, { kind: 'rect', start: box.min, end: box.max, fill: false });
      }

      if (r) consumed.add(r.index);
      successes++;
      continue;
    }

    // A circle stays a circle, or becomes the square that contains it.
    if (s?.kind === 'circle') {
      const c = s.center ?? s.start;
      if (!c || !s.end) {
        failures++;
        continue;
      }
      const newRadius = Math.hypot(s.end.x - c.x, s.end.y - c.y) + distance;
      if (newRadius <= 0) {
        failures++;
        continue;
      }

      if (round) {
        emit(s, { kind: 'circle', center: c, end: { x: c.x + newRadius, y: c.y }, fill: false });
      } else {
        // The square containing the already-outset circle: upstream builds it
        // from the new radius, so the distance is not applied a second time.
        let lo = { x: c.x - newRadius, y: c.y - newRadius };
        let hi = { x: c.x + newRadius, y: c.y + newRadius };
        if (opts.gridRounding && opts.gridRounding > 0) {
          const g = roundRectOutwards(lo, hi, opts.gridRounding);
          lo = g.min;
          hi = g.max;
        }
        emit(s, { kind: 'rect', start: lo, end: hi, fill: false });
      }

      if (r) consumed.add(r.index);
      successes++;
      continue;
    }

    // A segment becomes the whole stadium (or its rectangle): which side the
    // user wants cannot be told from the geometry.
    if (s?.kind === 'line' && s.start && s.end) {
      if (distance <= 0) {
        failures++;
        continue;
      }
      const ring = outsetSegmentRing(s.start, s.end, distance, round);
      if (ring.length < 3) {
        failures++;
        continue;
      }
      emit(s, { kind: 'poly', pts: ring, fill: false });
      if (r) consumed.add(r.index);
      successes++;
      continue;
    }

    // Everything else falls back to its bounding box — upstream's default.
    const bb = boardItemBBox(board, id);
    if (!bb) {
      failures++;
      continue;
    }
    const box = boxOutset({ x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.maxY });
    if (!box) {
      failures++;
      continue;
    }
    emit(s ?? null, { kind: 'rect', start: box.min, end: box.max, fill: false });
    if (r?.kind === 'shape') consumed.add(r.index);
    successes++;
  }

  if (successes === 0) return { board, successes: 0, failures };

  const kept = opts.deleteSourceItems
    ? board.shapes.filter((_, i) => !consumed.has(i))
    : board.shapes;

  return { board: { ...board, shapes: [...kept, ...added] }, successes, failures };
}
