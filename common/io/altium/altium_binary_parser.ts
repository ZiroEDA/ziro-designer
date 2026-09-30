// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/altium/altium_binary_parser.cpp` / `.h`: the compound-file wrapper
 * every Altium binary document is opened through (`ALTIUM_COMPOUND_FILE`), the
 * little-endian record reader over one of its streams (`ALTIUM_BINARY_PARSER`),
 * and the two small readers the schematic side uses for embedded data.
 *
 * One deviation, the browser's: `ALTIUM_COMPOUND_FILE( const wxString& aFilePath )`
 * opened the file itself; here the caller hands in its bytes (the importer's
 * `PCB_IO` has already read them through its file source).
 *
 * `Read<Type>()` is a template upstream; the instantiations the readers use are
 * spelled out (`ReadUint8`, `ReadUint16`, …), each with upstream's short-read
 * rule: what is left is skipped, the error flag is set, and 0 comes back.
 */

import { inflateZlib } from '../../wx/inflate.js';
import { IO_ERROR } from '../../exceptions.js';
import {
  CFBException,
  type COMPOUND_FILE_ENTRY,
  CompoundFileReader,
  UTF16ToUTF8,
  UTF16ToWstring,
} from './compoundfilereader.js';
import { AltiumPropertyToKiCadString } from './altium_parser_utils.js';
import { ALTIUM_PROPS_UTILS, type ALTIUM_PROPS } from './altium_props_utils.js';

/**
 * Helper for debug logging (vector -> string)
 * @param aVectorPath path
 * @return path formatted as string
 */
export function FormatPath(aVectorPath: readonly string[]): string {
  return aVectorPath.reduce((ss, s) => (ss === '' ? s : `${ss}\\${s}`), '');
}

export interface ALTIUM_SYMBOL_DATA {
  m_symbol?: COMPOUND_FILE_ENTRY;
  m_pinsFrac?: COMPOUND_FILE_ENTRY;
  m_pinsWideText?: COMPOUND_FILE_ENTRY;
  m_pinsTextData?: COMPOUND_FILE_ENTRY;
  m_pinsSymbolLineWidth?: COMPOUND_FILE_ENTRY;
}

/** `wxConvISO8859_1`: one byte, one character. */
export function latin1ToString(aBytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < aBytes.length; i += 0x8000)
    s += String.fromCharCode(...aBytes.subarray(i, i + 0x8000));
  return s;
}

/** A byte string (one char per byte) back to its bytes. */
function binaryToBytes(aBinary: string): Uint8Array {
  const out = new Uint8Array(aBinary.length);
  for (let i = 0; i < aBinary.length; i++) out[i] = aBinary.charCodeAt(i);
  return out;
}

/**
 * `wxString( s.c_str(), wxConvUTF8 )`: up to the first NUL, strictly decoded;
 * a sequence that is not UTF-8 converts to the empty string, as wx's strict
 * converter fails.
 */
function utf8CStr(aBinary: string): string {
  const nul = aBinary.indexOf('\0');
  const bytes = binaryToBytes(nul === -1 ? aBinary : aBinary.slice(0, nul));

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return '';
  }
}

/** `wxString( s.c_str(), wxConvISO8859_1 )`: up to the first NUL, byte for character. */
function latin1CStr(aBinary: string): string {
  const nul = aBinary.indexOf('\0');
  return nul === -1 ? aBinary : aBinary.slice(0, nul);
}

/** `wxString::Trim( true )`: trailing blanks (`wxSafeIsspace`) off. */
function trimRight(s: string): string {
  return s.replace(/[ \t\n\v\f\r]+$/, '');
}

/** `wxString::Trim( false )`: leading blanks off. */
function trimLeft(s: string): string {
  return s.replace(/^[ \t\n\v\f\r]+/, '');
}

/** `wxString::MakeUpper()`: `towupper` per character, never a length change. */
function makeUpper(s: string): string {
  let out = '';

  for (const ch of s) {
    const up = ch.toUpperCase();
    out += up.length === ch.length ? up : ch;
  }

  return out;
}

