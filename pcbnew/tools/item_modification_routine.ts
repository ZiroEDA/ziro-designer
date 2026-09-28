// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/item_modification_routine.h` / `item_modification_routine.cpp`:
 * `PAIRWISE_LINE_ROUTINE` (fillet/chamfer/extend/dogbone), `OUTSET_ROUTINE` and
 * `POLYGON_BOOLEAN_ROUTINE`, the three item-modification routines
 * `EDIT_TOOL` drives — one file upstream, kept as one here.
 */

import { boardItemBBox, parseBoardItemId, tessellateArc } from '../edit-board.js';
import {
  chamferLinePair,
  computeDogbone,
  extendLinePair,
  filletLinePair,
  sharedEndpoint,
  type Seg,
} from '@ziroeda/kimath/src/geometry/corner_operations.js';
import {
  booleanAdd,
  booleanIntersection,
  booleanSubtract,
  fractureSingle,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set_algorithms.js';
import type { Board, PcbShape } from '../types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ---------------------------------------------------------------------------
// PAIRWISE_LINE_ROUTINE: fillet, chamfer, extend and dogbone selected lines.
// ---------------------------------------------------------------------------
/**
 * Fillet, chamfer and extend selected lines.
 * Counterparts: `PAIRWISE_LINE_ROUTINE` and its three subclasses in
 * `pcbnew/tools/item_modification_routine.cpp`, driven by `EDIT_TOOL::ModifyLines`.
 *
 * The geometry lives in kimath (corner_operations.ts); this decides which pairs
 * to try and writes the answer back to the board.
 *
 * Every *unordered pair* in the selection is tried, not just adjacent ones —
 * upstream's `alg::for_all_pairs`. That sounds wasteful and is the point: the
 * user selects a handful of lines and expects every corner among them to be
 * worked on, without having to select them in drawing order.
 *
 * A pair that cannot be worked on is skipped rather than failing the run, so
 * the counts come back as successes and failures for the status line. The
 * distinction upstream draws, and this keeps: a pair that simply does not meet
 * is *not* a failure, while a pair that meets but whose radius will not fit is.
 */

export type LineModification = 'fillet' | 'chamfer' | 'extend' | 'dogbone';

export interface ModifyLinesOptions {
  /** Fillet only. */
  radius?: number;
  /** Chamfer only; the set-back along each line. */
  setback?: number;
  /** Dogbone only; the router bit's radius. */
  dogboneRadius?: number;
  /**
   * Dogbone only: widen a pocket whose mouth is narrower than the bit into the
   * minimal slot that lets the bit in. Without it an acute corner produces a
   * pocket no cutter can actually reach.
   */
  addSlots?: boolean;
}

export interface ModifyLinesResult {
  board: Board;
  /** Pairs the operation was applied to. */
  successes: number;
  /**
   * Pairs that met at a corner but could not be worked on — a radius too big
   * for the corner, say. Pairs that never met at all are not counted: they were
   * never candidates.
   */
  failures: number;
}

/** A selected item usable as a straight line. */
interface LineRef {
  index: number;
  shape: PcbShape;
  seg: Seg;
}

function lineRefs(board: Board, selection: Iterable<string>): LineRef[] {
  const out: LineRef[] = [];

  for (const id of selection) {
    const r = parseBoardItemId(id);
    if (r?.kind !== 'shape') continue;

    const s = board.shapes[r.index];
    if (!s || s.kind !== 'line' || !s.start || !s.end) continue;
    // A zero-length line has no direction, so no corner can be formed with it.
    if (s.start.x === s.end.x && s.start.y === s.end.y) continue;

    out.push({ index: r.index, shape: s, seg: { a: s.start, b: s.end } });
  }

  return out;
}

/** An arc graphic taking its stroke and layer from the line it came from. */
function arcFrom(src: PcbShape, pts: { start: Vec2; mid: Vec2; end: Vec2 }): PcbShape {
  return {
    kind: 'arc',
    start: pts.start,
    mid: pts.mid,
    end: pts.end,
    width: src.width,
    strokeType: src.strokeType,
    fillMode: 'none',
    layer: src.layer,
    locked: src.locked,
  };
}

/** A line graphic taking its stroke and layer from the line it came from. */
function lineFrom(src: PcbShape, seg: Seg): PcbShape {
  return {
    ...src,
    kind: 'line',
    start: seg.a,
    end: seg.b,
    // The source node still describes the old endpoints; dropping it makes the
    // writer rebuild the shape from the model rather than emit stale geometry.
  };
}

/**
 * `EDIT_TOOL::ModifyLines`: apply one of the three corner operations to every
 * pair of selected lines.
 *
 * Lines consumed entirely — a fillet or chamfer that reaches the far end — are
 * deleted, which is `ModifyLineOrDeleteIfZeroLength`.
 */
export function modifyLines(
  board: Board,
  selection: Iterable<string>,
  op: LineModification,
  opts: ModifyLinesOptions = {},
): ModifyLinesResult {
  const lines = lineRefs(board, selection);
  if (lines.length < 2) return { board, successes: 0, failures: 0 };

  // Worked on in place, so a line that takes part in two corners is shortened
  // by both — which is what makes filleting a whole rectangle in one go work.
  const segs = new Map<number, Seg>(lines.map((l) => [l.index, l.seg]));
  const deleted = new Set<number>();
  const added: PcbShape[] = [];

  let successes = 0;
  let failures = 0;

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!;
      const b = lines[j]!;
      if (deleted.has(a.index) || deleted.has(b.index)) continue;

      const segA = segs.get(a.index)!;
      const segB = segs.get(b.index)!;

      if (op === 'extend') {
        const res = extendLinePair(segA, segB);
        if (!res) continue;
        if (res.updatedA) segs.set(a.index, res.updatedA);
        if (res.updatedB) segs.set(b.index, res.updatedB);
        successes++;
        continue;
      }

      // Fillet and chamfer both need a shared corner. Not sharing one is not a
      // failure — most pairs in a selection do not.
      if (!sharedEndpoint(segA, segB)) continue;

      const res =
        op === 'fillet'
          ? filletLinePair(segA, segB, opts.radius ?? 0)
          : op === 'dogbone'
            ? computeDogbone(segA, segB, opts.dogboneRadius ?? 0, opts.addSlots ?? false)
            : chamferLinePair(segA, segB, opts.setback ?? 0, opts.setback ?? 0);

      if (!res) {
        // They met, and it still could not be done: the radius or set-back does
        // not fit this corner.
        failures++;
        continue;
      }

      if ('arc' in res) added.push(arcFrom(a.shape, res.arc));
      else added.push(lineFrom(a.shape, res.chamfer));

      if (res.updatedA) segs.set(a.index, res.updatedA);
      else deleted.add(a.index);

      if (res.updatedB) segs.set(b.index, res.updatedB);
      else deleted.add(b.index);

      successes++;
    }
  }

  if (successes === 0) return { board, successes: 0, failures };

  const shapes = board.shapes
    .map((s, i) => {
      if (deleted.has(i)) return null;
      const seg = segs.get(i);
      if (!seg || (seg.a === s.start && seg.b === s.end)) return s;
      return lineFrom(s, seg);
    })
    .filter((s): s is PcbShape => s !== null);

  return { board: { ...board, shapes: [...shapes, ...added] }, successes, failures };
}

