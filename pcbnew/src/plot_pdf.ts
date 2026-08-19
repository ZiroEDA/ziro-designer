// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PDF_PLOTTER, the PDF 1.5 plot back-end, transcribed from
 * common/plotters/PDF_plotter.cpp plus the members it inherits from
 * PSLIKE_PLOTTER (SetColor, SetTextMode, SetScaleAdjust) and PLOTTER
 * (userToDeviceCoordinates, userToDeviceSize, the Get*MarkLenIU dash lengths,
 * the MoveTo/LineTo/FinishTo/PenFinish pen wrappers and the three-point Arc).
 *
 * Unlike DXF and SVG this back-end is not an append-only text emitter: a PDF is
 * a container of numbered indirect objects, and the trailer's cross-reference
 * table records the *byte offset* of every one of them. So the output is bytes,
 * not a string, and the structure is the interface. Four invariants carry the
 * whole file, and getting any of them wrong yields something no viewer opens:
 *
 * 1. Object numbering is a monotone counter with a reserved null object 0.
 *    `allocPdfObject` only extends the xref table; `startPdfObject` is what
 *    fills the offset in. The two are separate because a stream must reserve
 *    its own deferred `/Length` handle *before* its body can allocate more
 *    objects — which page content does, one per image.
 * 2. A stream's length is not known when its dictionary is written, so
 *    `/Length N 0 R` points at an object emitted after the stream closes. That
 *    is the back-patch, and it is why `closePdfStream` writes three objects'
 *    worth of output for one logical stream.
 * 3. Page content is compressed. Upstream accumulates it in a temporary file
 *    and DEFLATEs the lot at ClosePage; here the temporary file is an in-memory
 *    byte buffer and the compressor is injected (`PdfDeflate`), because
 *    pcbnew/src may not reach for a filesystem or a zlib binding.
 * 4. Every xref offset is `ftell` on the *output* file. Anything that changes
 *    the byte count — a stray newline, a UTF-8 expansion — moves every later
 *    object and silently breaks the file. Nothing that reaches the file here is
 *    non-ASCII: `encodeStringForPlotter` hex-escapes anything that is.
 *
 * Faithfully reproduced oddities, none of which is to be "fixed":
 * ClosePage reassigns its `actionHandle` inside the bookmark loop, so the
 * second and subsequent bookmark *groups* on a page hang off the previous
 * group's last bookmark action rather than the page's; StartPage formats an
 * absent parent page as the non-empty string `"Page "`, so ClosePage always
 * runs its parent search and always fails it; the image resource dictionary is
 * opened with `println("<<\n")`, i.e. two newlines; the `/CreationDate` is
 * `D:%Y:%m:%d:%H:%M:%S`, colon-separated, which is not the PDF date syntax;
 * the hyperlink `/Rect` is written `[left bottom right top]` and only comes out
 * in the order PDF wants because `iuToPdfUserSpace` flipped the axis first;
 * `SetDash`'s `pattern.empty()` test is dead, `std::all_of` having already
 * returned true for an empty pattern; and `Circle`'s enlarged thin-circle
 * radius is computed from the *caller's* width while the comparison that
 * triggers it uses the clamped pen, so a sentinel width shrinks it instead.
 *
 * Deliberate gaps, each modelled as an injected dependency rather than
 * approximated: the DEFLATE compressor (`PdfDeflate`), the raster image
 * (`PdfImage`, standing in for wxImage), the page size (`SetPageSettings` takes
 * the mils PAGE_INFO::GetSizeMils would have returned) and the environment
 * variable expansion behind `ResolveUriByEnvVars` (`PdfProject`; passing none
 * mirrors upstream's null PROJECT).
 *
 * Two things are absent rather than injected. `Text` and `PlotText` need the
 * Type 3 stroke-font subsetter (pdf_stroke_font.cpp), the CID outline-font
 * subsetter (pdf_outline_font.cpp, which needs FreeType) and the markup parser;
 * because nothing then registers a glyph, `endPlotEmitResources` writes the
 * same empty font dictionary upstream writes for a text-free document, so this
 * is a gap and not a divergence. `Plot3DModel` is absent too, though
 * `Set3DExport` and the `/3D` annotation it guards are ported: with no model
 * plotted the annotation names handle -1, which is what upstream emits in the
 * same situation.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { CalcArcCenter } from '@ziroeda/kimath/src/trigo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';

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
 * `PLOT_TEXT_MODE` (plotter.h). PSLIKE_PLOTTER's constructor selects PHANTOM and
 * only PDF_PLOTTER::Text ever reads it, so with text unported the member is
 * write-only here. It is kept because SetTextMode is part of the contract a
 * caller drives a PS-like plotter through.
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

/** A `BOX2I` reduced to what HyperlinkBox / Bookmark store: origin plus extent. */
export interface PdfBox2 {
  pos: Vec2;
  size: Vec2;
}

/**
 * `RENDER_SETTINGS`, reduced to the five accessors the plotter reaches for.
 * Injected rather than imported because pcbnew/src must not reach into
 * designer/'s theme. `pdfRenderSettings` below builds a faithful one.
 */
export interface PdfRenderSettings {
  GetDefaultPenWidth(): number;
  GetDashLength(aLineWidth: number): number;
  GetDotLength(aLineWidth: number): number;
  GetGapLength(aLineWidth: number): number;
  /** Only masked image pixels consult this; PDF has no page background. */
  GetBackgroundColor(): Color4d;
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
export function pdfRenderSettings(
  aOptions: {
    defaultPenWidth?: number;
    dashLengthRatio?: number;
    gapLengthRatio?: number;
    backgroundColor?: Color4d;
  } = {},
): PdfRenderSettings {
  const defaultPenWidth = aOptions.defaultPenWidth ?? 0;
  const dashLengthRatio = aOptions.dashLengthRatio ?? DEFAULT_DASH_LENGTH_RATIO;
  const gapLengthRatio = aOptions.gapLengthRatio ?? DEFAULT_GAP_LENGTH_RATIO;
  const backgroundColor = aOptions.backgroundColor ?? COLOR4D_WHITE;

  return {
    GetDefaultPenWidth: () => defaultPenWidth,
    GetDashLength: (aLineWidth) => Math.max(dashLengthRatio - DASH_CORRECTION, 1.0) * aLineWidth,
    GetDotLength: (aLineWidth) => Math.max(1.0 - DASH_CORRECTION, 0.2) * aLineWidth,
    GetGapLength: (aLineWidth) => Math.max(gapLengthRatio + DASH_CORRECTION, 1.0) * aLineWidth,
    GetBackgroundColor: () => backgroundColor,
  };
}

/**
 * `wxImage`, reduced to what PlotImage and the XObject writer use. `GetData` is
 * wxImage's own RGB triplet buffer, which is where GetRed/GetGreen/GetBlue read
 * from and what the deduplicator memcmps; there is no separate accessor here
 * because there is none there either.
 *
 * `GetType` is the wxBitmapType the image was loaded as. The deduplicator
 * compares it, so two pixel-identical images that arrived as PNG and as JPEG
 * are still emitted twice — upstream's behaviour.
 */
export interface PdfImage {
  GetWidth(): number;
  GetHeight(): number;
  /** width * height * 3 bytes, R, G, B per pixel, row-major. */
  GetData(): Uint8Array;
  HasAlpha(): boolean;
  /** width * height bytes; only read when HasAlpha(). */
  GetAlpha(): Uint8Array;
  HasMask(): boolean;
  GetMaskRed(): number;
  GetMaskGreen(): number;
  GetMaskBlue(): number;
  GetType(): number;
}

/**
 * `wxZlibOutputStream( …, wxZ_BEST_COMPRESSION, wxZLIB_ZLIB )`. The PDF spec
 * calls it a DEFLATE stream but wants a *zlib* stream — a two byte header and
 * an Adler-32 tail around the deflate data — which is the comment upstream
 * leaves at the call site. An implementation that emits a raw deflate stream
 * produces a file that opens nowhere.
 */
export type PdfDeflate = (aBytes: Uint8Array) => Uint8Array;

/**
 * `PROJECT`, reduced to the one call the hyperlink writer makes on it:
 * `ResolveUriByEnvVars`, i.e. ExpandTextVars followed by
 * ExpandEnvVarSubstitutions. Neither has a counterpart in this repo, so the
 * whole resolution is injected; omitting it mirrors upstream's null PROJECT,
 * where the URL travels unresolved.
 */
export interface PdfProject {
  ResolveUriByEnvVars(aUri: string): string;
}

// ===========================================================================
// Number formatting
// ===========================================================================

const F64 = new DataView(new ArrayBuffer(8));

/** The IEEE-754 fields of |aValue|, as the exact rational mantissa * 2^exponent. */
function decompose(aValue: number): { mantissa: bigint; exponent: number } {
  F64.setFloat64(0, Math.abs(aValue));

  const hi = F64.getUint32(0);
  const lo = F64.getUint32(4);
  const rawExponent = (hi >>> 20) & 0x7ff;

  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);

  // Subnormals have no implicit leading bit and an exponent of 1, not 0.
  if (rawExponent !== 0) mantissa |= 1n << 52n;

  return { mantissa, exponent: (rawExponent === 0 ? 1 : rawExponent) - 1075 };
}

/**
 * `mantissa * 2^exponent * 10^aScale`, rounded to an integer with ties going to
 * even. Exact by construction: the whole computation is a BigInt rational, so
 * there is no second rounding to disagree with the first.
 */
function scaledRound(aMantissa: bigint, aExponent: number, aScale: number): bigint {
  let numerator = aMantissa;
  let denominator = 1n;

  if (aScale >= 0) numerator *= 10n ** BigInt(aScale);
  else denominator *= 10n ** BigInt(-aScale);

  if (aExponent >= 0) numerator <<= BigInt(aExponent);
  else denominator <<= BigInt(-aExponent);

  let quotient = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;

  if (twiceRemainder > denominator || (twiceRemainder === denominator && (quotient & 1n) === 1n))
    quotient += 1n;

  return quotient;
}

/**
 * fmt's `{:.Nf}`, i.e. C's `%.*f`: the exact binary value of the double is
 * rounded to N decimals with ties going to even, and the sign survives even
 * when the result is zero.
 *
 * `Number.prototype.toFixed` differs on both counts — it rounds ties away from
 * zero and prints negative zero as "0" — so it is not a drop-in. The negative
 * zero matters here specifically: `encodeDoubleForPlotter` recognises `"-0"`
 * and rewrites it, and it can only do that if the minus sign survives.
 */
export function fixed(aValue: number, aPrecision: number): string {
  if (Number.isNaN(aValue)) return 'nan';
  if (!Number.isFinite(aValue)) return aValue > 0 ? 'inf' : '-inf';

  const negative = aValue < 0 || Object.is(aValue, -0);
  const { mantissa, exponent } = decompose(aValue);

  let digits = scaledRound(mantissa, exponent, aPrecision).toString();

  if (aPrecision > 0) {
    digits = digits.padStart(aPrecision + 1, '0');
    digits = `${digits.slice(0, digits.length - aPrecision)}.${digits.slice(digits.length - aPrecision)}`;
  }

  return negative ? `-${digits}` : digits;
}

/** fmt's bare `{:f}`: a hard-coded six decimals. PlotPoly and PenTo use it. */
export const DEFAULT_FMT_PRECISION = 6;

/** printf's default `%g` precision, i.e. six *significant* digits. */
export const FMT_G_PRECISION = 6;

/**
 * fmt's `{:g}`, i.e. C's `%g` at the default precision of six significant
 * digits: pick `%e` when the decimal exponent falls outside `[-4, 6)` and `%f`
 * otherwise, then strip the fractional part's trailing zeros and a bare
 * trailing point.
 *
 * The exponent is decided on the *rounded* value, not the raw one, which is why
 * it is recovered here by rounding to six significant digits and checking the
 * digit count rather than by trusting `Math.log10`. 9.9999995 is a six-digit
 * value whose exponent is 1, not 0.
 */
export function formatG(aValue: number): string {
  if (Number.isNaN(aValue)) return 'nan';
  if (!Number.isFinite(aValue)) return aValue > 0 ? 'inf' : '-inf';

  const negative = aValue < 0 || Object.is(aValue, -0);
  const sign = negative ? '-' : '';

  if (aValue === 0) return `${sign}0`;

  const precision = FMT_G_PRECISION;
  const { mantissa, exponent } = decompose(aValue);
  const low = 10n ** BigInt(precision - 1);
  const high = low * 10n;

  // log10 only seeds the exponent; the loops below make it exact, which is what
  // lets the digits come from BigInt arithmetic rather than from log10's
  // accuracy. The overflow loop is the one that runs — rounding to six
  // significant digits can carry into the next decade, as 9.999999 does. The
  // underflow loop has never been observed to run on V8 and is kept because the
  // invariant it enforces, a significand of exactly `precision` digits, belongs
  // to this function rather than to the standard library.
  let decimalExponent = Math.floor(Math.log10(Math.abs(aValue)));
  let significand = scaledRound(mantissa, exponent, precision - 1 - decimalExponent);

  while (significand >= high) {
    decimalExponent += 1;
    significand = scaledRound(mantissa, exponent, precision - 1 - decimalExponent);
  }

  while (significand < low) {
    decimalExponent -= 1;
    significand = scaledRound(mantissa, exponent, precision - 1 - decimalExponent);
  }

  if (decimalExponent < -4 || decimalExponent >= precision) {
    const digits = significand.toString();
    const fraction = digits.slice(1).replace(/0+$/, '');
    const expSign = decimalExponent < 0 ? '-' : '+';
    const expDigits = String(Math.abs(decimalExponent)).padStart(2, '0');

    return `${sign}${digits[0]}${fraction ? `.${fraction}` : ''}e${expSign}${expDigits}`;
  }

  let out = fixed(Math.abs(aValue), precision - 1 - decimalExponent);

  if (out.includes('.')) {
    out = out.replace(/0+$/, '');
    if (out.endsWith('.')) out = out.slice(0, -1);
  }

  return `${sign}${out}`;
}

/** fmt's `{:0Nd}`: a decimal integer zero-padded to N digits. */
function zeroPad(aValue: number, aWidth: number): string {
  const negative = aValue < 0;
  const digits = String(Math.abs(aValue)).padStart(negative ? aWidth - 1 : aWidth, '0');

  return negative ? `-${digits}` : digits;
}

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

/** `COLOR4D::ToColour`: `(unsigned char)( channel * 255 + 0.5 )`, per channel. */
export function toColour(aColor: Color4d): { r: number; g: number; b: number } {
  return {
    r: Math.trunc(aColor.r * 255 + 0.5) & 0xff,
    g: Math.trunc(aColor.g * 255 + 0.5) & 0xff,
    b: Math.trunc(aColor.b * 255 + 0.5) & 0xff,
  };
}

// ===========================================================================
// Free functions
// ===========================================================================

/**
 * `EDA_TEXT::IsGotoPageHref` (eda_text.cpp:1329). `StartsWith( "#", &rest )`
 * yields the destination page number as the remainder, and only writes through
 * the out-parameter when the prefix matched.
 */
export function IsGotoPageHref(aHref: string): string | null {
  return aHref.startsWith('#') ? aHref.slice(1) : null;
}

/**
 * `NormalizeFileUri` (string_utils.cpp:1536). Note that the colon removal is
 * unconditional over the *whole* remainder, so a Windows drive letter loses its
 * colon: `file://C:/x` normalises to `file:///Cx`. That is upstream's, and the
 * `wxCHECK` means a URI that is not a `file://` one is returned untouched.
 */
export function NormalizeFileUri(aFileUri: string): string {
  if (!aFileUri.startsWith('file://')) return aFileUri;

  let tmp = aFileUri.slice('file://'.length);

  tmp = tmp.replaceAll('\\', '/');
  tmp = tmp.replaceAll(':', '');

  if (tmp.length > 0 && tmp[0] !== '/') tmp = `/${tmp}`;

  return `file://${tmp}`;
}

/**
 * `EscapeString( …, CTX_JS_STR )` (string_utils.cpp:239). The escape is
 * `\uXXXX` via `%4.4X`, so a code point above 0xFFFF produces five hex digits
 * and a JavaScript parser reads the fifth as a literal character — upstream's
 * behaviour, reproduced by iterating code points rather than UTF-16 units.
 */
export function EscapeJsString(aSource: string): string {
  let converted = '';

  for (const c of aSource) {
    const code = c.codePointAt(0)!;

    if (code >= 0x7f || c === "'" || c === '"' || c === '\\' || c === '(' || c === ')')
      converted += `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else converted += c;
  }

  return converted;
}

/**
 * `PDF_PLOTTER::encodeStringForPlotter` (PDF_plotter.cpp:65). ASCII-7 strings
 * travel as a readable literal `(…)` with the three PDF delimiters escaped;
 * anything else becomes a UTF-16BE hex string with a byte-order mark.
 *
 * Two upstream details survive here. DEL (0x7F) counts as *not* ASCII-7, so a
 * string containing it flips the whole encoding to hex. And the hex arm formats
 * a wxString element — a code *point* on the Linux build — with `{:04X}`, so an
 * astral character emits five hex digits and desynchronises the rest of the
 * string. Iterating code units instead would silently fix a real bug.
 */
export function encodeStringForPlotter(aText: string): string {
  let isAscii7 = true;

  for (const c of aText) {
    if (c.codePointAt(0)! >= 0x7f) {
      isAscii7 = false;
      break;
    }
  }

  if (isAscii7) {
    let result = '(';

    for (const c of aText) {
      // These characters must be escaped
      if (c === '(' || c === ')' || c === '\\') result += '\\';

      result += c;
    }

    return `${result})`;
  }

  let result = '<FEFF';

  for (const c of aText) result += c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');

  return `${result}>`;
}

/**
 * `PDF_PLOTTER::encodeByteString` (PDF_plotter.cpp:155). Everything outside
 * printable ASCII becomes a three-digit octal escape, so the result is safe to
 * drop into a PDF literal string whatever the bytes were.
 */
export function encodeByteString(aBytes: Uint8Array): string {
  let result = '(';

  for (const byte of aBytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      result += `\\${String.fromCharCode(byte)}`;
    } else if (byte < 32 || byte > 126) {
      result += `\\${byte.toString(8).padStart(3, '0')}`;
    } else {
      result += String.fromCharCode(byte);
    }
  }

  return `${result})`;
}

/**
 * `fmt::format( "D:{:%Y:%m:%d:%H:%M:%S}", tm )` on a `localtime` struct. The
 * separators are colons throughout, which is *not* the `D:YYYYMMDDHHmmSS`
 * syntax the PDF specification defines for a date; viewers fall back to showing
 * the raw string. Reproduced, not corrected.
 */
export function pdfCreationDate(aNow: Date): string {
  const pad = (aValue: number, aWidth = 2): string => String(aValue).padStart(aWidth, '0');

  return (
    `D:${pad(aNow.getFullYear(), 4)}:${pad(aNow.getMonth() + 1)}:${pad(aNow.getDate())}` +
    `:${pad(aNow.getHours())}:${pad(aNow.getMinutes())}:${pad(aNow.getSeconds())}`
  );
}

/**
 * The `JSInit` script every PDF carries, verbatim from PDF_plotter.cpp:1908.
 * The leading newline is part of the raw string literal and reaches the file.
 */
const PDF_MENU_JS = `
function ShM(aEntries) {
    var aParams = [];
    for (var i = 0; i < aEntries.length; ++i) {
        aParams.push({
            cName: aEntries[i][0],
            cReturn: aEntries[i].length > 1 ? aEntries[i][1] : ''
        })
    }

    var cChoice = app.popUpMenuEx.apply(app, aParams);
    if (cChoice == null || cChoice == '') return;

    if (cChoice.substring(0, 1) == '#') {
        this.pageNum = parseInt(cChoice.slice(1));
        return;
    }

    // Fallback: some viewers return cName instead of cReturn
    var url = cChoice;
    if (url.substring(0, 4) != 'http' && url.substring(0, 4) != 'file') {
        var idx = url.indexOf('http');
        if (idx < 0) idx = url.indexOf('file:');
        if (idx >= 0) url = url.substring(idx);
        else return;
    }

    if (url.substring(0, 8) == 'file:///') app.openDoc(url.substring(7));
    else if (url.substring(0, 7) == 'file://') app.openDoc('//' + url.substring(7));
    else app.launchURL(url);
}
`;

/** `wxIsalpha`, restricted to the C locale the drive-letter test assumes. */
const isAlpha = (aChar: string): boolean => /^[A-Za-z]$/.test(aChar);

/** `PDF_PLOTTER::OUTLINE_NODE`, the bookmark tree the /Outlines object walks. */
interface OutlineNode {
  actionHandle: number;
  title: string;
  entryHandle: number;
  children: OutlineNode[];
}

const newOutlineNode = (aActionHandle = -1, aTitle = '', aEntryHandle = -1): OutlineNode => ({
  actionHandle: aActionHandle,
  title: aTitle,
  entryHandle: aEntryHandle,
  children: [],
});

/**
 * `PDF_PLOTTER` (include/plotters/plotters_pslike.h,
 * common/plotters/PDF_plotter.cpp).
 *
 * Drive it exactly as upstream does: OpenFile / SetCreator / SetPageSettings /
 * SetColorMode / SetViewport, then StartPlot, then geometry, then — for a
 * multi-page document — ClosePage and StartPage between pages, then EndPlot.
 * Read the finished document back with `bytes()`.
 */
export class PdfPlotter {
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
  private m_title = '';
  private m_author = '';
  private m_subject = '';

  // ---- PSLIKE_PLOTTER state ------------------------------------------------
  private plotScaleAdjX = 1;
  private plotScaleAdjY = 1;
  private m_textMode: PLOT_TEXT_MODE = PLOT_TEXT_MODE.PHANTOM;

  // ---- PDF_PLOTTER state ---------------------------------------------------
  private m_pageTreeHandle = 0;
  private m_fontResDictHandle = 0;
  private m_imgResDictHandle = 0;
  private m_jsNamesHandle = 0;
  private m_pageHandles: number[] = [];
  private m_pageStreamHandle = -1;
  private m_streamLengthHandle = 0;
  private m_pageName = '';
  private m_parentPageName = '';
  private m_xrefTable: number[] = [];
  private m_pageNumbers: string[] = [];
  private m_hyperlinksInPage: { box: PdfBox2; url: string }[] = [];
  private m_hyperlinkMenusInPage: { box: PdfBox2; urls: string[] }[] = [];
  private m_hyperlinkHandles = new Map<number, { box: PdfBox2; url: string }>();
  private m_hyperlinkMenuHandles = new Map<number, { box: PdfBox2; urls: string[] }>();
  private m_bookmarksInPage = new Map<string, { box: PdfBox2; ref: string }[]>();
  private m_imageHandles = new Map<number, PdfImage>();
  private m_outlineRoot: OutlineNode = newOutlineNode();
  private m_totalOutlineNodes = 0;
  private m_3dModelHandle = -1;
  private m_3dExportMode = false;

  /** The output file, as bytes. `ftell( m_outputFile )` is `m_outLength`. */
  private m_out: Uint8Array[] = [];
  private m_outLength = 0;
  private m_outputFile = false;

  /** The temporary stream-accumulation file, likewise. Null when closed. */
  private m_work: Uint8Array[] | null = null;
  private m_workLength = 0;

  private readonly m_encoder = new TextEncoder();

  /**
   * `ADVANCED_CFG::GetCfg().m_DebugPDFWriter`. With it set the page content
   * streams are written uncompressed and without a `/Filter`, which is the only
   * way to read a KiCad PDF in a text editor. The injected deflater is then
   * never called.
   */
  private readonly m_debugPdfWriter: boolean;
  private readonly m_project: PdfProject | null;

  constructor(
    private readonly m_renderSettings: PdfRenderSettings,
    private readonly m_deflate: PdfDeflate,
    aOptions: { debugPdfWriter?: boolean; project?: PdfProject } = {},
  ) {
    this.m_debugPdfWriter = aOptions.debugPdfWriter ?? false;
    this.m_project = aOptions.project ?? null;
  }

  static GetDefaultFileExtension(): string {
    return 'pdf';
  }

  // =========================================================================
  // Output buffers
  // =========================================================================

  /** `fmt::print( m_outputFile, … )`. Everything emitted here is ASCII. */
  private out(aText: string): void {
    this.outBytes(this.m_encoder.encode(aText));
  }

  private outBytes(aBytes: Uint8Array): void {
    this.m_out.push(aBytes);
    this.m_outLength += aBytes.length;
  }

  /**
   * `fmt::print( m_workFile, … )`. Upstream guards every one of these with a
   * `wxASSERT( m_workFile )`, which is compiled out of a release build and then
   * hands fmt a null FILE*. Throwing is the honest analogue: a drawing
   * primitive outside a page stream has nowhere to go.
   */
  private work(aText: string): void {
    this.workBytes(this.m_encoder.encode(aText));
  }

  private workBytes(aBytes: Uint8Array): void {
    if (!this.m_work) throw new Error('PDF drawing primitive called outside a page stream');

    this.m_work.push(aBytes);
    this.m_workLength += aBytes.length;
  }

  /** The plotted document. */
  bytes(): Uint8Array {
    const result = new Uint8Array(this.m_outLength);
    let offset = 0;

    for (const chunk of this.m_out) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * The document as Latin-1, i.e. one code unit per byte. Byte offsets in the
   * file are string indices in this view, which is what makes an xref entry
   * checkable from a test without decoding twice.
   */
  text(): string {
    let result = '';

    for (const chunk of this.m_out) {
      for (const byte of chunk) result += String.fromCharCode(byte);
    }

    return result;
  }

  // =========================================================================
  // Setup
  // =========================================================================

  /**
   * `PDF_PLOTTER::OpenFile`. There is no file here — the document accumulates
   * in memory — but the name is still needed: EndPlot falls back to its base
   * name for the `/Title` when none was set.
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

  SetAuthor(aAuthor: string): void {
    this.m_author = aAuthor;
  }

  SetSubject(aSubject: string): void {
    this.m_subject = aSubject;
  }

  /**
   * `PLOTTER::SetPageSettings`, collapsed to the one thing StartPage and
   * ClosePage ask a PAGE_INFO for: `GetSizeMils()`, a VECTOR2D of mils. The
   * page-size table itself is not this module's business.
   */
  SetPageSettings(aSizeMils: Vec2): void {
    this.m_pageSizeMils = { x: aSizeMils.x, y: aSizeMils.y };
  }

  /**
   * `PDF_PLOTTER::SetViewport`. Unlike every other back-end this one does *not*
   * compute the paper size here — the PDF engine handles the page size page by
   * page, in StartPage — and the device unit is one decimil, which is what the
   * `0.0072` CTM in StartPage then converts to PDF points.
   */
  SetViewport(aOffset: Vec2, aIusPerDecimil: number, aScale: number, aMirror: boolean): void {
    this.m_plotMirror = aMirror;
    this.m_plotOffset = aOffset;
    this.m_plotScale = aScale;
    this.m_IUsPerDecimil = aIusPerDecimil;

    // The CTM is set to 1 user unit per decimal
    this.m_iuPerDeviceUnit = 1.0 / aIusPerDecimil;
  }

  /** `PSLIKE_PLOTTER::SetScaleAdjust`, the fine scaling StartPage's CTM folds in. */
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

  /**
   * `PDF_PLOTTER::Set3DExport`. With it set, StartPage writes no content stream,
   * ClosePage adds a `/3D` annotation and EndPlot emits no resources at all.
   * The model itself comes from Plot3DModel, which is not ported, so the
   * annotation's `/3DD` refers to handle -1 — which is exactly what upstream
   * emits when the mode is set and no model is plotted.
   */
  Set3DExport(aYes: boolean): void {
    this.m_3dExportMode = aYes;
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
   * `PLOTTER::userToDeviceCoordinates`. m_yaxisReversed is false for PDF, so the
   * paper flip stands and the result is in decimils with y measured down from
   * the top of the page — which the page CTM then turns the right way up.
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
  // Numeric encoding
  // =========================================================================

  /**
   * `PDF_PLOTTER::encodeDoubleForPlotter`. PDF has no exponent notation, so a
   * `{:g}` that produced one is redone as `%.10f` and then stripped back. The
   * trailing-zero loop looks redundant after `{:g}` — which already strips
   * them — but it is what turns the `%.10f` fallback into something short, and
   * it is what makes a tiny negative collapse to `-0` so the last line can
   * rewrite it as `0`.
   */
  encodeDoubleForPlotter(aValue: number): string {
    let buf = formatG(aValue);

    if (buf.includes('e') || buf.includes('E')) buf = fixed(aValue, 10);

    if (buf.includes('.')) {
      // Trim trailing zeros from fixed output while keeping at least one digit.
      while (buf.length > 1 && buf.endsWith('0')) buf = buf.slice(0, -1);

      // Remove a dangling decimal point if we stripped all fractional digits.
      if (buf.length > 0 && buf.endsWith('.')) buf = buf.slice(0, -1);
    }

    // Avoid emitting "-0" for tiny negative values that round to zero.
    if (buf === '-0') buf = '0';

    return buf;
  }

  // =========================================================================
  // Graphics state
  // =========================================================================

  /**
   * `SetCurrentLineWidth`. A zero width is promoted to 1 because the PDF
   * specification's zero-width line is "one device pixel", which is not a
   * plot. Any *other* negative width only trips a `wxASSERT_MSG`, compiled out
   * of a release build, so it is stored and emitted as-is.
   *
   * The `w` operator is only written when the width *changes*, but the member
   * is assigned either way — so DO_NOT_SET_LINE_WIDTH, which returns early, is
   * the one path that leaves the member alone.
   */
  SetCurrentLineWidth(aWidth: number, _aData?: unknown): void {
    let width = aWidth;

    if (width === DO_NOT_SET_LINE_WIDTH) return;
    else if (width === USE_DEFAULT_LINE_WIDTH) width = this.m_renderSettings.GetDefaultPenWidth();

    if (width === 0) width = 1;

    if (width !== this.m_currentPenWidth)
      this.work(`${this.encodeDoubleForPlotter(this.userToDeviceSize(width))} w\n`);

    this.m_currentPenWidth = width;
  }

  GetCurrentLineWidth(): number {
    return this.m_currentPenWidth;
  }

  /**
   * `emitSetRGBColor`. PDF has no alpha in the graphics state the plotter uses,
   * so a translucent colour is pre-blended against white paper. Both the fill
   * (`rg`) and the stroke (`RG`) colour are set from the same triple, on one
   * line, every time — there is no change detection here at all.
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

    const rs = this.encodeDoubleForPlotter(red);
    const gs = this.encodeDoubleForPlotter(green);
    const bs = this.encodeDoubleForPlotter(blue);

    this.work(`${rs} ${gs} ${bs} rg ${rs} ${gs} ${bs} RG\n`);
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
   * `SetDash`. Each element is *truncated* to an int, so a pattern computed
   * from a small pen width can collapse to all zeros — and a PDF dash array
   * summing to zero makes Acrobat and Evince abandon the rest of the page, so
   * that case falls back to solid. The `pattern.empty()` half of the test is
   * dead: `std::all_of` over an empty range is already true.
   */
  SetDash(aLineWidth: number, aLineStyle: LINE_STYLE): void {
    let pattern: number[] = [];

    switch (aLineStyle) {
      case LINE_STYLE.DASH:
        pattern = [
          Math.trunc(this.GetDashMarkLenIU(aLineWidth)),
          Math.trunc(this.GetDashGapLenIU(aLineWidth)),
        ];
        break;

      case LINE_STYLE.DOT:
        pattern = [
          Math.trunc(this.GetDotMarkLenIU(aLineWidth)),
          Math.trunc(this.GetDashGapLenIU(aLineWidth)),
        ];
        break;

      case LINE_STYLE.DASHDOT:
        pattern = [
          Math.trunc(this.GetDashMarkLenIU(aLineWidth)),
          Math.trunc(this.GetDashGapLenIU(aLineWidth)),
          Math.trunc(this.GetDotMarkLenIU(aLineWidth)),
          Math.trunc(this.GetDashGapLenIU(aLineWidth)),
        ];
        break;

      case LINE_STYLE.DASHDOTDOT:
        pattern = [
          Math.trunc(this.GetDashMarkLenIU(aLineWidth)),
          Math.trunc(this.GetDashGapLenIU(aLineWidth)),
          Math.trunc(this.GetDotMarkLenIU(aLineWidth)),
          Math.trunc(this.GetDashGapLenIU(aLineWidth)),
          Math.trunc(this.GetDotMarkLenIU(aLineWidth)),
          Math.trunc(this.GetDashGapLenIU(aLineWidth)),
        ];
        break;

      default:
        break;
    }

    const allZero = pattern.every((v) => v === 0);

    if (pattern.length === 0 || allZero) {
      this.work('[] 0 d\n');
      return;
    }

    this.work(`[${pattern.join(' ')}] 0 d\n`);
  }

  // =========================================================================
  // Entities
  // =========================================================================

  /**
   * `Rect`. An unfilled zero-width rectangle is not drawn at all, a zero-sized
   * one degenerates to a stroked point, and one whose *shorter* side is thinner
   * than the pen is redrawn as a five-point polygon because a stroke wider than
   * the shape it outlines renders badly.
   *
   * The thickness test uses the caller's `width`, not the pen the call above
   * just clamped to at least 1 — so a caller asking for width 0 on a filled
   * rectangle never takes the polygon path.
   */
  Rect(p1: Vec2, p2: Vec2, fill: FILL_T, width: number, aCornerRadius = 0): void {
    if (fill === FILL_T.NO_FILL && width === 0) return;

    this.SetCurrentLineWidth(width);

    if (aCornerRadius > 0) {
      // Needs SHAPE_RECT with a corner radius and the SHAPE_LINE_CHAIN PlotPoly.
      throw new Error('PDF Rect with a corner radius is not ported (needs SHAPE_RECT::SetRadius)');
    }

    const size = { x: p2.x - p1.x, y: p2.y - p1.y };

    if (size.x === 0 && size.y === 0) {
      // Can't draw zero-sized rectangles
      this.MoveTo({ x: p1.x, y: p1.y });
      this.FinishTo({ x: p1.x, y: p1.y });

      return;
    }

    if (Math.min(Math.abs(size.x), Math.abs(size.y)) < width) {
      // Too thick stroked rectangles are buggy, draw as polygon
      const cornerList: Vec2[] = [
        { x: p1.x, y: p1.y },
        { x: p2.x, y: p1.y },
        { x: p2.x, y: p2.y },
        { x: p1.x, y: p2.y },
        { x: p1.x, y: p1.y },
      ];

      this.PlotPoly(cornerList, fill, width);

      return;
    }

    const p1_dev = this.userToDeviceCoordinates(p1);
    const p2_dev = this.userToDeviceCoordinates(p2);

    let paintOp: string;

    if (fill === FILL_T.NO_FILL) paintOp = 'S';
    else paintOp = width > 0 ? 'B' : 'f';

    this.work(
      `${this.encodeDoubleForPlotter(p1_dev.x)} ${this.encodeDoubleForPlotter(p1_dev.y)}` +
        ` ${this.encodeDoubleForPlotter(p2_dev.x - p1_dev.x)}` +
        ` ${this.encodeDoubleForPlotter(p2_dev.y - p1_dev.y)} re ${paintOp}\n`,
    );
  }

  /**
   * `Circle`. PDF has no circle operator, so one is drawn as four cubic Béziers
   * whose control points sit `0.551784 * r` off the axis crossings — the
   * standard approximation, and the constant upstream declines to explain.
   *
   * The thin-circle branch compares the diameter against the *clamped* pen but
   * grows the radius by the *caller's* width. The two agree for an ordinary
   * call and diverge wildly for a sentinel: USE_DEFAULT_LINE_WIDTH resolves the
   * pen to the render settings' default and then *shrinks* the radius by half
   * an internal unit, because -1 is what lands in the arithmetic.
   */
  Circle(pos: Vec2, diametre: number, aFill: FILL_T, width: number): void {
    if (aFill === FILL_T.NO_FILL && width === 0) return;

    this.SetCurrentLineWidth(width);

    let fill = aFill;
    const pos_dev = this.userToDeviceCoordinates(pos);
    let radius = this.userToDeviceSize(diametre / 2.0);

    // If diameter is less than width, switch to filled mode
    if (fill === FILL_T.NO_FILL && diametre < this.GetCurrentLineWidth()) {
      fill = FILL_T.FILLED_SHAPE;
      radius = this.userToDeviceSize(diametre / 2.0 + width / 2.0);
    }

    const magic = radius * 0.551784; // You don't want to know where this come from
    const e = (aValue: number): string => this.encodeDoubleForPlotter(aValue);

    // This is the convex hull for the bezier approximated circle
    this.work(
      `${e(pos_dev.x - radius)} ${e(pos_dev.y)} m ` +
        `${e(pos_dev.x - radius)} ${e(pos_dev.y + magic)} ` +
        `${e(pos_dev.x - magic)} ${e(pos_dev.y + radius)} ` +
        `${e(pos_dev.x)} ${e(pos_dev.y + radius)} c ` +
        `${e(pos_dev.x + magic)} ${e(pos_dev.y + radius)} ` +
        `${e(pos_dev.x + radius)} ${e(pos_dev.y + magic)} ` +
        `${e(pos_dev.x + radius)} ${e(pos_dev.y)} c ` +
        `${e(pos_dev.x + radius)} ${e(pos_dev.y - magic)} ` +
        `${e(pos_dev.x + magic)} ${e(pos_dev.y - radius)} ` +
        `${e(pos_dev.x)} ${e(pos_dev.y - radius)} c ` +
        `${e(pos_dev.x - magic)} ${e(pos_dev.y - radius)} ` +
        `${e(pos_dev.x - radius)} ${e(pos_dev.y - magic)} ` +
        `${e(pos_dev.x - radius)} ${e(pos_dev.y)} c ` +
        `${fill === FILL_T.NO_FILL ? 's' : 'b'}\n`,
    );
  }

  /**
   * `arcPath`. PDF cannot express a circular arc, so it is flattened at a fixed
   * five-degree step. The start angle is negated once for the sweep and again
   * at each sample, so the first point sits at the caller's start angle unless
   * the ordering swap fired; the loop bound is strictly `<`, which is why the
   * penultimate sample never coincides with the explicit end point.
   */
  private arcPath(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
  ): Vec2[] {
    const path: Vec2[] = [];

    let startAngle = aStartAngle.negate();
    let endAngle = startAngle.sub(aAngle);
    const delta = new EDA_ANGLE(5); // increment to draw circles

    if (startAngle.gt(endAngle)) [startAngle, endAngle] = [endAngle, startAngle];

    // Usual trig arc plotting routine...
    path.push(
      this.userToDeviceCoordinates({
        x: KiROUND(aCenter.x + aRadius * startAngle.negate().Cos()),
        y: KiROUND(aCenter.y + aRadius * startAngle.negate().Sin()),
      }),
    );

    for (let ii = startAngle.add(delta); ii.lt(endAngle); ii = ii.add(delta)) {
      path.push(
        this.userToDeviceCoordinates({
          x: KiROUND(aCenter.x + aRadius * ii.negate().Cos()),
          y: KiROUND(aCenter.y + aRadius * ii.negate().Sin()),
        }),
      );
    }

    path.push(
      this.userToDeviceCoordinates({
        x: KiROUND(aCenter.x + aRadius * endAngle.negate().Cos()),
        y: KiROUND(aCenter.y + aRadius * endAngle.negate().Sin()),
      }),
    );

    return path;
  }

  /**
   * `Arc`. The pen is set *before* the degenerate check, so a non-positive
   * radius becomes a filled circle whose diameter is the clamped pen width —
   * which for a caller passing width 0 is 1 IU, not 0.
   *
   * A filled arc is closed back to the centre and painted with `b` (close, fill
   * and stroke), so the pie's two straight edges are stroked too; an unfilled
   * one is left open and merely stroked.
   */
  Arc(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aFill: FILL_T,
    aWidth: number,
  ): void {
    this.SetCurrentLineWidth(aWidth);

    if (aRadius <= 0) {
      this.Circle(toVector2I(aCenter), this.GetCurrentLineWidth(), FILL_T.FILLED_SHAPE, 0);
      return;
    }

    const path = this.arcPath(aCenter, aStartAngle, aAngle, aRadius);

    if (path.length >= 2) {
      this.work(
        `${this.encodeDoubleForPlotter(path[0]!.x)} ${this.encodeDoubleForPlotter(path[0]!.y)} m `,
      );

      for (let ii = 1; ii < path.length; ++ii) {
        this.work(
          `${this.encodeDoubleForPlotter(path[ii]!.x)} ` +
            `${this.encodeDoubleForPlotter(path[ii]!.y)} l `,
        );
      }
    }

    // The arc is drawn... if not filled we stroke it, otherwise we finish
    // closing the pie at the center
    if (aFill === FILL_T.NO_FILL) {
      this.work('S\n');
    } else {
      const pos_dev = this.userToDeviceCoordinates(aCenter);

      this.work(
        `${this.encodeDoubleForPlotter(pos_dev.x)} ${this.encodeDoubleForPlotter(pos_dev.y)} l b\n`,
      );
    }
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
   * `PlotPoly( const std::vector<VECTOR2I>& )`. Two details set this apart from
   * everything around it: the coordinates go out as a bare `{:f}`, six decimals
   * with the zeros kept, where Rect and Arc use encodeDoubleForPlotter's
   * shortest form; and the paint operator distinguishes a *zero-width* filled
   * polygon (`h f`, closed and filled with no stroke) from a stroked one (`b`).
   *
   * The corner list is not closed here — `h` and `b` do that — so the last
   * point is written like any other.
   */
  PlotPoly(
    aCornerList: readonly Vec2[],
    aFill: FILL_T,
    aWidth: number = USE_DEFAULT_LINE_WIDTH,
    _aData?: unknown,
  ): void {
    if (aCornerList.length <= 1) return;

    if (aFill === FILL_T.NO_FILL && aWidth === 0) return;

    this.SetCurrentLineWidth(aWidth);

    const d = DEFAULT_FMT_PRECISION;
    let pos = this.userToDeviceCoordinates(aCornerList[0]!);

    this.work(`${fixed(pos.x, d)} ${fixed(pos.y, d)} m `);

    for (let ii = 1; ii < aCornerList.length; ii++) {
      pos = this.userToDeviceCoordinates(aCornerList[ii]!);
      this.work(`${fixed(pos.x, d)} ${fixed(pos.y, d)} l `);
    }

    // Close path and stroke and/or fill
    if (aFill === FILL_T.NO_FILL) this.work('S\n');
    else if (aWidth === 0) this.work('h f\n');
    else this.work('b\n');
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
   * `PenTo`. 'Z' strokes whatever path is open and parks the pen at (-1,-1),
   * which is what makes the *next* plume emit a fresh `m`. Note that the
   * suppression test compares the *user* position, so a repeated point at the
   * same plume writes nothing even though the device position might differ
   * after a viewport change.
   */
  PenTo(pos: Vec2, plume: 'U' | 'D' | 'Z'): void {
    if (plume === 'Z') {
      if (this.m_penState !== 'Z') {
        this.work('S\n');
        this.m_penState = 'Z';
        this.m_penLastpos = { x: -1, y: -1 };
      }

      return;
    }

    if (
      this.m_penState !== plume ||
      pos.x !== this.m_penLastpos.x ||
      pos.y !== this.m_penLastpos.y
    ) {
      const pos_dev = this.userToDeviceCoordinates(pos);
      const d = DEFAULT_FMT_PRECISION;

      this.work(`${fixed(pos_dev.x, d)} ${fixed(pos_dev.y, d)} ${plume === 'D' ? 'l' : 'm'}\n`);
    }

    this.m_penState = plume;
    this.m_penLastpos = { x: pos.x, y: pos.y };
  }

  // =========================================================================
  // Images
  // =========================================================================

  /**
   * `PlotImage`. Images in PDF are always drawn into the unit square at the
   * origin, so the content stream saves the CTM, concatenates a matrix that
   * scales and translates the unit square onto the target rectangle, invokes
   * the XObject and restores.
   *
   * Note the start corner: x is the *left* edge but y is `aPos.y + drawsize/2`,
   * the bottom edge in IU space, because the device transform flips y and the
   * unit square grows upwards from its origin.
   *
   * Identical images share one XObject. The comparison walks the already
   * registered handles in insertion order and takes the first match, so the
   * handle a repeat gets is the earliest equal one.
   */
  PlotImage(aImage: PdfImage, aPos: Vec2, aScaleFactor: number): void {
    const pix_size = { x: aImage.GetWidth(), y: aImage.GetHeight() };

    // Requested size (in IUs)
    const drawsize = {
      x: aScaleFactor * pix_size.x,
      y: aScaleFactor * pix_size.y,
    };

    // calculate the bitmap start position
    const start = toVector2I({
      x: aPos.x - drawsize.x / 2,
      y: aPos.y + drawsize.y / 2,
    });
    const dev_start = this.userToDeviceCoordinates(start);

    let imgHandle = this.findHandleForImage(aImage);

    if (imgHandle === -1) {
      imgHandle = this.allocPdfObject();
      this.m_imageHandles.set(imgHandle, aImage);
    }

    /* PDF has an uhm... simplified coordinate system handling. There is
       *one* operator to do everything (the PS concat equivalent). At least
       they kept the matrix stack to save restore environments. Also images
       are always emitted at the origin with a size of 1x1 user units. */
    this.work(
      `q ${this.encodeDoubleForPlotter(this.userToDeviceSize(drawsize.x))} 0 0` +
        ` ${this.encodeDoubleForPlotter(this.userToDeviceSize(drawsize.y))}` +
        ` ${this.encodeDoubleForPlotter(dev_start.x)}` +
        ` ${this.encodeDoubleForPlotter(dev_start.y)} cm\n`,
    );

    this.work(`/Im${imgHandle} Do\n`);
    this.work('Q\n');
  }

  /**
   * The `findHandleForImage` lambda inside PlotImage. `IsSameAs` is wxObject
   * reference-data identity, so the first test is a pointer comparison and the
   * rest is a full field-by-field then pixel-by-pixel compare. The type check
   * means a PNG and a JPEG that decoded to the same pixels are *not* merged.
   */
  private findHandleForImage(aCurrImage: PdfImage): number {
    for (const [imgHandle, image] of this.m_imageHandles) {
      if (image === aCurrImage) return imgHandle;

      if (image.GetWidth() !== aCurrImage.GetWidth()) continue;
      if (image.GetHeight() !== aCurrImage.GetHeight()) continue;
      if (image.GetType() !== aCurrImage.GetType()) continue;
      if (image.HasAlpha() !== aCurrImage.HasAlpha()) continue;

      if (
        image.HasMask() !== aCurrImage.HasMask() ||
        image.GetMaskRed() !== aCurrImage.GetMaskRed() ||
        image.GetMaskGreen() !== aCurrImage.GetMaskGreen() ||
        image.GetMaskBlue() !== aCurrImage.GetMaskBlue()
      ) {
        continue;
      }

      const pixCount = image.GetWidth() * image.GetHeight();

      if (!bytesEqual(image.GetData(), aCurrImage.GetData(), pixCount * 3)) continue;

      if (image.HasAlpha() && !bytesEqual(image.GetAlpha(), aCurrImage.GetAlpha(), pixCount))
        continue;

      return imgHandle;
    }

    return -1;
  }

  // =========================================================================
  // Object plumbing
  // =========================================================================

  /**
   * `allocPdfObject`. Reserves the *number* only; the xref entry stays 0 until
   * startPdfObject records where the object actually landed. An object that is
   * allocated and never started keeps a zero offset, which a viewer reads as
   * the free-list head and quietly ignores.
   */
  private allocPdfObject(): number {
    this.m_xrefTable.push(0);
    return this.m_xrefTable.length - 1;
  }

  /** `startPdfObject`. -1 means "allocate one now"; anything else fills it in. */
  private startPdfObject(aHandle = -1): number {
    if (!this.m_outputFile) throw new Error('PDF object started before OpenFile');
    if (this.m_work) throw new Error('PDF object started inside a stream');

    let handle = aHandle;

    if (handle < 0) handle = this.allocPdfObject();

    this.m_xrefTable[handle] = this.m_outLength;
    this.out(`${handle} 0 obj\n`);

    return handle;
  }

  private closePdfObject(): void {
    if (this.m_work) throw new Error('PDF object closed inside a stream');

    this.out('endobj\n');
  }

  /**
   * `startPdfStream`. The `/Length` is an indirect reference because the length
   * is not known yet, and the handle for it must be reserved *here*: the stream
   * body may allocate further objects (an image XObject does), and the deferred
   * length object has to keep the number it was promised.
   */
  private startPdfStream(aHandle = -1): number {
    const handle = this.startPdfObject(aHandle);

    // This is guaranteed to be handle+1 but needs to be allocated since
    // you could allocate more object during stream preparation
    this.m_streamLengthHandle = this.allocPdfObject();

    if (this.m_debugPdfWriter) this.out(`<< /Length ${this.m_streamLengthHandle} 0 R >>\nstream\n`);
    else this.out(`<< /Length ${this.m_streamLengthHandle} 0 R /Filter /FlateDecode >>\nstream\n`);

    // Open a temporary buffer to accumulate the stream
    this.m_work = [];
    this.m_workLength = 0;

    return handle;
  }

  /**
   * `closePdfStream`. One logical stream costs three objects' worth of output:
   * the stream itself, its `endobj`, and then the deferred length as its own
   * indirect object. The length recorded is the length of what was *written* —
   * the compressed byte count, not the plaintext one.
   */
  private closePdfStream(): void {
    if (!this.m_work) throw new Error('PDF stream closed without being started');

    const stream_len = this.m_workLength;
    const inbuf = new Uint8Array(stream_len);
    let offset = 0;

    for (const chunk of this.m_work) {
      inbuf.set(chunk, offset);
      offset += chunk.length;
    }

    // We are done with the temporary buffer, junk it
    this.m_work = null;
    this.m_workLength = 0;

    let out_count: number;

    if (this.m_debugPdfWriter) {
      out_count = stream_len;
      this.outBytes(inbuf);
    } else {
      const compressed = this.m_deflate(inbuf);

      out_count = compressed.length;
      this.outBytes(compressed);
    }

    this.out('\nendstream\n');
    this.closePdfObject();

    // Writing the deferred length as an indirect object
    this.startPdfObject(this.m_streamLengthHandle);
    this.out(`${out_count}\n`);
    this.closePdfObject();
  }

  // =========================================================================
  // Pages
  // =========================================================================

  /**
   * `StartPage`. The paper size is computed here, not in SetViewport, and with
   * *two* truncations: the mils are a VECTOR2D assigned into a VECTOR2I member,
   * and each `int *= double` truncates again.
   *
   * The parent page name is the load-bearing oddity. With no parent given it
   * formats to `"Page "` — a non-empty string — so ClosePage always runs its
   * outline search and never finds a match, and every page lands at the root.
   * A port that treated the absent parent as an empty string would take the
   * same branch by accident and diverge the moment a real parent was passed.
   *
   * m_currentPenWidth is reset to 0, which works as an "unset" marker only
   * because SetCurrentLineWidth clamps a requested 0 up to 1 and so can never
   * *store* one — every page therefore reissues the `w` operator for whatever
   * width its first primitive asks for.
   */
  StartPage(
    aPageNumber: string,
    aPageName = '',
    aParentPageNumber = '',
    aParentPageName = '',
  ): void {
    if (!this.m_outputFile) throw new Error('PDF page started before OpenFile');
    if (this.m_work) throw new Error('PDF page started inside a stream');

    this.m_pageNumbers.push(aPageNumber);
    this.m_pageName =
      aPageName === '' ? `Page ${aPageNumber}` : `${aPageName} (Page ${aPageNumber})`;
    this.m_parentPageName =
      aParentPageName === ''
        ? `Page ${aParentPageNumber}`
        : `${aParentPageName} (Page ${aParentPageNumber})`;

    // Compute the paper size in IUs
    const paperSize = toVector2I(this.m_pageSizeMils);

    this.m_paperSize = {
      x: Math.trunc(paperSize.x * (10.0 / this.m_iuPerDeviceUnit)),
      y: Math.trunc(paperSize.y * (10.0 / this.m_iuPerDeviceUnit)),
    };

    // Set m_currentPenWidth to a unused value to ensure the pen width
    // will be initialized to a the right value in pdf file by the first item to plot
    this.m_currentPenWidth = 0;

    if (!this.m_3dExportMode) {
      // Open the content stream; the page object will go later
      this.m_pageStreamHandle = this.startPdfStream();

      /* Now, until ClosePage *everything* must be wrote in workFile, to be
         compressed later in closePdfStream */

      // Default graphic settings (coordinate system, default color and line style)
      this.work(
        `${this.encodeDoubleForPlotter(0.0072 * this.plotScaleAdjX)} 0 0` +
          ` ${this.encodeDoubleForPlotter(0.0072 * this.plotScaleAdjY)} 0 0 cm 1 J 1 j` +
          ` 0 0 0 rg 0 0 0 RG` +
          ` ${this.encodeDoubleForPlotter(
            this.userToDeviceSize(this.m_renderSettings.GetDefaultPenWidth()),
          )} w\n`,
      );
    }
  }

  /**
   * `ClosePage`. The page object cannot be written until its content stream is
   * closed and its annotations allocated, so the order here is: close the
   * stream, allocate one object per hyperlink and per menu, emit the annotation
   * *array*, then the page dictionary itself.
   *
   * `iuToPdfUserSpace` converts to PDF points and flips y, so the BOX2D built
   * from it has its "top" and "bottom" the other way round from the IU box.
   * That inversion is what makes the `/Rect` written later — which reads
   * `[left bottom right top]` — still come out with the smaller y first, as a
   * PDF rectangle requires.
   *
   * The bookmark loop reassigns `actionHandle`, the variable that carried the
   * page's own GoTo action. After the first group has bookmarks, every later
   * group's outline node points at the last bookmark of the previous group
   * rather than at the page. That is a bug, and it is upstream's.
   */
  ClosePage(): void {
    // non 3d exports need this
    if (this.m_pageStreamHandle !== -1) {
      // Close the page stream (and compress it)
      this.closePdfStream();
    }

    // Page size is in 1/72 of inch (default user space units).
    const PTsPERMIL = 0.072;
    const psPaperSize = {
      x: this.m_pageSizeMils.x * PTsPERMIL,
      y: this.m_pageSizeMils.y * PTsPERMIL,
    };

    const iuToPdfUserSpace = (aCoord: Vec2): Vec2 => {
      const pos = {
        x: (aCoord.x * PTsPERMIL) / (this.m_IUsPerDecimil * 10),
        y: (aCoord.y * PTsPERMIL) / (this.m_IUsPerDecimil * 10),
      };

      // PDF y=0 is at bottom of page, invert coordinate
      const retval = { x: pos.x, y: psPaperSize.y - pos.y };

      // The pdf plot can be mirrored (from left to right). So mirror the
      // x coordinate if m_plotMirror is set
      if (this.m_plotMirror) {
        if (this.m_mirrorIsHorizontal) retval.x = psPaperSize.x - pos.x;
        else retval.y = pos.y;
      }

      return retval;
    };

    // Handle annotations (at the moment only "link" type objects)
    const annotHandles: number[] = [];

    for (const link of this.m_hyperlinksInPage) {
      const bottomLeft = iuToPdfUserSpace(link.box.pos);
      const topRight = iuToPdfUserSpace(boxEnd(link.box));

      annotHandles.push(this.allocPdfObject());

      this.m_hyperlinkHandles.set(annotHandles[annotHandles.length - 1]!, {
        box: {
          pos: bottomLeft,
          size: { x: topRight.x - bottomLeft.x, y: topRight.y - bottomLeft.y },
        },
        url: link.url,
      });
    }

    for (const menu of this.m_hyperlinkMenusInPage) {
      const bottomLeft = iuToPdfUserSpace(menu.box.pos);
      const topRight = iuToPdfUserSpace(boxEnd(menu.box));

      annotHandles.push(this.allocPdfObject());

      this.m_hyperlinkMenuHandles.set(annotHandles[annotHandles.length - 1]!, {
        box: {
          pos: bottomLeft,
          size: { x: topRight.x - bottomLeft.x, y: topRight.y - bottomLeft.y },
        },
        urls: menu.urls,
      });
    }

    let annot3DHandle = -1;

    if (this.m_3dExportMode) {
      annot3DHandle = this.allocPdfObject();
      annotHandles.push(annot3DHandle);
    }

    let annotArrayHandle = -1;

    // If we have added any annotation links, create an array containing all the objects
    if (annotHandles.length > 0) {
      annotArrayHandle = this.startPdfObject();

      this.out(`[${annotHandles.map((handle) => `${handle} 0 R`).join(' ')}]\n`);
      this.closePdfObject();
    }

    // Emit the page object and put it in the page list for later
    const pageHandle = this.startPdfObject();
    this.m_pageHandles.push(pageHandle);

    this.out(
      '<<\n' +
        '/Type /Page\n' +
        `/Parent ${this.m_pageTreeHandle} 0 R\n` +
        '/Resources <<\n' +
        '    /ProcSet [/PDF /Text /ImageC /ImageB]\n' +
        `    /Font ${this.m_fontResDictHandle} 0 R\n` +
        `    /XObject ${this.m_imgResDictHandle} 0 R >>\n` +
        `/MediaBox [0 0 ${this.encodeDoubleForPlotter(psPaperSize.x)}` +
        ` ${this.encodeDoubleForPlotter(psPaperSize.y)}]\n`,
    );

    if (this.m_pageStreamHandle !== -1) this.out(`/Contents ${this.m_pageStreamHandle} 0 R\n`);

    // No newline after the /Annots reference — upstream's format string has
    // none — so a page with annotations reads `/Annots N 0 R>>`.
    if (annotHandles.length > 0) this.out(`/Annots ${annotArrayHandle} 0 R`);

    this.out('>>\n');

    this.closePdfObject();

    if (this.m_3dExportMode) {
      this.startPdfObject(annot3DHandle);

      this.out(
        '<<\n' +
          '/Type /Annot\n' +
          '/Subtype /3D\n' +
          `/Rect [0 0 ${this.encodeDoubleForPlotter(psPaperSize.x)}` +
          ` ${this.encodeDoubleForPlotter(psPaperSize.y)}]\n` +
          '/NM (3D Annotation)\n' +
          `/3DD ${this.m_3dModelHandle} 0 R\n` +
          '/3DV 0\n' +
          '/3DA<</A/PO/D/PC/TB true/NP true>>\n' +
          '/3DI true\n' +
          `/P ${pageHandle} 0 R\n` +
          '>>\n',
      );

      this.closePdfObject();
    }

    // Mark the page stream as idle
    this.m_pageStreamHandle = -1;

    let actionHandle = this.emitGoToAction(pageHandle);
    let parent_node = this.m_outlineRoot;

    if (this.m_parentPageName !== '') {
      // Search for the parent node iteratively through the entire tree
      const nodes: OutlineNode[] = [this.m_outlineRoot];

      while (nodes.length > 0) {
        const node = nodes.pop()!;

        // Check if this node matches
        if (node.title === this.m_parentPageName) {
          parent_node = node;
          break;
        }

        // Add all children to the stack
        for (const child of node.children) nodes.push(child);
      }
    }

    const pageOutlineNode = this.addOutlineNode(parent_node, actionHandle, this.m_pageName);

    // let's reorg the symbol bookmarks under a page handle
    for (const groupName of [...this.m_bookmarksInPage.keys()].sort(compareStrings)) {
      const groupVector = this.m_bookmarksInPage.get(groupName)!;
      const groupOutlineNode = this.addOutlineNode(pageOutlineNode, actionHandle, groupName);

      for (const bookmark of groupVector) {
        const bottomLeft = toVector2I(iuToPdfUserSpace(bookmark.box.pos));
        const topRight = toVector2I(iuToPdfUserSpace(boxEnd(bookmark.box)));

        actionHandle = this.emitGoToAction(pageHandle, bottomLeft, topRight);

        this.addOutlineNode(groupOutlineNode, actionHandle, bookmark.ref);
      }

      groupOutlineNode.children.sort((a, b) => compareStrings(a.title, b.title));
    }

    // Clean up
    this.m_hyperlinksInPage = [];
    this.m_hyperlinkMenusInPage = [];
    this.m_bookmarksInPage = new Map();
  }

  /**
   * `StartPlot`. The `%PDF-1.5` line is followed by a comment whose four bytes
   * all have bit 7 set, which is how a PDF declares itself binary to tools that
   * sniff the first two lines. Those bytes are 0x80..0x83 exactly, so they
   * cannot travel through a UTF-8 encoder.
   *
   * Four objects are reserved before anything is written: the page tree root,
   * the font and image resource dictionaries and the JavaScript name tree. All
   * four are referenced by every page and emitted only at EndPlot.
   */
  StartPlot(aPageNumber: string, aPageName = ''): boolean {
    if (!this.m_outputFile) throw new Error('PDF plot started before OpenFile');

    // First things first: the customary null object
    this.m_xrefTable = [0];
    this.m_hyperlinksInPage = [];
    this.m_hyperlinkMenusInPage = [];
    this.m_hyperlinkHandles = new Map();
    this.m_hyperlinkMenuHandles = new Map();
    this.m_bookmarksInPage = new Map();
    this.m_totalOutlineNodes = 0;

    this.m_outlineRoot = newOutlineNode();

    /* The header (that's easy!). The second line is binary junk required
       to make the file binary from the beginning (the important thing is
       that they must have the bit 7 set) */
    this.out('%PDF-1.5\n');
    this.outBytes(new Uint8Array([0x25, 0x80, 0x81, 0x82, 0x83, 0x0a]));

    /* Allocate an entry for the page tree root, it will go in every page parent entry */
    this.m_pageTreeHandle = this.allocPdfObject();

    /* In the same way, the font resource dictionary is used by every page
       (it *could* be inherited via the Pages tree */
    this.m_fontResDictHandle = this.allocPdfObject();

    this.m_imgResDictHandle = this.allocPdfObject();

    this.m_jsNamesHandle = this.allocPdfObject();

    /* Now, the PDF is read from the end, (more or less)... so we start
       with the page stream for page 1. Other more important stuff is written
       at the end */
    this.StartPage(aPageNumber, aPageName);

    return true;
  }

  // =========================================================================
  // Outline (bookmarks) and actions
  // =========================================================================

  /**
   * `emitGoToAction`. The two-point overload writes `/FitR` with the rectangle
   * *as integers* — the caller truncated the user-space doubles into a VECTOR2I
   * first — so a bookmark's destination rectangle is whole points.
   */
  private emitGoToAction(aPageHandle: number, aBottomLeft?: Vec2, aTopRight?: Vec2): number {
    const actionHandle = this.allocPdfObject();
    this.startPdfObject(actionHandle);

    if (aBottomLeft && aTopRight) {
      this.out(
        `<</S /GoTo /D [${aPageHandle} 0 R /FitR ${aBottomLeft.x} ${aBottomLeft.y}` +
          ` ${aTopRight.x} ${aTopRight.y}]\n>>\n`,
      );
    } else {
      this.out(`<</S /GoTo /D [${aPageHandle} 0 R /Fit]\n>>\n`);
    }

    this.closePdfObject();

    return actionHandle;
  }

  /** `addOutlineNode`. The entry handle is reserved now and written at EndPlot. */
  private addOutlineNode(aParent: OutlineNode, aActionHandle: number, aTitle: string): OutlineNode {
    const node = newOutlineNode(aActionHandle, aTitle, this.allocPdfObject());

    aParent.children.push(node);
    this.m_totalOutlineNodes++;

    return node;
  }

  /**
   * `emitOutlineNode`. Children are emitted before the node itself, and the
   * root — reached with parentHandle -1 — is skipped here and written by
   * emitOutline. `/Count` on an inner node is *negative*, which is the PDF
   * encoding for "this subtree starts collapsed".
   */
  private emitOutlineNode(
    aNode: OutlineNode,
    aParentHandle: number,
    aNextNode: number,
    aPrevNode: number,
  ): void {
    const nodeHandle = aNode.entryHandle;
    let prevHandle = -1;
    let nextHandle = -1;

    for (let index = 0; index < aNode.children.length; index++) {
      if (index >= aNode.children.length - 1) nextHandle = -1;
      else nextHandle = aNode.children[index + 1]!.entryHandle;

      this.emitOutlineNode(aNode.children[index]!, nodeHandle, nextHandle, prevHandle);

      prevHandle = aNode.children[index]!.entryHandle;
    }

    // -1 for parentHandle is the outline root itself which is handed elsewhere.
    if (aParentHandle !== -1) {
      this.startPdfObject(nodeHandle);

      this.out(`<<\n/Title ${encodeStringForPlotter(aNode.title)}\n/Parent ${aParentHandle} 0 R\n`);

      if (aNextNode > 0) this.out(`/Next ${aNextNode} 0 R\n`);

      if (aPrevNode > 0) this.out(`/Prev ${aPrevNode} 0 R\n`);

      if (aNode.children.length > 0) {
        this.out(`/Count ${-1 * aNode.children.length}\n`);
        this.out(`/First ${aNode.children[0]!.entryHandle} 0 R\n`);
        this.out(`/Last ${aNode.children[aNode.children.length - 1]!.entryHandle} 0 R\n`);
      }

      if (aNode.actionHandle !== -1) this.out(`/A ${aNode.actionHandle} 0 R\n`);

      this.out('>>\n');
      this.closePdfObject();
    }
  }

  /**
   * `emitOutline`. The root's own handle is allocated *here*, at EndPlot time,
   * so it is numerically larger than every node under it. Returns -1 when there
   * is nothing to show, which is what puts the catalog in `/PageMode /UseNone`.
   */
  private emitOutline(): number {
    if (this.m_outlineRoot.children.length > 0) {
      // declare the outline object
      this.m_outlineRoot.entryHandle = this.allocPdfObject();

      this.emitOutlineNode(this.m_outlineRoot, -1, -1, -1);

      this.startPdfObject(this.m_outlineRoot.entryHandle);

      this.out(
        '<< /Type /Outlines\n' +
          `   /Count ${this.m_totalOutlineNodes}\n` +
          `   /First ${this.m_outlineRoot.children[0]!.entryHandle} 0 R\n` +
          `   /Last ${this.m_outlineRoot.children[this.m_outlineRoot.children.length - 1]!.entryHandle} 0 R\n` +
          '>>\n',
      );

      this.closePdfObject();

      return this.m_outlineRoot.entryHandle;
    }

    return -1;
  }

  // =========================================================================
  // Resources
  // =========================================================================

  /**
   * `endPlotEmitResources`. The font dictionaries come out empty here: with
   * PDF_PLOTTER::Text unported nothing ever registers a glyph, and upstream's
   * emitStrokeFonts / emitOutlineFonts loop over an empty subset list and emit
   * nothing either. A document with no text is therefore byte-identical.
   *
   * The image resource dictionary is opened with a `println("<<\n")`, i.e. a
   * blank line after the `<<`. Trimming it would move every later object.
   */
  private endPlotEmitResources(): void {
    this.startPdfObject(this.m_fontResDictHandle);
    this.out('<<\n');
    this.out('>>\n');
    this.closePdfObject();

    // Named image dictionary (was allocated, now we emit it)
    this.startPdfObject(this.m_imgResDictHandle);
    this.out('<<\n\n');

    for (const imgHandle of this.sortedImageHandles())
      this.out(`    /Im${imgHandle} ${imgHandle} 0 R\n`);

    this.out('>>\n');
    this.closePdfObject();

    // Emit images with optional SMask for transparency
    for (const imgHandle of this.sortedImageHandles()) {
      const image = this.m_imageHandles.get(imgHandle)!;

      // Image
      this.startPdfObject(imgHandle);
      const imgLenHandle = this.allocPdfObject();
      const smaskHandle = image.HasAlpha() || image.HasMask() ? this.allocPdfObject() : -1;

      this.out(
        '<<\n' +
          '/Type /XObject\n' +
          '/Subtype /Image\n' +
          '/BitsPerComponent 8\n' +
          `/ColorSpace ${this.m_colorMode ? '/DeviceRGB' : '/DeviceGray'}\n` +
          `/Width ${image.GetWidth()}\n` +
          `/Height ${image.GetHeight()}\n` +
          '/Filter /FlateDecode\n' +
          `/Length ${imgLenHandle} 0 R\n`, // Length is deferred
      );

      if (smaskHandle !== -1) this.out(`/SMask ${smaskHandle} 0 R\n`);

      this.out('>>\n');
      this.out('stream\n');

      const imgStreamStart = this.m_outLength;

      this.outBytes(
        this.m_deflate(
          WriteImageStream(
            image,
            toColour(this.m_renderSettings.GetBackgroundColor()),
            this.m_colorMode,
          ),
        ),
      );

      const imgStreamSize = this.m_outLength - imgStreamStart;

      this.out('\nendstream\n');
      this.closePdfObject();

      this.startPdfObject(imgLenHandle);
      this.out(`${imgStreamSize}\n`);
      this.closePdfObject();

      if (smaskHandle !== -1) {
        // SMask
        this.startPdfObject(smaskHandle);
        const smaskLenHandle = this.allocPdfObject();

        this.out(
          '<<\n' +
            '/Type /XObject\n' +
            '/Subtype /Image\n' +
            '/BitsPerComponent 8\n' +
            '/ColorSpace /DeviceGray\n' +
            `/Width ${image.GetWidth()}\n` +
            `/Height ${image.GetHeight()}\n` +
            `/Length ${smaskLenHandle} 0 R\n` +
            '/Filter /FlateDecode\n' +
            '>>\n', // Length is deferred
        );

        this.out('stream\n');

        const smaskStreamStart = this.m_outLength;

        this.outBytes(this.m_deflate(WriteImageSMaskStream(image)));

        const smaskStreamSize = this.m_outLength - smaskStreamStart;

        this.out('\nendstream\n');
        this.closePdfObject();

        this.startPdfObject(smaskLenHandle);
        this.out(`${smaskStreamSize}\n`);
        this.closePdfObject();
      }
    }

    for (const linkHandle of [...this.m_hyperlinkHandles.keys()].sort((a, b) => a - b)) {
      const link = this.m_hyperlinkHandles.get(linkHandle)!;

      this.startPdfObject(linkHandle);
      this.emitAnnotRect(link.box);

      const pageNumber = IsGotoPageHref(link.url);

      if (pageNumber !== null) {
        let pageFound = false;

        for (let ii = 0; ii < this.m_pageNumbers.length; ++ii) {
          if (this.m_pageNumbers[ii] === pageNumber) {
            this.out(`/Dest [${this.m_pageHandles[ii]} 0 R /FitB]\n>>\n`);

            pageFound = true;
            break;
          }
        }

        if (!pageFound) {
          // destination page is not being plotted, assign the NOP action to the link
          this.out('/A << /Type /Action /S /NOP >>\n>>\n');
        }
      } else {
        let url = link.url;

        if (this.m_project) url = this.m_project.ResolveUriByEnvVars(url);

        this.out(`/A << /Type /Action /S /URI /URI ${encodeStringForPlotter(url)} >>\n>>\n`);
      }

      this.closePdfObject();
    }

    for (const menuHandle of [...this.m_hyperlinkMenuHandles.keys()].sort((a, b) => a - b)) {
      const menu = this.m_hyperlinkMenuHandles.get(menuHandle)!;
      const js = this.buildMenuJs(menu.urls);

      this.startPdfObject(menuHandle);
      this.emitAnnotRect(menu.box);

      this.out(`/A << /Type /Action /S /JavaScript /JS ${encodeStringForPlotter(js)} >>\n>>\n`);

      this.closePdfObject();
    }

    this.startPdfObject(this.m_jsNamesHandle);

    this.out(
      '<< /JavaScript\n' +
        ' << /Names\n' +
        `    [ (JSInit) << /Type /Action /S /JavaScript /JS ${encodeStringForPlotter(PDF_MENU_JS)} >> ]\n` +
        ' >>\n' +
        '>>\n',
    );

    this.closePdfObject();
  }

  /** The `/Type /Annot /Subtype /Link` preamble both annotation writers share. */
  private emitAnnotRect(aBox: PdfBox2): void {
    const left = aBox.pos.x;
    const top = aBox.pos.y;
    const right = aBox.pos.x + aBox.size.x;
    const bottom = aBox.pos.y + aBox.size.y;

    this.out(
      '<<\n' +
        '/Type /Annot\n' +
        '/Subtype /Link\n' +
        `/Rect [${this.encodeDoubleForPlotter(left)} ${this.encodeDoubleForPlotter(bottom)}` +
        ` ${this.encodeDoubleForPlotter(right)} ${this.encodeDoubleForPlotter(top)}]\n` +
        '/Border [16 16 0]\n',
    );
  }

  /** The image map iterated as `std::map<int, wxImage>` does: by ascending handle. */
  private sortedImageHandles(): number[] {
    return [...this.m_imageHandles.keys()].sort((a, b) => a - b);
  }

  /**
   * The `js` accumulator inside endPlotEmitResources' menu loop. Four kinds of
   * entry are recognised and the order of the tests is what decides them: a `!`
   * prefix marks a property line, whose *first* embedded `http:`, `https:` or
   * `file:` — in that order — becomes the target; a `#` prefix is an internal
   * page jump, silently dropped when the page is not in this document; anything
   * else is a bare URL, promoted to a `file://` URI if it looks like a path and
   * then dropped unless it ended up with a recognised scheme.
   *
   * Note that `Find( "http:" )` does not match `https:`, so the https arm is
   * reachable — and that the legacy ` = ` fallback emits a one-element entry,
   * i.e. a menu line that does nothing, when it cannot make a URL of the value.
   */
  private buildMenuJs(aUrls: readonly string[]): string {
    const resolve = (aUri: string): string =>
      this.m_project ? this.m_project.ResolveUriByEnvVars(aUri) : aUri;

    let js = 'ShM([\n';

    for (const url of aUrls) {
      if (url.startsWith('!')) {
        const property = url.slice(url.indexOf('!') + 1);

        if (property.indexOf('http:') >= 0) {
          const href = resolve(property.slice(property.indexOf('http:')));

          js += `["${EscapeJsString(property)}", "${EscapeJsString(href)}"],\n`;
        } else if (property.indexOf('https:') >= 0) {
          const href = resolve(property.slice(property.indexOf('https:')));

          js += `["${EscapeJsString(property)}", "${EscapeJsString(href)}"],\n`;
        } else if (property.indexOf('file:') >= 0) {
          let href = resolve(property.slice(property.indexOf('file:')));

          href = NormalizeFileUri(href);

          const displayText = property.slice(0, property.indexOf('file:')) + href;

          js += `["${EscapeJsString(displayText)}", "${EscapeJsString(href)}"],\n`;
        } else {
          // Legacy fallback
          const eqPos = property.indexOf(' = ');
          let href = '';
          let converted = false;

          if (eqPos !== -1) {
            href = resolve(property.slice(eqPos + 3));

            if (
              href.startsWith('/') ||
              href.startsWith('${') ||
              (href.length >= 2 && isAlpha(href[0]!) && href[1] === ':') ||
              href.startsWith('\\\\')
            ) {
              if (!href.startsWith('/')) {
                href = href.replaceAll('\\', '/');

                if (href.startsWith('//')) href = `file:${href}`;
                else href = `file:///${href}`;
              } else {
                href = `file://${href}`;
              }

              href = NormalizeFileUri(href);
              converted = true;
            }
          }

          if (converted) js += `["${EscapeJsString(property)}", "${EscapeJsString(href)}"],\n`;
          else js += `["${EscapeJsString(property)}"],\n`;
        }
      } else if (url.startsWith('#')) {
        const pageNumber = url.slice(url.indexOf('#') + 1);

        for (let ii = 0; ii < this.m_pageNumbers.length; ++ii) {
          if (this.m_pageNumbers[ii] === pageNumber) {
            js += `["${EscapeJsString(`Show Page ${pageNumber}`)}", "#${ii}"],\n`;
            break;
          }
        }
      } else {
        let href = resolve(url);

        // Convert bare file paths to file:// URIs (legacy support)
        if (!href.startsWith('http:') && !href.startsWith('https:') && !href.startsWith('file:')) {
          if (href.startsWith('/') || href.startsWith('${')) {
            href = `file://${href}`;
          } else if (href.length >= 2 && isAlpha(href[0]!) && href[1] === ':') {
            href = href.replaceAll('\\', '/');
            href = `file:///${href}`;
          } else if (href.startsWith('\\\\')) {
            href = href.replaceAll('\\', '/');
            href = `file:${href}`;
          }
        }

        if (href.startsWith('file:')) href = NormalizeFileUri(href);

        if (href.startsWith('http:') || href.startsWith('https:') || href.startsWith('file:')) {
          js += `["${EscapeJsString(`Open ${href}`)}", "${EscapeJsString(href)}"],\n`;
        }
      }
    }

    return `${js}]);`;
  }

  // =========================================================================
  // File skeleton
  // =========================================================================

  /**
   * `EndPlot`. The tail of a PDF is written in dependency order, last first:
   * the page tree (which needs every page handle), the info dictionary, the
   * outline, the catalog, and finally the xref table and trailer.
   *
   * The xref format is fixed to the byte: entry zero is the free-list head and
   * every other entry is exactly twenty characters, `%010d 00000 n ` plus a
   * newline. `startxref` then points at the byte the `xref` keyword began at,
   * which is why the offset is captured before anything is written.
   *
   * The `/Title` fallback takes the file name after the last `\` and then after
   * the last `/`, so a Windows path is handled without knowing the platform —
   * wxString::AfterLast returns the whole string when the character is absent.
   */
  EndPlot(aNow: Date = new Date()): boolean {
    // We can end up here if there was nothing to plot
    if (!this.m_outputFile) return false;

    // Close the current page (often the only one)
    this.ClosePage();

    if (!this.m_3dExportMode) this.endPlotEmitResources();

    /* The page tree: it's a B-tree but luckily we only have few pages!
       So we use just an array... The handle was allocated at the beginning,
       now we instantiate the corresponding object */
    this.startPdfObject(this.m_pageTreeHandle);
    this.out('<<\n/Type /Pages\n/Kids [\n');

    for (const pageHandle of this.m_pageHandles) this.out(`${pageHandle} 0 R\n`);

    this.out(`]\n/Count ${this.m_pageHandles.length}\n>>\n`);
    this.closePdfObject();

    const infoDictHandle = this.startPdfObject();

    const dt = pdfCreationDate(aNow);

    if (this.m_title === '') {
      // Windows uses '\' and other platforms use '/' as separator
      this.m_title = afterLast(this.m_filename, '\\');
      this.m_title = afterLast(this.m_title, '/');
    }

    this.out(
      '<<\n' +
        '/Producer (KiCad PDF)\n' +
        `/CreationDate (${dt})\n` +
        `/Creator ${encodeStringForPlotter(this.m_creator)}\n` +
        `/Title ${encodeStringForPlotter(this.m_title)}\n` +
        `/Author ${encodeStringForPlotter(this.m_author)}\n` +
        `/Subject ${encodeStringForPlotter(this.m_subject)}\n`,
    );

    this.out('>>\n');
    this.closePdfObject();

    // Let's dump in the outline
    let outlineHandle = -1;

    if (!this.m_3dExportMode) outlineHandle = this.emitOutline();

    // The catalog, at last
    const catalogHandle = this.startPdfObject();

    if (outlineHandle > 0) {
      this.out(
        '<<\n' +
          '/Type /Catalog\n' +
          `/Pages ${this.m_pageTreeHandle} 0 R\n` +
          '/Version /1.5\n' +
          '/PageMode /UseOutlines\n' +
          `/Outlines ${outlineHandle} 0 R\n` +
          `/Names ${this.m_jsNamesHandle} 0 R\n` +
          '/PageLayout /SinglePage\n' +
          '>>\n',
      );
    } else {
      this.out(
        '<<\n' +
          '/Type /Catalog\n' +
          `/Pages ${this.m_pageTreeHandle} 0 R\n` +
          '/Version /1.5\n' +
          '/PageMode /UseNone\n' +
          '/PageLayout /SinglePage\n' +
          '>>\n',
      );
    }

    this.closePdfObject();

    /* Emit the xref table (format is crucial to the byte, each entry must
       be 20 bytes long, and object zero must be done in that way). Also
       the offset must be kept along for the trailer */
    const xref_start = this.m_outLength;

    this.out(`xref\n0 ${this.m_xrefTable.length}\n0000000000 65535 f \n`);

    for (let i = 1; i < this.m_xrefTable.length; i++)
      this.out(`${zeroPad(this.m_xrefTable[i]!, 10)} 00000 n \n`);

    // Done the xref, go for the trailer
    this.out(
      'trailer\n' +
        `<< /Size ${this.m_xrefTable.length} /Root ${catalogHandle} 0 R` +
        ` /Info ${infoDictHandle} 0 R >>\n` +
        'startxref\n' +
        `${xref_start}\n` +
        '%%EOF\n',
    );

    this.m_outputFile = false;

    return true;
  }

  // =========================================================================
  // Annotations
  // =========================================================================

  /** `HyperlinkBox`. Queued until ClosePage, which is where the object is made. */
  HyperlinkBox(aBox: PdfBox2, aDestinationURL: string): void {
    this.m_hyperlinksInPage.push({ box: cloneBox(aBox), url: aDestinationURL });
  }

  /** `HyperlinkMenu`. Likewise; the JavaScript is only built at EndPlot. */
  HyperlinkMenu(aBox: PdfBox2, aDestURLs: readonly string[]): void {
    this.m_hyperlinkMenusInPage.push({ box: cloneBox(aBox), urls: [...aDestURLs] });
  }

  /**
   * `Bookmark`. Grouped by name, and the group name defaults to the empty
   * string — which is a real key, so ungrouped bookmarks all land under one
   * unnamed outline node rather than directly under the page.
   */
  Bookmark(aLocation: PdfBox2, aSymbolReference: string, aGroupName = ''): void {
    const group = this.m_bookmarksInPage.get(aGroupName);

    if (group) group.push({ box: cloneBox(aLocation), ref: aSymbolReference });
    else
      this.m_bookmarksInPage.set(aGroupName, [{ box: cloneBox(aLocation), ref: aSymbolReference }]);
  }
}

