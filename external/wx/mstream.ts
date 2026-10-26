// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `wxMemoryInputStream` (wx 3.2.4 mstream.cpp, with the wxInputStream and wxStreamBuffer parts of
 * stream.cpp it runs through), as far as the image handlers read it. What a truncated file comes
 * down to is this class's end-of-data behaviour, so that is kept exactly:
 *
 * - `Read( buf, n )` copies what is left, up to n, and zeroes the rest of the n bytes it was asked
 *   for (wxStreamBuffer::Read's memset). `LastRead()` is the count copied.
 * - It sets EOF only when it got fewer bytes than asked: a read that ends exactly at the end of
 *   the data leaves the stream OK, and only the next read finds EOF.
 * - `GetC()` is a one-byte Read: the byte, or `wxEOF` (-1) with EOF set.
 * - `SeekI` clears EOF first; a seek before the start or past the end is `wxInvalidOffset` and
 *   does not move (the memory stream's buffer is not flushable).
 */

/** `wxEOF`. */
export const wxEOF = -1;

/** `wxInvalidOffset`. */
export const wxInvalidOffset = -1;

/** `wxSeekMode`. */
export enum wxSeekMode {
  wxFromStart,
  wxFromCurrent,
  wxFromEnd,
}

/** `wxStreamError`, the two a memory stream can be in. */
export enum wxStreamError {
  wxSTREAM_NO_ERROR = 0,
  wxSTREAM_EOF = 1,
}

/** `wxMemoryInputStream`. */
export class wxMemoryInputStream {
  private m_pos = 0;
  private m_lastcount = 0;
  private m_lasterror = wxStreamError.wxSTREAM_NO_ERROR;

  constructor(private readonly m_data: Uint8Array) {}

  GetLength(): number {
    return this.m_data.length;
  }

  TellI(): number {
    return this.m_pos;
  }

  LastRead(): number {
    return this.m_lastcount;
  }

  GetLastError(): wxStreamError {
    return this.m_lasterror;
  }

  /** `wxStreamBase::IsOk`: no error, EOF included. */
  IsOk(): boolean {
    return this.m_lasterror === wxStreamError.wxSTREAM_NO_ERROR;
  }

  /** `wxInputStream::Eof`: a read has already gone past the end. */
  Eof(): boolean {
    return this.m_lasterror === wxStreamError.wxSTREAM_EOF;
  }

  /** `wxMemoryInputStream::OnSysRead`. */
  private OnSysRead(aBuffer: Uint8Array, aOffset: number, aBytes: number): number {
    if (this.m_pos === this.m_data.length) {
      this.m_lasterror = wxStreamError.wxSTREAM_EOF;
      return 0;
    }

    // wxStreamBuffer::Read: "Clear buffer first", then copy what there is.
    aBuffer.fill(0, aOffset, aOffset + aBytes);

    const n = Math.min(aBytes, this.m_data.length - this.m_pos);
    aBuffer.set(this.m_data.subarray(this.m_pos, this.m_pos + n), aOffset);
    this.m_pos += n;
    this.m_lasterror = wxStreamError.wxSTREAM_NO_ERROR;

    return n;
  }

  /** `wxInputStream::Read( buf, size )`, into \a aBuffer from \a aOffset. */
  Read(aBuffer: Uint8Array, aSize: number, aOffset = 0): this {
    let size = aSize;
    let p = aOffset;
    let read = 0; // GetWBack: nothing is ever written back here

    this.m_lastcount = 0;

    for (;;) {
      size -= read;
      this.m_lastcount += read;
      p += read;

      // we read the requested amount of data
      if (!size) break;

      // we have already read something and we would block in OnSysRead() now
      if (p !== aOffset && this.m_lasterror === wxStreamError.wxSTREAM_EOF) break;

      read = this.OnSysRead(aBuffer, p, size);

      // no more data available
      if (!read) break;
    }

    return this;
  }

  /** `wxInputStream::GetC`. */
  GetC(): number {
    const c = new Uint8Array(1);
    this.Read(c, 1);
    return this.LastRead() ? c[0]! : wxEOF;
  }

  /** `wxInputStream::SeekI`, on a memory stream. */
  SeekI(aPos: number, aMode: wxSeekMode = wxSeekMode.wxFromStart): number {
    if (this.m_lasterror === wxStreamError.wxSTREAM_EOF)
      this.m_lasterror = wxStreamError.wxSTREAM_NO_ERROR;

    // avoid unnecessary seek operations (optimization)
    const size = this.m_data.length;

    if (
      (aMode === wxSeekMode.wxFromStart && this.m_pos === aPos) ||
      (aMode === wxSeekMode.wxFromCurrent && aPos === 0) ||
      (aMode === wxSeekMode.wxFromEnd && this.m_pos === size - aPos)
    )
      return this.m_pos;

    // wxStreamBuffer::Seek, a buffer that is not flushable
    const diff =
      aMode === wxSeekMode.wxFromStart
        ? aPos
        : aMode === wxSeekMode.wxFromCurrent
          ? aPos + this.m_pos
          : aPos + size;

    if (diff < 0 || diff > size) return wxInvalidOffset;

    this.m_pos = diff;
    return diff;
  }
}
