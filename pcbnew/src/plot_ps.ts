// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PS_PLOTTER, the Adobe PostScript 3.0 plot back-end, transcribed from
 * common/plotters/PS_plotter.cpp — both the PS_PLOTTER half and the
 * PSLIKE_PLOTTER half that file also carries (SetColor, SetScaleAdjust,
 * SetTextMode, encodeStringForPlotter, returnPostscriptTextWidth,
 * computeTextParameters, the Helvetica AFM width tables and the pad flashes) —
 * plus the PLOTTER base members it leans on (userToDeviceCoordinates,
 * userToDeviceSize, the Get*MarkLenIU dash lengths, the MoveTo/LineTo/FinishTo/
 * PenFinish pen wrappers, the Thick* helpers, the three-point Arc and the
 * stroke-font Text/PlotText).
 *
 * PS is the sibling of PDF under PSLIKE_PLOTTER, but the file it writes could
 * hardly be less alike: a PostScript document is a *program*, so StartPlot
 * emits a prolog of macros and every later primitive is a handful of operands
 * and a macro name. Four things carry the port.
 *
 * 1. The paint mode is baked into the macro name, not into an operator.
 *    `getFillId` maps a FILL_T onto 0/1/2 and the emitter concatenates it, so a
 *    filled circle is `cir1` and an unfilled one `cir0`. Anything that is
 *    neither NO_FILL nor FILLED_SHAPE — a hatch, a background fill — collapses
 *    onto id 2, whose macro is character-for-character the id 1 macro.
 * 2. Numbers go out as fmt's `{:g}`, six *significant* digits with trailing
 *    zeros stripped, at every call site but one: `emitSetRGBColor` uses
 *    `{:.3g}`, three significant digits, above a comment that asks why. That
 *    difference is real and observable — 0.6666666 plots as `0.666667` in a
 *    coordinate and `0.667` in a colour — so `formatG` here takes a precision
 *    where the PDF port's hard-codes six.
 * 3. The file is bytes with two encodings in it. `%%Creator` and
 *    `%%DocumentMedia` are `TO_UTF8`, while everything routed through
 *    `encodeStringForPlotter` — `%%Title`, `%%Page` and the phantom text — is
 *    written a `char` at a time from a `wchar_t`, i.e. Latin-1, after silently
 *    *dropping* every code point at or above 256. A string-then-encode
 *    implementation would quietly diverge on the first accented title.
 * 4. Only StartPlot knows the page's orientation, and it un-swaps it: PAGE_INFO
 *    already keeps m_size the right way round for the current orientation, so
 *    a landscape sheet has its width and height swapped *back* before the
 *    `%%BoundingBox` and `%%DocumentMedia` comments, and the swap is undone
 *    again at draw time by `N 0 translate 90 rotate`.
 *
 * Faithfully reproduced oddities, none of which is to be "fixed":
 * SetCurrentLineWidth's sentinel handling is an `else if` chain, so a
 * USE_DEFAULT_LINE_WIDTH that resolves to a zero default pen stays zero here
 * where PDF's separate `if` would clamp it to one — and Rect, Circle and
 * PlotPoly all test `GetCurrentLineWidth() <= 0` *after* setting the pen, so
 * that zero is exactly what silences them; `%%Pages: 1` is hard-coded however
 * many pages follow; `PlotImage` declares `/pix` as one byte per pixel of width
 * and then feeds `colorimage` three components per pixel, and its hex
 * line-break counter is never reset between rows, so the breaks drift, and its
 * alpha premultiply is done in C `float` and then *masked* with 0xFF rather
 * than clamped, so an already-bright channel wraps round to dark;
 * `computeTextParameters` hands `returnPostscriptTextWidth` the integer pen
 * width in its `bool aBold` slot, so any non-zero pen widens the estimate to
 * the bold table, and it rotates `tw`/`th` only to discard them; `PenTo` emits
 * the `newpath` that opens a plume before deciding whether the plume moved at
 * all; and `Arc` decides whether to swap its endpoints with
 * `!m_plotMirror ^ ( aAngle < ANGLE_0 )`, a bool XOR whose left half is
 * negated and whose right half is not.
 *
 * Deliberate gaps, each an injected dependency rather than an approximation:
 * the page description (`PsPageInfo`, standing in for PAGE_INFO — an unset one
 * is an error here rather than upstream's silent default-constructed A3,
 * because reproducing that default means embedding page_info.cpp's size table),
 * the raster image (`PsImage`, standing in for wxImage, with the per-pixel
 * accessors upstream actually calls) and the font (`PsFont`, standing in for
 * KIFONT::FONT, as the SVG back-end already does). `Rect` with a corner radius,
 * the SHAPE_LINE_CHAIN `PlotPoly` overload, `FlashPadRoundRect` and
 * `FlashPadCustom` all need geometry classes this repo does not have yet and
 * are absent rather than approximated.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE, ANGLE_0, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint, CalcArcCenter } from '@ziroeda/kimath/src/trigo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';

/** `FILL_T` (eda_shape.h). NO_FILL is 1, not 0 — never treat this as a boolean. */
export enum FILL_T {
  NO_FILL = 1,
  FILLED_SHAPE,
  FILLED_WITH_BG_BODYCOLOR,
  FILLED_WITH_COLOR,
  HATCH,
  REVERSE_HATCH,
  CROSS_HATCH,
}

/** `LINE_STYLE` (stroke_params.h). */
export enum LINE_STYLE {
  DEFAULT = -1,
  SOLID = 0,
  DASH,
  DOT,
  DASHDOT,
  DASHDOTDOT,
}

/**
 * `PLOT_TEXT_MODE` (plotter.h). PSLIKE_PLOTTER's constructor selects PHANTOM,
 * but PS_PLOTTER's overrides it back to STROKE, because — upstream's words —
 * "the phantom plot in postscript is an hack and reportedly crashes Adobe's own
 * postscript interpreter". A caller who wants the invisible search anchors must
 * therefore ask for PHANTOM explicitly.
 */
export enum PLOT_TEXT_MODE {
  STROKE = 0,
  NATIVE,
  PHANTOM,
  DEFAULT,
}

/**
 * `PLOTTER::DO_NOT_SET_LINE_WIDTH` / `USE_DEFAULT_LINE_WIDTH` (plotter.h:139-140).
 * Statics on the base upstream, so one declaration here, re-exported for the
 * callers that reach for them through this module.
 */
export {
  DO_NOT_SET_LINE_WIDTH,
  USE_DEFAULT_LINE_WIDTH,
} from '@ziroeda/common/src/plotters/plotter.js';

import {
  DO_NOT_SET_LINE_WIDTH,
  USE_DEFAULT_LINE_WIDTH,
} from '@ziroeda/common/src/plotters/plotter.js';

// `COLOR4D` lives in `common` because the graphics importers, shared with
// eeschema, need it too. Re-exported here so existing consumers are unaffected.
export { COLOR4D_BLACK, COLOR4D_WHITE, type Color4d } from '@ziroeda/common/src/color4d.js';
import { COLOR4D_BLACK, COLOR4D_WHITE, type Color4d } from '@ziroeda/common/src/color4d.js';

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

// `RENDER_SETTINGS` and its ISO 128-2 dash/gap ratios live in `common`: upstream
// keeps them on RENDER_SETTINGS, not on PLOTTER, and every backend asks the one
// object for a dash length. Re-exported under the names this module used.
export {
  DEFAULT_DASH_LENGTH_RATIO,
  DEFAULT_GAP_LENGTH_RATIO,
  type PlotterRenderSettings as PsRenderSettings,
  plotterRenderSettings as psRenderSettings,
} from '@ziroeda/common/src/render_settings.js';

import type { PlotterRenderSettings as PsRenderSettings } from '@ziroeda/common/src/render_settings.js';

/**
 * `PAGE_INFO`, reduced to the six accessors SetViewport and StartPlot make on
 * it. `GetSizeMils` is already orientation-corrected — PAGE_INFO::SetPortrait
 * swaps m_size — which is why StartPlot swaps it *back* for the DSC comments.
 * `GetTypeAsString` is the enumerator name, so a User sheet answers "User" and
 * StartPlot rewrites it to "Custom".
 */
export interface PsPageInfo {
  GetSizeMils(): Vec2;
  GetWidthMils(): number;
  GetHeightMils(): number;
  IsPortrait(): boolean;
  IsCustom(): boolean;
  GetTypeAsString(): string;
}

/**
 * A `PAGE_INFO` built from the numbers a caller already has. The width and
 * height accessors read the *same* stored size the plotter's swap consults, so
 * a landscape page must be handed its landscape size, exactly as PAGE_INFO
 * stores one.
 */
export function psPageInfo(aOptions: {
  sizeMils: Vec2;
  type: string;
  portrait: boolean;
  custom?: boolean;
}): PsPageInfo {
  const size = { x: aOptions.sizeMils.x, y: aOptions.sizeMils.y };
  const custom = aOptions.custom ?? aOptions.type === 'User';

  return {
    GetSizeMils: () => ({ x: size.x, y: size.y }),
    GetWidthMils: () => size.x,
    GetHeightMils: () => size.y,
    IsPortrait: () => aOptions.portrait,
    IsCustom: () => custom,
    GetTypeAsString: () => aOptions.type,
  };
}

/** The `TEXT_ATTRIBUTES` fields Text and PlotText read (text_attributes.h). */
export interface PsTextAttributes {
  m_Size: Vec2;
  m_Halign: GR_TEXT_H_ALIGN_T;
  m_Valign: GR_TEXT_V_ALIGN_T;
  m_StrokeWidth: number;
  m_Angle: EDA_ANGLE;
  m_Italic: boolean;
  m_Bold: boolean;
  m_Mirrored: boolean;
  m_Multiline: boolean;
}

/**
 * `KIFONT::FONT`, reduced to the one call the PostScript text path makes.
 * Supplied by the caller for the same reason the SVG back-end asks for one: the
 * monorepo's stroke font (common/src/font/stroke_font.ts) does not implement
 * KIFONT's contract — no justification, italic shear, rotation or bold
 * thickness — and faking those here would be a substitute, not a port.
 *
 * `Draw` stands in for `FONT::Draw` driven by a CALLBACK_GAL: it must yield the
 * glyph strokes as point pairs in IU, in draw order. The polygon callback
 * (which upstream routes to `PlotPoly( chain, FILLED_SHAPE, 0 )`) only fires
 * for outline fonts and has no analogue here.
 */
