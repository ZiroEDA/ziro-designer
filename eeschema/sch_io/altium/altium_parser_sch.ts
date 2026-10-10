// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/altium/altium_parser_sch.cpp` / `.h`: the Altium schematic records - one
 * `|KEY=value` property map per object - each read into its struct, coordinates already in
 * KiCad schematic units with Y flipped.
 *
 * A unit is stored as two integers, mils and a 1/10000-mil fraction (`LOCATION.X`,
 * `LOCATION.X_FRAC`); `Altium2KiCadUnit` combines them and rounds to whole 10 IU, as KiCad does.
 */
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { ALTIUM_BINARY_PARSER } from '@ziroeda/common/io/altium/altium_binary_parser.js';
import { ALTIUM_PROPS_UTILS } from '@ziroeda/common/io/altium/altium_props_utils.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

/** `std::map<wxString, wxString>`: one record's properties. */
export type ALTIUM_PROPS = ReadonlyMap<string, string>;

export const ALTIUM_COMPONENT_NONE = -1;

const U = ALTIUM_PROPS_UTILS;

export enum ALTIUM_SCH_RECORD {
  UNKNOWN = -1,
  HEADER = 0,
  COMPONENT = 1,
  PIN = 2,
  IEEE_SYMBOL = 3,
  LABEL = 4,
  BEZIER = 5,
  POLYLINE = 6,
  POLYGON = 7,
  ELLIPSE = 8,
  PIECHART = 9,
  ROUND_RECTANGLE = 10,
  ELLIPTICAL_ARC = 11,
  ARC = 12,
  LINE = 13,
  RECTANGLE = 14,
  SHEET_SYMBOL = 15,
  SHEET_ENTRY = 16,
  POWER_PORT = 17,
  PORT = 18,
  NO_ERC = 22,
  NET_LABEL = 25,
  BUS = 26,
  WIRE = 27,
  TEXT_FRAME = 28,
  JUNCTION = 29,
  IMAGE = 30,
  SHEET = 31,
  SHEET_NAME = 32,
  FILE_NAME = 33,
  DESIGNATOR = 34,
  BUS_ENTRY = 37,
  TEMPLATE = 39,
  PARAMETER = 41,
  PARAMETER_SET = 43,
  IMPLEMENTATION_LIST = 44,
  IMPLEMENTATION = 45,
  MAP_DEFINER_LIST = 46,
  MAP_DEFINER = 47,
  IMPL_PARAMS = 48,
  NOTE = 209,
  COMPILE_MASK = 211,
  HARNESS_CONNECTOR = 215,
  HARNESS_ENTRY = 216,
  HARNESS_TYPE = 217,
  SIGNAL_HARNESS = 218,
  BLANKET = 225,
  HYPERLINK = 226,
}

export enum ASCH_RECORD_ORIENTATION {
  RIGHTWARDS = 0, // 0
  UPWARDS = 1, // 90
  LEFTWARDS = 2, // 180
  DOWNWARDS = 3, // 270
}

/** `ASCH_PIN_SYMBOL::PTYPE`. */
export enum ASCH_PIN_SYMBOL {
  UNKNOWN = -1,
  NO_SYMBOL = 0,
  NEGATED = 1,
  RIGHTLEFT = 2,
  CLOCK = 3,
  LOW_INPUT = 4,
  ANALOG_IN = 5,
  NOLOGICCONNECT = 6,
  POSTPONE_OUTPUT = 8,
  OPEN_COLLECTOR = 9,
  HIZ = 10,
  HIGH_CURRENT = 11,
  PULSE = 12,
  SCHMITT = 13,
  LOW_OUTPUT = 17,
  OPEN_COLLECTOR_PULL_UP = 22,
  OPEN_EMITTER = 23,
  OPEN_EMITTER_PULL_UP = 24,
  DIGITAL_IN = 25,
  SHIFT_LEFT = 30,
  OPEN_OUTPUT = 32,
  LEFTRIGHT = 33,
  BIDI = 34,
}

/** `ASCH_PIN_SYMBOL::FromInt`: a known value, else UNKNOWN. */
function pinSymbolFromInt(aInt: number): ASCH_PIN_SYMBOL {
  return aInt in ASCH_PIN_SYMBOL && aInt !== -1
    ? (aInt as ASCH_PIN_SYMBOL)
    : ASCH_PIN_SYMBOL.UNKNOWN;
}

export enum ASCH_PIN_ELECTRICAL {
  UNKNOWN = -1,
  PIN_INPUT = 0,
  BIDI = 1,
  OUTPUT = 2,
  OPEN_COLLECTOR = 3,
  PASSIVE = 4,
  TRISTATE = 5,
  OPEN_EMITTER = 6,
  POWER = 7,
}

export enum ASCH_LABEL_JUSTIFICATION {
  UNKNOWN = -1,
  BOTTOM_LEFT = 0,
  BOTTOM_CENTER = 1,
  BOTTOM_RIGHT = 2,
  CENTER_LEFT = 3,
  CENTER_CENTER = 4,
  CENTER_RIGHT = 5,
  TOP_LEFT = 6,
  TOP_CENTER = 7,
  TOP_RIGHT = 8,
}

export enum ASCH_TEXT_FRAME_ALIGNMENT {
  LEFT = 1,
  CENTER = 2,
  RIGHT = 3,
}

export enum ASCH_PORT_ALIGNMENT {
  CENTER = 0,
  RIGHT = 1,
  LEFT = 2,
}

export enum ASCH_POLYLINE_LINESTYLE {
  SOLID = 0,
  DASHED = 1,
  DOTTED = 2,
  DASH_DOTTED = 3,
}

export enum ASCH_SHEET_ENTRY_SIDE {
  LEFT = 0,
  RIGHT = 1,
  TOP = 2,
  BOTTOM = 3,
}

export enum ASCH_PORT_IOTYPE {
  UNSPECIFIED = 0,
  OUTPUT = 1,
  IO_INPUT = 2,
  BIDI = 3,
}

export enum ASCH_PORT_STYLE {
  NONE_HORIZONTAL = 0,
  LEFT = 1,
  RIGHT = 2,
  LEFT_RIGHT = 3,
  NONE_VERTICAL = 4,
  TOP = 5,
  BOTTOM = 6,
  TOP_BOTTOM = 7,
}

