// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dragging a track the way the push-and-shove router does. Counterparts:
 * `pcbnew/router/pns_dragger.cpp` (DRAGGER::startDragSegment / drag) and
 * `pcbnew/router/pns_node.cpp` (NODE::AssembleLine, NODE::followLine,
 * JOINT::NextSegment).
 *
 * The unit of a drag is not the segment you grabbed but the *line* it belongs
 * to: the run of same-net, same-layer, same-width segments joined end to end,
 * ending wherever the topology branches or a via or pad anchors it. Grab a
 * corner and the corner moves; grab the middle of a segment and the segment
 * slides while its neighbours are re-cut to keep the 45° regime.
 *
 * `TRACK_DRAG_ACTION::DRAG`, 45°, is what KiCad does with a left-drag on a
 * trace by default (PCBNEW_SETTINGS::m_TrackDragAction); free-angle is the
 * `dragFreeAngle` action, and it only ever drags corners (upstream asserts on a
 * free-angle *segment* drag).
 *
 * Not ported: arcs are treated as ends of a line rather than dragged through
 * (LINE::DragArc), via dragging, and the router's collision response, shoving
 * or walking around what is in the way. This is the free-space geometry.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { withTrackEnds } from '../edit-board.js';
import type { Board, PcbTrack } from '../types.js';
import { type Chain, dragCorner, dragSegment45, segmentCount } from './pns_line.js';

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** A line assembled out of board tracks, in walk order. */
export interface AssembledLine {
  /** The corner points, `tracks.length + 1` of them. */
  chain: Chain;
  /** Board track indices, one per chain segment, in the same order. */
  tracks: number[];
  /** Chain index of the seed segment (NODE::AssembleLine's origin index). */
  originSegment: number;
  width: number;
  layer: string;
  net: number;
}

/**
 * JOINT::NextSegment, the one other track that carries the line on through
 * `p`. Null when the joint branches, carries a via or pad, or the next segment
 * is a different width: all of those end the line.
 */
function nextSegment(
  board: Board,
  p: Vec2,
  current: number,
  line: { net: number; layer: string; width: number },
): number | null {
  // A via or pad at the joint anchors the line (upstream returns nullptr for
  // SOLID_T / VIA_T without even looking for another segment).
  for (const via of board.vias) {
    if (via.net === line.net && same(via.at, p)) return null;
  }
  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if ((pad.net ?? 0) === line.net && same(pad.at, p)) return null;
    }
  }
  // An arc through the joint is not dragged as part of the line, so stop there.
  for (const arc of board.arcs) {
    if (arc.net === line.net && (same(arc.start, p) || same(arc.end, p))) return null;
  }

  let found: number | null = null;
  for (let i = 0; i < board.tracks.length; i++) {
    if (i === current) continue;
    const t = board.tracks[i]!;
    if (t.net !== line.net || t.layer !== line.layer) continue;
    if (!same(t.start, p) && !same(t.end, p)) continue;
    if (found !== null) return null; // a branch: more than one candidate
    found = i;
  }
  if (found === null) return null;
  if (board.tracks[found]!.width !== line.width) return null;
  return found;
}

/**
 * NODE::AssembleLine, the whole line through `trackIndex`, walked out both
 * ways from the seed segment.
 */
export function assembleLine(board: Board, trackIndex: number): AssembledLine | null {
  const seed = board.tracks[trackIndex];
  if (!seed) return null;

  const spec = { net: seed.net, layer: seed.layer, width: seed.width };
  const chain: Chain = [{ ...seed.start }, { ...seed.end }];
  const tracks = [trackIndex];

  const walk = (from: Vec2, forwards: boolean): void => {
    let p = from;
    let current = trackIndex;
    for (;;) {
      const next = nextSegment(board, p, current, spec);
      if (next === null || tracks.includes(next)) break; // no continuation, or a loop
      const t = board.tracks[next]!;
      const far = same(t.start, p) ? t.end : t.start;
      if (forwards) {
        chain.push({ ...far });
        tracks.push(next);
      } else {
        chain.unshift({ ...far });
        tracks.unshift(next);
      }
      p = far;
      current = next;
    }
  };

  walk(seed.end, true);
  const before = tracks.length;
  walk(seed.start, false);
  // Every segment prepended shifts the seed along the chain.
  const originSegment = tracks.length - before;

  return { chain, tracks, originSegment, width: spec.width, layer: spec.layer, net: spec.net };
}

