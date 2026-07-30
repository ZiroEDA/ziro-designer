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
