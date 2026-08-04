// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DXF_PLOTTER, the AutoCAD R2004 (AC1018) plot back-end, transcribed from
 * common/plotters/DXF_plotter.cpp plus the handful of PLOTTER base members it
 * leans on (common/plotters/plotter.cpp: userToDeviceCoordinates,
 * userToDeviceSize, the MoveTo/LineTo/FinishTo/PenFinish pen wrappers and
 * ThickOval).
 *
 * A DXF file is read by mechanical CAD, so the byte-level syntax *is* the
 * interface: a stray space in a group code or a reordered subclass marker is
 * not a cosmetic difference, it is a file that will not open. Three
 * consequences shape this port.
 *
 * 1. Output is bytes, not a string. Layer names go out UTF-8 (upstream's
 *    TO_UTF8) but TEXT glyphs are written a byte at a time with putc(), i.e.
 *    Latin-1. The same file therefore carries two encodings and a
 *    string-then-encode implementation would silently diverge on accented
 *    text. Hence `out: number[]`, `emit()` for markup and `putLatin1()` for
 *    glyphs.
 * 2. Group-code padding is copied verbatim per call site. The same code is
 *    " 50" in the tables and "  50" inside $HEADER; nothing here computes
 *    padding.
 * 3. Where upstream truncates with C++ integer division, or lets a VECTOR2D
 *    decay to a VECTOR2I, this uses Math.trunc explicitly. Those half-IU
 *    losses are observable in the emitted coordinates.
 *
 * Faithfully reproduced oddities, each of which looks like a bug and is not to
 * be "fixed": "VIOLETFIFTEEN" appears twice in the ACAD colour-name table (so
 * two LAYER records share a name, and the name->ACI lookup must be a
 * first-match scan); getDXFLineType returns "DIVIDE" for dash-dot-dot, a
 * linetype the LTYPE table never declares; Rect ignores its fill argument;
 * Circle with a fill that is neither NO_FILL nor FILLED_SHAPE emits nothing at
 * all; PenTo('Z') returns before updating the pen position; and arc angles are
 * written unnormalised, negative zero included.
 *
 * One genuine ambiguity: upstream calls nextHandle() twice inside a single
 * fmt::print argument list for each BLOCK/ENDBLK pair, and C++ leaves that
 * evaluation order unspecified. This port allocates left to right (BLOCK gets
 * the lower handle). A byte-diff against a KiCad binary that evaluates right
 * to left will show those six handles swapped; that is the compiler, not a
 * port defect.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE, ANGLE_90, ANGLE_180 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import type { PCB_LAYER_ID } from './layer_ids.js';

/** `DXF_UNITS` (plotter.h). MM is 1 because Windows headers claim `MM`. */
export enum DXF_UNITS {
  INCH = 0,
  MM = 1,
}

/** `PLOT_TEXT_MODE` (plotter.h). Only NATIVE reaches the TEXT entity path. */
export enum PLOT_TEXT_MODE {
  STROKE = 0,
  NATIVE,
  PHANTOM,
  DEFAULT,
}

/** `DXF_LAYER_OUTPUT_MODE` (plotter.h). */
export enum DXF_LAYER_OUTPUT_MODE {
  Layer_Name = 0,
  Layer_Color_Name,
  Current_Layer_Name,
  Current_Layer_Color_Name,
}

/** `DXF_OUTLINE_MODE` (plotter.h): the plot dialog's DXF outline/filled radio. */
export enum DXF_OUTLINE_MODE {
  SKETCH = 0,
  FILLED = 1,
}

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
 * Oblique angle for DXF native text. Upstream's comment: "I don't remember if
 * 15 degrees is the ISO value... it looks nice anyway".
 */
const DXF_OBLIQUE_ANGLE = 15;

/** `PLOTTER::DO_NOT_SET_LINE_WIDTH` / `USE_DEFAULT_LINE_WIDTH` (plotter.h). */
export const DO_NOT_SET_LINE_WIDTH = -2;
export const USE_DEFAULT_LINE_WIDTH = -1;

/**
 * `#define DXF_LINE_WIDTH DO_NOT_SET_LINE_WIDTH` — DXF carries no line widths,
 * so every internal call passes -2. That is why PlotPoly's `aWidth <= 0` branch
 * is the only one any caller inside this class ever reaches.
 */
const DXF_LINE_WIDTH = DO_NOT_SET_LINE_WIDTH;

/** COLOR4D, components in 0..1. Equality below includes alpha, as upstream's does. */
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
 * The slice of `RENDER_SETTINGS` the plotter uses. Injected rather than
 * imported because pcbnew/src must not reach into designer/'s theme.
 */
export interface DxfRenderSettings {
  GetLayerColor(aLayer: PCB_LAYER_ID): Color4d;
}

/**
 * The slice of `PLOT_PARAMS` the Thick and Flash primitives consult
 * (plotter.h). An absent params object means FILLED, because upstream's
 * `cfg && cfg->GetDXFPlotMode() == SKETCH` short-circuits on the null pointer.
 */
export interface DxfPlotParams {
  GetDXFPlotMode(): DXF_OUTLINE_MODE;
}

