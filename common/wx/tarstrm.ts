// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets (src/common/tarstrm.cpp), wxWindows Library Licence.
/**
 * `wxTarOutputStream`, the writing half: `PutNextDirEntry`, `PutNextEntry` with the entry's bytes,
 * and `Close`, into one buffer. Entries are POSIX ustar headers (wx's default format is PAX, which
 * adds extended headers only for names and sizes that do not fit ustar; the ones written here
 * do).
 */

const BLOCK = 512;

function octal(aValue: number, aWidth: number): string {
  // aWidth - 1 octal digits, then a NUL.
  return `${aValue.toString(8).padStart(aWidth - 1, '0')}\0`;
}

export class wxTarOutputStream {
  private readonly m_parts: Uint8Array[] = [];
  private readonly m_enc = new TextEncoder();

  private header(aName: string, aSize: number, aType: '0' | '5', aMTime: Date): Uint8Array {
    const h = new Uint8Array(BLOCK);
    const put = (aOffset: number, aText: string): void => {
      h.set(this.m_enc.encode(aText), aOffset);
    };

    let name = aName;
    let prefix = '';

    // ustar splits a long name at a '/' into prefix (155) + name (100).
    if (this.m_enc.encode(name).length > 100) {
      const cut = name.lastIndexOf('/', 155);

      if (cut > 0) {
        prefix = name.substring(0, cut);
        name = name.substring(cut + 1);
      }
    }

    put(0, name);
    put(100, octal(aType === '5' ? 0o755 : 0o644, 8));
    put(108, octal(0, 8)); // uid
    put(116, octal(0, 8)); // gid
    put(124, octal(aSize, 12));
    put(136, octal(Math.floor(aMTime.getTime() / 1000), 12));
    put(148, '        '); // checksum, as spaces while summing
    put(156, aType);
    put(257, 'ustar\0');
    put(263, '00');
    put(345, prefix);

    let sum = 0;

    for (const b of h) sum += b;

    put(148, `${sum.toString(8).padStart(6, '0')}\0 `);

    return h;
  }

  /** `PutNextDirEntry( name )`: a directory entry, named with a trailing '/'. */
  PutNextDirEntry(aName: string, aMTime: Date = new Date()): void {
    this.m_parts.push(this.header(aName.endsWith('/') ? aName : `${aName}/`, 0, '5', aMTime));
  }

  /** `PutNextEntry( name, time, size )` and the entry's bytes, padded to a block. */
  PutNextEntry(aName: string, aData: Uint8Array, aMTime: Date = new Date()): void {
    this.m_parts.push(this.header(aName, aData.length, '0', aMTime));
    this.m_parts.push(aData);

    const pad = (BLOCK - (aData.length % BLOCK)) % BLOCK;

    if (pad) this.m_parts.push(new Uint8Array(pad));
  }

  /** `Close()`: the two zero blocks that end an archive, and the whole archive. */
  Close(): Uint8Array {
    this.m_parts.push(new Uint8Array(2 * BLOCK));

    const total = this.m_parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;

    for (const p of this.m_parts) {
      out.set(p, at);
      at += p.length;
    }

    return out;
  }
}
