// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `<cstring>`: the C library string functions KiCad's C++ calls directly.
 */

/**
 * `strtok`: the state a C `strtok( nullptr, … )` call continues from, held in
 * an object rather than in the library's hidden static.
 *
 * Each call skips leading delimiters, returns the run up to the next one (or
 * the end), and consumes that one delimiter; null once only delimiters remain.
 */
export class STRTOK {
  private m_rest: string | null;

  /** `strtok( aStr, … )`'s first argument. */
  constructor(aStr: string) {
    this.m_rest = aStr;
  }

  /** `strtok( first ? aStr : nullptr, aDelims )`. */
  Next(aDelims: string): string | null {
    if (this.m_rest === null) return null;

    const s = this.m_rest;
    let begin = 0;

    while (begin < s.length && aDelims.includes(s[begin]!)) ++begin;

    if (begin === s.length) {
      this.m_rest = null;
      return null;
    }

    let end = begin;

    while (end < s.length && !aDelims.includes(s[end]!)) ++end;

    this.m_rest = end < s.length ? s.slice(end + 1) : null;
    return s.slice(begin, end);
  }
}

/**
 * `char line[1024]; strncpy( line, aSrc, sizeof( line ) - 1 ); line[1023] = 0;`:
 * the fixed buffer a remote command is copied into, in bytes of UTF-8.
 */
export function strncpyLine(aSrc: string, aSize = 1024): string {
  const bytes = new TextEncoder().encode(aSrc);

  if (bytes.length <= aSize - 1) return aSrc;

  // A cut through a multi-byte character leaves a partial sequence the
  // decoder replaces; KiCad's From_UTF8 on it does the same.
  return new TextDecoder().decode(bytes.slice(0, aSize - 1));
}
