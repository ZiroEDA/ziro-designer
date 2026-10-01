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

/**
 * `PIN_NUMBERS` (common/pin_numbers.h): the set of pin numbers, ordered by
 * {@link pinNumbersCompare}, that collapses to a summary like `1-8,10` and
 * remembers which numbers were inserted more than once.
 *
 * Two numbers are the same element of the set when neither is less than the
 * other (`std::set<wxString, less>`), so a duplicate is `v` when an equivalent
 * element is already there.
 */
export class PIN_NUMBERS {
  private pins: string[] = [];
  private duplicate_pins: string[] = [];

  /** `PIN_NUMBERS::less`. */
  private static less(lhs: string, rhs: string): boolean {
    return pinNumbersCompare(lhs, rhs) < 0;
  }

  static Compare(lhs: string, rhs: string): number {
    return pinNumbersCompare(lhs, rhs);
  }

  /**
   * `insert( v )`: a number the set already holds goes into the duplicates
   * (a `std::set<wxString>`, in `wxString` order) instead.
   */
  insert(v: string): void {
    let lo = 0;
    let hi = this.pins.length;

    // std::set::insert: the first element that is not less than v
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (PIN_NUMBERS.less(this.pins[mid] as string, v)) lo = mid + 1;
      else hi = mid;
    }

    if (lo < this.pins.length && !PIN_NUMBERS.less(v, this.pins[lo] as string)) {
      // Not inserted: the pin number is a duplicate so add it to the duplicate set.
      if (!this.duplicate_pins.includes(v)) {
        this.duplicate_pins.push(v);
        this.duplicate_pins.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      }

      return;
    }

    this.pins.splice(lo, 0, v);
  }

  size(): number {
    return this.pins.length;
  }

  [Symbol.iterator](): IterableIterator<string> {
    return this.pins[Symbol.iterator]();
  }

  /** `GetSummary()`: runs of adjacent numbers as `first-last`, joined with commas. */
  GetSummary(): string {
    let ret = '';

    if (this.pins.length === 0) return ret;

    let i = 0;
    let begin_of_range = i;
    let last: number;

    for (;;) {
      last = i;
      ++i;

      const rc =
        i !== this.pins.length
          ? PIN_NUMBERS.Compare(this.pins[last] as string, this.pins[i] as string)
          : -2;

      console.assert(rc === -1 || rc === -2);

      // adjacent elements
      if (rc === -1) continue;

      ret += this.pins[begin_of_range];

      if (begin_of_range !== last) {
        ret += '-';
        ret += this.pins[last];
      }

      if (i === this.pins.length) break;

      begin_of_range = i;
      ret += ',';
    }

    return ret;
  }

  /** `GetDuplicates()`: the numbers inserted more than once, or "none". */
  GetDuplicates(): string {
    let ret = '';

    for (const pinNumber of this.duplicate_pins) {
      ret += pinNumber;
      ret += ',';
    }

    // Remove the trailing comma
    ret = ret.slice(0, -1);

    if (ret === '') ret = 'none';

    return ret;
  }
}
