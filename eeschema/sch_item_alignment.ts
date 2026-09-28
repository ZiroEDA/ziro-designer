// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The grid-snap geometry of `AlignSchematicItemsToGrid` —
 * `eeschema/sch_item_alignment.cpp`.
 *
 * Upstream's own `AlignSchematicItemsToGrid` fuses this geometry with the
 * per-item drag loop that applies it (a `SCH_COMMIT`, `m_doMoveItem`, the
 * connected-drag-items callback) in one function; here that loop is
 * `tools/align_to_grid.ts`'s `alignToGridCommand`, which imports the two pure
 * functions below rather than duplicating them. `MoveSchematicItem`
 * (`sch_item_alignment.cpp`'s other function, the per-`EDA_ITEM`-type move
 * dispatch used by both alignment and drag) has no separate port here: our
 * move dispatch lives in `tools/move.ts`/`tools/connect.ts`
 * (`moveWithConnections`/`planMove`), reused as-is rather than duplicated for
 * alignment.
 */

import type { Vec2 } from './types.js';

/** `EE_GRID_HELPER::AlignGrid`: the nearest multiple of the grid step. */
export const alignToGridPoint = (p: Vec2, grid: number): Vec2 => ({
  x: Math.round(p.x / grid) * grid,
  y: Math.round(p.y / grid) * grid,
});

const key = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * The shift that snaps the most of `points` onto the grid — upstream's
 * `shifts` histogram, whose winner is the most common delta.
 *
 * Ties go to the first shift to reach the running maximum, which is the order
 * the connection points come in, exactly as the `>` comparison upstream leaves
 * the incumbent in place.
 */
export function mostCommonGridShift(points: readonly Vec2[], grid: number): Vec2 {
  let best: Vec2 = { x: 0, y: 0 };
  let bestCount = 0;
  const counts = new Map<string, { shift: Vec2; n: number }>();
  for (const p of points) {
    const aligned = alignToGridPoint(p, grid);
    const shift = { x: aligned.x - p.x, y: aligned.y - p.y };
    const k = key(shift);
    const entry = counts.get(k) ?? { shift, n: 0 };
    entry.n++;
    counts.set(k, entry);
    if (entry.n > bestCount) {
      bestCount = entry.n;
      best = entry.shift;
    }
  }
  return best;
}
