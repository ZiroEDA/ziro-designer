// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SVG_PLOTTER, the SVG 1.1 plot back-end, transcribed from
 * common/plotters/SVG_plotter.cpp plus the handful of members it inherits from
 * PSLIKE_PLOTTER (SetColor) and PLOTTER (userToDeviceCoordinates,
 * userToDeviceSize, GetDash/Dot/GapMarkLenIU, the MoveTo/LineTo/FinishTo/
 * PenFinish pen wrappers, the three-point Arc, PlotImage's degenerate fallback
 * and Text's glyph stroking).
 *
 * The plotter is an append-only text emitter with a *lazy graphics context*.
 * Pen colour, brush colour and alpha, fill mode, pen width and dash style live
 * in members; touching any of them only raises `m_graphics_changed`, and the
 * next drawing primitive flushes it by writing `</g>\n<g style="…">`. Nothing
 * is buffered or reordered, so a port has to make the same calls in the same
 * order or the group balance — and hence the whole document — differs.
 *
 * Three things dominate byte-level fidelity.
 *
 * 1. Precision is per call site. Most numbers use fmt's `{:.{}f}` with
 *    `m_precision` (4), but *five* places use a bare `{:f}`, which is a
 *    hard-coded six decimals: `<rect>`'s x/y/width/height/rx, `<image>`'s x/y,
 *    the `translate()` of mirrored hidden text, `Text`'s `rotate()` angle, and
 *    the DOT/DASHDOT/DASHDOTDOT dasharrays — DASH alone uses m_precision. (The
 *    port spec lists only four; `rotate()` is the fifth, SVG_plotter.cpp:904.)
 *    A single shared formatter would quietly normalise all of them.
 * 2. `fixed()` below rounds ties to even on the exact binary value, because
 *    that is what fmt and printf do. `Number.toFixed` rounds ties away from
 *    zero and drops the sign of negative zero, so it is not a drop-in.
 * 3. Separators differ by element and are copied literally: PenTo writes
 *    `M{x} {y}` / `L{x} {y}`, PlotPoly writes `M {x},{y}`, BezierCurve writes
 *    `M{x},{y} C…`, Arc writes spaces. So is the stray whitespace — `<circle …
 *    /> \n`, `Z" /> \n`, `</g> \n</svg>\n`, the space before `</title>` and
 *    `</desc>`.
 *
 * Faithfully reproduced oddities, none of which is to be "fixed": Circle
 * flushes the style *before* the thin-circle branch switches to FILLED_SHAPE,
 * so the enlarged circle comes out stroked and hollow and the fill state leaks
 * to the next primitive; PlotPoly hands setSVGPlotStyle the raw `aWidth`, so a
 * caller passing a sentinel gets `stroke:none`; PlotPoly asks for a non-group
 * style, which does *not* clear the dirty flag, so the next primitive re-emits
 * one; a hatch fill still emits `fill:#RRGGBB` and is only overridden by the
 * `fill:none` appended after it in CSS source order; `Arc` with a non-positive
 * radius passes the *width* where Circle expects a *diameter*; `flg_sweep` is
 * hard-coded to 0; emitSetRGBColor truncates `255*channel` rather than
 * rounding; StartLayer/EndLayer have no caller anywhere in KiCad and do not
 * escape the layer name; and KiCad's base64 encoder emits no `=` padding, so
 * the `<image>` data URI is unpadded.
 *
 * Deliberate gaps, each modelled as an injected dependency rather than
 * approximated: the font (`SvgFont`, standing in for KIFONT::FONT — the
 * monorepo has a stroke font but not KIFONT's Draw/StringBoundaryLimits
 * contract), the raster image (`SvgImage`, standing in for wxImage), and the
 * page size (`SetPageSettings` takes the mils that PAGE_INFO::GetSizeMils
 * would have returned). `@{…}` expression evaluation is skipped, as is the
 * outline-font polygon callback; both are noted where they would have run.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE, ANGLE_180 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { CalcArcCenter } from '@ziroeda/kimath/src/trigo.js';
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
 * `PLOT_TEXT_MODE` (plotter.h). The SVG constructor selects STROKE, but the
 * member is then never read: SVG_PLOTTER::Text always emits the hidden native
 * string *and* the stroked glyphs regardless of the mode.
 */
export enum PLOT_TEXT_MODE {
  STROKE = 0,
  NATIVE,
  PHANTOM,
  DEFAULT,
}

/** `PLOTTER::DO_NOT_SET_LINE_WIDTH` / `USE_DEFAULT_LINE_WIDTH` (plotter.h). */
export const DO_NOT_SET_LINE_WIDTH = -2;
export const USE_DEFAULT_LINE_WIDTH = -1;

/** COLOR4D, components in 0..1. Equality includes alpha, as COLOR4D's does. */
export interface Color4d {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const COLOR4D_BLACK: Color4d = { r: 0, g: 0, b: 0, a: 1 };
export const COLOR4D_WHITE: Color4d = { r: 1, g: 1, b: 1, a: 1 };

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/**
 * `RENDER_SETTINGS`, reduced to the four accessors the plotter reaches for.
 * Injected rather than imported because pcbnew/src must not reach into
 * designer/'s theme. `svgRenderSettings` below builds a faithful one.
 */
export interface SvgRenderSettings {
  GetDefaultPenWidth(): number;
  GetDashLength(aLineWidth: number): number;
  GetDotLength(aLineWidth: number): number;
  GetGapLength(aLineWidth: number): number;
}

/**
 * `correction` (render_settings.cpp). The file offers 0.8 ("looks best
 * visually") behind an `#if 0` and compiles 1.0; the dead value is not an
 * option, it is dead.
 */
const DASH_CORRECTION = 1.0;

/** RENDER_SETTINGS' ISO 128-2 defaults, and m_defaultPenWidth's bare zero. */
export const DEFAULT_DASH_LENGTH_RATIO = 12;
export const DEFAULT_GAP_LENGTH_RATIO = 3;

/**
 * `RENDER_SETTINGS::GetDashLength` / `GetDotLength` / `GetGapLength`. The dot
 * length ignores both ratios and is floored at 0.2 of the width, which is what
 * keeps a dot from collapsing to a zero-length line.
 */
export function svgRenderSettings(
  aOptions: { defaultPenWidth?: number; dashLengthRatio?: number; gapLengthRatio?: number } = {},
): SvgRenderSettings {
  const defaultPenWidth = aOptions.defaultPenWidth ?? 0;
  const dashLengthRatio = aOptions.dashLengthRatio ?? DEFAULT_DASH_LENGTH_RATIO;
  const gapLengthRatio = aOptions.gapLengthRatio ?? DEFAULT_GAP_LENGTH_RATIO;

  return {
    GetDefaultPenWidth: () => defaultPenWidth,
    GetDashLength: (aLineWidth) => Math.max(dashLengthRatio - DASH_CORRECTION, 1.0) * aLineWidth,
    GetDotLength: (aLineWidth) => Math.max(1.0 - DASH_CORRECTION, 0.2) * aLineWidth,
    GetGapLength: (aLineWidth) => Math.max(gapLengthRatio + DASH_CORRECTION, 1.0) * aLineWidth,
  };
}

/** The `TEXT_ATTRIBUTES` fields Text and PlotText read (text_attributes.h). */
export interface SvgTextAttributes {
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
 * `KIFONT::FONT`, reduced to the two calls the SVG text path makes. Supplied by
 * the caller because the monorepo's stroke font (common/src/font/stroke_font.ts)
 * does not implement KIFONT's contract — it has no justification, italic shear,
 * rotation or bold-thickness handling — and faking those here would be a
 * substitute, not a port.
 *
 * `GRTextWidth` is gr_text.cpp's free function minus its FONT and METRICS
 * arguments; only the invisible search-layer `textLength` depends on it.
 * `Draw` stands in for `FONT::Draw` driven by a CALLBACK_GAL: it must yield the
 * glyph strokes as point pairs in IU, in draw order. The polygon callback (which
 * upstream routes to `PlotPoly(chain, FILLED_SHAPE, 0)`) only fires for outline
 * fonts and has no analogue here.
 */
export interface SvgFont {
  GRTextWidth(
    aText: string,
    aSize: Vec2,
    aThickness: number,
    aBold: boolean,
    aItalic: boolean,
  ): number;

  Draw(
    aText: string,
    aPos: Vec2,
    aAttributes: SvgTextAttributes,
  ): readonly (readonly [Vec2, Vec2])[];
}

/**
 * `wxImage`, reduced to what PlotImage uses. `SaveFilePng` is
 * `SaveFile(stream, wxBITMAP_TYPE_PNG)`; the greyscale conversion is a separate
 * call because upstream re-encodes a *converted* image, so the two paths do not
 * share bytes.
 */
export interface SvgImage {
  GetWidth(): number;
  GetHeight(): number;
  SaveFilePng(): Uint8Array;
  ConvertToGreyscale(): SvgImage;
}

// ===========================================================================
// Number formatting
// ===========================================================================

const F64 = new DataView(new ArrayBuffer(8));

/**
 * fmt's `{:.Nf}`, i.e. C's `%.*f`: the exact binary value of the double is
 * rounded to N decimals with ties going to even, and the sign survives even
 * when the result is zero.
 *
 * `Number.prototype.toFixed` differs on both counts — it rounds ties away from
 * zero and prints negative zero as "0" — so the digits are produced here from
 * the IEEE fields with BigInt arithmetic, which is exact by construction.
 * Ties are rare at m_precision 4 but they are not impossible, and a rounding
 * rule that is right "almost always" is not a port.
 */
export function fixed(aValue: number, aPrecision: number): string {
  if (Number.isNaN(aValue)) return 'nan';
  if (!Number.isFinite(aValue)) return aValue > 0 ? 'inf' : '-inf';

  const negative = aValue < 0 || Object.is(aValue, -0);

  F64.setFloat64(0, Math.abs(aValue));
  const hi = F64.getUint32(0);
  const lo = F64.getUint32(4);

  const rawExponent = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);

  // Subnormals have no implicit leading bit and an exponent of 1, not 0.
  if (rawExponent === 0) mantissa |= 0n;
  else mantissa |= 1n << 52n;

  const exponent = (rawExponent === 0 ? 1 : rawExponent) - 1075;

  // value * 10^precision, as an exact rational.
  let numerator = mantissa * 10n ** BigInt(aPrecision);
  let denominator = 1n;

  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator = 1n << BigInt(-exponent);

  let quotient = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;

  if (twiceRemainder > denominator || (twiceRemainder === denominator && (quotient & 1n) === 1n))
    quotient += 1n;

  let digits = quotient.toString();

  if (aPrecision > 0) {
    digits = digits.padStart(aPrecision + 1, '0');
    digits = `${digits.slice(0, digits.length - aPrecision)}.${digits.slice(digits.length - aPrecision)}`;
  }

  return negative ? `-${digits}` : digits;
}

/** fmt's bare `{:f}`: a hard-coded six decimals, whatever m_precision says. */
export const DEFAULT_FMT_PRECISION = 6;

/** fmt's `{:06X}`: uppercase hex, zero-padded to at least six digits. */
export function hex6(aValue: number): string {
  return (aValue >>> 0).toString(16).toUpperCase().padStart(6, '0');
}

/** The `VECTOR2D` -> `VECTOR2I` conversion: truncate towards zero, per component. */
const toVector2I = (aVec: Vec2): Vec2 => ({
  x: Math.trunc(aVec.x),
  y: Math.trunc(aVec.y),
});

/**
 * `RotatePoint( VECTOR2D&, const EDA_ANGLE& )` (libs/kimath/src/trigo.cpp:291).
 * kimath's TypeScript RotatePoint is the *integer* overload and rounds; Arc
 * rotates device-space doubles, where rounding to whole millimetres would be
 * catastrophic, so the double overload is reproduced here rather than made
 * public in kimath, which must stay untouched.
 */
function rotatePointD(aPoint: Vec2, aAngle: EDA_ANGLE): Vec2 {
  const angle = aAngle.Clone().Normalize();

  // Cheap and dirty optimizations for 0, 90, 180, and 270 degrees.
  if (angle.AsDegrees() === 0) return { x: aPoint.x, y: aPoint.y };
  if (angle.AsDegrees() === 90) return { x: aPoint.y, y: -aPoint.x };
  if (angle.AsDegrees() === 180) return { x: -aPoint.x, y: -aPoint.y };
  if (angle.AsDegrees() === 270) return { x: -aPoint.y, y: aPoint.x };

  const sinus = angle.Sin();
  const cosinus = angle.Cos();

  return {
    x: aPoint.y * sinus + aPoint.x * cosinus,
    y: aPoint.y * cosinus - aPoint.x * sinus,
  };
}

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
 * `XmlEsc` (SVG_plotter.cpp:109). Carriage return is escaped in *both* modes,
 * which is why it sits above the isAttribute switch; the apostrophe is escaped
 * in neither. Every call from the SVG plotter leaves isAttribute false, so the
 * quote/tab/newline arm is unreachable from here — it is ported because the
 * function is the unit, not the call site.
 */
export function XmlEsc(aStr: string, aIsAttribute = false): string {
  let escaped = '';

  for (const c of aStr) {
    switch (c) {
      case '<':
        escaped += '&lt;';
        break;
      case '>':
        escaped += '&gt;';
        break;
      case '&':
        escaped += '&amp;';
        break;
      case '\r':
        escaped += '&#xD;';
        break;
      default:
        if (aIsAttribute) {
          switch (c) {
            case '"':
              escaped += '&quot;';
              break;
            case '\t':
              escaped += '&#x9;';
              break;
            case '\n':
              escaped += '&#xA;';
              break;
            default:
              escaped += c;
          }
        } else {
          escaped += c;
        }
    }
  }

  return escaped;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * `base64::encode` (libs/core/base64.cpp). KiCad's encoder emits **no `=`
 * padding** — encode_length works out to 2 or 3 characters for a 1- or 2-byte
 * tail — so the `<image>` data URI in a KiCad SVG is unpadded base64. `btoa`
 * pads, so it cannot be used here.
 */
export function base64Encode(aInput: Uint8Array): string {
  const end = Math.trunc(aInput.length / 3) * 3;
  let out = '';

  for (let i = 0; i < end; i += 3) {
    const value = (aInput[i]! << 16) | (aInput[i + 1]! << 8) | aInput[i + 2]!;

    out += BASE64_ALPHABET[(value >> 18) & 0x3f];
    out += BASE64_ALPHABET[(value >> 12) & 0x3f];
    out += BASE64_ALPHABET[(value >> 6) & 0x3f];
    out += BASE64_ALPHABET[value & 0x3f];
  }

  const remainder = aInput.length - end;

  if (remainder) {
    let value = aInput[end]!;

    if (remainder === 2) {
      value = (value << 10) | (aInput[end + 1]! << 2);
      out += BASE64_ALPHABET[(value >> 12) & 0x3f];
    } else {
      value <<= 4;
    }

    out += BASE64_ALPHABET[(value >> 6) & 0x3f];
    out += BASE64_ALPHABET[value & 0x3f];
  }

  return out;
}

/**
 * `GetISO8601CurrentDateTime` (string_utils.cpp:815), i.e.
 * `wxDateTime::Now().FormatISOCombined('T')` — *local* time, second precision,
 * no zone suffix.
 */
export function GetISO8601CurrentDateTime(aNow: Date = new Date()): string {
  const pad = (aValue: number, aWidth = 2): string => String(aValue).padStart(aWidth, '0');

  return (
    `${pad(aNow.getFullYear(), 4)}-${pad(aNow.getMonth() + 1)}-${pad(aNow.getDate())}` +
    `T${pad(aNow.getHours())}:${pad(aNow.getMinutes())}:${pad(aNow.getSeconds())}`
  );
}

/** `wxFileName( … ).GetFullName()`: the last path component, separator agnostic. */
function fullName(aPath: string): string {
  const cut = Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\'));
  return cut < 0 ? aPath : aPath.slice(cut + 1);
}

/**
 * `SVG_PLOTTER` (include/plotters/plotters_pslike.h,
 * common/plotters/SVG_plotter.cpp).
 *
 * Drive it exactly as upstream does: OpenFile / SetCreator / SetPageSettings /
 * SetColorMode / SetViewport, then StartPlot, then geometry, then EndPlot, and
 * read the document back with `text()`. Write it to disk as UTF-8 — every
 * string that reaches the file goes through upstream's TO_UTF8.
 */
export class SvgPlotter {
  // ---- PLOTTER base state --------------------------------------------------
  private m_plotOffset: Vec2 = { x: 0, y: 0 };
  private m_plotScale = 1;
  private m_paperSize: Vec2 = { x: 0, y: 0 };
  private m_pageSizeMils: Vec2 = { x: 0, y: 0 };
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

  // ---- SVG_PLOTTER state ---------------------------------------------------
  private m_fillMode: FILL_T = FILL_T.NO_FILL;
  private m_pen_rgb_color = 0;
  private m_brush_rgb_color = 0;
  private m_brush_alpha = 1.0;
  private m_graphics_changed = true;
  private m_dashed: LINE_STYLE = LINE_STYLE.SOLID;
  private m_precision = 4;

  /** PSLIKE_PLOTTER::m_textMode. Set by the constructor and never read again. */
  private m_textMode: PLOT_TEXT_MODE = PLOT_TEXT_MODE.PHANTOM;

  /** The emitted document. UTF-8 on the way to disk, a JS string in memory. */
  private out = '';

  constructor(private readonly m_renderSettings: SvgRenderSettings) {
    // SVG_PLOTTER's constructor body, in order.
    this.m_graphics_changed = true;
    this.SetTextMode(PLOT_TEXT_MODE.STROKE);
    this.m_fillMode = FILL_T.NO_FILL;
    this.m_pen_rgb_color = 0;
    this.m_brush_rgb_color = 0;
    this.m_brush_alpha = 1.0;
    this.m_dashed = LINE_STYLE.SOLID;
    this.m_precision = 4;
  }

  static GetDefaultFileExtension(): string {
    return 'svg';
  }

  // =========================================================================
  // Output buffer
  // =========================================================================

  private emit(aText: string): void {
    this.out += aText;
  }

  /** The plotted document. */
  text(): string {
    return this.out;
  }

  /** The document as the bytes that should be written to disk. */
  bytes(): Uint8Array {
    return new TextEncoder().encode(this.out);
  }

  // =========================================================================
  // Setup
  // =========================================================================

  /**
   * `PLOTTER::OpenFile`. There is no file here — the document accumulates in a
   * string — but the name is still needed: StartPlot puts its base name in the
   * `<title>`.
   */
  OpenFile(aFullFilename: string): boolean {
    this.m_filename = aFullFilename;
    return true;
  }

  GetFilename(): string {
    return this.m_filename;
  }

  SetCreator(aCreator: string): void {
    this.m_creator = aCreator;
  }

  /**
   * `PLOTTER::SetPageSettings`, collapsed to the one thing SetViewport asks a
   * PAGE_INFO for: `GetSizeMils()`, a VECTOR2D of mils. The page-size table
   * itself is not this module's business.
   */
  SetPageSettings(aSizeMils: Vec2): void {
    this.m_pageSizeMils = { x: aSizeMils.x, y: aSizeMils.y };
  }

  /**
   * `SetViewport`. SVG is the one back-end that reverses the Y axis, and the
   * paper size is computed here with *two* truncations: the mils are a VECTOR2D
   * assigned into a VECTOR2I member, and each `int *= double` truncates again.
   * That is why an A4 page comes out as 297.0022 mm wide in every file rather
   * than 297.
   *
   * `iusPerMM` is derived from aIusPerDecimil alone, so for pcbnew's 2540 the
   * device unit is exactly one millimetre.
   */
  SetViewport(aOffset: Vec2, aIusPerDecimil: number, aScale: number, aMirror: boolean): void {
    this.m_plotMirror = aMirror;
    this.m_yaxisReversed = true; // unlike other plotters, SVG has Y axis reversed
    this.m_plotOffset = aOffset;
    this.m_plotScale = aScale;
    this.m_IUsPerDecimil = aIusPerDecimil;

    // Compute the paper size in IUs. for historical reasons the page size is in mils
    // Two truncations, and only the first is observable. `PAGE_INFO::SetWidthMM`
    // stores mils as `mm * 1000 / 25.4`, so the mils really can be fractional
    // and dropping this one changes the emitted page size — a test pins it.
    // The second is upstream's `int *= double`: by then the value is integral
    // and every caller passes an integer `aIusPerDecimil` (pcbnew 2540,
    // eeschema 100, gerbview 1000), so it can never fire. Mutation testing
    // confirms it. Kept as upstream's arithmetic, not on the strength of a test.
    const paperSize = toVector2I(this.m_pageSizeMils);
    this.m_paperSize = {
      x: Math.trunc(paperSize.x * (10.0 * aIusPerDecimil)),
      y: Math.trunc(paperSize.y * (10.0 * aIusPerDecimil)),
    };

    const iusPerMM = (this.m_IUsPerDecimil / 2.54) * 1000;
    this.m_iuPerDeviceUnit = 1 / iusPerMM;

    this.SetSvgCoordinatesFormat(4);
  }

  /** `SetSvgCoordinatesFormat`. SVG units are always mm; only the digits move. */
  SetSvgCoordinatesFormat(aPrecision: number): void {
    this.m_precision = aPrecision;
  }

  GetPrecision(): number {
    return this.m_precision;
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

  /**
   * `PSLIKE_PLOTTER::SetTextMode`. SVG's constructor calls it with STROKE, but
   * SVG_PLOTTER never consults m_textMode: Text emits both the hidden native
   * string and the stroked glyphs no matter what.
   */
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
   * `PLOTTER::userToDeviceCoordinates`. With SVG's m_yaxisReversed the two Y
   * flips cancel, so the observable transform really is `y = pos.y * scale`;
   * the arithmetic is written out anyway because the *vertical* mirror branch
   * replaces the first flip only and would then not cancel.
   *
   * That branch is unreachable today: nothing in the KiCad tree ever assigns
   * m_mirrorIsHorizontal, so it is `true` from PLOTTER's constructor onwards
   * and only the horizontal mirror can fire. It is kept because the transform,
   * not the reachable half of it, is the unit being ported.
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

  /** `PLOTTER::userToDeviceSize( const VECTOR2I& )` — no Y negation. */
  private userToDeviceSizeV(aSize: Vec2): Vec2 {
    return {
      x: aSize.x * this.m_plotScale * this.m_iuPerDeviceUnit,
      y: aSize.y * this.m_plotScale * this.m_iuPerDeviceUnit,
    };
  }

  /** `PLOTTER::userToDeviceSize( double )`. */
  private userToDeviceSize(aSize: number): number {
    return aSize * this.m_plotScale * this.m_iuPerDeviceUnit;
  }

  /**
   * `PLOTTER::GetDotMarkLenIU` and friends. Despite the `IU` in the names these
   * are already in *device* units — userToDeviceSize has run. Scaling them
   * again in setSVGPlotStyle would square the plot scale.
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
  // Graphics context
  // =========================================================================

  /** `setFillMode`. Only a *change* dirties the context. */
  private setFillMode(aFill: FILL_T): void {
    if (this.m_fillMode !== aFill) {
      this.m_graphics_changed = true;
      this.m_fillMode = aFill;
    }
  }

  /**
   * `setSVGPlotStyle`. With aIsGroup (the default) this closes the open group
   * and opens a new one, and only then is the context clean again; PlotPoly
   * passes false, writes the style straight onto its own `<path>` element, and
   * so leaves the context dirty for whatever comes next.
   *
   * The dash geometry is recomputed from *this call's* width, not from the
   * width SetDash was given — SetDash discards its width argument entirely.
   */
  private setSVGPlotStyle(aLineWidth: number, aIsGroup = true, aExtraStyle = ''): void {
    if (aIsGroup) this.emit('</g>\n<g ');

    this.emit('style="');

    if (this.m_fillMode === FILL_T.NO_FILL) {
      this.emit('fill:none; ');
    } else {
      // output the background fill color
      this.emit(`fill:#${hex6(this.m_brush_rgb_color)}; `);

      switch (this.m_fillMode) {
        case FILL_T.FILLED_SHAPE:
        case FILL_T.FILLED_WITH_BG_BODYCOLOR:
        case FILL_T.FILLED_WITH_COLOR:
          this.emit(`fill-opacity:${fixed(this.m_brush_alpha, this.m_precision)}; `);
          break;
        default:
          break;
      }
    }

    const pen_w = this.userToDeviceSize(aLineWidth);

    if (pen_w <= 0) {
      this.emit('stroke:none;');
    } else {
      // Inkscape mishandles stroke widths below 100 nm when degrouping, hence
      // the four-digit cap on the mantissa.
      this.emit(
        `\nstroke:#${hex6(this.m_pen_rgb_color)}; ` +
          `stroke-width:${fixed(pen_w, this.m_precision)}; stroke-opacity:1; \n`,
      );
      this.emit('stroke-linecap:round; stroke-linejoin:round;');

      const p = this.m_precision;
      const d = DEFAULT_FMT_PRECISION;

      switch (this.m_dashed) {
        case LINE_STYLE.DASH:
          this.emit(
            `stroke-dasharray:${fixed(this.GetDashMarkLenIU(aLineWidth), p)},` +
              `${fixed(this.GetDashGapLenIU(aLineWidth), p)};`,
          );
          break;

        // DOT and below use a bare {:f}, i.e. six decimals, not m_precision.
        case LINE_STYLE.DOT:
          this.emit(
            `stroke-dasharray:${fixed(this.GetDotMarkLenIU(aLineWidth), d)},` +
              `${fixed(this.GetDashGapLenIU(aLineWidth), d)};`,
          );
          break;

        case LINE_STYLE.DASHDOT:
          this.emit(
            `stroke-dasharray:${fixed(this.GetDashMarkLenIU(aLineWidth), d)},` +
              `${fixed(this.GetDashGapLenIU(aLineWidth), d)},` +
              `${fixed(this.GetDotMarkLenIU(aLineWidth), d)},` +
              `${fixed(this.GetDashGapLenIU(aLineWidth), d)};`,
          );
          break;

        case LINE_STYLE.DASHDOTDOT:
          this.emit(
            `stroke-dasharray:${fixed(this.GetDashMarkLenIU(aLineWidth), d)},` +
              `${fixed(this.GetDashGapLenIU(aLineWidth), d)},` +
              `${fixed(this.GetDotMarkLenIU(aLineWidth), d)},` +
              `${fixed(this.GetDashGapLenIU(aLineWidth), d)},` +
              `${fixed(this.GetDotMarkLenIU(aLineWidth), d)},` +
              `${fixed(this.GetDashGapLenIU(aLineWidth), d)};`,
          );
          break;

        case LINE_STYLE.DEFAULT:
        case LINE_STYLE.SOLID:
        default:
          // do nothing
          break;
      }
    }

    if (aExtraStyle.length) this.emit(aExtraStyle);

    this.emit('"');

    if (aIsGroup) {
      this.emit('>');
      this.m_graphics_changed = false;
    }

    this.emit('\n');
  }

  /**
   * `SetCurrentLineWidth`. DO_NOT_SET_LINE_WIDTH is an early *return*: the pen
   * keeps its old value and the context is not dirtied. Width 0 is legal and
   * means "filled shape with no outline", which setSVGPlotStyle renders as
   * `stroke:none`.
   *
   * Any *other* negative width only trips a `wxASSERT_MSG`, which is compiled
   * out of a release build and merely logs in a debug one — execution continues
   * and the negative value is stored. Text relies on that: it hands
   * SetCurrentLineWidth the raw stroke width before PLOTTER::Text takes the
   * magnitude, so a caller with a negative stroke width transiently sets a
   * negative pen and gets one `stroke:none` style out of it. Throwing here
   * would turn a logged warning into a failed plot.
   */
  SetCurrentLineWidth(aWidth: number, _aData?: unknown): void {
    let width = aWidth;

    if (width === DO_NOT_SET_LINE_WIDTH) return;
    else if (width === USE_DEFAULT_LINE_WIDTH) width = this.m_renderSettings.GetDefaultPenWidth();

    if (width !== this.m_currentPenWidth) {
      this.m_graphics_changed = true;
      this.m_currentPenWidth = width;
    }
  }

  GetCurrentLineWidth(): number {
    return this.m_currentPenWidth;
  }

  /**
   * `emitSetRGBColor`. The channels are *truncated*, not rounded, so r = 0.5
   * gives 0x7F. Pen and brush always carry the same triple; only the brush
   * carries the alpha.
   */
  private emitSetRGBColor(r: number, g: number, b: number, a: number): void {
    const red = Math.trunc(255.0 * r);
    const green = Math.trunc(255.0 * g);
    const blue = Math.trunc(255.0 * b);
    const rgb_color = ((red << 16) | (green << 8) | blue) >>> 0;

    if (this.m_pen_rgb_color !== rgb_color || this.m_brush_alpha !== a) {
      this.m_graphics_changed = true;
      this.m_pen_rgb_color = rgb_color;

      // Currently, use the same color for brush and pen.
      this.m_brush_rgb_color = rgb_color;
      this.m_brush_alpha = a;
    }
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

  /** `SetDash`. The width argument is ignored; only a *change* dirties. */
  SetDash(_aLineWidth: number, aLineStyle: LINE_STYLE): void {
    if (this.m_dashed !== aLineStyle) {
      this.m_graphics_changed = true;
      this.m_dashed = aLineStyle;
    }
  }

  /**
   * `StartBlock` / `EndBlock`. Deliberately empty: `<g>` is already spoken for
   * by the lazy graphics context, which leaves its last group open, so a block
   * cannot nest inside it.
   */
  StartBlock(_aData?: unknown): void {
    // Intentionally empty, as upstream is.
  }

  EndBlock(_aData?: unknown): void {
    // Intentionally empty, as upstream is.
  }

  /**
   * `StartLayer`. Flushes any pending context first so the layer group is a
   * sibling of the style group rather than a child of a half-written one. The
   * layer name is *not* escaped, so a name containing `&` or `"` produces
   * invalid XML — upstream's behaviour, and it has no callers in the KiCad tree
   * to have noticed.
   */
  StartLayer(aLayerName: string): void {
    if (this.m_graphics_changed) this.setSVGPlotStyle(this.GetCurrentLineWidth());

    this.emit(`<g id="${aLayerName}" inkscape:label="${aLayerName}" inkscape:groupmode="layer">\n`);
  }

  /** `EndLayer`: closes the context group and the layer group, then dirties. */
  EndLayer(): void {
    this.emit('</g>\n');
    this.emit('</g>\n');
    this.m_graphics_changed = true; // Force new graphics context on next draw
  }

  // =========================================================================
  // File skeleton
  // =========================================================================

  /**
   * `StartPlot`. The header opens a `<g>` that nothing ever closes on purpose:
   * m_graphics_changed is left true, so the first primitive emits `</g><g …>`
   * and the balance works out to the single `</g>` EndPlot writes.
   *
   * `origin` is upstream's zero-initialised VECTOR2D with a "TODO set to actual
   * value" beside it, so the viewBox always starts at 0 0.
   */
  StartPlot(_aPageNumber = '', aNow: Date = new Date()): boolean {
    const header =
      '<?xml version="1.0" standalone="no"?>\n' +
      ' <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" \n' +
      ' "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"> \n' +
      '<svg\n' +
      '  xmlns:svg="http://www.w3.org/2000/svg"\n' +
      '  xmlns="http://www.w3.org/2000/svg"\n' +
      '  xmlns:xlink="http://www.w3.org/1999/xlink"\n' +
      '  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"\n' +
      '  version="1.1"\n';

    this.emit(header);

    const p = this.m_precision;
    const origin = { x: 0, y: 0 };

    this.emit(
      `  width="${fixed(((this.m_paperSize.x / this.m_IUsPerDecimil) * 2.54) / 1000, p)}mm"` +
        ` height="${fixed(((this.m_paperSize.y / this.m_IUsPerDecimil) * 2.54) / 1000, p)}mm"` +
        ` viewBox="${fixed(origin.x, p)} ${fixed(origin.y, p)}` +
        ` ${fixed(this.m_paperSize.x * this.m_iuPerDeviceUnit, p)}` +
        ` ${fixed(this.m_paperSize.y * this.m_iuPerDeviceUnit, p)}">\n`,
    );

    const date = GetISO8601CurrentDateTime(aNow);

    this.emit(
      `<title>SVG Image created as ${XmlEsc(fullName(this.m_filename))} date ${date} </title>\n`,
    );

    this.emit(`  <desc>Image generated by ${XmlEsc(this.m_creator)} </desc>\n`);

    // output the pen and brush color (RVB values in hex) and opacity
    const opacity = 1.0; // 0.0 (transparent) to 1.0 (solid)

    this.emit(
      `<g style="fill:#${hex6(this.m_brush_rgb_color)}; ` +
        `fill-opacity:${fixed(this.m_brush_alpha, p)};` +
        `stroke:#${hex6(this.m_pen_rgb_color)}; stroke-opacity:${fixed(opacity, p)};\n`,
    );

    this.emit('stroke-linecap:round; stroke-linejoin:round;"\n');
    this.emit(' transform="translate(0 0) scale(1 1)">\n');

    return true;
  }

  /** `EndPlot`. Mind the space between `</g>` and the newline. */
  EndPlot(): boolean {
    this.emit('</g> \n</svg>\n');
    return true;
  }

  // =========================================================================
  // Entities
  // =========================================================================

  /**
   * `Rect`. Normalised twice — once in user space, once in device space —
   * because the transform can flip the sign of an extent and Inkscape refuses a
   * negative or zero width. For SVG it is the *horizontal mirror* that does the
   * flipping, not Y: the reversed axis cancels the paper flip, so an unmirrored
   * plot never needs the second pass and only a mirrored one shows it working.
   *
   * The zero test is an exact float compare on the *device* size, and a
   * degenerate rectangle degrades to a `<line>` at m_precision while the real
   * `<rect>` uses six decimals throughout.
   */
  Rect(p1: Vec2, p2: Vec2, fill: FILL_T, width: number, aCornerRadius = 0): void {
    const rect = normalizedBox(p1, { x: p2.x - p1.x, y: p2.y - p1.y });

    const org_dev = this.userToDeviceCoordinates(rect.pos);
    const end_dev = this.userToDeviceCoordinates({
      x: rect.pos.x + rect.size.x,
      y: rect.pos.y + rect.size.y,
    });
    const size_dev = { x: end_dev.x - org_dev.x, y: end_dev.y - org_dev.y };

    const rect_dev = normalizedBox(org_dev, size_dev);

    this.setFillMode(fill);
    this.SetCurrentLineWidth(width);

    if (this.m_graphics_changed) this.setSVGPlotStyle(this.GetCurrentLineWidth());

    const p = this.m_precision;
    const d = DEFAULT_FMT_PRECISION;

    if (rect_dev.size.x === 0.0 || rect_dev.size.y === 0.0) {
      // Rectangles with a zero side are not drawn by Inkscape, so draw a line.
      this.emit(
        `<line x1="${fixed(rect_dev.pos.x, p)}" y1="${fixed(rect_dev.pos.y, p)}"` +
          ` x2="${fixed(rect_dev.pos.x + rect_dev.size.x, p)}"` +
          ` y2="${fixed(rect_dev.pos.y + rect_dev.size.y, p)}" />\n`,
      );
    } else {
      this.emit(
        `<rect x="${fixed(rect_dev.pos.x, d)}" y="${fixed(rect_dev.pos.y, d)}"` +
          ` width="${fixed(rect_dev.size.x, d)}" height="${fixed(rect_dev.size.y, d)}"` +
          ` rx="${fixed(this.userToDeviceSize(aCornerRadius), d)}" />\n`,
      );
    }
  }

  /**
   * `Circle`. The thin-circle branch is subtle and its subtlety is the point:
   * the style is flushed *before* the branch runs, so switching to FILLED_SHAPE
   * and a zero pen there changes nothing about the element being written — it
   * still comes out stroked and unfilled, just with the radius grown to
   * `d/2 + w/2`. Both state changes leak to the next primitive, which is where
   * they finally take effect.
   */
  Circle(pos: Vec2, diametre: number, fill: FILL_T, width: number): void {
    const pos_dev = this.userToDeviceCoordinates(pos);
    let radius = this.userToDeviceSize(diametre / 2.0);

    this.setFillMode(fill);
    this.SetCurrentLineWidth(width);

    if (this.m_graphics_changed) this.setSVGPlotStyle(this.GetCurrentLineWidth());

    // If diameter is less than width, switch to filled mode
    if (fill === FILL_T.NO_FILL && diametre < this.GetCurrentLineWidth()) {
      this.setFillMode(FILL_T.FILLED_SHAPE);
      const w = this.GetCurrentLineWidth();
      this.SetCurrentLineWidth(0);

      radius = this.userToDeviceSize(diametre / 2.0 + w / 2.0);
    }

    const p = this.m_precision;

    this.emit(
      `<circle cx="${fixed(pos_dev.x, p)}" cy="${fixed(pos_dev.y, p)}" r="${fixed(radius, p)}" /> \n`,
    );
  }

  /**
   * `Arc`. A non-positive radius is turned into a *filled circle whose diameter
   * is the line width* — `Circle( aCenter, aWidth, … )` really does pass the
   * width into the diameter slot.
   *
   * The horizontal-mirror branch swaps the angles and then reflects each about
   * 180 degrees; the vertical branch negates both without swapping, which can
   * leave endAngle behind startAngle. The theta normalisation below is what
   * rescues that, and it is also what decides flg_arc. flg_sweep is a constant
   * zero, so a clockwise arc is expressed purely through the angle ordering.
   *
   * A filled arc emits *two* paths: the pie wedge with a zero pen, then the
   * stroked arc with no fill.
   */
  Arc(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aFill: FILL_T,
    aWidth: number,
  ): void {
    if (aRadius <= 0) {
      this.Circle(toVector2I(aCenter), aWidth, FILL_T.FILLED_SHAPE, 0);
      return;
    }

    let startAngle = aStartAngle.negate();
    let endAngle = startAngle.sub(aAngle);

    if (endAngle.lt(startAngle)) [startAngle, endAngle] = [endAngle, startAngle];

    const centre_device = this.userToDeviceCoordinates(toVector2I(aCenter));
    const radius_device = this.userToDeviceSize(aRadius);

    if (this.m_plotMirror) {
      if (this.m_mirrorIsHorizontal) {
        [startAngle, endAngle] = [endAngle, startAngle];
        startAngle = ANGLE_180.sub(startAngle);
        endAngle = ANGLE_180.sub(endAngle);
      } else {
        startAngle = startAngle.negate();
        endAngle = endAngle.negate();
      }
    }

    let start = { x: radius_device, y: 0 };
    start = rotatePointD(start, startAngle);
    let end = { x: radius_device, y: 0 };
    end = rotatePointD(end, endAngle);
    start = { x: start.x + centre_device.x, y: start.y + centre_device.y };
    end = { x: end.x + centre_device.x, y: end.y + centre_device.y };

    let theta1 = startAngle.AsRadians();

    if (theta1 < 0) theta1 = theta1 + Math.PI * 2;

    let theta2 = endAngle.AsRadians();

    if (theta2 < 0) theta2 = theta2 + Math.PI * 2;

    if (theta2 < theta1) theta2 = theta2 + Math.PI * 2;

    let flg_arc = 0; // flag for large or small arc. 0 means less than 180 degrees

    if (Math.abs(theta2 - theta1) > Math.PI) flg_arc = 1;

    const flg_sweep = 0; // flag for sweep always 0
    const p = this.m_precision;

    if (aFill !== FILL_T.NO_FILL) {
      // Filled arcs (in Eeschema) consist of the pie wedge and a stroke only on
      // the arc, so they need two elements.
      this.setFillMode(aFill);
      this.SetCurrentLineWidth(0);

      if (this.m_graphics_changed) this.setSVGPlotStyle(this.GetCurrentLineWidth());

      this.emit(
        `<path d="M${fixed(start.x, p)} ${fixed(start.y, p)}` +
          ` A${fixed(radius_device, p)} ${fixed(radius_device, p)} 0.0 ${flg_arc} ${flg_sweep}` +
          ` ${fixed(end.x, p)} ${fixed(end.y, p)}` +
          ` L ${fixed(centre_device.x, p)} ${fixed(centre_device.y, p)} Z" />\n`,
      );
    }

    this.setFillMode(FILL_T.NO_FILL);
    this.SetCurrentLineWidth(aWidth);

    if (this.m_graphics_changed) this.setSVGPlotStyle(this.GetCurrentLineWidth());

    this.emit(
      `<path d="M${fixed(start.x, p)} ${fixed(start.y, p)}` +
        ` A${fixed(radius_device, p)} ${fixed(radius_device, p)} 0.0 ${flg_arc} ${flg_sweep}` +
        ` ${fixed(end.x, p)} ${fixed(end.y, p)}" />\n`,
    );
  }

  /**
   * `PLOTTER::Arc( start, mid, end, … )`, inherited unchanged: it derives the
   * centre and sweep and defers to the override above. `det <= 0` counts a
   * collinear triple as clockwise, so a degenerate arc normalises positive.
   */
  ArcThroughPoints(aStart: Vec2, aMid: Vec2, aEnd: Vec2, aFill: FILL_T, aWidth: number): void {
    const aCenter = CalcArcCenter(aStart, aMid, aEnd);

    const startAngle = EDA_ANGLE.fromVector({
      x: aStart.x - aCenter.x,
      y: aStart.y - aCenter.y,
    });
    const endAngle = EDA_ANGLE.fromVector({
      x: aEnd.x - aCenter.x,
      y: aEnd.y - aCenter.y,
    });

    // < 0: left, 0 : on the line, > 0 : right
    const det =
      (aEnd.x - aStart.x) * (aMid.y - aStart.y) - (aEnd.y - aStart.y) * (aMid.x - aStart.x);

    const cw = det <= 0;
    const angle = endAngle.sub(startAngle);

    if (cw) angle.Normalize();
    else angle.NormalizeNegative();

    const radius = euclideanNormD({
      x: aStart.x - aCenter.x,
      y: aStart.y - aCenter.y,
    });
    this.Arc(aCenter, startAngle, angle, radius, aFill, aWidth);
  }

  /**
   * `BezierCurve`. Upstream keeps the flattening fallback behind an `#if 1`, so
   * aTolerance is dead and a real cubic goes out; the `C` command takes three
   * points because the current point is the start.
   */
  BezierCurve(
    aStart: Vec2,
    aControl1: Vec2,
    aControl2: Vec2,
    aEnd: Vec2,
    _aTolerance: number,
    aLineThickness: number,
  ): void {
    this.setFillMode(FILL_T.NO_FILL);
    this.SetCurrentLineWidth(aLineThickness);

    if (this.m_graphics_changed) this.setSVGPlotStyle(this.GetCurrentLineWidth());

    const start = this.userToDeviceCoordinates(aStart);
    const ctrl1 = this.userToDeviceCoordinates(aControl1);
    const ctrl2 = this.userToDeviceCoordinates(aControl2);
    const end = this.userToDeviceCoordinates(aEnd);
    const p = this.m_precision;

    this.emit(
      `<path d="M${fixed(start.x, p)},${fixed(start.y, p)}` +
        ` C${fixed(ctrl1.x, p)},${fixed(ctrl1.y, p)}` +
        ` ${fixed(ctrl2.x, p)},${fixed(ctrl2.y, p)}` +
        ` ${fixed(end.x, p)},${fixed(end.y, p)}" />\n`,
    );
  }

  /**
   * `PlotPoly( const std::vector<VECTOR2I>& )`. Three things here look wrong and
   * are not: the style is emitted with the *raw* aWidth, so a caller passing a
   * sentinel gets `stroke:none` even though the pen was set correctly; it asks
   * for a non-group style, which leaves the context dirty so the next primitive
   * still opens a group; and the vertex loop stops one short of the end, the
   * last point being either replaced by `Z` (on an exact integer match with the
   * first) or written after the loop.
   *
   * A hatch fill still calls setFillMode, so the style opens with
   * `fill:#RRGGBB` and is only countermanded by the `fill:none` appended after
   * it — CSS source order is doing the work.
   */
  PlotPoly(aCornerList: readonly Vec2[], aFill: FILL_T, aWidth: number, _aData?: unknown): void {
    if (aCornerList.length <= 1) return;

    this.setFillMode(aFill);
    this.SetCurrentLineWidth(aWidth);
    this.emit('<path ');

    switch (aFill) {
      case FILL_T.NO_FILL:
      case FILL_T.HATCH:
      case FILL_T.REVERSE_HATCH:
      case FILL_T.CROSS_HATCH:
        this.setSVGPlotStyle(aWidth, false, 'fill:none');
        break;

      case FILL_T.FILLED_WITH_BG_BODYCOLOR:
      case FILL_T.FILLED_SHAPE:
      case FILL_T.FILLED_WITH_COLOR:
        this.setSVGPlotStyle(aWidth, false, 'fill-rule:evenodd;');
        break;
    }

    const p = this.m_precision;
    let pos = this.userToDeviceCoordinates(aCornerList[0]!);
    this.emit(`d="M ${fixed(pos.x, p)},${fixed(pos.y, p)}\n`);

    for (let ii = 1; ii < aCornerList.length - 1; ii++) {
      pos = this.userToDeviceCoordinates(aCornerList[ii]!);
      this.emit(`${fixed(pos.x, p)},${fixed(pos.y, p)}\n`);
    }

    const first = aCornerList[0]!;
    const last = aCornerList[aCornerList.length - 1]!;

    // If the corner list ends where it begins, then close the poly
    if (first.x === last.x && first.y === last.y) {
      this.emit('Z" /> \n');
    } else {
      pos = this.userToDeviceCoordinates(last);
      this.emit(`${fixed(pos.x, p)},${fixed(pos.y, p)}\n" /> \n`);
    }
  }

  /**
   * `PlotImage`. The start corner is computed in *doubles* and then truncated
   * into a VECTOR2I, which is not the same as the base class's integer halving
   * — see plotterPlotImage below, which the degenerate branch falls back to.
   *
   * The x/y of the `<image>` use six decimals while its width/height use
   * m_precision, and the base64 payload is broken with a newline after every
   * 64th character (i.e. after index 63, 127, …). The element is left without a
   * trailing newline, exactly as upstream leaves it.
   */
  PlotImage(aImage: SvgImage, aPos: Vec2, aScaleFactor: number): void {
    const pix_size = { x: aImage.GetWidth(), y: aImage.GetHeight() };

    // Requested size (in IUs)
    const drawsize = {
      x: aScaleFactor * pix_size.x,
      y: aScaleFactor * pix_size.y,
    };

    // calculate the bitmap start position
    const start = toVector2I({
      x: aPos.x - drawsize.x / 2,
      y: aPos.y - drawsize.y / 2,
    });

    if (drawsize.x === 0.0 || drawsize.y === 0.0) {
      // Rectangles with a zero side are not drawn by Inkscape, so draw a line.
      this.plotterPlotImage(aImage, aPos, aScaleFactor);
    } else {
      const png = this.m_colorMode
        ? aImage.SaveFilePng()
        : aImage.ConvertToGreyscale().SaveFilePng();

      const encoded = base64Encode(png);

      const pos = this.userToDeviceCoordinates(start);
      const d = DEFAULT_FMT_PRECISION;

      this.emit(
        `<image x="${fixed(pos.x, d)}" y="${fixed(pos.y, d)}" xlink:href="data:image/png;base64,`,
      );

      for (let i = 0; i < encoded.length; i++) {
        this.emit(encoded[i]!);

        if (i % 64 === 63) this.emit('\n');
      }

      const p = this.m_precision;

      this.emit(
        `"\npreserveAspectRatio="none"` +
          ` width="${fixed(this.userToDeviceSize(drawsize.x), p)}"` +
          ` height="${fixed(this.userToDeviceSize(drawsize.y), p)}" />`,
      );
    }
  }

  /**
   * `PLOTTER::PlotImage`, the degenerate fallback: an outline rectangle at the
   * default pen width. Its halving is *integer* division on an already
   * truncated size, so it can land one IU away from the override's corner.
   */
  private plotterPlotImage(aImage: SvgImage, aPos: Vec2, aScaleFactor: number): void {
    const size = toVector2I({
      x: aImage.GetWidth() * aScaleFactor,
      y: aImage.GetHeight() * aScaleFactor,
    });

    const start = {
      x: aPos.x - Math.trunc(size.x / 2),
      y: aPos.y - Math.trunc(size.y / 2),
    };
    const end = { x: start.x + size.x, y: start.y + size.y };

    this.Rect(start, end, FILL_T.NO_FILL, USE_DEFAULT_LINE_WIDTH, 0);
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
   * `PenTo`. There is no mid-path moveto: once a path is open a 'U' plume emits
   * an `L`, exactly like a 'D' would, so two disjoint polylines need an explicit
   * PenFinish between them. 'Z' closes the element and parks the pen at
   * (-1,-1), which is what makes the *next* 'U' open a fresh path.
   *
   * Opening a path forces NO_FILL first — an open contour must not be filled —
   * and that fill change is what dirties the context, so the style group is
   * emitted before the `<path>` rather than after.
   */
  PenTo(pos: Vec2, plume: 'U' | 'D' | 'Z'): void {
    const p = this.m_precision;

    if (plume === 'Z') {
      if (this.m_penState !== 'Z') {
        this.emit('" />\n');
        this.m_penState = 'Z';
        this.m_penLastpos = { x: -1, y: -1 };
      }

      return;
    }

    if (this.m_penState === 'Z') {
      // here plume = 'D' or 'U'
      const pos_dev = this.userToDeviceCoordinates(pos);

      // Ensure we do not use a fill mode when moving the pen: in SVG mode we
      // are plotting only basic lines, not a filled area.
      if (this.m_fillMode !== FILL_T.NO_FILL) this.setFillMode(FILL_T.NO_FILL);

      if (this.m_graphics_changed) this.setSVGPlotStyle(this.GetCurrentLineWidth());

      this.emit(`<path d="M${fixed(pos_dev.x, p)} ${fixed(pos_dev.y, p)}\n`);
    } else if (
      this.m_penState !== plume ||
      pos.x !== this.m_penLastpos.x ||
      pos.y !== this.m_penLastpos.y
    ) {
      if (this.m_graphics_changed) this.setSVGPlotStyle(this.GetCurrentLineWidth());

      const pos_dev = this.userToDeviceCoordinates(pos);

      this.emit(`L${fixed(pos_dev.x, p)} ${fixed(pos_dev.y, p)}\n`);
    }

    this.m_penState = plume;
    this.m_penLastpos = { x: pos.x, y: pos.y };
  }

  // =========================================================================
  // Text
  // =========================================================================

  /**
   * `Text`. The string goes out *twice*: once as a fully transparent `<text>`
   * so that viewers can search and select it, and once as stroked geometry
   * inside `<g class="stroked-text">` with a `<desc>` for screen readers.
   * m_textMode is never consulted.
   *
   * Two asymmetries are load bearing. The `rotate()` transform pivots on the
   * *original* position while the `<text>` element's x/y are the
   * vertically-justified one, and the rotation angle is negated unless the plot
   * is mirrored. The mirror test is an XOR — `m_plotMirror !== (aSize.x < 0)` —
   * because a negative width is how a mirrored string is encoded, so a mirrored
   * string on a mirrored plot is upright again.
   *
   * `text_size.y` is computed from `aSize.x`, not aSize.y: four thirds of the
   * *width*, as integer arithmetic, converting Hershey height to em size.
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
    aFont: SvgFont | null,
    _aFontMetrics?: unknown,
    _aData?: unknown,
  ): void {
    this.setFillMode(FILL_T.NO_FILL);
    this.SetColor(aColor);
    this.SetCurrentLineWidth(aWidth);

    if (this.m_graphics_changed) this.setSVGPlotStyle(this.GetCurrentLineWidth());

    const text_pos = { x: aPos.x, y: aPos.y };
    let hjust = 'start';

    switch (aH_justify) {
      case GR_TEXT_H_ALIGN_T.CENTER:
        hjust = 'middle';
        break;
      case GR_TEXT_H_ALIGN_T.RIGHT:
        hjust = 'end';
        break;
      case GR_TEXT_H_ALIGN_T.LEFT:
        hjust = 'start';
        break;
    }

    switch (aV_justify) {
      case GR_TEXT_V_ALIGN_T.CENTER:
        text_pos.y += Math.trunc(aSize.y / 2);
        break;
      case GR_TEXT_V_ALIGN_T.TOP:
        text_pos.y += aSize.y;
        break;
      case GR_TEXT_V_ALIGN_T.BOTTOM:
        break;
    }

    if (!aFont) throw new Error('SVG Text needs a font (KIFONT::FONT::GetFont is not ported)');

    // aSize.x or aSize.y is < 0 for mirrored texts; the size is the magnitude.
    const text_size = {
      x: Math.abs(aFont.GRTextWidth(aText, aSize, this.GetCurrentLineWidth(), aBold, aItalic)),
      // Hershey font height to em size conversion, on the WIDTH.
      y: Math.abs(Math.trunc((aSize.x * 4) / 3)),
    };

    const anchor_pos_dev = this.userToDeviceCoordinates(aPos);
    const text_pos_dev = this.userToDeviceCoordinates(text_pos);
    const sz_dev = this.userToDeviceSizeV(text_size);
    const p = this.m_precision;
    const d = DEFAULT_FMT_PRECISION;

    // Output the text as a hidden string (opacity = 0), so that WYSIWYG search
    // can highlight roughly the right area and later processes can edit it.
    if (!aOrient.IsZero()) {
      this.emit(
        `<g transform="rotate(` +
          `${fixed(this.m_plotMirror ? aOrient.AsDegrees() : -aOrient.AsDegrees(), d)}` +
          ` ${fixed(anchor_pos_dev.x, p)} ${fixed(anchor_pos_dev.y, p)})">\n`,
      );
    }

    this.emit(`<text x="${fixed(text_pos_dev.x, p)}" y="${fixed(text_pos_dev.y, p)}"\n`);

    // If the text is mirrored, we should also mirror the hidden text to match
    if (this.m_plotMirror !== aSize.x < 0)
      this.emit(`transform="scale(-1 1) translate(${fixed(-2 * text_pos_dev.x, d)} 0)"\n`);

    this.emit(
      `textLength="${fixed(sz_dev.x, p)}" font-size="${fixed(sz_dev.y, p)}" lengthAdjust="spacingAndGlyphs"\n` +
        `text-anchor="${hjust}" opacity="0" stroke-opacity="0">${XmlEsc(aText)}</text>\n`,
    );

    if (!aOrient.IsZero()) this.emit('</g>\n');

    // Output the text again as graphics with a <desc> tag (for non-WYSIWYG
    // search and for screen readers).
    this.emit(`<g class="stroked-text"><desc>${XmlEsc(aText)}</desc>\n`);

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
    );

    this.emit('</g>');
  }

  /**
   * `PLOTTER::Text`, the glyph stroking half. Every segment the font yields
   * becomes its own `<path>`, because the callback closes the path each time —
   * one element per stroke, which is a lot of elements and is what upstream
   * emits.
   *
   * `@{…}` expression substitution runs here upstream (EXPRESSION_EVALUATOR);
   * it has no counterpart in this repo and is skipped rather than approximated
   * with a regex, so a string containing `@{` plots literally.
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
    aFont: SvgFont,
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

    const attributes: SvgTextAttributes = {
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
      // from SVG_PLOTTER::Text, and then silently discarded. Passing false here
      // would make single-line-only callers behave differently from upstream.
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
   * `PlotText`. A mirrored run is handed to Text as a *negative width*, which is
   * the encoding Text's XOR mirror test then reads back out.
   */
  PlotText(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aAttributes: SvgTextAttributes,
    aFont: SvgFont | null,
    aFontMetrics?: unknown,
    aData?: unknown,
  ): void {
    const size = { x: aAttributes.m_Size.x, y: aAttributes.m_Size.y };

    if (aAttributes.m_Mirrored) size.x = -size.x;

    this.Text(
      aPos,
      aColor,
      aText,
      aAttributes.m_Angle,
      size,
      aAttributes.m_Halign,
      aAttributes.m_Valign,
      aAttributes.m_StrokeWidth,
      aAttributes.m_Italic,
      aAttributes.m_Bold,
      aAttributes.m_Multiline,
      aFont,
      aFontMetrics,
      aData,
    );
  }
}

/**
 * `BOX2::Normalize` folded into the constructor, which already calls it — so
 * `BOX2I rect( p1, size ); rect.Normalize();` normalises once, not twice. The
 * origin moves by the *negated* size, which is why a box built from a
 * bottom-right corner and a negative extent still ends up anchored top-left.
 */
function normalizedBox(aPos: Vec2, aSize: Vec2): { pos: Vec2; size: Vec2 } {
  const pos = { x: aPos.x, y: aPos.y };
  const size = { x: aSize.x, y: aSize.y };

  if (size.y < 0) {
    size.y = -size.y;
    pos.y = pos.y - size.y;
  }

  if (size.x < 0) {
    size.x = -size.x;
    pos.x = pos.x - size.x;
  }

  return { pos, size };
}
