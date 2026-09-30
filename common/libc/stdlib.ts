// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The number conversions of the C library (`<stdlib.h>`) and the two
 * `wxString` wrappers over them that KiCad's readers call: `strtod`, `strtol`,
 * `atoi`, `wxString::ToCDouble` / `ToLong` / `ToULong`.
 *
 * Ours, no KiCad file: KiCad gets these from libc and wx. They were first
 * written for gerbview's readers (`gerbview/libc.ts` re-exports them); the
 * Altium and Eagle importers read numbers through the same calls.
 */

const WHITESPACE = ' \t\n\r\f\v';

const isdigit = (ch: string): boolean => ch >= '0' && ch <= '9' && ch.length === 1;

/**
 * The prefix of `s` from `start` that C's `strtod` would consume, in the C
 * locale: optional whitespace and sign, then a decimal number (digits, one
 * point, an optional exponent), a hexadecimal one (`0x`, digits, point, `p`
 * exponent), `inf`/`infinity` or `nan`. Returns the value and the index just
 * past it, or `null` when no conversion is performed (`endptr == nptr`).
 */
export function strtodPrefix(s: string, start = 0): { value: number; end: number } | null {
  let i = start;
  while (i < s.length && WHITESPACE.includes(s[i] as string)) i++;
  let sign = 1;
  if (s[i] === '+' || s[i] === '-') {
    if (s[i] === '-') sign = -1;
    i++;
  }
  const lower = s.slice(i, i + 8).toLowerCase();
  if (lower.startsWith('infinity')) return { value: sign * Infinity, end: i + 8 };
  if (lower.startsWith('inf')) return { value: sign * Infinity, end: i + 3 };
  if (lower.startsWith('nan')) return { value: Number.NaN, end: i + 3 };

  const hexDigit = (ch: string | undefined): boolean => !!ch && /^[0-9a-fA-F]$/.test(ch);

  if (s[i] === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X')) {
    let j = i + 2;
    let mant = 0;
    let any = false;
    while (hexDigit(s[j])) {
      mant = mant * 16 + Number.parseInt(s[j] as string, 16);
      j++;
      any = true;
    }
    let scale = 0;
    if (s[j] === '.') {
      let k = j + 1;
      while (hexDigit(s[k])) {
        mant = mant * 16 + Number.parseInt(s[k] as string, 16);
        scale -= 4;
        k++;
        any = true;
      }
      if (any) j = k;
    }
    if (!any) {
      // "0x" with no hex digit: strtod converts the "0" and stops at the 'x'.
      return { value: sign * 0, end: i + 1 };
    }
    if (s[j] === 'p' || s[j] === 'P') {
      let k = j + 1;
      let esign = 1;
      if (s[k] === '+' || s[k] === '-') {
        if (s[k] === '-') esign = -1;
        k++;
      }
      if (isdigit(s[k] ?? '')) {
        let e = 0;
        while (isdigit(s[k] ?? '')) e = e * 10 + Number(s[k++]);
        scale += esign * e;
        j = k;
      }
    }
    return { value: sign * mant * 2 ** scale, end: j };
  }

  let j = i;
  let digits = 0;
  while (isdigit(s[j] ?? '')) {
    j++;
    digits++;
  }
  if (s[j] === '.') {
    j++;
    while (isdigit(s[j] ?? '')) {
      j++;
      digits++;
    }
  }
  if (digits === 0) return null;
  if (s[j] === 'e' || s[j] === 'E') {
    let k = j + 1;
    if (s[k] === '+' || s[k] === '-') k++;
    if (isdigit(s[k] ?? '')) {
      while (isdigit(s[k] ?? '')) k++;
      j = k;
    }
  }
  return { value: sign * Number(s.slice(i, j)), end: j };
}

/**
 * `strtol( nptr, &endptr, 10 )`: the value and where it stopped, `end ===
 * start` when no digits were read (and the value 0).
 */
export function strtol10(s: string, start = 0): { value: number; end: number } {
  let i = start;
  while (i < s.length && WHITESPACE.includes(s[i] as string)) i++;
  let sign = 1;
  if (s[i] === '+' || s[i] === '-') {
    if (s[i] === '-') sign = -1;
    i++;
  }
  let j = i;
  let v = 0;
  while (isdigit(s[j] ?? '')) v = v * 10 + Number(s[j++]);
  if (j === i) return { value: 0, end: start };
  // A C long saturates; ours only ever reads counts and D-code numbers.
  return { value: sign * v, end: j };
}

/**
 * `wxString::ToCDouble( &val )` as wx 3.2 behaves on this machine
 * (`qa/probes/gerbview_tocdouble_probe.cpp`): `val` gets strtod's result for
 * whatever prefix it could read — even when trailing text makes the call
 * return false — and is left UNTOUCHED when nothing at all converts.
 */
export function ToCDouble(text: string, prev: number): number {
  const r = strtodPrefix(text, 0);
  return r === null ? prev : r.value;
}

/**
 * The return value of `wxString::ToCDouble`: true only when the whole text,
 * after leading blanks, is one number (`"1.25 "` is false).
 */
export function ToCDoubleOk(text: string): boolean {
  const r = strtodPrefix(text, 0);
  return r !== null && r.end === text.length;
}

/**
 * `atoi( s )` / `wxAtoi( s )`: `strtol( s, nullptr, 10 )` narrowed to `int`.
 * Nothing readable reads 0.
 */
export function atoi(s: string): number {
  return strtol10(s, 0).value | 0;
}

/**
 * `wxString::ToLong( &val, 10 )`: true only when the whole text, after
 * leading blanks, is one integer; `val` is the prefix's value either way.
 */
export function ToLong(text: string): { ok: boolean; value: number } {
  const r = strtol10(text, 0);
  return { ok: r.end !== 0 && r.end === text.length, value: r.value };
}

/**
 * `wxString::ToULong( &val, 10 )`: as `ToLong`, but a leading minus fails
 * (`wxStringToIntType` rejects it for the unsigned types).
 */
export function ToULong(text: string): { ok: boolean; value: number } {
  if (text.trimStart().startsWith('-')) return { ok: false, value: 0 };

  return ToLong(text);
}
