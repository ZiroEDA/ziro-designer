// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIUI::EnsureTextCtrlWidth` (`common/widgets/ui_common.cpp:174-198`).
 *
 * A wxTextCtrl built with `wxDefaultSize` starts at the toolkit's default width
 * and is widened when a string does not fit:
 *
 *     wxSize textz = GetTextSize( *aString, window );
 *     wxSize ctrlz = aCtrl->GetSize();
 *     if( ctrlz.GetWidth() < textz.GetWidth() + 10 )
 *     {
 *         ctrlz.SetWidth( textz.GetWidth() + 10 );
 *         aCtrl->SetSizeHints( ctrlz );
 *     }
 *
 * Two things about that are easy to miss and are the reason this is a named
 * function rather than a `style={{ width }}` at the call site:
 *
 *  - **it only grows.** `SetSizeHints` raises the minimum; nothing lowers it
 *    again, so a control that once held a long string keeps its width when a
 *    short one replaces it. A caller that recomputed the width from the current
 *    text would shrink the box, which upstream never does.
 *  - **the 10 is padding around the text**, not a margin outside the control.
 */

/** The padding upstream adds to the text extent — `textz.GetWidth() + 10`. */
const TEXT_PADDING = 10;

/**
 * The control's new width: unchanged when the text already fits, otherwise the
 * text plus {@link TEXT_PADDING}.
 *
 * `current` is what the control is now — its toolkit default the first time.
 */
export function ensureTextCtrlWidth(current: number, textWidth: number): number {
  const wanted = textWidth + TEXT_PADDING;
  return current < wanted ? wanted : current;
}

/** A canvas kept between calls, as `GetTextSize` reuses the window's own DC. */
let scratch: CanvasRenderingContext2D | null = null;

/**
 * The width of `text` in the font `el` is rendered in — the browser's answer to
 * `KIUI::GetTextSize`, which measures with the window's font rather than
 * guessing from a character count.
 *
 * Returns 0 when there is no canvas to measure with (jsdom, SSR), which leaves
 * {@link ensureTextCtrlWidth} returning the control's current width unchanged —
 * the same as a string that fits.
 */
export function measureTextWidth(text: string, el: Element): number {
  if (text === '') return 0;
  if (!scratch) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return 0;
    scratch = ctx;
  }
  const font = getComputedStyle(el).font;
  if (font) scratch.font = font;
  return Math.ceil(scratch.measureText(text).width);
}
