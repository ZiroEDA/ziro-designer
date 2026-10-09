// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/fabmaster/import_fabmaster.cpp` / `.h`: FABMASTER, the reader
 * of a Cadence Allegro "extracta" (`!`-separated) export and what it builds on
 * a BOARD.
 *
 * The file is read as bytes: a cell is its bytes, upper-cased as `std::toupper`
 * does in the C locale (ASCII letters only), and compared byte-wise as a
 * `std::string` is. The C++ containers keep their order here: a `std::map` or
 * `std::set` is iterated in key order, and a `std::set` with a comparator
 * drops an item the comparator calls equal to one already in it.
 *
 * A struct the C++ default-initialises (`FABMASTER_LAYER layer;` in
 * `processLayers`, the `new GRAPHIC_*` items) has indeterminate members there;
 * they are zero here, which is what a value-initialised one holds. The
 * graphic items' `type` is never read and is not kept.
 *
 * `wxLogError` / `wxLogWarning` / `wxLogTrace` text is not kept.
 */

import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import {
  IsBackLayer,
  IsCopperLayer,
  IsPcbLayer,
  PCB_LAYER_ID,
  PCBNEW_LAYER_ID_START,
} from '@ziroeda/common/layer_id.js';
import { ISTRINGSTREAM } from '@ziroeda/common/libc/sstream.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { ReplaceIllegalFileNameChars } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import {
  ANGLE_0,
  ANGLE_180,
  ANGLE_360,
  ANGLE_90,
  EDA_ANGLE,
  EDA_ANGLE_T,
  FULL_CIRCLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN, pointOnEdge } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import {
  KIGEOM_AddHoleIfValid,
  KIGEOM_MakeCrossSegments,
  KIGEOM_MakeRegularPolygonPoints,
} from '@ziroeda/kimath/src/geometry/shape_utils.js';
import { KiROUND, toInt } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import type { BOARD_ITEM } from '../../board_item.js';
import { FOOTPRINT } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK, PADSTACK_MODE } from '../../padstack.js';
import { PCB_FIELD } from '../../pcb_field.js';
import { PCB_GROUP } from '../../pcb_group.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { VIATYPE } from '../../pcb_track_types.js';
import { ZONE } from '../../zone.js';
import { AutoAssignZonePriorities } from '../../zone_utils.js';
import { ZONE_CONNECTION } from '../../zones.js';

type single_row = string[];

// ---------------------------------------------------------------------------
// std::string and the C library

/** `std::string` `operator<`: byte order (a cell holds one byte per char). */
const strLess = (a: string, b: string): boolean => a < b;
const strCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `std::toupper` in the C locale. */
const toupper = (c: string): string => (c >= 'a' && c <= 'z' ? c.toUpperCase() : c);

/** `std::isalpha` in the C locale. */
const isalpha = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));

/**
 * A `std::string` of bytes as the `wxString` it converts to: UTF-8, and
 * empty when the bytes are not UTF-8 (wx's conversion fails).
 */
function wx(aStd: string): string {
  let ascii = true;

  for (let i = 0; i < aStd.length; i++) if (aStd.charCodeAt(i) >= 0x80) ascii = false;

  if (ascii) return aStd;

  const bytes = Uint8Array.from(aStd, (c) => c.charCodeAt(0));

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return '';
  }
}

/** `split( aStr, aDelim )` (string_utils.h). */
function split(aStr: string, aDelim: string): string[] {
  let pos = 0;
  let last_pos = 0;
  const tokens: string[] = [];

  while (pos < aStr.length) {
    pos = last_pos;

    while (pos < aStr.length && !aDelim.includes(aStr[pos]!)) pos++;

    tokens.push(aStr.slice(last_pos, pos));

    last_pos = pos + 1;
  }

  return tokens;
}

/** `std::sscanf( aStr, "%d %d[ %d]", … )`: the values read, in order. */
function scanInts(aStr: string, aMax: number): number[] {
  const out: number[] = [];
  let i = 0;

  while (out.length < aMax) {
    while (i < aStr.length && ' \t\n\v\f\r'.includes(aStr[i]!)) i++;

    const m = /^[+-]?\d+/.exec(aStr.slice(i));

    if (!m) break;

    // %d into an int: out of range is undefined; glibc keeps the low 32 bits
    out.push(Number(BigInt.asIntN(32, BigInt(m[0]))));
    i += m[0].length;
  }

  return out;
}

const eraseUnderscores = (s: string): string => s.replaceAll('_', '');

// ---------------------------------------------------------------------------
// the structures

interface FM_PAD_LAYER {
  shape: PAD_SHAPE;
  custom_name: string;
  is_octogon: boolean;
  width: number;
  height: number;
  x_offset: number;
  y_offset: number;
}

const newPadLayer = (): FM_PAD_LAYER => ({
  shape: PAD_SHAPE.CIRCLE,
  custom_name: '',
  is_octogon: false,
  width: 0,
  height: 0,
  x_offset: 0,
  y_offset: 0,
});

/** `FM_PAD()`: value-initialised. */
class FM_PAD {
  name = '';
  fixed = false;
  via = false;
  shape: PAD_SHAPE = 0 as PAD_SHAPE;
  custom_name = '';
  top = false;
  bottom = false;
  paste = false;
  mask = false;
  drill = false;
  plated = false;
  is_octogon = false;
  drill_size_x = 0;
  drill_size_y = 0;
  width = 0;
  height = 0;
  mask_width = 0;
  mask_height = 0;
  paste_width = 0;
  paste_height = 0;
  x_offset = 0;
  y_offset = 0;
  antipad_size = 0;
  /** `std::set<std::string>`. */
  readonly copper_layers = new Set<string>();
  /** `std::map<std::string, FM_PAD_LAYER>`. */
  readonly layer_shapes = new Map<string, FM_PAD_LAYER>();
}

enum COMPCLASS {
  COMPCLASS_NONE,
  COMPCLASS_IO,
  COMPCLASS_IC,
  COMPCLASS_DISCRETE,
}

enum SYMTYPE {
  SYMTYPE_NONE,
  SYMTYPE_PACKAGE,
  SYMTYPE_MECH,
  SYMTYPE_FORMAT,
  SYMTYPE_DRAFTING,
}

interface NETNAME {
  name: string;
  refdes: string;
  pin_num: string;
  pin_name: string;
  pin_gnd: boolean;
  pin_pwr: boolean;
}

enum GRAPHIC_SHAPE {
  GR_SHAPE_LINE,
  GR_SHAPE_TEXT, ///< Not actually in Fabmaster but we use for 1:1 mapping
  GR_SHAPE_RECTANGLE,
  GR_SHAPE_ARC,
  GR_SHAPE_CIRCLE, ///< Actually 360° arcs (for both arcs where start==end and real circles)
  GR_SHAPE_OBLONG, ///< Actually 360° arcs (for both arcs where start==end and real circles)
  GR_SHAPE_CROSS,
  GR_SHAPE_POLYGON,
}

class GRAPHIC_ITEM {
  start_x = 0; ///< X position of the start of the item
  start_y = 0; ///< Y position of the start of the item
  width = 0; ///< width of the line or border
  layer = ''; ///< Name of the layer
  symbol = ''; ///< Symbol name
  refdes = ''; ///< Reference designator
  seq = 0; ///< Sequence of the item
  subseq = 0; ///< Subsequence of the item
  shape: GRAPHIC_SHAPE = GRAPHIC_SHAPE.GR_SHAPE_LINE; ///< Shape of the graphic_item
}

class GRAPHIC_LINE extends GRAPHIC_ITEM {
  end_x = 0;
  end_y = 0;
}

class GRAPHIC_ARC extends GRAPHIC_ITEM {
  end_x = 0;
  end_y = 0;
  center_x = 0;
  center_y = 0;
  radius = 0;
  clockwise = false;
  result = new SHAPE_ARC();
}

class GRAPHIC_RECTANGLE extends GRAPHIC_ITEM {
  end_x = 0;
  end_y = 0;
  fill = false;
}

class GRAPHIC_OBLONG extends GRAPHIC_ITEM {
  oblong_x = false;
  size_x = 0;
  size_y = 0;
}

class GRAPHIC_CROSS extends GRAPHIC_ITEM {
  oblong_x = false;
  size_x = 0;
  size_y = 0;
}

class GRAPHIC_POLYGON extends GRAPHIC_ITEM {
  m_pts: VECTOR2I[] = [];
}

class GRAPHIC_TEXT extends GRAPHIC_ITEM {
  rotation = 0;
  mirror = false;
  orient: GR_TEXT_H_ALIGN_T = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
  height = 0;
  thickness = 0;
  ital = false;
  text = '';
}

/** `GRAPHIC_ITEM::SEQ_CMP`. */
function seqCmp(lhs: GRAPHIC_ITEM, rhs: GRAPHIC_ITEM): number {
  if (lhs.refdes !== rhs.refdes) return strCmp(lhs.refdes, rhs.refdes);

  if (lhs.layer !== rhs.layer) return strCmp(lhs.layer, rhs.layer);

  return lhs.seq - rhs.seq;
}

/**
 * `std::set<std::unique_ptr<GRAPHIC_ITEM>, GRAPHIC_ITEM::SEQ_CMP>`: sorted,
 * and an item equal to one already held is refused.
 */
class graphic_element {
  private readonly m_items: GRAPHIC_ITEM[] = [];

  /** `insert` / `emplace`: whether it went in. */
  insert(aItem: GRAPHIC_ITEM): boolean {
    let lo = 0;
    let hi = this.m_items.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (seqCmp(this.m_items[mid]!, aItem) < 0) lo = mid + 1;
      else hi = mid;
    }

    if (lo < this.m_items.length && seqCmp(this.m_items[lo]!, aItem) === 0) return false;

    this.m_items.splice(lo, 0, aItem);
    return true;
  }

  get size(): number {
    return this.m_items.length;
  }

  empty(): boolean {
    return this.m_items.length === 0;
  }

  begin(): GRAPHIC_ITEM {
    return this.m_items[0]!;
  }

  [Symbol.iterator](): Iterator<GRAPHIC_ITEM> {
    return this.m_items[Symbol.iterator]();
  }
}

/** `FABMASTER_LAYER{}`: value-initialised. */
class FABMASTER_LAYER {
  id = 0; ///< FabMaster layer ID
  name = ''; ///< FabMaster layer name
  positive = false; ///< true if positive
  use = ''; ///< FabMaster layer use
  conductive = false; ///< true if copper
  er = 0; ///< dielectric constant
  conductivity = 0; ///< conductivity
  material = ''; ///< Name of the material
  shield = false; ///< true if a shield layer
  thermal_cond = 0; ///< Thermal conductivity
  thickness = 0; ///< Layer thickness
  layerid = 0; ///< pcbnew layer (assigned)
  disable = false; ///< if true, prevent the layer elements from being used

  clone(): FABMASTER_LAYER {
    return Object.assign(new FABMASTER_LAYER(), this);
  }
}

class FABMASTER_PAD_SHAPE {
  name = ''; ///< Name of the shape
  padstack = ''; ///< Name of the pad stack using the shape
  refdes = ''; ///< Refdes of the pad
  pinnum = ''; ///< Pin number of the pad
  /** `std::map<int, graphic_element>`. */
  readonly elements = new Map<number, graphic_element>();
}

interface GRAPHIC_DATA {
  graphic_dataname: string;
  graphic_datanum: string;
  graphic_data1: string;
  graphic_data2: string;
  graphic_data3: string;
  graphic_data4: string;
  graphic_data5: string;
  graphic_data6: string;
  graphic_data7: string;
  graphic_data8: string;
  graphic_data9: string;
  graphic_data10: string;
}

class GEOM_GRAPHIC {
  subclass = ''; ///< Subclass of the shape
  name = ''; ///< Symbol name
  refdes = ''; ///< Reference designator
  id = 0; ///< Graphical element id
  elements: graphic_element | null = null; ///< Graphical elements
}

interface FM_VIA {
  x: number; ///< X location of the via
  y: number; ///< Y location of the via
  padstack: string; ///< Name of the via padstack
  net: string; ///< Name of the via's net
  test_point: boolean; ///< Is this a test point
  mirror: boolean; ///< Is this via on the bottom
}

class TRACE {
  lclass = ''; ///< Name of the layer class
  layer = ''; ///< Name of the layer
  netname = ''; ///< Name of the net
  id = 0; ///< Graphical element id
  readonly segment = new graphic_element(); ///< Collection of graphical items making up the trace
}

/** `std::set<std::unique_ptr<TRACE>, TRACE::BY_ID>`: one trace per id, in id order. */
class TRACE_SET {
  private readonly m_byId = new Map<number, TRACE>();

  /** `emplace`: the trace already held for its id, or this one. */
  emplace(aTrace: TRACE): TRACE {
    const held = this.m_byId.get(aTrace.id);

    if (held) return held;

    this.m_byId.set(aTrace.id, aTrace);
    return aTrace;
  }

  get size(): number {
    return this.m_byId.size;
  }

  [Symbol.iterator](): Iterator<TRACE> {
    return [...this.m_byId.keys()]
      .sort((a, b) => a - b)
      .map((k) => this.m_byId.get(k)!)
      [Symbol.iterator]();
  }
}

class COMPONENT {
  refdes = ''; ///< Reference designator of the component
  cclass: COMPCLASS = COMPCLASS.COMPCLASS_NONE; ///< Component class
  pn = ''; ///< Part number
  height = ''; ///< Component height
  dev_label = ''; ///< Device label
  insert_code = ''; ///< Insertion code
  type: SYMTYPE = SYMTYPE.SYMTYPE_NONE; ///< Symbol type
  name = ''; ///< Symbol name
  mirror = false; ///< Mirrored (on bottom)
  rotate = 0; ///< Rotation of the symbol in degrees
  x = 0; ///< X coordinate of the symbol origin
  y = 0; ///< Y coordinate of the symbol origin
  value = ''; ///< Component value
  tol = ''; ///< Component tolerance
  voltage = ''; ///< Voltage (for power components)
}

class PIN {
  name = ''; ///< Symbol name
  mirror = false;
  pin_name = ''; ///< Pin name
  pin_number = ''; ///< Pin number
  pin_x = 0; ///< X location of the pin
  pin_y = 0; ///< Y location of the pin
  padstack = '';
  refdes = '';
  rotation = 0;
}

/** `std::set<std::unique_ptr<PIN>, PIN::BY_NUM>`: one pin per number, in number order. */
class PIN_SET {
  private readonly m_items: PIN[] = [];

  insert(aPin: PIN): void {
    let lo = 0;
    let hi = this.m_items.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if (strLess(this.m_items[mid]!.pin_number, aPin.pin_number)) lo = mid + 1;
      else hi = mid;
    }