export interface PsFont {
  Draw(
    aText: string,
    aPos: Vec2,
    aAttributes: PsTextAttributes,
  ): readonly (readonly [Vec2, Vec2])[];
}

/**
 * `wxImage`, reduced to what PlotImage uses. The accessors are per pixel rather
 * than a data buffer because that is literally what upstream calls: PS_PLOTTER
 * reads `GetRed( x, y )` where PDF_PLOTTER walks `GetData()`.
 */
export interface PsImage {
  GetWidth(): number;
  GetHeight(): number;
  GetRed(x: number, y: number): number;
  GetGreen(x: number, y: number): number;
  GetBlue(x: number, y: number): number;
  HasAlpha(): boolean;
  /** Only read when HasAlpha(). */
  GetAlpha(x: number, y: number): number;
  HasMask(): boolean;
  GetMaskRed(): number;
  GetMaskGreen(): number;
  GetMaskBlue(): number;
}

// ===========================================================================
// Number formatting
// ===========================================================================

// `{fmt}`'s `{:.Nf}`. One implementation for every backend, as upstream has
// one `fmt::print`; the precision is a call-site argument, not a per-backend
// formatter. Re-exported so existing importers of this module are unaffected.
export { fixed } from '@ziroeda/common/src/plotters/fmt.js';
import { decompose, fixed, scaledRound } from '@ziroeda/common/src/plotters/fmt.js';

/**
 * `%g` and its default precision now live beside `fixed`, `decompose` and
 * `scaledRound` in `common/src/plotters/fmt.ts` — the module those three were
 * already moved to. Re-exported so this module's importers are unaffected.
 */
export { FMT_G_PRECISION, formatG } from '@ziroeda/common/src/plotters/fmt.js';
import { formatG } from '@ziroeda/common/src/plotters/fmt.js';

/** The `{:.3g}` `emitSetRGBColor` alone asks for, above a comment asking why. */
export const RGB_G_PRECISION = 3;

/** The `VECTOR2D` -> `VECTOR2I` conversion: truncate towards zero, per component. */
const toVector2I = (aVec: Vec2): Vec2 => ({
  x: Math.trunc(aVec.x),
  y: Math.trunc(aVec.y),
});

/**
 * `VECTOR2<double>::EuclideanNorm` (vector2d.h:279). kimath's exported
 * EuclideanNorm is a bare `Math.hypot`; upstream shortcuts the axis-aligned and
 * 45-degree cases first, and `|x| * sqrt(2)` is not obliged to agree with
 * `hypot(x, x)` in the last bit.
 */
function euclideanNormD(aVec: Vec2): number {
  // 45° are common in KiCad, so we can optimize the calculation
  if (Math.abs(aVec.x) === Math.abs(aVec.y)) return Math.abs(aVec.x) * Math.SQRT2;

  if (aVec.x === 0) return Math.abs(aVec.y);
  if (aVec.y === 0) return Math.abs(aVec.x);

  return Math.hypot(aVec.x, aVec.y);
}

/** `GetPenSizeForBold` (gr_text.cpp:33). */
export function GetPenSizeForBold(aTextSize: number): number {
  return KiROUND(aTextSize / 5.0);
}

// ===========================================================================
// Free functions
// ===========================================================================

/**
 * `getFillId` (PS_plotter.cpp:49). Everything that is neither NO_FILL nor
 * FILLED_SHAPE — a hatch, a background fill, a colour fill — lands on 2, and
 * the prolog's `cir2`/`arc2`/`poly2`/`rect2` are identical to their `…1`
 * siblings, so id 2 paints exactly like a plain filled shape.
 */
export function getFillId(aFill: FILL_T): number {
  if (aFill === FILL_T.NO_FILL) return 0;

  if (aFill === FILL_T.FILLED_SHAPE) return 1;

  return 2;
}

/**
 * `PSLIKE_PLOTTER::encodeStringForPlotter` (PS_plotter.cpp:227) — the base
 * version, which PS uses and PDF overrides. The result is a *byte* string
 * dressed as a JavaScript string: every code unit is in 0..255 and is written
 * to the file as one byte, i.e. Latin-1.
 *
 * Two upstream details are load bearing. Any character at or above U+0100 is
 * dropped outright — the `if( ch < 256 )` has no else — so a Cyrillic title
 * reaches the file as an empty literal rather than as mojibake. And the escape
 * arm falls through into the default arm, which is what makes `(` come out as
 * `\(` and not as a bare backslash.
 *
 * Iterating code points rather than UTF-16 units matches the Linux wxString,
 * where `aUnicode[i]` is a code point; an astral character is therefore one
 * dropped element, not two.
 */
export function encodeStringForPlotter(aUnicode: string): string {
  let converted = '(';

  for (const c of aUnicode) {
    const ch = c.codePointAt(0)!;

    if (ch < 256) {
      // These characters must be escaped
      if (ch === 0x28 || ch === 0x29 || ch === 0x5c) converted += '\\';

      converted += String.fromCharCode(ch);
    }
  }

  return `${converted})`;
}

/**
 * `ctime`, which is what `%%CreationDate` is handed verbatim — trailing newline
 * included, which is why the format string that prints it has none of its own.
 * The C locale form is `Www Mmm dd hh:mm:ss yyyy\n` with the day of the month
 * blank-padded, not zero-padded, to two columns.
 */
export function psCreationDate(aNow: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const pad = (aValue: number): string => String(aValue).padStart(2, '0');

  return (
    `${days[aNow.getDay()]} ${months[aNow.getMonth()]} ` +
    `${String(aNow.getDate()).padStart(2, ' ')} ` +
    `${pad(aNow.getHours())}:${pad(aNow.getMinutes())}:${pad(aNow.getSeconds())} ` +
    `${aNow.getFullYear()}\n`
  );
}

/**
 * `PSMacro` (PS_plotter.cpp:731), the prolog every PostScript plot opens with.
 * Byte for byte upstream's, indentation and all: the two-line `arc1`/`arc2` and
 * `textshow` definitions really are wrapped where they are, and `reencodefont`
 * really is indented two spaces where everything around it is indented four.
 */
export const PS_MACRO_PROLOG =
  '%%BeginProlog\n' +
  '/line { newpath moveto lineto stroke } bind def\n' +
  '/cir0 { newpath 0 360 arc stroke } bind def\n' +
  '/cir1 { newpath 0 360 arc gsave fill grestore stroke } bind def\n' +
  '/cir2 { newpath 0 360 arc gsave fill grestore stroke } bind def\n' +
  '/arc0 { newpath arc stroke } bind def\n' +
  '/arc1 { newpath 4 index 4 index moveto arc closepath gsave fill\n' +
  '    grestore stroke } bind def\n' +
  '/arc2 { newpath 4 index 4 index moveto arc closepath gsave fill\n' +
  '    grestore stroke } bind def\n' +
  '/poly0 { stroke } bind def\n' +
  '/poly1 { closepath gsave fill grestore stroke } bind def\n' +
  '/poly2 { closepath gsave fill grestore stroke } bind def\n' +
  '/rect0 { rectstroke } bind def\n' +
  '/rect1 { rectfill } bind def\n' +
  '/rect2 { rectfill } bind def\n' +
  '/linemode0 { 0 setlinecap 0 setlinejoin 0 setlinewidth } bind def\n' +
  '/linemode1 { 1 setlinecap 1 setlinejoin } bind def\n' +
  '/dashedline { [200] 100 setdash } bind def\n' +
  '/solidline { [] 0 setdash } bind def\n' +
  '/phantomshow { moveto\n' +
  '    /KicadFont findfont 0.000001 scalefont setfont\n' +
  '    show } bind def\n' +
  '/textshow { gsave\n' +
  '    findfont exch scalefont setfont concat 1 scale 0 0 moveto show\n' +
  '    } bind def\n' +
  '/reencodefont {\n' +
  '  findfont dup length dict begin\n' +
  '  { 1 index /FID ne\n' +
  '    { def }\n' +
  '    { pop pop } ifelse\n' +
  '  } forall\n' +
  '  /Encoding ISOLatin1Encoding def\n' +
  '  currentdict\n' +
  '  end } bind def\n' +
  '/KicadFont /Helvetica reencodefont definefont pop\n' +
  '/KicadFont-Bold /Helvetica-Bold reencodefont definefont pop\n' +
  '/KicadFont-Oblique /Helvetica-Oblique reencodefont definefont pop\n' +
  '/KicadFont-BoldOblique /Helvetica-BoldOblique reencodefont definefont pop\n' +
  '%%EndProlog\n';

/** `PSLIKE_PLOTTER::postscriptTextAscent`: the Helvetica AFM ascent. */
export const POSTSCRIPT_TEXT_ASCENT = 0.718;

/** `BIGPTsPERMIL`: big points (1/72 inch) per mil. */
const BIGPTsPERMIL = 0.072;

const TEXT_ENCODER = new TextEncoder();

// ===========================================================================
// Helvetica AFM character widths (PS_plotter.cpp:951 onwards)
// ===========================================================================

