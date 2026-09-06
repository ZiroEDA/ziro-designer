// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Merge, subtract and intersect selected polygons.
 * Counterpart: `POLYGON_BOOLEAN_ROUTINE` and its three subclasses in
 * `pcbnew/tools/item_modification_routine.cpp`.
 *
 * The selection is folded left: the first polygon becomes the working set and
 * every later one is combined into it. That makes the order matter for
 * subtraction — first minus the rest — and it is why the first item also
 * decides the layer, width and fill of the result.
 *
 * All the sources are consumed. The result is written back as one shape per
 * disjoint outline, so subtracting a bar across the middle of a rectangle
 * leaves two shapes rather than one shape with a hole through it that no longer
 * describes anything connected.
 */

import { parseBoardItemId } from './edit-board.js';
import { tessellateArc } from './read-board.js';
import {
  booleanAdd,
  booleanIntersection,
  booleanSubtract,
  fractureSingle,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Board, PcbShape } from './types.js';

export type PolygonBoolean = 'merge' | 'subtract' | 'intersect';

export interface PolygonBooleanResult {
  board: Board;
  /** Sources folded into the working set. */
  successes: number;
  /**
   * Sources that could not be folded in. Only intersection produces these: an
   * empty result is refused rather than committed, so that intersecting with a
   * polygon that does not overlap leaves the working set alone instead of
   * erasing everything.
   */
  failures: number;
}

/**
 * The polygon a shape contributes, or null when it is not an area.
 * `POLYGON_BOOLEAN_ROUTINE::ProcessShape` accepts polygons, rectangles and
 * circles; everything else is silently ignored.
 *
 * Arcs are dropped from polygons, as upstream's `ClearArcs` does — Clipper works
 * on straight edges, and an arc left in would assert.
 */
export function shapeAsPolygon(s: PcbShape): Polygon | null {
  if (s.kind === 'poly' && s.pts && s.pts.length >= 3) return [[...s.pts]];

  if (s.kind === 'rect' && s.start && s.end) {
    return [
      [
        { x: s.start.x, y: s.start.y },
        { x: s.end.x, y: s.start.y },
        { x: s.end.x, y: s.end.y },
        { x: s.start.x, y: s.end.y },
      ],
    ];
  }

  if (s.kind === 'circle') {
    const c = s.center ?? s.start;
    if (!c || !s.end) return null;
    const r = Math.hypot(s.end.x - c.x, s.end.y - c.y);
    if (r === 0) return null;
    const left = { x: c.x - r, y: c.y };
    const right = { x: c.x + r, y: c.y };
    // Two half turns: one tessellation cannot express a full circle, since its
    // start and end would coincide and the sweep would be ambiguous. The second
    // half drops both its endpoints, which the first already supplied.
    return [
      [
        ...tessellateArc(left, { x: c.x, y: c.y - r }, right),
        ...tessellateArc(right, { x: c.x, y: c.y + r }, left).slice(1, -1),
      ],
    ];
  }

  return null;
}

export interface PolygonBooleanOptions {
  /** Overrides the layer the first source contributes. */
  layer?: string;
}

/** `POLYGON_BOOLEAN_ROUTINE`. */
export function polygonBoolean(
  board: Board,
  selection: Iterable<string>,
  op: PolygonBoolean,
  opts: PolygonBooleanOptions = {},
): PolygonBooleanResult {
  const sources: { index: number; shape: PcbShape; poly: Polygon }[] = [];

  for (const id of selection) {
    const r = parseBoardItemId(id);
    if (r?.kind !== 'shape') continue;

    const s = board.shapes[r.index];
    if (!s) continue;

    const poly = shapeAsPolygon(s);
    if (poly) sources.push({ index: r.index, shape: s, poly });
  }

  // One polygon has nothing to combine with.
  if (sources.length < 2) return { board, successes: 0, failures: 0 };

  const first = sources[0]!;
  let working: Polygon[] = [first.poly];
  // Consumed sources, including the first — upstream deletes it as soon as it
  // becomes the working set.
  const consumed = new Set<number>([first.index]);

  let successes = 0;
  let failures = 0;

  for (let i = 1; i < sources.length; i++) {
    const src = sources[i]!;
    const clip = [src.poly];

    if (op === 'merge') {
      working = booleanAdd(working, clip);
    } else if (op === 'subtract') {
      working = booleanSubtract(working, clip);
    } else {
      const next = booleanIntersection(working, clip);
      if (next.length === 0) {
        // No overlap. Committing would erase the working set entirely, so
        // upstream skips the source and reports it instead.
        failures++;
        continue;
      }
      working = next;
    }

    consumed.add(src.index);
    successes++;
  }

  if (successes === 0) return { board, successes: 0, failures };

  const layer = opts.layer ?? first.shape.layer;

  // One shape per disjoint outline.
  //
  // A subtraction can leave a hole, and neither our PcbShape nor the file's
  // `(gr_poly (pts …))` can hold one — both are a single ring. So the result is
  // fractured: each hole is joined to its outline by a zero-width slit, which
  // is the same ring the renderer and the zone filler already expect elsewhere.
  const added: PcbShape[] = working.map((poly) => ({
    kind: 'poly',
    pts: fractureSingle(poly)[0]!,
    width: first.shape.width,
    strokeType: first.shape.strokeType,
    fillMode: first.shape.fillMode,
    layer,
    source: { kind: 'list', items: [] },
  }));

  const kept = board.shapes.filter((_, i) => !consumed.has(i));

  return {
    board: { ...board, shapes: [...kept, ...added] },
    successes,
    failures,
  };
}

/** Ids of the shapes a boolean would consider, for enabling the menu. */
export function booleanableShapeCount(board: Board, selection: Iterable<string>): number {
  let n = 0;
  for (const id of selection) {
    const r = parseBoardItemId(id);
    if (r?.kind !== 'shape') continue;
    const s = board.shapes[r.index];
    if (s && shapeAsPolygon(s)) n++;
  }
  return n;
}