export enum ASCH_POWER_PORT_STYLE {
  UNKNOWN = -1,
  CIRCLE = 0,
  ARROW = 1,
  BAR = 2,
  WAVE = 3,
  POWER_GROUND = 4,
  SIGNAL_GROUND = 5,
  EARTH = 6,
  GOST_ARROW = 7,
  GOST_POWER_GROUND = 8,
  GOST_EARTH = 9,
  GOST_BAR = 10,
}

export enum ASCH_SHEET_SIZE {
  UNKNOWN = -1, // use A4
  A4 = 0, // 1150 × 760
  A3 = 1, // 1550 × 1110
  A2 = 2, // 2230 × 1570
  A1 = 3, // 3150 × 2230
  A0 = 4, // 4460 × 3150
  A = 5, // 950 × 750
  B = 6, // 1500 × 950
  C = 7, // 2000 × 1500
  D = 8, // 3200 × 2000
  E = 9, // 4200 × 3200
  LETTER = 10, // 1100 × 850
  LEGAL = 11, // 1400 × 850
  TABLOID = 12, // 1700 × 1100
  ORCAD_A = 13, // 990 × 790
  ORCAD_B = 14, // 1540 × 990
  ORCAD_C = 15, // 2060 × 1560
  ORCAD_D = 16, // 3260 × 2060
  ORCAD_E = 17, // 4280 × 3280
}

export enum ASCH_SHEET_WORKSPACEORIENTATION {
  LANDSCAPE = 0,
  PORTRAIT = 1,
}

export function ReadRecord(aProps: ALTIUM_PROPS): ALTIUM_SCH_RECORD {
  return U.ReadInt(aProps as Map<string, string>, 'RECORD', -1) as ALTIUM_SCH_RECORD;
}

const INT_MAX = 2147483647;

/** `constexpr int Altium2KiCadUnit( const int val, const int frac )`. */
export function Altium2KiCadUnit(val: number, frac: number): number {
  const int_limit = (INT_MAX - 10) / 2.54;

  // `10 * schIUScale.MilsToIU( val )`: an int times an int, before the conversion to double.
  const dbase = 10 * schIUScale.milsToIU(val);
  const dfrac = schIUScale.milsToIU(frac) / 10000.0;

  return KiROUND(Math.min(Math.max((dbase + dfrac) / 10.0, -int_limit), int_limit)) * 10;
}

const P = (aProps: ALTIUM_PROPS): Map<string, string> => aProps as Map<string, string>;

export function ReadKiCadUnitFrac(aProps: ALTIUM_PROPS, aKey: string): number {
  // a unit is stored using two fields, denoting the size in mils and a fraction size
  const key = U.ReadInt(P(aProps), aKey, 0);
  const keyFrac = U.ReadInt(P(aProps), `${aKey}_FRAC`, 0);
  return Altium2KiCadUnit(key, keyFrac);
}

export function ReadKiCadUnitFrac1(aProps: ALTIUM_PROPS, aKey: string): number {
  // a unit is stored using two fields, denoting the size in mils and a fraction size
  // Dunno why Altium invents different units for the same purpose
  const key = U.ReadInt(P(aProps), aKey, 0);
  const keyFrac = U.ReadInt(P(aProps), `${aKey}_FRAC1`, 0);
  return Altium2KiCadUnit(key * 10, keyFrac);
}

function ReadOwnerIndex(aProperties: ALTIUM_PROPS): number {
  return U.ReadInt(P(aProperties), 'OWNERINDEX', ALTIUM_COMPONENT_NONE);
}

function ReadOwnerPartId(aProperties: ALTIUM_PROPS): number {
  return U.ReadInt(P(aProperties), 'OWNERPARTID', ALTIUM_COMPONENT_NONE);
}

/** `ReadEnum<T>`: the value when within [aLower, aUpper], else aDefault. */
function ReadEnum<T extends number>(
  aProps: ALTIUM_PROPS,
  aKey: string,
  aLower: number,
  aUpper: number,
  aDefault: T,
): T {
  const value = U.ReadInt(P(aProps), aKey, aDefault);

  if (value < aLower || value > aUpper) return aDefault;
  else return value as T;
}

const pt = (aProps: ALTIUM_PROPS, aX: string, aY: string): VECTOR2I => ({
  x: ReadKiCadUnitFrac(aProps, aX),
  y: -ReadKiCadUnitFrac(aProps, aY),
});

const location = (aProps: ALTIUM_PROPS): VECTOR2I => pt(aProps, 'LOCATION.X', 'LOCATION.Y');

function readPoints(aProps: ALTIUM_PROPS): VECTOR2I[] {
  const points: VECTOR2I[] = [];
  const locationCount = U.ReadInt(P(aProps), 'LOCATIONCOUNT', 0);

  for (let i = 1; i <= locationCount; i++) points.push(pt(aProps, `X${i}`, `Y${i}`));

  return points;
}

export class ASCH_STORAGE_FILE {
  filename = '';
  data: Uint8Array = new Uint8Array(0);

  static fromProps(aProps: ALTIUM_PROPS): ASCH_STORAGE_FILE {
    const f = new ASCH_STORAGE_FILE();
    f.filename = U.ReadString(P(aProps), 'NAME', '');
    // `size_t dataSize = ReadInt( ... )`
    const dataSize = U.ReadInt(P(aProps), 'DATA_LEN', 0) >>> 0;

    const hexData = U.ReadString(P(aProps), 'DATA', '');
    const charCount = hexData.length;

    if (charCount !== dataSize * 2) {
      throw new IO_ERROR(
        `Invalid binary file hex data size. Chars expected: ${dataSize * 2}, hex string length: ${hexData.length}`,
      );
    }

    f.data = new Uint8Array(dataSize);

    let b = 0;
    let outputId = 0;

    for (let inputId = 1; inputId < charCount; inputId += 2) {
      // `std::from_chars( str, str + 2, b, 16 )`: the leading hex digits; on none, b keeps
      // the last byte read (it is declared outside the loop).
      const m = /^[0-9a-fA-F]+/.exec(hexData[inputId - 1]! + hexData[inputId]!);
      if (m) b = Number.parseInt(m[0], 16);
      f.data[outputId] = b;

      outputId++;
    }

    return f;
  }