/** Character widths for Helvetica, as fractions of the em (Adobe AFM). */
const hv_widths: readonly number[] = [
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.355, 0.556, 0.556, 0.889, 0.667, 0.191, 0.333, 0.333,
  0.389, 0.584, 0.278, 0.333, 0.278, 0.278, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556,
  0.556, 0.556, 0.278, 0.278, 0.584, 0.584, 0.584, 0.556, 1.015, 0.667, 0.667, 0.722, 0.722, 0.667,
  0.611, 0.778, 0.722, 0.278, 0.5, 0.667, 0.556, 0.833, 0.722, 0.778, 0.667, 0.778, 0.722, 0.667,
  0.611, 0.722, 0.667, 0.944, 0.667, 0.667, 0.611, 0.278, 0.278, 0.278, 0.469, 0.556, 0.333, 0.556,
  0.556, 0.5, 0.556, 0.556, 0.278, 0.556, 0.556, 0.222, 0.222, 0.5, 0.222, 0.833, 0.556, 0.556,
  0.556, 0.556, 0.333, 0.5, 0.278, 0.556, 0.5, 0.722, 0.5, 0.5, 0.5, 0.334, 0.26, 0.334, 0.584,
  0.278, 0.278, 0.278, 0.222, 0.556, 0.333, 1.0, 0.556, 0.556, 0.333, 1.0, 0.667, 0.333, 1.0, 0.278,
  0.278, 0.278, 0.278, 0.222, 0.222, 0.333, 0.333, 0.35, 0.556, 1.0, 0.333, 1.0, 0.5, 0.333, 0.944,
  0.278, 0.278, 0.667, 0.278, 0.333, 0.556, 0.556, 0.556, 0.556, 0.26, 0.556, 0.333, 0.737, 0.37,
  0.556, 0.584, 0.333, 0.737, 0.333, 0.4, 0.584, 0.333, 0.333, 0.333, 0.556, 0.537, 0.278, 0.333,
  0.333, 0.365, 0.556, 0.834, 0.834, 0.834, 0.611, 0.667, 0.667, 0.667, 0.667, 0.667, 0.667, 1.0,
  0.722, 0.667, 0.667, 0.667, 0.667, 0.278, 0.278, 0.278, 0.278, 0.722, 0.722, 0.778, 0.778, 0.778,
  0.778, 0.778, 0.584, 0.778, 0.722, 0.722, 0.722, 0.722, 0.667, 0.667, 0.611, 0.556, 0.556, 0.556,
  0.556, 0.556, 0.556, 0.889, 0.5, 0.556, 0.556, 0.556, 0.556, 0.278, 0.278, 0.278, 0.278, 0.556,
  0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.584, 0.611, 0.556, 0.556, 0.556, 0.556, 0.5, 0.556,
  0.5,
];

/** Character widths for Helvetica-Bold. */
const hvb_widths: readonly number[] = [
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.333, 0.474, 0.556, 0.556, 0.889, 0.722, 0.238, 0.333, 0.333,
  0.389, 0.584, 0.278, 0.333, 0.278, 0.278, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556,
  0.556, 0.556, 0.333, 0.333, 0.584, 0.584, 0.584, 0.611, 0.975, 0.722, 0.722, 0.722, 0.722, 0.667,
  0.611, 0.778, 0.722, 0.278, 0.556, 0.722, 0.611, 0.833, 0.722, 0.778, 0.667, 0.778, 0.722, 0.667,
  0.611, 0.722, 0.667, 0.944, 0.667, 0.667, 0.611, 0.333, 0.278, 0.333, 0.584, 0.556, 0.333, 0.556,
  0.611, 0.556, 0.611, 0.556, 0.333, 0.611, 0.611, 0.278, 0.278, 0.556, 0.278, 0.889, 0.611, 0.611,
  0.611, 0.611, 0.389, 0.556, 0.333, 0.611, 0.556, 0.778, 0.556, 0.556, 0.5, 0.389, 0.28, 0.389,
  0.584, 0.278, 0.278, 0.278, 0.278, 0.556, 0.5, 1.0, 0.556, 0.556, 0.333, 1.0, 0.667, 0.333, 1.0,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.5, 0.5, 0.35, 0.556, 1.0, 0.333, 1.0, 0.556, 0.333,
  0.944, 0.278, 0.278, 0.667, 0.278, 0.333, 0.556, 0.556, 0.556, 0.556, 0.28, 0.556, 0.333, 0.737,
  0.37, 0.556, 0.584, 0.333, 0.737, 0.333, 0.4, 0.584, 0.333, 0.333, 0.333, 0.611, 0.556, 0.278,
  0.333, 0.333, 0.365, 0.556, 0.834, 0.834, 0.834, 0.611, 0.722, 0.722, 0.722, 0.722, 0.722, 0.722,
  1.0, 0.722, 0.667, 0.667, 0.667, 0.667, 0.278, 0.278, 0.278, 0.278, 0.722, 0.722, 0.778, 0.778,
  0.778, 0.778, 0.778, 0.584, 0.778, 0.722, 0.722, 0.722, 0.722, 0.667, 0.667, 0.611, 0.556, 0.556,
  0.556, 0.556, 0.556, 0.556, 0.889, 0.556, 0.556, 0.556, 0.556, 0.556, 0.278, 0.278, 0.278, 0.278,
  0.611, 0.611, 0.611, 0.611, 0.611, 0.611, 0.611, 0.584, 0.611, 0.611, 0.611, 0.611, 0.611, 0.556,
  0.611, 0.556,
];

/** Character widths for Helvetica-Oblique. Identical to hv_widths — an
 * oblique face is a shear, so it shares its upright metrics. */
const hvo_widths: readonly number[] = [
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.355, 0.556, 0.556, 0.889, 0.667, 0.191, 0.333, 0.333,
  0.389, 0.584, 0.278, 0.333, 0.278, 0.278, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556,
  0.556, 0.556, 0.278, 0.278, 0.584, 0.584, 0.584, 0.556, 1.015, 0.667, 0.667, 0.722, 0.722, 0.667,
  0.611, 0.778, 0.722, 0.278, 0.5, 0.667, 0.556, 0.833, 0.722, 0.778, 0.667, 0.778, 0.722, 0.667,
  0.611, 0.722, 0.667, 0.944, 0.667, 0.667, 0.611, 0.278, 0.278, 0.278, 0.469, 0.556, 0.333, 0.556,
  0.556, 0.5, 0.556, 0.556, 0.278, 0.556, 0.556, 0.222, 0.222, 0.5, 0.222, 0.833, 0.556, 0.556,
  0.556, 0.556, 0.333, 0.5, 0.278, 0.556, 0.5, 0.722, 0.5, 0.5, 0.5, 0.334, 0.26, 0.334, 0.584,
  0.278, 0.278, 0.278, 0.222, 0.556, 0.333, 1.0, 0.556, 0.556, 0.333, 1.0, 0.667, 0.333, 1.0, 0.278,
  0.278, 0.278, 0.278, 0.222, 0.222, 0.333, 0.333, 0.35, 0.556, 1.0, 0.333, 1.0, 0.5, 0.333, 0.944,
  0.278, 0.278, 0.667, 0.278, 0.333, 0.556, 0.556, 0.556, 0.556, 0.26, 0.556, 0.333, 0.737, 0.37,
  0.556, 0.584, 0.333, 0.737, 0.333, 0.4, 0.584, 0.333, 0.333, 0.333, 0.556, 0.537, 0.278, 0.333,
  0.333, 0.365, 0.556, 0.834, 0.834, 0.834, 0.611, 0.667, 0.667, 0.667, 0.667, 0.667, 0.667, 1.0,
  0.722, 0.667, 0.667, 0.667, 0.667, 0.278, 0.278, 0.278, 0.278, 0.722, 0.722, 0.778, 0.778, 0.778,
  0.778, 0.778, 0.584, 0.778, 0.722, 0.722, 0.722, 0.722, 0.667, 0.667, 0.611, 0.556, 0.556, 0.556,
  0.556, 0.556, 0.556, 0.889, 0.5, 0.556, 0.556, 0.556, 0.556, 0.278, 0.278, 0.278, 0.278, 0.556,
  0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.584, 0.611, 0.556, 0.556, 0.556, 0.556, 0.5, 0.556,
  0.5,
];

/** Character widths for Helvetica-BoldOblique. Identical to hvb_widths. */
const hvbo_widths: readonly number[] = [
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.278,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.333, 0.474, 0.556, 0.556, 0.889, 0.722, 0.238, 0.333, 0.333,
  0.389, 0.584, 0.278, 0.333, 0.278, 0.278, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556,
  0.556, 0.556, 0.333, 0.333, 0.584, 0.584, 0.584, 0.611, 0.975, 0.722, 0.722, 0.722, 0.722, 0.667,
  0.611, 0.778, 0.722, 0.278, 0.556, 0.722, 0.611, 0.833, 0.722, 0.778, 0.667, 0.778, 0.722, 0.667,
  0.611, 0.722, 0.667, 0.944, 0.667, 0.667, 0.611, 0.333, 0.278, 0.333, 0.584, 0.556, 0.333, 0.556,
  0.611, 0.556, 0.611, 0.556, 0.333, 0.611, 0.611, 0.278, 0.278, 0.556, 0.278, 0.889, 0.611, 0.611,
  0.611, 0.611, 0.389, 0.556, 0.333, 0.611, 0.556, 0.778, 0.556, 0.556, 0.5, 0.389, 0.28, 0.389,
  0.584, 0.278, 0.278, 0.278, 0.278, 0.556, 0.5, 1.0, 0.556, 0.556, 0.333, 1.0, 0.667, 0.333, 1.0,
  0.278, 0.278, 0.278, 0.278, 0.278, 0.278, 0.5, 0.5, 0.35, 0.556, 1.0, 0.333, 1.0, 0.556, 0.333,
  0.944, 0.278, 0.278, 0.667, 0.278, 0.333, 0.556, 0.556, 0.556, 0.556, 0.28, 0.556, 0.333, 0.737,
  0.37, 0.556, 0.584, 0.333, 0.737, 0.333, 0.4, 0.584, 0.333, 0.333, 0.333, 0.611, 0.556, 0.278,
  0.333, 0.333, 0.365, 0.556, 0.834, 0.834, 0.834, 0.611, 0.722, 0.722, 0.722, 0.722, 0.722, 0.722,
  1.0, 0.722, 0.667, 0.667, 0.667, 0.667, 0.278, 0.278, 0.278, 0.278, 0.722, 0.722, 0.778, 0.778,
  0.778, 0.778, 0.778, 0.584, 0.778, 0.722, 0.722, 0.722, 0.722, 0.667, 0.667, 0.611, 0.556, 0.556,
  0.556, 0.556, 0.556, 0.556, 0.889, 0.556, 0.556, 0.556, 0.556, 0.556, 0.278, 0.278, 0.278, 0.278,
  0.611, 0.611, 0.611, 0.611, 0.611, 0.611, 0.611, 0.584, 0.611, 0.611, 0.611, 0.611, 0.611, 0.556,
  0.611, 0.556,
];

