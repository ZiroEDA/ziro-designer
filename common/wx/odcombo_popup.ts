// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a `wxComboCtrl`'s drop-down opens, and how tall it is allowed to get.
 *
 * Split out of `OwnerDrawnCombo.tsx` for the reason `combo_popup.ts` is split
 * out of `Combo.tsx`: this is the part of the widget that is pure arithmetic,
 * and pinning it does not need a DOM.
 *
 * A `wxOwnerDrawnComboBox` is a `wxComboCtrl`, and its popup is NOT placed like
 * a `wxChoice`'s. `wxChoice` on GTK opens its list *over* the closed box with
 * the selected row covering it (that is what `combo_popup.ts` computes);
 * `wxComboCtrl` opens a window of its own flush against the bottom edge of the
 * control, left edges aligned.
 *
 * Measured rather than read out of the wx sources, because the number that
 * matters is what this GTK does on this machine:
 * `~/kicad-probes/fp_choice_probe.cpp` builds the same read-only
 * `wxOwnerDrawnComboBox` KiCad builds, pops it, and subtracts the two screen
 * rectangles.
 *
 *   combo screen rect  x=110 y=177 w=420 h=34
 *   popup screen rect  x=110 y=211 w=748 h=110
 *   dx = 0, dy (popup.y - combo.bottom) = 0
 *
 * So: no gap, no offset, and a width that is the WIDER of the control and the
 * widest item (748 against a 420 px control whose widest entry measured 735).
 */

/**
 * The tallest a `wxComboCtrl` popup gets before it starts scrolling.
 *
 * [px] `~/kicad-probes/fp_choice_probe.cpp` again, with 200 entries in the
 * list: the popup window opens 398 px tall — a 1 px border, 22 rows of 18, and
 * a 1 px border — however many more items there are. `wxComboCtrlBase` clamps
 * its popup to a default maximum height and then rounds down to a whole number
 * of rows. It is the same 397 px the real KiCad screenshot's footprint list
 * measures (y 646..1043) with hundreds of TerminalBlock footprints below the
 * fold.
 *
 * Border-box, so a rule using it must be `box-sizing: border-box`.
 */
export const POPUP_MAX_H = 398;

/** The bits of a `DOMRect` this needs; enough to pass a plain object in a test. */
export interface FieldRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PopupBox {
  left: number;
  top: number;
  /** A floor, not a width: the popup still grows to its widest row. */
  minWidth: number;
  maxHeight: number;
}

/**
 * Place the popup against the control, the way `wxComboCtrl` does.
 *
 * Below the control by preference. When the list would not fit below, wx flips
 * it above instead, and flush: [px] with the control at y=1080..1114 on a
 * 1200 px screen the 398 px popup opened at y=682, i.e. its bottom edge exactly
 * on the control's top edge — not merely nudged up until it fitted.
 *
 * @param field    the closed control, in viewport coordinates
 * @param natural  the popup's unconstrained size, as measured off the DOM
 * @param viewport `window.innerWidth` / `innerHeight`
 */
export function placeComboPopup(
  field: FieldRect,
  natural: { width: number; height: number },
  viewport: Viewport,
): PopupBox {
  const wanted = Math.min(natural.height, POPUP_MAX_H);
  const below = viewport.height - field.bottom;
  const above = field.top;

  let top: number;
  let maxHeight: number;

  if (wanted <= below) {
    top = field.bottom;
    maxHeight = wanted;
  } else if (wanted <= above) {
    top = field.top - wanted;
    maxHeight = wanted;
  } else if (below >= above) {
    // Neither side holds the whole list: take the roomier one and scroll.
    top = field.bottom;
    maxHeight = below;
  } else {
    top = 0;
    maxHeight = above;
  }

  // The popup is as wide as its widest row, which is why KiCad's footprint list
  // hangs well outside the Choose Symbol dialog. wx clamps that to the display;
  // the viewport is our display, and a fixed-position box pushed past its right
  // edge is simply unreachable.
  const width = Math.max(natural.width, field.width);
  const left = Math.max(0, Math.min(field.left, viewport.width - width));

  return { left, top, minWidth: field.width, maxHeight };
}