/**
 * `WriteImageStream` (PDF_plotter.cpp:875). Masked pixels are replaced with the
 * render settings' background colour *before* the greyscale conversion, so a
 * mono plot of a masked image shows the background's luminance and not white.
 * The greyscale weights are CIE 1931 and the result is KiROUNDed.
 */
export function WriteImageStream(
  aImage: PdfImage,
  aBackground: { r: number; g: number; b: number },
  aColorMode: boolean,
): Uint8Array {
  const w = aImage.GetWidth();
  const h = aImage.GetHeight();
  const data = aImage.GetData();
  const hasMask = aImage.HasMask();
  const out: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const base = (y * w + x) * 3;
      let r = data[base]! & 0xff;
      let g = data[base + 1]! & 0xff;
      let b = data[base + 2]! & 0xff;

      if (hasMask) {
        if (
          r === aImage.GetMaskRed() &&
          g === aImage.GetMaskGreen() &&
          b === aImage.GetMaskBlue()
        ) {
          r = aBackground.r;
          g = aBackground.g;
          b = aBackground.b;
        }
      }

      if (aColorMode) {
        out.push(r, g, b);
      } else {
        // Greyscale conversion (CIE 1931)
        out.push(KiROUND(r * 0.2126 + g * 0.7152 + b * 0.0722) & 0xff);
      }
    }
  }

  return Uint8Array.from(out);
}