/**
 * `PS_PLOTTER` / `PSLIKE_PLOTTER` (include/plotters/plotters_pslike.h,
 * common/plotters/PS_plotter.cpp).
 *
 * Drive it exactly as upstream does: OpenFile / SetCreator / SetTitle /
 * SetPageSettings / SetColorMode / SetViewport, then StartPlot, then geometry,
 * then EndPlot. Read the finished document back with `bytes()`, or — since all
 * but the two encoded-string call sites are ASCII — with `text()`.
 */
export class PsPlotter {
  // ---- PLOTTER base state --------------------------------------------------
  private m_plotOffset: Vec2 = { x: 0, y: 0 };
  private m_plotScale = 1;
  private m_paperSize: Vec2 = { x: 0, y: 0 };
  private m_pageInfo: PsPageInfo | null = null;
  private m_IUsPerDecimil = 1;
  private m_iuPerDeviceUnit = 1;
  private m_currentPenWidth = -1;
  private m_penState: 'U' | 'D' | 'Z' = 'Z';
  private m_penLastpos: Vec2 = { x: 0, y: 0 };
  private m_plotMirror = false;
  private m_mirrorIsHorizontal = true;
  private m_yaxisReversed = false;
  private m_colorMode = false;
  private m_negativeMode = false;
  private m_creator = '';
  private m_filename = '';
  private m_title = '';

  // ---- PSLIKE_PLOTTER state ------------------------------------------------
  private plotScaleAdjX = 1;
  private plotScaleAdjY = 1;

  /** PS_PLOTTER's constructor overwrites PSLIKE_PLOTTER's PHANTOM with STROKE. */
  private m_textMode: PLOT_TEXT_MODE = PLOT_TEXT_MODE.STROKE;

  /** The output file, as bytes: the document mixes UTF-8 and Latin-1. */
  private out: number[] = [];
  private m_outputFile = false;

  constructor(private readonly m_renderSettings: PsRenderSettings) {}

  static GetDefaultFileExtension(): string {
    return 'ps';
  }

  // =========================================================================
  // Output buffer
  // =========================================================================

  /** `fmt::print( m_outputFile, … )` for markup and `TO_UTF8`-ed strings. */
  private emit(aText: string): void {
    for (const byte of TEXT_ENCODER.encode(aText)) this.out.push(byte);
  }

  /**
   * An `encodeStringForPlotter` result, whose code units are already bytes.
   * Writing these through `emit` would UTF-8 expand them and desynchronise the
   * one thing PostScript counts on: the parenthesis nesting of a literal.
   */
  private emitLatin1(aText: string): void {
    for (let i = 0; i < aText.length; i++) this.out.push(aText.charCodeAt(i) & 0xff);
  }

