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
