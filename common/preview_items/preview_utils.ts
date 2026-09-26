// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/preview_items/preview_utils.cpp` — the text every drawing assistant
 * puts beside the cursor, and the constant-on-screen metrics it is written at.
 *
 * Upstream has one of each of these and four callers: `RULER_ITEM`,
 * `TWO_POINT_ASSISTANT` (the line, rectangle and circle tools),
 * `ARC_ASSISTANT` and `BEZIER_ASSISTANT`. Ours had them inlined in
 * `ruler_item.ts`, which is why the shape tools had no readout at all — the
 * measurement text is not the ruler's, it is every tool's.
 *
 * ### Everything here is a SCREEN size
 *
 * `GetConstantGlyphHeight` divides by `GetWorldScale()` so the text does not
 * grow with the zoom. Drawing in device space is how that stays exact, and it
 * is why every function below returns pixels rather than internal units.
 */

import { brightness, COLOR4D_BLACK, COLOR4D_WHITE, type Color4d } from '../color4d.js';
import { type EdaIuScale, type EdaUnits, toUserUnit, unitLabelText } from '../eda_units.js';
import { FONT } from '../font/font.js';
import { METRICS } from '../font/font_metrics.js';
import { GR_TEXT_H_ALIGN_T, TEXT_ATTRIBUTES } from '../font/text_attributes.js';
import {
  type GAL,
  GAL_SCOPED_ATTRS,
  GAL_SCOPED_ATTRS_FLAGS,
} from '../gal/graphics_abstraction_layer.js';
import { GAL_LAYER_ID } from '../layer_id.js';
import type { VIEW } from '../view/view.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

/** The units a preview label can be written in, as `EDA_UNITS` distinguishes them. */
export type PreviewUnits = 'mm' | 'in' | 'mils';

/**
 * `DimensionLabel`'s precision table (`preview_utils.cpp:44-61`), deliberately
 * coarser than the status bar's: "show a sane precision for the preview, which
 * doesn't need to be accurate down to the nanometre".
 */
// [data] EDA_UNITS::MM "%.3f" (1um), INCH "%.4f" (0.1mil), MILS "%.1f" (0.1mil),
// DEGREES "%.1f" (0.1deg).
const DECIMALS: Record<PreviewUnits, number> = { mm: 3, in: 4, mils: 1 };
const DEGREE_DECIMALS = 1;
const UNIT_SUFFIX: Record<PreviewUnits, string> = { mm: ' mm', in: '"', mils: ' mils' };

/** `EDA_UNIT_UTILS::UI::ToUserUnit`, for the three distance units a frame offers. */
export function fromIU(iu: number, iuPerMm: number, units: PreviewUnits): number {
  const mm = iu / iuPerMm;
  if (units === 'mm') return mm;
  if (units === 'in') return mm / 25.4;
  return (mm / 25.4) * 1000;
}

/**
 * `DimensionLabel( prefix, val, iuScale, units )` — `"<prefix>: <value><unit>"`
 * (`preview_utils.cpp:33-69`), for a length in internal units.
 */
export function dimensionLabel(
  prefix: string,
  valueIU: number,
  iuPerMm: number,
  units: PreviewUnits,
): string {
  const v = fromIU(valueIU, iuPerMm, units).toFixed(DECIMALS[units]);
  return `${prefix}: ${v}${UNIT_SUFFIX[units]}`;
}

/**
 * `DimensionLabel( "", val, iuScale, units, false )` — the value alone, with no
 * prefix and no unit suffix. The ruler's graduation numbers.
 */
export function bareDimensionValue(valueIU: number, iuPerMm: number, units: PreviewUnits): string {
  return fromIU(valueIU, iuPerMm, units).toFixed(DECIMALS[units]);
}

/**
 * The same, for `EDA_UNITS::DEGREES`: `%.1f` and a degree sign, and no IU
 * conversion because the caller already holds `EDA_ANGLE::AsDegrees()`.
 */
export function angleLabel(prefix: string, degrees: number): string {
  return `${prefix}: ${degrees.toFixed(DEGREE_DECIMALS)}°`;
}

/**
 * `PreviewOverlayDeemphAlpha( aDeemph )` (`preview_utils.cpp:27-30`) — 0.5 for
 * a de-emphasised line, 1.0 otherwise. `DRAW_CONTEXT` puts every line it draws
 * through it, which is how the arc assistant dims the radius you have already
 * committed.
 */
export function previewOverlayDeemphAlpha(deemph: boolean): number {
  return deemph ? 0.5 : 1.0;
}

