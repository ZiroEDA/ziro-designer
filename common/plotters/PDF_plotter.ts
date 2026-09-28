// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PDF_PLOTTER, the PDF 1.5 plot back-end, transcribed from
 * common/plotters/PDF_plotter.cpp. It derives from PSLIKE_PLOTTER
 * (PS_plotter.ts: SetColor, SetTextMode, SetScaleAdjust, the pad flashes) and
 * so from PLOTTER (plotter.ts: the device transform, the dash lengths, the pen
 * wrappers, the three-point Arc and the Thick* helpers), as upstream's does.
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
 *    pcbnew may not reach for a filesystem or a zlib binding.
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
 * (`PdfImage`, standing in for wxImage) and the environment
 * variable expansion behind `ResolveUriByEnvVars` (`PdfProject`; passing none
 * mirrors upstream's null PROJECT).
 *
 * Text is PDF text, as upstream's: `Text` writes each word through the Type 3
 * stroke-font subsetter (pdf_stroke_font.ts) or the CIDFontType2 outline-font
 * subsetter (pdf_outline_font.ts, over the face outline_face.ts reads), and
 * `endPlotEmitResources` emits the subsets. The font comes in on the
 * PLOTTER_FONT (`plotterFont`); without one it is the stroke font, which is
 * `FONT::GetFont( m_renderSettings->GetDefaultFont() )` for every default.
 * `@{…}` expressions are not evaluated. `Plot3DModel` is absent, though
 * `Set3DExport` and the `/3D` annotation it guards are ported: with no model
 * plotted the annotation names handle -1, which is what upstream emits in the
 * same situation.
 */

import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { ANGLE_0, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { ADVANCED_CFG } from '../advanced_config.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '../eda_text.js';
import { FONT, TEXT_STYLE, type TEXT_STYLE_FLAGS, wxTokenizeRetDelims } from '../font/font.js';
import { ITALIC_TILT, METRICS } from '../font/font_metrics.js';
import type { OUTLINE_FONT } from '../font/outline_font.js';
import { TEXT_ATTRIBUTES } from '../font/text_attributes.js';
import { GetPenSizeForBold } from '../gr_text.js';
import { MARKUP_PARSER, type NODE } from '../markup_parser.js';
import { PDF_OUTLINE_FONT_MANAGER, type PDF_OUTLINE_FONT_RUN } from './pdf_outline_font.js';
import { PDF_STROKE_FONT_MANAGER, type PDF_STROKE_FONT_RUN } from './pdf_stroke_font.js';
import { COLOR4D_WHITE, type Color4d } from '../gal/color4d.js';
import {
  DO_NOT_SET_LINE_WIDTH,
  FILL_T,
  LINE_STYLE,
  PLOT_FORMAT,
  type PLOTTER_FONT,
  type PLOTTER_TEXT_ATTRIBUTES,
  type PEN_PLUME,
  toVector2I,
  USE_DEFAULT_LINE_WIDTH,
} from './plotter.js';
import { PSLIKE_PLOTTER } from './PS_plotter.js';

/** A `BOX2I` reduced to what HyperlinkBox / Bookmark store: origin plus extent. */
export interface PdfBox2 {
  pos: Vec2;
  size: Vec2;
}

import { type PlotterRenderSettings, plotterRenderSettings } from '../render_settings.js';

/**
 * `RENDER_SETTINGS` plus the one accessor only the PDF backend reaches for.
 */
export interface PdfRenderSettings extends PlotterRenderSettings {
  /** Only masked image pixels consult this; PDF has no page background. */
  GetBackgroundColor(): Color4d;
}

/**
 * `plotterRenderSettings` plus the background colour. COLOR4D_WHITE is the
 * default because that is what an unset PCB background reads back as.
 */
export function pdfRenderSettings(
  aOptions: {
    defaultPenWidth?: number;
    dashLengthRatio?: number;
    gapLengthRatio?: number;
    backgroundColor?: Color4d;
  } = {},
): PdfRenderSettings {
  const settings = plotterRenderSettings(aOptions);

  settings.SetBackgroundColor(aOptions.backgroundColor ?? COLOR4D_WHITE);

  return settings;
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

import { fixed, formatG, shortest } from './fmt.js';

/** `OVERBAR_INFO` (plotters_pslike.h): an overbar to draw once the text is out. */
interface OVERBAR_INFO {
  startPos: Vec2; // Start position of overbar text
  endPos: Vec2; // End position of overbar text
  fontSize: Vec2; // Font size for proper overbar positioning
  isOutline: boolean; // True if the overbar applies to an outline font run
  vAlign: GR_TEXT_V_ALIGN_T; // Original vertical alignment of the parent text
}

/** `std::lround`: half away from zero. */
const lround = (aValue: number): number => Math.sign(aValue) * Math.round(Math.abs(aValue));

/** `{:02X}`. */
const hex2 = (aValue: number): string => aValue.toString(16).toUpperCase().padStart(2, '0');

/** fmt's bare `{:f}`: a hard-coded six decimals. PlotPoly and PenTo use it. */
export const DEFAULT_FMT_PRECISION = 6;

/** fmt's `{:0Nd}`: a decimal integer zero-padded to N digits. */
function zeroPad(aValue: number, aWidth: number): string {
  const negative = aValue < 0;
  const digits = String(Math.abs(aValue)).padStart(negative ? aWidth - 1 : aWidth, '0');

  return negative ? `-${digits}` : digits;
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
export class PDF_PLOTTER extends PSLIKE_PLOTTER {
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
  private m_strokeFontManager: PDF_STROKE_FONT_MANAGER | null = null;
  private m_outlineFontManager: PDF_OUTLINE_FONT_MANAGER | null = null;

  /** The output file, as bytes. `ftell( m_outputFile )` is `m_outLength`. */
  private m_out: Uint8Array[] = [];
  private m_outLength = 0;

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

  /** PDF reads the background colour too, which PLOTTER's slice does not carry. */
  protected declare m_renderSettings: PdfRenderSettings | null;

  constructor(
    aRenderSettings: PdfRenderSettings | null,
    private readonly m_deflate: PdfDeflate,
    aOptions: { debugPdfWriter?: boolean; project?: PdfProject } = {},
  ) {
    super();
    this.m_renderSettings = aRenderSettings;
    this.m_debugPdfWriter = aOptions.debugPdfWriter ?? false;
    this.m_project = aOptions.project ?? null;
  }

  static GetDefaultFileExtension(): string {
    return 'pdf';
  }

  override GetPlotterType(): PLOT_FORMAT {
    return PLOT_FORMAT.PDF;
  }

  /** `m_renderSettings->`, with the PDF-only accessor. */
  protected override renderSettings(): PdfRenderSettings {
    if (!this.m_renderSettings) throw new Error('plotter has no render settings');

    return this.m_renderSettings;
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

  // =========================================================================
  // Coordinates
  // =========================================================================

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
    else if (width === USE_DEFAULT_LINE_WIDTH) width = this.renderSettings().GetDefaultPenWidth();

    if (width === 0) width = 1;

    if (width !== this.m_currentPenWidth)
      this.work(`${this.encodeDoubleForPlotter(this.userToDeviceSize(width))} w\n`);

    this.m_currentPenWidth = width;
  }

  /**
   * `emitSetRGBColor`. PDF has no alpha in the graphics state the plotter uses,
   * so a translucent colour is pre-blended against white paper. Both the fill
   * (`rg`) and the stroke (`RG`) colour are set from the same triple, on one
   * line, every time — there is no change detection here at all.
   */
  protected override emitSetRGBColor(r: number, g: number, b: number, a: number): void {
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
      const box = new BOX2I(p1, { x: p2.x - p1.x, y: p2.y - p1.y });
      box.Normalize();
      const rect = new SHAPE_RECT(box);
      rect.SetRadius(aCornerRadius);
      this.PlotPolyLineChain(rect.Outline(), fill, width, null);
      return;
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
   * `PDF_PLOTTER::PlotPoly( const SHAPE_LINE_CHAIN&, … )`: every straight
   * segment contributes both ends (so interior corners are written twice), an
   * arc its flattened `arcPath` reversed, and the numbers go out through
   * `encodeDoubleForPlotter` rather than the `{:f}` of the corner-list overload.
   */
  override PlotPolyLineChain(
    aLineChain: SHAPE_LINE_CHAIN,
    aFill: FILL_T,
    aWidth: number,
    _aData?: unknown,
  ): void {
    this.SetCurrentLineWidth(aWidth);

    const handledArcs = new Set<number>();
    const path: Vec2[] = [];

    for (let ii = 0; ii < aLineChain.SegmentCount(); ++ii) {
      if (aLineChain.IsArcSegment(ii)) {
        const arcIndex = aLineChain.ArcIndex(ii);

        if (!handledArcs.has(arcIndex)) {
          handledArcs.add(arcIndex);
          const arc = aLineChain.Arc(arcIndex);
          const arc_path = this.arcPath(
            arc.GetCenter(),
            arc.GetStartAngle(),
            arc.GetCentralAngle(),
            arc.GetRadius(),
          );

          for (let k = arc_path.length - 1; k >= 0; --k) path.push(arc_path[k]!);
        }
      } else {
        const seg = aLineChain.Segment(ii);
        path.push(this.userToDeviceCoordinates(seg.A));
        path.push(this.userToDeviceCoordinates(seg.B));
      }
    }

    if (path.length <= 1) return;

    const e = (aValue: number): string => this.encodeDoubleForPlotter(aValue);
    let out = `${e(path[0]!.x)} ${e(path[0]!.y)} m `;

    for (let ii = 1; ii < path.length; ++ii) out += `${e(path[ii]!.x)} ${e(path[ii]!.y)} l `;

    // Close path and stroke and/or fill
    if (aFill === FILL_T.NO_FILL) out += 'S\n';
    else if (aWidth === 0) out += 'h f\n';
    else out += 'b\n';

    this.work(out);
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
  override Arc(
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

  /**
   * `PenTo`. 'Z' strokes whatever path is open and parks the pen at (-1,-1),
   * which is what makes the *next* plume emit a fresh `m`. Note that the
   * suppression test compares the *user* position, so a repeated point at the
   * same plume writes nothing even though the device position might differ
   * after a viewport change.
   */
  PenTo(pos: Vec2, plume: PEN_PLUME): void {
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
  override PlotImage(aImage: PdfImage, aPos: Vec2, aScaleFactor: number): void {
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
    const paperSize = toVector2I(this.PageSettings().GetSizeMils());

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
            this.userToDeviceSize(this.renderSettings().GetDefaultPenWidth()),
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
      x: this.PageSettings().GetSizeMils().x * PTsPERMIL,
      y: this.PageSettings().GetSizeMils().y * PTsPERMIL,
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

    if (!this.m_strokeFontManager) this.m_strokeFontManager = new PDF_STROKE_FONT_MANAGER();
    else this.m_strokeFontManager.Reset();

    if (!this.m_outlineFontManager) this.m_outlineFontManager = new PDF_OUTLINE_FONT_MANAGER();
    else this.m_outlineFontManager.Reset();

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

  /** `emitStrokeFonts`: each stroke-font subset as a Type 3 font. */
  private emitStrokeFonts(): void {
    if (!this.m_strokeFontManager) return;

    for (const subset of this.m_strokeFontManager.AllSubsets()) {
      if (subset.GlyphCount() <= 1) {
        subset.SetCharProcsHandle(-1);
        subset.SetFontHandle(-1);
        subset.SetToUnicodeHandle(-1);
        continue;
      }

      for (const glyph of subset.Glyphs()) {
        const charProcHandle = this.startPdfStream();

        if (glyph.m_stream !== '') this.work(`${glyph.m_stream}\n`);

        this.closePdfStream();
        glyph.m_charProcHandle = charProcHandle;
      }

      const charProcDictHandle = this.startPdfObject();
      this.out('<<\n');

      for (const glyph of subset.Glyphs())
        this.out(`    /${glyph.m_name} ${glyph.m_charProcHandle} 0 R\n`);

      this.out('>>\n');
      this.closePdfObject();
      subset.SetCharProcsHandle(charProcDictHandle);

      const toUnicodeHandle = this.startPdfStream();
      const cmap = subset.BuildToUnicodeCMap();

      if (cmap !== '') this.work(cmap);

      this.closePdfStream();
      subset.SetToUnicodeHandle(toUnicodeHandle);

      const fontMatrixScale = 1.0 / subset.UnitsPerEm();
      const minX = subset.FontBBoxMinX();
      const minY = subset.FontBBoxMinY();
      const maxX = subset.FontBBoxMaxX();
      const maxY = subset.FontBBoxMaxY();
      const d = (v: number): string => this.encodeDoubleForPlotter(v);

      const fontHandle = this.startPdfObject();
      this.out(
        `<<\n/Type /Font\n/Subtype /Type3\n/Name ${subset.ResourceName()}\n` +
          `/FontBBox [ ${d(minX)} ${d(minY)} ${d(maxX)} ${d(maxY)} ]\n`,
      );
      this.out(
        `/FontMatrix [ ${d(fontMatrixScale)} 0 0 ${d(fontMatrixScale)} 0 0 ]\n` +
          `/CharProcs ${subset.CharProcsHandle()} 0 R\n`,
      );
      this.out(`/Encoding << /Type /Encoding /Differences ${subset.BuildDifferencesArray()} >>\n`);
      this.out(
        `/FirstChar ${subset.FirstChar()}\n/LastChar ${subset.LastChar()}\n` +
          `/Widths ${subset.BuildWidthsArray()}\n`,
      );
      this.out(
        `/ToUnicode ${subset.ToUnicodeHandle()} 0 R\n/Resources << /ProcSet [/PDF /Text] >>\n>>\n`,
      );
      this.closePdfObject();
      subset.SetFontHandle(fontHandle);
    }
  }

  /** `emitOutlineFonts`: each outline-font subset as a Type 0 / CIDFontType2 pair. */
  private emitOutlineFonts(): void {
    if (!this.m_outlineFontManager) return;

    for (const subset of this.m_outlineFontManager.AllSubsets()) {
      if (!subset.HasGlyphs()) continue;

      const fontData = subset.FontFileData();

      if (fontData.length === 0) continue;

      const fontFileHandle = this.startPdfStream();
      subset.SetFontFileHandle(fontFileHandle);

      this.workBytes(fontData);

      this.closePdfStream();

      const cidMap = subset.BuildCIDToGIDStream();
      const cidMapHandle = this.startPdfStream();
      subset.SetCIDMapHandle(cidMapHandle);

      if (cidMap.length > 0) this.workBytes(cidMap);

      this.closePdfStream();

      const toUnicode = subset.BuildToUnicodeCMap();
      const toUnicodeHandle = this.startPdfStream();
      subset.SetToUnicodeHandle(toUnicodeHandle);

      if (toUnicode !== '') this.work(toUnicode);

      this.closePdfStream();

      const d = (v: number): string => this.encodeDoubleForPlotter(v);
      const descriptorHandle = this.startPdfObject();
      subset.SetFontDescriptorHandle(descriptorHandle);

      this.out(
        `<<\n/Type /FontDescriptor\n/FontName /${subset.BaseFontName()}\n/Flags ${subset.Flags()}\n` +
          `/ItalicAngle ${d(subset.ItalicAngle())}\n/Ascent ${d(subset.Ascent())}\n` +
          `/Descent ${d(subset.Descent())}\n/CapHeight ${d(subset.CapHeight())}\n` +
          `/StemV ${d(subset.StemV())}\n/FontBBox [ ${d(subset.BBoxMinX())} ${d(subset.BBoxMinY())} ` +
          `${d(subset.BBoxMaxX())} ${d(subset.BBoxMaxY())} ]\n/FontFile2 ${subset.FontFileHandle()} 0 R\n>>\n`,
      );
      this.closePdfObject();

      const cidFontHandle = this.startPdfObject();
      subset.SetCIDFontHandle(cidFontHandle);

      this.out(
        `<<\n/Type /Font\n/Subtype /CIDFontType2\n/BaseFont /${subset.BaseFontName()}\n` +
          '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>\n' +
          `/FontDescriptor ${subset.FontDescriptorHandle()} 0 R\n/W ${subset.BuildWidthsArray()}\n` +
          `/CIDToGIDMap ${subset.CIDMapHandle()} 0 R\n>>\n`,
      );
      this.closePdfObject();

      const fontHandle = this.startPdfObject();
      subset.SetFontHandle(fontHandle);

      this.out(
        `<<\n/Type /Font\n/Subtype /Type0\n/BaseFont /${subset.BaseFontName()}\n/Encoding /Identity-H\n` +
          `/DescendantFonts [ ${subset.CIDFontHandle()} 0 R ]\n/ToUnicode ${subset.ToUnicodeHandle()} 0 R\n>>\n`,
      );
      this.closePdfObject();
    }
  }

  /**
   * `endPlotEmitResources`: the fonts, the font resource dictionary, the
   * images.
   *
   * The image resource dictionary is opened with a `println("<<\n")`, i.e. a
   * blank line after the `<<`. Trimming it would move every later object.
   */
  private endPlotEmitResources(): void {
    this.emitOutlineFonts();
    this.emitStrokeFonts();

    this.startPdfObject(this.m_fontResDictHandle);
    this.out('<<\n');

    if (this.m_outlineFontManager) {
      for (const subset of this.m_outlineFontManager.AllSubsets()) {
        if (subset.FontHandle() >= 0)
          this.out(`    ${subset.ResourceName()} ${subset.FontHandle()} 0 R\n`);
      }
    }

    if (this.m_strokeFontManager) {
      for (const subset of this.m_strokeFontManager.AllSubsets()) {
        if (subset.FontHandle() >= 0)
          this.out(`    ${subset.ResourceName()} ${subset.FontHandle()} 0 R\n`);
      }
    }

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
            toColour(this.renderSettings().GetBackgroundColor()),
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

  /**
   * `PDF_PLOTTER::Text`: the text as PDF text, in the Type 3 stroke font or the
   * embedded outline font, one `BT … ET` block per word so markup (sub- and
   * superscripts, overbars) can move and resize between words.
   *
   * `@{…}` expression substitution runs here upstream (EXPRESSION_EVALUATOR);
   * as in PLOTTER::Text it is skipped rather than approximated.
   */
  override Text(
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
    _aMultilineAllowed: boolean,
    aFont: PLOTTER_FONT | null,
    aFontMetrics?: unknown,
    aData?: unknown,
  ): void {
    // PDF files do not like 0 sized texts which create broken files.
    if (aSize.x === 0 || aSize.y === 0) return;

    const text = aText;
    let width = aWidth;

    this.SetColor(aColor);
    this.SetCurrentLineWidth(width, aData);

    const t_size = { x: Math.abs(aSize.x), y: Math.abs(aSize.y) };
    const textMirrored = aSize.x < 0;

    if (width === 0 && aBold) width = GetPenSizeForBold(Math.min(t_size.x, t_size.y));

    if (width < 0) width = -width;

    // `if( !aFont ) aFont = KIFONT::FONT::GetFont( m_renderSettings->GetDefaultFont() )`
    const font: FONT = aFont?.font ?? FONT.GetFont();
    const fontMetrics: METRICS =
      aFontMetrics instanceof METRICS ? aFontMetrics : (aFont?.metrics ?? METRICS.Default());

    const computeAlignedStartPos = (): Vec2 => {
      let startPos = { x: aPos.x, y: aPos.y };

      if (font.IsStroke()) {
        const alignAttrs = new TEXT_ATTRIBUTES();
        alignAttrs.m_Size = t_size;
        alignAttrs.m_StrokeWidth = width;
        alignAttrs.m_Halign = aH_justify;
        alignAttrs.m_Valign = aV_justify;
        alignAttrs.m_Bold = aBold;
        alignAttrs.m_Italic = aItalic;

        // getLinePositions returns anchor + offset; use (0,0) to get the offset alone.
        let drawOffset = font.GetAlignedDrawPosition(text, { x: 0, y: 0 }, alignAttrs, fontMetrics);

        // GAL mirrors about the text anchor (GetDrawPos), after placing the unmirrored
        // cursor.  Negating the X offset before rotation makes the Type3 Tz=-100 origin
        // land on the mirrored start so ink sits on the correct side of the anchor.
        if (textMirrored) drawOffset = { x: -drawOffset.x, y: drawOffset.y };

        drawOffset = RotatePoint(drawOffset, aOrient);
        startPos = { x: aPos.x + drawOffset.x, y: aPos.y + drawOffset.y };
      } else {
        const full_box = {
          ...font.StringBoundaryLimits(text, t_size, width, aBold, aItalic, fontMetrics),
        };

        if (textMirrored) full_box.x *= -1;

        const box_x = RotatePoint({ x: full_box.x, y: 0 }, aOrient);
        const box_y = RotatePoint({ x: 0, y: full_box.y }, aOrient);

        if (aH_justify === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER)
          startPos = {
            x: startPos.x - Math.trunc(box_x.x / 2),
            y: startPos.y - Math.trunc(box_x.y / 2),
          };
        else if (aH_justify === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
          startPos = { x: startPos.x - box_x.x, y: startPos.y - box_x.y };

        if (aV_justify === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER)
          startPos = {
            x: startPos.x + Math.trunc(box_y.x / 2),
            y: startPos.y + Math.trunc(box_y.y / 2),
          };
        else if (aV_justify === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP)
          startPos = { x: startPos.x + box_y.x, y: startPos.y + box_y.y };
      }

      return startPos;
    };

    // Parse the text for markup
    const markupTree = new MARKUP_PARSER(text).Parse();

    if (!markupTree) {
      // Fallback to simple text rendering if parsing fails
      let pos = computeAlignedStartPos();

      for (const word of wxTokenizeRetDelims(text, ' '))
        pos = this.renderWord(
          word,
          pos,
          t_size,
          aOrient,
          textMirrored,
          width,
          aBold,
          aItalic,
          font,
          fontMetrics,
          aV_justify,
          0,
        );

      return;
    }

    const pos = computeAlignedStartPos();

    // Render markup tree
    const overbars: OVERBAR_INFO[] = [];
    this.renderMarkupNode(
      markupTree,
      pos,
      t_size,
      aOrient,
      textMirrored,
      width,
      aBold,
      aItalic,
      font,
      fontMetrics,
      aV_justify,
      0,
      overbars,
    );

    // Draw any overbars that were accumulated
    this.drawOverbars(overbars, aOrient, fontMetrics);
  }

  /** `renderWord`: one word as PDF text; returns the cursor after it. */
  private renderWord(
    aWord: string,
    aPosition: Vec2,
    aSize: Vec2,
    aOrient: EDA_ANGLE,
    aTextMirrored: boolean,
    aWidth: number,
    aBold: boolean,
    aItalic: boolean,
    aFont: FONT,
    aFontMetrics: METRICS,
    aV_justify: GR_TEXT_V_ALIGN_T,
    aTextStyle: TEXT_STYLE_FLAGS,
  ): Vec2 {
    // Don't try to output a blank string, but handle space characters for word separation
    if (aWord === '') return aPosition;

    // Compute the per-word cursor advance via the font's own glyph metrics so the gap between
    // words matches what the PDF Tj operator further down will produce.  StringBoundaryLimits
    // would inflate the stroke-font bbox by 3*thickness, opening spurious whitespace between
    // words (issue #24419).
    //
    // Only BOLD/ITALIC from the caller are forwarded; SUPERSCRIPT/SUBSCRIPT in aTextStyle have
    // already been baked into aSize by renderMarkupNode, and Tj renders with that reduced Tf
    // size, so GetTextAsGlyphs must not apply the SUPER_SUB_SIZE_MULTIPLIER a second time.
    let metricsStyle: TEXT_STYLE_FLAGS = 0;

    if (aBold) metricsStyle |= TEXT_STYLE.BOLD;

    if (aItalic) metricsStyle |= TEXT_STYLE.ITALIC;

    const cursorAdvanceX = (aText: string): number =>
      aFont.GetTextAsGlyphs(
        null,
        null,
        aText,
        aSize,
        { x: 0, y: 0 },
        ANGLE_0,
        false,
        { x: 0, y: 0 },
        metricsStyle,
      ).x;

    const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

    // If the word is just a space character, advance position by space width and continue
    if (aWord === ' ') {
      const spaceBox = { x: cursorAdvanceX(' '), y: 0 };

      if (aTextMirrored) spaceBox.x *= -1;

      return add(aPosition, RotatePoint(spaceBox, aOrient));
    }

    // Tabs are layout only.  Plot visible runs at font layout positions.
    if (aWord.includes('\t')) {
      const positionedAdvance = (aText: string): Vec2 => {
        const advance = { x: cursorAdvanceX(aText), y: 0 };

        if (aTextMirrored) advance.x *= -1;

        return RotatePoint(advance, aOrient);
      };

      let prefix = '';
      let segment = '';

      const flushSegment = (): void => {
        if (segment !== '') {
          this.renderWord(
            segment,
            add(aPosition, positionedAdvance(prefix)),
            aSize,
            aOrient,
            aTextMirrored,
            aWidth,
            aBold,
            aItalic,
            aFont,
            aFontMetrics,
            aV_justify,
            aTextStyle,
          );
          prefix += segment;
          segment = '';
        }
      };

      for (const c of aWord) {
        if (c === '\t') {
          flushSegment();
          prefix += c;
        } else {
          segment += c;
        }
      }

      flushSegment();

      return add(aPosition, positionedAdvance(aWord));
    }

    // Compute transformation parameters for this word
    const params = this.computeTextParameters(
      aPosition,
      aWord,
      aOrient,
      aSize,
      aTextMirrored,
      GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT,
      GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM,
      aWidth,
      aItalic,
      aBold,
    );
    const { wideningFactor, ctm_a, ctm_b, ctm_c, ctm_d, heightFactor } = params;
    let { ctm_e, ctm_f } = params;

    const bbox = { x: cursorAdvanceX(aWord), y: 0 };

    if (aTextMirrored) bbox.x *= -1;

    const nextPos = add(aPosition, RotatePoint(bbox, aOrient));

    // Apply vertical offset for subscript/superscript
    // Stroke font positioning (baseline) already correct per user feedback.
    // Outline fonts need: superscript +1 full font height higher; subscript +1 full font height higher
    if (aTextStyle & TEXT_STYLE.SUPERSCRIPT) {
      const factor = aFont.IsOutline() ? 0.05 : 0.03; // stroke original ~0.40, outline needs +1.0
      const offset = RotatePoint({ x: 0, y: lround(aSize.y * factor) }, aOrient);
      ctm_e -= offset.x;
      ctm_f += offset.y; // Note: PDF Y increases upward
    } else if (aTextStyle & TEXT_STYLE.SUBSCRIPT) {
      // For outline fonts raise by one font height versus stroke (which shifts downward slightly)
      let offset = { x: 0, y: 0 };

      if (aFont.IsStroke()) offset.y = lround(aSize.y * 0.01);

      offset = RotatePoint(offset, aOrient);
      ctm_e += offset.x;
      ctm_f -= offset.y; // Note: PDF Y increases upward
    }

    const f = (v: number): string => fixed(v, 6);

    // Render the word using existing outline font logic
    if (aFont.IsOutline()) {
      const outlineFont = aFont as OUTLINE_FONT;
      const outlineRuns: PDF_OUTLINE_FONT_RUN[] = [];

      if (this.m_outlineFontManager) {
        this.m_outlineFontManager.EncodeString(
          aWord,
          outlineFont,
          aItalic || (aTextStyle & TEXT_STYLE.ITALIC) !== 0,
          aBold || (aTextStyle & TEXT_STYLE.BOLD) !== 0,
          outlineRuns,
        );
      }

      if (outlineRuns.length > 0) {
        // Apply baseline adjustment (keeping existing logic)
        const baseline_factor = 0.17;
        let alignment_multiplier = 1.0;

        if (aV_justify === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER) alignment_multiplier = 2.0;
        else if (aV_justify === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP) alignment_multiplier = 4.0;

        const font_size_dev = this.userToDeviceSizeV(aSize);
        const baseline_adjustment = font_size_dev.y * baseline_factor * alignment_multiplier;

        const angle_rad = aOrient.AsRadians();
        const cos_angle = Math.cos(angle_rad);
        const sin_angle = Math.sin(angle_rad);

        const adjusted_ctm_e = ctm_e - baseline_adjustment * sin_angle;
        const adjusted_ctm_f = ctm_f + baseline_adjustment * cos_angle;

        const adj_c = ctm_c;
        const adj_d = ctm_d;

        // Synthetic italic (shear) for outline font if requested but font not intrinsically italic
        let syntheticItalicApplied = false;
        let appliedTilt = 0.0;
        let syn_c = adj_c;
        let syn_d = adj_d;
        let syn_a = ctm_a;
        let syn_b = ctm_b;
        const wantItalic = aItalic || (aTextStyle & TEXT_STYLE.ITALIC) !== 0;

        // (KICAD_FORCE_SYN_ITALIC / KICAD_SYN_ITALIC_TILT, environment overrides for
        // testing, are never set here.)
        const wantBold = aBold || (aTextStyle & TEXT_STYLE.BOLD) !== 0;
        const fontIsItalic = aFont.IsItalic();
        const fontIsBold = aFont.IsBold();
        const fontIsFakeItalic = outlineFont.IsFakeItalic();

        // Apply synthetic italic if:
        //  - Italic requested AND outline font
        //  - And there is no REAL italic face.
        //    (A fake italic flag from fontconfig substitution should NOT block synthetic shear.)
        const realItalicFace = fontIsItalic && !fontIsFakeItalic;

        if (wantItalic && !realItalicFace) {
          // Left-multiply a horizontal shear: (c', d') = (c + tilt * a, d + tilt * b).
          // This produces a right-leaning italic for positive tilt.
          let tilt = ITALIC_TILT;

          if (wideningFactor < 0)
            // mirrored text should mirror the shear
            tilt = -tilt;

          syn_c = adj_c + tilt * syn_a;
          syn_d = adj_d + tilt * syn_b;
          appliedTilt = tilt;
          syntheticItalicApplied = true;
        }

        if (wantBold && !fontIsBold) {
          // Slight horizontal widening to simulate bold (~3%)
          syn_a *= 1.03;
          syn_b *= 1.03;
        }

        if (syntheticItalicApplied) {
          // PDF comment to allow manual inspection in the output stream
          this.work(
            `% syn-italic tilt=${shortest(appliedTilt)} a=${shortest(syn_a)} b=${shortest(syn_b)} ` +
              `c=${shortest(syn_c)} d=${shortest(syn_d)}\n`,
          );
        }

        this.work(
          `q ${f(syn_a)} ${f(syn_b)} ${f(syn_c)} ${f(syn_d)} ${f(adjusted_ctm_e)} ${f(adjusted_ctm_f)} cm BT ` +
            `0 Tr ${this.encodeDoubleForPlotter(wideningFactor * 100)} Tz `,
        );

        for (const run of outlineRuns) {
          let out = `${run.m_subset.ResourceName()} ${this.encodeDoubleForPlotter(heightFactor)} Tf <`;

          for (const glyph of run.m_glyphs)
            out += `${hex2((glyph.cid >> 8) & 0xff)}${hex2(glyph.cid & 0xff)}`;

          out += '> Tj ';
          this.work(out);
        }

        this.work('ET\n');
        this.work('Q\n');
      }
    } else {
      // Handle stroke fonts
      if (!this.m_strokeFontManager) return nextPos;

      const runs: PDF_STROKE_FONT_RUN[] = [];
      this.m_strokeFontManager.EncodeString(aWord, runs, aWidth, aSize.x, aSize.y, aBold, aItalic);

      if (runs.length > 0) {
        const dev_size = this.userToDeviceSizeV(aSize);
        const fontSize = dev_size.y;

        let adj_c = ctm_c;
        let adj_d = ctm_d;

        if (aItalic) {
          let tilt = -ITALIC_TILT;

          if (wideningFactor < 0) tilt = -tilt;

          adj_c -= ctm_a * tilt;
          adj_d -= ctm_b * tilt;
        }

        // Cancel m_PDFStrokeFontXOffset / m_PDFStrokeFontYOffset baked into Type3 charprocs.
        // Horizontal/vertical anchors are already GAL-aligned in PDF_PLOTTER::Text().
        // X offset is stored in aspect-scaled glyph X units, so cancel with device width.
        // When Tz mirrors (wideningFactor < 0), glyph X is flipped, so cancel the other way.
        const xOffsetEm = ADVANCED_CFG.GetCfg().m_PDFStrokeFontXOffset;
        const yOffsetEm = ADVANCED_CFG.GetCfg().m_PDFStrokeFontYOffset;
        const xCancelDev = xOffsetEm * dev_size.x;
        const yCancelDev = yOffsetEm * dev_size.y;
        const xSign = wideningFactor < 0 ? -1.0 : 1.0;

        const adj_ctm_e = ctm_e - yCancelDev * adj_c - xSign * xCancelDev * ctm_a;
        const adj_ctm_f = ctm_f - yCancelDev * adj_d - xSign * xCancelDev * ctm_b;

        // Aspect ratio is baked into the Type3 glyph charprocs; Tz only mirrors when needed.
        const tzFactor = wideningFactor < 0 ? -100.0 : 100.0;

        this.work(
          `q ${f(ctm_a)} ${f(ctm_b)} ${f(adj_c)} ${f(adj_d)} ${f(adj_ctm_e)} ${f(adj_ctm_f)} cm BT ` +
            `0 Tr ${this.encodeDoubleForPlotter(tzFactor)} Tz `,
        );

        for (const run of runs) {
          this.work(
            `${run.m_subset.ResourceName()} ${this.encodeDoubleForPlotter(fontSize)} Tf ` +
              `${encodeByteString(run.m_bytes)} Tj `,
          );
        }

        this.work('ET\n');
        this.work('Q\n');
      }
    }

    return nextPos;
  }

  /** `renderMarkupNode`: a markup subtree, word by word; returns the cursor after it. */
  private renderMarkupNode(
    aNode: NODE | null,
    aPosition: Vec2,
    aBaseSize: Vec2,
    aOrient: EDA_ANGLE,
    aTextMirrored: boolean,
    aWidth: number,
    aBaseBold: boolean,
    aBaseItalic: boolean,
    aFont: FONT,
    aFontMetrics: METRICS,
    aV_justify: GR_TEXT_V_ALIGN_T,
    aTextStyle: TEXT_STYLE_FLAGS,
    aOverbars: OVERBAR_INFO[],
  ): Vec2 {
    let nextPosition = aPosition;

    if (!aNode) return nextPosition;

    let currentStyle = aTextStyle;
    let currentSize = aBaseSize;
    let drawOverbar = false;

    // Handle markup node types
    if (!aNode.is_root()) {
      if (aNode.isSubscript()) {
        currentStyle |= TEXT_STYLE.SUBSCRIPT;
        // Subscript: smaller size and lower position
        currentSize = { x: Math.trunc(aBaseSize.x * 0.5), y: Math.trunc(aBaseSize.y * 0.6) };
      } else if (aNode.isSuperscript()) {
        currentStyle |= TEXT_STYLE.SUPERSCRIPT;
        // Superscript: smaller size and higher position
        currentSize = { x: Math.trunc(aBaseSize.x * 0.5), y: Math.trunc(aBaseSize.y * 0.6) };
      }

      if (aNode.isOverbar()) {
        drawOverbar = true;
        // Overbar doesn't change font size, just adds decoration
      }

      // Render content of this node if it has text
      if (aNode.has_content()) {
        const nodeText = aNode.asWxString();

        // Process text content (simplified version of the main text processing)
        for (const word of wxTokenizeRetDelims(nodeText, ' ')) {
          nextPosition = this.renderWord(
            word,
            nextPosition,
            currentSize,
            aOrient,
            aTextMirrored,
            aWidth,
            aBaseBold || (currentStyle & TEXT_STYLE.BOLD) !== 0,
            aBaseItalic || (currentStyle & TEXT_STYLE.ITALIC) !== 0,
            aFont,
            aFontMetrics,
            aV_justify,
            currentStyle,
          );
        }
      }
    }

    // Process child nodes recursively
    for (const child of aNode.children) {
      const startPos = nextPosition;

      nextPosition = this.renderMarkupNode(
        child,
        nextPosition,
        currentSize,
        aOrient,
        aTextMirrored,
        aWidth,
        aBaseBold,
        aBaseItalic,
        aFont,
        aFontMetrics,
        aV_justify,
        currentStyle,
        aOverbars,
      );

      // Store overbar info for later rendering
      if (drawOverbar) {
        aOverbars.push({
          startPos,
          endPos: nextPosition,
          fontSize: currentSize,
          isOutline: aFont.IsOutline(),
          vAlign: aV_justify,
        });
      }
    }

    return nextPosition;
  }

  /** `drawOverbars`: each accumulated overbar as a stroked line. */
  private drawOverbars(
    aOverbars: readonly OVERBAR_INFO[],
    aOrient: EDA_ANGLE,
    aFontMetrics: METRICS,
  ): void {
    for (const overbar of aOverbars) {
      // Baseline direction (vector from start to end). If zero length, derive from orientation.
      const dir = {
        x: overbar.endPos.x - overbar.startPos.x,
        y: overbar.endPos.y - overbar.startPos.y,
      };

      let len = Math.hypot(dir.x, dir.y);

      if (len <= 1e-6) {
        // Fallback: derive direction from orientation angle
        const ang = aOrient.AsRadians();
        dir.x = Math.cos(ang);
        dir.y = Math.sin(ang);
        len = 1.0;
      }

      dir.x /= len;
      dir.y /= len;

      // Perpendicular (rotate dir 90° CCW). Upward in text space so overbar sits above baseline.
      const nrm = { x: -dir.y, y: dir.x };

      // Base vertical offset distance in device units (baseline -> default overbar position)
      let barOffset = aFontMetrics.GetOverbarVerticalPosition(overbar.fontSize.y);

      // Adjust further to match screen drawing.  This is somewhat disturbing, but I can't figure
      // out why it's needed.
      if (overbar.isOutline) barOffset += overbar.fontSize.y * 0.16;
      else barOffset += overbar.fontSize.y * 0.32;

      // Mirror the text vertical alignment adjustments used for baseline shifting.
      let alignMult = 1.0;

      switch (overbar.vAlign) {
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
          alignMult = overbar.isOutline ? 2.0 : 1.0;
          break;
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
          alignMult = overbar.isOutline ? 4.0 : 1.0;
          break;
        default:
          alignMult = 1.0;
          break; // bottom
      }

      if (alignMult > 1.0) {
        // Scale only the baseline component (approx 17% of height, matching earlier baseline_factor)
        const baseline_factor = 0.17;
        barOffset += (alignMult - 1.0) * (baseline_factor * overbar.fontSize.y);
      }

      // Trim to avoid rounded cap extension (assumes stroke caps); proportion of font width.
      const barTrim = overbar.fontSize.x * 0.1;

      const startPt = { x: overbar.startPos.x, y: overbar.startPos.y };
      const endPt = { x: overbar.endPos.x, y: overbar.endPos.y };

      // Both endpoints should share identical vertical (normal) offset above baseline.
      const offVec = { x: -barOffset * nrm.x, y: -barOffset * nrm.y };

      startPt.x += dir.x * barTrim + offVec.x;
      startPt.y += dir.y * barTrim + offVec.y;
      endPt.x -= dir.x * barTrim - offVec.x; // subtract trim, then apply same vertical offset
      endPt.y -= dir.y * barTrim - offVec.y;

      this.MoveTo({ x: KiROUND(startPt.x), y: KiROUND(startPt.y) });
      this.LineTo({ x: KiROUND(endPt.x), y: KiROUND(endPt.y) });
      this.PenFinish();
    }
  }

  /** `PDF_PLOTTER::PlotText`: a mirrored run is a negative width into Text. */
  override PlotText(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aAttributes: PLOTTER_TEXT_ATTRIBUTES,
    aFont: PLOTTER_FONT | null,
    aFontMetrics?: unknown,
    aData?: unknown,
  ): void {
    const size = { x: aAttributes.m_Size.x, y: aAttributes.m_Size.y };

    // PDF files do not like 0 sized texts which create broken files.
    if (size.x === 0 || size.y === 0) return;

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

  /** `PDF_PLOTTER::encodeStringForPlotter`, the free function above. */
  protected override encodeStringForPlotter(aUnicode: string): string {
    return encodeStringForPlotter(aUnicode);
  }

  /** `HyperlinkBox`. Queued until ClosePage, which is where the object is made. */
  override HyperlinkBox(aBox: PdfBox2, aDestinationURL: string): void {
    this.m_hyperlinksInPage.push({ box: cloneBox(aBox), url: aDestinationURL });
  }

  /** `HyperlinkMenu`. Likewise; the JavaScript is only built at EndPlot. */
  override HyperlinkMenu(aBox: PdfBox2, aDestURLs: readonly string[]): void {
    this.m_hyperlinkMenusInPage.push({ box: cloneBox(aBox), urls: [...aDestURLs] });
  }

  /**
   * `Bookmark`. Grouped by name, and the group name defaults to the empty
   * string — which is a real key, so ungrouped bookmarks all land under one
   * unnamed outline node rather than directly under the page.
   */
  override Bookmark(aLocation: PdfBox2, aSymbolReference: string, aGroupName = ''): void {
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
