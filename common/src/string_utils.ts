// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * String helpers shared across the editors. Counterpart:
 * `common/string_utils.cpp`, the natural-order comparison every reference
 * designator list is sorted with, and the stacked-pin notation, which lets one
 * schematic pin stand for several footprint pads: `[1,2]`, `[A1-A4]`,
 * `[1,3-5,7]`. A backslash escapes a structural character (`[ ] , -`) so it can
 * appear inside a pin number.
 */

/**
 * EscapeString( …, CTX_NETNAME ), make a string safe to use as (part of) a net
 * name. `/` is the hierarchy separator in a net name, so it becomes `{slash}`;
 * newlines are dropped. This is what turns a label "SDA/A4" into the net name
 * "SDA{slash}A4", and it is applied to each sheet name of a net's path too.
 */
export function escapeNetName(source: string): string {
  let out = '';
  for (const c of source) {
    if (c === '/') out += '{slash}';
    else if (c === '\n' || c === '\r') continue;
    else out += c;
  }
  return out;
}

/**
 * StrNumCmp, natural order: digit runs compare by value, so R2 sorts before
 * R10. `aIgnoreCase` defaults to false, as upstream.
 */
export function strNumCmp(a: string, b: string, ignoreCase = false): number {
  const fold = (s: string): string => (ignoreCase ? s.toUpperCase() : s);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a[i]!;
    const cb = b[j]!;
    if (ca >= '0' && ca <= '9' && cb >= '0' && cb <= '9') {
      let ei = i;
      while (ei < a.length && a[ei]! >= '0' && a[ei]! <= '9') ei++;
      let ej = j;
      while (ej < b.length && b[ej]! >= '0' && b[ej]! <= '9') ej++;
      const na = Number(a.slice(i, ei));
      const nb = Number(b.slice(j, ej));
      if (na !== nb) return na < nb ? -1 : 1;
      i = ei;
      j = ej;
      continue;
    }
    const fa = fold(ca);
    const fb = fold(cb);
    if (fa !== fb) return fa < fb ? -1 : 1;
    i++;
    j++;
  }
  return a.length - i - (b.length - j);
}

/**
 * EscapeString( …, CTX_IPC ), make a string safe to put in a cross-probe packet.
 * The packet joins its parts with commas and splits a path on slashes, and a
 * quote would end a quoted field early — so those three, and only those three,
 * are escaped. `{` is left alone here, unlike the file contexts.
 */
export function escapeIpc(source: string): string {
  let out = '';
  for (const c of source) {
    if (c === '/') out += '{slash}';
    else if (c === ',') out += '{comma}';
    else if (c === '"') out += '{dblquote}';
    else out += c;
  }
  return out;
}

/** UnescapeString's `{token}` -> character table. */
const UNESCAPE_TOKENS: Record<string, string> = {
  dblquote: '"',
  quote: "'",
  lt: '<',
  gt: '>',
  backslash: '\\',
  slash: '/',
  bar: '|',
  comma: ',',
  colon: ':',
  space: ' ',
  dollar: '$',
  tab: '\t',
  return: '\n',
  brace: '{',
};

/**
 * UnescapeString, turn the `{slash}`-style escapes KiCad writes into a file back
 * into the characters they stand for. A `{…}` group preceded by `$`, `~`, `^` or `_`
 * is markup (a variable reference, an overbar, a superscript, a subscript) and is
 * kept, with its contents unescaped; so is an unknown or unterminated token.
 */
export function unescapeString(source: string): string {
  // The smallest escape string is three characters; shortcut everything else.
  if (source.length <= 2) return source;

  let out = '';
  let prev = '';
  let ch = '';

  for (let i = 0; i < source.length; ++i) {
    prev = ch;
    ch = source[i]!;

    if (ch !== '{') {
      out += ch;
      continue;
    }

    let token = '';
    let depth = 1;
    let terminated = false;

    for (i = i + 1; i < source.length; ++i) {
      ch = source[i]!;
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth <= 0) {
        terminated = true;
        break;
      }
      token += ch;
    }

    if (!terminated) out += `{${unescapeString(token)}`;
    else if (prev === '$' || prev === '~' || prev === '^' || prev === '_')
      out += `{${unescapeString(token)}}`;
    else if (token in UNESCAPE_TOKENS) out += UNESCAPE_TOKENS[token];
    else out += `{${unescapeString(token)}}`;
  }

  return out;
}