  static fromReader(aReader: ALTIUM_BINARY_PARSER): ASCH_STORAGE_FILE {
    const f = new ASCH_STORAGE_FILE();
    aReader.Skip(5);
    f.filename = aReader.ReadWxString();
    const dataSize = aReader.ReadUint32();
    f.data = aReader.ReadVector(dataSize);

    if (aReader.HasParsingError()) throw new IO_ERROR('Storage stream was not parsed correctly');

    return f;
  }
}

export class ASCH_ADDITIONAL_FILE {
  FileName: string;
  Data: Uint8Array;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    aReader.Skip(5);
    this.FileName = aReader.ReadWxString();
    const dataSize = aReader.ReadUint32();
    this.Data = aReader.ReadVector(dataSize);

    if (aReader.HasParsingError()) throw new IO_ERROR('Additional stream was not parsed correctly');
  }
}

export class ASCH_OWNER_INTERFACE {
  ownerindex: number;
  ownerpartid: number;
  ownerpartdisplaymode: number;
  indexinsheet: number;
  IsNotAccesible: boolean;

  constructor(aProps: ALTIUM_PROPS) {
    this.ownerindex = ReadOwnerIndex(aProps);
    this.ownerpartid = ReadOwnerPartId(aProps);
    this.ownerpartdisplaymode = U.ReadInt(P(aProps), 'OWNERPARTDISPLAYMODE', 0);
    this.indexinsheet = U.ReadInt(P(aProps), 'INDEXINSHEET', 0);
    this.IsNotAccesible = U.ReadBool(P(aProps), 'ISNOTACCESIBLE', false);
  }
}

/** `ASCH_FILL_INTERFACE` members. */
export interface ASCH_FILL {
  AreaColor: number;
  IsSolid: boolean;
  IsTransparent: boolean;
}

/** `ASCH_BORDER_INTERFACE` members. */
export interface ASCH_BORDER {
  LineWidth: number;
  Color: number;
}

function readFill(aProps: ALTIUM_PROPS): ASCH_FILL {
  return {
    AreaColor: U.ReadInt(P(aProps), 'AREACOLOR', 0),
    IsSolid: U.ReadBool(P(aProps), 'ISSOLID', false),
    IsTransparent: U.ReadBool(P(aProps), 'TRANSPARENT', false),
  };
}

function readBorder(aProps: ALTIUM_PROPS): ASCH_BORDER {
  let LineWidth = ReadKiCadUnitFrac(aProps, 'LINEWIDTH');

  // Altium line width 0 means hairline.  Since KiCad doesn't have a hairline, we
  // represent it as a 1 mil line.
  if (LineWidth === 0) LineWidth = schIUScale.milsToIU(1);

  return { LineWidth, Color: U.ReadInt(P(aProps), 'COLOR', 0) };
}

export class ASCH_SYMBOL {
  currentpartid: number;
  m_indexInSheet: number;
  uniqueid: string;
  libreference: string;
  sourcelibraryname: string;
  componentdescription: string;
  orientation: number;
  isMirrored: boolean;
  location: VECTOR2I;
  partcount: number;
  displaymodecount: number;
  displaymode: number;

  constructor(aProps: ALTIUM_PROPS) {
    this.uniqueid = U.ReadString(P(aProps), 'UNIQUEID', '');
    this.currentpartid = U.ReadInt(P(aProps), 'CURRENTPARTID', ALTIUM_COMPONENT_NONE);
    this.libreference = U.ReadString(P(aProps), 'LIBREFERENCE', '');
    this.sourcelibraryname = U.ReadString(P(aProps), 'SOURCELIBRARYNAME', '');
    this.componentdescription = U.ReadString(P(aProps), 'COMPONENTDESCRIPTION', '');

    this.orientation = U.ReadInt(P(aProps), 'ORIENTATION', 0);
    this.isMirrored = U.ReadBool(P(aProps), 'ISMIRRORED', false);
    this.location = location(aProps);

    this.partcount = U.ReadInt(P(aProps), 'PARTCOUNT', 0);
    this.displaymodecount = U.ReadInt(P(aProps), 'DISPLAYMODECOUNT', 0);
    this.m_indexInSheet = U.ReadInt(P(aProps), 'INDEXINSHEET', -1);

    // DISPLAYMODE may be a string. Leave displaymode at 0 in this case.
    this.displaymode = 0;
    const displayModeStr = U.ReadString(P(aProps), 'DISPLAYMODE', '');

    // `wxString::ToCLong`: the whole string as a C long (leading blanks allowed).
    if (/^[ \t\n\v\f\r]*[-+]?\d+$/.test(displayModeStr))
      this.displaymode = Number.parseInt(displayModeStr, 10) | 0;
  }
}

export class ASCH_TEMPLATE extends ASCH_OWNER_INTERFACE {
  filename: string;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    this.filename = U.ReadString(P(aProps), 'FILENAME', '');
  }
}

export class ASCH_PIN extends ASCH_OWNER_INTERFACE {
  name: string;
  text: string;
  designator: string;
  symbolOuter: ASCH_PIN_SYMBOL;
  symbolInner: ASCH_PIN_SYMBOL;
  symbolOuterEdge: ASCH_PIN_SYMBOL;
  symbolInnerEdge: ASCH_PIN_SYMBOL;
  electrical: ASCH_PIN_ELECTRICAL;
  orientation: ASCH_RECORD_ORIENTATION;
  location: VECTOR2I;
  pinlength: number;
  kicadLocation: VECTOR2I; // location of pin in KiCad without rounding error
  showPinName: boolean;
  showDesignator: boolean;
  hidden: boolean;
  locked: boolean;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.ownerpartdisplaymode = U.ReadInt(p, 'OWNERPARTDISPLAYMODE', 0);

    this.name = U.ReadString(p, 'NAME', '');
    this.text = U.ReadString(p, 'TEXT', '');
    this.designator = U.ReadString(p, 'DESIGNATOR', '');

    this.symbolOuter = pinSymbolFromInt(U.ReadInt(p, 'SYMBOL_OUTER', 0));
    this.symbolInner = pinSymbolFromInt(U.ReadInt(p, 'SYMBOL_INNER', 0));
    this.symbolOuterEdge = pinSymbolFromInt(U.ReadInt(p, 'SYMBOL_OUTEREDGE', 0));
    this.symbolInnerEdge = pinSymbolFromInt(U.ReadInt(p, 'SYMBOL_INNEREDGE', 0));

