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

/**
 * `EDIT_TOOL::Move`'s movement, for one frame (edit_tool_move_fct.cpp:1144-1177).
 *
 *     m_cursor = grid.BestSnapAnchor( mousePos, layers, selectionGrid, sel_items );
 *     movement = m_cursor - prevPos;
 *     …
 *     prevPos  = m_cursor;
 *
 * `prevPos` is seeded to the drag origin — `grid.BestDragOrigin(…)`, an anchor
 * *on the selection*, with the pointer warped onto it (:1311-1351). Summed over
 * the gesture the telescoping leaves `anchor + Σmovement = BestSnapAnchor(…)`,
 * so what is really being placed is the **anchor**, absolutely, at the snapped
 * cursor. That is the whole of why two parts dragged in KiCad line up with each
 * other: each one's anchor lands on a grid node rather than keeping whatever
 * fraction of a grid step it had.
 *
 * `snap` is `BestSnapAnchor`, taken as an argument because it needs the board,
 * the view scale and the moving items to skip — none of which this arithmetic
 * has any business knowing.
 *
 * The browser cannot warp the pointer. It does not need to: with the warp,
 * upstream's `mousePos` is the anchor plus the pointer's motion since the grab,
 * which is what the first line reconstructs. Called with `anchor === grabOrigin`
 * — a selection that offers no anchor at all, where `BestDragOrigin` returns the
 * mouse position — it degenerates to exactly upstream's own answer for that case.
 */
export function moveDelta(
  anchor: GridPoint,
  grabOrigin: GridPoint,
  cursor: GridPoint,
  snap: (p: GridPoint) => GridPoint,
): GridPoint {
  const to = snap({
    x: anchor.x + (cursor.x - grabOrigin.x),
    y: anchor.y + (cursor.y - grabOrigin.y),
  });

  return { x: to.x - anchor.x, y: to.y - anchor.y };
}