/** The characters stacked-pin notation gives meaning to. */
const SPECIAL = new Set(['[', ']', ',', '-', '\\']);

const isEscapeAt = (text: string, i: number): boolean =>
  text[i] === '\\' && i + 1 < text.length && SPECIAL.has(text[i + 1]!);

/** EscapeStackedPinItem: make a pin number safe to place inside `[…]`. */
export function escapeStackedPinItem(pinNumber: string): string {
  let out = '';
  for (const ch of pinNumber) {
    if (SPECIAL.has(ch)) out += '\\';
    out += ch;
  }
  return out;
}

/** SplitStackedPinItems: split on unescaped commas. */
function splitStackedPinItems(inner: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    if (isEscapeAt(inner, i)) {
      current += inner[i]! + inner[i + 1]!;
      i++;
    } else if (inner[i] === ',') {
      parts.push(current);
      current = '';
    } else {
      current += inner[i];
    }
  }
  parts.push(current);
  return parts;
}

/** FindUnescaped: the first unescaped occurrence of a character, or -1. */
function findUnescaped(text: string, ch: string): number {
  for (let i = 0; i < text.length; i++) {
    if (isEscapeAt(text, i)) i++;
    else if (text[i] === ch) return i;
  }
  return -1;
}

/** UnescapeStackedPinItem: drop the backslashes a structural character needed. */
function unescapeStackedPinItem(item: string): string {
  let out = '';
  for (let i = 0; i < item.length; i++) {
    if (isEscapeAt(item, i)) out += item[++i];
    else out += item[i];
  }
  return out;
}

/** ParseAlphaNumericPin: split "A12" into ["A", 12]; -1 when there is no number. */
function parseAlphaNumericPin(pinNum: string): [string, number] {
  let numStart = pinNum.length;
  for (let i = pinNum.length - 1; i >= 0; i--) {
    if (!/[0-9]/.test(pinNum[i]!)) {
      numStart = i + 1;
      break;
    }
    if (i === 0) numStart = 0; // all digits
  }
  if (numStart < pinNum.length) {
    const prefix = pinNum.slice(0, numStart);
    const value = Number.parseInt(pinNum.slice(numStart), 10);
    return [prefix, Number.isNaN(value) ? -1 : value];
  }
  return ['', -1];
}

/**
 * ExpandStackedPinNotation: the pad numbers a pin stands for. `valid` reports
 * whether the notation parsed, mismatched brackets, a reversed or
 * non-numeric range, or an empty list make it false, and the pin name comes
 * back unexpanded.
 */
export function expandStackedPinNotation(pinName: string): {
  numbers: string[];
  valid: boolean;
} {
  const hasOpen = pinName.includes('[');
  const hasClose = pinName.includes(']');

  if (hasOpen || hasClose) {
    if (!pinName.startsWith('[') || !pinName.endsWith(']')) {
      return { numbers: [pinName], valid: false };
    }
  }
  if (!pinName.startsWith('[') || !pinName.endsWith(']')) {
    return { numbers: [pinName], valid: true };
  }

  const inner = pinName.slice(1, -1);
  const expanded: string[] = [];

  for (const raw of splitStackedPinItems(inner)) {
    const part = raw.trim();
    if (part === '') continue;

    // A range (A1-A4) is only a range on an *unescaped* dash.
    const dash = findUnescaped(part, '-');
    if (dash !== -1) {
      const startTxt = unescapeStackedPinItem(part.slice(0, dash)).trim();
      const endTxt = unescapeStackedPinItem(part.slice(dash + 1)).trim();
      const [startPrefix, startVal] = parseAlphaNumericPin(startTxt);
      const [endPrefix, endVal] = parseAlphaNumericPin(endTxt);

      if (startPrefix !== endPrefix || startVal === -1 || endVal === -1 || startVal > endVal) {
        return { numbers: [pinName], valid: false };
      }
      for (let i = startVal; i <= endVal; i++) expanded.push(`${startPrefix}${i}`);
    } else {
      expanded.push(unescapeStackedPinItem(part));
    }
  }

  if (expanded.length === 0) return { numbers: [pinName], valid: false };
  return { numbers: expanded, valid: true };
}

