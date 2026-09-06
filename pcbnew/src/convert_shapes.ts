// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Convert to Polygon / Zone: turn a ring of drawn segments into a filled area.
 * Counterparts: `CONVERT_TOOL::CreatePolys`, `makePolysFromChainedSegs`,
 * `makePolysFromClosedGraphics` and `getStartEndPoints`.
 *
 * The interesting half is the chaining. The user has drawn a closed outline out
 * of separate lines, arcs and tracks; nothing records which touches which, and
 * they were not drawn in order. So the items are filed by endpoint into buckets,
 * and each chain is then walked in both directions from an arbitrary start.
 *
 * Two details make it work on real boards rather than only on tidy ones:
 *
 *  - Endpoints are matched within an epsilon, because a hand-drawn outline
 *    almost never closes to the nanometre. The epsilon is deliberately *small*
 *    (100 nm); upstream notes that a generous one starts swallowing the very
 *    short segments a converted bezier is made of.
 *
 *  - Each endpoint remembers the bucket it was filed under. Upstream needs this
 *    for correctness: its buckets live in a `std::map` keyed by coordinate, so
 *    iteration order shifts as entries are inserted and re-deriving a key
 *    mid-walk can land in a different bucket than the build phase chose. Ours
 *    is an append-only array scanned in creation order, where re-deriving
 *    provably gives the same answer, so the stored keys are a lookup rather
 *    than a guard. Recorded because the difference is easy to misread as a
 *    ported bug fix.
 *
 * Chains that fail to close are dropped rather than failing the whole
 * conversion: the tool is best-effort, and upstream says so.
 */

import { boardItemId, parseBoardItemId } from './edit-board.js';
import { tessellateArc } from './read-board.js';
import { barcodeGeometry } from './barcode_geometry.js';
import type { Board, PcbShape, PcbZone } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * Max distance from one endpoint to the next, in IU.
 * `CONVERT_TOOL::makePolysFromChainedSegs`'s `chainingEpsilon`.
 */
export const CHAINING_EPSILON = 100;

/** `CONVERT_STRATEGY`, less `BOUNDING_HULL` — see the note in `convertToPolygons`. */
export type ConvertStrategy = 'centerline' | 'copyLineWidth';

const closeEnough = (a: Vec2, b: Vec2, limit: number): boolean => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= limit * limit;
};

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** An item that can take part in a chain, reduced to what chaining needs. */
interface Chainable {
  id: string;
  start: Vec2;
  end: Vec2;
  /** Present for arcs: the intermediate point, so the curve can be walked. */
  mid?: Vec2;
}

/**
 * `CONVERT_TOOL::getStartEndPoints`.
 *
 * A shape whose start and end coincide has no direction to be walked in and is
 * refused — upstream returns nullopt for it. Closed shapes are handled by the
 * other path entirely.
 */
export function chainableItem(board: Board, id: string): Chainable | null {
  const r = parseBoardItemId(id);
  if (!r) return null;

  if (r.kind === 'track') {
    const t = board.tracks[r.index];
    return t ? { id, start: t.start, end: t.end } : null;
  }

  if (r.kind === 'arc') {
    const a = board.arcs[r.index];
    return a ? { id, start: a.start, end: a.end, mid: a.mid } : null;
  }

  if (r.kind === 'shape') {
    const s = board.shapes[r.index];
    if (!s || !s.start || !s.end) return null;
    if (s.kind !== 'line' && s.kind !== 'arc') return null;
    if (samePoint(s.start, s.end)) return null;
    return { id, start: s.start, end: s.end, mid: s.mid };
  }

  return null;
}

/**
 * The points an item contributes when entered at `from`, walking to its other
 * end — *excluding* `from` itself, which whatever we are joining onto already
 * supplied. A segment gives one point; an arc gives its tessellation.
 *
 * Keeping the entry point out of the result is what lets the append and the
 * prepend share one rule: the ring is always continuous at the join.
 */
function pointsAfter(item: Chainable, from: Vec2): Vec2[] {
  const forward = samePoint(from, item.start);

  if (item.mid) {
    const pts = tessellateArc(item.start, item.mid, item.end);
    return forward ? pts.slice(1) : [...pts].reverse().slice(1);
  }

  return [forward ? item.end : item.start];
}

/**
 * `makePolysFromChainedSegs`: chain the given items into closed outlines.
 *
 * Returns one point ring per closed chain, in no particular order. Items that
 * cannot chain, and chains that do not close, contribute nothing.
 */
