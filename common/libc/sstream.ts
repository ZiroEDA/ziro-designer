// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `std::istringstream` as libstdc++ reads one, for the importers that parse
 * a line with `>>`: the stream is a byte string (one JS character per byte),
 * and the extractions, their failures and the state bits behave as the C++
 * does, because the importers branch on them.
 *
 *  - `>> std::string`: the sentry skips white space (`isspace`, "C" locale);
 *    at the end it sets fail and eof and leaves the string unchanged; else the
 *    token up to the next white space (eof set when the token ends the input).
 *  - `>> double` / `>> int` / `>> long`: the same sentry, then `num_get`: the
 *    characters that fit the number's pattern are consumed, and a text that
 *    does not convert — "-", "1e", "." — gives 0 with fail set; an out-of-
 *    range integer gives the type's limit with fail set.
 *  - An extraction on a stream that is not `good()` fails without consuming.
 *
 * `read*` return the new value to store, which is the current one when the
 * sentry failed (the C++ leaves the variable untouched then).
 */

const isspace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r';

const isdigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

export class ISTRINGSTREAM {
  private m_pos = 0;
  private m_fail = false;
  private m_eof = false;

  constructor(private readonly m_str: string) {}

  /** `good()`. */
  good(): boolean {
    return !this.m_fail && !this.m_eof;
  }

  /** `fail()` (and `!operator bool`). */
  fail(): boolean {
    return this.m_fail;
  }

  eof(): boolean {
    return this.m_eof;
  }

  /** `clear()`. */
  clear(): void {
    this.m_fail = false;
    this.m_eof = false;
  }

  /** `tellg()`: -1 once failed. */
  tellg(): number {
    return this.m_fail ? -1 : this.m_pos;
  }

  /** `seekg( pos )`: clears eof (C++11), fails on a failed stream. */
  seekg(aPos: number): void {
    if (this.m_fail) return;

    this.m_eof = false;
    this.m_pos = aPos;
  }

  /** The formatted-input sentry: white space skipped; false (and fail) at the end. */
  private sentry(): boolean {
    if (!this.good()) {
      this.m_fail = true;
      return false;
    }

    while (this.m_pos < this.m_str.length && isspace(this.m_str[this.m_pos])) this.m_pos++;

    if (this.m_pos >= this.m_str.length) {
      this.m_eof = true;
      this.m_fail = true;
      return false;
    }

    return true;
  }

  /** `>> std::string`. */
  readString(aCur = ''): string {
    if (!this.sentry()) return aCur;

    const start = this.m_pos;

    while (this.m_pos < this.m_str.length && !isspace(this.m_str[this.m_pos])) this.m_pos++;

    if (this.m_pos >= this.m_str.length) this.m_eof = true;

    return this.m_str.substring(start, this.m_pos);
  }

  /** `>> std::string` as `if( iss >> s )`: the token, or null when it failed. */
  str(): string | null {
    const v = this.readString();
    return this.m_fail ? null : v;
  }

  /** `>> double`. */
  readDouble(aCur = 0): number {
    if (!this.sentry()) return aCur;

    const s = this.m_str;
    let i = this.m_pos;
    let acc = '';

    if (s[i] === '+' || s[i] === '-') acc += s[i++];

    let mantissa = false;

    while (isdigit(s[i])) {
      acc += s[i++];
      mantissa = true;
    }

    if (s[i] === '.') {
      acc += s[i++];

      while (isdigit(s[i])) {
        acc += s[i++];
        mantissa = true;
      }
    }

    if (mantissa && (s[i] === 'e' || s[i] === 'E')) {
      acc += s[i++];

      if (s[i] === '+' || s[i] === '-') acc += s[i++];

      while (isdigit(s[i])) acc += s[i++];
    }

    this.m_pos = i;

    if (i >= s.length) this.m_eof = true;

    // __convert_to_v: strtod must consume the whole accumulated text
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(acc)) {
      this.m_fail = true;
      return 0;
    }

    const v = Number(acc);

    if (!Number.isFinite(v)) {
      this.m_fail = true;
      return v > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
    }

    return v;
  }

  /** `>> double` as `if( iss >> d )`: the value, or null when it failed. */
  dbl(): number | null {
    const v = this.readDouble();
    return this.m_fail ? null : v;
  }

  /** `>> long` (64-bit here, as on LP64). */
  readLong(aCur = 0): number {
    const r = this.readInteger();

    if (r === null) return aCur;

    return this.clamp(r, -(2 ** 63), 2 ** 63 - 1);
  }

  /** `>> int`: extracted as a long, then held to the int range. */
  readInt(aCur = 0): number {
    const r = this.readInteger();

    if (r === null) return aCur;

    return this.clamp(r, -2147483648, 2147483647);
  }

  /** `>> int` as `if( iss >> i )`: the value, or null when it failed. */
  int(): number | null {
    const v = this.readInt();
    return this.m_fail ? null : v;
  }

  /** An out-of-range integer: the limit, with fail set. */
  private clamp(v: number, aMin: number, aMax: number): number {
    if (v < aMin) {
      this.m_fail = true;
      return aMin;
    }

    if (v > aMax) {
      this.m_fail = true;
      return aMax;
    }

    return v;
  }

  /** num_get's decimal integer: null when the sentry failed, 0 with fail when no digits. */
  private readInteger(): number | null {
    if (!this.sentry()) return null;

    const s = this.m_str;
    let i = this.m_pos;
    let neg = false;

    if (s[i] === '+' || s[i] === '-') {
      neg = s[i] === '-';
      i++;
    }

    const start = i;
    let v = 0n;

    while (isdigit(s[i])) v = v * 10n + BigInt(s.charCodeAt(i++) - 48);

    this.m_pos = i;

    if (i >= s.length) this.m_eof = true;

    if (i === start) {
      this.m_fail = true;
      return 0;
    }

    return Number(neg ? -v : v);
  }

  /** `std::ws`: white space skipped; eof (not fail) at the end. */
  ws(): this {
    if (!this.good()) {
      this.m_fail = true;
      return this;
    }

    while (this.m_pos < this.m_str.length && isspace(this.m_str[this.m_pos])) this.m_pos++;

    if (this.m_pos >= this.m_str.length) this.m_eof = true;

    return this;
  }

  /**
   * `std::getline( iss, s )`: the rest up to a '\n' (consumed, not stored);
   * fail (and `aCur` kept) when the stream is not good, fail and eof when
   * nothing is left.
   */
  getline(aCur = ''): string {
    if (!this.good()) {
      this.m_fail = true;
      return aCur;
    }

    const s = this.m_str;

    if (this.m_pos >= s.length) {
      this.m_eof = true;
      this.m_fail = true;
      return '';
    }

    const end = s.indexOf('\n', this.m_pos);

    if (end < 0) {
      const out = s.substring(this.m_pos);
      this.m_pos = s.length;
      this.m_eof = true;
      return out;
    }

    const out = s.substring(this.m_pos, end);
    this.m_pos = end + 1;

    return out;
  }
}