/** The `TEXT_ATTRIBUTES` fields plotOneLineOfText reads (text_attributes.h). */
export interface DxfTextAttributes {
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

/** One `m_layersToExport` entry: the board layer and the DXF layer name for it. */
export type DxfLayerExport = readonly [layer: PCB_LAYER_ID, name: string];

interface DxfLayout {
  name: string;
  blockName: string;
  blockRecordHandle: string;
  layoutHandle: string;
  isPaperSpace: boolean;
}

/**
 * `formatCoord` (DXF_plotter.cpp): sixteen fixed decimals with trailing zeros
 * popped. The loop stops at the '.', so whole numbers keep a bare trailing dot
 * — "0.", "100." — and that dot is part of the expected output, not a typo.
 *
 * Two divergences between fmt and toFixed have to be papered over by hand:
 * JS drops the sign of negative zero, and it spells the non-finite values
 * differently. Coordinates never reach either case (the Y transform is written
 * as `0 - v`, which yields +0), but group 41 on TEXT does — see plotOneLineOfText.
 */
export function formatCoord(aValue: number): string {
  if (Number.isNaN(aValue)) return 'nan';
  if (!Number.isFinite(aValue)) return aValue > 0 ? 'inf' : '-inf';

  let buf = Object.is(aValue, -0) ? `-${(0).toFixed(16)}` : aValue.toFixed(16);

  while (buf.length > 0 && buf[buf.length - 1] === '0') buf = buf.slice(0, -1);

  return buf;
}

/**
 * fmt's `{:.8f}`, used for the two ARC angles and the TEXT rotation. Unlike
 * formatCoord this keeps its trailing zeros, and unlike formatCoord it really
 * does see negative zero: `Arc` negates a zero start angle, and upstream prints
 * that as "-0.00000000".
 */
function formatAngle(aValue: number): string {
  if (Number.isNaN(aValue)) return 'nan';
  if (!Number.isFinite(aValue)) return aValue > 0 ? 'inf' : '-inf';

  return Object.is(aValue, -0) ? `-${(0).toFixed(8)}` : aValue.toFixed(8);
}

/**
 * `getDXFLineType` (DXF_plotter.cpp). DASHDOTDOT maps to "DIVIDE", which
 * StartPlot never declares in the LTYPE table; the LINE entity then names an
 * undeclared linetype. That is upstream behaviour and stays.
 */
export function getDXFLineType(aType: LINE_STYLE): string {
  switch (aType) {
    case LINE_STYLE.DEFAULT:
    case LINE_STYLE.SOLID:
      return 'CONTINUOUS';
    case LINE_STYLE.DASH:
      return 'DASHED';
    case LINE_STYLE.DOT:
      return 'DOTTED';
    case LINE_STYLE.DASHDOT:
      return 'DASHDOT';
    case LINE_STYLE.DASHDOTDOT:
      return 'DIVIDE';
    default:
      return 'CONTINUOUS';
  }
}

/**
 * The ACAD legacy palette, transcribed from DXF_plotter.cpp lines 62..313.
 *
 * "VIOLETFIFTEEN" appears at index 192 (ACI 194) and again at index 224, where
 * the DXF_COLOR_T enum calls the entry VIOLETTHIRTYONE (ACI 229). Both records
 * are emitted, giving the file two LAYER entries with the same name, and the
 * name->ACI lookup in StartPlot is a first-match scan, so that name always
 * resolves to 194. A Map keyed by name would keep 229 instead and be wrong.
 */
const acad_dxf_color_names: readonly (readonly [name: string, aci: number])[] = [
  ['BLACK', 250],
  ['RED', 14],
  ['YELLOW', 52],
  ['GREEN', 94],
  ['CYAN', 134],
  ['BLUE', 174],
  ['MAGENTA', 214],
  ['WHITE', 250],
  ['BROWN', 54],
  ['ORANGE', 32],
  ['LIGHTRED', 12],
  ['LIGHTYELLOW', 51],
  ['LIGHTGREEN', 92],
  ['LIGHTCYAN', 132],
  ['LIGHTBLUE', 172],
  ['LIGHTMAGENTA', 212],
  ['LIGHTORANGE', 30],
  ['LIGHTGRAY', 9],
  ['DARKRED', 16],
  ['DARKYELLOW', 41],
  ['DARKGREEN', 96],
  ['DARKCYAN', 136],
  ['DARKBLUE', 176],
  ['DARKMAGENTA', 216],
  ['DARKBROWN', 56],
  ['DARKORANGE', 34],
  ['DARKGRAY', 8],
  ['PURERED', 1],
  ['PUREYELLOW', 2],
  ['PUREGREEN', 3],
  ['PURECYAN', 4],
  ['PUREBLUE', 5],
  ['PUREMAGENTA', 6],
  ['PUREORANGE', 40],
  ['PUREGRAY', 57],
  ['REDONE', 11],
  ['REDTWO', 13],
  ['REDTHREE', 15],
  ['REDFOUR', 17],
  ['REDFIVE', 18],
  ['REDSIX', 19],
  ['ORANGEONE', 20],
  ['ORANGETWO', 21],
  ['ORANGETHREE', 22],
  ['ORANGEFOUR', 23],
  ['ORANGEFIVE', 24],
  ['REDSEVEN', 25],
  ['REDEIGHT', 26],
  ['ORANGESIX', 27],
  ['REDNINE', 28],
  ['ORANGESEVEN', 29],
  ['ORANGEEIGHT', 31],
  ['ORANGENINE', 33],
  ['ORANGETEN', 35],
  ['ORANGEELEVEN', 36],
  ['ORANGETWELVE', 37],
  ['ORANGETHIRTEEN', 38],
  ['ORANGEFOURTEEN', 39],
  ['YELLOWONE', 42],
  ['YELLOWTWO', 43],
  ['YELLOWTHREE', 44],
  ['YELLOWFOUR', 45],
  ['YELLOWFIVE', 46],
  ['YELLOWSIX', 47],
  ['YELLOWSEVEN', 48],
  ['YELLOWEIGHT', 49],
  ['YELLOWNINE', 53],
  ['YELLOWTEN', 55],
  ['YELLOWELEVEN', 58],
  ['YELLOWTWELVE', 59],
  ['YELLOWTHIRTEEN', 60],
  ['YELLOWFOURTEEN', 61],
  ['GREENONE', 62],
  ['GREENTWO', 63],
  ['GREENTHREE', 64],
  ['GREENFOUR', 65],
  ['GREENFIVE', 66],
  ['GREENSIX', 67],
  ['GREENSEVEN', 68],
  ['GREENEIGHT', 69],
  ['GREENNINE', 70],
  ['GREENTEN', 71],
  ['GREENELEVEN', 72],
  ['GREENTWELVE', 73],
  ['GREENTHIRTEEN', 74],
  ['GREENFOURTEEN', 75],
  ['GREENFIFTEEN', 76],
  ['GREENSIXTEEN', 77],
  ['GREENSEVENTEEN', 78],
  ['GREENEIGHTEEN', 79],
  ['GREENNINETEEN', 80],
  ['GREENTWENTY', 81],
  ['GREENTWENTYONE', 82],
  ['GREENTWENTYTWO', 83],
  ['GREENTWENTYTHREE', 84],
  ['GREENTWENTYFOUR', 85],
  ['GREENTWENTYFIVE', 86],
  ['GREENTWENTYSIX', 87],
  ['GREENTWENTYSEVEN', 88],
  ['GREENTWENTYEIGHT', 89],
  ['GREENTWENTYNINE', 90],
  ['GREENTHIRTY', 91],
  ['GREENTHIRTYONE', 93],
  ['GREENTHIRTYTWO', 95],
  ['GREENTHIRTYTHREE', 97],
  ['GREENTHIRTYFOUR', 98],
  ['GREENTHIRTYFIVE', 99],
  ['GREENTHIRTYSIX', 100],
  ['GREENTHIRTYSEVEN', 101],
  ['GREENTHIRTYEIGHT', 102],
  ['GREENTHIRTYNINE', 103],
  ['GREENFORTY', 104],
  ['GREENFORTYONE', 105],
  ['GREENFORTYTWO', 106],
  ['GREENFORTYTHREE', 107],
  ['GREENFORTYFOUR', 108],
  ['GREENFORTYFIVE', 109],
  ['GREENFORTYSIX', 110],
  ['GREENFORTYSEVEN', 111],
  ['GREENFORTYEIGHT', 112],
  ['GREENFORTYNINE', 113],
  ['GREENFIFTY', 114],
  ['GREENFIFTYONE', 115],
  ['GREENFIFTYTWO', 116],
  ['GREENFIFTYTHREE', 117],
  ['GREENFIFTYFOUR', 118],
  ['GREENFIFTYFIVE', 119],
  ['GREENFIFTYSIX', 120],
  ['GREENFIFTYSEVEN', 121],
  ['GREENFIFTYEIGHT', 122],
  ['GREENFIFTYNINE', 123],
  ['GREENSIXTY', 124],
  ['GREENSIXTYONE', 125],
  ['GREENSIXTYTWO', 126],
  ['GREENSIXTYTHREE', 127],
  ['GREENSIXTYFOUR', 128],
  ['GREENSIXTYFIVE', 129],
  ['CYANONE', 131],
  ['CYANTWO', 133],
  ['CYANTHREE', 135],
  ['CYANFOUR', 137],
  ['CYANFIVE', 138],
  ['CYANSIX', 139],
  ['CYANSEVEN', 140],
  ['BLUEONE', 141],
  ['BLUETWO', 142],
  ['BLUETHREE', 143],
  ['BLUEFOUR', 144],
  ['BLUEFIVE', 145],
  ['BLUESIX', 146],
  ['BLUESEVEN', 147],
  ['BLUEEIGHT', 148],
  ['BLUENINE', 149],
  ['BLUETEN', 150],
  ['BLUEELEVEN', 151],
  ['BLUETWELVE', 152],
  ['BLUETHIRTEEN', 153],
  ['BLUEFOURTEEN', 154],
  ['BLUEFIFTEEN', 155],
  ['BLUESIXTEEN', 156],
  ['BLUESEVENTEEN', 157],
  ['BLUEEIGHTEEN', 158],
  ['BLUENINETEEN', 159],
  ['BLUETWENTY', 160],
  ['BLUETWENTYONE', 161],
  ['BLUETWENTYTWO', 162],
  ['BLUETWENTYTHREE', 163],
  ['BLUETWENTYFOUR', 164],
  ['BLUETWENTYFIVE', 165],
  ['BLUETWENTYSIX', 166],
  ['BLUETWENTYSEVEN', 167],
  ['BLUETWENTYEIGHT', 168],
  ['BLUETWENTYNINE', 169],
  ['BLUETHIRTY', 170],
  ['BLUETHIRTYONE', 171],
  ['BLUETHIRTYTWO', 177],
  ['BLUETHIRTYETHREE', 178],
  ['BLUETHIRTYFOUR', 179],
  ['VIOLETONE', 180],
  ['VIOLETTWO', 181],
  ['VIOLETTHREE', 182],
  ['VIOLETFOUR', 183],
  ['VIOLETFIVE', 184],
  ['VIOLETSIX', 185],
  ['VIOLETSEVEN', 186],
  ['VIOLETEIGHT', 187],
  ['VIOLETNINE', 188],
  ['VIOLETTEN', 189],
  ['VIOLETELEVEN', 190],
  ['VIOLETTWELVE', 191],
  ['VIOLETTHIRTEEN', 192],
  ['VIOLETFOURTEEN', 193],
  ['VIOLETFIFTEEN', 194],
  ['VIOLETSIXTEEN', 195],
  ['VIOLETSEVENTEEN', 196],
  ['VIOLETEIGHTEEN', 197],
  ['VIOLETNINETEEN', 198],
  ['VIOLETTWENTY', 199],
  ['VIOLETTWENTYONE', 200],
  ['VIOLETTWENTYTWO', 201],
  ['VIOLETTWENTYTHREE', 202],
  ['VIOLETTWENTYFOUR', 203],
  ['VIOLETTWENTYFIVE', 204],
  ['VIOLETTWENTYSIX', 205],
  ['VIOLETTWENTYSEVEN', 206],
  ['VIOLETTWENTYEIGHT', 207],
  ['VIOLETTWENTYNINE', 208],
  ['VIOLETTHIRTY', 209],
  ['MAGENTAONE', 210],
  ['MAGENTATWO', 211],
  ['MAGENTATHREE', 213],
  ['MAGENTAFOUR', 215],
  ['MAGENTAFIVE', 217],
  ['MAGENTASIX', 218],
  ['MAGENTASEVEN', 219],
  ['MAGENTAEIGHT', 220],
  ['MAGENTANINE', 221],
  ['MAGENTATEN', 222],
  ['MAGENTAELEVEN', 223],
  ['MAGENTATWELVE', 224],
  ['MAGENTATHIRTEEN', 225],
  ['MAGENTAFOURTEEN', 226],
  ['REDTEN', 227],
  ['REDELEVEN', 228],
  ['VIOLETFIFTEEN', 229],
  ['REDTWELVE', 230],
  ['REDTHIRTEEN', 231],
  ['REDFOURTEEN', 232],
  ['REDFIFTEEN', 233],
  ['REDSIXTEEN', 234],
  ['REDSEVENTEEN', 235],
  ['REDEIGHTEEN', 236],
  ['REDNINETEEN', 237],
  ['REDTWENTY', 238],
  ['REDTWENTYONE', 239],
  ['REDTWENTYTWO', 240],
  ['REDTWENTYTHREE', 241],
  ['REDTWENTYFOUR', 242],
  ['REDTWENTYFIVE', 243],
  ['REDTWENTYSIX', 244],
  ['REDTWENTYSEVEN', 245],
  ['REDTWENTYEIGHT', 246],
  ['REDTWENTYNINE', 247],
  ['REDTHIRTY', 248],
  ['REDTHIRTYONE', 249],
  ['GRAYONE', 251],
  ['GRAYTWO', 252],
  ['GRAYTHREE', 253],
  ['GRAYFOUR', 254],
];

/**
 * The RGB values for those 249 entries, DXF_plotter.cpp lines 323..573.
 * Upstream stores them BLUE, GREEN, RED in that field order; the tuples keep it
 * so a transcription slip shows up as a swapped channel rather than silently
 * shifting every nearest-colour lookup. The struct's fourth member (the
 * DXF_COLOR_T name) is dead: FindNearestLegacyColor works off the array index.
 */
const acad_dxf_color_values: readonly (readonly [b: number, g: number, r: number])[] = [
  [0, 0, 0],
  [0, 0, 127],
  [0, 165, 165],
  [0, 127, 0],
  [127, 127, 0],
  [127, 0, 0],
  [127, 0, 127],
  [255, 255, 255],
  [0, 127, 127],
  [0, 82, 165],
  [0, 0, 165],
  [127, 255, 255],
  [0, 165, 0],
  [165, 165, 0],
  [165, 0, 0],
  [165, 0, 165],
  [0, 127, 255],
  [192, 192, 192],
  [0, 0, 76],
  [127, 223, 255],
  [0, 76, 0],
  [76, 76, 0],
  [76, 0, 0],
  [76, 0, 76],
  [0, 76, 76],
  [0, 63, 127],
  [128, 128, 128],
  [0, 0, 255],
  [0, 255, 255],
  [0, 255, 0],
  [255, 255, 0],
  [255, 0, 0],
  [255, 0, 255],
  [0, 191, 255],
  [38, 76, 76],
  [127, 127, 255],
  [82, 82, 165],
  [63, 63, 127],
  [38, 38, 76],
  [0, 0, 38],
  [19, 19, 38],
  [0, 63, 255],
  [127, 159, 255],
  [0, 41, 165],
  [82, 103, 165],
  [0, 31, 127],
  [63, 79, 127],
  [0, 19, 76],
  [38, 47, 76],
  [0, 9, 38],
  [19, 23, 38],
  [127, 191, 255],
  [82, 124, 165],
  [63, 95, 127],
  [0, 38, 76],
  [38, 57, 76],
  [0, 19, 38],
  [19, 28, 38],
  [0, 124, 165],
  [82, 145, 165],
  [0, 95, 127],
  [63, 111, 127],
  [0, 57, 76],
  [38, 66, 76],
  [0, 28, 38],
  [19, 33, 38],
  [82, 165, 165],
  [63, 127, 127],
  [0, 38, 38],
  [19, 38, 38],
  [0, 255, 191],
  [127, 255, 223],
  [0, 165, 124],
  [82, 165, 145],
  [0, 127, 95],
  [63, 127, 111],
  [0, 76, 57],
  [38, 76, 66],
  [0, 38, 28],
  [19, 38, 33],
  [0, 255, 127],
  [127, 255, 191],
  [0, 165, 82],
  [82, 165, 124],
  [0, 127, 63],
  [63, 127, 95],
  [0, 76, 38],
  [38, 76, 57],
  [0, 38, 19],
  [19, 38, 28],
  [0, 255, 63],
  [127, 255, 159],
  [0, 165, 41],
  [82, 165, 103],
  [0, 127, 31],
  [63, 127, 79],
  [0, 76, 19],
  [38, 76, 47],
  [0, 38, 9],
  [19, 38, 23],
  [0, 255, 0],
  [127, 255, 127],
  [82, 165, 82],
  [63, 127, 63],
  [38, 76, 38],
  [0, 38, 0],
  [19, 38, 19],
  [63, 255, 0],
  [159, 255, 127],
  [41, 165, 0],
  [103, 165, 82],
  [31, 127, 0],
  [79, 127, 63],
  [19, 76, 0],
  [47, 76, 38],
  [9, 38, 0],
  [23, 88, 19],
  [127, 255, 0],
  [191, 255, 127],
  [82, 165, 0],
  [95, 127, 63],
  [63, 127, 0],
  [95, 127, 63],
  [38, 76, 0],
  [57, 76, 38],
  [19, 38, 0],
  [28, 88, 19],
  [191, 255, 0],
  [223, 255, 127],
  [124, 165, 0],
  [145, 165, 82],
  [95, 127, 0],
  [111, 127, 63],
  [57, 76, 0],
  [66, 76, 38],
  [28, 38, 0],
  [88, 88, 19],
  [255, 255, 127],
  [165, 165, 82],
  [127, 127, 63],
  [76, 76, 38],
  [38, 38, 0],
  [88, 88, 19],
  [255, 191, 0],
  [255, 223, 127],
  [165, 124, 0],
  [165, 145, 82],
  [127, 95, 0],
  [127, 111, 63],
  [76, 57, 0],
  [126, 66, 38],
  [38, 28, 0],
  [88, 88, 19],
  [255, 127, 0],
  [255, 191, 127],
  [165, 82, 0],
  [165, 124, 82],
  [127, 63, 0],
  [127, 95, 63],
  [76, 38, 0],
  [126, 57, 38],
  [38, 19, 0],
  [88, 28, 19],
  [255, 63, 0],
  [255, 159, 127],
  [165, 41, 0],
  [165, 103, 82],
  [127, 31, 0],
  [127, 79, 63],
  [76, 19, 0],
  [126, 47, 38],
  [38, 9, 0],
  [88, 23, 19],
  [255, 0, 0],
  [255, 127, 127],
  [126, 38, 38],
  [38, 0, 0],
  [88, 19, 19],
  [255, 0, 63],
  [255, 127, 159],
  [165, 0, 41],
  [165, 82, 103],
  [127, 0, 31],
  [127, 63, 79],
  [76, 0, 19],
  [126, 38, 47],
  [38, 0, 9],
  [88, 19, 23],
  [255, 0, 127],
  [255, 127, 191],
  [165, 0, 82],
  [165, 82, 124],
  [127, 0, 63],
  [127, 63, 95],
  [76, 0, 38],
  [126, 38, 57],
  [38, 0, 19],
  [88, 19, 28],
  [255, 0, 191],
  [255, 127, 223],
  [165, 0, 124],
  [165, 82, 145],
  [127, 0, 95],
  [127, 63, 111],
  [76, 0, 57],
  [76, 38, 66],
  [38, 0, 28],
  [88, 19, 88],
  [255, 0, 255],
  [255, 127, 255],
  [165, 82, 165],
  [127, 63, 127],
  [76, 38, 76],
  [38, 0, 38],
  [88, 19, 88],
  [191, 0, 255],
  [223, 127, 255],
  [124, 0, 165],
  [145, 82, 165],
  [95, 0, 127],
  [111, 63, 127],
  [57, 0, 76],
  [66, 38, 76],
  [28, 0, 38],
  [88, 19, 88],
  [127, 0, 255],
  [191, 127, 255],
  [82, 0, 165],
  [124, 82, 165],
  [63, 0, 127],
  [95, 63, 127],
  [38, 0, 76],
  [57, 38, 76],
  [19, 0, 38],
  [28, 19, 88],
  [63, 0, 255],
  [159, 127, 255],
  [41, 0, 165],
  [103, 82, 165],
  [31, 0, 127],
  [79, 63, 127],
  [19, 0, 76],
  [47, 38, 76],
  [9, 0, 38],
  [23, 19, 88],
  [101, 101, 101],
  [102, 102, 102],
  [153, 153, 153],
  [204, 204, 204],
];

/**
 * `FindNearestLegacyColor` (DXF_plotter.cpp): a linear scan over all 249
 * entries by squared RGB distance. The comparison is strictly `<`, so ties go
 * to the lowest index — pure black resolves to BLACK (0) and never to WHITE
 * (7), even though the two share ACI 250. Returns a table *index*, not an ACI.
 */
export function FindNearestLegacyColor(aR: number, aG: number, aB: number): number {
  let nearestColorValueIndex = 0;
  let nearestDistance = Number.MAX_SAFE_INTEGER;

  for (let trying = 0; trying < acad_dxf_color_values.length; trying++) {
    const [blue, green, red] = acad_dxf_color_values[trying]!;
    const distance =
      (aR - red) * (aR - red) + (aG - green) * (aG - green) + (aB - blue) * (aB - blue);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestColorValueIndex = trying;
    }
  }

