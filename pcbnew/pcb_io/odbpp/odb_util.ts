// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/odbpp/odb_util.{h,cpp}` and `odb_defines.h`: the ODB++ enums and name rules, the
 * number formatting, the tree / file / text writers and the drill tools file.
 *
 * The tree writer keeps every file it is handed in memory (path -> text) along with the folders it
 * made, and the plugin hands them on through its file writer: the browser has no folder to make.
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { fixed } from '@ziroeda/common/plotters/fmt.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { PCB_SHAPE } from '../../pcb_shape.js';

// odb_defines.h
export const ODB_JOB_NAME = 'JOB_NAME';
export const ODB_UNITS = 'UNITS';
export const ODB_DIM_X = 'x';
export const ODB_DIM_R = 'r';
export const ODB_DIM_C = 'c';
export const ODB_NONE = 'NONE';

export enum ODB_POLARITY {
  POSITIVE,
  NEGATIVE,
}

export enum ODB_CONTEXT {
  BOARD,
  MISC,
}

export enum ODB_DIELECTRIC_TYPE {
  NONE,
  PREPREG,
  CORE,
}

export enum ODB_TYPE {
  UNDEFINED,
  SIGNAL,
  POWER_GROUND,
  DIELECTRIC,
  MIXED,
  SOLDER_MASK,
  SOLDER_PASTE,
  SILK_SCREEN,
  DRILL,
  ROUT,
  DOCUMENT,
  COMPONENT,
  MASK,
  CONDUCTIVE_PASTE,
}

export enum ODB_SUBTYPE {
  COVERLAY,
  COVERCOAT,
  STIFFENER,
  BEND_AREA,
  FLEX_AREA,
  RIGID_AREA,
  PSA,
  SILVER_MASK,
  CARBON_MASK,
  BACKDRILL,
}

export enum ODB_FID_TYPE {
  COPPER,
  LAMINATE,
  HOLE,
}

export enum ODB_AUX_LAYER_TYPE {
  COVERING,
  PLUGGING,
  TENTING,
  FILLING,
  CAPPING,
}

/** The plugin's export settings, upstream's PCB_IO_ODBPP statics. */
export const ODB_SETTINGS = {
  m_scale: 1.0 / 1e6,
  m_symbolScale: 1.0 / 1e3,
  m_sigfig: 4,
  m_unitsStr: 'MM',
};

const ENUM_STRINGS = new Map<object, Map<number, string>>([
  [
    ODB_POLARITY,
    new Map([
      [ODB_POLARITY.POSITIVE, 'POSITIVE'],
      [ODB_POLARITY.NEGATIVE, 'NEGATIVE'],
    ]),
  ],
  [
    ODB_CONTEXT,
    new Map([
      [ODB_CONTEXT.BOARD, 'BOARD'],
      [ODB_CONTEXT.MISC, 'MISC'],
    ]),
  ],
  [
    ODB_TYPE,
    new Map([
      //just for logical reasons.TYPE field must be defined.
      [ODB_TYPE.UNDEFINED, ''],
      [ODB_TYPE.SIGNAL, 'SIGNAL'],
      [ODB_TYPE.POWER_GROUND, 'POWER_GROUND'],
      [ODB_TYPE.DIELECTRIC, 'DIELECTRIC'],
      [ODB_TYPE.MIXED, 'MIXED'],
      [ODB_TYPE.SOLDER_MASK, 'SOLDER_MASK'],
      [ODB_TYPE.SOLDER_PASTE, 'SOLDER_PASTE'],
      [ODB_TYPE.SILK_SCREEN, 'SILK_SCREEN'],
      [ODB_TYPE.DRILL, 'DRILL'],
      [ODB_TYPE.ROUT, 'ROUT'],
      [ODB_TYPE.DOCUMENT, 'DOCUMENT'],
      [ODB_TYPE.COMPONENT, 'COMPONENT'],
      [ODB_TYPE.MASK, 'MASK'],
      [ODB_TYPE.CONDUCTIVE_PASTE, 'CONDUCTIVE_PASTE'],
    ]),
  ],
  [
    ODB_SUBTYPE,
    new Map([
      [ODB_SUBTYPE.COVERLAY, 'COVERLAY'],
      [ODB_SUBTYPE.COVERCOAT, 'COVERCOAT'],
      [ODB_SUBTYPE.STIFFENER, 'STIFFENER'],
      [ODB_SUBTYPE.BEND_AREA, 'BEND_AREA'],
      [ODB_SUBTYPE.FLEX_AREA, 'FLEX_AREA'],
      [ODB_SUBTYPE.RIGID_AREA, 'RIGID_AREA'],
      [ODB_SUBTYPE.PSA, 'PSA'],
      [ODB_SUBTYPE.SILVER_MASK, 'SILVER_MASK'],
      [ODB_SUBTYPE.CARBON_MASK, 'CARBON_MASK'],
      [ODB_SUBTYPE.BACKDRILL, 'BACKDRILL'],
    ]),
  ],
  [
    ODB_DIELECTRIC_TYPE,
    new Map([
      [ODB_DIELECTRIC_TYPE.NONE, 'NONE'],
      [ODB_DIELECTRIC_TYPE.PREPREG, 'PREPREG'],
      [ODB_DIELECTRIC_TYPE.CORE, 'CORE'],
    ]),
  ],
  [
    ODB_FID_TYPE,
    new Map([
      [ODB_FID_TYPE.COPPER, 'C'],
      [ODB_FID_TYPE.LAMINATE, 'L'],
      [ODB_FID_TYPE.HOLE, 'H'],
    ]),
  ],
]);