    this.electrical = ReadEnum(aProps, 'ELECTRICAL', 0, 7, ASCH_PIN_ELECTRICAL.PIN_INPUT);

    const pinconglomerate = U.ReadInt(p, 'PINCONGLOMERATE', 0);

    this.orientation = (pinconglomerate & 0x03) as ASCH_RECORD_ORIENTATION;
    this.hidden = (pinconglomerate & 0x04) !== 0;
    this.showPinName = (pinconglomerate & 0x08) !== 0;
    this.showDesignator = (pinconglomerate & 0x10) !== 0;
    // 0x20 is unknown
    this.locked = (pinconglomerate & 0x40) !== 0;

    const x = U.ReadInt(p, 'LOCATION.X', 0);
    const xfrac = U.ReadInt(p, 'LOCATION.X_FRAC', 0);
    const y = U.ReadInt(p, 'LOCATION.Y', 0);
    const yfrac = U.ReadInt(p, 'LOCATION.Y_FRAC', 0);
    this.location = { x: Altium2KiCadUnit(x, xfrac), y: -Altium2KiCadUnit(y, yfrac) };

    const pl = U.ReadInt(p, 'PINLENGTH', 0);
    const pfrac = U.ReadInt(p, 'PINLENGTH_FRAC', 0);
    this.pinlength = Altium2KiCadUnit(pl, pfrac);

    // this code calculates the location as required by KiCad without rounding error attached
    let kicadX = x;
    let kicadXfrac = xfrac;
    let kicadY = y;
    let kicadYfrac = yfrac;

    const offsetY = pl;
    const offsetYfrac = pfrac;

    switch (this.orientation) {
      case ASCH_RECORD_ORIENTATION.RIGHTWARDS:
        kicadX += offsetY;
        kicadXfrac += offsetYfrac;
        break;

      case ASCH_RECORD_ORIENTATION.UPWARDS:
        kicadY += offsetY;
        kicadYfrac += offsetYfrac;
        break;

      case ASCH_RECORD_ORIENTATION.LEFTWARDS:
        kicadX -= offsetY;
        kicadXfrac -= offsetYfrac;
        break;

      case ASCH_RECORD_ORIENTATION.DOWNWARDS:
        kicadY -= offsetY;
        kicadYfrac -= offsetYfrac;
        break;

      default:
        break; // wxLogWarning: "Pin has unexpected orientation"
    }

    this.kicadLocation = {
      x: Altium2KiCadUnit(kicadX, kicadXfrac),
      y: -Altium2KiCadUnit(kicadY, kicadYfrac),
    };
  }
}

export class ASCH_LABEL extends ASCH_OWNER_INTERFACE {
  location: VECTOR2I;
  text: string;
  textColor: number;
  fontId: number;
  isMirrored: boolean;
  justification: ASCH_LABEL_JUSTIFICATION;
  orientation: ASCH_RECORD_ORIENTATION;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.location = location(aProps);
    this.text = U.ReadString(p, 'TEXT', '');
    this.textColor = 0;
    this.fontId = U.ReadInt(p, 'FONTID', 0);
    this.isMirrored = U.ReadBool(p, 'ISMIRRORED', false);

    this.justification = ReadEnum(
      aProps,
      'JUSTIFICATION',
      0,
      8,
      ASCH_LABEL_JUSTIFICATION.BOTTOM_LEFT,
    );
    this.orientation = ReadEnum(aProps, 'ORIENTATION', 0, 3, ASCH_RECORD_ORIENTATION.RIGHTWARDS);
  }
}

export class ASCH_HYPERLINK extends ASCH_LABEL {
  url: string;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    this.url = U.ReadString(P(aProps), 'URL', '');
  }
}

export class ASCH_TEXT_FRAME extends ASCH_OWNER_INTERFACE {
  Location: VECTOR2I;
  Size: VECTOR2I;
  BottomLeft: VECTOR2I;
  TopRight: VECTOR2I;
  Text: string;
  IsWordWrapped: boolean; // to do when kicad supports this
  ShowBorder: boolean;
  FontID: number;
  TextMargin: number; // to do when kicad supports this
  AreaColor: number;
  TextColor: number;
  BorderColor: number;
  BorderWidth: number;
  isSolid: boolean;
  Alignment: ASCH_TEXT_FRAME_ALIGNMENT;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.BottomLeft = location(aProps);
    this.TopRight = pt(aProps, 'CORNER.X', 'CORNER.Y');

    this.Location = location(aProps);
    this.Size = {
      x: ReadKiCadUnitFrac(aProps, 'CORNER.X') - this.Location.x,
      y: -ReadKiCadUnitFrac(aProps, 'CORNER.Y') - this.Location.y,
    };

    this.Text = U.ReadString(p, 'TEXT', '').replaceAll('~1', '\n');

    this.FontID = U.ReadInt(p, 'FONTID', 0);
    this.IsWordWrapped = U.ReadBool(p, 'WORDWRAP', false);
    this.ShowBorder = U.ReadBool(p, 'SHOWBORDER', false);
    this.TextMargin = ReadKiCadUnitFrac(aProps, 'TEXTMARGIN');

    this.AreaColor = U.ReadInt(p, 'AREACOLOR', 0);
    this.BorderColor = U.ReadInt(p, 'COLOR', 0);
    this.TextColor = U.ReadInt(p, 'TEXTCOLOR', 0);

    this.BorderWidth = ReadKiCadUnitFrac(aProps, 'LINEWIDTH');
    this.isSolid = U.ReadBool(p, 'ISSOLID', false);

    this.Alignment = ReadEnum(aProps, 'ALIGNMENT', 1, 3, ASCH_TEXT_FRAME_ALIGNMENT.LEFT);
  }
}

export class ASCH_NOTE extends ASCH_TEXT_FRAME {
  author: string;

  constructor(aProperties: ALTIUM_PROPS) {
    super(aProperties);
    this.author = U.ReadString(P(aProperties), 'AUTHOR', '');
  }
}

export class ASCH_BEZIER extends ASCH_OWNER_INTERFACE implements ASCH_BORDER {
  LineWidth: number;
  Color: number;
  points: VECTOR2I[];

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    ({ LineWidth: this.LineWidth, Color: this.Color } = readBorder(aProps));
    this.points = readPoints(aProps);
  }
}