/** CountStackedPinNotation: how many pads a pin number stands for. */
export function countStackedPinNotation(pinName: string): { count: number; valid: boolean } {
  if (pinName.length === 0) return { count: 1, valid: true };
  const { numbers, valid } = expandStackedPinNotation(pinName);
  return { count: numbers.length, valid };
}

/**
 * ConvertToNewOverbarNotation (`common/string_utils.cpp:88-156`): rewrite the
 * pre-2021 overbar spelling, where a bare `~` toggled an overbar on and off
 * (and a space, `}` or `)` also ended one), into the current `~{…}` form.
 *
 * Every reader of a file older than its format's cut-over runs its text
 * through this; without it a legacy `~RESET` keeps its tilde as a literal
 * character and draws with no bar at all.
 *
 * The details that a paraphrase loses, all from the C++:
 *  - the lone `~` is the legacy empty-string token and is returned untouched;
 *  - `~~` is an escaped tilde, but `~~{` becomes `~~{}` so that the `{` which
 *    follows cannot open an overbar;
 *  - `~{` means the string has already been converted, so the WHOLE string is
 *    returned unchanged rather than converted twice;
 *  - an overbar left open at the end of the string is closed explicitly.
 */
export function convertToNewOverbarNotation(oldStr: string): string {
  // Don't get tripped up by the legacy empty-string token.
  if (oldStr === '~') return oldStr;

  let newStr = '';
  let inOverbar = false;

  for (let i = 0; i < oldStr.length; i++) {
    const ch = oldStr[i]!;

    if (ch === '~') {
      const next = oldStr[i + 1];

      if (next === '~') {
        if (oldStr[i + 2] === '{') {
          // This way the subsequent opening curly brace will not start an
          // overbar.
          newStr += '~~{}';
          continue;
        }
        // Two subsequent tildes mean a tilde.
        newStr += '~';
        i++;
        continue;
      }

      if (next === '{') {
        // Could mean the user wants "{" with an overbar, but more likely this
        // is a case of double notation conversion. Bail out.
        return oldStr;
      }

      if (inOverbar) {
        newStr += '}';
        inOverbar = false;
      } else {
        newStr += '~{';
        inOverbar = true;
      }
      continue;
    }

    if ((ch === ' ' || ch === '}' || ch === ')') && inOverbar) {
      // Spaces were used to terminate overbar as well.
      newStr += '}';
      inOverbar = false;
    }

    newStr += ch;
  }

  // Explicitly end the overbar even if there was no terminating '~'.
  if (inOverbar) newStr += '}';

  return newStr;
}

// ---------------------------------------------------------------------------
// Wildcard matching (`common/string_utils.cpp:910`).

/**
 * WildCompareString: match `stringToTst` against a `*` / `?` `pattern`, whole
 * string. `*` stands for any run of characters including an empty one, `?` for
 * exactly one; every other character, `.` `+` `^` `$` `(` `)` `[` `]` `|` `\`
 * included, is literal.
 *
 * This is the pointer walk upstream uses rather than a translation to a regular
 * expression, which is the point: with no regex there is no escape set to get
 * wrong, so a net named `Net.Cu` can never be matched by the pattern `NetXCu`.
 *
 * `caseSensitive` defaults to true exactly as the header does
 * (`include/string_utils.h:233`), but **every call site in KiCad passes
 * `false`** — the filters in Edit Text and Graphics, Change Symbols, Exchange
 * Footprints, the net navigator and the DRC expression evaluator are all
 * case-insensitive to the user. Pass the argument explicitly, the way the C++
 * does, rather than leaning on the default.
 */
