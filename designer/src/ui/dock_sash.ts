// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a dock sash drag puts the pane edge.
 *
 * Split out of the component because the one decision in it - which way the
 * pane grows - is invisible until somebody drags, and a component in a `.tsx`
 * cannot be reached from qa's tests at all. Named here, it can be.
 */

/** Which edge of the pane the sash sits on. */
export type DockEdge = 'left' | 'right';

/**
 * The pane's new width after the pointer has moved `dx` from where the drag
 * started, clamped to the pane's `MinSize` and to the point past which the
 * centre pane would be squeezed out.
 *
 * A pane docked on the **right** of the window has its sash on its **left**
 * edge, so it grows as the pointer moves left: `dx` counts against it. A pane
 * docked on the left is the other way round. Writing one and reusing it for
 * the other reads perfectly plausibly and is wrong in exactly one direction.
 */
export function resizeDock(
  edge: DockEdge,
  startWidth: number,
  dx: number,
  min: number,
  max: number,
): number {
  const sign = edge === 'left' ? -1 : 1;
  // `max` can fall below `min` on a very narrow window; the pane's own minimum
  // wins, because wxAUI will not shrink a pane past its MinSize to make room.
  return Math.max(min, Math.min(Math.max(min, max), startWidth + sign * dx));
}