  /** The plotted document. This, not `text()`, is what belongs on disk. */
  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }

  /** The document decoded as Latin-1, so a test can read operators as prose. */
  text(): string {
    let result = '';

    for (const byte of this.out) result += String.fromCharCode(byte);

    return result;
  }

  // =========================================================================
  // Setup
  // =========================================================================

  /**
   * `PLOTTER::OpenFile`. There is no file here — the document accumulates in
   * memory — but the plotter still refuses to draw before it is "open", which
   * is what upstream's `wxASSERT( m_outputFile )` guards in a debug build.
   */
  OpenFile(aFullFilename: string): boolean {
    this.m_filename = aFullFilename;
    this.m_outputFile = true;
    return true;
  }

  GetFilename(): string {
    return this.m_filename;
  }

  SetCreator(aCreator: string): void {
    this.m_creator = aCreator;
  }

  SetTitle(aTitle: string): void {
    this.m_title = aTitle;
  }

  /** `PLOTTER::SetPageSettings`. */
  SetPageSettings(aPageInfo: PsPageInfo): void {
    this.m_pageInfo = aPageInfo;
  }

  PageSettings(): PsPageInfo {
    if (!this.m_pageInfo) throw new Error('PostScript plotter has no page settings');

    return this.m_pageInfo;
  }

  /**
   * `PS_PLOTTER::SetViewport`. Unlike PDF's, this one *does* compute the paper
   * size, and with two truncations: PAGE_INFO's mils are a VECTOR2D landing in
   * a VECTOR2I member, and each `int *= double` truncates again.
   */
  SetViewport(aOffset: Vec2, aIusPerDecimil: number, aScale: number, aMirror: boolean): void {
    this.m_plotMirror = aMirror;
    this.m_plotOffset = { x: aOffset.x, y: aOffset.y };
    this.m_plotScale = aScale;
    this.m_IUsPerDecimil = aIusPerDecimil;
    this.m_iuPerDeviceUnit = 1.0 / aIusPerDecimil;

    // Compute the paper size in IUs
    const paperSize = toVector2I(this.PageSettings().GetSizeMils());

    this.m_paperSize = {
      x: Math.trunc(paperSize.x * (10.0 * aIusPerDecimil)),
      y: Math.trunc(paperSize.y * (10.0 * aIusPerDecimil)),
    };
  }

  /** `PSLIKE_PLOTTER::SetScaleAdjust`, the fine scaling StartPlot folds in. */
  SetScaleAdjust(aScaleX: number, aScaleY: number): void {
    this.plotScaleAdjX = aScaleX;
    this.plotScaleAdjY = aScaleY;
  }

  /** `PLOTTER::SetColorMode`. pcbnew passes `!blackAndWhite`. */
  SetColorMode(aColorMode: boolean): void {
    this.m_colorMode = aColorMode;
  }

  GetColorMode(): boolean {
    return this.m_colorMode;
  }

  SetNegative(aNegative: boolean): void {
    this.m_negativeMode = aNegative;
  }

  /** `PSLIKE_PLOTTER::SetTextMode`. DEFAULT means "leave the mode alone". */
  SetTextMode(aMode: PLOT_TEXT_MODE): void {
    if (aMode !== PLOT_TEXT_MODE.DEFAULT) this.m_textMode = aMode;
  }

  GetTextMode(): PLOT_TEXT_MODE {
    return this.m_textMode;
  }

  /** `PLOTTER::GetPlotterArcHighDef` / `GetPlotterArcLowDef`. */
  GetPlotterArcHighDef(): number {
    return this.m_IUsPerDecimil * 2;
  }

  GetPlotterArcLowDef(): number {
    return this.m_IUsPerDecimil * 8;
  }

  // =========================================================================
  // Coordinates
  // =========================================================================

  /**
   * `PLOTTER::userToDeviceCoordinates`. m_yaxisReversed is false for PS, so the
   * paper flip stands and the result is in decimils measured up from the bottom
   * of the sheet — which is where PostScript wants its origin, and why the page
   * setup only has to scale by 0.0072 and never to flip.
   *
   * The vertical-mirror branch is unreachable: nothing in the KiCad tree ever
   * assigns m_mirrorIsHorizontal, so it is `true` from PLOTTER's constructor
   * onwards. It is kept because the transform, not the reachable half of it, is
   * the unit being ported.
   */
  private userToDeviceCoordinates(aCoordinate: Vec2): Vec2 {
    const pos = {
      x: aCoordinate.x - this.m_plotOffset.x,
      y: aCoordinate.y - this.m_plotOffset.y,
    };

    let x = pos.x * this.m_plotScale;
    let y = this.m_paperSize.y - pos.y * this.m_plotScale;

    if (this.m_plotMirror) {
      if (this.m_mirrorIsHorizontal) x = this.m_paperSize.x - pos.x * this.m_plotScale;
      else y = pos.y * this.m_plotScale;
    }

    if (this.m_yaxisReversed) y = this.m_paperSize.y - y;

    x *= this.m_iuPerDeviceUnit;
    y *= this.m_iuPerDeviceUnit;

    return { x, y };
  }

  /** `PLOTTER::userToDeviceSize( double )`. */
  private userToDeviceSize(aSize: number): number {
    return aSize * this.m_plotScale * this.m_iuPerDeviceUnit;
  }

  /** `PLOTTER::userToDeviceSize( const VECTOR2I& )`. */
  private userToDeviceSizeV(aSize: Vec2): Vec2 {
    return {
      x: aSize.x * this.m_plotScale * this.m_iuPerDeviceUnit,
      y: aSize.y * this.m_plotScale * this.m_iuPerDeviceUnit,
    };
  }

  /**
   * `PLOTTER::GetDotMarkLenIU` and friends. Despite the `IU` in the names these
   * are already in *device* units — userToDeviceSize has run — and SetDash then
   * truncates each to an int, so a dash pattern is whole decimils.
   */
  private GetDotMarkLenIU(aLineWidth: number): number {
    return this.userToDeviceSize(this.m_renderSettings.GetDotLength(aLineWidth));
  }

  private GetDashMarkLenIU(aLineWidth: number): number {
    return this.userToDeviceSize(this.m_renderSettings.GetDashLength(aLineWidth));
  }

  private GetDashGapLenIU(aLineWidth: number): number {
    return this.userToDeviceSize(this.m_renderSettings.GetGapLength(aLineWidth));
  }

  // =========================================================================
  // Graphics state
  // =========================================================================

  /**
   * `PS_PLOTTER::SetCurrentLineWidth`. The sentinel handling is an `else if`
   * chain, and that is the whole difference from PDF's: a caller asking for
   * USE_DEFAULT_LINE_WIDTH against a zero default pen keeps a *zero* pen here,
   * where PDF's separate `if` would have clamped it to one. Every NO_FILL entry
   * point below then tests `GetCurrentLineWidth() <= 0` and draws nothing, so
   * the zero is not academic.
   *
   * `setlinewidth` is only written when the width *changes*, but the member is
   * assigned either way — so DO_NOT_SET_LINE_WIDTH, which returns early, is the
   * one path that leaves the member alone.
   */
  SetCurrentLineWidth(aWidth: number, _aData?: unknown): void {
    let width = aWidth;

    if (width === DO_NOT_SET_LINE_WIDTH) return;
    else if (width === USE_DEFAULT_LINE_WIDTH) width = this.m_renderSettings.GetDefaultPenWidth();
    else if (width === 0) width = 1;

    if (width !== this.GetCurrentLineWidth())
      this.emit(`${formatG(this.userToDeviceSize(width))} setlinewidth\n`);

    this.m_currentPenWidth = width;
  }

  GetCurrentLineWidth(): number {
    return this.m_currentPenWidth;
  }

  /**
   * `PS_PLOTTER::emitSetRGBColor`. PostScript treats every colour as opaque, so
   * a translucent one is pre-blended against white paper. The three components
   * are the only numbers in the whole back-end written at `{:.3g}` instead of
   * `{:g}`; upstream's comment on the line is "XXX why %.3g ? shouldn't %g
   * suffice? who cares...".
   */
  private emitSetRGBColor(r: number, g: number, b: number, a: number): void {
    let red = r;
    let green = g;
    let blue = b;

    if (a < 1.0) {
      red = red * a + (1 - a);
      green = green * a + (1 - a);
      blue = blue * a + (1 - a);
    }

    const p = RGB_G_PRECISION;

    this.emit(`${formatG(red, p)} ${formatG(green, p)} ${formatG(blue, p)} setrgbcolor\n`);
  }

  /**
   * `PSLIKE_PLOTTER::SetColor`. In mono mode only exact white survives as white
   * — every other colour, alpha included in the comparison, becomes black, and
   * the alpha is forced to 1.
   */
  SetColor(aColor: Color4d): void {
    if (this.m_colorMode) {
      if (this.m_negativeMode)
        this.emitSetRGBColor(1 - aColor.r, 1 - aColor.g, 1 - aColor.b, aColor.a);
      else this.emitSetRGBColor(aColor.r, aColor.g, aColor.b, aColor.a);
    } else {
      // B/W mode: pcbnew relies on the two colours to draw holes white on black pads.
      let k = 1; // White

      if (!colorEquals(aColor, COLOR4D_WHITE)) k = 0;

      if (this.m_negativeMode) this.emitSetRGBColor(1 - k, 1 - k, 1 - k, 1.0);
      else this.emitSetRGBColor(k, k, k, 1.0);
    }
  }

  /**
   * `PS_PLOTTER::SetDash`. Each element is *truncated* to an int, so a pattern
   * computed from a small pen collapses to `[0 0]` rather than falling back to
   * solid — PDF guards against that, PostScript does not. SOLID and DEFAULT
   * share the default arm, which calls the prolog's `solidline` macro instead
   * of writing a `setdash` of its own.
   */
  SetDash(aLineWidth: number, aLineStyle: LINE_STYLE): void {
    const dash = (): number => Math.trunc(this.GetDashMarkLenIU(aLineWidth));
    const dot = (): number => Math.trunc(this.GetDotMarkLenIU(aLineWidth));
    const gap = (): number => Math.trunc(this.GetDashGapLenIU(aLineWidth));

    switch (aLineStyle) {
      case LINE_STYLE.DASH:
        this.emit(`[${dash()} ${gap()}] 0 setdash\n`);
        break;

      case LINE_STYLE.DOT:
        this.emit(`[${dot()} ${gap()}] 0 setdash\n`);
        break;

      case LINE_STYLE.DASHDOT:
        this.emit(`[${dash()} ${gap()} ${dot()} ${gap()}] 0 setdash\n`);
        break;

      case LINE_STYLE.DASHDOTDOT:
        this.emit(`[${dash()} ${gap()} ${dot()} ${gap()} ${dot()} ${gap()}] 0 setdash\n`);
        break;

      default:
        this.emit('solidline\n');
    }
  }

  // =========================================================================
  // Entities
  // =========================================================================

  /**
   * `PS_PLOTTER::Rect`. The pen is set *before* the "nothing to draw" test, so
   * the test reads the resolved pen and not the caller's sentinel — and a
   * zero-sized rectangle is emitted as-is, because `rectstroke` and `rectfill`
   * both cope with a degenerate box where PDF had to special-case it.
   */
  Rect(p1: Vec2, p2: Vec2, fill: FILL_T, width: number, aCornerRadius = 0): void {
    this.SetCurrentLineWidth(width);

    if (fill === FILL_T.NO_FILL && this.GetCurrentLineWidth() <= 0) return;

    if (aCornerRadius > 0) {
      // Needs SHAPE_RECT with a corner radius and the SHAPE_LINE_CHAIN PlotPoly.
      throw new Error('PS Rect with a corner radius is not ported (needs SHAPE_RECT::SetRadius)');
    }

    const p1_dev = this.userToDeviceCoordinates(p1);
    const p2_dev = this.userToDeviceCoordinates(p2);

    this.emit(
      `${formatG(p1_dev.x)} ${formatG(p1_dev.y)}` +
        ` ${formatG(p2_dev.x - p1_dev.x)} ${formatG(p2_dev.y - p1_dev.y)}` +
        ` rect${getFillId(fill)}\n`,
    );
  }

  /**
   * `PS_PLOTTER::Circle`. PostScript has a real `arc` operator, so a circle is
   * three numbers and a macro name — no Bézier approximation, and no thin-circle
   * special case either: unlike PDF's, this one never promotes a hairline
   * outline to a fill.
   */
  Circle(pos: Vec2, diametre: number, fill: FILL_T, width: number): void {
    this.SetCurrentLineWidth(width);

    if (fill === FILL_T.NO_FILL && this.GetCurrentLineWidth() <= 0) return;

    const pos_dev = this.userToDeviceCoordinates(pos);
    const radius = this.userToDeviceSize(diametre / 2.0);

    this.emit(
      `${formatG(pos_dev.x)} ${formatG(pos_dev.y)} ${formatG(radius)} cir${getFillId(fill)}\n`,
    );
  }

  /**
   * `PS_PLOTTER::Arc`. The endpoints are computed in user space, pushed through
   * the device transform and only *then* turned back into angles, so the paper
   * flip is what decides which way round they come out. The correction is the
   * XOR `!m_plotMirror ^ ( aAngle < ANGLE_0 )`: an unmirrored plot swaps for a
   * positive sweep, a mirrored one for a negative sweep.
   *
   * Two more details. The pen is set after all of that but before the operator
   * is written, so a `setlinewidth` line can appear between an arc's operands
   * being computed and the arc itself being emitted; and there is no degenerate
   * radius guard at all, so a zero radius plots a zero-radius `arc`.
   */
  Arc(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aFill: FILL_T,
    aWidth: number,
  ): void {
    const center_device = this.userToDeviceCoordinates(aCenter);
    const radius_device = this.userToDeviceSize(aRadius);

    const endA = aStartAngle.add(aAngle);
    const start = {
      x: aRadius * aStartAngle.Cos() + aCenter.x,
      y: aRadius * aStartAngle.Sin() + aCenter.y,
    };
    const end = { x: aRadius * endA.Cos() + aCenter.x, y: aRadius * endA.Sin() + aCenter.y };

    const start_device = this.userToDeviceCoordinates(toVector2I(start));
    const end_device = this.userToDeviceCoordinates(toVector2I(end));

    let startAngle = EDA_ANGLE.fromVector({
      x: start_device.x - center_device.x,
      y: start_device.y - center_device.y,
    });
    let endAngle = EDA_ANGLE.fromVector({
      x: end_device.x - center_device.x,
      y: end_device.y - center_device.y,
    });

    // userToDeviceCoordinates gets our start/ends out of order
    if (!this.m_plotMirror !== aAngle.lt(ANGLE_0)) [startAngle, endAngle] = [endAngle, startAngle];

    this.SetCurrentLineWidth(aWidth);

    this.emit(
      `${formatG(center_device.x)} ${formatG(center_device.y)} ${formatG(radius_device)}` +
        ` ${formatG(startAngle.AsDegrees())} ${formatG(endAngle.AsDegrees())}` +
        ` arc${getFillId(aFill)}\n`,
    );
  }

  /**
   * `PLOTTER::Arc( start, mid, end, … )`, inherited unchanged: it derives the
   * centre and sweep and defers to the override above. `det <= 0` counts a
   * collinear triple as clockwise, so a degenerate arc normalises positive.
   */
  ArcThroughPoints(aStart: Vec2, aMid: Vec2, aEnd: Vec2, aFill: FILL_T, aWidth: number): void {
    const aCenter = CalcArcCenter(aStart, aMid, aEnd);

    const startAngle = EDA_ANGLE.fromVector({ x: aStart.x - aCenter.x, y: aStart.y - aCenter.y });
    const endAngle = EDA_ANGLE.fromVector({ x: aEnd.x - aCenter.x, y: aEnd.y - aCenter.y });

    // < 0: left, 0 : on the line, > 0 : right
    const det =
      (aEnd.x - aStart.x) * (aMid.y - aStart.y) - (aEnd.y - aStart.y) * (aMid.x - aStart.x);

    const cw = det <= 0;
    const angle = endAngle.sub(startAngle);

    if (cw) angle.Normalize();
    else angle.NormalizeNegative();

    const radius = euclideanNormD({ x: aStart.x - aCenter.x, y: aStart.y - aCenter.y });

    this.Arc(aCenter, startAngle, angle, radius, aFill, aWidth);
  }

  /**
   * `PS_PLOTTER::PlotPoly`. The three guards run in upstream's order — pen
   * first, then the unfilled-hairline test, then the point count — which is
   * observable: a one-point corner list still emits a `setlinewidth` before it
   * gives up.
   *
   * The path is left open; the `poly1`/`poly2` macros close it themselves, and
   * `poly0` is nothing but `stroke`, so an unfilled polygon is deliberately not
   * closed at all.
   */
  PlotPoly(
    aCornerList: readonly Vec2[],
    aFill: FILL_T,
    aWidth: number = USE_DEFAULT_LINE_WIDTH,
    _aData?: unknown,
  ): void {
    this.SetCurrentLineWidth(aWidth);

    if (aFill === FILL_T.NO_FILL && this.GetCurrentLineWidth() <= 0) return;

    if (aCornerList.length <= 1) return;

    let pos = this.userToDeviceCoordinates(aCornerList[0]!);

    this.emit(`newpath\n${formatG(pos.x)} ${formatG(pos.y)} moveto\n`);

    for (let ii = 1; ii < aCornerList.length; ii++) {
      pos = this.userToDeviceCoordinates(aCornerList[ii]!);
      this.emit(`${formatG(pos.x)} ${formatG(pos.y)} lineto\n`);
    }

    // Close/(fill) the path
    this.emit(`poly${getFillId(aFill)}\n`);
  }

  // =========================================================================
  // Thick primitives (PLOTTER)
  // =========================================================================

  /**
   * `PLOTTER::ThickSegment`. A zero-length segment becomes a filled circle, and
   * the width doubles as a sentinel: USE_DEFAULT_LINE_WIDTH is resolved *through*
   * SetCurrentLineWidth so the pen is left at the default too, while
   * DO_NOT_SET_LINE_WIDTH reads the live pen without touching it. An unresolved
   * sentinel then trips a `wxCHECK2_MSG` and draws nothing.
   */
  ThickSegment(aStart: Vec2, aEnd: Vec2, aWidth: number, aData?: unknown): void {
    if (aStart.x === aEnd.x && aStart.y === aEnd.y) {
      let diameter = aWidth;

      if (aWidth === USE_DEFAULT_LINE_WIDTH) {
        this.SetCurrentLineWidth(aWidth, aData);
        diameter = this.GetCurrentLineWidth();
      } else if (aWidth === DO_NOT_SET_LINE_WIDTH) {
        diameter = this.GetCurrentLineWidth();
      }

      if (diameter < 0) return;

      this.Circle(aStart, diameter, FILL_T.FILLED_SHAPE, 0);
    } else {
      this.SetCurrentLineWidth(aWidth);
      this.MoveTo(aStart);
      this.FinishTo(aEnd);
    }
  }

  /** `PLOTTER::ThickArc`, which is an unfilled Arc and nothing else. */
  ThickArc(
    aCentre: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aWidth: number,
    _aData?: unknown,
  ): void {
    this.Arc(aCentre, aStartAngle, aAngle, aRadius, FILL_T.NO_FILL, aWidth);
  }

  /** `PLOTTER::ThickRect`. */
  ThickRect(p1: Vec2, p2: Vec2, width: number, _aData?: unknown): void {
    this.Rect(p1, p2, FILL_T.NO_FILL, width, 0);
  }

  /** `PLOTTER::ThickCircle`. */
  ThickCircle(pos: Vec2, diametre: number, width: number, _aData?: unknown): void {
    this.Circle(pos, diametre, FILL_T.NO_FILL, width);
  }

  /** `PLOTTER::FilledCircle`. */
  FilledCircle(pos: Vec2, diametre: number, _aData?: unknown): void {
    this.Circle(pos, diametre, FILL_T.FILLED_SHAPE, 0);
  }

  // =========================================================================
  // Pad flashes (PSLIKE_PLOTTER)
  // =========================================================================

  /** `PSLIKE_PLOTTER::FlashPadCircle`. */
  FlashPadCircle(aPadPos: Vec2, aDiameter: number, _aData?: unknown): void {
    this.Circle(aPadPos, aDiameter, FILL_T.FILLED_SHAPE, 0);
  }

  /**
   * `PSLIKE_PLOTTER::FlashPadOval`. The pad is first normalised to a *vertical*
   * tablet by swapping the axes and adding 90 degrees, then drawn as one thick
   * segment between the two cap centres. `delta / 2` is integer division, so an
   * odd-length oval loses half an IU off each cap.
   */
  FlashPadOval(aPadPos: Vec2, aSize: Vec2, aPadOrient: EDA_ANGLE, aData?: unknown): void {
    const size = { x: aSize.x, y: aSize.y };
    let orient = aPadOrient;

    // The pad is reduced to an oval by dy > dx
    if (size.x > size.y) {
      [size.x, size.y] = [size.y, size.x];
      orient = orient.add(ANGLE_90);
    }

    const delta = size.y - size.x;
    let a = { x: 0, y: Math.trunc(-delta / 2) };
    let b = { x: 0, y: Math.trunc(delta / 2) };

    a = RotatePoint(a, orient);
    b = RotatePoint(b, orient);

    this.ThickSegment(
      { x: a.x + aPadPos.x, y: a.y + aPadPos.y },
      { x: b.x + aPadPos.x, y: b.y + aPadPos.y },
      size.x,
      aData,
    );
  }

  /**
   * `PSLIKE_PLOTTER::FlashPadRect`. The corners are built anticlockwise from the
   * bottom-left, rotated *about the pad centre*, and then the first is repeated
   * to close the ring — which `poly1` would have closed anyway, so the fifth
   * point is a duplicated `lineto` in the output.
   */
  FlashPadRect(aPadPos: Vec2, aSize: Vec2, aPadOrient: EDA_ANGLE, aData?: unknown): void {
    const dx = Math.trunc(aSize.x / 2);
    const dy = Math.trunc(aSize.y / 2);

    let cornerList: Vec2[] = [
      { x: aPadPos.x - dx, y: aPadPos.y + dy },
      { x: aPadPos.x - dx, y: aPadPos.y - dy },
      { x: aPadPos.x + dx, y: aPadPos.y - dy },
      { x: aPadPos.x + dx, y: aPadPos.y + dy },
    ];

    cornerList = cornerList.map((corner) => RotatePoint(corner, aPadPos, aPadOrient));

    cornerList.push(cornerList[0]!);

    this.PlotPoly(cornerList, FILL_T.FILLED_SHAPE, 0, aData);
  }

  /**
   * `PSLIKE_PLOTTER::FlashPadTrapez`. The corners rotate about the *origin* and
   * only then translate by the pad position, so they arrive relative to the pad.
   */
  FlashPadTrapez(
    aPadPos: Vec2,
    aCorners: readonly Vec2[],
    aPadOrient: EDA_ANGLE,
    aData?: unknown,
  ): void {
    const cornerList: Vec2[] = [];

    for (let ii = 0; ii < 4; ii++) cornerList.push({ x: aCorners[ii]!.x, y: aCorners[ii]!.y });

    for (let ii = 0; ii < 4; ii++) {
      const rotated = RotatePoint(cornerList[ii]!, aPadOrient);

      cornerList[ii] = { x: rotated.x + aPadPos.x, y: rotated.y + aPadPos.y };
    }

    cornerList.push(cornerList[0]!);

    this.PlotPoly(cornerList, FILL_T.FILLED_SHAPE, 0, aData);
  }

  /**
   * `PSLIKE_PLOTTER::FlashRegularPolygon`. The whole body is `wxASSERT( 0 )`
   * with the comment "Do nothing", so in a release build this draws nothing at
   * all — which is the behaviour, not an omission.
   */
  FlashRegularPolygon(
    _aShapePos: Vec2,
    _aRadius: number,
    _aCornerCount: number,
    _aOrient: EDA_ANGLE,
    _aData?: unknown,
  ): void {
    // Do nothing
  }

  // =========================================================================
  // Pen
  // =========================================================================

  MoveTo(pos: Vec2): void {
    this.PenTo(pos, 'U');
  }

  LineTo(pos: Vec2): void {
    this.PenTo(pos, 'D');
  }

  FinishTo(pos: Vec2): void {
    this.PenTo(pos, 'D');
    this.PenTo(pos, 'Z');
  }

  PenFinish(): void {
    // The point is not important with Z motion
    this.PenTo({ x: 0, y: 0 }, 'Z');
  }

  /**
   * `PS_PLOTTER::PenTo`. 'Z' strokes whatever path is open and parks the pen at
   * (-1,-1), which is what makes the *next* plume start a fresh `newpath`.
   *
   * Note the order: the `newpath` is written as soon as the pen leaves rest,
   * before the test that decides whether the plume actually moved — though the
   * two never disagree, because a pen at rest is in state 'Z' and so always
   * fails the `m_penState != plume` half of that test. What the ordering does
   * buy is that a *mid-path* lift, where the state is already 'U' or 'D', gets
   * no `newpath` and stays part of the same subpath.
   *
   * The suppression test compares the *user* position, so a repeated point
   * writes nothing even though the device position might differ after a
   * viewport change.
   */
  PenTo(pos: Vec2, plume: 'U' | 'D' | 'Z'): void {
    if (plume === 'Z') {
      if (this.m_penState !== 'Z') {
        this.emit('stroke\n');
        this.m_penState = 'Z';
        this.m_penLastpos = { x: -1, y: -1 };
      }

      return;
    }

    if (this.m_penState === 'Z') this.emit('newpath\n');

    if (
      this.m_penState !== plume ||
      pos.x !== this.m_penLastpos.x ||
      pos.y !== this.m_penLastpos.y
    ) {
      const pos_dev = this.userToDeviceCoordinates(pos);

      this.emit(
        `${formatG(pos_dev.x)} ${formatG(pos_dev.y)} ${plume === 'D' ? 'line' : 'move'}to\n`,
      );
    }

    this.m_penState = plume;
    this.m_penLastpos = { x: pos.x, y: pos.y };
  }

  // =========================================================================
  // Images
  // =========================================================================

  /**
   * `PS_PLOTTER::PlotImage`. The image is mapped onto the unit square by
   * `translate` and `scale`, and the source matrix `[w 0 0 -h 0 h]` flips it
   * back the right way up.
   *
   * Two upstream faults reach the file. `/pix` is declared as a string of
   * *width* bytes, but in colour mode `colorimage` consumes three components
   * per pixel, so each `readhexstring` returns a third of a scanline; and `jj`,
   * the counter that breaks the hex dump every sixteen pixels, is never reset
   * between rows, so the break positions drift across the image rather than
   * lining up with it.
   *
   * The alpha premultiply carries two more. It is done in C `float`, not
   * `double` — `float a` and a `float` multiply — which is why `Math.fround`
   * appears here twice and why a half-transparent pixel gains 127 and not 128.
   * And the sum is masked with `& 0xFF` instead of clamped, so a channel that
   * was already near white wraps round to near black; a port that clamped would
   * produce a nicer image than KiCad does.
   */
  PlotImage(aImage: PsImage, aPos: Vec2, aScaleFactor: number): void {
    // size of the bitmap in pixels
    const pix_size = { x: aImage.GetWidth(), y: aImage.GetHeight() };

    // requested size of image
    const drawsize = { x: aScaleFactor * pix_size.x, y: aScaleFactor * pix_size.y };

    // calculate the bottom left corner position of bitmap
    const start = {
      x: Math.trunc(aPos.x - drawsize.x / 2), // left
      y: Math.trunc(aPos.y + drawsize.y / 2), // bottom (Y axis reversed)
    };

    // calculate the top right corner position of bitmap
    const end = {
      x: Math.trunc(start.x + drawsize.x),
      y: Math.trunc(start.y - drawsize.y),
    };

    this.emit('/origstate save def\n');
    this.emit(`/pix ${pix_size.x} string def\n`);

    // Locate lower-left corner of image
    const start_dev = this.userToDeviceCoordinates(start);
    this.emit(`${formatG(start_dev.x)} ${formatG(start_dev.y)} translate\n`);

    // Map image size to device
    const end_dev = this.userToDeviceCoordinates(end);
    this.emit(
      `${formatG(Math.abs(end_dev.x - start_dev.x))}` +
        ` ${formatG(Math.abs(end_dev.y - start_dev.y))} scale\n`,
    );

    // Dimensions of source image (in pixels)
    this.emit(`${pix_size.x} ${pix_size.y} 8`);

    //  Map unit square to source
    this.emit(` [${pix_size.x} 0 0 ${-pix_size.y} 0 ${pix_size.y}]\n`);

    // include image data in ps file
    this.emit('{currentfile pix readhexstring pop}\n');

    if (this.m_colorMode) this.emit('false 3 colorimage\n');
    else this.emit('image\n');

    // Single data source, 3 colors, Output RGB data (hexadecimal)
    // (or the same downscaled to gray)
    let jj = 0;

    for (let yy = 0; yy < pix_size.y; yy++) {
      for (let xx = 0; xx < pix_size.x; xx++, jj++) {
        if (jj >= 16) {
          jj = 0;
          this.emit('\n');
        }

        let red = aImage.GetRed(xx, yy) & 0xff;
        let green = aImage.GetGreen(xx, yy) & 0xff;
        let blue = aImage.GetBlue(xx, yy) & 0xff;

        // PS doesn't support alpha, so premultiply against white background
        if (aImage.HasAlpha()) {
          const alpha = aImage.GetAlpha(xx, yy) & 0xff;

          if (alpha < 0xff) {
            // The `Math.fround` here mirrors C's `float a` and is provably
            // unobservable: `(1 - alpha/255) * 255` is exactly `255 - alpha` in
            // reals, and both the double and the float32 roundings of it land
            // inside half an ULP of that integer, so the enclosing
            // `Math.fround(a * 0xFF)` collapses them to the same value for all
            // 255 x 256 (alpha, channel) pairs — checked exhaustively. Kept for
            // the transcription, not for behaviour; no test can pin it.
            const a = Math.fround(1.0 - alpha / 255.0);

            red = Math.trunc(Math.fround(red + Math.fround(a * 0xff))) & 0xff;
            green = Math.trunc(Math.fround(green + Math.fround(a * 0xff))) & 0xff;
            blue = Math.trunc(Math.fround(blue + Math.fround(a * 0xff))) & 0xff;
          }
        }

        if (aImage.HasMask()) {
          if (
            red === aImage.GetMaskRed() &&
            green === aImage.GetMaskGreen() &&
            blue === aImage.GetMaskBlue()
          ) {
            red = 0xff;
            green = 0xff;
            blue = 0xff;
          }
        }

        if (this.m_colorMode) {
          this.emit(`${hex2(red)}${hex2(green)}${hex2(blue)}`);
        } else {
          // Greyscale conversion (CIE 1931)
          const grey = KiROUND(red * 0.2126 + green * 0.7152 + blue * 0.0722) & 0xff;

          this.emit(hex2(grey));
        }
      }
    }

    this.emit('\n');
    this.emit('origstate restore\n');
  }

  // =========================================================================
  // Document structure
  // =========================================================================

  /**
   * `PS_PLOTTER::StartPlot`. The comments follow Adobe's Document Structuring
   * Convention, and three of them are worth reading twice.
   *
   * `%%Pages: 1` is a constant, whatever the caller then plots. The bounding box
   * rounds *up* with `ceil` while `%%DocumentMedia` rounds to nearest, so the
   * two disagree by a point on most sheets — deliberate, per the comment about
   * rounding the corners outwards. And both are computed from a page size that
   * has been swapped *back* to portrait for a landscape sheet, because
   * PAGE_INFO already stores its size the right way round and the rotation is
   * applied later by `N 0 translate 90 rotate`.
   *
   * The `%%DocumentMedia` size really is written y-before-x; upstream's comment
   * says "the order in which they are specified is not wrong!".
   */
  StartPlot(aPageNumber: string, aNow: Date = new Date()): boolean {
    if (!this.m_outputFile) throw new Error('PostScript plot started before OpenFile');

    const pageInfo = this.PageSettings();

    this.emit('%!PS-Adobe-3.0\n'); // Print header

    this.emit(`%%Creator: ${this.m_creator}\n`);

    /* A "newline" character ("\n") is not included in the following string,
       because it is provided by the ctime() function. */
    this.emit(`%%CreationDate: ${psCreationDate(aNow)}`);
    this.emit('%%Title: ');
    this.emitLatin1(encodeStringForPlotter(this.m_title));
    this.emit('\n');
    this.emit('%%Pages: 1\n');
    this.emit('%%PageOrder: Ascend\n');

    /* The coordinates of the lower left corner of the boundary
       box need to be "rounded down", but the coordinates of its
       upper right corner need to be "rounded up" instead. */
    const sizeMils = toVector2I(pageInfo.GetSizeMils());
    const psPaperSize = { x: sizeMils.x, y: sizeMils.y };

    if (!pageInfo.IsPortrait()) {
      psPaperSize.x = Math.trunc(pageInfo.GetHeightMils());
      psPaperSize.y = Math.trunc(pageInfo.GetWidthMils());
    }

    this.emit(
      `%%BoundingBox: 0 0 ${Math.trunc(Math.ceil(psPaperSize.x * BIGPTsPERMIL))}` +
        ` ${Math.trunc(Math.ceil(psPaperSize.y * BIGPTsPERMIL))}\n`,
    );

    // Specify the size of the sheet and the name associated with that size.
    // (If the "User size" option has been selected for the sheet size,
    // identify the sheet size as "Custom" (rather than as "User"), but
    // otherwise use the name assigned by KiCad for each sheet size.)
    let pageType = pageInfo.GetTypeAsString();

    if (pageInfo.IsCustom()) pageType = 'Custom';

    this.emit(
      `%%DocumentMedia: ${pageType} ${KiROUND(psPaperSize.x * BIGPTsPERMIL)}` +
        ` ${KiROUND(psPaperSize.y * BIGPTsPERMIL)} 0 () ()\n`,
    );

    if (pageInfo.IsPortrait()) this.emit('%%Orientation: Portrait\n');
    else this.emit('%%Orientation: Landscape\n');

    this.emit('%%EndComments\n');

    // Now specify various other details.
    this.emit(PS_MACRO_PROLOG);

    // The following strings are output here (rather than within PSMacro[])
    // to highlight that it has been provided to ensure that the contents of
    // the postscript file comply with the Document Structuring Convention.
    this.emit('%%Page: ');
    this.emitLatin1(encodeStringForPlotter(aPageNumber));
    this.emit(' 1\n');

    this.emit(
      '%%BeginPageSetup\n' +
        'gsave\n' +
        '0.0072 0.0072 scale\n' + // Configure postscript for decimils coordinates
        'linemode1\n',
    );

    // Rototranslate the coordinate to achieve the landscape layout
    if (!pageInfo.IsPortrait()) this.emit(`${10 * psPaperSize.x} 0 translate 90 rotate\n`);

    // Apply the user fine scale adjustments
    if (this.plotScaleAdjX !== 1.0 || this.plotScaleAdjY !== 1.0)
      this.emit(`${formatG(this.plotScaleAdjX)} ${formatG(this.plotScaleAdjY)} scale\n`);

    // Set default line width
    this.emit(
      `${formatG(this.userToDeviceSize(this.m_renderSettings.GetDefaultPenWidth()))} setlinewidth\n`,
    );
    this.emit('%%EndPageSetup\n');

    return true;
  }

  /**
   * `PS_PLOTTER::EndPlot`. `grestore` unwinds StartPlot's `gsave`, and the file
   * is closed — after which nothing may be drawn, which is what the reset of
   * m_outputFile enforces here.
   */
  EndPlot(): boolean {
    if (!this.m_outputFile) throw new Error('PostScript plot ended before OpenFile');

    this.emit('showpage\ngrestore\n%%EOF\n');

    this.m_outputFile = false;

    return true;
  }

  // =========================================================================
  // Text
  // =========================================================================

  /**
   * `PS_PLOTTER::Text`. The PostScript-native path is only the *phantom* one:
   * an invisible `phantomshow` string that gives a PDF distiller something to
   * search, drawn before the glyphs and only when the mode was set to PHANTOM —
   * which PS_PLOTTER's constructor deliberately does not do.
   *
   * The visible text is then stroked by `PLOTTER::Text`, and note what is passed
   * to it: `GetCurrentLineWidth()`, the pen this method has just resolved, not
   * the caller's `aWidth`. A caller passing DO_NOT_SET_LINE_WIDTH therefore
   * hands the base class whatever the live pen happens to be.
   */
  Text(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aOrient: EDA_ANGLE,
    aSize: Vec2,
    aH_justify: GR_TEXT_H_ALIGN_T,
    aV_justify: GR_TEXT_V_ALIGN_T,
    aWidth: number,
    aItalic: boolean,
    aBold: boolean,
    aMultilineAllowed: boolean,
    aFont: PsFont | null,
    _aFontMetrics?: unknown,
    aData?: unknown,
  ): void {
    this.SetCurrentLineWidth(aWidth);
    this.SetColor(aColor);

    // Draw the hidden postscript text (if requested)
    if (this.m_textMode === PLOT_TEXT_MODE.PHANTOM) {
      const pos_dev = this.userToDeviceCoordinates(aPos);

      this.emitLatin1(encodeStringForPlotter(aText));
      this.emit(` ${formatG(pos_dev.x)} ${formatG(pos_dev.y)} phantomshow\n`);
    }

    this.plotterText(
      aPos,
      aColor,
      aText,
      aOrient,
      aSize,
      aH_justify,
      aV_justify,
      this.GetCurrentLineWidth(),
      aItalic,
      aBold,
      aMultilineAllowed,
      aFont,
      aData,
    );
  }

  /**
   * `PLOTTER::Text`, the stroking half. The stroke callback re-issues
   * `SetCurrentLineWidth( aPenWidth )` for every segment — `PLOTTER::PlotText`'s
   * does not — so a run of glyphs plotted through this path restores the pen
   * after anything the font's polygon callback might have changed.
   *
   * `@{…}` expression substitution runs here upstream (EXPRESSION_EVALUATOR); it
   * has no counterpart in this repo and is skipped rather than approximated with
   * a regex, so a string containing `@{` plots literally.
   *
   * A negative pen width is made positive *after* the bold default is applied,
   * so a bold string with a zero width picks up size/5 and a deliberately
   * negative width is only ever a sign trick.
   */
  private plotterText(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aOrient: EDA_ANGLE,
    aSize: Vec2,
    aH_justify: GR_TEXT_H_ALIGN_T,
    aV_justify: GR_TEXT_V_ALIGN_T,
    aPenWidth: number,
    aItalic: boolean,
    aBold: boolean,
    _aMultilineAllowed: boolean,
    aFont: PsFont | null,
    _aData?: unknown,
  ): void {
    let penWidth = aPenWidth;

    this.SetColor(aColor);

    if (penWidth === 0 && aBold) penWidth = GetPenSizeForBold(Math.min(aSize.x, aSize.y));

    if (penWidth < 0) penWidth = -penWidth;

    const size = { x: aSize.x, y: aSize.y };
    let mirrored = false;

    // if Size.x is < 0, the text is mirrored (there is no other flag for it)
    if (size.x < 0) {
      size.x = -size.x;
      mirrored = true;
    }

    if (!aFont) throw new Error('PS Text needs a font (KIFONT::FONT::GetFont is not ported)');

    const attributes: PsTextAttributes = {
      m_Angle: aOrient,
      m_StrokeWidth: penWidth,
      m_Italic: aItalic,
      m_Bold: aBold,
      m_Halign: aH_justify,
      m_Valign: aV_justify,
      m_Size: size,
      m_Mirrored: mirrored,
      // TEXT_ATTRIBUTES' constructor default is *true*, and PLOTTER::Text never
      // assigns it — so aMultilineAllowed is accepted, threaded all the way down
      // from PS_PLOTTER::Text, and then silently discarded.
      m_Multiline: true,
    };

    for (const [pt1, pt2] of aFont.Draw(aText, aPos, attributes)) {
      this.SetCurrentLineWidth(penWidth);
      this.MoveTo(pt1);
      this.LineTo(pt2);
      this.PenFinish();
    }
  }

  /**
   * `PS_PLOTTER::PlotText`. Same shape as Text, with one difference that is not
   * cosmetic: the base `PLOTTER::PlotText` calls `SetCurrentLineWidth` once, up
   * front, and its stroke callback does *not* re-issue it per segment. So a
   * font whose polygon callback disturbed the pen would leave the rest of the
   * string thin — where the Text path would have repaired it.
   */
  PlotText(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aAttributes: PsTextAttributes,
    aFont: PsFont | null,
    _aFontMetrics?: unknown,
    aData?: unknown,
  ): void {
    this.SetCurrentLineWidth(aAttributes.m_StrokeWidth);
    this.SetColor(aColor);

    // Draw the hidden postscript text (if requested)
    if (this.m_textMode === PLOT_TEXT_MODE.PHANTOM) {
      const pos_dev = this.userToDeviceCoordinates(aPos);

      this.emitLatin1(encodeStringForPlotter(aText));
      this.emit(` ${formatG(pos_dev.x)} ${formatG(pos_dev.y)} phantomshow\n`);
    }

    let penWidth = aAttributes.m_StrokeWidth;

    this.SetColor(aColor);
    this.SetCurrentLineWidth(penWidth, aData);

    if (penWidth === 0 && aAttributes.m_Bold)
      penWidth = GetPenSizeForBold(Math.min(aAttributes.m_Size.x, aAttributes.m_Size.y));

    if (penWidth < 0) penWidth = -penWidth;

    if (!aFont) throw new Error('PS PlotText needs a font (KIFONT::FONT::GetFont is not ported)');

    const attributes: PsTextAttributes = { ...aAttributes, m_StrokeWidth: penWidth };

    for (const [pt1, pt2] of aFont.Draw(aText, aPos, attributes)) {
      this.MoveTo(pt1);
      this.LineTo(pt2);
      this.PenFinish();
    }
  }

  /**
   * `PSLIKE_PLOTTER::returnPostscriptTextWidth`. The AFM widths are fractions of
   * the em, so the tally is scaled by the requested x size and divided by the
   * ascent — "widths are proportional to height, but height is enlarged by a
   * scaling factor". Code points at or above 256 are simply not counted, which
   * is why a Cyrillic string measures zero.
   */
  returnPostscriptTextWidth(
    aText: string,
    aXSize: number,
    aItalic: boolean,
    aBold: boolean,
  ): number {
    const width_table = aBold
      ? aItalic
        ? hvbo_widths
        : hvb_widths
      : aItalic
        ? hvo_widths
        : hv_widths;
    let tally = 0;

    for (const c of aText) {
      // Skip the negation marks and untabled points.
      const asciiCode = c.codePointAt(0)!;

      if (asciiCode < 256) tally += width_table[asciiCode]!;
    }

    // Widths are proportional to height, but height is enlarged by a scaling factor.
    return KiROUND((aXSize * tally) / POSTSCRIPT_TEXT_ASCENT);
  }

  /**
   * `PSLIKE_PLOTTER::computeTextParameters`, the shared PS/PDF text alignment
   * core. PS_PLOTTER never calls it — only PDF_PLOTTER::Text does — but it lives
   * in PS_plotter.cpp and belongs to the class being ported, and it is pure
   * enough to check on its own.
   *
   * Two upstream faults are reproduced. The width estimate is asked for with
   * `returnPostscriptTextWidth( aText, aSize.x, aItalic, aWidth )`, passing the
   * integer pen width into the `bool aBold` parameter — so *any* non-zero pen
   * selects the bold table regardless of `aBold`. And `tw`/`th` are rotated by
   * the text angle and then never read again; the call is kept because removing
   * it would be an edit, not a port.
   */
  computeTextParameters(
    aPos: Vec2,
    aText: string,
    aOrient: EDA_ANGLE,
    aSize: Vec2,
    aMirror: boolean,
    aH_justify: GR_TEXT_H_ALIGN_T,
    aV_justify: GR_TEXT_V_ALIGN_T,
    aWidth: number,
    aItalic: boolean,
    _aBold: boolean,
  ): {
    wideningFactor: number;
    ctm_a: number;
    ctm_b: number;
    ctm_c: number;
    ctm_d: number;
    ctm_e: number;
    ctm_f: number;
    heightFactor: number;
  } {
    // Compute the starting position (compensated for alignment)
    const start_pos = { x: aPos.x, y: aPos.y };

    // This is an approximation of the text bounds (in IUs)
    // NOTE: aWidth, an int, is handed to the bool aBold parameter.
    const tw = this.returnPostscriptTextWidth(aText, aSize.x, aItalic, aWidth !== 0);
    const th = aSize.y;
    let dx = 0;
    let dy = 0;

    switch (aH_justify) {
      case GR_TEXT_H_ALIGN_T.CENTER:
        dx = Math.trunc(-tw / 2);
        break;
      case GR_TEXT_H_ALIGN_T.RIGHT:
        dx = -tw;
        break;
      case GR_TEXT_H_ALIGN_T.LEFT:
        dx = 0;
        break;
    }

    switch (aV_justify) {
      case GR_TEXT_V_ALIGN_T.CENTER:
        dy = Math.trunc(th / 2);
        break;
      case GR_TEXT_V_ALIGN_T.TOP:
        dy = th;
        break;
      case GR_TEXT_V_ALIGN_T.BOTTOM:
        dy = 0;
        break;
    }

    const d = RotatePoint({ x: dx, y: dy }, aOrient);

    // tw/th are rotated upstream and then discarded; kept for fidelity.
    RotatePoint({ x: tw, y: th }, aOrient);

    start_pos.x += d.x;
    start_pos.y += d.y;

    const pos_dev = this.userToDeviceCoordinates(start_pos);
    const sz_dev = this.userToDeviceSizeV(aSize);

    // Now returns the final values... the widening factor
    let wideningFactor = sz_dev.x / sz_dev.y;

    // Mirrored texts must be plotted as mirrored!
    if (this.m_plotMirror !== aMirror) wideningFactor = -wideningFactor;

    // The CTM transformation matrix
    const alpha = this.m_plotMirror ? aOrient.Invert().AsRadians() : aOrient.AsRadians();
    const sinalpha = Math.sin(alpha);
    const cosalpha = Math.cos(alpha);

    return {
      wideningFactor,
      ctm_a: cosalpha,
      ctm_b: sinalpha,
      ctm_c: -sinalpha,
      ctm_d: cosalpha,
      ctm_e: pos_dev.x,
      ctm_f: pos_dev.y,
      // This is because the letters are less than 1 unit high
      heightFactor: sz_dev.y / POSTSCRIPT_TEXT_ASCENT,
    };
  }
}

/** fmt's `{:02X}`: two upper-case hex digits, zero padded. */
function hex2(aValue: number): string {
  return aValue.toString(16).toUpperCase().padStart(2, '0');
}
