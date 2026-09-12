// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The constant-only headers under KiCad's `include/font/`.
 *
 * Two of them, kept together because they are leaves that everything else in
 * `common/src/font/` needs and neither may import the other's dependents:
 *
 *   - `include/font/font_metrics.h`  `KIFONT::METRICS` — the interline pitch,
 *     overbar height and underline offset, expressed as multiples of the glyph
 *     height. `METRICS::Default()` is what every call site passes, so the
 *     defaults are simply the values.
 *   - `include/font/font.h:62`       `ITALIC_TILT` — the italic shear.
 *
 * Both were previously copied per consumer: `INTERLINE_PITCH` stood in five
 * files and `ITALIC_TILT` in five more, one upstream `constexpr` each. A copy
 * is how `stroke_font.ts` came to disagree with `renderer.ts` about the line
 * pitch of the very same text.
 */

/** `METRICS::m_InterlinePitch`. */
export const INTERLINE_PITCH = 1.68;

/** `METRICS::m_OverbarHeight`. */
export const OVERBAR_HEIGHT = 1.23;

/** `METRICS::m_UnderlineOffset`. */
export const UNDERLINE_OFFSET = -0.16;

/**
 * `STROKE_FONT::GetInterline`'s "Adjustment to match legacy spacing"
 * (`common/font/stroke_font.cpp:196`).
 *
 * It applies to the **stroke font only** — `OUTLINE_FONT::GetInterline`
 * (`common/font/outline_font.cpp:184`) returns `METRICS::GetInterline` with no
 * adjustment — so it lives here next to the pitch it adjusts rather than being
 * folded into it.
 */
export const STROKE_LEGACY_FACTOR = 0.9583;

/** @deprecated `METRICS.Default().GetInterline`; this delegates. */
export const metricsInterline = (glyphHeight: number): number =>
  METRICS.Default().GetInterline(glyphHeight);

/** @deprecated `METRICS.Default().GetOverbarVerticalPosition`; this delegates. */
export const overbarVerticalPosition = (glyphHeight: number): number =>
  METRICS.Default().GetOverbarVerticalPosition(glyphHeight);

/** @deprecated `METRICS.Default().GetUnderlineVerticalPosition`; this delegates. */
export const underlineVerticalPosition = (glyphHeight: number): number =>
  METRICS.Default().GetUnderlineVerticalPosition(glyphHeight);

/**
 * `include/font/font.h:62` `static constexpr double ITALIC_TILT = 1.0 / 8`.
 *
 * `STROKE_FONT::GetTextAsGlyphs` shears each glyph point right by `y · tilt`
 * (y is negative above the baseline, so the tops lean right), and
 * `EDA_TEXT::GetTextBox` uses the same constant for its `italicOffset`.
 */
export const ITALIC_TILT = 1.0 / 8;

/** `KIFONT::METRICS`: the three ratios a font's layout reads. */
export class METRICS {
  m_InterlinePitch = INTERLINE_PITCH;
  m_OverbarHeight = OVERBAR_HEIGHT;
  m_UnderlineOffset = UNDERLINE_OFFSET;

  GetOverbarVerticalPosition(aGlyphHeight: number): number {
    return aGlyphHeight * this.m_OverbarHeight;
  }

  GetUnderlineVerticalPosition(aGlyphHeight: number): number {
    return aGlyphHeight * this.m_UnderlineOffset;
  }

  GetInterline(aFontHeight: number): number {
    return aFontHeight * this.m_InterlinePitch;
  }

  /** `g_defaultMetrics` (font.cpp). */
  static Default(): METRICS {
    return g_defaultMetrics;
  }
}

const g_defaultMetrics = new METRICS();
