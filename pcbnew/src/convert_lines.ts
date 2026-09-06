// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Convert to Lines / Tracks, and Convert to Arc.
 * Counterparts: `CONVERT_TOOL::CreateLines` and `CONVERT_TOOL::SegmentToArc`.
 *
 * The reverse of convert_shapes.ts: an area becomes the individual edges it is
 * drawn from. The same routine serves both menu entries — the only difference
 * is whether each edge comes out as a graphic or as a track, so the target is a
 * parameter rather than two near-identical functions.
 *
 * Zero-length edges are skipped. A polygon that stores its closing point
 * explicitly, or one with a repeated vertex, would otherwise yield degenerate
 * items that are invisible on the canvas but real in the file and in DRC.
 */

import { boardItemId, parseBoardItemId, type BoardItemKind } from './edit-board.js';
import type { Board, PcbArcTrack, PcbShape, PcbTrack } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Whether the edges come out as graphics (`convertToLines`) or copper. */
export type LineTarget = 'graphic' | 'track';

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * The closed rings an item decomposes into, in board coordinates.
 *
 * Rectangles become their four corners, polygons and zone outlines are already
 * rings, and a circle is refused: upstream's selection filter admits only
 * segments, arcs, polygons, rectangles and zones, and a circle has no vertices
 * to make edges from.
 */
export function itemRings(board: Board, id: string): Vec2[][] {
  const r = parseBoardItemId(id);
  if (!r) return [];

  if (r.kind === 'zone') {
    const outline = board.zones[r.index]?.outline;
    return outline && outline.length >= 2 ? [outline] : [];
  }

  if (r.kind !== 'shape') return [];

  const s = board.shapes[r.index];
  if (!s) return [];

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

  if (s.kind === 'poly' && s.pts && s.pts.length >= 2) return [s.pts];

  return [];
}

export interface ConvertToLinesOptions {
  layer: string;
  target?: LineTarget;
  /** Copper only; graphics carry no net. */
  net?: number;
  /** Falls back to the source item's own width when absent. */
  width?: number;
  /** `CONVERT_SETTINGS::m_DeleteOriginals`. */
  deleteOriginals?: boolean;
}

/** The width each produced edge is drawn with. */
function sourceWidth(board: Board, id: string): number {
  const r = parseBoardItemId(id);
  if (r?.kind === 'shape') return board.shapes[r.index]?.width ?? 0;
  return 0;
}

/**
 * `CONVERT_TOOL::CreateLines`: every ring edge becomes its own item.
 *
 * A segment or arc that is *already* a line converts across the graphic/copper
 * divide rather than being decomposed — upstream's `handleGraphicSeg`, which is
 * how "convert to tracks" turns drawn outlines into routable copper.
 */
export function convertToLines(
  board: Board,
  selection: Iterable<string>,
  opts: ConvertToLinesOptions,
): { board: Board; ids: string[] } {
  const ids = [...selection];
  const target = opts.target ?? 'graphic';

  const shapes: PcbShape[] = [];
  const tracks: PcbTrack[] = [];
  const arcs: PcbArcTrack[] = [];

  const emitSegment = (a: Vec2, b: Vec2, width: number): void => {
    if (samePoint(a, b)) return; // seg.Length() == 0

    if (target === 'track') {
      tracks.push({
        start: a,
        end: b,
        width,
        layer: opts.layer,
        net: opts.net ?? 0,
        source: { kind: 'list', items: [] },
      });
    } else {
      shapes.push({
        kind: 'line',
        start: a,
        end: b,
        width,
        fillMode: 'none',
        layer: opts.layer,
        source: { kind: 'list', items: [] },
      });
    }
  };

  for (const id of ids) {
    const r = parseBoardItemId(id);
    const width = opts.width ?? sourceWidth(board, id);

    // An arc or segment crosses the graphic/copper divide whole, keeping its
    // curve: decomposing it would throw the curve away.
    if (r?.kind === 'shape') {
      const s = board.shapes[r.index];

      if (s?.kind === 'line' && s.start && s.end) {
        emitSegment(s.start, s.end, width);
        continue;
      }

      if (s?.kind === 'arc' && s.start && s.mid && s.end) {
        if (target === 'track') {
          arcs.push({
            start: s.start,
            mid: s.mid,
            end: s.end,
            width,
            layer: opts.layer,
            net: opts.net ?? 0,
            source: { kind: 'list', items: [] },
          });
        } else {
          shapes.push({ ...s, layer: opts.layer, width, source: { kind: 'list', items: [] } });
        }
        continue;
      }
    }

    if (r?.kind === 'track') {
      const t = board.tracks[r.index];
      if (t) emitSegment(t.start, t.end, opts.width ?? t.width);
      continue;
    }

    for (const ring of itemRings(board, id)) {
      // Closed: the last vertex joins back to the first, and that edge is as
      // real as any other.
      for (let i = 0; i < ring.length; i++) {
        emitSegment(ring[i]!, ring[(i + 1) % ring.length]!, width);
      }
    }
  }

  if (shapes.length === 0 && tracks.length === 0 && arcs.length === 0) {
    return { board, ids: [] };
  }

  let next: Board = {
    ...board,
    shapes: [...board.shapes, ...shapes],
    tracks: [...board.tracks, ...tracks],
    arcs: [...board.arcs, ...arcs],
  };

  const newIds = [
    ...shapes.map((_, i) => boardItemId('shape', board.shapes.length + i)),
    ...tracks.map((_, i) => boardItemId('track', board.tracks.length + i)),
    ...arcs.map((_, i) => boardItemId('arc', board.arcs.length + i)),
  ];

  if (opts.deleteOriginals) {
    // Indices shift as items are removed, so the sources are dropped by
    // filtering each array once rather than by deleting one id at a time.
    const drop = new Set(ids);
    const keep = (kind: BoardItemKind, i: number): boolean => !drop.has(boardItemId(kind, i));

    next = {
      ...next,
      shapes: next.shapes.filter((_, i) => i >= board.shapes.length || keep('shape', i)),
      tracks: next.tracks.filter((_, i) => i >= board.tracks.length || keep('track', i)),
      zones: next.zones.filter((_, i) => keep('zone', i)),
    };
  }

  return { board: next, ids: newIds };
}

