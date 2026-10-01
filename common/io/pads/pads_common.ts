// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/pads/pads_common.cpp` / `.h`: what the PADS board and schematic
 * importers share — the deterministic component UUID, file-type detection,
 * the forgiving number parsers, inverted net names, the 8-bit text decoding
 * and the line-style map.
 *
 * A PADS file is read here as a byte string: one JS character per byte
 * (latin-1), so `std::string` indexing and lengths carry over. `ConvertText`
 * is where bytes become text.
 */

import { LINE_STYLE } from '../../stroke_params.js';
import { strtodPrefix } from '../../libc/stdlib.js';

/** A byte string's bytes. */
export function bytesOf(aByteString: string): Uint8Array {
  const out = new Uint8Array(aByteString.length);
  for (let i = 0; i < aByteString.length; i++) out[i] = aByteString.charCodeAt(i) & 0xff;
  return out;
}

/** Bytes as a byte string. */
export function byteString(aBytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < aBytes.length; i += CHUNK)
    s += String.fromCharCode(...aBytes.subarray(i, i + CHUNK));
  return s;
}

/**
 * Generate a deterministic KIID from a PADS component identifier (FNV-1a,
 * two salted 64-bit hashes shaped as a version-4 UUID).
 */
export function GenerateDeterministicUuid(aIdentifier: string): string {
  // FNV-1a parameters for 64-bit
  const FNV_PRIME = 0x00000100000001b3n;
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const M = (1n << 64n) - 1n;

  const hash = (s: string): bigint => {
    let h = FNV_OFFSET;
    for (let i = 0; i < s.length; i++) {
      h ^= BigInt(s.charCodeAt(i) & 0xff);
      h = (h * FNV_PRIME) & M;
    }
    return h;
  };

  // `std::string` bytes: the identifier is already a byte string
  const hash1 = hash(`PADS1:${aIdentifier}`);
  const hash2 = hash(`PADS2:${aIdentifier}`);

  const hex = (v: bigint, w: number): string => v.toString(16).padStart(w, '0');

  const version = (hash1 & 0xffffn & 0x0fffn) | 0x4000n;
  const variant = ((hash2 >> 48n) & 0x3fffn) | 0x8000n;

  return `${hex(hash1 >> 32n, 8)}-${hex((hash1 >> 16n) & 0xffffn, 4)}-${hex(version, 4)}-${hex(variant, 4)}-${hex(hash2 & 0xffffffffffffn, 12)}`;
}

export enum PADS_FILE_TYPE {
  UNKNOWN,
  PCB_ASCII, ///< PADS PowerPCB ASCII (.asc)
  SCHEMATIC_ASCII, ///< PADS Logic ASCII (.asc or .txt)
}

/** `DetectPadsFileType`, over the file's first line (`std::getline`: up to the '\n'). */
export function DetectPadsFileType(aData: Uint8Array | null): PADS_FILE_TYPE {
  if (!aData) return PADS_FILE_TYPE.UNKNOWN;

  if (aData.length === 0) return PADS_FILE_TYPE.UNKNOWN;

  let end = aData.indexOf(0x0a);
  if (end < 0) end = aData.length;

  const line = byteString(aData.subarray(0, end));

  if (line.startsWith('*PADS-POWERPCB') || line.startsWith('!PADS-POWERPCB'))
    return PADS_FILE_TYPE.PCB_ASCII;

  if (line.startsWith('*PADS2000') || line.startsWith('!PADS2000')) return PADS_FILE_TYPE.PCB_ASCII;

  if (line.startsWith('*PADS-POWERLOGIC') || line.startsWith('!PADS-POWERLOGIC'))
    return PADS_FILE_TYPE.SCHEMATIC_ASCII;

  if (line.startsWith('*PADS-LOGIC') || line.startsWith('!PADS-LOGIC'))
    return PADS_FILE_TYPE.SCHEMATIC_ASCII;

  return PADS_FILE_TYPE.UNKNOWN;
}

/** `std::stoi`: leading blanks, a sign, digits; null where it throws. */
function stoi(aStr: string): number | null {
  const m = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(aStr);

  if (!m) return null;

  const v = Number.parseInt(m[1]!, 10);

  if (v > 2147483647 || v < -2147483648) return null; // out_of_range

  return v;
}

/** `std::stod`: strtod's prefix; null where it throws (nothing read, or out of range). */
function stod(aStr: string): number | null {
  const r = strtodPrefix(aStr, 0);

  if (r === null) return null;

  if (!Number.isFinite(r.value)) {
    // strtod sets ERANGE on overflow only; an explicit "inf" is a value
    const t = aStr.trimStart().replace(/^[+-]/, '').toLowerCase();
    if (!t.startsWith('inf') && !t.startsWith('nan')) return null;
  } else if (r.value !== 0 && Math.abs(r.value) < 2.2250738585072014e-308) {
    return null; // underflow to a subnormal: ERANGE
  }

  return r.value;
}

/** `ParseInt( aStr, aDefault )`: `std::stoi`, or the default where it throws. */
export function ParseInt(aStr: string, aDefault = 0, _aContext = ''): number {
  const v = stoi(aStr);
  return v === null ? aDefault : v;
}

/** `ParseDouble( aStr, aDefault )`: `std::stod`, or the default where it throws. */
export function ParseDouble(aStr: string, aDefault = 0.0, _aContext = ''): number {
  const v = stod(aStr);
  return v === null ? aDefault : v;
}

/** `wxString::FromUTF8( bytes )`: the text, or '' when the bytes are not UTF-8. */
export function FromUTF8(aByteString: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytesOf(aByteString));
  } catch {
    return '';
  }
}

/** Convert a PADS net name to KiCad format: a "/" prefix is an overbar. */
export function ConvertInvertedNetName(aNetName: string): string {
  if (aNetName === '') return '';

  if (aNetName[0] === '/') return `~{${FromUTF8(aNetName.substring(1))}}`;

  return FromUTF8(aNetName);
}

/**
 * Decode text from a PADS file, which uses an 8-bit codepage rather than UTF-8:
 * UTF-8 when valid, else Windows-1252 — where a byte CP1252 leaves undefined
 * (0x81, 0x8D, 0x8F, 0x90, 0x9D) fails the whole conversion, as iconv does —
 * else ISO-8859-1.
 */
export function ConvertText(aText: string): string {
  if (aText === '') return '';

  let result = FromUTF8(aText);

  if (result === '') {
    const bytes = bytesOf(aText);

    if (![0x81, 0x8d, 0x8f, 0x90, 0x9d].some((b) => bytes.includes(b)))
      result = new TextDecoder('windows-1252').decode(bytes);

    // Latin-1 maps every byte one-to-one when CP1252 has no mapping.
    if (result === '') result = aText;
  }

  return result;
}

/** A PADS line style (read as a signed byte) as a KiCad LINE_STYLE. */
export function PadsLineStyleToKiCad(aPadsStyle: number): LINE_STYLE {
  const s = ((aPadsStyle & 0xff) << 24) >> 24;

  switch (s) {
    case 0:
      return LINE_STYLE.DASH;
    case 1:
      return LINE_STYLE.SOLID;
    case -1:
      return LINE_STYLE.SOLID;
    case -2:
      return LINE_STYLE.DASH;
    case -3:
      return LINE_STYLE.DOT;
    case -4:
      return LINE_STYLE.DASHDOT;
    case -5:
      return LINE_STYLE.DASHDOTDOT;
    default:
      return LINE_STYLE.SOLID;
  }
}
