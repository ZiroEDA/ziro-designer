// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright Quilter and The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/allegro/convert/allegro_pcb_structs.h`: the near-verbatim
 * structs the Allegro parser fills, one per block type.
 *
 * Field order follows the header; the order bytes are READ in is the
 * parser's (allegro_parser.ts), which is not always the same. `std::array`
 * fields are zero-filled arrays of their stated length, and a
 * `std::variant` is a union of the classes below, told apart with
 * `instanceof` where the C++ uses `std::holds_alternative` / `std::get`.
 */
import { wxFromBytes } from './allegro_stream.js';

/**
 * The base class for all blocks in the main body of an Allegro file.
 *
 * This records metadata about the block, such as its type and offset in the file.
 *
 * In the file format, blocks do not seem to know their own length,
 * so it's very important that each block type gets this right, or the next block
 * will not be read properly and everything will fall apart.
 */
export class BLOCK_BASE {
  private readonly m_blockType: number;
  private readonly m_offset: number;

  constructor(aBlockType: number, aOffset: number) {
    this.m_blockType = aBlockType;
    this.m_offset = aOffset;
  }

  GetBlockType(): number {
    return this.m_blockType;
  }

  GetOffset(): number {
    return this.m_offset;
  }

  /**
   * If this block data has a key, return it, else 0. Upstream defines this in
   * allegro_db.cpp over `GetBlockKey`; it is here so the block classes carry
   * it without allegro_db.ts and this module importing each other.
   */
  GetKey(): number {
    return GetBlockKey(this) ?? 0;
  }
}

export class BLOCK<T> extends BLOCK_BASE {
  private readonly m_data: T;

  constructor(aBlockType: number, aOffset: number, aData: T) {
    super(aBlockType, aOffset);
    this.m_data = aData;
  }

  GetData(): T {
    return this.m_data;
  }
}

/** `GetBlockKey` (allegro_db.cpp:40-100): the m_Key of every block type that has one. */
export function GetBlockKey(aBlock: BLOCK_BASE): number | null {
  switch (aBlock.GetBlockType()) {
    case 0x01:
    case 0x03:
    case 0x04:
    case 0x05:
    case 0x06:
    case 0x07:
    case 0x08:
    case 0x09:
    case 0x0a:
    case 0x0c:
    case 0x0d:
    case 0x0e:
    case 0x0f:
    case 0x10:
    case 0x11:
    case 0x12:
    case 0x14:
    case 0x15:
    case 0x16:
    case 0x17:
    case 0x1b:
    case 0x1c:
    case 0x1d:
    case 0x1e:
    case 0x1f:
    case 0x20:
    case 0x21:
    case 0x22:
    case 0x23:
    case 0x24:
    case 0x26:
    case 0x28:
    case 0x29:
    case 0x2a:
    case 0x2b:
    case 0x2c:
    case 0x2d:
    case 0x2e:
    case 0x2f:
    case 0x30:
    case 0x31:
    case 0x32:
    case 0x33:
    case 0x34:
    case 0x36:
    case 0x37:
    case 0x38:
    case 0x39:
    case 0x3a:
    case 0x3c:
      return (aBlock as BLOCK<{ m_Key: number }>).GetData().m_Key;
    default:
      break;
  }

  return null;
}

export enum BLOCK_TYPE {
  x1B_NET = 0x1b,
}

/**
 * The format of an Allego file.
 *
 * Allgro formats seem to be versioned per the magic, with the lowest
 * byte masked out (or at least there no known case of the lower
 * magic byte changing the format.
 *
 * But the version does not seem to be directly related to the
 * Allegro version (e.g. 17.2) itself.
 */
export enum FMT_VER {
  V_UNKNOWN,
  V_PRE_V16, // Allegro versions before 16.0 (unsupported binary format)
  V_160, // Allegro 16.0, 0x00130000
  V_162, // Allegro 16.2  0x00130400
  V_164, // Allegro 16.4, 0x00130C00
  V_165, // Allegro 16.5, 0x00131000
  V_166, // Allegro 16.6, 0x00131500
  V_172, // Allegro 17.2, 0x00140400
  V_174, // Allegro 17.4, 0x00140900
  V_175, // Allegro 17.5, 0x00141500
  V_180, // Allegro 18.0, 0x00150000
}

/** `COND_FIELD_BASE<T>`: an optional field whose presence depends on the file version. */
export abstract class COND_FIELD_BASE<T> {
  private m_Value: T | undefined = undefined;
  private m_HasValue = false;

  /** Whether the field exists in the given version of the file. */
  abstract exists(ver: FMT_VER): boolean;

  value(): T {
    return this.m_Value as T;
  }

  has_value(): boolean {
    return this.m_HasValue;
  }

  value_or(aDefault: T): T {
    return this.m_HasValue ? (this.m_Value as T) : aDefault;
  }

  /** `operator=( const T& )`. */
  set(aValue: T): this {
    this.m_Value = aValue;
    this.m_HasValue = true;
    return this;
  }
}

/**
 * This is a conditional field that only exists in versions of a file
 * of or above a certain version.
 */
export class COND_GE<T> extends COND_FIELD_BASE<T> {
  constructor(private readonly m_MinVersion: FMT_VER) {
    super();
  }

  exists(ver: FMT_VER): boolean {
    return ver >= this.m_MinVersion;
  }
}

/**
 * This is a conditional field that only exists in versions of a file
 * less than a certain version.
 */
export class COND_LT<T> extends COND_FIELD_BASE<T> {
  constructor(private readonly m_MaxVersion: FMT_VER) {
    super();
  }

  exists(ver: FMT_VER): boolean {
    return ver < this.m_MaxVersion;
  }
}

/**
 * This is a conditional field that only exists in versions of a file
 * less than a certain version and greater than or equal to a certain version.
 */
export class COND_GE_LT<T> extends COND_FIELD_BASE<T> {
  constructor(
    private readonly m_GEVersion: FMT_VER,
    private readonly m_LTVersion: FMT_VER,
  ) {
    super();
  }

  exists(ver: FMT_VER): boolean {
    return ver >= this.m_GEVersion && ver < this.m_LTVersion;
  }
}

export enum BOARD_UNITS {
  MILS = 0x01,
  INCHES = 0x02,
  MILLIMETERS = 0x03,
  CENTIMETERS = 0x04,
  MICROMETERS = 0x05,
}

const zeros = (n: number): number[] => new Array<number>(n).fill(0);

export interface LAYER_MAP_ENTRY {
  m_A: number;
  m_LayerList0x2A: number;
}

/**
 * This is apparently some kind of linked list that chains though subsets
 * objects in the file. It's not clear if this has any utility for KiCad, as we
 * can just keep a map of object types as we go.
 */
export interface LINKED_LIST {
  m_Tail: number;
  m_Head: number;
}

const LL = (): LINKED_LIST => ({ m_Tail: 0, m_Head: 0 });

/**
 * Allegro files start with this header. It is mostly full of a lot
 * of linked lists, but also a few key parameters of the file such
 * as units.
 *
 * It does not seem to have things that vary between file versions.
 */
export class FILE_HEADER {
  m_Magic = 0;

  m_Unknown1a = 0; // 0x03
  m_FileRole = 0; // 0x01 (.brd) or 0x02 (.dra) (?)
  m_Unknown1b = 0; // 0x03
  m_WriterProgram = 0; // 0x09 (Allegro) or 0x130000 (DB Doctor) (?)

  m_ObjectCount = 0;

  m_UnknownMagic = 0; // This is always 0x000a0d0a?
  m_UnknownFlags = 0; // This looks like flags: 0x01000000, 0x0400000, 0x06000000

  // In this block of 7 uint32s, it seems they have very different meanings pre and post v18

  // Pre v18, these are all unknown
  // - 3 and 4 are the same.
  // - 5 and 6 arer of a similar size
  m_Unknown2_preV18 = new COND_LT<number[]>(FMT_VER.V_180);

  // V18
  m_Unknown2a_V18 = new COND_GE<number>(FMT_VER.V_180); // Looks like an 'end pointer' like 0x27_end
  m_Unknown2b_V18 = new COND_GE<number>(FMT_VER.V_180); // 0x00
  m_0x27_End_V18 = new COND_GE<number>(FMT_VER.V_180);
  m_Unknown2d_V18 = new COND_GE<number>(FMT_VER.V_180); // 0x00
  m_Unknown2e_V18 = new COND_GE<number>(FMT_VER.V_180); // 25? (perhaps layer count?)
  m_StringCount_V18 = new COND_GE<number>(FMT_VER.V_180);
  m_Unknown2g_V18 = new COND_GE<number>(FMT_VER.V_180); // 0x00

  // V180 has 6 additional linked lists in the header
  // 5 of them are at the start
  m_LL_V18_1 = new COND_GE<LINKED_LIST>(FMT_VER.V_180);
  m_LL_V18_2 = new COND_GE<LINKED_LIST>(FMT_VER.V_180);
  m_LL_V18_3 = new COND_GE<LINKED_LIST>(FMT_VER.V_180);
  m_LL_V18_4 = new COND_GE<LINKED_LIST>(FMT_VER.V_180);
  m_LL_V18_5 = new COND_GE<LINKED_LIST>(FMT_VER.V_180);

