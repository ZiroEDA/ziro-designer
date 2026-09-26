// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Middle-ellipsis for status-bar fields.
 *
 * KISTATUSBAR::SetEllipsedTextField (common/widgets/kistatusbar.cpp) is how
 * every KiCad frame keeps a long path inside a status field:
 *
 *     if( GetFieldRect( aFieldId, fieldRect ) )
 *         width = fieldRect.GetWidth();
 *
 *     if( width > 20 )
 *     {
 *         int margin = KIUI::GetTextSize( wxT( "XX" ), this ).x;
 *         etext = wxControl::Ellipsize( etext, dc, wxELLIPSIZE_MIDDLE, width - margin );
 *     }
 *
 * Three things to carry over, all of them load-bearing:
 *
 *  - the ellipsis goes in the *middle*, not at the end. A project path's two
 *    informative ends are the folder it lives in and the file itself; CSS's
 *    `text-overflow: ellipsis` throws away the second one, which is the half
 *    that says which project you have open.
 *  - it is measured against the field's own width, not the window's.
 *  - the budget is the field width less the width of "XX", so the text never
 *    sits flush against the edge of its field.
 *
 * The replacement is "..." rather than "…" because that is what wxWidgets
 * substitutes, and it is visibly wider than the single glyph.
 */

/** wxWidgets' wxELLIPSE_REPLACEMENT. */
const ELLIPSIS = '...';

/**
 * Shorten `text` from the middle until it measures no wider than `maxWidth`.
 *
 * `measure` returns the rendered width of a string; keeping it a parameter is
 * what makes this testable without a DOM, and lets the caller supply a canvas
 * context configured with the element's real font.
 *
 * Returns `text` unchanged when it already fits, and never returns anything
 * longer than the input.
 */
export function ellipsizeMiddle(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (maxWidth <= 0 || measure(text) <= maxWidth) return text;
  // Not even "..." fits: there is nothing useful to show, and returning a
  // truncated ellipsis would be noise. Upstream's own guard is the caller's
  // `width > 20`; this is the same idea one level down.
  if (measure(ELLIPSIS) > maxWidth) return ELLIPSIS;

  // Largest number of original characters we can keep, split around the middle.
  // Binary search rather than trimming one at a time: a status bar re-measures
  // on every resize tick, and a long path is ~80 characters.
  const build = (keep: number): string => {
    const head = Math.ceil(keep / 2);
    const tail = keep - head;
    return text.slice(0, head) + ELLIPSIS + (tail > 0 ? text.slice(text.length - tail) : '');
  };

  let lo = 0; // always fits
  let hi = text.length - 1; // may not
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(build(mid)) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return build(lo);
}

/**
 * The "XX" margin KISTATUSBAR subtracts from the field width before ellipsizing.
 */
export function ellipsisMargin(measure: (s: string) => number): number {
  return measure('XX');
}
