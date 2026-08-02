// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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

import { parseBoardItemId } from './edit-board.js';
import {
  chamferLinePair,
  extendLinePair,
  filletLinePair,
  sharedEndpoint,
  type Seg,
} from '@ziroeda/kimath/src/geometry/corner_operations.js';
import type { Board, PcbShape } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export type LineModification = 'fillet' | 'chamfer' | 'extend';

export interface ModifyLinesOptions {
  /** Fillet only. */
  radius?: number;
  /** Chamfer only; the set-back along each line. */
  setback?: number;
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

const blank = { kind: 'list' as const, items: [] };

/** An arc graphic taking its stroke and layer from the line it came from. */
function arcFrom(src: PcbShape, pts: { start: Vec2; mid: Vec2; end: Vec2 }): PcbShape {
  return {
    kind: 'arc',
    start: pts.start,
    mid: pts.mid,
    end: pts.end,
    width: src.width,
    strokeType: src.strokeType,
    fill: false,
    layer: src.layer,
    locked: src.locked,
    source: blank,
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
    source: blank,
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