/**
 * The face the preview text is drawn in.
 *
 * Upstream uses `KIFONT::FONT::GetFont()`, the stroke font. A monospace stack
 * is the nearest a 2D canvas has: the readout is a column of numbers that
 * jitters if the digits are proportional.
 */
export const PREVIEW_FONT = 'ui-monospace, monospace';

/**
 * `GetConstantGlyphHeight` (`preview_utils.cpp:75-108`):
 *
 *     constexpr double hdpiSizes[] = { 7,  8,  9,  11,  13, 14, 16 };
 *     constexpr double sizes[]     = { 8, 10, 12,  14,  15, 16, 18 };
 *     height = <table>[ 3 + aRelativeSize ];
 *
 * The HiDPI table is taken when `HIDPI_GL_CANVAS::GetScaleFactor() > 1`, which
 * is the device pixel ratio. The height is a SCREEN size — upstream divides it
 * by the world scale so the text never grows with zoom — so these are logical
 * pixels and a caller in device space multiplies by the ratio itself.
 */
export function constantGlyphHeightPx(devicePixelRatio: number, relativeSize = 0): number {
  // [data] `preview_utils.cpp:79-80`, the two tables verbatim.
  const hdpi = [7, 8, 9, 11, 13, 14, 16];
  const std = [8, 10, 12, 14, 15, 16, 18];
  const i = 3 + relativeSize;
  return devicePixelRatio > 1 ? hdpi[i]! : std[i]!;
}

/**
 * `StrokeWidth = height * thicknessFactor` — 0.15 HiDPI, else 0.20
 * (`preview_utils.cpp:88-99`). It is what makes preview text read bold: a
 * 14-unit glyph is stroked 2.8 wide.
 */
export function constantStrokeWidthPx(devicePixelRatio: number, relativeSize = 0): number {
  const f = devicePixelRatio > 1 ? 0.15 : 0.2;
  return constantGlyphHeightPx(devicePixelRatio, relativeSize) * f;
}

/** `linePitchFactor`, the other half of the same branch: 1.7 HiDPI, else 1.9. */
export function constantLinePitchPx(devicePixelRatio: number, relativeSize = 0): number {
  const f = devicePixelRatio > 1 ? 1.7 : 1.9;
  return constantGlyphHeightPx(devicePixelRatio, relativeSize) * f;
}

/**
 * The CSS `font-size` whose cap height is `targetPx`.
 *
 * KiCad's `TEXT_DIMS::GlyphSize` is the stroke font's glyph HEIGHT — the height
 * of a capital — while CSS `font-size` is the em box, which is always larger.
 * Setting one as the other draws the preview text about a third too small.
 *
 * Measured rather than assumed: the ratio differs per face, and the fallback
 * chain here can resolve to whatever the platform has. `actualBoundingBoxAscent`
 * of a digit is that cap height.
 */
const capRatioCache = new Map<string, number>();
export function cssSizeForGlyphHeight(ctx: CanvasRenderingContext2D, targetPx: number): number {
  const face = PREVIEW_FONT;
  let ratio = capRatioCache.get(face);
  if (ratio === undefined) {
    const probe = 100;
    const saved = ctx.font;
    ctx.font = `${probe}px ${face}`;
    const m = ctx.measureText('0');
    const asc = m.actualBoundingBoxAscent;
    ratio = asc > 0 ? asc / probe : 0.72;
    capRatioCache.set(face, ratio);
    ctx.font = saved;
  }
  return targetPx / ratio;
}

/**
 * `textPos.x += 15.0 / gal->GetWorldScale()` — "enough to keep clear of a
 * system cursor if present" (`preview_utils.cpp:155, 163`).
 */
export const CURSOR_TEXT_OFFSET_PX = 15;

export interface TextNextToCursorOptions {
  /** The cursor, in DEVICE pixels. */
  cursor: { x: number; y: number };
  /**
   * `aTextQuadrant`, the direction the block is pushed away from — only the
   * SIGN of each component is read.
   *
   * Give it in device space. Upstream compensates for a flipped view by
   * swapping the horizontal alignment (`gal->IsFlippedX()`); a device-space
   * direction has the flip in it already, which is the same answer without the
   * special case.
   */
  quadrant: { x: number; y: number };
  /** Drawn top to bottom, in the order given. */
  strings: readonly string[];
  /** `GetLayerColor( LAYER_AUX_ITEMS )` — the item carries no colour of its own. */
  color: string;
  devicePixelRatio: number;
}