  return nearestColorValueIndex;
}

/** The ACAD colour name at a table index, for callers that resolved one. */
export function acadColorName(aIndex: number): string {
  return acad_dxf_color_names[aIndex]![0];
}

/**
 * `arcPts` (DXF_plotter.cpp), the free function that flattens an arc at a fixed
 * five-degree step. The start angle is negated, then each sample is taken at
 * the *re*-negated angle, so the first point sits at the original start angle
 * unless the CCW swap fired. The loop bound is strictly `<`, which is why the
 * penultimate sample never lands on the end point.
 *
 * Its only upstream caller is the SHAPE_LINE_CHAIN PlotPoly overload, which the
 * repo cannot express yet; it is exported here because it is pure and testable.
 */
export function arcPts(
  aCenter: Vec2,
  aStartAngle: EDA_ANGLE,
  aAngle: EDA_ANGLE,
  aRadius: number,
): Vec2[] {
  const pts: Vec2[] = [];

  let startAngle = aStartAngle.negate();
  let endAngle = startAngle.sub(aAngle);
  const delta = new EDA_ANGLE(5);

  if (startAngle.gt(endAngle)) [startAngle, endAngle] = [endAngle, startAngle];

  pts.push({
    x: KiROUND(aCenter.x + aRadius * startAngle.negate().Cos()),
    y: KiROUND(aCenter.y + aRadius * startAngle.negate().Sin()),
  });

  for (let ii = startAngle.add(delta); ii.lt(endAngle); ii = ii.add(delta)) {
    pts.push({
      x: KiROUND(aCenter.x + aRadius * ii.negate().Cos()),
      y: KiROUND(aCenter.y + aRadius * ii.negate().Sin()),
    });
  }

  pts.push({
    x: KiROUND(aCenter.x + aRadius * endAngle.negate().Cos()),
    y: KiROUND(aCenter.y + aRadius * endAngle.negate().Sin()),
  });

  return pts;
}

/** One LTYPE table row (StartPlot's local `LtypePattern`). */
interface LtypePattern {
  name: string;
  description: string;
  elementCount: number;
  patternLength: number;
  dashes: string;
}

/**
 * ByBlock and ByLayer are looked up by name and AutoCAD aborts when either is
 * absent. Group 49 is the per-element dash (positive) or gap (negative) length
 * and each 49 must be followed by a 74 in R2000+. DOTTED's first dash is the
 * literal "0.0", which is not what String(0) would produce, so the pattern
 * strings are copied through verbatim rather than formatted.
 */
const LTYPES: readonly LtypePattern[] = [
  { name: 'ByBlock', description: '', elementCount: 0, patternLength: 0.0, dashes: '' },
  { name: 'ByLayer', description: '', elementCount: 0, patternLength: 0.0, dashes: '' },
  {
    name: 'CONTINUOUS',
    description: 'Solid line',
    elementCount: 0,
    patternLength: 0.0,
    dashes: '',
  },
  {
    name: 'DASHDOT',
    description: 'Dash Dot ____ _ ____ _',
    elementCount: 4,
    patternLength: 2.0,
    dashes: ' 49\n1.25\n 74\n0\n 49\n-0.25\n 74\n0\n' + ' 49\n0.25\n 74\n0\n 49\n-0.25\n 74\n0\n',
  },
  {
    name: 'DASHED',
    description: 'Dashed __ __ __ __ __',
    elementCount: 2,
    patternLength: 0.75,
    dashes: ' 49\n0.5\n 74\n0\n 49\n-0.25\n 74\n0\n',
  },
  {
    name: 'DOTTED',
    description: 'Dotted .  .  .  .',
    elementCount: 2,
    patternLength: 0.2,
    dashes: ' 49\n0.0\n 74\n0\n 49\n-0.2\n 74\n0\n',
  },
];

/** STYLE table names; the oblique angle is chosen by `i < 2`, not by the name. */
const STYLE_NAMES = ['KICAD', 'KICADB', 'KICADI', 'KICADBI'] as const;

const PAPER_NAME = 'A3';
const PAPER_WIDTH_MM = 420.0;
const PAPER_HEIGHT_MM = 297.0;
const PLOT_FLAG_MODELTYPE = 1024;

const TEXT_ENCODER = new TextEncoder();

/**
 * `DXF_PLOTTER` (include/plotters/plotter_dxf.h, common/plotters/DXF_plotter.cpp).
 *
 * Stateful by nature — handle counter, pen position, current colour and
 * linetype, layout bookkeeping — so it stays a class. Drive it exactly as
 * upstream does: SetUnits / SetViewport / SetColorMode / SetLayersToExport,
 * then StartPlot, then geometry with SetLayer between layers, then EndPlot.
 */
export class DxfPlotter {
  // ---- PLOTTER base state (the members DXF actually reads) -----------------
  private m_plotOffset: Vec2 = { x: 0, y: 0 };
  private m_plotScale = 1;
  private m_paperSize: Vec2 = { x: 0, y: 0 };
  private m_IUsPerDecimil = 1;
  private m_iuPerDeviceUnit = 1;
  private m_colorMode = false;
  private m_currentPenWidth = -1;
  private m_penLastpos: Vec2 = { x: 0, y: 0 };
  private m_layer: PCB_LAYER_ID = '';
  private m_layersToExport: readonly DxfLayerExport[] = [];

