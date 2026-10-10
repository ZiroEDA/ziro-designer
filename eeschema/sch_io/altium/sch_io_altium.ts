// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/altium/sch_io_altium.cpp` / `.h`: `SCH_IO_ALTIUM`, the Altium schematic
 * importer (`.SchDoc`, binary compound file or ASCII) and the Altium symbol library reader
 * (`.SchLib`, `.IntLib`).
 *
 * Every `std::map` the C++ walks is walked here in its key order: numeric for the record
 * indices, code point for names. `m_errorMessages` is an `unordered_map` upstream, so its
 * reporting order is unspecified there; ours reports in insertion order.
 *
 * A sub-sheet's file is found beside its parent through `m_readFile`; the case-insensitive
 * search `ResolveSheetFileName` falls back to needs the folder listed (`SetDirLister`).
 *
 * Not ported: `FONTCONFIG_REPORTER_SCOPE` (font substitution warnings).
 */
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { ALTIUM_ASCII_PARSER } from '@ziroeda/common/io/altium/altium_ascii_parser.js';
import {
  ALTIUM_BINARY_PARSER,
  ALTIUM_BINARY_READER,
  ALTIUM_COMPOUND_FILE,
  ALTIUM_COMPRESSED_READER,
} from '@ziroeda/common/io/altium/altium_binary_parser.js';
import {
  AltiumPinDesignatorToKiCad,
  AltiumPinNamesToKiCad,
  AltiumSchSpecialStringsToKiCadVariables,
  AltiumToKiCadLibID,
} from '@ziroeda/common/io/altium/altium_parser_utils.js';
import { ParseAltiumProjectVariants } from '@ziroeda/common/io/altium/altium_project_variants.js';
import { ALTIUM_PROPS_UTILS } from '@ziroeda/common/io/altium/altium_props_utils.js';
import { CFBException } from '@ziroeda/common/io/altium/compoundfilereader.js';
import {
  COMPOUND_FILE_HEADER,
  fileHasBinaryHeader,
  fileStartsWithPrefix,
} from '@ziroeda/common/io/io_utils.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import {
  type Color4d,
  COLOR4D_UNSPECIFIED,
  LEGACY_COLORS,
  withAlpha,
} from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import {
  RPT_SEVERITY_DEBUG,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import {
  KiCadSchematicFileExtension,
  KiCadSymbolLibFileExtension,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { inflateZlib } from '@ziroeda/common/wx/inflate.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_LOW_DEF_MM } from '@ziroeda/kimath/src/base_units.js';
import { BezierPoly, TransformEllipseToBeziers } from '@ziroeda/kimath/src/bezier_curves.js';
import {
  ANGLE_0,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
  EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ELLIPSE } from '@ziroeda/kimath/src/geometry/ellipse.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BUS_ALIAS } from '../../bus_alias.js';
import {
  DEFAULT_PINNAME_SIZE,
  DEFAULT_PINNUM_SIZE,
  DEFAULT_TEXT_SIZE,
} from '../../default_values.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SymbolLibAdapter } from '../../project_sch.js';
import { SCH_BITMAP } from '../../sch_bitmap.js';
import { SCH_BUS_WIRE_ENTRY } from '../../sch_bus_entry.js';
import { SCH_CONNECTION } from '../../sch_connection.js';
import { SCH_FIELD } from '../../sch_field.js';
import { AUTOPLACE_ALGO, type SCH_ITEM } from '../../sch_item.js';
import { SCH_JUNCTION } from '../../sch_junction.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
  type SCH_LABEL_BASE,
  SPIN_STYLE,
} from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import { SCH_NO_CONNECT } from '../../sch_no_connect.js';
import { SCH_PIN } from '../../sch_pin.js';
import { SCH_SCREEN, SCH_SCREENS } from '../../sch_screen.js';
import { SCH_SHAPE } from '../../sch_shape.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SHEET_INSTANCE, SCH_SHEET_PATH, SCH_SYMBOL_VARIANT } from '../../sch_sheet_path.js';
import { SCH_SHEET_PIN, SHEET_SIDE } from '../../sch_sheet_pin.js';
import { SCH_SYMBOL } from '../../sch_symbol.js';
import { SCH_TEXT } from '../../sch_text.js';
import { SCH_TEXTBOX } from '../../sch_textbox.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SYMBOL_ORIENTATION_T } from '../../symbol.js';
import { SYMBOL_LIBRARY_ADAPTER } from '../../libraries/symbol_library_adapter.js';
import { SCH_IO, type SCH_IO_PROPERTIES } from '../sch_io.js';
import {
  ALTIUM_COMPONENT_NONE,
  type ALTIUM_PROPS,
  ALTIUM_SCH_RECORD,
  ASCH_ADDITIONAL_FILE,
  ASCH_ARC,
  type ASCH_BORDER,
  ASCH_BEZIER,
  ASCH_BUS,
  ASCH_BUS_ENTRY,
  ASCH_DESIGNATOR,
  ASCH_ELLIPSE,
  type ASCH_FILL,
  ASCH_FILE_NAME,
  ASCH_HARNESS_CONNECTOR,
  ASCH_HARNESS_ENTRY,
  ASCH_HARNESS_TYPE,
  ASCH_IMAGE,
  ASCH_IMPLEMENTATION,
  ASCH_IMPLEMENTATION_LIST,
  ASCH_JUNCTION,
  ASCH_LABEL,
  ASCH_LABEL_JUSTIFICATION,
  ASCH_LINE,
  ASCH_NET_LABEL,
  ASCH_NO_ERC,
  ASCH_NOTE,
  type ASCH_OWNER_INTERFACE,
  ASCH_PARAMETER,
  ASCH_PIECHART,
  ASCH_PIN,
  ASCH_PIN_ELECTRICAL,
  ASCH_PIN_SYMBOL,
  ASCH_POLYGON,
  ASCH_POLYLINE,
  ASCH_POLYLINE_LINESTYLE,
  ASCH_PORT,
  ASCH_PORT_IOTYPE,
  ASCH_PORT_STYLE,
  ASCH_POWER_PORT,
  ASCH_POWER_PORT_STYLE,
  ASCH_RECORD_ORIENTATION,
  ASCH_RECTANGLE,
  ASCH_ROUND_RECTANGLE,
  ASCH_SHEET,
  ASCH_SHEET_ENTRY,
  ASCH_SHEET_ENTRY_SIDE,
  ASCH_SHEET_NAME,
  ASCH_SHEET_SIZE,
  ASCH_SHEET_SYMBOL,
  ASCH_SHEET_WORKSPACEORIENTATION,
  ASCH_SIGNAL_HARNESS,
  ASCH_STORAGE_FILE,
  ASCH_SYMBOL,
  ASCH_TEMPLATE,
  ASCH_TEXT_FRAME,
  ASCH_TEXT_FRAME_ALIGNMENT,
  ASCH_WIRE,
} from './altium_parser_sch.js';

/** A record's properties as the property helpers take them. */
type PROPS = Map<string, string>;

// Harness port object itself does not contain color information about itself
// It seems altium is drawing harness ports using these colors
const HARNESS_PORT_COLOR_DEFAULT_BACKGROUND: Color4d = {
  r: 0.92941176470588238,
  g: 0.94901960784313721,
  b: 0.98431372549019602,
  a: 1.0,
};

const HARNESS_PORT_COLOR_DEFAULT_OUTLINE: Color4d = {
  r: 0.5607843137254902,
  g: 0.61960784313725492,
  b: 0.78823529411764703,
  a: 1.0,
};

void HARNESS_PORT_COLOR_DEFAULT_BACKGROUND;
void HARNESS_PORT_COLOR_DEFAULT_OUTLINE;

const add = (a: Vec2, b: Vec2): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });

/** `wxString` (UTF-32) ordering, `std::map<wxString, …>`'s. */
function codePointCompare(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i]!.codePointAt(0)!;
    const y = cb[i]!.codePointAt(0)!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return ca.length - cb.length;
}

/** `std::map<int, T>` walked in key order. */
function byIntKey<T>(aMap: ReadonlyMap<number, T>): [number, T][] {
  return [...aMap].sort((a, b) => a[0] - b[0]);
}

/** `std::map<wxString, T>` walked in key order. */
function byStringKey<T>(aMap: ReadonlyMap<string, T>): [string, T][] {
  return [...aMap].sort((a, b) => codePointCompare(a[0], b[0]));
}

/** `wxString::Trim()` both ends (isspace). */
const isBlank = (s: string): boolean => s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '') === '';

/** `wxFileName` pieces of a path, either separator. */
function fileNameParts(aPath: string): { path: string; name: string; ext: string } {
  const slash = Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\'));
  const path = slash < 0 ? '' : aPath.substring(0, slash);
  const base = aPath.substring(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0
    ? { path, name: base, ext: '' }
    : { path, name: base.substring(0, dot), ext: base.substring(dot + 1) };
}

/** `wxFileName( aPath, wxPATH_WIN ).GetName()`: the name of a Windows path. */
const winPathName = (aPath: string): string => fileNameParts(aPath.replaceAll('\\', '/')).name;

const joinPath = (aDir: string, aFullName: string): string =>
  aDir === '' ? aFullName : `${aDir.replace(/\/+$/, '')}/${aFullName}`;

/** `wxFileName( path ).SetExt( ext ).GetFullPath()`. */
function withExt(aPath: string, aExt: string): string {
  const f = fileNameParts(aPath);
  return joinPath(f.path, aExt === '' ? f.name : `${f.name}.${aExt}`);
}

/** `wxFileName::MakeRelativeTo` for the progress text only; the name is enough. */
const baseName = (aPath: string): string => aPath.substring(aPath.lastIndexOf('/') + 1);

export interface HARNESS_PORT {
  m_location: VECTOR2I;
  m_entryLocation: VECTOR2I;
  m_harnessConnectorSide: ASCH_SHEET_ENTRY_SIDE;
  m_primaryConnectionPosition: number;
  m_name: string;
}

export interface HARNESS {
  m_name: string;
  m_location: VECTOR2I;
  m_size: VECTOR2I;
  m_ports: HARNESS_PORT[];
  m_entry: HARNESS_PORT;
}

const newHarnessPort = (): HARNESS_PORT => ({
  m_location: { x: 0, y: 0 },
  m_entryLocation: { x: 0, y: 0 },
  m_harnessConnectorSide: ASCH_SHEET_ENTRY_SIDE.LEFT,
  m_primaryConnectionPosition: 0,
  m_name: '',
});

function GetRelativePosition(aPosition: VECTOR2I, aSymbol: SCH_SYMBOL): VECTOR2I {
  const t = aSymbol.GetTransform().InverseTransform();
  return t.TransformCoordinate(sub(aPosition, aSymbol.GetPosition()));
}

function GetColorFromInt(color: number): Color4d {
  const red = color & 0x0000ff;
  const green = (color & 0x00ff00) >> 8;
  const blue = (color & 0xff0000) >> 16;

  // `COLOR4D().FromCSSRGBA( red, green, blue, 1.0 )`
  const c = (v: number): number => Math.min(255, Math.max(0, v)) / 255.0;
  return { r: c(red), g: c(green), b: c(blue), a: 1.0 };
}

const colorEq = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

function GetPlotDashType(linestyle: ASCH_POLYLINE_LINESTYLE): LINE_STYLE {
  switch (linestyle) {
    case ASCH_POLYLINE_LINESTYLE.SOLID:
      return LINE_STYLE.SOLID;
    case ASCH_POLYLINE_LINESTYLE.DASHED:
      return LINE_STYLE.DASH;
    case ASCH_POLYLINE_LINESTYLE.DOTTED:
      return LINE_STYLE.DOT;
    case ASCH_POLYLINE_LINESTYLE.DASH_DOTTED:
      return LINE_STYLE.DASHDOT;
    default:
      return LINE_STYLE.DEFAULT;
  }
}

function SetSchShapeLine(elem: ASCH_BORDER, shape: SCH_SHAPE): void {
  shape.SetStroke(new STROKE_PARAMS(elem.LineWidth, LINE_STYLE.SOLID, GetColorFromInt(elem.Color)));
}

function SetSchShapeFillAndColor(elem: ASCH_FILL, shape: SCH_SHAPE): void {
  if (!elem.IsSolid) {
    shape.SetFillMode(FILL_T.NO_FILL);
  } else {
    shape.SetFillMode(FILL_T.FILLED_WITH_COLOR);
    shape.SetFillColor(GetColorFromInt(elem.AreaColor));
  }

  // Fixup small circles that had their widths set to 0
  if (
    shape.GetShape() === SHAPE_T.CIRCLE &&
    shape.GetStroke().GetWidth() === 0 &&
    shape.GetRadius() <= schIUScale.milsToIU(10)
  ) {
    shape.SetFillMode(FILL_T.FILLED_SHAPE);
  }
}

function SetLibShapeLine(elem: ASCH_BORDER, shape: SCH_SHAPE, aType: ALTIUM_SCH_RECORD): void {
  let default_color: Color4d;
  // PUREBLUE is used for many objects, so if it is used, we will assume that it should
  // blend with the others
  const alt_default_color = LEGACY_COLORS.PUREBLUE;
  const stroke = new STROKE_PARAMS();
  stroke.SetColor(GetColorFromInt(elem.Color));
  stroke.SetLineStyle(LINE_STYLE.SOLID);

  switch (aType) {
    case ALTIUM_SCH_RECORD.BEZIER:
      default_color = LEGACY_COLORS.PURERED;
      break;
    case ALTIUM_SCH_RECORD.POLYLINE:
      default_color = LEGACY_COLORS.BLACK;
      break;
    case ALTIUM_SCH_RECORD.RECTANGLE:
      default_color = { r: 0.5, g: 0, b: 0, a: 1.0 };
      break;
    default:
      // ARC, ELLIPSE, ELLIPTICAL_ARC, LINE, POLYGON, ROUND_RECTANGLE and the rest
      default_color = LEGACY_COLORS.PUREBLUE;
      break;
  }

  if (colorEq(stroke.GetColor(), default_color) || colorEq(stroke.GetColor(), alt_default_color))
    stroke.SetColor(COLOR4D_UNSPECIFIED);

  // In Altium libraries, you cannot change the width of the pins.  So, to match pin width,
  // if the line width of other elements is the default pin width (10 mil), we set the width
  // to the KiCad default pin width ( represented by 0 )
  if (elem.LineWidth === 2540) stroke.SetWidth(0);
  else stroke.SetWidth(elem.LineWidth);

  shape.SetStroke(stroke);
}

function SetLibShapeFillAndColor(
  elem: ASCH_FILL,
  shape: SCH_SHAPE,
  aType: ALTIUM_SCH_RECORD,
  aStrokeColor: number,
): void {
  let bgcolor = GetColorFromInt(elem.AreaColor);
  let default_bgcolor: Color4d;

  switch (aType) {
    case ALTIUM_SCH_RECORD.RECTANGLE:
      default_bgcolor = GetColorFromInt(11599871); // Light Yellow
      break;
    default:
      default_bgcolor = GetColorFromInt(12632256); // Grey
      break;
  }

  if (elem.IsTransparent) bgcolor = withAlpha(bgcolor, 0.5);

  if (!elem.IsSolid) {
    shape.SetFillMode(FILL_T.NO_FILL);
  } else if (elem.AreaColor === aStrokeColor) {
    bgcolor = shape.GetStroke().GetColor();

    shape.SetFillMode(FILL_T.FILLED_SHAPE);
  } else if (colorEq(withAlpha(bgcolor, 1.0), default_bgcolor)) {
    shape.SetFillMode(FILL_T.FILLED_WITH_BG_BODYCOLOR);
  } else {
    shape.SetFillMode(FILL_T.FILLED_WITH_COLOR);
  }

  shape.SetFillColor(bgcolor);

  if (elem.AreaColor === aStrokeColor && shape.GetStroke().GetWidth() === schIUScale.milsToIU(1)) {
    const stroke = shape.GetStroke();
    stroke.SetWidth(-1);
    shape.SetStroke(stroke);
  }

  // Fixup small circles that had their widths set to 0
  if (
    shape.GetShape() === SHAPE_T.CIRCLE &&
    shape.GetStroke().GetWidth() === 0 &&
    shape.GetRadius() <= schIUScale.milsToIU(10)
  ) {
    shape.SetFillMode(FILL_T.FILLED_SHAPE);
  }
}

/**
 * Altium marks bus membership by geometry alone (a scalar label placed on a bus line);
 * KiCad needs the same label expressed as a single-member bus group to make the
 * connection.  Already-formatted bus labels are left untouched.
 */
export function AltiumWrapBusLabel(aText: string): string {
  if (SCH_CONNECTION.IsBusLabel(aText)) return aText;

  // Spaces and commas separate members inside a bus group, so a multi-word net name would
  // otherwise fan out into several members.  Quote such names so the bus-group reader in
  // NET_SETTINGS::ParseBusGroup keeps the whole name as a single member.
  if (aText.includes(' ') || aText.includes(',')) return `{"${aText}"}`;

  return `{${aText}}`;
}

export function AltiumDeriveSheetName(
  aFilename: string,
  aExistingNames: ReadonlySet<string>,
): string {
  let name = fileNameParts(aFilename).name;
  name = name.replaceAll('/', '_');

  if (isBlank(name)) name = 'Sheet';
  // `baseName.Trim()` trims in place (from the right)
  else name = name.replace(/[ \t\n\v\f\r]+$/, '');

  let sheetName = name;

  for (let ii = 1; aExistingNames.has(sheetName); ++ii) sheetName = `${name}_${ii}`;

  return sheetName;
}

function SetTextPositioning(
  text: SCH_TEXT | SCH_FIELD,
  justification: ASCH_LABEL_JUSTIFICATION,
  orientation: ASCH_RECORD_ORIENTATION,
): void {
  let vjustify: number;
  let hjustify: number;
  let angle = ANGLE_HORIZONTAL;
  const J = ASCH_LABEL_JUSTIFICATION;

  switch (justification) {
    case J.CENTER_LEFT:
    case J.CENTER_CENTER:
    case J.CENTER_RIGHT:
      vjustify = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
      break;

    case J.TOP_LEFT:
    case J.TOP_CENTER:
    case J.TOP_RIGHT:
      vjustify = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
      break;

    default:
      vjustify = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;
      break;
  }

  switch (justification) {
    case J.BOTTOM_CENTER:
    case J.CENTER_CENTER:
    case J.TOP_CENTER:
      hjustify = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
      break;

    case J.BOTTOM_RIGHT:
    case J.CENTER_RIGHT:
    case J.TOP_RIGHT:
      hjustify = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
      break;

    default:
      hjustify = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
      break;
  }

  switch (orientation) {
    case ASCH_RECORD_ORIENTATION.RIGHTWARDS:
      angle = ANGLE_HORIZONTAL;
      break;

    case ASCH_RECORD_ORIENTATION.LEFTWARDS:
      hjustify *= -1;
      angle = ANGLE_HORIZONTAL;
      break;

    case ASCH_RECORD_ORIENTATION.UPWARDS:
      angle = ANGLE_VERTICAL;
      break;

    case ASCH_RECORD_ORIENTATION.DOWNWARDS:
      hjustify *= -1;
      angle = ANGLE_VERTICAL;
      break;
  }

  text.SetVertJustify(vjustify as GR_TEXT_V_ALIGN_T);
  text.SetHorizJustify(hjustify as GR_TEXT_H_ALIGN_T);
  text.SetTextAngle(angle);
}

/**
 * Altium text orientation and justification are in absolute (page) coordinates. KiCad stores
 * field text properties relative to the parent symbol and applies the symbol's transform at
 * render time. This adjusts the field's stored text angle and justification to compensate for
 * the symbol's orientation so that the final rendered appearance matches the original Altium
 * layout.
 */
function AdjustFieldForSymbolOrientation(aField: SCH_FIELD, aSymbol: ASCH_SYMBOL): void {
  const isHorizontal = aField.GetTextAngle().IsHorizontal();
  const flipH = () => aField.SetHorizJustify(-aField.GetHorizJustify() as GR_TEXT_H_ALIGN_T);

  if (aSymbol.orientation === 1) {
    // UPWARDS -> SYM_ORIENT_90 (CCW): compensate with CW 90; CW rotation of horizontal text
    // flips justification, of vertical text does not.
    if (isHorizontal) flipH();

    aField.SetTextAngle(isHorizontal ? ANGLE_VERTICAL : ANGLE_HORIZONTAL);
  } else if (aSymbol.orientation === 2) {
    // LEFTWARDS -> SYM_ORIENT_180: one correction for the full 180 degrees.
    flipH();
  } else if (aSymbol.orientation === 3) {
    // DOWNWARDS -> SYM_ORIENT_270 (CW): compensate with CCW 90; CCW rotation of vertical text
    // flips justification, of horizontal text does not.
    if (!isHorizontal) flipH();

    aField.SetTextAngle(isHorizontal ? ANGLE_VERTICAL : ANGLE_HORIZONTAL);
  }

  // Mirror-Y in KiCad negates the X component of the bounding box, which effectively
  // flips horizontal justification. Compensate so the rendered text matches Altium.
  if (aSymbol.isMirrored) flipH();
}

/**
 * Altium text in symbols uses absolute orientation, but KiCad applies the symbol's transform
 * to library body items at render time. This pre-compensates the stored text angle and
 * justification so that after the render-time transform the appearance matches Altium.
 */
function AdjustTextForSymbolOrientation(aText: SCH_TEXT, aSymbol: ASCH_SYMBOL): void {
  // C++ `%` keeps the dividend's sign; the loop below only runs for a positive count.
  const nRenderRotations = aSymbol.orientation % 4;

  // Undo mirror first (reverse of render-time application order).
  // MirrorHorizontally on LAYER_DEVICE text flips H-justify when horizontal
  // and V-justify when vertical.
  if (aSymbol.isMirrored) {
    if (aText.GetTextAngle().IsHorizontal()) aText.FlipHJustify();
    else aText.SetVertJustify(-aText.GetVertJustify() as GR_TEXT_V_ALIGN_T);
  }

  // The render pipeline applies Rotate90(false) N times; undo with N inverse rotations.
  for (let i = 0; i < nRenderRotations; i++) aText.Rotate90(true);
}

/** `KIGEOM::GetOtherEnd( aSeg, aPoint )`: the end of the segment that is not aPoint. */
function GetOtherEnd(aStart: VECTOR2I, aEnd: VECTOR2I, aPoint: VECTOR2I): VECTOR2I {
  return aStart.x === aPoint.x && aStart.y === aPoint.y ? aEnd : aStart;
}

/** `magic_enum::enum_name<ASCH_POWER_PORT_STYLE>`. */
function powerPortStyleName(aStyle: ASCH_POWER_PORT_STYLE): string {
  return ASCH_POWER_PORT_STYLE[aStyle] ?? '';
}

export function HelperGeneratePowerPortGraphics(
  aKsymbol: LIB_SYMBOL,
  aStyle: ASCH_POWER_PORT_STYLE,
  aReport: (aMsg: string, aSeverity: Severity) => void,
): VECTOR2I {
  const m = (v: number): number => schIUScale.milsToIU(v);
  const poly = (aWidth: number, ...aPts: [number, number][]): void => {
    const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
    line.SetStroke(new STROKE_PARAMS(aWidth, LINE_STYLE.SOLID));
    for (const [x, y] of aPts) line.AddPoint({ x, y });
    aKsymbol.AddDrawItem(line, false);
  };
  const S = ASCH_POWER_PORT_STYLE;

  if (aStyle === S.CIRCLE || aStyle === S.ARROW) {
    poly(m(10), [0, 0], [0, m(50)]);

    if (aStyle === S.CIRCLE) {
      const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);
      circle.SetStroke(new STROKE_PARAMS(m(5), LINE_STYLE.SOLID));
      circle.SetPosition({ x: m(0), y: m(75) });
      circle.SetEnd(add(circle.GetPosition(), { x: m(25), y: 0 }));
      aKsymbol.AddDrawItem(circle, false);
    } else {
      poly(m(10), [m(-25), m(50)], [m(25), m(50)], [m(0), m(100)], [m(-25), m(50)]);
    }

    return { x: 0, y: m(150) };
  } else if (aStyle === S.WAVE) {
    poly(m(10), [0, 0], [0, m(72)]);

    const bezier = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_DEVICE);
    bezier.SetStroke(new STROKE_PARAMS(m(5), LINE_STYLE.SOLID));
    bezier.SetStart({ x: m(30), y: m(50) });
    bezier.SetBezierC1({ x: m(30), y: m(87) });
    bezier.SetBezierC2({ x: m(-30), y: m(63) });
    bezier.SetEnd({ x: m(-30), y: m(100) });
    aKsymbol.AddDrawItem(bezier, false);

    return { x: 0, y: m(150) };
  } else if (
    aStyle === S.POWER_GROUND ||
    aStyle === S.SIGNAL_GROUND ||
    aStyle === S.EARTH ||
    aStyle === S.GOST_ARROW
  ) {
    poly(m(10), [0, 0], [0, m(100)]);

    if (aStyle === S.POWER_GROUND) {
      poly(m(10), [m(-100), m(100)], [m(100), m(100)]);
      poly(m(10), [m(-70), m(130)], [m(70), m(130)]);
      poly(m(10), [m(-40), m(160)], [m(40), m(160)]);
      poly(m(10), [m(-10), m(190)], [m(10), m(190)]);
    } else if (aStyle === S.SIGNAL_GROUND) {
      poly(m(10), [m(-100), m(100)], [m(100), m(100)], [m(0), m(200)], [m(-100), m(100)]);
    } else if (aStyle === S.EARTH) {
      poly(m(10), [m(-150), m(200)], [m(-100), m(100)], [m(100), m(100)], [m(50), m(200)]);
      poly(m(10), [m(0), m(100)], [m(-50), m(200)]);
    } // ASCH_POWER_PORT_STYLE::GOST_ARROW
    else {
      poly(m(10), [m(-25), m(50)], [m(0), m(100)], [m(25), m(50)]);

      return { x: 0, y: m(150) }; // special case
    }

    return { x: 0, y: m(250) };
  } else if (aStyle === S.GOST_POWER_GROUND || aStyle === S.GOST_EARTH) {
    poly(m(10), [0, 0], [0, m(160)]);
    poly(m(10), [m(-100), m(160)], [m(100), m(160)]);
    poly(m(10), [m(-60), m(200)], [m(60), m(200)]);
    poly(m(10), [m(-20), m(240)], [m(20), m(240)]);

    if (aStyle === S.GOST_POWER_GROUND) return { x: 0, y: m(-300) };

    const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);
    circle.SetStroke(new STROKE_PARAMS(m(10), LINE_STYLE.SOLID));
    circle.SetPosition({ x: m(0), y: m(160) });
    circle.SetEnd(add(circle.GetPosition(), { x: m(120), y: 0 }));
    aKsymbol.AddDrawItem(circle, false);

    return { x: 0, y: m(350) };
  } else if (aStyle === S.GOST_BAR) {
    poly(m(10), [0, 0], [0, m(200)]);
    poly(m(10), [m(-100), m(200)], [m(100), m(200)]);

    return { x: 0, y: m(250) };
  } else {
    if (aStyle !== S.BAR)
      aReport("Power Port with unknown style imported as 'Bar' type.", RPT_SEVERITY_WARNING);

    poly(m(10), [0, 0], [0, m(100)]);
    poly(m(10), [m(-50), m(100)], [m(50), m(100)]);

    return { x: 0, y: m(150) };
  }
}

