// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Distribute selected items evenly.
 * Counterpart: `ALIGN_DISTRIBUTE_TOOL::DistributeItems`, `doDistributeGaps`
 * and `doDistributeCenters`.
 *
 * The maths lives in kimath (distribute.ts); this decides what to feed it and
 * applies the result to the board.
 */

import {
  deltasForDistributeByGaps,
  deltasForDistributeByPoints,
} from '@ziroeda/kimath/src/geometry/distribute.js';
import { boardItemBBox, moveBoardItems } from './edit-board.js';
import type { Board } from './types.js';

export type DistributeAction =
  | 'horizontallyCenters'
  | 'horizontallyGaps'
  | 'verticallyCenters'
  | 'verticallyGaps';

/**
 * `DistributeItems`.
 *
 * Fewer than three items is a no-op, not an error: distribution needs one item
 * at each end and at least one in between to move. Upstream returns early on
 * the same count, and its menu entries are enabled by `MoreThan( 2 )`.
 *
 * The first and last items never move. They define the span, so moving them
 * would make running the command twice give a different answer than running it
 * once.
 */
export function distributeBoardItems(
  board: Board,
  selection: Iterable<string>,
  action: DistributeAction,
): Board {
  const isX = action === 'horizontallyCenters' || action === 'horizontallyGaps';
  const byGaps = action === 'horizontallyGaps' || action === 'verticallyGaps';

  const entries = [...selection]
    .map((id) => {
      const bbox = boardItemBBox(board, id);
      return bbox ? { id, bbox } : null;
    })
    .filter((e): e is { id: string; bbox: NonNullable<ReturnType<typeof boardItemBBox>> } => !!e);

  // The maths returns all-zero deltas below three items too, so this is the
  // early-out upstream has rather than the thing that makes it safe.
  if (entries.length < 3) return board;

  // Sorted along the axis by the measure being distributed, as upstream sorts
  // each. For a row of non-overlapping items — the only case the gap algorithm
  // is well-defined for, per upstream's own comment — leading-edge order and
  // centre order agree, so this choice is invisible unless items overlap.
  const start = (b: (typeof entries)[number]['bbox']): number => (isX ? b.minX : b.minY);
  const end = (b: (typeof entries)[number]['bbox']): number => (isX ? b.maxX : b.maxY);
  const centre = (b: (typeof entries)[number]['bbox']): number => (start(b) + end(b)) / 2;

  const sorted = [...entries].sort((a, b) =>
    byGaps ? start(a.bbox) - start(b.bbox) : centre(a.bbox) - centre(b.bbox),
  );

  const deltas = byGaps
    ? deltasForDistributeByGaps(sorted.map((e) => [start(e.bbox), end(e.bbox)] as const))
    : deltasForDistributeByPoints(sorted.map((e) => Math.round(centre(e.bbox))));

  let next = board;

  for (let i = 0; i < sorted.length; i++) {
    const delta = deltas[i] ?? 0;
    if (delta === 0) continue;

    next = moveBoardItems(
      next,
      new Set([sorted[i]!.id]),
      isX ? { x: delta, y: 0 } : { x: 0, y: delta },
    );
  }

  return next;
}