export class ASCH_POLYLINE extends ASCH_OWNER_INTERFACE implements ASCH_BORDER {
  LineWidth: number;
  Color: number;
  Points: VECTOR2I[];
  LineStyle: ASCH_POLYLINE_LINESTYLE;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    ({ LineWidth: this.LineWidth, Color: this.Color } = readBorder(aProps));
    this.Points = readPoints(aProps);

    const lineStyleExt = ReadEnum(aProps, 'LINESTYLEEXT', 0, 3, ASCH_POLYLINE_LINESTYLE.SOLID);
    this.LineStyle = ReadEnum(aProps, 'LINESTYLE', 0, 3, lineStyleExt); // overwrite if present.
  }
}

export class ASCH_POLYGON extends ASCH_OWNER_INTERFACE implements ASCH_FILL, ASCH_BORDER {
  AreaColor: number;
  IsSolid: boolean;
  IsTransparent: boolean;
  LineWidth: number;
  Color: number;
  points: VECTOR2I[];

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    ({
      AreaColor: this.AreaColor,
      IsSolid: this.IsSolid,
      IsTransparent: this.IsTransparent,
    } = readFill(aProps));
    ({ LineWidth: this.LineWidth, Color: this.Color } = readBorder(aProps));
    this.points = readPoints(aProps);
  }
}

export class ASCH_ROUND_RECTANGLE extends ASCH_OWNER_INTERFACE implements ASCH_FILL, ASCH_BORDER {
  AreaColor: number;
  IsSolid: boolean;
  IsTransparent: boolean;
  LineWidth: number;
  Color: number;
  BottomLeft: VECTOR2I;
  TopRight: VECTOR2I;
  CornerRadius: VECTOR2I;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    ({
      AreaColor: this.AreaColor,
      IsSolid: this.IsSolid,
      IsTransparent: this.IsTransparent,
    } = readFill(aProps));
    ({ LineWidth: this.LineWidth, Color: this.Color } = readBorder(aProps));

    this.BottomLeft = location(aProps);
    this.TopRight = pt(aProps, 'CORNER.X', 'CORNER.Y');
    this.CornerRadius = {
      x: ReadKiCadUnitFrac(aProps, 'CORNERXRADIUS'),
      y: -ReadKiCadUnitFrac(aProps, 'CORNERYRADIUS'),
    };
  }
}

export class ASCH_ARC extends ASCH_OWNER_INTERFACE implements ASCH_BORDER, ASCH_FILL {
  LineWidth: number;
  Color: number;
  AreaColor: number;
  IsSolid: boolean;
  IsTransparent: boolean;
  m_IsElliptical: boolean;
  m_Center: VECTOR2I;
  m_Radius: number;
  m_SecondaryRadius: number;
  m_StartAngle: number;
  m_EndAngle: number;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    ({ LineWidth: this.LineWidth, Color: this.Color } = readBorder(aProps));
    ({
      AreaColor: this.AreaColor,
      IsSolid: this.IsSolid,
      IsTransparent: this.IsTransparent,
    } = readFill(aProps));

    this.m_IsElliptical = ReadRecord(aProps) === ALTIUM_SCH_RECORD.ELLIPTICAL_ARC;

    this.m_Center = location(aProps);
    this.m_Radius = ReadKiCadUnitFrac(aProps, 'RADIUS');
    this.m_SecondaryRadius = this.m_Radius;

    if (this.m_IsElliptical) this.m_SecondaryRadius = ReadKiCadUnitFrac(aProps, 'SECONDARYRADIUS');

    this.m_StartAngle = U.ReadDouble(P(aProps), 'STARTANGLE', 0);
    this.m_EndAngle = U.ReadDouble(P(aProps), 'ENDANGLE', 0);
  }
}

export class ASCH_PIECHART extends ASCH_ARC {}

export class ASCH_ELLIPSE extends ASCH_OWNER_INTERFACE implements ASCH_FILL, ASCH_BORDER {
  AreaColor: number;
  IsSolid: boolean;
  IsTransparent: boolean;
  LineWidth: number;
  Color: number;
  Center: VECTOR2I;
  Radius: number;
  SecondaryRadius: number;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    ({
      AreaColor: this.AreaColor,
      IsSolid: this.IsSolid,
      IsTransparent: this.IsTransparent,
    } = readFill(aProps));
    ({ LineWidth: this.LineWidth, Color: this.Color } = readBorder(aProps));

    this.Center = location(aProps);
    this.Radius = ReadKiCadUnitFrac(aProps, 'RADIUS');
    this.SecondaryRadius = ReadKiCadUnitFrac(aProps, 'SECONDARYRADIUS');
  }
}

export class ASCH_LINE extends ASCH_OWNER_INTERFACE implements ASCH_BORDER {
  LineWidth: number;
  Color: number;
  point1: VECTOR2I;
  point2: VECTOR2I;
  LineStyle: ASCH_POLYLINE_LINESTYLE;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    ({ LineWidth: this.LineWidth, Color: this.Color } = readBorder(aProps));

    this.point1 = location(aProps);
    this.point2 = pt(aProps, 'CORNER.X', 'CORNER.Y');

    const lineStyleExt = ReadEnum(aProps, 'LINESTYLEEXT', 0, 3, ASCH_POLYLINE_LINESTYLE.SOLID);
    this.LineStyle = ReadEnum(aProps, 'LINESTYLE', 0, 3, lineStyleExt); // overwrite if present.
  }
}

export class ASCH_SIGNAL_HARNESS extends ASCH_OWNER_INTERFACE {
  point1: VECTOR2I = { x: 0, y: 0 };
  point2: VECTOR2I = { x: 0, y: 0 };
  points: VECTOR2I[];
  color: number;
  lineWidth: number;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    this.points = readPoints(aProps);
    this.color = U.ReadInt(P(aProps), 'COLOR', 0);
    this.lineWidth = ReadKiCadUnitFrac(aProps, 'LINEWIDTH');
  }
}

export class ASCH_HARNESS_CONNECTOR extends ASCH_OWNER_INTERFACE {
  m_location: VECTOR2I;
  m_size: VECTOR2I;
  m_areaColor: number;
  m_color: number;
  m_lineWidth: number;
  m_primaryConnectionPosition: number;
  m_harnessConnectorSide: ASCH_SHEET_ENTRY_SIDE;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.m_location = location(aProps);
    this.m_size = { x: ReadKiCadUnitFrac(aProps, 'XSIZE'), y: ReadKiCadUnitFrac(aProps, 'YSIZE') };

