// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/kicad_legacy/pcb_io_kicad_legacy.cpp` / `.h`: the reader
 * for KiCad's pre-s-expression board (`PCBNEW-BOARD`, `.brd`) and footprint
 * library (`PCBNEW-LibModule-V1`, `.mod` / `.emp`) formats.
 *
 * The C++ parses each line as a `char*` it walks with `strtol`, `strtok_r`
 * (which writes NULs into the line), `fast_float::from_chars` and
 * `ReadDelimitedText`. The line here is the same bytes (a `LINE_READER`
 * buffer, NUL-terminated and mutable) and those functions are ported over it
 * below, so a malformed line is read the way KiCad reads it.
 */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { DSNLEXER } from '@ziroeda/common/dsnlexer.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { kiidFromString } from '@ziroeda/common/kiid.js';
import {
  B_Adhes,
  B_Cu,
  B_Mask,
  B_Paste,
  B_SilkS,
  BoardLayerFromLegacyId,
  Cmts_User,
  Dwgs_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  F_Adhes,
  F_Cu,
  F_Mask,
  F_Paste,
  F_SilkS,
  type PCB_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { strtodPrefix, ToCDoubleOk } from '@ziroeda/common/libc/stdlib.js';
import { LSET } from '@ziroeda/common/lset.js';
import { NETCLASS } from '@ziroeda/common/netclass.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { LINE_READER } from '@ziroeda/common/richio.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import {
  convertToNewOverbarNotation,
  ReplaceIllegalFileNameChars,
} from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD, LEGACY_BOARD_FILE_VERSION } from '../../board.js';
import { LAYER_CLASS, VIA_DIMENSION } from '../../board_design_settings.js';
import { ADD_MODE } from '../../board_item_container.js';
import { BOARD_CONNECTED_ITEM } from '../../board_connected_item.js';
import { LAYER } from '../../board_types.js';
import {
  FOOTPRINT,
  FP_3DMODEL,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
} from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { NETINFO_LIST } from '../../netinfo_list.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK } from '../../padstack.js';
import { DIM_UNITS_FORMAT } from '../../pcb_dimension_types.js';
import { PCB_DIM_ALIGNED } from '../../pcb_dimension.js';
import { PCB_FIELD } from '../../pcb_field.js';
import { PCB_PLOT_PARAMS, PCB_PLOT_PARAMS_PARSER } from '../../pcb_plot_params.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TARGET } from '../../pcb_target.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { VIATYPE } from '../../pcb_track_types.js';
import { ZONE } from '../../zone.js';
import { ZONE_BORDER_DISPLAY_STYLE, ZONE_FILL_MODE, ZONE_SETTINGS } from '../../zone_settings.js';
import { ZONE_CONNECTION } from '../../zones.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';

export const FOOTPRINT_LIBRARY_HEADER = 'PCBNEW-LibModule-V1';
export const FOOTPRINT_LIBRARY_HEADER_CNT = 18;

// The legacy layer numbers (`LAYER_N_*` of the old layers_id_colors_and_visibility.h).
const FIRST_LAYER = 0;
const FIRST_COPPER_LAYER = 0;
const LAYER_N_BACK = 0;
const LAYER_N_FRONT = 15;
const FIRST_NON_COPPER_LAYER = 16;
const ADHESIVE_N_BACK = 16;
const ADHESIVE_N_FRONT = 17;
const SOLDERPASTE_N_BACK = 18;
const SOLDERPASTE_N_FRONT = 19;
const SILKSCREEN_N_BACK = 20;
const SILKSCREEN_N_FRONT = 21;
const SOLDERMASK_N_BACK = 22;
const SOLDERMASK_N_FRONT = 23;
const DRAW_N = 24;
const COMMENT_N = 25;
const ECO1_N = 26;
const ECO2_N = 27;
const EDGE_N = 28;
const LAST_NON_COPPER_LAYER = 28;

const ALL_CU_LAYERS = 0x0000ffff;

const PCB_LEGACY_TEXT_is_REFERENCE = 0;
const PCB_LEGACY_TEXT_is_VALUE = 1;
const PCB_LEGACY_TEXT_is_DIVERS = 2; // French for "other"

/** `NOT_USED`: loadTrackList's "skip these" type. */
const NOT_USED = -1;

// ---------------------------------------------------------------------------
// The C string functions the parser calls, over a NUL-terminated byte line.
// ---------------------------------------------------------------------------

const DELIMS = [0x20, 0x09, 0x0d, 0x0a]; // " \t\r\n"

/** `isSpace( c )`: `strchr( delims, c )`, which also finds the terminating NUL. */
function isSpace(c: number): boolean {
  return c === 0 || DELIMS.includes(c);
}

/** C `isspace`. */
function cIsspace(c: number): boolean {
  return c === 0x20 || (c >= 0x09 && c <= 0x0d);
}

const lower = (c: number): number => (c >= 0x41 && c <= 0x5a ? c + 0x20 : c);

/** `!strncasecmp( s + p, x, strlen( x ) )`. */
function startsWithNoCase(s: Uint8Array, p: number, x: string): boolean {
  for (let i = 0; i < x.length; i++) {
    const c = s[p + i] ?? 0;

    if (lower(c) !== lower(x.charCodeAt(i))) return false;
  }

  return true;
}

/** `TESTLINE( x )`: the keyword, then a delimiter (or the line's end). */
function TESTLINE(s: Uint8Array, x: string, p = 0): boolean {
  return startsWithNoCase(s, p, x) && isSpace(s[p + x.length] ?? 0);
}

/** `TESTSUBSTR( x )`. */
function TESTSUBSTR(s: Uint8Array, x: string, p = 0): boolean {
  return startsWithNoCase(s, p, x);
}

/** `strtol` / `strtoul` of `base`: the value (as the C `long`) and where it stopped. */
function strtol(s: Uint8Array, p: number, base: number): { v: number; end: number } {
  let i = p;

  while (cIsspace(s[i] ?? 0)) i++;

  let neg = false;

  if (s[i] === 0x2d || s[i] === 0x2b) {
    neg = s[i] === 0x2d;
    i++;
  }

  if (base === 16 && s[i] === 0x30 && lower(s[i + 1] ?? 0) === 0x78) {
    const d = hexDigit(s[i + 2] ?? 0);
    if (d >= 0) i += 2;
  }

  let v = 0n;
  const start = i;

  for (;;) {
    const c = s[i] ?? 0;
    const d = base === 16 ? hexDigit(c) : c >= 0x30 && c <= 0x39 ? c - 0x30 : -1;

    if (d < 0) break;

    v = v * BigInt(base) + BigInt(d);
    i++;
  }

  if (i === start) return { v: 0, end: p };

  if (neg) v = -v;

  return { v: Number(BigInt.asIntN(64, v)), end: i };
}

function hexDigit(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  const l = lower(c);
  if (l >= 0x61 && l <= 0x66) return l - 0x61 + 10;
  return -1;
}

/** `intParse`: `(int) strtol( next, &out, 10 )`. */
function intParse(s: Uint8Array, p: number): { v: number; end: number } {
  const r = strtol(s, p, 10);
  return { v: r.v | 0, end: r.end };
}

/** `hexParse`: `(uint32_t) strtoul( next, &out, 16 )`. */
function hexParse(s: Uint8Array, p: number): { v: number; end: number } {
  const r = strtol(s, p, 16);
  return { v: r.v >>> 0, end: r.end };
}

/** `strlen` from p. */
function cstrEnd(s: Uint8Array, p: number): number {
  let i = p;
  while ((s[i] ?? 0) !== 0) i++;
  return i;
}

/** The bytes of the C string at p. */
function cbytes(s: Uint8Array, p: number): Uint8Array {
  return s.subarray(p, cstrEnd(s, p));
}

/** `From_UTF8( char* )`: the bytes decoded as UTF-8. */
function fromUTF8(b: Uint8Array): string {
  return new TextDecoder('utf-8').decode(b);
}

/** The C string at p as latin-1 text, for the numeric converters. */
function latin1(s: Uint8Array, p: number): string {
  let out = '';
  for (let i = p; (s[i] ?? 0) !== 0; i++) out += String.fromCharCode(s[i]!);
  return out;
}

/** `strcmp( s + p, x ) == 0`. */
function streq(s: Uint8Array, p: number | null, x: string): boolean {
  if (p === null) return false;
  return latin1(s, p) === x;
}

/** `strtok_r( start, delims, &save )`: writes a NUL after the token, as C does. */
function strtok_r(s: Uint8Array, start: number | null, st: { save: number }): number | null {
  let i = start ?? st.save;

  while ((s[i] ?? 0) !== 0 && DELIMS.includes(s[i]!)) i++;

  if ((s[i] ?? 0) === 0) {
    st.save = i;
    return null;
  }

  const tok = i;

  while ((s[i] ?? 0) !== 0 && !DELIMS.includes(s[i]!)) i++;

  if ((s[i] ?? 0) !== 0) {
    s[i] = 0;
    st.save = i + 1;
  } else {
    st.save = i;
  }

  return tok;
}

/**
 * `ReadDelimitedText( char* aDest, const char* aSource, int aDestSize )`, and
 * the unlimited `wxString*` form when aDestSize is 0: the text between the
 * first two `"`, `\"` and `\\` unescaped; the bytes consumed.
 */
function ReadDelimitedText(
  s: Uint8Array,
  p: number,
  aDestSize = 0,
): { text: Uint8Array; consumed: number } {
  const out: number[] = [];
  const limit = aDestSize > 0 ? aDestSize - 1 : Number.POSITIVE_INFINITY;
  let inside = false;
  let i = p;

  for (;;) {
    const cc0 = s[i] ?? 0;
    i++;

    // `( cc = *aSource++ ) != 0 && aDest < limit`: the byte is consumed even when
    // the limit test then ends the loop
    if (cc0 === 0 || !(out.length < limit)) break;

    let cc = cc0;

    if (cc === 0x22) {
      if (inside) break; // 2nd double quote is end of delimited text

      inside = true; // first delimiter found, make note, do not copy
    } else if (inside) {
      if (cc === 0x5c) {
        cc = s[i] ?? 0;
        i++;

        if (!cc) break;

        // do no copy the escape byte if it is followed by \ or "
        if (cc !== 0x22 && cc !== 0x5c) out.push(0x5c);

        if (out.length < limit) out.push(cc);
      } else {
        out.push(cc);
      }
    }
  }

  return { text: new Uint8Array(out), consumed: i - p };
}

/** `StrPurge( s + p )`: leading and trailing whitespace off (trailing overwritten with NULs). */
function StrPurge(s: Uint8Array, p: number): number {
  const ws = [0x20, 0x09, 0x0a, 0x0d, 0x0c, 0x0b];
  let t = p;

  while ((s[t] ?? 0) !== 0 && ws.includes(s[t]!)) ++t;

  let cp = cstrEnd(s, t) - 1;

  while (cp >= t && ws.includes(s[cp]!)) s[cp--] = 0;

  return t;
}

/**
 * `fast_float::from_chars( …, chars_format::skip_white_space )`: leading
 * white space skipped, then `[-]digits[.digits][(e|E)[+-]digits]` or
 * inf / infinity / nan, correctly rounded; null when nothing parses.
 */
function fastFloat(s: Uint8Array, p: number): { v: number; end: number } | null {
  let i = p;

  while (cIsspace(s[i] ?? 0) && (s[i] ?? 0) !== 0) i++;

  const start = i;
  let neg = false;

  if (s[i] === 0x2d) {
    neg = true;
    i++;
  }

  const rest = latin1(s, i).toLowerCase();

  for (const w of ['infinity', 'inf', 'nan']) {
    if (rest.startsWith(w)) {
      let end = i + w.length;

      if (w === 'nan' && s[end] === 0x28) {
        let k = end + 1;
        while (/[0-9a-z_]/i.test(String.fromCharCode(s[k] ?? 0)) && (s[k] ?? 0) !== 0) k++;
        if (s[k] === 0x29) end = k + 1;
      }

      const v = w === 'nan' ? Number.NaN : Number.POSITIVE_INFINITY;
      return { v: neg ? -v : v, end };
    }
  }

  const isD = (c: number | undefined): boolean => c !== undefined && c >= 0x30 && c <= 0x39;
  let digits = 0;

  while (isD(s[i])) {
    i++;
    digits++;
  }

  if (s[i] === 0x2e) {
    i++;

    while (isD(s[i])) {
      i++;
      digits++;
    }
  }

  if (digits === 0) return null;

  if (s[i] === 0x65 || s[i] === 0x45) {
    let k = i + 1;

    if (s[k] === 0x2b || s[k] === 0x2d) k++;

    if (isD(s[k])) {
      while (isD(s[k])) k++;
      i = k;
    }
  }

  const text = latin1(s, start).slice(0, i - start);

  return { v: Number(text), end: i };
}