  // ---- DXF_PLOTTER state ---------------------------------------------------
  private m_plotUnits: DXF_UNITS = DXF_UNITS.INCH;
  private m_unitScalingFactor = 0.0001;
  private m_measurementDirective = 0;
  private m_insUnits = 1;
  private m_textAsLines = true;
  private m_currentColor: Color4d = COLOR4D_BLACK;
  private m_currentLineType: LINE_STYLE = LINE_STYLE.SOLID;

  private m_handle = 0;
  private m_modelSpaceHandle = '';
  private m_plotStyleNormalHandle = '';
  private m_plotStyleNameDictHandle = '';
  private m_namedObjectDictHandle = '';
  private m_layoutDictHandle = '';
  private m_dxfLayouts: DxfLayout[] = [];

  /** The emitted file. Bytes, because layer names are UTF-8 and glyphs Latin-1. */
  private out: number[] = [];

  constructor(private readonly m_renderSettings: DxfRenderSettings) {
    // DXF_PLOTTER's constructor body, in order.
    this.m_textAsLines = true;
    this.m_currentColor = COLOR4D_BLACK;
    this.m_currentLineType = LINE_STYLE.SOLID;
    this.SetUnits(DXF_UNITS.INCH);
  }

  // =========================================================================
  // Output buffer
  // =========================================================================

  /** Fixed markup and layer names: `TO_UTF8`. */
  private emit(aText: string): void {
    for (const byte of TEXT_ENCODER.encode(aText)) this.out.push(byte);
  }

  /** A single raw byte, upstream's `putc( ch, m_outputFile )`, i.e. Latin-1. */
  private putLatin1(aCode: number): void {
    this.out.push(aCode & 0xff);
  }

