// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where the grid is, and how a point snaps onto it.
 *
 * A board carries its own grid origin — `(setup (grid_origin x y))`,
 * `BOARD_DESIGN_SETTINGS::GetGridOrigin` — and pcbnew installs it on the GAL the
 * moment a board is opened (`pcb_base_edit_frame.cpp`:
 * `GetGAL()->SetGridOrigin( aBoard->GetDesignSettings().GetGridOrigin() )`).
 * Everything that touches the grid then works relative to it: `CAIRO_GAL_BASE::
 * DrawGrid` offsets every dot by `m_gridOrigin`, and `GRID_HELPER::AlignGrid`
 * rounds about `GRID_HELPER::GetOrigin()`, which reads the same value back off
 * the GAL.
 *
 * We had it hardcoded to (0, 0) in both places. That is invisible on a board
 * whose origin happens to be a whole number of grid steps from the world origin
 * — most of them, which is why it survived — and plainly wrong on one where it
 * is not: the dots sit at a fixed fraction of a step away from every track and
 * pad that KiCad placed on them.
 *
 * Lives in its own module rather than in `PcbEditor.tsx` so the qa package can
 * typecheck it; qa's tsc has no `--jsx`, so anything imported from a `.tsx`
 * fails the workspace typecheck even though vitest runs it happily.
 */

/** A point in internal units. */
export interface GridPoint {
  x: number;
  y: number;
}

/**
 * `GRID_HELPER::computeNearest`: the nearest node of a grid of `size`, anchored
 * at `origin`.
 *
 * Both the crosshair and the move go through this, which is what makes a
 * dragged item follow the snapped crosshair rather than the raw pointer
 * (`edit_tool_move_fct.cpp`: `m_cursor = grid.BestSnapAnchor( mousePos )`,
 * `movement = m_cursor - prevPos`).
 */
export function snapToGridSize(p: GridPoint, size: number, origin: GridPoint): GridPoint {
  if (!(size > 0)) return { x: p.x, y: p.y };
  return {
    x: Math.round((p.x - origin.x) / size) * size + origin.x,
    y: Math.round((p.y - origin.y) / size) * size + origin.y,
  };
}
