// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright Quilter and The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/allegro/convert/allegro_parser.h` / `.cpp`: reads a `.brd`
 * buffer into a BRD_DB - the header, the string table at 0x1200, then the
 * object blocks one after another.
 *
 * `ReadCond( stream, ver, field )` deduces the read from the field's C++ type;
 * here the reader is passed alongside (`U32`, `S32`, `U16`, `U8`, `LL`,
 * `ARR( n )`), which is the same choice written out.
 */
import { IO_ERROR, THROW_IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import { BRD_DB } from './allegro_db.js';
import {
  BLK_0x01_ARC,
  BLK_0x03_FIELD,
  BLK_0x04_NET_ASSIGNMENT,
  BLK_0x05_TRACK,
  BLK_0x06_COMPONENT,
  BLK_0x07_COMPONENT_INST,
  BLK_0x08_PIN_NUMBER,
  BLK_0x09_FILL_LINK,
  BLK_0x0A_DRC,
  BLK_0x0C_PIN_DEF,
  BLK_0x0D_PAD,
  BLK_0x0E_RECT,
  BLK_0x0F_FUNCTION_SLOT,
  BLK_0x10_FUNCTION_INST,
  BLK_0x11_PIN_NAME,
  BLK_0x12_XREF,
  BLK_0x14_GRAPHIC,
  BLK_0x15_16_17_SEGMENT,
  BLK_0x1B_NET,
  BLK_0x1C_PADSTACK,
  BLK_0x1D_CONSTRAINT_SET,
  BLK_0x1E_SI_MODEL,
  BLK_0x1F_PADSTACK_DIM,
  BLK_0x20_UNKNOWN,
  BLK_0x21_BLOB,
  BLK_0x22_UNKNOWN,
  BLK_0x23_RATLINE,
  BLK_0x24_RECT,
  BLK_0x26_MATCH_GROUP,
  BLK_0x27_CSTRMGR_XREF,
  BLK_0x28_SHAPE,
  BLK_0x29_PIN,
  BLK_0x2A_LAYER_LIST,
  BLK_0x2B_FOOTPRINT_DEF,
  BLK_0x2C_TABLE,
  BLK_0x2D_FOOTPRINT_INST,
  BLK_0x2E_CONNECTION,
  BLK_0x2F_UNKNOWN,
  BLK_0x30_STR_WRAPPER,
  BLK_0x31_SGRAPHIC,
  BLK_0x32_PLACED_PAD,
  BLK_0x33_VIA,
  BLK_0x34_KEEPOUT,
  BLK_0x35_FILE_REF,
  BLK_0x36_DEF_TABLE,
  BLK_0x37_PTR_ARRAY,
  BLK_0x38_FILM,
  BLK_0x39_FILM_LAYER_LIST,
  BLK_0x3A_FILM_LIST_NODE,
  BLK_0x3B_PROPERTY,
  BLK_0x3C_KEY_LIST,
  BLOCK,
  type BLOCK_BASE,
  BOARD_UNITS,
  type COND_FIELD_BASE,
  FILE_HEADER,
  FMT_VER,
  FontDef_X08,
  HEADER_v16x,
  HEADER_v17x,
  type LAYER_INFO,
  type LINKED_LIST,
  type NONREF_ENTRY,
  PAD_TYPE,
  PADSTACK_COMPONENT,
  RAW_BOARD,
  type REF_ENTRY,
  STRING_LAYER,
  SUB_0x6C,
  SUB_0x70_0x74,
  SUB_0xF6,
  TEXT_ALIGNMENT,
  type TEXT_PROPERTIES,
  TEXT_REVERSAL,
  X02,
  X03,
  X05,
  X06,
  X0B,
  X0C,
  X0D,
  X0F,
  X10,
  X12,
} from './allegro_pcb_structs.js';
import type { FILE_STREAM } from './allegro_stream.js';

/** `%#010x` / `%#010zx`. */
const hex010 = (v: number): string =>
  v === 0 ? '0000000000' : `0x${v.toString(16).padStart(8, '0')}`;
/** `%#02x`: the `0x` prefix on anything but zero, no padding past two characters. */
const hex02 = (v: number): string => (v === 0 ? '00' : `0x${v.toString(16)}`);

function ReadLL(aStream: FILE_STREAM, aVer: FMT_VER): LINKED_LIST {
  const w1 = aStream.ReadU32();
  const w2 = aStream.ReadU32();

  if (aVer >= FMT_VER.V_180) {
    // V18 stores head (chain start key) first, tail (sentinel key) second
    return { m_Tail: w2, m_Head: w1 };
  }

  // V16/V17 stores tail (sentinel pointer) first, head (chain start) second
  return { m_Tail: w1, m_Head: w2 };
}

const f64Scratch = new DataView(new ArrayBuffer(8));

function ReadAllegroFloat(aStream: FILE_STREAM): number {
  const a = aStream.ReadU32();
  const b = aStream.ReadU32();

  // `( uint64_t( a ) << 32 ) + b`, memcpy'd into a double: on a little-endian
  // host the low word (b) is the first four bytes in memory.
  f64Scratch.setUint32(0, b, true);
  f64Scratch.setUint32(4, a, true);
  return f64Scratch.getFloat64(0, true);
}

function ReadArrayU32(aStream: FILE_STREAM, aArray: number[]): void {
  for (let i = 0; i < aArray.length; i++) aArray[i] = aStream.ReadU32();
}

/** `ReadField<T>`, with the type given as its reader. */
type READER<T> = (aStream: FILE_STREAM, aVer: FMT_VER) => T;
const U32: READER<number> = (s) => s.ReadU32();
const U8: READER<number> = (s) => s.ReadU8();
const U16: READER<number> = (s) => s.ReadU16();
const S32: READER<number> = (s) => s.ReadS32();
const LL: READER<LINKED_LIST> = ReadLL;
/** `std::array<uint32_t, n>`: every element read as a U32, even an int32 array. */
const ARR =
  (n: number): READER<number[]> =>
  (s) => {
    const out = new Array<number>(n).fill(0);
    ReadArrayU32(s, out);
    return out;
  };

/**
 * Read a single conditional field from the stream, if it exists at the current
 * version.
 */
function ReadCond<T>(
  aStream: FILE_STREAM,
  aFmtVer: FMT_VER,
  aField: COND_FIELD_BASE<T>,
  aRead: READER<T>,
): void {
  if (aField.exists(aFmtVer)) aField.set(aRead(aStream, aFmtVer));
}

/**
 * Parses a .brd header, taking care of any version-specific differences.
 *
 * Encapsulates any state and context needed to parse the header.
 */
export class HEADER_PARSER {
  private readonly m_stream: FILE_STREAM;
  private m_fmtVer: FMT_VER = FMT_VER.V_UNKNOWN;

  constructor(aStream: FILE_STREAM) {
    this.m_stream = aStream;
  }

  /**
   * Get the parsed format version.
   *
   * This is only valid after ParseHeader() has been called successfully.
   */
  GetFormatVersion(): FMT_VER {
    return this.m_fmtVer;
  }

  /**
   * Determine the format version from the magic number.
   */
  static FormatFromMagic(aMagic: number): FMT_VER {
    const masked = (aMagic & 0xffffff00) >>> 0;

    switch (masked) {
      case 0x00130000:
        return FMT_VER.V_160;
      case 0x00130400:
        return FMT_VER.V_162;
      case 0x00130c00:
        return FMT_VER.V_164;
      case 0x00131000:
        return FMT_VER.V_165;
      case 0x00131500:
        return FMT_VER.V_166;
      case 0x00140400:
      case 0x00140500:
      case 0x00140600:
      case 0x00140700:
        return FMT_VER.V_172;
      case 0x00140900:
      case 0x00140e00:
        return FMT_VER.V_174;
      case 0x00141500:
        return FMT_VER.V_175;
      case 0x00150000:
        return FMT_VER.V_180;
      default:
        break;
    }

    // Pre-v16 Allegro files use a fundamentally different binary format
    // that cannot be parsed by this importer. The header is still compatible enough to read
    // the Allegro version string for a helpful error message.
    const majorVer = (aMagic >>> 16) & 0xffff;

    if (majorVer <= 0x0012) return FMT_VER.V_PRE_V16;

    // Struct sizes depend on version, so we can't do anything useful with
    // unrecognized formats. Report the magic and ask the user to report it.
    THROW_IO_ERROR(`Unknown Allegro file version ${hex010(aMagic)} (rev ${majorVer - 3})`);
  }

  ParseHeader(): FILE_HEADER {
    const s = this.m_stream;
    const header = new FILE_HEADER();

    const fileMagic = s.ReadU32();
    this.m_fmtVer = HEADER_PARSER.FormatFromMagic(fileMagic);
    const v = this.m_fmtVer;

    header.m_Magic = fileMagic;

    header.m_Unknown1a = s.ReadU32();
    header.m_FileRole = s.ReadU32();
    header.m_Unknown1b = s.ReadU32();
    header.m_WriterProgram = s.ReadU32();

    header.m_ObjectCount = s.ReadU32();

    header.m_UnknownMagic = s.ReadU32();
    header.m_UnknownFlags = s.ReadU32();

    ReadCond(s, v, header.m_Unknown2_preV18, ARR(7));

    ReadCond(s, v, header.m_Unknown2a_V18, U32);
    ReadCond(s, v, header.m_Unknown2b_V18, U32);
    ReadCond(s, v, header.m_0x27_End_V18, U32);
    ReadCond(s, v, header.m_Unknown2d_V18, U32);
    ReadCond(s, v, header.m_Unknown2e_V18, U32);
    ReadCond(s, v, header.m_StringCount_V18, U32);
    ReadCond(s, v, header.m_Unknown2g_V18, U32);

    ReadCond(s, v, header.m_LL_V18_1, LL);
    ReadCond(s, v, header.m_LL_V18_2, LL);
    ReadCond(s, v, header.m_LL_V18_3, LL);
    ReadCond(s, v, header.m_LL_V18_4, LL);
    ReadCond(s, v, header.m_LL_V18_5, LL);

    // V18 positions 5-22 match v16 positions 0-17
    header.m_LL_0x04 = ReadLL(s, v);
    header.m_LL_0x06 = ReadLL(s, v);
    header.m_LL_0x0C = ReadLL(s, v);
    header.m_LL_Shapes = ReadLL(s, v);
    header.m_LL_0x14 = ReadLL(s, v);
    header.m_LL_0x1B_Nets = ReadLL(s, v);
    header.m_LL_0x1C = ReadLL(s, v);
    header.m_LL_0x24_0x28 = ReadLL(s, v);
    header.m_LL_Unknown1 = ReadLL(s, v);
    header.m_LL_0x2B = ReadLL(s, v);
    header.m_LL_0x03_0x30 = ReadLL(s, v);
    header.m_LL_0x0A = ReadLL(s, v);
    header.m_LL_0x1D_0x1E_0x1F = ReadLL(s, v);
    header.m_LL_Unknown2 = ReadLL(s, v);
    header.m_LL_0x38 = ReadLL(s, v);
    header.m_LL_0x2C = ReadLL(s, v);
    header.m_LL_0x0C_2 = ReadLL(s, v);
    header.m_LL_Unknown3 = ReadLL(s, v);

    ReadCond(s, v, header.m_0x35_Start_preV18, U32);
    ReadCond(s, v, header.m_0x35_End_preV18, U32);

    ReadCond(s, v, header.m_LL_Unknown5_V18, LL);
    header.m_LL_0x36 = ReadLL(s, v);
    ReadCond(s, v, header.m_LL_Unknown5_preV18, LL);

    header.m_LL_Unknown6 = ReadLL(s, v);
    header.m_LL_0x0A_2 = ReadLL(s, v);

    ReadCond(s, v, header.m_Unknown3, U32);

    ReadCond(s, v, header.m_LL_V18_6, LL);
    ReadCond(s, v, header.m_0x35_Start_V18, U32);
    ReadCond(s, v, header.m_0x35_End_V18, U32);

    // Quick check that the positions line up
    // (start of the m_AllegroVersion string is easy to find): a wxASSERT, debug-only

    header.m_AllegroVersion = s.ReadBytes(60);
    header.m_Unknown4 = s.ReadU32();
    header.m_MaxKey = s.ReadU32();

    ReadCond(s, v, header.m_Unknown5_preV18, ARR(17));
    ReadCond(s, v, header.m_Unknown5_V18, ARR(9));

    {
      const units = s.ReadU8();

      switch (units) {
        case BOARD_UNITS.MILS:
        case BOARD_UNITS.INCHES:
        case BOARD_UNITS.MILLIMETERS:
        case BOARD_UNITS.CENTIMETERS:
        case BOARD_UNITS.MICROMETERS:
          header.m_BoardUnits = units as BOARD_UNITS;
          break;

        default:
          THROW_IO_ERROR(`Unknown board units ${units}`);
      }

      s.Skip(3);
    }

    header.m_Unknown6 = s.ReadU32();

    ReadCond(s, v, header.m_Unknown7, U32);
    ReadCond(s, v, header.m_0x27_End_preV18, U32);

    header.m_Unknown8 = s.ReadU32();

    ReadCond(s, v, header.m_StringCount_preV18, U32);

    ReadArrayU32(s, header.m_Unknown9);

    header.m_Unknown10a = s.ReadU32();
    header.m_Unknown10b = s.ReadU32();
    header.m_Unknown10c = s.ReadU32();

    header.m_UnitsDivisor = s.ReadU32();

    s.SkipU32(110);

    for (const entry of header.m_LayerMap) {
      entry.m_A = s.ReadU32();
      entry.m_LayerList0x2A = s.ReadU32();
    }

    return header;
  }
}

function ReadStringMap(stream: FILE_STREAM, aDb: BRD_DB, count: number): void {
  stream.Seek(RAW_BOARD.STRING_TABLE_OFFSET);

  for (let i = 0; i < count; ++i) {
    const id = stream.ReadU32();
    const str = stream.ReadString(true);

    aDb.AddString(id, str);
  }
}

function ParseLayerInfo(aStream: FILE_STREAM): LAYER_INFO {
  const classCode = aStream.ReadU8();
  const subclassCode = aStream.ReadU8();

  // Don't try to be clever and assign enums here - there are loads of them,
  // and we don't have a perfect map yet.
  return { m_Class: classCode, m_Subclass: subclassCode };
}

function ReadS32Array(aStream: FILE_STREAM, aArray: number[]): void {
  for (let i = 0; i < aArray.length; ++i) aArray[i] = aStream.ReadS32();
}

function ParseBlock_0x01_ARC(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x01_ARC();
  const block = new BLOCK(0x01, aStream.Position(), data);

  aStream.Skip(1);

  data.m_UnknownByte = aStream.ReadU8();
  data.m_SubType = aStream.ReadU8();
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Parent = aStream.ReadU32();
  data.m_Unknown1 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown6, U32);

  data.m_Width = aStream.ReadU32();

  data.m_StartX = aStream.ReadS32();
  data.m_StartY = aStream.ReadS32();
  data.m_EndX = aStream.ReadS32();
  data.m_EndY = aStream.ReadS32();

  data.m_CenterX = ReadAllegroFloat(aStream);
  data.m_CenterY = ReadAllegroFloat(aStream);
  data.m_Radius = ReadAllegroFloat(aStream);

  ReadS32Array(aStream, data.m_BoundingBoxCoords);

  return block;
}

