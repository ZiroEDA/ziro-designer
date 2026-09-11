// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KICAD_FORMAT` (common/io/kicad/kicad_io_utils.cpp): the shared token
 * helpers every KiCad file writer prints through, and `Prettify`, the pass
 * that lays a compact s-expression stream out as the tab-indented file KiCad
 * 8+ writes. The layout of a board, a schematic or a library is this one
 * function, not the writers' `Print` calls.
 */
import type { OUTPUTFORMATTER } from '../../richio.js';

export enum FORMAT_MODE {
  /** Follows standard pretty-printing rules. */
  NORMAL = 0,
  /** Collapses certain text properties to single-line. */
  COMPACT_TEXT_PROPERTIES = 1,
  /** Puts library table rows on a single line. */
  LIBRARY_TABLE = 2,
}

export function FormatBool(out: OUTPUTFORMATTER, key: string, value: boolean): void {
  out.Print(`(${key} ${value ? 'yes' : 'no'})`);
}

export function FormatOptBool(out: OUTPUTFORMATTER, key: string, value: boolean | undefined): void {
  if (value !== undefined) FormatBool(out, key, value);
  else out.Print(`(${key} none)`);
}

export function FormatUuid(out: OUTPUTFORMATTER, uuid: string): void {
  out.Print(`(uuid ${out.Quotew(uuid)})`);
}

/**
 * `FormatStreamData`: the bytes base64-encoded in 76-column quoted lines
 * ("Apparently the MIME standard character width for base64 encoding is 76").
 */
export function FormatStreamData(out: OUTPUTFORMATTER, bytes: Uint8Array): void {
  out.Print('(data');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const encoded = btoa(binary);
  const MIME_BASE64_LENGTH = 76;
  let first = 0;
  while (first < encoded.length) {
    out.Print(`\n"${encoded.slice(first, first + MIME_BASE64_LENGTH)}"`);
    first += MIME_BASE64_LENGTH;
  }
  out.Print(')'); // Closes data token.
}

/*
 * Formatting rules:
 * - All extra (non-indentation) whitespace is trimmed
 * - Indentation is one tab
 * - Starting a new list (open paren) starts a new line with one deeper indentation
 * - Lists with no inner lists go on a single line
 * - End of multi-line lists (close paren) goes on a single line at same indentation as its start
 *
 * For example:
 * (first
 *  (second
 *   (third list)
 *   (another list)
 *  )
 *  (fifth)
 *  (sixth thing with lots of tokens
 *   (and a sub list)
 *  )
 * )
 */