export type DragMode = 'corner' | 'segment';

export interface TrackDrag {
  line: AssembledLine;
  mode: DragMode;
  /** Corner index for a corner drag; segment index for a segment drag. */
  index: number;
  freeAngle: boolean;
  /** LINE::SetSnapThreshhold, width/4 with "smooth dragged segments" on. */
  snapThreshold: number;
}

/**
 * DRAGGER::startDragSegment, grabbing within half a track width of either end
 * drags that corner; anywhere else slides the segment, except in free-angle
 * mode, which only ever drags corners.
 */
export function startTrackDrag(
  board: Board,
  trackIndex: number,
  p: Vec2,
  opts: { freeAngle?: boolean; smoothDraggedSegments?: boolean } = {},
): TrackDrag | null {
  const line = assembleLine(board, trackIndex);
  if (!line) return null;

  const freeAngle = opts.freeAngle === true;
  const smooth = opts.smoothDraggedSegments !== false;
  const w2 = line.width / 2;

  let index = line.originSegment;
  const a = line.chain[index]!;
  const b = line.chain[index + 1]!;
  const distA = dist(p, a);
  const distB = dist(p, b);

  let mode: DragMode;
  if (distA < w2 || distB < w2) {
    mode = 'corner';
    if (distB <= distA) index++;
  } else if (freeAngle) {
    if (distB < distA && index < line.chain.length - 2) index++;
    mode = 'corner';
  } else {
    mode = 'segment';
  }

  return { line, mode, index, freeAngle, snapThreshold: smooth ? Math.floor(line.width / 4) : 0 };
}

/**
 * The line's new shape with the grabbed corner/segment at `p`. Corners land on
 * whole internal units, as everything upstream is VECTOR2I, guide intersections
 * are otherwise free to land a half-unit off and write coordinates back with
 * more precision than the file format carries.
 */
export function updateTrackDrag(drag: TrackDrag, p: Vec2): Chain {
  const chain =
    drag.mode === 'corner'
      ? dragCorner(drag.line.chain, p, drag.index, drag.freeAngle, drag.snapThreshold)
      : dragSegment45(drag.line.chain, p, drag.index, drag.snapThreshold);
  return chain.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));
}

/**
 * The line's segments after a drag: the old track objects re-pointed at the new
 * corners so they keep their identity (uuid, net, locked, source formatting),
 * plus writer-canonical ones for any segment the drag added.
 */
export function trackDragSegments(board: Board, drag: TrackDrag, chain: Chain): PcbTrack[] {
  const count = segmentCount(chain);
  const old = drag.line.tracks.map((i) => board.tracks[i]!);
  const template = old[0]!;
  const rebuilt: PcbTrack[] = [];

  for (let i = 0; i < count; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    const reuse = old[i];
    if (reuse) {
      rebuilt.push(withTrackEnds(reuse, a, b));
    } else {
      // A new segment the drag created: writer-canonical, with its own identity.
      const { uuid, ...rest } = template;
      void uuid;
      rebuilt.push({ ...rest, start: a, end: b, source: { kind: 'list', items: [] } });
    }
  }
  return rebuilt;
}

/**
 * Commit a dragged line: the line's own segments become the new chain's,
 * dropping or adding segments at the end when the counts do not line up.
 */
export function applyTrackDrag(board: Board, drag: TrackDrag, chain: Chain): Board {
  const count = segmentCount(chain);
  if (count === 0) return board;

  const rebuilt = trackDragSegments(board, drag, chain);

  // Replace in place so the surviving segments keep their indices (and so any
  // selection referring to them stays valid); extras are appended, and the tail
  // of a shortened line is dropped.
  const dropped = new Set(drag.line.tracks.slice(count));
  const byIndex = new Map<number, PcbTrack>();
  drag.line.tracks.slice(0, count).forEach((boardIdx, i) => byIndex.set(boardIdx, rebuilt[i]!));
  const extra = rebuilt.slice(drag.line.tracks.length);

  const tracks = board.tracks.map((t, i) => byIndex.get(i) ?? t).filter((_, i) => !dropped.has(i));

  return { ...board, tracks: [...tracks, ...extra] };
}