/** `ODB::Enum2String`: the enum is named by its TS enum object. */
export function Enum2String(aEnum: object, aValue: number): string {
  const s = ENUM_STRINGS.get(aEnum)?.get(aValue);

  if (s === undefined) throw new RangeError('Enum value not found in map');

  return s;
}

const isGraph = (c: number): boolean => c > 32 && c < 127;

/** `ODB::GenODBString`: printable ASCII only (others become `?`), upper-cased. */
export function GenODBString(aStr: string): string {
  let str = '';

  for (const ch of aStr) {
    const c = ch.codePointAt(0)!;
    str += c > 126 || !isGraph(c) ? '?' : ch;
  }

  return str.toUpperCase();
}

/** `std::string( aStr.ToStdString() )`: the current locale's narrow form, UTF-8 here. */
function utf8Units(aStr: string): number[] {
  return [...new TextEncoder().encode(aStr)].map((b) => (b > 127 ? b - 256 : b));
}

/** `ODB::GenLegalNetName`: each byte of the UTF-8 form, ';' and outside 33..126 to `_`. */
export function GenLegalNetName(aStr: string): string {
  let out = '';

  for (const c of utf8Units(aStr))
    out += c >= 33 && c <= 126 && c !== 59 ? String.fromCharCode(c) : '_';

  return out;
}

/** `ODB::GenLegalComponentName`: printable ASCII (33..126) but ';', anything else `_`. */
export function GenLegalComponentName(aStr: string): string {
  let out = '';

  for (const ch of aStr) {
    const c = ch.codePointAt(0)!;
    out += c >= 33 && c <= 126 && c !== 59 ? ch : '_';
  }

  return out;
}

/**
 * `ODB::GenLegalEntityName`: the names of products, models, steps, layers, symbols and
 * attributes - lower case letters, digits and `-_+.`, the rest `_`; at most 64; no leading
 * `.-+`, no trailing `.`.
 */
export function GenLegalEntityName(aStr: string): string {
  let out = '';

  for (const c of utf8Units(aStr)) {
    // isalpha / isdigit in the "C" locale: a negative char is neither.
    const ch = c >= 0 ? String.fromCharCode(c) : '';

    if (/^[A-Za-z]$/.test(ch)) out += ch.toLowerCase();
    else if (/^[0-9\-_+.]$/.test(ch)) out += ch;
    else out += '_';
  }

  if (out.length > 64) out = out.substring(0, 64);

  while (out !== '' && (out[0] === '.' || out[0] === '-' || out[0] === '+')) out = out.substring(1);

  while (out !== '' && out[out.length - 1] === '.') out = out.slice(0, -1);

  return out;
}

