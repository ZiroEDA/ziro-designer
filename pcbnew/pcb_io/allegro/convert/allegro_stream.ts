// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright Quilter and The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/allegro/convert/allegro_stream.h`: the little-endian reader
 * over an Allegro `.brd` (or `.dra`) buffer.
 *
 * A `std::string` read here becomes a `wxString` on every path that uses it
 * (`DB::AddString`, the builder's names and values), and that conversion is
 * UTF-8 on the locales kicad-cli runs under; a byte sequence that is not
 * UTF-8 converts to an empty `wxString`. Strings are therefore decoded once,
 * here, with that rule, while every length and offset is still counted in
 * bytes as the C++ counts them.
 */
import { THROW_IO_ERROR } from '@ziroeda/common/exceptions.js';

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** A `std::string`'s bytes as the `wxString` they become (empty when not UTF-8). */
export function wxFromBytes(aBytes: Uint8Array): string {
  try {
    return UTF8.decode(aBytes);
  } catch {
    return '';
  }
}

/**
 * Stream that reads primitive types from a memory buffer containing
 * Allegro .brd (or .dra) file data. All multi-byte values are little-endian.
 */
export class FILE_STREAM {
  private readonly m_data: Uint8Array;
  private readonly m_view: DataView;
  private readonly m_size: number;
  private m_pos = 0;

  constructor(aData: Uint8Array, aSize: number = aData.length) {
    this.m_data = aData;
    this.m_view = new DataView(aData.buffer, aData.byteOffset, aData.byteLength);
    this.m_size = aSize;
  }

  Position(): number {
    return this.m_pos;
  }

  Seek(aPos: number): void {
    if (aPos > this.m_size) {
      THROW_IO_ERROR(`Seek past end of file: offset ${aPos} exceeds file size ${this.m_size}`);
    }

    this.m_pos = aPos;
  }

  Skip(aBytes: number): void {
    if (aBytes > this.m_size - this.m_pos) {
      THROW_IO_ERROR(`Skip past end of file at offset ${this.m_pos}`);
    }

    this.m_pos += aBytes;
  }

  Eof(): boolean {
    return this.m_pos >= this.m_size;
  }

  /**
   * Read a number of bytes from the stream (`ReadBytes( aDest, aSize )`).
   * The copy is returned rather than written through a pointer.
   */
  ReadBytes(aSize: number): Uint8Array {
    if (aSize > this.m_size || this.m_pos > this.m_size - aSize) {
      THROW_IO_ERROR(
        `Failed to read requested ${aSize} bytes at offset ${this.m_pos} (file size ${this.m_size})`,
      );
    }

    const out = this.m_data.slice(this.m_pos, this.m_pos + aSize);
    this.m_pos += aSize;
    return out;
  }

  private need(aSize: number): number {
    if (aSize > this.m_size || this.m_pos > this.m_size - aSize) {
      THROW_IO_ERROR(
        `Failed to read requested ${aSize} bytes at offset ${this.m_pos} (file size ${this.m_size})`,
      );
    }

    const at = this.m_pos;
    this.m_pos += aSize;
    return at;
  }

  ReadString(aRoundToNextU32: boolean): string {
    if (this.m_pos > this.m_size) {
      THROW_IO_ERROR(`ReadString at invalid offset ${this.m_pos} (file size ${this.m_size})`);
    }

    const end = this.m_data.subarray(0, this.m_size).indexOf(0, this.m_pos);

    if (end < 0) THROW_IO_ERROR(`Unterminated string at offset ${this.m_pos}`);

    const str = wxFromBytes(this.m_data.subarray(this.m_pos, end));
    this.m_pos = end + 1;

    if (aRoundToNextU32 && this.m_pos % 4 !== 0) this.Skip(4 - (this.m_pos % 4));

    return str;
  }

  ReadStringFixed(aLen: number, aRoundToNextU32: boolean): string {
    if (aLen > this.m_size || this.m_pos > this.m_size - aLen) {
      THROW_IO_ERROR(
        `Failed to read fixed string of ${aLen} bytes at offset ${this.m_pos} (file size ${this.m_size})`,
      );
    }

    // strnlen( start, aLen )
    const field = this.m_data.subarray(this.m_pos, this.m_pos + aLen);
    const nul = field.indexOf(0);
    const str = wxFromBytes(nul < 0 ? field : field.subarray(0, nul));
    this.m_pos += aLen;

    if (aRoundToNextU32 && this.m_pos % 4 !== 0) this.Skip(4 - (this.m_pos % 4));

    return str;
  }

  /** `GetU8( value )`: the next byte, or null at EOF (the C++ returns false). */
  GetU8(): number | null {
    if (this.m_pos >= this.m_size) return null;

    return this.m_data[this.m_pos++]!;
  }

  ReadU8(): number {
    return this.m_view.getUint8(this.need(1));
  }

  ReadU16(): number {
    return this.m_view.getUint16(this.need(2), true);
  }

  ReadS16(): number {
    return this.m_view.getInt16(this.need(2), true);
  }

  ReadU32(): number {
    return this.m_view.getUint32(this.need(4), true);
  }

  ReadS32(): number {
    return this.m_view.getInt32(this.need(4), true);
  }

  SkipU32(n = 1): void {
    this.Skip(4 * n);
  }
}