function ParseBlock_0x03(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x03_FIELD();
  const block = new BLOCK(0x03, aStream.Position(), data);

  aStream.Skip(1);

  data.m_Hdr1 = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);

  data.m_SubType = aStream.ReadU8();
  data.m_Hdr2 = aStream.ReadU8();
  data.m_Size = aStream.ReadU16();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  switch (data.m_SubType) {
    case 0x65:
      // Nothing for this one?
      break;
    case 0x64:
    case 0x66:
    case 0x67:
    case 0x6a: {
      data.m_Substruct = aStream.ReadU32();
      break;
    }
    case 0x69: {
      data.m_Substruct = [aStream.ReadU32(), aStream.ReadU32()];
      break;
    }
    case 0x68:
    case 0x6b:
    case 0x6d:
    case 0x6e:
    case 0x6f:
    case 0x71:
    case 0x73:
    case 0x78: {
      data.m_Substruct = aStream.ReadStringFixed(data.m_Size, true);
      break;
    }
    case 0x6c: {
      const sub = new SUB_0x6C();
      sub.m_NumEntries = aStream.ReadU32();

      if (sub.m_NumEntries > 1000000) {
        THROW_IO_ERROR(
          `Block 0x03 subtype 0x6C entry count ${sub.m_NumEntries} exceeds limit at offset ${hex010(aStream.Position())}`,
        );
      }

      for (let i = 0; i < sub.m_NumEntries; ++i) sub.m_Entries.push(aStream.ReadU32());

      data.m_Substruct = sub;
      break;
    }
    case 0x70:
    case 0x74: {
      const sub = new SUB_0x70_0x74();

      sub.m_X0 = aStream.ReadU16();
      sub.m_X1 = aStream.ReadU16();

      const numEntries = sub.m_X1 + 4 * sub.m_X0;
      for (let i = 0; i < numEntries; ++i) sub.m_Entries.push(aStream.ReadU8());
      data.m_Substruct = sub;
      break;
    }
    case 0xf6: {
      const sub = new SUB_0xF6();
      ReadArrayU32(aStream, sub.m_Entries);
      data.m_Substruct = sub;
      break;
    }
    default: {
      if (data.m_Size === 4) {
        data.m_Substruct = aStream.ReadU32();
      } else if (data.m_Size === 8) {
        data.m_Substruct = [aStream.ReadU32(), aStream.ReadU32()];
      } else {
        THROW_IO_ERROR(`Unknown substruct type ${hex02(data.m_SubType)} with size ${data.m_Size}`);
      }
      break;
    }
  }

  return block;
}

