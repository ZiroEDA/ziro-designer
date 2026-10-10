// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/geda/sch_io_geda.cpp` / `.h`: `SCH_IO_GEDA`, the gEDA / Lepton EDA
 * schematic (`.sch`) importer.
 *
 * Symbol libraries are found as upstream finds them - component-library directives in the
 * rc files beside the schematic and in the user's gEDA folders, then the system symbol
 * folders - but through `m_readFile` / `m_listDir`, so a folder the file source cannot list
 * holds no symbols. What is still missing falls back to the built-in standard symbols
 * (geda_builtin_symbols.ts) and then to a placeholder box.
 *
 * The wx text handling is emulated where the importer depends on it: `wxTextFile` lines (any
 * of `\n`, `\r\n`, `\r` ends one), `wxStringTokenizer` over white space (empty tokens
 * skipped), and `wxString::ToLong`, which stores what strtol read even when it then fails.
 */
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ELECTRICAL_PINTYPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_LOW_DEF_MM } from '@ziroeda/kimath/src/base_units.js';
import { ANGLE_90, ANGLE_180, ANGLE_270 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { DEFAULT_SCH_ENTRY_SIZE } from '../../default_values.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_BITMAP } from '../../sch_bitmap.js';
import { SCH_BUS_WIRE_ENTRY } from '../../sch_bus_entry.js';
import { SCH_FIELD } from '../../sch_field.js';
import { SCH_JUNCTION } from '../../sch_junction.js';
import { SCH_GLOBALLABEL, SCH_LABEL, SPIN_STYLE } from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import { SCH_NO_CONNECT } from '../../sch_no_connect.js';
import { SCH_PIN } from '../../sch_pin.js';
import { SCH_SCREEN } from '../../sch_screen.js';
import { SCH_SHAPE } from '../../sch_shape.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SYMBOL } from '../../sch_symbol.js';
import { SCH_TEXT } from '../../sch_text.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SYMBOL_ORIENTATION_T } from '../../symbol.js';
import { SCH_IO, type SCH_IO_PROPERTIES } from '../sch_io.js';
import { GEDA_BUILTIN_SYMBOLS } from './geda_builtin_symbols.js';

const GEDA_DEFAULT_TEXT_SIZE_MILS = 50;

// Default body size for fallback rectangular symbols
const DEFAULT_SYMBOL_SIZE_MILS = 200;

/**
 * Convert gEDA overbar markup to KiCad syntax.
 *
 * gEDA uses \_text\_ to indicate an overbar (text with a line above it).
 * KiCad uses ~{text}. Escaped backslashes (\\) become a literal backslash.
 */
export function convertOverbars(aInput: string): string {
  let result = '';
  let i = 0;

  while (i < aInput.length) {
    if (i + 1 < aInput.length && aInput[i] === '\\' && aInput[i + 1] === '_') {
      const barEnd = aInput.indexOf('\\_', i + 2);

      if (barEnd !== -1) {
        result += `~{${aInput.substring(i + 2, barEnd)}}`;
        i = barEnd + 2;
      } else {
        result += aInput[i];
        i++;
      }
    } else if (i + 1 < aInput.length && aInput[i] === '\\' && aInput[i + 1] === '\\') {
      result += '\\';
      i += 2;
    } else {
      result += aInput[i];
      i++;
    }
  }

  return result;
}

/** `wxTextFile`: the lines of a text, any of `\n`, `\r\n`, `\r` ending one. */
export class WX_TEXT_FILE {
  private m_lines: string[];

  constructor(aText: string) {
    this.m_lines = aText === '' ? [] : aText.split(/\r\n|\n|\r/);

    // A final line break ends the last line; it does not start an empty one.
    if (this.m_lines.length > 0 && /(\r\n|\n|\r)$/.test(aText)) this.m_lines.pop();
  }

  GetLineCount(): number {
    return this.m_lines.length;
  }

  GetLine(aIdx: number): string {
    return this.m_lines[aIdx] ?? '';
  }

  /** `GetLine( n ).Trim()` on the non-const reference: the stored line is trimmed too. */
  TrimLine(aIdx: number): string {
    const t = wxTrimRight(this.GetLine(aIdx));
    this.m_lines[aIdx] = t;
    return t;
  }

  GetFirstLine(): string {
    return this.GetLine(0);
  }
}

/** `wxString::Trim()` (from the right): ' ', '\t', '\r', '\n', '\v', '\f'. */
export const wxTrimRight = (s: string): string => s.replace(/[ \t\r\n\v\f]+$/, '');

/** `wxString::Trim( false )` (from the left). */
export const wxTrimLeft = (s: string): string => s.replace(/^[ \t\r\n\v\f]+/, '');

/** `wxStringTokenizer( s )`: white-space delimiters, empty tokens skipped. */
export class WX_TOKENIZER {
  private m_tokens: string[];
  private m_pos = 0;

  constructor(aText: string) {
    this.m_tokens = aText.split(/[ \t\r\n]+/).filter((t) => t !== '');
  }

  HasMoreTokens(): boolean {
    return this.m_pos < this.m_tokens.length;
  }

  GetNextToken(): string {
    return this.m_tokens[this.m_pos++] ?? '';
  }

  CountTokens(): number {
    return this.m_tokens.length - this.m_pos;
  }

  /** `if( tok.HasMoreTokens() ) tok.GetNextToken().ToLong( &v )`: \a aCur when none is left. */
  nextLong(aCur: number): number {
    return this.HasMoreTokens() ? wxToLong(this.GetNextToken()).value : aCur;
  }
}

/**
 * `wxString::ToLong( &v )`: strtol base 10 over the whole string. The value strtol read is
 * stored whatever happens; `ok` only when the whole (non-empty) string was a number.
 */
export function wxToLong(aStr: string): { value: number; ok: boolean } {
  const m = /^[ \t\n\v\f\r]*([-+]?)(\d+)/.exec(aStr);

  if (!m) return { value: 0, ok: false };

  let v = Number.parseInt(m[2]!, 10);
  if (m[1] === '-') v = -v;

  // LONG_MAX (2^63 - 1) as a double is 2^63.
  const LONG_MAX = 2 ** 63;
  let range = true;

  if (v > LONG_MAX) {
    v = LONG_MAX;
    range = false;
  } else if (v < -LONG_MAX - 1) {
    v = -LONG_MAX - 1;
    range = false;
  }

  return { value: v, ok: m[0].length === aStr.length && range };
}

/** `wxStringTokenizer( s, aDelims )` with a delimiter that is not white space (wxTOKEN_RET_EMPTY):
 * empty tokens between delimiters are returned, but not after a final one. */
export class WX_TOKENIZER_RET_EMPTY {
  private m_tokens: string[];
  private m_pos = 0;

  constructor(aText: string, aDelims: string) {
    if (aText === '') {
      this.m_tokens = [];
      return;
    }

    const tokens: string[] = [];
    let cur = '';

    for (const c of aText) {
      if (aDelims.includes(c)) {
        tokens.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }

    if (cur !== '' || !aDelims.includes(aText[aText.length - 1]!)) tokens.push(cur);

    this.m_tokens = tokens;
  }

  HasMoreTokens(): boolean {
    return this.m_pos < this.m_tokens.length;
  }

  GetNextToken(): string {
    return this.m_tokens[this.m_pos++] ?? '';
  }

  All(): string[] {
    const rest = this.m_tokens.slice(this.m_pos);
    this.m_pos = this.m_tokens.length;
    return rest;
  }
}

/** `wxTextFile::Open`'s wxConvAuto: a UTF-8 BOM stripped, UTF-8 when valid, else ISO-8859-1. */
function decodeAuto(aData: Uint8Array): string {
  let bytes = aData;

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    bytes = bytes.subarray(3);

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

/** `wxBase64Decode` (wxBase64DecodeMode_Strict): any character outside the alphabet, white
 * space included, empties the result. */
function wxBase64Decode(aText: string): Uint8Array {
  const clean = aText;

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) return new Uint8Array(0);

  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** `wxFileName::MakeAbsolute` + `GetFullPath`: `.` and `..` resolved. */
function wxNormalizeAbsolute(aPath: string): string {
  const out: string[] = [];

  for (const part of aPath.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }

  return `/${out.join('/')}`;
}

/** Compute the Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; ++i) {
    curr[0] = i;

    for (let j = 1; j <= n; ++j) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }

    [prev, curr] = [curr, prev];
  }

  return prev[n]!;
}

/** `DEG2RAD`. */
const DEG2RAD = (aDeg: number): number => (aDeg * Math.PI) / 180.0;

/** `static_cast<int>( long )`: two's-complement truncation to 32 bits. */
const toInt = (v: number): number => Number(BigInt.asIntN(32, BigInt(Math.trunc(v))));

/** Parsed attribute from a gEDA T line inside a { } block. */
export interface GEDA_ATTR {
  name: string;
  value: string;
  x: number;
  y: number;
  size: number;
  angle: number;
  align: number;
  visible: boolean;
  showNV: number; ///< 0=name+value, 1=value, 2=name
}

/**
 * Pending component waiting for symbol resolution.
 * A gEDA C line defers actual symbol loading until we know whether
 * the definition is embedded ([] block) or from the library.
 */
interface PENDING_COMPONENT {
  basename: string;
  x: number;
  y: number;
  angle: number;
  mirror: number;
  selectable: number;
  attrs: GEDA_ATTR[];
  embedded: boolean;
  embeddedSym: LIB_SYMBOL | null;
}

/** Entry in the symbol library search cache. */
interface SYM_CACHE_ENTRY {
  path: string; ///< Full path to .sym file
  symbol: LIB_SYMBOL | null; ///< Loaded symbol (null if not yet loaded)
  symversion: string; ///< symversion from the .sym file (if any)
  netAttr: string; ///< net= attribute (e.g. "GND:1") identifying power symbols
}

interface NET_ATTR_RECORD {
  netname: string;
  pinnumber: string;
  symbol: SCH_SYMBOL;
}

/** Parsed bus segment in KiCad coordinates with gEDA ripper direction. */
interface BUS_SEGMENT {
  start: VECTOR2I;
  end: VECTOR2I;
  ripperDir: number; ///< -1, 0, or 1 from gEDA U line
}

interface DEFERRED_SHEET {
  sheet: SCH_SHEET;
  sourceFile: string; ///< Resolved full path to the sub-schematic
}

/** `wxFileName` pieces of a path. */
function fileNameParts(aPath: string): {
  path: string;
  name: string;
  ext: string;
  fullName: string;
} {
  const slash = aPath.lastIndexOf('/');
  const path = slash < 0 ? '' : aPath.substring(0, slash);
  const fullName = aPath.substring(slash + 1);
  const dot = fullName.lastIndexOf('.');
  return dot <= 0
    ? { path, name: fullName, ext: '', fullName }
    : { path, name: fullName.substring(0, dot), ext: fullName.substring(dot + 1), fullName };
}

const joinPath = (aDir: string, aName: string): string =>
  aDir === '' ? aName : `${aDir.replace(/\/+$/, '')}/${aName}`;

/** `std::map<wxString, …>` key order (code point). */
const cpLess = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class SCH_IO_GEDA extends SCH_IO {
  /** gEDA coordinates are mils with Y-up. KiCad uses 100nm IU with Y-down. */
  static readonly MILS_TO_IU = 254;

  private m_screen: SCH_SCREEN | null = null;
  private m_rootSheet: SCH_SHEET | null = null;
  private m_schematic: SCHEMATIC | null = null;
  private m_filename = '';

  /** The maximum Y coordinate seen during parsing (gEDA coords, before flip). */
  private m_maxY = 0;

  /** gEDA file version fields from the "v YYYYMMDD N" header line. */
  private m_releaseVersion = 0;
  private m_fileFormatVersion = 0;

  /** Pending component awaiting symbol resolution. */
  private m_pendingComp: PENDING_COMPONENT | null = null;

  /** Symbol library cache: gEDA basename -> cache entry. */
  private m_symLibrary = new Map<string, SYM_CACHE_ENTRY>();
  private m_symLibraryInitialized = false;

  /** Loaded symbols for this import session, keyed by basename. */
  private m_libSymbols = new Map<string, LIB_SYMBOL>();

  /** Sequential counter for auto-generated #PWR references. */
  private m_powerCounter = 0;

  /** Net endpoint positions in raw gEDA coordinates for junction detection. */
  private m_netEndpoints = new Map<string, [number, number, number]>();

  private m_netAttrRecords: NET_ATTR_RECORD[] = [];
  private m_busSegments: BUS_SEGMENT[] = [];
  private m_deferredSheets: DEFERRED_SHEET[] = [];

  /** Fully-resolved file paths currently in the import call stack. */
  private m_importStack = new Set<string>();

  /** Properties passed from the import framework (search paths, etc.) */
  private m_properties: SCH_IO_PROPERTIES | null = null;

  constructor() {
    super('gEDA/gschem Schematic');
  }

  override GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('gEDA / Lepton EDA schematic files', ['sch']);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('', []);
  }

  override GetModifyHash(): number {
    return 0;
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
  }

  /** Return the map of built-in gEDA symbol definitions (symbol name -> .sym content). */
  static getBuiltinSymbols(): ReadonlyMap<string, string> {
    return GEDA_BUILTIN_SYMBOLS;
  }

  /** A text file through the file source, decoded as wxTextFile's wxConvAuto does. */
  private openTextFile(aPath: string): WX_TEXT_FILE | null {
    const data = this.m_readFile(aPath);

    if (!data) return null;

    return new WX_TEXT_FILE(decodeAuto(data));
  }

  // ==========================================================================
  // Format detection
  // ==========================================================================

  override CanReadSchematicFile(aFileName: string): boolean {
    if (fileNameParts(aFileName).ext.toLowerCase() !== 'sch') return false;

    const file = this.openTextFile(aFileName);

    if (!file) return false;

    if (file.GetLineCount() === 0) return false;

    const firstLine = wxTrimLeft(file.GetFirstLine());

    if (!firstLine.startsWith('v ')) return false;

    const tok = new WX_TOKENIZER(firstLine);
    tok.GetNextToken(); // skip 'v'

    if (!tok.HasMoreTokens()) return false;

    const dateStr = tok.GetNextToken();

    if (dateStr.length !== 8) return false;

    const r = wxToLong(dateStr);
    return r.ok && r.value >= 19700101;
  }

  // ==========================================================================
  // Coordinate transformation
  // ==========================================================================

  private toKiCadDist(aMils: number): number {
    return toInt(aMils * SCH_IO_GEDA.MILS_TO_IU);
  }

  private toKiCad(aGedaX: number, aGedaY: number): VECTOR2I {
    return { x: this.toKiCadDist(aGedaX), y: this.toKiCadDist(this.m_maxY - aGedaY) };
  }

  // ==========================================================================
  // Version parsing
  // ==========================================================================

  private parseVersionLine(aLine: string): boolean {
    const tokenizer = new WX_TOKENIZER(aLine);

    if (tokenizer.CountTokens() < 2) return false;

    if (tokenizer.GetNextToken() !== 'v') return false;

    this.m_releaseVersion = wxToLong(tokenizer.GetNextToken()).value;

    if (this.m_releaseVersion < 19700101) return false;

    // File format version is optional in very old files
    if (tokenizer.HasMoreTokens())
      this.m_fileFormatVersion = wxToLong(tokenizer.GetNextToken()).value;
    else this.m_fileFormatVersion = 0;

    return true;
  }

  // ==========================================================================
  // Attribute parsing
  // ==========================================================================

  private parseAttributes(aFile: WX_TEXT_FILE, aLineIdx: { v: number }): GEDA_ATTR[] {
    const attrs: GEDA_ATTR[] = [];

    while (aLineIdx.v < aFile.GetLineCount()) {
      const line = aFile.GetLine(aLineIdx.v);

      if (wxTrimRight(line) === '}') {
        aLineIdx.v++;
        break;
      }

      if (line.startsWith('T ')) {
        // T x y color size visibility show_name_value angle alignment num_lines
        const tok = new WX_TOKENIZER(line);
        tok.GetNextToken(); // skip 'T'

        const x = tok.nextLong(0);
        const y = tok.nextLong(0);
        tok.nextLong(0); // color
        const size = tok.nextLong(0);
        const vis = tok.nextLong(0);
        const showNV = tok.nextLong(0);
        const angle = tok.nextLong(0);
        const align = tok.nextLong(0);
        const numLines = tok.nextLong(1);

        aLineIdx.v++;

        let textContent = '';

        for (let i = 0; i < numLines && aLineIdx.v < aFile.GetLineCount(); i++) {
          if (i > 0) textContent += '\n';

          textContent += aFile.GetLine(aLineIdx.v);
          aLineIdx.v++;
        }

        const eqPos = textContent.indexOf('=');

        if (eqPos !== -1) {
          let value = textContent.substring(eqPos + 1);

          // Strip surrounding double quotes from attribute values
          if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
            value = value.substring(1, value.length - 1);

          attrs.push({
            name: textContent.substring(0, eqPos),
            value,
            x: toInt(x),
            y: toInt(y),
            size: toInt(size),
            angle: toInt(angle),
            align: toInt(align),
            visible: vis === 1,
            showNV: toInt(showNV),
          });
        }

        continue;
      }

      aLineIdx.v++;
    }

    return attrs;
  }

  private findAttr(aAttrs: readonly GEDA_ATTR[], aName: string): string {
    return aAttrs.find((attr) => attr.name === aName)?.value ?? '';
  }

  private findAttrStruct(aAttrs: readonly GEDA_ATTR[], aName: string): GEDA_ATTR | null {
    return aAttrs.find((attr) => attr.name === aName) ?? null;
  }

  private maybeParseAttributes(aFile: WX_TEXT_FILE, aLineIdx: { v: number }): GEDA_ATTR[] {
    if (aLineIdx.v < aFile.GetLineCount() && aFile.TrimLine(aLineIdx.v) === '{') {
      aLineIdx.v++;
      return this.parseAttributes(aFile, aLineIdx);
    }

    return [];
  }

  // ==========================================================================
  // Style mapping
  // ==========================================================================

  static toLineStyle(aDashStyle: number): LINE_STYLE {
    switch (aDashStyle) {
      case 1:
        return LINE_STYLE.DOT;
      case 2:
        return LINE_STYLE.DASH;
      case 3:
        return LINE_STYLE.DASHDOT;
      case 4:
        return LINE_STYLE.DASHDOTDOT;
      default:
        return LINE_STYLE.DEFAULT;
    }
  }

  static toFillType(aFillType: number): FILL_T {
    switch (aFillType) {
      case 1:
        return FILL_T.FILLED_SHAPE;
      case 2:
        return FILL_T.CROSS_HATCH;
      case 3:
        return FILL_T.HATCH;
      default:
        return FILL_T.NO_FILL;
    }
  }

  // ==========================================================================
  // Orientation mapping
  // ==========================================================================

  private toKiCadOrientation(aAngle: number, aMirror: number): number {
    const O = SYMBOL_ORIENTATION_T;
    let orientation: number;

    switch (aAngle) {
      case 90:
        orientation = O.SYM_ORIENT_90;
        break;
      case 180:
        orientation = O.SYM_ORIENT_180;
        break;
      case 270:
        orientation = O.SYM_ORIENT_270;
        break;
      default:
        orientation = O.SYM_ORIENT_0;
        break;
    }

    if (aMirror) orientation |= O.SYM_MIRROR_Y;

    return orientation;
  }

  private getLibName(): string {
    let libName = '';

    if (this.m_schematic) libName = this.m_schematic.Project().GetProjectName();

    if (libName === '') libName = fileNameParts(this.m_filename).name;

    if (libName === '') libName = 'noname';

    libName += '-geda-import';
    return LIB_ID.FixIllegalChars(libName, true);
  }

  // ==========================================================================
  // Object parsers - connectivity
  // ==========================================================================

  private parseComponent(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // Flush any previous pending component before starting a new one
    this.flushPendingComponent();

    // C x y selectable angle mirror basename.sym
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'C'

    const x = tok.nextLong(0);
    const y = tok.nextLong(0);
    const selectable = tok.nextLong(0);
    const angle = tok.nextLong(0);
    const mirror = tok.nextLong(0);

    let basename = '';

    if (tok.HasMoreTokens()) basename = tok.GetNextToken();

    // gEDA prefixes embedded component basenames with "EMBEDDED"
    if (basename.startsWith('EMBEDDED')) basename = basename.substring(8);

    this.m_pendingComp = {
      basename,
      x: toInt(x),
      y: toInt(y),
      selectable: toInt(selectable),
      angle: toInt(angle),
      mirror: toInt(mirror),
      attrs: [],
      embedded: false,
      embeddedSym: null,
    };

    this.m_pendingComp.attrs = this.maybeParseAttributes(aFile, aLineIdx);
  }

  private parseNet(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // N x1 y1 x2 y2 color
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'N'

    const x1 = toInt(tok.nextLong(0));
    const y1 = toInt(tok.nextLong(0));
    const x2 = toInt(tok.nextLong(0));
    const y2 = toInt(tok.nextLong(0));

    const start = this.toKiCad(x1, y1);
    const end = this.toKiCad(x2, y2);

    const wire = new SCH_LINE(start, SCH_LAYER_ID.LAYER_WIRE);
    wire.SetEndPoint(end);
    this.m_screen!.Append(wire);

    this.trackEndpoint(x1, y1);
    this.trackEndpoint(x2, y2);

    const attrs = this.maybeParseAttributes(aFile, aLineIdx);
    const netname = this.findAttr(attrs, 'netname');

    if (netname !== '') {
      const label = new SCH_LABEL(start, netname);
      const textSize = this.toKiCadDist(Math.trunc(GEDA_DEFAULT_TEXT_SIZE_MILS / 2));
      label.SetTextSize({ x: textSize, y: textSize });
      this.m_screen!.Append(label);
    }
  }

  private parseBus(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // U x1 y1 x2 y2 color [ripperdir]
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'U'

    const x1 = toInt(tok.nextLong(0));
    const y1 = toInt(tok.nextLong(0));
    const x2 = toInt(tok.nextLong(0));
    const y2 = toInt(tok.nextLong(0));
    tok.nextLong(0); // color
    let ripperDir = 0;

    if (this.m_releaseVersion > 20020825) ripperDir = tok.nextLong(ripperDir);

    const start = this.toKiCad(x1, y1);
    const end = this.toKiCad(x2, y2);

    const line = new SCH_LINE(start, SCH_LAYER_ID.LAYER_BUS);
    line.SetEndPoint(end);
    this.m_screen!.Append(line);

    this.m_busSegments.push({ start, end, ripperDir: toInt(ripperDir) });

    this.maybeParseAttributes(aFile, aLineIdx);
  }

  private parsePin(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // P x1 y1 x2 y2 color [pintype whichend]
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'P'

    const x1 = toInt(tok.nextLong(0));
    const y1 = toInt(tok.nextLong(0));
    const x2 = toInt(tok.nextLong(0));
    const y2 = toInt(tok.nextLong(0));
    tok.nextLong(0); // color
    let whichend = 0;

    if (this.m_releaseVersion > 20020825) {
      tok.nextLong(0); // pintype
      whichend = tok.nextLong(whichend);
    }

    const start = this.toKiCad(x1, y1);
    const end = this.toKiCad(x2, y2);

    // In schematic context, pin lines become wire stubs for connectivity
    const wire = new SCH_LINE(start, SCH_LAYER_ID.LAYER_WIRE);
    wire.SetEndPoint(end);
    this.m_screen!.Append(wire);

    const connPt = whichend === 0 ? start : end;
    const connX = whichend === 0 ? x1 : x2;
    const connY = whichend === 0 ? y1 : y2;
    this.trackEndpoint(connX, connY);

    const attrs = this.maybeParseAttributes(aFile, aLineIdx);

    const pinlabel = this.findAttr(attrs, 'pinlabel');

    if (pinlabel !== '') {
      const label = new SCH_LABEL(connPt, pinlabel);
      const textSize = this.toKiCadDist(Math.trunc(GEDA_DEFAULT_TEXT_SIZE_MILS / 2));
      label.SetTextSize({ x: textSize, y: textSize });
      this.m_screen!.Append(label);
    }
  }

  private parseEmbeddedComponent(aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    if (!this.m_pendingComp) return;

    const libSym = new LIB_SYMBOL(this.m_pendingComp.basename);

    // Parse until ] closing bracket
    while (aLineIdx.v < aFile.GetLineCount()) {
      const line = aFile.GetLine(aLineIdx.v);

      if (wxTrimRight(line) === ']') {
        aLineIdx.v++;
        break;
      }

      if (line === '') {
        aLineIdx.v++;
        continue;
      }

      const type = line[0]!;
      aLineIdx.v++;

      switch (type) {
        case 'P': {
          const tok = new WX_TOKENIZER(line);
          tok.GetNextToken(); // skip 'P'
          const px1 = tok.nextLong(0);
          const py1 = tok.nextLong(0);
          const px2 = tok.nextLong(0);
          const py2 = tok.nextLong(0);
          tok.nextLong(0); // color
          tok.nextLong(0); // pintype
          const pw = tok.nextLong(0);

          const pinAttrs = this.maybeParseAttributes(aFile, aLineIdx);
          this.addSymbolPin(
            libSym,
            toInt(px1),
            toInt(py1),
            toInt(px2),
            toInt(py2),
            toInt(pw),
            pinAttrs,
          );
          break;
        }

        case 'L':
        case 'B':
        case 'V':
        case 'A':
        case 'H':
          this.addSymbolGraphic(libSym, line, aFile, aLineIdx, type);
          break;

        case 'T': {
          // Skip text lines in embedded symbols (they're attribute text)
          const tok = new WX_TOKENIZER(line);
          tok.GetNextToken(); // skip 'T'
          let numLines = 1;

          // Parse enough to get numLines (9th field)
          for (let i = 0; i < 8 && tok.HasMoreTokens(); i++) {
            if (i === 7) numLines = wxToLong(tok.GetNextToken()).value;
            else tok.GetNextToken();
          }

          for (let i = 0; i < numLines && aLineIdx.v < aFile.GetLineCount(); i++) aLineIdx.v++;

          this.maybeParseAttributes(aFile, aLineIdx);
          break;
        }

        case '{': {
          // Skip nested attribute block
          while (aLineIdx.v < aFile.GetLineCount()) {
            if (aFile.TrimLine(aLineIdx.v) === '}') {
              aLineIdx.v++;
              break;
            }

            aLineIdx.v++;
          }

          break;
        }

        default:
          break;
      }
    }

    this.m_pendingComp.embedded = true;
    this.m_pendingComp.embeddedSym = libSym;
  }

  // ==========================================================================
  // Object parsers - graphics
  // ==========================================================================

  private parseText(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // T x y color size visibility show_name_value angle alignment num_lines
    // Old formats may omit alignment and/or num_lines fields
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'T'

    const x = tok.nextLong(0);
    const y = tok.nextLong(0);
    tok.nextLong(0); // color
    const size = tok.nextLong(0);
    const vis = tok.nextLong(0);
    const showNV = tok.nextLong(0);
    const angle = tok.nextLong(0);
    let align = 0;
    let numLines = 1;

    if (this.m_fileFormatVersion >= 1) {
      align = tok.nextLong(align);
      numLines = tok.nextLong(numLines);
    } else if (this.m_releaseVersion >= 20000220) {
      align = tok.nextLong(align);

      numLines = 1;
    } else {
      align = 0;
      numLines = 1;
    }

    let textContent = '';

    for (let i = 0; i < numLines && aLineIdx.v < aFile.GetLineCount(); i++) {
      if (i > 0) textContent += '\n';

      textContent += aFile.GetLine(aLineIdx.v);
      aLineIdx.v++;
    }

    textContent = convertOverbars(textContent);

    if (vis === 0) {
      this.maybeParseAttributes(aFile, aLineIdx);
      return;
    }

    // Handle attribute text (contains '=') with show_name_value field
    const eqPos = textContent.indexOf('=');

    if (eqPos !== -1) {
      const name = textContent.substring(0, eqPos);
      const value = textContent.substring(eqPos + 1);

      switch (toInt(showNV)) {
        case 1:
          textContent = value;
          break;
        case 2:
          textContent = name;
          break;
        default:
          textContent = `${name}=${value}`;
          break;
      }
    }

    const pos = this.toKiCad(toInt(x), toInt(y));

    const text = new SCH_TEXT(pos, textContent);

    let textSize = this.toKiCadDist(toInt(size) * 10);

    if (textSize < this.toKiCadDist(10)) textSize = this.toKiCadDist(10);

    text.SetTextSize({ x: textSize, y: textSize });

    // gEDA allows arbitrary angles but KiCad text only supports orthogonal.
    // Snap to the nearest 90-degree increment.
    const normAngle = (((toInt(angle) % 360) + 360) % 360) | 0;
    let snapped = Math.trunc((normAngle + 45) / 90) * 90;

    if (snapped === 360) snapped = 0;

    switch (snapped) {
      case 90:
        text.SetTextAngle(ANGLE_90);
        break;
      case 180:
        text.SetTextAngle(ANGLE_180);
        break;
      case 270:
        text.SetTextAngle(ANGLE_270);
        break;
      default:
        break;
    }

    // Horizontal alignment: gEDA align / 3 gives column (0=left, 1=center, 2=right)
    switch (Math.trunc(toInt(align) / 3)) {
      case 1:
        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        break;
      case 2:
        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        break;
      default:
        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        break;
    }

    // Vertical alignment: gEDA align % 3 gives row (0=bottom, 1=middle, 2=top)
    switch (toInt(align) % 3) {
      case 1:
        text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
        break;
      case 2:
        text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
        break;
      default:
        text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
        break;
    }

    this.m_screen!.Append(text);
    this.maybeParseAttributes(aFile, aLineIdx);
  }

  /** The common `linewidth capstyle dashstyle …` tail, after \a aCount leading fields. */
  private static readStyle(aTok: WX_TOKENIZER): {
    width: number;
    dashstyle: number;
    filltype: number;
  } {
    const width = aTok.nextLong(0);
    aTok.nextLong(0); // capstyle
    const dashstyle = aTok.nextLong(0);
    aTok.nextLong(0); // dashlength
    aTok.nextLong(0); // dashspace
    const filltype = aTok.nextLong(0);
    return { width, dashstyle, filltype };
  }

  private parseLine(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // L x1 y1 x2 y2 color [width capstyle dashstyle dashlength dashspace]
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'L'

    const x1 = tok.nextLong(0);
    const y1 = tok.nextLong(0);
    const x2 = tok.nextLong(0);
    const y2 = tok.nextLong(0);
    tok.nextLong(0); // color
    let width = 0;
    let dashstyle = 0;

    if (this.m_releaseVersion > 20000704) ({ width, dashstyle } = SCH_IO_GEDA.readStyle(tok));

    const start = this.toKiCad(toInt(x1), toInt(y1));
    const end = this.toKiCad(toInt(x2), toInt(y2));

    const line = new SCH_LINE(start, SCH_LAYER_ID.LAYER_NOTES);
    line.SetEndPoint(end);
    line.SetStroke(
      new STROKE_PARAMS(this.toKiCadDist(toInt(width)), SCH_IO_GEDA.toLineStyle(toInt(dashstyle))),
    );
    this.m_screen!.Append(line);
    this.maybeParseAttributes(aFile, aLineIdx);
  }

  private parseBox(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // B x y width height color [linewidth capstyle dashstyle dashlength dashspace
    //   filltype fillwidth a1 p1 a2 p2]
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'B'

    const x = tok.nextLong(0);
    const y = tok.nextLong(0);
    const w = tok.nextLong(0);
    const h = tok.nextLong(0);
    tok.nextLong(0); // color
    let linewidth = 0;
    let dashstyle = 0;
    let filltype = 0;

    if (this.m_releaseVersion > 20000704)
      ({ width: linewidth, dashstyle, filltype } = SCH_IO_GEDA.readStyle(tok));

    const topLeft = this.toKiCad(toInt(x), toInt(y + h));
    const botRight = this.toKiCad(toInt(x + w), toInt(y));

    const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_NOTES);
    rect.SetStart(topLeft);
    rect.SetEnd(botRight);
    rect.SetStroke(
      new STROKE_PARAMS(
        this.toKiCadDist(toInt(linewidth)),
        SCH_IO_GEDA.toLineStyle(toInt(dashstyle)),
      ),
    );

    const fill = SCH_IO_GEDA.toFillType(toInt(filltype));

    if (fill !== FILL_T.NO_FILL) {
      rect.SetFilled(true);
      rect.SetFillMode(fill);
    }

    this.m_screen!.Append(rect);
    this.maybeParseAttributes(aFile, aLineIdx);
  }

  private parseCircle(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // V cx cy radius color [linewidth capstyle dashstyle dashlength dashspace
    //   filltype fillwidth a1 p1 a2 p2]
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'V'

    const cx = tok.nextLong(0);
    const cy = tok.nextLong(0);
    const radius = tok.nextLong(0);
    tok.nextLong(0); // color
    let linewidth = 0;
    let dashstyle = 0;
    let filltype = 0;

    if (this.m_releaseVersion > 20000704)
      ({ width: linewidth, dashstyle, filltype } = SCH_IO_GEDA.readStyle(tok));

    const center = this.toKiCad(toInt(cx), toInt(cy));

    const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_NOTES);
    circle.SetCenter(center);
    circle.SetEnd({ x: center.x + this.toKiCadDist(toInt(radius)), y: center.y });
    circle.SetStroke(
      new STROKE_PARAMS(
        this.toKiCadDist(toInt(linewidth)),
        SCH_IO_GEDA.toLineStyle(toInt(dashstyle)),
      ),
    );

    const fill = SCH_IO_GEDA.toFillType(toInt(filltype));

    if (fill !== FILL_T.NO_FILL) {
      circle.SetFilled(true);
      circle.SetFillMode(fill);
    }

    this.m_screen!.Append(circle);
    this.maybeParseAttributes(aFile, aLineIdx);
  }

  private parseArc(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // A cx cy radius startangle sweepangle color [linewidth capstyle dashstyle dashlength dashspace]
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'A'

    const cx = tok.nextLong(0);
    const cy = tok.nextLong(0);
    const radius = tok.nextLong(0);
    const startAngle = tok.nextLong(0);
    const sweepAngle = tok.nextLong(0);
    tok.nextLong(0); // color
    let linewidth = 0;
    let dashstyle = 0;

    if (this.m_releaseVersion > 20000704)
      ({ width: linewidth, dashstyle } = SCH_IO_GEDA.readStyle(tok));

    const center = this.toKiCad(toInt(cx), toInt(cy));
    const r = this.toKiCadDist(toInt(radius));

    const startRad = DEG2RAD(startAngle);
    const endRad = DEG2RAD(startAngle + sweepAngle);

    // Y-flip negates the Y component of angle calculations
    const arcStart: VECTOR2I = {
      x: center.x + KiROUND(r * Math.cos(startRad)),
      y: center.y - KiROUND(r * Math.sin(startRad)),
    };
    const arcEnd: VECTOR2I = {
      x: center.x + KiROUND(r * Math.cos(endRad)),
      y: center.y - KiROUND(r * Math.sin(endRad)),
    };

    const arc = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_NOTES);
    arc.SetCenter(center);

    // Y-flip reverses angular sweep direction, so swap start and end
    // to preserve the original arc visual appearance.
    arc.SetStart(arcEnd);
    arc.SetEnd(arcStart);

    arc.SetStroke(
      new STROKE_PARAMS(
        this.toKiCadDist(toInt(linewidth)),
        SCH_IO_GEDA.toLineStyle(toInt(dashstyle)),
      ),
    );
    this.m_screen!.Append(arc);
    this.maybeParseAttributes(aFile, aLineIdx);
  }

  private parsePath(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // H color width capstyle dashstyle dashlength dashspace
    //   filltype fillwidth a1 p1 a2 p2 numlines
    // followed by numlines of SVG-style path data
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'H'

    tok.nextLong(0); // color
    const width = tok.nextLong(0);
    tok.nextLong(0); // capstyle
    const dashstyle = tok.nextLong(0);
    for (let i = 0; i < 8; i++) tok.nextLong(0); // dashlength … p2
    const numlines = tok.nextLong(0);

    // Collect all path data lines
    let pathData = '';

    for (let i = 0; i < numlines && aLineIdx.v < aFile.GetLineCount(); i++) {
      if (i > 0) pathData += ' ';

      pathData += aFile.TrimLine(aLineIdx.v);
      aLineIdx.v++;
    }

    let startPt: VECTOR2I = { x: 0, y: 0 };
    let currentPt: VECTOR2I = { x: 0, y: 0 };
    const stroke = new STROKE_PARAMS(
      this.toKiCadDist(toInt(width)),
      SCH_IO_GEDA.toLineStyle(toInt(dashstyle)),
    );

    const emitSeg = (aFrom: VECTOR2I, aTo: VECTOR2I): void => {
      const seg = new SCH_LINE(aFrom, SCH_LAYER_ID.LAYER_NOTES);
      seg.SetEndPoint(aTo);
      seg.SetStroke(stroke);
      this.m_screen!.Append(seg);
    };

    const pathTok = new WX_TOKENIZER_RET_EMPTY(pathData, ' ,\t');

    // For relative (lowercase) SVG commands, deltas are in gEDA mils (Y-up).
    // Convert to KiCad IU (Y-down) by scaling X and negating+scaling Y.
    const relToAbs = (dx: number, dy: number): VECTOR2I => ({
      x: currentPt.x + this.toKiCadDist(toInt(dx)),
      y: currentPt.y - this.toKiCadDist(toInt(dy)),
    });

    /** `HasMoreTokens() && GetNextToken().ToLong( &v ) && …` for \a aCount values, short-circuiting. */
    const longs = (aCount: number): number[] | null => {
      const out: number[] = [];

      for (let i = 0; i < aCount; i++) {
        if (!pathTok.HasMoreTokens()) return null;

        const r = wxToLong(pathTok.GetNextToken());

        if (!r.ok) return null;

        out.push(r.value);
      }

      return out;
    };

    const emitBezier = (cp1: VECTOR2I, cp2: VECTOR2I, endPt: VECTOR2I): void => {
      const bezier = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_NOTES);
      bezier.SetStart(currentPt);
      bezier.SetBezierC1(cp1);
      bezier.SetBezierC2(cp2);
      bezier.SetEnd(endPt);
      bezier.SetStroke(stroke);
      bezier.RebuildBezierToSegmentsPointsList(schIUScale.mmToIU(ARC_LOW_DEF_MM));
      this.m_screen!.Append(bezier);
      currentPt = endPt;
    };

    while (pathTok.HasMoreTokens()) {
      const token = pathTok.GetNextToken();

      if (token === 'M' || token === 'm') {
        const v = longs(2);

        if (v) {
          currentPt =
            token === 'M' ? this.toKiCad(toInt(v[0]!), toInt(v[1]!)) : relToAbs(v[0]!, v[1]!);
          startPt = currentPt;
        }
      } else if (token === 'L' || token === 'l') {
        const v = longs(2);

        if (v) {
          const pt =
            token === 'L' ? this.toKiCad(toInt(v[0]!), toInt(v[1]!)) : relToAbs(v[0]!, v[1]!);
          emitSeg(currentPt, pt);
          currentPt = pt;
        }
      } else if (token === 'C') {
        const v = longs(6);

        if (v) {
          emitBezier(
            this.toKiCad(toInt(v[0]!), toInt(v[1]!)),
            this.toKiCad(toInt(v[2]!), toInt(v[3]!)),
            this.toKiCad(toInt(v[4]!), toInt(v[5]!)),
          );
        }
      } else if (token === 'c') {
        const v = longs(6);

        if (v) emitBezier(relToAbs(v[0]!, v[1]!), relToAbs(v[2]!, v[3]!), relToAbs(v[4]!, v[5]!));
      } else if (token === 'Z' || token === 'z') {
        if (currentPt.x !== startPt.x || currentPt.y !== startPt.y) {
          emitSeg(currentPt, startPt);
          currentPt = startPt;
        }
      }
    }

    this.maybeParseAttributes(aFile, aLineIdx);
  }

  private parsePicture(aLine: string, aFile: WX_TEXT_FILE, aLineIdx: { v: number }): void {
    // G x y width height angle mirrored embedded
    const tok = new WX_TOKENIZER(aLine);
    tok.GetNextToken(); // skip 'G'

    const x = tok.nextLong(0);
    const y = tok.nextLong(0);
    const w = tok.nextLong(0);
    const h = tok.nextLong(0);
    const angle = tok.nextLong(0);
    const mirror = tok.nextLong(0);
    const embedded = tok.nextLong(0);

    let filename = '';

    if (aLineIdx.v < aFile.GetLineCount()) {
      filename = wxTrimLeft(aFile.TrimLine(aLineIdx.v));
      aLineIdx.v++;
    }

    let base64Data = '';

    if (embedded) {
      while (aLineIdx.v < aFile.GetLineCount()) {
        const dataLine = wxTrimRight(aFile.GetLine(aLineIdx.v));
        aLineIdx.v++;

        if (dataLine === '.') break;

        base64Data += dataLine;
      }
    }

    const bitmap = new SCH_BITMAP();
    const refImage = bitmap.GetReferenceImage();
    let loaded = false;

    if (embedded && base64Data !== '') {
      const buf = wxBase64Decode(base64Data);

      if (buf.length > 0) loaded = refImage.ReadImageFile(buf);
    } else if (filename !== '') {
      let imgPath = filename;

      if (!imgPath.startsWith('/') && this.m_filename !== '')
        imgPath = joinPath(fileNameParts(this.m_filename).path, imgPath);

      const bytes = this.m_readFile(imgPath);

      if (bytes) loaded = refImage.ReadImageFile(bytes);
    }

    if (!loaded) return;

    // gEDA specifies x,y as the lower-left corner of the picture bounding box.
    // Compute center position from the lower-left corner + size.
    const gCenterX = toInt(x) + Math.trunc(toInt(w) / 2);
    const gCenterY = toInt(y) + Math.trunc(toInt(h) / 2);
    const center = this.toKiCad(gCenterX, gCenterY);

    const targetWidth = this.toKiCadDist(toInt(w));
    const imgSize = refImage.GetSize();

    if (imgSize.x > 0) refImage.SetImageScale(targetWidth / imgSize.x);

    bitmap.SetPosition(center);

    if (mirror) bitmap.MirrorHorizontally(center.x);

    for (let a = angle; a > 0; a -= 90) bitmap.Rotate(center, false);

    this.m_maxY = Math.max(this.m_maxY, toInt(y + h));
    this.m_screen!.Append(bitmap);
  }

  // ==========================================================================
  // Symbol loading
  // ==========================================================================

  /** `wxDir::Exists`: the file source lists it. */
  private dirExists(aDir: string): boolean {
    return this.m_listDir(aDir) !== null;
  }

  /**
   * Upstream also scans $GEDADATA/sym, the system gEDA / Lepton symbol folders, the
   * $XDG_DATA_DIRS ones and the user's rc files under $HOME; a browser has no environment or
   * home, so those are the fixed system folders only, through the file source.
   */
  private initSymbolLibrary(): void {
    if (this.m_symLibraryInitialized) return;

    this.m_symLibraryInitialized = true;

    // Scan standard gEDA and Lepton-EDA symbol directories
    const defaultPaths = [
      '/usr/share/gEDA/sym',
      '/usr/share/geda-symbols',
      '/usr/local/share/gEDA/sym',
      '/usr/local/share/geda-symbols',
      '/usr/share/lepton-eda/sym',
      '/usr/local/share/lepton-eda/sym',
    ];

    for (const dir of defaultPaths) {
      if (this.dirExists(dir)) this.scanSymbolDir(dir);
    }

    // Scan relative to the schematic file location.
    const schDir = this.m_filename !== '' ? fileNameParts(this.m_filename).path : '';

    // Parse project-level RC files and scan schematic-relative directories
    if (schDir !== '') {
      this.parseRcFileForLibraries(joinPath(schDir, 'gafrc'), schDir);
      this.parseRcFileForLibraries(joinPath(schDir, 'gschemrc'), schDir);

      // Parse Lepton-EDA INI-style config files (lepton.conf or geda.conf)
      // for [libs] section with component-library entries
      for (const configName of ['lepton.conf', 'geda.conf']) {
        const confFile = this.openTextFile(joinPath(schDir, configName));

        if (!confFile) continue;

        let inLibsSection = false;

        for (let i = 0; i < confFile.GetLineCount(); ++i) {
          const line = wxTrimLeft(wxTrimRight(confFile.GetLine(i)));

          if (line === '' || line[0] === '#' || line[0] === ';') continue;

          if (line[0] === '[') {
            inLibsSection = line.toLowerCase() === '[libs]';
            continue;
          }

          if (!inLibsSection) continue;

          if (line.startsWith('component-library')) {
            const eqPos = line.indexOf('=');

            if (eqPos === -1) continue;

            let libPath = wxTrimRight(wxTrimLeft(line.substring(eqPos + 1)));

            if (!libPath.startsWith('/')) libPath = wxNormalizeAbsolute(joinPath(schDir, libPath));

            if (this.dirExists(libPath)) this.scanSymbolDir(libPath);
          }
        }

        break;
      }

      this.scanSymbolDir(schDir);

      const symDir = joinPath(schDir, 'sym');

      if (this.dirExists(symDir)) this.scanSymbolDir(symDir);

      const parentSymDir = joinPath(fileNameParts(schDir).path, 'sym');

      if (this.dirExists(parentSymDir)) this.scanSymbolDir(parentSymDir);
    }

    const paths = this.m_properties?.get('sym_search_paths');

    if (paths !== undefined) {
      for (const token of new WX_TOKENIZER_RET_EMPTY(paths, '\n;').All()) {
        const dir = wxTrimLeft(wxTrimRight(token));

        if (dir !== '' && this.dirExists(dir)) this.scanSymbolDir(dir);
      }
    }
  }

  private scanSymbolDir(aDir: string, aDepth = 0): void {
    if (aDepth > 20) return;

    const names = this.m_listDir(aDir);

    if (!names) return;

    for (const filename of names) {
      const fullPath = joinPath(aDir, filename);

      if (this.dirExists(fullPath)) {
        this.scanSymbolDir(fullPath, aDepth + 1);
      } else if (filename.endsWith('.sym')) {
        this.m_symLibrary.set(filename, {
          path: fullPath,
          symbol: null,
          symversion: '',
          netAttr: '',
        });
      }
    }
  }

  private parseRcFileForLibraries(aPath: string, aBaseDir: string): void {
    const rcFile = this.openTextFile(aPath);

    if (!rcFile) return;

    for (let i = 0; i < rcFile.GetLineCount(); ++i) {
      const line = wxTrimLeft(wxTrimRight(rcFile.GetLine(i)));

      if (!line.startsWith('(component-library-search ') && !line.startsWith('(component-library '))
        continue;

      const firstQuote = line.indexOf('"');

      if (firstQuote === -1) continue;

      // Find the closing quote of the first argument. The two-argument
      // form (component-library "path" "name") has a second quoted
      // string that we ignore.
      let secondQuote = line.substring(firstQuote + 1).indexOf('"');

      if (secondQuote !== -1) secondQuote += firstQuote + 1;

      if (secondQuote === -1 || secondQuote <= firstQuote) continue;

      let libPath = line.substring(firstQuote + 1, secondQuote);

      if (!libPath.startsWith('/')) libPath = wxNormalizeAbsolute(joinPath(aBaseDir, libPath));

      if (this.dirExists(libPath)) this.scanSymbolDir(libPath);
    }
  }

  /**
   * Load a .sym file and return a LIB_SYMBOL. If \a aOut is given, the symbol's symversion and
   * net= attributes (when present) are written to it.
   */
  private loadSymbolFile(
    aPath: string,
    aOut?: { symversion?: string; netAttr?: string },
  ): LIB_SYMBOL | null {
    const file = this.openTextFile(aPath);

    return file ? this.loadSymbolText(file, fileNameParts(aPath).name, aOut) : null;
  }

  private loadSymbolText(
    file: WX_TEXT_FILE,
    aSymName: string,
    aOut?: { symversion?: string; netAttr?: string },
  ): LIB_SYMBOL | null {
    if (file.GetLineCount() === 0) return null;

    // Validate version line
    const firstLine = wxTrimLeft(file.GetFirstLine());

    if (!firstLine.startsWith('v ')) return null;

    const libSym = new LIB_SYMBOL(aSymName);
    libSym.SetShowPinNumbers(true);
    libSym.SetShowPinNames(true);

    const lineIdx = { v: 1 }; // Skip version line

    while (lineIdx.v < file.GetLineCount()) {
      const line = file.GetLine(lineIdx.v);

      if (line === '') {
        lineIdx.v++;
        continue;
      }

      const type = line[0]!;
      lineIdx.v++;

      switch (type) {
        case 'P': {
          const tok = new WX_TOKENIZER(line);
          tok.GetNextToken(); // skip 'P'
          const px1 = tok.nextLong(0);
          const py1 = tok.nextLong(0);
          const px2 = tok.nextLong(0);
          const py2 = tok.nextLong(0);
          tok.nextLong(0); // color
          tok.nextLong(0); // pintype
          const pw = tok.nextLong(0);

          const pinAttrs = this.maybeParseAttributes(file, lineIdx);
          this.addSymbolPin(
            libSym,
            toInt(px1),
            toInt(py1),
            toInt(px2),
            toInt(py2),
            toInt(pw),
            pinAttrs,
          );
          break;
        }

        case 'L':
        case 'B':
        case 'V':
        case 'A':
        case 'H':
          this.addSymbolGraphic(libSym, line, file, lineIdx, type);
          break;

        case 'T': {
          // T x y color size vis show_nv angle align num_lines
          const tok = new WX_TOKENIZER(line);
          tok.GetNextToken(); // skip 'T'
          let numLines = 1;

          for (let i = 0; i < 9 && tok.HasMoreTokens(); i++) {
            const fieldVal = tok.GetNextToken();

            if (i === 8) numLines = wxToLong(fieldVal).value;
          }

          for (let i = 0; i < numLines && lineIdx.v < file.GetLineCount(); i++) {
            const textLine = file.GetLine(lineIdx.v);

            if (aOut && aOut.symversion !== undefined && textLine.startsWith('symversion='))
              aOut.symversion = textLine.substring(11);

            if (aOut && aOut.netAttr !== undefined && textLine.startsWith('net='))
              aOut.netAttr = textLine.substring(4);

            lineIdx.v++;
          }

          this.maybeParseAttributes(file, lineIdx);
          break;
        }

        case '{': {
          while (lineIdx.v < file.GetLineCount()) {
            if (file.TrimLine(lineIdx.v) === '}') {
              lineIdx.v++;
              break;
            }

            lineIdx.v++;
          }

          break;
        }

        default:
          break;
      }
    }

    return libSym;
  }

  private addSymbolPin(
    aSymbol: LIB_SYMBOL,
    aX1: number,
    aY1: number,
    aX2: number,
    aY2: number,
    aWhichEnd: number,
    aAttrs: readonly GEDA_ATTR[],
  ): void {
    // whichend determines which endpoint is the connection point (active end)
    // 0 = (x1,y1) is connection point, 1 = (x2,y2) is connection point
    const [connX, connY, otherX, otherY] =
      aWhichEnd === 0 ? [aX1, aY1, aX2, aY2] : [aX2, aY2, aX1, aY1];

    // Symbol coordinates use the same mil system but are relative to the symbol origin.
    // The connection point goes at the tip, the other end is toward the symbol body.
    const connPt: VECTOR2I = { x: this.toKiCadDist(connX), y: -this.toKiCadDist(connY) };

    // PIN_ORIENTATION describes which direction the pin body extends FROM the
    // connection point, so the delta must point from connection toward body.
    const dx = toInt(otherX - connX);
    const dy = toInt(otherY - connY);
    const length = this.toKiCadDist(KiROUND(Math.hypot(dx, dy)));

    let orient = PIN_ORIENTATION.PIN_RIGHT;

    if (dx > 0) orient = PIN_ORIENTATION.PIN_RIGHT;
    else if (dx < 0) orient = PIN_ORIENTATION.PIN_LEFT;
    else if (dy > 0) orient = PIN_ORIENTATION.PIN_UP;
    else if (dy < 0) orient = PIN_ORIENTATION.PIN_DOWN;

    let pinnumber = this.findAttr(aAttrs, 'pinnumber');
    let pinlabel = this.findAttr(aAttrs, 'pinlabel');
    const pintypeStr = this.findAttr(aAttrs, 'pintype');

    if (pinnumber === '') pinnumber = '?';

    if (pinlabel === '') pinlabel = pinnumber;

    const PINTYPES: Record<string, ELECTRICAL_PINTYPE> = {
      in: ELECTRICAL_PINTYPE.PT_INPUT,
      out: ELECTRICAL_PINTYPE.PT_OUTPUT,
      io: ELECTRICAL_PINTYPE.PT_BIDI,
      oc: ELECTRICAL_PINTYPE.PT_OPENCOLLECTOR,
      oe: ELECTRICAL_PINTYPE.PT_OPENEMITTER,
      pas: ELECTRICAL_PINTYPE.PT_PASSIVE,
      tp: ELECTRICAL_PINTYPE.PT_TRISTATE,
      tri: ELECTRICAL_PINTYPE.PT_TRISTATE,
      clk: ELECTRICAL_PINTYPE.PT_INPUT,
      pwr: ELECTRICAL_PINTYPE.PT_POWER_IN,
    };
    const elecType = Object.hasOwn(PINTYPES, pintypeStr)
      ? PINTYPES[pintypeStr]!
      : ELECTRICAL_PINTYPE.PT_PASSIVE;

    const pin = new SCH_PIN(aSymbol);
    pin.SetPosition(connPt);
    pin.SetLength(length);
    pin.SetOrientation(orient);
    pin.SetNumber(pinnumber);
    pin.SetName(pinlabel);
    pin.SetType(elecType);

    aSymbol.AddDrawItem(pin);
  }

  private addSymbolGraphic(
    aSymbol: LIB_SYMBOL,
    aLine: string,
    aFile: WX_TEXT_FILE,
    aLineIdx: { v: number },
    aType: string,
  ): void {
    const sym = (x: number, y: number): VECTOR2I => ({
      x: this.toKiCadDist(toInt(x)),
      y: -this.toKiCadDist(toInt(y)),
    });

    switch (aType) {
      case 'L': {
        const tok = new WX_TOKENIZER(aLine);
        tok.GetNextToken(); // skip 'L'
        const x1 = tok.nextLong(0);
        const y1 = tok.nextLong(0);
        const x2 = tok.nextLong(0);
        const y2 = tok.nextLong(0);
        tok.nextLong(0); // color
        const { width, dashstyle } = SCH_IO_GEDA.readStyle(tok);

        const shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
        shape.AddPoint(sym(x1, y1));
        shape.AddPoint(sym(x2, y2));
        shape.SetStroke(
          new STROKE_PARAMS(
            this.toKiCadDist(toInt(width)),
            SCH_IO_GEDA.toLineStyle(toInt(dashstyle)),
          ),
        );
        aSymbol.AddDrawItem(shape);
        break;
      }

      case 'B': {
        const tok = new WX_TOKENIZER(aLine);
        tok.GetNextToken(); // skip 'B'
        const x = tok.nextLong(0);
        const y = tok.nextLong(0);
        const w = tok.nextLong(0);
        const h = tok.nextLong(0);
        tok.nextLong(0); // color
        const { width: linewidth, dashstyle, filltype } = SCH_IO_GEDA.readStyle(tok);

        const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);
        rect.SetStart(sym(x, y + h));
        rect.SetEnd(sym(x + w, y));
        rect.SetStroke(
          new STROKE_PARAMS(
            this.toKiCadDist(toInt(linewidth)),
            SCH_IO_GEDA.toLineStyle(toInt(dashstyle)),
          ),
        );

        const fill = SCH_IO_GEDA.toFillType(toInt(filltype));

        if (fill !== FILL_T.NO_FILL) {
          rect.SetFilled(true);
          rect.SetFillMode(fill);
        }

        aSymbol.AddDrawItem(rect);
        break;
      }

      case 'V': {
        const tok = new WX_TOKENIZER(aLine);
        tok.GetNextToken(); // skip 'V'
        const cx = tok.nextLong(0);
        const cy = tok.nextLong(0);
        const r = tok.nextLong(0);
        tok.nextLong(0); // color
        const { width: linewidth, dashstyle, filltype } = SCH_IO_GEDA.readStyle(tok);

        const center = sym(cx, cy);

        const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);
        circle.SetCenter(center);
        circle.SetEnd({ x: center.x + this.toKiCadDist(toInt(r)), y: center.y });
        circle.SetStroke(
          new STROKE_PARAMS(
            this.toKiCadDist(toInt(linewidth)),
            SCH_IO_GEDA.toLineStyle(toInt(dashstyle)),
          ),
        );

        const fill = SCH_IO_GEDA.toFillType(toInt(filltype));

        if (fill !== FILL_T.NO_FILL) {
          circle.SetFilled(true);
          circle.SetFillMode(fill);
        }

        aSymbol.AddDrawItem(circle);
        break;
      }

      case 'A': {
        const tok = new WX_TOKENIZER(aLine);
        tok.GetNextToken(); // skip 'A'
        const cx = tok.nextLong(0);
        const cy = tok.nextLong(0);
        const r = tok.nextLong(0);
        const sa = tok.nextLong(0);
        const da = tok.nextLong(0);
        tok.nextLong(0); // color
        const linewidth = tok.nextLong(0);

        const center = sym(cx, cy);
        const radius = this.toKiCadDist(toInt(r));

        const startRad = DEG2RAD(sa);
        const endRad = DEG2RAD(sa + da);

        const arcStart: VECTOR2I = {
          x: center.x + KiROUND(radius * Math.cos(startRad)),
          y: center.y - KiROUND(radius * Math.sin(startRad)),
        };
        const arcEnd: VECTOR2I = {
          x: center.x + KiROUND(radius * Math.cos(endRad)),
          y: center.y - KiROUND(radius * Math.sin(endRad)),
        };

        const arc = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);
        arc.SetCenter(center);

        // Symbol coordinates use negative-Y, which reverses angular sweep
        // direction. Swap start/end to preserve the correct arc extent.
        arc.SetStart(arcEnd);
        arc.SetEnd(arcStart);
        arc.SetStroke(new STROKE_PARAMS(this.toKiCadDist(toInt(linewidth)), LINE_STYLE.DEFAULT));
        aSymbol.AddDrawItem(arc);
        break;
      }

      case 'H': {
        const tok = new WX_TOKENIZER(aLine);
        tok.GetNextToken(); // skip 'H'

        tok.nextLong(0); // color
        const width = tok.nextLong(0);
        tok.nextLong(0); // capstyle
        const dashstyle = tok.nextLong(0);
        tok.nextLong(0); // dashlength
        tok.nextLong(0); // dashspace
        const filltype = tok.nextLong(0);
        for (let i = 0; i < 5; i++) tok.nextLong(0); // fillwidth … p2
        const numlines = tok.nextLong(0);

        let pathData = '';

        for (let i = 0; i < numlines && aLineIdx.v < aFile.GetLineCount(); i++) {
          if (i > 0) pathData += ' ';

          pathData += aFile.TrimLine(aLineIdx.v);
          aLineIdx.v++;
        }

        let polyPts: VECTOR2I[] = [];
        let startPt: VECTOR2I = { x: 0, y: 0 };
        let currentPt: VECTOR2I = { x: 0, y: 0 };
        const symStroke = new STROKE_PARAMS(
          this.toKiCadDist(toInt(width)),
          SCH_IO_GEDA.toLineStyle(toInt(dashstyle)),
        );
        const symFill = SCH_IO_GEDA.toFillType(toInt(filltype));

        const flushPoly = (): void => {
          if (polyPts.length < 2) return;

          const poly = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

          for (const pt of polyPts) poly.AddPoint(pt);

          poly.SetStroke(symStroke);

          if (symFill !== FILL_T.NO_FILL) {
            poly.SetFilled(true);
            poly.SetFillMode(symFill);
          }

          aSymbol.AddDrawItem(poly);
          polyPts = [];
        };

        const pathTok = new WX_TOKENIZER_RET_EMPTY(pathData, ' ,\t');

        const longs = (aCount: number): number[] | null => {
          const out: number[] = [];

          for (let i = 0; i < aCount; i++) {
            if (!pathTok.HasMoreTokens()) return null;

            const r = wxToLong(pathTok.GetNextToken());

            if (!r.ok) return null;

            out.push(r.value);
          }

          return out;
        };

        while (pathTok.HasMoreTokens()) {
          const pathToken = pathTok.GetNextToken();

          // Symbol path coordinates are in mils (Y-up). Convert to IU (Y-down).
          const symAbsPt = (aX: number, aY: number): VECTOR2I => sym(aX, aY);
          const symRelPt = (aDx: number, aDy: number): VECTOR2I => ({
            x: currentPt.x + this.toKiCadDist(toInt(aDx)),
            y: currentPt.y - this.toKiCadDist(toInt(aDy)),
          });

          // `pathToken.IsAscii() && islower( pathToken[0u] )`
          const isRelative =
            [...pathToken].every((c) => c.charCodeAt(0) < 0x80) && /^[a-z]/.test(pathToken);
          const pt = (x: number, y: number): VECTOR2I =>
            isRelative ? symRelPt(x, y) : symAbsPt(x, y);

          if (pathToken === 'M' || pathToken === 'm') {
            const v = longs(2);

            if (v) {
              currentPt = pt(v[0]!, v[1]!);
              startPt = currentPt;

              if (polyPts.length === 0) polyPts.push(currentPt);
            }
          } else if (pathToken === 'L' || pathToken === 'l') {
            const v = longs(2);

            if (v) {
              currentPt = pt(v[0]!, v[1]!);
              polyPts.push(currentPt);
            }
          } else if (pathToken === 'C' || pathToken === 'c') {
            const v = longs(6);

            if (v) {
              flushPoly();

              const cp1 = pt(v[0]!, v[1]!);
              const cp2 = pt(v[2]!, v[3]!);
              const endPt = pt(v[4]!, v[5]!);

              const bezier = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_DEVICE);
              bezier.SetStart(currentPt);
              bezier.SetBezierC1(cp1);
              bezier.SetBezierC2(cp2);
              bezier.SetEnd(endPt);
              bezier.SetStroke(symStroke);
              bezier.RebuildBezierToSegmentsPointsList(schIUScale.mmToIU(ARC_LOW_DEF_MM));

              if (symFill !== FILL_T.NO_FILL) {
                bezier.SetFilled(true);
                bezier.SetFillMode(symFill);
              }

              aSymbol.AddDrawItem(bezier);
              currentPt = endPt;
              polyPts.push(currentPt);
            }
          } else if (pathToken === 'Z' || pathToken === 'z') {
            if (currentPt.x !== startPt.x || currentPt.y !== startPt.y) {
              polyPts.push(startPt);
              currentPt = startPt;
            }
          }
        }

        flushPoly();

        break;
      }

      default:
        break;
    }

    this.maybeParseAttributes(aFile, aLineIdx);
  }

  private loadBuiltinSymbol(aBasename: string): LIB_SYMBOL | null {
    const src = SCH_IO_GEDA.getBuiltinSymbols().get(aBasename);

    if (src === undefined) return null;

    // Upstream writes the text to a temporary file and loads that; the name it gives the
    // symbol is replaced below.
    const out = { netAttr: '' };
    const result = this.loadSymbolText(new WX_TEXT_FILE(src), 'geda_sym', out);

    if (result) {
      let symName = aBasename;

      if (symName.endsWith('.sym')) symName = symName.substring(0, symName.length - 4);

      result.SetName(symName);

      if (out.netAttr !== '') {
        let entry = this.m_symLibrary.get(aBasename);

        if (!entry) {
          entry = { path: '', symbol: null, symversion: '', netAttr: '' };
          this.m_symLibrary.set(aBasename, entry);
        }

        entry.netAttr = out.netAttr;
      }
    }

    return result;
  }

  private getOrLoadSymbol(aBasename: string): LIB_SYMBOL {
    // Check if already loaded
    const loaded = this.m_libSymbols.get(aBasename);

    if (loaded) return loaded;

    // Try the library cache
    this.initSymbolLibrary();

    const entry = this.m_symLibrary.get(aBasename);

    if (entry) {
      if (!entry.symbol) {
        const out = { symversion: entry.symversion, netAttr: entry.netAttr };
        entry.symbol = this.loadSymbolFile(entry.path, out);
        entry.symversion = out.symversion;
        entry.netAttr = out.netAttr;

        // When a project-local symbol overrides a builtin power symbol but lacks a
        // net= attribute, inherit the builtin's net= so power detection still works.
        // This handles projects that provide custom graphics for standard power symbols.
        if (entry.symbol && entry.netAttr === '') {
          const src = SCH_IO_GEDA.getBuiltinSymbols().get(aBasename);

          if (src !== undefined) {
            // Scan the builtin symbol text for a net= attribute line.
            // In gEDA .sym format, net= always starts a line.
            const pos = src.indexOf('\nnet=');

            if (pos !== -1) {
              const rest = src.substring(pos + 5);
              const eol = rest.indexOf('\n');

              entry.netAttr = wxTrimRight(eol !== -1 ? rest.substring(0, eol) : rest);
            }
          }
        }
      }

      if (entry.symbol) {
        const copy = LIB_SYMBOL.copyOf(entry.symbol);
        this.m_libSymbols.set(aBasename, copy);
        return copy;
      }
    }

    // Try built-in standard symbols before falling back to a placeholder
    const builtin = this.loadBuiltinSymbol(aBasename);

    if (builtin) {
      this.m_libSymbols.set(aBasename, builtin);
      return builtin;
    }

    // Not found anywhere - create a fallback placeholder
    const fallback = this.createFallbackSymbol(aBasename);
    this.m_libSymbols.set(aBasename, fallback);

    if (this.m_reporter) {
      let suggestion = '';
      let bestDist = Number.MAX_SAFE_INTEGER;

      for (const [name] of [...this.m_symLibrary].sort((a, b) => cpLess(a[0], b[0]))) {
        const dist = editDistance(aBasename, name);

        if (dist < bestDist && dist <= 3) {
          bestDist = dist;
          suggestion = name;
        }
      }

      // Also check builtins, which may have a closer match than the library cache
      for (const [name] of [...SCH_IO_GEDA.getBuiltinSymbols()].sort((a, b) =>
        cpLess(a[0], b[0]),
      )) {
        const dist = editDistance(aBasename, name);

        if (dist < bestDist && dist <= 3) {
          bestDist = dist;
          suggestion = name;
        }
      }

      let msg = `Symbol '${aBasename}' not found in gEDA libraries.`;

      if (suggestion !== '') msg += ` Did you mean '${suggestion}'?`;

      this.m_reporter.Report(msg);
    }

    return fallback;
  }

  private createFallbackSymbol(aBasename: string): LIB_SYMBOL {
    let symName = aBasename;

    if (symName.endsWith('.sym')) symName = symName.substring(0, symName.length - 4);

    const libSymbol = new LIB_SYMBOL(symName);
    libSymbol.SetShowPinNumbers(true);
    libSymbol.SetShowPinNames(true);

    const halfSize = Math.trunc(this.toKiCadDist(DEFAULT_SYMBOL_SIZE_MILS) / 2);

    const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);
    rect.SetStart({ x: -halfSize, y: -halfSize });
    rect.SetEnd({ x: halfSize, y: halfSize });
    rect.SetStroke(new STROKE_PARAMS(0, LINE_STYLE.DEFAULT));
    libSymbol.AddDrawItem(rect);

    return libSymbol;
  }

  private flushPendingComponent(): void {
    const comp = this.m_pendingComp;

    if (!comp) return;

    // Skip title block symbols
    if (comp.basename.startsWith('title-')) {
      this.m_pendingComp = null;
      return;
    }

    const MILS = SCH_IO_GEDA.MILS_TO_IU;

    // Detect no-connect symbols (nc-right-1.sym, nc-left-1.sym, etc.) and emit
    // SCH_NO_CONNECT at the pin connection point rather than the component origin.
    const ncValue = this.findAttr(comp.attrs, 'value');
    const isNoConnect = comp.basename.startsWith('nc-') && ncValue === 'NoConnection';

    if (isNoConnect) {
      const ncSym = this.getOrLoadSymbol(comp.basename);
      let pinLocalX = 0;
      let pinLocalY = 0;

      const pins = ncSym.GetPins();

      if (pins.length > 0) {
        const pinPos = pins[0]!.GetPosition();
        pinLocalX = Math.trunc(pinPos.x / MILS);
        pinLocalY = Math.trunc(-pinPos.y / MILS);
      }

      // Apply gEDA component rotation/mirror to the pin offset
      let rx = pinLocalX;
      let ry = pinLocalY;

      switch (comp.angle) {
        case 90:
          rx = -pinLocalY;
          ry = pinLocalX;
          break;
        case 180:
          rx = -pinLocalX;
          ry = -pinLocalY;
          break;
        case 270:
          rx = pinLocalY;
          ry = -pinLocalX;
          break;
        default:
          break;
      }

      if (comp.mirror) rx = -rx;

      this.m_screen!.Append(new SCH_NO_CONNECT(this.toKiCad(comp.x + rx, comp.y + ry)));
      this.m_pendingComp = null;
      return;
    }

    // Check for hierarchical sheet reference. In gEDA, a source= attribute
    // pointing to a .sch file indicates a hierarchical sub-schematic.
    const sourceAttr = this.findAttr(comp.attrs, 'source');

    if (sourceAttr !== '' && sourceAttr.endsWith('.sch')) {
      this.importHierarchicalSheet(sourceAttr);
      this.m_pendingComp = null;
      return;
    }

    let libSym: LIB_SYMBOL;

    if (comp.embedded && comp.embeddedSym) {
      this.m_libSymbols.set(comp.basename, comp.embeddedSym);
      libSym = comp.embeddedSym;
      comp.embeddedSym = null;
    } else {
      libSym = this.getOrLoadSymbol(comp.basename);
    }

    // Compare component symversion against the loaded symbol's symversion.
    // A mismatch in the major version number indicates the symbol has changed
    // in an incompatible way since the schematic was saved.
    const compSymver = this.findAttr(comp.attrs, 'symversion');

    if (compSymver !== '' && this.m_reporter) {
      const symSymver = this.m_symLibrary.get(comp.basename)?.symversion ?? '';

      if (symSymver !== '') {
        const beforeDot = (s: string): string =>
          s.includes('.') ? s.substring(0, s.indexOf('.')) : s;
        const compMajor = wxToLong(beforeDot(compSymver)).value;
        const symMajor = wxToLong(beforeDot(symSymver)).value;

        if (compMajor !== symMajor) {
          const refdes = this.findAttr(comp.attrs, 'refdes');
          const label = refdes === '' ? comp.basename : refdes;

          this.m_reporter.Report(
            `Symbol version mismatch for '${label}' (${comp.basename}): schematic has symversion ${compSymver}, library symbol has symversion ${symSymver}.`,
            RPT_SEVERITY_WARNING,
          );
        }
      }
    }

    // Detect power symbols via the net= attribute in the .sym definition.
    // gEDA power symbols (gnd-1.sym, vcc-1.sym, etc.) carry a net=NETNAME:PIN
    // attribute that identifies them as implicit power connections.
    const symNetAttr = this.m_symLibrary.get(comp.basename)?.netAttr ?? '';

    const isPowerSym = symNetAttr !== '';
    let powerNetName = '';

    if (isPowerSym) {
      // Schematic-level net= overrides the .sym-level default (e.g. generic-power.sym
      // has net=Vcc:1 but instances use net=5V:1 or net=9V:1).
      const schematicNet = this.findAttr(comp.attrs, 'net');
      const effectiveNet = schematicNet === '' ? symNetAttr : schematicNet;

      const colonPos = effectiveNet.indexOf(':');

      powerNetName = colonPos !== -1 ? effectiveNet.substring(0, colonPos) : effectiveNet;

      // Work on a copy so the shared cached symbol is not modified.
      // Each power instance may have a different net name.
      libSym = LIB_SYMBOL.copyOf(libSym);

      libSym.SetGlobalPower();
      libSym.SetShowPinNames(false);
      libSym.SetShowPinNumbers(false);
      libSym.GetReferenceField().SetText('#PWR');
      libSym.GetReferenceField().SetVisible(false);
      libSym.GetValueField().SetText(powerNetName);
      libSym.GetValueField().SetVisible(true);

      for (const pin of libSym.GetPins()) {
        pin.SetName(powerNetName);
        pin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
      }
    }

    const libId = new LIB_ID(this.getLibName(), libSym.GetName());
    const pos = this.toKiCad(comp.x, comp.y);
    const sheet = this.m_schematic!.CurrentSheet();

    const symbol = new SCH_SYMBOL(libSym, libId, sheet, 1, 0, pos);

    symbol.SetOrientation(this.toKiCadOrientation(comp.angle, comp.mirror));

    if (isPowerSym) {
      const pwrRef = `#PWR${String(++this.m_powerCounter).padStart(4, '0')}`;
      symbol.SetRef(sheet, pwrRef);
      symbol.GetField(FIELD_T.REFERENCE)!.SetText(pwrRef);
      symbol.GetField(FIELD_T.REFERENCE)!.SetVisible(false);
      symbol.GetField(FIELD_T.VALUE)!.SetText(powerNetName);
      symbol.GetField(FIELD_T.VALUE)!.SetVisible(true);
    }

    // Mark graphical-only symbols as excluded from BOM, board, and simulation
    if (this.findAttr(comp.attrs, 'graphical') === '1') {
      symbol.SetExcludedFromBOM(true);
      symbol.SetExcludedFromBoard(true);
      symbol.SetExcludedFromSim(true);
    }

    const refdes = this.findAttr(comp.attrs, 'refdes');
    const value = this.findAttr(comp.attrs, 'value');
    const footprint = this.findAttr(comp.attrs, 'footprint');

    const placeField = (aField: SCH_FIELD, aAttr: GEDA_ATTR): void => {
      aField.SetPosition(this.toKiCad(aAttr.x, aAttr.y));
      const textSize = this.toKiCadDist(aAttr.size * 10);
      aField.SetTextSize({ x: textSize, y: textSize });
    };

    if (!isPowerSym && refdes !== '') {
      symbol.SetRef(sheet, refdes);

      const refField = symbol.GetField(FIELD_T.REFERENCE)!;
      const refAttr = this.findAttrStruct(comp.attrs, 'refdes');
      refField.SetText(refdes);

      if (refAttr) {
        placeField(refField, refAttr);
        refField.SetVisible(refAttr.visible);
      }
    }

    if (!isPowerSym && value !== '') {
      const valField = symbol.GetField(FIELD_T.VALUE)!;
      const valAttr = this.findAttrStruct(comp.attrs, 'value');
      valField.SetText(value);

      if (valAttr) {
        placeField(valField, valAttr);
        valField.SetVisible(valAttr.visible);
      }
    }

    if (footprint !== '') symbol.SetFootprintFieldText(footprint);

    // Map documentation attribute to KiCad's native DATASHEET field
    const documentation = this.findAttr(comp.attrs, 'documentation');

    if (documentation !== '') symbol.GetField(FIELD_T.DATASHEET)!.SetText(documentation);

    // Map description attribute to KiCad's native DESCRIPTION field
    const descAttr = this.findAttrStruct(comp.attrs, 'description');

    if (descAttr && descAttr.value !== '') {
      const descField = symbol.GetField(FIELD_T.DESCRIPTION)!;
      descField.SetText(descAttr.value);
      descField.SetVisible(descAttr.visible);

      if (descAttr.visible) placeField(descField, descAttr);
    }

    // Collect net= attributes for post-processing. Power symbols already establish
    // their net connection through the pin name, so skip global label generation.
    if (!isPowerSym) {
      for (const attr of comp.attrs) {
        if (attr.name === 'net') {
          const colonPos = attr.value.indexOf(':');

          if (colonPos !== -1) {
            this.m_netAttrRecords.push({
              netname: attr.value.substring(0, colonPos),
              pinnumber: attr.value.substring(colonPos + 1),
              symbol,
            });
          }
        }
      }
    }

    // Store additional attributes as custom fields (skip those already handled)
    const handled = new Set([
      'refdes',
      'value',
      'footprint',
      'net',
      'device',
      'symversion',
      'documentation',
      'description',
      'graphical',
      'slot',
      'numslots',
      'slotdef',
    ]);

    for (const attr of comp.attrs) {
      if (handled.has(attr.name)) continue;

      const field = symbol.AddField(new SCH_FIELD(symbol, FIELD_T.USER, attr.name));
      field.SetText(attr.value);
      field.SetVisible(attr.visible);
      field.SetPosition(pos);
    }

    // Track pin connection points for junction detection. Reverse-map the
    // KiCad IU positions back to gEDA coordinates to match the wire endpoints.
    for (const pin of libSym.GetPins()) {
      const pinPos = symbol.GetPinPhysicalPosition(pin);
      const gedaX = Math.trunc(pinPos.x / MILS);
      const gedaY = this.m_maxY - Math.trunc(pinPos.y / MILS);
      this.trackEndpoint(gedaX, gedaY);
    }

    symbol.SetLibSymbol(LIB_SYMBOL.copyOf(libSym));

    // Apply multi-slot pin remapping on the symbol's PRIVATE copy of the lib symbol.
    // gEDA slotdef format is "N:pin1,pin2,pin3" where N is the slot number
    // and each pin corresponds to a pinseq-ordered pin in the symbol.
    // Operating on the private copy prevents corrupting the shared cached symbol.
    const slotStr = this.findAttr(comp.attrs, 'slot');
    const slot = wxToLong(slotStr);

    if (slotStr !== '' && slot.ok && slot.value > 0) {
      let targetSlotDef = '';

      for (const attr of comp.attrs) {
        if (attr.name !== 'slotdef') continue;

        const colonPos = attr.value.indexOf(':');

        if (colonPos === -1) continue;

        const defSlot = wxToLong(attr.value.substring(0, colonPos));

        if (defSlot.ok && defSlot.value === slot.value) {
          targetSlotDef = attr.value.substring(colonPos + 1);
          break;
        }
      }

      if (targetSlotDef !== '') {
        const slotPins = new WX_TOKENIZER_RET_EMPTY(targetSlotDef, ',').All();

        const privateSym = symbol.GetLibSymbolRef()!;

        // Build pinseq-ordered list from the private copy's pins.
        // Pins are added in file order which matches pinseq order.
        const pinsBySeq = privateSym.GetPins();

        for (let i = 0; i < slotPins.length && i < pinsBySeq.length; i++)
          pinsBySeq[i]!.SetNumber(wxTrimRight(slotPins[i]!));
      }
    }

    this.m_screen!.Append(symbol);
    this.m_pendingComp = null;
  }

  // ==========================================================================
  // Hierarchical sheet import
  // ==========================================================================

  private importHierarchicalSheet(aSourceFile: string): void {
    // Resolve relative paths against the directory of the current schematic
    const fullPath = aSourceFile.startsWith('/')
      ? aSourceFile
      : joinPath(fileNameParts(this.m_filename).path, fileNameParts(aSourceFile).fullName);
    const exists = this.m_readFile(fullPath) !== null;

    if (!exists) {
      this.m_reporter?.Report(
        `Hierarchical source '${aSourceFile}' not found, creating empty sheet.`,
        RPT_SEVERITY_WARNING,
      );
    }

    if (this.m_importStack.has(fullPath)) {
      this.m_reporter?.Report(
        `Circular hierarchy detected for '${aSourceFile}', skipping.`,
        RPT_SEVERITY_WARNING,
      );

      return;
    }

    const pos = this.toKiCad(this.m_pendingComp!.x, this.m_pendingComp!.y);

    // Use a default sheet size. We'll resize after loading the sub-schematic content.
    const sheetSize: VECTOR2I = { x: schIUScale.milsToIU(2000), y: schIUScale.milsToIU(1500) };

    const sheet = new SCH_SHEET(this.m_rootSheet, pos, sheetSize);

    const refdes = this.findAttr(this.m_pendingComp!.attrs, 'refdes');

    sheet
      .GetField(FIELD_T.SHEET_NAME)!
      .SetText(refdes !== '' ? refdes : fileNameParts(aSourceFile).name);

    sheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(aSourceFile);
    sheet.SetFileName(aSourceFile);

    this.m_screen!.Append(sheet);

    if (exists) this.m_deferredSheets.push({ sheet, sourceFile: fullPath });
  }

  // ==========================================================================
  // Endpoint tracking
  // ==========================================================================

  private trackEndpoint(aGedaX: number, aGedaY: number): void {
    const k = `${aGedaX},${aGedaY}`;
    const e = this.m_netEndpoints.get(k);

    if (e) e[2]++;
    else this.m_netEndpoints.set(k, [aGedaX, aGedaY, 1]);
  }

  /** `std::map<std::pair<int,int>, int>` in key order. */
  private sortedEndpoints(): [number, number, number][] {
    return [...this.m_netEndpoints.values()].sort((a, b) =>
      a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1],
    );
  }

  // ==========================================================================
  // Post-processing
  // ==========================================================================

  private postProcess(): void {
    this.flushPendingComponent();
    this.processNetAttributes();
    this.addBusEntries();
    this.addJunctions();
    this.loadDeferredSheets();
  }

  private processNetAttributes(): void {
    for (const rec of this.m_netAttrRecords) {
      const libSym = rec.symbol.GetLibSymbolRef();

      if (!libSym) continue;

      // Find the pin with matching number
      for (const pin of libSym.GetPins()) {
        if (pin.GetNumber() === rec.pinnumber) {
          const pinPos = rec.symbol.GetPinPhysicalPosition(pin);

          const label = new SCH_GLOBALLABEL(pinPos, rec.netname);
          const textSize = this.toKiCadDist(Math.trunc(GEDA_DEFAULT_TEXT_SIZE_MILS / 2));
          label.SetTextSize({ x: textSize, y: textSize });

          // Build a unit direction vector for the pin in library space,
          // then transform it through the symbol's rotation/mirror matrix
          // to get the world-space pin direction.
          let pinDir: VECTOR2I;

          switch (pin.GetOrientation()) {
            case PIN_ORIENTATION.PIN_LEFT:
              pinDir = { x: -1, y: 0 };
              break;
            case PIN_ORIENTATION.PIN_UP:
              pinDir = { x: 0, y: -1 };
              break;
            case PIN_ORIENTATION.PIN_DOWN:
              pinDir = { x: 0, y: 1 };
              break;
            default:
              pinDir = { x: 1, y: 0 };
              break;
          }

          const worldDir = rec.symbol.GetTransform().TransformCoordinate(pinDir);

          // Orient the label away from the transformed pin direction
          if (Math.abs(worldDir.x) >= Math.abs(worldDir.y))
            label.SetSpinStyle(new SPIN_STYLE(worldDir.x > 0 ? SPIN_STYLE.LEFT : SPIN_STYLE.RIGHT));
          else
            label.SetSpinStyle(new SPIN_STYLE(worldDir.y > 0 ? SPIN_STYLE.UP : SPIN_STYLE.BOTTOM));

          this.m_screen!.Append(label);
          break;
        }
      }
    }
  }

  /** The screen's wires, in `m_screen->Items()` order. */
  private screenWires(): SCH_LINE[] {
    const wires: SCH_LINE[] = [];

    for (const item of this.m_screen!.Items()) {
      if (item.Type() !== KICAD_T.SCH_LINE_T) continue;

      const wire = item as unknown as SCH_LINE;

      if (wire.GetLayer() !== SCH_LAYER_ID.LAYER_WIRE) continue;

      wires.push(wire);
    }

    return wires;
  }

  private addJunctions(): void {
    // Collect all wire segments and pin positions from the screen.
    const wireSegs = this.screenWires().map((w) => [w.GetStartPoint(), w.GetEndPoint()] as const);
    const junctionPts = new Map<string, [number, number]>();
    const key = (x: number, y: number): string => `${x},${y}`;

    // Place junctions where 3+ endpoints coincide at the same point.
    for (const [x, y, count] of this.sortedEndpoints()) {
      if (count >= 3) junctionPts.set(key(x, y), [x, y]);
    }

    // Detect T-junctions: a wire endpoint that lands on the interior of
    // another wire segment. Work in gEDA coordinates for exact integer match,
    // then convert when placing the junction.
    for (const [x, y] of this.sortedEndpoints()) {
      if (junctionPts.has(key(x, y))) continue;

      const pt = this.toKiCad(x, y);

      for (const [segStart, segEnd] of wireSegs) {
        if (
          (pt.x === segStart.x && pt.y === segStart.y) ||
          (pt.x === segEnd.x && pt.y === segEnd.y)
        )
          continue;

        const isHorizontal = segStart.y === segEnd.y;
        const isVertical = segStart.x === segEnd.x;

        if (!isHorizontal && !isVertical) continue;

        let onSeg = false;

        if (isHorizontal && pt.y === segStart.y) {
          onSeg = pt.x > Math.min(segStart.x, segEnd.x) && pt.x < Math.max(segStart.x, segEnd.x);
        } else if (isVertical && pt.x === segStart.x) {
          onSeg = pt.y > Math.min(segStart.y, segEnd.y) && pt.y < Math.max(segStart.y, segEnd.y);
        }

        if (onSeg) {
          junctionPts.set(key(x, y), [x, y]);
          break;
        }
      }
    }

    // `std::set<std::pair<int,int>>` in key order.
    for (const [gX, gY] of [...junctionPts.values()].sort((a, b) =>
      a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1],
    ))
      this.m_screen!.Append(new SCH_JUNCTION(this.toKiCad(gX, gY)));
  }

  private addBusEntries(): void {
    if (this.m_busSegments.length === 0) return;

    // Collect all net (wire) endpoints from the screen
    const wireEndpoints: [VECTOR2I, SCH_LINE][] = [];

    for (const wire of this.screenWires()) {
      wireEndpoints.push([wire.GetStartPoint(), wire]);
      wireEndpoints.push([wire.GetEndPoint(), wire]);
    }

    const entrySize = schIUScale.milsToIU(DEFAULT_SCH_ENTRY_SIZE);

    for (const bus of this.m_busSegments) {
      const busIsHorizontal = bus.start.y === bus.end.y;
      const busIsVertical = bus.start.x === bus.end.x;

      if (!busIsHorizontal && !busIsVertical) continue;

      for (const [pt, wire] of wireEndpoints) {
        let onBus: boolean;

        if (busIsHorizontal) {
          onBus =
            pt.y === bus.start.y &&
            pt.x >= Math.min(bus.start.x, bus.end.x) &&
            pt.x <= Math.max(bus.start.x, bus.end.x);
        } else {
          onBus =
            pt.x === bus.start.x &&
            pt.y >= Math.min(bus.start.y, bus.end.y) &&
            pt.y <= Math.max(bus.start.y, bus.end.y);
        }

        if (!onBus) continue;

        // Determine which direction the wire goes away from the bus
        const ws = wire.GetStartPoint();
        const otherEnd = ws.x === pt.x && ws.y === pt.y ? wire.GetEndPoint() : ws;
        let dx: number;
        let dy: number;

        if (busIsHorizontal) {
          dy = otherEnd.y < pt.y ? -entrySize : entrySize;
          let sign = bus.ripperDir;

          if (sign === 0) {
            // Auto-detect from wire position relative to bus center
            const busMidX = Math.trunc((bus.start.x + bus.end.x) / 2);
            sign = pt.x <= busMidX ? 1 : -1;
          }

          dx = sign * entrySize;
        } else {
          dx = otherEnd.x < pt.x ? -entrySize : entrySize;
          let sign = bus.ripperDir;

          if (sign === 0) {
            const busMidY = Math.trunc((bus.start.y + bus.end.y) / 2);
            sign = pt.y <= busMidY ? 1 : -1;
          }

          dy = sign * entrySize;
        }

        // Bus entry position is on the bus; its end (pos + size) is on the wire side
        const entry = new SCH_BUS_WIRE_ENTRY(pt);
        entry.SetSize({ x: dx, y: dy });

        // Shorten the wire so it starts at the bus entry tip instead of the bus
        const entryTip: VECTOR2I = { x: pt.x + dx, y: pt.y + dy };
        const cur = wire.GetStartPoint();

        if (cur.x === pt.x && cur.y === pt.y) wire.SetStartPoint(entryTip);
        else wire.SetEndPoint(entryTip);

        this.m_screen!.Append(entry);
      }
    }
  }

  /** A fresh importer for a sub-schematic, reading through the same file source. */
  private subImporter(): SCH_IO_GEDA {
    const sub = new SCH_IO_GEDA();
    sub.SetFileReader(this.m_readFile);
    sub.SetDirLister(this.m_listDir);
    return sub;
  }

  private loadDeferredSheets(): void {
    for (const deferred of this.m_deferredSheets) {
      const sheet = deferred.sheet;

      const subScreen = new SCH_SCREEN(this.m_schematic);
      subScreen.SetFileName(deferred.sourceFile);
      sheet.SetScreen(subScreen);

      // Use a fresh importer instance for each sub-schematic to avoid
      // clobbering parse state. Share the import stack for recursion detection
      // and the symbol library cache to avoid redundant filesystem scanning.
      const sub = this.subImporter();
      sub.m_importStack = new Set(this.m_importStack);
      sub.m_importStack.add(this.m_filename);

      for (const [name, entry] of [...this.m_symLibrary].sort((a, b) => cpLess(a[0], b[0])))
        sub.m_symLibrary.set(name, { path: entry.path, symbol: null, symversion: '', netAttr: '' });

      sub.m_symLibraryInitialized = this.m_symLibraryInitialized;

      try {
        sub.LoadSchematicFile(deferred.sourceFile, this.m_schematic!, sheet, this.m_properties);

        // Merge any newly-discovered symbols back into the parent cache
        // so subsequent sub-schematics benefit from them.
        for (const [name, entry] of [...sub.m_symLibrary].sort((a, b) => cpLess(a[0], b[0]))) {
          if (!this.m_symLibrary.has(name)) this.m_symLibrary.set(name, entry);
        }
      } catch (e) {
        if (!(e instanceof IO_ERROR)) throw e;

        this.m_reporter?.Report(
          `Failed to load sub-schematic '${deferred.sourceFile}': ${e.What()}`,
          RPT_SEVERITY_WARNING,
        );
      }
    }
  }

  private fitPageToContent(): void {
    const bbox = new BOX2I();

    for (const item of this.m_screen!.Items()) bbox.Merge(item.GetBoundingBox());

    if (bbox.GetWidth() === 0 || bbox.GetHeight() === 0) return;

    const size = bbox.GetSize();
    const targetSize: VECTOR2I = {
      x: size.x + schIUScale.milsToIU(1500),
      y: size.y + schIUScale.milsToIU(1500),
    };

    // `PAGE_INFO pageInfo = GetPageSettings()` is a copy upstream; the screen holds its own.
    const pageInfo = this.m_screen!.GetPageSettings();
    let pageSizeIU = pageInfo.GetSizeIU(schIUScale.IU_PER_MILS);

    if (pageSizeIU.x < targetSize.x) pageInfo.SetWidthMils(schIUScale.iuToMils(targetSize.x));

    if (pageSizeIU.y < targetSize.y) pageInfo.SetHeightMils(schIUScale.iuToMils(targetSize.y));

    this.m_screen!.SetPageSettings(pageInfo);

    pageSizeIU = this.m_screen!.GetPageSettings().GetSizeIU(schIUScale.IU_PER_MILS);
    const sheetCentre: VECTOR2I = {
      x: Math.trunc(pageSizeIU.x / 2),
      y: Math.trunc(pageSizeIU.y / 2),
    };
    const itemsCentre = bbox.Centre();

    const translation: VECTOR2I = {
      x: sheetCentre.x - itemsCentre.x,
      y: sheetCentre.y - itemsCentre.y,
    };
    translation.x = translation.x - (translation.x % schIUScale.milsToIU(100));
    translation.y = translation.y - (translation.y % schIUScale.milsToIU(100));

    const allItems = [...this.m_screen!.Items()];

    for (const item of allItems) {
      const p = item.GetPosition();
      item.SetPosition({ x: p.x + translation.x, y: p.y + translation.y });
      item.ClearFlags();
      this.m_screen!.Update(item);
    }
  }

  // ==========================================================================
  // Main entry point
  // ==========================================================================

  override LoadSchematicFile(
    aFileName: string,
    aSchematic: SCHEMATIC,
    aAppendToMe: SCH_SHEET | null = null,
    aProperties: SCH_IO_PROPERTIES | null = null,
  ): SCH_SHEET {
    this.m_properties = aProperties;
    this.m_schematic = aSchematic;
    this.m_filename = aFileName;
    this.m_libSymbols.clear();
    this.m_netEndpoints.clear();
    this.m_netAttrRecords = [];
    this.m_busSegments = [];
    this.m_deferredSheets = [];
    this.m_pendingComp = null;

    if (!this.m_symLibraryInitialized) this.m_symLibrary.clear();

    this.m_maxY = 0;
    this.m_releaseVersion = 0;
    this.m_fileFormatVersion = 0;
    this.m_powerCounter = 0;

    if (aAppendToMe) {
      if (!aSchematic.IsValid()) throw new IO_ERROR("Can't append to a schematic with no root!");
      this.m_rootSheet = aAppendToMe;
    } else {
      this.m_rootSheet = new SCH_SHEET(aSchematic);
      this.m_rootSheet.SetFileName(aFileName);
      aSchematic.SetTopLevelSheets([this.m_rootSheet]);
    }

    if (!this.m_rootSheet.GetScreen()) {
      const screen = new SCH_SCREEN(aSchematic);
      screen.SetFileName(aFileName);
      this.m_rootSheet.SetScreen(screen);
      (this.m_rootSheet as { m_Uuid: unknown }).m_Uuid = screen.GetUuid();
    }

    this.m_screen = this.m_rootSheet.GetScreen();

    const file = this.openTextFile(aFileName);

    if (!file) throw new IO_ERROR(`Cannot open file '${aFileName}'.`);

    if (file.GetLineCount() === 0) throw new IO_ERROR(`File '${aFileName}' is empty.`);

    // First pass: scan for max Y coordinate to set up the Y-flip transform.
    // We need this before creating objects because coordinates are transformed during creation.
    for (let i = 0; i < file.GetLineCount(); i++) {
      const line = file.GetLine(i);
      const type = line === '' ? '\0' : line[0]!;

      // Skip embedded component blocks entirely. Their coordinates are
      // symbol-local and must not affect the schematic-level Y extent.
      if (type === '[') {
        while (++i < file.GetLineCount()) {
          if (file.TrimLine(i) === ']') break;
        }

        continue;
      }

      if ('CNUTLBVAPG'.includes(type)) {
        const tok = new WX_TOKENIZER(line);
        tok.GetNextToken(); // skip type

        let val = 0;

        if (tok.HasMoreTokens()) tok.GetNextToken(); // x or x1

        if (tok.HasMoreTokens()) {
          val = wxToLong(tok.GetNextToken()).value;

          if (val > this.m_maxY) this.m_maxY = toInt(val);
        }

        if (type === 'N' || type === 'U' || type === 'L' || type === 'P') {
          if (tok.HasMoreTokens()) tok.GetNextToken(); // x2

          if (tok.HasMoreTokens()) {
            val = wxToLong(tok.GetNextToken()).value;

            if (val > this.m_maxY) this.m_maxY = toInt(val);
          }
        }

        if (type === 'B') {
          tok.nextLong(0); // bw
          const bh = tok.nextLong(0);

          const top = val + bh;

          if (top > this.m_maxY) this.m_maxY = toInt(top);
        }

        if (type === 'V' || type === 'A') {
          // V: cx cy radius ...  A: cx cy radius ...
          // After reading cy into val, the next token is radius
          const radius = tok.nextLong(0);

          const extent = val + radius;

          if (extent > this.m_maxY) this.m_maxY = toInt(extent);
        }

        // T lines have content lines that follow the header. Skip them
        // to avoid misinterpreting text as object lines.
        // Format: T x y color size vis show_nv angle align num_lines
        // tok has consumed: type, x (skipped), y (read). Skip remaining 6
        // fields to reach num_lines.
        if (type === 'T') {
          let numTextLines = 1;

          for (let j = 0; j < 6 && tok.HasMoreTokens(); j++) tok.GetNextToken();

          if (tok.HasMoreTokens()) numTextLines = wxToLong(tok.GetNextToken()).value;

          i += numTextLines;
        }
      } else if (type === 'H') {
        // Scan H path lines for Y coordinates in subsequent lines
        const tok = new WX_TOKENIZER(line);
        tok.GetNextToken(); // skip 'H'
        let numlines = 0;

        for (let j = 0; j < 12 && tok.HasMoreTokens(); j++) tok.GetNextToken();

        if (tok.HasMoreTokens()) numlines = wxToLong(tok.GetNextToken()).value;

        for (let j = 0; j < numlines && i + 1 < file.GetLineCount(); j++) {
          i++;
          const ptok = new WX_TOKENIZER_RET_EMPTY(file.GetLine(i), ' ,\t');

          // Path data uses SVG-like commands: M x,y  L x,y  C x1,y1 x2,y2 x3,y3  z
          // Coordinate pairs alternate X then Y. Command letters reset to X.
          let nextIsY = false;

          while (ptok.HasMoreTokens()) {
            const token = ptok.GetNextToken();

            if (token.length === 1 && /[A-Za-z]/.test(token)) {
              nextIsY = false;
              continue;
            }

            const r = wxToLong(token);

            if (r.ok) {
              if (nextIsY && r.value > this.m_maxY) this.m_maxY = toInt(r.value);

              nextIsY = !nextIsY;
            }
          }
        }
      }
    }

    this.m_maxY += 1000;

    // Parse version line
    const lineIdx = { v: 0 };
    const firstLine = file.GetLine(lineIdx.v);
    lineIdx.v++;

    if (!this.parseVersionLine(firstLine))
      throw new IO_ERROR(`File '${aFileName}' is not a valid gEDA schematic.`);

    // Main parse loop
    while (lineIdx.v < file.GetLineCount()) {
      const line = file.GetLine(lineIdx.v);
      lineIdx.v++;

      if (line === '') continue;

      switch (line[0]) {
        case 'C':
          this.parseComponent(line, file, lineIdx);
          break;
        case 'N':
          this.parseNet(line, file, lineIdx);
          break;
        case 'U':
          this.parseBus(line, file, lineIdx);
          break;
        case 'T':
          this.parseText(line, file, lineIdx);
          break;
        case 'L':
          this.parseLine(line, file, lineIdx);
          break;
        case 'B':
          this.parseBox(line, file, lineIdx);
          break;
        case 'V':
          this.parseCircle(line, file, lineIdx);
          break;
        case 'A':
          this.parseArc(line, file, lineIdx);
          break;
        case 'H':
          this.parsePath(line, file, lineIdx);
          break;
        case 'G':
          this.parsePicture(line, file, lineIdx);
          break;
        case 'P':
          this.parsePin(line, file, lineIdx);
          break;
        case '[':
          this.parseEmbeddedComponent(file, lineIdx);
          break;
        case '{': {
          while (lineIdx.v < file.GetLineCount()) {
            if (file.TrimLine(lineIdx.v) === '}') {
              lineIdx.v++;
              break;
            }

            lineIdx.v++;
          }

          break;
        }
        default:
          break;
      }
    }

    this.postProcess();

    // Size the page to fit the imported content and center it, following
    // the same approach as the Eagle importer.
    this.fitPageToContent();

    // Multi-page support: when the project handler passes additional schematic
    // files, create sub-sheets for each and load them into the hierarchy.
    const additionalFiles = aProperties?.get('additional_schematics');

    if (additionalFiles !== undefined) {
      let sheetY = schIUScale.milsToIU(500);
      const sheetSpacing = schIUScale.milsToIU(2000);
      let pageNum = 2;

      for (const filePath of new WX_TOKENIZER_RET_EMPTY(additionalFiles, ';').All()) {
        const fn = fileNameParts(filePath);

        const pos: VECTOR2I = { x: schIUScale.milsToIU(500), y: sheetY };
        const size: VECTOR2I = { x: schIUScale.milsToIU(2000), y: schIUScale.milsToIU(1500) };

        const subSheet = new SCH_SHEET(this.m_rootSheet, pos, size);

        subSheet.GetField(FIELD_T.SHEET_NAME)!.SetText(`Page ${pageNum}`);
        subSheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(fn.fullName);
        subSheet.SetFileName(fn.fullName);

        this.m_screen!.Append(subSheet);

        if (this.m_readFile(filePath) !== null) {
          const subScreen = new SCH_SCREEN(this.m_schematic);
          subScreen.SetFileName(filePath);
          subSheet.SetScreen(subScreen);

          const sub = this.subImporter();

          for (const [name, entry] of [...this.m_symLibrary].sort((a, b) => cpLess(a[0], b[0])))
            sub.m_symLibrary.set(name, {
              path: entry.path,
              symbol: null,
              symversion: entry.symversion,
              netAttr: entry.netAttr,
            });

          sub.m_symLibraryInitialized = this.m_symLibraryInitialized;

          try {
            sub.LoadSchematicFile(filePath, this.m_schematic!, subSheet, null);
          } catch (e) {
            if (!(e instanceof IO_ERROR)) throw e;

            this.m_reporter?.Report(
              `Failed to load page '${fn.fullName}': ${e.What()}`,
              RPT_SEVERITY_WARNING,
            );
          }
        }

        sheetY += sheetSpacing;
        pageNum++;
      }
    }

    return this.m_rootSheet;
  }
}