/**
 * `WriteImageSMaskStream` (PDF_plotter.cpp:916). The mask arm wins over the
 * alpha arm, and an image with neither yields an *empty* stream — which is why
 * the caller only allocates an SMask object when one of them holds.
 */
export function WriteImageSMaskStream(aImage: PdfImage): Uint8Array {
  const w = aImage.GetWidth();
  const h = aImage.GetHeight();

  if (aImage.HasMask()) {
    const data = aImage.GetData();
    const out = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const base = (y * w + x) * 3;

        out[y * w + x] =
          data[base] === aImage.GetMaskRed() &&
          data[base + 1] === aImage.GetMaskGreen() &&
          data[base + 2] === aImage.GetMaskBlue()
            ? 0
            : 255;
      }
    }

    return out;
  }

  if (aImage.HasAlpha()) return aImage.GetAlpha().slice(0, w * h);

  return new Uint8Array(0);
}

/** `memcmp( a, b, n ) != 0`, inverted. */
function bytesEqual(a: Uint8Array, b: Uint8Array, aCount: number): boolean {
  for (let i = 0; i < aCount; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

/** `BOX2I::GetEnd()`, i.e. origin plus extent. */
const boxEnd = (aBox: PdfBox2): Vec2 => ({
  x: aBox.pos.x + aBox.size.x,
  y: aBox.pos.y + aBox.size.y,
});

const cloneBox = (aBox: PdfBox2): PdfBox2 => ({
  pos: { x: aBox.pos.x, y: aBox.pos.y },
  size: { x: aBox.size.x, y: aBox.size.y },
});

/**
 * `wxString::operator<`, as `std::map<wxString, …>` and the outline sort use it:
 * a code-unit comparison. JavaScript's `<` compares UTF-16 units where the
 * Linux wxString compares code points, so the two orders differ only when an
 * astral character meets one in U+E000..U+FFFF.
 */
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `wxString::AfterLast`, which — unlike BeforeLast — returns the *whole* string
 * when the character is absent rather than an empty one.
 */
function afterLast(aText: string, aChar: string): string {
  const cut = aText.lastIndexOf(aChar);

  return cut < 0 ? aText : aText.slice(cut + 1);
}