/**
 * How far the midpoint of a converted straight edge is pushed off the chord, as
 * a fraction of its length. `CONVERT_TOOL::SegmentToArc`'s `offsetRatio`:
 * "offset the midpoint along the normal a little bit so that it's more
 * obviously an arc".
 */
export const ARC_BOW_RATIO = 0.1;

/**
 * The midpoint a straight edge is given when it becomes an arc: the chord
 * centre pushed along the normal by a tenth of the chord's length.
 *
 * The normal is `(−y, x)`, KiCad's `VECTOR2::Perpendicular`, so which side the
 * arc bows towards is fixed rather than arbitrary.
 */
export function bowedMidpoint(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return { x: a.x, y: a.y };

  // Upstream resizes the perpendicular to `ratio * length`. The perpendicular
  // already has the chord's length, so the resize is a scale by exactly the
  // ratio and the length cancels — the bow is proportional to the chord, which
  // is what makes it look the same on a 1 mm edge and a 100 mm one.
  return {
    x: Math.round((a.x + b.x) / 2 - dy * ARC_BOW_RATIO),
    y: Math.round((a.y + b.y) / 2 + dx * ARC_BOW_RATIO),
  };
}

/**
 * `CONVERT_TOOL::SegmentToArc`.
 *
 * The menu entry reads "Create Arc from Selected", but it does two jobs at
 * once: a *straight* item gains a bow, while an item that is already curved
 * simply crosses the graphic/copper divide keeping its geometry. Both are
 * "make an arc out of this" from the user's side.
 */
export function segmentToArc(board: Board, id: string): { board: Board; id: string | null } {
  const r = parseBoardItemId(id);
  if (!r) return { board, id: null };

  const blank = { kind: 'list' as const, items: [] };

  if (r.kind === 'shape') {
    const s = board.shapes[r.index];
    if (!s || !s.start || !s.end) return { board, id: null };

    // A graphic segment becomes a graphic arc, bowed.
    if (s.kind === 'line') {
      if (samePoint(s.start, s.end)) return { board, id: null };

      const arc: PcbShape = {
        kind: 'arc',
        start: s.start,
        mid: bowedMidpoint(s.start, s.end),
        end: s.end,
        width: s.width,
        strokeType: s.strokeType,
        fillMode: 'none',
        layer: s.layer,
        source: blank,
      };

      return {
        board: { ...board, shapes: [...board.shapes, arc] },
        id: boardItemId('shape', board.shapes.length),
      };
    }

    // A graphic arc becomes a track arc, geometry unchanged.
    if (s.kind === 'arc' && s.mid) {
      const arc: PcbArcTrack = {
        start: s.start,
        mid: s.mid,
        end: s.end,
        width: s.width,
        layer: s.layer,
        net: 0,
        source: blank,
      };

      return {
        board: { ...board, arcs: [...board.arcs, arc] },
        id: boardItemId('arc', board.arcs.length),
      };
    }

    return { board, id: null };
  }

  // A track becomes a track arc, bowed, keeping its net.
  if (r.kind === 'track') {
    const t = board.tracks[r.index];
    if (!t || samePoint(t.start, t.end)) return { board, id: null };

    const arc: PcbArcTrack = {
      start: t.start,
      mid: bowedMidpoint(t.start, t.end),
      end: t.end,
      width: t.width,
      layer: t.layer,
      net: t.net,
      source: blank,
    };

    return {
      board: { ...board, arcs: [...board.arcs, arc] },
      id: boardItemId('arc', board.arcs.length),
    };
  }

  // A track arc becomes a graphic arc, geometry unchanged — and loses its net,
  // because a graphic has none to carry.
  if (r.kind === 'arc') {
    const a = board.arcs[r.index];
    if (!a) return { board, id: null };

    const arc: PcbShape = {
      kind: 'arc',
      start: a.start,
      mid: a.mid,
      end: a.end,
      width: a.width,
      fillMode: 'none',
      layer: a.layer,
      source: blank,
    };

    return {
      board: { ...board, shapes: [...board.shapes, arc] },
      id: boardItemId('shape', board.shapes.length),
    };
  }

  return { board, id: null };
}