/**
 * `DrawTextNextToCursor` (`preview_utils.cpp:123-202`).
 *
 * The two placement rules are easy to get backwards, and ours had both of them
 * that way before this was shared:
 *
 * - `aTextQuadrant.y > 0` shifts the block UP by `LinePitch * ( n + 1 )`, and
 *   the draw loop then adds one pitch *before* each line — so the block sits
 *   one pitch below the cursor when it goes down, and ends one pitch above it
 *   when it goes up. The vertical offset is a line pitch, never the 15 px.
 * - `aTextQuadrant.x < 0` LEFT-aligns and moves right by 15 px. The 15 px is
 *   horizontal only.
 *
 * Drop shadows are not ported: they exist so the stroke font stays legible
 * over a busy board, and a 2D canvas gets that from the fill+stroke pair below.
 */
export function drawTextNextToCursor(
  ctx: CanvasRenderingContext2D,
  o: TextNextToCursorOptions,
): void {
  if (o.strings.length === 0) return;

  const dpr = o.devicePixelRatio;
  const pitch = constantLinePitchPx(dpr) * dpr;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${cssSizeForGlyphHeight(ctx, constantGlyphHeightPx(dpr) * dpr)}px ${PREVIEW_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  // A stroke font at thicknessFactor 0.2 reads bold; fill plus a stroke of half
  // that width is the same weight on a 2D context.
  ctx.lineWidth = constantStrokeWidthPx(dpr) * dpr * 0.5;
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  let y = o.cursor.y;
  if (o.quadrant.y > 0) y -= pitch * (o.strings.length + 1);

  let x = o.cursor.x;
  if (o.quadrant.x < 0) {
    ctx.textAlign = 'left';
    x += CURSOR_TEXT_OFFSET_PX * dpr;
  } else {
    ctx.textAlign = 'right';
    x -= CURSOR_TEXT_OFFSET_PX * dpr;
  }

  // "write strings top-to-bottom" — the pitch is added BEFORE each line.
  for (const s of o.strings) {
    y += pitch;
    ctx.fillText(s, x, y);
    ctx.strokeText(s, x, y);
  }

  ctx.restore();
}

// ---- the GAL half (preview_utils.cpp:27-202) ---------------------------------

/** `struct TEXT_DIMS`. */
export interface TEXT_DIMS {
  GlyphSize: VECTOR2I;
  StrokeWidth: number;
  ShadowWidth: number;
  LinePitch: number;
}

/**
 * Get a formatted string showing a dimension to a sane precision with an
 * optional prefix and unit suffix.
 */
export function DimensionLabel(
  prefix: string,
  aVal: number,
  aIuScale: EdaIuScale,
  aUnits: EdaUnits,
  aIncludeUnits = true,
): string {
  let str = '';

  if (prefix.length) str += `${prefix}: `;

  // show a sane precision for the preview, which doesn't need to be accurate down to the
  // nanometre
  const v = toUserUnit(aIuScale, aUnits, aVal);

  switch (aUnits) {
    case 'um':
      str += v.toFixed(0);
      break; // 1um
    case 'mm':
      str += v.toFixed(3);
      break; // 1um
    case 'cm':
      str += v.toFixed(4);
      break; // 1um
    case 'mils':
      str += v.toFixed(1);
      break; // 0.1mil
    case 'in':
      str += v.toFixed(4);
      break; // 0.1mil
    case 'degrees':
      str += v.toFixed(1);
      break; // 0.1deg
    case 'percent':
      str += v.toFixed(1);
      break; // 0.1%
    case 'fs':
      str += v.toFixed(4);
      break; // 0.0001ps
    case 'ps':
    case 'ps/in':
    case 'ps/cm':
    case 'ps/mm':
      str += v.toFixed(3);
      break;
    case 'unscaled':
      str += v.toFixed(6);
      break;
  }

  if (aIncludeUnits) str += unitLabelText(aUnits);

  return str;
}

/**
 * Set the GAL glyph height to a constant scaled value, so that it always looks the same
 * on screen.
 *
 * @param aGal the GAL to draw on.
 * @param aRelativeSize similar to HTML font sizes; 0 will give a standard size while +1
 *                      etc. will size up and -1 etc. will size down.
 * @return the text widths for the resulting glyph size.
 */
export function GetConstantGlyphHeight(aGal: GAL, aRelativeSize = 0): TEXT_DIMS {
  const aspectRatio = 1.0;
  const hdpiSizes = [7, 8, 9, 11, 13, 14, 16];
  const sizes = [8, 10, 12, 14, 15, 16, 18];

  let height: number;
  let thicknessFactor: number;
  let shadowFactor: number;
  let linePitchFactor: number;

  // dynamic_cast<HIDPI_GL_CANVAS*>( aGal )
  const canvas = aGal as unknown as { GetScaleFactor?: () => number };

  if (typeof canvas.GetScaleFactor === 'function' && canvas.GetScaleFactor() > 1) {
    height = hdpiSizes[3 + aRelativeSize]!;
    thicknessFactor = 0.15;
    shadowFactor = 0.1;
    linePitchFactor = 1.7;
  } else {
    height = sizes[3 + aRelativeSize]!;
    thicknessFactor = 0.2;
    shadowFactor = 0.15;
    linePitchFactor = 1.9;
  }

  height /= aGal.GetWorldScale();

  return {
    // VECTOR2I( height * aspectRatio, height ): the double truncates into the int.
    GlyphSize: { x: Math.trunc(height * aspectRatio), y: Math.trunc(height) },
    StrokeWidth: Math.trunc(height * thicknessFactor),
    ShadowWidth: Math.trunc(height * shadowFactor),
    LinePitch: height * linePitchFactor,
  };
}

/**
 * Get a contrasting colour for a shadow of the given colour.
 */
export function GetShadowColor(aColor: Color4d): Color4d {
  if (brightness(aColor) > 0.5) return COLOR4D_BLACK;

  return COLOR4D_WHITE;
}

/**
 * Draw strings next to the cursor.
 *
 * @param aGal the GAL to draw on.
 * @param aCursorPos the position of the cursor to draw next to.
 * @param aTextQuadrant a vector pointing to the quadrant to draw the text in.
 * @param aStrings list of strings to draw, top to bottom.
 */
export function DrawTextNextToCursor(
  aView: VIEW,
  aCursorPos: Vec2,
  aTextQuadrant: Vec2,
  aStrings: readonly string[],
  aDrawingDropShadows: boolean,
): void {
  const gal = aView.GetGAL()!;

  GAL_SCOPED_ATTRS(gal, GAL_SCOPED_ATTRS_FLAGS.STROKE_FILL, () => {
    const font = FONT.GetFont();

    // constant text size on screen
    const textDims = GetConstantGlyphHeight(gal);
    const textAttrs = new TEXT_ATTRIBUTES();

    // radius string goes on the right of the cursor centre line with a small horizontal
    // offset (enough to keep clear of a system cursor if present)
    const textPos = { x: aCursorPos.x, y: aCursorPos.y };

    const viewFlipped = gal.IsFlippedX();

    // if the text goes above the cursor, shift it up
    if (aTextQuadrant.y > 0) textPos.y -= textDims.LinePitch * (aStrings.length + 1);

    if (aTextQuadrant.x < 0) {
      if (viewFlipped) textAttrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
      else textAttrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;

      textPos.x += 15.0 / gal.GetWorldScale();
    } else {
      if (viewFlipped) textAttrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
      else textAttrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;

      textPos.x -= 15.0 / gal.GetWorldScale();
    }

    // text is left (or right) aligned, so a shadow text need a small offset to be draw
    // around the basic text
    let shadowXoffset = aDrawingDropShadows ? textDims.ShadowWidth : 0;

    // Due to the fact a shadow text is drawn left or right aligned,
    // it needs an offset = shadowWidth/2 to be drawn at the same place as normal text
    // But for some reason we need to slightly modify this offset
    // for a better look for KiCad font (better alignment of shadow shape)
    const adjust = 1.2; // Value chosen after tests
    shadowXoffset = Math.trunc(shadowXoffset * adjust);

    if ((textAttrs.m_Halign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT) !== viewFlipped)
      textPos.x -= shadowXoffset;
    else textPos.x += shadowXoffset;

    gal.SetStrokeColor(
      aView.GetPainter().GetSettings().GetLayerColor(GAL_LAYER_ID.LAYER_AUX_ITEMS),
    );
    textAttrs.m_Mirrored = viewFlipped; // Prevent text flipping when view is flipped
    textAttrs.m_Size = textDims.GlyphSize;
    textAttrs.m_StrokeWidth = textDims.StrokeWidth;
    gal.SetIsFill(false);
    gal.SetIsStroke(true);

    if (aDrawingDropShadows) {
      textAttrs.m_StrokeWidth = textDims.StrokeWidth + 2 * textDims.ShadowWidth;
      gal.SetStrokeColor(GetShadowColor(gal.GetStrokeColor()));
    }

    // write strings top-to-bottom
    for (const str of aStrings) {
      textPos.y += textDims.LinePitch;
      font.Draw(gal, str, textPos, { x: 0, y: 0 }, textAttrs, METRICS.Default());
    }
  });
}