/** Ids of the lines a modification would consider, for enabling the menu. */
export function modifiableLineCount(board: Board, selection: Iterable<string>): number {
  return lineRefs(board, selection).length;
}

// ---------------------------------------------------------------------------
// OUTSET_ROUTINE: draw a shape a fixed distance outside another one.
// ---------------------------------------------------------------------------
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
        emit(s, {
          kind: 'poly',
          pts: roundedRectRing(box.min, box.max, distance),
          fillMode: 'none',
        });
      } else {
        emit(s, { kind: 'rect', start: box.min, end: box.max, fillMode: 'none' });
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
        emit(s, {
          kind: 'circle',
          center: c,
          end: { x: c.x + newRadius, y: c.y },
          fillMode: 'none',
        });
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
        emit(s, { kind: 'rect', start: lo, end: hi, fillMode: 'none' });
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
      emit(s, { kind: 'poly', pts: ring, fillMode: 'none' });
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
    emit(s ?? null, { kind: 'rect', start: box.min, end: box.max, fillMode: 'none' });
    if (r?.kind === 'shape') consumed.add(r.index);
    successes++;
  }

  if (successes === 0) return { board, successes: 0, failures };

  const kept = opts.deleteSourceItems
    ? board.shapes.filter((_, i) => !consumed.has(i))
    : board.shapes;

  return { board: { ...board, shapes: [...kept, ...added] }, successes, failures };
}

// ---------------------------------------------------------------------------
// POLYGON_BOOLEAN_ROUTINE: merge, subtract and intersect selected polygons.
// ---------------------------------------------------------------------------
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