  /** The plotted file. This, not `text()`, is what should be written to disk. */
  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }

  /** The file decoded as Latin-1, so tests can read whole entities as prose. */
  text(): string {
    let s = '';
    for (const byte of this.out) s += String.fromCharCode(byte);
    return s;
  }

  // =========================================================================
  // Units, viewport, pen and colour state
  // =========================================================================

  /** `SetUnits`. INCH is also the default arm of upstream's switch. */
  SetUnits(aUnit: DXF_UNITS): void {
    this.m_plotUnits = aUnit;

    switch (aUnit) {
      case DXF_UNITS.MM:
        this.m_unitScalingFactor = 0.00254;
        this.m_measurementDirective = 1;
        this.m_insUnits = 4;
        break;

      // INCH shares upstream's default arm.
      default:
        this.m_unitScalingFactor = 0.0001;
        this.m_measurementDirective = 0;
        this.m_insUnits = 1;
    }
  }

  GetUnits(): DXF_UNITS {
    return this.m_plotUnits;
  }

  /**
   * `SetViewport`. DXF paper is virtual, so the paper size is forced to zero,
   * and `aMirror` is deliberately dropped — DXF never mirrors. pcbnew always
   * passes aIusPerDecimil = 2540 (plot_board_layers.cpp), which makes the
   * device unit an inch or a millimetre depending on SetUnits.
   */
  SetViewport(aOffset: Vec2, aIusPerDecimil: number, aScale: number, _aMirror: boolean): void {
    this.m_plotOffset = aOffset;
    this.m_plotScale = aScale;

    this.m_paperSize = { x: 0, y: 0 };

    this.m_IUsPerDecimil = aIusPerDecimil;
    this.m_iuPerDeviceUnit = 1.0 / aIusPerDecimil;
    this.m_iuPerDeviceUnit *= this.m_unitScalingFactor;

    // aMirror is dropped on the floor: DXF never mirrors.
    this.m_currentColor = COLOR4D_BLACK;
  }

  /**
   * `PLOTTER::userToDeviceCoordinates`, specialised to the state SetViewport
   * pins for DXF: paper size (0,0), no mirroring, no reversed Y axis. Keeping
   * `m_paperSize.y - v` rather than `-v` is what stops a point on the origin
   * row emitting "-0." instead of "0.".
   */
  private userToDeviceCoordinates(aCoordinate: Vec2): Vec2 {
    const pos = {
      x: aCoordinate.x - this.m_plotOffset.x,
      y: aCoordinate.y - this.m_plotOffset.y,
    };

    const x = pos.x * this.m_plotScale;
    const y = this.m_paperSize.y - pos.y * this.m_plotScale;

    return { x: x * this.m_iuPerDeviceUnit, y: y * this.m_iuPerDeviceUnit };
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

  /** DXF carries no line widths, so the width is discarded and the pen is 0. */
  SetCurrentLineWidth(_width: number, _aData?: unknown): void {
    this.m_currentPenWidth = 0;
  }

  GetCurrentLineWidth(): number {
    return this.m_currentPenWidth;
  }

  /** `PLOTTER::SetColorMode`. pcbnew passes `!blackAndWhite`. */
  SetColorMode(aColorMode: boolean): void {
    this.m_colorMode = aColorMode;
  }

  GetColorMode(): boolean {
    return this.m_colorMode;
  }

  /**
   * `SetColor`. In mono mode everything but exact black and exact white
   * collapses to black; the comparison includes alpha, as COLOR4D's does.
   */
  SetColor(aColor: Color4d): void {
    if (
      this.m_colorMode ||
      colorEquals(aColor, COLOR4D_BLACK) ||
      colorEquals(aColor, COLOR4D_WHITE)
    )
      this.m_currentColor = aColor;
    else this.m_currentColor = COLOR4D_BLACK;
  }

  /**
   * `SetTextMode`. The constructor leaves m_textAsLines true, so the native
   * TEXT entity path is reached only when the caller explicitly asks for it.
   */
  SetTextMode(aMode: PLOT_TEXT_MODE): void {
    if (aMode !== PLOT_TEXT_MODE.DEFAULT) this.m_textAsLines = aMode !== PLOT_TEXT_MODE.NATIVE;
  }

  /** `SetDash`. The width argument is ignored; DXF dashes are a linetype name. */
  SetDash(_aLineWidth: number, aLineStyle: LINE_STYLE): void {
    this.m_currentLineType = aLineStyle;
  }

  SetLayer(aLayer: PCB_LAYER_ID): void {
    this.m_layer = aLayer;
  }

  GetLayer(): PCB_LAYER_ID {
    return this.m_layer;
  }

  /**
   * `PLOTTER::SetLayersToExport`. pcbnew populates this for every plot, so a
   * board plot names its DXF layers after board layers; leaving it empty is the
   * eeschema path, where the 249 ACAD colour names become the layers.
   */
  SetLayersToExport(aLayersToExport: readonly DxfLayerExport[]): void {
    this.m_layersToExport = aLayersToExport;
  }

  /** `PLOTTER::GetPlotterArcHighDef` / `GetPlotterArcLowDef`. */
  GetPlotterArcHighDef(): number {
    return this.m_IUsPerDecimil * 2;
  }

  GetPlotterArcLowDef(): number {
    return this.m_IUsPerDecimil * 8;
  }

  // =========================================================================
  // Layer naming
  // =========================================================================

  /**
   * `GetCurrentLayerName`. Note the two asymmetries upstream builds in
   * deliberately: with an empty export list, Layer_Name reads the colour that
   * SetColor last stored while Layer_Color_Name reads the render settings, and
   * Current_Layer_Color_Name ignores the layer id it was handed in favour of
   * the current layer. `int( c * 255 )` truncates towards zero, so 0.5 is 127.
   */
  GetCurrentLayerName(aMode: DXF_LAYER_OUTPUT_MODE, aLayerId?: PCB_LAYER_ID): string {
    const actualLayerId = aLayerId !== undefined ? aLayerId : this.m_layer;

    switch (aMode) {
      case DXF_LAYER_OUTPUT_MODE.Layer_Name:
      case DXF_LAYER_OUTPUT_MODE.Current_Layer_Name: {
        if (this.m_layersToExport.length === 0) {
          const layerColor =
            aMode === DXF_LAYER_OUTPUT_MODE.Current_Layer_Name
              ? this.m_currentColor
              : this.m_renderSettings.GetLayerColor(actualLayerId);

          const color = FindNearestLegacyColor(
            Math.trunc(layerColor.r * 255),
            Math.trunc(layerColor.g * 255),
            Math.trunc(layerColor.b * 255),
          );
          return acad_dxf_color_names[color]![0];
        }

        const it = this.m_layersToExport.find((element) => element[0] === actualLayerId);

        return it !== undefined ? it[1] : 'BLACK';
      }

      case DXF_LAYER_OUTPUT_MODE.Layer_Color_Name:
      case DXF_LAYER_OUTPUT_MODE.Current_Layer_Color_Name: {
        const layerColor =
          aMode === DXF_LAYER_OUTPUT_MODE.Current_Layer_Color_Name
            ? this.m_renderSettings.GetLayerColor(this.GetLayer())
            : this.m_renderSettings.GetLayerColor(actualLayerId);

        const color = FindNearestLegacyColor(
          Math.trunc(layerColor.r * 255),
          Math.trunc(layerColor.g * 255),
          Math.trunc(layerColor.b * 255),
        );
        return acad_dxf_color_names[color]![0];
      }

      default:
        return 'Unknown Mode';
    }
  }

  // =========================================================================
  // Handles
  // =========================================================================

  /** `nextHandle`: uppercase unpadded hex, pre-incremented, so the first is "1". */
  private nextHandle(): string {
    return (++this.m_handle).toString(16).toUpperCase();
  }

  /**
   * `emitEntityHandle`. Returns the handle so POLYLINE can own its VERTEX
   * records and their SEQEND. SEQEND is the one caller that passes no subclass.
   */
  private emitEntityHandle(
    aEntityType: string,
    aSubclass: string | null,
    aLayerName: string,
    aOwner = '',
  ): string {
    const handle = this.nextHandle();
    const owner = aOwner === '' ? this.m_modelSpaceHandle : aOwner;

    this.emit(
      `  0\n${aEntityType}\n` +
        `  5\n${handle}\n` +
        `330\n${owner}\n` +
        `100\nAcDbEntity\n` +
        `  8\n${aLayerName}\n`,
    );

    if (aSubclass) this.emit(`100\n${aSubclass}\n`);

    return handle;
  }

  /** `emitSymbolTableHeader`; the returned handle is the 330 owner of its records. */
  private emitSymbolTableHeader(aTableName: string, aCount: number): string {
    const handle = this.nextHandle();

    this.emit(
      `  0\n` +
        `TABLE\n` +
        `  2\n${aTableName}\n` +
        `  5\n${handle}\n` +
        `330\n0\n` +
        `100\nAcDbSymbolTable\n` +
        ` 70\n${aCount}\n`,
    );

    return handle;
  }

  // =========================================================================
  // File skeleton
  // =========================================================================

  /**
   * `StartPlot`. Everything before the ENTITIES section, in one go, because the
   * handle numbering is positional: every record's handle is decided by where
   * its allocation sits in this method, and the OBJECTS section written by
   * EndPlot cites handles minted here.
   *
   * Tagged AC1018 (R2004) because the LAYER records emit group 420, the 24-bit
   * true colour AutoCAD only accepts from R2004 on; that in turn obliges the
   * full table and blocks skeleton below.
   */
  StartPlot(_aPageNumber = ''): boolean {
    // Reset so one instance can plot several files, as upstream's does.
    this.m_handle = 0;
    this.m_modelSpaceHandle = '';

    // Codes 50 and 70 carry TWO leading spaces here and one everywhere else.
    this.emit(
      `  0\n` +
        `SECTION\n` +
        `  2\n` +
        `HEADER\n` +
        `  9\n` +
        `$ACADVER\n` +
        `  1\n` +
        `AC1018\n` +
        `  9\n` +
        `$HANDSEED\n` +
        `  5\n` +
        `FFFFFFFF\n` +
        `  9\n` +
        `$ANGBASE\n` +
        `  50\n` +
        `0.0\n` +
        `  9\n` +
        `$ANGDIR\n` +
        `  70\n` +
        `1\n` +
        `  9\n` +
        `$MEASUREMENT\n` +
        `  70\n` +
        `${this.m_measurementDirective}\n` +
        `  9\n` +
        `$INSUNITS\n` +
        `  70\n` +
        `${this.m_insUnits}\n` +
        `  0\n` +
        `ENDSEC\n`,
    );

    this.emit(`  0\n` + `SECTION\n` + `  2\n` + `TABLES\n`);

    // AutoCAD refuses to load R2000+ files lacking an ACAD APPID entry.
    const appidTableHandle = this.emitSymbolTableHeader('APPID', 1);

    this.emit(
      `  0\n` +
        `APPID\n` +
        `  5\n${this.nextHandle()}\n` +
        `330\n${appidTableHandle}\n` +
        `100\nAcDbSymbolTableRecord\n` +
        `100\nAcDbRegAppTableRecord\n` +
        `  2\nACAD\n` +
        ` 70\n0\n` +
        `  0\n` +
        `ENDTAB\n`,
    );

    const ltypeTableHandle = this.emitSymbolTableHeader('LTYPE', LTYPES.length);

    for (const lt of LTYPES) {
      this.emit(
        `  0\n` +
          `LTYPE\n` +
          `  5\n${this.nextHandle()}\n` +
          `330\n${ltypeTableHandle}\n` +
          `100\nAcDbSymbolTableRecord\n` +
          `100\nAcDbLinetypeTableRecord\n` +
          `  2\n${lt.name}\n` +
          ` 70\n0\n` +
          `  3\n${lt.description}\n` +
          ` 72\n65\n` +
          ` 73\n${lt.elementCount}\n` +
          ` 40\n${String(lt.patternLength)}\n` +
          `${lt.dashes}`,
      );
    }

    this.emit(`  0\n` + `ENDTAB\n`);

    // STYLE table - one entry per bold/italic combination. The oblique angle is
    // selected by `i < 2`, not by whether the style is the italic one; the
    // ordering makes that come out right, and the form is kept as upstream's.
    const styleTableHandle = this.emitSymbolTableHeader('STYLE', 4);

    for (let i = 0; i < 4; i++) {
      this.emit(
        `  0\n` +
          `STYLE\n` +
          `  5\n${this.nextHandle()}\n` +
          `330\n${styleTableHandle}\n` +
          `100\nAcDbSymbolTableRecord\n` +
          `100\nAcDbTextStyleTableRecord\n` +
          `  2\n${STYLE_NAMES[i]}\n` +
          ` 70\n0\n` +
          ` 40\n0\n` +
          ` 41\n1\n` +
          ` 42\n1\n` +
          ` 50\n${String(i < 2 ? 0 : DXF_OBLIQUE_ANGLE)}\n` +
          ` 71\n0\n` +
          // The standard ISO font: with it, DXF text in acad matches perfectly.
          `  3\nisocp.shx\n`,
      );
    }

    this.emit(`  0\n` + `ENDTAB\n`);

    let numLayers =
      this.m_layersToExport.length === 0
        ? acad_dxf_color_names.length
        : this.m_layersToExport.length;

    // If printing in monochrome, only output the black layer. The table header
    // count below is still numLayers + 1, so a mono colour-layered plot declares
    // two layers and writes one; that is upstream's arithmetic.
    if (!this.GetColorMode() && this.m_layersToExport.length === 0) numLayers = 1;

    // Every LAYER record needs a 390 hard-pointer to a PlotStyleName object; one
    // shared ACDBPLACEHOLDER named "Normal" serves them all, so its handle and
    // its owning dictionary's are minted here, before the records that cite them.
    // The +1 on the count is the mandatory layer "0" emitted next.
    const layerTableHandle = this.emitSymbolTableHeader('LAYER', numLayers + 1);

    this.m_plotStyleNormalHandle = this.nextHandle();
    this.m_plotStyleNameDictHandle = this.nextHandle();

    this.emit(
      `  0\n` +
        `LAYER\n` +
        `  5\n${this.nextHandle()}\n` +
        `330\n${layerTableHandle}\n` +
        `100\nAcDbSymbolTableRecord\n` +
        `100\nAcDbLayerTableRecord\n` +
        `  2\n0\n` +
        ` 70\n0\n` +
        ` 62\n7\n` +
        `  6\nCONTINUOUS\n` +
        `390\n${this.m_plotStyleNormalHandle}\n`,
    );

    let layerName = '';
    let colorNumber = 0;

    // Declared outside the loop and never reset, exactly as upstream. Harmless
    // only because the branch that sets it runs on every iteration or on none.
    let hasActualColor = false;
    let actualColor: Color4d = COLOR4D_BLACK;

    for (let i = 0; i < numLayers; i++) {
      if (this.m_layersToExport.length !== 0) {
        layerName = this.GetCurrentLayerName(
          DXF_LAYER_OUTPUT_MODE.Layer_Name,
          this.m_layersToExport[i]![0],
        );
        const colorName = this.GetCurrentLayerName(
          DXF_LAYER_OUTPUT_MODE.Layer_Color_Name,
          this.m_layersToExport[i]![0],
        );

        // First match, so a colour resolving to the duplicated "VIOLETFIFTEEN"
        // always takes ACI 194 and never the 229 of the second record.
        const it = acad_dxf_color_names.find((layer) => layer[0] === colorName);

        colorNumber = it !== undefined ? it[1] : 7; // Default to white/black

        actualColor = this.m_renderSettings.GetLayerColor(this.m_layersToExport[i]![0]);
        hasActualColor = true;
      } else {
        layerName = acad_dxf_color_names[i]![0];
        colorNumber = acad_dxf_color_names[i]![1];
      }

      this.emit(
        `  0\n` +
          `LAYER\n` +
          `  5\n${this.nextHandle()}\n` +
          `330\n${layerTableHandle}\n` +
          `100\nAcDbSymbolTableRecord\n` +
          `100\nAcDbLayerTableRecord\n` +
          `  2\n${layerName}\n` +
          ` 70\n0\n` +
          ` 62\n${colorNumber}\n`,
      );

      if (hasActualColor) {
        // The legacy 62 index alone would lose the user's layer colour.
        const r = Math.trunc(actualColor.r * 255);
        const g = Math.trunc(actualColor.g * 255);
        const b = Math.trunc(actualColor.b * 255);

        const trueColorValue = (r << 16) | (g << 8) | b;

        this.emit(`420\n${trueColorValue}\n`);
      }

      this.emit(`  6\nCONTINUOUS\n390\n${this.m_plotStyleNormalHandle}\n`);
    }

    this.emit(`  0\n` + `ENDTAB\n`);

    // AutoCAD's R2000+ reader walks a fixed list of expected symbol tables and
    // aborts when one is absent; empty headers satisfy it.
    for (const tableName of ['VPORT', 'VIEW', 'UCS']) {
      this.emitSymbolTableHeader(tableName, 0);
      this.emit(`  0\nENDTAB\n`);
    }

    // DIMSTYLE is the only symbol table whose record handle uses group 105
    // instead of 5, and whose header carries an extra subclass marker.
    const dimstyleTableHandle = this.emitSymbolTableHeader('DIMSTYLE', 1);

    this.emit(
      `100\nAcDbDimStyleTable\n` +
        ` 71\n0\n` +
        `  0\n` +
        `DIMSTYLE\n` +
        `105\n${this.nextHandle()}\n` +
        `330\n${dimstyleTableHandle}\n` +
        `100\nAcDbSymbolTableRecord\n` +
        `100\nAcDbDimStyleTableRecord\n` +
        `  2\nStandard\n` +
        ` 70\n0\n` +
        `  0\n` +
        `ENDTAB\n`,
    );

    // R2004 mandates three layout blocks; each BLOCK_RECORD carries a 340
    // hard-pointer to its LAYOUT, so the LAYOUT handles are pre-allocated here
    // for EndPlot to use when it writes OBJECTS.
    const blockRecordTableHandle = this.emitSymbolTableHeader('BLOCK_RECORD', 3);

    this.m_modelSpaceHandle = this.nextHandle();
    const paperSpaceBR = this.nextHandle();
    const paperSpace0BR = this.nextHandle();

    this.m_dxfLayouts = [];
    this.m_dxfLayouts.push({
      name: 'Model',
      blockName: '*Model_Space',
      blockRecordHandle: this.m_modelSpaceHandle,
      layoutHandle: this.nextHandle(),
      isPaperSpace: false,
    });
    this.m_dxfLayouts.push({
      name: 'Layout1',
      blockName: '*Paper_Space',
      blockRecordHandle: paperSpaceBR,
      layoutHandle: this.nextHandle(),
      isPaperSpace: true,
    });
    this.m_dxfLayouts.push({
      name: 'Layout2',
      blockName: '*Paper_Space0',
      blockRecordHandle: paperSpace0BR,
      layoutHandle: this.nextHandle(),
      isPaperSpace: true,
    });

    this.m_namedObjectDictHandle = this.nextHandle();
    this.m_layoutDictHandle = this.nextHandle();

    for (const l of this.m_dxfLayouts) {
      this.emit(
        `  0\n` +
          `BLOCK_RECORD\n` +
          `  5\n${l.blockRecordHandle}\n` +
          `330\n${blockRecordTableHandle}\n` +
          `100\nAcDbSymbolTableRecord\n` +
          `100\nAcDbBlockTableRecord\n` +
          `  2\n${l.blockName}\n` +
          `340\n${l.layoutHandle}\n` +
          ` 70\n0\n` +
          `280\n1\n` +
          `281\n0\n`,
      );
    }

    this.emit(`  0\n` + `ENDTAB\n` + `  0\n` + `ENDSEC\n`);

    this.emit(`  0\n` + `SECTION\n` + `  2\n` + `BLOCKS\n`);

    for (const l of this.m_dxfLayouts) {
      // The BLOCK and ENDBLK handles are two nextHandle() calls in one C++
      // argument list; allocated left to right here (see the file docblock).
      const blockHandle = this.nextHandle();
      const endblkHandle = this.nextHandle();
      const ps = l.isPaperSpace ? ` 67\n1\n` : '';

      this.emit(
        `  0\n` +
          `BLOCK\n` +
          `  5\n${blockHandle}\n` +
          `330\n${l.blockRecordHandle}\n` +
          `100\nAcDbEntity\n` +
          `${ps}` +
          `  8\n0\n` +
          `100\nAcDbBlockBegin\n` +
          `  2\n${l.blockName}\n` +
          ` 70\n0\n` +
          ` 10\n0.0\n 20\n0.0\n 30\n0.0\n` +
          `  3\n${l.blockName}\n` +
          `  1\n\n` +
          `  0\n` +
          `ENDBLK\n` +
          `  5\n${endblkHandle}\n` +
          `330\n${l.blockRecordHandle}\n` +
          `100\nAcDbEntity\n` +
          `${ps}` +
          `  8\n0\n` +
          `100\nAcDbBlockEnd\n`,
      );
    }

    this.emit(`  0\n` + `ENDSEC\n`);

    this.emit(`  0\n` + `SECTION\n` + `  2\n` + `ENTITIES\n`);

    return true;
  }

  /**
   * `writeObjectsSection`. The LAYOUT field set and its ordering are what the
   * ODA File Converter writes for R2004 and the reader is order-sensitive:
   * group 2 must be present, ModelType (1024) must be off for the paperspace
   * layouts, and 147 must follow 76/77/78. The +/-1e+20 extents are the
   * AcDbLayout "uninitialised" sentinel and are literal text — String(1e20)
   * would spell them out in full and break the sentinel.
   */
  private writeObjectsSection(): void {
    const acadGroupDictHandle = this.nextHandle();

    this.emit(
      `  0\n` +
        `SECTION\n` +
        `  2\n` +
        `OBJECTS\n` +
        `  0\n` +
        `DICTIONARY\n` +
        `  5\n${this.m_namedObjectDictHandle}\n` +
        `330\n0\n` +
        `100\nAcDbDictionary\n` +
        `281\n1\n` +
        `  3\nACAD_GROUP\n` +
        `350\n${acadGroupDictHandle}\n` +
        `  3\nACAD_LAYOUT\n` +
        `350\n${this.m_layoutDictHandle}\n` +
        `  3\nACAD_PLOTSTYLENAME\n` +
        `350\n${this.m_plotStyleNameDictHandle}\n`,
    );

    // ACAD_GROUP - empty, but the named-object root requires it.
    this.emit(
      `  0\n` +
        `DICTIONARY\n` +
        `  5\n${acadGroupDictHandle}\n` +
        `330\n${this.m_namedObjectDictHandle}\n` +
        `100\nAcDbDictionary\n` +
        `281\n1\n`,
    );

    // A dictionary with a default entry; every LAYER's 390 resolves through here.
    this.emit(
      `  0\n` +
        `ACDBDICTIONARYWDFLT\n` +
        `  5\n${this.m_plotStyleNameDictHandle}\n` +
        `330\n${this.m_namedObjectDictHandle}\n` +
        `100\nAcDbDictionary\n` +
        `281\n1\n` +
        `  3\nNormal\n` +
        `350\n${this.m_plotStyleNormalHandle}\n` +
        `100\nAcDbDictionaryWithDefault\n` +
        `340\n${this.m_plotStyleNormalHandle}\n`,
    );

    // No payload; it just gives the "Normal" plot style a resolvable handle.
    this.emit(
      `  0\n` +
        `ACDBPLACEHOLDER\n` +
        `  5\n${this.m_plotStyleNormalHandle}\n` +
        `330\n${this.m_plotStyleNameDictHandle}\n`,
    );

    this.emit(
      `  0\n` +
        `DICTIONARY\n` +
        `  5\n${this.m_layoutDictHandle}\n` +
        `330\n${this.m_namedObjectDictHandle}\n` +
        `100\nAcDbDictionary\n` +
        `281\n1\n`,
    );

    for (const l of this.m_dxfLayouts) this.emit(`  3\n${l.name}\n` + `350\n${l.layoutHandle}\n`);

    for (let i = 0; i < this.m_dxfLayouts.length; ++i) {
      const l = this.m_dxfLayouts[i]!;
      const plotLayoutFlag = l.isPaperSpace ? 0 : PLOT_FLAG_MODELTYPE;

      this.emit(
        `  0\n` +
          `LAYOUT\n` +
          `  5\n${l.layoutHandle}\n` +
          `330\n${this.m_layoutDictHandle}\n` +
          `100\nAcDbPlotSettings\n` +
          `  1\n\n` +
          `  2\nnone_device\n` +
          `  4\n${PAPER_NAME}\n` +
          `  6\n\n` +
          ` 40\n0.0\n 41\n0.0\n 42\n0.0\n 43\n0.0\n` +
          ` 44\n${PAPER_WIDTH_MM.toFixed(1)}\n 45\n${PAPER_HEIGHT_MM.toFixed(1)}\n 46\n0.0\n 47\n0.0\n` +
          ` 48\n0.0\n 49\n0.0\n` +
          `140\n0.0\n141\n0.0\n142\n1.0\n143\n1.0\n` +
          ` 70\n${plotLayoutFlag}\n` +
          ` 72\n1\n 73\n0\n 74\n5\n` +
          `  7\n\n` +
          ` 75\n16\n` +
          ` 76\n0\n 77\n2\n 78\n300\n` +
          `147\n1.0\n` +
          `148\n0.0\n149\n0.0\n` +
          `100\nAcDbLayout\n` +
          `  1\n${l.name}\n` +
          ` 70\n1\n` +
          ` 71\n${i}\n` +
          ` 10\n0.0\n 20\n0.0\n` +
          ` 11\n${PAPER_WIDTH_MM.toFixed(1)}\n 21\n${PAPER_HEIGHT_MM.toFixed(1)}\n` +
          ` 12\n0.0\n 22\n0.0\n 32\n0.0\n` +
          ` 14\n1e+20\n 24\n1e+20\n 34\n1e+20\n` +
          ` 15\n-1e+20\n 25\n-1e+20\n 35\n-1e+20\n` +
          `146\n0.0\n` +
          ` 13\n0.0\n 23\n0.0\n 33\n0.0\n` +
          ` 16\n1.0\n 26\n0.0\n 36\n0.0\n` +
          ` 17\n0.0\n 27\n1.0\n 37\n0.0\n` +
          ` 76\n0\n` +
          `330\n${l.blockRecordHandle}\n`,
      );
    }

    this.emit(`  0\n` + `ENDSEC\n`);
  }

  /** `EndPlot`: close ENTITIES, write OBJECTS, then EOF. The file ends "EOF\n". */
  EndPlot(): boolean {
    this.emit(`  0\n` + `ENDSEC\n`);

    this.writeObjectsSection();

    this.emit(`  0\n` + `EOF\n`);

    return true;
  }

  // =========================================================================
  // Pen
  // =========================================================================

  /** `PLOTTER::MoveTo`. */
  MoveTo(pos: Vec2): void {
    this.PenTo(pos, 'U');
  }

  /** `PLOTTER::LineTo`. */
  LineTo(pos: Vec2): void {
    this.PenTo(pos, 'D');
  }

  /** `PLOTTER::FinishTo`. */
  FinishTo(pos: Vec2): void {
    this.PenTo(pos, 'D');
    this.PenTo(pos, 'Z');
  }

  /** `PLOTTER::PenFinish`. The point is irrelevant to a 'Z' motion. */
  PenFinish(): void {
    this.PenTo({ x: 0, y: 0 }, 'Z');
  }

  /**
   * `PenTo`. Two behaviours matter to callers: 'Z' returns *before* recording
   * the position, so the pen still sits at the last drawn point after a
   * FinishTo and a bare LineTo would draw from there; and a move to the
   * position the pen already holds emits nothing at all, which is what makes
   * the duplicated vertices in upstream's chain walks harmless.
   *
   * Hand-rolled rather than routed through emitEntityHandle because group 6,
   * the linetype, has to sit between group 8 and the AcDbLine marker.
   */
  PenTo(pos: Vec2, plume: 'U' | 'D' | 'Z'): void {
    if (plume === 'Z') return;

    const pos_dev = this.userToDeviceCoordinates(pos);
    const pen_lastpos_dev = this.userToDeviceCoordinates(this.m_penLastpos);

    if ((this.m_penLastpos.x !== pos.x || this.m_penLastpos.y !== pos.y) && plume === 'D') {
      const layer = this.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name);
      const lname = getDXFLineType(this.m_currentLineType);

      this.emit(
        `  0\nLINE\n` +
          `  5\n${this.nextHandle()}\n` +
          `330\n${this.m_modelSpaceHandle}\n` +
          `100\nAcDbEntity\n` +
          `  8\n${layer}\n` +
          `  6\n${lname}\n` +
          `100\nAcDbLine\n` +
          ` 10\n${formatCoord(pen_lastpos_dev.x)}\n 20\n${formatCoord(pen_lastpos_dev.y)}\n 30\n0\n` +
          ` 11\n${formatCoord(pos_dev.x)}\n 21\n${formatCoord(pos_dev.y)}\n 31\n0\n`,
      );
    }

    this.m_penLastpos = pos;
  }

  // =========================================================================
  // Entities
  // =========================================================================

  /**
   * `Rect`. The fill argument is ignored outright — a filled rectangle comes
   * out as an outline — and the walk goes down the left edge first. A
   * degenerate rectangle becomes a POINT.
   */
  Rect(p1: Vec2, p2: Vec2, _fill: FILL_T, _width: number, aCornerRadius = 0): void {
    if (aCornerRadius > 0) {
      // Needs SHAPE_RECT with a corner radius and the thick PlotPoly path.
      throw new Error('DXF Rect with a corner radius is not ported (needs SHAPE_RECT::SetRadius)');
    }

    if (p1.x !== p2.x || p1.y !== p2.y) {
      this.MoveTo(p1);
      this.LineTo({ x: p1.x, y: p2.y });
      this.LineTo({ x: p2.x, y: p2.y });
      this.LineTo({ x: p2.x, y: p1.y });
      this.FinishTo({ x: p1.x, y: p1.y });
    } else {
      // Draw as a point
      const cLayerName = this.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name);

      const point_dev = this.userToDeviceCoordinates(p1);

      this.emitEntityHandle('POINT', 'AcDbPoint', cLayerName);
      // Group 30 is the bare literal "0", not formatCoord(0)'s "0.".
      this.emit(` 10\n${formatCoord(point_dev.x)}\n 20\n${formatCoord(point_dev.y)}\n 30\n0\n`);
    }
  }

  /**
   * `Circle`. `diameter / 2` is C++ integer division, so an odd diameter loses
   * half an IU before it is ever scaled. NO_FILL gives a CIRCLE; FILLED_SHAPE
   * gives the two-vertex bulged POLYLINE trick below; any *other* fill value
   * falls off the end of the if/else-if and emits nothing whatsoever.
   */
  Circle(centre: Vec2, diameter: number, fill: FILL_T, _width: number): void {
    const radius = this.userToDeviceSize(Math.trunc(diameter / 2));
    const centre_dev = this.userToDeviceCoordinates(centre);

    const layer = this.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name);

    if (radius > 0) {
      if (fill === FILL_T.NO_FILL) {
        this.emitEntityHandle('CIRCLE', 'AcDbCircle', layer);
        this.emit(
          ` 10\n${formatCoord(centre_dev.x)}\n 20\n${formatCoord(centre_dev.y)}\n 30\n0\n` +
            ` 40\n${formatCoord(radius)}\n`,
        );
      } else if (fill === FILL_T.FILLED_SHAPE) {
        const r = radius * 0.5;

        // The fill is a closed two-vertex polyline whose *width* is the full
        // radius (groups 40/41) and whose vertices sit at half the radius either
        // side of the centre with bulge 1.0, i.e. two semicircles. 10/20/30 is
        // the elevation dummy point AutoCAD rejects the entity without. Owner of
        // the VERTEX records and the SEQEND is the POLYLINE, not *Model_Space.
        const polyHandle = this.emitEntityHandle('POLYLINE', 'AcDb2dPolyline', layer);
        const rStr = formatCoord(radius);

        this.emit(` 66\n1\n 10\n0\n 20\n0\n 30\n0\n 70\n1\n 40\n${rStr}\n 41\n${rStr}\n`);

        for (const offset of [-r, r]) {
          this.emitEntityHandle('VERTEX', 'AcDbVertex', layer, polyHandle);
          this.emit(
            `100\nAcDb2dVertex\n` +
              ` 10\n${formatCoord(centre_dev.x + offset)}\n 20\n${formatCoord(centre_dev.y)}\n 30\n0\n 42\n1.0\n`,
          );
        }

        this.emitEntityHandle('SEQEND', null, layer, polyHandle);
      }
    } else {
      // Draw as a point
      this.emitEntityHandle('POINT', 'AcDbPoint', layer);
      this.emit(` 10\n${formatCoord(centre_dev.x)}\n 20\n${formatCoord(centre_dev.y)}\n 30\n0\n`);
    }
  }

  /**
   * `PlotPoly( const std::vector<VECTOR2I>& )`. Every caller inside this class
   * passes width -2, so the stroked branch is the only one they reach; the
   * polygon is closed only when a fill was asked for.
   */
  PlotPoly(aCornerList: readonly Vec2[], aFill: FILL_T, aWidth: number, _aData?: unknown): void {
    if (aCornerList.length <= 1) return;

    const last = aCornerList.length - 1;

    // Plot outlines with lines (thickness = 0) to define the polygon
    if (aWidth <= 0 || aFill === FILL_T.NO_FILL) {
      this.MoveTo(aCornerList[0]!);

      for (let ii = 1; ii < aCornerList.length; ii++) this.LineTo(aCornerList[ii]!);

      // Close polygon if 'fill' requested
      if (aFill !== FILL_T.NO_FILL) {
        if (
          aCornerList[last]!.x !== aCornerList[0]!.x ||
          aCornerList[last]!.y !== aCornerList[0]!.y
        )
          this.LineTo(aCornerList[0]!);
      }

      this.PenFinish();
      return;
    }

    // The thick-outline-plus-fill branch unions a TransformOvalToPolygon per
    // segment (excluding the closing one) with the raw polygon; kimath has no
    // TransformOvalToPolygon yet, so it is deliberately unreachable rather than
    // approximated.
    throw new Error(
      'DXF PlotPoly with a thick filled outline is not ported (needs TransformOvalToPolygon)',
    );
  }

  /**
   * `Arc`. The start angle is negated and the sweep subtracted from it, then
   * the pair is swapped if it came out clockwise, because DXF arcs are CCW.
   * Both angles go out in degrees *unnormalised*, so negative values — and the
   * negative zero that a zero start angle produces — appear verbatim.
   *
   * `aCenter` is a VECTOR2D upstream and userToDeviceCoordinates takes a
   * VECTOR2I, so C++ truncates it towards zero on the way in; Math.trunc here
   * reproduces that.
   */
  Arc(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    _aFill: FILL_T,
    _aWidth: number,
  ): void {
    if (aRadius <= 0) return;

    let startAngle = aStartAngle.negate();
    let endAngle = startAngle.sub(aAngle);

    if (endAngle.lt(startAngle)) [startAngle, endAngle] = [endAngle, startAngle];

    const centre_device = this.userToDeviceCoordinates({
      x: Math.trunc(aCenter.x),
      y: Math.trunc(aCenter.y),
    });
    const radius_device = this.userToDeviceSize(aRadius);

    // Two subclass markers, AcDbCircle then AcDbArc; reversing them trips
    // AutoCAD's validator.
    const layer = this.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name);

    this.emitEntityHandle('ARC', 'AcDbCircle', layer);
    this.emit(
      ` 10\n${formatCoord(centre_device.x)}\n 20\n${formatCoord(centre_device.y)}\n 30\n0\n` +
        ` 40\n${formatCoord(radius_device)}\n` +
        `100\nAcDbArc\n` +
        ` 50\n${formatAngle(startAngle.AsDegrees())}\n 51\n${formatAngle(endAngle.AsDegrees())}\n`,
    );
  }

  // =========================================================================
  // Thick primitives
  // =========================================================================

  /**
   * `ThickSegment`. In FILLED mode a zero-length segment emits nothing at all:
   * the base class would draw a filled circle there, but DXF overrides the
   * whole method and PenTo drops the equal-position move.
   */
  ThickSegment(aStart: Vec2, aEnd: Vec2, _aWidth: number, aData?: DxfPlotParams): void {
    if (aData && aData.GetDXFPlotMode() === DXF_OUTLINE_MODE.SKETCH) {
      throw new Error(
        'DXF ThickSegment in SKETCH mode is not ported (needs TransformOvalToPolygon)',
      );
    } else {
      this.MoveTo(aStart);
      this.FinishTo(aEnd);
    }
  }

  /** `ThickArc`. `aWidth / 2` is integer division, hence the Math.trunc. */
  ThickArc(
    centre: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aWidth: number,
    aData?: DxfPlotParams,
  ): void {
    if (aData && aData.GetDXFPlotMode() === DXF_OUTLINE_MODE.SKETCH) {
      const half = Math.trunc(aWidth / 2);
      this.Arc(centre, aStartAngle, aAngle, aRadius - half, FILL_T.NO_FILL, DXF_LINE_WIDTH);
      this.Arc(centre, aStartAngle, aAngle, aRadius + half, FILL_T.NO_FILL, DXF_LINE_WIDTH);
    } else {
      this.Arc(centre, aStartAngle, aAngle, aRadius, FILL_T.NO_FILL, DXF_LINE_WIDTH);
    }
  }

  /**
   * `ThickRect`. The inner rectangle is produced by mutating the *already
   * offset* corners by the full width, so for an odd width the two rectangles
   * are not concentric: width 5 gives an outer edge at p1 - 2 and an inner one
   * at p1 + 3. Computing p1 + width/2 instead would diverge.
   */
  ThickRect(p1: Vec2, p2: Vec2, width: number, aData?: DxfPlotParams): void {
    if (aData && aData.GetDXFPlotMode() === DXF_OUTLINE_MODE.SKETCH) {
      const half = Math.trunc(width / 2);
      const offsetp1 = { x: p1.x - half, y: p1.y - half };
      const offsetp2 = { x: p2.x + half, y: p2.y + half };
      this.Rect(offsetp1, offsetp2, FILL_T.NO_FILL, DXF_LINE_WIDTH, 0);

      offsetp1.x += width;
      offsetp1.y += width;
      offsetp2.x -= width;
      offsetp2.y -= width;
      this.Rect(offsetp1, offsetp2, FILL_T.NO_FILL, DXF_LINE_WIDTH, 0);
    } else {
      this.Rect(p1, p2, FILL_T.NO_FILL, DXF_LINE_WIDTH, 0);
    }
  }

  /** `ThickCircle`. */
  ThickCircle(pos: Vec2, diametre: number, width: number, aData?: DxfPlotParams): void {
    if (aData && aData.GetDXFPlotMode() === DXF_OUTLINE_MODE.SKETCH) {
      this.Circle(pos, diametre - width, FILL_T.NO_FILL, DXF_LINE_WIDTH);
      this.Circle(pos, diametre + width, FILL_T.NO_FILL, DXF_LINE_WIDTH);
    } else {
      this.Circle(pos, diametre, FILL_T.NO_FILL, DXF_LINE_WIDTH);
    }
  }

  /** `FilledCircle`, the only internal caller that reaches the POLYLINE fill. */
  FilledCircle(pos: Vec2, diametre: number, aData?: DxfPlotParams): void {
    if (aData && aData.GetDXFPlotMode() === DXF_OUTLINE_MODE.SKETCH)
      this.Circle(pos, diametre, FILL_T.NO_FILL, DXF_LINE_WIDTH);
    else this.Circle(pos, diametre, FILL_T.FILLED_SHAPE, 0);
  }

  /**
   * `PLOTTER::ThickOval`, inherited unchanged. Both the radius and the
   * half-height are integer divisions. FlashPadOval has already normalised the
   * size, so this method's own swap is then a no-op — but it is upstream's and
   * ThickOval has other callers, so it stays.
   */
  ThickOval(aPos: Vec2, aSize: Vec2, aOrient: EDA_ANGLE, aWidth: number, aData?: unknown): void {
    this.SetCurrentLineWidth(aWidth, aData);

    let orient = aOrient;
    const size = { x: aSize.x, y: aSize.y };

    if (size.x > size.y) {
      [size.x, size.y] = [size.y, size.x];
      orient = orient.add(ANGLE_90);
    }

    const deltaxy = size.y - size.x; // distance between centres of the oval
    const radius = Math.trunc(size.x / 2);

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

  // =========================================================================
  // Pad flashes - DXF draws every pad in sketch mode
  // =========================================================================

  /** `FlashPadCircle`. */
  FlashPadCircle(pos: Vec2, diametre: number, _aData?: unknown): void {
    this.Circle(pos, diametre, FILL_T.NO_FILL, DXF_LINE_WIDTH);
  }

  /** `FlashPadOval`: normalise to a vertical tablet, then hand to ThickOval. */
  FlashPadOval(aPos: Vec2, aSize: Vec2, aOrient: EDA_ANGLE, aData?: unknown): void {
    const size = { x: aSize.x, y: aSize.y };
    let orient = aOrient;

    /* The chip is reduced to an oval tablet with size.y > size.x
     * (Oval vertical orientation 0) */
    if (size.x > size.y) {
      [size.x, size.y] = [size.y, size.x];
      orient = orient.add(ANGLE_90);
    }

    this.ThickOval(aPos, size, orient, DXF_LINE_WIDTH, aData);
  }

  /**
   * `FlashPadRect`. Half sizes are integer divisions clamped at zero, and a
   * pad that is zero-wide or zero-high degenerates to a single stroke.
   */
  FlashPadRect(aPos: Vec2, aPadSize: Vec2, aOrient: EDA_ANGLE, _aData?: unknown): void {
    const size = { x: Math.trunc(aPadSize.x / 2), y: Math.trunc(aPadSize.y / 2) };

    if (size.x < 0) size.x = 0;

    if (size.y < 0) size.y = 0;

    // If a dimension is zero, the trace is reduced to 1 line
    if (size.x === 0) {
      const start = RotatePoint({ x: aPos.x, y: aPos.y - size.y }, aPos, aOrient);
      const end = RotatePoint({ x: aPos.x, y: aPos.y + size.y }, aPos, aOrient);
      this.MoveTo(start);
      this.FinishTo(end);
      return;
    }

    if (size.y === 0) {
      const start = RotatePoint({ x: aPos.x - size.x, y: aPos.y }, aPos, aOrient);
      const end = RotatePoint({ x: aPos.x + size.x, y: aPos.y }, aPos, aOrient);
      this.MoveTo(start);
      this.FinishTo(end);
      return;
    }

    const start = RotatePoint({ x: aPos.x - size.x, y: aPos.y - size.y }, aPos, aOrient);
    this.MoveTo(start);

    this.LineTo(RotatePoint({ x: aPos.x - size.x, y: aPos.y + size.y }, aPos, aOrient));
    this.LineTo(RotatePoint({ x: aPos.x + size.x, y: aPos.y + size.y }, aPos, aOrient));
    this.LineTo(RotatePoint({ x: aPos.x + size.x, y: aPos.y - size.y }, aPos, aOrient));

    this.FinishTo(start);
  }

  /**
   * `FlashPadCustom`. Position, size and orientation are all ignored: the
   * polygons arrive already placed. Holes are plotted too, one outline at a
   * time, because upstream walks Outline(cnt) for every outline index.
   */
  FlashPadCustom(
    _aPadPos: Vec2,
    _aSize: Vec2,
    _aOrient: EDA_ANGLE,
    aPolygons: readonly (readonly Vec2[][])[],
    _aData?: unknown,
  ): void {
    for (let cnt = 0; cnt < aPolygons.length; ++cnt) {
      const poly = aPolygons[cnt]![0]!;

      this.MoveTo(poly[0]!);

      for (let ii = 1; ii < poly.length; ++ii) this.LineTo(poly[ii]!);

      this.FinishTo(poly[0]!);
    }
  }

  /** `FlashPadTrapez`. The corners rotate about the ORIGIN, then translate. */
  FlashPadTrapez(
    aPadPos: Vec2,
    aCorners: readonly Vec2[],
    aPadOrient: EDA_ANGLE,
    _aData?: unknown,
  ): void {
    const coord: Vec2[] = [];

    for (let ii = 0; ii < 4; ii++) {
      const rotated = RotatePoint(aCorners[ii]!, aPadOrient);
      coord.push({ x: rotated.x + aPadPos.x, y: rotated.y + aPadPos.y });
    }

    // Plot edge:
    this.MoveTo(coord[0]!);
    this.LineTo(coord[1]!);
    this.LineTo(coord[2]!);
    this.LineTo(coord[3]!);
    this.FinishTo(coord[0]!);
  }

  /** `FlashRegularPolygon`: upstream is a wxASSERT(0) and does nothing. */
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
  // Text
  // =========================================================================

  /**
   * `PlotText`, the entry point pcbnew uses for every string it plots.
   *
   * The guard below is why a plain plot never contains a TEXT entity: the
   * constructor leaves m_textAsLines true, so unless the caller has asked for
   * PLOT_TEXT_MODE::NATIVE the text is stroked into LINE entities instead.
   */
  PlotText(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aAttributes: DxfTextAttributes,
    _aFont?: unknown,
    _aFontMetrics?: unknown,
    _aData?: unknown,
  ): void {
    const attrs: DxfTextAttributes = { ...aAttributes };

    // Fix me: see how to use DXF text mode for multiline texts
    if (attrs.m_Multiline && !aText.includes('\n')) attrs.m_Multiline = false;

    const processSuperSub = aText.includes('^{') || aText.includes('_{');

    if (
      this.m_textAsLines ||
      containsNonAsciiChars(aText) ||
      attrs.m_Multiline ||
      processSuperSub
    ) {
      // Upstream falls back to PLOTTER::PlotText, which strokes the glyphs
      // through KIFONT::FONT::Draw into MoveTo/LineTo pairs. That needs a font
      // engine this repo does not have yet, so refuse loudly rather than emit a
      // file with the text silently missing.
      throw new Error('DXF stroked-text fallback is not ported (needs KIFONT::FONT::Draw)');
    } else {
      this.plotOneLineOfText(aPos, aColor, aText, attrs);
    }
  }

  /**
   * `plotOneLineOfText`. Emit text as a TEXT entity: this loses formatting and
   * shape but is far more useful as a CAD object.
   *
   * SetColor runs before the layer name is resolved, and that order is load
   * bearing: with an empty export list the layer name is derived from the
   * colour this call just stored.
   *
   * Group 73 must follow a *second* AcDbText marker, and the vertical alignment
   * codes are TOP 3 / CENTER 2 / BOTTOM 1 — neither zero-based nor in the same
   * direction as the horizontal 0/1/2.
   */
  private plotOneLineOfText(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aAttributes: DxfTextAttributes,
  ): void {
    const origin_dev = this.userToDeviceCoordinates(aPos);
    this.SetColor(aColor);
    const cLayerName = this.GetCurrentLayerName(DXF_LAYER_OUTPUT_MODE.Current_Layer_Name);

    const size_dev = this.userToDeviceSizeV(aAttributes.m_Size);
    let h_code = 0;
    let v_code = 0;

    switch (aAttributes.m_Halign) {
      case GR_TEXT_H_ALIGN_T.LEFT:
        h_code = 0;
        break;
      case GR_TEXT_H_ALIGN_T.CENTER:
        h_code = 1;
        break;
      case GR_TEXT_H_ALIGN_T.RIGHT:
        h_code = 2;
        break;
    }

    switch (aAttributes.m_Valign) {
      case GR_TEXT_V_ALIGN_T.TOP:
        v_code = 3;
        break;
      case GR_TEXT_V_ALIGN_T.CENTER:
        v_code = 2;
        break;
      case GR_TEXT_V_ALIGN_T.BOTTOM:
        v_code = 1;
        break;
    }

    let textStyle = 'KICAD';

    if (aAttributes.m_Bold) {
      if (aAttributes.m_Italic) textStyle = 'KICADBI';
      else textStyle = 'KICADB';
    } else if (aAttributes.m_Italic) {
      textStyle = 'KICADI';
    }

    this.emitEntityHandle('TEXT', 'AcDbText', cLayerName);

    this.emit(
      ` 10\n${formatCoord(origin_dev.x)}\n 20\n${formatCoord(origin_dev.y)}\n 30\n0\n` +
        ` 40\n${formatCoord(size_dev.y)}\n`,
    );

    this.emit(`  1\n`);

    escapeDxfText(
      aText,
      (byte) => this.putLatin1(byte),
      (s) => this.emit(s),
    );

    this.emit(`\n`);

    this.emit(
      ` 50\n${formatAngle(aAttributes.m_Angle.AsDegrees())}\n` +
        ` 41\n${formatCoord(Math.abs(size_dev.x / size_dev.y))}\n` +
        ` 51\n${formatAngle(aAttributes.m_Italic ? DXF_OBLIQUE_ANGLE : 0)}\n` +
        `  7\n${textStyle}\n` +
        ` 71\n${aAttributes.m_Mirrored ? 2 : 0}\n` +
        ` 72\n${h_code}\n` +
        ` 11\n${formatCoord(origin_dev.x)}\n 21\n${formatCoord(origin_dev.y)}\n 31\n0\n` +
        `100\nAcDbText\n` +
        ` 73\n${v_code}\n`,
    );
  }
}