/** `atof( s + p )`: strtod's prefix, 0 when none. */
function atof(s: Uint8Array, p: number): number {
  const r = strtodPrefix(latin1(s, p), 0);
  return r === null ? 0 : r.value;
}

function horizJustify(s: Uint8Array, p: number): GR_TEXT_H_ALIGN_T {
  if (streq(s, p, 'L')) return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;

  if (streq(s, p, 'R')) return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;

  return GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
}

function vertJustify(s: Uint8Array, p: number): GR_TEXT_V_ALIGN_T {
  if (streq(s, p, 'T')) return GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;

  if (streq(s, p, 'B')) return GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;

  return GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
}

export function layerMaskCountSet(aMask: number): number {
  let count = 0;
  let m = aMask >>> 0;

  while (m) {
    if (m & 1) ++count;

    m >>>= 1;
  }

  return count;
}

function is_leg_copperlayer_valid(aCu_Count: number, aLegacyLayerNum: number): boolean {
  return aLegacyLayerNum === LAYER_N_FRONT || aLegacyLayerNum < aCu_Count;
}

/** `KIID( char* )`: a null token is an empty string (a fresh id). */
const KIIDof = (s: Uint8Array, p: number | null): string =>
  kiidFromString(p === null ? '' : latin1(s, p));

/** `wxString( const char* )`: the locale conversion, UTF-8 here. */
const wxStr = (b: Uint8Array): string => fromUTF8(b);

/** One legacy footprint library held in memory (`LP_CACHE`). */
interface LP_CACHE {
  m_lib_path: string;
  m_footprints: Map<string, FOOTPRINT>;
  m_writable: boolean;
}

export class PCB_IO_KICAD_LEGACY extends PCB_IO {
  protected m_cu_count = 16; // for FootprintLoad()
  protected m_error = '';
  protected m_lastProgressLine = 0;
  protected m_lineCount = 0;
  protected m_reader: LINE_READER | null = null;
  protected m_loading_format_version = 0;
  protected m_cache: LP_CACHE | null = null;
  protected m_showLegacySegmentZoneWarning = true;
  protected m_netCodes: number[] = [];

  biuToDisk = 1.0;
  diskToBiu = 1.0;

  constructor() {
    super('KiCad-Legacy');

    this.init(null);
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    // upstream's own description text for the legacy board plugin
    return new IO_FILE_DESC('Eagle ver. 6.x XML PCB files', ['brd']);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Legacy footprint library files', ['mod', 'emp']);
  }

  static leg_layer2new(cu_count: number, aLayerNum: number): PCB_LAYER_ID {
    let newid: number;
    const old = aLayerNum >>> 0;

    if (old <= LAYER_N_FRONT) {
      if (old === LAYER_N_FRONT) {
        newid = F_Cu;
      } else if (old === LAYER_N_BACK) {
        newid = B_Cu;
      } else {
        newid = BoardLayerFromLegacyId(cu_count - 1 - old);

        if (newid < 0) newid = 0;
      }
    } else {
      switch (old) {
        case ADHESIVE_N_BACK:
          newid = B_Adhes;
          break;
        case ADHESIVE_N_FRONT:
          newid = F_Adhes;
          break;
        case SOLDERPASTE_N_BACK:
          newid = B_Paste;
          break;
        case SOLDERPASTE_N_FRONT:
          newid = F_Paste;
          break;
        case SILKSCREEN_N_BACK:
          newid = B_SilkS;
          break;
        case SILKSCREEN_N_FRONT:
          newid = F_SilkS;
          break;
        case SOLDERMASK_N_BACK:
          newid = B_Mask;
          break;
        case SOLDERMASK_N_FRONT:
          newid = F_Mask;
          break;
        case DRAW_N:
          newid = Dwgs_User;
          break;
        case COMMENT_N:
          newid = Cmts_User;
          break;
        case ECO1_N:
          newid = Eco1_User;
          break;
        case ECO2_N:
          newid = Eco2_User;
          break;
        case EDGE_N:
          newid = Edge_Cuts;
          break;
        default:
          newid = Cmts_User;
      }
    }

    return newid as PCB_LAYER_ID;
  }

  static leg_mask2new(cu_count: number, aMaskIn: number): LSET {
    let ret = new LSET();
    let aMask = aMaskIn >>> 0;

    if ((aMask & ALL_CU_LAYERS) === ALL_CU_LAYERS) {
      ret = new LSET(LSET.AllCuMask());
      aMask = (aMask & ~ALL_CU_LAYERS) >>> 0;
    }

    for (let i = 0; aMask; ++i, aMask >>>= 1) {
      if (aMask & 1) ret.set(PCB_IO_KICAD_LEGACY.leg_layer2new(cu_count, i));
    }

    return ret;
  }

  private checkpoint(): void {
    const PROGRESS_DELTA = 250;

    if (this.m_progressReporter && this.m_reader) {
      const curLine = this.m_reader.LineNumber();

      if (curLine > this.m_lastProgressLine + PROGRESS_DELTA) {
        this.m_progressReporter.SetCurrentProgress(curLine / Math.max(1, this.m_lineCount));

        if (!this.m_progressReporter.KeepRefreshing()) throw new IO_ERROR('Open canceled by user.');

        this.m_lastProgressLine = curLine;
      }
    }
  }

  private getNetCode(aNetCode: number): number {
    if (aNetCode >>> 0 < this.m_netCodes.length) return this.m_netCodes[aNetCode]!;

    return aNetCode;
  }

  private READLINE(): Uint8Array | null {
    return this.m_reader!.ReadLine();
  }

  private floatError(kind: 'Invalid' | 'Missing', s: Uint8Array, p: number): never {
    this.m_error = `${kind} floating point number in file: '${this.m_reader?.GetSource() ?? ''}'\nline: ${this.m_reader?.LineNumber() ?? 0}, offset: ${p + 1}`;
    throw new IO_ERROR(this.m_error);
  }

  /** `biuParse`: a number in the file's units, in BIU; where it stopped. */
  biuParse(s: Uint8Array, p: number): { v: number; end: number } {
    const r = fastFloat(s, p);

    if (r === null) this.floatError('Invalid', s, p);

    return { v: KiROUND(r.v * this.diskToBiu), end: r.end };
  }

  /** `degParse`: tenths of a degree. */
  degParse(s: Uint8Array, p: number): { v: EDA_ANGLE; end: number } {
    const r = fastFloat(s, p);

    if (r === null) this.floatError('Invalid', s, p);

    return { v: new EDA_ANGLE(r.v, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T), end: r.end };
  }

  private readerOf(aFileName: string): LINE_READER {
    const data = this.m_readFile(aFileName);

    if (!data) throw new IO_ERROR(`Unable to open file '${aFileName}'`);

    return new LINE_READER(data, aFileName);
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    try {
      PCB_IO_KICAD_LEGACY.getVersion(this.readerOf(aFileName));
    } catch (e) {
      if (e instanceof IO_ERROR) return false;
      throw e;
    }

    return true;
  }

  override CanReadFootprint(aFileName: string): boolean {
    if (!super.CanReadFootprint(aFileName)) return false;

    try {
      const freader = this.readerOf(aFileName);

      // WHITESPACE_FILTER_READER: blank lines and comments skipped, leading blanks off
      let first: Uint8Array | null = null;
      let offset = 0;

      for (let l = freader.ReadLine(); l !== null; l = freader.ReadLine()) {
        let k = 0;
        while (l[k] === 0x20 || l[k] === 0x09) k++;

        if (![0x23, 0x0a, 0x0d, 0].includes(l[k] ?? 0)) {
          first = l;
          offset = k;
          break;
        }
      }

      if (!first) return false;

      if (
        startsWithNoCase(
          first,
          offset,
          FOOTPRINT_LIBRARY_HEADER.slice(0, FOOTPRINT_LIBRARY_HEADER_CNT),
        )
      ) {
        for (let l = freader.ReadLine(); l !== null; l = freader.ReadLine()) {
          if (startsWithNoCase(l, offset, '$MODULE')) return true;
        }
      }
    } catch (e) {
      if (e instanceof IO_ERROR) return false;
      throw e;
    }

    return false;
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    this.init(aProperties);

    const board = aAppendToMe ?? new BOARD();
    this.m_board = board;

    if (!aAppendToMe) board.SetFileName(aFileName);

    const reader = this.readerOf(aFileName);
    this.m_reader = reader;

    this.m_loading_format_version = PCB_IO_KICAD_LEGACY.getVersion(reader);
    board.SetFileFormatVersionAtLoad(this.m_loading_format_version);

    if (this.m_progressReporter) {
      this.m_lineCount = 0;

      this.m_progressReporter.Report(`Loading ${aFileName}...`);

      if (!this.m_progressReporter.KeepRefreshing()) throw new IO_ERROR('Open canceled by user.');

      while (reader.ReadLine()) this.m_lineCount++;

      reader.Rewind();
    }

    this.loadAllSections(aAppendToMe !== null);

    this.m_progressReporter = null;
    return board;
  }