    if (lo < this.m_items.length && this.m_items[lo]!.pin_number === aPin.pin_number) return;

    this.m_items.splice(lo, 0, aPin);
  }

  empty(): boolean {
    return this.m_items.length === 0;
  }

  begin(): PIN {
    return this.m_items[0]!;
  }

  [Symbol.iterator](): Iterator<PIN> {
    return this.m_items[Symbol.iterator]();
  }
}

/** The keys of a `std::map<std::string, …>` in its order. */
const sortedKeys = <V>(aMap: Map<string, V>): string[] =>
  [...aMap.keys()].sort((a, b) => strCmp(a, b));

enum section_type {
  UNKNOWN_EXTRACT,
  EXTRACT_PADSTACKS,
  EXTRACT_PAD_SHAPES,
  EXTRACT_FULL_LAYERS,
  EXTRACT_VIAS,
  FABMASTER_EXTRACT_PINS,
  EXTRACT_PINS,
  EXTRACT_TRACES,
  EXTRACT_GRAPHICS,
  EXTRACT_BASIC_LAYERS,
  EXTRACT_NETS,
  EXTRACT_REFDES,
}

const isRuleAreaClass = (aClass: string): boolean =>
  aClass === 'ROUTE KEEPOUT' ||
  aClass === 'VIA KEEPOUT' ||
  aClass === 'PACKAGE KEEPOUT' ||
  aClass === 'ROUTE KEEPIN' ||
  aClass === 'PACKAGE KEEPIN' ||
  aClass === 'CONSTRAINT REGION';

// ---------------------------------------------------------------------------

export class FABMASTER {
  private m_filename = '';
  /** `m_filename.GetName()`: the file name without its directory or extension. */
  private m_filenameName = '';

  private readonly rows: single_row[] = [];

  private has_pads = false;
  private has_comps = false;
  private has_graphic = false;
  private has_nets = false;
  private has_pins = false;

  private readonly pads = new Map<string, FM_PAD>();
  /** `std::map<std::pair<std::string, std::string>, NETNAME>`, keyed refdes NUL pin. */
  private readonly pin_nets = new Map<string, NETNAME>();
  /** `std::set<std::string>`. */
  private readonly netnames = new Set<string>();
  /** `std::map<std::string, FABMASTER_LAYER>`. */
  private readonly layers = new Map<string, FABMASTER_LAYER>();
  private readonly pad_shapes = new Map<string, FABMASTER_PAD_SHAPE>();
  private readonly board_graphics: GEOM_GRAPHIC[] = [];
  /** `std::map<std::string, std::map<int, GEOM_GRAPHIC>>`. */
  private readonly comp_graphics = new Map<string, Map<number, GEOM_GRAPHIC>>();
  private readonly vias: FM_VIA[] = [];
  private readonly traces = new TRACE_SET();
  private readonly zones = new TRACE_SET();
  private readonly polygons = new TRACE_SET();
  private readonly refdes = new TRACE_SET();
  /** `std::map<std::string, std::vector<std::unique_ptr<COMPONENT>>>`. */
  private readonly components = new Map<string, COMPONENT[]>();
  /** `std::map<std::string, std::set<std::unique_ptr<PIN>, PIN::BY_NUM>>`. */
  private readonly pins = new Map<string, PIN_SET>();

  private m_progressReporter: PROGRESS_REPORTER | null = null;
  private m_doneCount = 0;
  private m_lastProgressCount = 0;
  private m_totalCount = 0;

  private checkpoint(): void {
    const PROGRESS_DELTA = 250;

    if (this.m_progressReporter) {
      if (++this.m_doneCount > this.m_lastProgressCount + PROGRESS_DELTA) {
        this.m_progressReporter.SetCurrentProgress(
          this.m_doneCount / Math.max(1, this.m_totalCount),
        );

        if (!this.m_progressReporter.KeepRefreshing())
          throw new IO_ERROR('File import canceled by user.');

        this.m_lastProgressCount = this.m_doneCount;
      }
    }
  }

  private readDouble(aStr: string): number {
    // wxCHECK_MSG( !aStr.empty(), 0.0, … )
    if (aStr === '') return 0.0;

    // `double doubleValue;` is left alone when nothing is extracted (a blank
    // text); ours reads 0 there.
    return new ISTRINGSTREAM(aStr).readDouble(0);
  }

  private readInt(aStr: string): number {
    if (aStr === '') return 0;

    return new ISTRINGSTREAM(aStr).readInt(0);
  }

  /** `Read( aFile )`: split the file into rows of cells. */
  Read(aData: Uint8Array | null, aFileName: string): boolean {
    if (!aData) return false;

    this.m_filename = aFileName;

    const slash = aFileName.lastIndexOf('/');
    const base = aFileName.slice(slash + 1);
    const dot = base.lastIndexOf('.');

    this.m_filenameName = dot < 0 ? base : base.slice(0, dot);

    let row: string[] = [];
    let cell = '';
    let quoted = false;

    for (const b of aData) {
      const ch = String.fromCharCode(b);

      switch (ch) {
        case '"':
          if (cell === '' || cell[0] === '"') quoted = !quoted;

          cell += ch;
          break;

        case '!':
          if (!quoted) {
            row.push(cell);
            cell = '';
          } else {
            cell += ch;
          }

          break;

        case '\n':
          // Push the final cell
          if (cell !== '') row.push(cell);

          cell = '';
          this.rows.push(row);
          row = [];
          quoted = false;
          break;

        case '\r':
          break;

        default:
          cell += toupper(ch);
      }
    }

    // Handle last line without linebreak
    if (cell !== '' || row.length > 0) {
      row.push(cell);
      cell = '';
      this.rows.push(row);
      row = [];
    }

    return true;
  }

  private detectType(aOffset: number): section_type {
    const row = this.rows[aOffset];

    if (!row) return section_type.UNKNOWN_EXTRACT;

    if (row.length < 3) return section_type.UNKNOWN_EXTRACT;

    // We only want to check the "A" rows
    if (row[0]![row[0]!.length - 1] !== 'A') return section_type.UNKNOWN_EXTRACT;

    const row1 = eraseUnderscores(row[1]!);
    const row2 = eraseUnderscores(row[2]!);
    let row3 = '';

    if (row.length > 3) row3 = eraseUnderscores(row[3]!);

    if (row1 === 'REFDES' && row2 === 'COMPCLASS') return section_type.EXTRACT_REFDES;

    if (row1 === 'NETNAME' && row2 === 'REFDES') return section_type.EXTRACT_NETS;

    if (row1 === 'CLASS' && row2 === 'SUBCLASS' && row3 === '')
      return section_type.EXTRACT_BASIC_LAYERS;

    if (row1 === 'GRAPHICDATANAME' && row2 === 'GRAPHICDATANUMBER')
      return section_type.EXTRACT_GRAPHICS;

    if (row1 === 'CLASS' && row2 === 'SUBCLASS' && row3 === 'GRAPHICDATANAME')
      return section_type.EXTRACT_TRACES;

    if (row1 === 'SYMNAME' && row2 === 'PINNAME') return section_type.FABMASTER_EXTRACT_PINS;

    if (row1 === 'SYMNAME' && row2 === 'SYMMIRROR' && row3 === 'PINNAME')
      return section_type.EXTRACT_PINS;

    if (row1 === 'VIAX' && row2 === 'VIAY') return section_type.EXTRACT_VIAS;

    if (row1 === 'SUBCLASS' && row2 === 'PADSHAPENAME') return section_type.EXTRACT_PAD_SHAPES;

    if (row1 === 'PADNAME') return section_type.EXTRACT_PADSTACKS;

    if (row1 === 'LAYERSORT') return section_type.EXTRACT_FULL_LAYERS;

    return section_type.UNKNOWN_EXTRACT;
  }

  private processScaleFactor(aRow: number): number {
    let retval = 0.0;

    if (aRow >= this.rows.length) return -1.0;

    if (this.rows[aRow]!.length < 11) return -1.0;

    for (let i = 7; i < 10 && retval < 1.0; ++i) {
      const units = [...this.rows[aRow]![i]!].map(toupper).join('');

      if (units === 'MILS') retval = pcbIUScale.IU_PER_MILS;
      else if (units === 'MILLIMETERS') retval = pcbIUScale.IU_PER_MM;
      else if (units === 'MICRONS') retval = pcbIUScale.IU_PER_MM * 10.0;
      else if (units === 'INCHES') retval = pcbIUScale.IU_PER_MILS * 1000.0;
    }

    // Could not find units value, defaulting to mils.
    if (retval < 1.0) retval = pcbIUScale.IU_PER_MILS;

    return retval;
  }

  private getColFromName(aRow: number, aStr: string): number {
    if (aRow >= this.rows.length) return -1;

    const header = this.rows[aRow]!;

    for (let i = 0; i < header.length; i++) {
      /// Some Fabmaster headers include the underscores while others do not.
      /// Removing them all allows us to generalize
      if (eraseUnderscores(header[i]!) === aStr) return i;
    }

    throw new IO_ERROR(`Could not find column label ${aStr}.`);
  }

  private getLayer(aLayerName: string): PCB_LAYER_ID {
    const kicad_layer = this.layers.get(aLayerName);

    if (!kicad_layer) return PCB_LAYER_ID.UNDEFINED_LAYER;

    return kicad_layer.layerid as PCB_LAYER_ID;
  }

  /** The rows of a section: from two past the header while their first cell is "S". */
  private sectionRows(
    aRow: number,
    aVisit: (row: single_row, rownum: number) => boolean | void,
  ): number {
    let rownum = aRow + 2;

    for (
      ;
      rownum < this.rows.length && this.rows[rownum]!.length > 0 && this.rows[rownum]![0] === 'S';
      ++rownum
    ) {
      if (aVisit(this.rows[rownum]!, rownum) === false) break;
    }

    return rownum;
  }

  private processPadStackLayers(aRow: number): number {
    const rownum0 = aRow + 2;

    if (rownum0 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const pad_num_col = this.getColFromName(aRow, 'RECNUMBER');
    const pad_lay_col = this.getColFromName(aRow, 'LAYER');

    this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      const pad_num = row[pad_num_col]!;
      const pad_layer = row[pad_lay_col]!;

      // This layer setting seems to be unused
      if (pad_layer === 'INTERNAL_PAD_DEF' || pad_layer === 'internal_pad_def') return;

      // Skip the technical layers
      if (pad_layer[0] === '~') return false;

      let layer = this.layers.get(pad_layer);

      if (!layer) {
        layer = new FABMASTER_LAYER();
        this.layers.set(pad_layer, layer);
      }

      // If the layer ID is not yet set, set it
      if (layer.id === 0) {
        layer.name = pad_layer;
        layer.id = this.readInt(pad_num);
        layer.conductive = true;
      }
    });