export class ALTIUM_COMPOUND_FILE {
  protected m_reader: CompoundFileReader | null = null;
  protected m_buffer: Uint8Array = new Uint8Array(0);

  /**
   * `ALTIUM_COMPOUND_FILE()` for two-step initialization (e.g. with
   * `InitFromBuffer`), or `ALTIUM_COMPOUND_FILE( aBuffer, aLen )`: load a CFB
   * file from memory. Might throw an IO_ERROR.
   */
  constructor(aBuffer?: Uint8Array) {
    if (aBuffer) this.InitFromBuffer(aBuffer);
  }

  /**
   * Load a CFB file from memory; may throw an IO_ERROR.
   * Data is copied.
   */
  InitFromBuffer(aBuffer: Uint8Array): void {
    this.m_buffer = aBuffer.slice();

    try {
      this.m_reader = new CompoundFileReader(this.m_buffer, this.m_buffer.length);
    } catch (exception) {
      if (exception instanceof CFBException) throw new IO_ERROR(exception.message);

      throw exception;
    }
  }

  GetCompoundFileReader(): CompoundFileReader {
    return this.m_reader!;
  }

  DecodeIntLibStream(cfe: COMPOUND_FILE_ENTRY, aOutput: ALTIUM_COMPOUND_FILE): boolean {
    if (cfe.size < 1) return false;

    const streamSize = cfe.size;
    const buffer = new Uint8Array(streamSize);

    // read file into buffer
    this.GetCompoundFileReader().ReadFile(cfe, 0, buffer, streamSize);

    // 0x02: compressed stream, 0x00: uncompressed
    if (buffer[0] === 0x02) {
      aOutput.InitFromBuffer(inflateZlib(buffer.subarray(1)));
      return true;
    } else if (buffer[0] === 0x00) {
      aOutput.InitFromBuffer(buffer.subarray(1));
      return true;
    } else {
      console.assert(false, 'Altium IntLib unknown header');
    }

    return false;
  }

  FindStreamSingleLevel(
    aEntry: COMPOUND_FILE_ENTRY | null,
    aName: string,
    aIsStream: boolean,
  ): COMPOUND_FILE_ENTRY | null {
    if (!this.m_reader || !aEntry) return null;

    let ret: COMPOUND_FILE_ENTRY | null = null;
    const reader = this.m_reader;

    reader.EnumFiles(aEntry, 1, (entry) => {
      if (ret !== null) return 1;

      if (reader.IsStream(entry) === aIsStream) {
        const name = UTF16ToUTF8(entry.name);
        if (name === aName) {
          ret = entry;
          return 1;
        }
      }

      return 0;
    });
    return ret;
  }