  private loadAllSections(doAppend: boolean): void {
    const board = this.m_board!;

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      this.checkpoint();

      if (TESTLINE(line, '$MODULE')) {
        const footprint = new FOOTPRINT(board);
        const fpid = new LIB_ID();
        let fpName = wxStr(cbytes(line, StrPurge(line, '$MODULE'.length)));
        fpName = ReplaceIllegalFileNameChars(fpName);

        if (fpName !== '') fpid.Parse(fpName, true);

        footprint.SetFPID(fpid);

        this.loadFOOTPRINT(footprint);
        board.Add(footprint, ADD_MODE.APPEND);
      } else if (TESTLINE(line, '$DRAWSEGMENT')) {
        this.loadPCB_LINE();
      } else if (TESTLINE(line, '$EQUIPOT')) {
        this.loadNETINFO_ITEM();
      } else if (TESTLINE(line, '$TEXTPCB')) {
        this.loadPCB_TEXT();
      } else if (TESTLINE(line, '$TRACK')) {
        this.loadTrackList(KICAD_T.PCB_TRACE_T);
      } else if (TESTLINE(line, '$NCLASS')) {
        this.loadNETCLASS();
      } else if (TESTLINE(line, '$CZONE_OUTLINE')) {
        this.loadZONE_CONTAINER();
      } else if (TESTLINE(line, '$COTATION')) {
        this.loadDIMENSION();
      } else if (TESTLINE(line, '$PCB_TARGET') || TESTLINE(line, '$MIREPCB')) {
        this.loadPCB_TARGET();
      } else if (TESTLINE(line, '$ZONE')) {
        this.loadTrackList(NOT_USED);
      } else if (TESTLINE(line, '$GENERAL')) {
        this.loadGENERAL();
      } else if (TESTLINE(line, '$SHEETDESCR')) {
        this.loadSHEET();
      } else if (TESTLINE(line, '$SETUP')) {
        if (!doAppend) {
          this.loadSETUP();
        } else {
          for (let l = this.READLINE(); l !== null; l = this.READLINE()) {
            if (TESTLINE(l, '$EndSETUP')) break;
          }
        }
      } else if (TESTLINE(line, '$EndBOARD')) {
        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$EndBOARD'");
  }

  static getVersion(aReader: LINE_READER): number {
    aReader.ReadLine();
    const line = aReader.Line();

    if (!TESTLINE(line, 'PCBNEW-BOARD')) throw new IO_ERROR('Unknown file type');

    let ver = 1; // if sccanf fails
    // sscanf( line, "PCBNEW-BOARD Version %d", &ver )
    const m = /^PCBNEW-BOARD[ \t\n\r\f\v]+Version[ \t\n\r\f\v]*([+-]?\d+)/.exec(latin1(line, 0));
    if (m) ver = Number.parseInt(m[1]!, 10) | 0;

    if (ver === 7) ver = 2;

    if (ver > LEGACY_BOARD_FILE_VERSION)
      throw new IO_ERROR(`File '${aReader.GetSource()}' has an unrecognized version: ${ver}.`);

    return ver;
  }

  private loadGENERAL(): void {
    const board = this.m_board!;
    let saw_LayerCount = false;

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, 'Units')) {
        const st = { save: 0 };
        const data = strtok_r(line, 'Units'.length, st);

        if (streq(line, data, 'mm')) this.diskToBiu = pcbIUScale.IU_PER_MM;
      } else if (TESTLINE(line, 'LayerCount')) {
        const tmp = intParse(line, 'LayerCount'.length).v;
        board.SetCopperLayerCount(tmp);
        this.m_cu_count = tmp;
        saw_LayerCount = true;
      } else if (TESTLINE(line, 'EnabledLayers')) {
        if (!saw_LayerCount) throw new IO_ERROR("Missing '$GENERAL's LayerCount");

        const enabledLayers = hexParse(line, 'EnabledLayers'.length).v;
        const new_mask = PCB_IO_KICAD_LEGACY.leg_mask2new(this.m_cu_count, enabledLayers);

        board.SetEnabledLayers(new_mask);
        board.SetVisibleLayers(new LSET(new_mask));

        board.SetCopperLayerCount(this.m_cu_count);
      } else if (TESTLINE(line, 'VisibleLayers')) {
        // #if 0 upstream
      } else if (TESTLINE(line, 'Ly')) {
        // Old format for Layer count
        if (!saw_LayerCount) {
          const layer_mask = hexParse(line, 'Ly'.length).v;

          this.m_cu_count = layerMaskCountSet(layer_mask & ALL_CU_LAYERS);
          board.SetCopperLayerCount(this.m_cu_count);

          saw_LayerCount = true;
        }
      } else if (TESTLINE(line, 'BoardThickness')) {
        const thickn = this.biuParse(line, 'BoardThickness'.length).v;
        board.GetDesignSettings().SetBoardThickness(thickn);
      } else if (TESTLINE(line, 'NoConn')) {
        intParse(line, 'NoConn'.length);
      } else if (TESTLINE(line, 'Di')) {
        let r = this.biuParse(line, 'Di'.length);
        r = this.biuParse(line, r.end);
        r = this.biuParse(line, r.end);
        this.biuParse(line, r.end);
      } else if (TESTLINE(line, 'Nnets')) {
        this.resizeNetCodes(intParse(line, 'Nnets'.length).v);
      } else if (TESTLINE(line, 'Nn')) {
        // id "Nnets" for old .brd files
        this.resizeNetCodes(intParse(line, 'Nn'.length).v);
      } else if (TESTLINE(line, '$EndGENERAL')) {
        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$EndGENERAL'");
  }

  /** `std::vector<int>::resize( n )`: new entries are 0. */
  private resizeNetCodes(n: number): void {
    const size = Math.max(0, n);

    if (this.m_netCodes.length > size) this.m_netCodes.length = size;
    else while (this.m_netCodes.length < size) this.m_netCodes.push(0);
  }

