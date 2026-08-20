// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_TEXT::GetTextBox` — the one place KiCad answers "how big is this text".
 *
 * KiCad never *estimates* a text extent. Every bounding box, every hit test and
 * every autoplacement clearance goes through `EDA_TEXT::GetTextBox`, which asks
 * the font for the glyph run and then adds the things a glyph run does not
 * carry: the stroke pen, a stroke-font descender fudge, the overbar, the
 * interline stack of a multi-line run, and the shift for the item's
 * justification.
 *
 * Ported line for line from:
 *   - `common/eda_text.cpp`         `EDA_TEXT::GetTextBox`,
 *                                   `EDA_TEXT::GetEffectiveTextPenWidth`
 *   - `common/gr_text.cpp`          `GetPenSizeForBold`, `GetPenSizeForNormal`,
 *                                   `ClampTextPenSize`
 *   - `common/font/font.cpp`        `FONT::StringBoundaryLimits`
 *   - `common/font/stroke_font.cpp` `STROKE_FONT::GetTextAsGlyphs` (the glyph-run
 *                                   bbox, including `INTER_CHAR`),
 *                                   `STROKE_FONT::GetInterline`
 *   - `include/font/font_metrics.h` `METRICS::m_InterlinePitch`
 *
 * This lives in `common/` because upstream's does: `eeschema`, `pcbnew`,
 * `gerbview` and the drawing-sheet code all call the same `EDA_TEXT` method.
 * `eeschema/src/fieldbox.ts` grew its own copy of this maths first, for symbol
 * fields; this is that maths with the schematic-field specifics lifted out, so
 * the board can use it too instead of guessing.
 */

import { interline, splitTextLines } from './stroke_font.js';
import { ITALIC_TILT, metricsInterline } from './font_metrics.js';
import { textWidth, type TextStyle } from './font_provider.js';

