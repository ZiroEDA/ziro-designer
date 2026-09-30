// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `wxZipInputStream` over bytes in memory: the entries of a `.zip` in the
 * order their local headers sit in the file, each one's name and inflated
 * data, as the importers walk it (`while( entry.reset( zip.GetNextEntry() ) )`).
 *
 * The sizes come from the central directory, which wx also consults when a
 * local header defers them to a data descriptor (bit 3). Stored and deflated
 * entries are read; any other method yields an entry whose `Read()` fails,
 * as wx's stream goes bad on it. Names are UTF-8 (the flag-11 form, and what
 * wx's default `wxConvLocal` decodes on a UTF-8 system).
 */

import { inflateRaw } from './inflate.js';

export class wxZipEntry {
  constructor(
    private readonly m_name: string,
    private readonly m_read: () => Uint8Array | null,
    private readonly m_isDir: boolean,
  ) {}

  /** `GetName()`: the internal name in native (here `/`) form. */
  GetName(): string {
    return this.m_name;
  }

  IsDir(): boolean {
    return this.m_isDir;
  }

  /** The entry's bytes, or null when the stream cannot produce them. */
  Read(): Uint8Array | null {
    return this.m_read();
  }
}

interface CENTRAL {
  offset: number;
  compSize: number;
  size: number;
  method: number;
  name: string;
}

export class wxZipInputStream {
  private m_entries: CENTRAL[] = [];
  private m_next = 0;
  private m_ok = false;

  constructor(private readonly m_data: Uint8Array) {
    try {
      this.m_entries = this.readCentralDirectory();
      this.m_ok = this.m_entries.length > 0 || this.findEocd() >= 0;
    } catch {
      this.m_ok = false;
    }
  }

  IsOk(): boolean {
    return this.m_ok;
  }

  GetNextEntry(): wxZipEntry | null {
    if (!this.m_ok || this.m_next >= this.m_entries.length) return null;

    const e = this.m_entries[this.m_next++]!;
    const d = this.m_data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);

    if (e.offset + 30 > d.length || dv.getUint32(e.offset, true) !== 0x04034b50) return null;

    const nameLen = dv.getUint16(e.offset + 26, true);
    const extraLen = dv.getUint16(e.offset + 28, true);
    const start = e.offset + 30 + nameLen + extraLen;

    const read = (): Uint8Array | null => {
      if (start + e.compSize > d.length) return null;

      const raw = d.subarray(start, start + e.compSize);

      if (e.method === 0) return raw.slice();

      if (e.method === 8) {
        try {
          return inflateRaw(raw, e.size);
        } catch {
          return null;
        }
      }

      return null;
    };

    return new wxZipEntry(e.name, read, e.name.endsWith('/'));
  }

  private findEocd(): number {
    const d = this.m_data;

    for (let i = d.length - 22; i >= Math.max(0, d.length - 22 - 0xffff); i--) {
      if (d[i] === 0x50 && d[i + 1] === 0x4b && d[i + 2] === 0x05 && d[i + 3] === 0x06) return i;
    }

    return -1;
  }

  private readCentralDirectory(): CENTRAL[] {
    const d = this.m_data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const eocd = this.findEocd();

    if (eocd < 0) return [];

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out: CENTRAL[] = [];
    const utf8 = new TextDecoder('utf-8');

    for (let i = 0; i < count; i++) {
      if (p + 46 > d.length || dv.getUint32(p, true) !== 0x02014b50) break;

      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const offset = dv.getUint32(p + 42, true);
      const name = utf8.decode(d.subarray(p + 46, p + 46 + nameLen));

      out.push({ offset, compSize, size, method, name });

      p += 46 + nameLen + extraLen + commentLen;
    }

    // the stream meets the entries in file order
    return out.sort((a, b) => a.offset - b.offset);
  }
}
