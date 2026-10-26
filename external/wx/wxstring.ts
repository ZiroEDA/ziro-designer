// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The `wxString` comparisons KiCad's item classes sort and compare by.
 *
 * `wxString` on Linux holds UTF-32 (`wchar_t`), so `Cmp` and `operator<` order by code
 * point. A JS string compares UTF-16 code units, which disagrees with that for a
 * character above U+FFFF against one in U+E000..U+FFFF; these walk code points so the
 * two agree everywhere. Never `localeCompare`: it follows the browser's locale.
 */

/** `wxString::Cmp`: negative, zero or positive, by code point. */
export function wxCmp(a: string, b: string): number {
  if (a === b) return 0;

  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();

  for (;;) {
    const ca = ia.next();
    const cb = ib.next();

    if (ca.done) return cb.done ? 0 : -1;

    if (cb.done) return 1;

    const d = ca.value.codePointAt(0)! - cb.value.codePointAt(0)!;

    if (d !== 0) return d < 0 ? -1 : 1;
  }
}

/** `wxString::operator<`. */
export function wxLess(a: string, b: string): boolean {
  return wxCmp(a, b) < 0;
}

/** `wxString::CmpNoCase`: `wxTolower` on each character, then `Cmp`. */
export function wxCmpNoCase(a: string, b: string): number {
  return wxCmp(a.toLowerCase(), b.toLowerCase());
}

/**
 * `wxString::Matches( aPattern )`: the whole of \a aText against \a aPattern, where `*` is any
 * run of characters and `?` any one.
 */
export function wxMatches(aText: string, aPattern: string): boolean {
  const re = aPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[\\s\\S]*')
    .replace(/\?/g, '[\\s\\S]');

  return new RegExp(`^${re}$`, 'u').test(aText);
}

/**
 * `wxString::ToDouble( &val )`: `strtod` over the whole string. True only when
 * the scan reaches the end of a non-empty string and no over- or underflow
 * (ERANGE) occurred. Returns the value, or null for false. Leading blanks are
 * skipped, trailing ones are not; `inf`, `infinity` and `nan` convert, as C's
 * strtod converts them.
 */
export function wxStringToDouble(aText: string): number | null {
  const m =
    /^[ \t\n\v\f\r]*([+-]?)(?:(inf(?:inity)?|nan)|((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))$/i.exec(
      aText,
    );

  if (!m) return null;

  const sign = m[1] === '-' ? -1 : 1;

  if (m[2]) return /^nan$/i.test(m[2]) ? Number.NaN : sign * Infinity;

  const v = sign * Number(m[3]);

  if (!Number.isFinite(v)) return null; // overflow: ERANGE

  if (v === 0 && /[1-9]/.test(m[3]!.split(/[eE]/)[0]!)) return null; // underflow: ERANGE

  return v;
}