export function wildCompareString(
  pattern: string,
  stringToTst: string,
  caseSensitive = true,
): boolean {
  const wild = caseSensitive ? pattern : pattern.toUpperCase();
  const str = caseSensitive ? stringToTst : stringToTst.toUpperCase();

  // Indices, where upstream has pointers: past the end reads as undefined,
  // which stands in for the terminating NUL and equals no character.
  let w = 0;
  let s = 0;
  let mp = 0;
  let cp = 0;

  while (s < str.length && wild[w] !== '*') {
    if (wild[w] !== str[s] && wild[w] !== '?') return false;
    w++;
    s++;
  }

  while (s < str.length) {
    if (wild[w] === '*') {
      w++;
      // A trailing `*` swallows the rest of the string.
      if (w >= wild.length) return true;
      // Remember where to resume if this `*` turns out to be too greedy.
      mp = w;
      cp = s + 1;
    } else if (wild[w] === str[s] || wild[w] === '?') {
      w++;
      s++;
    } else {
      w = mp;
      s = cp++;
    }
  }

  // Trailing `*`s may still match the empty remainder.
  while (wild[w] === '*') w++;

  return w >= wild.length;
}

// ---------------------------------------------------------------------------
// Numeric-aware helpers (`common/string_utils.cpp`).

/**
 * GetTrailingInt (`common/string_utils.cpp:1299`): the number a string ends
 * with, 0 when it ends in anything else. No sign and no decimal point, so
 * `"12Foo4.2"` is 2 and `"foo"` is 0.
 */
export function getTrailingInt(str: string): number {
  let number = 0;
  let base = 1;

  for (let i = str.length - 1; i >= 0; i--) {
    const ch = str[i]!;
    if (ch < '0' || ch > '9') break;
    number += (ch.charCodeAt(0) - 48) * base;
    base *= 10;
  }

  return number;
}

/**
 * NUMERIC_EVALUATOR::IsOldSchoolDecimalSeparator
 * (`common/libeval/numeric_evaluator.cpp:196`): the characters that may be
 * written *in place of* a decimal point, `4k7` for 4.7 k. Both micro signs are
 * listed because they look alike and are U+00B5 and U+03BC.
 */
const OLD_SCHOOL_DECIMAL_SEPARATORS = new Set([
  'p',
  'n',
  'µ',
  'μ',
  'u',
  'm',
  'L',
  'R',
  'F',
  'k',
  'K',
  'M',
  'G',
  'T',
]);

/**
 * convertSeparators (`common/string_utils.cpp:1090`): rewrite a number into the
 * C locale, working out from the value itself which of `.` and `,` is the
 * decimal point and which groups thousands.
 *
 * Upstream's reasoning, which is why this is not just "strip the commas":
 * fetching the separator from the current locale is no silver bullet, because
 * it assumes the schematic was authored on this computer. Most values say what
 * they are — several instances of one character must be thousands separators,
 * one of each must be thousands then decimal, a separator followed by other
 * than three digits must be a decimal — and only a genuinely ambiguous value
 * falls back on the locale.
 *
 * Returns the converted string, or `undefined` when the value contradicts
 * itself (a decimal before a thousands, two decimals, a thousands group that is
 * not three digits). Upstream returns false there and leaves the string
 * untouched, and its one caller ignores the result, so the caller here keeps
 * the original text on `undefined` in the same way.
 */
