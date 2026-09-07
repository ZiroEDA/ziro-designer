// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ACTION_TOOLBAR`'s overflow: what a toolbar does when it does not fit.
 *
 *     Bind( wxEVT_SIZE, [&]( wxSizeEvent& aEvent )
 *           {
 *               CallAfter( [&]() { SetOverflowVisible( !GetToolBarFits() ); } );
 *               aEvent.Skip();
 *           } );
 *                                  (`common/tool/action_toolbar.cpp:221-231`)
 *
 * So the answer is not "let it overflow" and not "shrink the buttons": the bar
 * KEEPS its size, the tools that do not fit are dropped from the layout, and a
 * chevron appears at the end which opens them as a menu. Every wxAuiToolBar in
 * KiCad behaves this way, which is why a user can set Large icons on a short
 * window and nothing moves except the number of buttons on the strip.
 *
 * This module is the arithmetic half — which entries fit — so it can be tested
 * without a DOM. `Toolbar.tsx` measures and renders.
 */

/**
 * `wxAuiDefaultToolBarArt::GetElementSize( wxAUI_TBART_OVERFLOW_SIZE )`.
 *
 * [px] 16 on this machine, read off a live `wxAuiToolBar` by
 * `qa/probes/aui_overflow_probe.cpp` — which also reports the tool packing (2),
 * the border padding (3) and a 30x30 rect around a 24px icon, all of which
 * agree with `--toolbar-button-size`. The chevron is a horizontal bar over a
 * downward triangle; the probe dumps the glyph the art provider draws.
 */
export const OVERFLOW_SIZE = 16;

/**
 * How many of `ends` fit, given the room there is.
 *
 * `ends[i]` is the offset at which entry `i` ENDS, measured along the bar's own
 * axis from its content edge, with every entry laid out. Cumulative rather than
 * per-entry sizes because the gaps between entries belong to neither neighbour
 * and a sum of sizes would lose them.
 *
 * Returns `null` when everything fits, which is the state with no chevron —
 * distinct from "all of them fit alongside a chevron", which cannot happen but
 * would otherwise be spelled the same way.
 *
 * The reserved chevron is the whole subtlety: wx does not first check whether
 * the tools fit and then add the button on top of them. `GetToolBarFits()` is
 * false, the overflow button becomes visible, and the layout that follows has
 * `OVERFLOW_SIZE` less room — so a bar one pixel short of fitting loses however
 * many tools that 16px costs, not one.
 */
export function visibleCount(ends: readonly number[], available: number): number | null {
  if (ends.length === 0) return null;

  const total = ends[ends.length - 1] ?? 0;
  if (total <= available) return null;

  const room = available - OVERFLOW_SIZE;
  let n = 0;
  for (const end of ends) {
    if (end > room) break;
    n++;
  }
  // Even with no room for a single tool the chevron is what is drawn, so the
  // tools are reachable rather than gone. `Math.max` is not a clamp for a
  // number that cannot go negative — `room` can, on a pane narrower than 16px.
  return Math.max(0, n);
}
