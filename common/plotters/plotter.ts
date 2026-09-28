// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PLOTTER` — the base every plot backend derives from: KiCad's
 * `include/plotters/plotter.h` and `common/plotters/plotter.cpp`, one unit
 * under the `.cpp` name as common/STRUCTURE.md prescribes for a header/source
 * pair.
 *
 * The class tree is upstream's:
 *
 *     PLOTTER                      (this file)
 *     ├── PSLIKE_PLOTTER           (PS_plotter.ts)
 *     │   ├── PS_PLOTTER           (PS_plotter.ts)
 *     │   ├── PDF_PLOTTER          (PDF_plotter.ts)
 *     │   └── SVG_PLOTTER          (SVG_plotter.ts)
 *     ├── DXF_PLOTTER              (DXF_plotter.ts)
 *     └── GERBER_PLOTTER           (GERBER_plotter.ts)
 *
 * and eeschema and pcbnew both plot through it, as upstream's do.
 *
 * Three deliberate differences from the C++, each because a browser has no
 * `FILE*` or no overloading:
 *
 * 1. **No `FILE*`.** Every backend accumulates its document in memory and hands
 *    it back with `bytes()` / `text()`. `m_outputFile` is a flag that is true
 *    between OpenFile and EndPlot, which is all upstream's `wxASSERT(
 *    m_outputFile )` guards ever read.
 * 2. **Overloads get names.** `Arc( start, mid, end, … )` is `ArcThroughPoints`,
 *    `userToDeviceSize( VECTOR2I )` is `userToDeviceSizeV`, the
 *    SHAPE_LINE_CHAIN `PlotPoly` is `PlotPolyLineChain` and the EDA_SHAPE
 *    `ThickArc` is `ThickArcShape`. The centre/angle forms keep the upstream
 *    name.
 * 3. **The font is handed in wrapped.** `Text` / `PlotText` take a
 *    {@link PLOTTER_FONT}; {@link plotterFont} wraps a real `KIFONT::FONT` and
 *    its METRICS and draws through a CALLBACK_GAL exactly as upstream does.
 *    Called without one, the stroking base throws rather than substitute a
 *    font (PDF_PLOTTER falls back to the stroke font, as upstream).
 */

import type { Color4d } from '../gal/color4d.js';
import { FILL_T } from '../eda_shape.js';
import type { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '../eda_text.js';
import { CALLBACK_GAL } from '../callback_gal.js';
import type { FONT } from '../font/font.js';
import type { METRICS } from '../font/font_metrics.js';
import { TEXT_ATTRIBUTES } from '../font/text_attributes.js';
import { GetPenSizeForBold, GRTextWidth } from '../gr_text.js';
import type { PlotterRenderSettings } from '../render_settings.js';
import { LINE_STYLE } from '../stroke_params.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { ANGLE_0, ANGLE_90, ANGLE_180, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { CalcArcCenter, RotatePoint } from '@ziroeda/kimath/src/trigo.js';

// plotter.h includes eda_shape.h and stroke_params.h, so every backend sees
// FILL_T and LINE_STYLE through it; re-exported for the same reason.
export { FILL_T, LINE_STYLE };

/**
 * `PLOTTER::DO_NOT_SET_LINE_WIDTH` (plotter.h:139) — "Skip selection". The pen
 * is left exactly as it is; `SetCurrentLineWidth` returns without touching it.
 */
export const DO_NOT_SET_LINE_WIDTH = -2;

/**
 * `PLOTTER::USE_DEFAULT_LINE_WIDTH` (plotter.h:140) — "use the default pen",
 * i.e. resolve through `RENDER_SETTINGS::GetDefaultPenWidth()`.
 */
export const USE_DEFAULT_LINE_WIDTH = -1;

// Must be in the same order as the drop-down list in the plot dialog inside pcbnew
// Units (inch/mm for DXF plotter
export enum DXF_UNITS {
  INCH = 0, // Do not use MM: it conficts with a Windows header
  MM = 1,
}

/**
 * The set of supported output plot formats.
 *
 * They should be kept in order of the radio buttons in the plot panel/windows.
 */
export enum PLOT_FORMAT {
  UNDEFINED = -1,
  FIRST_FORMAT = 0,
  HPGL = FIRST_FORMAT,
  GERBER,
  POST,
  DXF,
  PDF,
  SVG,
  LAST_FORMAT = SVG,
}

/**
 * Options to draw items with thickness ( segments, arcs, circles, texts...)
 */
export enum DXF_OUTLINE_MODE {
  SKETCH = 0, // sketch mode: draw segments outlines only
  FILLED = 1, // normal mode: solid segments
}

/**
 * Which kind of text to output with the PSLIKE plotters.
 *
 * You can:
 * 1) only use the internal vector font
 * 2) only use native postscript fonts
 * 3) use the internal vector font and add 'phantom' text to aid
 *    searching
 * 4) keep the default for the plot driver
 *
 * This is recognized by the DXF driver too, where NATIVE emits
 * TEXT entities instead of stroking the text
 */
export enum PLOT_TEXT_MODE {
  STROKE = 0,
  NATIVE,
  PHANTOM,
  DEFAULT,
}

export class PLOT_PARAMS {
  GetDXFPlotMode(): DXF_OUTLINE_MODE {
    return DXF_OUTLINE_MODE.FILLED; // wxFAIL
  }

  GetTextMode(): PLOT_TEXT_MODE {
    return PLOT_TEXT_MODE.DEFAULT;
  }
}

/**
 * @enum DXF_LAYER_OUTPUT_MODE
 * @brief Specifies the output mode for the DXF layer.
 *
 * This enumeration is used to define the mode of output for the DXF layer.
 * It allows the user to choose between retrieving the layer name or the color name.
 */
export enum DXF_LAYER_OUTPUT_MODE {
  Layer_Name = 0,
  Layer_Color_Name,
  Current_Layer_Name,
  Current_Layer_Color_Name,
}

/**
 * `PAGE_INFO`, reduced to the accessors the plotters make on it. `PAGE_INFO`
 * (common/page_info.ts) satisfies it; so does a literal built from the numbers
 * a caller already has. `GetSizeMils` is already orientation-corrected —
 * PAGE_INFO::SetPortrait swaps m_size.
 */
export interface PLOTTER_PAGE_INFO {
  GetSizeMils(): Vec2;
  GetWidthMils(): number;
  GetHeightMils(): number;
  IsPortrait(): boolean;
  IsCustom(): boolean;
  GetTypeAsString(): string;
}

/**
 * A {@link PLOTTER_PAGE_INFO} from the numbers a caller already has. The width
 * and height accessors read the *same* stored size, so a landscape page must be
 * handed its landscape size, exactly as PAGE_INFO stores one.
 */
export function plotterPageInfo(aOptions: {
  sizeMils: Vec2;
  type?: string;
  portrait?: boolean;
  custom?: boolean;
}): PLOTTER_PAGE_INFO {
  const size = { x: aOptions.sizeMils.x, y: aOptions.sizeMils.y };
  const type = aOptions.type ?? 'User';
  const custom = aOptions.custom ?? type === 'User';

  return {
    GetSizeMils: () => ({ x: size.x, y: size.y }),
    GetWidthMils: () => size.x,
    GetHeightMils: () => size.y,
    IsPortrait: () => aOptions.portrait ?? false,
    IsCustom: () => custom,
    GetTypeAsString: () => type,
  };
}

/** The `TEXT_ATTRIBUTES` fields the plotters read (text_attributes.h). */
export interface PLOTTER_TEXT_ATTRIBUTES {
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
 * `KIFONT::FONT`, reduced to the calls the plotters make. `Draw` stands in for
 * `FONT::Draw` driven by a CALLBACK_GAL: it yields the glyph strokes as point
 * pairs in IU, in draw order. `GRTextWidth` is gr_text.cpp's free function
 * minus its FONT and METRICS arguments; only SVG's invisible search text reads
 * it.
 *
 * `DrawCallback`, when present, *is* `FONT::Draw` on upstream's CALLBACK_GAL:
 * strokes and outline-glyph polygons in draw order, so an outline font's
 * polygon callback (`PlotPoly( chain, FILLED_SHAPE, 0 )`) fires as it does
 * upstream. {@link plotterFont} builds one from a real `KIFONT::FONT`; a font
 * that has only `Draw` plots strokes and nothing else.
 */
export interface PLOTTER_FONT {
  /**
   * The `KIFONT::FONT` and `METRICS` themselves, when there is one: PDF_PLOTTER
   * writes text as PDF fonts and needs the glyphs, not just the strokes.
   */
  readonly font?: FONT;
  readonly metrics?: METRICS;

  Draw(
    aText: string,
    aPos: Vec2,
    aAttributes: PLOTTER_TEXT_ATTRIBUTES,
  ): readonly (readonly [Vec2, Vec2])[];

  DrawCallback?(
    aText: string,
    aPos: Vec2,
    aAttributes: PLOTTER_TEXT_ATTRIBUTES,
    aStroke: (aPt1: Vec2, aPt2: Vec2) => void,
    aPolygon: (aPoly: SHAPE_LINE_CHAIN) => void,
  ): void;

  GRTextWidth?(
    aText: string,
    aSize: Vec2,
    aThickness: number,
    aBold: boolean,
    aItalic: boolean,
  ): number;
}

/**
 * A {@link PLOTTER_FONT} over a real `KIFONT::FONT` and its `METRICS`: the
 * `aFont` / `aFontMetrics` pair upstream's `PLOTTER::Text` and `PlotText` take.
 * Drawing is `aFont->Draw( &callback_gal, text, aPos, attributes, aFontMetrics )`.
 */
export function plotterFont(aFont: FONT, aFontMetrics: METRICS): PLOTTER_FONT {
  const textAttributes = (aAttributes: PLOTTER_TEXT_ATTRIBUTES): TEXT_ATTRIBUTES =>
    Object.assign(new TEXT_ATTRIBUTES(), aAttributes);

  const drawCallback = (
    aText: string,
    aPos: Vec2,
    aAttributes: PLOTTER_TEXT_ATTRIBUTES,
    aStroke: (aPt1: Vec2, aPt2: Vec2) => void,
    aPolygon: (aPoly: SHAPE_LINE_CHAIN) => void,
  ): void => {
    const callback_gal = new CALLBACK_GAL(
      (aPt1: Vec2, aPt2: Vec2) => aStroke(aPt1, aPt2),
      (aPoly: SHAPE_LINE_CHAIN) => aPolygon(aPoly),
    );

    aFont.DrawAt(callback_gal, aText, aPos, textAttributes(aAttributes), aFontMetrics);
  };

  return {
    font: aFont,
    metrics: aFontMetrics,
    Draw(aText, aPos, aAttributes) {
      const strokes: [Vec2, Vec2][] = [];

      drawCallback(
        aText,
        aPos,
        aAttributes,
        (aPt1, aPt2) => strokes.push([aPt1, aPt2]),
        () => {},
      );

      return strokes;
    },
    DrawCallback: drawCallback,
    GRTextWidth(aText, aSize, aThickness, aBold, aItalic) {
      return GRTextWidth(aText, aFont, aSize, aThickness, aBold, aItalic, aFontMetrics);
    },
  };
}

/** The pen plume `PenTo` takes: up, down, or finish the path. */
export type PEN_PLUME = 'U' | 'D' | 'Z';

/** The `VECTOR2D` -> `VECTOR2I` conversion: truncate towards zero, per component. */
export const toVector2I = (aVec: Vec2): Vec2 => ({
  x: Math.trunc(aVec.x),
  y: Math.trunc(aVec.y),
});

/**
 * `VECTOR2<double>::EuclideanNorm` (vector2d.h:279). kimath's exported
 * EuclideanNorm is a bare `Math.hypot`; upstream shortcuts the axis-aligned and
 * 45-degree cases first, and `|x| * sqrt(2)` is not obliged to agree with
 * `hypot(x, x)` in the last bit.
 */
export function euclideanNormD(aVec: Vec2): number {
  // 45° are common in KiCad, so we can optimize the calculation
  if (Math.abs(aVec.x) === Math.abs(aVec.y)) return Math.abs(aVec.x) * Math.SQRT2;

  if (aVec.x === 0) return Math.abs(aVec.y);
  if (aVec.y === 0) return Math.abs(aVec.x);

  return Math.hypot(aVec.x, aVec.y);
}

/**
 * `marker_patterns` (plotter.cpp:291), octal as upstream wrote it. Bit order:
 * O Square Lozenge - | \ /
 */
const marker_patterns: readonly number[] = [
  // First choice: simple shapes
  0o003, // X
  0o100, // O
  0o014, // +
  0o040, // Sq
  0o020, // Lz

  // Two simple shapes
  0o103, // X O
  0o017, // X +
  0o043, // X Sq
  0o023, // X Lz
  0o114, // O +
  0o140, // O Sq
  0o120, // O Lz
  0o054, // + Sq
  0o034, // + Lz
  0o060, // Sq Lz

  // Three simple shapes
  0o117, // X O +
  0o143, // X O Sq
  0o123, // X O Lz
  0o057, // X + Sq
  0o037, // X + Lz
  0o063, // X Sq Lz
  0o154, // O + Sq
  0o134, // O + Lz
  0o074, // + Sq Lz

  // Four simple shapes
  0o174, // O Sq Lz +
  0o163, // X O Sq Lz
  0o157, // X O Sq +
  0o137, // X O Lz +
  0o077, // X Sq Lz +

  // This draws *everything *
  0o177, // X O Sq Lz +

  // Here we use the single bars... so the cross is forbidden
  0o110, // O -
  0o104, // O |
  0o101, // O /
  0o050, // Sq -
  0o044, // Sq |
  0o041, // Sq /
  0o030, // Lz -
  0o024, // Lz |
  0o021, // Lz /
  0o150, // O Sq -
  0o144, // O Sq |
  0o141, // O Sq /
  0o130, // O Lz -
  0o124, // O Lz |
  0o121, // O Lz /
  0o070, // Sq Lz -
  0o064, // Sq Lz |
  0o061, // Sq Lz /
  0o170, // O Sq Lz -
  0o164, // O Sq Lz |
  0o161, // O Sq Lz /

  // Last resort: the backlash component (easy to confound)
  0o102, // \ O
  0o042, // \ Sq
  0o022, // \ Lz
  0o142, // \ O Sq
  0o122, // \ O Lz
  0o062, // \ Sq Lz
  0o162, // \ O Sq Lz
];

/**
 * `PLOTTER` (plotter.h / plotter.cpp). Subclasses supply the device: PenTo, the
 * filled/stroked primitives, the pad flashes and the document framing. What is
 * here is what upstream writes once for all of them.
 */
export abstract class PLOTTER {
  static readonly DO_NOT_SET_LINE_WIDTH = DO_NOT_SET_LINE_WIDTH;
  static readonly USE_DEFAULT_LINE_WIDTH = USE_DEFAULT_LINE_WIDTH;
  static readonly MARKER_COUNT = 58;

  // ---- variables used in most of plotters (plotter.h:656) -----------------
  protected m_plotScale = 1;
  /** Caller scale (how many IUs in a decimil - always); it's a double. */
  protected m_IUsPerDecimil = 1; // will be set later to the actual value
  /** Device scale (from IUs to plotter device units; usually decimils). */
  protected m_iuPerDeviceUnit = 1; // will be set later to the actual value
  protected m_plotOffset: Vec2 = { x: 0, y: 0 };
  protected m_plotMirror = false; // Plot mirror option flag
  protected m_mirrorIsHorizontal = true;
  protected m_yaxisReversed = false;
  /** Upstream's `FILE*`: true between OpenFile and the file being closed. */
  protected m_outputFile = false;
  protected m_colorMode = false; // Starts as a BW plot
  protected m_negativeMode = false;
  protected m_currentPenWidth = -1; // To-be-set marker
  protected m_penState: PEN_PLUME = 'Z'; // End-of-path idle
  protected m_penLastpos: Vec2 = { x: 0, y: 0 };
  protected m_creator = '';
  protected m_filename = '';
  protected m_title = '';
  protected m_author = '';
  protected m_subject = '';
  protected m_pageInfo: PLOTTER_PAGE_INFO | null = null;
  /** Paper size in IU - not in mils. */
  protected m_paperSize: Vec2 = { x: 0, y: 0 };
  /** A set of string to print in header file. */
  protected m_headerExtraLines: string[] = [];
  protected m_renderSettings: PlotterRenderSettings | null = null;
  protected m_layersToExport: readonly (readonly [layer: number, name: string])[] = [];
  /** The PCB_LAYER_ID being plotted; `UNDEFINED_LAYER` (-1) until pcbnew sets one. */
  protected m_layer = -1;

  abstract GetPlotterType(): PLOT_FORMAT;

  abstract StartPlot(aPageNumber: string): boolean;
  abstract EndPlot(): boolean;

  SetNegative(aNegative: boolean): void {
    this.m_negativeMode = aNegative;
  }

  /**
   * Plot in B/W or color.
   *
   * @param aColorMode use true to plot in color, false to plot in black and white.
   */
  SetColorMode(aColorMode: boolean): void {
    this.m_colorMode = aColorMode;
  }

  GetColorMode(): boolean {
    return this.m_colorMode;
  }

  SetRenderSettings(aSettings: PlotterRenderSettings | null): void {
    this.m_renderSettings = aSettings;
  }

  RenderSettings(): PlotterRenderSettings | null {
    return this.m_renderSettings;
  }

  SetPageSettings(aPageSettings: PLOTTER_PAGE_INFO): void {
    this.m_pageInfo = aPageSettings;
  }

  /**
   * An unset page is an error here rather than upstream's silent
   * default-constructed A3, because reproducing that default means embedding
   * page_info.cpp's size table in every caller.
   */
  PageSettings(): PLOTTER_PAGE_INFO {
    if (!this.m_pageInfo) throw new Error('plotter has no page settings');

    return this.m_pageInfo;
  }

  SetPlotMirrored(aMirror: boolean): void {
    this.m_plotMirror = aMirror;
  }

  GetPlotMirrored(): boolean {
    return this.m_plotMirror;
  }

  /**
   * Set the line width for the next drawing.
   *
   * @param width is specified in IUs.
   * @param aData is an auxiliary parameter, mainly used in gerber plotter.
   */
  abstract SetCurrentLineWidth(width: number, aData?: unknown): void;

  GetCurrentLineWidth(): number {
    return this.m_currentPenWidth;
  }

  abstract SetColor(color: Color4d): void;

  abstract SetDash(aLineWidth: number, aLineStyle: LINE_STYLE): void;

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
   * Add a line to the list of free lines to print at the beginning of the file.
   *
   * @param aExtraString is the string to print
   */
  AddLineToHeader(aExtraString: string): void {
    this.m_headerExtraLines.push(aExtraString);
  }

  /** Remove all lines from the list of free lines to print at the beginning of the file. */
  ClearHeaderLinesList(): void {
    this.m_headerExtraLines = [];
  }

  /**
   * Set the plot offset and scaling for the current plot
   *
   * @param aOffset is the plot offset.
   * @param aIusPerDecimil gives the scaling factor from IUs to device units
   * @param aScale is the user set plot scaling factor (either explicitly
   *      or using 'fit to A4')
   * @param aMirror flips the plot in the Y direction (useful for toner
   *      transfers or some kind of film).
   */
  abstract SetViewport(
    aOffset: Vec2,
    aIusPerDecimil: number,
    aScale: number,
    aMirror: boolean,
  ): void;

  /** Set the list of layers to export to the specified vector. */
  SetLayersToExport(aLayersToExport: readonly (readonly [layer: number, name: string])[]): void {
    this.m_layersToExport = aLayersToExport;
  }

  GetLayer(): number {
    return this.m_layer;
  }

  SetLayer(aLayer: number): void {
    this.m_layer = aLayer;
  }

  /**
   * Open or create the plot file `aFullFilename`. There is no file here — the
   * document accumulates in memory — but the plotter still refuses to draw
   * before it is "open", which is what upstream's `wxASSERT( m_outputFile )`
   * guards in a debug build.
   *
   * @return true if success, false if the file cannot be created/opened.
   */
  OpenFile(aFullFilename: string): boolean {
    this.m_filename = aFullFilename;
    this.m_outputFile = true;
    return true;
  }

  GetFilename(): string {
    return this.m_filename;
  }

  /** The IUs per decimil that are being used. */
  GetIUsPerDecimil(): number {
    return this.m_IUsPerDecimil;
  }

  GetPlotterArcLowDef(): number {
    return this.m_IUsPerDecimil * 8;
  }

  GetPlotterArcHighDef(): number {
    return this.m_IUsPerDecimil * 2;
  }

  // Low level primitives

  abstract Rect(p1: Vec2, p2: Vec2, fill: FILL_T, width: number, aCornerRadius?: number): void;

  abstract Circle(pos: Vec2, diametre: number, fill: FILL_T, width: number): void;

  /**
   * `PLOTTER::Arc( start, mid, end, … )` (plotter.cpp:155): derive the centre
   * and sweep and defer to the centre/angle form. `det <= 0` counts a collinear
   * triple as clockwise, so a degenerate arc normalises positive.
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
   * Generic fallback: arc rendered as a polyline. Note also aCentre and aRadius
   * are double to avoid creating rounding issues due to the fact a arc is defined
   * in Kicad by a start point, a end point and third point not angles and radius.
   * In some plotters (i.e. dxf) whe need a good precision when calculating an arc
   * without error introduced by rounding, to avoid moving the end points,
   * usually on grid (and therefore marked as connected).
   */
  Arc(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aFill: FILL_T,
    aWidth: number,
  ): void {
    this.polyArc(aCenter, aStartAngle, aAngle, aRadius, aFill, aWidth);
  }

  /**
   * Generic fallback: Cubic Bezier curve rendered as a polyline.
   * In KiCad the bezier curves have 4 control points: start ctrl1 ctrl2 end
   */
  BezierCurve(
    aStart: Vec2,
    aControl1: Vec2,
    aControl2: Vec2,
    aEnd: Vec2,
    aTolerance: number,
    aLineThickness: number,
  ): void {
    // Generic fallback: Quadratic Bezier curve plotted as a polyline
    const bezier_converter = new BezierPoly([aStart, aControl1, aControl2, aEnd]);
    const approxPoints = bezier_converter.getPoly(aTolerance);

    this.SetCurrentLineWidth(aLineThickness);
    this.MoveTo(aStart);

    for (let ii = 1; ii < approxPoints.length - 1; ii++) this.LineTo(approxPoints[ii]!);

    this.FinishTo(aEnd);
  }

  /**
   * Moveto/lineto primitive, moves the 'pen' to the specified direction.
   *
   * @param pos is the target position.
   * @param plume specifies the kind of motion: 'U' only moves the pen, 'D' draw
   *              a line from the current position and 'Z' finish the drawing and
   *              returns the 'pen' to rest (flushes the trace).
   */
  abstract PenTo(pos: Vec2, plume: PEN_PLUME): void;

  // Convenience functions for PenTo
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
   * Draw a polygon ( filled or not ).
   *
   * @param aCornerList is the corners list (a std::vector< VECTOR2I >).
   * @param aFill is the type of fill.
   * @param aWidth is the line width.
   * @param aData is an auxiliary info (mainly for gerber format).
   */
  abstract PlotPoly(
    aCornerList: readonly Vec2[],
    aFill: FILL_T,
    aWidth: number,
    aData?: unknown,
  ): void;

  /**
   * `PLOTTER::PlotPoly( const SHAPE_LINE_CHAIN&, … )` (plotter.cpp:655): the
   * chain's points, closed by repeating the first when the chain is closed and
   * does not already end there.
   */
  PlotPolyLineChain(
    aLineChain: SHAPE_LINE_CHAIN,
    aFill: FILL_T,
    aWidth: number,
    aData?: unknown,
  ): void {
    const cornerList: Vec2[] = [];

    for (let ii = 0; ii < aLineChain.PointCount(); ii++) {
      const pt = aLineChain.CPoint(ii);
      cornerList.push({ x: pt.x, y: pt.y });
    }

    if (aLineChain.IsClosed()) {
      const front = cornerList[0];
      const back = cornerList[cornerList.length - 1];

      if (front && back && (front.x !== back.x || front.y !== back.y))
        cornerList.push({ x: front.x, y: front.y });
    }

    this.PlotPoly(cornerList, aFill, aWidth, aData);
  }

  /**
   * Only PostScript plotters can plot bitmaps.
   *
   * A rectangle is plotted for plotters that cannot plot a bitmap.
   *
   * @param aImage is the bitmap.
   * @param aPos is position of the center of the bitmap.
   * @param aScaleFactor is the scale factor to apply to the bitmap size
   *                      (this is not the plot scale factor).
   */
  PlotImage(
    aImage: { GetWidth(): number; GetHeight(): number },
    aPos: Vec2,
    aScaleFactor: number,
  ): void {
    const size = {
      x: Math.trunc(aImage.GetWidth() * aScaleFactor),
      y: Math.trunc(aImage.GetHeight() * aScaleFactor),
    };

    const start = { x: aPos.x - Math.trunc(size.x / 2), y: aPos.y - Math.trunc(size.y / 2) };
    const end = { x: start.x + size.x, y: start.y + size.y };

    this.Rect(start, end, FILL_T.NO_FILL, USE_DEFAULT_LINE_WIDTH, 0);
  }

  // Higher level primitives -- can be drawn as line, sketch or 'filled'

  /**
   * `PLOTTER::ThickSegment` (plotter.cpp:538). A zero-length segment becomes a
   * filled circle, and the width doubles as a sentinel: USE_DEFAULT_LINE_WIDTH
   * is resolved *through* SetCurrentLineWidth so the pen is left at the default
   * too, while DO_NOT_SET_LINE_WIDTH reads the live pen without touching it. An
   * unresolved sentinel then trips a `wxCHECK2_MSG` and draws nothing.
   */
  ThickSegment(start: Vec2, end: Vec2, width: number, aData?: unknown): void {
    if (start.x === end.x && start.y === end.y) {
      // The width parameter doubles as a sentinel. DO_NOT_SET_LINE_WIDTH means the
      // caller already configured the pen so we use the live pen width as the diameter.
      // USE_DEFAULT_LINE_WIDTH must be resolved through SetCurrentLineWidth so the pen
      // is also set to the default value, otherwise we would emit whatever the prior
      // pen width happened to be.
      let diameter = width;

      if (width === USE_DEFAULT_LINE_WIDTH) {
        this.SetCurrentLineWidth(width, aData);
        diameter = this.GetCurrentLineWidth();
      } else if (width === DO_NOT_SET_LINE_WIDTH) {
        diameter = this.GetCurrentLineWidth();
      }

      // wxCHECK2_MSG: "Plotter called with unresolved line width sentinel"
      if (diameter < 0) return;

      this.Circle(start, diameter, FILL_T.FILLED_SHAPE, 0);
    } else {
      this.SetCurrentLineWidth(width);
      this.MoveTo(start);
      this.FinishTo(end);
    }
  }

  /** `PLOTTER::ThickArc` (plotter.cpp:571), which is an unfilled Arc and nothing else. */
  ThickArc(
    centre: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aWidth: number,
    _aData?: unknown,
  ): void {
    this.Arc(centre, aStartAngle, aAngle, aRadius, FILL_T.NO_FILL, aWidth);
  }

  /**
   * `PLOTTER::ThickArc( const EDA_SHAPE&, … )` (plotter.cpp:578): the arc's
   * centre and sweep, with the same `det <= 0` clockwise rule as
   * ArcThroughPoints.
   */
  ThickArcShape(
    aArcShape: { getCenter(): Vec2; GetArcMid(): Vec2; GetStart(): Vec2; GetEnd(): Vec2 },
    aData: unknown,
    aWidth: number,
  ): void {
    const center = aArcShape.getCenter();
    const mid = aArcShape.GetArcMid();
    const start = aArcShape.GetStart();
    const end = aArcShape.GetEnd();

    const startAngle = EDA_ANGLE.fromVector({ x: start.x - center.x, y: start.y - center.y });
    const endAngle = EDA_ANGLE.fromVector({ x: end.x - center.x, y: end.y - center.y });
    const angle = endAngle.sub(startAngle);

    // < 0: left, 0 : on the line, > 0 : right
    const det = (end.x - start.x) * (mid.y - start.y) - (end.y - start.y) * (mid.x - start.x);

    if (det <= 0)
      // cw
      angle.Normalize();
    else angle.NormalizeNegative();

    const radius = euclideanNormD({ x: start.x - center.x, y: start.y - center.y });

    this.ThickArc(center, startAngle, angle, radius, aWidth, aData);
  }

  /** `PLOTTER::ThickRect` (plotter.cpp:601). */
  ThickRect(p1: Vec2, p2: Vec2, width: number, _aData?: unknown): void {
    this.Rect(p1, p2, FILL_T.NO_FILL, width, 0);
  }

  /** `PLOTTER::ThickCircle` (plotter.cpp:607). */
  ThickCircle(pos: Vec2, diametre: number, width: number, _aData?: unknown): void {
    this.Circle(pos, diametre, FILL_T.NO_FILL, width);
  }

  /** `PLOTTER::FilledCircle` (plotter.cpp:613). */
  FilledCircle(pos: Vec2, diametre: number, _aData?: unknown): void {
    this.Circle(pos, diametre, FILL_T.FILLED_SHAPE, 0);
  }

  /**
   * `PLOTTER::ThickOval` (plotter.cpp:476): normalise to a vertical oval, then
   * two lines and two 180 degree arcs.
   */
  ThickOval(aPos: Vec2, aSize: Vec2, aOrient: EDA_ANGLE, aWidth: number, aData?: unknown): void {
    this.SetCurrentLineWidth(aWidth, aData);

    let orient = aOrient;
    const size = { x: aSize.x, y: aSize.y };

    if (size.x > size.y) {
      [size.x, size.y] = [size.y, size.x];
      orient = orient.add(ANGLE_90);
    }

    const deltaxy = size.y - size.x; /* distance between centers of the oval */
    const radius = Math.trunc(size.x / 2);

    // Build a vertical oval shape giving the start and end points of arcs and edges,
    // and the middle point of arcs
    // Shape is (x = corner and arc ends, c = arc centre)
    //  xcx
    //
    //  xcx
    const half_height = Math.trunc(deltaxy / 2);
    const corners: Vec2[] = [
      { x: -radius, y: -half_height },
      { x: -radius, y: half_height },
      { x: 0, y: half_height },
      { x: radius, y: half_height },
      { x: radius, y: -half_height },
      { x: 0, y: -half_height },
    ].map((corner) => {
      // Rotate and move to the actual position
      const rotated = RotatePoint(corner, orient);
      return { x: rotated.x + aPos.x, y: rotated.y + aPos.y };
    });

    // Gen shape (2 lines and 2 180 deg arcs):
    this.MoveTo(corners[0]!);
    this.FinishTo(corners[1]!);

    this.Arc(corners[2]!, orient.negate(), ANGLE_180, radius, FILL_T.NO_FILL, aWidth);

    this.MoveTo(corners[3]!);
    this.FinishTo(corners[4]!);

    this.Arc(corners[5]!, orient.negate(), ANGLE_180.negate(), radius, FILL_T.NO_FILL, aWidth);
  }

  /** `PLOTTER::ThickPoly` (plotter.cpp:619): the first outline, unfilled. */
  ThickPoly(aPoly: SHAPE_POLY_SET, aWidth: number, aData?: unknown): void {
    this.PlotPolyLineChain(aPoly.COutline(0), FILL_T.NO_FILL, aWidth, aData);
  }

  // Flash primitives

  abstract FlashPadCircle(aPadPos: Vec2, aDiameter: number, aData?: unknown): void;

  abstract FlashPadOval(aPadPos: Vec2, aSize: Vec2, aPadOrient: EDA_ANGLE, aData?: unknown): void;

  abstract FlashPadRect(aPadPos: Vec2, aSize: Vec2, aPadOrient: EDA_ANGLE, aData?: unknown): void;

  abstract FlashPadRoundRect(
    aPadPos: Vec2,
    aSize: Vec2,
    aCornerRadius: number,
    aOrient: EDA_ANGLE,
    aData?: unknown,
  ): void;

  abstract FlashPadCustom(
    aPadPos: Vec2,
    aSize: Vec2,
    aPadOrient: EDA_ANGLE,
    aPolygons: SHAPE_POLY_SET,
    aData?: unknown,
  ): void;

  abstract FlashPadTrapez(
    aPadPos: Vec2,
    aCorners: readonly Vec2[],
    aPadOrient: EDA_ANGLE,
    aData?: unknown,
  ): void;

  abstract FlashRegularPolygon(
    aShapePos: Vec2,
    aDiameter: number,
    aCornerCount: number,
    aOrient: EDA_ANGLE,
    aData?: unknown,
  ): void;

  /**
   * `PLOTTER::Text` (plotter.cpp:668). Draws text with the plotter.
   *
   * The stroke callback re-issues `SetCurrentLineWidth( aPenWidth )` for every
   * segment — `PLOTTER::PlotText`'s does not — so a run of glyphs plotted
   * through this path restores the pen after anything the font's polygon
   * callback might have changed.
   *
   * `@{…}` expression substitution runs here upstream (EXPRESSION_EVALUATOR);
   * it is skipped rather than approximated, so a string containing `@{` plots
   * literally.
   *
   * A negative pen width is made positive *after* the bold default is applied,
   * so a bold string with a zero width picks up size/5 and a deliberately
   * negative width is only ever a sign trick.
   */
  Text(
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
    aFont: PLOTTER_FONT | null,
    _aFontMetrics?: unknown,
    aData?: unknown,
  ): void {
    let penWidth = aPenWidth;

    this.SetColor(aColor);

    if (penWidth === 0 && aBold)
      // Use default values if aPenWidth == 0
      penWidth = GetPenSizeForBold(Math.min(aSize.x, aSize.y));

    if (penWidth < 0) penWidth = -penWidth;

    const size = { x: aSize.x, y: aSize.y };
    let mirrored = false;

    // if Size.x is < 0, the text is mirrored (we have no other param to know a text is mirrored)
    if (size.x < 0) {
      size.x = -size.x;
      mirrored = true;
    }

    if (!aFont) throw new Error('PLOTTER::Text needs a font (KIFONT::FONT::GetFont is not wired)');

    const attributes: PLOTTER_TEXT_ATTRIBUTES = {
      m_Angle: aOrient,
      m_StrokeWidth: penWidth,
      m_Italic: aItalic,
      m_Bold: aBold,
      m_Halign: aH_justify,
      m_Valign: aV_justify,
      m_Size: size,
      m_Mirrored: mirrored,
      // TEXT_ATTRIBUTES' constructor default is *true*, and PLOTTER::Text never
      // assigns it — so aMultilineAllowed is accepted, threaded all the way
      // down, and then silently discarded.
      m_Multiline: true,
    };

    const stroke = (pt1: Vec2, pt2: Vec2): void => {
      this.SetCurrentLineWidth(penWidth);
      this.MoveTo(pt1);
      this.LineTo(pt2);
      this.PenFinish();
    };

    if (aFont.DrawCallback) {
      aFont.DrawCallback(aText, aPos, attributes, stroke, (aPoly) =>
        this.PlotPolyLineChain(aPoly, FILL_T.FILLED_SHAPE, 0, aData),
      );
      return;
    }

    for (const [pt1, pt2] of aFont.Draw(aText, aPos, attributes)) stroke(pt1, pt2);
  }

  /**
   * `PLOTTER::PlotText` (plotter.cpp:728). Same shape as Text, with one
   * difference that is not cosmetic: the pen is set once, up front, and the
   * stroke callback does *not* re-issue it per segment.
   */
  PlotText(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aAttributes: PLOTTER_TEXT_ATTRIBUTES,
    aFont: PLOTTER_FONT | null,
    _aFontMetrics?: unknown,
    aData?: unknown,
  ): void {
    let penWidth = aAttributes.m_StrokeWidth;

    this.SetColor(aColor);
    this.SetCurrentLineWidth(penWidth, aData);

    if (penWidth === 0 && aAttributes.m_Bold)
      // Use default values if aPenWidth == 0
      penWidth = GetPenSizeForBold(Math.min(aAttributes.m_Size.x, aAttributes.m_Size.y));

    if (penWidth < 0) penWidth = -penWidth;

    if (!aFont)
      throw new Error('PLOTTER::PlotText needs a font (KIFONT::FONT::GetFont is not wired)');

    const attributes: PLOTTER_TEXT_ATTRIBUTES = { ...aAttributes, m_StrokeWidth: penWidth };

    const stroke = (pt1: Vec2, pt2: Vec2): void => {
      this.MoveTo(pt1);
      this.LineTo(pt2);
      this.PenFinish();
    };

    if (aFont.DrawCallback) {
      aFont.DrawCallback(aText, aPos, attributes, stroke, (aPoly) =>
        this.PlotPolyLineChain(aPoly, FILL_T.FILLED_SHAPE, 0, aData),
      );
      return;
    }

    for (const [pt1, pt2] of aFont.Draw(aText, aPos, attributes)) stroke(pt1, pt2);
  }

  /** Create a clickable hyperlink with a rectangular click area. */
  HyperlinkBox(_aBox: unknown, _aDestinationURL: string): void {
    // NOP for most plotters.
  }

  /** Create a clickable hyperlink menu with a rectangular click area. */
  HyperlinkMenu(_aBox: unknown, _aDestURLs: readonly string[]): void {
    // NOP for most plotters.
  }

  /** Create a bookmark to a symbol. */
  Bookmark(_aBox: unknown, _aName: string, _aGroupName?: string): void {
    // NOP for most plotters.
  }

  /**
   * Draw a pattern shape number aShapeId, to coord position.
   * Diameter diameter = (coord table) hole
   * AShapeId = index (used to generate forms characters)
   */
  Marker(position: Vec2, diametre: number, aShapeId: number): void {
    const radius = Math.trunc(diametre / 2);

    /* Marker are composed by a series of 'parts' superimposed; not every
       combination make sense, obviously. Since they are used in order I
       tried to keep the uglier/more complex constructions at the end.
       Also I avoided the |/ |\ -/ -\ construction because they're *very*
       ugly... if needed they could be added anyway... I'd like to see
       a board with more than 58 drilling/slotting tools!
       If Visual C++ supported the 0b literals they would be optimally
       and easily encoded as an integer array. We have to do with octal */
    if (aShapeId >= PLOTTER.MARKER_COUNT) {
      // Fallback shape
      this.markerCircle(position, radius);
    } else {
      // Decode the pattern and draw the corresponding parts
      const pat = marker_patterns[aShapeId]!;

      if (pat & 0o001) this.markerSlash(position, radius);

      if (pat & 0o002) this.markerBackSlash(position, radius);

      if (pat & 0o004) this.markerVBar(position, radius);

      if (pat & 0o010) this.markerHBar(position, radius);

      if (pat & 0o020) this.markerLozenge(position, radius);

      if (pat & 0o040) this.markerSquare(position, radius);

      if (pat & 0o100) this.markerCircle(position, radius);
    }
  }

  /**
   * Set the current Gerber layer polarity to positive or negative
   * by writing \%LPD*\% or \%LPC*\% to the Gerber file, respectively.
   * (obviously starts a new Gerber layer, too)
   *
   * @param aPositive is the layer polarity and true for positive.
   * It's not useful with most other plotter since they can't 'scratch'
   * the film like photoplotter imagers do
   */
  SetLayerPolarity(_aPositive: boolean): void {
    // NOP for most plotters
  }

  /** Change the current text mode. See the PlotTextMode explanation at the beginning of the file. */
  SetTextMode(_mode: PLOT_TEXT_MODE): void {
    // NOP for most plotters.
  }

  SetGerberCoordinatesFormat(_aResolution: number, _aUseInches = false): void {
    // NOP for most plotters. Only for Gerber plotter
  }

  SetSvgCoordinatesFormat(_aPrecision: number): void {
    // NOP for most plotters. Only for SVG plotter
  }

  /**
   * calling this function allows one to define the beginning of a group
   * of drawing items, for instance in SVG  or Gerber format.
   * (example: group all segments of a letter or a text)
   */
  StartBlock(_aData?: unknown): void {}

  /** calling this function allows one to define the end of a group of drawing items. */
  EndBlock(_aData?: unknown): void {}

  /** The plot offset in current Plotter units. */
  GetPlotOffsetUserUnits(): Vec2 {
    return this.m_plotOffset;
  }

  // ---- protected ----------------------------------------------------------

  /**
   * Generic fallback: arc rendered as a polyline (plotter.cpp:176). Note
   * also aCentre and aRadius are double to avoid creating rounding issues due
   * to the fact a arc is defined in Kicad by a start point, a end point and
   * third point not angles and radius.
   */
  protected polyArc(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aFill: FILL_T,
    aWidth: number,
  ): void {
    let startAngle = aStartAngle;
    let endAngle = startAngle.add(aAngle);
    const delta = new EDA_ANGLE(5.0); // increment to draw arc
    const sign = 1;

    if (aAngle.lt(ANGLE_0)) [startAngle, endAngle] = [endAngle, startAngle];

    this.SetCurrentLineWidth(aWidth);

    const start = {
      x: KiROUND(aCenter.x + aRadius * startAngle.Cos()),
      y: KiROUND(aCenter.y + sign * aRadius * startAngle.Sin()),
    };

    if (aFill !== FILL_T.NO_FILL) {
      this.MoveTo(toVector2I(aCenter));
      this.LineTo(start);
    } else {
      this.MoveTo(start);
    }

    for (let ii = startAngle.add(delta); ii.lt(endAngle); ii = ii.add(delta)) {
      const end = {
        x: KiROUND(aCenter.x + aRadius * ii.Cos()),
        y: KiROUND(aCenter.y + sign * aRadius * ii.Sin()),
      };
      this.LineTo(end);
    }

    const end = {
      x: KiROUND(aCenter.x + aRadius * endAngle.Cos()),
      y: KiROUND(aCenter.y + sign * aRadius * endAngle.Sin()),
    };

    if (aFill !== FILL_T.NO_FILL) {
      this.LineTo(end);
      this.FinishTo(toVector2I(aCenter));
    } else {
      this.FinishTo(end);
    }
  }

  // These are marker subcomponents
  /** Plot a circle centered on the position. Building block for markers. */
  protected markerCircle(pos: Vec2, radius: number): void {
    this.Circle(pos, radius * 2, FILL_T.NO_FILL, this.GetCurrentLineWidth());
  }

  /** Plot a - bar centered on the position. Building block for markers. */
  protected markerHBar(pos: Vec2, radius: number): void {
    this.MoveTo({ x: pos.x - radius, y: pos.y });
    this.FinishTo({ x: pos.x + radius, y: pos.y });
  }

  /** Plot a / bar centered on the position. Building block for markers. */
  protected markerSlash(pos: Vec2, radius: number): void {
    this.MoveTo({ x: pos.x - radius, y: pos.y - radius });
    this.FinishTo({ x: pos.x + radius, y: pos.y + radius });
  }

  /** Plot a \ bar centered on the position. Building block for markers. */
  protected markerBackSlash(pos: Vec2, radius: number): void {
    this.MoveTo({ x: pos.x + radius, y: pos.y - radius });
    this.FinishTo({ x: pos.x - radius, y: pos.y + radius });
  }

  /** Plot a | bar centered on the position. Building block for markers. */
  protected markerVBar(pos: Vec2, radius: number): void {
    this.MoveTo({ x: pos.x, y: pos.y - radius });
    this.FinishTo({ x: pos.x, y: pos.y + radius });
  }

  /** Plot a square centered on the position. Building block for markers. */
  protected markerSquare(position: Vec2, radius: number): void {
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: [data] upstream's literal, not SQRT2
    const r = KiROUND(radius / 1.4142);

    const corner_list: Vec2[] = [
      { x: position.x + r, y: position.y + r },
      { x: position.x + r, y: position.y - r },
      { x: position.x - r, y: position.y - r },
      { x: position.x - r, y: position.y + r },
      { x: position.x + r, y: position.y + r },
    ];

    this.PlotPoly(corner_list, FILL_T.NO_FILL, this.GetCurrentLineWidth(), undefined);
  }

  /** Plot a lozenge centered on the position. Building block for markers. */
  protected markerLozenge(position: Vec2, radius: number): void {
    const corner_list: Vec2[] = [
      { x: position.x, y: position.y + radius },
      { x: position.x + radius, y: position.y },
      { x: position.x, y: position.y - radius },
      { x: position.x - radius, y: position.y },
      { x: position.x, y: position.y + radius },
    ];

    this.PlotPoly(corner_list, FILL_T.NO_FILL, this.GetCurrentLineWidth(), undefined);
  }

  // Helper function for sketched filler segment

  /**
   * Modify coordinates according to the orientation, scale factor, and offsets
   * trace. Also convert from a VECTOR2I to VECTOR2D, since some output engines
   * needs floating point coordinates.
   */
  protected userToDeviceCoordinates(aCoordinate: Vec2): Vec2 {
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

  /** Modify size according to the plotter scale factors (VECTOR2I version, returns a VECTOR2D). */
  protected userToDeviceSizeV(size: Vec2): Vec2 {
    return {
      x: size.x * this.m_plotScale * this.m_iuPerDeviceUnit,
      y: size.y * this.m_plotScale * this.m_iuPerDeviceUnit,
    };
  }

  /** Modify size according to the plotter scale factors (simple double version). */
  protected userToDeviceSize(size: number): number {
    return size * this.m_plotScale * this.m_iuPerDeviceUnit;
  }

  protected GetDotMarkLenIU(aLineWidth: number): number {
    return this.userToDeviceSize(this.renderSettings().GetDotLength(aLineWidth));
  }

  protected GetDashMarkLenIU(aLineWidth: number): number {
    return this.userToDeviceSize(this.renderSettings().GetDashLength(aLineWidth));
  }

  protected GetDashGapLenIU(aLineWidth: number): number {
    return this.userToDeviceSize(this.renderSettings().GetGapLength(aLineWidth));
  }

  /** `m_renderSettings->`: upstream dereferences it unchecked. */
  protected renderSettings(): PlotterRenderSettings {
    if (!this.m_renderSettings) throw new Error('plotter has no render settings');

    return this.m_renderSettings;
  }
}