/** `ODB::RemoveWhitespace`: trimmed, then every white-space character to `_`. */
export function RemoveWhitespace(aStr: string): string {
  // wxString::Trim: spaces, tabs and newlines at the ends (wxSafeIsspace).
  const trimmed = aStr.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');
  // wxRegEx "\\s" (extended): [[:space:]].
  return trimmed.replace(/[ \t\n\v\f\r]/g, '_');
}

/** `ODB::Double2String( aVal )`: `m_sigfig` decimals, trailing zeros trimmed to one. */
export function Double2String(aVal: number): string {
  // We don't want to output -0.0 as this value is just 0 for fabs
  let v = aVal;

  if (v === 0) v = 0;

  let str = fixed(v, ODB_SETTINGS.m_sigfig);

  // Remove all but the last trailing zeros from str
  while (str.endsWith('00')) str = str.slice(0, -1);

  return str;
}

/** `ODB::Double2String( aVal, aDigits )`: exactly `aDigits` decimals. */
export function Double2StringDigits(aVal: number, aDigits: number): string {
  let v = aVal;

  if (v === 0) v = 0;

  return fixed(v, aDigits);
}

export function SymDouble2String(aVal: number): string {
  return Double2String(ODB_SETTINGS.m_symbolScale * aVal);
}

export function Data2String(aVal: number): string {
  return Double2String(ODB_SETTINGS.m_scale * aVal);
}

/** `ODB::AddXY`: a board point in output units, y up. */
export function AddXY(aVec: { x: number; y: number }): [string, string] {
  // TODO: to deal with user preference x y increment setting
  return [
    Double2String(ODB_SETTINGS.m_scale * aVec.x),
    Double2String(-ODB_SETTINGS.m_scale * aVec.y),
  ];
}

/** `ODB::GetShapePosition`: a rectangle's centre, any other shape's position. */
export function GetShapePosition(aShape: PCB_SHAPE): VECTOR2I {
  if (aShape.GetShape() === SHAPE_T.RECTANGLE) {
    // Rectangles in KiCad are mapped by their corner while ODBPP uses the center
    const p = aShape.GetPosition();
    // VECTOR2I( double, double ): the int conversion truncates.
    return {
      x: p.x + Math.trunc(aShape.GetRectangleWidth() / 2.0),
      y: p.y + Math.trunc(aShape.GetRectangleHeight() / 2.0),
    };
  }

  return aShape.GetPosition();
}

/** `ODB::CHECK_ONCE`: true the first time it is called, false after. */
export class CHECK_ONCE {
  private first = true;

  call(): boolean {
    if (this.first) {
      this.first = false;
      return true;
    }

    return false;
  }
}

/** A `std::ostream` that collects text. */
export class OSTREAM {
  private parts: string[] = [];

  write(...aParts: (string | number)[]): this {
    for (const p of aParts) this.parts.push(String(p));

    return this;
  }

  str(): string {
    return this.parts.join('');
  }
}

/**
 * `ODB_TREE_WRITER`: the current folder of the tree being written, and (here) every folder and
 * file written so far.
 */
export class ODB_TREE_WRITER {
  private m_currentPath: string;
  private m_rootPath = '';
  readonly m_dirs: string[] = [];
  readonly m_files = new Map<string, OSTREAM>();

  constructor(aDir: string) {
    this.m_currentPath = aDir;
  }

  /** `CreateFileProxy`: a file in the current folder, emptied (trunc). */
  CreateFileProxy(aFileName: string): ODB_FILE_WRITER {
    return new ODB_FILE_WRITER(this, aFileName);
  }

  /** `CreateEntityDirectory`: `aPareDir/aSubDir` (lower-cased), made, and current. */
  CreateEntityDirectory(aPareDir: string, aSubDir = ''): void {
    const parts = aSubDir
      .toLowerCase()
      .split('/')
      .filter((p) => p !== '');
    let path = aPareDir;

    for (const p of parts) {
      path = path === '' ? p : `${path}/${p}`;

      if (!this.m_dirs.includes(path)) this.m_dirs.push(path);
    }

    this.m_currentPath = path;
  }