export function Prettify(source: string, mode: FORMAT_MODE = FORMAT_MODE.NORMAL): string {
  // Configuration
  const quoteChar = '"';
  const indentChar = '\t';
  const indentSize = 1;

  // In order to visually compress PCB files, it is helpful to special-case long lists of (xy ...)
  // lists, which we allow to exist on a single line until we reach column 99.
  const xySpecialCaseColumnLimit = 99;

  // If whitespace occurs inside a list after this threshold, it will be converted into a newline
  // and the indentation will be increased.  This is mainly used for image and group objects,
  // which contain potentially long sets of string tokens within a single list.
  const consecutiveTokenWrapThreshold = 72;

  const textSpecialCase = mode === FORMAT_MODE.COMPACT_TEXT_PROPERTIES;
  const libSpecialCase = mode === FORMAT_MODE.LIBRARY_TABLE;

  const n = source.length;
  const formatted: string[] = [];
  let formattedEmpty = true;

  let listDepth = 0;
  let libDepth = 0;
  let lastNonWhitespace = '';
  let inQuote = false;
  let hasInsertedSpace = false;
  let inMultiLineList = false;
  let inXY = false;
  let inShortForm = false;
  let inLibRow = false;
  let shortFormDepth = 0;
  let column = 0;
  let backslashCount = 0; // Count of successive backslash read since any other char

  const isWhitespace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

  const isAlpha = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

  const nextNonWhitespace = (at: number): string => {
    let seek = at;
    while (seek < n && isWhitespace(source[seek]!)) seek++;
    if (seek >= n) return '';
    return source[seek]!;
  };

  const isXY = (at: number): boolean => {
    let seek = at;
    if (++seek >= n || source[seek] !== 'x') return false;
    if (++seek >= n || source[seek] !== 'y') return false;
    if (++seek >= n || source[seek] !== ' ') return false;
    return true;
  };

  const tokenAfter = (at: number): string => {
    let seek = at;
    let token = '';
    while (++seek < n && isAlpha(source[seek]!)) token += source[seek];
    return token;
  };

  const isShortForm = (at: number): boolean => {
    const token = tokenAfter(at);
    return (
      token === 'font' ||
      token === 'stroke' ||
      token === 'fill' ||
      token === 'teardrop' ||
      token === 'offset' ||
      token === 'rotate' ||
      token === 'scale'
    );
  };

  const isLib = (at: number): boolean => tokenAfter(at) === 'lib';

  /** How many UTF-8 bytes the code unit at `at` contributes. */
  const utf8Bytes = (c: string, src: string, at: number): number => {
    const code = c.charCodeAt(0);
    if (code < 0x80) return 1;
    if (code < 0x800) return 2;
    if (code >= 0xd800 && code <= 0xdbff) return 4; // high surrogate: the pair's four bytes
    if (code >= 0xdc00 && code <= 0xdfff) return 0; // low surrogate: counted with its high
    return 3;
  };

  const push = (text: string): void => {
    formatted.push(text);
    formattedEmpty = false;
  };

  for (let cursor = 0; cursor < n; ++cursor) {
    const ch = source[cursor]!;
    const next = nextNonWhitespace(cursor);

    if (isWhitespace(ch) && !inQuote) {
      if (
        !hasInsertedSpace && // Only permit one space between chars
        listDepth > 0 && // Do not permit spaces in outer list
        lastNonWhitespace !== '(' && // Remove extra space after start of list
        next !== ')' && // Remove extra space before end of list
        next !== '(' // Remove extra space before newline
      ) {
        if (inXY || column < consecutiveTokenWrapThreshold) {
          // Note that we only insert spaces here, no matter what kind of whitespace is
          // in the input.  Newlines will be inserted as needed by the logic below.
          push(' ');
          column++;
        } else if (inShortForm || inLibRow) {
          push(' ');
        } else {
          push(`\n${indentChar.repeat(listDepth * indentSize)}`);
          column = listDepth * indentSize;
          inMultiLineList = true;
        }

        hasInsertedSpace = true;
      }
    } else {
      hasInsertedSpace = false;

      if (ch === '(' && !inQuote) {
        const currentIsXY = isXY(cursor);
        const currentIsShortForm = textSpecialCase && isShortForm(cursor);
        const currentIsLib = libSpecialCase && isLib(cursor);

        if (formattedEmpty) {
          push('(');
          column++;
        } else if (inXY && currentIsXY && column < xySpecialCaseColumnLimit) {
          // List-of-points special case
          push(' (');
          column += 2;
        } else if (inShortForm || inLibRow) {
          push(' (');
          column += 2;
        } else {
          push(`\n${indentChar.repeat(listDepth * indentSize)}(`);
          column = listDepth * indentSize + 1;
        }

        inXY = currentIsXY;

        if (currentIsShortForm) {
          inShortForm = true;
          shortFormDepth = listDepth;
        } else if (currentIsLib) {
          inLibRow = true;
          libDepth = listDepth;
        }

        listDepth++;
      } else if (ch === ')' && !inQuote) {
        if (listDepth > 0) listDepth--;

        if (inShortForm) {
          push(')');
          column++;
        } else if (inLibRow && listDepth === libDepth) {
          push(')');
          inLibRow = false;
        } else if (lastNonWhitespace === ')' || inMultiLineList) {
          push(`\n${indentChar.repeat(listDepth * indentSize)})`);
          column = listDepth * indentSize + 1;
          inMultiLineList = false;
        } else {
          push(')');
          column++;
        }

        if (shortFormDepth === listDepth) {
          inShortForm = false;
          shortFormDepth = 0;
        }
      } else {
        // The output formatter escapes double-quotes (like \")
        // But a corner case is a sequence like \\"
        // therefore a '\' is attached to a '"' if a odd number of '\' is detected
        if (ch === '\\') backslashCount++;
        else if (ch === quoteChar && (backslashCount & 1) === 0) inQuote = !inQuote;

        if (ch !== '\\') backslashCount = 0;

        push(ch);
        // The C++ walks UTF-8 bytes and counts each one as a column; the
        // wrap thresholds above are therefore byte columns.
        column += utf8Bytes(ch, source, cursor);
      }

      lastNonWhitespace = ch;
    }
  }

  // newline required at end of line / file for POSIX compliance. Keeps git diffs clean.
  push('\n');

  return formatted.join('');
}