    this.m_color = U.ReadInt(p, 'COLOR', 0);
    this.m_areaColor = U.ReadInt(p, 'AREACOLOR', 0);

    this.indexinsheet = 0;
    this.m_lineWidth = 0;
    this.m_primaryConnectionPosition = U.ReadInt(p, 'PRIMARYCONNECTIONPOSITION', 0);
    this.m_harnessConnectorSide = ReadEnum(aProps, 'SIDE', 0, 3, ASCH_SHEET_ENTRY_SIDE.RIGHT);
  }
}

export class ASCH_HARNESS_ENTRY extends ASCH_OWNER_INTERFACE {
  AreaColor: number;
  Color: number;
  DistanceFromTop: number;
  TextColor: number;
  TextFontID: number;
  TextStyle: number;
  OwnerIndexAdditionalList: boolean; // what is that?
  Name: string;
  Side: ASCH_SHEET_ENTRY_SIDE;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    // use SCH_IO_ALTIUM::m_harnessEntryParent instead, because this property sometimes
    // does not exist in altium file!

    this.DistanceFromTop = ReadKiCadUnitFrac1(aProps, 'DISTANCEFROMTOP');
    this.Side = ReadEnum(aProps, 'SIDE', 0, 3, ASCH_SHEET_ENTRY_SIDE.LEFT);
    this.Name = U.ReadString(p, 'NAME', '');
    this.OwnerIndexAdditionalList = U.ReadBool(p, 'OWNERINDEXADDITIONALLIST', true);

    this.Color = U.ReadInt(p, 'COLOR', 0);
    this.AreaColor = U.ReadInt(p, 'AREACOLOR', 0);
    this.TextColor = U.ReadInt(p, 'TEXTCOLOR', 0);
    this.TextFontID = U.ReadInt(p, 'TEXTFONTID', 0);
    this.TextStyle = 0;
  }
}

export class ASCH_HARNESS_TYPE extends ASCH_OWNER_INTERFACE {
  Color: number;
  FontID: number;
  IsHidden: boolean;
  OwnerIndexAdditionalList: boolean; // what is that?
  Location: VECTOR2I;
  Text: string;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.Text = U.ReadString(p, 'TEXT', '');
    this.Location = location(aProps);
    this.IsHidden = U.ReadBool(p, 'ISHIDDEN', false);
    this.OwnerIndexAdditionalList = U.ReadBool(p, 'OWNERINDEXADDITIONALLIST', true);
    this.Color = U.ReadInt(p, 'COLOR', 0);
    this.FontID = U.ReadInt(p, 'TEXTFONTID', 0);
  }
}

export class ASCH_RECTANGLE extends ASCH_OWNER_INTERFACE implements ASCH_FILL, ASCH_BORDER {
  AreaColor: number;
  IsSolid: boolean;
  IsTransparent: boolean;
  LineWidth: number;
  Color: number;
  BottomLeft: VECTOR2I;
  TopRight: VECTOR2I;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    ({
      AreaColor: this.AreaColor,
      IsSolid: this.IsSolid,
      IsTransparent: this.IsTransparent,
    } = readFill(aProps));
    ({ LineWidth: this.LineWidth, Color: this.Color } = readBorder(aProps));

    this.BottomLeft = location(aProps);
    this.TopRight = pt(aProps, 'CORNER.X', 'CORNER.Y');
  }
}

export class ASCH_SHEET_SYMBOL extends ASCH_OWNER_INTERFACE {
  location: VECTOR2I;
  size: VECTOR2I;
  isSolid: boolean;
  color: number;
  areacolor: number;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.location = location(aProps);
    this.size = { x: ReadKiCadUnitFrac(aProps, 'XSIZE'), y: ReadKiCadUnitFrac(aProps, 'YSIZE') };
    this.isSolid = U.ReadBool(p, 'ISSOLID', false);
    this.color = U.ReadInt(p, 'COLOR', 0);
    this.areacolor = U.ReadInt(p, 'AREACOLOR', 0);
  }
}

export class ASCH_SHEET_ENTRY extends ASCH_OWNER_INTERFACE {
  distanceFromTop: number;
  side: ASCH_SHEET_ENTRY_SIDE;
  iotype: ASCH_PORT_IOTYPE;
  style: ASCH_PORT_STYLE;
  name: string;
  harnessType: string;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    // some magic, because it stores those infos in a different unit??
    this.distanceFromTop = ReadKiCadUnitFrac1(aProps, 'DISTANCEFROMTOP');
    this.side = ReadEnum(aProps, 'SIDE', 0, 3, ASCH_SHEET_ENTRY_SIDE.LEFT);
    this.name = U.ReadString(p, 'NAME', '');
    this.harnessType = U.ReadString(p, 'HARNESSTYPE', '');
    this.iotype = ReadEnum(aProps, 'IOTYPE', 0, 3, ASCH_PORT_IOTYPE.UNSPECIFIED);
    this.style = ReadEnum(aProps, 'STYLE', 0, 7, ASCH_PORT_STYLE.NONE_HORIZONTAL);
  }
}

export class ASCH_POWER_PORT extends ASCH_OWNER_INTERFACE {
  text: string;
  showNetName: boolean;
  location: VECTOR2I;
  orientation: ASCH_RECORD_ORIENTATION;
  style: ASCH_POWER_PORT_STYLE;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.location = location(aProps);
    this.orientation = ReadEnum(aProps, 'ORIENTATION', 0, 3, ASCH_RECORD_ORIENTATION.RIGHTWARDS);
    this.text = U.ReadString(p, 'TEXT', '');
    this.showNetName = U.ReadBool(p, 'SHOWNETNAME', true);
    this.style = ReadEnum(aProps, 'STYLE', 0, 10, ASCH_POWER_PORT_STYLE.CIRCLE);
  }
}