export class SCH_IO_ALTIUM extends SCH_IO {
  private m_rootFilepath = ''; // The file path of the root sheet being imported
  private m_rootSheet: SCH_SHEET | null = null; // The root sheet of the schematic being loaded..
  private m_sheetPath = new SCH_SHEET_PATH();
  private m_schematic: SCHEMATIC | null = null; // Passed to Load(), the schematic object being loaded
  private m_libName = ''; // Library name to save symbols
  private m_isIntLib = false; // Flag to indicate Integrated Library

  private m_currentTitleBlock: TITLE_BLOCK | null = null; // Will be assigned at the end of parsing
  private m_sheetOffset: VECTOR2I = { x: 0, y: 0 };
  private m_altiumSheet: ASCH_SHEET | null = null;
  private m_symbols = new Map<number, SCH_SYMBOL>();
  private m_sheets = new Map<number, SCH_SHEET>();
  private m_libSymbols = new Map<number, LIB_SYMBOL>(); // every symbol has its unique lib_symbol
  private m_powerSymbols = new Map<string, LIB_SYMBOL>();
  private m_altiumStorage: ASCH_STORAGE_FILE[] = [];
  private m_altiumAdditional: ASCH_ADDITIONAL_FILE[] = [];

  private m_altiumComponents = new Map<number, ASCH_SYMBOL>();
  private m_altiumTemplates = new Map<number, ASCH_TEMPLATE>();
  private m_altiumImplementationList = new Map<number, number>();
  private m_altiumPortsCurrentSheet: ASCH_PORT[] = []; // we require all connections first
  private m_altiumHarnessPortsCurrentSheet: ASCH_PORT[] = [];

  private m_altiumHarnesses = new Map<number, HARNESS>();

  private m_harnessOwnerIndexOffset = 0;
  private m_harnessEntryParent = 0; // used to identify harness connector for harness entry element

  private m_timestamps = new Map<string, number>();
  /** `CASE_INSENSITIVE_MAP<LIB_SYMBOL*>`: keyed by the upper-cased name. */
  private m_libCache = new Map<string, Map<string, [string, LIB_SYMBOL]>>();

  private m_fonts: [string, number][] = [];

  private m_altiumSymbolToUid = new Map<SCH_SYMBOL, string>();

  private m_errorMessages = new Map<string, Severity>();

  constructor() {
    super('Altium');
  }