/** A `BOX2I`: origin plus size, in internal units. */
export interface TextBox2 {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextHJustify = 'left' | 'center' | 'right';
export type TextVJustify = 'top' | 'center' | 'bottom';

/**
 * `include/font/font.h` `ITALIC_TILT`, re-exported so a consumer that already
 * talks to `GetTextBox` need not know which header it came from. The single
 * declaration is in `font_metrics.ts`.
 */
export { ITALIC_TILT };

/**
 * `KiROUND` (`include/math/util.h`): half away from zero, unlike `Math.round`,
 * which takes -0.5 to -0 rather than to -1.
 */
export const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/** `GetPenSizeForBold`: text size / 5. */
export const penSizeForBold = (textSize: number): number => kiRound(textSize / 5);

/** `GetPenSizeForNormal`: text size / 8. */
export const penSizeForNormal = (textSize: number): number => kiRound(textSize / 8);

/**
 * `ClampTextPenSize`: a pen may not exceed a quarter of the smaller text
 * dimension (0.18 in `aStrict` mode), so small text does not blot out.
 */
export function clampTextPenSize(pen: number, size: TextSize, strict = false): number {
  const smaller = Math.min(Math.abs(size.x), Math.abs(size.y));
  return Math.min(pen, kiRound(smaller * (strict ? 0.18 : 0.25)));
}

/** `GetTextSize()`: the glyph box. `x` scales advances, `y` is the cap height. */
export interface TextSize {
  x: number;
  y: number;
}

/** Everything `GetTextBox` reads off the item, in `EDA_TEXT`'s own terms. */
export interface TextBoxAttrs {
  size: TextSize;
  /** `GetTextThickness()`; 0/undefined means "not set", as in the file format. */
  thickness?: number;
  bold?: boolean;
  italic?: boolean;
  /** `IsMirrored()`. Only shifts the box; it never changes its size. */
  mirrored?: boolean;
  hJustify?: TextHJustify;
  vJustify?: TextVJustify;
  /**
   * `IsMultilineAllowed()`. `TEXT_ATTRIBUTES` defaults it to true
   * (`common/font/text_attributes.cpp:37`) and neither `PCB_TEXT` nor
   * `SCH_TEXT` turns it off, so it defaults to true here as well.
   */
  multiline?: boolean;
  /** `(font (face "…"))`; absent means KiCad's built-in stroke font. */
  face?: string;
}

/** Whether this face is drawn (and measured) as the built-in stroke font. */
export const isStrokeFont = (face?: string): boolean => !face;

/**
 * `EDA_TEXT::GetEffectiveTextPenWidth`.
 *
 * A stored thickness greater than 1 wins outright. Otherwise the caller's
 * default pen is used, and when that is also ≤ 1 the pen is derived from the
 * text *width* — `GetPenSizeForBold( GetTextWidth() )` / `GetPenSizeForNormal(
 * GetTextWidth() )`, both of which take `GetTextSize().x`, not the height.
 * Either way the result is clamped against the smaller of the two dimensions.
 */
export function effectiveTextPenWidth(attrs: TextBoxAttrs, defaultPenWidth = 0): number {
  let penWidth = attrs.thickness ?? 0;

  if (penWidth <= 1) {
    penWidth = defaultPenWidth;

    if (attrs.bold) penWidth = penSizeForBold(attrs.size.x);
    else if (penWidth <= 1) penWidth = penSizeForNormal(attrs.size.x);
  }

  return clampTextPenSize(penWidth, attrs.size);
}

/**
 * `STROKE_FONT::GetInterline`: the metrics pitch (1.68) times a 0.9583 factor
 * kept "to match legacy spacing".
 *
 * This is now `stroke_font.ts`'s `interline()` — the same function the renderer
 * lays lines out with. It used to be a second copy here, because that one was
 * missing the legacy factor and `GetTextBox` needs the real value; the two are
 * one again.
 */
export const strokeInterline = interline;

/**
 * `FONT::GetInterline` for the face in use. `OUTLINE_FONT::GetInterline` returns
 * the metrics pitch unadjusted; only the stroke font carries the legacy factor.
 */
export function fontInterline(glyphHeight: number, face?: string): number {
  return isStrokeFont(face) ? interline(glyphHeight) : metricsInterline(glyphHeight);
}

/**
 * `FONT::StringBoundaryLimits` for one line.
 *
 * The glyph-run box comes from `STROKE_FONT::GetTextAsGlyphs`, whose end x is
 * `cursor.x - KiROUND( glyphSize.x * INTER_CHAR )` with `INTER_CHAR = 0.2`:
 * every Newstroke advance carries a trailing side bearing, and the box trims
 * the last one. Its height is the nominal glyph height, not the ink extent.
 *
 * A stroke font is then inflated by `KiROUND( thickness * 1.5 )` on every side
 * "to catch diacriticals, descenders, etc."; an outline font is not, because
 * its thickness is built into the outline.
 *
 * Italic does *not* widen this. `GetTextAsGlyphs` applies the tilt when it
 * transforms glyphs, but derives the box from the cursor, so the shear shows up
 * only as `GetTextBox`'s justification `italicOffset`.
 */
export function stringBoundaryLimits(
  text: string,
  attrs: TextBoxAttrs,
  thickness: number,
): TextSize {
  const style: TextStyle = { face: attrs.face, bold: attrs.bold, italic: attrs.italic };
  // Advances scale with the glyph box *width* (GetTextAsGlyphs multiplies each
  // glyph extent by glyphSize.x); the single-scale measurer takes that as its
  // size argument, exactly as fieldbox.ts does for schematic fields.
  const advance = textWidth(text, attrs.size.x, style);

  // An empty run never reaches GetTextAsGlyphs, so its box stays at zero and
  // only the inflate below gives it any size at all.
  let x = text === '' ? 0 : advance - kiRound(attrs.size.x * 0.2);
  let y = text === '' ? 0 : attrs.size.y;

  if (isStrokeFont(attrs.face)) {
    const inflate = kiRound(thickness * 1.5);
    x += 2 * inflate;
    y += 2 * inflate;
  }

  return { x, y };
}

/**
 * `EDA_TEXT::GetTextBox( aSettings = nullptr, aLine = -1 )`: the axis-aligned
 * box of `text` anchored at `pos`, before any rotation.
 *
 * `aLine < 0` is upstream's "all lines" signal, which is what every bounding
 * box and hit test asks for; a per-line box is not modelled here because
 * nothing on the board wants one.
 */
export function textBox(
  text: string,
  pos: { x: number; y: number },
  attrs: TextBoxAttrs,
): TextBox2 {
  const thickness = effectiveTextPenWidth(attrs);
  const multiline = attrs.multiline ?? true;
  const lines = multiline ? splitTextLines(text) : [text];
  const first = lines[0] ?? '';

  const extents = stringBoundaryLimits(first, attrs, thickness);
  const textsize = { x: extents.x, y: extents.y };

  // A stroke font's box is grown 17 % to cover descenders; an outline font's
  // ascent/descent already does.
  const fudgeFactor = kiRound(extents.y * 0.17);
  if (isStrokeFont(attrs.face)) textsize.y += fudgeFactor;

  // `~{` opens an overbar, which sits above the cap height. Upstream tests this
  // *before* its multi-line loop reassigns `text`, so only the first line
  // counts — an overbar on line 2 alone does not grow the box.
  const overbarOffset = first.includes('~{') ? Math.trunc(extents.y / 6) : 0;

  if (multiline && lines.length > 1) {
    for (let i = 1; i < lines.length; i++)
      textsize.x = Math.max(textsize.x, stringBoundaryLimits(lines[i]!, attrs, thickness).x);
    // Interline spacing is only *between* lines: the first line's full height
    // plus one interline for each line after it.
    textsize.y += kiRound((lines.length - 1) * fontInterline(attrs.size.y, attrs.face));
  }

  textsize.y += overbarOffset;

  const box: TextBox2 = { x: pos.x, y: pos.y, w: textsize.x, h: textsize.y };

  const italicOffset = attrs.italic ? kiRound(attrs.size.y * ITALIC_TILT) : 0;

  switch (attrs.hJustify ?? 'center') {
    case 'left':
      if (attrs.mirrored) box.x -= box.w - italicOffset;
      break;
    case 'center':
      box.x -= Math.trunc((box.w - italicOffset) / 2);
      break;
    case 'right':
      if (!attrs.mirrored) box.x -= box.w - italicOffset;
      break;
  }

  switch (attrs.vJustify ?? 'center') {
    case 'top':
      box.y -= fudgeFactor;
      break;
    case 'center':
      box.y -= Math.trunc(box.h / 2);
      break;
    case 'bottom':
      box.y -= box.h;
      box.y += fudgeFactor;
      break;
  }

  return box;
}