  // Linked lists grouping top-level elements by type
  m_LL_0x04 = LL(); // Net assignments
  m_LL_0x06 = LL(); // Component definitions
  m_LL_0x0C = LL(); // Pin definitions
  m_LL_Shapes = LL(); // Shape segments (0x0E) and shapes (0x28)
  m_LL_0x14 = LL(); // Graphics
  m_LL_0x1B_Nets = LL(); // Nets
  m_LL_0x1C = LL(); // Padstacks
  m_LL_0x24_0x28 = LL(); // Rects and shapes
  m_LL_Unknown1 = LL();
  m_LL_0x2B = LL(); // Footprint definitions
  m_LL_0x03_0x30 = LL(); // Fields (0x03) and string wrappers (0x30)
  m_LL_0x0A = LL(); // DRC elements
  m_LL_0x1D_0x1E_0x1F = LL(); // Constraint sets, SI models, padstack dims
  m_LL_Unknown2 = LL();
  m_LL_0x38 = LL(); // Films
  m_LL_0x2C = LL(); // Tables
  m_LL_0x0C_2 = LL(); // Secondary pin definitions
  m_LL_Unknown3 = LL();

  // For some reason the 0x35 extents are recorded in the header
  m_0x35_Start_preV18 = new COND_LT<number>(FMT_VER.V_180);
  m_0x35_End_preV18 = new COND_LT<number>(FMT_VER.V_180);

  m_LL_Unknown5_V18 = new COND_GE<LINKED_LIST>(FMT_VER.V_180);
  m_LL_0x36 = LL();
  m_LL_Unknown5_preV18 = new COND_LT<LINKED_LIST>(FMT_VER.V_180);

  m_LL_Unknown6 = LL();
  m_LL_0x0A_2 = LL();

  m_Unknown3 = new COND_LT<number>(FMT_VER.V_180);

  m_LL_V18_6 = new COND_GE<LINKED_LIST>(FMT_VER.V_180);

  m_0x35_Start_V18 = new COND_GE<number>(FMT_VER.V_180);
  m_0x35_End_V18 = new COND_GE<number>(FMT_VER.V_180);

  // Fixed length string field (`std::array<char, 60>`), the raw bytes
  m_AllegroVersion: Uint8Array = new Uint8Array(60);

  m_Unknown4 = 0;

  m_MaxKey = 0;

  m_Unknown5_preV18 = new COND_LT<number[]>(FMT_VER.V_180);
  m_Unknown5_V18 = new COND_GE<number[]>(FMT_VER.V_180);

  m_BoardUnits: BOARD_UNITS = BOARD_UNITS.MILS;
  // 3 empty bytes here?

  m_Unknown6 = 0;
  m_Unknown7 = new COND_LT<number>(FMT_VER.V_180);

  // The end of the 0x27 object(?)
  // In V18, this is relocated to m_0x27_End_V18
  m_0x27_End_preV18 = new COND_LT<number>(FMT_VER.V_180);

  m_Unknown8 = 0;

  m_StringCount_preV18 = new COND_LT<number>(FMT_VER.V_180);

  m_Unknown9: number[] = zeros(50);

  m_Unknown10a = 0; // Often 0x000500FF
  m_Unknown10b = 0; // Similar to 0xFFA60000
  m_Unknown10c = 0; // Usually 0x01

  // E.g. 1000 for mils
  m_UnitsDivisor = 0;

  /**
   * The layer maps is a list of groups of two numbers.
   *
   * All files so far seem to have 25 entries, but unsure if that
   * is a universal value. But there's no obvious nearby value of '25'.
   */
  m_LayerMap: LAYER_MAP_ENTRY[] = Array.from({ length: 25 }, () => ({
    m_A: 0,
    m_LayerList0x2A: 0,
  }));

  GetStringsCount(): number {
    if (this.m_StringCount_V18.has_value()) return this.m_StringCount_V18.value();

    return this.m_StringCount_preV18.value();
  }

  Get_0x27_End(): number {
    if (this.m_0x27_End_V18.has_value()) return this.m_0x27_End_V18.value();

    return this.m_0x27_End_preV18.value();
  }

  GetUnknown5(): LINKED_LIST {
    if (this.m_LL_Unknown5_V18.has_value()) return this.m_LL_Unknown5_V18.value();

    return this.m_LL_Unknown5_preV18.value();
  }
}

/** `LAYER_INFO::CLASS`. */
export enum LAYER_CLASS {
  BOARD_GEOMETRY = 0x01,
  COMPONENT_VALUE = 0x02,
  DEVICE_TYPE = 0x03,
  DRAWING_FORMAT = 0x04,
  DRC_ERROR = 0x05,
  ETCH = 0x06,
  MANUFACTURING = 0x07,
  ANALYSIS = 0x08,
  PACKAGE_GEOMETRY = 0x09,
  PACKAGE_KEEPIN = 0x0a,
  PACKAGE_KEEPOUT = 0x0b,
  PIN = 0x0c,
  REF_DES = 0x0d,
  ROUTE_KEEPIN = 0x0e,
  ROUTE_KEEPOUT = 0x0f,
  TOLERANCE = 0x10,
  USER_PART_NUMBER = 0x11,
  VIA_CLASS = 0x12,
  VIA_KEEPOUT = 0x13,
  ANTI_ETCH = 0x14,
  BOUNDARY = 0x15,
  CONSTRAINTS_REGION = 0x16,
}

/**
 * `LAYER_INFO::SUBCLASS`: the second byte in a CLASS:SUBCLASS pair.
 *
 * THe same meanings can have different subclass codes in different classes
 */
export const LAYER_SUBCLASS = {
  // BOARD_GEOMETRY
  // BGEOM_PASTEMASK_BOTTOM     = 0x??
  // BGEOM_PASTEMASK_TOP        = 0x??
  BGEOM_OUTLINE: 0xea,
  BGEOM_CONSTRAINT_AREA: 0xeb,
  BGEOM_OFF_GRID_AREA: 0xec,
  BGEOM_SOLDERMASK_BOTTOM: 0xed,
  BGEOM_SOLDERMASK_TOP: 0xee,
  BGEOM_ASSEMBLY_DETAIL: 0xef,
  BGEOM_SILKSCREEN_BOTTOM: 0xf0,
  BGEOM_SILKSCREEN_TOP: 0xf1,
  BGEOM_SWITCH_AREA_BOTTOM: 0xf2,
  BGEOM_SWITCH_AREA_TOP: 0xf3,
  BGEOM_BOTH_ROOMS: 0xf4,
  BGEOM_BOTTOM_ROOM: 0xf5,
  BGEOM_TOP_ROOM: 0xf6,
  BGEOM_PLACE_GRID_BOTTOM: 0xf7,
  BGEOM_PLACE_GRID_TOP: 0xf8,
  BGEOM_DIMENSION: 0xf9,
  BGEOM_TOOLING_CORNERS: 0xfa,
  BGEOM_ASSEMBLY_NOTES: 0xfb,
  BGEOM_PLATING_BAR: 0xfc,
  BGEOM_DESIGN_OUTLINE: 0xfd,

  // COMPONENT_VALUE / DEVICE_TYPE / USER_PART_NUMBER
  // REF_DES / TOLERANCE
  DISPLAY_BOTTOM: 0xf8,
  DISPLAY_TOP: 0xf9,
  SILKSCREEN_BOTTOM: 0xfa,
  SILKSCREEN_TOP: 0xfb,
  ASSEMBLY_BOTTOM: 0xfc,
  ASSEMBLY_TOP: 0xfd,

  // ANALYSIS
  ANALYSIS_PCB_TEMPERATURE: 0xf8,
  ANALYSIS_HIGH_ISOCONTOUR: 0xf9,
  ANALYSIS_MEDIUM3_ISOCONTOUR: 0xfa,
  ANALYSIS_MEDIUM2_ISOCONTOUR: 0xfb,
  ANALYSIS_MEDIUM1_ISOCONTOUR: 0xfc,
  ANALYSIS_LOW_ISOCONTOUR: 0xfd,

  // DRAWING_FORMAT
  DFMT_REVISION_DATA: 0xf9,
  DFMT_REVISION_BLOCK: 0xfa,
  DFMT_TITLE_DATA: 0xfb,
  DFMT_TITLE_BLOCK: 0xfc,
  DFMT_OUTLINE: 0xfd,

  // PACKAGE_GEOMETRY
  PGEOM_PASTEMASK_BOTTOM: 0xec,
  PGEOM_PASTEMASK_TOP: 0xed,
  PGEOM_DFA_BOUND_BOTTOM: 0xee,
  PGEOM_DFA_BOUND_TOP: 0xef,
  PGEOM_DISPLAY_BOTTOM: 0xf1,
  PGEOM_DISPLAY_TOP: 0xf2,
  PGEOM_SOLDERMASK_BOTTOM: 0xf3,
  PGEOM_SOLDERMASK_TOP: 0xf4,
  PGEOM_BODY_CENTER: 0xf5,
  PGEOM_SILKSCREEN_BOTTOM: 0xf6,
  PGEOM_SILKSCREEN_TOP: 0xf7,
  PGEOM_PAD_STACK_NAME: 0xf8,
  PGEOM_PIN_NUMBER: 0xf9,
  PGEOM_PLACE_BOUND_BOTTOM: 0xfa,
  PGEOM_PLACE_BOUND_TOP: 0xfb,
  PGEOM_ASSEMBLY_BOTTOM: 0xfc,
  PGEOM_ASSEMBLY_TOP: 0xfd,

  // MANUFACTURING
  MFR_XSECTION_CHART: 0xf0,
  MFR_NO_PROBE_BOTTOM: 0xf1,
  MFR_NO_PROBE_TOP: 0xf2,
  MFR_AUTOSILK_BOTTOM: 0xf3,
  MFR_AUTOSILK_TOP: 0xf4,
  MFR_PROBE_BOTTOM: 0xf5,
  MFR_PROBE_TOP: 0xf6,
  MFR_NCDRILL_FIGURE: 0xf7,
  MFR_NCDRILL_LEGEND: 0xf8,
  MFR_NO_GLOSS_INTERNAL: 0xf9,
  MFR_NO_GLOSS_BOTTOM: 0xfa,
  MFR_NO_GLOSS_TOP: 0xfb,
  MFR_NO_GLOSS_ALL: 0xfc,
  MFR_PHOTOPLOT_OUTLINE: 0xfd,

  // CONSTRAINTS_REGION
  CREG_ALL: 0xfd,

  // PACKAGE_KEEPIN / ROUTE_KEEPIN
  KEEPIN_ALL: 0xfd,

  // PACKAGE_KEEPOUT / ROUTE_KEEPOUT / VIA_KEEPOUT
  KEEPOUT_BOTTOM: 0xfb,
  KEEPOUT_TOP: 0xfc,
  KEEPOUT_ALL: 0xfd,
} as const;