  GetLibSymbols(aStart: COMPOUND_FILE_ENTRY | null): Map<string, ALTIUM_SYMBOL_DATA> {
    const reader = this.m_reader!;
    const root = aStart ?? reader.GetRootEntry();

    if (!root) return new Map();

    const folders = new Map<string, ALTIUM_SYMBOL_DATA>();
    const folder = (aName: string): ALTIUM_SYMBOL_DATA => {
      let f = folders.get(aName);
      if (!f) {
        f = {};
        folders.set(aName, f);
      }
      return f;
    };

    reader.EnumFiles(root, 1, (tentry) => {
      const dirName = UTF16ToWstring(tentry.name);

      if (reader.IsStream(tentry)) return 0;

      reader.EnumFiles(tentry, 1, (entry) => {
        const fileName = UTF16ToWstring(entry.name);

        if (reader.IsStream(entry) && fileName === 'Data') folder(dirName).m_symbol = entry;

        if (reader.IsStream(entry) && fileName === 'PinFrac') folder(dirName).m_pinsFrac = entry;

        if (reader.IsStream(entry) && fileName === 'PinWideText')
          folder(dirName).m_pinsWideText = entry;

        if (reader.IsStream(entry) && fileName === 'PinTextData')
          folder(dirName).m_pinsTextData = entry;

        return 0;
      });

      return 0;
    });

    return new Map([...folders].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  EnumDir(aDir: string): Map<string, COMPOUND_FILE_ENTRY> {
    const reader = this.m_reader!;
    const root = reader.GetRootEntry();

    if (!root) return new Map();

    const files = new Map<string, COMPOUND_FILE_ENTRY>();

    reader.EnumFiles(root, 1, (tentry) => {
      if (reader.IsStream(tentry)) return 0;

      const dirName = UTF16ToWstring(tentry.name);

      if (dirName !== aDir) return 0;

      reader.EnumFiles(tentry, 1, (entry) => {
        if (reader.IsStream(entry)) {
          const fileName = UTF16ToWstring(entry.name);

          files.set(fileName, entry);
        }

        return 0;
      });
      return 0;
    });

    // std::map: ordered by name
    return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  FindStream(aStreamPath: readonly string[]): COMPOUND_FILE_ENTRY | null;
  FindStream(
    aStart: COMPOUND_FILE_ENTRY | null,
    aStreamPath: readonly string[],
  ): COMPOUND_FILE_ENTRY | null;
  FindStream(
    a: COMPOUND_FILE_ENTRY | null | readonly string[],
    b?: readonly string[],
  ): COMPOUND_FILE_ENTRY | null {
    let aStart: COMPOUND_FILE_ENTRY | null;
    let aStreamPath: readonly string[];

    if (Array.isArray(a)) {
      aStart = null;
      aStreamPath = a;
    } else {
      aStart = a as COMPOUND_FILE_ENTRY | null;
      aStreamPath = b!;
    }

    if (!this.m_reader) return null;

    if (!aStart) aStart = this.m_reader.GetRootEntry();

    let it = 0;

    while (aStart !== null) {
      const name = aStreamPath[it]!;

      if (++it === aStreamPath.length) {
        const ret = this.FindStreamSingleLevel(aStart, name, true);
        return ret;
      } else {
        const ret = this.FindStreamSingleLevel(aStart, name, false);
        aStart = ret;
      }
    }

    return null;
  }
}

export class ALTIUM_BINARY_PARSER {
  private m_content: Uint8Array;
  private m_view: DataView;
  private m_size: number;

  /** current read pointer */
  private m_pos: number;
  /** pointer which points to next subrecord start; -1 is nullptr */
  private m_subrecord_end: number;
  private m_error: boolean;

  /**
   * `ALTIUM_BINARY_PARSER( aFile, aEntry )` reads the stream `aEntry` of
   * `aFile`; `ALTIUM_BINARY_PARSER( aContent, aSize )` adopts a buffer.
   */
  constructor(aFile: ALTIUM_COMPOUND_FILE, aEntry: COMPOUND_FILE_ENTRY);
  constructor(aContent: Uint8Array, aSize?: number);
  constructor(a: ALTIUM_COMPOUND_FILE | Uint8Array, b?: COMPOUND_FILE_ENTRY | number) {
    this.m_subrecord_end = -1;
    this.m_error = false;

    if (a instanceof Uint8Array) {
      this.m_size = (b as number | undefined) ?? a.length;
      this.m_content = a;
    } else {
      const aEntry = b as COMPOUND_FILE_ENTRY;
      this.m_size = aEntry.size;
      this.m_content = new Uint8Array(this.m_size);

      // read file into buffer
      a.GetCompoundFileReader().ReadFile(aEntry, 0, this.m_content, this.m_size);
    }

    this.m_view = new DataView(
      this.m_content.buffer,
      this.m_content.byteOffset,
      this.m_content.byteLength,
    );
    this.m_pos = 0;
  }

  /** `Read<Type>()` for a `Type` of `aSize` bytes, `aGet` reading it at the cursor. */
  private read(aSize: number, aGet: (aAt: number) => number): number {
    const remainingBytes = this.GetRemainingBytes();

    if (remainingBytes >= aSize) {
      const val = aGet(this.m_pos);
      this.m_pos += aSize;
      return val;
    } else {
      this.m_pos += remainingBytes; // Ensure remaining bytes are zero
      this.m_error = true;
      return 0;
    }
  }

  /** `Read<uint8_t>()`. */
  ReadUint8(): number {
    return this.read(1, (at) => this.m_view.getUint8(at));
  }

  /** `Read<uint16_t>()`. */
  ReadUint16(): number {
    return this.read(2, (at) => this.m_view.getUint16(at, true));
  }

  /** `Read<int16_t>()`. */
  ReadInt16(): number {
    return this.read(2, (at) => this.m_view.getInt16(at, true));
  }

  /** `Read<uint32_t>()`. */
  ReadUint32(): number {
    return this.read(4, (at) => this.m_view.getUint32(at, true));
  }

  /** `Read<int32_t>()`. */
  ReadInt32(): number {
    return this.read(4, (at) => this.m_view.getInt32(at, true));
  }

  /** `Read<double>()`. */
  ReadDouble(): number {
    return this.read(8, (at) => this.m_view.getFloat64(at, true));
  }

  /** `Peek<Type>()`: the read, then the cursor and error flag put back. */
  private peek(aRead: () => number): number {
    const oldPos = this.m_pos;
    const oldError = this.m_error;
    const result = aRead();
    this.m_pos = oldPos;
    this.m_error = oldError;
    return result;
  }

  /** `Peek<uint8_t>()`. */
  PeekUint8(): number {
    return this.peek(() => this.ReadUint8());
  }

  /** `Peek<uint32_t>()`. */
  PeekUint32(): number {
    return this.peek(() => this.ReadUint32());
  }

  /** `ReadCharBuffer()`: a byte count, then that many bytes; null (an empty buffer) on a short read. */
  ReadCharBuffer(): Uint8Array | null {
    const len = this.ReadUint8();

    if (this.GetRemainingBytes() >= len) {
      const buf = this.m_content.slice(this.m_pos, this.m_pos + len);
      this.m_pos += len;

      return buf;
    } else {
      this.m_error = true;
      return null;
    }
  }

  ReadWxString(): string {
    // TODO: Identify where the actual code page is stored. For now, this default code page
    //       has limited impact, because recent Altium files come with a UTF16 string table
    const buf = this.ReadCharBuffer();
    return buf ? latin1ToString(buf) : '';
  }

  ReadWideStringTable(): Map<number, string> {
    const table = new Map<number, string>();
    let remaining = this.GetRemainingBytes();

    while (remaining >= 8) {
      const index = this.ReadUint32();
      let length = this.ReadUint32();
      let str = '';
      remaining -= 8;

      if (length <= 2) {
        length = 0; // for empty strings, not even the null bytes are present
      } else {
        if (length > remaining) break;

        str = new TextDecoder('utf-16le').decode(
          this.m_content.subarray(this.m_pos, this.m_pos + length - 2),
        );
      }

      // std::map::emplace: the first entry for an index stays
      if (!table.has(index)) table.set(index, str);
      this.m_pos += length;
      remaining -= length;
    }

    // std::map: ordered by index
    return new Map([...table].sort(([a], [b]) => a - b));
  }

  ReadVector(aSize: number): Uint8Array {
    if (aSize > this.GetRemainingBytes()) {
      this.m_error = true;
      return new Uint8Array(0);
    } else {
      const data = this.m_content.slice(this.m_pos, this.m_pos + aSize);
      this.m_pos += aSize;
      return data;
    }
  }

  ReadBytes(aOut: Uint8Array, aSize: number): number {
    if (aSize > this.GetRemainingBytes()) {
      this.m_error = true;
      return 0;
    } else {
      aOut.set(this.m_content.subarray(this.m_pos, this.m_pos + aSize));
      this.m_pos += aSize;
      return aSize;
    }
  }

  ReadKicadUnit(): number {
    return ALTIUM_PROPS_UTILS.ConvertToKicadUnit(this.ReadInt32());
  }

  ReadKicadUnitX(): number {
    return this.ReadKicadUnit();
  }

  ReadKicadUnitY(): number {
    return -this.ReadKicadUnit();
  }

  ReadVector2IPos(): { x: number; y: number } {
    const x = this.ReadKicadUnitX();
    const y = this.ReadKicadUnitY();
    return { x, y: y + 0 };
  }

  ReadVector2ISize(): { x: number; y: number } {
    const x = this.ReadKicadUnit();
    const y = this.ReadKicadUnit();
    return { x, y };
  }

  ReadAndSetSubrecordLength(): number {
    const length = this.ReadUint32();
    this.m_subrecord_end = this.m_pos + length;
    return length;
  }

  ReadProperties(
    handleBinaryData: (aData: string) => ALTIUM_PROPS = () => new Map(),
  ): ALTIUM_PROPS {
    const kv: ALTIUM_PROPS = new Map();

    let length = this.ReadUint32();
    const isBinary = (length & 0xff000000) !== 0;

    length &= 0x00ffffff;

    if (length > this.GetRemainingBytes()) {
      this.m_error = true;
      return kv;
    }

    if (length === 0) {
      return kv;
    }

    // There is one case by kliment where Board6 ends with "|NEARDISTANCE=1000mi".
    // Both the 'l' and the null-byte are missing, which looks like Altium swallowed two bytes.
    const hasNullByte = this.m_content[this.m_pos + length - 1] === 0;

    // if( !hasNullByte && !isBinary ): wxLogTrace "Missing null byte at end of property list."

    // we use std::string because std::string can handle NULL-bytes
    // wxString would end the string at the first NULL-byte
    const str = latin1ToString(
      this.m_content.subarray(this.m_pos, this.m_pos + length - (hasNullByte && !isBinary ? 1 : 0)),
    );
    this.m_pos += length;

    if (isBinary) {
      return handleBinaryData(str);
    }

    // std::string::find, npos as -1; `u` orders npos above every index as size_t does
    const u = (p: number): number => (p === -1 ? Number.POSITIVE_INFINITY : p);
    let token_end = 0;

    while (token_end < str.length && token_end !== -1) {
      const token_start = str.indexOf('|', token_end);
      const token_equal = str.indexOf('=', token_end);
      let key_start: number;

      if (u(token_start) <= u(token_equal)) {
        // npos + 1 wraps to 0
        key_start = token_start + 1;
      } else {
        // Leading "|" before "RECORD=28" may be missing in older schematic versions.
        key_start = token_end;
      }

      token_end = str.indexOf('|', key_start);

      if (u(token_equal) >= u(token_end)) {
        continue; // this looks like an error: skip the entry. Also matches on std::string::npos
      }

      if (token_end === -1) {
        token_end = str.length + 1; // this is the correct offset
      }

      const keyS = str.substring(key_start, token_equal);
      const valueS = str.substr(token_equal + 1, token_end - token_equal - 1);

      // convert the strings to wxStrings, since we use them everywhere
      // value can have non-ASCII characters, so we convert them from LATIN1/ISO8859-1
      const key = latin1CStr(keyS);

      // Altium stores keys either in Upper, or in CamelCase. Lets unify it.
      const canonicalKey = makeUpper(trimRight(trimLeft(key)));

      // If the key starts with '%UTF8%' we have to parse the value using UTF8
      let value: string;

      if (canonicalKey.startsWith('%UTF8%')) value = utf8CStr(valueS);
      else value = latin1CStr(valueS);

      if (canonicalKey !== 'PATTERN' && canonicalKey !== 'SOURCEFOOTPRINTLIBRARY') {
        // Breathless hack because I haven't a clue what the story is here (but this character
        // appears in a lot of radial dimensions and is rendered by Altium as a space).
        // the replacement is U+00A0 NO-BREAK SPACE, which Trim() below keeps
        value = value.replaceAll('\u00ff', '\u00a0');
      }

      // std::map::insert: the first value for a key stays
      if (!kv.has(canonicalKey)) kv.set(canonicalKey, trimRight(value));
    }

    // DESIGNATOR/NAME/TEXT carry Altium overbar markup that must be converted for every record
    // type except RECORD=4 (LABEL). Older schematics emit those keys ahead of RECORD, so the type
    // is only reliably known once the whole record has been read; deciding mid-stream both misses
    // the exemption and, via operator[], leaves an empty RECORD that shadows the real value.
    const recordIt = kv.get('RECORD');

    if (recordIt === undefined || recordIt !== '4') {
      for (const key of ['DESIGNATOR', 'NAME', 'TEXT']) {
        const valueIt = kv.get(key);

        if (valueIt !== undefined) kv.set(key, AltiumPropertyToKiCadString(valueIt));
      }
    }

    return kv;
  }

  Skip(aLength: number): void {
    if (this.GetRemainingBytes() >= aLength) {
      this.m_pos += aLength;
    } else {
      this.m_error = true;
    }
  }

  SkipSubrecord(): void {
    if (this.m_subrecord_end === -1 || this.m_subrecord_end < this.m_pos) {
      this.m_error = true;
    } else {
      this.m_pos = this.m_subrecord_end;
    }
  }

  GetRemainingBytes(): number {
    return this.m_size - this.m_pos;
  }

  GetRemainingSubrecordBytes(): number {
    return this.m_subrecord_end === -1 || this.m_subrecord_end <= this.m_pos
      ? 0
      : this.m_subrecord_end - this.m_pos;
  }

  HasParsingError(): boolean {
    return this.m_error;
  }
}

/** `std::out_of_range( "ALTIUM_BINARY_READER: out of range" )`. */
function outOfRange(): Error {
  return new RangeError('ALTIUM_BINARY_READER: out of range');
}

/** `ALTIUM_BINARY_READER`: a throwing reader over a byte string (`std::string`). */
export class ALTIUM_BINARY_READER {
  protected readonly m_data: string;
  protected m_position: number;

  constructor(binaryData: string) {
    this.m_data = binaryData;
    this.m_position = 0;
  }

  private bytes(aCount: number): number[] {
    if (this.m_position + aCount > this.m_data.length) throw outOfRange();

    const out: number[] = [];
    for (let i = 0; i < aCount; i++) out.push(this.m_data.charCodeAt(this.m_position + i));
    this.m_position += aCount;
    return out;
  }

  ReadInt32(): number {
    const b = this.bytes(4);
    return b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24);
  }

  ReadInt16(): number {
    const b = this.bytes(2);
    return ((b[0]! | (b[1]! << 8)) << 16) >> 16;
  }

  ReadByte(): number {
    return this.bytes(1)[0]!;
  }

  ReadShortPascalString(): string {
    const length = this.ReadByte();

    if (this.m_position + length > this.m_data.length) throw outOfRange();

    const pascalString = this.m_data.substr(this.m_position, length);
    this.m_position += length;
    return pascalString;
  }

  ReadFullPascalString(): string {
    const length = this.ReadInt32() >>> 0;

    if (this.m_position + length > this.m_data.length) throw outOfRange();

    const pascalString = this.m_data.substr(this.m_position, length);
    this.m_position += length;
    return pascalString;
  }
}

export class ALTIUM_COMPRESSED_READER extends ALTIUM_BINARY_READER {
  private decompressedData = '';

  ReadCompressedString(): [number, string] {
    let id = -1;

    const byte = this.ReadByte();

    if (byte !== 0xd0) throw new Error('ALTIUM_COMPRESSED_READER: invalid compressed string');

    const str = this.ReadShortPascalString();
    // std::from_chars: leading digits (and a minus) only
    const m = /^-?\d+/.exec(str);
    if (m) id = Number.parseInt(m[0], 10);

    const data = this.ReadFullPascalString();
    const result = this.decompressData(data);

    return [id, result];
  }

  private decompressData(aData: string): string {
    // Read decompressed data from the zlib input stream
    this.decompressedData += latin1ToString(inflateZlib(binaryToBytes(aData)));

    return this.decompressedData;
  }
}
