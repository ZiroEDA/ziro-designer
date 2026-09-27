// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `<wx/buffer.h>`: `wxMemoryBuffer`, a growable run of bytes - the part of
 * it KiCad calls.
 */
export class wxMemoryBuffer {
  private m_data = new Uint8Array(0);
  private m_len = 0;

  constructor(aData?: Uint8Array) {
    if (aData) this.AppendData(aData);
  }

  /** The bytes in use: a view, not a copy. */
  GetData(): Uint8Array {
    return this.m_data.subarray(0, this.m_len);
  }

  GetDataLen(): number {
    return this.m_len;
  }

  /** Truncate or extend the used length; new bytes are zero. */
  SetDataLen(aLen: number): void {
    this.reserve(aLen);
    if (aLen > this.m_len) this.m_data.fill(0, this.m_len, aLen);
    this.m_len = aLen;
  }

  AppendData(aData: Uint8Array): void {
    this.reserve(this.m_len + aData.length);
    this.m_data.set(aData, this.m_len);
    this.m_len += aData.length;
  }

  private reserve(aLen: number): void {
    if (aLen <= this.m_data.length) return;

    const grown = new Uint8Array(Math.max(aLen, this.m_data.length * 2));
    grown.set(this.m_data.subarray(0, this.m_len));
    this.m_data = grown;
  }
}