export interface LAYER_INFO {
  m_Class: number;
  m_Subclass: number;
}

/** `LAYER_INFO::operator==`. */
export const LayerInfoEquals = (a: LAYER_INFO, b: LAYER_INFO): boolean =>
  a.m_Class === b.m_Class && a.m_Subclass === b.m_Subclass;

const LI = (): LAYER_INFO => ({ m_Class: 0, m_Subclass: 0 });

/**
 * Arc segment used in tracks, zone outlines, and shape boundaries. The sweep direction
 * is encoded in m_SubType bit 6 (0x40 = clockwise). Center and radius are stored as
 * word-swapped IEEE 754 doubles (ReadAllegroFloat).
 */
export class BLK_0x01_ARC {
  m_UnknownByte = 0;
  m_SubType = 0; ///< Bit 6 (0x40) = clockwise direction
  m_Key = 0;
  m_Next = 0;
  m_Parent = 0;
  m_Unknown1 = 0;

  m_Unknown6 = new COND_GE<number>(FMT_VER.V_172);

  m_Width = 0;

  m_StartX = 0;
  m_StartY = 0;
  m_EndX = 0;
  m_EndY = 0;

  m_CenterX = 0; // Center
  m_CenterY = 0;
  m_Radius = 0;

  m_BoundingBoxCoords: number[] = zeros(4);
}

export class SUB_0x6C {
  m_NumEntries = 0;
  m_Entries: number[] = [];
}

export class SUB_0x70_0x74 {
  m_X0 = 0;
  m_X1 = 0;
  m_Entries: number[] = [];
}

export class SUB_0xF6 {
  m_Entries: number[] = zeros(20);
}

/** `std::variant<uint32_t, std::array<uint32_t, 2>, std::string, SUB_0x6C, SUB_0x70_0x74, SUB_0xF6>`. */
export type BLK_0x03_SUBSTRUCT =
  | number
  | [number, number]
  | string
  | SUB_0x6C
  | SUB_0x70_0x74
  | SUB_0xF6;

/**
 * Field/property references with variable-typed substructs. Used for constraint set names,
 * net properties, trace widths, and schematic cross-references.
 */
export class BLK_0x03_FIELD {
  m_Hdr1 = 0;

  m_Key = 0;
  m_Next = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  m_SubType = 0;
  m_Hdr2 = 0;
  m_Size = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);

  /** A default-constructed variant holds its first alternative, `uint32_t` 0. */
  m_Substruct: BLK_0x03_SUBSTRUCT = 0;
}

/**
 * Hdr1 keys for field roles
 */
export enum FIELD_KEYS {
  LOGICAL_PATH = 0x37,
  MIN_LINE_WIDTH = 0x55,
  NET_SCHEDULE = 0x77, ///< Net class/schedule assignment
  MAX_LINE_WIDTH = 0x173,
  MIN_NECK_WIDTH = 0x5c,
  MAX_NECK_LENGTH = 0x1fb,
  PHYS_CONSTRAINT_SET = 0x1a0, ///< Physical Constraint Set assignment
}

/**
 * Net assignment linking a net (0x1B) to its member objects. Each NET has a chain of
 * 0x04 blocks, each pointing to a connected item (0x05 track, 0x32 placed pad, 0x33 via,
 * or 0x28 shape for copper fills).
 */
export class BLK_0x04_NET_ASSIGNMENT {
  m_Type = 0;
  m_R = 0;
  m_Key = 0;
  m_Next = 0;
  m_Net = 0;
  m_ConnItem = 0;

  m_Unknown = new COND_GE<number>(FMT_VER.V_174);
}

/**
 * Track segment container. Each track has a layer, a net assignment (via 0x04), and a
 * linked list of line/arc segments starting at m_FirstSegPtr (0x15/0x16/0x17 lines or
 * 0x01 arcs). Also used for zone fill shapes (0x28) on the net assignment chain.
 */
export class BLK_0x05_TRACK {
  m_Layer: LAYER_INFO = LI();

  m_Key = 0;
  m_Next = 0;
  m_NetAssignment = 0;
  m_UnknownPtr1 = 0;
  m_Unknown2 = 0;
  m_Unknown3 = 0;
  m_UnknownPtr2a = 0;
  m_UnknownPtr2b = 0;
  m_Unknown4 = 0;
  m_UnknownPtr3a = 0;
  m_UnknownPtr3b = 0;

  m_Unknown5a = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown5b = new COND_GE<number>(FMT_VER.V_172);

  m_FirstSegPtr = 0;
  m_UnknownPtr5 = 0;
  m_Unknown6 = 0;
}

/**
 * Component/symbol definitions. Links to instances (0x07), function slots (0x0F),
 * and pin numbers (0x08).
 */
export class BLK_0x06_COMPONENT {
  m_Key = 0;

  // Pointer to the next BLK_0x06_COMPONENT
  m_Next = 0;
  // Pointer to COMP_DEVICE_TYPE string
  m_CompDeviceType = 0;
  // Pointer to SYM_NAME string
  m_SymbolName = 0;
  // Points to 0x07, first instance
  m_FirstInstPtr = 0;
  // Points to 0x0F, function slot
  m_PtrFunctionSlot = 0;
  // Points to 0x08, pin number
  m_PtrPinNumber = 0;

  // Points to 0x03, first 'field'
  m_Fields = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);
}

/**
 * Component instance reference data. Links a placed footprint (0x2D) to its reference
 * designator string, function instance (0x10), and placed pad list (0x32). One 0x07
 * exists per placed component.
 */
export class BLK_0x07_COMPONENT_INST {
  m_Key = 0;

  m_Next = 0;

  m_UnknownPtr1 = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown3 = new COND_GE<number>(FMT_VER.V_172);

  m_FpInstPtr = 0;

  m_Unknown4 = new COND_LT<number>(FMT_VER.V_172);

  m_RefDesStrPtr = 0;
  m_FunctionInstPtr = 0;
  m_X03Ptr = 0; // 0x03 or null
  m_Unknown5 = 0;
  m_FirstPadPtr = 0; // 0x32 or null
}

/**
 * Pin number within a component. Links to pin name (0x11) and is chained from the
 * component definition (0x06). The pin number string is version-dependent (m_StrPtr
 * for V172+, m_StrPtr16x for pre-V172).
 */
export class BLK_0x08_PIN_NUMBER {
  m_Type = 0;
  m_R = 0;
  m_Key = 0;

  m_Previous = new COND_GE<number>(FMT_VER.V_172);
  m_StrPtr16x = new COND_LT<number>(FMT_VER.V_172);

  m_Next = 0;

  m_StrPtr = new COND_GE<number>(FMT_VER.V_172);

  ///< Pointer to 0x11 PIN_NAME object
  m_PinNamePtr = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  m_Ptr4 = 0;