  private loadSHEET(): void {
    const board = this.m_board!;
    const tb = new TITLE_BLOCK();

    const text = (line: Uint8Array): string => wxStr(ReadDelimitedText(line, 0, 260).text);

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, 'Sheet')) {
        const page = new PAGE_INFO();
        const st = { save: 0 };
        const sname = strtok_r(line, 'Sheet'.length, st);

        if (sname !== null) {
          const wname = wxStr(cbytes(line, sname));

          if (!page.SetType(wname)) {
            this.m_error = `Unknown sheet type '${wname}' on line: ${this.m_reader!.LineNumber()}.`;
            throw new IO_ERROR(this.m_error);
          }

          const width = strtok_r(line, null, st);
          const height = strtok_r(line, null, st);
          const orient = strtok_r(line, null, st);

          if (page.GetType() === PAGE_SIZE_TYPE.User) {
            if (width !== null && height !== null) {
              const w = intParse(line, width).v;
              const h = intParse(line, height).v;
              page.SetWidthMils(w);
              page.SetHeightMils(h);
            }
          }

          if (orient !== null && streq(line, orient, 'portrait')) page.SetPortrait(true);

          board.SetPageSettings(page);
        }
      } else if (TESTLINE(line, 'Title')) {
        tb.SetTitle(text(line));
      } else if (TESTLINE(line, 'Date')) {
        tb.SetDate(text(line));
      } else if (TESTLINE(line, 'Rev')) {
        tb.SetRevision(text(line));
      } else if (TESTLINE(line, 'Comp')) {
        tb.SetCompany(text(line));
      } else if (
        TESTLINE(line, 'Comment1') ||
        TESTLINE(line, 'Comment2') ||
        TESTLINE(line, 'Comment3') ||
        TESTLINE(line, 'Comment4') ||
        TESTLINE(line, 'Comment5') ||
        TESTLINE(line, 'Comment6') ||
        TESTLINE(line, 'Comment7') ||
        TESTLINE(line, 'Comment8') ||
        TESTLINE(line, 'Comment9')
      ) {
        tb.SetComment(line[7]! - 0x31, text(line));
      } else if (TESTLINE(line, '$EndSHEETDESCR')) {
        board.SetTitleBlock(tb);
        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$EndSHEETDESCR'");
  }

  private loadSETUP(): void {
    const board = this.m_board!;
    const bds = board.GetDesignSettings();
    const zoneSettings = bds.GetDefaultZoneSettings().clone();
    const defaultNetclass = bds.m_NetSettings.GetDefaultNetclass();

    board.m_LegacyDesignSettingsLoaded = true;
    board.m_LegacyNetclassesLoaded = true;

    const biu = (line: Uint8Array, key: string): number => this.biuParse(line, key.length).v;
    const pair = (line: Uint8Array, key: string): VECTOR2I => {
      const x = this.biuParse(line, key.length);
      const y = this.biuParse(line, x.end).v;
      return { x: x.v, y };
    };

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, 'PcbPlotParams')) {
        const plot_opts = new PCB_PLOT_PARAMS();
        const parser = new PCB_PLOT_PARAMS_PARSER(
          new DSNLEXER(wxStr(cbytes(line, 'PcbPlotParams'.length)), this.m_reader!.GetSource()),
          0,
        );
        parser.Parse(plot_opts);

        board.SetPlotOptions(plot_opts);

        const tent = plot_opts.GetLegacyPlotViaOnMaskLayer();

        if (tent !== undefined && tent !== null) {
          board.GetDesignSettings().m_TentViasFront = tent;
          board.GetDesignSettings().m_TentViasBack = tent;
        }
      } else if (TESTLINE(line, 'AuxiliaryAxisOrg')) {
        bds.SetAuxOrigin(pair(line, 'AuxiliaryAxisOrg'));
      } else if (TESTSUBSTR(line, 'Layer[')) {
        const r = intParse(line, 'Layer['.length);
        const layer_id = PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, r.v);

        const st = { save: 0 };
        let data = strtok_r(line, r.end + 1, st); // +1 for ']'

        if (data !== null) {
          const layerName = wxStr(cbytes(line, data));
          board.SetLayerName(layer_id, layerName);

          data = strtok_r(line, null, st);

          if (data !== null) {
            // optional in old board files
            const type = LAYER.ParseType(latin1(line, data));
            board.SetLayerType(layer_id, type);
          }
        }
      } else if (TESTLINE(line, 'TrackWidth')) {
        defaultNetclass.SetTrackWidth(biu(line, 'TrackWidth'));
      } else if (TESTLINE(line, 'TrackWidthList')) {
        bds.m_TrackWidthList.push(biu(line, 'TrackWidthList'));
      } else if (TESTLINE(line, 'TrackClearence')) {
        defaultNetclass.SetClearance(biu(line, 'TrackClearence'));
      } else if (TESTLINE(line, 'TrackMinWidth')) {
        bds.m_TrackMinWidth = biu(line, 'TrackMinWidth');
      } else if (TESTLINE(line, 'ZoneClearence')) {
        zoneSettings.m_ZoneClearance = biu(line, 'ZoneClearence');
      } else if (TESTLINE(line, 'Zone_45_Only')) {
        // No longer used
        intParse(line, 'Zone_45_Only'.length);
      } else if (TESTLINE(line, 'DrawSegmWidth')) {
        bds.m_LineThickness[LAYER_CLASS.LAYER_CLASS_COPPER] = biu(line, 'DrawSegmWidth');
      } else if (TESTLINE(line, 'EdgeSegmWidth')) {
        bds.m_LineThickness[LAYER_CLASS.LAYER_CLASS_EDGES] = biu(line, 'EdgeSegmWidth');
      } else if (TESTLINE(line, 'ViaMinSize')) {
        bds.m_ViasMinSize = biu(line, 'ViaMinSize');
      } else if (TESTLINE(line, 'MicroViaMinSize')) {
        bds.m_MicroViasMinSize = biu(line, 'MicroViaMinSize');
      } else if (TESTLINE(line, 'ViaSizeList')) {
        let drill = 0;
        const d = this.biuParse(line, 'ViaSizeList'.length);
        const st = { save: 0 };
        const data = strtok_r(line, d.end, st);

        if (data !== null) drill = this.biuParse(line, data).v; // DRILL may not be present ?

        bds.m_ViasDimensionsList.push(new VIA_DIMENSION(d.v, drill));
      } else if (TESTLINE(line, 'ViaSize')) {
        defaultNetclass.SetViaDiameter(biu(line, 'ViaSize'));
      } else if (TESTLINE(line, 'ViaDrill')) {
        defaultNetclass.SetViaDrill(biu(line, 'ViaDrill'));
      } else if (TESTLINE(line, 'ViaMinDrill')) {
        bds.m_MinThroughDrill = biu(line, 'ViaMinDrill');
      } else if (TESTLINE(line, 'MicroViaSize')) {
        defaultNetclass.SetuViaDiameter(biu(line, 'MicroViaSize'));
      } else if (TESTLINE(line, 'MicroViaDrill')) {
        defaultNetclass.SetuViaDrill(biu(line, 'MicroViaDrill'));
      } else if (TESTLINE(line, 'MicroViaMinDrill')) {
        bds.m_MicroViasMinDrill = biu(line, 'MicroViaMinDrill');
      } else if (TESTLINE(line, 'MicroViasAllowed')) {
        intParse(line, 'MicroViasAllowed'.length);
      } else if (TESTLINE(line, 'TextPcbWidth')) {
        bds.m_TextThickness[LAYER_CLASS.LAYER_CLASS_COPPER] = biu(line, 'TextPcbWidth');
      } else if (TESTLINE(line, 'TextPcbSize')) {
        bds.m_TextSize[LAYER_CLASS.LAYER_CLASS_COPPER] = pair(line, 'TextPcbSize');
      } else if (TESTLINE(line, 'EdgeModWidth')) {
        const tmp = biu(line, 'EdgeModWidth');
        bds.m_LineThickness[LAYER_CLASS.LAYER_CLASS_SILK] = tmp;
        bds.m_LineThickness[LAYER_CLASS.LAYER_CLASS_OTHERS] = tmp;
      } else if (TESTLINE(line, 'TextModWidth')) {
        const tmp = biu(line, 'TextModWidth');
        bds.m_TextThickness[LAYER_CLASS.LAYER_CLASS_SILK] = tmp;
        bds.m_TextThickness[LAYER_CLASS.LAYER_CLASS_OTHERS] = tmp;
      } else if (TESTLINE(line, 'TextModSize')) {
        const sz = pair(line, 'TextModSize');
        bds.m_TextSize[LAYER_CLASS.LAYER_CLASS_SILK] = { ...sz };
        bds.m_TextSize[LAYER_CLASS.LAYER_CLASS_OTHERS] = { ...sz };
      } else if (TESTLINE(line, 'PadSize')) {
        bds.m_Pad_Master.SetSize(PADSTACK.ALL_LAYERS, pair(line, 'PadSize'));
      } else if (TESTLINE(line, 'PadDrill')) {
        const tmp = biu(line, 'PadDrill');
        bds.m_Pad_Master.SetDrillSize({ x: tmp, y: tmp });
      } else if (TESTLINE(line, 'Pad2MaskClearance')) {
        bds.m_SolderMaskExpansion = biu(line, 'Pad2MaskClearance');
      } else if (TESTLINE(line, 'SolderMaskMinWidth')) {
        bds.m_SolderMaskMinWidth = biu(line, 'SolderMaskMinWidth');
      } else if (TESTLINE(line, 'Pad2PasteClearance')) {
        bds.m_SolderPasteMargin = biu(line, 'Pad2PasteClearance');
      } else if (TESTLINE(line, 'Pad2PasteClearanceRatio')) {
        bds.m_SolderPasteMarginRatio = atof(line, 'Pad2PasteClearanceRatio'.length);
      } else if (TESTLINE(line, 'GridOrigin')) {
        bds.SetGridOrigin(pair(line, 'GridOrigin'));
      } else if (TESTLINE(line, 'VisibleElements')) {
        // #if 0 upstream
      } else if (TESTLINE(line, '$EndSETUP')) {
        bds.SetDefaultZoneSettings(zoneSettings);
        return; // preferred exit
      }
    }

    // Past the end of the file without $EndSETUP: upstream sorts and dedupes the lists here.
    const ds = board.GetDesignSettings();
    ds.m_ViasDimensionsList = [
      ...ds.m_ViasDimensionsList.slice(0, 1),
      ...ds.m_ViasDimensionsList.slice(1).sort((a, b) => (a.lt(b) ? -1 : b.lt(a) ? 1 : 0)),
    ];
    ds.m_TrackWidthList = [
      ...ds.m_TrackWidthList.slice(0, 1),
      ...ds.m_TrackWidthList.slice(1).sort((a, b) => a - b),
    ];

    for (let ii = 1; ii < ds.m_ViasDimensionsList.length - 1; ii++) {
      if (ds.m_ViasDimensionsList[ii]!.equals(ds.m_ViasDimensionsList[ii + 1]!)) {
        ds.m_ViasDimensionsList.splice(ii, 1);
        ii--;
      }
    }

    for (let ii = 1; ii < ds.m_TrackWidthList.length - 1; ii++) {
      if (ds.m_TrackWidthList[ii] === ds.m_TrackWidthList[ii + 1]) {
        ds.m_TrackWidthList.splice(ii, 1);
        ii--;
      }
    }
  }

  protected loadFOOTPRINT(aFootprint: FOOTPRINT): void {
    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTSUBSTR(line, 'D') && [0x53, 0x43, 0x41, 0x50, 0].includes(line[1] ?? 0)) {
        // read a drawing item, e.g. "DS"
        this.loadFP_SHAPE(aFootprint);
      } else if (TESTLINE(line, '$PAD')) {
        this.loadPAD(aFootprint);
      } else if (TESTSUBSTR(line, 'T')) {
        // Read a footprint text description (ref, value, or drawing)
        const tnum = intParse(line, 1).v;
        let text: PCB_TEXT;

        switch (tnum) {
          case PCB_LEGACY_TEXT_is_REFERENCE:
            text = aFootprint.Reference();
            break;
          case PCB_LEGACY_TEXT_is_VALUE:
            text = aFootprint.Value();
            break;
          default:
            text = new PCB_TEXT(aFootprint);
            aFootprint.Add(text);
        }

        this.loadMODULE_TEXT(text);

        if (!text.IsVisible() && text.Type() === KICAD_T.PCB_TEXT_T) {
          aFootprint.Remove(text);
          aFootprint.Add(new PCB_FIELD(text, FIELD_T.USER));
        }
      } else if (TESTLINE(line, 'Po')) {
        const pos_x = this.biuParse(line, 'Po'.length);
        const pos_y = this.biuParse(line, pos_x.end);
        const orient = intParse(line, pos_y.end);
        const layer_num = intParse(line, orient.end);
        const layer_id = PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer_num.v);
        const edittime = hexParse(line, layer_num.end);
        const st = { save: 0 };
        const uuid = strtok_r(line, edittime.end, st);
        const data = strtok_r(line, st.save + 1, st);

        if (data !== null && line[data] === 0x46) aFootprint.SetLocked(true); // 'F'

        if (data !== null && line[data + 1] === 0x50) aFootprint.SetIsPlaced(true); // 'P'

        aFootprint.SetPosition({ x: pos_x.v, y: pos_y.v });
        aFootprint.SetLayer(layer_id);
        aFootprint.SetOrientation(new EDA_ANGLE(orient.v, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T));
        aFootprint.SetUuidDirect(KIIDof(line, uuid));
      } else if (TESTLINE(line, 'Sc')) {
        // timestamp
        const st = { save: 0 };
        const uuid = strtok_r(line, 'Sc'.length, st);
        aFootprint.SetUuidDirect(KIIDof(line, uuid));
      } else if (TESTLINE(line, 'Op')) {
        // (Op)tions for auto placement (no longer supported)
        const r = hexParse(line, 'Op'.length);
        hexParse(line, r.end);
      } else if (TESTLINE(line, 'At')) {
        // (At)tributes of footprint
        let attrs = 0;
        const data = latin1(line, 'At'.length);

        if (data.includes('SMD')) attrs |= FP_SMD;
        else if (data.includes('VIRTUAL')) attrs |= FP_EXCLUDE_FROM_POS_FILES | FP_EXCLUDE_FROM_BOM;
        else attrs |= FP_THROUGH_HOLE | FP_EXCLUDE_FROM_POS_FILES;

        aFootprint.SetAttributes(attrs);
      } else if (TESTLINE(line, 'AR')) {
        // Alternate Reference
        const st = { save: 0 };
        const data = strtok_r(line, 'AR'.length, st);

        if (data !== null) aFootprint.SetPath(kiidPathFromString(wxStr(cbytes(line, data))));
      } else if (TESTLINE(line, '$SHAPE3D')) {
        this.load3D(aFootprint);
      } else if (TESTLINE(line, 'Cd')) {
        aFootprint.SetLibDescription(wxStr(cbytes(line, StrPurge(line, 'Cd'.length))));
      } else if (TESTLINE(line, 'Kw')) {
        // Key words
        aFootprint.SetKeywords(wxStr(cbytes(line, StrPurge(line, 'Kw'.length))));
      } else if (TESTLINE(line, '.SolderPasteRatio')) {
        let tmp = atof(line, '.SolderPasteRatio'.length);

        // Due to a bug in dialog editor in Modedit, fixed in BZR version 3565
        // this parameter can be broken.
        // It should be >= -50% (no solder paste) and <= 0% (full area of the pad)

        if (tmp < -0.5) tmp = -0.5;

        if (tmp > 0.0) tmp = 0.0;

        aFootprint.SetLocalSolderPasteMarginRatio(tmp);
      } else if (TESTLINE(line, '.SolderPaste')) {
        aFootprint.SetLocalSolderPasteMargin(this.biuParse(line, '.SolderPaste'.length).v);
      } else if (TESTLINE(line, '.SolderMask')) {
        aFootprint.SetLocalSolderMaskMargin(this.biuParse(line, '.SolderMask'.length).v);
      } else if (TESTLINE(line, '.LocalClearance')) {
        aFootprint.SetLocalClearance(this.biuParse(line, '.LocalClearance'.length).v);
      } else if (TESTLINE(line, '.ZoneConnection')) {
        const tmp = intParse(line, '.ZoneConnection'.length).v;
        aFootprint.SetLocalZoneConnection(tmp as ZONE_CONNECTION);
      } else if (TESTLINE(line, '.ThermalWidth')) {
        this.biuParse(line, '.ThermalWidth'.length);
      } else if (TESTLINE(line, '.ThermalGap')) {
        this.biuParse(line, '.ThermalGap'.length);
      } else if (TESTLINE(line, '$EndMODULE')) {
        return; // preferred exit
      }
    }

    throw new IO_ERROR(
      `Missing '$EndMODULE' for MODULE '${aFootprint.GetFPID().GetLibItemName()}'.`,
    );
  }

  private loadPAD(aFootprint: FOOTPRINT): void {
    const pad = new PAD(aFootprint);

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, 'Sh')) {
        // (Sh)ape and padname
        let data = 'Sh'.length + 1; // +1 skips trailing whitespace
        const rd = ReadDelimitedText(line, data, 50);
        data = data + rd.consumed + 1;

        while (isSpace(line[data] ?? 0) && (line[data] ?? 0) !== 0) ++data;

        const padchar = line[data] ?? 0;
        data++;
        let padshape: PAD_SHAPE;

        const size_x = this.biuParse(line, data);
        const size_y = this.biuParse(line, size_x.end);
        const delta_x = this.biuParse(line, size_y.end);
        const delta_y = this.biuParse(line, delta_x.end);
        const orient = this.degParse(line, delta_y.end).v;

        switch (padchar) {
          case 0x43: // 'C'
            padshape = PAD_SHAPE.CIRCLE;
            break;
          case 0x52: // 'R'
            padshape = PAD_SHAPE.RECTANGLE;
            break;
          case 0x4f: // 'O'
            padshape = PAD_SHAPE.OVAL;
            break;
          case 0x54: // 'T'
            padshape = PAD_SHAPE.TRAPEZOID;
            break;
          default:
            this.m_error = `Unknown padshape '${String.fromCharCode(padchar)}=0x${padchar.toString(16).padStart(2, '0')}' on line: ${this.m_reader!.LineNumber()} of footprint: '${aFootprint.GetFPID().GetLibItemName()}'.`;
            throw new IO_ERROR(this.m_error);
        }

        let padNumber: string;

        if (this.m_loading_format_version === 1) {
          // unsigned, ls 8 bits only
          padNumber = '';
          for (const b of rd.text) padNumber += String.fromCharCode(b);
        } else {
          padNumber = fromUTF8(rd.text);
        }

        pad.SetNumber(padNumber);
        pad.SetShape(PADSTACK.ALL_LAYERS, padshape);
        pad.SetSize(PADSTACK.ALL_LAYERS, { x: size_x.v, y: size_y.v });
        pad.SetDelta(PADSTACK.ALL_LAYERS, { x: delta_x.v, y: delta_y.v });
        pad.SetOrientation(orient);
      } else if (TESTLINE(line, 'Dr')) {
        // (Dr)ill
        const dx = this.biuParse(line, 'Dr'.length);
        let drill_x = dx.v;
        let drill_y = drill_x;
        const offs_x = this.biuParse(line, dx.end);
        const offs_y = this.biuParse(line, offs_x.end);

        let drShape = PAD_DRILL_SHAPE.CIRCLE;

        const st = { save: 0 };
        let data = strtok_r(line, offs_y.end, st);

        if (data !== null) {
          // optional shape
          if (line[data] === 0x4f) {
            drShape = PAD_DRILL_SHAPE.OBLONG;
            data = strtok_r(line, null, st);
            drill_x = this.biuParse(line, data ?? cstrEnd(line, 0)).v;
            data = strtok_r(line, null, st);
            drill_y = this.biuParse(line, data ?? cstrEnd(line, 0)).v;
          }
        }

        pad.SetDrillShape(drShape);
        pad.SetOffset(PADSTACK.ALL_LAYERS, { x: offs_x.v, y: offs_y.v });
        pad.SetDrillSize({ x: drill_x, y: drill_y });
      } else if (TESTLINE(line, 'At')) {
        // (At)tribute
        let attribute: PAD_ATTRIB;
        const st = { save: 0 };
        let data = strtok_r(line, 'At'.length, st);

        if (streq(line, data, 'SMD')) attribute = PAD_ATTRIB.SMD;
        else if (streq(line, data, 'CONN')) attribute = PAD_ATTRIB.CONN;
        else if (streq(line, data, 'HOLE')) attribute = PAD_ATTRIB.NPTH;
        else attribute = PAD_ATTRIB.PTH;

        strtok_r(line, null, st); // skip unused prm
        data = strtok_r(line, null, st);

        const layer_mask = hexParse(line, data ?? cstrEnd(line, 0)).v;

        pad.SetLayerSet(PCB_IO_KICAD_LEGACY.leg_mask2new(this.m_cu_count, layer_mask));
        pad.SetAttribute(attribute);
      } else if (TESTLINE(line, 'Ne')) {
        // (Ne)tname
        const netcode = intParse(line, 'Ne'.length).v;

        // Store the new code mapping
        pad.SetNetCode(this.getNetCode(netcode));
      } else if (TESTLINE(line, 'Po')) {
        // (Po)sition
        const x = this.biuParse(line, 'Po'.length);
        const y = this.biuParse(line, x.end);
        pad.SetFPRelativePosition({ x: x.v, y: y.v });
      } else if (TESTLINE(line, 'Le')) {
        pad.SetPadToDieLength(this.biuParse(line, 'Le'.length).v);
      } else if (TESTLINE(line, '.SolderMask')) {
        pad.SetLocalSolderMaskMargin(this.biuParse(line, '.SolderMask'.length).v);
      } else if (TESTLINE(line, '.SolderPasteRatio')) {
        pad.SetLocalSolderPasteMarginRatio(atof(line, '.SolderPasteRatio'.length));
      } else if (TESTLINE(line, '.SolderPaste')) {
        pad.SetLocalSolderPasteMargin(this.biuParse(line, '.SolderPaste'.length).v);
      } else if (TESTLINE(line, '.LocalClearance')) {
        pad.SetLocalClearance(this.biuParse(line, '.LocalClearance'.length).v);
      } else if (TESTLINE(line, '.ZoneConnection')) {
        const tmp = intParse(line, '.ZoneConnection'.length).v;
        pad.SetLocalZoneConnection(tmp as ZONE_CONNECTION);
      } else if (TESTLINE(line, '.ThermalWidth')) {
        pad.SetLocalThermalSpokeWidthOverride(this.biuParse(line, '.ThermalWidth'.length).v);
      } else if (TESTLINE(line, '.ThermalGap')) {
        pad.SetLocalThermalGapOverride(this.biuParse(line, '.ThermalGap'.length).v);
      } else if (TESTLINE(line, '$EndPAD')) {
        if (pad.GetSizeX() > 0 && pad.GetSizeY() > 0) {
          aFootprint.Add(pad);
        } else {
          this.Report(`Invalid zero-sized pad ignored in\nfile: ${this.m_reader!.GetSource()}`);
        }

        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$EndPAD'");
  }

  private loadFP_SHAPE(aFootprint: FOOTPRINT): void {
    let shape: SHAPE_T;
    let line = this.m_reader!.Line(); // obtain current (old) line

    switch (line[1]) {
      case 0x53: // 'S'
        shape = SHAPE_T.SEGMENT;
        break;
      case 0x43: // 'C'
        shape = SHAPE_T.CIRCLE;
        break;
      case 0x41: // 'A'
        shape = SHAPE_T.ARC;
        break;
      case 0x50: // 'P'
        shape = SHAPE_T.POLY;
        break;
      default:
        this.m_error = `Unknown PCB_SHAPE type:'${String.fromCharCode(line[1] ?? 0)}=0x${(line[1] ?? 0).toString(16).padStart(2, '0')}' on line ${this.m_reader!.LineNumber()} of footprint '${aFootprint.GetFPID().GetLibItemName()}'.`;
        throw new IO_ERROR(this.m_error);
    }

    const dwg = new PCB_SHAPE(aFootprint, shape); // a drawing

    let width = 1;
    let layer = FIRST_NON_COPPER_LAYER;

    switch (shape) {
      case SHAPE_T.ARC: {
        const center0_x = this.biuParse(line, 'DA'.length);
        const center0_y = this.biuParse(line, center0_x.end);
        const start0_x = this.biuParse(line, center0_y.end);
        const start0_y = this.biuParse(line, start0_x.end);
        const angle = this.degParse(line, start0_y.end);
        const w = this.biuParse(line, angle.end);
        width = w.v;
        layer = intParse(line, w.end).v;

        dwg.SetCenter({ x: center0_x.v, y: center0_y.v });
        dwg.SetStart({ x: start0_x.v, y: start0_y.v });

        // Setting angle will set m_endPoint, so must be done after setting m_start
        dwg.SetArcAngleAndEnd(angle.v, true);
        break;
      }

      case SHAPE_T.SEGMENT:
      case SHAPE_T.CIRCLE: {
        // e.g. "DS -7874 -10630 7874 -10630 50 20\r\n"
        const start0_x = this.biuParse(line, 'DS'.length);
        const start0_y = this.biuParse(line, start0_x.end);
        const end0_x = this.biuParse(line, start0_y.end);
        const end0_y = this.biuParse(line, end0_x.end);
        const w = this.biuParse(line, end0_y.end);
        width = w.v;
        layer = intParse(line, w.end).v;

        dwg.SetStart({ x: start0_x.v, y: start0_y.v });
        dwg.SetEnd({ x: end0_x.v, y: end0_y.v });
        break;
      }

      case SHAPE_T.POLY: {
        // e.g. "DP %d %d %d %d %d %d %d\n"
        const start0_x = this.biuParse(line, 'DP'.length);
        const start0_y = this.biuParse(line, start0_x.end);
        const end0_x = this.biuParse(line, start0_y.end);
        const end0_y = this.biuParse(line, end0_x.end);
        const ptCount = intParse(line, end0_y.end);
        const w = this.biuParse(line, ptCount.end);
        width = w.v;
        layer = intParse(line, w.end).v;

        dwg.SetStart({ x: start0_x.v, y: start0_y.v });
        dwg.SetEnd({ x: end0_x.v, y: end0_y.v });

        const pts: VECTOR2I[] = [];

        for (let ii = 0; ii < ptCount.v; ++ii) {
          const l = this.READLINE();

          if (l === null) throw new IO_ERROR('S_POLGON point count mismatch.');

          line = l;

          // e.g. "Dl 23 44\n"

          if (!TESTLINE(line, 'Dl')) throw new IO_ERROR('Missing Dl point def');

          const x = this.biuParse(line, 'Dl'.length);
          const y = this.biuParse(line, x.end).v;

          pts.push({ x: x.v, y });
        }

        dwg.SetPolyPoints(pts);
        break;
      }

      default:
        // first switch code above prevents us from getting here.
        break;
    }

    // Check for a reasonable layer:
    // layer must be >= FIRST_NON_COPPER_LAYER, but because microwave footprints can use the
    // copper layers, layer < FIRST_NON_COPPER_LAYER is allowed.
    if (layer < FIRST_LAYER || layer > LAST_NON_COPPER_LAYER) layer = SILKSCREEN_N_FRONT;

    dwg.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
    dwg.SetLayer(PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer));

    dwg.Rotate({ x: 0, y: 0 }, aFootprint.GetOrientation());
    dwg.Move(aFootprint.GetPosition());
    aFootprint.Add(dwg);
  }

  private loadMODULE_TEXT(aText: PCB_TEXT): void {
    const line = this.m_reader!.Line(); // current (old) line

    // sscanf( line + 1, "%d %d %d %d %d %d %d %s %s %d %s",
    //         &type, &m_Pos0.x, &m_Pos0.y, &m_Size.y, &m_Size.x,
    //         &m_Orient, &m_Thickness, BufCar1, BufCar2, &layer, BufCar3 ) >= 10 )

    // e.g. "T1 6940 -16220 350 300 900 60 M I 20 N "CFCARD"\r\n"
    // or    T1 0 500 600 400 900 80 M V 20 N"74LS245"
    // ouch, the last example has no space between N and "74LS245" !
    // that is an older version.

    let type = intParse(line, 1);
    const pos0_x = this.biuParse(line, type.end);
    const pos0_y = this.biuParse(line, pos0_x.end);
    const size0_y = this.biuParse(line, pos0_y.end);
    const size0_x = this.biuParse(line, size0_y.end);
    const orient = this.degParse(line, size0_x.end);
    const thickn = this.biuParse(line, orient.end);
    let data = thickn.end;

    // read the quoted text before the first call to strtok() which introduces
    // NULs into the string and chops it into multiple C strings, something
    // ReadDelimitedText() cannot traverse.

    // convert the "quoted, escaped, UTF8, text" to a wxString, find it by skipping
    // as far forward as needed until the first double quote.
    const rd = ReadDelimitedText(line, data);
    const txt_end = data + rd.consumed;
    let field = wxStr(rd.text);
    field = field.replaceAll('%V', '${VALUE}');
    field = field.replaceAll('%R', '${REFERENCE}');
    field = convertToNewOverbarNotation(field);
    aText.SetText(field);

    // after switching to strtok, there's no easy coming back because of the
    // embedded nul(s?) placed to the right of the current field.
    // (that's the reason why strtok was deprecated...)
    const st = { save: data };
    const mirror = strtok_r(line, data, st);
    const hide = strtok_r(line, null, st);
    const tmp = strtok_r(line, null, st);

    let layer_num = tmp !== null ? intParse(line, tmp).v : SILKSCREEN_N_FRONT;

    const italic = strtok_r(line, null, st);

    const hjust = strtok_r(line, txt_end, st);
    const vjust = strtok_r(line, null, st);
    data = st.save;

    let t = type.v;

    if (t !== PCB_LEGACY_TEXT_is_REFERENCE && t !== PCB_LEGACY_TEXT_is_VALUE)
      t = PCB_LEGACY_TEXT_is_DIVERS;

    type = { v: t, end: type.end };

    aText.SetFPRelativePosition({ x: pos0_x.v, y: pos0_y.v });
    aText.SetTextSize({ x: size0_x.v, y: size0_y.v });

    aText.SetTextAngle(orient.v);

    aText.SetTextThickness(thickn.v < 1 ? 0 : thickn.v);

    aText.SetMirrored(mirror !== null && line[mirror] === 0x4d); // 'M'

    aText.SetVisible(!(hide !== null && line[hide] === 0x49)); // 'I'

    aText.SetItalic(italic !== null && line[italic] === 0x49);

    if (hjust !== null) aText.SetHorizJustify(horizJustify(line, hjust));

    if (vjust !== null) aText.SetVertJustify(vertJustify(line, vjust));

    // A protection against mal formed (or edited by hand) files:
    if (layer_num < FIRST_LAYER) layer_num = FIRST_LAYER;
    else if (layer_num > LAST_NON_COPPER_LAYER) layer_num = LAST_NON_COPPER_LAYER;
    else if (layer_num === LAYER_N_BACK) layer_num = SILKSCREEN_N_BACK;
    else if (layer_num === LAYER_N_FRONT) layer_num = SILKSCREEN_N_FRONT;
    else if (layer_num < LAYER_N_FRONT)
      // this case is a internal layer
      layer_num = SILKSCREEN_N_FRONT;

    aText.SetLayer(PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer_num));
  }

  private load3D(aFootprint: FOOTPRINT): void {
    const t3D = new FP_3DMODEL();

    // wxString( str ).Trim().Trim( false ), wxStringTokenizer( " \t", wxTOKEN_STRTOK ),
    // three tokens each wholly a number
    const parseThreeDoubles = (s: Uint8Array, p: number): [number, number, number] | null => {
      const toks = wxStr(cbytes(s, p))
        .trim()
        .split(/[ \t]+/)
        .filter((x) => x !== '');

      if (toks.length < 3) return null;

      const out: number[] = [];

      for (const t of toks.slice(0, 3)) {
        if (!ToCDoubleOk(t)) return null;
        out.push(strtodPrefix(t, 0)!.value);
      }

      return [out[0]!, out[1]!, out[2]!];
    };

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, 'Na')) {
        // Shape File Name
        t3D.m_Filename = wxStr(ReadDelimitedText(line, 'Na'.length, 512).text);
      } else if (TESTLINE(line, 'Sc')) {
        // Scale
        const v = parseThreeDoubles(line, 'Sc'.length);
        if (!v) throw new IO_ERROR('Invalid scale values in 3D model');
        t3D.m_Scale = { x: v[0], y: v[1], z: v[2] };
      } else if (TESTLINE(line, 'Of')) {
        // Offset
        const v = parseThreeDoubles(line, 'Of'.length);
        if (!v) throw new IO_ERROR('Invalid offset values in 3D model');
        t3D.m_Offset = { x: v[0], y: v[1], z: v[2] };
      } else if (TESTLINE(line, 'Ro')) {
        // Rotation
        const v = parseThreeDoubles(line, 'Ro'.length);
        if (!v) throw new IO_ERROR('Invalid rotation values in 3D model');
        t3D.m_Rotation = { x: v[0], y: v[1], z: v[2] };
      } else if (TESTLINE(line, '$EndSHAPE3D')) {
        aFootprint.Models().push(t3D);
        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$EndSHAPE3D'");
  }

  private loadPCB_LINE(): void {
    const board = this.m_board!;
    const dseg = new PCB_SHAPE(board);

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, 'Po')) {
        const shape = intParse(line, 'Po'.length);
        const start_x = this.biuParse(line, shape.end);
        const start_y = this.biuParse(line, start_x.end);
        const end_x = this.biuParse(line, start_y.end);
        const end_y = this.biuParse(line, end_x.end);
        let width = this.biuParse(line, end_y.end).v;

        if (width < 0) width = 0;

        dseg.SetShape(shape.v as SHAPE_T);
        dseg.SetFilled(false);
        dseg.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));

        if (dseg.GetShape() === SHAPE_T.ARC) {
          dseg.SetCenter({ x: start_x.v, y: start_y.v });
          dseg.SetStart({ x: end_x.v, y: end_y.v });
        } else {
          dseg.SetStart({ x: start_x.v, y: start_y.v });
          dseg.SetEnd({ x: end_x.v, y: end_y.v });
        }
      } else if (TESTLINE(line, 'De')) {
        let x = 0;
        let y: number;

        const st = { save: 0 };
        let data = strtok_r(line, 'De'.length, st);

        for (let i = 0; data !== null; ++i, data = strtok_r(line, null, st)) {
          switch (i) {
            case 0: {
              let layer = intParse(line, data).v;

              if (layer < FIRST_NON_COPPER_LAYER) layer = FIRST_NON_COPPER_LAYER;
              else if (layer > LAST_NON_COPPER_LAYER) layer = LAST_NON_COPPER_LAYER;

              dseg.SetLayer(PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer));
              break;
            }
            case 1:
              intParse(line, data);
              break;
            case 2: {
              const angle = this.degParse(line, data).v;

              if (dseg.GetShape() === SHAPE_T.ARC) dseg.SetArcAngleAndEnd(angle);

              break;
            }
            case 3:
              dseg.SetUuidDirect(KIIDof(line, data));
              break;
            case 4:
              hexParse(line, data);
              break;
            case 5:
              x = this.biuParse(line, data).v;
              break;
            case 6:
              y = this.biuParse(line, data).v;
              dseg.SetBezierC1({ x, y });
              break;
            case 7:
              x = this.biuParse(line, data).v;
              break;
            case 8:
              y = this.biuParse(line, data).v;
              dseg.SetBezierC2({ x, y });
              break;
            default:
              break;
          }
        }
      } else if (TESTLINE(line, '$EndDRAWSEGMENT')) {
        board.Add(dseg, ADD_MODE.APPEND);
        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$EndDRAWSEGMENT'");
  }

  private loadNETINFO_ITEM(): void {
    const board = this.m_board!;
    let net: NETINFO_ITEM | null = null;
    let netCode = 0;

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, 'Na')) {
        // e.g. "Na 58 "/cpu.sch/PAD7"\r\n"
        const r = intParse(line, 'Na'.length);
        netCode = r.v;
        const buf = ReadDelimitedText(line, r.end, 1024).text;

        if (net === null) {
          net = new NETINFO_ITEM(board, convertToNewOverbarNotation(wxStr(buf)), netCode);
        } else {
          throw new IO_ERROR("Two net definitions in  '$EQUIPOT' block");
        }
      } else if (TESTLINE(line, '$EndEQUIPOT')) {
        // net 0 should be already in list, so store this net
        // if it is not the net 0, or if the net 0 does not exists.
        // (TODO: a better test.)
        if (net && (net.GetNetCode() > 0 || board.FindNet(0) === null)) {
          board.Add(net);

          // Be sure we have room to store the net in m_netCodes
          if (this.m_netCodes.length <= netCode) this.resizeNetCodes(netCode + 1);

          this.m_netCodes[netCode] = net.GetNetCode();
          net = null;
        } else {
          net = null; // Avoid double deletion.
        }

        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$EndEQUIPOT'");
  }

  private loadPCB_TEXT(): void {
    const board = this.m_board!;
    const pcbtxt = new PCB_TEXT(board);
    board.Add(pcbtxt, ADD_MODE.APPEND);

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, 'Te')) {
        // Text line (or first line for multi line texts)
        const text = ReadDelimitedText(line, 'Te'.length, 1024).text;
        pcbtxt.SetText(convertToNewOverbarNotation(wxStr(text)));
      } else if (TESTLINE(line, 'nl')) {
        // next line of the current text
        const text = ReadDelimitedText(line, 'nl'.length, 1024).text;
        pcbtxt.SetText(`${pcbtxt.GetText()}\n${wxStr(text)}`);
      } else if (TESTLINE(line, 'Po')) {
        const pos_x = this.biuParse(line, 'Po'.length);
        const pos_y = this.biuParse(line, pos_x.end);
        const sx = this.biuParse(line, pos_y.end);
        const sy = this.biuParse(line, sx.end);
        const thickn = this.biuParse(line, sy.end);
        const angle = this.degParse(line, thickn.end).v;

        pcbtxt.SetTextSize({ x: sx.v, y: sy.v });
        pcbtxt.SetTextThickness(thickn.v);
        pcbtxt.SetTextAngle(angle);

        pcbtxt.SetTextPos({ x: pos_x.v, y: pos_y.v });
      } else if (TESTLINE(line, 'De')) {
        // e.g. "De 21 1 68183921-93a5-49ac-91b0-49d05a0e1647 Normal C\r\n"
        const layer = intParse(line, 'De'.length);
        let layer_num = layer.v;
        const notMirrored = intParse(line, layer.end);
        const st = { save: 0 };
        const uuid = strtok_r(line, notMirrored.end, st);
        const style = strtok_r(line, null, st);
        const hJustify = strtok_r(line, null, st);
        const vJustify = strtok_r(line, null, st);

        pcbtxt.SetMirrored(!notMirrored.v);
        pcbtxt.SetUuidDirect(KIIDof(line, uuid));
        pcbtxt.SetItalic(streq(line, style, 'Italic'));

        if (hJustify !== null) pcbtxt.SetHorizJustify(horizJustify(line, hJustify));

        if (vJustify !== null) pcbtxt.SetVertJustify(vertJustify(line, vJustify));

        if (layer_num < FIRST_COPPER_LAYER) layer_num = FIRST_COPPER_LAYER;
        else if (layer_num > LAST_NON_COPPER_LAYER) layer_num = LAST_NON_COPPER_LAYER;

        if (
          layer_num >= FIRST_NON_COPPER_LAYER ||
          is_leg_copperlayer_valid(this.m_cu_count, layer_num)
        )
          pcbtxt.SetLayer(PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer_num));
        // not perfect, but putting this text on front layer is a workaround
        else pcbtxt.SetLayer(F_Cu);
      } else if (TESTLINE(line, '$EndTEXTPCB')) {
        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$EndTEXTPCB'");
  }

  private loadTrackList(aStructType: number): void {
    const board = this.m_board!;

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      this.checkpoint();

      // read two lines per loop iteration, each loop is one TRACK or VIA
      // example first line:
      // e.g. "Po 0 23994 28800 24400 28800 150 -1" for a track
      // e.g. "Po 3 21086 17586 21086 17586 180 -1" for a via (uses sames start and end)

      if (line[0] === 0x24)
        // $EndTRACK
        return; // preferred exit

      const legacy_viatype = intParse(line, 'Po'.length);
      const start_x = this.biuParse(line, legacy_viatype.end);
      const start_y = this.biuParse(line, start_x.end);
      const end_x = this.biuParse(line, start_y.end);
      const end_y = this.biuParse(line, end_x.end);
      const width = this.biuParse(line, end_y.end);

      // optional 7th drill parameter (must be optional in an old format?)
      const st = { save: 0 };
      const data = strtok_r(line, width.end, st);

      const drill = data !== null ? this.biuParse(line, data).v : -1; // SetDefault() if < 0

      // Read the 2nd line to determine the exact type, one of:
      // PCB_TRACE_T, PCB_VIA_T, or PCB_SEGZONE_T.  The type field in 2nd line
      // differentiates between PCB_TRACE_T and PCB_VIA_T.  With virtual
      // functions in use, it is critical to instantiate the PCB_VIA_T
      // exactly.
      this.READLINE();

      const line2 = this.m_reader!.Line();

      // e.g. "De 15 1 7 68183921-93a5-49ac-91b0-49d05a0e1647 0" for a via
      // e.g. "De 15 0 7 68183921-93a5-49ac-91b0-49d05a0e1647 0" for a track
      // example second line:
      // e.g. "De 0 0 463 0 800000\r\n"

      const layer = intParse(line2, 'De'.length);
      const layer_num = layer.v;
      const type = intParse(line2, layer.end);
      const net_code = intParse(line2, type.end);
      const st2 = { save: 0 };
      const uuid = strtok_r(line2, net_code.end, st2);
      intParse(line2, st2.save);

      let makeType: number;

      if (aStructType === KICAD_T.PCB_TRACE_T) {
        makeType = type.v === 1 ? KICAD_T.PCB_VIA_T : KICAD_T.PCB_TRACE_T;
      } else if (aStructType === NOT_USED) {
        continue;
      } else {
        continue;
      }

      let newTrack: PCB_TRACK | null = null;
      let newVia: PCB_VIA | null = null;

      if (makeType === KICAD_T.PCB_VIA_T) newVia = new PCB_VIA(board);
      else newTrack = new PCB_TRACK(board);

      if (newVia) {
        // Ensure layers are OK when possible:
        let viatype = VIATYPE.THROUGH;

        if (legacy_viatype.v === 1) viatype = VIATYPE.MICROVIA;
        else if (legacy_viatype.v === 2) viatype = VIATYPE.BLIND;

        newVia.SetViaType(viatype);
        newVia.SetWidth(PADSTACK.ALL_LAYERS, width.v);
        newVia.SetUuidDirect(KIIDof(line2, uuid));
        newVia.SetPosition({ x: start_x.v, y: start_y.v });
        newVia.SetEnd({ x: end_x.v, y: end_y.v });

        if (drill < 0) newVia.SetDrillDefault();
        else newVia.SetDrill(drill);

        if (newVia.GetViaType() === VIATYPE.THROUGH) {
          newVia.SetLayerPair(F_Cu, B_Cu);
        } else {
          const back = PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, (layer_num >> 4) & 0xf);
          const front = PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer_num & 0xf);

          // upstream passes the new layer ids to a check of legacy numbers; kept as is
          if (
            is_leg_copperlayer_valid(this.m_cu_count, back) &&
            is_leg_copperlayer_valid(this.m_cu_count, front)
          ) {
            newVia.SetLayerPair(front, back);
          } else {
            newVia = null;
          }
        }
      } else if (newTrack) {
        // A few legacy boards can have tracks on non existent layers, because
        // reducing the number of layers does not remove tracks on removed layers
        // If happens, skip them
        newTrack.SetWidth(width.v);
        newTrack.SetUuidDirect(KIIDof(line2, uuid));
        newTrack.SetPosition({ x: start_x.v, y: start_y.v });
        newTrack.SetEnd({ x: end_x.v, y: end_y.v });

        if (is_leg_copperlayer_valid(this.m_cu_count, layer_num)) {
          newTrack.SetLayer(PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer_num));
        } else {
          newTrack = null;
        }
      }

      if (newTrack) {
        newTrack.SetNetCode(this.getNetCode(net_code.v));
        board.Add(newTrack);
      }

      if (newVia) {
        newVia.SetNetCode(this.getNetCode(net_code.v));
        board.Add(newVia);
      }
    }

    throw new IO_ERROR("Missing '$EndTRACK'");
  }

  private loadNETCLASS(): void {
    const board = this.m_board!;
    const nc = new NETCLASS('');

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      const text = (key: string): string => wxStr(ReadDelimitedText(line, key.length, 1024).text);

      if (TESTLINE(line, 'AddNet')) {
        // most frequent type of line
        // e.g. "AddNet "V3.3D"\n"
        const netname = convertToNewOverbarNotation(text('AddNet'));
        board.GetDesignSettings().m_NetSettings.SetNetclassPatternAssignment(netname, nc.GetName());
      } else if (TESTLINE(line, 'Clearance')) {
        nc.SetClearance(this.biuParse(line, 'Clearance'.length).v);
      } else if (TESTLINE(line, 'TrackWidth')) {
        nc.SetTrackWidth(this.biuParse(line, 'TrackWidth'.length).v);
      } else if (TESTLINE(line, 'ViaDia')) {
        nc.SetViaDiameter(this.biuParse(line, 'ViaDia'.length).v);
      } else if (TESTLINE(line, 'ViaDrill')) {
        nc.SetViaDrill(this.biuParse(line, 'ViaDrill'.length).v);
      } else if (TESTLINE(line, 'uViaDia')) {
        nc.SetuViaDiameter(this.biuParse(line, 'uViaDia'.length).v);
      } else if (TESTLINE(line, 'uViaDrill')) {
        nc.SetuViaDrill(this.biuParse(line, 'uViaDrill'.length).v);
      } else if (TESTLINE(line, 'Name')) {
        nc.SetName(text('Name'));
      } else if (TESTLINE(line, 'Desc')) {
        nc.SetDescription(text('Desc'));
      } else if (TESTLINE(line, '$EndNCLASS')) {
        const ns = board.GetDesignSettings().m_NetSettings;

        if (ns.HasNetclass(nc.GetName())) {
          // Must have been a name conflict, this is a bad board file.
          // User may have done a hand edit to the file.
          this.m_error = `Duplicate NETCLASS name '${nc.GetName()}'.`;
          throw new IO_ERROR(this.m_error);
        } else {
          ns.SetNetclass(nc.GetName(), nc);
        }

        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$EndNCLASS'");
  }

  private loadZONE_CONTAINER(): void {
    const board = this.m_board!;
    const zc = new ZONE(board);

    let outline_hatch = ZONE_BORDER_DISPLAY_STYLE.NO_HATCH;
    let endContour = false;
    let holeIndex = -1; // -1 is the main outline; holeIndex >= 0 = hole index

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, 'ZCorner')) {
        // new corner of the zone outlines found
        // e.g. "ZCorner 25650 49500 0"
        const x = this.biuParse(line, 'ZCorner'.length);
        const y = this.biuParse(line, x.end);

        if (endContour) {
          // the previous corner was the last corner of a contour.
          // so this corner is the first of a new hole
          endContour = false;
          zc.NewHole();
          holeIndex++;
        }

        zc.AppendCorner({ x: x.v, y: y.v }, holeIndex);

        endContour = intParse(line, y.end).v !== 0; // the corner is the last corner of a contour
      } else if (TESTLINE(line, 'ZInfo')) {
        // general info found
        // e.g. 'ZInfo 68183921-93a5-49ac-91b0-49d05a0e1647 310 "COMMON"'
        const st = { save: 0 };
        const uuid = strtok_r(line, 'ZInfo'.length, st);
        const netcode = intParse(line, st.save);

        if (ReadDelimitedText(line, netcode.end, 1024).consumed > 1024)
          throw new IO_ERROR('ZInfo netname too long');

        zc.SetUuidDirect(KIIDof(line, uuid));

        // Init the net code only, not the netname, to be sure
        // the zone net name is the name read in file.
        // (When mismatch, the user will be prompted in DRC, to fix the actual name)
        BOARD_CONNECTED_ITEM.prototype.SetNetCode.call(zc, this.getNetCode(netcode.v));
      } else if (TESTLINE(line, 'ZLayer')) {
        // layer found
        const layer_num = intParse(line, 'ZLayer'.length).v;
        zc.SetLayer(PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer_num));
      } else if (TESTLINE(line, 'ZAux')) {
        // aux info found
        // e.g. "ZAux 7 E"
        const r = intParse(line, 'ZAux'.length);
        const st = { save: 0 };
        const hopt = strtok_r(line, r.end, st);

        if (hopt === null) {
          this.m_error = `Bad ZAux for CZONE_CONTAINER '${zc.GetNetname()}'`;
          throw new IO_ERROR(this.m_error);
        }

        switch (line[hopt]) {
          // upper case required
          case 0x4e: // 'N'
            outline_hatch = ZONE_BORDER_DISPLAY_STYLE.NO_HATCH;
            break;
          case 0x45: // 'E'
            outline_hatch = ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE;
            break;
          case 0x46: // 'F'
            outline_hatch = ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL;
            break;
          default:
            this.m_error = `Bad ZAux for CZONE_CONTAINER '${zc.GetNetname()}'`;
            throw new IO_ERROR(this.m_error);
        }

        // Set hatch mode later, after reading corner outline data
      } else if (TESTLINE(line, 'ZSmoothing')) {
        // Smoothing option info found
        const smoothing = intParse(line, 'ZSmoothing'.length);
        const cornerRadius = this.biuParse(line, smoothing.end).v;

        if (smoothing.v >= ZONE_SETTINGS.SMOOTHING_LAST || smoothing.v < 0) {
          this.m_error = `Bad ZSmoothing for CZONE_CONTAINER '${zc.GetNetname()}'`;
          throw new IO_ERROR(this.m_error);
        }

        zc.SetCornerSmoothingType(smoothing.v);
        zc.SetCornerRadius(cornerRadius);
      } else if (TESTLINE(line, 'ZKeepout')) {
        zc.SetIsRuleArea(true);
        zc.SetDoNotAllowPads(false); // Not supported in legacy
        zc.SetDoNotAllowFootprints(false); // Not supported in legacy

        // e.g. "ZKeepout tracks N vias N pads Y"
        const st = { save: 0 };
        let token = strtok_r(line, 'ZKeepout'.length, st);

        while (token !== null) {
          if (streq(line, token, 'tracks')) {
            token = strtok_r(line, null, st);
            zc.SetDoNotAllowTracks(token !== null && line[token] === 0x4e);
          } else if (streq(line, token, 'vias')) {
            token = strtok_r(line, null, st);
            zc.SetDoNotAllowVias(token !== null && line[token] === 0x4e);
          } else if (streq(line, token, 'copperpour')) {
            token = strtok_r(line, null, st);
            zc.SetDoNotAllowZoneFills(token !== null && line[token] === 0x4e);
          }

          token = strtok_r(line, null, st);
        }
      } else if (TESTLINE(line, 'ZOptions')) {
        // e.g. "ZOptions 0 32 F 200 200"
        const fillmode = intParse(line, 'ZOptions'.length);
        const r = intParse(line, fillmode.end); // was: arcsegcount
        let data = r.end;
        const fillstate = line[data + 1] ?? 0; // here e.g. " F"
        data += 2; // +=2 for " F"
        const thermalReliefGap = this.biuParse(line, data);
        const thermalReliefCopperBridge = this.biuParse(line, thermalReliefGap.end).v;

        if (fillmode.v) {
          // SEGMENT fill mode no longer supported.  Make sure user is OK with converting
          // them.
          if (this.m_showLegacySegmentZoneWarning) {
            this.Report(
              'The legacy segment zone fill mode is no longer supported.\nZone fills will be converted on a best-effort basis.',
            );

            this.m_showLegacySegmentZoneWarning = false;
          }
        }

        zc.SetFillMode(ZONE_FILL_MODE.POLYGONS);
        zc.SetIsFilled(fillstate === 0x53); // 'S'
        zc.SetThermalReliefGap(thermalReliefGap.v);
        zc.SetThermalReliefSpokeWidth(thermalReliefCopperBridge);
      } else if (TESTLINE(line, 'ZClearance')) {
        // Clearance and pad options info found
        // e.g. "ZClearance 40 I"
        const clearance = this.biuParse(line, 'ZClearance'.length);
        const st = { save: 0 };
        const padoption = strtok_r(line, clearance.end, st); // data: " I"

        let popt: ZONE_CONNECTION;

        switch (padoption === null ? 0 : line[padoption]) {
          case 0x49: // 'I'
            popt = ZONE_CONNECTION.FULL;
            break;
          case 0x54: // 'T'
            popt = ZONE_CONNECTION.THERMAL;
            break;
          case 0x48: // 'H'
            popt = ZONE_CONNECTION.THT_THERMAL;
            break;
          case 0x58: // 'X'
            popt = ZONE_CONNECTION.NONE;
            break;
          default:
            this.m_error = `Bad ZClearance padoption for CZONE_CONTAINER '${zc.GetNetname()}'`;
            throw new IO_ERROR(this.m_error);
        }

        zc.SetLocalClearance(clearance.v);
        zc.SetPadConnection(popt);
      } else if (TESTLINE(line, 'ZMinThickness')) {
        zc.SetMinThickness(this.biuParse(line, 'ZMinThickness'.length).v);
      } else if (TESTLINE(line, 'ZPriority')) {
        zc.SetAssignedPriority(intParse(line, 'ZPriority'.length).v);
      } else if (TESTLINE(line, '$POLYSCORNERS')) {
        // Read the PolysList (polygons that are the solid areas in the filled zone)
        const polysList = new SHAPE_POLY_SET();

        let makeNewOutline = true;

        for (let l = this.READLINE(); l !== null; l = this.READLINE()) {
          if (TESTLINE(l, '$endPOLYSCORNERS')) break;

          // e.g. "39610 43440 0 0"
          const x = this.biuParse(l, 0);
          const y = this.biuParse(l, x.end);

          if (makeNewOutline) polysList.NewOutline();

          polysList.Append(x.v, y.v);

          const end_contour = intParse(l, y.end); // end_countour was a bool when file saved,
          // so '0' or '1' here
          intParse(l, end_contour.end); // skip corner utility flag

          makeNewOutline = end_contour.v !== 0;
        }

        zc.SetFilledPolysList(zc.GetFirstLayer(), polysList);
      } else if (TESTLINE(line, '$FILLSEGMENTS')) {
        for (let l = this.READLINE(); l !== null; l = this.READLINE()) {
          if (TESTLINE(l, '$endFILLSEGMENTS')) break;

          // e.g. ""%d %d %d %d\n"
          let r = this.biuParse(l, 0);
          r = this.biuParse(l, r.end);
          r = this.biuParse(l, r.end);
          this.biuParse(l, r.end);
        }
      } else if (TESTLINE(line, '$endCZONE_OUTLINE')) {
        // Ensure keepout does not have a net
        // (which have no sense for a keepout zone)
        if (zc.GetIsRuleArea()) zc.SetNetCode(NETINFO_LIST.UNCONNECTED);

        // Convert from legacy to KiCad 7+ zone fills (which are always polygons, and
        // include the stroke width).
        if (zc.GetMinThickness() > 0) {
          const layer = zc.GetFirstLayer();
          const inflatedFill = new SHAPE_POLY_SET(zc.GetFilledPolysList(layer)!);

          inflatedFill.InflateWithLinkedHoles(
            Math.trunc(zc.GetMinThickness() / 2),
            CornerStrategy.ROUND_ALL_CORNERS,
            Math.trunc(ARC_HIGH_DEF / 2),
          );

          zc.SetFilledPolysList(layer, inflatedFill);
        }

        // should always occur, but who knows, a zone without two corners
        // is no zone at all, it's a spot?

        if (zc.GetNumCorners() > 2) {
          if (!zc.IsOnCopperLayer()) {
            zc.SetFillMode(ZONE_FILL_MODE.POLYGONS);
            zc.SetNetCode(NETINFO_LIST.UNCONNECTED);
          }

          // HatchBorder here, after outlines corners are read
          // Set hatch here, after outlines corners are read
          zc.SetBorderDisplayStyle(outline_hatch, ZONE.GetDefaultHatchPitch(), true);

          board.Add(zc);
        }

        return; // preferred exit
      }
    }

    throw new IO_ERROR("Missing '$endCZONE_OUTLINE'");
  }

  private loadDIMENSION(): void {
    const board = this.m_board!;
    const dim = new PCB_DIM_ALIGNED(board, KICAD_T.PCB_DIM_ALIGNED_T);
    let crossBarO: VECTOR2I = { x: 0, y: 0 };
    let crossBarF: VECTOR2I = { x: 0, y: 0 };

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, '$endCOTATION')) {
        dim.UpdateHeight(crossBarF, crossBarO);

        board.Add(dim, ADD_MODE.APPEND);
        return; // preferred exit
      } else if (TESTLINE(line, 'Va')) {
        this.biuParse(line, 'Va'.length);
      } else if (TESTLINE(line, 'Ge')) {
        // e.g. "Ge 1 21 68183921-93a5-49ac-91b0-49d05a0e1647\r\n"
        const shape = intParse(line, 'De'.length);
        const layer_num = intParse(line, shape.end);
        const st = { save: 0 };
        const uuid = strtok_r(line, layer_num.end, st);

        dim.SetLayer(PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer_num.v));
        dim.SetUuidDirect(KIIDof(line, uuid));
      } else if (TESTLINE(line, 'Te')) {
        const buf = ReadDelimitedText(line, 'Te'.length, 2048).text;

        dim.SetOverrideText(wxStr(buf));
        dim.SetOverrideTextEnabled(true);
        dim.SetUnitsFormat(DIM_UNITS_FORMAT.NO_SUFFIX);
        dim.SetAutoUnits();
      } else if (TESTLINE(line, 'Po')) {
        const pos_x = this.biuParse(line, 'Po'.length);
        const pos_y = this.biuParse(line, pos_x.end);
        const width = this.biuParse(line, pos_y.end);
        const height = this.biuParse(line, width.end);
        const thickn = this.biuParse(line, height.end);
        const orient = this.degParse(line, thickn.end);
        const st = { save: 0 };
        const mirror = strtok_r(line, orient.end, st);

        // This sets both DIMENSION's position and internal m_Text's.
        // @todo: But why do we even know about internal m_Text?
        dim.SetTextPos({ x: pos_x.v, y: pos_y.v });
        dim.SetTextSize({ x: width.v, y: height.v });
        dim.SetMirrored(mirror !== null && line[mirror] === 0x30); // '0'
        dim.SetTextThickness(thickn.v);
        dim.SetTextAngle(orient.v);
      } else if (TESTLINE(line, 'Sb')) {
        const r = this.biuParse(line, 'Sb'.length);
        const crossBarOx = this.biuParse(line, r.end);
        const crossBarOy = this.biuParse(line, crossBarOx.end);
        const crossBarFx = this.biuParse(line, crossBarOy.end);
        const crossBarFy = this.biuParse(line, crossBarFx.end);
        const width = this.biuParse(line, crossBarFy.end).v;

        dim.SetLineThickness(width);
        crossBarO = { x: crossBarOx.v, y: crossBarOy.v };
        crossBarF = { x: crossBarFx.v, y: crossBarFy.v };
      } else if (TESTLINE(line, 'Sd')) {
        const r = intParse(line, 'Sd'.length);
        const featureLineDOx = this.biuParse(line, r.end);
        const featureLineDOy = this.biuParse(line, featureLineDOx.end);
        const q = this.biuParse(line, featureLineDOy.end);
        this.biuParse(line, q.end);

        dim.SetStart({ x: featureLineDOx.v, y: featureLineDOy.v });
      } else if (TESTLINE(line, 'Sg')) {
        const r = intParse(line, 'Sg'.length);
        const featureLineGOx = this.biuParse(line, r.end);
        const featureLineGOy = this.biuParse(line, featureLineGOx.end);
        const q = this.biuParse(line, featureLineGOy.end);
        this.biuParse(line, q.end);

        dim.SetEnd({ x: featureLineGOx.v, y: featureLineGOy.v });
      } else if (
        TESTLINE(line, 'S1') ||
        TESTLINE(line, 'S2') ||
        TESTLINE(line, 'S3') ||
        TESTLINE(line, 'S4')
      ) {
        // Arrow: no longer imported
        const r = intParse(line, 2);
        let q = this.biuParse(line, r.end); // skipping excessive data
        q = this.biuParse(line, q.end); // skipping excessive data
        q = this.biuParse(line, q.end);
        this.biuParse(line, q.end);
      }
    }

    throw new IO_ERROR("Missing '$endCOTATION'");
  }

  private loadPCB_TARGET(): void {
    const board = this.m_board!;

    for (let line = this.READLINE(); line !== null; line = this.READLINE()) {
      if (TESTLINE(line, '$EndPCB_TARGET') || TESTLINE(line, '$EndMIREPCB')) {
        return; // preferred exit
      } else if (TESTLINE(line, 'Po')) {
        // e.g. "Po 0 23 33 45 67 23 68183921-93a5-49ac-91b0-49d05a0e1647\r\n"
        const shape = intParse(line, 'Po'.length);
        const layer = intParse(line, shape.end);
        let layer_num = layer.v;
        const pos_x = this.biuParse(line, layer.end);
        const pos_y = this.biuParse(line, pos_x.end);
        const size = this.biuParse(line, pos_y.end);
        const width = this.biuParse(line, size.end);
        const st = { save: 0 };
        const uuid = strtok_r(line, width.end, st);

        if (layer_num < FIRST_NON_COPPER_LAYER) layer_num = FIRST_NON_COPPER_LAYER;
        else if (layer_num > LAST_NON_COPPER_LAYER) layer_num = LAST_NON_COPPER_LAYER;

        const t = new PCB_TARGET(
          board,
          shape.v,
          PCB_IO_KICAD_LEGACY.leg_layer2new(this.m_cu_count, layer_num),
          { x: pos_x.v, y: pos_y.v },
          size.v,
          width.v,
        );
        board.Add(t, ADD_MODE.APPEND);

        t.SetUuidDirect(KIIDof(line, uuid));
      }
    }

    throw new IO_ERROR("Missing '$EndDIMENSION'");
  }

  protected init(aProperties: PCB_IO_PROPERTIES | null): void {
    this.m_loading_format_version = 0;
    this.m_cu_count = 16;
    this.m_board = null;
    this.m_showLegacySegmentZoneWarning = true;
    this.m_props = aProperties;

    // conversion factor for saving RAM BIUs to KICAD legacy file format.
    this.biuToDisk = 1.0 / pcbIUScale.IU_PER_MM; // BIUs are nanometers & file is mm

    // Conversion factor for loading KICAD legacy file format into BIUs in RAM
    // Start by assuming the *.brd file is in deci-mils.
    // If we see "Units mm" in the $GENERAL section, set diskToBiu to 1000000.0
    // then, during the file loading process, to start a conversion from
    // mm to nanometers.  The deci-mil legacy files have no such "Units" marker
    // so we must assume the file is in deci-mils until told otherwise.

    this.diskToBiu = pcbIUScale.IU_PER_MILS / 10; // BIUs are nanometers
  }

  // -----<FOOTPRINT LIBRARY FUNCTIONS>----------------------------------------

  private cacheLib(aLibraryPath: string): void {
    if (!this.m_cache || this.m_cache.m_lib_path !== aLibraryPath) {
      this.m_cache = { m_lib_path: aLibraryPath, m_footprints: new Map(), m_writable: true };
      this.loadCache(this.m_cache);
    }
  }

  /** `LP_CACHE::Load`: the header, the index skipped, then every $MODULE. */
  private loadCache(aCache: LP_CACHE): void {
    const reader = this.readerOf(aCache.m_lib_path);

    // ReadAndVerifyHeader
    let line = reader.ReadLine();

    if (!line) throw new IO_ERROR(`File '${aCache.m_lib_path}' is empty.`);

    if (!TESTLINE(line, 'PCBNEW-LibModule-V1'))
      throw new IO_ERROR(`File '${aCache.m_lib_path}' is not a legacy library.`);

    for (line = reader.ReadLine(); line !== null; line = reader.ReadLine()) {
      if (TESTLINE(line, 'Units')) {
        const st = { save: 0 };
        const units = strtok_r(line, 'Units'.length, st);

        if (streq(line, units, 'mm')) this.diskToBiu = pcbIUScale.IU_PER_MM;
      } else if (TESTLINE(line, '$INDEX')) {
        break;
      }
    }

    // SkipIndex
    let exit = false;
    let cur: Uint8Array | null = reader.Line();

    do {
      if (TESTLINE(cur!, '$INDEX')) {
        exit = false;

        for (cur = reader.ReadLine(); cur !== null; cur = reader.ReadLine()) {
          if (TESTLINE(cur, '$EndINDEX')) {
            exit = true;
            break;
          }
        }

        if (cur === null) break;
      } else if (exit) {
        break;
      }

      cur = reader.ReadLine();
    } while (cur !== null);

    // LoadModules
    this.m_reader = reader;
    cur = reader.Line();

    while (cur !== null) {
      if (TESTLINE(cur, '$MODULE')) {
        const fp = new FOOTPRINT(this.m_board);
        let footprintName = wxStr(cbytes(cur, StrPurge(cur, '$MODULE'.length)));

        // The footprint names in legacy libraries can contain the '/' and ':'
        // characters which will cause the LIB_ID parser to choke.
        footprintName = ReplaceIllegalFileNameChars(footprintName);

        // set the footprint name first thing, so exceptions can use name.
        fp.SetFPID(new LIB_ID('', footprintName));

        this.loadFOOTPRINT(fp);

        if (!aCache.m_footprints.has(footprintName)) {
          aCache.m_footprints.set(footprintName, fp);
        } else {
          // Bad library has a duplicate of this footprintName, generate a
          // unique footprint name and load it anyway.
          for (let version = 2; ; version++) {
            const newName = `${footprintName}_v${version}`;

            if (!aCache.m_footprints.has(newName)) {
              fp.SetFPID(new LIB_ID('', newName));
              aCache.m_footprints.set(newName, fp);
              break;
            }
          }
        }
      }

      cur = reader.ReadLine();
    }
  }

  GetLibraryTimestamp(aLibraryPath: string): number {
    return this.m_readFile(aLibraryPath) ? 1 : 0;
  }

  override FootprintEnumerate(
    aFootprintNames: string[],
    aLibPath: string,
    aBestEfforts: boolean,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    let errorMsg = '';

    this.init(aProperties);

    try {
      this.cacheLib(aLibPath);
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      errorMsg = ioe.What();
    }

    // Some of the files may have been parsed correctly so we want to add the valid files to
    // the library.

    // boost::ptr_map< std::string, FOOTPRINT >: names in byte order
    for (const name of [...(this.m_cache?.m_footprints.keys() ?? [])].sort(utf8Less))
      aFootprintNames.push(name);

    if (errorMsg !== '' && !aBestEfforts) throw new IO_ERROR(errorMsg);
  }

  override FootprintLoad(
    aLibraryPath: string,
    aFootprintName: string,
    _aKeepUUID = false,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    this.init(aProperties);

    this.cacheLib(aLibraryPath);

    const it = this.m_cache!.m_footprints.get(aFootprintName);

    if (it === undefined) return null;

    // Return copy of already loaded FOOTPRINT
    const copy = it.Duplicate(false) as FOOTPRINT;
    copy.SetParent(null);
    return copy;
  }

  override IsLibraryWritable(aLibraryPath: string): boolean {
    this.init(null);

    this.cacheLib(aLibraryPath);

    return this.m_cache!.m_writable;
  }
}

/** `KIID_PATH( const wxString& )`: the '/'-separated ids. */
function kiidPathFromString(aString: string): string[] {
  const out: string[] = [];

  for (const pathStep of aString.split('/')) {
    if (pathStep !== '') out.push(kiidFromString(pathStep));
  }

  return out;
}

/** `std::string` order: UTF-8 bytes, which is the code point order. */
function utf8Less(a: string, b: string): number {
  const n = Math.min(a.length, b.length);

  for (let i = 0; i < n; i++) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(i)!;

    if (ca !== cb) return ca < cb ? -1 : 1;

    if (ca > 0xffff) i++;
  }

  return a.length - b.length;
}