    return 0;
  }

  private processPadStacks(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const col = (s: string) => this.getColFromName(aRow, s);
    const pad_name_col = col('PADNAME');
    const pad_num_col = col('RECNUMBER');
    const pad_lay_col = col('LAYER');
    const pad_via_col = col('VIAFLAG');
    const pad_shape_col = col('PADSHAPE1');
    const pad_width_col = col('PADWIDTH');
    const pad_height_col = col('PADHGHT');
    const pad_xoff_col = col('PADXOFF');
    const pad_yoff_col = col('PADYOFF');
    const pad_shape_name_col = col('PADSHAPENAME');

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      const pad_name = row[pad_name_col]!;
      const pad_num = row[pad_num_col]!;
      const pad_layer = row[pad_lay_col]!;
      const pad_is_via = row[pad_via_col]!;
      const pad_shape = row[pad_shape_col]!;
      const pad_width = row[pad_width_col]!;
      const pad_height = row[pad_height_col]!;
      const pad_xoff = row[pad_xoff_col]!;
      const pad_yoff = row[pad_yoff_col]!;
      const pad_shapename = row[pad_shape_name_col]!;

      // This layer setting seems to be unused
      if (pad_layer === 'INTERNAL_PAD_DEF' || pad_layer === 'internal_pad_def') return;

      const recnum = KiROUND(this.readDouble(pad_num));

      let pad = this.pads.get(pad_name);

      if (!pad) {
        pad = new FM_PAD();
        this.pads.set(pad_name, pad);
        pad.name = pad_name;
      }

      if (pad_layer === '~DRILL') {
        const drill_hit = KiROUND(Math.abs(this.readDouble(pad_shape) * scale_factor));
        const drill_x = KiROUND(Math.abs(this.readDouble(pad_width) * scale_factor));
        const drill_y = KiROUND(Math.abs(this.readDouble(pad_height) * scale_factor));

        if (drill_hit === 0) {
          pad.drill = false;
          return;
        }

        pad.drill = true;

        // This is to account for broken fabmaster outputs where square drill hits don't
        // match the drill hit size.
        if (drill_x === drill_y) {
          pad.drill_size_x = drill_hit;
          pad.drill_size_y = drill_hit;
        } else {
          pad.drill_size_x = drill_x;
          pad.drill_size_y = drill_y;
        }

        if (pad_shapename !== '' && pad_shapename[0] === 'P') pad.plated = true;

        return;
      }

      if (pad_shape === '') return;

      const w = this.readDouble(pad_width) * scale_factor;
      const h = this.readDouble(pad_height) * scale_factor;

      const layer = this.layers.get(pad_layer);

      if (w > 0.0 && layer && layer.conductive) pad.copper_layers.add(pad_layer);

      if (w <= 0.0) return;

      if (layer) {
        if (layer.layerid === PCB_LAYER_ID.F_Cu) pad.top = true;
        else if (layer.layerid === PCB_LAYER_ID.B_Cu) pad.bottom = true;
      }

      // Invalid pad size
      if (w > 2147483647 || h > 2147483647) return;

      if (pad_layer === '~TSM' || pad_layer === '~BSM') {
        if (w > 0.0 && h > 0.0) {
          pad.mask_width = KiROUND(w);
          pad.mask_height = KiROUND(h);
        }

        return;
      }

      if (pad_layer === '~TSP' || pad_layer === '~BSP') {
        if (w > 0.0 && h > 0.0) {
          pad.paste_width = KiROUND(w);
          pad.paste_height = KiROUND(h);
        }

        return;
      }

      /// All remaining technical layers are not handled
      if (pad_layer[0] === '~') return;

      const layer_x_offset = KiROUND(this.readDouble(pad_xoff) * scale_factor);
      const layer_y_offset = -KiROUND(this.readDouble(pad_yoff) * scale_factor);

      if (recnum === 1) {
        pad.x_offset = layer_x_offset;
        pad.y_offset = layer_y_offset;
      }

      if (w > 0.0 && h > 0.0) {
        const layer_data = newPadLayer();
        layer_data.width = KiROUND(w);
        layer_data.height = KiROUND(h);
        layer_data.x_offset = layer_x_offset;
        layer_data.y_offset = layer_y_offset;

        if (pad_shape === 'CIRCLE') {
          layer_data.height = layer_data.width;
          layer_data.shape = PAD_SHAPE.CIRCLE;
        } else if (pad_shape === 'RECTANGLE') {
          layer_data.shape = PAD_SHAPE.RECTANGLE;
        } else if (pad_shape === 'ROUNDED_RECT') {
          layer_data.shape = PAD_SHAPE.ROUNDRECT;
        } else if (pad_shape === 'SQUARE') {
          layer_data.shape = PAD_SHAPE.RECTANGLE;
          layer_data.height = layer_data.width;
        } else if (pad_shape === 'OBLONG' || pad_shape === 'OBLONG_X' || pad_shape === 'OBLONG_Y') {
          layer_data.shape = PAD_SHAPE.OVAL;
        } else if (pad_shape === 'OCTAGON') {
          layer_data.shape = PAD_SHAPE.RECTANGLE;
          layer_data.is_octogon = true;
        } else if (pad_shape === 'SHAPE') {
          layer_data.shape = PAD_SHAPE.CUSTOM;
          layer_data.custom_name = pad_shapename;
        } else {
          // Unknown pad shape name
          return;
        }

        pad.layer_shapes.set(pad_layer, layer_data);

        if (recnum === 1) {
          pad.width = layer_data.width;
          pad.height = layer_data.height;
          pad.shape = layer_data.shape;
          pad.is_octogon = layer_data.is_octogon;
          pad.via = pad_is_via === '' || toupper(pad_is_via[0]!) !== 'V';

          if (layer_data.shape === PAD_SHAPE.CUSTOM) pad.custom_name = pad_shapename;
        }
      }
    });

    return rownum - aRow;
  }

  private processSimpleLayers(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const layer_class_col = this.getColFromName(aRow, 'CLASS');
    const layer_subclass_col = this.getColFromName(aRow, 'SUBCLASS');

    if (layer_class_col < 0 || layer_subclass_col < 0) return -1;

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      const key = row[layer_subclass_col]!;
      let layer = this.layers.get(key);

      if (!layer) {
        layer = new FABMASTER_LAYER();
        this.layers.set(key, layer);
      }

      layer.name = row[layer_subclass_col]!;
      layer.positive = true;
      layer.conductive = false;

      if (row[layer_class_col] === 'ANTI ETCH') {
        layer.positive = false;
        layer.conductive = true;
      } else if (row[layer_class_col] === 'ETCH') {
        layer.conductive = true;
      }
    });

    return rownum - aRow;
  }

  private assignLayers(): boolean {
    const extra_layers: [string, number][] = [
      ['ASSEMBLY_TOP', PCB_LAYER_ID.F_Fab],
      ['ASSEMBLY_BOTTOM', PCB_LAYER_ID.B_Fab],
      ['PLACE_BOUND_TOP', PCB_LAYER_ID.F_CrtYd],
      ['PLACE_BOUND_BOTTOM', PCB_LAYER_ID.B_CrtYd],
    ];

    const layer_order: FABMASTER_LAYER[] = [];

    let next_user_layer: number = PCB_LAYER_ID.User_1;

    for (const key of sortedKeys(this.layers)) {
      const layer = this.layers.get(key)!;
      layer.layerid = PCB_LAYER_ID.UNSELECTED_LAYER;

      if (layer.conductive) {
        layer_order.push(layer);
      } else if (
        (layer.name.includes('SILK') && !layer.name.includes('AUTOSILK')) || // Skip the autosilk layer
        layer.name.includes('DISPLAY')
      ) {
        if (layer.name.includes('B')) layer.layerid = PCB_LAYER_ID.B_SilkS;
        else layer.layerid = PCB_LAYER_ID.F_SilkS;
      } else if (layer.name.includes('MASK') || layer.name.includes('MSK')) {
        if (layer.name.includes('B')) layer.layerid = PCB_LAYER_ID.B_Mask;
        else layer.layerid = PCB_LAYER_ID.F_Mask;
      } else if (layer.name.includes('PAST')) {
        if (layer.name.includes('B')) layer.layerid = PCB_LAYER_ID.B_Paste;
        else layer.layerid = PCB_LAYER_ID.F_Paste;
      } else if (layer.name.includes('NCLEGEND')) {
        layer.layerid = PCB_LAYER_ID.Dwgs_User;
      } else {
        // Try to gather as many other layers into user layers as possible

        // Skip ones that seem like a waste of good layers
        if (!layer.name.includes('AUTOSILK')) {
          if (next_user_layer <= PCB_LAYER_ID.User_9) {
            // Assign the mapping
            layer.layerid = next_user_layer;
            next_user_layer += 2;
          } else {
            // Out of additional layers
            layer.disable = true;
          }
        }
      }
    }

    stdSort(layer_order, (lhs, rhs) => lhs.id < rhs.id);

    for (let layeri = 0; layeri < layer_order.length; ++layeri) {
      const layer = layer_order[layeri]!;

      if (layeri === 0) layer.layerid = PCB_LAYER_ID.F_Cu;
      else if (layeri === layer_order.length - 1) layer.layerid = PCB_LAYER_ID.B_Cu;
      else layer.layerid = layeri * 2 + 2;
    }

    /// Back fill the missing layers so that they are all mapped
    for (const [name, id] of extra_layers) {
      const existing = this.layers.get(name);

      if (!existing) {
        const new_layer = new FABMASTER_LAYER();
        new_layer.name = name;
        new_layer.layerid = id;
        new_layer.conductive = false;
        this.layers.set(name, new_layer);
      } else {
        existing.layerid = id;
        existing.disable = false;
      }
    }

    return true;
  }

  /**
   * A!LAYER_SORT!LAYER_SUBCLASS!LAYER_ARTWORK!LAYER_USE!LAYER_CONDUCTOR!LAYER_DIELECTRIC_CONSTANT!
   * LAYER_ELECTRICAL_CONDUCTIVITY!LAYER_MATERIAL!LAYER_SHIELD_LAYER!LAYER_THERMAL_CONDUCTIVITY!
   * LAYER_THICKNESS!
   */
  private processLayers(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const col = (s: string) => this.getColFromName(aRow, s);
    const layer_sort_col = col('LAYERSORT');
    const layer_subclass_col = col('LAYERSUBCLASS');
    const layer_art_col = col('LAYERARTWORK');
    const layer_use_col = col('LAYERUSE');
    const layer_cond_col = col('LAYERCONDUCTOR');
    const layer_er_col = col('LAYERDIELECTRICCONSTANT');
    const layer_rho_col = col('LAYERELECTRICALCONDUCTIVITY');
    const layer_mat_col = col('LAYERMATERIAL');

    if (
      layer_sort_col < 0 ||
      layer_subclass_col < 0 ||
      layer_art_col < 0 ||
      layer_use_col < 0 ||
      layer_cond_col < 0 ||
      layer_er_col < 0 ||
      layer_rho_col < 0 ||
      layer_mat_col < 0
    )
      return -1;

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      const layer_sort = row[layer_sort_col]!;
      const layer_subclass = row[layer_subclass_col]!;
      const layer_art = row[layer_art_col]!;
      const layer_cond = row[layer_cond_col]!;
      const layer_mat = row[layer_mat_col]!;

      if (layer_mat === 'AIR') return;

      const layer = new FABMASTER_LAYER();

      if (layer_subclass === '') {
        if (layer_cond !== 'NO') layer.name = `In.Cu${layer_sort}`;
        else layer.name = `Dielectric${layer_sort}`;
      }

      layer.positive = layer_art !== 'NEGATIVE';

      // `std::map::emplace` keeps an existing entry
      if (!this.layers.has(layer.name)) this.layers.set(layer.name, layer);
    });

    return rownum - aRow;
  }

  /**
   * A!SUBCLASS!PAD_SHAPE_NAME!GRAPHIC_DATA_NAME!GRAPHIC_DATA_NUMBER!RECORD_TAG!GRAPHIC_DATA_1!
   * GRAPHIC_DATA_2!GRAPHIC_DATA_3!GRAPHIC_DATA_4!GRAPHIC_DATA_5!GRAPHIC_DATA_6!GRAPHIC_DATA_7!
   * GRAPHIC_DATA_8!GRAPHIC_DATA_9!PAD_STACK_NAME!REFDES!PIN_NUMBER!
   */
  private processCustomPads(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const col = (s: string) => this.getColFromName(aRow, s);
    const pad_subclass_col = col('SUBCLASS');
    const pad_shape_name_col = col('PADSHAPENAME');
    const pad_grdata_name_col = col('GRAPHICDATANAME');
    const pad_grdata_num_col = col('GRAPHICDATANUMBER');
    const pad_record_tag_col = col('RECORDTAG');
    const grdata = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => col(`GRAPHICDATA${i}`));
    const pad_stack_name_col = col('PADSTACKNAME');
    const pad_refdes_col = col('REFDES');
    const pad_pin_num_col = col('PINNUMBER');

    if (
      pad_subclass_col < 0 ||
      pad_shape_name_col < 0 ||
      grdata.some((c) => c < 0) ||
      pad_stack_name_col < 0 ||
      pad_refdes_col < 0 ||
      pad_pin_num_col < 0
    )
      return -1;

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      const pad_layer = row[pad_subclass_col]!;
      const pad_shape_name = row[pad_shape_name_col]!;
      const pad_record_tag = row[pad_record_tag_col]!;

      const gr_data = this.graphicData(row, pad_grdata_name_col, pad_grdata_num_col, grdata);

      const pad_stack_name = row[pad_stack_name_col]!;
      const pad_refdes = row[pad_refdes_col]!;
      const pad_pin_num = row[pad_pin_num_col]!;

      // N.B. We get the FIGSHAPE records as "FIG_SHAPE name".  We only want "name"
      // and we don't process other pad shape records
      const prefix = 'FIG_SHAPE ';

      if (pad_shape_name.length <= prefix.length || !pad_shape_name.startsWith(prefix)) return;

      // Custom pads are a series of records with the same record ID but incrementing
      // Sequence numbers.
      const ids = scanInts(pad_record_tag, 2);

      if (ids.length !== 2) return;

      const [id, seq] = ids as [number, number];

      let name = pad_shape_name.slice(prefix.length);
      name += `_${pad_refdes}_${pad_pin_num}`;

      let custom_pad = this.pad_shapes.get(name);

      if (!custom_pad) {
        custom_pad = new FABMASTER_PAD_SHAPE();
        this.pad_shapes.set(name, custom_pad);
        custom_pad.name = name;
        custom_pad.padstack = pad_stack_name;
        custom_pad.pinnum = pad_pin_num;
        custom_pad.refdes = pad_refdes;
      }

      // At this point we extract the individual graphical elements for processing the complex
      // pad.  The coordinates are in board origin format, so we'll need to fix the offset later
      // when we assign them to the modules.

      const gr_item = this.processGraphic(gr_data, scale_factor);

      if (gr_item) {
        gr_item.layer = pad_layer;
        gr_item.refdes = pad_refdes;
        gr_item.seq = seq;
        gr_item.subseq = 0;

        let el = custom_pad.elements.get(id);

        if (!el) {
          el = new graphic_element();
          custom_pad.elements.set(id, el);
        }

        el.insert(gr_item);
      }
    });

    return rownum - aRow;
  }

  private graphicData(
    row: single_row,
    aNameCol: number,
    aNumCol: number,
    aDataCols: number[],
  ): GRAPHIC_DATA {
    const d = (i: number) => row[aDataCols[i]!]!;

    return {
      graphic_dataname: row[aNameCol]!,
      graphic_datanum: row[aNumCol]!,
      graphic_data1: d(0),
      graphic_data2: d(1),
      graphic_data3: d(2),
      graphic_data4: d(3),
      graphic_data5: d(4),
      graphic_data6: d(5),
      graphic_data7: d(6),
      graphic_data8: d(7),
      graphic_data9: d(8),
      graphic_data10: '',
    };
  }

  private processLine(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_LINE {
    const new_line = new GRAPHIC_LINE();

    new_line.shape = GRAPHIC_SHAPE.GR_SHAPE_LINE;
    new_line.start_x = KiROUND(this.readDouble(aData.graphic_data1) * aScale);
    new_line.start_y = -KiROUND(this.readDouble(aData.graphic_data2) * aScale);
    new_line.end_x = KiROUND(this.readDouble(aData.graphic_data3) * aScale);
    new_line.end_y = -KiROUND(this.readDouble(aData.graphic_data4) * aScale);
    new_line.width = KiROUND(this.readDouble(aData.graphic_data5) * aScale);

    return new_line;
  }

  private processArc(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_ARC {
    const new_arc = new GRAPHIC_ARC();

    new_arc.shape = GRAPHIC_SHAPE.GR_SHAPE_ARC;
    new_arc.start_x = KiROUND(this.readDouble(aData.graphic_data1) * aScale);
    new_arc.start_y = -KiROUND(this.readDouble(aData.graphic_data2) * aScale);
    new_arc.end_x = KiROUND(this.readDouble(aData.graphic_data3) * aScale);
    new_arc.end_y = -KiROUND(this.readDouble(aData.graphic_data4) * aScale);
    new_arc.center_x = KiROUND(this.readDouble(aData.graphic_data5) * aScale);
    new_arc.center_y = -KiROUND(this.readDouble(aData.graphic_data6) * aScale);
    new_arc.radius = KiROUND(this.readDouble(aData.graphic_data7) * aScale);
    new_arc.width = KiROUND(this.readDouble(aData.graphic_data8) * aScale);

    new_arc.clockwise = aData.graphic_data9 !== 'COUNTERCLOCKWISE';

    const startangle = EDA_ANGLE.fromVector({
      x: new_arc.start_x - new_arc.center_x,
      y: new_arc.start_y - new_arc.center_y,
    });
    const endangle = EDA_ANGLE.fromVector({
      x: new_arc.end_x - new_arc.center_x,
      y: new_arc.end_y - new_arc.center_y,
    });

    startangle.Normalize();
    endangle.Normalize();

    const center: VECTOR2I = { x: new_arc.center_x, y: new_arc.center_y };
    const start: VECTOR2I = { x: new_arc.start_x, y: new_arc.start_y };
    let mid: VECTOR2I = { x: new_arc.start_x, y: new_arc.start_y };
    const end: VECTOR2I = { x: new_arc.end_x, y: new_arc.end_y };

    let angle = endangle.sub(startangle);

    if (new_arc.clockwise && angle.lt(ANGLE_0)) angle = angle.add(ANGLE_360);

    if (!new_arc.clockwise && angle.gt(ANGLE_0)) angle = angle.sub(ANGLE_360);

    const sameEnds = start.x === end.x && start.y === end.y;

    if (sameEnds) angle = ANGLE_360.negate();

    mid = RotatePoint(mid, center, angle.negate().divide(2.0));

    if (sameEnds) new_arc.shape = GRAPHIC_SHAPE.GR_SHAPE_CIRCLE;

    new_arc.result = new SHAPE_ARC(start, mid, end, 0);

    return new_arc;
  }

  private processCircle(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_ARC | null {
    const new_circle = new GRAPHIC_ARC();

    new_circle.shape = GRAPHIC_SHAPE.GR_SHAPE_CIRCLE;

    const center: VECTOR2I = {
      x: KiROUND(this.readDouble(aData.graphic_data1) * aScale),
      y: -KiROUND(this.readDouble(aData.graphic_data2) * aScale),
    };

    const size: VECTOR2I = {
      x: KiROUND(this.readDouble(aData.graphic_data3) * aScale),
      y: KiROUND(this.readDouble(aData.graphic_data4) * aScale),
    };

    // Circle with unequal x and y radii
    if (size.x !== size.y) return null;

    new_circle.width = KiROUND(this.readDouble(aData.graphic_data5) * aScale);

    new_circle.radius = Math.trunc(size.x / 2);

    // Fake up a 360-degree arc
    const start: VECTOR2I = { x: center.x - new_circle.radius, y: center.y };
    const mid: VECTOR2I = { x: center.x + new_circle.radius, y: center.y };

    new_circle.start_x = start.x;
    new_circle.start_y = start.y;

    new_circle.end_x = start.x;
    new_circle.end_y = start.y;

    new_circle.center_x = center.x;
    new_circle.center_y = center.y;

    new_circle.clockwise = true;

    new_circle.result = new SHAPE_ARC(start, mid, start, 0);

    return new_circle;
  }

  private processRectangle(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_RECTANGLE {
    const new_rect = new GRAPHIC_RECTANGLE();

    new_rect.shape = GRAPHIC_SHAPE.GR_SHAPE_RECTANGLE;
    new_rect.start_x = KiROUND(this.readDouble(aData.graphic_data1) * aScale);
    new_rect.start_y = -KiROUND(this.readDouble(aData.graphic_data2) * aScale);
    new_rect.end_x = KiROUND(this.readDouble(aData.graphic_data3) * aScale);
    new_rect.end_y = -KiROUND(this.readDouble(aData.graphic_data4) * aScale);
    new_rect.fill = aData.graphic_data5 === '1';
    new_rect.width = 0;

    return new_rect;
  }

  private processFigRectangle(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_RECTANGLE {
    const new_rect = new GRAPHIC_RECTANGLE();

    const center_x = KiROUND(this.readDouble(aData.graphic_data1) * aScale);
    const center_y = -KiROUND(this.readDouble(aData.graphic_data2) * aScale);
    const size_x = KiROUND(this.readDouble(aData.graphic_data3) * aScale);
    const size_y = KiROUND(this.readDouble(aData.graphic_data4) * aScale);

    new_rect.shape = GRAPHIC_SHAPE.GR_SHAPE_RECTANGLE;
    new_rect.start_x = center_x - Math.trunc(size_x / 2);
    new_rect.start_y = center_y + Math.trunc(size_y / 2);
    new_rect.end_x = center_x + Math.trunc(size_x / 2);
    new_rect.end_y = center_y - Math.trunc(size_y / 2);
    new_rect.fill = aData.graphic_data5 === '1';
    new_rect.width = 0;

    return new_rect;
  }

  private processSquare(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_RECTANGLE {
    // Square is just a rectangle with equal sides, and it's a
    // center-based shape, so just reuse the FIG_RECTANGLE code.
    return this.processFigRectangle(aData, aScale);
  }

  private processOblong(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_OBLONG {
    const new_oblong = new GRAPHIC_OBLONG();

    new_oblong.shape = GRAPHIC_SHAPE.GR_SHAPE_OBLONG;
    new_oblong.oblong_x = aData.graphic_dataname === 'OBLONG_X';
    new_oblong.start_x = KiROUND(this.readDouble(aData.graphic_data1) * aScale);
    new_oblong.start_y = -KiROUND(this.readDouble(aData.graphic_data2) * aScale);
    new_oblong.size_x = KiROUND(this.readDouble(aData.graphic_data3) * aScale);
    new_oblong.size_y = KiROUND(this.readDouble(aData.graphic_data4) * aScale);
    new_oblong.width = KiROUND(this.readDouble(aData.graphic_data5) * aScale);

    return new_oblong;
  }

  private processPolygon(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_POLYGON | null {
    const c = {
      x: this.readDouble(aData.graphic_data1) * aScale,
      y: -this.readDouble(aData.graphic_data2) * aScale,
    };

    const s = {
      x: this.readDouble(aData.graphic_data3) * aScale,
      y: this.readDouble(aData.graphic_data4) * aScale,
    };

    const new_poly = new GRAPHIC_POLYGON();

    new_poly.shape = GRAPHIC_SHAPE.GR_SHAPE_POLYGON;
    new_poly.width = KiROUND(this.readDouble(aData.graphic_data5) * aScale);

    // `int radius = s.x / 2`: truncated
    const radius = toInt(s.x / 2);

    let across_corners = true;
    let pt0_angle = ANGLE_90;
    let n_pts = 0;

    if (aData.graphic_dataname === 'TRIANGLE_1') {
      n_pts = 3;
    } else if (aData.graphic_dataname === 'DIAMOND') {
      n_pts = 4;
    } else if (aData.graphic_dataname === 'HEXAGON_X') {
      n_pts = 6;
      pt0_angle = ANGLE_0;
    } else if (aData.graphic_dataname === 'HEXAGON_Y') {
      n_pts = 6;
    } else if (aData.graphic_dataname === 'OCTAGON') {
      across_corners = false;
      pt0_angle = FULL_CIRCLE.divide(16);
      n_pts = 8;
    } else {
      // Unhandled polygon type
      return null;
    }

    // VECTOR2I( VECTOR2D ): each coordinate truncated
    new_poly.m_pts = KIGEOM_MakeRegularPolygonPoints(
      { x: toInt(c.x), y: toInt(c.y) },
      n_pts,
      radius,
      across_corners,
      pt0_angle,
    );

    return new_poly;
  }

  private processCross(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_CROSS {
    const new_cross = new GRAPHIC_CROSS();

    new_cross.shape = GRAPHIC_SHAPE.GR_SHAPE_CROSS;
    new_cross.start_x = KiROUND(this.readDouble(aData.graphic_data1) * aScale);
    new_cross.start_y = -KiROUND(this.readDouble(aData.graphic_data2) * aScale);
    new_cross.size_x = KiROUND(this.readDouble(aData.graphic_data3) * aScale);
    new_cross.size_y = KiROUND(this.readDouble(aData.graphic_data4) * aScale);
    new_cross.width = KiROUND(this.readDouble(aData.graphic_data5) * aScale);

    return new_cross;
  }

  private processText(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_TEXT {
    const new_text = new GRAPHIC_TEXT();

    new_text.shape = GRAPHIC_SHAPE.GR_SHAPE_TEXT;
    new_text.start_x = KiROUND(this.readDouble(aData.graphic_data1) * aScale);
    new_text.start_y = -KiROUND(this.readDouble(aData.graphic_data2) * aScale);
    new_text.rotation = KiROUND(this.readDouble(aData.graphic_data3));
    new_text.mirror = aData.graphic_data4 === 'YES';

    if (aData.graphic_data5 === 'RIGHT') new_text.orient = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
    else if (aData.graphic_data5 === 'CENTER')
      new_text.orient = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
    else new_text.orient = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;

    const toks = split(aData.graphic_data6, ' \t');

    // We expect 8 parameters, but the 8th is the thickness which is not always present
    if (toks.length < 8) {
      // Log the error
      new_text.height = 0;
      new_text.width = 0;
      new_text.ital = false;
      new_text.thickness = 0;
    } else {
      // 0 = size
      // 1 = font
      new_text.height = KiROUND(this.readDouble(toks[2]!) * aScale);
      new_text.width = KiROUND(this.readDouble(toks[3]!) * aScale);
      new_text.ital = this.readDouble(toks[4]!) !== 0.0;
      // 5 = character spacing
      // 6 = line spacing
      new_text.thickness = KiROUND(this.readDouble(toks[7]!) * aScale);
    }

    new_text.text = aData.graphic_data7;

    return new_text;
  }

  private processGraphic(aData: GRAPHIC_DATA, aScale: number): GRAPHIC_ITEM | null {
    const n = aData.graphic_dataname;

    if (n === 'LINE') return this.processLine(aData, aScale);

    if (n === 'ARC') return this.processArc(aData, aScale);

    if (n === 'CIRCLE') return this.processCircle(aData, aScale);

    if (n === 'RECTANGLE') return this.processRectangle(aData, aScale);

    if (n === 'FIG_RECTANGLE') return this.processFigRectangle(aData, aScale);

    if (n === 'SQUARE') return this.processSquare(aData, aScale);

    if (n === 'OBLONG_X' || n === 'OBLONG_Y') return this.processOblong(aData, aScale);

    if (
      n === 'TRIANGLE_1' ||
      n === 'DIAMOND' ||
      n === 'HEXAGON_X' ||
      n === 'HEXAGON_Y' ||
      n === 'OCTAGON'
    )
      return this.processPolygon(aData, aScale);

    if (n === 'CROSS') return this.processCross(aData, aScale);

    if (n === 'TEXT') return this.processText(aData, aScale);

    // `graphic_data10` (the CONNECT / NOTCONNECT type) is never filled by a caller
    return null;
  }

  /**
   * A!GRAPHIC_DATA_NAME!GRAPHIC_DATA_NUMBER!RECORD_TAG!GRAPHIC_DATA_1!GRAPHIC_DATA_2!GRAPHIC_DATA_3!
   * GRAPHIC_DATA_4!GRAPHIC_DATA_5!GRAPHIC_DATA_6!GRAPHIC_DATA_7!GRAPHIC_DATA_8!GRAPHIC_DATA_9!
   * SUBCLASS!SYM_NAME!REFDES!
   */
  private processGeometry(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const col = (s: string) => this.getColFromName(aRow, s);
    const geo_name_col = col('GRAPHICDATANAME');
    const geo_num_col = col('GRAPHICDATANUMBER');
    const geo_tag_col = col('RECORDTAG');
    const grdata = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => col(`GRAPHICDATA${i}`));
    const geo_subclass_col = col('SUBCLASS');
    const geo_sym_name_col = col('SYMNAME');
    const geo_refdes_col = col('REFDES');

    if (
      geo_name_col < 0 ||
      geo_num_col < 0 ||
      grdata.some((c) => c < 0) ||
      geo_subclass_col < 0 ||
      geo_sym_name_col < 0 ||
      geo_refdes_col < 0
    )
      return -1;

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      const geo_tag = row[geo_tag_col]!;

      const gr_data = this.graphicData(row, geo_name_col, geo_num_col, grdata);

      const geo_refdes = row[geo_refdes_col]!;

      // Grouped graphics are a series of records with the same record ID but incrementing
      // Sequence numbers.
      const ids = scanInts(geo_tag, 3);

      if (ids.length < 2) return;

      const id = ids[0]!;
      const seq = ids[1]!;
      const subseq = ids[2] ?? 0;

      const gr_item = this.processGraphic(gr_data, scale_factor);

      if (!gr_item) return;

      gr_item.layer = row[geo_subclass_col]!;
      gr_item.seq = seq;
      gr_item.subseq = subseq;

      if (geo_refdes === '') {
        if (
          this.board_graphics.length === 0 ||
          this.board_graphics[this.board_graphics.length - 1]!.id !== id
        ) {
          const new_gr = new GEOM_GRAPHIC();
          new_gr.subclass = row[geo_subclass_col]!;
          new_gr.refdes = row[geo_refdes_col]!;
          new_gr.name = row[geo_sym_name_col]!;
          new_gr.id = id;
          new_gr.elements = new graphic_element();
          this.board_graphics.push(new_gr);
        }

        const graphic = this.board_graphics[this.board_graphics.length - 1]!;
        graphic.elements!.insert(gr_item);
      } else {
        let sym_gr = this.comp_graphics.get(geo_refdes);

        if (!sym_gr) {
          sym_gr = new Map();
          this.comp_graphics.set(geo_refdes, sym_gr);
        }

        let gr = sym_gr.get(id);

        if (!gr) {
          gr = new GEOM_GRAPHIC();
          sym_gr.set(id, gr);
          gr.subclass = row[geo_subclass_col]!;
          gr.refdes = row[geo_refdes_col]!;
          gr.name = row[geo_sym_name_col]!;
          gr.id = id;
          gr.elements = new graphic_element();
        }

        gr.elements!.insert(gr_item);
      }
    });

    return rownum - aRow;
  }

  /** A!VIA_X!VIA_Y!PAD_STACK_NAME!NET_NAME!TEST_POINT! */
  private processVias(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const viax_col = this.getColFromName(aRow, 'VIAX');
    const viay_col = this.getColFromName(aRow, 'VIAY');
    const padstack_name_col = this.getColFromName(aRow, 'PADSTACKNAME');
    const net_name_col = this.getColFromName(aRow, 'NETNAME');
    const test_point_col = this.getColFromName(aRow, 'TESTPOINT');

    if (
      viax_col < 0 ||
      viay_col < 0 ||
      padstack_name_col < 0 ||
      net_name_col < 0 ||
      test_point_col < 0
    )
      return -1;

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      this.vias.push({
        x: KiROUND(this.readDouble(row[viax_col]!) * scale_factor),
        y: -KiROUND(this.readDouble(row[viay_col]!) * scale_factor),
        padstack: row[padstack_name_col]!,
        net: row[net_name_col]!,
        test_point: row[test_point_col] === 'YES',
        mirror: false,
      });
    });

    return rownum - aRow;
  }

  /**
   * A!CLASS!SUBCLASS!GRAPHIC_DATA_NAME!GRAPHIC_DATA_NUMBER!RECORD_TAG!GRAPHIC_DATA_1!
   * GRAPHIC_DATA_2!GRAPHIC_DATA_3!GRAPHIC_DATA_4!GRAPHIC_DATA_5!GRAPHIC_DATA_6!GRAPHIC_DATA_7!
   * GRAPHIC_DATA_8!GRAPHIC_DATA_9!NET_NAME!
   */
  private processTraces(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const col = (s: string) => this.getColFromName(aRow, s);
    const class_col = col('CLASS');
    const layer_col = col('SUBCLASS');
    const grdata_name_col = col('GRAPHICDATANAME');
    const grdata_num_col = col('GRAPHICDATANUMBER');
    const tag_col = col('RECORDTAG');
    const grdata = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => col(`GRAPHICDATA${i}`));
    const netname_col = col('NETNAME');

    if (
      class_col < 0 ||
      layer_col < 0 ||
      grdata_name_col < 0 ||
      grdata_num_col < 0 ||
      tag_col < 0 ||
      grdata.some((c) => c < 0) ||
      netname_col < 0
    )
      return -1;

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      const gr_data = this.graphicData(row, grdata_name_col, grdata_num_col, grdata);

      const geo_tag = row[tag_col]!;

      // Grouped graphics are a series of records with the same record ID but incrementing
      // Sequence numbers.
      const ids = scanInts(geo_tag, 3);

      if (ids.length < 2) return;

      const id = ids[0]!;
      const seq = ids[1]!;
      const subseq = ids[2] ?? 0;

      const gr_item = this.processGraphic(gr_data, scale_factor);

      if (!gr_item) return;

      const new_trace = new TRACE();
      new_trace.id = id;
      new_trace.layer = row[layer_col]!;
      new_trace.netname = row[netname_col]!;
      new_trace.lclass = row[class_col]!;

      gr_item.layer = row[layer_col]!;
      gr_item.seq = seq;
      gr_item.subseq = subseq;

      // Collect the reference designator positions for the footprints later
      if (new_trace.lclass === 'REF DES') {
        const ref = this.refdes.emplace(new_trace);
        ref.segment.insert(gr_item);
      } else if (
        new_trace.lclass === 'DEVICE TYPE' ||
        new_trace.lclass === 'COMPONENT VALUE' ||
        new_trace.lclass === 'TOLERANCE'
      ) {
        //TODO: This seems like a value field, but it is not immediately clear how best
        // to add it to the footprint (if at all).
      } else if (gr_item.width === 0) {
        const zone = this.zones.emplace(new_trace);
        zone.segment.insert(gr_item);
      } else {
        const trace = this.traces.emplace(new_trace);
        trace.segment.insert(gr_item);
      }
    });

    return rownum - aRow;
  }

  private parseSymType(aSymType: string): SYMTYPE {
    if (aSymType === 'PACKAGE') return SYMTYPE.SYMTYPE_PACKAGE;
    else if (aSymType === 'DRAFTING') return SYMTYPE.SYMTYPE_DRAFTING;
    else if (aSymType === 'MECHANICAL') return SYMTYPE.SYMTYPE_MECH;
    else if (aSymType === 'FORMAT') return SYMTYPE.SYMTYPE_FORMAT;

    return SYMTYPE.SYMTYPE_NONE;
  }

  private parseCompClass(aCmpClass: string): COMPCLASS {
    if (aCmpClass === 'IO') return COMPCLASS.COMPCLASS_IO;
    else if (aCmpClass === 'IC') return COMPCLASS.COMPCLASS_IC;
    else if (aCmpClass === 'DISCRETE') return COMPCLASS.COMPCLASS_DISCRETE;

    return COMPCLASS.COMPCLASS_NONE;
  }

  /**
   * A!REFDES!COMP_CLASS!COMP_PART_NUMBER!COMP_HEIGHT!COMP_DEVICE_LABEL!COMP_INSERTION_CODE!
   * SYM_TYPE!SYM_NAME!SYM_MIRROR!SYM_ROTATE!SYM_X!SYM_Y!COMP_VALUE!COMP_TOL!COMP_VOLTAGE!
   */
  private processFootprints(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const col = (s: string) => this.getColFromName(aRow, s);
    const refdes_col = col('REFDES');
    const compclass_col = col('COMPCLASS');
    const comppartnum_col = col('COMPPARTNUMBER');
    const compheight_col = col('COMPHEIGHT');
    const compdevlabelcol = col('COMPDEVICELABEL');
    const compinscode_col = col('COMPINSERTIONCODE');
    const symtype_col = col('SYMTYPE');
    const symname_col = col('SYMNAME');
    const symmirror_col = col('SYMMIRROR');
    const symrotate_col = col('SYMROTATE');
    const symx_col = col('SYMX');
    const symy_col = col('SYMY');
    const compvalue_col = col('COMPVALUE');
    const comptol_col = col('COMPTOL');
    const compvolt_col = col('COMPVOLTAGE');

    if (
      [
        refdes_col,
        compclass_col,
        comppartnum_col,
        compheight_col,
        compdevlabelcol,
        compinscode_col,
        symtype_col,
        symname_col,
        symmirror_col,
        symrotate_col,
        symx_col,
        symy_col,
        compvalue_col,
        comptol_col,
        compvolt_col,
      ].some((c) => c < 0)
    )
      return -1;

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      // `const wxString& comp_refdes = row[refdes_col]`: through wx and back
      const comp_refdes = row[refdes_col]!;

      // Missing X, Y, or rotation data: this may be an unplaced component.
      if (row[symx_col] === '' || row[symy_col] === '' || row[symrotate_col] === '') return;

      const cmp = new COMPONENT();
      cmp.refdes = comp_refdes;
      cmp.cclass = this.parseCompClass(row[compclass_col]!);
      cmp.pn = row[comppartnum_col]!;
      cmp.height = row[compheight_col]!;
      cmp.dev_label = row[compdevlabelcol]!;
      cmp.insert_code = row[compinscode_col]!;
      cmp.type = this.parseSymType(row[symtype_col]!);
      cmp.name = row[symname_col]!;
      cmp.mirror = row[symmirror_col] === 'YES';
      cmp.rotate = this.readDouble(row[symrotate_col]!);
      cmp.x = KiROUND(this.readDouble(row[symx_col]!) * scale_factor);
      cmp.y = -KiROUND(this.readDouble(row[symy_col]!) * scale_factor);
      cmp.value = row[compvalue_col]!;
      cmp.tol = row[comptol_col]!;
      cmp.voltage = row[compvolt_col]!;

      let vec = this.components.get(cmp.refdes);

      if (!vec) {
        vec = [];
        this.components.set(cmp.refdes, vec);
      }

      vec.push(cmp);
    });

    return rownum - aRow;
  }

  /**
   * A!SYM_NAME!SYM_MIRROR!PIN_NAME!PIN_NUMBER!PIN_X!PIN_Y!PAD_STACK_NAME!REFDES!PIN_ROTATION!
   * TEST_POINT!
   */
  private processPins(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const col = (s: string) => this.getColFromName(aRow, s);
    const symname_col = col('SYMNAME');
    const symmirror_col = col('SYMMIRROR');
    const pinname_col = col('PINNAME');
    const pinnum_col = col('PINNUMBER');
    const pinx_col = col('PINX');
    const piny_col = col('PINY');
    const padstack_col = col('PADSTACKNAME');
    const refdes_col = col('REFDES');
    const pinrot_col = col('PINROTATION');
    const testpoint_col = col('TESTPOINT');

    if (
      [
        symname_col,
        symmirror_col,
        pinname_col,
        pinnum_col,
        pinx_col,
        piny_col,
        padstack_col,
        refdes_col,
        pinrot_col,
        testpoint_col,
      ].some((c) => c < 0)
    )
      return -1;

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      const pin = new PIN();

      pin.name = row[symname_col]!;
      pin.mirror = row[symmirror_col] === 'YES';
      pin.pin_name = row[pinname_col]!;
      pin.pin_number = row[pinnum_col]!;
      pin.pin_x = KiROUND(this.readDouble(row[pinx_col]!) * scale_factor);
      pin.pin_y = -KiROUND(this.readDouble(row[piny_col]!) * scale_factor);
      pin.padstack = row[padstack_col]!;
      pin.refdes = row[refdes_col]!;
      pin.rotation = this.readDouble(row[pinrot_col]!);

      // Use refdes as primary key, fall back to symbol name for unplaced pins
      const pin_key = pin.refdes === '' ? pin.name : pin.refdes;

      let set = this.pins.get(pin_key);

      if (!set) {
        set = new PIN_SET();
        this.pins.set(pin_key, set);
      }

      set.insert(pin);
    });

    return rownum - aRow;
  }

  /** A!NET_NAME!REFDES!PIN_NUMBER!PIN_NAME!PIN_GROUND!PIN_POWER! */
  private processNets(aRow: number): number {
    if (aRow + 2 >= this.rows.length) return -1;

    const header = this.rows[aRow]!;
    const scale_factor = this.processScaleFactor(aRow + 1);

    if (scale_factor <= 0.0) return -1;

    const netname_col = this.getColFromName(aRow, 'NETNAME');
    const refdes_col = this.getColFromName(aRow, 'REFDES');
    const pinnum_col = this.getColFromName(aRow, 'PINNUMBER');
    const pinname_col = this.getColFromName(aRow, 'PINNAME');
    const pingnd_col = this.getColFromName(aRow, 'PINGROUND');
    const pinpwr_col = this.getColFromName(aRow, 'PINPOWER');

    if (
      netname_col < 0 ||
      refdes_col < 0 ||
      pinnum_col < 0 ||
      pinname_col < 0 ||
      pingnd_col < 0 ||
      pinpwr_col < 0
    )
      return -1;

    const rownum = this.sectionRows(aRow, (row) => {
      if (row.length !== header.length) return;

      const new_net: NETNAME = {
        name: row[netname_col]!,
        refdes: row[refdes_col]!,
        pin_num: row[pinnum_col]!,
        pin_name: row[pinname_col]!,
        pin_gnd: row[pingnd_col] === 'YES',
        pin_pwr: row[pinpwr_col] === 'YES',
      };

      const key = `${new_net.refdes}\u0000${new_net.pin_num}`;

      if (!this.pin_nets.has(key)) this.pin_nets.set(key, new_net);

      this.netnames.add(row[netname_col]!);
    });

    return rownum - aRow;
  }

  Process(): boolean {
    for (let i = 0; i < this.rows.length; ) {
      const type = this.detectType(i);

      switch (type) {
        case section_type.EXTRACT_PADSTACKS: {
          /// This section extracts the layer information first
          this.processPadStackLayers(i);
          this.assignLayers();
          const retval = this.processPadStacks(i);

          i += Math.max(retval, 1);
          break;
        }

        case section_type.EXTRACT_FULL_LAYERS:
          i += Math.max(this.processLayers(i), 1);
          break;

        case section_type.EXTRACT_BASIC_LAYERS:
          i += Math.max(this.processSimpleLayers(i), 1);
          break;

        case section_type.EXTRACT_VIAS:
          i += Math.max(this.processVias(i), 1);
          break;

        case section_type.EXTRACT_TRACES:
          i += Math.max(this.processTraces(i), 1);
          break;

        case section_type.EXTRACT_REFDES:
          i += Math.max(this.processFootprints(i), 1);
          break;

        case section_type.EXTRACT_NETS:
          i += Math.max(this.processNets(i), 1);
          break;

        case section_type.EXTRACT_GRAPHICS:
          i += Math.max(this.processGeometry(i), 1);
          break;

        case section_type.EXTRACT_PINS:
          i += Math.max(this.processPins(i), 1);
          break;

        case section_type.EXTRACT_PAD_SHAPES:
          i += Math.max(this.processCustomPads(i), 1);
          break;

        default:
          ++i;
          break;
      }
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // building the board

  private loadZones(aBoard: BOARD): boolean {
    for (const zone of this.zones) {
      this.checkpoint();

      if (
        isRuleAreaClass(zone.lclass) ||
        IsCopperLayer(this.getLayer(zone.layer)) ||
        zone.layer === 'ALL'
      ) {
        this.loadZone(aBoard, zone);
      } else {
        if (zone.layer === 'OUTLINE' || zone.layer === 'DESIGN_OUTLINE')
          this.loadOutline(aBoard, zone);
        else this.loadPolygon(aBoard, zone);
      }
    }

    /**
     * Zone filling in Fabmaster is a series of polygons, each an island of copper that is
     * connected to a net.  Zones with a net > 0 are the fills; the net 0 zones are the
     * outlines. Each outline takes the net of the fills most of its vertices touch, and
     * those fills are deleted.
     */
    const zones_to_delete = new Set<ZONE>();
    const matched_fills = new Set<ZONE>();

    for (const zone of aBoard.Zones()) {
      /// Remove the filled areas in favor of the outlines
      if (zone.GetNetCode() > 0) zones_to_delete.add(zone);
    }

    for (const zone1 of aBoard.Zones()) {
      /// Zone1 will be the destination zone for the new net
      if (zone1.GetNetCode() > 0) continue;

      if (zone1.GetIsRuleArea()) continue;

      const outline1 = zone1.Outline().Outline(0);
      const overlaps: number[] = new Array(aBoard.GetNetInfo().GetNetCount() + 1).fill(0);
      const net_to_fills = new Map<number, ZONE[]>();

      for (const zone2 of aBoard.Zones()) {
        if (zone2.GetNetCode() <= 0) continue;

        const outline2 = zone2.Outline().Outline(0);

        if (zone1.GetLayer() !== zone2.GetLayer()) continue;

        if (!outline1.BBox().Intersects(outline2.BBox())) continue;

        let match_count = 0;

        for (const pt1 of outline1.CPoints()) {
          /// We're looking for the netcode with the most overlaps to the un-netted zone
          if (pointOnEdge(outline2.CPoints(), pt1, 1, outline2.IsClosed())) match_count++;
        }

        for (const pt2 of outline2.CPoints()) {
          /// The overlap between outline1 and outline2 isn't perfect, so look for overlaps
          /// in both directions
          if (pointOnEdge(outline1.CPoints(), pt2, 1, outline1.IsClosed())) match_count++;
        }

        if (match_count > 0) {
          const code = zone2.GetNetCode();
          overlaps[code] = (overlaps[code] ?? 0) + match_count;

          let fills = net_to_fills.get(code);

          if (!fills) {
            fills = [];
            net_to_fills.set(code, fills);
          }

          fills.push(zone2);
        }
      }

      let max_net = 0;
      let max_net_id = 0;

      for (let el = 1; el < overlaps.length; ++el) {
        if (overlaps[el]! > max_net) {
          max_net = overlaps[el]!;
          max_net_id = el;
        }
      }

      if (max_net > 0) {
        zone1.SetNetCode(max_net_id);

        for (const fill of net_to_fills.get(max_net_id) ?? []) matched_fills.add(fill);
      }
    }

    for (const zone of zones_to_delete) {
      if (matched_fills.has(zone)) aBoard.Remove(zone);
    }

    return true;
  }

  private static setupText(
    aGText: GRAPHIC_TEXT,
    aLayer: PCB_LAYER_ID,
    aText: PCB_TEXT,
    aBoard: BOARD,
    aMirrorPoint: VECTOR2I | null,
  ): void {
    aText.SetHorizJustify(aGText.orient);
    aText.SetKeepUpright(false);

    const angle = new EDA_ANGLE(aGText.rotation);
    angle.Normalize180();

    const halfHeight = Math.trunc(aGText.height / 2);

    if (aMirrorPoint) {
      aText.SetLayer(aBoard.FlipLayer(aLayer));
      aText.SetTextPos({
        x: aGText.start_x,
        y: 2 * aMirrorPoint.y - (aGText.start_y - halfHeight),
      });
      aText.SetMirrored(!aGText.mirror);
      aText.SetTextAngle(angle.negate().add(ANGLE_180));
    } else {
      aText.SetLayer(aLayer);
      aText.SetTextPos({ x: aGText.start_x, y: aGText.start_y - halfHeight });
      aText.SetMirrored(aGText.mirror);
      aText.SetTextAngle(angle);
    }

    if (Math.abs(angle.AsDegrees()) >= ANGLE_90.AsDegrees())
      aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);

    aText.SetText(wx(aGText.text));
    aText.SetItalic(aGText.ital);
    aText.SetTextThickness(aGText.thickness);
    aText.SetTextHeight(aGText.height);
    aText.SetTextWidth(aGText.width);
  }

  private createComponentsFromOrphanPins(): void {
    for (const pinKey of sortedKeys(this.pins)) {
      const pinSet = this.pins.get(pinKey)!;

      if (pinSet.empty()) continue;

      if (this.components.has(pinKey)) continue;

      const firstPin = pinSet.begin();
      let minX = firstPin.pin_x;
      let maxX = firstPin.pin_x;
      let minY = firstPin.pin_y;
      let maxY = firstPin.pin_y;

      for (const pin of pinSet) {
        minX = Math.min(minX, pin.pin_x);
        maxX = Math.max(maxX, pin.pin_x);
        minY = Math.min(minY, pin.pin_y);
        maxY = Math.max(maxY, pin.pin_y);
      }

      const cmp = new COMPONENT();
      cmp.refdes = pinKey;
      cmp.name = firstPin.name;
      cmp.mirror = firstPin.mirror;
      cmp.rotate = 0.0;
      cmp.x = Math.trunc((minX + maxX) / 2);
      cmp.y = Math.trunc((minY + maxY) / 2);
      cmp.type = SYMTYPE.SYMTYPE_PACKAGE;
      cmp.cclass = COMPCLASS.COMPCLASS_IC;

      if (!this.components.has(pinKey)) this.components.set(pinKey, [cmp]);
    }
  }

  private loadFootprints(aBoard: BOARD): boolean {
    const netinfo = aBoard.GetNetInfo().NetsByName();
    const ds = aBoard.GetDesignSettings();

    for (const key of sortedKeys(this.components)) {
      const mod = this.components.get(key)!;
      this.checkpoint();

      const has_multiple = mod.length > 1;

      for (let i = 0; i < mod.length; ++i) {
        const src = mod[i]!;

        const fp = new FOOTPRINT(aBoard);

        let mod_ref = wx(src.name);
        let lib_ref = this.m_filenameName;

        if (has_multiple) mod_ref += `_${i}`;

        lib_ref = ReplaceIllegalFileNameChars(lib_ref, '_');
        mod_ref = ReplaceIllegalFileNameChars(mod_ref, '_');

        const fpKey = lib_ref !== '' ? `${lib_ref}:${mod_ref}` : mod_ref;

        const fpID = new LIB_ID();
        fpID.Parse(fpKey, true);
        fp.SetFPID(fpID);

        fp.SetPosition({ x: src.x, y: src.y });
        fp.SetOrientationDegrees(-src.rotate);

        // KiCad netlisting requires parts to have non-digit + digit annotation.
        // If the reference begins with a number, we prepend 'UNK' (unknown) for the source
        // designator
        let reference = wx(src.refdes);

        if (!isalpha(src.refdes[0])) reference = `UNK${reference}`;

        fp.SetReference(reference);

        fp.SetValue(wx(src.value));
        fp.Value().SetLayer(PCB_LAYER_ID.F_Fab);
        fp.Value().SetVisible(false);

        // Hide the reference field by default. If a REF DES text is found on silkscreen, it
        // will be made visible below.
        fp.Reference().SetVisible(false);

        for (const ref of this.refdes) {
          const lsrc = ref.segment.begin() as GRAPHIC_TEXT;

          if (lsrc.text === src.refdes) {
            let txt: PCB_TEXT;
            const layer = this.getLayer(ref.layer);

            if (!IsPcbLayer(layer)) continue;

            if (layer === PCB_LAYER_ID.F_SilkS || layer === PCB_LAYER_ID.B_SilkS)
              txt = fp.Reference();
            else txt = new PCB_TEXT(fp);

            const flip_point: VECTOR2I | null = src.mirror ? { x: src.x, y: src.y } : null;

            const fp_angle = new EDA_ANGLE(lsrc.rotation).Normalized();
            txt.SetTextAngle(fp_angle);

            FABMASTER.setupText(lsrc, layer, txt, aBoard, flip_point);

            if (txt !== fp.Reference()) fp.Add(txt, ADD_MODE.APPEND);
          }
        }

        /// Always set the footprint to the top and flip later if needed
        /// When flipping later, we get the correct layer information
        fp.SetLayer(PCB_LAYER_ID.F_Cu);

        const gr = this.comp_graphics.get(src.refdes);

        if (gr) {
          for (const grId of [...gr.keys()].sort((a, b) => a - b)) {
            const graphic = gr.get(grId)!;

            for (const seg of graphic.elements!) {
              let layer: PCB_LAYER_ID = PCB_LAYER_ID.Dwgs_User;

              if (IsPcbLayer(this.getLayer(seg.layer))) layer = this.getLayer(seg.layer);

              const defaultStroke = new STROKE_PARAMS(ds.GetLineThickness(layer));

              switch (seg.shape) {
                case GRAPHIC_SHAPE.GR_SHAPE_LINE: {
                  const lsrc = seg as GRAPHIC_LINE;
                  const line = new PCB_SHAPE(fp, SHAPE_T.SEGMENT);

                  if (src.mirror) {
                    line.SetLayer(aBoard.FlipLayer(layer));
                    line.SetStart({ x: lsrc.start_x, y: 2 * src.y - lsrc.start_y });
                    line.SetEnd({ x: lsrc.end_x, y: 2 * src.y - lsrc.end_y });
                  } else {
                    line.SetLayer(layer);
                    line.SetStart({ x: lsrc.start_x, y: lsrc.start_y });
                    line.SetEnd({ x: lsrc.end_x, y: lsrc.end_y });
                  }

                  line.SetStroke(new STROKE_PARAMS(lsrc.width, LINE_STYLE.SOLID));

                  if (lsrc.width === 0) line.SetStroke(defaultStroke);

                  fp.Add(line, ADD_MODE.APPEND);
                  break;
                }

                case GRAPHIC_SHAPE.GR_SHAPE_CIRCLE: {
                  const lsrc = seg as GRAPHIC_ARC;
                  const circle = new PCB_SHAPE(fp, SHAPE_T.CIRCLE);

                  circle.SetLayer(layer);
                  circle.SetCenter({ x: lsrc.center_x, y: lsrc.center_y });
                  circle.SetEnd({ x: lsrc.end_x, y: lsrc.end_y });
                  circle.SetWidth(lsrc.width);

                  if (IsBackLayer(layer)) {
                    // Circles on back layers need Y-mirroring to match the flip
                    const fp_orig = fp.GetPosition();
                    circle.Mirror(fp_orig, FLIP_DIRECTION.TOP_BOTTOM);
                  }

                  if (lsrc.width === 0) {
                    // It is a filled shape or a line with the default width
                    if (lsrc.layer === 'DISPLAY_TOP' || lsrc.layer === 'DISPLAY_BOTTOM')
                      circle.SetFilled(true);
                    else circle.SetWidth(ds.GetLineThickness(circle.GetLayer()));
                  }

                  if (src.mirror) circle.Flip(circle.GetCenter(), FLIP_DIRECTION.TOP_BOTTOM);

                  fp.Add(circle, ADD_MODE.APPEND);
                  break;
                }

                case GRAPHIC_SHAPE.GR_SHAPE_ARC: {
                  const lsrc = seg as GRAPHIC_ARC;
                  const arc = new PCB_SHAPE(fp, SHAPE_T.ARC);

                  const sarc = new SHAPE_ARC(lsrc.result);

                  if (IsBackLayer(layer)) {
                    // Arcs on back layers need Y-mirroring to match the flip
                    const fp_orig = fp.GetPosition();
                    sarc.Mirror(fp_orig, FLIP_DIRECTION.TOP_BOTTOM);
                    sarc.Mirror(sarc.GetCenter(), FLIP_DIRECTION.TOP_BOTTOM);
                  }

                  arc.SetLayer(layer);
                  arc.SetArcGeometry(sarc.GetP0(), sarc.GetArcMid(), sarc.GetP1());
                  arc.SetStroke(new STROKE_PARAMS(lsrc.width, LINE_STYLE.SOLID));

                  if (lsrc.width === 0) arc.SetStroke(defaultStroke);

                  if (src.mirror) arc.Flip(arc.GetCenter(), FLIP_DIRECTION.TOP_BOTTOM);

                  fp.Add(arc, ADD_MODE.APPEND);
                  break;
                }

                case GRAPHIC_SHAPE.GR_SHAPE_RECTANGLE: {
                  const lsrc = seg as GRAPHIC_RECTANGLE;
                  const rect = new PCB_SHAPE(fp, SHAPE_T.RECTANGLE);

                  if (src.mirror) {
                    rect.SetLayer(aBoard.FlipLayer(layer));
                    rect.SetStart({ x: lsrc.start_x, y: 2 * src.y - lsrc.start_y });
                    rect.SetEnd({ x: lsrc.end_x, y: 2 * src.y - lsrc.end_y });
                  } else {
                    rect.SetLayer(layer);
                    rect.SetStart({ x: lsrc.start_x, y: lsrc.start_y });
                    rect.SetEnd({ x: lsrc.end_x, y: lsrc.end_y });
                  }

                  rect.SetStroke(defaultStroke);

                  fp.Add(rect, ADD_MODE.APPEND);
                  break;
                }

                case GRAPHIC_SHAPE.GR_SHAPE_TEXT: {
                  const lsrc = seg as GRAPHIC_TEXT;
                  const txt = new PCB_TEXT(fp);

                  const flip_point: VECTOR2I | null = src.mirror ? { x: src.x, y: src.y } : null;

                  FABMASTER.setupText(lsrc, layer, txt, aBoard, flip_point);

                  if (
                    txt.GetLayer() !== PCB_LAYER_ID.F_SilkS &&
                    txt.GetLayer() !== PCB_LAYER_ID.B_SilkS
                  ) {
                    // Non-silkscreen text becomes a hidden user field
                    const field = new PCB_FIELD(txt, FIELD_T.USER);
                    field.SetVisible(false);
                    fp.Add(field, ADD_MODE.APPEND);
                  } else {
                    fp.Add(txt, ADD_MODE.APPEND);
                  }

                  break;
                }

                default:
                  continue;
              }
            }
          }
        }

        let pinSet = this.pins.get(src.refdes);

        if (!pinSet) pinSet = this.pins.get(src.name);

        if (pinSet) {
          for (const pin of pinSet) {
            const pin_net = this.pin_nets.get(`${pin.refdes}\u0000${pin.pin_number}`);
            const pad = this.pads.get(pin.padstack);

            let netname = '';

            if (pin_net) netname = pin_net.name;

            const net = netinfo.get(wx(netname));

            const newpad = new PAD(fp);

            if (net) newpad.SetNet(net);
            else newpad.SetNetCode(0);

            newpad.SetX(pin.pin_x);

            if (src.mirror) newpad.SetY(2 * src.y - pin.pin_y);
            else newpad.SetY(pin.pin_y);

            newpad.SetNumber(wx(pin.pin_number));

            // Unable to locate padstack: the pad is dropped
            if (!pad) continue;

            this.shapePad(newpad, pad, pin, src);

            if (src.mirror)
              newpad.SetOrientation(
                new EDA_ANGLE(-src.rotate + pin.rotation, EDA_ANGLE_T.DEGREES_T),
              );
            else
              newpad.SetOrientation(
                new EDA_ANGLE(src.rotate - pin.rotation, EDA_ANGLE_T.DEGREES_T),
              );

            // Invalid zero-sized pad ignored
            if (newpad.GetSizeX() > 0 || newpad.GetSizeY() > 0) fp.Add(newpad, ADD_MODE.APPEND);
          }
        }

        if (src.mirror) {
          fp.SetOrientationDegrees(180.0 - src.rotate);
          fp.Flip(fp.GetPosition(), FLIP_DIRECTION.LEFT_RIGHT);
        }

        aBoard.Add(fp, ADD_MODE.APPEND);
      }
    }

    return true;
  }

  /** The padstack part of `loadFootprints`' pin loop. */
  private shapePad(newpad: PAD, pad: FM_PAD, pin: PIN, src: COMPONENT): void {
    const ALL = PADSTACK.ALL_LAYERS;

    // Detect per-layer copper geometry differences
    let front_layer: FM_PAD_LAYER | null = null;
    let back_layer: FM_PAD_LAYER | null = null;
    let inner_layer: FM_PAD_LAYER | null = null;

    for (const layer_name of sortedKeys(pad.layer_shapes)) {
      const layer_data = pad.layer_shapes.get(layer_name)!;
      const layer_it = this.layers.get(layer_name);

      if (!layer_it || !layer_it.conductive) continue;

      const kicad_layer = layer_it.layerid as PCB_LAYER_ID;

      if (kicad_layer === PCB_LAYER_ID.F_Cu) front_layer = layer_data;
      else if (kicad_layer === PCB_LAYER_ID.B_Cu) back_layer = layer_data;
      else if (IsCopperLayer(kicad_layer)) inner_layer = layer_data;
    }

    const layersDiffer = (aA: FM_PAD_LAYER, aB: FM_PAD_LAYER): boolean =>
      aA.shape !== aB.shape ||
      aA.width !== aB.width ||
      aA.height !== aB.height ||
      aA.x_offset !== aB.x_offset ||
      aA.y_offset !== aB.y_offset ||
      aA.is_octogon !== aB.is_octogon ||
      aA.custom_name !== aB.custom_name;

    const copper_defs: FM_PAD_LAYER[] = [];

    for (const def of [front_layer, inner_layer, back_layer]) if (def) copper_defs.push(def);

    let needs_padstack = false;

    for (let ii = 1; ii < copper_defs.length; ++ii) {
      if (layersDiffer(copper_defs[0]!, copper_defs[ii]!)) {
        needs_padstack = true;
        break;
      }
    }

    if (needs_padstack) newpad.Padstack().SetMode(PADSTACK_MODE.FRONT_INNER_BACK);

    const applyLayerShape = (aLayer: PCB_LAYER_ID, aLayerData: FM_PAD_LAYER) => {
      newpad.SetShape(aLayer, aLayerData.shape);

      if (aLayerData.shape === PAD_SHAPE.CIRCLE)
        newpad.SetSize(aLayer, { x: aLayerData.width, y: aLayerData.width });
      else newpad.SetSize(aLayer, { x: aLayerData.width, y: aLayerData.height });

      newpad.SetOffset(aLayer, { x: aLayerData.x_offset, y: aLayerData.y_offset });
    };

    if (needs_padstack) {
      if (front_layer) applyLayerShape(PCB_LAYER_ID.F_Cu, front_layer);

      if (back_layer) applyLayerShape(PCB_LAYER_ID.B_Cu, back_layer);

      if (inner_layer) applyLayerShape(PADSTACK.INNER_LAYERS, inner_layer);
      else if (front_layer) applyLayerShape(PADSTACK.INNER_LAYERS, front_layer);

      // Custom pad shapes with per-layer geometry: custom primitives are not
      // supported in padstack mode.
    } else if (pad.shape === PAD_SHAPE.CUSTOM) {
      // Choose the smaller dimension to ensure the base pad
      // is fully hidden by the custom pad
      newpad.SetShape(ALL, pad.shape);

      const pad_size = Math.min(pad.width, pad.height);

      newpad.SetSize(ALL, { x: Math.trunc(pad_size / 2), y: Math.trunc(pad_size / 2) });

      const custom_name = `${pad.custom_name}_${pin.refdes}_${pin.pin_number}`;
      const custom = this.pad_shapes.get(custom_name);

      if (custom) {
        const poly_outline = new SHAPE_POLY_SET();
        const last_subseq = 0;
        let hole_idx = -1;

        poly_outline.NewOutline();

        // Custom pad shapes have a group of elements
        // that are a list of graphical polygons
        for (const elId of [...custom.elements.keys()].sort((a, b) => a - b)) {
          const el = custom.elements.get(elId)!;

          // For now, we are only processing the custom pad for the top layer
          const primary_layer = src.mirror ? PCB_LAYER_ID.B_Cu : PCB_LAYER_ID.F_Cu;

          if (this.getLayer(el.begin().layer) !== primary_layer) continue;

          for (const seg of el) {
            if (seg.subseq > 0 || seg.subseq !== last_subseq) {
              const outline = poly_outline.Polygon(0);
              outline[outline.length - 1]!.SetClosed(true);
              hole_idx = poly_outline.AddHole(new SHAPE_LINE_CHAIN());
            }

            if (seg.shape === GRAPHIC_SHAPE.GR_SHAPE_LINE) {
              const line_seg = seg as GRAPHIC_LINE;

              if (poly_outline.VertexCount(0, hole_idx) === 0)
                poly_outline.Append(line_seg.start_x, line_seg.start_y, 0, hole_idx);

              poly_outline.Append(line_seg.end_x, line_seg.end_y, 0, hole_idx);
            } else if (seg.shape === GRAPHIC_SHAPE.GR_SHAPE_ARC) {
              const arc_seg = seg as GRAPHIC_ARC;
              const chain = poly_outline.Hole(0, hole_idx);

              chain.Append(arc_seg.result);
            }
          }
        }

        if (poly_outline.OutlineCount() < 1 || poly_outline.Outline(0).PointCount() < 3) {
          // Invalid custom pad: replaced with a circular pad
          newpad.SetShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.CIRCLE);
        } else {
          poly_outline.Fracture();

          const pos = newpad.GetPosition();
          poly_outline.Move({ x: -pos.x, y: -pos.y });

          if (src.mirror) {
            poly_outline.Mirror({ x: 0, y: pin.pin_y - src.y }, FLIP_DIRECTION.TOP_BOTTOM);
            poly_outline.Rotate(new EDA_ANGLE(src.rotate - pin.rotation, EDA_ANGLE_T.DEGREES_T));
          } else {
            poly_outline.Rotate(new EDA_ANGLE(-src.rotate + pin.rotation, EDA_ANGLE_T.DEGREES_T));
          }

          newpad.AddPrimitivePoly(ALL, poly_outline, 0, true);
        }

        const mergedPolygon = new SHAPE_POLY_SET();
        newpad.MergePrimitivesAsPolygon(ALL, mergedPolygon);

        // Invalid custom pad: replaced with a circular pad
        if (mergedPolygon.OutlineCount() > 1) newpad.SetShape(ALL, PAD_SHAPE.CIRCLE);
      }
      // else: could not find the custom pad
    } else {
      newpad.SetShape(ALL, pad.shape);
      newpad.SetSize(ALL, { x: pad.width, y: pad.height });
    }

    if (!needs_padstack && (pad.x_offset || pad.y_offset))
      newpad.SetOffset(ALL, { x: pad.x_offset, y: pad.y_offset });

    if (pad.drill) {
      if (pad.plated) {
        newpad.SetAttribute(PAD_ATTRIB.PTH);
        newpad.SetLayerSet(PAD.PTHMask());
      } else {
        newpad.SetAttribute(PAD_ATTRIB.NPTH);
        newpad.SetLayerSet(PAD.UnplatedHoleMask());
      }

      if (pad.drill_size_x === pad.drill_size_y) newpad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
      else newpad.SetDrillShape(PAD_DRILL_SHAPE.OBLONG);

      newpad.SetDrillSize({ x: pad.drill_size_x, y: pad.drill_size_y });
    } else {
      newpad.SetAttribute(PAD_ATTRIB.SMD);

      if (pad.top) newpad.SetLayerSet(PAD.SMDMask());
      else if (pad.bottom) newpad.SetLayerSet(PAD.SMDMask().FlipStandardLayers());
    }
  }

  private loadLayers(aBoard: BOARD): boolean {
    const layer_set = new LSET();

    /// The default gives us a simple layer stackup.  Here, we modify the layers to match
    /// the actual layers in the file
    layer_set.orAssign(LSET.AllTechMask().or(LSET.UserMask()));

    for (const key of sortedKeys(this.layers)) {
      const layer = this.layers.get(key)!;
      this.checkpoint();

      if (layer.layerid >= PCBNEW_LAYER_ID_START) layer_set.set(layer.layerid);
    }

    aBoard.SetEnabledLayers(layer_set);

    for (const key of sortedKeys(this.layers)) {
      const layer = this.layers.get(key)!;

      if (layer.conductive) aBoard.SetLayerName(layer.layerid as PCB_LAYER_ID, wx(layer.name));
    }

    return true;
  }

  private loadVias(aBoard: BOARD): boolean {
    const netinfo = aBoard.GetNetInfo().NetsByName();
    const ds = aBoard.GetDesignSettings();

    // Build a sorted list of conductive layers for blind/buried via detection
    const conductiveLayers: FABMASTER_LAYER[] = [];

    for (const key of sortedKeys(this.layers)) {
      const layer = this.layers.get(key)!;

      if (layer.conductive) conductiveLayers.push(layer);
    }

    stdSort(conductiveLayers, (lhs, rhs) => lhs.id < rhs.id);

    for (const via of this.vias) {
      this.checkpoint();

      const net = netinfo.get(wx(via.net));
      const padstack = this.pads.get(via.padstack);

      const new_via = new PCB_VIA(aBoard);

      new_via.SetPosition({ x: via.x, y: via.y });

      if (net) new_via.SetNet(net);

      if (!padstack) {
        new_via.SetDrillDefault();

        if (ds.m_ViasDimensionsList.length > 0) {
          new_via.SetWidth(PADSTACK.ALL_LAYERS, ds.m_ViasDimensionsList[0]!.m_Diameter);
          new_via.SetDrill(ds.m_ViasDimensionsList[0]!.m_Drill);
        } else {
          new_via.SetDrillDefault();
          new_via.SetWidth(PADSTACK.ALL_LAYERS, ds.m_ViasMinSize);
        }
      } else {
        new_via.SetDrill(padstack.drill_size_x);
        new_via.SetWidth(PADSTACK.ALL_LAYERS, padstack.width);

        const viaLayers = padstack.copper_layers;

        if (viaLayers.size >= 2) {
          let topLayer: FABMASTER_LAYER | null = null;
          let botLayer: FABMASTER_LAYER | null = null;

          for (const layer of conductiveLayers) {
            if (viaLayers.has(layer.name)) {
              if (!topLayer) topLayer = layer;

              botLayer = layer;
            }
          }

          if (topLayer && botLayer && topLayer !== botLayer) {
            const topLayerId = topLayer.layerid as PCB_LAYER_ID;
            const botLayerId = botLayer.layerid as PCB_LAYER_ID;

            const isThrough = topLayerId === PCB_LAYER_ID.F_Cu && botLayerId === PCB_LAYER_ID.B_Cu;

            if (!isThrough) {
              if (topLayerId === PCB_LAYER_ID.F_Cu || botLayerId === PCB_LAYER_ID.B_Cu)
                new_via.SetViaType(VIATYPE.BLIND);
              else new_via.SetViaType(VIATYPE.BURIED);

              new_via.SetLayerPair(topLayerId, botLayerId);
            }
          }
        }
      }

      aBoard.Add(new_via, ADD_MODE.APPEND);
    }

    return true;
  }

  private loadNets(aBoard: BOARD): boolean {
    for (const net of [...this.netnames].sort((a, b) => strCmp(a, b))) {
      this.checkpoint();

      const newnet = new NETINFO_ITEM(aBoard, wx(net));
      aBoard.Add(newnet, ADD_MODE.APPEND);
    }

    return true;
  }

  private loadEtch(aBoard: BOARD, aLine: TRACE): boolean {
    const netinfo = aBoard.GetNetInfo().NetsByName();
    const net = netinfo.get(wx(aLine.netname));

    for (const seg of aLine.segment) {
      const layer = this.getLayer(seg.layer);

      if (IsCopperLayer(layer)) {
        switch (seg.shape) {
          case GRAPHIC_SHAPE.GR_SHAPE_LINE: {
            const src = seg as GRAPHIC_LINE;

            const trk = new PCB_TRACK(aBoard);

            trk.SetLayer(layer);
            trk.SetStart({ x: src.start_x, y: src.start_y });
            trk.SetEnd({ x: src.end_x, y: src.end_y });
            trk.SetWidth(src.width);

            if (net) trk.SetNet(net);

            aBoard.Add(trk, ADD_MODE.APPEND);
            break;
          }

          case GRAPHIC_SHAPE.GR_SHAPE_ARC: {
            const src = seg as GRAPHIC_ARC;

            const trk = new PCB_ARC(aBoard, src.result);
            trk.SetLayer(layer);
            trk.SetWidth(src.width);

            if (net) trk.SetNet(net);

            aBoard.Add(trk, ADD_MODE.APPEND);
            break;
          }

          default:
            // Defer to the generic graphics factory
            for (const new_item of FABMASTER.createBoardItems(aBoard, layer, seg))
              aBoard.Add(new_item, ADD_MODE.APPEND);

            break;
        }
      }
      // else: expecting etch data to be on a copper layer
    }

    return true;
  }

  private loadShapePolySet(aElement: graphic_element): SHAPE_POLY_SET {
    const poly_outline = new SHAPE_POLY_SET();
    const last_subseq = 0;
    let hole_idx = -1;

    poly_outline.NewOutline();

    for (const seg of aElement) {
      if (seg.subseq > 0 || seg.subseq !== last_subseq)
        hole_idx = poly_outline.AddHole(new SHAPE_LINE_CHAIN());

      if (seg.shape === GRAPHIC_SHAPE.GR_SHAPE_LINE) {
        const src = seg as GRAPHIC_LINE;

        if (poly_outline.VertexCount(0, hole_idx) === 0)
          poly_outline.Append(src.start_x, src.start_y, 0, hole_idx);

        poly_outline.Append(src.end_x, src.end_y, 0, hole_idx);
      } else if (
        seg.shape === GRAPHIC_SHAPE.GR_SHAPE_ARC ||
        seg.shape === GRAPHIC_SHAPE.GR_SHAPE_CIRCLE
      ) {
        const src = seg as GRAPHIC_ARC;
        const chain = poly_outline.Hole(0, hole_idx);

        chain.Append(src.result);
      }
    }

    return poly_outline;
  }

  private static traceIsOpen(aLine: TRACE): boolean {
    if (aLine.segment.size === 0) return true;

    let first: GRAPHIC_ITEM | null = null;
    let last: GRAPHIC_ITEM | null = null;
    let first_subseq = -1;
    let have_multiple_subseqs = false;

    for (const gr_item of aLine.segment) {
      if (first === null) {
        first = gr_item;
        first_subseq = gr_item.subseq;
      } else if (gr_item.subseq === first_subseq) {
        last = gr_item;
      } else {
        have_multiple_subseqs = true;
        break;
      }
    }

    if (!first) return true;

    if (!last) {
      // This is a single-item trace, so it's open unless it's a circle with holes
      if (first.shape === GRAPHIC_SHAPE.GR_SHAPE_CIRCLE && have_multiple_subseqs) return false;

      return true;
    }

    const start: VECTOR2I = { x: first.start_x, y: first.start_y };
    let end: VECTOR2I | null = null;

    switch (last.shape) {
      case GRAPHIC_SHAPE.GR_SHAPE_LINE: {
        const line = last as GRAPHIC_LINE;
        end = { x: line.end_x, y: line.end_y };
        break;
      }

      case GRAPHIC_SHAPE.GR_SHAPE_ARC: {
        const arc = last as GRAPHIC_ARC;
        end = { x: arc.end_x, y: arc.end_y };
        break;
      }

      default:
        // These shapes are "closed" by definition, but they're only closed
        // if they're the only item in the trace.
        break;
    }

    if (end && start.x === end.x && start.y === end.y) return false;

    return true;
  }

  private static createBoardItems(
    aBoard: BOARD,
    aLayer: PCB_LAYER_ID,
    aGraphic: GRAPHIC_ITEM,
  ): BOARD_ITEM[] {
    const new_items: BOARD_ITEM[] = [];
    const boardSettings = aBoard.GetDesignSettings();
    const defaultStroke = new STROKE_PARAMS(boardSettings.GetLineThickness(aLayer));

    const setShapeParameters = (aShape: PCB_SHAPE) => {
      aShape.SetStroke(new STROKE_PARAMS(aGraphic.width, LINE_STYLE.SOLID));

      if (aShape.GetWidth() === 0) aShape.SetStroke(defaultStroke);
    };

    switch (aGraphic.shape) {
      case GRAPHIC_SHAPE.GR_SHAPE_TEXT: {
        const src = aGraphic as GRAPHIC_TEXT;

        const new_text = new PCB_TEXT(aBoard);

        if (IsBackLayer(aLayer)) new_text.SetMirrored(true);

        FABMASTER.setupText(src, aLayer, new_text, aBoard, null);

        new_items.push(new_text);
        break;
      }

      case GRAPHIC_SHAPE.GR_SHAPE_CROSS: {
        const src = aGraphic as GRAPHIC_CROSS;

        const c: VECTOR2I = { x: src.start_x, y: src.start_y };
        const s: VECTOR2I = { x: src.size_x, y: src.size_y };

        for (const seg of KIGEOM_MakeCrossSegments(c, s, ANGLE_0)) {
          const line = new PCB_SHAPE(aBoard);
          line.SetShape(SHAPE_T.SEGMENT);
          line.SetStart(seg.A);
          line.SetEnd(seg.B);

          setShapeParameters(line);
          new_items.push(line);
        }

        break;
      }

      default: {
        // Simple single shape
        const new_shape = new PCB_SHAPE(aBoard);

        setShapeParameters(new_shape);

        switch (aGraphic.shape) {
          case GRAPHIC_SHAPE.GR_SHAPE_LINE: {
            const src = aGraphic as GRAPHIC_LINE;

            new_shape.SetShape(SHAPE_T.SEGMENT);
            new_shape.SetStart({ x: src.start_x, y: src.start_y });
            new_shape.SetEnd({ x: src.end_x, y: src.end_y });

            break;
          }

          case GRAPHIC_SHAPE.GR_SHAPE_ARC: {
            const src = aGraphic as GRAPHIC_ARC;

            new_shape.SetShape(SHAPE_T.ARC);
            new_shape.SetArcGeometry(
              src.result.GetP0(),
              src.result.GetArcMid(),
              src.result.GetP1(),
            );

            break;
          }

          case GRAPHIC_SHAPE.GR_SHAPE_CIRCLE: {
            const src = aGraphic as GRAPHIC_ARC;

            new_shape.SetShape(SHAPE_T.CIRCLE);
            new_shape.SetCenter({ x: src.center_x, y: src.center_y });
            new_shape.SetRadius(src.radius);

            break;
          }

          case GRAPHIC_SHAPE.GR_SHAPE_RECTANGLE: {
            const src = aGraphic as GRAPHIC_RECTANGLE;

            new_shape.SetShape(SHAPE_T.RECTANGLE);
            new_shape.SetStart({ x: src.start_x, y: src.start_y });
            new_shape.SetEnd({ x: src.end_x, y: src.end_y });
            new_shape.SetFilled(src.fill);

            break;
          }

          case GRAPHIC_SHAPE.GR_SHAPE_POLYGON: {
            const src = aGraphic as GRAPHIC_POLYGON;

            new_shape.SetShape(SHAPE_T.POLY);
            new_shape.SetPolyPoints(src.m_pts);

            break;
          }

          case GRAPHIC_SHAPE.GR_SHAPE_OBLONG: {
            const src = aGraphic as GRAPHIC_OBLONG;

            const c: VECTOR2I = { x: src.start_x, y: src.start_y };
            let s: VECTOR2I = { ...c };
            let w = 0;

            if (src.oblong_x) {
              w = src.size_y;
              s = { x: s.x - Math.trunc((src.size_x - w) / 2), y: s.y };
            } else {
              w = src.size_x;
              s = { x: s.x, y: s.y - Math.trunc((src.size_y - w) / 2) };
            }

            const seg = new SHAPE_SEGMENT(s, { x: c.x - (s.x - c.x), y: c.y - (s.y - c.y) }, w);

            const poly = new SHAPE_POLY_SET();
            seg.TransformToPolygon(poly, boardSettings.m_MaxError, ERROR_LOC.ERROR_INSIDE);

            new_shape.SetShape(SHAPE_T.POLY);
            new_shape.SetPolyShape(poly);
            break;
          }

          default:
            // Unhandled shape type: the shape stays a zero segment
            break;
        }

        new_items.push(new_shape);
      }
    }

    for (const new_item of new_items) new_item.SetLayer(aLayer);

    // If there's more than one, group them
    if (new_items.length > 1) {
      const new_group = new PCB_GROUP(aBoard);

      for (const new_item of new_items) new_group.AddItem(new_item);

      new_items.push(new_group);
    }

    return new_items;
  }

  private loadPolygon(aBoard: BOARD, aLine: TRACE): boolean {
    if (aLine.segment.empty()) return false;

    let layer: PCB_LAYER_ID = PCB_LAYER_ID.Cmts_User;

    const new_layer = this.getLayer(aLine.layer);

    if (IsPcbLayer(new_layer)) layer = new_layer;

    const is_open = FABMASTER.traceIsOpen(aLine);

    if (is_open) {
      for (const seg of aLine.segment) {
        for (const new_item of FABMASTER.createBoardItems(aBoard, layer, seg))
          aBoard.Add(new_item, ADD_MODE.APPEND);
      }
    } else {
      const defaultStroke = new STROKE_PARAMS(aBoard.GetDesignSettings().GetLineThickness(layer));

      const poly_outline = this.loadShapePolySet(aLine.segment);

      poly_outline.Fracture();

      if (poly_outline.OutlineCount() < 1 || poly_outline.COutline(0).PointCount() < 3)
        return false;

      const new_poly = new PCB_SHAPE(aBoard);

      new_poly.SetShape(SHAPE_T.POLY);
      new_poly.SetLayer(layer);

      if (layer === PCB_LAYER_ID.F_SilkS || layer === PCB_LAYER_ID.B_SilkS) {
        new_poly.SetFilled(true);
        new_poly.SetStroke(new STROKE_PARAMS(0));
      } else {
        new_poly.SetStroke(new STROKE_PARAMS(aLine.segment.begin().width, LINE_STYLE.SOLID));

        if (new_poly.GetWidth() === 0) new_poly.SetStroke(defaultStroke);
      }

      new_poly.SetPolyShape(poly_outline);
      aBoard.Add(new_poly, ADD_MODE.APPEND);
    }

    return true;
  }

  private loadZone(aBoard: BOARD, aLine: TRACE): boolean {
    if (aLine.segment.size < 3) return false;

    const netinfo = aBoard.GetNetInfo().NetsByName();
    const net = netinfo.get(wx(aLine.netname));
    let layer: PCB_LAYER_ID = PCB_LAYER_ID.Cmts_User;

    const new_layer = this.getLayer(aLine.layer);

    if (IsPcbLayer(new_layer)) layer = new_layer;

    const zone = new ZONE(aBoard);
    const zone_outline = new SHAPE_POLY_SET();

    if (net) zone.SetNet(net);

    if (aLine.layer === 'ALL') zone.SetLayerSet(aBoard.GetLayerSet().and(LSET.AllCuMask()));
    else if (aLine.layer === 'OUTER_LAYERS')
      zone.SetLayerSet(aBoard.GetLayerSet().and(LSET.ExternalCuMask()));
    else if (aLine.layer === 'INNER_PLANE_LAYERS' || aLine.layer === 'INNER_SIGNAL_LAYERS')
      zone.SetLayerSet(aBoard.GetLayerSet().and(LSET.InternalCuMask()));
    else zone.SetLayer(layer);

    zone.SetIsRuleArea(false);
    zone.SetDoNotAllowTracks(false);
    zone.SetDoNotAllowVias(false);
    zone.SetDoNotAllowPads(false);
    zone.SetDoNotAllowFootprints(false);
    zone.SetDoNotAllowZoneFills(false);

    if (aLine.lclass === 'ROUTE KEEPOUT') {
      zone.SetIsRuleArea(true);
      zone.SetDoNotAllowTracks(true);
      zone.SetDoNotAllowVias(true);
      zone.SetDoNotAllowPads(true);
      zone.SetDoNotAllowZoneFills(true);
    } else if (aLine.lclass === 'VIA KEEPOUT') {
      zone.SetIsRuleArea(true);
      zone.SetDoNotAllowVias(true);
    } else if (aLine.lclass === 'PACKAGE KEEPOUT') {
      zone.SetIsRuleArea(true);
      zone.SetDoNotAllowFootprints(true);
    } else if (
      aLine.lclass === 'ROUTE KEEPIN' ||
      aLine.lclass === 'PACKAGE KEEPIN' ||
      aLine.lclass === 'CONSTRAINT REGION'
    ) {
      zone.SetIsRuleArea(true);
      zone.SetZoneName(wx(aLine.lclass));
    } else {
      zone.SetAssignedPriority(50);
    }

    zone.SetLocalClearance(0);
    zone.SetPadConnection(ZONE_CONNECTION.FULL);

    zone_outline.NewOutline();

    let pending_hole: SHAPE_LINE_CHAIN | null = null;
    let active_chain: SHAPE_LINE_CHAIN = zone_outline.Outline(0);

    const add_hole_if_valid = () => {
      if (pending_hole) {
        pending_hole.SetClosed(true);

        // Invalid holes are logged and dropped
        KIGEOM_AddHoleIfValid(zone_outline, pending_hole);

        pending_hole = null;
      }
    };

    let last_subseq = 0;

    for (const seg of aLine.segment) {
      if (seg.subseq > 0 && seg.subseq !== last_subseq) {
        /// Don't knock holes in the BOUNDARY systems.  These are the outer layers for
        /// zone fills.
        if (aLine.lclass === 'BOUNDARY') break;

        add_hole_if_valid();
        pending_hole = new SHAPE_LINE_CHAIN();
        active_chain = pending_hole;
        last_subseq = seg.subseq;
      }

      if (seg.shape === GRAPHIC_SHAPE.GR_SHAPE_LINE) {
        const src = seg as GRAPHIC_LINE;
        const start: VECTOR2I = { x: src.start_x, y: src.start_y };
        const end: VECTOR2I = { x: src.end_x, y: src.end_y };

        if (active_chain.PointCount() === 0) {
          active_chain.Append(start);
        }
        // else: an outline whose last point is not the next start is logged

        active_chain.Append(end);
      } else if (
        seg.shape === GRAPHIC_SHAPE.GR_SHAPE_ARC ||
        seg.shape === GRAPHIC_SHAPE.GR_SHAPE_CIRCLE
      ) {
        const src = seg as GRAPHIC_ARC;
        active_chain.Append(src.result);
      }
      // else: invalid shape type in a zone outline
    }

    add_hole_if_valid();

    if (zone_outline.Outline(0).PointCount() >= 3) {
      zone.SetOutline(zone_outline);
      aBoard.Add(zone, ADD_MODE.APPEND);
    }

    return true;
  }

  private loadOutline(aBoard: BOARD, aLine: TRACE): boolean {
    let layer: PCB_LAYER_ID;

    if (aLine.lclass === 'BOARD GEOMETRY' && aLine.layer !== 'DIMENSION')
      layer = PCB_LAYER_ID.Edge_Cuts;
    else if (aLine.lclass === 'DRAWING FORMAT') layer = PCB_LAYER_ID.Dwgs_User;
    else layer = PCB_LAYER_ID.Cmts_User;

    for (const seg of aLine.segment) {
      for (const new_item of FABMASTER.createBoardItems(aBoard, layer, seg))
        aBoard.Add(new_item, ADD_MODE.APPEND);
    }

    return true;
  }

  private loadGraphics(aBoard: BOARD): boolean {
    for (const geom of this.board_graphics) {
      this.checkpoint();

      let layer: PCB_LAYER_ID;

      // The pin numbers are not useful for us outside of the footprints
      if (geom.subclass === 'PIN_NUMBER') continue;

      layer = this.getLayer(geom.subclass);

      if (!IsPcbLayer(layer)) layer = PCB_LAYER_ID.Cmts_User;

      if (!geom.elements!.empty()) {
        /// Zero-width items are filled polygons
        if (geom.elements!.begin().width === 0) {
          const poly_outline = this.loadShapePolySet(geom.elements!);

          poly_outline.Fracture();

          if (poly_outline.OutlineCount() < 1 || poly_outline.COutline(0).PointCount() < 3)
            continue;

          const new_poly = new PCB_SHAPE(aBoard, SHAPE_T.POLY);

          new_poly.SetLayer(layer);
          new_poly.SetPolyShape(poly_outline);
          new_poly.SetStroke(new STROKE_PARAMS(0));

          if (layer === PCB_LAYER_ID.F_SilkS || layer === PCB_LAYER_ID.B_SilkS)
            new_poly.SetFilled(true);

          aBoard.Add(new_poly, ADD_MODE.APPEND);
        }
      }

      for (const seg of geom.elements!) {
        for (const new_item of FABMASTER.createBoardItems(aBoard, layer, seg))
          aBoard.Add(new_item, ADD_MODE.APPEND);
      }
    }

    return true;
  }

  private orderZones(aBoard: BOARD): boolean {
    AutoAssignZonePriorities(aBoard);
    return true;
  }

  LoadBoard(aBoard: BOARD, aProgressReporter: PROGRESS_REPORTER | null): boolean {
    aBoard.SetFileName(this.m_filename);
    this.m_progressReporter = aProgressReporter;

    this.m_totalCount =
      this.netnames.size +
      this.layers.size +
      this.vias.length +
      this.components.size +
      this.zones.size +
      this.board_graphics.length +
      this.traces.size;
    this.m_doneCount = 0;

    this.loadNets(aBoard);
    this.loadLayers(aBoard);
    this.loadVias(aBoard);
    this.createComponentsFromOrphanPins();
    this.loadFootprints(aBoard);
    this.loadZones(aBoard);
    this.loadGraphics(aBoard);

    for (const track of this.traces) {
      this.checkpoint();

      if (track.lclass === 'ETCH') this.loadEtch(aBoard, track);
      else if (track.layer === 'OUTLINE' || track.layer === 'DIMENSION')
        this.loadOutline(aBoard, track);
      else this.loadPolygon(aBoard, track);
    }

    this.orderZones(aBoard);

    return true;
  }
}