  GetStrPtr(): number {
    return this.m_StrPtr.value_or(this.m_StrPtr16x.value_or(0));
  }
}

/**
 * Intermediate link between copper fills and their parent shapes. Appears in fill-to-shape
 * resolution chains. Not directly imported.
 */
export class BLK_0x09_FILL_LINK {
  m_Key = 0;

  m_UnknownArray: number[] = zeros(4);

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  m_UnknownPtr1 = 0;
  m_UnknownPtr2 = 0;
  m_Unknown2 = 0;
  m_UnknownPtr3 = 0;
  m_UnknownPtr4 = 0;

  m_Unknown3 = new COND_GE<number>(FMT_VER.V_174);
}

/**
 * 0x0A objects represent DRC (Design Rule Check) elements.
 */
export class BLK_0x0A_DRC {
  m_T = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;
  m_Unknown1 = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);

  m_Coords: number[] = zeros(4);
  m_Unknown4: number[] = zeros(4);
  m_Unknown5: number[] = zeros(5);

  m_Unknown6 = new COND_GE<number>(FMT_VER.V_174);
}

/** `BLK_0x0C_PIN_DEF::MARKER_SHAPE`. */
export enum MARKER_SHAPE {
  // These are in the same order as the pad shapes, at least for the 'simple' shapes
  CIRCLE = 0x02,
  OCTAGON = 0x03,
  CROSS = 0x04,
  SQUARE = 0x05,
  RECTANGLE = 0x06,
  DIAMOND = 0x07,
  PENTAGON = 0x0a,
  OBLONG_X = 0x0b,
  OBLONG_Y = 0x0c,
  HEXAGON_X = 0x0f,
  HEXAGON_Y = 0x10,
  TRIANGLE = 0x12,
}

/**
 * Pin definition with shape type, drill character, coordinates, and size. Contains
 * version-dependent fields for the pad shape and drill character encoding.
 */
export class BLK_0x0C_PIN_DEF {
  m_T = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;

  m_Unknown1 = 0;
  m_Unknown2 = 0;

  m_Shape = new COND_LT<number>(FMT_VER.V_172);
  m_DrillChar = new COND_LT<number>(FMT_VER.V_172);
  m_UnknownPadding = new COND_LT<number>(FMT_VER.V_172); // or drill char?

  m_Shape16x = new COND_GE<number>(FMT_VER.V_172);
  m_DrillChars = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown_16x = new COND_GE<number>(FMT_VER.V_172);

  m_Unknown4 = 0;

  m_Unknown5 = new COND_GE<number>(FMT_VER.V_180);

  m_Coords: number[] = zeros(2);
  m_Size: number[] = zeros(2);

  m_GroupPtr = 0;
  m_Unknown6 = 0;
  m_Unknown7 = 0;

  m_Unknown8 = new COND_GE_LT<number>(FMT_VER.V_174, FMT_VER.V_180);

  GetShape(): number {
    return this.m_Shape16x.value_or(this.m_Shape.value_or(0));
  }
}

/**
 * Pad geometry and placement in board-absolute coordinates. References a padstack (0x1C)
 * for shape/drill definitions. Coordinates and rotation are board-absolute; for KiCad
 * footprint-local space, subtract the parent footprint's position and rotation.
 */
export class BLK_0x0D_PAD {
  m_Key = 0;
  m_NameStrId = 0;
  m_Next = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_174);

  m_CoordsX = 0; ///< Board coordinates. Use SetFPRelativePosition() for KiCad FP-local space.
  m_CoordsY = 0; ///< Board coordinates. Use SetFPRelativePosition() for KiCad FP-local space.

  m_PadStack = 0;
  m_Unknown2 = 0;

  m_Unknown3 = new COND_GE<number>(FMT_VER.V_172);

  m_Flags = 0;
  m_Rotation = 0; ///< Board-absolute millidegrees. Subtract footprint rotation for FP-local orientation.
}

/**
 * Rectangular shape.
 */
export class BLK_0x0E_RECT {
  m_T = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;
  m_FpPtr = 0;

  m_Unknown1 = 0;
  m_Unknown2 = 0;
  m_Unknown3 = 0;

  m_Unknown4 = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown5 = new COND_GE<number>(FMT_VER.V_172);

  m_Coords: number[] = zeros(4);

  m_UnknownArr: number[] = zeros(3);
  /// Rotation in millidegrees
  m_Rotation = 0;
}

/**
 * Function slot in a multi-slot component (e.g. a quad op-amp has 4 slots). Contains
 * the slot name string, device type, and links to the parent component (0x06) and
 * pin name list (0x11).
 */
export class BLK_0x0F_FUNCTION_SLOT {
  m_Key = 0;

  m_SlotName = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_174);

  /** `std::array<char, 32>`, the raw bytes. */
  m_CompDeviceType: Uint8Array = new Uint8Array(32);

  m_Next = new COND_GE<number>(FMT_VER.V_172);

  m_Ptr0x06 = 0;
  m_Ptr0x11 = 0;

  m_Unknown2 = 0;

  GetCompDeviceTypeStr(): string {
    // The string is stored as a fixed-length array, but is null-terminated
    const nul = this.m_CompDeviceType.indexOf(0);
    return wxFromBytes(nul < 0 ? this.m_CompDeviceType : this.m_CompDeviceType.subarray(0, nul));
  }
}

/**
 * Function instance linking a component instance (0x07) to its schematic function,
 * pin cross-references (0x12), and function slots (0x0F). Count matches 0x07 objects
 * one-to-one.
 */
export class BLK_0x10_FUNCTION_INST {
  m_Key = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  m_ComponentInstPtr = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_174);

  m_PtrX12 = 0;
  m_Unknown3 = 0;
  m_FunctionName = 0;
  m_Slots = 0; // 0x0F?
  m_Fields = 0; // Presumably a pointer to a string
}

/**
 * Pin name within a component, linked from function slots (0x0F). Maps pin names to pin
 * numbers (0x08) for schematic-to-layout cross-referencing.
 */
export class BLK_0x11_PIN_NAME {
  m_Type = 0;
  m_R = 0;
  m_Key = 0;
  ///< Pointer to pin name string
  m_PinNameStrPtr = 0;
  ///< Pointer to next 0x11 PIN_NAME object or 0x0F SLOT
  m_Next = 0;
  ///< Pointer to 0x08 PIN_NUMBER object
  m_PinNumberPtr = 0;
  m_Unknown1 = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_174);
}

/**
 * Cross-reference between objects. Exact semantics not fully understood; appears in
 * component and function instance chains.
 */
export class BLK_0x12_XREF {
  m_Type = 0;
  m_R = 0;
  m_Key = 0;
  m_Ptr1 = 0;
  m_Ptr2 = 0;
  m_Ptr3 = 0;
  m_Unknown1 = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_165);
  m_Unknown3 = new COND_GE<number>(FMT_VER.V_174);
}

/**
 * Graphics container holding a chain of line segments and arcs. Each 0x14 has a layer,
 * a parent pointer (usually a footprint 0x2D or board-level object), and a head pointer
 * to the first segment (0x15/0x16/0x17 or 0x01 arc).
 */
export class BLK_0x14_GRAPHIC {
  m_Type = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;
  m_Parent = 0;
  m_Flags = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);

  m_SegmentPtr = 0;
  m_Ptr0x03 = 0;
  m_Ptr0x26 = 0;
}

/**
 * 0x15 , 0x16, 0x17 are segments:
 *
 *  - 0x15: horizontal
 *  - 0x16: not horizontal or vertical
 *  - 0x17: vertical
 */
export class BLK_0x15_16_17_SEGMENT {
  m_Key = 0;
  m_Next = 0;
  m_Parent = 0;
  m_Flags = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);

  m_Width = 0;

  m_StartX = 0;
  m_StartY = 0;
  m_EndX = 0;
  m_EndY = 0;
}

/**
 * 0x1B objects are nets.
 *
 * They have names and pointers to various other objects.
 */
export class BLK_0x1B_NET {
  m_Key = 0;
  m_Next = 0;
  m_NetName = 0;

  m_Unknown1 = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);

  m_Type = 0;

  m_Assignment = 0;
  m_Ratline = 0;
  ///< Pointer to first 0x03 FIELD object or null
  m_FieldsPtr = 0;
  m_MatchGroupPtr = 0; ///< Diff pair / match group pointer (0x26 or 0x2C)
  m_ModelPtr = 0;
  m_UnknownPtr4 = 0;
  m_UnknownPtr5 = 0;
  m_UnknownPtr6 = 0;
}

/**
 * The type of the padstack.
 *
 * This seems a little uncertain in places (there seems to be 2 codes for SMD for example)
 */
export enum PAD_TYPE {
  THROUGH_VIA,
  VIA,
  SMD_PIN,
  SLOT,
  NPTH,
}

