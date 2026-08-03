// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Grabbing and dragging point-editor handles on the board canvas.
 * Counterparts: `EDIT_POINTS::FindPoint` and the drag arithmetic in
 * `PCB_POINT_EDITOR::OnDragEnd` (pcbnew/tools/pcb_point_editor.cpp).
 *
 * The engine in `@ziroeda/pcbnew` decides *where* the handles are and what
 * moving one does to the board. This is the other half: which handle the mouse
 * is on, and what point to hand the engine when the mouse moves. Kept out of the
 * .tsx so qa can test it — the component around it is refs and canvas calls.
 */
import type { BoardEditHandle } from '@ziroeda/pcbnew';

/** A world-space point, in internal units. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * `EDIT_POINTS::FindPoint` hit-tests each point's own box, which stays
 * POINT_SIZE *screen* pixels wide however far you are zoomed in. So the
 * tolerance has to be converted back through the view scale rather than being a
 * fixed distance on the board — at a 10x zoom the same button-sized target is a
 * tenth as many internal units across.
 */
export function handleTolerance(pointSizePx: number, viewScale: number): number {
  return pointSizePx / viewScale;
}

/**
 * The handle under a world point, or null if the cursor is not on one.
 *
 * Ties go to a `point` handle. Corner and vertex handles sit on top of the
 * `line` (edge-midpoint) handles either side of them, and on a short edge the
 * two can be the same distance away; resolving that towards the corner is what
 * makes a corner grabbable at all on a small item.
 */
export function handleAtPoint(
  handles: readonly BoardEditHandle[],
  p: Pt,
  tolerance: number,
): BoardEditHandle | null {
  let best: BoardEditHandle | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const h of handles) {
    const d = Math.hypot(h.at.x - p.x, h.at.y - p.y);
    if (d <= tolerance && (d < bestD || (d === bestD && h.kind === 'point'))) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/**
 * The point to hand `dragBoardHandle` for a cursor at `cursor`, given a drag
 * that started at `origin`.
 *
 * A `point` handle is the thing being positioned, so it goes where the cursor
 * is. A `line` handle stands for a whole edge, and the grab almost never lands
 * exactly on its midpoint — snapping it onto the cursor would make the edge jump
 * by however far off you clicked. So an edge is moved by the cursor's *delta*
 * from where it was grabbed, which leaves it under the mouse.
 */
export function handleDragTarget(handle: BoardEditHandle, origin: Pt, cursor: Pt): Pt {
  if (handle.kind !== 'line') return cursor;
  return {
    x: handle.at.x + (cursor.x - origin.x),
    y: handle.at.y + (cursor.y - origin.y),
  };
}
