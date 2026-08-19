// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a `Combo`'s drop-down list opens.
 *
 * Split out of `Combo.tsx` because this is the only part of the widget that can
 * be tested without a DOM, and the test environment cannot reach into a `.tsx`.
 */

/** Row height and vertical padding, kept here so `popupTop` and the CSS agree. */
export const ROW_H = 26;
export const PAD_Y = 4;

/**
 * The popup's top edge, in viewport coordinates.
 *
 * GTK's `wxChoice` opens its list *over* the closed box with the selected row
 * covering it, so the value you are reading does not move when the list appears
 * — unlike a native `<select>`, which drops the list below the box. Off-screen
 * at either end the list slides back in rather than opening partly out of view,
 * which is why a long list selected near its bottom still shows whole.
 *
 * @param buttonTop      top of the closed box, viewport coordinates
 * @param index          index of the selected row
 * @param count          number of rows
 * @param viewportHeight `window.innerHeight`
 */
export function popupTop(
  buttonTop: number,
  index: number,
  count: number,
  viewportHeight: number,
): number {
  const height = count * ROW_H + PAD_Y * 2;
  const wanted = buttonTop - PAD_Y - index * ROW_H;
  return Math.max(4, Math.min(wanted, viewportHeight - 4 - height));
}
