// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PIN_NUMBERS` (common/pin_numbers.cpp). A pin number is not a number and not
 * a string: it is a run of alternating symbol groups, and comparing two of them
 * digit-group by digit-group is what puts "2" before "10" and "A1" before "A2".
 *
 * It lives in `common/` here because it lives in `common/` upstream — the pin
 * table's sort, the pin-summary in a netlist and the duplicate-pin ERC check
 * all ask this one function rather than each rolling a natural sort.
 */

/**
 * `PIN_NUMBERS::getNextSymbol` (common/pin_numbers.cpp:30-67).
 *
 * Reads one group from `str` starting at `cursor`, advancing it. A group is
 * either a number — optionally signed, and allowing `.` and `v`/`V` inside it
 * so that "3V3" is one numeric group — or the run of non-digits before the next
 * digit.
 */
function getNextSymbol(str: string, cursor: { at: number }): string {
  if (str.length <= cursor.at) return '';

  const begin = cursor.at;
  let c = str[cursor.at] as string;

  const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';

  if (
    isDigit(c) ||
    ((c === '+' || c === '-') && cursor.at < str.length - 1 && isDigit(str[cursor.at + 1]))
  ) {
    // number, possibly with sign
    while (++cursor.at < str.length) {
      c = str[cursor.at] as string;
      if (isDigit(c) || c === 'v' || c === 'V' || c === '.') continue;
      break;
    }
  } else {
    while (++cursor.at < str.length) {
      c = str[cursor.at] as string;
      if (isDigit(c)) break;
    }
  }

  return str.slice(begin, cursor.at);
}

/**
 * `PIN_NUMBERS::Compare` (common/pin_numbers.cpp:135-211).
 *
 * The magnitudes matter as well as the sign: `±1` means "adjacent", which is
 * what `GetSummary` uses to collapse a run of pins into "1-8", and `±2` means
 * "apart". A caller that only wants an ordering can treat it as any comparator.
 */
export function pinNumbersCompare(lhs: string, rhs: string): number {
  const cursor1 = { at: 0 };
  const cursor2 = { at: 0 };

  for (;;) {
    let symbol1 = getNextSymbol(lhs, cursor1);
    let symbol2 = getNextSymbol(rhs, cursor2);

    if (symbol1 === '' && symbol2 === '') return 0;
    if (symbol1 === '') return -2;
    if (symbol2 === '') return 2;

    const sym1IsNumeric = /[0-9]/.test(symbol1);
    const sym2IsNumeric = /[0-9]/.test(symbol2);

    if (sym1IsNumeric) {
      if (sym2IsNumeric) {
        // numeric comparison; a "v"/"V" inside the group is a decimal point,
        // which is what makes 3V3 sort as 3.3.
        symbol1 = symbol1.replace(/[vV]/, '.');
        symbol2 = symbol2.replace(/[vV]/, '.');

        // `wxString::ToCDouble` leaves the out-param untouched on failure, and
        // the caller here starts it uninitialised; a group always begins with a
        // digit or a sign, so parseFloat only fails on a lone sign, and 0 is
        // what glibc's strtod would have left.
        const val1 = Number.parseFloat(symbol1);
        const val2 = Number.parseFloat(symbol2);
        const v1 = Number.isFinite(val1) ? val1 : 0;
        const v2 = Number.isFinite(val2) ? val2 : 0;

        if (v1 < v2) return v1 === v2 - 1 ? -1 : -2;
        if (v1 > v2) return v1 === v2 + 1 ? 1 : 2;
      } else {
        return -2;
      }
    } else {
      if (sym2IsNumeric) return 2;

      // `wxString::Cmp` is a byte-wise compare, not a locale collation.
      const res = symbol1 < symbol2 ? -1 : symbol1 > symbol2 ? 1 : 0;
      if (res !== 0) return res;
    }
  }
}
