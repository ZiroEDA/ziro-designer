// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `OPENGL_GAL::BitmapText`: pad numbers and net names, laid out from the atlas.
 *
 * KiCad draws board text two different ways and the difference is visible. Item
 * text — silkscreen, fab, dimensions — is stroked from the Newstroke font, so it
 * thickens with the pen the painter sets. Pad numbers, pad net names, via net
 * names and track net names are `m_gal->BitmapText()`, which on the OpenGL GAL
 * samples a signed-distance atlas and **ignores `SetLineWidth` and
 * `SetFontBold` entirely** (`opengl_gal.cpp`). So `draw(PAD)`'s
 * `SetLineWidth( namesize.x / 6.0 )` and `SetFontBold( true )` change nothing on
 * screen, and honouring them with a stroke font — which is what we did — draws
 * those labels at roughly twice pcbnew's weight. A ground pad reads as a white
 * blob with the copper barely showing.
 *
 * This is the layout half of the real thing: the pure geometry, no GL and no
 * DOM, so it can be checked against the C++ line by line in a unit test. The
 * drawing half is the glyph run in `scene.ts` and the MSDF program in
 * `shaders.ts`.
 *
 * Everything is in **glyph space** until the final transform, exactly as the
 * C++ is: the vertex manager is translated, rotated and scaled once, and each
 * character then walks a pen along x. Glyph space has y increasing **downward**,
 * matching both GAL's board coordinates and ours, which is why a glyph's quad
 * runs from the text top at y=0 to its baseline at y=H.
 */
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  FIRST_CODEPOINT,
  FONT_MAX_Y,
  FONT_SMOOTH_PIXELS,
  GLYPH_STRIDE,
  GLYPHS,
  LAST_CODEPOINT,
} from './bitmap_font.js';

/** Field offsets within a {@link GLYPHS} record. */
const ATLAS_X = 0;
const ATLAS_Y = 1;
const ATLAS_W = 2;
const ATLAS_H = 3;
const MIN_X = 4;
const MIN_Y = 5;
const MAX_Y = 6;
const ADVANCE = 7;

/**
 * Index of `aChar` in {@link GLYPHS}, or of `'?'` when the atlas has no entry —
 * which is what `drawBitmapChar` substitutes ("happens for many esoteric unicode
 * chars"). We ship printable ASCII only, so this is also the fallback for the
 * whole of the rest of Unicode.
 */
export function glyphIndex(codePoint: number): number {
  const cp =
    codePoint >= FIRST_CODEPOINT && codePoint <= LAST_CODEPOINT ? codePoint : '?'.codePointAt(0)!;
  return (cp - FIRST_CODEPOINT) * GLYPH_STRIDE;
}

/** `LookupGlyph( '(' )` — `computeBitmapTextSize`'s stand-in for a strange char. */
const DEFAULT_GLYPH = glyphIndex('('.codePointAt(0)!);

/** `LookupGlyph( 'x' )`, whose advance sets the width of a space. */
const X_GLYPH = glyphIndex('x'.codePointAt(0)!);

/** What one string occupies in glyph space, and where its top sits. */
export interface BitmapTextSize {
  /** Sum of the advances. */
  width: number;
  /** Cap height, less {@link BitmapTextSize.commonOffset}. */
  height: number;
  /** How far the tallest glyph's top falls below the font's `max_y`. */
  commonOffset: number;
}

/**
 * `OPENGL_GAL::computeBitmapTextSize`.
 *
 * The height does not depend on the string: it is the default glyph's full
 * extent, so a line of "1" is as tall as a line of "Ag" and a row of pad numbers
 * shares one baseline. `-` and `_` are measured as the default glyph too — the
 * C++ calls their real metrics "strange size of these 2 chars" — which matters
 * here because via layer pairs are spelled "1-4".
 *
 * Overbar markup (`~{...}`) is not handled: `BitmapText` falls back to the
 * stroke font for `^{`, `_{` and newlines, and no net name we lay out here
 * carries any of them.
 */
export function bitmapTextSize(text: string): BitmapTextSize {
  const charHeight = FONT_MAX_Y - GLYPHS[DEFAULT_GLYPH + MIN_Y]!;
  const commonOffset = FONT_MAX_Y - GLYPHS[DEFAULT_GLYPH + MAX_Y]!;
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const inAtlas = cp >= FIRST_CODEPOINT && cp <= LAST_CODEPOINT;
    const g = !inAtlas || ch === '-' || ch === '_' ? DEFAULT_GLYPH : glyphIndex(cp);
    width += GLYPHS[g + ADVANCE]!;
  }
  return { width, height: charHeight - commonOffset, commonOffset };
}

/**
 * One glyph quad, in world units, as the four corners of a (possibly rotated)
 * rectangle plus its atlas window.
 *
 * Passed as loose numbers rather than an object because a dense board lays out a
 * few thousand of these per frame and the allocations showed up.
 */
export type GlyphQuadSink = (
  /** v0, the glyph box's top-left in glyph space. */
  x0: number,
  y0: number,
  /** v1, top-right. */
  x1: number,
  y1: number,
  /** v2, bottom-left. */
  x2: number,
  y2: number,
  /** v3, bottom-right. */
  x3: number,
  y3: number,
  /** Atlas window, already in texture coordinates. */
  u0: number,
  v0: number,
  u1: number,
  v1: number,
) => void;