/** `PADSTACK_COMPONENT::TYPE`. */
export enum PADSTACK_COMPONENT_TYPE {
  TYPE_NULL = 0x00,
  TYPE_CIRCLE = 0x02,
  TYPE_OCTAGON = 0x03,
  TYPE_CROSS = 0x04,
  TYPE_SQUARE = 0x05,
  TYPE_RECTANGLE = 0x06,
  TYPE_DIAMOND = 0x07,
  TYPE_PENTAGON = 0x0a,
  TYPE_OBLONG_X = 0x0b,
  TYPE_OBLONG_Y = 0x0c,
  TYPE_HEXAGON_X = 0x0f,
  TYPE_HEXAGON_Y = 0x10,
  TYPE_TRIANGLE = 0x12,
  TYPE_SHAPE_SYMBOL = 0x16,
  TYPE_FLASH = 0x17,
  TYPE_DONUT = 0x19,
  TYPE_ROUNDED_RECTANGLE = 0x1b,
  TYPE_CHAMFERED_RECTANGLE = 0x1c,
  TYPE_NSIDED_POLYGON = 0x1e,
  TYPE_APERTURE_EXT = 0xee,
}

/**
 * Substruct in a padstack object. Each component is one slot in the padstack, representing
 * either a fixed technical layer or a per-copper-layer pad/antipad/thermal relief.
 */
export class PADSTACK_COMPONENT {
  m_Type = 0;
  m_UnknownByte1 = 0;
  m_UnknownByte2 = 0;
  m_UnknownByte3 = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  // Pad size
  m_W = 0;
  m_H = 0;

  // In rounded rectangles, this is the corner radius.
  // In chamfered rectangles, this is the chamfer size.
  m_Z1 = new COND_GE<number>(FMT_VER.V_172);

  // This is the pad component offset
  m_X3 = 0;
  m_X4 = 0;

  /**
   * Seems to point to various things:
   *
   * * 0x0F objects when the type is 0x06
   * * 0x28 objects when the type is 0x16
   */
  m_StrPtr = 0;

  // In versions < 17.2, seems to be not present in the last entry.
  m_Z2: number | null = null;
}

/** `BLK_0x1C_PADSTACK::HEADER_v16x::PAD_FLAGS`. */
export enum PAD_FLAGS_V16X {
  FLAG_PLATED = 0x01,
  // NPTHs seem to have this instead of 0x01
  // SMDs seems to have this or 0x01, no clear pattern identified
  FLAG_UNKNOWN1 = 0x02,
}

export class HEADER_v16x {
  m_DrillSize = 0;
  m_UnknownStr = 0;
  m_DrillMarkSizeX = 0;
  m_DrillMarkSizeY = 0;
  // Not sure these are in the right place but they're in here somewhere (usually zero)
  m_DrillOffsetX = 0;
  m_DrillOffsetY = 0;

  // Drill char presumably somewhere in here - can cross-match with 0x0C PIN_DEF to find
  m_DrillMarkShape = 0;
  // Mask or enum of pad flags, including plating
  m_Flags = 0;
  // An ASCII char, or 0x00
  m_DrillChar = 0;
  m_D = 0;

  // Probably some kind of type:
  // 0x0000 for through-hole
  // 0x0002 for SMD
  // 0x0400 for slots
  m_Unknown_1 = 0;

  m_ArrayNX = 0;
  m_ArrayNY = 0;

  m_LayerCount = 0;
  // Also unsure if these are in the right place (all usually 0?)
  m_ClearanceX = 0;
  m_ClearanceY = 0;

  m_TolerancePos = 0;
  m_ToleranceNeg = 0;
  m_Unknown_2 = 0;
  m_SlotX = 0;
  m_SlotY = 0;
  m_Unknown_3 = 0;

  m_Unknown_4 = new COND_GE<number>(FMT_VER.V_165);
}

/** `BLK_0x1C_PADSTACK::HEADER_v17x::PAD_FLAGS`. */
export enum PAD_FLAGS_V17X {
  // Some through-holes have this, some don't
  FLAG_UNKNOWN1 = 0x01,
  FLAG_PLATED = 0x20,
}

export class HEADER_v17x {
  // Presumably the same as the one in the v16x header
  m_UnknownStr = 0;
  m_Unknown1 = 0; // 0?
  m_Unknown2 = 0; // 0?

  m_PadType: PAD_TYPE = PAD_TYPE.THROUGH_VIA;

  // Not sure if this is really a substruct
  m_A = 0; // Only lower 4 bits (top 4 are type)
  m_B = 0;
  /// Mask of @c PAD_FLAGS values
  m_Flags = 0;
  m_D = 0;

  m_unknown3 = 0; // 1?
  m_Unknown4 = 0; // 0?

  m_ArrayNX = 0;
  m_ArrayNY = 0;
  m_LayerCount = 0;
  m_Unknown5 = 0; // 0?

  // Again, these are tentatively placed, they're always zero so far,
  // so it's hard to say where they go.
  // Assuming they follow the v16x layout and come after the layer count
  m_ClearanceX = 0;
  m_ClearanceY = 0;
  m_Unknown6a = 0;
  m_Unknown6b = 0;

  m_DrillSize = 0;
  m_TolerancePos = 0;
  m_ToleranceNeg = 0;
  m_SlotX = 0;
  m_SlotY = 0;
  m_ToleranceTravelPos = 0; // "TOLERANCE_TRAVEL" in BeagleBone_Black drill table
  m_ToleranceTravelNeg = 0;

  m_DrillMarkSizeX = 0;
  m_DrillMarkSizeY = 0;
  m_DrillMarkShape = 0;
  m_DrillChars = 0; // Presumably 4 drill chars

  // Probably holds secondary drill parameters and other new V17.2 features
  m_UnknownArr3: number[] = zeros(21);

  // To check - this could be another component?
  m_UnknownArr_v180 = new COND_GE<number[]>(FMT_VER.V_180);
}

/**
 * Fixed slot indices in the component table.
 *
 * The fixed slots come before the per-layer copper entries.
 * V<172 has 10 fixed slots, V>=172 has 21.
 *
 * All fixed slots are technical layers (solder mask, paste mask, film mask,
 * assembly variant, etc). The exact slot-to-layer mapping is version-dependent
 * and not fully contiguous.
 *
 * V<165 (10 fixed)
 *   Slot 0  = ~TSM (top solder mask)
 *   Slot 5  = ~TPM (top paste mask)
 *   Slot 7  = ~TFM (top film mask)
 *
 * V<172 (11 fixed):
 *   Slot 0  = ??? (looks the same size as a solder mask)
 *   Slot 1  = ~TSM (top solder mask)
 *   Slot 6  = ~TPM (top paste mask)
 *   Slot 8  = ~TFM (top film mask)
 *
 * V>=172 (21 fixed):
 *   Slot 14 = ~TSM (top solder mask)
 *   Slot 15 = ~BSM (bottom solder mask)
 */
export enum PADSTACK_SLOTS {
  // V<172 verified slots
  SOLDERMASK_TOP_V16X = 0,
  PASTEMASK_TOP_V16X = 5,
  FILMMASK_TOP_V16X = 7,

  SOLDERMASK_TOP_V165 = 1,
  PASTEMASK_TOP_V165 = 6,
  FILMMASK_TOP_V165 = 8,

  // V>=172 verified slots
  SOLDERMASK_TOP_V17X = 14,
  SOLDERMASK_BOT_V17X = 15,
  PASTEMASK_TOP_V17X = 16,
  PASTEMASK_BOT_V17X = 17,
}

/**
 * Component table layer offsets
 * In the component table's layer section, each layer has 3 or 4 slots, depending on version.
 */
export enum LAYER_COMP_SLOT {
  // First slot: Antipad
  ANTIPAD = 0,
  // Thermal relief shape
  THERMAL_RELIEF = 1,
  // Pad shape
  PAD = 2,
  // Unsure what this layer component slot is
  // But I suspect it's keepout, as that was added in V172.
  UNKNOWN_GE_V172 = 3,
}

/**
 * Padstack definition containing drill dimensions and a table of per-layer pad/antipad/thermal
 * components. The component table has fixed technical layer slots (solder mask, paste mask, etc.)
 * followed by per-copper-layer groups. Drill location is version-dependent (m_Drill for pre-V172,
 * m_DrillArr for V172+). Slot dimensions for oblong drills are stored as (primary, secondary)
 * not (X, Y), requiring orientation correction based on the copper pad aspect ratio.
 */
export class BLK_0x1C_PADSTACK {
  m_UnknownByte1 = 0;

  /**
   * The number of something. Drives the size of an array (with a multiplier).
   */
  m_N = 0;
  m_UnknownByte2 = 0;
  m_Key = 0;
  m_Next = 0;

  // The name of the padstack
  m_PadStr = 0;

  // The header fields arevery different between v16x and v17.x+
  m_Header: HEADER_v16x | HEADER_v17x = new HEADER_v16x();

  /**
   * Collection of components that make up the padstack.
   *
   * The number of components appears to be fixed by version:
   *
   * *  < 17.2: 10 + layer_count * 3
   * * >= 17.2: 21 + layer_count * 4
   *
   * The first 10/11/21 components seem to be a fixed set of technical layers.
   *
   * Then, a set of groups of 3/4 components for each layer.
   */
  m_Components: PADSTACK_COMPONENT[] = [];