export class ASCH_PORT extends ASCH_OWNER_INTERFACE {
  Name: string;
  HarnessType: string;
  Location: VECTOR2I;
  Width: number;
  Height: number;
  AreaColor: number;
  Color: number;
  TextColor: number;
  FontID: number;
  m_align: ASCH_PORT_ALIGNMENT;
  IOtype: ASCH_PORT_IOTYPE;
  Style: ASCH_PORT_STYLE;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.Location = location(aProps);
    this.Name = U.ReadString(p, 'NAME', '');
    this.HarnessType = U.ReadString(p, 'HARNESSTYPE', '');

    this.Width = ReadKiCadUnitFrac(aProps, 'WIDTH');
    this.Height = ReadKiCadUnitFrac(aProps, 'HEIGHT');

    this.IOtype = ReadEnum(aProps, 'IOTYPE', 0, 3, ASCH_PORT_IOTYPE.UNSPECIFIED);
    this.Style = ReadEnum(aProps, 'STYLE', 0, 7, ASCH_PORT_STYLE.NONE_HORIZONTAL);

    this.AreaColor = U.ReadInt(p, 'AREACOLOR', 0);
    this.Color = U.ReadInt(p, 'COLOR', 0);
    this.FontID = U.ReadInt(p, 'TEXTFONTID', 0);
    this.TextColor = U.ReadInt(p, 'TEXTCOLOR', 0);

    this.m_align = ReadEnum(aProps, 'ALIGNMENT', 0, 2, ASCH_PORT_ALIGNMENT.CENTER);
  }
}

export class ASCH_NO_ERC {
  location: VECTOR2I;
  isActive: boolean;
  suppressAll: boolean;

  constructor(aProps: ALTIUM_PROPS) {
    this.location = location(aProps);
    this.isActive = U.ReadBool(P(aProps), 'ISACTIVE', true);
    // `suppressAll = ReadInt( aProps, "SUPPRESSALL", true )`: an int into a bool.
    this.suppressAll = U.ReadInt(P(aProps), 'SUPPRESSALL', 1) !== 0;
  }
}

export class ASCH_NET_LABEL extends ASCH_OWNER_INTERFACE {
  text: string;
  location: VECTOR2I;
  justification: ASCH_LABEL_JUSTIFICATION;
  orientation: ASCH_RECORD_ORIENTATION;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);

    this.text = U.ReadString(P(aProps), 'TEXT', '');
    this.location = location(aProps);
    this.justification = ReadEnum(
      aProps,
      'JUSTIFICATION',
      0,
      8,
      ASCH_LABEL_JUSTIFICATION.BOTTOM_LEFT,
    );
    this.orientation = ReadEnum(aProps, 'ORIENTATION', 0, 3, ASCH_RECORD_ORIENTATION.RIGHTWARDS);
  }
}

export class ASCH_BUS extends ASCH_OWNER_INTERFACE {
  lineWidth: number;
  points: VECTOR2I[];

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    this.points = readPoints(aProps);
    this.lineWidth = ReadKiCadUnitFrac(aProps, 'LINEWIDTH');
  }
}

export class ASCH_WIRE extends ASCH_OWNER_INTERFACE {
  lineWidth: number;
  points: VECTOR2I[];

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    this.points = readPoints(aProps);
    this.lineWidth = ReadKiCadUnitFrac(aProps, 'LINEWIDTH');
  }
}

export class ASCH_JUNCTION extends ASCH_OWNER_INTERFACE {
  location: VECTOR2I;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    this.location = location(aProps);
  }
}

export class ASCH_IMAGE extends ASCH_OWNER_INTERFACE implements ASCH_BORDER {
  LineWidth: number;
  Color: number;
  filename: string;
  location: VECTOR2I;
  corner: VECTOR2I;
  embedimage: boolean;
  keepaspect: boolean;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    ({ LineWidth: this.LineWidth, Color: this.Color } = readBorder(aProps));
    const p = P(aProps);

    this.filename = U.ReadString(p, 'FILENAME', '');
    this.location = location(aProps);
    this.corner = pt(aProps, 'CORNER.X', 'CORNER.Y');
    this.embedimage = U.ReadBool(p, 'EMBEDIMAGE', false);
    this.keepaspect = U.ReadBool(p, 'KEEPASPECT', false);
  }
}

export class ASCH_SHEET_FONT extends ASCH_OWNER_INTERFACE {
  FontName: string;
  Size: number;
  Rotation: number;
  AreaColor: number;
  Italic: boolean;
  Bold: boolean;
  Underline: boolean;

  constructor(aProps: ALTIUM_PROPS, aId: number) {
    super(aProps);
    const p = P(aProps);
    const sid = `${aId}`;

    this.FontName = U.ReadString(p, `FONTNAME${sid}`, '');
    this.Size = ReadKiCadUnitFrac(aProps, `SIZE${sid}`);
    this.Rotation = U.ReadInt(p, `ROTATION${sid}`, 0);
    this.Italic = U.ReadBool(p, `ITALIC${sid}`, false);
    this.Bold = U.ReadBool(p, `BOLD${sid}`, false);
    this.Underline = U.ReadBool(p, `UNDERLINE${sid}`, false);
    this.AreaColor = U.ReadInt(p, `AREACOLOR${sid}`, 0);
  }
}

export function ASchSheetGetSize(aSheetSize: ASCH_SHEET_SIZE): VECTOR2I {
  // From: https://github.com/vadmium/python-altium/blob/master/format.md#sheet
  switch (aSheetSize) {
    case ASCH_SHEET_SIZE.A3:
      return { x: 1550, y: 1110 };
    case ASCH_SHEET_SIZE.A2:
      return { x: 2230, y: 1570 };
    case ASCH_SHEET_SIZE.A1:
      return { x: 3150, y: 2230 };
    case ASCH_SHEET_SIZE.A0:
      return { x: 4460, y: 3150 };
    case ASCH_SHEET_SIZE.A:
      return { x: 950, y: 750 };
    case ASCH_SHEET_SIZE.B:
      return { x: 1500, y: 950 };
    case ASCH_SHEET_SIZE.C:
      return { x: 2000, y: 1500 };
    case ASCH_SHEET_SIZE.D:
      return { x: 3200, y: 2000 };
    case ASCH_SHEET_SIZE.E:
      return { x: 4200, y: 3200 };
    case ASCH_SHEET_SIZE.LETTER:
      return { x: 1100, y: 850 };
    case ASCH_SHEET_SIZE.LEGAL:
      return { x: 1400, y: 850 };
    case ASCH_SHEET_SIZE.TABLOID:
      return { x: 1700, y: 1100 };
    case ASCH_SHEET_SIZE.ORCAD_A:
      return { x: 990, y: 790 };
    case ASCH_SHEET_SIZE.ORCAD_B:
      return { x: 1540, y: 990 };
    case ASCH_SHEET_SIZE.ORCAD_C:
      return { x: 2060, y: 1560 };
    case ASCH_SHEET_SIZE.ORCAD_D:
      return { x: 3260, y: 2060 };
    case ASCH_SHEET_SIZE.ORCAD_E:
      return { x: 4280, y: 3280 };
    default:
      return { x: 1150, y: 760 }; // A4
  }
}

