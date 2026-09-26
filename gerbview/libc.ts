// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The C library the RS-274X and Excellon readers are written against: a
 * `FILE*` read with `fgets`, a `char*` cursor that the readers advance by
 * reference (`char*& aText`), and `strtol` / `strtod` / `strncasecmp`.
 *
 * Ours, no KiCad file: KiCad gets these from libc. They are spelled out so the
 * readers can be ported line for line — `aText++`, `*aText`, `aText = aBuff`
 * after an `fgets` — instead of being re-expressed as regexes, which is how the
 * reader this replaced came to disagree with GerbView on real files.
 *
 * Text is a JS string (the file decoded as UTF-8), so a "char" is a UTF-16
 * code unit. Gerber and Excellon are ASCII; X2 attribute values may carry
 * UTF-8, which KiCad reads as bytes and converts back with `From_UTF8` — the
 * same string either way.
 */

/** The NUL a C string ends with, which `*aText` reads at the end of a line. */
export const NUL = '\0';

/** `char aBuff[N]`: a line buffer that `fgets` overwrites in place. */
export class LINE_BUFFER {
  s = '';
}

/**
 * `char*` into a {@link LINE_BUFFER}. Every reader method that takes
 * `char*& aText` takes one of these and moves it; `aText = aBuff` is
 * {@link CHAR_PTR.reset}.
 */
export class CHAR_PTR {
  constructor(
    public buf: LINE_BUFFER,
    public i = 0,
  ) {}

  /** `*aText`: the char under the cursor, NUL past the end. */
  c(): string {
    return this.i < this.buf.s.length ? (this.buf.s[this.i] as string) : NUL;
  }

  /** `aText[n]`. */
  at(n: number): string {
    const k = this.i + n;
    return k >= 0 && k < this.buf.s.length ? (this.buf.s[k] as string) : NUL;
  }

  /** `*aText++`: the char, then advance. */
  next(): string {
    const ch = this.c();
    this.i++;
    return ch;
  }

  /** `aText++` / `aText += n`. */
  inc(n = 1): void {
    this.i += n;
  }

  /** `aText = aBuff`. */
  reset(buf: LINE_BUFFER): void {
    this.buf = buf;
    this.i = 0;
  }

  /** A copy, for a C function that takes `char*` by value. */
  clone(): CHAR_PTR {
    return new CHAR_PTR(this.buf, this.i);
  }

  /** The C string from the cursor to the NUL. */
  rest(): string {
    return this.buf.s.slice(this.i);
  }
}

/** A `FILE*` opened on text already in memory. */
export class FILE {
  private pos = 0;

  constructor(private readonly text: string) {}

  /**
   * `fgets( aBuff, aSize, file )`: at most `aSize - 1` chars, stopping after a
   * `'\n'`. `null` at end of file; otherwise the buffer holds the line and it
   * is returned.
   */
  fgets(aBuff: LINE_BUFFER, aSize: number): LINE_BUFFER | null {
    if (this.pos >= this.text.length) return null;
    const max = Math.max(aSize - 1, 0);
    const nl = this.text.indexOf('\n', this.pos);
    let end = nl === -1 ? this.text.length : nl + 1;
    if (end - this.pos > max) end = this.pos + max;
    aBuff.s = this.text.slice(this.pos, end);
    this.pos = end;
    return aBuff;
  }
}

const WHITESPACE = ' \t\n\r\f\v';

/** `isspace()` in the C locale. */
export const isspace = (ch: string): boolean => ch !== NUL && WHITESPACE.includes(ch);

/** `isdigit()`. */
export const isdigit = (ch: string): boolean => ch >= '0' && ch <= '9' && ch.length === 1;

/**
 * `StrPurge( char* )` (`common/string_utils.cpp:784-800`): skips leading
 * whitespace and writes NULs over the trailing whitespace, in place. Returns the
 * cursor at the first kept char.
 *
 * Belongs in `common/string_utils.ts`; see STRUCTURE.md.
 */
export function StrPurge(aText: CHAR_PTR): CHAR_PTR {
  const p = aText.clone();
  while (p.c() !== NUL && WHITESPACE.includes(p.c())) p.inc();
  const s = p.buf.s;
  let end = s.length;
  while (end > p.i && WHITESPACE.includes(s[end - 1] as string)) end--;
  p.buf.s = s.slice(0, end);
  return p;
}

/** `strncasecmp( aText, aWhat, n )` === 0. */
export function strncasecmp0(aText: CHAR_PTR, aWhat: string, n: number): boolean {
  return aText.buf.s.slice(aText.i, aText.i + n).toLowerCase() === aWhat.slice(0, n).toLowerCase();
}

/** `strncmp( aText, aWhat, n )` === 0. */
export function strncmp0(aText: CHAR_PTR, aWhat: string, n: number): boolean {
  return aText.buf.s.slice(aText.i, aText.i + n) === aWhat.slice(0, n);
}

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