export function chainSegmentsToPolygons(board: Board, selection: Iterable<string>): Vec2[][] {
  const items: Chainable[] = [];
  for (const id of selection) {
    const c = chainableItem(board, id);
    if (c) items.push(c);
  }

  // Endpoint buckets, keyed by the first point filed there that everything else
  // is within epsilon of.
  const buckets: { key: Vec2; ends: { item: Chainable; anchor: 0 | 1 }[] }[] = [];

  const findBucket = (p: Vec2): number => {
    for (let i = 0; i < buckets.length; i++) {
      if (closeEnough(p, buckets[i]!.key, CHAINING_EPSILON)) return i;
    }
    buckets.push({ key: p, ends: [] });
    return buckets.length - 1;
  };

  // The bucket each (item, anchor) was filed under: an O(1) lookup in place of
  // re-scanning the bucket list. See the note at the top on why this is a
  // lookup here and a correctness guard upstream.
  const keyOf = new Map<string, number>();
  const keyId = (item: Chainable, anchor: 0 | 1): string => `${item.id}#${anchor}`;

  for (const item of items) {
    const a = findBucket(item.start);
    const b = findBucket(item.end);
    buckets[a]!.ends.push({ item, anchor: 0 });
    buckets[b]!.ends.push({ item, anchor: 1 });
    keyOf.set(keyId(item, 0), a);
    keyOf.set(keyId(item, 1), b);
  }

  // Items already walked. A chain is a connected component, so once an item is
  // consumed — whether its chain closed or not — no other chain can want it,
  // and leaving it marked stops the same component being re-walked from each of
  // its members in turn.
  const used = new Set<string>();
  const rings: Vec2[][] = [];

  for (const candidate of items) {
    if (used.has(candidate.id)) continue;

    const outline: Vec2[] = [];

    // `anchor` names the end the item is *entered* at; the points after that
    // end are appended, and whatever meets it at its far end continues the ring.
    const process = (item: Chainable, anchor: 0 | 1): void => {
      if (used.has(item.id)) return;
      used.add(item.id);

      outline.push(...pointsAfter(item, anchor === 0 ? item.start : item.end));

      const bucket = keyOf.get(keyId(item, anchor === 0 ? 1 : 0));
      if (bucket === undefined) return;

      for (const end of buckets[bucket]!.ends) {
        if (end.item.id === item.id) continue;
        process(end.item, end.anchor);
      }
    };

    // Seed with the candidate's start and walk one way only.
    //
    // Upstream also walks "left" from the candidate, because it keeps open
    // chains for the bounding-hull strategy and those have to grow from both
    // ends. Here only closed rings survive, and a ring is a cycle: walking one
    // way from any of its items comes back round to that item, so the whole
    // ring is covered and there is nothing to the left that is not. Verified by
    // chaining the same square from each of its four segments in turn.
    outline.push(candidate.start);
    process(candidate, 0);

    if (
      outline.length < 3 ||
      !closeEnough(outline[0]!, outline[outline.length - 1]!, CHAINING_EPSILON)
    ) {
      // Best-effort: an unclosed chain contributes nothing, but the rest of the
      // selection is still converted. Its items stay marked — they are a whole
      // connected component, so no other chain could have used them.
      continue;
    }

    // The walk ends back where it started, so the ring carries its first point
    // twice. Upstream calls SetClosed(true), where the closing edge is implied;
    // our polygons are the same, and a repeated vertex would be a zero-length
    // edge for anything that later walks them.
    outline.pop();

    rings.push(outline);
  }

  return rings;
}

/** A circle as a ring of points, via the same tessellation arcs use. */
function circleRing(center: Vec2, radius: number): Vec2[] {
  const left = { x: center.x - radius, y: center.y };
  const right = { x: center.x + radius, y: center.y };
  const top = { x: center.x, y: center.y - radius };
  const bottom = { x: center.x, y: center.y + radius };
  // Two half turns: one tessellation cannot express a full circle, since its
  // start and end would coincide and the sweep would be ambiguous. The second
  // half drops both its endpoints — they are the first half's, and a ring that
  // repeats its first point closes twice.
  return [...tessellateArc(left, top, right), ...tessellateArc(right, bottom, left).slice(1, -1)];
}

/**
 * `makePolysFromClosedGraphics`: a shape that is already an area becomes its own
 * outline, no chaining needed.
 *
 * Text, pads and barcodes are handled upstream and not here — each needs its own
 * tessellation (glyph outlines, pad stacks), which we do not have.
 */
export function closedShapeRing(s: PcbShape): Vec2[] | null {
  if (s.kind === 'rect' && s.start && s.end) {
    return [
      { x: s.start.x, y: s.start.y },
      { x: s.end.x, y: s.start.y },
      { x: s.end.x, y: s.end.y },
      { x: s.start.x, y: s.end.y },
    ];
  }

  if (s.kind === 'circle') {
    const c = s.center ?? s.start;
    if (!c || !s.end) return null;
    return circleRing(c, Math.hypot(s.end.x - c.x, s.end.y - c.y));
  }

  if (s.kind === 'poly' && s.pts && s.pts.length >= 3) return [...s.pts];

  return null;
}

/** The width the converted outline is stroked with, per `CONVERT_STRATEGY`. */
export function resolvedLineWidth(
  board: Board,
  selection: Iterable<string>,
  strategy: ConvertStrategy,
  defaultWidth: number,
): number {
  if (strategy !== 'copyLineWidth') return defaultWidth;

  // The top-left item that actually carries a stroke, by the same comparison
  // GetTopLeftItem uses — leftmost, ties broken by highest.
  let best: { at: Vec2; width: number } | null = null;

  for (const id of selection) {
    const r = parseBoardItemId(id);
    if (r?.kind !== 'shape') continue;
    const s = board.shapes[r.index];
    const at = s?.start ?? s?.center;
    if (!s || !at) continue;

    if (!best || at.x < best.at.x || (at.x === best.at.x && at.y < best.at.y)) {
      best = { at, width: s.width };
    }
  }

  return best ? best.width : defaultWidth;
}