  /**
   * How many of the entries are fixed roles (after this is n*layers)
   */
  m_NumFixedCompEntries = 0;
  m_NumCompsPerLayer = 0;

  /**
   * Some structure of m_N * 8 or 10:
   *
   * *  < 17.2: 8
   * * >= 17.2: 10
   */
  m_UnknownArrN: number[] = [];

  // Dispatch common properties to the header variant
  GetDrillSize(): number {
    return this.m_Header.m_DrillSize;
  }

  GetLayerCount(): number {
    return this.m_Header.m_LayerCount;
  }

  IsPlated(): boolean {
    if (this.m_Header instanceof HEADER_v17x)
      return (this.m_Header.m_Flags & PAD_FLAGS_V17X.FLAG_PLATED) !== 0;

    return (this.m_Header.m_Flags & PAD_FLAGS_V16X.FLAG_PLATED) !== 0;
  }
}

/**
 * Physical constraint sets containing trace width, clearance, and routing rules.
 */
export class BLK_0x1D_CONSTRAINT_SET {
  m_Key = 0;
  m_Next = 0; ///< Linked list next pointer (used by LL_WALKER)
  m_NameStrKey = 0; ///< String table key for constraint set name
  m_FieldPtr = 0; ///< Pointer to 0x03 FIELD with CS name (fallback when m_NameStrKey fails)
  m_SizeA = 0;
  m_SizeB = 0;

  /**
   * Per-copper-layer dimension values, 14 x int32 per record. Count equals board copper
   * layer count. V172+: f[1]=line_width, f[4]=clearance. Pre-V172: f[0]=line_width,
   * f[1]=spacing.
   */
  m_DataB: Uint8Array[] = []; // each 56 bytes
  /**
   * Records contain ASCII padstack/via name strings (null-terminated at offset 4)
   * and file path references. Size is m_SizeA * 256.
   */
  m_DataA: Uint8Array[] = []; // each 256 bytes

  m_Unknown4 = new COND_GE<number>(FMT_VER.V_172);
}

/**
 * Signal integrity and simulation model data (IBIS netlists). m_String contains ASCII
 * netlist text. Not imported.
 */
export class BLK_0x1E_SI_MODEL {
  m_Type = 0;
  m_T2 = 0;
  m_Key = 0;
  m_Next = 0; ///< Linked list next pointer (used by LL_WALKER)

  // Versioning seems unsure here
  // At least it is in Kinoma (V_164)
  m_Unknown2 = new COND_GE<number>(FMT_VER.V_164);
  m_Unknown3 = new COND_GE<number>(FMT_VER.V_164);

  m_StrPtr = 0;
  m_Size = 0;

  m_String = '';

  m_Unknown4 = new COND_GE<number>(FMT_VER.V_172);
}

/**
 * Per-padstack dimension records with name and value. Not imported.
 */
export class BLK_0x1F_PADSTACK_DIM {
  m_Key = 0;
  m_Next = 0; ///< Linked list next pointer (used by LL_WALKER)
  m_Unknown2 = 0;
  m_Unknown3 = 0;
  m_Unknown4 = 0;
  m_Unknown5 = 0;
  m_Size = 0;

  /**
   * Version-dependent substruct holding padstack dimension name and value
   */
  m_Substruct: Uint8Array = new Uint8Array(0);
}

/**
 * Unknown purpose.
 *
 * Seems to contain one or two fixed-size arrays of uint32 values
 * (but they could be some set of fields).
 *
 * This block is sometimes used at the parent of, e.g. line segments.
 *
 * Only seen so far in Project Olympus 15061-1b.brd
 */
export class BLK_0x20_UNKNOWN {
  m_Type = 0;
  m_R = 0;
  m_Key = 0;
  m_Next = 0;
  m_UnknownArray1: number[] = zeros(7);

  m_UnknownArray2 = new COND_GE<number[]>(FMT_VER.V_174);
}

/**
 * Headered data blob containing structured board data such as layer stackup definitions,
 * material properties, and design rule tables. The payload (m_Data) is a variable-length
 * byte array whose interpretation depends on context.
 */
export class BLK_0x21_BLOB {
  m_Type = 0;
  m_R = 0;
  m_Size = 0;
  m_Key = 0;

  /**
   * An array of bytes that seems to be a variable length
   *
   * Size = m_Size - 12 (i.e. size is the whole header size)
   */
  m_Data: Uint8Array = new Uint8Array(0);
}

/**
 * Purpose not determined. Contains an 8-element array of uint32 values.
 */
export class BLK_0x22_UNKNOWN {
  m_Type = 0;
  m_T2 = 0;
  m_Key = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  m_UnknownArray: number[] = zeros(8);
}

/**
 * 0x23 objects represent ratlines.
 */
export class BLK_0x23_RATLINE {
  m_Type = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;

  m_Flags: number[] = zeros(2);

  m_Ptr1 = 0;
  m_Ptr2 = 0;
  m_Ptr3 = 0;

  m_Coords: number[] = zeros(5);

  m_Unknown1: number[] = zeros(4);

  m_Unknown2 = new COND_GE<number[]>(FMT_VER.V_164);

  m_Unknown3 = new COND_GE<number>(FMT_VER.V_174);
}

/**
 * Rectangle defined by four coordinates. Appears on the m_LL_0x24_0x28 header linked
 * list for keepout areas and other rectangular regions. Has a layer and parent pointer.
 *
 * Not entirely clear how this differs from 0x0E yet.
 */
export class BLK_0x24_RECT {
  m_Type = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;
  m_Parent = 0;
  m_Unknown1 = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);

  m_Coords: number[] = zeros(4);

  m_Ptr2 = 0;

  m_Unknown3 = 0;
  m_Unknown4 = 0;
  /// Rotation in millidegrees
  m_Rotation = 0;
}

/**
 * Match group indirection for differential pairs and match groups.
 * NET.m_MatchGroupPtr -> 0x26 -> m_GroupPtr -> 0x2C TABLE -> group name string (V172+).
 */
export class BLK_0x26_MATCH_GROUP {
  m_Type = 0;
  m_R = 0;
  m_Key = 0;
  m_MemberPtr = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  m_GroupPtr = 0;
  m_ConstPtr = 0; ///< Points to timing/delay constraints (field type 0x63), not physical constraints

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_174);
}

/**
 * Serialized Constraint Manager database containing secondary name table (V172+),
 * material stackup, color palette, and constraint manager state. NOT a heap pointer table.
 *
 * Pre-V172 uses runtime heap pointer format. V172+ uses compact indices that match
 * geometric block keys. The block extends to an offset defined in the header (m_0x27_End).
 * Not imported directly since it is a display/navigation structure, not design data.
 */
export class BLK_0x27_CSTRMGR_XREF {
  m_Refs: number[] = [];
}

/**
 * Polygon shape defined by a linked list of segments starting at m_FirstSegmentPtr
 * (0x15/0x16/0x17 lines and 0x01 arcs). Used for zone outlines (BOUNDARY class on
 * m_LL_Shapes), computed copper fills (on net assignment chains), board outline, keepout
 * areas, place bounds, and custom pad shapes (shape symbol type 0x16).
 *
 * Zone net resolution follows m_Ptr7 (V172+) or m_Ptr7_16x (pre-V172) through a
 * 0x2C TABLE and 0x37 pointer array to reach the owning 0x1B NET.
 */
export class BLK_0x28_SHAPE {
  m_Type = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;
  m_Ptr1 = 0;
  m_Unknown1 = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown3 = new COND_GE<number>(FMT_VER.V_172);

  m_Ptr2 = 0;
  m_Ptr3 = 0;
  m_FirstKeepoutPtr = 0;
  m_FirstSegmentPtr = 0;
  m_Unknown4 = 0;
  m_Unknown5 = 0;

  m_TablePtr = new COND_GE<number>(FMT_VER.V_172);

  m_Ptr6 = 0;

  m_TablePtr_16x = new COND_LT<number>(FMT_VER.V_172);

  m_Coords: number[] = zeros(4);

  GetTablePtr(): number {
    return this.m_TablePtr.value_or(this.m_TablePtr_16x.value_or(0));
  }
}

/**
 * 0x29 objects may represent pins in .dra files.
 *
 * Full version-specific structures not clear yet.
 */
export class BLK_0x29_PIN {
  m_Type = 0;
  m_T = 0;
  m_Key = 0;

  // Points to something in the header
  m_Ptr1 = 0;
  m_Ptr2 = 0;

  m_Null = 0; // Null value

  m_Ptr3 = 0;

  m_Coord1 = 0;
  m_Coord2 = 0;

  m_PtrPadstack = 0;

  m_Unknown1 = 0;

  // Pointer to a string, e.g., "2" in R0603
  m_PtrX30 = 0;

