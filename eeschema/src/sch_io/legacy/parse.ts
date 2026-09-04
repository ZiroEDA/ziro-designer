// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The pieces both legacy readers share — `sch_io_kicad_legacy_helpers.cpp`.
 *
 * KiCad's legacy `.lib` and `.sch` parsers are two files that call the same
 * free functions over a `const char*`: `strCompare`, `parseInt`, `parseChar`,
 * `parseUnquotedString`, `parseQuotedString`. Here they are one {@link Scanner}
 * with the pointer held for you, shared for the same reason upstream shares
 * them — the two formats are one grammar, and a fix to how a quoted string
 * escapes has to reach both.
 */

/** `schIUScale.IU_PER_MILS`, exact: schematic IU is 100 nm and a mil is 25400. */
export const IU_PER_MIL = 254;
/** `SCH_IU_PER_MM`. */
export const IU_PER_MM = 10000;

/** An IU length as the millimetres the s-expression grammar wants. */
export function mm(iu: number): string {
  const s = (iu / IU_PER_MM).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** A legacy mils coordinate or length, in IU. */
export const mil = (mils: number): number => mils * IU_PER_MIL;

/**
 * Model (+Y down) -> file (+Y up), the same pair `write-symbol-lib.ts` uses.
 *
 * Coordinates are held here in the space KiCad works in after loading — the
 * legacy `-MilsToIU( y )` — because that is the space `MapAnglesV6` and
 * `GetArcMid` do their trigonometry in, and mirroring it would turn the arc
 * the wrong way. The single negation back to +Y-up happens here, once, on
 * every coordinate that reaches a node.
 */
export const fx = (iu: number): string => mm(iu);
export const fy = (iu: number): string => mm(-iu);

/** KiROUND: half away from zero, which is not what Math.round does for -0.5. */
export const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

// ---------------------------------------------------------------------------
// The line scanner — `sch_io_kicad_legacy_helpers.cpp`
// ---------------------------------------------------------------------------

export class ParseError extends Error {}

/**
 * One line of the file, consumed left to right.
 *
 * The upstream helpers are free functions over a `const char*` that each skip
 * leading whitespace, take one token and leave the pointer on the next; this is
 * the same contract with the pointer held for you.
 */
export class Scanner {
  private i = 0;

  constructor(
    readonly line: string,
    readonly lineNumber: number,
  ) {}

  private fail(what: string): never {
    throw new ParseError(`${what} at line ${this.lineNumber}: ${this.line}`);
  }

  private skipSpace(): void {
    while (this.i < this.line.length && /\s/.test(this.line[this.i]!)) this.i++;
  }

  /** `is_eol` — nothing but whitespace left. */
  atEol(): boolean {
    this.skipSpace();
    return this.i >= this.line.length;
  }

  /** `strCompare( aString, aLine, &aLine )`: the token, case-insensitively,
   *  and only when it is a whole token. */
  take(token: string): boolean {
    this.skipSpace();
    const at = this.line.slice(this.i, this.i + token.length);
    if (at.toLowerCase() !== token.toLowerCase()) return false;
    const after = this.line[this.i + token.length];
    if (after !== undefined && !/\s/.test(after)) return false;
    this.i += token.length;
    return true;
  }

  /** `parseInt`: strtol, which stops at the first character it cannot use. */
  int(): number {
    this.skipSpace();
    const m = /^[+-]?\d+/.exec(this.line.slice(this.i));
    if (!m) this.fail('expected an integer');
    this.i += m[0].length;
    return Number.parseInt(m[0], 10);
  }

  /** `parseChar`: a single-character token, and it must be single. */
  char(): string {
    this.skipSpace();
    if (this.i >= this.line.length) this.fail('unexpected end of line');
    const c = this.line[this.i]!;
    const next = this.line[this.i + 1];
    if (next !== undefined && !/\s/.test(next)) this.fail('expected single character token');
    this.i += 1;
    return c;
  }

  /** `parseUnquotedString`: everything up to the next whitespace. */
  word(canBeEmpty = false): string {
    this.skipSpace();
    if (this.i >= this.line.length) {
      if (canBeEmpty) return '';
      this.fail('unexpected end of line');
    }
    const start = this.i;
    while (this.i < this.line.length && !/\s/.test(this.line[this.i]!)) this.i++;
    return this.line.slice(start, this.i);
  }

  /**
   * `parseQuotedString`: `"…"`, where a backslash escapes the next character
   * and is itself dropped only before a quote or another backslash.
   */
  quoted(canBeEmpty = false): string {
    this.skipSpace();
    if (this.i >= this.line.length) {
      if (canBeEmpty) return '';
      this.fail('unexpected end of line');
    }
    if (this.line[this.i] !== '"') {
      if (canBeEmpty) return '';
      this.fail('expecting opening quote');
    }
    this.i++;
    let out = '';
    while (this.i < this.line.length) {
      const c = this.line[this.i]!;
      if (c === '\\') {
        this.i++;
        if (this.i >= this.line.length) this.fail('unexpected end of line');
        const esc = this.line[this.i]!;
        if (esc !== '"' && esc !== '\\') out += '\\';
        out += esc;
        this.i++;
      } else if (c === '"') {
        this.i++;
        return out;
      } else {
        out += c;
        this.i++;
      }
    }
    this.fail('missing closing quote');
  }

  /** Whether the next non-space character opens a quoted string. */
  peekQuote(): boolean {
    this.skipSpace();
    return this.line[this.i] === '"';
  }

  /** Skip forward to the first double quote, as `loadField` does. */
  toQuote(): void {
    while (this.i < this.line.length && this.line[this.i] !== '"') this.i++;
    if (this.i >= this.line.length) this.fail('unexpected end of line');
  }

  /** The whitespace-separated tokens of what is left, for the token-list forms
   *  (`DEF` and `X`, which upstream reads with a wxStringTokenizer). */
  tokens(): string[] {
    return this.line
      .slice(this.i)
      .trim()
      .split(/[ \t\r\n]+/)
      .filter(Boolean);
  }
}