/**
 * Every outline the selection converts to: closed shapes contribute their own,
 * everything else is chained.
 *
 * `BOUNDING_HULL` is not ported. It inflates the union of the items' own
 * outlines by a gap, which needs polygon offsetting and a boolean union we do
 * not have; the two centreline strategies cover what the tool is normally used
 * for. Recorded here rather than silently accepted as the only behaviour.
 */
export function convertToPolygons(board: Board, selection: Iterable<string>): Vec2[][] {
  const ids = [...selection];
  const rings: Vec2[][] = [];

  for (const id of ids) {
    const r = parseBoardItemId(id);

    if (r?.kind === 'shape') {
      const ring = closedShapeRing(board.shapes[r.index] as PcbShape);
      if (ring) rings.push(ring);
    } else if (r?.kind === 'zone') {
      const outline = board.zones[r.index]?.outline;
      if (outline && outline.length >= 3) rings.push([...outline]);
    } else if (r?.kind === 'barcode') {
      // `PCB_BARCODE_T` is in `CONVERT_TOOL`'s `toPolyTypes`
      // (`convert_tool.cpp:277`), beside `PCB_TEXT_T` — the two items whose
      // "outline" is a set of glyph or module shapes rather than one ring.
      //
      // Each ring of the assembled polygon becomes an outline, which is what
      // makes Create Polygon useful on a barcode at all: it turns the modules
      // into editable graphics that can then be filled, milled or exported.
      const bc = board.barcodes[r.index];
      if (bc)
        for (const poly of barcodeGeometry(bc).poly)
          for (const ring of poly) if (ring.length >= 3) rings.push([...ring]);
    }
  }

  // The whole selection goes to the chainer, with no need for upstream's
  // SKIP_STRUCT bookkeeping: `chainableItem` accepts only lines and arcs, and
  // `closedShapeRing` only rectangles, circles and polygons, so nothing can be
  // taken by both. One guard rather than two that could drift apart.
  rings.push(...chainSegmentsToPolygons(board, ids));

  return rings;
}

export interface ConvertToPolyOptions {
  layer: string;
  strategy?: ConvertStrategy;
  /** Used unless `copyLineWidth` finds a stroke to copy. */
  lineWidth?: number;
}

/** `CONVERT_TOOL::CreatePolys` for `convertToPoly`: one graphic per outline. */
export function convertToPoly(
  board: Board,
  selection: Iterable<string>,
  opts: ConvertToPolyOptions,
): { board: Board; ids: string[] } {
  const ids = [...selection];
  const rings = convertToPolygons(board, ids);
  if (rings.length === 0) return { board, ids: [] };

  const strategy = opts.strategy ?? 'centerline';
  const width = resolvedLineWidth(board, ids, strategy, opts.lineWidth ?? 0);

  const shapes: PcbShape[] = rings.map((pts) => ({
    kind: 'poly',
    pts,
    width,
    // Only the centreline strategy produces a filled shape; copying a line
    // width means the outline itself is the thing being kept.
    fillMode: strategy === 'centerline' ? 'solid' : 'none',
    layer: opts.layer,
    source: { kind: 'list', items: [] },
  }));

  const newIds = shapes.map((_, i) => boardItemId('shape', board.shapes.length + i));

  return { board: { ...board, shapes: [...board.shapes, ...shapes] }, ids: newIds };
}

export interface ConvertToZoneOptions {
  layer: string;
  net?: number;
  /** `(keepout …)`: a rule area rather than a filled zone. */
  ruleArea?: boolean;
}

/**
 * `ZONE_SETTINGS`'s defaults for a fresh rule area: tracks, vias and pads
 * forbidden, zone fills and footprints allowed. Every flag is *do not allow*,
 * so `false` on copperPour means a pour may still enter.
 */
export const DEFAULT_RULE_AREA_KEEPOUT = {
  tracks: true,
  vias: true,
  pads: true,
  copperPour: false,
  footprints: false,
} as const;

/** `CONVERT_TOOL::CreatePolys` for `convertToZone` / `convertToKeepout`. */
export function convertToZone(
  board: Board,
  selection: Iterable<string>,
  opts: ConvertToZoneOptions,
): { board: Board; ids: string[] } {
  const rings = convertToPolygons(board, selection);
  if (rings.length === 0) return { board, ids: [] };

  const zones: PcbZone[] = rings.map((outline) => ({
    net: opts.net ?? 0,
    layers: [opts.layer],
    fills: [],
    outline,
    ...(opts.ruleArea ? { ruleArea: { ...DEFAULT_RULE_AREA_KEEPOUT } } : {}),
    source: { kind: 'list', items: [] },
  }));

  const newIds = zones.map((_, i) => boardItemId('zone', board.zones.length + i));

  return { board: { ...board, zones: [...board.zones, ...zones] }, ids: newIds };
}
