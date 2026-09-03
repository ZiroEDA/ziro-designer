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

/**
 * Which edge of the pane the sash sits on.
 *
 * `top` and `bottom` are the same decision turned ninety degrees, for a
 * wxSplitterWindow split horizontally — APPEARANCE_CONTROLS' Nets tab stacks
 * its two panels that way (`m_netsTabSplitter`,
 * appearance_controls_base.cpp:145). One function rather than two, because the
 * bug the header warns about is the sign, and a second copy is a second sign
 * to get wrong.
 */
export type DockEdge = 'left' | 'right' | 'top' | 'bottom';

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
  const sign = edge === 'left' || edge === 'top' ? -1 : 1;
  // `max` can fall below `min` on a very narrow window; the pane's own minimum
  // wins, because wxAUI will not shrink a pane past its MinSize to make room.
  return Math.max(min, Math.min(Math.max(min, max), startWidth + sign * dx));
}

/**
 * The width a docked pane OPENS at, given the two sizes wxAUI is handed.
 *
 * `wxAuiPaneInfo` keeps `best_size` and `min_size` as separate fields and the
 * dock layout clamps the best size up to the minimum, so a pane added with
 * both shows whichever is larger. Every KiCad frame relies on that pairing:
 *
 *     m_auimgr.AddPane( m_propertiesPagelayout, EDA_PANE().Palette()
 *                       .Right().Layer( 3 )
 *                       .BestSize( m_propertiesFrameWidth, -1 )
 *                       .MinSize( m_propertiesPagelayout->GetMinSize() ) );
 *                                       pagelayout_editor/pl_editor_frame.cpp:200-204
 *
 * Reading only the settings default is how a pane ends up clipping its own
 * controls: `properties_frame_width` is 150 (pl_editor_settings.cpp:38) while
 * the panel's own content needs more, and it is the MinSize that rescues it.
 *
 * `contentMin` is the DOM's answer to `GetMinSize()` - the panel's
 * `scrollWidth`, what the content needs when the box is narrower than it.
 */
export function dockedPaneWidth(bestSize: number, contentMin: number): number {
  return Math.max(bestSize, contentMin);
}