  override GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Altium schematic files', ['SchDoc']);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Altium Schematic Library or Integrated Library', ['SchLib', 'IntLib']);
  }

  override GetModifyHash(): number {
    return 0;
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
  }

  /** `std::unordered_map::emplace`: the first of a message stays. */
  private error(aMsg: string, aSeverity: Severity): void {
    if (!this.m_errorMessages.has(aMsg)) this.m_errorMessages.set(aMsg, aSeverity);
  }

  private isBinaryFile(aFileName: string): boolean {
    // Compound File Binary Format header
    return fileHasBinaryHeader(this.m_readFile(aFileName), COMPOUND_FILE_HEADER);
  }

  private isASCIIFile(aFileName: string): boolean {
    // ASCII file format
    return fileStartsWithPrefix(this.m_readFile(aFileName), '|HEADER=', false);
  }

  private checkFileHeader(aFileName: string): boolean {
    return this.isBinaryFile(aFileName) || this.isASCIIFile(aFileName);
  }

  override CanReadSchematicFile(aFileName: string): boolean {
    if (!super.CanReadSchematicFile(aFileName)) return false;

    return this.checkFileHeader(aFileName);
  }

  override CanReadLibrary(aFileName: string): boolean {
    if (!super.CanReadLibrary(aFileName)) return false;

    return this.checkFileHeader(aFileName);
  }

  private fixupSymbolPinNameNumbers(aSymbol: SCH_SYMBOL | LIB_SYMBOL): void {
    let pins: SCH_PIN[] = [];

    if (aSymbol instanceof SCH_SYMBOL) pins = aSymbol.GetPins(null);
    else pins = aSymbol.GetGraphicalPins(0, 0);

    let names_visible = false;
    let numbers_visible = false;

    for (const pin of pins) {
      if (pin.GetNameTextSize() > 0 && pin.GetName() !== '') names_visible = true;

      if (pin.GetNumberTextSize() > 0 && pin.GetNumber() !== '') numbers_visible = true;
    }

    if (!names_visible) {
      for (const pin of pins) pin.SetNameTextSize(schIUScale.milsToIU(DEFAULT_PINNAME_SIZE));

      aSymbol.SetShowPinNames(false);
    }

    if (!numbers_visible) {
      for (const pin of pins) pin.SetNumberTextSize(schIUScale.milsToIU(DEFAULT_PINNUM_SIZE));

      aSymbol.SetShowPinNumbers(false);
    }
  }

  getLibName(): string {
    if (this.m_libName === '') {
      // Try to come up with a meaningful name
      this.m_libName = this.m_schematic!.Project().GetProjectName();

      if (this.m_libName === '')
        this.m_libName = fileNameParts(this.m_rootSheet!.GetFileName()).name;

      if (this.m_libName === '') this.m_libName = 'noname';

      this.m_libName += '-altium-import';
      this.m_libName = LIB_ID.FixIllegalChars(this.m_libName, true);
    }

    return this.m_libName;
  }

  getLibFileName(): string {
    return joinPath(
      this.m_schematic!.Project().GetProjectPath(),
      `${this.getLibName()}.${KiCadSymbolLibFileExtension}`,
    );
  }

  LoadSchematicProject(aSchematic: SCHEMATIC, aProperties: SCH_IO_PROPERTIES): SCH_SHEET {
    let x = 1;
    let y = 1;
    let page = 1;

    const sheets = new Map<string, SCH_SHEET>();

    for (const [key, filestring] of byStringKey(aProperties)) {
      if (!key.startsWith('sch')) continue;

      const fn = filestring;

      // Check if this file was already loaded as a subsheet of another sheet.
      // This can happen when the project file lists sheets in an order where a parent
      // sheet is processed before its subsheets. We need to handle potential case
      // differences in filenames (e.g., LVDS.SCHDOC vs LVDS.SchDoc).
      const existing = { value: null as SCH_SCREEN | null };
      this.m_rootSheet!.SearchHierarchy(fn, existing);
      let existingScreen = existing.value;

      // If not found, try case-insensitive search by checking all loaded screens.
      // Compare base names only (without extension) since Altium uses .SchDoc/.SCHDOC
      // while KiCad uses .kicad_sch
      if (!existingScreen) {
        const allScreens = new SCH_SCREENS(this.m_rootSheet!);

        for (let screen = allScreens.GetFirst(); screen; screen = allScreens.GetNext()) {
          if (
            fileNameParts(screen.GetFileName()).name.toLowerCase() ===
            fileNameParts(fn).name.toLowerCase()
          ) {
            existingScreen = screen;
            break;
          }
        }
      }

      if (existingScreen) continue;

      const pos: VECTOR2I = { x: x * schIUScale.milsToIU(1000), y: y * schIUScale.milsToIU(1000) };

      const sheet = new SCH_SHEET(this.m_rootSheet as unknown as EDA_ITEM, pos);
      const screen = new SCH_SCREEN(this.m_schematic);
      sheet.SetScreen(screen);

      // Convert to KiCad project-relative path with .kicad_sch extension
      const kicadFullName = `${fileNameParts(fn).name}.${KiCadSchematicFileExtension}`;
      const kicadFullPath = joinPath(aSchematic.Project().GetProjectPath(), kicadFullName);

      // Sheet uses relative filename, screen uses full path
      sheet.SetFileName(kicadFullName);
      screen.SetFileName(kicadFullPath);

      const pageNo = `${page++}`;

      this.m_sheetPath.push_back(sheet);

      // Parse from the original Altium file location
      this.ParseAltiumSch(fn);

      // Sheets created here won't have names set by ParseSheetName (which only applies
      // to sheet symbols within a parent). Derive a name from the Altium filename.
      if (isBlank(sheet.GetName())) {
        const existingNames = new Set<string>();

        for (const [, existingSheet] of byStringKey(sheets))
          existingNames.add(existingSheet.GetName());

        sheet.SetName(AltiumDeriveSheetName(fn, existingNames));
      }

      this.m_sheetPath.SetPageNumber(pageNo);
      this.m_sheetPath.pop_back();

      const currentScreen = this.m_rootSheet!.GetScreen();

      if (!currentScreen) continue;

      sheet.SetParent(this.m_sheetPath.Last() as unknown as EDA_ITEM);
      currentScreen.Append(sheet);

      // Use the KiCad path for the map key since screen filenames use KiCad paths
      sheets.set(kicadFullPath, sheet);

      x += 2;

      if (x > 10) {
        // Start next row of sheets.
        x = 1;
        y += 2;
      }
    }

    // If any of the sheets in the project is a subsheet, then remove the sheet from the root sheet.
    // The root sheet only contains sheets that are not referenced by any other sheet in a
    // pseudo-flat structure.
    for (const [filestring, sheet] of byStringKey(sheets)) {
      if (this.m_rootSheet!.CountSheets(filestring) > 1) this.getCurrentScreen()!.Remove(sheet);
    }

    return this.m_rootSheet!;
  }

  override LoadSchematicFile(
    aFileName: string,
    aSchematic: SCHEMATIC,
    aAppendToMe: SCH_SHEET | null = null,
    aProperties: SCH_IO_PROPERTIES | null = null,
  ): SCH_SHEET {
    if ((aFileName === '' && (!aProperties || aProperties.size === 0)) || !aSchematic)
      throw new IO_ERROR('No file name or schematic.');

    const fileName = withExt(aFileName, KiCadSchematicFileExtension);
    this.m_schematic = aSchematic;

    if (aAppendToMe) {
      if (!aSchematic.IsValid()) throw new IO_ERROR("Can't append to a schematic with no root!");
      this.m_rootSheet = aAppendToMe;
    } else {
      this.m_rootSheet = new SCH_SHEET(aSchematic);
      this.m_rootSheet.SetFileName(fileName);

      // For project imports (empty filename), the root sheet becomes the virtual root
      // container. Don't call SetTopLevelSheets yet - that will happen after
      // LoadSchematicProject populates the sheet hierarchy.
      if (aFileName === '') {
        (this.m_rootSheet as { m_Uuid: KIID }).m_Uuid = niluuid;
      } else {
        // For single-file imports, set as top-level sheet immediately and assign
        // a placeholder page number that will be updated if we find a pageNumber record.
        aSchematic.SetTopLevelSheets([this.m_rootSheet]);

        const sheetpath = new SCH_SHEET_PATH();
        sheetpath.push_back(this.m_rootSheet);
        sheetpath.SetPageNumber('#');
      }
    }

    if (!this.m_rootSheet.GetScreen()) {
      const screen = new SCH_SCREEN(this.m_schematic);
      screen.SetFileName(aFileName);
      this.m_rootSheet.SetScreen(screen);

      // For single-file import, use the screen's UUID for the root sheet
      if (aFileName !== '') (this.m_rootSheet as { m_Uuid: KIID }).m_Uuid = screen.GetUuid();
    }

    this.m_sheetPath.push_back(this.m_rootSheet);

    const rootScreen = this.m_rootSheet.GetScreen();

    if (!rootScreen) throw new IO_ERROR('No root screen.');

    const sheetInstance = new SCH_SHEET_INSTANCE();

    sheetInstance.m_Path = this.m_sheetPath.Path();
    sheetInstance.m_PageNumber = '#';

    rootScreen.m_sheetInstances.push(sheetInstance);

    if (aFileName === '') this.LoadSchematicProject(aSchematic, aProperties!);
    else this.ParseAltiumSch(aFileName);

    if (aFileName === '') {
      const topLevelSheets: SCH_SHEET[] = [];

      for (const item of rootScreen.Items().OfType(KICAD_T.SCH_SHEET_T)) {
        const sheet = item as unknown as SCH_SHEET;

        // Skip the temporary root sheet itself if it somehow ended up in its own screen
        if (sheet !== this.m_rootSheet) topLevelSheets.push(sheet);
      }

      // Remove sheets from the temporary root screen before transferring ownership
      // to the schematic. Otherwise the screen destructor will delete them.
      for (const sheet of topLevelSheets) rootScreen.Remove(sheet);

      if (topLevelSheets.length > 0) aSchematic.SetTopLevelSheets(topLevelSheets);

      // Convert hierarchical labels to global labels on top-level sheets.
      // Top-level sheets have no parent, so hierarchical labels don't make sense.
      for (const sheet of topLevelSheets) {
        const screen = sheet.GetScreen();

        if (!screen) continue;

        const hierLabels = [
          ...screen.Items().OfType(KICAD_T.SCH_HIER_LABEL_T),
        ] as unknown as SCH_HIERLABEL[];

        for (const hierLabel of hierLabels) {
          const globalLabel = new SCH_GLOBALLABEL(hierLabel.GetPosition(), hierLabel.GetText());
          globalLabel.SetShape(hierLabel.GetShape());
          globalLabel.SetSpinStyle(hierLabel.GetSpinStyle());
          globalLabel.GetField(FIELD_T.INTERSHEET_REFS)!.SetVisible(false);

          screen.Remove(hierLabel);
          screen.Append(globalLabel);
        }
      }

      this.m_rootSheet = aSchematic.Root();
    }

    if (!aAppendToMe) this.NormalizeRepeatedSheetInstances();

    if (this.m_reporter) {
      for (const [msg, severity] of this.m_errorMessages) this.m_reporter.Report(msg, severity);
    }

    this.m_errorMessages.clear();

    const allSheets = new SCH_SCREENS(this.m_rootSheet);
    allSheets.UpdateSymbolLinks(null); // Update all symbol library links for all sheets.
    allSheets.ClearEditFlags();

    // Apply Altium project variants to schematic symbols
    const projectFile = aProperties?.get('project_file');

    if (projectFile !== undefined) {
      const projectBytes = this.m_readFile(projectFile);
      const variants = projectBytes
        ? ParseAltiumProjectVariants(new TextDecoder('utf-8').decode(projectBytes))
        : [];

      if (variants.length > 0) {
        // Build lookups keyed by both UniqueId and designator. UniqueId is preferred
        // because repeated-channel designs can have multiple components sharing a
        // designator but with distinct UniqueIds.
        type ENTRY = [string, (typeof variants)[number]['variations'][number]];
        const variantsByUid = new Map<string, ENTRY[]>();
        const variantsByDesignator = new Map<string, ENTRY[]>();
        const push = (m: Map<string, ENTRY[]>, k: string, e: ENTRY) => {
          let list = m.get(k);
          if (!list) {
            list = [];
            m.set(k, list);
          }
          list.push(e);
        };

        for (const pv of variants) {
          this.m_schematic.AddVariant(pv.name);

          if (pv.description !== '' && pv.description !== pv.name)
            this.m_schematic.SetVariantDescription(pv.name, pv.description);

          for (const entry of pv.variations) {
            if (entry.uniqueId !== '') push(variantsByUid, entry.uniqueId, [pv.name, entry]);

            push(variantsByDesignator, entry.designator, [pv.name, entry]);
          }
        }

        for (const path of this.m_schematic.Hierarchy()) {
          const screen = path.LastScreen();

          if (!screen) continue;

          for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
            const symbol = item as unknown as SCH_SYMBOL;

            let applicable: ENTRY[] = [];

            let uidEntries: ENTRY[] | null = null;
            const symUid = this.m_altiumSymbolToUid.get(symbol);

            if (symUid !== undefined) uidEntries = variantsByUid.get(symUid) ?? null;

            if (uidEntries && uidEntries.length === 1) {
              applicable = [...uidEntries];
            } else if (uidEntries) {
              // A unique id shared by several variations (repeated channels) is
              // ambiguous; disambiguate with the per-channel designator.
              const ref = symbol.GetRef(path);

              for (const namedEntry of uidEntries) {
                if (namedEntry[1].designator === ref) applicable.push(namedEntry);
              }
            } else {
              const ref = symbol.GetRef(path);
              applicable = [...(variantsByDesignator.get(ref) ?? [])];
            }

            if (applicable.length === 0) continue;

            for (const [variantName, entry] of applicable) {
              const variant = new SCH_SYMBOL_VARIANT(variantName);
              variant.InitializeAttributes(symbol);

              if (entry.kind === 1) {
                variant.m_DNP = true;
                variant.m_ExcludedFromBOM = true;
                variant.m_ExcludedFromPosFiles = true;
              } else if (entry.kind === 0) {
                for (const [key, value] of byStringKey(entry.alternateFields)) {
                  if (key.toLowerCase() === 'libreference') variant.m_Fields.set('Value', value);
                  else if (key.toLowerCase() === 'description')
                    variant.m_Fields.set('Description', value);
                  else if (key.toLowerCase() === 'footprint')
                    variant.m_Fields.set('Footprint', value);
                }
              }

              symbol.AddVariant(path, variant);
            }
          }
        }
      }
    }

    // Set up the default netclass wire & bus width based on imported wires & buses.
    //

    let minWireWidth = Number.MAX_SAFE_INTEGER;
    let minBusWidth = Number.MAX_SAFE_INTEGER;

    for (let screen = allSheets.GetFirst(); screen; screen = allSheets.GetNext()) {
      for (const item of screen.Items().OfType(KICAD_T.SCH_LINE_T)) {
        const line = item as unknown as SCH_LINE;

        if (line.IsWire() && line.GetLineWidth() > 0)
          minWireWidth = Math.min(minWireWidth, line.GetLineWidth());

        if (line.IsBus() && line.GetLineWidth() > 0)
          minBusWidth = Math.min(minBusWidth, line.GetLineWidth());
      }
    }

    const netSettings = this.m_schematic.Project().GetProjectFile().NetSettings();

    if (minWireWidth < Number.MAX_SAFE_INTEGER)
      netSettings.GetDefaultNetclass().SetWireWidth(minWireWidth);

    if (minBusWidth < Number.MAX_SAFE_INTEGER)
      netSettings.GetDefaultNetclass().SetBusWidth(minBusWidth);

    return this.m_rootSheet;
  }

  private getCurrentScreen(): SCH_SCREEN | null {
    return this.m_sheetPath.LastScreen();
  }

  private getCurrentSheet(): SCH_SHEET | null {
    return this.m_sheetPath.Last();
  }

  private CreateAliases(): void {
    const screen = this.getCurrentScreen();
    if (!screen) return;

    const busLineMap = new Map<string, SCH_LINE[]>();
    const key = (p: VECTOR2I) => `${p.x},${p.y}`; // std::less<VECTOR2I>: the point

    for (const elem of screen.Items().OfType(KICAD_T.SCH_LINE_T)) {
      const line = elem as unknown as SCH_LINE;

      if (line.IsBus()) {
        for (const p of [line.GetStartPoint(), line.GetEndPoint()]) {
          let list = busLineMap.get(key(p));
          if (!list) {
            list = [];
            busLineMap.set(key(p), list);
          }
          list.push(line);
        }
      }
    }

    const walkBusLine = (aStart: VECTOR2I, aVisited: Set<SCH_LINE>): SCH_LABEL | null => {
      const lines = busLineMap.get(key(aStart));

      if (!lines) return null;

      for (const line of lines) {
        // Skip lines we've already checked to avoid cycles
        if (aVisited.has(line)) continue;

        aVisited.add(line);

        for (const elem of screen.Items().Overlapping(KICAD_T.SCH_LABEL_T, line.GetBoundingBox())) {
          const label = elem as unknown as SCH_LABEL;

          if (line.HitTest(label.GetPosition())) return label;
        }

        const result = walkBusLine(
          GetOtherEnd(line.GetStartPoint(), line.GetEndPoint(), aStart),
          aVisited,
        );

        if (result) return result;
      }

      return null;
    };

    for (const [, harness] of byIntKey(this.m_altiumHarnesses)) {
      const alias = new BUS_ALIAS();
      alias.SetName(harness.m_name);

      for (const port of harness.m_ports) alias.AddMember(port.m_name);

      screen.AddBusAlias(alias);

      let pos: VECTOR2I = { x: 0, y: 0 };
      const box = new BOX2I(harness.m_location, harness.m_size);
      let busLine: SCH_LINE | null = null;

      for (const elem of screen.Items().Overlapping(KICAD_T.SCH_LINE_T, box)) {
        const line = elem as unknown as SCH_LINE;

        if (!line.IsBus()) continue;

        busLine = line;

        for (const p of line.GetConnectionPoints()) {
          if (box.Contains(p)) {
            pos = p;
            break;
          }
        }
      }

      if (!busLine) {
        for (const elem of screen.Items().Overlapping(KICAD_T.SCH_HIER_LABEL_T, box)) {
          const label = elem as unknown as SCH_HIERLABEL;

          pos = label.GetPosition();
          const center = box.GetCenter();
          const delta_x = center.x - pos.x;
          const delta_y = center.y - pos.y;

          busLine = new SCH_LINE(pos, SCH_LAYER_ID.LAYER_BUS);

          if (Math.abs(delta_x) > Math.abs(delta_y)) busLine.SetEndPoint({ x: center.x, y: pos.y });
          else busLine.SetEndPoint({ x: pos.x, y: center.y });

          busLine.SetFlags(IS_NEW);
          screen.Append(busLine);

          break;
        }
      }

      if (!busLine) continue;

      const visited = new Set<SCH_LINE>();
      let label = walkBusLine(pos, visited);

      // Altium supports two different naming conventions for harnesses.  If there is a specific
      // harness name, then the nets inside the harness will be named harnessname.netname.
      // However, if there is no harness name, the nets will be named just netname.

      // KiCad bus labels need some special handling to be recognized as bus labels
      if (label && !label.GetText().startsWith('{'))
        label.SetText(`${label.GetText()}{${harness.m_name}}`);

      if (!label) {
        label = new SCH_LABEL(busLine.GetStartPoint(), `{${harness.m_name}}`);
        label.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);

        if (busLine.GetEndPoint().x < busLine.GetStartPoint().x)
          label.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        else label.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

        screen.Append(label);
      }

      // Draw the bus line from the individual ports to the harness

      let isVertical = true;

      if (harness.m_ports.length > 1) {
        const first = harness.m_ports[0]!.m_location;
        const last = harness.m_ports[harness.m_ports.length - 1]!.m_location;

        if (first.y === last.y) isVertical = false;
      }

      if (isVertical) {
        // `harness.m_ports.front()`: undefined behaviour upstream on an empty list.
        const frontEntry = harness.m_ports[0]?.m_entryLocation ?? { x: 0, y: 0 };
        let bottom = frontEntry;
        let top = frontEntry;
        const delta_space = schIUScale.milsToIU(100);

        for (const port of harness.m_ports) {
          if (port.m_entryLocation.y > bottom.y) bottom = port.m_entryLocation;

          if (port.m_entryLocation.y < top.y) top = port.m_entryLocation;
        }

        let last_pt: VECTOR2I;
        let line = new SCH_LINE(bottom, SCH_LAYER_ID.LAYER_BUS);
        line.SetStartPoint(bottom);
        line.SetEndPoint(top);
        line.SetLineWidth(busLine.GetLineWidth());
        line.SetLineColor(busLine.GetLineColor());
        screen.Append(line);

        const sq = (v: VECTOR2I): number => v.x * v.x + v.y * v.y;
        last_pt =
          sq(sub(busLine.GetStartPoint(), line.GetEndPoint())) <
          sq(sub(busLine.GetStartPoint(), line.GetStartPoint()))
            ? line.GetEndPoint()
            : line.GetStartPoint();

        // If the busline is not on the save y coordinate as the bus/wire connectors, add a short
        // hop to bring the bus down to the level of the connectors
        if (last_pt.y !== busLine.GetStartPoint().y) {
          line = new SCH_LINE(last_pt, SCH_LAYER_ID.LAYER_BUS);
          line.SetStartPoint(last_pt);

          // `alg::signbit( busLine->GetStartPoint().x - last_pt.x )`
          if (
            Object.is(busLine.GetStartPoint().x - last_pt.x, -0) ||
            busLine.GetStartPoint().x - last_pt.x < 0
          )
            line.SetEndPoint(add(last_pt, { x: -delta_space, y: 0 }));
          else line.SetEndPoint(add(last_pt, { x: delta_space, y: 0 }));

          line.SetLineWidth(busLine.GetLineWidth());
          line.SetLineColor(busLine.GetLineColor());
          screen.Append(line);
          last_pt = line.GetEndPoint();

          line = new SCH_LINE(last_pt, SCH_LAYER_ID.LAYER_BUS);
          line.SetStartPoint(last_pt);
          line.SetEndPoint(add(last_pt, { x: 0, y: busLine.GetStartPoint().y - last_pt.y }));
          line.SetLineWidth(busLine.GetLineWidth());
          line.SetLineColor(busLine.GetLineColor());
          screen.Append(line);
          last_pt = line.GetEndPoint();
        }

        line = new SCH_LINE(last_pt, SCH_LAYER_ID.LAYER_BUS);
        line.SetStartPoint(last_pt);
        line.SetEndPoint(busLine.GetStartPoint());
        line.SetLineWidth(busLine.GetLineWidth());
        line.SetLineColor(busLine.GetLineColor());
        screen.Append(line);
      }
    }
  }

  private PostProcessBusLabels(): void {
    const screen = this.getCurrentScreen();
    if (!screen) return;

    let hasBusLines = false;

    for (const item of screen.Items().OfType(KICAD_T.SCH_LINE_T)) {
      if ((item as unknown as SCH_LINE).IsBus()) {
        hasBusLines = true;
        break;
      }
    }

    if (!hasBusLines) return;

    // Collect labels that need wrapping, then modify them after iteration to avoid
    // modifying the R-tree during traversal.
    const labelsToWrap: SCH_LABEL[] = [];

    for (const item of screen.Items().OfType(KICAD_T.SCH_LABEL_T)) {
      const label = item as unknown as SCH_LABEL;

      if (SCH_CONNECTION.IsBusLabel(label.GetText())) continue;

      for (const busItem of screen
        .Items()
        .Overlapping(KICAD_T.SCH_LINE_T, label.GetBoundingBox())) {
        const busLine = busItem as unknown as SCH_LINE;

        if (busLine.IsBus() && busLine.HitTest(label.GetPosition())) {
          labelsToWrap.push(label);
          break;
        }
      }
    }

    for (const label of labelsToWrap) label.SetText(AltiumWrapBusLabel(label.GetText()));
  }

  private EnsureSheetSymbolNames(): void {
    const screen = this.getCurrentScreen();
    if (!screen) return;

    const existingNames = new Set<string>();

    for (const item of screen.Items().OfType(KICAD_T.SCH_SHEET_T)) {
      const sheet = item as unknown as SCH_SHEET;

      if (!isBlank(sheet.GetName())) existingNames.add(sheet.GetName());
    }

    for (const [, sheet] of byIntKey(this.m_sheets)) {
      if (!isBlank(sheet.GetName())) continue;

      const filenameField = sheet.GetField(FIELD_T.SHEET_FILENAME);
      const filename = filenameField ? filenameField.GetText() : '';
      const sheetName = AltiumDeriveSheetName(filename, existingNames);

      sheet.SetName(sheetName);
      existingNames.add(sheetName);
    }
  }

  private ResolveSheetFileName(aParentPath: string, aSheetFileName: string): string {
    const readable = (p: string): boolean => this.m_readFile(p) !== null;
    const loadAltiumFileName = joinPath(aParentPath, aSheetFileName);

    if (readable(loadAltiumFileName)) return loadAltiumFileName;

    const sheetFn = fileNameParts(aSheetFileName);
    const extensionless = sheetFn.ext === '';

    if (fileNameParts(loadAltiumFileName).ext === '') {
      const withSchDoc = withExt(loadAltiumFileName, 'SchDoc');

      if (readable(withSchDoc)) return withSchDoc;
    }

    for (const candidate of this.m_listDir(aParentPath) ?? []) {
      const candidateFname = fileNameParts(candidate);
      const full = candidate.substring(
        Math.max(candidate.lastIndexOf('/'), candidate.lastIndexOf('\\')) + 1,
      );

      if (
        full.toLowerCase() === aSheetFileName.toLowerCase() ||
        (extensionless &&
          sheetFn.name !== '' &&
          candidateFname.name.toLowerCase() === sheetFn.name.toLowerCase() &&
          candidateFname.ext.toLowerCase() === 'schdoc')
      ) {
        return joinPath(aParentPath, full);
      }
    }

    return loadAltiumFileName;
  }

  private NormalizeRepeatedSheetInstances(): void {
    const schematic = this.m_schematic;
    if (!schematic) return;

    schematic.RefreshHierarchy();

    const sheetList = schematic.Hierarchy();
    const pathsByFile = new Map<string, SCH_SHEET_PATH[]>();

    for (const sheetPath of sheetList) {
      if (sheetPath.size() < 2 || !sheetPath.LastScreen()) continue;

      const sheetFileName = sheetPath.Last()!.GetFileName().toLowerCase();

      if (sheetFileName === '') continue;

      const parentPath = sheetPath.Clone();
      parentPath.pop_back();

      const k = `${parentPath.Path().AsString()}|${sheetFileName}`;
      let list = pathsByFile.get(k);
      if (!list) {
        list = [];
        pathsByFile.set(k, list);
      }
      list.push(sheetPath);
    }

    for (const [, sheetPaths] of byStringKey(pathsByFile)) {
      if (sheetPaths.length < 2) continue;

      sheetPaths.sort((aFirst, aSecond) => {
        const firstPos = aFirst.Last()!.GetPosition();
        const secondPos = aSecond.Last()!.GetPosition();

        if (firstPos.y !== secondPos.y) return firstPos.y - secondPos.y;

        return firstPos.x - secondPos.x;
      });

      let basePage = 0;

      for (const sheetPath of sheetPaths) {
        const page = toLong(sheetPath.GetPageNumber());

        if (page !== null && page > 0) basePage = basePage === 0 ? page : Math.min(basePage, page);
      }

      if (basePage === 0) basePage = toLong(sheetList.GetNextPageNumber()) ?? 0;

      if (basePage === 0) basePage = 1;

      for (let ii = 0; ii < sheetPaths.length; ++ii) {
        const sheetPath = sheetPaths[ii]!;

        sheetPath.SetPageNumber(`${basePage + ii}`);

        for (const item of sheetPath.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
          const symbol = item as unknown as SCH_SYMBOL;
          const baseRef = symbol.GetField(FIELD_T.REFERENCE)!.GetText();

          if (baseRef.startsWith('#')) {
            symbol.AddSheetPathReferenceEntryIfMissing(sheetPath.Path());
            continue;
          }

          if (baseRef !== '') symbol.SetRef(sheetPath, `${baseRef}_${sheetPath.Last()!.GetName()}`);
        }
      }
    }

    schematic.RefreshHierarchy();
  }

  ParseAltiumSch(aFileName: string): void {
    // Load path may be different from the project path.
    const parentPath = fileNameParts(aFileName).path;

    if (this.m_rootFilepath === '') this.m_rootFilepath = parentPath;

    if (this.m_progressReporter) {
      this.m_progressReporter.Report(`Importing ${baseName(aFileName)}`);

      if (!this.m_progressReporter.KeepRefreshing())
        throw new IO_ERROR('File import canceled by user.');
    }

    if (this.isBinaryFile(aFileName)) {
      const bytes = this.m_readFile(aFileName);

      if (!bytes) throw new IO_ERROR(`Cannot open file '${aFileName}'`);

      const altiumSchFile = new ALTIUM_COMPOUND_FILE(bytes);

      try {
        this.ParseStorage(altiumSchFile); // we need this before parsing the FileHeader
        this.ParseFileHeader(altiumSchFile);

        // Parse "Additional" because sheet is set up during "FileHeader" parsing.
        this.ParseAdditional(altiumSchFile);
      } catch (exception) {
        if (exception instanceof CFBException) throw new IO_ERROR(exception.message);
        if (exception instanceof IO_ERROR) throw exception;
        throw new IO_ERROR(`Error parsing Altium schematic: ${(exception as Error).message}`);
      }
    } // ASCII
    else {
      this.ParseASCIISchematic(aFileName);
    }

    const currentScreen = this.getCurrentScreen();
    if (!currentScreen) return;

    // Descend the sheet hierarchy.
    for (const item of [...currentScreen.Items().OfType(KICAD_T.SCH_SHEET_T)]) {
      const sheet = item as unknown as SCH_SHEET;

      const loadAltiumFileName = this.ResolveSheetFileName(parentPath, sheet.GetFileName());

      if (baseName(loadAltiumFileName) === '' || this.m_readFile(loadAltiumFileName) === null) {
        this.error(
          `The file name for sheet ${sheet.GetName()} is undefined, this is probably an Altium signal harness that got converted to a sheet.`,
          RPT_SEVERITY_INFO,
        );
        sheet.SetScreen(new SCH_SCREEN(this.m_schematic));
        continue;
      }

      const loaded = { value: null as SCH_SCREEN | null };
      this.m_rootSheet!.SearchHierarchy(loadAltiumFileName, loaded);
      const loadedScreen = loaded.value;

      const projectFullName = `${fileNameParts(loadAltiumFileName).name}.${KiCadSchematicFileExtension}`;

      if (loadedScreen) {
        sheet.SetScreen(loadedScreen);
        sheet.SetFileName(projectFullName);

        // Do not need to load the sub-sheets - this has already been done.
      } else {
        sheet.SetScreen(new SCH_SCREEN(this.m_schematic));
        const screen = sheet.GetScreen();

        if (isBlank(sheet.GetName())) {
          const name = fileNameParts(loadAltiumFileName).name.replaceAll('/', '_');

          let sheetName = name;
          const sheetNames = new Set<string>();

          for (const otherItem of currentScreen.Items().OfType(KICAD_T.SCH_SHEET_T))
            sheetNames.add((otherItem as unknown as SCH_SHEET).GetName());

          for (let ii = 1; ; ++ii) {
            if (!sheetNames.has(sheetName)) break;

            sheetName = `${name}_${ii}`;
          }

          sheet.SetName(sheetName);
        }

        if (!screen) continue;

        this.m_sheetPath.push_back(sheet);
        this.m_sheets.clear();
        this.ParseAltiumSch(loadAltiumFileName);

        // Map the loaded Altium file to the project file.
        sheet.SetFileName(projectFullName);
        screen.SetFileName(joinPath(this.m_schematic!.Project().GetProjectPath(), projectFullName));

        this.m_sheetPath.pop_back();
      }
    }
  }

  private ParseStorage(aAltiumSchFile: ALTIUM_COMPOUND_FILE): void {
    const file = aAltiumSchFile.FindStream(['Storage']);

    if (file === null) return;

    const reader = new ALTIUM_BINARY_PARSER(aAltiumSchFile, file);

    const properties = reader.ReadProperties();
    ALTIUM_PROPS_UTILS.ReadString(properties, 'HEADER', '');
    const weight = ALTIUM_PROPS_UTILS.ReadInt(properties, 'WEIGHT', 0);

    if (weight < 0) throw new IO_ERROR('Storage weight is negative!');

    for (let i = 0; i < weight; i++)
      this.m_altiumStorage.push(ASCH_STORAGE_FILE.fromReader(reader));

    if (reader.HasParsingError()) throw new IO_ERROR('stream was not parsed correctly!');

    // TODO pointhi: is it possible to have multiple headers in one Storage file? Otherwise
    // throw IO Error.
    if (reader.GetRemainingBytes() !== 0) {
      this.error(
        `Storage file not fully parsed (${reader.GetRemainingBytes()} bytes remaining).`,
        RPT_SEVERITY_ERROR,
      );
    }
  }

  private ParseAdditional(aAltiumSchFile: ALTIUM_COMPOUND_FILE): void {
    const streamName = 'Additional';

    const file = aAltiumSchFile.FindStream([streamName]);

    if (file === null) return;

    const reader = new ALTIUM_BINARY_PARSER(aAltiumSchFile, file);

    if (reader.GetRemainingBytes() <= 0) {
      throw new IO_ERROR('Additional section does not contain any data');
    } else {
      const properties = reader.ReadProperties();

      const recordId = ALTIUM_PROPS_UTILS.ReadInt(properties, 'RECORD', 0);

      if ((recordId as ALTIUM_SCH_RECORD) !== ALTIUM_SCH_RECORD.HEADER)
        throw new IO_ERROR('Header expected');
    }

    for (let index = 0; reader.GetRemainingBytes() > 0; index++) {
      const properties = reader.ReadProperties();

      this.ParseRecord(index, properties, streamName);
    }

    // Handle harness Ports
    for (const port of this.m_altiumHarnessPortsCurrentSheet) this.ParseHarnessPort(port);

    this.CreateAliases();

    // Wrap any remaining net labels sitting on bus lines in curly braces
    this.PostProcessBusLabels();

    if (reader.HasParsingError()) throw new IO_ERROR('stream was not parsed correctly!');

    if (reader.GetRemainingBytes() !== 0) throw new IO_ERROR('stream is not fully parsed');

    this.m_altiumHarnesses.clear();
    this.m_altiumHarnessPortsCurrentSheet = [];
  }

  private finishSheet(): void {
    // assign LIB_SYMBOL -> COMPONENT
    for (const [index, symbol] of byIntKey(this.m_symbols)) {
      const libSymbol = this.m_libSymbols.get(index);

      if (!libSymbol) throw new IO_ERROR('every symbol should have a symbol attached');

      this.fixupSymbolPinNameNumbers(symbol);
      this.fixupSymbolPinNameNumbers(libSymbol);

      symbol.SetLibSymbol(libSymbol);
    }

    const screen = this.getCurrentScreen();
    if (!screen) return;

    // Handle title blocks
    screen.SetTitleBlock(this.m_currentTitleBlock!);
    this.m_currentTitleBlock = null;
  }

  private ParseFileHeader(aAltiumSchFile: ALTIUM_COMPOUND_FILE): void {
    const streamName = 'FileHeader';

    const file = aAltiumSchFile.FindStream([streamName]);

    if (file === null) throw new IO_ERROR('FileHeader not found');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumSchFile, file);

    if (reader.GetRemainingBytes() <= 0) {
      throw new IO_ERROR('FileHeader does not contain any data');
    } else {
      const properties = reader.ReadProperties();

      const libtype = ALTIUM_PROPS_UTILS.ReadString(properties, 'HEADER', '');

      if (
        libtype.toLowerCase() !== 'protel for windows - schematic capture binary file version 5.0'
      )
        throw new IO_ERROR('Expected Altium Schematic file version 5.0');
    }

    // Prepare some local variables
    if (this.m_altiumPortsCurrentSheet.length > 0 || this.m_currentTitleBlock) return;

    this.m_currentTitleBlock = new TITLE_BLOCK();

    // index is required to resolve OWNERINDEX
    for (let index = 0; reader.GetRemainingBytes() > 0; index++) {
      const properties = reader.ReadProperties();

      this.ParseRecord(index, properties, streamName);
    }

    if (reader.HasParsingError()) throw new IO_ERROR('stream was not parsed correctly!');

    if (reader.GetRemainingBytes() !== 0) throw new IO_ERROR('stream is not fully parsed');

    this.finishSheet();

    // Handle Ports
    for (const port of this.m_altiumPortsCurrentSheet) this.ParsePort(port);

    // Bus labels are wrapped in ParseAdditional() after CreateAliases() has had a chance to
    // append harness suffixes; doing it here would prematurely mark labels as bus groups.

    // Assign default names to any sheet symbols that didn't get a SHEET_NAME record
    this.EnsureSheetSymbolNames();

    this.m_altiumPortsCurrentSheet = [];
    this.m_altiumComponents.clear();
    this.m_altiumTemplates.clear();
    this.m_altiumImplementationList.clear();

    this.m_symbols.clear();
    this.m_libSymbols.clear();

    // Otherwise we cannot save the imported sheet?
    const sheet = this.getCurrentSheet();

    if (!sheet) return;

    sheet.SetModified();
  }

  private ParseASCIISchematic(aFileName: string): void {
    const bytes = this.m_readFile(aFileName);

    if (!bytes) throw new IO_ERROR(`Cannot open file '${aFileName}'`);

    // Read storage content first
    {
      const storageReader = new ALTIUM_ASCII_PARSER(bytes);

      while (storageReader.CanRead()) {
        const properties = storageReader.ReadProperties();

        // Binary data
        if (properties.has('BINARY'))
          this.m_altiumStorage.push(ASCH_STORAGE_FILE.fromProps(properties));
      }
    }

    // Read other data
    const reader = new ALTIUM_ASCII_PARSER(bytes);

    if (!reader.CanRead()) {
      throw new IO_ERROR('FileHeader does not contain any data');
    } else {
      const properties = reader.ReadProperties();

      const libtype = ALTIUM_PROPS_UTILS.ReadString(properties, 'HEADER', '');

      if (libtype.toLowerCase() !== 'protel for windows - schematic capture ascii file version 5.0')
        throw new IO_ERROR('Expected Altium Schematic file version 5.0');
    }

    // Prepare some local variables
    if (this.m_altiumPortsCurrentSheet.length > 0 || this.m_currentTitleBlock) return;

    this.m_currentTitleBlock = new TITLE_BLOCK();

    // index is required to resolve OWNERINDEX
    let index = 0;

    while (reader.CanRead()) {
      const properties = reader.ReadProperties();

      // Reset index at headers
      if (properties.has('HEADER')) {
        index = 0;
        continue;
      }

      if (properties.has('RECORD')) this.ParseRecord(index, properties, aFileName);

      index++;
    }

    if (reader.HasParsingError()) throw new IO_ERROR('stream was not parsed correctly!');

    if (reader.CanRead()) throw new IO_ERROR('stream is not fully parsed');

    this.finishSheet();

    // Handle harness Ports
    for (const port of this.m_altiumHarnessPortsCurrentSheet) this.ParseHarnessPort(port);

    // Handle Ports
    for (const port of this.m_altiumPortsCurrentSheet) this.ParsePort(port);

    // Add the aliases used for harnesses
    this.CreateAliases();

    // Wrap net labels sitting on bus lines in curly braces so KiCad recognizes them
    this.PostProcessBusLabels();

    // Assign default names to any sheet symbols that didn't get a SHEET_NAME record
    this.EnsureSheetSymbolNames();

    this.m_altiumHarnesses.clear();
    this.m_altiumPortsCurrentSheet = [];
    this.m_altiumComponents.clear();
    this.m_altiumTemplates.clear();
    this.m_altiumImplementationList.clear();

    this.m_symbols.clear();
    this.m_libSymbols.clear();

    // Otherwise we cannot save the imported sheet?
    const sheet = this.getCurrentSheet();

    if (!sheet) return;

    sheet.SetModified();
  }

  ParseRecord(index: number, properties: ALTIUM_PROPS, aSectionName: string): void {
    const recordId = ALTIUM_PROPS_UTILS.ReadInt(properties as PROPS, 'RECORD', -1);
    const record = recordId as ALTIUM_SCH_RECORD;
    const R = ALTIUM_SCH_RECORD;

    // see: https://github.com/vadmium/python-altium/blob/master/format.md
    switch (record) {
      // FileHeader section

      case R.HEADER:
        throw new IO_ERROR('Header already parsed');

      case R.COMPONENT:
        this.ParseComponent(index, properties);
        break;

      case R.PIN:
        this.ParsePin(properties);
        break;

      case R.IEEE_SYMBOL:
        this.error("Record 'IEEE_SYMBOL' not handled.", RPT_SEVERITY_INFO);
        break;

      case R.LABEL:
        this.ParseLabel(properties);
        break;

      case R.BEZIER:
        this.ParseBezier(properties);
        break;

      case R.POLYLINE:
        this.ParsePolyline(properties);
        break;

      case R.POLYGON:
        this.ParsePolygon(properties);
        break;

      case R.ELLIPSE:
        this.ParseEllipse(properties);
        break;

      case R.PIECHART:
        this.ParsePieChart(properties);
        break;

      case R.ROUND_RECTANGLE:
        this.ParseRoundRectangle(properties);
        break;

      case R.ELLIPTICAL_ARC:
      case R.ARC:
        this.ParseArc(properties);
        break;

      case R.LINE:
        this.ParseLine(properties);
        break;

      case R.RECTANGLE:
        this.ParseRectangle(properties);
        break;

      case R.SHEET_SYMBOL:
        this.ParseSheetSymbol(index, properties);
        break;

      case R.SHEET_ENTRY:
        this.ParseSheetEntry(properties);
        break;

      case R.POWER_PORT:
        this.ParsePowerPort(properties);
        break;

      case R.PORT:
        // Ports are parsed after the sheet was parsed
        // This is required because we need all electrical connection points before placing.
        this.m_altiumPortsCurrentSheet.push(new ASCH_PORT(properties));
        break;

      case R.NO_ERC:
        this.ParseNoERC(properties);
        break;

      case R.NET_LABEL:
        this.ParseNetLabel(properties);
        break;

      case R.BUS:
        this.ParseBus(properties);
        break;

      case R.WIRE:
        this.ParseWire(properties);
        break;

      case R.TEXT_FRAME:
        this.ParseTextFrame(properties);
        break;

      case R.JUNCTION:
        this.ParseJunction(properties);
        break;

      case R.IMAGE:
        this.ParseImage(properties);
        break;

      case R.SHEET:
        this.ParseSheet(properties);
        break;

      case R.SHEET_NAME:
        this.ParseSheetName(properties);
        break;

      case R.FILE_NAME:
        this.ParseFileName(properties);
        break;

      case R.DESIGNATOR:
        this.ParseDesignator(properties);
        break;

      case R.BUS_ENTRY:
        this.ParseBusEntry(properties);
        break;

      case R.TEMPLATE:
        this.ParseTemplate(index, properties);
        break;

      case R.PARAMETER:
        this.ParseParameter(properties);
        break;

      case R.PARAMETER_SET:
        this.error('Parameter Set not currently supported.', RPT_SEVERITY_ERROR);
        break;

      case R.IMPLEMENTATION_LIST:
        this.ParseImplementationList(index, properties);
        break;

      case R.IMPLEMENTATION:
        this.ParseImplementation(properties);
        break;

      case R.MAP_DEFINER_LIST:
      case R.MAP_DEFINER:
      case R.IMPL_PARAMS:
        break;

      case R.NOTE:
        this.ParseNote(properties);
        break;

      case R.COMPILE_MASK:
        this.error('Compile mask not currently supported.', RPT_SEVERITY_ERROR);
        break;

      case R.HYPERLINK:
        break;

      // Additional section

      case R.HARNESS_CONNECTOR:
        this.ParseHarnessConnector(index, properties);
        break;

      case R.HARNESS_ENTRY:
        this.ParseHarnessEntry(properties);
        break;

      case R.HARNESS_TYPE:
        this.ParseHarnessType(properties);
        break;

      case R.SIGNAL_HARNESS:
        this.ParseSignalHarness(properties);
        break;

      case R.BLANKET:
        this.error('Blanket not currently supported.', RPT_SEVERITY_ERROR);
        break;

      default:
        this.error(
          `Unknown or unexpected record id ${recordId} found in ${aSectionName}.`,
          RPT_SEVERITY_ERROR,
        );
        break;
    }

    this.m_harnessOwnerIndexOffset = index;
  }

  private IsComponentPartVisible(aElem: ASCH_OWNER_INTERFACE): boolean {
    const component = this.m_altiumComponents.get(aElem.ownerindex);

    if (component) return component.displaymode === aElem.ownerpartdisplaymode;

    if (this.m_altiumTemplates.has(aElem.ownerindex)) return true;

    return false;
  }

  private GetFileFromStorage(aFilename: string): ASCH_STORAGE_FILE | null {
    let nonExactMatch: ASCH_STORAGE_FILE | null = null;

    for (const file of this.m_altiumStorage) {
      if (file.filename === aFilename) return file;

      if (file.filename.endsWith(aFilename)) nonExactMatch = file;
    }

    return nonExactMatch;
  }

  /**
   * The library symbol an item drawn in a symbol belongs to: `aSymbol[ ownerpartdisplaymode ]`
   * when reading a library, else the component that owns it (with its placed SCH_SYMBOL). Null,
   * with the "%s's owner (%d) not found." message, when there is none.
   */
  private owner(
    aElem: ASCH_OWNER_INTERFACE,
    aSymbol: LIB_SYMBOL[],
    aKind: string,
  ): { symbol: LIB_SYMBOL; schsym: SCH_SYMBOL | null } | null {
    const fromLib =
      aSymbol.length <= aElem.ownerpartdisplaymode ? null : aSymbol[aElem.ownerpartdisplaymode]!;

    if (fromLib) return { symbol: fromLib, schsym: null };

    const libSymbol = this.m_libSymbols.get(aElem.ownerindex);

    if (!libSymbol) {
      // TODO: e.g. can depend on Template (RECORD=39
      this.error(`${aKind}'s owner (${aElem.ownerindex}) not found.`, RPT_SEVERITY_DEBUG);
      return null;
    }

    const schsym = this.m_symbols.get(aElem.ownerindex);

    if (!schsym) throw new IO_ERROR('map::at');

    return { symbol: libSymbol, schsym };
  }

  private ParseComponent(aIndex: number, aProperties: ALTIUM_PROPS): void {
    const currentSheet = this.m_sheetPath.Last();
    if (!currentSheet) return;

    let sheetName = currentSheet.GetName();

    if (sheetName === '') sheetName = 'root';

    const altiumSymbol = new ASCH_SYMBOL(aProperties);

    const current = this.m_altiumComponents.get(aIndex);

    if (current) {
      this.error(
        `Symbol '${current.libreference}' in sheet '${sheetName}' at index ${aIndex} replaced with symbol "${altiumSymbol.libreference}".`,
        RPT_SEVERITY_ERROR,
      );
    }

    // `std::map::insert`: an existing index keeps its symbol.
    if (!current) this.m_altiumComponents.set(aIndex, altiumSymbol);
    const elem = this.m_altiumComponents.get(aIndex)!;

    let name: string;
    let libId: LIB_ID;

    if (elem.sourcelibraryname !== '' && elem.libreference !== '') {
      // The part comes from an Altium library that project import registers in the symbol
      // library table, so address it by its real library id and let the placement transform
      // ride on the SCH_SYMBOL rather than baking it into a unique name. Altium stores Windows
      // paths, so split the source library name accordingly.
      name = elem.libreference;
      libId = AltiumToKiCadLibID(winPathName(elem.sourcelibraryname), name);
    } else {
      // TODO: this is a hack until we correctly apply all transformations to every element
      name = `${sheetName}_${elem.orientation}${elem.isMirrored ? '_mirrored' : ''}_${elem.libreference}_${elem.sourcelibraryname}`;

      if (elem.displaymodecount > 1) name += `_${elem.displaymode}`;

      libId = AltiumToKiCadLibID(this.getLibName(), name);
    }

    const ksymbol = new LIB_SYMBOL('');
    ksymbol.SetName(name);
    ksymbol.SetDescription(elem.componentdescription);
    ksymbol.SetLibId(libId);

    // Altium PARTCOUNT is one more than the actual unit count. The property may be missing
    // (defaults to 0) or otherwise nonsensical, so clamp to a minimum of 1 unit.
    ksymbol.SetUnitCount(Math.max(1, elem.partcount - 1), true);
    if (!this.m_libSymbols.has(aIndex)) this.m_libSymbols.set(aIndex, ksymbol);

    // each component has its own symbol for now
    const symbol = new SCH_SYMBOL();

    symbol.SetPosition(add(elem.location, this.m_sheetOffset));

    for (const field of symbol.GetFields()) field.SetVisible(false);

    let orientation: number = SYMBOL_ORIENTATION_T.SYM_ORIENT_0;

    // Altium encodes symbol rotation as quarter turns CCW, matching KiCad's SYM_ORIENT_* angles
    // one for one. The stored value must equal the Altium angle so a later "Update Symbols from
    // Library" against a canonical upright symbol does not rotate the placement.
    switch (elem.orientation) {
      case 0:
        orientation = SYMBOL_ORIENTATION_T.SYM_ORIENT_0;
        break;
      case 1:
        orientation = SYMBOL_ORIENTATION_T.SYM_ORIENT_90;
        break;
      case 2:
        orientation = SYMBOL_ORIENTATION_T.SYM_ORIENT_180;
        break;
      case 3:
        orientation = SYMBOL_ORIENTATION_T.SYM_ORIENT_270;
        break;
      default:
        break;
    }

    if (elem.isMirrored) orientation += SYMBOL_ORIENTATION_T.SYM_MIRROR_Y;

    symbol.SetOrientation(orientation);

    symbol.SetLibId(libId);

    if (ksymbol.GetUnitCount() > 1) symbol.SetUnit(Math.max(1, elem.currentpartid));
    else symbol.SetUnit(1);

    symbol.GetField(FIELD_T.DESCRIPTION)!.SetText(elem.componentdescription);

    const screen = this.getCurrentScreen();
    if (!screen) return;

    screen.Append(symbol);

    if (!this.m_symbols.has(aIndex)) this.m_symbols.set(aIndex, symbol);

    if (elem.uniqueid !== '') this.m_altiumSymbolToUid.set(symbol, elem.uniqueid);
  }

  private ParseTemplate(aIndex: number, aProperties: ALTIUM_PROPS): void {
    const currentSheet = this.m_sheetPath.Last();
    if (!currentSheet) return;

    const altiumTemplate = new ASCH_TEMPLATE(aProperties);

    if (!this.m_altiumTemplates.has(aIndex)) this.m_altiumTemplates.set(aIndex, altiumTemplate);
    // No need to create a symbol - graphics is put on the sheet
  }

  private ParsePin(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_PIN(aProperties);

    let symbol =
      aSymbol.length <= elem.ownerpartdisplaymode ? null : aSymbol[elem.ownerpartdisplaymode]!;
    let schSymbol: SCH_SYMBOL | null = null;

    if (!symbol) {
      const libSymbol = this.m_libSymbols.get(elem.ownerindex);

      if (!libSymbol) {
        // TODO: e.g. can depend on Template (RECORD=39
        this.error(`Pin's owner (${elem.ownerindex}) not found.`, RPT_SEVERITY_DEBUG);
        return;
      }

      if (!this.IsComponentPartVisible(elem)) return;

      schSymbol = this.m_symbols.get(elem.ownerindex) ?? null;

      if (!schSymbol) throw new IO_ERROR('map::at');

      symbol = libSymbol;
    }

    const pin = new SCH_PIN(symbol as unknown as EDA_ITEM);

    // Make sure that these are visible when initializing the symbol
    // This may be overriden by the file data but not by the pin defaults
    pin.SetNameTextSize(schIUScale.milsToIU(DEFAULT_PINNAME_SIZE));
    pin.SetNumberTextSize(schIUScale.milsToIU(DEFAULT_PINNUM_SIZE));

    symbol.AddDrawItem(pin, false);

    pin.SetUnit(Math.max(0, elem.ownerpartid));

    pin.SetName(AltiumPinNamesToKiCad(elem.name));
    pin.SetNumber(AltiumPinDesignatorToKiCad(elem.designator));
    pin.SetLength(elem.pinlength);

    if (elem.hidden) pin.SetVisible(false);

    if (!elem.showDesignator) pin.SetNumberTextSize(0);

    if (!elem.showPinName) pin.SetNameTextSize(0);

    // Altium gives the pin body end location (elem.location) and the pre-computed
    // electrical connection point (elem.kicadLocation) which accounts for pin length
    // with combined integer+fractional arithmetic to avoid rounding errors.
    let bodyEnd = elem.location;
    let pinLocation = elem.kicadLocation;

    switch (elem.orientation) {
      case ASCH_RECORD_ORIENTATION.RIGHTWARDS:
        pin.SetOrientation(PIN_ORIENTATION.PIN_LEFT);
        break;

      case ASCH_RECORD_ORIENTATION.UPWARDS:
        pin.SetOrientation(PIN_ORIENTATION.PIN_DOWN);
        break;

      case ASCH_RECORD_ORIENTATION.LEFTWARDS:
        pin.SetOrientation(PIN_ORIENTATION.PIN_RIGHT);
        break;

      case ASCH_RECORD_ORIENTATION.DOWNWARDS:
        pin.SetOrientation(PIN_ORIENTATION.PIN_UP);
        break;

      default:
        this.error('Pin has unexpected orientation.', RPT_SEVERITY_WARNING);
        break;
    }

    if (schSymbol) {
      // Both points are in absolute schematic coordinates.  Transform them to library-local
      // space, then derive the pin orientation from the resulting direction vector.
      pinLocation = GetRelativePosition(add(pinLocation, this.m_sheetOffset), schSymbol);
      bodyEnd = GetRelativePosition(add(bodyEnd, this.m_sheetOffset), schSymbol);

      const dir = sub(bodyEnd, pinLocation);

      if (Math.abs(dir.x) >= Math.abs(dir.y))
        pin.SetOrientation(dir.x > 0 ? PIN_ORIENTATION.PIN_RIGHT : PIN_ORIENTATION.PIN_LEFT);
      else pin.SetOrientation(dir.y > 0 ? PIN_ORIENTATION.PIN_DOWN : PIN_ORIENTATION.PIN_UP);
    }

    pin.SetPosition(pinLocation);

    switch (elem.electrical) {
      case ASCH_PIN_ELECTRICAL.PIN_INPUT:
        pin.SetType(ELECTRICAL_PINTYPE.PT_INPUT);
        break;

      case ASCH_PIN_ELECTRICAL.BIDI:
        pin.SetType(ELECTRICAL_PINTYPE.PT_BIDI);
        break;

      case ASCH_PIN_ELECTRICAL.OUTPUT:
        pin.SetType(ELECTRICAL_PINTYPE.PT_OUTPUT);
        break;

      case ASCH_PIN_ELECTRICAL.OPEN_COLLECTOR:
        pin.SetType(ELECTRICAL_PINTYPE.PT_OPENCOLLECTOR);
        break;

      case ASCH_PIN_ELECTRICAL.PASSIVE:
        pin.SetType(ELECTRICAL_PINTYPE.PT_PASSIVE);
        break;

      case ASCH_PIN_ELECTRICAL.TRISTATE:
        pin.SetType(ELECTRICAL_PINTYPE.PT_TRISTATE);
        break;

      case ASCH_PIN_ELECTRICAL.OPEN_EMITTER:
        pin.SetType(ELECTRICAL_PINTYPE.PT_OPENEMITTER);
        break;

      case ASCH_PIN_ELECTRICAL.POWER:
        pin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
        break;

      default:
        pin.SetType(ELECTRICAL_PINTYPE.PT_UNSPECIFIED);
        this.error('Pin has unexpected electrical type.', RPT_SEVERITY_WARNING);
        break;
    }

    if (elem.symbolOuterEdge === ASCH_PIN_SYMBOL.UNKNOWN)
      this.error('Pin has unexpected outer edge type.', RPT_SEVERITY_WARNING);

    if (elem.symbolInnerEdge === ASCH_PIN_SYMBOL.UNKNOWN)
      this.error('Pin has unexpected inner edge type.', RPT_SEVERITY_WARNING);

    if (elem.symbolOuterEdge === ASCH_PIN_SYMBOL.NEGATED) {
      if (elem.symbolInnerEdge === ASCH_PIN_SYMBOL.CLOCK)
        pin.SetShape(GRAPHIC_PINSHAPE.INVERTED_CLOCK);
      else pin.SetShape(GRAPHIC_PINSHAPE.INVERTED);
    } else if (elem.symbolOuterEdge === ASCH_PIN_SYMBOL.LOW_INPUT) {
      if (elem.symbolInnerEdge === ASCH_PIN_SYMBOL.CLOCK) pin.SetShape(GRAPHIC_PINSHAPE.CLOCK_LOW);
      else pin.SetShape(GRAPHIC_PINSHAPE.INPUT_LOW);
    } else if (elem.symbolOuterEdge === ASCH_PIN_SYMBOL.LOW_OUTPUT) {
      pin.SetShape(GRAPHIC_PINSHAPE.OUTPUT_LOW);
    } else {
      if (elem.symbolInnerEdge === ASCH_PIN_SYMBOL.CLOCK) pin.SetShape(GRAPHIC_PINSHAPE.CLOCK);
      else pin.SetShape(GRAPHIC_PINSHAPE.LINE); // nothing to do
    }
  }

  private ShouldPutItemOnSheet(aOwnerindex: number): boolean {
    // No component assigned -> Put on sheet
    if (aOwnerindex === ALTIUM_COMPONENT_NONE) return true;

    // For a template -> Put on sheet so we can resolve variables
    if (this.m_altiumTemplates.has(aOwnerindex)) return true;

    return false;
  }

  private static readonly s_labelVariableMap = new Map<string, string>([
    ['APPLICATION_BUILDNUMBER', 'KICAD_VERSION'],
    ['SHEETNUMBER', '#'],
    ['SHEETTOTAL', '##'],
    ['TITLE', 'TITLE'], // including 1:1 maps makes it easier
    ['REVISION', 'REVISION'], //   to see that the list is complete
    ['DATE', 'ISSUE_DATE'],
    ['CURRENTDATE', 'CURRENT_DATE'],
    ['COMPANYNAME', 'COMPANY'],
    ['DOCUMENTNAME', 'FILENAME'],
    ['DOCUMENTFULLPATHANDNAME', 'FILEPATH'],
    ['PROJECTNAME', 'PROJECTNAME'],
  ]);

  /** A sheet font by its 1-based id: `m_altiumSheet->fonts.at( fontId - 1 )`. */
  private sheetFont(aFontId: number) {
    const fonts = this.m_altiumSheet?.fonts;
    return fonts && aFontId > 0 && aFontId <= fonts.length ? fonts[aFontId - 1]! : null;
  }

  private ParseLabel(
    aProperties: ALTIUM_PROPS,
    aSymbol: LIB_SYMBOL[] = [],
    aFontSizes: number[] = [],
  ): void {
    const elem = new ASCH_LABEL(aProperties);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const kicadText = AltiumSchSpecialStringsToKiCadVariables(
        elem.text,
        SCH_IO_ALTIUM.s_labelVariableMap,
      );
      const textItem = new SCH_TEXT(add(elem.location, this.m_sheetOffset), kicadText);

      SetTextPositioning(textItem, elem.justification, elem.orientation);

      const font = this.sheetFont(elem.fontId);

      if (font) {
        textItem.SetTextSize({ x: Math.trunc(font.Size / 2), y: Math.trunc(font.Size / 2) });

        // Must come after SetTextSize()
        textItem.SetBold(font.Bold);
        textItem.SetItalic(font.Italic);
      }

      textItem.SetFlags(IS_NEW);

      const screen = this.getCurrentScreen();
      if (!screen) return;

      screen.Append(textItem);
    } else {
      const o = this.owner(elem, aSymbol, 'Label');

      if (!o) return;

      const { symbol, schsym } = o;

      let pos = elem.location;
      const textItem = new SCH_TEXT({ x: 0, y: 0 }, elem.text, SCH_LAYER_ID.LAYER_DEVICE);
      symbol.AddDrawItem(textItem, false);

      /// Handle labels that are in a library symbol, not on schematic
      if (schsym) pos = GetRelativePosition(add(elem.location, this.m_sheetOffset), schsym);

      textItem.SetPosition(pos);
      textItem.SetUnit(Math.max(0, elem.ownerpartid));
      SetTextPositioning(textItem, elem.justification, elem.orientation);

      if (schsym) {
        const altiumSym = this.m_altiumComponents.get(elem.ownerindex);

        if (altiumSym) AdjustTextForSymbolOrientation(textItem, altiumSym);
      }

      const fontId = elem.fontId;
      const font = this.sheetFont(fontId);

      if (font) {
        textItem.SetTextSize({ x: Math.trunc(font.Size / 2), y: Math.trunc(font.Size / 2) });

        // Must come after SetTextSize()
        textItem.SetBold(font.Bold);
        textItem.SetItalic(font.Italic);
      } else if (fontId > 0 && fontId <= aFontSizes.length) {
        const size = aFontSizes[fontId - 1]!;
        textItem.SetTextSize({ x: size, y: size });
      }
    }
  }

  private ParseTextFrame(
    aProperties: ALTIUM_PROPS,
    aSymbol: LIB_SYMBOL[] = [],
    aFontSizes: number[] = [],
  ): void {
    const elem = new ASCH_TEXT_FRAME(aProperties);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) this.AddTextBox(elem);
    else this.AddLibTextBox(elem, aSymbol, aFontSizes);
  }

  private ParseNote(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_NOTE(aProperties);
    this.AddTextBox(elem);

    // TODO: need some sort of property system for storing author....
  }

  private textBoxAlignment(aBox: SCH_TEXTBOX, aAlignment: ASCH_TEXT_FRAME_ALIGNMENT): void {
    switch (aAlignment) {
      case ASCH_TEXT_FRAME_ALIGNMENT.CENTER:
        aBox.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        break;
      case ASCH_TEXT_FRAME_ALIGNMENT.RIGHT:
        aBox.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        break;
      default:
        aBox.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        break;
    }
  }

  private AddTextBox(aElem: ASCH_TEXT_FRAME): void {
    const textBox = new SCH_TEXTBOX();

    const sheetTopRight = add(aElem.TopRight, this.m_sheetOffset);
    const sheetBottomLeft = add(aElem.BottomLeft, this.m_sheetOffset);

    textBox.SetStart(sheetTopRight);
    textBox.SetEnd(sheetBottomLeft);

    textBox.SetText(aElem.Text);

    textBox.SetFillColor(GetColorFromInt(aElem.AreaColor));

    if (aElem.isSolid) textBox.SetFillMode(FILL_T.FILLED_WITH_COLOR);
    else textBox.SetFilled(false);

    if (aElem.ShowBorder)
      textBox.SetStroke(
        new STROKE_PARAMS(0, LINE_STYLE.DEFAULT, GetColorFromInt(aElem.BorderColor)),
      );
    else
      textBox.SetStroke(
        new STROKE_PARAMS(-1, LINE_STYLE.DEFAULT, GetColorFromInt(aElem.BorderColor)),
      );

    this.textBoxAlignment(textBox, aElem.Alignment);

    const font = this.sheetFont(aElem.FontID);

    if (font) {
      textBox.SetTextSize({ x: Math.trunc(font.Size / 2), y: Math.trunc(font.Size / 2) });

      // Must come after SetTextSize()
      textBox.SetBold(font.Bold);
      textBox.SetItalic(font.Italic);
      //textBox->SetFont(  //how to set font, we have a font name here: ( font.fontname );
    }

    textBox.SetFlags(IS_NEW);

    const screen = this.getCurrentScreen();
    if (!screen) return;

    screen.Append(textBox);
  }

  private AddLibTextBox(aElem: ASCH_TEXT_FRAME, aSymbol: LIB_SYMBOL[], aFontSizes: number[]): void {
    const o = this.owner(aElem, aSymbol, 'Label');

    if (!o) return;

    const { symbol, schsym } = o;

    const textBox = new SCH_TEXTBOX(SCH_LAYER_ID.LAYER_DEVICE);

    textBox.SetUnit(Math.max(0, aElem.ownerpartid));
    symbol.AddDrawItem(textBox, false);

    /// Handle text frames that are in a library symbol, not on schematic
    if (!schsym) {
      textBox.SetStart(aElem.TopRight);
      textBox.SetEnd(aElem.BottomLeft);
    } else {
      textBox.SetStart(GetRelativePosition(add(aElem.TopRight, this.m_sheetOffset), schsym));
      textBox.SetEnd(GetRelativePosition(add(aElem.BottomLeft, this.m_sheetOffset), schsym));
    }

    textBox.SetText(aElem.Text);

    textBox.SetFillColor(GetColorFromInt(aElem.AreaColor));

    if (aElem.isSolid) textBox.SetFillMode(FILL_T.FILLED_WITH_COLOR);
    else textBox.SetFilled(false);

    if (aElem.ShowBorder)
      textBox.SetStroke(
        new STROKE_PARAMS(0, LINE_STYLE.DEFAULT, GetColorFromInt(aElem.BorderColor)),
      );
    else textBox.SetStroke(new STROKE_PARAMS(-1));

    this.textBoxAlignment(textBox, aElem.Alignment);

    if (aElem.FontID > 0 && aElem.FontID <= aFontSizes.length) {
      const size = aFontSizes[aElem.FontID - 1]!;
      textBox.SetTextSize({ x: size, y: size });
    }
  }

  /** A library-local point: through the placed symbol's inverse transform when there is one. */
  private rel(aPos: VECTOR2I, aSchsym: SCH_SYMBOL | null): VECTOR2I {
    return aSchsym ? GetRelativePosition(add(aPos, this.m_sheetOffset), aSchsym) : aPos;
  }

  private ParseBezier(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_BEZIER(aProperties);

    if (elem.points.length < 2) {
      this.error(
        `Bezier has ${elem.points.length} control points. At least 2 are expected.`,
        RPT_SEVERITY_WARNING,
      );
      return;
    }

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const currentScreen = this.getCurrentScreen();
      if (!currentScreen) return;

      for (let i = 0; i + 1 < elem.points.length; i += 3) {
        if (i + 2 === elem.points.length) {
          // special case: single line
          const line = new SCH_LINE(
            add(elem.points[i]!, this.m_sheetOffset),
            SCH_LAYER_ID.LAYER_NOTES,
          );

          line.SetEndPoint(add(elem.points[i + 1]!, this.m_sheetOffset));
          line.SetStroke(new STROKE_PARAMS(elem.LineWidth, LINE_STYLE.SOLID));

          line.SetFlags(IS_NEW);

          currentScreen.Append(line);
        } else {
          // simulate Bezier using line segments
          const bezierPoints: VECTOR2I[] = [];

          for (let j = i; j < elem.points.length && j < i + 4; j++)
            bezierPoints.push(elem.points[j]!);

          // `BEZIER_POLY( std::vector<VECTOR2I> ).GetPoly( polyPoints )`: aMaxError = 10
          const polyPoints = new BezierPoly(bezierPoints).getPoly(10);

          for (let k = 0; k + 1 < polyPoints.length; k++) {
            const line = new SCH_LINE(
              add(polyPoints[k]!, this.m_sheetOffset),
              SCH_LAYER_ID.LAYER_NOTES,
            );

            line.SetEndPoint(add(polyPoints[k + 1]!, this.m_sheetOffset));
            line.SetStroke(new STROKE_PARAMS(elem.LineWidth, LINE_STYLE.SOLID));

            line.SetFlags(IS_NEW);
            currentScreen.Append(line);
          }
        }
      }
    } else {
      const o = this.owner(elem, aSymbol, 'Bezier');

      if (!o) return;

      const { symbol, schsym } = o;

      if (aSymbol.length === 0 && !this.IsComponentPartVisible(elem)) return;

      for (let i = 0; i + 1 < elem.points.length; i += 3) {
        if (i + 2 === elem.points.length || i + 3 === elem.points.length) {
          // special case: single line (and, i + 3, a single line with an extra point: the
          // sample document in https://gitlab.com/kicad/code/kicad/-/issues/8974 responds
          // best to treating it as another single line special case)
          const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
          symbol.AddDrawItem(line, false);

          line.SetUnit(Math.max(0, elem.ownerpartid));

          for (let j = i; j < elem.points.length && j < i + 2; j++)
            line.AddPoint(this.rel(elem.points[j]!, schsym));

          line.SetStroke(new STROKE_PARAMS(elem.LineWidth, LINE_STYLE.SOLID));
        } else {
          // Bezier always has exactly 4 control points
          const bezier = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_DEVICE);
          symbol.AddDrawItem(bezier, false);

          bezier.SetUnit(Math.max(0, elem.ownerpartid));

          for (let j = i; j < elem.points.length && j < i + 4; j++) {
            const pos = this.rel(elem.points[j]!, schsym);

            switch (j - i) {
              case 0:
                bezier.SetStart(pos);
                break;
              case 1:
                bezier.SetBezierC1(pos);
                break;
              case 2:
                bezier.SetBezierC2(pos);
                break;
              case 3:
                bezier.SetEnd(pos);
                break;
              default:
                break; // Can't get here but silence warnings
            }
          }

          bezier.SetStroke(new STROKE_PARAMS(elem.LineWidth, LINE_STYLE.SOLID));
          bezier.RebuildBezierToSegmentsPointsList(schIUScale.mmToIU(ARC_LOW_DEF_MM));
        }
      }
    }
  }

  private ParsePolyline(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_POLYLINE(aProperties);

    if (elem.Points.length < 2) return;

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const screen = this.getCurrentScreen();
      if (!screen) return;

      for (let i = 1; i < elem.Points.length; i++) {
        const line = new SCH_LINE();

        line.SetStartPoint(add(elem.Points[i - 1]!, this.m_sheetOffset));
        line.SetEndPoint(add(elem.Points[i]!, this.m_sheetOffset));

        line.SetStroke(
          new STROKE_PARAMS(
            elem.LineWidth,
            GetPlotDashType(elem.LineStyle),
            GetColorFromInt(elem.Color),
          ),
        );

        line.SetFlags(IS_NEW);

        screen.Append(line);
      }
    } else {
      const o = this.owner(elem, aSymbol, 'Polyline');

      if (!o) return;

      const { symbol, schsym } = o;

      if (aSymbol.length === 0 && !this.IsComponentPartVisible(elem)) return;

      const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
      symbol.AddDrawItem(line, false);

      line.SetUnit(Math.max(0, elem.ownerpartid));

      for (const point of elem.Points) line.AddPoint(this.rel(point, schsym));

      SetLibShapeLine(elem, line, ALTIUM_SCH_RECORD.POLYLINE);
      const stroke = line.GetStroke();
      stroke.SetLineStyle(GetPlotDashType(elem.LineStyle));

      line.SetStroke(stroke);
    }
  }

  private ParsePolygon(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_POLYGON(aProperties);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const screen = this.getCurrentScreen();
      if (!screen) return;

      const poly = new SCH_SHAPE(SHAPE_T.POLY);

      for (const point of elem.points) poly.AddPoint(add(point, this.m_sheetOffset));
      // `elem.points.front()`: undefined behaviour upstream on an empty polygon.
      if (elem.points.length > 0) poly.AddPoint(add(elem.points[0]!, this.m_sheetOffset));

      SetSchShapeLine(elem, poly);
      SetSchShapeFillAndColor(elem, poly);
      poly.SetFlags(IS_NEW);

      screen.Append(poly);
    } else {
      const o = this.owner(elem, aSymbol, 'Polygon');

      if (!o) return;

      const { symbol, schsym } = o;

      if (aSymbol.length === 0 && !this.IsComponentPartVisible(elem)) return;

      const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

      symbol.AddDrawItem(line, false);
      line.SetUnit(Math.max(0, elem.ownerpartid));

      for (const point of elem.points) line.AddPoint(this.rel(point, schsym));

      if (elem.points.length > 0) line.AddPoint(this.rel(elem.points[0]!, schsym));

      SetLibShapeLine(elem, line, ALTIUM_SCH_RECORD.POLYGON);
      SetLibShapeFillAndColor(elem, line, ALTIUM_SCH_RECORD.POLYGON, elem.Color);

      if (
        colorEq(line.GetFillColor(), line.GetStroke().GetColor()) &&
        line.GetFillMode() !== FILL_T.NO_FILL
      ) {
        const stroke = line.GetStroke();
        stroke.SetWidth(-1);
        line.SetStroke(stroke);
      }
    }
  }

  private ParseRoundRectangle(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_ROUND_RECTANGLE(aProperties);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const screen = this.getCurrentScreen();
      if (!screen) return;

      // TODO: misses rounded edges
      const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE);

      rect.SetPosition(add(elem.TopRight, this.m_sheetOffset));
      rect.SetEnd(add(elem.BottomLeft, this.m_sheetOffset));
      SetSchShapeLine(elem, rect);
      SetSchShapeFillAndColor(elem, rect);
      rect.SetFlags(IS_NEW);

      screen.Append(rect);
    } else {
      const o = this.owner(elem, aSymbol, 'Rounded rectangle');

      if (!o) return;

      const { symbol, schsym } = o;

      if (aSymbol.length === 0 && !this.IsComponentPartVisible(elem)) return;

      let rect: SCH_SHAPE;

      const width = Math.abs(elem.TopRight.x - elem.BottomLeft.x);
      const height = Math.abs(elem.TopRight.y - elem.BottomLeft.y);

      // If it is a circle, make it a circle
      if (
        Math.abs(elem.CornerRadius.x) >= Math.trunc(width / 2) &&
        Math.abs(elem.CornerRadius.y) >= Math.trunc(height / 2)
      ) {
        rect = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);

        // `( TopRight + BottomLeft ) / 2`: VECTOR2<int>::operator/( double ) rounds.
        let center: VECTOR2I = {
          x: KiROUND((elem.TopRight.x + elem.BottomLeft.x) / 2),
          y: KiROUND((elem.TopRight.y + elem.BottomLeft.y) / 2),
        };
        const radius = Math.min(Math.trunc(width / 2), Math.trunc(height / 2));

        center = this.rel(center, schsym);

        rect.SetPosition(center);
        rect.SetEnd({ x: rect.GetPosition().x + radius, y: rect.GetPosition().y });
      } else {
        rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);

        rect.SetPosition(this.rel(elem.TopRight, schsym));
        rect.SetEnd(this.rel(elem.BottomLeft, schsym));

        rect.Normalize();
      }

      SetLibShapeLine(elem, rect, ALTIUM_SCH_RECORD.ROUND_RECTANGLE);
      SetLibShapeFillAndColor(elem, rect, ALTIUM_SCH_RECORD.ROUND_RECTANGLE, elem.Color);

      symbol.AddDrawItem(rect, false);
      rect.SetUnit(Math.max(0, elem.ownerpartid));
    }
  }

  /** `KiROUND( r * cos, -( r * sin ) )` of an arc's end angle and start angle. */
  private static arcOffsets(elem: ASCH_ARC): { startOffset: VECTOR2I; endOffset: VECTOR2I } {
    const arc_radius = elem.m_Radius;
    const startAngle = new EDA_ANGLE(elem.m_EndAngle);
    const endAngle = new EDA_ANGLE(elem.m_StartAngle);
    return {
      startOffset: {
        x: KiROUND(arc_radius * startAngle.Cos()),
        y: KiROUND(-(arc_radius * startAngle.Sin())),
      },
      endOffset: {
        x: KiROUND(arc_radius * endAngle.Cos()),
        y: KiROUND(-(arc_radius * endAngle.Sin())),
      },
    };
  }

  private ParseArc(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_ARC(aProperties);

    const arc_radius = elem.m_Radius;
    let center = elem.m_Center;
    let { startOffset, endOffset } = SCH_IO_ALTIUM.arcOffsets(elem);
    const isCircle = elem.m_StartAngle === 0 && (elem.m_EndAngle === 0 || elem.m_EndAngle === 360);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const currentScreen = this.getCurrentScreen();
      if (!currentScreen) return;

      if (isCircle) {
        const circle = new SCH_SHAPE(SHAPE_T.CIRCLE);

        circle.SetPosition(add(elem.m_Center, this.m_sheetOffset));
        circle.SetEnd(add(circle.GetPosition(), { x: arc_radius, y: 0 }));

        SetSchShapeLine(elem, circle);
        SetSchShapeFillAndColor(elem, circle);

        currentScreen.Append(circle);
      } else {
        const arc = new SCH_SHAPE(SHAPE_T.ARC);

        arc.SetCenter(add(elem.m_Center, this.m_sheetOffset));
        arc.SetStart(add(add(elem.m_Center, startOffset), this.m_sheetOffset));
        arc.SetEnd(add(add(elem.m_Center, endOffset), this.m_sheetOffset));

        SetSchShapeLine(elem, arc);
        SetSchShapeFillAndColor(elem, arc);

        currentScreen.Append(arc);
      }
    } else {
      const o = this.owner(elem, aSymbol, 'Arc');

      if (!o) return;

      const { symbol, schsym } = o;

      if (aSymbol.length === 0 && !this.IsComponentPartVisible(elem)) return;

      if (isCircle) {
        const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);
        symbol.AddDrawItem(circle, false);

        circle.SetUnit(Math.max(0, elem.ownerpartid));

        center = this.rel(center, schsym);

        circle.SetPosition(center);

        circle.SetEnd(add(circle.GetPosition(), { x: arc_radius, y: 0 }));
        SetLibShapeLine(elem, circle, ALTIUM_SCH_RECORD.ARC);
        SetLibShapeFillAndColor(elem, circle, ALTIUM_SCH_RECORD.ARC, elem.Color);
      } else {
        const arc = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);
        symbol.AddDrawItem(arc, false);
        arc.SetUnit(Math.max(0, elem.ownerpartid));

        if (schsym) {
          center = GetRelativePosition(add(elem.m_Center, this.m_sheetOffset), schsym);
          startOffset = sub(
            GetRelativePosition(add(add(elem.m_Center, startOffset), this.m_sheetOffset), schsym),
            center,
          );
          endOffset = sub(
            GetRelativePosition(add(add(elem.m_Center, endOffset), this.m_sheetOffset), schsym),
            center,
          );
        }

        arc.SetCenter(center);
        arc.SetStart(add(center, startOffset));
        arc.SetEnd(add(center, endOffset));

        SetLibShapeLine(elem, arc, ALTIUM_SCH_RECORD.ARC);
        SetLibShapeFillAndColor(elem, arc, ALTIUM_SCH_RECORD.ARC, elem.Color);
      }
    }
  }

  /** `std::vector<BEZIER<int>>` of an `ELLIPSE<int>`. */
  private static ellipseBeziers(
    aCenter: VECTOR2I,
    aMajor: number,
    aMinor: number,
    aStart?: EDA_ANGLE,
    aEnd?: EDA_ANGLE,
  ) {
    return TransformEllipseToBeziers(
      ELLIPSE.fromRadii(aCenter, aMajor, aMinor, ANGLE_0, aStart, aEnd),
      true,
    );
  }

  private ParseEllipticalArc(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_ARC(aProperties);

    if (
      elem.m_Radius === elem.m_SecondaryRadius &&
      elem.m_StartAngle === 0 &&
      (elem.m_EndAngle === 0 || elem.m_EndAngle === 360)
    ) {
      this.ParseCircle(aProperties, aSymbol);
      return;
    }

    const startAngle = new EDA_ANGLE(elem.m_StartAngle);
    const endAngle = new EDA_ANGLE(elem.m_EndAngle);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const currentScreen = this.getCurrentScreen();
      if (!currentScreen) return;

      const beziers = SCH_IO_ALTIUM.ellipseBeziers(
        add(elem.m_Center, this.m_sheetOffset),
        elem.m_Radius,
        KiROUND(elem.m_SecondaryRadius),
        startAngle,
        endAngle,
      );

      for (const bezier of beziers) {
        const schbezier = new SCH_SHAPE(SHAPE_T.BEZIER);
        schbezier.SetStart(bezier.Start);
        schbezier.SetBezierC1(bezier.C1);
        schbezier.SetBezierC2(bezier.C2);
        schbezier.SetEnd(bezier.End);
        schbezier.SetStroke(new STROKE_PARAMS(elem.LineWidth, LINE_STYLE.SOLID));
        schbezier.RebuildBezierToSegmentsPointsList(schIUScale.mmToIU(ARC_LOW_DEF_MM));

        currentScreen.Append(schbezier);
      }
    } else {
      const o = this.owner(elem, aSymbol, 'Elliptical Arc');

      if (!o) return;

      const { symbol, schsym } = o;

      if (aSymbol.length === 0 && !this.IsComponentPartVisible(elem)) return;

      const beziers = SCH_IO_ALTIUM.ellipseBeziers(
        elem.m_Center,
        elem.m_Radius,
        KiROUND(elem.m_SecondaryRadius),
        startAngle,
        endAngle,
      );

      for (const bezier of beziers) {
        const schbezier = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_DEVICE);
        symbol.AddDrawItem(schbezier, false);

        schbezier.SetUnit(Math.max(0, elem.ownerpartid));

        schbezier.SetStart(this.rel(bezier.Start, schsym));
        schbezier.SetBezierC1(this.rel(bezier.C1, schsym));
        schbezier.SetBezierC2(this.rel(bezier.C2, schsym));
        schbezier.SetEnd(this.rel(bezier.End, schsym));

        SetLibShapeLine(elem, schbezier, ALTIUM_SCH_RECORD.ELLIPTICAL_ARC);
        schbezier.RebuildBezierToSegmentsPointsList(schIUScale.mmToIU(ARC_LOW_DEF_MM));
      }
    }
  }

  private ParsePieChart(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    this.ParseArc(aProperties, aSymbol);

    const elem = new ASCH_PIECHART(aProperties);

    const center = elem.m_Center;
    const { startOffset, endOffset } = SCH_IO_ALTIUM.arcOffsets(elem);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const screen = this.getCurrentScreen();
      if (!screen) return;

      // close polygon
      let line = new SCH_LINE(add(center, this.m_sheetOffset), SCH_LAYER_ID.LAYER_NOTES);
      line.SetEndPoint(add(add(center, startOffset), this.m_sheetOffset));
      line.SetStroke(new STROKE_PARAMS(elem.LineWidth, LINE_STYLE.SOLID));

      line.SetFlags(IS_NEW);
      screen.Append(line);

      line = new SCH_LINE(add(center, this.m_sheetOffset), SCH_LAYER_ID.LAYER_NOTES);
      line.SetEndPoint(add(add(center, endOffset), this.m_sheetOffset));
      line.SetStroke(new STROKE_PARAMS(elem.LineWidth, LINE_STYLE.SOLID));

      line.SetFlags(IS_NEW);
      screen.Append(line);
    } else {
      const o = this.owner(elem, aSymbol, 'Piechart');

      if (!o) return;

      const { symbol, schsym } = o;

      if (aSymbol.length === 0 && !this.IsComponentPartVisible(elem)) return;

      const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
      symbol.AddDrawItem(line, false);

      line.SetUnit(Math.max(0, elem.ownerpartid));

      line.AddPoint(this.rel(add(center, startOffset), schsym));
      line.AddPoint(this.rel(center, schsym));
      line.AddPoint(this.rel(add(center, endOffset), schsym));

      SetLibShapeLine(elem, line, ALTIUM_SCH_RECORD.LINE);
    }
  }

  private ParseEllipse(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_ELLIPSE(aProperties);

    if (elem.Radius === elem.SecondaryRadius) {
      this.ParseCircle(aProperties, aSymbol);
      return;
    }

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const screen = this.getCurrentScreen();
      if (!screen) return;

      let fillColor = GetColorFromInt(elem.AreaColor);

      if (elem.IsTransparent) fillColor = withAlpha(fillColor, 0.5);

      const fillMode = elem.IsSolid ? FILL_T.FILLED_WITH_COLOR : FILL_T.NO_FILL;

      const beziers = SCH_IO_ALTIUM.ellipseBeziers(
        add(elem.Center, this.m_sheetOffset),
        elem.Radius,
        KiROUND(elem.SecondaryRadius),
      );
      const polyPoints: VECTOR2I[] = [];

      for (const bezier of beziers) {
        const schbezier = new SCH_SHAPE(SHAPE_T.BEZIER);
        schbezier.SetStart(bezier.Start);
        schbezier.SetBezierC1(bezier.C1);
        schbezier.SetBezierC2(bezier.C2);
        schbezier.SetEnd(bezier.End);
        schbezier.SetStroke(new STROKE_PARAMS(elem.LineWidth, LINE_STYLE.SOLID));
        schbezier.SetFillColor(fillColor);
        schbezier.SetFillMode(fillMode);

        schbezier.RebuildBezierToSegmentsPointsList(schIUScale.mmToIU(ARC_LOW_DEF_MM));
        screen.Append(schbezier);

        polyPoints.push(bezier.Start);
      }

      if (fillMode !== FILL_T.NO_FILL) {
        const schpoly = new SCH_SHAPE(SHAPE_T.POLY);
        schpoly.SetFillColor(fillColor);
        schpoly.SetFillMode(fillMode);
        schpoly.SetWidth(-1);

        for (const point of polyPoints) schpoly.AddPoint(point);

        schpoly.AddPoint(polyPoints[0]!);

        screen.Append(schpoly);
      }
    } else {
      const o = this.owner(elem, aSymbol, 'Ellipse');

      if (!o) return;

      const { symbol, schsym } = o;

      const beziers = SCH_IO_ALTIUM.ellipseBeziers(
        elem.Center,
        elem.Radius,
        KiROUND(elem.SecondaryRadius),
      );
      const polyPoints: VECTOR2I[] = [];

      for (const bezier of beziers) {
        const libbezier = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_DEVICE);
        symbol.AddDrawItem(libbezier, false);
        libbezier.SetUnit(Math.max(0, elem.ownerpartid));

        libbezier.SetStart(this.rel(bezier.Start, schsym));
        libbezier.SetBezierC1(this.rel(bezier.C1, schsym));
        libbezier.SetBezierC2(this.rel(bezier.C2, schsym));
        libbezier.SetEnd(this.rel(bezier.End, schsym));

        SetLibShapeLine(elem, libbezier, ALTIUM_SCH_RECORD.ELLIPSE);
        SetLibShapeFillAndColor(elem, libbezier, ALTIUM_SCH_RECORD.ELLIPSE, elem.Color);
        libbezier.RebuildBezierToSegmentsPointsList(schIUScale.mmToIU(ARC_LOW_DEF_MM));

        polyPoints.push(libbezier.GetStart());
      }

      // A series of beziers won't fill the center, so if this is meant to be fully filled,
      // Add a polygon to fill the center
      if (elem.IsSolid) {
        const libline = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
        symbol.AddDrawItem(libline, false);
        libline.SetUnit(Math.max(0, elem.ownerpartid));

        for (const point of polyPoints) libline.AddPoint(point);

        libline.AddPoint(polyPoints[0]!);

        libline.SetWidth(-1);
        SetLibShapeFillAndColor(elem, libline, ALTIUM_SCH_RECORD.ELLIPSE, elem.Color);
      }
    }
  }

  private ParseCircle(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_ELLIPSE(aProperties);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const screen = this.getCurrentScreen();
      if (!screen) return;

      const circle = new SCH_SHAPE(SHAPE_T.CIRCLE);

      circle.SetPosition(add(elem.Center, this.m_sheetOffset));
      circle.SetEnd(add(circle.GetPosition(), { x: elem.Radius, y: 0 }));
      circle.SetStroke(new STROKE_PARAMS(1, LINE_STYLE.SOLID));

      circle.SetFillColor(GetColorFromInt(elem.AreaColor));

      if (elem.IsSolid) circle.SetFillMode(FILL_T.FILLED_WITH_COLOR);
      else circle.SetFilled(false);

      screen.Append(circle);
    } else {
      const o = this.owner(elem, aSymbol, 'Ellipse');

      if (!o) return;

      const { symbol, schsym } = o;

      const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);
      symbol.AddDrawItem(circle, false);

      circle.SetUnit(Math.max(0, elem.ownerpartid));

      circle.SetPosition(this.rel(elem.Center, schsym));
      circle.SetEnd(add(circle.GetPosition(), { x: elem.Radius, y: 0 }));

      SetLibShapeLine(elem, circle, ALTIUM_SCH_RECORD.ELLIPSE);
      SetLibShapeFillAndColor(elem, circle, ALTIUM_SCH_RECORD.ELLIPSE, elem.Color);
    }
  }

  private ParseLine(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_LINE(aProperties);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const screen = this.getCurrentScreen();
      if (!screen) return;

      // close polygon
      const line = new SCH_LINE(add(elem.point1, this.m_sheetOffset), SCH_LAYER_ID.LAYER_NOTES);
      line.SetEndPoint(add(elem.point2, this.m_sheetOffset));
      line.SetStroke(
        new STROKE_PARAMS(
          elem.LineWidth,
          GetPlotDashType(elem.LineStyle),
          GetColorFromInt(elem.Color),
        ),
      );

      line.SetFlags(IS_NEW);
      screen.Append(line);
    } else {
      const o = this.owner(elem, aSymbol, 'Line');

      if (!o) return;

      const { symbol, schsym } = o;

      if (aSymbol.length === 0 && !this.IsComponentPartVisible(elem)) return;

      const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
      symbol.AddDrawItem(line, false);

      line.SetUnit(Math.max(0, elem.ownerpartid));

      line.AddPoint(this.rel(elem.point1, schsym));
      line.AddPoint(this.rel(elem.point2, schsym));

      SetLibShapeLine(elem, line, ALTIUM_SCH_RECORD.LINE);
      line.SetLineStyle(GetPlotDashType(elem.LineStyle));
    }
  }

  private ParseSignalHarness(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_SIGNAL_HARNESS(aProperties);

    if (this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const screen = this.getCurrentScreen();
      if (!screen) return;

      // `ii < elem.points.size() - 1`: size_t, so an empty list wraps; it has none to walk.
      for (let ii = 0; ii + 1 < elem.points.length; ii++) {
        const line = new SCH_LINE(
          add(elem.points[ii]!, this.m_sheetOffset),
          SCH_LAYER_ID.LAYER_BUS,
        );
        line.SetEndPoint(add(elem.points[ii + 1]!, this.m_sheetOffset));
        line.SetStroke(
          new STROKE_PARAMS(elem.lineWidth, LINE_STYLE.SOLID, GetColorFromInt(elem.color)),
        );

        line.SetFlags(IS_NEW);
        screen.Append(line);
      }
    } else {
      // No clue if this situation can ever exist
      this.error(
        'Signal harness, belonging to the part is not currently supported.',
        RPT_SEVERITY_DEBUG,
      );
    }
  }

  private ParseHarnessConnector(aIndex: number, aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_HARNESS_CONNECTOR(aProperties);

    if (this.ShouldPutItemOnSheet(elem.ownerindex)) {
      this.m_harnessEntryParent = aIndex + this.m_harnessOwnerIndexOffset;

      let harness = this.m_altiumHarnesses.get(this.m_harnessEntryParent);

      if (!harness) {
        harness = {
          m_name: '',
          m_location: { x: 0, y: 0 },
          m_size: { x: 0, y: 0 },
          m_ports: [],
          m_entry: newHarnessPort(),
        };
        this.m_altiumHarnesses.set(this.m_harnessEntryParent, harness);
      }

      const port = harness.m_entry;
      harness.m_location = add(elem.m_location, this.m_sheetOffset);
      harness.m_size = elem.m_size;

      const pos = add(elem.m_location, this.m_sheetOffset);
      const size = elem.m_size;

      switch (elem.m_harnessConnectorSide) {
        case ASCH_SHEET_ENTRY_SIDE.RIGHT:
          port.m_location = { x: pos.x + size.x, y: pos.y + elem.m_primaryConnectionPosition };
          break;
        case ASCH_SHEET_ENTRY_SIDE.TOP:
          port.m_location = { x: pos.x + elem.m_primaryConnectionPosition, y: pos.y };
          break;
        case ASCH_SHEET_ENTRY_SIDE.BOTTOM:
          port.m_location = { x: pos.x + elem.m_primaryConnectionPosition, y: pos.y + size.y };
          break;
        default:
          port.m_location = { x: pos.x, y: pos.y + elem.m_primaryConnectionPosition };
          break;
      }
    } else {
      // I have no clue if this situation can ever exist
      this.error(
        'Harness connector, belonging to the part is not currently supported.',
        RPT_SEVERITY_DEBUG,
      );
    }
  }

  private ParseHarnessEntry(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_HARNESS_ENTRY(aProperties);

    const harness = this.m_altiumHarnesses.get(this.m_harnessEntryParent);

    if (!harness) {
      this.error(
        `Harness entry's parent (${this.m_harnessEntryParent}) not found.`,
        RPT_SEVERITY_DEBUG,
      );
      return;
    }

    const port = newHarnessPort();
    port.m_name = elem.Name;
    port.m_harnessConnectorSide = elem.Side;
    port.m_primaryConnectionPosition = 0;

    const pos = harness.m_location;
    const size = harness.m_size;
    let quadrant = 1;

    switch (elem.Side) {
      case ASCH_SHEET_ENTRY_SIDE.RIGHT:
        quadrant = 4;
        port.m_location = { x: pos.x + size.x, y: pos.y + elem.DistanceFromTop };
        break;
      case ASCH_SHEET_ENTRY_SIDE.TOP:
        port.m_location = { x: pos.x + elem.DistanceFromTop, y: pos.y };
        break;
      case ASCH_SHEET_ENTRY_SIDE.BOTTOM:
        quadrant = 2;
        port.m_location = { x: pos.x + elem.DistanceFromTop, y: pos.y + size.y };
        break;
      default:
        port.m_location = { x: pos.x, y: pos.y + elem.DistanceFromTop };
        break;
    }

    const screen = this.getCurrentScreen();
    if (!screen) return;

    const entry = new SCH_BUS_WIRE_ENTRY(port.m_location, quadrant);
    port.m_entryLocation = add(entry.GetPosition(), entry.GetSize());
    entry.SetFlags(IS_NEW);
    screen.Append(entry);
    harness.m_ports.push(port);
  }

  private ParseHarnessType(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_HARNESS_TYPE(aProperties);

    const harness = this.m_altiumHarnesses.get(this.m_harnessEntryParent);

    if (!harness) {
      this.error(
        `Harness type's parent (${this.m_harnessEntryParent}) not found.`,
        RPT_SEVERITY_DEBUG,
      );
      return;
    }

    harness.m_name = elem.Text;
  }

  private ParseRectangle(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_RECTANGLE(aProperties);

    const sheetTopRight = add(elem.TopRight, this.m_sheetOffset);
    const sheetBottomLeft = add(elem.BottomLeft, this.m_sheetOffset);

    if (aSymbol.length === 0 && this.ShouldPutItemOnSheet(elem.ownerindex)) {
      const screen = this.getCurrentScreen();
      if (!screen) return;

      const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE);

      rect.SetPosition(sheetTopRight);
      rect.SetEnd(sheetBottomLeft);
      SetSchShapeLine(elem, rect);
      SetSchShapeFillAndColor(elem, rect);
      rect.SetFlags(IS_NEW);

      screen.Append(rect);
    } else {
      const o = this.owner(elem, aSymbol, 'Rectangle');

      if (!o) return;

      const { symbol, schsym } = o;

      if (aSymbol.length === 0 && !this.IsComponentPartVisible(elem)) return;

      const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);
      symbol.AddDrawItem(rect, false);

      rect.SetUnit(Math.max(0, elem.ownerpartid));

      // Upstream passes the sheet-offset points straight to GetRelativePosition here.
      if (!schsym) {
        rect.SetPosition(sheetTopRight);
        rect.SetEnd(sheetBottomLeft);
      } else {
        rect.SetPosition(GetRelativePosition(sheetTopRight, schsym));
        rect.SetEnd(GetRelativePosition(sheetBottomLeft, schsym));
      }

      SetLibShapeLine(elem, rect, ALTIUM_SCH_RECORD.RECTANGLE);
      SetLibShapeFillAndColor(elem, rect, ALTIUM_SCH_RECORD.RECTANGLE, elem.Color);
    }
  }

  private ParseSheetSymbol(aIndex: number, aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_SHEET_SYMBOL(aProperties);

    const sheet = new SCH_SHEET(
      this.getCurrentSheet() as unknown as EDA_ITEM,
      add(elem.location, this.m_sheetOffset),
      elem.size,
    );

    sheet.SetBorderColor(GetColorFromInt(elem.color));

    if (elem.isSolid) sheet.SetBackgroundColor(GetColorFromInt(elem.areacolor));

    sheet.SetFlags(IS_NEW);

    const currentScreen = this.getCurrentScreen();
    if (!currentScreen) return;
    currentScreen.Append(sheet);

    const sheetpath = this.m_sheetPath.Clone();
    sheetpath.push_back(sheet);

    // We'll update later if we find a pageNumber record for it.
    sheetpath.SetPageNumber('#');

    const rootScreen = this.m_rootSheet!.GetScreen();
    if (!rootScreen) return;

    const sheetInstance = new SCH_SHEET_INSTANCE();

    sheetInstance.m_Path = sheetpath.Path();
    sheetInstance.m_PageNumber = '#';

    rootScreen.m_sheetInstances.push(sheetInstance);
    if (!this.m_sheets.has(aIndex)) this.m_sheets.set(aIndex, sheet);
  }

  private ParseSheetEntry(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_SHEET_ENTRY(aProperties);

    const sheet = this.m_sheets.get(elem.ownerindex);

    if (!sheet) {
      this.error(`Sheet entry's owner (${elem.ownerindex}) not found.`, RPT_SEVERITY_DEBUG);
      return;
    }

    const sheetPin = new SCH_SHEET_PIN(sheet);
    sheet.AddPin(sheetPin);

    let pinName = elem.name;

    if (elem.harnessType !== '') pinName += `{${elem.harnessType}}`;

    sheetPin.SetText(pinName);
    sheetPin.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);

    const pos = sheet.GetPosition();
    const size = sheet.GetSize();

    switch (elem.side) {
      case ASCH_SHEET_ENTRY_SIDE.RIGHT:
        sheetPin.SetPosition({ x: pos.x + size.x, y: pos.y + elem.distanceFromTop });
        sheetPin.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
        sheetPin.SetSide(SHEET_SIDE.RIGHT);
        break;

      case ASCH_SHEET_ENTRY_SIDE.TOP:
        sheetPin.SetPosition({ x: pos.x + elem.distanceFromTop, y: pos.y });
        sheetPin.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.UP));
        sheetPin.SetSide(SHEET_SIDE.TOP);
        break;

      case ASCH_SHEET_ENTRY_SIDE.BOTTOM:
        sheetPin.SetPosition({ x: pos.x + elem.distanceFromTop, y: pos.y + size.y });
        sheetPin.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.BOTTOM));
        sheetPin.SetSide(SHEET_SIDE.BOTTOM);
        break;

      default:
        sheetPin.SetPosition({ x: pos.x, y: pos.y + elem.distanceFromTop });
        sheetPin.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT));
        sheetPin.SetSide(SHEET_SIDE.LEFT);
        break;
    }

    switch (elem.iotype) {
      case ASCH_PORT_IOTYPE.OUTPUT:
        sheetPin.SetShape(LABEL_FLAG_SHAPE.L_OUTPUT);
        break;

      case ASCH_PORT_IOTYPE.IO_INPUT:
        sheetPin.SetShape(LABEL_FLAG_SHAPE.L_INPUT);
        break;

      case ASCH_PORT_IOTYPE.BIDI:
        sheetPin.SetShape(LABEL_FLAG_SHAPE.L_BIDI);
        break;

      default:
        sheetPin.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);
        break;
    }
  }

  private ParsePowerPort(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_POWER_PORT(aProperties);

    let symName = elem.text;
    const styleName = powerPortStyleName(elem.style);

    if (styleName !== '') symName += `_${styleName}`;

    const libId = AltiumToKiCadLibID(this.getLibName(), symName);
    let libSymbol = this.m_powerSymbols.get(symName);

    if (!libSymbol) {
      libSymbol = new LIB_SYMBOL('');
      libSymbol.SetGlobalPower();
      libSymbol.SetName(symName);
      libSymbol.GetReferenceField().SetText('#PWR');
      libSymbol.GetReferenceField().SetVisible(false);
      libSymbol.GetValueField().SetText(elem.text);
      libSymbol.GetValueField().SetVisible(true);
      libSymbol.SetDescription(`Power symbol creates a global label with name '${elem.text}'`);
      libSymbol.SetKeyWords('power-flag');
      libSymbol.SetLibId(libId);

      // generate graphic
      const pin = new SCH_PIN(libSymbol as unknown as EDA_ITEM);
      libSymbol.AddDrawItem(pin, false);

      pin.SetName(elem.text);
      pin.SetPosition({ x: 0, y: 0 });
      pin.SetLength(0);
      pin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
      pin.SetVisible(false);

      const valueFieldPos = HelperGeneratePowerPortGraphics(libSymbol, elem.style, (m, s) =>
        this.m_reporter?.Report(m, s),
      );

      libSymbol.GetValueField().SetPosition(valueFieldPos);

      // this has to be done after parsing the LIB_SYMBOL!
      this.m_powerSymbols.set(symName, libSymbol);
    }

    const screen = this.getCurrentScreen();
    if (!screen) return;

    const symbol = new SCH_SYMBOL();
    symbol.SetRef(this.m_sheetPath, '#PWR?');
    symbol.GetField(FIELD_T.REFERENCE)!.SetVisible(false);
    symbol.SetValueFieldText(elem.text);
    symbol.SetLibId(libId);
    symbol.SetLibSymbol(LIB_SYMBOL.copyOf(libSymbol));

    const valueField = symbol.GetField(FIELD_T.VALUE)!;
    valueField.SetVisible(elem.showNetName);
    valueField.SetPosition(libSymbol.GetValueField().GetPosition());

    symbol.SetPosition(add(elem.location, this.m_sheetOffset));

    switch (elem.orientation) {
      case ASCH_RECORD_ORIENTATION.RIGHTWARDS:
        symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ORIENT_90);
        valueField.SetTextAngle(ANGLE_VERTICAL);
        valueField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        break;

      case ASCH_RECORD_ORIENTATION.UPWARDS:
        symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ORIENT_180);
        valueField.SetTextAngle(ANGLE_HORIZONTAL);
        valueField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        break;

      case ASCH_RECORD_ORIENTATION.LEFTWARDS:
        symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ORIENT_270);
        valueField.SetTextAngle(ANGLE_VERTICAL);
        valueField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        break;

      case ASCH_RECORD_ORIENTATION.DOWNWARDS:
        symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ORIENT_0);
        valueField.SetTextAngle(ANGLE_HORIZONTAL);
        valueField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        break;

      default:
        this.error('Pin has unexpected orientation.', RPT_SEVERITY_WARNING);
        break;
    }

    screen.Append(symbol);
  }

  private ParseHarnessPort(aElem: ASCH_PORT): void {
    this.ParsePortHelper(aElem);
  }

  private ParsePort(aElem: ASCH_PORT): void {
    if (aElem.HarnessType !== '') {
      // Parse harness ports after "Additional" compound section is parsed
      this.m_altiumHarnessPortsCurrentSheet.push(aElem);
      return;
    }

    this.ParsePortHelper(aElem);
  }

  private ParsePortHelper(aElem: ASCH_PORT): void {
    const start = add(aElem.Location, this.m_sheetOffset);
    const end = { ...start };
    const S = ASCH_PORT_STYLE;
    const vertical =
      aElem.Style === S.NONE_VERTICAL ||
      aElem.Style === S.TOP ||
      aElem.Style === S.BOTTOM ||
      aElem.Style === S.TOP_BOTTOM;

    if (vertical) end.y -= aElem.Width;
    else end.x += aElem.Width;

    // Check which connection points exists in the schematic
    const screen = this.getCurrentScreen();
    if (!screen) return;

    const startIsWireTerminal = screen.IsTerminalPoint(start, SCH_LAYER_ID.LAYER_WIRE);
    let startIsBusTerminal = screen.IsTerminalPoint(start, SCH_LAYER_ID.LAYER_BUS);

    const endIsWireTerminal = screen.IsTerminalPoint(end, SCH_LAYER_ID.LAYER_WIRE);
    let endIsBusTerminal = screen.IsTerminalPoint(end, SCH_LAYER_ID.LAYER_BUS);

    // check if any of the points is a terminal point
    // TODO: there seems a problem to detect approximated connections towards component pins?
    let connectionFound =
      startIsWireTerminal || startIsBusTerminal || endIsWireTerminal || endIsBusTerminal;

    if (!connectionFound) {
      for (const [, harness] of byIntKey(this.m_altiumHarnesses)) {
        if (harness.m_name.toLowerCase() !== aElem.HarnessType.toLowerCase()) continue;

        const bbox = new BOX2I(harness.m_location, harness.m_size);
        bbox.Inflate(10);

        if (bbox.Contains(start)) {
          startIsBusTerminal = true;
          connectionFound = true;
          break;
        }

        if (bbox.Contains(end)) {
          endIsBusTerminal = true;
          connectionFound = true;
          break;
        }
      }

      if (!connectionFound)
        this.error(`Port ${aElem.Name} has no connections.`, RPT_SEVERITY_WARNING);
    }

    // Select label position. In case both match, we will add a line later.
    const position = startIsWireTerminal || startIsBusTerminal ? start : end;

    let labelName = aElem.Name;

    if (aElem.HarnessType !== '') labelName += `{${aElem.HarnessType}}`;

    // TODO: detect correct label type depending on sheet settings, etc.
    const label: SCH_LABEL_BASE = new SCH_HIERLABEL(position, labelName);

    switch (aElem.IOtype) {
      case ASCH_PORT_IOTYPE.OUTPUT:
        label.SetShape(LABEL_FLAG_SHAPE.L_OUTPUT);
        break;
      case ASCH_PORT_IOTYPE.IO_INPUT:
        label.SetShape(LABEL_FLAG_SHAPE.L_INPUT);
        break;
      case ASCH_PORT_IOTYPE.BIDI:
        label.SetShape(LABEL_FLAG_SHAPE.L_BIDI);
        break;
      default:
        label.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);
        break;
    }

    if (vertical) {
      if (startIsWireTerminal || startIsBusTerminal)
        label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.UP));
      else label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.BOTTOM));
    } else {
      if (startIsWireTerminal || startIsBusTerminal)
        label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
      else label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT));
    }

    label.AutoplaceFields(screen, AUTOPLACE_ALGO.AUTOPLACE_AUTO);
    label.SetFlags(IS_NEW);

    screen.Append(label);

    // This is a hack, for the case both connection points are valid: add a small wire
    if (startIsWireTerminal && endIsWireTerminal) {
      const wire = new SCH_LINE(start, SCH_LAYER_ID.LAYER_WIRE);
      wire.SetEndPoint(end);
      wire.SetLineWidth(schIUScale.milsToIU(2));
      wire.SetFlags(IS_NEW);
      screen.Append(wire);
    } else if (startIsBusTerminal && endIsBusTerminal) {
      const wire = new SCH_LINE(start, SCH_LAYER_ID.LAYER_BUS);
      wire.SetEndPoint(end);
      wire.SetLineWidth(schIUScale.milsToIU(2));
      wire.SetFlags(IS_NEW);
      screen.Append(wire);
    }
  }

  private ParseNoERC(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_NO_ERC(aProperties);

    const screen = this.getCurrentScreen();
    if (!screen) return;

    if (elem.isActive) {
      const noConnect = new SCH_NO_CONNECT(add(elem.location, this.m_sheetOffset));

      noConnect.SetFlags(IS_NEW);
      screen.Append(noConnect);
    }
  }

  private ParseNetLabel(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_NET_LABEL(aProperties);

    const label = new SCH_LABEL(add(elem.location, this.m_sheetOffset), elem.text);

    const screen = this.getCurrentScreen();
    if (!screen) return;

    SetTextPositioning(label, elem.justification, elem.orientation);

    label.SetFlags(IS_NEW);
    screen.Append(label);
  }

  private ParseBus(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_BUS(aProperties);

    const screen = this.getCurrentScreen();
    if (!screen) return;

    for (let i = 0; i + 1 < elem.points.length; i++) {
      const bus = new SCH_LINE(add(elem.points[i]!, this.m_sheetOffset), SCH_LAYER_ID.LAYER_BUS);
      bus.SetEndPoint(add(elem.points[i + 1]!, this.m_sheetOffset));
      bus.SetLineWidth(elem.lineWidth);

      bus.SetFlags(IS_NEW);
      screen.Append(bus);
    }
  }

  private ParseWire(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_WIRE(aProperties);

    const screen = this.getCurrentScreen();
    if (!screen) return;

    for (let i = 0; i + 1 < elem.points.length; i++) {
      const wire = new SCH_LINE(add(elem.points[i]!, this.m_sheetOffset), SCH_LAYER_ID.LAYER_WIRE);
      wire.SetEndPoint(add(elem.points[i + 1]!, this.m_sheetOffset));
      // wire->SetLineWidth( elem.lineWidth );

      wire.SetFlags(IS_NEW);
      screen.Append(wire);
    }
  }

  private ParseJunction(aProperties: ALTIUM_PROPS): void {
    const screen = this.getCurrentScreen();
    if (!screen) return;

    const elem = new ASCH_JUNCTION(aProperties);

    const junction = new SCH_JUNCTION(add(elem.location, this.m_sheetOffset));

    junction.SetFlags(IS_NEW);
    screen.Append(junction);
  }

  private ParseImage(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_IMAGE(aProperties);

    const component = this.m_altiumComponents.get(elem.ownerindex);

    //Hide the image if it is owned by a component but the part id do not match
    if (component && component.currentpartid !== elem.ownerpartid) return;

    // `( location + corner ) / 2`: VECTOR2<int>::operator/( int ) truncates.
    const center = add(
      {
        x: Math.trunc((elem.location.x + elem.corner.x) / 2),
        y: Math.trunc((elem.location.y + elem.corner.y) / 2),
      },
      this.m_sheetOffset,
    );
    const bitmap = new SCH_BITMAP(center);
    const refImage = bitmap.GetReferenceImage();

    const screen = this.getCurrentScreen();
    if (!screen) return;

    if (elem.embedimage) {
      const storageFile = this.GetFileFromStorage(elem.filename);

      if (!storageFile) {
        this.error(`Embedded file ${elem.filename} not found in storage.`, RPT_SEVERITY_ERROR);
        return;
      }

      // Upstream inflates to a temporary file and reads that; we read the bytes directly.
      let image: Uint8Array | null = null;

      try {
        image = inflateZlib(storageFile.data);
      } catch {
        image = null;
      }

      if (!image || !refImage.ReadImageFile(image)) {
        this.error(`Error reading image ${elem.filename}.`, RPT_SEVERITY_ERROR);
        return;
      }
    } else {
      const bytes = this.m_readFile(elem.filename);

      if (!bytes) {
        this.error(`File not found ${elem.filename}.`, RPT_SEVERITY_ERROR);
        return;
      }

      if (!refImage.ReadImageFile(bytes)) {
        this.error(`Error reading image ${elem.filename}.`, RPT_SEVERITY_ERROR);
        return;
      }
    }

    // we only support one scale, thus we need to select one in case it does not keep aspect ratio
    const currentImageSize = refImage.GetSize();
    const expectedImageSize = sub(elem.location, elem.corner);
    const scaleX = Math.abs(expectedImageSize.x / currentImageSize.x);
    const scaleY = Math.abs(expectedImageSize.y / currentImageSize.y);
    refImage.SetImageScale(Math.min(scaleX, scaleY));

    bitmap.SetFlags(IS_NEW);
    screen.Append(bitmap);
  }

  private ParseSheet(aProperties: ALTIUM_PROPS): void {
    this.m_altiumSheet = new ASCH_SHEET(aProperties);

    const screen = this.getCurrentScreen();
    if (!screen) return;

    const pageInfo = new PAGE_INFO();

    const isPortrait =
      this.m_altiumSheet.sheetOrientation === ASCH_SHEET_WORKSPACEORIENTATION.PORTRAIT;

    if (this.m_altiumSheet.useCustomSheet) {
      PAGE_INFO.SetCustomWidthMils(schIUScale.iuToMils(this.m_altiumSheet.customSize.x));
      PAGE_INFO.SetCustomHeightMils(schIUScale.iuToMils(this.m_altiumSheet.customSize.y));
      pageInfo.SetType(PAGE_SIZE_TYPE.User, isPortrait);
    } else {
      const Z = ASCH_SHEET_SIZE;
      let type: string;

      switch (this.m_altiumSheet.sheetSize) {
        case Z.A3:
        case Z.TABLOID:
          type = 'A3';
          break;
        case Z.A2:
          type = 'A2';
          break;
        case Z.A1:
          type = 'A1';
          break;
        case Z.A0:
          type = 'A0';
          break;
        case Z.A:
        case Z.ORCAD_A:
          type = 'A';
          break;
        case Z.B:
        case Z.ORCAD_B:
          type = 'B';
          break;
        case Z.C:
        case Z.ORCAD_C:
          type = 'C';
          break;
        case Z.D:
        case Z.ORCAD_D:
          type = 'D';
          break;
        case Z.E:
        case Z.ORCAD_E:
          type = 'E';
          break;
        case Z.LETTER:
          type = 'USLetter';
          break;
        case Z.LEGAL:
          type = 'USLegal';
          break;
        default:
          type = 'A4';
          break;
      }

      pageInfo.SetType(type, isPortrait);
    }

    screen.SetPageSettings(pageInfo);

    this.m_sheetOffset = { x: 0, y: pageInfo.GetHeightIU(schIUScale.IU_PER_MILS) };
  }

  private ParseSheetName(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_SHEET_NAME(aProperties);
    const currentScreen = this.getCurrentScreen();

    if (!currentScreen) return;

    const sheet = this.m_sheets.get(elem.ownerindex);

    if (!sheet) {
      this.error(`Sheetname's owner (${elem.ownerindex}) not found.`, RPT_SEVERITY_DEBUG);
      return;
    }

    const name = elem.text.replaceAll('/', '_');

    let sheetName = name;
    const sheetNames = new Set<string>();

    for (const item of currentScreen.Items().OfType(KICAD_T.SCH_SHEET_T))
      sheetNames.add((item as unknown as SCH_SHEET).GetName());

    for (let ii = 1; ; ++ii) {
      if (!sheetNames.has(sheetName)) break;

      sheetName = `${name}_${ii}`;
    }

    const sheetNameField = sheet.GetField(FIELD_T.SHEET_NAME)!;

    sheetNameField.SetPosition(add(elem.location, this.m_sheetOffset));
    sheetNameField.SetText(sheetName);
    sheetNameField.SetVisible(!elem.isHidden);
    SetTextPositioning(sheetNameField, ASCH_LABEL_JUSTIFICATION.BOTTOM_LEFT, elem.orientation);
  }

  private ParseFileName(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_FILE_NAME(aProperties);

    const sheet = this.m_sheets.get(elem.ownerindex);

    if (!sheet) {
      this.error(`Filename's owner (${elem.ownerindex}) not found.`, RPT_SEVERITY_DEBUG);
      return;
    }

    const filenameField = sheet.GetField(FIELD_T.SHEET_FILENAME)!;

    filenameField.SetPosition(add(elem.location, this.m_sheetOffset));

    // Keep the filename of the Altium file until after the file is actually loaded.
    filenameField.SetText(elem.text);
    filenameField.SetVisible(!elem.isHidden);
    SetTextPositioning(filenameField, ASCH_LABEL_JUSTIFICATION.BOTTOM_LEFT, elem.orientation);
  }

  private ParseDesignator(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_DESIGNATOR(aProperties);

    if (!this.m_libSymbols.has(elem.ownerindex)) {
      // TODO: e.g. can depend on Template (RECORD=39
      this.error(`Designator's owner (${elem.ownerindex}) not found.`, RPT_SEVERITY_DEBUG);
      return;
    }

    const symbol = this.m_symbols.get(elem.ownerindex);

    if (!symbol) throw new IO_ERROR('map::at');

    const screen = this.getCurrentScreen();
    if (!screen) return;

    // Graphics symbols have no reference. '#GRAPHIC' allows them to not have footprint associated.
    // Note: not all unnamed imported symbols are necessarily graphics.
    const emptyRef = elem.text === '';
    symbol.SetRef(this.m_sheetPath, emptyRef ? '#GRAPHIC' : elem.text);

    // I am not sure value and ref should be invisible just because emptyRef is true
    // I have examples with this criteria fully incorrect.
    const visible = !emptyRef;

    symbol.GetField(FIELD_T.VALUE)!.SetVisible(visible);

    const field = symbol.GetField(FIELD_T.REFERENCE)!;
    field.SetVisible(visible);
    field.SetPosition(add(elem.location, this.m_sheetOffset));
    SetTextPositioning(field, elem.justification, elem.orientation);

    const altiumSym = this.m_altiumComponents.get(elem.ownerindex);

    if (altiumSym) AdjustFieldForSymbolOrientation(field, altiumSym);
  }

  private ParseLibDesignator(
    aProperties: ALTIUM_PROPS,
    aSymbol: LIB_SYMBOL[],
    aFontSizes: number[],
  ): void {
    const elem = new ASCH_DESIGNATOR(aProperties);

    // Designators are shared by everyone
    for (const symbol of aSymbol) {
      const emptyRef = elem.text === '';
      const refField = symbol.GetReferenceField();

      if (emptyRef) {
        refField.SetText('X');
      } else {
        // remove the '?' at the end for KiCad-style: `BeforeLast( '?' )` is empty without one
        const q = elem.text.lastIndexOf('?');
        refField.SetText(q < 0 ? '' : elem.text.substring(0, q));
      }

      refField.SetPosition(elem.location);
      SetTextPositioning(refField, elem.justification, elem.orientation);

      if (elem.fontId > 0 && elem.fontId <= aFontSizes.length) {
        const size = aFontSizes[elem.fontId - 1]!;
        refField.SetTextSize({ x: size, y: size });
      }
    }
  }

  private ParseBusEntry(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_BUS_ENTRY(aProperties);

    const screen = this.getCurrentScreen();
    if (!screen) return;

    const busWireEntry = new SCH_BUS_WIRE_ENTRY(add(elem.location, this.m_sheetOffset));

    const vector = sub(elem.corner, elem.location);
    busWireEntry.SetSize({ x: vector.x, y: vector.y });

    busWireEntry.SetFlags(IS_NEW);
    screen.Append(busWireEntry);
  }

  private static readonly s_parameterVariableMap = new Map<string, string>([
    ['COMMENT', 'VALUE'],
    ['VALUE', 'ALTIUM_VALUE'],
  ]);

  private ParseParameter(aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_PARAMETER(aProperties);

    // TODO: fill in replacements from variant, sheet and project
    if (elem.ownerindex <= 0) {
      // This is some sheet parameter
      if (elem.text === '*') return; // indicates parameter not set?

      const paramName = elem.name.toUpperCase();

      if (paramName === 'SHEETNUMBER') this.m_sheetPath.SetPageNumber(elem.text);
      else if (paramName === 'TITLE') this.m_currentTitleBlock!.SetTitle(elem.text);
      else if (paramName === 'REVISION') this.m_currentTitleBlock!.SetRevision(elem.text);
      else if (paramName === 'DATE') this.m_currentTitleBlock!.SetDate(elem.text);
      else if (paramName === 'COMPANYNAME') this.m_currentTitleBlock!.SetCompany(elem.text);
      else this.m_schematic!.Project().GetTextVars().set(paramName, elem.text);
    } else {
      if (!this.m_libSymbols.has(elem.ownerindex)) {
        // TODO: e.g. can depend on Template (RECORD=39
        return;
      }

      const symbol = this.m_symbols.get(elem.ownerindex);

      if (!symbol) throw new IO_ERROR('map::at');

      let field: SCH_FIELD;
      const upperName = elem.name.toUpperCase();

      if (upperName === 'COMMENT') {
        field = symbol.GetField(FIELD_T.VALUE)!;
      } else {
        let fieldName = elem.name.toUpperCase();

        if (fieldName === '') {
          let disambiguate = 1;

          for (;;) {
            fieldName = `ALTIUM_UNNAMED_${disambiguate++}`;

            if (!symbol.GetField(fieldName)) break;
          }
        } else if (fieldName === 'VALUE') {
          fieldName = 'ALTIUM_VALUE';
        }

        field = symbol.AddField(new SCH_FIELD(symbol, FIELD_T.USER, fieldName));
      }

      const kicadText = AltiumSchSpecialStringsToKiCadVariables(
        elem.text,
        SCH_IO_ALTIUM.s_parameterVariableMap,
      );
      field.SetText(kicadText);
      field.SetPosition(add(elem.location, this.m_sheetOffset));
      field.SetVisible(!elem.isHidden);
      field.SetNameShown(elem.isShowName);
      SetTextPositioning(field, elem.justification, elem.orientation);

      const altiumSym = this.m_altiumComponents.get(elem.ownerindex);

      if (altiumSym) AdjustFieldForSymbolOrientation(field, altiumSym);
    }
  }

  private ParseLibParameter(
    aProperties: ALTIUM_PROPS,
    aSymbol: LIB_SYMBOL[],
    aFontSizes: number[],
  ): void {
    const elem = new ASCH_PARAMETER(aProperties);

    // Part ID 1 is the current library part.
    // Part ID ALTIUM_COMPONENT_NONE(-1) means all parts
    // If a parameter is assigned to a specific element such as a pin,
    // we will need to handle it here.
    // TODO: Handle HIDDENNETNAME property (others?)
    if (elem.ownerpartid !== 1 && elem.ownerpartid !== ALTIUM_COMPONENT_NONE) return;

    // If ownerindex is populated, this is parameter belongs to a subelement (e.g. pin).
    // Ignore for now.
    // TODO: Update this when KiCad supports parameters for any object
    if (elem.ownerindex !== ALTIUM_COMPONENT_NONE) return;

    // TODO: fill in replacements from variant, sheet and project
    // N.B. We do not keep the Altium "VALUE" variable here because
    // we don't have a way to assign variables to specific symbols
    const variableMap = new Map<string, string>([['COMMENT', 'VALUE']]);

    for (const libSymbol of aSymbol) {
      let field: SCH_FIELD;
      const upperName = elem.name.toUpperCase();

      if (upperName === 'COMMENT') {
        field = libSymbol.GetValueField();
      } else {
        let fieldNameStem = elem.name;
        let fieldName = fieldNameStem;
        let disambiguate = 1;

        if (fieldName === '') {
          fieldNameStem = 'ALTIUM_UNNAMED';
          fieldName = 'ALTIUM_UNNAMED_1';
          disambiguate = 2;
        } else if (upperName === 'VALUE') {
          fieldNameStem = 'ALTIUM_VALUE';
          fieldName = 'ALTIUM_VALUE';
        }

        // Avoid adding duplicate fields
        while (libSymbol.GetField(fieldName)) fieldName = `${fieldNameStem}_${disambiguate++}`;

        const new_field = new SCH_FIELD(libSymbol, FIELD_T.USER, fieldName);
        libSymbol.AddField(new_field);
        field = new_field;
      }

      const kicadText = AltiumSchSpecialStringsToKiCadVariables(elem.text, variableMap);
      field.SetText(kicadText);

      field.SetTextPos(elem.location);
      SetTextPositioning(field, elem.justification, elem.orientation);
      field.SetVisible(!elem.isHidden);

      if (elem.fontId > 0 && elem.fontId <= aFontSizes.length) {
        const size = aFontSizes[elem.fontId - 1]!;
        field.SetTextSize({ x: size, y: size });
      } else {
        const size = schIUScale.milsToIU(DEFAULT_TEXT_SIZE);
        field.SetTextSize({ x: size, y: size });
      }
    }
  }

  private ParseImplementationList(aIndex: number, aProperties: ALTIUM_PROPS): void {
    const elem = new ASCH_IMPLEMENTATION_LIST(aProperties);

    if (!this.m_altiumImplementationList.has(aIndex))
      this.m_altiumImplementationList.set(aIndex, elem.ownerindex);
  }

  private ParseImplementation(aProperties: ALTIUM_PROPS, aSymbol: LIB_SYMBOL[] = []): void {
    const elem = new ASCH_IMPLEMENTATION(aProperties);

    if (elem.type !== 'PCBLIB') return;

    // For schematic files, we need to check if the model is current.
    if (aSymbol.length === 0 && !elem.isCurrent) return;

    // For IntLibs we want to use the same lib name for footprints. Otherwise the model data
    // file names the source PcbLib as a Windows path; take its base name so the footprint id
    // matches the nickname project import registers in the footprint library table.
    const libName = this.m_isIntLib ? this.m_libName : winPathName(elem.libname);

    const fpFilters = [`*${elem.name}*`];

    // Parse the footprint fields for the library symbol
    if (aSymbol.length > 0) {
      for (const symbol of aSymbol) {
        const fpLibId = AltiumToKiCadLibID(libName, elem.name);

        symbol.SetFPFilters(fpFilters);
        symbol.GetField(FIELD_T.FOOTPRINT)!.SetText(fpLibId.Format());
      }

      return;
    }

    const implementationOwner = this.m_altiumImplementationList.get(elem.ownerindex);

    if (implementationOwner === undefined) {
      this.error(`Implementation's owner (${elem.ownerindex}) not found.`, RPT_SEVERITY_DEBUG);
      return;
    }

    const libSymbol = this.m_libSymbols.get(implementationOwner);

    if (!libSymbol) {
      this.error(`Footprint's owner (${implementationOwner}) not found.`, RPT_SEVERITY_DEBUG);
      return;
    }

    const fpLibId = AltiumToKiCadLibID(libName, elem.name);

    libSymbol.SetFPFilters(fpFilters); // TODO: not ideal as we overwrite it

    const symbol = this.m_symbols.get(implementationOwner);

    if (!symbol) throw new IO_ERROR('map::at');

    symbol.SetFootprintFieldText(fpLibId.Format());
  }

  private ParseLibComponent(aProperties: ALTIUM_PROPS): LIB_SYMBOL[] {
    const elem = new ASCH_SYMBOL(aProperties);

    const symbols: LIB_SYMBOL[] = [];

    for (let i = 0; i < elem.displaymodecount; i++) {
      const symbol = new LIB_SYMBOL('');

      if (elem.displaymodecount > 1)
        symbol.SetName(`${elem.libreference} (Altium Display ${i + 1})`);
      else symbol.SetName(elem.libreference);

      const libId = AltiumToKiCadLibID(this.getLibName(), symbol.GetName());
      symbol.SetDescription(elem.componentdescription);
      symbol.SetLibId(libId);
      // Altium PARTCOUNT is one more than the actual unit count. The property may be
      // missing (defaults to 0) or otherwise nonsensical, so clamp to a minimum of 1 unit.
      symbol.SetUnitCount(Math.max(1, elem.partcount - 1), true);
      symbols.push(symbol);
    }

    return symbols;
  }

  /** `CASE_INSENSITIVE_MAP<LIB_SYMBOL*>`: upper-cased key to [name, symbol]. */
  private ParseLibFile(aAltiumLibFile: ALTIUM_COMPOUND_FILE): Map<string, [string, LIB_SYMBOL]> {
    const ret = new Map<string, [string, LIB_SYMBOL]>();
    const fontSizes: number[] = [];

    this.ParseLibHeader(aAltiumLibFile, fontSizes);

    const syms = aAltiumLibFile.GetLibSymbols(null);

    for (const [name, entry] of byStringKey(syms)) {
      const pinFracs = new Map<number, { x_frac: number; y_frac: number; len_frac: number }>();

      if (entry.m_pinsFrac) {
        const parse_binary_pin_frac = (binaryData: string): Map<string, string> => {
          const result: Map<string, string> = new Map();
          const cmpreader = new ALTIUM_COMPRESSED_READER(binaryData);

          const [id, data] = cmpreader.ReadCompressedString();

          const binreader = new ALTIUM_BINARY_READER(data);
          const pinFrac = {
            x_frac: binreader.ReadInt32(),
            y_frac: binreader.ReadInt32(),
            len_frac: binreader.ReadInt32(),
          };
          if (!pinFracs.has(id)) pinFracs.set(id, pinFrac);

          return result;
        };

        const reader = new ALTIUM_BINARY_PARSER(aAltiumLibFile, entry.m_pinsFrac);

        while (reader.GetRemainingBytes() > 0) reader.ReadProperties(parse_binary_pin_frac);
      }

      if (!entry.m_symbol) throw new IO_ERROR('LibSymbol does not contain any data');

      const reader = new ALTIUM_BINARY_PARSER(aAltiumLibFile, entry.m_symbol);
      let symbols: LIB_SYMBOL[] = [];
      let pin_index = 0;

      if (reader.GetRemainingBytes() <= 0)
        throw new IO_ERROR('LibSymbol does not contain any data');

      {
        const properties = reader.ReadProperties();
        const recordId = ALTIUM_PROPS_UTILS.ReadInt(properties as PROPS, 'RECORD', 0);

        if ((recordId as ALTIUM_SCH_RECORD) !== ALTIUM_SCH_RECORD.COMPONENT)
          throw new IO_ERROR('LibSymbol does not start with COMPONENT record');

        symbols = this.ParseLibComponent(properties);
      }

      const handleBinaryPinLambda = (binaryData: string): Map<string, string> => {
        const result: Map<string, string> = new Map();

        const binreader = new ALTIUM_BINARY_READER(binaryData);

        const recordId = binreader.ReadInt32();

        if (recordId !== ALTIUM_SCH_RECORD.PIN)
          throw new IO_ERROR('Binary record missing PIN record');

        result.set('RECORD', `${recordId}`);
        binreader.ReadByte(); // unknown
        result.set('OWNERPARTID', `${binreader.ReadInt16()}`);
        result.set('OWNERPARTDISPLAYMODE', `${binreader.ReadByte()}`);
        result.set('SYMBOL_INNEREDGE', `${binreader.ReadByte()}`);
        result.set('SYMBOL_OUTEREDGE', `${binreader.ReadByte()}`);
        result.set('SYMBOL_INNER', `${binreader.ReadByte()}`);
        result.set('SYMBOL_OUTER', `${binreader.ReadByte()}`);
        result.set('TEXT', binreader.ReadShortPascalString());
        binreader.ReadByte(); // unknown
        result.set('ELECTRICAL', `${binreader.ReadByte()}`);
        result.set('PINCONGLOMERATE', `${binreader.ReadByte()}`);
        result.set('PINLENGTH', `${binreader.ReadInt16()}`);
        result.set('LOCATION.X', `${binreader.ReadInt16()}`);
        result.set('LOCATION.Y', `${binreader.ReadInt16()}`);
        result.set('COLOR', `${binreader.ReadInt32()}`);
        result.set('NAME', binreader.ReadShortPascalString());
        result.set('DESIGNATOR', binreader.ReadShortPascalString());
        result.set('SWAPIDGROUP', binreader.ReadShortPascalString());

        const frac = pinFracs.get(pin_index);

        if (frac) {
          result.set('LOCATION.X_FRAC', `${frac.x_frac}`);
          result.set('LOCATION.Y_FRAC', `${frac.y_frac}`);
          result.set('PINLENGTH_FRAC', `${frac.len_frac}`);
        }

        const partSeq = binreader.ReadShortPascalString(); // This is 'part|&|seq'
        const partSeqSplit = splitOn(partSeq, '|');

        if (partSeqSplit.length === 3) {
          result.set('PART', partSeqSplit[0]!);
          result.set('SEQ', partSeqSplit[2]!);
        }

        return result;
      };

      const R = ALTIUM_SCH_RECORD;

      while (reader.GetRemainingBytes() > 0) {
        const properties = reader.ReadProperties(handleBinaryPinLambda);

        if (properties.size === 0) continue;

        const recordId = ALTIUM_PROPS_UTILS.ReadInt(properties as PROPS, 'RECORD', 0);
        const record = recordId as ALTIUM_SCH_RECORD;

        switch (record) {
          case R.PIN:
            this.ParsePin(properties, symbols);
            pin_index++;
            break;

          case R.LABEL:
            this.ParseLabel(properties, symbols, fontSizes);
            break;
          case R.BEZIER:
            this.ParseBezier(properties, symbols);
            break;
          case R.POLYLINE:
            this.ParsePolyline(properties, symbols);
            break;
          case R.POLYGON:
            this.ParsePolygon(properties, symbols);
            break;
          case R.ELLIPSE:
            this.ParseEllipse(properties, symbols);
            break;
          case R.PIECHART:
            this.ParsePieChart(properties, symbols);
            break;
          case R.ROUND_RECTANGLE:
            this.ParseRoundRectangle(properties, symbols);
            break;
          case R.ELLIPTICAL_ARC:
            this.ParseEllipticalArc(properties, symbols);
            break;
          case R.ARC:
            this.ParseArc(properties, symbols);
            break;
          case R.LINE:
            this.ParseLine(properties, symbols);
            break;
          case R.RECTANGLE:
            this.ParseRectangle(properties, symbols);
            break;
          case R.DESIGNATOR:
            this.ParseLibDesignator(properties, symbols, fontSizes);
            break;
          case R.PARAMETER:
            this.ParseLibParameter(properties, symbols, fontSizes);
            break;
          case R.TEXT_FRAME:
            this.ParseTextFrame(properties, symbols, fontSizes);
            break;
          case R.IMPLEMENTATION:
            this.ParseImplementation(properties, symbols);
            break;

          case R.IMPL_PARAMS:
            break;

          case R.MAP_DEFINER:
          case R.MAP_DEFINER_LIST:
            break;

          case R.IEEE_SYMBOL:
            // TODO: add support for these.  They are just drawn symbols, so we can probably hardcode
            break;

          case R.IMAGE:
            // TODO: Handle images once libedit supports them
            break;

          case R.IMPLEMENTATION_LIST:
            // Nothing for now.  TODO: Figure out how implementation lists are generated in libs
            break;

          default:
            this.error(
              `Unknown or unexpected record id ${recordId} found in ${symbols[0]?.GetName() ?? ''}.`,
              RPT_SEVERITY_ERROR,
            );
            break;
        }
      }

      if (reader.HasParsingError()) throw new IO_ERROR('stream was not parsed correctly!');

      if (reader.GetRemainingBytes() !== 0) throw new IO_ERROR('stream is not fully parsed');

      for (let ii = 0; ii < symbols.length; ii++) {
        const symbol = symbols[ii]!;
        symbol.FixupDrawItems();
        this.fixupSymbolPinNameNumbers(symbol);

        const valField = symbol.GetValueField();

        if (valField.GetText() === '') valField.SetText(name);

        // Set the symbol name to match the cache key. The directory name (used as cache
        // key) may differ from the Altium library reference when the original name
        // contains characters invalid for directory names (like '/').
        const cacheName = symbols.length === 1 ? name : `${name} (Altium Display ${ii + 1})`;

        symbol.SetName(cacheName);
        ret.set(cacheName.toUpperCase(), [cacheName, symbol]);
      }
    }

    return ret;
  }

  /**
   * `getLibraryTimestamp`: upstream's file modification time. A file source has none, so a
   * readable library reads as 1 and a loaded library is not reloaded.
   */
  private getLibraryTimestamp(aLibraryPath: string): number {
    return this.m_readFile(aLibraryPath) ? 1 : 0;
  }

  private ensureLoadedLibrary(aLibraryPath: string): void {
    if (this.m_libCache.has(aLibraryPath)) {
      if (!this.m_timestamps.has(aLibraryPath)) return;

      if (this.m_timestamps.get(aLibraryPath) === this.getLibraryTimestamp(aLibraryPath)) return;
    }

    const compoundFiles: ALTIUM_COMPOUND_FILE[] = [];

    this.m_libName = fileNameParts(aLibraryPath).name;

    try {
      const bytes = (): Uint8Array => {
        const b = this.m_readFile(aLibraryPath);
        if (!b) throw new IO_ERROR(`Cannot open file '${aLibraryPath}'`);
        return b;
      };

      if (aLibraryPath.toLowerCase().endsWith('.schlib')) {
        this.m_isIntLib = false;

        compoundFiles.push(new ALTIUM_COMPOUND_FILE(bytes()));
      } else if (aLibraryPath.toLowerCase().endsWith('.intlib')) {
        this.m_isIntLib = true;

        const intCom = new ALTIUM_COMPOUND_FILE(bytes());

        const schLibFiles = intCom.EnumDir('SchLib');

        for (const [, cfe] of byStringKey(schLibFiles)) {
          const decodedStream = new ALTIUM_COMPOUND_FILE();

          if (intCom.DecodeIntLibStream(cfe, decodedStream)) compoundFiles.push(decodedStream);
        }
      }

      let cacheMapRef = this.m_libCache.get(aLibraryPath);

      if (!cacheMapRef) {
        cacheMapRef = new Map();
        this.m_libCache.set(aLibraryPath, cacheMapRef);
      }

      for (const altiumSchFile of compoundFiles) {
        const parsed = this.ParseLibFile(altiumSchFile);

        // `std::map::insert( first, last )`: an existing key keeps its symbol.
        for (const [k, v] of parsed) if (!cacheMapRef.has(k)) cacheMapRef.set(k, v);
      }

      this.m_timestamps.set(aLibraryPath, this.getLibraryTimestamp(aLibraryPath));
    } catch (exception) {
      if (exception instanceof CFBException) throw new IO_ERROR(exception.message);
      if (exception instanceof IO_ERROR) throw exception;
      throw new IO_ERROR(`Error parsing Altium library: ${(exception as Error).message}`);
    }
  }

  private ParseLibHeader(aAltiumSchFile: ALTIUM_COMPOUND_FILE, aFontSizes: number[]): void {
    const file = aAltiumSchFile.FindStream(['FileHeader']);

    if (file === null) throw new IO_ERROR('FileHeader not found');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumSchFile, file);

    if (reader.GetRemainingBytes() <= 0) throw new IO_ERROR('FileHeader does not contain any data');

    const properties = reader.ReadProperties();

    const libtype = ALTIUM_PROPS_UTILS.ReadString(properties as PROPS, 'HEADER', '');

    if (
      libtype.toLowerCase() !==
      'protel for windows - schematic library editor binary file version 5.0'
    )
      throw new IO_ERROR('Expected Altium Schematic Library file version 5.0');

    for (const [key, value] of byStringKey(properties as PROPS)) {
      const upperKey = key.toUpperCase();

      if (upperKey.startsWith('SIZE')) {
        const remaining = upperKey.substring(4);

        if (remaining !== '') {
          const ind = wxAtoi(remaining);

          while (aFontSizes.length < ind) aFontSizes.push(0);

          // Altium stores in pt.  1 pt = 1/72 inch.  1 mil = 1/1000 inch.
          const scaled = schIUScale.milsToIU((wxAtoi(value) * 72.0) / 10.0);
          aFontSizes[ind - 1] = scaled;
        }
      }
    }
  }

  private doEnumerateSymbolLib(
    aLibraryPath: string,
    aProperties: SCH_IO_PROPERTIES | null,
    aInserter: (aName: string, aSymbol: LIB_SYMBOL) => void,
  ): void {
    this.ensureLoadedLibrary(aLibraryPath);

    const powerSymbolsOnly = !!aProperties?.has(SYMBOL_LIBRARY_ADAPTER.PropPowerSymsOnly);

    const lib = this.m_libCache.get(aLibraryPath);

    if (lib) {
      for (const [, [libnameStr, libSymbol]] of byStringKey(lib)) {
        if (powerSymbolsOnly && !libSymbol.IsPower()) continue;

        aInserter(libnameStr, libSymbol);
      }
    }
  }

  override EnumerateSymbolLib(
    aSymbolNameList: string[],
    aLibraryPath: string,
    aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    this.doEnumerateSymbolLib(aLibraryPath, aProperties, (aStr) => aSymbolNameList.push(aStr));
  }

  override EnumerateSymbolLibSymbols(
    aSymbolList: LIB_SYMBOL[],
    aLibraryPath: string,
    aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    this.doEnumerateSymbolLib(aLibraryPath, aProperties, (_aStr, aSymbol) =>
      aSymbolList.push(aSymbol),
    );
  }

  override LoadSymbol(
    aLibraryPath: string,
    aAliasName: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): LIB_SYMBOL | null {
    this.ensureLoadedLibrary(aLibraryPath);

    return this.m_libCache.get(aLibraryPath)?.get(aAliasName.toUpperCase())?.[1] ?? null;
  }
}

/** `wxString::ToLong`: the whole string as a C long, else null. */
function toLong(aStr: string): number | null {
  return /^[ \t\n\v\f\r]*[-+]?\d+$/.test(aStr) ? Number.parseInt(aStr, 10) : null;
}

/** KiCad's `split( aStr, aDelim )`: no trailing empty token. */
function splitOn(aStr: string, aDelim: string): string[] {
  const tokens: string[] = [];
  let pos = 0;
  let last_pos = 0;

  while (pos < aStr.length) {
    pos = aStr.indexOf(aDelim, last_pos);
    if (pos === -1) pos = aStr.length;
    tokens.push(aStr.substring(last_pos, pos));
    last_pos = pos + 1;
  }

  return tokens;
}

/** `wxAtoi`: leading whitespace, sign and digits; 0 when none. */
function wxAtoi(aStr: string): number {
  const m = /^[ \t\n\v\f\r]*([-+]?\d+)/.exec(aStr);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}