  m_Unknown2 = 0;
  m_Unknown3 = 0;
  m_Unknown4 = 0;
}

export interface NONREF_ENTRY {
  m_Name: string;
}

export interface REF_ENTRY {
  mLayerNameId: number; // string ID
  m_Properties: number;
  m_Unknown: number;
}

/**
 * Represents a list of layers.
 */
export class BLK_0x2A_LAYER_LIST {
  m_NumEntries = 0;

  m_Unknown = new COND_GE<number>(FMT_VER.V_174);

  m_NonRefEntries = new COND_LT<NONREF_ENTRY[]>(FMT_VER.V_165);
  m_RefEntries = new COND_GE<REF_ENTRY[]>(FMT_VER.V_165);

  m_Key = 0;
}

/**
 * Footprint definition (template) shared by multiple placed instances. Contains the
 * library symbol path (m_SymLibPathPtr), bounding box, and a linked list of placed
 * instances starting at m_FirstInstPtr (0x2D blocks).
 */
export class BLK_0x2B_FOOTPRINT_DEF {
  m_Key = 0;

  m_FpStrRef = 0;
  m_Unknown1 = 0;

  // Could these be signed?
  m_Coords: number[] = zeros(4);

  m_Next = 0;
  m_FirstInstPtr = 0;
  m_UnknownPtr3 = 0;
  m_UnknownPtr4 = 0;
  m_UnknownPtr5 = 0;
  m_SymLibPathPtr = 0;
  m_UnknownPtr6 = 0;
  m_UnknownPtr7 = 0;
  m_UnknownPtr8 = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_164);
  m_Unknown3 = new COND_GE<number>(FMT_VER.V_172);
}

/**
 * The subtype of a table (`BLK_0x2C_TABLE::SUBTYPE`).
 *
 * Not all of these are clear, but these are the ones that have been observed so far.
 */
export enum TABLE_SUBTYPE {
  SUBTYPE_UNKNOWN = 0,

  SUBTYPE_0x05 = 0x05,

  SUBTYPE_0x06 = 0x06,
  SUBTYPE_0x0c = 0x0c,
  SUBTYPE_0x15 = 0x15,
  SUBTYPE_0x16 = 0x16,
  SUBTYPE_0x20 = 0x20,
  SUBTYPE_0x23 = 0x23,

  /// Some kind of net match group
  SUBTYPE_0x102 = 0x102,
  /// Diff pair
  SUBTYPE_0x103 = 0x103,
  SUBTYPE_0x107 = 0x107,

  /// Used for drill charts and x-section charts
  SUBTYPE_GRAPHICAL_GROUP = 0x110,
}

/**
 * Lookup table used for named associations. Contains a string pointer (m_StringPtr) and
 * child pointers (m_Ptr1/m_Ptr2/m_Ptr3). Used in match group name resolution (diff pair
 * and match group names), zone net resolution (intermediate between 0x28 shape and 0x37
 * pointer array), and other key-to-name mappings.
 */
export class BLK_0x2C_TABLE {
  m_Type = 0;
  m_SubType = 0;
  m_Key = 0;
  m_Next = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown3 = new COND_GE<number>(FMT_VER.V_172);

  m_StringPtr = 0;

  m_Unknown4 = new COND_LT<number>(FMT_VER.V_172);

  m_Ptr1 = 0;
  m_Ptr2 = 0;
  m_Ptr3 = 0;

  m_Flags = 0;
}

/**
 * Placed footprint instance on the board. Contains position (m_CoordX/Y), rotation
 * (m_Rotation in millidegrees), and layer (0=top, 1=bottom). Links to graphics (0x14
 * via m_GraphicPtr), placed pads (0x32 via m_FirstPadPtr), text (0x30 via m_TextPtr),
 * and instance reference data (0x07 via m_InstRef). Bottom-layer footprints must be
 * flipped AFTER adding all children.
 */
export class BLK_0x2D_FOOTPRINT_INST {
  m_UnknownByte1 = 0;
  m_Layer = 0; // 0 = top (F_Cu), 1 = bottom (B_Cu)
  m_UnknownByte2 = 0;

  m_Key = 0;

  m_Next = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  // Unsure what 16x means
  m_InstRef16x = new COND_LT<number>(FMT_VER.V_172);

  m_Unknown2 = 0;
  m_Unknown3 = 0;

  m_Unknown4 = new COND_GE<number>(FMT_VER.V_172);

  m_Flags = 0;

  m_Rotation = 0; ///< Millidegrees (divide by 1000 for degrees)
  m_CoordX = 0;
  m_CoordY = 0;

  // Presumably equivalent to m_InstRef16x
  m_InstRef = new COND_GE<number>(FMT_VER.V_172);

  m_GraphicPtr = 0;
  m_FirstPadPtr = 0;
  m_TextPtr = 0; // Points to 0x30

  m_AssemblyPtr = 0;
  m_AreasPtr = 0;
  m_UnknownPtr1 = 0;
  m_UnknownPtr2 = 0;

  GetInstRef(): number {
    return this.m_InstRef.value_or(this.m_InstRef16x.value_or(0));
  }
}

/**
 * Connection point at a track junction or pad-to-track transition. Contains coordinates
 * and links to the net assignment and connected track.
 */
export class BLK_0x2E_CONNECTION {
  m_Type = 0;
  m_T2 = 0;
  m_Key = 0;
  m_Next = 0;
  m_NetAssignment = 0;
  m_Unknown1 = 0;
  m_CoordX = 0;
  m_CoordY = 0;
  m_Connection = 0;
  m_Unknown2 = 0;

  m_Unknown3 = new COND_GE<number>(FMT_VER.V_172);
}

/**
 * Purpose not determined. Contains a 6-element array of uint32 values.
 */
export class BLK_0x2F_UNKNOWN {
  m_Type = 0;
  m_T2 = 0;
  m_Key = 0;

  m_UnknownArray: number[] = zeros(6);
}

/** `BLK_0x30_STR_WRAPPER::TEXT_REVERSAL`. */
export enum TEXT_REVERSAL {
  STRAIGHT,
  REVERSED,
  UNKNOWN,
}

/** `BLK_0x30_STR_WRAPPER::TEXT_ALIGNMENT`. */
export enum TEXT_ALIGNMENT {
  LEFT,
  RIGHT,
  CENTER,
  UNKNOWN,
}

export interface TEXT_PROPERTIES {
  m_Key: number;
  m_Flags: number;
  m_Alignment: TEXT_ALIGNMENT;
  m_Reversal: TEXT_REVERSAL;
}

/**
 * Text object with position, rotation, layer, font properties, and alignment. References
 * a 0x31 string graphic (m_StrGraphicPtr) for the actual text content. Used for reference
 * designators, component values, and other board text. Font index in TEXT_PROPERTIES.m_Key
 * is 1-based into the 0x36 FontDef_X08 list.
 */
export class BLK_0x30_STR_WRAPPER {
  m_Type = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);
  m_Font = new COND_GE<TEXT_PROPERTIES>(FMT_VER.V_172);
  m_Ptr1 = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown3 = new COND_GE<number>(FMT_VER.V_174);

  m_StrGraphicPtr = 0;

  m_PtrGroup_17x = new COND_GE<number>(FMT_VER.V_172);
  m_Unknown4 = new COND_LT<number>(FMT_VER.V_172);

  m_Font16x = new COND_LT<TEXT_PROPERTIES>(FMT_VER.V_172);

  m_Ptr2 = new COND_GE<number>(FMT_VER.V_172);

  m_CoordsX = 0;
  m_CoordsY = 0;

  m_Unknown5 = 0;
  m_Rotation = 0; ///< Millidegrees

  m_PtrGroup_16x = new COND_LT<number>(FMT_VER.V_172);

  GetGroupPtr(): number {
    return this.m_PtrGroup_17x.value_or(this.m_PtrGroup_16x.value_or(0));
  }
}

/** `BLK_0x31_SGRAPHIC::STRING_LAYER`. */
export enum STRING_LAYER {
  BOT_TEXT,
  TOP_TEXT,
  BOT_PIN,
  TOP_PIN,
  TOP_PIN_LABEL,
  BOT_REFDES,
  TOP_REFDES,
  UNKNOWN,
}

/**
 * String graphic content holding the actual text value and its display layer category.
 * Referenced by 0x30 text wrapper objects via m_StrGraphicPtr.
 */
export class BLK_0x31_SGRAPHIC {
  m_T = 0;
  m_Layer: STRING_LAYER = STRING_LAYER.BOT_TEXT;
  m_Key = 0;
  m_StrGraphicWrapperPtr = 0;

  m_CoordsX = 0;
  m_CoordsY = 0;

  m_Unknown = 0;
  m_Len = 0;

  m_Un2 = new COND_GE<number>(FMT_VER.V_174);

  m_Value = '';
}

/**
 * Placed pad instance linking a pad definition (0x0D via m_PadPtr) to its parent
 * footprint (m_ParentFp) and net (m_NetPtr). Chained within a footprint via m_NextInFp
 * and within a component instance via m_NextInCompInst.
 */