export class ASCH_SHEET extends ASCH_OWNER_INTERFACE {
  fonts: ASCH_SHEET_FONT[] = [];
  useCustomSheet: boolean;
  customSize: VECTOR2I;
  sheetSize: ASCH_SHEET_SIZE;
  sheetOrientation: ASCH_SHEET_WORKSPACEORIENTATION;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    const fontidcount = U.ReadInt(p, 'FONTIDCOUNT', 0);

    for (let i = 1; i <= fontidcount; i++) this.fonts.push(new ASCH_SHEET_FONT(aProps, i));

    this.useCustomSheet = U.ReadBool(p, 'USECUSTOMSHEET', false);
    this.customSize = {
      x: ReadKiCadUnitFrac(aProps, 'CUSTOMX'),
      y: ReadKiCadUnitFrac(aProps, 'CUSTOMY'),
    };
    this.sheetSize = ReadEnum(aProps, 'SHEETSTYLE', 0, 17, ASCH_SHEET_SIZE.A4);
    this.sheetOrientation = ReadEnum(
      aProps,
      'WORKSPACEORIENTATION',
      0,
      1,
      ASCH_SHEET_WORKSPACEORIENTATION.LANDSCAPE,
    );
  }
}

export class ASCH_SHEET_NAME extends ASCH_OWNER_INTERFACE {
  text: string;
  orientation: ASCH_RECORD_ORIENTATION;
  location: VECTOR2I;
  isHidden: boolean;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    this.text = U.ReadString(P(aProps), 'TEXT', '');
    this.orientation = ReadEnum(aProps, 'ORIENTATION', 0, 3, ASCH_RECORD_ORIENTATION.RIGHTWARDS);
    this.location = location(aProps);
    this.isHidden = U.ReadBool(P(aProps), 'ISHIDDEN', false);
  }
}

export class ASCH_FILE_NAME extends ASCH_OWNER_INTERFACE {
  text: string;
  orientation: ASCH_RECORD_ORIENTATION;
  location: VECTOR2I;
  isHidden: boolean;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    this.text = U.ReadString(P(aProps), 'TEXT', '');
    this.orientation = ReadEnum(aProps, 'ORIENTATION', 0, 3, ASCH_RECORD_ORIENTATION.RIGHTWARDS);
    this.location = location(aProps);
    this.isHidden = U.ReadBool(P(aProps), 'ISHIDDEN', false);
  }
}

export class ASCH_DESIGNATOR extends ASCH_OWNER_INTERFACE {
  name: string;
  text: string;
  fontId: number;
  orientation: ASCH_RECORD_ORIENTATION;
  justification: ASCH_LABEL_JUSTIFICATION;
  location: VECTOR2I;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.name = U.ReadString(p, 'NAME', '');
    this.text = U.ReadString(p, 'TEXT', '');
    this.fontId = U.ReadInt(p, 'FONTID', 0);
    this.justification = ReadEnum(
      aProps,
      'JUSTIFICATION',
      0,
      8,
      ASCH_LABEL_JUSTIFICATION.BOTTOM_LEFT,
    );
    this.orientation = ReadEnum(aProps, 'ORIENTATION', 0, 3, ASCH_RECORD_ORIENTATION.RIGHTWARDS);
    this.location = location(aProps);
  }
}

export class ASCH_IMPLEMENTATION extends ASCH_OWNER_INTERFACE {
  name: string;
  type: string;
  libname: string;
  description: string;
  isCurrent: boolean;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.ownerindex = U.ReadInt(p, 'OWNERINDEX', ALTIUM_COMPONENT_NONE);
    this.name = U.ReadString(p, 'MODELNAME', '');
    this.type = U.ReadString(p, 'MODELTYPE', '');
    this.libname = U.ReadString(p, 'MODELDATAFILE0', '');
    this.description = U.ReadString(p, 'DESCRIPTION', '');
    this.isCurrent = U.ReadBool(p, 'ISCURRENT', false);
  }
}

export class ASCH_IMPLEMENTATION_LIST extends ASCH_OWNER_INTERFACE {}

export class ASCH_BUS_ENTRY extends ASCH_OWNER_INTERFACE {
  location: VECTOR2I;
  corner: VECTOR2I;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    this.location = location(aProps);
    this.corner = pt(aProps, 'CORNER.X', 'CORNER.Y');
  }
}

export class ASCH_PARAMETER extends ASCH_OWNER_INTERFACE {
  location: VECTOR2I;
  justification: ASCH_LABEL_JUSTIFICATION;
  orientation: ASCH_RECORD_ORIENTATION;
  name: string;
  text: string;
  isHidden: boolean;
  isMirrored: boolean;
  isShowName: boolean;
  fontId: number;

  constructor(aProps: ALTIUM_PROPS) {
    super(aProps);
    const p = P(aProps);

    this.location = location(aProps);
    this.justification = ReadEnum(
      aProps,
      'JUSTIFICATION',
      0,
      8,
      ASCH_LABEL_JUSTIFICATION.BOTTOM_LEFT,
    );
    this.orientation = ReadEnum(aProps, 'ORIENTATION', 0, 3, ASCH_RECORD_ORIENTATION.RIGHTWARDS);

    this.name = U.ReadString(p, 'NAME', '');
    this.text = U.ReadString(p, 'TEXT', '');

    this.isHidden = U.ReadBool(p, 'ISHIDDEN', false);
    this.isMirrored = U.ReadBool(p, 'ISMIRRORED', false);
    this.isShowName = U.ReadBool(p, 'SHOWNAME', false);

    this.fontId = U.ReadInt(p, 'FONTID', 0);
  }
}