/**
 * `containsNonAsciiChars`. Despite the name the cut is at 255, not 127, so
 * Latin-1 counts as ASCII here and only genuinely wide characters push the
 * caller onto the stroked path.
 */
export function containsNonAsciiChars(aString: string): boolean {
  for (let i = 0; i < aString.length; i++) {
    if (aString.charCodeAt(i) > 255) return true;
  }
  return false;
}

/**
 * The group-1 string escaper inside plotOneLineOfText, split out so it can be
 * tested on its own.
 *
 * Encoding: DXF's is unspecified enough that upstream settles on Latin-1 and
 * writes each character as one raw byte; anything above 255 becomes '?'. That
 * is why this takes a byte sink rather than returning a string.
 *
 * Overbars: only the '~{' pair and the '}' that closes it are consumed. A '{'
 * that is not part of '~{', and a '}' that closes something else, are written
 * out as themselves.
 *
 * Records longer than 255 bytes should be split across group-3 chunks. Upstream
 * says so in a comment and then does not do it, so neither does this.
 */
export function escapeDxfText(
  aText: string,
  put: (aByte: number) => void,
  emit: (aText: string) => void,
): void {
  let braceNesting = 0;
  let overbarDepth = -1;

  for (let i = 0; i < aText.length; i++) {
    const ch = aText.charCodeAt(i);

    if (ch > 255) {
      // I can't encode this...
      put('?'.charCodeAt(0));
    } else {
      if (aText[i] === '~' && i + 1 < aText.length && aText[i + 1] === '{') {
        emit('%%o');
        overbarDepth = braceNesting;

        // Skip the '{'
        i++;
        continue;
      } else if (aText[i] === '{') {
        braceNesting++;
      } else if (aText[i] === '}') {
        if (braceNesting > 0) braceNesting--;

        if (braceNesting === overbarDepth) {
          emit('%%O');
          overbarDepth = -1;
          continue;
        }
      }

      put(ch);
    }
  }
}