export class BLK_0x32_PLACED_PAD {
  m_Type = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;
  m_NetPtr = 0;
  m_Flags = 0;

  m_Prev = new COND_GE<number>(FMT_VER.V_172);

  m_NextInFp = 0;
  m_ParentFp = 0;
  m_Track = 0;
  m_PadPtr = 0;
  m_Ptr6 = 0;
  m_Ratline = 0;
  m_PtrPinNumber = 0;
  m_NextInCompInst = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_172);

  m_NameText = 0;
  m_Ptr11 = 0;

  m_Coords: number[] = zeros(4);
}

/**
 * Via instance with board position, padstack reference (m_Padstack for drill/annular ring
 * definitions), and net assignment (m_NetPtr). Drill diameter comes from the referenced
 * padstack (version-dependent location).
 */
export class BLK_0x33_VIA {
  m_LayerInfo: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;
  m_NetPtr = 0;
  m_Unknown2 = 0;

  m_Unknown3 = new COND_GE<number>(FMT_VER.V_172);

  m_UnknownPtr1 = 0;

  m_UnknownPtr2 = new COND_GE<number>(FMT_VER.V_172);

  m_CoordsX = 0;
  m_CoordsY = 0;

  m_Connection = 0;
  m_Padstack = 0;
  m_UnknownPtr5 = 0;
  m_UnknownPtr6 = 0;

  m_Unknown4 = 0;
  m_Unknown5 = 0;

  m_BoundingBoxCoords: number[] = zeros(4);
}

/**
 * 0x34 objects represent keepouts.
 */
export class BLK_0x34_KEEPOUT {
  m_T = 0;
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;
  m_Ptr1 = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  m_Flags = 0;
  m_FirstSegmentPtr = 0;
  m_Ptr3 = 0;
  m_Unknown2 = 0;
}

/**
 * File path references to Allegro log and report files (terminator.log, eclrpt.txt).
 * Content is a 120-byte fixed buffer with null-terminated path strings. Not imported.
 */
export class BLK_0x35_FILE_REF {
  m_T2 = 0;
  m_T3 = 0;

  m_Content: Uint8Array = new Uint8Array(120);
}

export class X02 {
  m_String = '';
  m_Xs: number[] = zeros(14);

  m_Ys = new COND_GE<number[]>(FMT_VER.V_164);
  m_Zs = new COND_GE<number[]>(FMT_VER.V_172);
}

export class X03 {
  m_Str = new COND_GE<string>(FMT_VER.V_172);
  m_Str16x = new COND_LT<string>(FMT_VER.V_172);
  m_Unknown1 = new COND_GE<number>(FMT_VER.V_174);
}

export class X05 {
  m_Unknown: Uint8Array = new Uint8Array(28);

  // The trailing word first appears in 17.5. On 17.4 the record is 28 bytes, and
  // reading a phantom word here overruns every slot and desyncs the object stream.
  m_Unknown2 = new COND_GE<number>(FMT_VER.V_175);
}

export class X06 {
  m_N = 0;
  m_R = 0;
  m_S = 0;
  m_Unknown1 = 0;

  m_Unknown2 = new COND_LT<number[]>(FMT_VER.V_172);
}

export class FontDef_X08 {
  m_A = 0;
  m_B = 0;
  m_CharHeight = 0;
  m_CharWidth = 0;

  m_Unknown2 = new COND_GE<number>(FMT_VER.V_174);

  m_CharacterSpace = 0;
  m_LineSpace = 0;
  m_Unknown3 = 0; // Always 0?
  m_StrokeWidth = 0; // Aka "photo width"

  m_Ys = new COND_GE<number[]>(FMT_VER.V_172);
}

export class X0B {
  m_Unknown: Uint8Array = new Uint8Array(1016);
}

export class X0C {
  m_Unknown: Uint8Array = new Uint8Array(232);
}

export class X0D {
  m_Unknown: Uint8Array = new Uint8Array(200);
}

export class X0F {
  m_Key = 0;
  m_Ptrs: number[] = zeros(3);
  m_Ptr2 = 0;
}

export class X10 {
  m_Unknown: Uint8Array = new Uint8Array(108);

  // V18 has an extra uint32 "somewhere" in this block
  m_Unknown2 = new COND_GE<number>(FMT_VER.V_180);
}

// So far only seen in a V175 file (Jetson)
export class X12 {
  // No point reading this before we can use it
  // std::array<uint8_t, 1052> m_Unknown;
}

export type DEF_TABLE_ITEM =
  | X02
  | X03
  | X05
  | X06
  | FontDef_X08
  | X0B
  | X0C
  | X0D
  | X0F
  | X10
  | X12;

/**
 * Heterogeneous definition table containing font metrics (FontDef_X08), layer name
 * definitions (X03), film definitions (X02), and other board-level configuration data.
 * Items are stored as a variant vector indexed by substruct code.
 */
export class BLK_0x36_DEF_TABLE {
  m_Code = 0;
  m_Key = 0;
  m_Next = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_172);

  m_NumItems = 0;
  m_Count = 0;
  m_LastIdx = 0;
  m_Unknown2 = 0;

  m_Unknown3 = new COND_GE<number>(FMT_VER.V_174);

  m_Items: DEF_TABLE_ITEM[] = [];
}

/**
 * Fixed-capacity pointer array (100 entries). Used in zone net resolution where
 * m_Ptrs[0] points to the owning 0x1B NET block. m_Count indicates how many entries
 * are valid.
 */
export class BLK_0x37_PTR_ARRAY {
  m_T = 0;
  m_T2 = 0;
  m_Key = 0;
  m_GroupPtr = 0;
  m_Next = 0;
  m_Capacity = 0;
  m_Count = 0;
  m_Unknown2 = 0;

  m_Unknown3 = new COND_GE<number>(FMT_VER.V_174);

  m_Ptrs: number[] = zeros(100);
}

/**
 * 0x38 objects represent films.
 */
export class BLK_0x38_FILM {
  m_Key = 0;
  m_Next = 0;
  m_LayerList = 0;

  m_FilmName = new COND_LT<string>(FMT_VER.V_166);

  m_LayerNameStr = new COND_GE<number>(FMT_VER.V_166);
  m_Unknown2 = new COND_GE<number>(FMT_VER.V_166);

  m_UnknownArray1: number[] = zeros(7);

  m_Unknown3 = new COND_GE<number>(FMT_VER.V_174);
}

/**
 * 0x39 objects represent a film layer list.
 */
export class BLK_0x39_FILM_LAYER_LIST {
  m_Key = 0;
  m_Parent = 0;
  m_Head = 0;

  // Array of 22 uint16_t values
  m_X: number[] = zeros(22);
}

/**
 * 0x3A objects represent a list of films
 */
export class BLK_0x3A_FILM_LIST_NODE {
  m_Layer: LAYER_INFO = LI();
  m_Key = 0;
  m_Next = 0;
  m_Unknown = 0;

  m_Unknown1 = new COND_GE<number>(FMT_VER.V_174);
}

/**
 * Named property with type and value strings. Carries board-level metadata such as
 * component attributes and design parameters.
 */
export class BLK_0x3B_PROPERTY {
  m_T = 0;
  m_SubType = 0;
  m_Len = 0;

  m_Name = '';
  m_Type = '';

  m_Unknown1 = 0;
  m_Unknown2 = 0;

  m_Unknown3 = new COND_GE<number>(FMT_VER.V_172);

  m_Value = '';
}

/**
 * Ordered list of block keys. Context-dependent usage; appears alongside other
 * block types for grouping related objects.
 */
export class BLK_0x3C_KEY_LIST {
  m_T = 0;
  m_T2 = 0;
  m_Key = 0;

  m_Unknown = new COND_GE<number>(FMT_VER.V_174);

  m_NumEntries = 0;
  m_Entries: number[] = [];
}

/**
 * Raw board structure that we will build as we parse the file.
 */
export class RAW_BOARD {
  m_Header: FILE_HEADER | null = null;

  /**
   * What version is this file? We will need this to correctly interpret some structures.
   */
  m_FmtVer: FMT_VER = FMT_VER.V_UNKNOWN;

  /**
   * The string map is a map of U32 ID to strings.
   * It seems to always be located at byte 0x1200 in the file.
   */
  m_StringTable = new Map<number, string>();

  // All the objects in the file
  m_Objects: BLOCK_BASE[] = [];

  // Map of keys to objects (for the objects we can get keys for)
  m_ObjectKeyMap = new Map<number, BLOCK_BASE>();

  // Lists of the objects by type
  m_ObjectLists = new Map<number, BLOCK_BASE[]>();

  static readonly STRING_TABLE_OFFSET = 0x1200;

  GetObjectByKey(aKey: number): BLOCK_BASE | null {
    return this.m_ObjectKeyMap.get(aKey) ?? null;
  }

  GetString(aId: number): string {
    return this.m_StringTable.get(aId) ?? '';
  }
}