/** How a run of bitmap text is placed. Both justifications are always CENTER in
 *  `pcb_painter.cpp`, but the other cases are one term each and cost nothing. */
export interface BitmapTextPlacement {
  /** Anchor, world units. */
  x: number;
  y: number;
  /** Degrees, positive counter-clockwise — `EDA_ANGLE` as the painter passes it. */
  angle: number;
  /** `GetGlyphSize().y`. The x component is ignored, as it is in the C++. */
  glyphSize: number;
  hAlign?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'center' | 'bottom';
  /** Mirror horizontally, for a view of the board from the back. */
  flipX?: boolean;
}

/**
 * Lay `text` out and hand each glyph's quad to `emit`.
 *
 * The transform chain is `BitmapText`'s, in its order: translate to the anchor,
 * rotate about -Z, scale uniformly, then shift by the common offset and the
 * justification. Because those last two are pure translations in glyph space
 * they collapse into one origin, which is all this needs to carry.
 *
 * `SCALE = 1.4 * glyphSize / textSize.y` is the whole reason the atlas can be
 * repacked freely: the size on screen comes from the *metrics*, not from how
 * many texels the glyph happens to occupy.
 */
export function layoutBitmapText(
  text: string,
  place: BitmapTextPlacement,
  emit: GlyphQuadSink,
): void {
  if (text === '') return;
  const size = bitmapTextSize(text);
  if (size.height <= 0) return;
  const scale = (1.4 * place.glyphSize) / size.height;

  // `Rotate( angle, 0, 0, -1 )` — about the negative Z axis, so a positive
  // EDA_ANGLE turns the other way from the usual 2D convention.
  const rad = (-place.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = scale * (place.flipX ? -1 : 1);
  const sy = scale;

  const hAlign = place.hAlign ?? 'center';
  const vAlign = place.vAlign ?? 'center';
  const originX = hAlign === 'left' ? 0 : hAlign === 'right' ? -size.width : -size.width / 2;
  // Every case starts from `Translate( 0, -commonOffset )`; the vertical
  // justification then adds its own term.
  const originY =
    -size.commonOffset +
    (vAlign === 'top' ? 0 : vAlign === 'bottom' ? -size.height : -size.height / 2);

  // Glyph space to world, as one affine map.
  const toWorldX = (gx: number, gy: number): number =>
    place.x + (gx + originX) * sx * cos - (gy + originY) * sy * sin;
  const toWorldY = (gx: number, gy: number): number =>
    place.y + (gx + originX) * sx * sin + (gy + originY) * sy * cos;

  let pen = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 32) {
      // "Match stroke font as well as possible" — a space is 0.74 of an 'x'.
      pen += GLYPHS[X_GLYPH + ADVANCE]! * 0.74;
      continue;
    }
    const g = glyphIndex(cp);
    const atlasX = GLYPHS[g + ATLAS_X]!;
    const atlasY = GLYPHS[g + ATLAS_Y]!;
    const atlasW = GLYPHS[g + ATLAS_W]!;
    const atlasH = GLYPHS[g + ATLAS_H]!;

    // The atlas pads every glyph by `smooth_pixels` on each side so the distance
    // field has somewhere to ramp; the quad covers the glyph without the pad.
    const X = atlasX + FONT_SMOOTH_PIXELS;
    const Y = atlasY + FONT_SMOOTH_PIXELS;
    const W = atlasW - FONT_SMOOTH_PIXELS * 2;
    const H = atlasH - FONT_SMOOTH_PIXELS * 2;

    // The glyph's box was rounded to whole texels when the atlas was baked, so
    // its height on screen is off by the rounding; `round_adjust` puts the
    // baseline back, and `top_adjust` drops the glyph from the text top to its
    // own. Both are in the metrics' units, which is why they can be added to a
    // texel count at all.
    const roundAdjust = GLYPHS[g + MAX_Y]! - GLYPHS[g + MIN_Y]! - H;
    const topAdjust = FONT_MAX_Y - GLYPHS[g + MAX_Y]!;
    const xoff = pen + GLYPHS[g + MIN_X]!;
    const yoff = roundAdjust + topAdjust;

    emit(
      toWorldX(xoff, yoff),
      toWorldY(xoff, yoff),
      toWorldX(xoff + W, yoff),
      toWorldY(xoff + W, yoff),
      toWorldX(xoff, yoff + H),
      toWorldY(xoff, yoff + H),
      toWorldX(xoff + W, yoff + H),
      toWorldY(xoff + W, yoff + H),
      X / ATLAS_WIDTH,
      (Y + H) / ATLAS_HEIGHT,
      (X + W) / ATLAS_WIDTH,
      Y / ATLAS_HEIGHT,
    );
    pen += GLYPHS[g + ADVANCE]!;
  }
}

/**
 * The world-space height one run of bitmap text occupies.
 *
 * `1.4 * glyphSize` by construction — the scale is chosen to make it so — but
 * spelled out because the visibility gates want to ask "how many pixels tall
 * will this be" without laying it out.
 */
export function bitmapTextHeight(glyphSize: number): number {
  return 1.4 * glyphSize;
}