  GetCurrentPath(): string {
    return this.m_currentPath;
  }

  SetCurrentPath(aDir: string): void {
    this.m_currentPath = aDir;
  }

  SetRootPath(aDir: string): void {
    this.m_rootPath = aDir;
  }

  GetRootPath(): string {
    return this.m_rootPath;
  }
}

export class ODB_FILE_WRITER {
  private readonly m_stream: OSTREAM;

  constructor(aTreeWriter: ODB_TREE_WRITER, aFileName: string) {
    const dir = aTreeWriter.GetCurrentPath();
    const path = dir === '' ? aFileName : `${dir}/${aFileName}`;
    this.m_stream = new OSTREAM();
    aTreeWriter.m_files.set(path, this.m_stream);
  }

  GetStream(): OSTREAM {
    return this.m_stream;
  }
}

/** `ODB_TEXT_WRITER`: `KEY=value` lines, and `NAME {` … `}` arrays indented four spaces. */
export class ODB_TEXT_WRITER {
  private in_array = false;

  constructor(private readonly m_ostream: OSTREAM) {}

  WriteEquationLine(aVar: string, aValue: string | number): void {
    this.WriteIndent();
    this.m_ostream.write(aVar, '=', aValue, '\n');
  }

  write_line_enum(aVar: string, aEnum: object, aValue: number): void {
    this.WriteEquationLine(aVar, Enum2String(aEnum, aValue));
  }

  /** `MakeArrayProxy` for the length of `aBody`. */
  Array(aStr: string, aBody: () => void): void {
    this.BeginArray(aStr);
    aBody();
    this.EndArray();
  }

  private WriteIndent(): void {
    if (this.in_array) this.m_ostream.write('    ');
  }

  private BeginArray(a: string): void {
    if (this.in_array) throw new Error('already in array');

    this.in_array = true;
    this.m_ostream.write(a, ' {', '\n');
  }

  private EndArray(): void {
    if (!this.in_array) throw new Error('not in array');

    this.in_array = false;
    this.m_ostream.write('}', '\n', '\n');
  }
}

interface TOOLS {
  m_num: number;
  m_type: string;
  m_type2: string;
  m_minTol: number;
  m_maxTol: number;
  m_bit: string;
  m_finishSize: string;
  m_drillSize: string;
}

export class ODB_DRILL_TOOLS {
  m_tools: TOOLS[] = [];

  constructor(
    public m_units: string,
    public m_thickness = '0',
    public m_userParams = '',
  ) {}

  AddDrillTools(aType: string, aFinishSize: string, aType2 = 'STANDARD'): void {
    this.m_tools.push({
      m_num: this.m_tools.length + 1,
      m_type: aType,
      m_type2: aType2,
      m_minTol: 0,
      m_maxTol: 0,
      m_bit: '',
      m_finishSize: aFinishSize,
      m_drillSize: aFinishSize,
    });
  }

  GenerateFile(aStream: OSTREAM): void {
    const twriter = new ODB_TEXT_WRITER(aStream);

    twriter.WriteEquationLine('UNITS', this.m_units);
    twriter.WriteEquationLine('THICKNESS', this.m_thickness);
    twriter.WriteEquationLine('USER_PARAMS', this.m_userParams);

    for (const tool of this.m_tools) {
      twriter.Array('TOOLS', () => {
        twriter.WriteEquationLine('NUM', tool.m_num);
        twriter.WriteEquationLine('TYPE', tool.m_type);
        twriter.WriteEquationLine('TYPE2', tool.m_type2);
        twriter.WriteEquationLine('MIN_TOL', tool.m_minTol);
        twriter.WriteEquationLine('MAX_TOL', tool.m_maxTol);
        twriter.WriteEquationLine('BIT', tool.m_bit);
        twriter.WriteEquationLine('FINISH_SIZE', tool.m_finishSize);
        twriter.WriteEquationLine('DRILL_SIZE', tool.m_drillSize);
      });
    }
  }
}