export function convertSeparators(value: string): string | undefined {
  let text = value.split(' ').join('');

  let ambiguousSeparator = '?';
  let thousandsSeparator = '?';
  let thousandsSeparatorFound = false;
  let decimalSeparator = '?';
  let decimalSeparatorFound = false;
  let digits = 0;

  for (let ii = text.length - 1; ii >= 0; --ii) {
    const c = text[ii]!;

    if (c >= '0' && c <= '9') {
      digits += 1;
      continue;
    }

    if (c !== '.' && c !== ',') {
      digits = 0;
      continue;
    }

    if (decimalSeparator !== '?' || thousandsSeparator !== '?') {
      // We've previously found a non-ambiguous separator...
      if (c === decimalSeparator) {
        if (thousandsSeparatorFound) return undefined; // decimal before thousands
        if (decimalSeparatorFound) return undefined; // more than one decimal
        decimalSeparatorFound = true;
      } else if (c === thousandsSeparator) {
        if (digits !== 3) return undefined; // thousands not followed by 3 digits
        thousandsSeparatorFound = true;
      }
    } else if (ambiguousSeparator !== '?') {
      // We've previously found a separator, but we don't know which...
      if (c === ambiguousSeparator) {
        // They both must be thousands separators.
        thousandsSeparator = ambiguousSeparator;
        thousandsSeparatorFound = true;
        decimalSeparator = c === '.' ? ',' : '.';
      } else {
        // The first must have been a decimal, and this must be a thousands.
        decimalSeparator = ambiguousSeparator;
        decimalSeparatorFound = true;
        thousandsSeparator = c;
        thousandsSeparatorFound = true;
      }
    } else {
      // This is the first separator. Preceded by a lone `0`, or followed by
      // some number of digits other than 3, and it must be a decimal point;
      // otherwise we do not know yet.
      if ((ii === 1 && text[0] === '0') || digits !== 3) {
        decimalSeparator = c;
        decimalSeparatorFound = true;
        thousandsSeparator = c === '.' ? ',' : '.';
      } else {
        ambiguousSeparator = c;
      }
    }

    digits = 0;
  }

  // If we found nothing definitive we would have to look at the current
  // locale. A browser has no `localeconv()` and every file we read is written
  // in the C locale, so `.` is the decimal point.
  if (decimalSeparator === '?' && thousandsSeparator === '?') {
    decimalSeparator = '.';
    thousandsSeparator = ',';
  }

  // Convert to C-locale.
  text = text.split(thousandsSeparator).join('');
  text = text.split(decimalSeparator).join('.');
  return text;
}

/**
 * SplitString (`common/string_utils.cpp:1213`): break a value into its
 * alphabetic preamble, its digit run and its trailing text — `C10A` is
 * `C` / `10` / `A`. An "old school" decimal separator inside the digits (the
 * `k` of `4k7`) is moved: the digits become `4.7` and the ending gains the `k`.
 */
export function splitString(strToSplit: string): {
  beginning: string;
  digits: string;
  end: string;
} {
  // Starting at the end of the string look for the first digit.
  let ii = strToSplit.length - 1;
  for (; ii >= 0; ii--) {
    if (strToSplit[ii]! >= '0' && strToSplit[ii]! <= '9') break;
  }

  // If there were no digits then just set the single string.
  if (ii < 0) return { beginning: strToSplit, digits: '', end: '' };

  // Since there is at least one digit this is the trailing string.
  const end = strToSplit.slice(ii + 1);
  const position = ii + 1;
  let infix = '';

  for (; ii >= 0; ii--) {
    const c = strToSplit[ii]!;
    if (c >= '0' && c <= '9') continue;
    // NUMERIC_EVALUATOR::IsOldSchoolDecimalSeparator: one unit letter may
    // stand in for the decimal point, as in `4k7` or `1u5F`. It is a closed
    // set of 14 characters, not "any letter" — `C` in `C10A` is a preamble.
    if (infix === '' && OLD_SCHOOL_DECIMAL_SEPARATORS.has(c)) {
      infix = c;
      continue;
    }
    if (c === '.' || c === ',') continue;
    break;
  }

  let digits: string;
  let beginning = '';

  if (ii < 0) {
    // All that was left was digits.
    digits = strToSplit.slice(0, position);
  } else {
    digits = strToSplit.slice(ii + 1, position);
    beginning = strToSplit.slice(0, ii + 1);
  }

  if (infix !== '') return { beginning, digits: digits.split(infix).join('.'), end: infix + end };
  return { beginning, digits, end };
}

/** The SI/IEC-60062 multipliers ApplyModifier recognises. Both micro signs
 *  (U+00B5 and U+03BC) are listed, as upstream lists both. */