function ParseBlock_0x04_NET_ASSIGNMENT(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x04_NET_ASSIGNMENT();
  const block = new BLOCK(0x04, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_R = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Net = aStream.ReadU32();
  data.m_ConnItem = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown, U32);

  return block;
}

function ParseBlock_0x05_TRACK(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x05_TRACK();
  const block = new BLOCK(0x05, aStream.Position(), data);

  aStream.Skip(1);

  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_NetAssignment = aStream.ReadU32();
  data.m_UnknownPtr1 = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();
  data.m_Unknown3 = aStream.ReadU32();
  data.m_UnknownPtr2a = aStream.ReadU32();
  data.m_UnknownPtr2b = aStream.ReadU32();
  data.m_Unknown4 = aStream.ReadU32();
  data.m_UnknownPtr3a = aStream.ReadU32();
  data.m_UnknownPtr3b = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown5a, U32);
  ReadCond(aStream, aVer, data.m_Unknown5b, U32);

  data.m_FirstSegPtr = aStream.ReadU32();
  data.m_UnknownPtr5 = aStream.ReadU32();
  data.m_Unknown6 = aStream.ReadU32();

  return block;
}

function ParseBlock_0x06(stream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x06_COMPONENT();
  const block = new BLOCK(0x06, stream.Position(), data);

  stream.Skip(3);

  data.m_Key = stream.ReadU32();
  data.m_Next = stream.ReadU32();
  data.m_CompDeviceType = stream.ReadU32();
  data.m_SymbolName = stream.ReadU32();
  data.m_FirstInstPtr = stream.ReadU32();
  data.m_PtrFunctionSlot = stream.ReadU32();
  data.m_PtrPinNumber = stream.ReadU32();
  data.m_Fields = stream.ReadU32();

  ReadCond(stream, aVer, data.m_Unknown1, U32);

  return block;
}

function ParseBlock_0x07(stream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x07_COMPONENT_INST();
  const block = new BLOCK(0x07, stream.Position(), data);

  stream.Skip(3);

  data.m_Key = stream.ReadU32();
  data.m_Next = stream.ReadU32();

  ReadCond(stream, aVer, data.m_UnknownPtr1, U32);
  ReadCond(stream, aVer, data.m_Unknown2, U32);
  ReadCond(stream, aVer, data.m_Unknown3, U32);

  data.m_FpInstPtr = stream.ReadU32();

  ReadCond(stream, aVer, data.m_Unknown4, U32);

  data.m_RefDesStrPtr = stream.ReadU32();
  data.m_FunctionInstPtr = stream.ReadU32();
  data.m_X03Ptr = stream.ReadU32();
  data.m_Unknown5 = stream.ReadU32();
  data.m_FirstPadPtr = stream.ReadU32();

  return block;
}

function ParseBlock_0x08(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x08_PIN_NUMBER();
  const block = new BLOCK(0x08, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_R = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Previous, U32);
  ReadCond(aStream, aVer, data.m_StrPtr16x, U32);

  data.m_Next = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_StrPtr, U32);

  data.m_PinNamePtr = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);

  data.m_Ptr4 = aStream.ReadU32();

  return block;
}

function ParseBlock_0x09(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x09_FILL_LINK();
  const block = new BLOCK(0x09, aStream.Position(), data);

  aStream.Skip(3);

  data.m_Key = aStream.ReadU32();

  ReadArrayU32(aStream, data.m_UnknownArray);

  ReadCond(aStream, aVer, data.m_Unknown1, U32);

  data.m_UnknownPtr1 = aStream.ReadU32();
  data.m_UnknownPtr2 = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();
  data.m_UnknownPtr3 = aStream.ReadU32();
  data.m_UnknownPtr4 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  return block;
}

function ParseBlock_0x0A_DRC(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x0A_DRC();
  const block = new BLOCK(0x0a, aStream.Position(), data);

  data.m_T = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Unknown1 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  ReadS32Array(aStream, data.m_Coords);

  ReadArrayU32(aStream, data.m_Unknown4);
  ReadArrayU32(aStream, data.m_Unknown5);

  ReadCond(aStream, aVer, data.m_Unknown6, U32);

  return block;
}

function ParseBlock_0x0C(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x0C_PIN_DEF();
  const block = new BLOCK(0x0c, aStream.Position(), data);

  data.m_T = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);

  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();

  data.m_Unknown1 = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();

  // Older packed format
  ReadCond(aStream, aVer, data.m_Shape, U8);
  ReadCond(aStream, aVer, data.m_DrillChar, U8);
  ReadCond(aStream, aVer, data.m_UnknownPadding, U16);

  // V17.2+
  ReadCond(aStream, aVer, data.m_Shape16x, U32);
  ReadCond(aStream, aVer, data.m_DrillChars, U32);
  ReadCond(aStream, aVer, data.m_Unknown_16x, U32);

  data.m_Unknown4 = aStream.ReadU32();
  ReadCond(aStream, aVer, data.m_Unknown5, U32);

  ReadS32Array(aStream, data.m_Coords);
  ReadS32Array(aStream, data.m_Size);

  data.m_GroupPtr = aStream.ReadU32();
  data.m_Unknown6 = aStream.ReadU32();
  data.m_Unknown7 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown8, U32);

  return block;
}

function ParseBlock_0x0D_PAD(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x0D_PAD();
  const block = new BLOCK(0x0d, aStream.Position(), data);

  aStream.Skip(3);

  data.m_Key = aStream.ReadU32();
  data.m_NameStrId = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);

  data.m_CoordsX = aStream.ReadS32();
  data.m_CoordsY = aStream.ReadS32();

  data.m_PadStack = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  data.m_Flags = aStream.ReadU32();
  data.m_Rotation = aStream.ReadU32();

  return block;
}

function ParseBlock_0x0E(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x0E_RECT();
  const block = new BLOCK(0x0e, aStream.Position(), data);

  data.m_T = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_FpPtr = aStream.ReadU32();

  data.m_Unknown1 = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();
  data.m_Unknown3 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown4, U32);
  ReadCond(aStream, aVer, data.m_Unknown5, U32);

  ReadS32Array(aStream, data.m_Coords);

  ReadArrayU32(aStream, data.m_UnknownArr);

  data.m_Rotation = aStream.ReadU32();

  return block;
}

function ParseBlock_0x0F(stream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x0F_FUNCTION_SLOT();
  const block = new BLOCK(0x0f, stream.Position(), data);

  stream.Skip(3);

  data.m_Key = stream.ReadU32();
  data.m_SlotName = stream.ReadU32();

  ReadCond(stream, aVer, data.m_Unknown1, U32);

  data.m_CompDeviceType = stream.ReadBytes(data.m_CompDeviceType.length);

  ReadCond(stream, aVer, data.m_Next, U32);

  data.m_Ptr0x06 = stream.ReadU32();
  data.m_Ptr0x11 = stream.ReadU32();
  data.m_Unknown2 = stream.ReadU32();

  return block;
}

function ParseBlock_0x10(stream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x10_FUNCTION_INST();
  const block = new BLOCK(0x10, stream.Position(), data);

  stream.Skip(3);

  data.m_Key = stream.ReadU32();

  ReadCond(stream, aVer, data.m_Unknown1, U32);
  data.m_ComponentInstPtr = stream.ReadU32();
  ReadCond(stream, aVer, data.m_Unknown2, U32);
  data.m_PtrX12 = stream.ReadU32();
  data.m_Unknown3 = stream.ReadU32();
  data.m_FunctionName = stream.ReadU32();
  data.m_Slots = stream.ReadU32();
  data.m_Fields = stream.ReadU32();

  return block;
}

