// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Whether a drop-down shows GTK's scroll arrows, and which.
 *
 * GTK grows arrows on a menu too tall for the monitor and shows one only at an
 * end there is still something beyond: none at the top until you have scrolled,
 * none at the bottom once you have reached the end, and neither on a menu that
 * fits. Split out of `MenuBar.tsx` because it is the only testable part and the
 * test environment has no DOM.
 */

export interface ScrollEnds {
  up: boolean;
  down: boolean;
}

export const NO_ARROWS: ScrollEnds = { up: false, down: false };

/**
 * @param scrollTop    the pane's current scroll offset
 * @param scrollHeight the height of all the rows
 * @param clientHeight the visible height of the pane, 0 before it is laid out
 */
export function submenuEnds(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): ScrollEnds {
  // `clientHeight` is 0 until the pane has been laid out, and `scrollHeight - 0`
  // then reads as a full menu's worth of "more below" — which is how an arrow
  // appeared on a three-item menu. Because the arrows are rows in the same flex
  // column, a spurious one also made the NEXT open measure arrow height rather
  // than row height and clamp the flyout to it, hiding the items outright.
  if (clientHeight === 0 || scrollHeight <= clientHeight + 1) return NO_ARROWS;
  const max = scrollHeight - clientHeight;
  return { up: scrollTop > 0, down: scrollTop < max - 1 };
}