const SI_MODIFIERS: Readonly<Record<string, number>> = {
  a: 1e-18,
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  L: 1e-3,
  R: 1,
  F: 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/**
 * ApplyModifier (`common/string_utils.cpp:971`): scale `value` by the SI suffix
 * the trailing text starts with. `isModifier` is false when that text is not a
 * unit at all, which is what makes ValueStringCompare fall back to comparing
 * the endings as plain text.
 */
function applyModifier(value: number, text: string): { value: number; isModifier: boolean } {
  if (text.length === 0) return { value, isModifier: false };
  const first = text[0]!;
  const hasModifier = first in SI_MODIFIERS;
  const units = (hasModifier ? text.slice(1) : text).trim();
  const known = ['f', 'hz', 'w', 'v', 'a', 'h'];
  if (units.length > 0 && !known.includes(units.toLowerCase())) return { value, isModifier: false };
  return { value: hasModifier ? value * SI_MODIFIERS[first]! : value, isModifier: true };
}

/**
 * ValueStringCompare (`common/string_utils.cpp:1158`): order two component
 * values the way a person reads them — `10uF` before `100uF`, `100uF` before
 * `1mF` — by splitting each into preamble / number / units and comparing the
 * three in turn. The preamble and the ending compare case-insensitively.
 *
 * Both sides are unescaped first, as upstream does, so a value written to file
 * as `1{k}5` sorts as the `1k5` the user typed.
 */
export function valueStringCompare(strFWord: string, strSWord: string): number {
  // Compare unescaped text.
  const fa = splitString(unescapeString(strFWord));
  const fb = splitString(unescapeString(strSWord));

  const beg = fa.beginning.toLowerCase().localeCompare(fb.beginning.toLowerCase());
  if (beg !== 0) return beg < 0 ? -1 : 1;

  // ToCDouble on a C-locale number: anything unparseable reads as 0, exactly as
  // an untouched wxString does when ToCDouble fails.
  const toDouble = (digits: string): number => Number(convertSeparators(digits) ?? digits) || 0;

  const na = applyModifier(toDouble(fa.digits), fa.end);
  const nb = applyModifier(toDouble(fb.digits), fb.end);
  if (na.value > nb.value) return 1;
  if (na.value < nb.value) return -1;

  // If the first two sections are equal and the endings are modifiers then
  // there is nothing left to compare.
  if (!na.isModifier && !nb.isModifier) {
    const end = fa.end.toLowerCase().localeCompare(fb.end.toLowerCase());
    return end < 0 ? -1 : end > 0 ? 1 : 0;
  }
  return 0;
}

/**
 * C's `%g` conversion, which `wxString::Format` hands straight to the C
 * library — `PL_EDITOR_FRAME::UpdateStatusBar` formats its coordinates with
 * `"X %.4g  Y %.4g"` (`pagelayout_editor/pl_editor_frame.cpp:770-771`).
 *
 * `%g` is not "4 significant digits": it is 4 significant digits *and* a switch
 * to exponent form once the exponent leaves the range `-4 <= e < precision`,
 * with trailing zeros trimmed and the exponent padded to two digits. That is
 * why a cold-open pl_editor reads `X 1.266e+04  Y 1.217e+04` and not
 * `X 12660  Y 12170`, which is what `Number(n.toPrecision(4))` gives.
 *
 * The exponent is taken AFTER rounding to `precision` digits, as C does, so
 * 9999.6 at `%.4g` is `1e+04` rather than `9999.6`.
 */
export function formatG(value: number, precision = 4): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';

  const p = precision <= 0 ? 1 : precision;
  const rounded = value.toExponential(p - 1);
  const exponent = Number(rounded.slice(rounded.indexOf('e') + 1));

  const trim = (text: string): string =>
    text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;

  if (exponent < -4 || exponent >= p) {
    const mantissa = trim(rounded.slice(0, rounded.indexOf('e')));
    const sign = exponent < 0 ? '-' : '+';
    return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  return trim(value.toFixed(Math.max(0, p - 1 - exponent)));
}