function ParseBlock_0x11(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x11_PIN_NAME();
  const block = new BLOCK(0x11, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_R = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_PinNameStrPtr = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_PinNumberPtr = aStream.ReadU32();
  data.m_Unknown1 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  return block;
}

function ParseBlock_0x12(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x12_XREF();
  const block = new BLOCK(0x12, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_R = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_Ptr1 = aStream.ReadU32();
  data.m_Ptr2 = aStream.ReadU32();
  data.m_Ptr3 = aStream.ReadU32();
  data.m_Unknown1 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);
  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  return block;
}

function ParseBlock_0x14(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x14_GRAPHIC();
  const block = new BLOCK(0x14, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Parent = aStream.ReadU32();
  data.m_Flags = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  data.m_SegmentPtr = aStream.ReadU32();
  data.m_Ptr0x03 = aStream.ReadU32();
  data.m_Ptr0x26 = aStream.ReadU32();

  return block;
}

function ParseBlock_0x15_16_17_SEGMENT(
  aStream: FILE_STREAM,
  aVer: FMT_VER,
  aType: number,
): BLOCK_BASE {
  const data = new BLK_0x15_16_17_SEGMENT();
  const block = new BLOCK(aType, aStream.Position(), data);

  aStream.Skip(3);

  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Parent = aStream.ReadU32();
  data.m_Flags = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  data.m_Width = aStream.ReadU32();

  data.m_StartX = aStream.ReadS32();
  data.m_StartY = aStream.ReadS32();
  data.m_EndX = aStream.ReadS32();
  data.m_EndY = aStream.ReadS32();

  return block;
}

function ParseBlock_0x1B_NET(stream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x1B_NET();
  const block = new BLOCK(0x1b, stream.Position(), data);

  stream.Skip(3);

  data.m_Key = stream.ReadU32();
  data.m_Next = stream.ReadU32();
  data.m_NetName = stream.ReadU32();
  data.m_Unknown1 = stream.ReadU32();

  ReadCond(stream, aVer, data.m_Unknown2, U32);

  data.m_Type = stream.ReadU32();
  data.m_Assignment = stream.ReadU32();
  data.m_Ratline = stream.ReadU32();
  data.m_FieldsPtr = stream.ReadU32();
  data.m_MatchGroupPtr = stream.ReadU32();
  data.m_ModelPtr = stream.ReadU32();
  data.m_UnknownPtr4 = stream.ReadU32();
  data.m_UnknownPtr5 = stream.ReadU32();
  data.m_UnknownPtr6 = stream.ReadU32();

  return block;
}

function decodePadType(aVal: number): PAD_TYPE {
  switch (aVal & 0xf0) {
    case 0x00:
      return PAD_TYPE.THROUGH_VIA;
    case 0x10:
      return PAD_TYPE.VIA;
    case 0x20:
    case 0xa0: // Unclear what the difference is
      return PAD_TYPE.SMD_PIN;
    case 0x30:
      return PAD_TYPE.SLOT;
    case 0x80:
      return PAD_TYPE.NPTH;
    default:
      THROW_IO_ERROR(`Unknown padstack type 0x${aVal.toString(16)}`);
  }
}

function ParseBlock_0x1C_PADSTACK(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x1C_PADSTACK();
  const block = new BLOCK(0x1c, aStream.Position(), data);

  data.m_UnknownByte1 = aStream.ReadU8();
  data.m_N = aStream.ReadU8();
  data.m_UnknownByte2 = aStream.ReadU8();

  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_PadStr = aStream.ReadU32();

  if (aVer < FMT_VER.V_172) {
    const hdr = new HEADER_v16x();
    data.m_Header = hdr;

    hdr.m_DrillSize = aStream.ReadU32();
    hdr.m_UnknownStr = aStream.ReadU32();
    hdr.m_DrillMarkSizeX = aStream.ReadU32();
    hdr.m_DrillMarkSizeY = aStream.ReadU32();
    hdr.m_DrillOffsetX = aStream.ReadU32();
    hdr.m_DrillOffsetY = aStream.ReadU32();

    hdr.m_DrillMarkShape = aStream.ReadU8();
    hdr.m_Flags = aStream.ReadU8();
    hdr.m_DrillChar = aStream.ReadU8();
    hdr.m_D = aStream.ReadU8();
    hdr.m_Unknown_1 = aStream.ReadU16();

    hdr.m_ArrayNX = aStream.ReadU16();
    hdr.m_ArrayNY = aStream.ReadU16();

    hdr.m_LayerCount = aStream.ReadU16();
    hdr.m_ClearanceX = aStream.ReadU32();
    hdr.m_ClearanceY = aStream.ReadU32();
    hdr.m_TolerancePos = aStream.ReadU32();
    hdr.m_ToleranceNeg = aStream.ReadU32();

    hdr.m_Unknown_2 = aStream.ReadU32();
    hdr.m_SlotX = aStream.ReadU32();
    hdr.m_SlotY = aStream.ReadU32();
    hdr.m_Unknown_3 = aStream.ReadU32();

    ReadCond(aStream, aVer, hdr.m_Unknown_4, U32);
  } else {
    const hdr = new HEADER_v17x();
    data.m_Header = hdr;

    hdr.m_UnknownStr = aStream.ReadU32();
    hdr.m_Unknown1 = aStream.ReadU32();
    hdr.m_Unknown2 = aStream.ReadU32();

    const padTypeAndA = aStream.ReadU8();
    hdr.m_PadType = decodePadType(padTypeAndA);
    hdr.m_A = padTypeAndA & 0x0f;

    hdr.m_B = aStream.ReadU8();
    hdr.m_Flags = aStream.ReadU8();
    hdr.m_D = aStream.ReadU8();

    hdr.m_unknown3 = aStream.ReadU32();
    hdr.m_Unknown4 = aStream.ReadU32();
    hdr.m_ArrayNX = aStream.ReadU16();
    hdr.m_ArrayNY = aStream.ReadU16();
    hdr.m_LayerCount = aStream.ReadU16();
    hdr.m_Unknown5 = aStream.ReadU16();

    hdr.m_ClearanceX = aStream.ReadU32();
    hdr.m_ClearanceY = aStream.ReadU32();

    hdr.m_Unknown6a = aStream.ReadU32();
    hdr.m_Unknown6b = aStream.ReadU32();

    hdr.m_DrillSize = aStream.ReadU32();
    hdr.m_TolerancePos = aStream.ReadU32();
    hdr.m_ToleranceNeg = aStream.ReadU32();

    hdr.m_SlotX = aStream.ReadU32();
    hdr.m_SlotY = aStream.ReadU32();

    hdr.m_ToleranceTravelPos = aStream.ReadU32();
    hdr.m_ToleranceTravelNeg = aStream.ReadU32();

    hdr.m_DrillMarkSizeX = aStream.ReadU32();
    hdr.m_DrillMarkSizeY = aStream.ReadU32();
    hdr.m_DrillMarkShape = aStream.ReadU32();
    hdr.m_DrillChars = aStream.ReadU32();

    ReadArrayU32(aStream, hdr.m_UnknownArr3);

    ReadCond(aStream, aVer, hdr.m_UnknownArr_v180, ARR(8));
  }

  // Work out how many fixed slots we have
  if (aVer < FMT_VER.V_165) data.m_NumFixedCompEntries = 10;
  else if (aVer < FMT_VER.V_172) data.m_NumFixedCompEntries = 11;
  else data.m_NumFixedCompEntries = 21;

  // ...and how many per-layer slots
  data.m_NumCompsPerLayer = aVer < FMT_VER.V_172 ? 3 : 4;

  const nComps = data.m_NumFixedCompEntries + data.GetLayerCount() * data.m_NumCompsPerLayer;

  for (let i = 0; i < nComps; ++i) {
    const comp = new PADSTACK_COMPONENT();
    data.m_Components.push(comp);

    comp.m_Type = aStream.ReadU8();

    comp.m_UnknownByte1 = aStream.ReadU8();
    comp.m_UnknownByte2 = aStream.ReadU8();
    comp.m_UnknownByte3 = aStream.ReadU8();

    ReadCond(aStream, aVer, comp.m_Unknown1, U32);

    comp.m_W = aStream.ReadS32();
    comp.m_H = aStream.ReadS32();

    ReadCond(aStream, aVer, comp.m_Z1, S32);

    comp.m_X3 = aStream.ReadS32();
    comp.m_X4 = aStream.ReadS32();

    comp.m_StrPtr = aStream.ReadU32();

    // The last component has a different size only in < 17.2
    if (aVer >= FMT_VER.V_172 || i < nComps - 1) comp.m_Z2 = aStream.ReadU32();
  }

  {
    const nElems = data.m_N * (aVer < FMT_VER.V_172 ? 8 : 10);

    for (let i = 0; i < nElems; ++i) data.m_UnknownArrN.push(aStream.ReadU32());
  }

  return block;
}

function ParseBlock_0x1D(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x1D_CONSTRAINT_SET();
  const block = new BLOCK(0x1d, aStream.Position(), data);

  aStream.Skip(3);

  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_NameStrKey = aStream.ReadU32();
  data.m_FieldPtr = aStream.ReadU32();

  data.m_SizeA = aStream.ReadU16();
  data.m_SizeB = aStream.ReadU16();

  for (let i = 0; i < data.m_SizeB; ++i) data.m_DataB.push(aStream.ReadBytes(56));

  for (let i = 0; i < data.m_SizeA; ++i) data.m_DataA.push(aStream.ReadBytes(256));

  ReadCond(aStream, aVer, data.m_Unknown4, U32);

  return block;
}

function ParseBlock_0x1E(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x1E_SI_MODEL();
  const block = new BLOCK(0x1e, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_T2 = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U16);
  ReadCond(aStream, aVer, data.m_Unknown3, U16);

  data.m_StrPtr = aStream.ReadU32();
  data.m_Size = aStream.ReadU32();

  data.m_String = aStream.ReadStringFixed(data.m_Size, true);

  ReadCond(aStream, aVer, data.m_Unknown4, U32);

  return block;
}

function ParseBlock_0x1F(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x1F_PADSTACK_DIM();
  const block = new BLOCK(0x1f, aStream.Position(), data);

  aStream.Skip(3);

  data.m_Key = aStream.ReadU32();

  data.m_Next = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();
  data.m_Unknown3 = aStream.ReadU32();
  data.m_Unknown4 = aStream.ReadU32();
  data.m_Unknown5 = aStream.ReadU16();

  data.m_Size = aStream.ReadU16();

  let substructSize = 0;
  if (aVer >= FMT_VER.V_175) substructSize = data.m_Size * 384 + 8;
  else if (aVer >= FMT_VER.V_172) substructSize = data.m_Size * 280 + 8;
  else if (aVer >= FMT_VER.V_162) substructSize = data.m_Size * 280 + 4;
  else substructSize = data.m_Size * 240 + 4;

  data.m_Substruct = aStream.ReadBytes(substructSize);

  return block;
}

function ParseBlock_0x20(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x20_UNKNOWN();
  const block = new BLOCK(0x20, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_R = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();

  ReadArrayU32(aStream, data.m_UnknownArray1);
  ReadCond(aStream, aVer, data.m_UnknownArray2, ARR(10));

  return block;
}

function ParseBlock_0x21(aStream: FILE_STREAM, _aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x21_BLOB();
  const block = new BLOCK(0x21, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_R = aStream.ReadU16();

  data.m_Size = aStream.ReadU32();

  if (data.m_Size < 12) {
    THROW_IO_ERROR(
      `Block 0x21 size ${data.m_Size} too small (minimum 12) at offset ${hex010(aStream.Position())}`,
    );
  }

  data.m_Key = aStream.ReadU32();

  data.m_Data = aStream.ReadBytes(data.m_Size - 12);

  return block;
}

function ParseBlock_0x22(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x22_UNKNOWN();
  const block = new BLOCK(0x22, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_T2 = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);

  ReadArrayU32(aStream, data.m_UnknownArray);

  return block;
}

function ParseBlock_0x23_RATLINE(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x23_RATLINE();
  const block = new BLOCK(0x23, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();

  ReadArrayU32(aStream, data.m_Flags);

  data.m_Ptr1 = aStream.ReadU32();
  data.m_Ptr2 = aStream.ReadU32();
  data.m_Ptr3 = aStream.ReadU32();

  ReadS32Array(aStream, data.m_Coords);

  ReadArrayU32(aStream, data.m_Unknown1);

  ReadCond(aStream, aVer, data.m_Unknown2, ARR(4));
  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  return block;
}

function ParseBlock_0x24_RECT(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x24_RECT();
  const block = new BLOCK(0x24, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Parent = aStream.ReadU32();
  data.m_Unknown1 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  ReadS32Array(aStream, data.m_Coords);

  data.m_Ptr2 = aStream.ReadU32();

  data.m_Unknown3 = aStream.ReadU32();
  data.m_Unknown4 = aStream.ReadU32();
  data.m_Rotation = aStream.ReadU32();

  return block;
}

function ParseBlock_0x26(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x26_MATCH_GROUP();
  const block = new BLOCK(0x26, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_R = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_MemberPtr = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);

  data.m_GroupPtr = aStream.ReadU32();
  data.m_ConstPtr = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  return block;
}

function ParseBlock_0x27(aStream: FILE_STREAM, _aVer: FMT_VER, aEndOff: number): BLOCK_BASE {
  const data = new BLK_0x27_CSTRMGR_XREF();
  const block = new BLOCK(0x27, aStream.Position(), data);

  const totalBytes = aEndOff - 1 - aStream.Position();

  // The blob starts with 3 bytes of padding, then uint32 LE values
  const kPadding = 3;

  if (totalBytes <= kPadding) {
    aStream.Skip(totalBytes);
    return block;
  }

  aStream.Skip(kPadding);

  const payloadBytes = totalBytes - kPadding;
  const numValues = Math.floor(payloadBytes / 4);
  const remainder = payloadBytes % 4;

  data.m_Refs = new Array<number>(numValues);

  for (let i = 0; i < numValues; i++) data.m_Refs[i] = aStream.ReadU32();

  if (remainder > 0) aStream.Skip(remainder);

  return block;
}

function ParseBlock_0x28_SHAPE(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x28_SHAPE();
  const block = new BLOCK(0x28, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Ptr1 = aStream.ReadU32();
  data.m_Unknown1 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);
  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  data.m_Ptr2 = aStream.ReadU32();
  data.m_Ptr3 = aStream.ReadU32();
  data.m_FirstKeepoutPtr = aStream.ReadU32();
  data.m_FirstSegmentPtr = aStream.ReadU32();
  data.m_Unknown4 = aStream.ReadU32();
  data.m_Unknown5 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_TablePtr, U32);

  data.m_Ptr6 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_TablePtr_16x, U32);

  ReadS32Array(aStream, data.m_Coords);

  return block;
}

function ParseBlock_0x29_PIN(aStream: FILE_STREAM, _aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x29_PIN();
  const block = new BLOCK(0x29, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_T = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();

  data.m_Ptr1 = aStream.ReadU32();
  data.m_Ptr2 = aStream.ReadU32();

  data.m_Null = aStream.ReadU32();

  data.m_Ptr3 = aStream.ReadU32();

  data.m_Coord1 = aStream.ReadS32();
  data.m_Coord2 = aStream.ReadS32();

  data.m_PtrPadstack = aStream.ReadU32();

  data.m_Unknown1 = aStream.ReadU32();

  data.m_PtrX30 = aStream.ReadU32();

  data.m_Unknown2 = aStream.ReadU32();
  data.m_Unknown3 = aStream.ReadU32();
  data.m_Unknown4 = aStream.ReadU32();

  return block;
}

function ParseBlock_0x2A(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x2A_LAYER_LIST();
  const block = new BLOCK(0x2a, aStream.Position(), data);

  aStream.Skip(1);

  data.m_NumEntries = aStream.ReadU16();

  ReadCond(aStream, aVer, data.m_Unknown, U32);

  if (data.m_NonRefEntries.exists(aVer)) {
    const entries: NONREF_ENTRY[] = [];
    data.m_NonRefEntries.set(entries);
    for (let i = 0; i < data.m_NumEntries; ++i)
      entries.push({ m_Name: aStream.ReadStringFixed(36, true) });
  } else {
    const entries: REF_ENTRY[] = [];
    data.m_RefEntries.set(entries);
    for (let i = 0; i < data.m_NumEntries; ++i) {
      entries.push({
        mLayerNameId: aStream.ReadU32(),
        m_Properties: aStream.ReadU32(),
        m_Unknown: aStream.ReadU32(),
      });
    }
  }

  data.m_Key = aStream.ReadU32();

  return block;
}

function ParseBlock_0x2B(stream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x2B_FOOTPRINT_DEF();
  const block = new BLOCK(0x2b, stream.Position(), data);

  stream.Skip(3);

  data.m_Key = stream.ReadU32();
  data.m_FpStrRef = stream.ReadU32();
  data.m_Unknown1 = stream.ReadU32();
  ReadArrayU32(stream, data.m_Coords);
  data.m_Next = stream.ReadU32();
  data.m_FirstInstPtr = stream.ReadU32();
  data.m_UnknownPtr3 = stream.ReadU32();
  data.m_UnknownPtr4 = stream.ReadU32();
  data.m_UnknownPtr5 = stream.ReadU32();
  data.m_SymLibPathPtr = stream.ReadU32();
  data.m_UnknownPtr6 = stream.ReadU32();
  data.m_UnknownPtr7 = stream.ReadU32();
  data.m_UnknownPtr8 = stream.ReadU32();

  ReadCond(stream, aVer, data.m_Unknown2, U32);
  ReadCond(stream, aVer, data.m_Unknown3, U32);

  return block;
}

function ParseBlock_0x2C_TABLE(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x2C_TABLE();
  const block = new BLOCK(0x2c, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_SubType = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);
  ReadCond(aStream, aVer, data.m_Unknown2, U32);
  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  data.m_StringPtr = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown4, U32);

  data.m_Ptr1 = aStream.ReadU32();
  data.m_Ptr2 = aStream.ReadU32();
  data.m_Ptr3 = aStream.ReadU32();

  data.m_Flags = aStream.ReadU32();

  return block;
}

function ParseBlock_0x2D(stream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x2D_FOOTPRINT_INST();
  const block = new BLOCK(0x2d, stream.Position(), data);

  data.m_UnknownByte1 = stream.ReadU8();
  data.m_Layer = stream.ReadU8();
  data.m_UnknownByte2 = stream.ReadU8();

  data.m_Key = stream.ReadU32();
  data.m_Next = stream.ReadU32();

  ReadCond(stream, aVer, data.m_Unknown1, U32);

  ReadCond(stream, aVer, data.m_InstRef16x, U32);

  data.m_Unknown2 = stream.ReadU16();
  data.m_Unknown3 = stream.ReadU16();

  ReadCond(stream, aVer, data.m_Unknown4, U32);

  data.m_Flags = stream.ReadU32();

  data.m_Rotation = stream.ReadU32();
  data.m_CoordX = stream.ReadS32();
  data.m_CoordY = stream.ReadS32();

  ReadCond(stream, aVer, data.m_InstRef, U32);

  data.m_GraphicPtr = stream.ReadU32();
  data.m_FirstPadPtr = stream.ReadU32();
  data.m_TextPtr = stream.ReadU32();

  data.m_AssemblyPtr = stream.ReadU32();
  data.m_AreasPtr = stream.ReadU32();
  data.m_UnknownPtr1 = stream.ReadU32();
  data.m_UnknownPtr2 = stream.ReadU32();

  return block;
}

function ParseBlock_0x2E(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x2E_CONNECTION();
  const block = new BLOCK(0x2e, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_T2 = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_NetAssignment = aStream.ReadU32();
  data.m_Unknown1 = aStream.ReadU32();
  // `int32_t m_CoordX = aStream.ReadU32()`: the unsigned word wraps into the int32
  data.m_CoordX = aStream.ReadU32() | 0;
  data.m_CoordY = aStream.ReadU32() | 0;
  data.m_Connection = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  return block;
}

function ParseBlock_0x2F(aStream: FILE_STREAM, _aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x2F_UNKNOWN();
  const block = new BLOCK(0x2f, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_T2 = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();

  ReadArrayU32(aStream, data.m_UnknownArray);

  return block;
}

function ParseTextProps(aStream: FILE_STREAM): TEXT_PROPERTIES {
  const m_Key = aStream.ReadU8();
  const m_Flags = aStream.ReadU8();

  let m_Alignment: TEXT_ALIGNMENT;
  const alignment = aStream.ReadU8();
  switch (alignment) {
    case 0x01:
      m_Alignment = TEXT_ALIGNMENT.LEFT;
      break;
    case 0x02:
      m_Alignment = TEXT_ALIGNMENT.RIGHT;
      break;
    case 0x03:
      m_Alignment = TEXT_ALIGNMENT.CENTER;
      break;
    default:
      m_Alignment = TEXT_ALIGNMENT.UNKNOWN;
    // THROW_IO_ERROR( wxString::Format( "Unknown text alignment value: %#02x", alignment ) );
  }

  let m_Reversal: TEXT_REVERSAL;
  const reversal = aStream.ReadU8();
  switch (reversal) {
    case 0x00:
      m_Reversal = TEXT_REVERSAL.STRAIGHT;
      break;
    case 0x01:
      m_Reversal = TEXT_REVERSAL.REVERSED;
      break;
    default:
      m_Reversal = TEXT_REVERSAL.UNKNOWN;
    //THROW_IO_ERROR( wxString::Format( "Unknown text reversal value: %#02x", reversal ) );
  }
  return { m_Key, m_Flags, m_Alignment, m_Reversal };
}

function ParseBlock_0x30_STR_WRAPPER(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x30_STR_WRAPPER();
  const block = new BLOCK(0x30, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);
  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  if (data.m_Font.exists(aVer)) data.m_Font.set(ParseTextProps(aStream));

  ReadCond(aStream, aVer, data.m_Ptr1, U32);
  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  data.m_StrGraphicPtr = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_PtrGroup_17x, U32);
  ReadCond(aStream, aVer, data.m_Unknown4, U32);

  if (data.m_Font16x.exists(aVer)) data.m_Font16x.set(ParseTextProps(aStream));

  ReadCond(aStream, aVer, data.m_Ptr2, U32);

  // `int32_t m_CoordsX = aStream.ReadU32()`
  data.m_CoordsX = aStream.ReadU32() | 0;
  data.m_CoordsY = aStream.ReadU32() | 0;

  data.m_Unknown5 = aStream.ReadU32();
  data.m_Rotation = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_PtrGroup_16x, U32);

  return block;
}

function ParseBlock_0x31_SGRAPHIC(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x31_SGRAPHIC();
  const block = new BLOCK(0x31, aStream.Position(), data);

  data.m_T = aStream.ReadU8();

  {
    const layer = aStream.ReadU16();

    switch (layer) {
      case 0xf001:
        data.m_Layer = STRING_LAYER.BOT_TEXT;
        break;
      case 0xf101:
        data.m_Layer = STRING_LAYER.TOP_TEXT;
        break;
      case 0xf609:
        data.m_Layer = STRING_LAYER.BOT_PIN;
        break;
      case 0xf709:
        data.m_Layer = STRING_LAYER.TOP_PIN;
        break;
      case 0xf801:
        data.m_Layer = STRING_LAYER.TOP_PIN_LABEL;
        break;
      case 0xfa0d:
        data.m_Layer = STRING_LAYER.BOT_REFDES;
        break;
      case 0xfb0d:
        data.m_Layer = STRING_LAYER.TOP_REFDES;
        break;
      default:
        data.m_Layer = STRING_LAYER.UNKNOWN;
        break;
    }
  }

  data.m_Key = aStream.ReadU32();
  data.m_StrGraphicWrapperPtr = aStream.ReadU32();

  // `int32_t m_CoordsX = aStream.ReadU32()`
  data.m_CoordsX = aStream.ReadU32() | 0;
  data.m_CoordsY = aStream.ReadU32() | 0;

  data.m_Unknown = aStream.ReadU16();
  data.m_Len = aStream.ReadU16();

  ReadCond(aStream, aVer, data.m_Un2, U32);

  data.m_Value = aStream.ReadStringFixed(data.m_Len, true);

  return block;
}

function ParseBlock_0x32_PLACED_PAD(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x32_PLACED_PAD();
  const block = new BLOCK(0x32, aStream.Position(), data);

  data.m_Type = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_NetPtr = aStream.ReadU32();
  data.m_Flags = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Prev, U32);

  data.m_NextInFp = aStream.ReadU32();
  data.m_ParentFp = aStream.ReadU32();
  data.m_Track = aStream.ReadU32();
  data.m_PadPtr = aStream.ReadU32();
  data.m_Ptr6 = aStream.ReadU32();
  data.m_Ratline = aStream.ReadU32();
  data.m_PtrPinNumber = aStream.ReadU32();
  data.m_NextInCompInst = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  data.m_NameText = aStream.ReadU32();
  data.m_Ptr11 = aStream.ReadU32();

  ReadS32Array(aStream, data.m_Coords);

  return block;
}

function ParseBlock_0x33_VIA(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x33_VIA();
  const block = new BLOCK(0x33, aStream.Position(), data);

  aStream.Skip(1);

  data.m_LayerInfo = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_NetPtr = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  data.m_UnknownPtr1 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_UnknownPtr2, U32);

  data.m_CoordsX = aStream.ReadS32();
  data.m_CoordsY = aStream.ReadS32();

  data.m_Connection = aStream.ReadU32();
  data.m_Padstack = aStream.ReadU32();
  data.m_UnknownPtr5 = aStream.ReadU32();
  data.m_UnknownPtr6 = aStream.ReadU32();

  data.m_Unknown4 = aStream.ReadU32();
  data.m_Unknown5 = aStream.ReadU32();

  ReadS32Array(aStream, data.m_BoundingBoxCoords);

  return block;
}

function ParseBlock_0x34_KEEPOUT(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x34_KEEPOUT();
  const block = new BLOCK(0x34, aStream.Position(), data);

  data.m_T = aStream.ReadU8();
  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Ptr1 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);

  data.m_Flags = aStream.ReadU32();
  data.m_FirstSegmentPtr = aStream.ReadU32();
  data.m_Ptr3 = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();

  return block;
}

function ParseBlock_0x35(aStream: FILE_STREAM, _aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x35_FILE_REF();
  const block = new BLOCK(0x35, aStream.Position(), data);

  data.m_T2 = aStream.ReadU8();
  data.m_T3 = aStream.ReadU16();
  data.m_Content = aStream.ReadBytes(data.m_Content.length);

  return block;
}

function ParseBlock_0x36(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x36_DEF_TABLE();
  const block = new BLOCK(0x36, aStream.Position(), data);

  aStream.Skip(1);

  data.m_Code = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);

  data.m_NumItems = aStream.ReadU32();
  data.m_Count = aStream.ReadU32();
  data.m_LastIdx = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  if (data.m_NumItems > 1000000) {
    THROW_IO_ERROR(
      `Block 0x36 item count ${data.m_NumItems} exceeds limit at offset ${hex010(aStream.Position())}`,
    );
  }

  if (data.m_Count > data.m_NumItems) {
    THROW_IO_ERROR(
      `Block 0x36 filled count ${data.m_Count} exceeds capacity ${data.m_NumItems} at offset ${hex010(aStream.Position())}`,
    );
  }

  // Each block has m_NumItems slots but only m_Count are populated; the rest are
  // zeroes. Iterate all slots to stride across them correctly, but only keep the
  // actual existing items.
  for (let i = 0; i < data.m_NumItems; ++i) {
    const keep = i < data.m_Count;

    switch (data.m_Code) {
      case 0x02: {
        const item = new X02();

        item.m_String = aStream.ReadStringFixed(32, true);
        ReadArrayU32(aStream, item.m_Xs);
        ReadCond(aStream, aVer, item.m_Ys, ARR(3));
        ReadCond(aStream, aVer, item.m_Zs, ARR(2));

        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x03: {
        const item = new X03();
        if (aVer >= FMT_VER.V_172) item.m_Str.set(aStream.ReadStringFixed(64, true));
        else item.m_Str16x.set(aStream.ReadStringFixed(32, true));

        ReadCond(aStream, aVer, item.m_Unknown1, U32);

        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x05: {
        const item = new X05();

        item.m_Unknown = aStream.ReadBytes(item.m_Unknown.length);
        ReadCond(aStream, aVer, item.m_Unknown2, U32);

        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x06: {
        const item = new X06();

        item.m_N = aStream.ReadU16();
        item.m_R = aStream.ReadU8();
        item.m_S = aStream.ReadU8();
        item.m_Unknown1 = aStream.ReadU32();

        ReadCond(aStream, aVer, item.m_Unknown2, ARR(50));

        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x08: {
        const item = new FontDef_X08();

        item.m_A = aStream.ReadU32();
        item.m_B = aStream.ReadU32();
        item.m_CharHeight = aStream.ReadU32();
        item.m_CharWidth = aStream.ReadU32();

        ReadCond(aStream, aVer, item.m_Unknown2, U32);

        item.m_CharacterSpace = aStream.ReadU32();
        item.m_LineSpace = aStream.ReadU32();
        item.m_Unknown3 = aStream.ReadU32();
        item.m_StrokeWidth = aStream.ReadU32();

        ReadCond(aStream, aVer, item.m_Ys, ARR(8));

        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x0b: {
        const item = new X0B();
        item.m_Unknown = aStream.ReadBytes(item.m_Unknown.length);
        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x0c: {
        const item = new X0C();
        item.m_Unknown = aStream.ReadBytes(item.m_Unknown.length);
        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x0d: {
        const item = new X0D();
        item.m_Unknown = aStream.ReadBytes(item.m_Unknown.length);
        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x0f: {
        const item = new X0F();
        item.m_Key = aStream.ReadU32();
        ReadArrayU32(aStream, item.m_Ptrs);
        item.m_Ptr2 = aStream.ReadU32();
        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x10: {
        const item = new X10();
        item.m_Unknown = aStream.ReadBytes(item.m_Unknown.length);
        ReadCond(aStream, aVer, item.m_Unknown2, U32);
        if (keep) data.m_Items.push(item);
        break;
      }
      case 0x12: {
        const item = new X12();
        // aStream.ReadBytes( item.m_Unknown.data(), item.m_Unknown.size() );
        aStream.Skip(1052);
        if (keep) data.m_Items.push(item);
        break;
      }
      default:
        THROW_IO_ERROR(`Unknown substruct type ${hex02(data.m_Code)} in block 0x36`);
    }
  }

  return block;
}

function ParseBlock_0x37(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x37_PTR_ARRAY();
  const block = new BLOCK(0x37, aStream.Position(), data);

  data.m_T = aStream.ReadU8();
  data.m_T2 = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();
  data.m_GroupPtr = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Capacity = aStream.ReadU32();
  data.m_Count = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  ReadArrayU32(aStream, data.m_Ptrs);

  return block;
}

function ParseBlock_0x38_FILM(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x38_FILM();
  const block = new BLOCK(0x38, aStream.Position(), data);

  aStream.Skip(3);

  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_LayerList = aStream.ReadU32();

  if (data.m_FilmName.exists(aVer)) data.m_FilmName.set(aStream.ReadStringFixed(20, true));

  ReadCond(aStream, aVer, data.m_LayerNameStr, U32);
  ReadCond(aStream, aVer, data.m_Unknown2, U32);

  ReadArrayU32(aStream, data.m_UnknownArray1);

  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  return block;
}

function ParseBlock_0x39_FILM_LAYER_LIST(aStream: FILE_STREAM, _aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x39_FILM_LAYER_LIST();
  const block = new BLOCK(0x39, aStream.Position(), data);

  aStream.Skip(3);

  data.m_Key = aStream.ReadU32();
  data.m_Parent = aStream.ReadU32();
  data.m_Head = aStream.ReadU32();

  for (let i = 0; i < data.m_X.length; ++i) data.m_X[i] = aStream.ReadU16();

  return block;
}

function ParseBlock_0x3A_FILM_LIST_NODE(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x3A_FILM_LIST_NODE();
  const block = new BLOCK(0x3a, aStream.Position(), data);

  aStream.Skip(1);

  data.m_Layer = ParseLayerInfo(aStream);
  data.m_Key = aStream.ReadU32();
  data.m_Next = aStream.ReadU32();
  data.m_Unknown = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown1, U32);

  return block;
}

function ParseBlock_0x3B(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x3B_PROPERTY();
  const block = new BLOCK(0x3b, aStream.Position(), data);

  data.m_T = aStream.ReadU8();
  data.m_SubType = aStream.ReadU16();
  data.m_Len = aStream.ReadU32();

  data.m_Name = aStream.ReadStringFixed(128, true);
  data.m_Type = aStream.ReadStringFixed(32, true);

  data.m_Unknown1 = aStream.ReadU32();
  data.m_Unknown2 = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown3, U32);

  data.m_Value = aStream.ReadStringFixed(data.m_Len, true);

  return block;
}

function ParseBlock_0x3C(aStream: FILE_STREAM, aVer: FMT_VER): BLOCK_BASE {
  const data = new BLK_0x3C_KEY_LIST();
  const block = new BLOCK(0x3c, aStream.Position(), data);

  data.m_T = aStream.ReadU8();
  data.m_T2 = aStream.ReadU16();
  data.m_Key = aStream.ReadU32();

  ReadCond(aStream, aVer, data.m_Unknown, U32);

  data.m_NumEntries = aStream.ReadU32();

  if (data.m_NumEntries > 1000000) {
    THROW_IO_ERROR(
      `Block 0x3C entry count ${data.m_NumEntries} exceeds limit at offset ${hex010(aStream.Position())}`,
    );
  }

  for (let i = 0; i < data.m_NumEntries; ++i) data.m_Entries.push(aStream.ReadU32());

  return block;
}

/**
 * The block parser is responsible for parsing individual blocks of data from the file stream.
 *
 * Most blocks don't need much context to parse in a binary sense, but most need to know the
 * version, and one (0x27) needs to know where the end of the block is.
 */
export class BLOCK_PARSER {
  private readonly m_stream: FILE_STREAM;
  private readonly m_ver: FMT_VER;

  /**
   * To parse an 0x27 block, we need to know where the end of the block is in the stream.
   * In a .brd file, this is in the header.
   */
  private readonly m_x27_end: number;

  constructor(aStream: FILE_STREAM, aVer: FMT_VER, aX27End = 0) {
    this.m_stream = aStream;
    this.m_ver = aVer;
    this.m_x27_end = aX27End;
  }

  /**
   * Parse one block from the stream, returning a BLOCK_BASE representing the raw data of the block.
   *
   * The stream is positioned at the start of the block (i.e. the next byte to read is the
   * block type). `aEndOfObjectsMarker.value` is set to true if we encounter the end of
   * objects marker.
   */
  ParseBlock(aEndOfObjectsMarker: { value: boolean }): BLOCK_BASE | null {
    // Read the type of the object
    // The file can end here without error.
    const type = this.m_stream.GetU8();
    if (type === null) {
      aEndOfObjectsMarker.value = true;
      return null;
    }

    const s = this.m_stream;
    const v = this.m_ver;

    switch (type) {
      case 0x01:
        return ParseBlock_0x01_ARC(s, v);
      case 0x03:
        return ParseBlock_0x03(s, v);
      case 0x04:
        return ParseBlock_0x04_NET_ASSIGNMENT(s, v);
      case 0x05:
        return ParseBlock_0x05_TRACK(s, v);
      case 0x06:
        return ParseBlock_0x06(s, v);
      case 0x07:
        return ParseBlock_0x07(s, v);
      case 0x08:
        return ParseBlock_0x08(s, v);
      case 0x09:
        return ParseBlock_0x09(s, v);
      case 0x0a:
        return ParseBlock_0x0A_DRC(s, v);
      case 0x0c:
        return ParseBlock_0x0C(s, v);
      case 0x0d:
        return ParseBlock_0x0D_PAD(s, v);
      case 0x0e:
        return ParseBlock_0x0E(s, v);
      case 0x0f:
        return ParseBlock_0x0F(s, v);
      case 0x10:
        return ParseBlock_0x10(s, v);
      case 0x11:
        return ParseBlock_0x11(s, v);
      case 0x12:
        return ParseBlock_0x12(s, v);
      case 0x14:
        return ParseBlock_0x14(s, v);
      case 0x15:
      case 0x16:
      case 0x17:
        return ParseBlock_0x15_16_17_SEGMENT(s, v, type);
      case 0x1b:
        return ParseBlock_0x1B_NET(s, v);
      case 0x1c:
        return ParseBlock_0x1C_PADSTACK(s, v);
      case 0x1d:
        return ParseBlock_0x1D(s, v);
      case 0x1e:
        return ParseBlock_0x1E(s, v);
      case 0x1f:
        return ParseBlock_0x1F(s, v);
      case 0x20:
        return ParseBlock_0x20(s, v);
      case 0x21:
        return ParseBlock_0x21(s, v);
      case 0x22:
        return ParseBlock_0x22(s, v);
      case 0x23:
        return ParseBlock_0x23_RATLINE(s, v);
      case 0x24:
        return ParseBlock_0x24_RECT(s, v);
      case 0x26:
        return ParseBlock_0x26(s, v);
      case 0x27: {
        if (this.m_x27_end <= s.Position()) {
          THROW_IO_ERROR(
            `Current offset ${hex010(s.Position())} is at or past the expected end of block 0x27 at ${hex010(this.m_x27_end)}`,
          );
        }
        return ParseBlock_0x27(s, v, this.m_x27_end);
      }
      case 0x28:
        return ParseBlock_0x28_SHAPE(s, v);
      case 0x29:
        return ParseBlock_0x29_PIN(s, v);
      case 0x2a:
        return ParseBlock_0x2A(s, v);
      case 0x2b:
        return ParseBlock_0x2B(s, v);
      case 0x2c:
        return ParseBlock_0x2C_TABLE(s, v);
      case 0x2d:
        return ParseBlock_0x2D(s, v);
      case 0x2e:
        return ParseBlock_0x2E(s, v);
      case 0x2f:
        return ParseBlock_0x2F(s, v);
      case 0x30:
        return ParseBlock_0x30_STR_WRAPPER(s, v);
      case 0x31:
        return ParseBlock_0x31_SGRAPHIC(s, v);
      case 0x32:
        return ParseBlock_0x32_PLACED_PAD(s, v);
      case 0x33:
        return ParseBlock_0x33_VIA(s, v);
      case 0x34:
        return ParseBlock_0x34_KEEPOUT(s, v);
      case 0x35:
        return ParseBlock_0x35(s, v);
      case 0x36:
        return ParseBlock_0x36(s, v);
      case 0x37:
        return ParseBlock_0x37(s, v);
      case 0x38:
        return ParseBlock_0x38_FILM(s, v);
      case 0x39:
        return ParseBlock_0x39_FILM_LAYER_LIST(s, v);
      case 0x3a:
        return ParseBlock_0x3A_FILM_LIST_NODE(s, v);
      case 0x3b:
        return ParseBlock_0x3B(s, v);
      case 0x3c:
        return ParseBlock_0x3C(s, v);
      case 0x00:
        // Block type 0x00 marks the end of the objects section
        aEndOfObjectsMarker.value = true;
        return null;
      default:
        return null;
    }
  }
}

/**
 * Class that parses a single FILE_STREAM into a RAW_BOARD,
 * and handles any state involved in that parsing
 *
 * This only handles converting rawfile stream data into
 * structs that represent a near-verbatim representation of the
 * data, with a few small conversions and conveniences.
 */
export class PARSER {
  private readonly m_stream: FILE_STREAM;
  private m_endAtUnknownBlock = false;
  private readonly m_progressReporter: PROGRESS_REPORTER | null;

  constructor(aStream: FILE_STREAM, aProgressReporter: PROGRESS_REPORTER | null) {
    this.m_stream = aStream;
    this.m_progressReporter = aProgressReporter;
  }

  /**
   * When set to true, the parser will stop at the first unknown block, rather
   * than throwing an error.
   *
   * This is mostly useful for debugging, as at least you can dump the blocks
   * and see what they are. But in real life, this would result in a very incomplete
   * board state.
   */
  EndAtUnknownBlock(aEndAtUnknownBlock: boolean): void {
    this.m_endAtUnknownBlock = aEndAtUnknownBlock;
  }

  private readObjects(aBoard: BRD_DB): void {
    const ver = aBoard.m_FmtVer;

    if (this.m_progressReporter) {
      this.m_progressReporter.AdvancePhase('Parsing Allegro objects');
      // This isn't exactly the number we seem to parse, but it's very close
      this.m_progressReporter.SetMaxProgress(aBoard.m_Header!.m_ObjectCount);
    }

    const blockParser = new BLOCK_PARSER(this.m_stream, ver, aBoard.m_Header!.Get_0x27_End());

    for (;;) {
      const offset = this.m_stream.Position();

      // Peek at the block type byte before ParseBlock consumes it so we
      // have the value available for error messages if the type is unknown
      // and ParseBlock returns nullptr.
      const blockTypeByte = this.m_stream.GetU8() ?? 0;
      this.m_stream.Seek(offset);

      const endOfObjectsMarker = { value: false };
      const block = blockParser.ParseBlock(endOfObjectsMarker);

      if (endOfObjectsMarker.value) {
        if (ver >= FMT_VER.V_180) {
          // V18 files can have zero-padded gaps between block groups. Skip
          // consecutive zero bytes and check if more blocks follow.
          let scanPos = this.m_stream.Position();
          let nextByte = 0;

          for (;;) {
            const b = this.m_stream.GetU8();
            if (b === null) break;
            nextByte = b;
            if (nextByte !== 0x00) break;
            scanPos = this.m_stream.Position();
          }

          if (nextByte > 0x00 && nextByte <= 0x3c) {
            let blockStart = scanPos;

            if (blockStart % 4 !== 0) blockStart -= blockStart % 4;

            // After backward alignment the byte at blockStart may
            // differ from the non-zero byte we found. Verify it
            // still looks like a valid block type before continuing.
            this.m_stream.Seek(blockStart);
            const alignedByte = this.m_stream.GetU8() ?? 0;
            this.m_stream.Seek(blockStart);

            if (alignedByte === 0x00 || alignedByte > 0x3c) break;

            continue;
          }
        }

        break;
      }

      if (!block) {
        if (!this.m_endAtUnknownBlock) {
          THROW_IO_ERROR(
            `Do not have parser for block index ${aBoard.GetObjectCount() + 1} type ${hex02(blockTypeByte)} available at offset ${hex010(offset)}`,
          );
        }

        // wxFAIL_MSG( "Failed to create block" )
        return;
      }

      aBoard.InsertBlock(block);

      if (this.m_progressReporter) {
        this.m_progressReporter.AdvanceProgress();

        if ((aBoard.GetObjectCount() & 0x3f) === 0) this.m_progressReporter.KeepRefreshing();
      }
    }
  }

  Parse(): BRD_DB {
    const board = new BRD_DB();

    if (this.m_progressReporter) {
      this.m_progressReporter.AddPhases(2);
      this.m_progressReporter.AdvancePhase('Reading file header');
    }

    const headerParser = new HEADER_PARSER(this.m_stream);

    const fail = (e: IO_ERROR): never => {
      let s = '';
      s += `Error parsing Allegro file: ${e.What()}\n`;
      s += `Stream position: ${hex010(this.m_stream.Position())}\n`;

      if (board.m_Header) s += `File magic: ${hex010(board.m_Header.m_Magic)}\n`;
      else s += 'File magic: Unknown\n';

      THROW_IO_ERROR(s);
    };

    try {
      board.m_Header = headerParser.ParseHeader();

      board.m_FmtVer = headerParser.GetFormatVersion();
    } catch (e) {
      if (e instanceof IO_ERROR) fail(e);
      throw e;
    }

    if (board.m_FmtVer === FMT_VER.V_PRE_V16) {
      // wxString( m_AllegroVersion.data(), 60 ), then Trim()
      let verStr = String.fromCharCode(...board.m_Header.m_AllegroVersion);
      verStr = verStr.replace(/[ \t\r\n\f\v]+$/, '');

      THROW_IO_ERROR(
        `This file was created with ${verStr}, which uses a binary format that ` +
          'predates Allegro 16.0 and is not supported by this importer.\n\n' +
          'To import this design, open it in Cadence Allegro PCB Editor ' +
          'version 16.0 or later and re-save, then import the resulting file.',
      );
    }

    const stringsCount = board.m_Header.GetStringsCount();
    board.ReserveCapacity(board.m_Header.m_ObjectCount, stringsCount);

    // Skip DB_OBJ creation for high-volume types (segments, graphics, arcs) that the
    // BOARD_BUILDER accesses only through raw BLOCK_BASE. Saves millions of allocations.
    board.SetLeanMode(true);

    try {
      ReadStringMap(this.m_stream, board, stringsCount);

      this.readObjects(board);
    } catch (e) {
      if (e instanceof IO_ERROR) fail(e);
      throw e;
    }

    // Now the object are read, resolve the DB links
    board.ResolveAndValidate();

    return board;
  }
}
