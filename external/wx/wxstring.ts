// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The `wxString` comparisons KiCad's item classes sort and compare by, and
 * `wxString::Format`.
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

/** One argument of {@link wxFormat}: what a `wxString::Format` vararg can be here. */
export type wxFormatArg = string | number | bigint | boolean;

const FORMAT_SPEC =
  /%(?:(\d+)\$)?([-+ #0']*)(\*(?:\d+\$)?|\d+)?(?:\.(\*(?:\d+\$)?|\d*))?(hh|h|ll|l|L|q|j|z|t)?([diouxXeEfFgGaAcsSp%])/g;

/**
 * `wxString::Format( fmt, ... )`: C's printf over the arguments - glibc's
 * `vswprintf`, which wx calls on Linux - including the positional `%1$s` form a
 * translator uses to reorder a message (zh_CN does, in 93 of them). A
 * translated format and the English one name the same arguments, so
 * `wxFormat( _( "Pin %s of %s" ), a, b )` is right in every language, where a
 * template literal is right in English only.
 *
 * Supported: `d i u o x X e E f F g G c s S p %`, flags `- + space # 0`, width,
 * precision, `*`, and the length modifiers (ignored: a JS number is a double).
 * A missing argument prints nothing, where C would read garbage.
 */
export function wxFormat(aFormat: string, ...aArgs: readonly wxFormatArg[]): string {
  let next = 0;
  const take = (aPos: string | undefined): wxFormatArg | undefined =>
    aPos !== undefined ? aArgs[Number(aPos) - 1] : aArgs[next++];
  const starOrNum = (s: string | undefined): number | undefined => {
    if (s === undefined || s === '') return s === '' ? 0 : undefined;
    if (s[0] !== '*') return Number(s);
    const m = /^\*(\d+)\$$/.exec(s);
    return Number(take(m ? m[1] : undefined) ?? 0);
  };

  return aFormat.replace(FORMAT_SPEC, (_m, pos, flags: string, w, p, _len, conv: string) => {
    if (conv === '%') return '%';
    let width = starOrNum(w);
    const precision = starOrNum(p);
    let left = flags.includes('-');
    if (width !== undefined && width < 0) {
      left = true;
      width = -width;
    }
    const arg = take(pos);
    let body: string;
    let sign = '';
    const num = (): number => (typeof arg === 'number' ? arg : Number(arg ?? 0));

    switch (conv) {
      case 's':
      case 'S':
        body = arg === undefined ? '' : String(arg);
        if (precision !== undefined) body = [...body].slice(0, precision).join('');
        break;
      case 'c':
        body = typeof arg === 'number' ? String.fromCodePoint(arg) : String(arg ?? '').slice(0, 1);
        break;
      case 'd':
      case 'i':
      case 'u': {
        const v = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(num()));
        sign = v < 0n ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        body = (v < 0n ? -v : v).toString();
        if (precision !== undefined) body = body.padStart(precision, '0');
        break;
      }
      case 'o':
      case 'x':
      case 'X': {
        const v = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(num()));
        body = (v < 0n ? -v : v).toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (precision !== undefined) body = body.padStart(precision, '0');
        if (flags.includes('#') && v !== 0n)
          body = (conv === 'o' ? '0' : conv === 'x' ? '0x' : '0X') + body;
        break;
      }
      case 'p':
        body = `0x${Math.trunc(num()).toString(16)}`;
        break;
      default: {
        const v = num();
        sign =
          v < 0 || Object.is(v, -0)
            ? '-'
            : flags.includes('+')
              ? '+'
              : flags.includes(' ')
                ? ' '
                : '';
        const a = Math.abs(v);
        const prec = precision ?? 6;
        if (!Number.isFinite(a)) body = Number.isNaN(a) ? 'nan' : 'inf';
        else if (conv === 'f' || conv === 'F') body = cFixed(a, prec);
        else if (conv === 'e' || conv === 'E') body = cExp(cExponential(a, prec));
        else if (conv === 'g' || conv === 'G')
          body = cG(a, prec === 0 ? 1 : prec, flags.includes('#'));
        else body = a.toString(16);
        if (conv === 'E' || conv === 'G' || conv === 'F') body = body.toUpperCase();
      }
    }

    const len = [...body].length + sign.length;
    if (width === undefined || len >= width) return sign + body;
    const pad = width - len;
    if (left) return sign + body + ' '.repeat(pad);
    if (
      flags.includes('0') &&
      !'sScp'.includes(conv) &&
      !(precision !== undefined && 'diouxX'.includes(conv))
    )
      return sign + '0'.repeat(pad) + body;
    return ' '.repeat(pad) + sign + body;
  });
}

/**
 * `%.Nf` of a non-negative double, as glibc prints it. `toFixed` is exact except in two
 * places: it rounds an exact tie up where C rounds it to even (`%.0f` of 2.5 is "2"), and it
 * switches to exponent form from 1e21, where every double is an integer anyway.
 */
function cFixed(aValue: number, aDigits: number): string {
  if (aValue >= 1e21)
    return BigInt(aValue).toString() + (aDigits > 0 ? `.${'0'.repeat(aDigits)}` : '');
  const up = aValue.toFixed(aDigits);
  const exact = aValue.toFixed(Math.min(100, aDigits + 60));
  const tail = exact.slice(exact.length - (Math.min(100, aDigits + 60) - aDigits));
  if (!/^50*$/.test(tail)) return up;
  // An exact tie: the digits kept so far, unless that last digit is odd.
  const down = exact.slice(0, exact.length - tail.length - (aDigits === 0 ? 1 : 0));
  return Number(down[down.length - 1]) % 2 === 0 ? down : up;
}

/** `%.Ne`, the same way: ties to even on the mantissa's last digit. */
function cExponential(aValue: number, aDigits: number): string {
  const up = aValue.toExponential(aDigits);
  const more = Math.min(100, aDigits + 40);
  const exact = aValue.toExponential(more);
  const [mant, exp] = exact.split('e') as [string, string];
  const tail = mant.slice(mant.length - (more - aDigits));
  if (!/^50*$/.test(tail) || exp !== up.split('e')[1]) return up;
  const kept = mant.slice(0, mant.length - tail.length - (aDigits === 0 ? 1 : 0));
  return Number(kept[kept.length - 1]) % 2 === 0 ? `${kept}e${exp}` : up;
}

/** JS writes `1.5e+3`; C writes `1.5e+03`. */
function cExp(aJs: string): string {
  return aJs.replace(/e([+-])(\d)$/, 'e$10$2');
}

/** C's `%g`: `%e` or `%f` by the exponent after rounding, trailing zeros trimmed unless `#`. */
function cG(aValue: number, aPrecision: number, aKeepZeros: boolean): string {
  if (aValue === 0) return aKeepZeros ? (0).toFixed(aPrecision - 1) : '0';
  const exp = Number(cExponential(aValue, aPrecision - 1).split('e')[1]);
  let out =
    exp < -4 || exp >= aPrecision
      ? cExp(cExponential(aValue, aPrecision - 1))
      : cFixed(aValue, Math.max(0, aPrecision - 1 - exp));
  if (!aKeepZeros)
    out = out.replace(/\.(\d*?)0+(e|$)/, (_m, d: string, e: string) => (d ? `.${d}${e}` : e));
  return out;
}
