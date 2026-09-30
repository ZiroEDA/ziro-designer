// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `OUTPUTFORMATTER` and its string-backed subclasses (common/richio.cpp,
 * include/richio.h): what every KiCad file writer prints into.
 *
 * The C++ `Print( fmt, ... )` is printf-style; here the caller formats the
 * text and `Print` appends it. The layout of a KiCad 8+ file is not decided by
 * these calls at all — a writer prints a compact token stream and
 * `PRETTIFIED_FILE_OUTPUTFORMATTER::Finish` runs `KICAD_FORMAT::Prettify`
 * over the whole buffer (kicad_io_utils.ts), which is where the tabs and the
 * line breaks come from.
 */
import { IO_ERROR } from './exceptions.js';
import { FORMAT_MODE, Prettify, prettifySteps } from './io/kicad/kicad_io_utils.js';

/** How many spaces per nestLevel (richio.cpp:424). */
const NESTWIDTH = 2;

export abstract class OUTPUTFORMATTER {
  protected readonly quoteChar: string;

  constructor(quoteChar = '"') {
    this.quoteChar = quoteChar;
  }

  protected abstract write(text: string): void;

  /**
   * `Print( int nestLevel, const char* fmt, ... )`: NESTWIDTH spaces per level,
   * then the text. Returns the number of characters written, as upstream's.
   */
  Print(nestLevel: number, text: string): number;
  /** `Print( const char* fmt, ... )`. */
  Print(text: string): number;
  Print(a: number | string, b?: string): number {
    if (typeof a === 'number') {
      for (let i = 0; i < a; ++i) this.write(' '.repeat(NESTWIDTH));
      this.write(b ?? '');
      return a * NESTWIDTH + (b ?? '').length;
    }

    this.write(a);
    return a.length;
  }

  /**
   * `OUTPUTFORMATTER::GetQuoteChar( wrapee, quote_char )` (richio.cpp:344): the
   * quote character a Specctra-style symbol needs, or "" when it can go bare.
   * A `#` is wrapped so it is not taken for a comment, as are the empty
   * string, whitespace, parentheses, `%`, braces, and a `-` that is not first.
   */
  static GetQuoteChar(wrapee: string, quoteChar: string): string {
    if (wrapee.startsWith('#')) return quoteChar;

    if (wrapee.length === 0) return quoteChar;

    let isFirst = true;

    for (const ch of wrapee) {
      if ('\t ()%{}'.includes(ch)) return quoteChar;

      if (!isFirst && ch === '-') return quoteChar;

      isFirst = false;
    }

    return ''; // caller does not need to wrap, can use an unwrapped string.
  }

  /** `GetQuoteChar( wrapee )`, with this formatter's own quote character. */
  GetQuoteChar(wrapee: string): string {
    return OUTPUTFORMATTER.GetQuoteChar(wrapee, this.quoteChar);
  }

  /**
   * `OUTPUTFORMATTER::Quotes` (richio.cpp:468): the string in double quotes
   * with `\n`, `\r`, `\\` and `"` escaped — and nothing else; a tab is written
   * as a tab.
   */
  Quotes(wrapee: string): string {
    let ret = '"';
    for (const ch of wrapee) {
      switch (ch) {
        case '\n':
          ret += '\\n';
          break;
        case '\r':
          ret += '\\r';
          break;
        case '\\':
          ret += '\\\\';
          break;
        case '"':
          ret += '\\"';
          break;
        default:
          ret += ch;
      }
    }
    ret += '"';
    return ret;
  }

  /** `Quotew`: the wxString form, which is the same bytes here. */
  Quotew(wrapee: string): string {
    return this.Quotes(wrapee);
  }
}

/** `STRING_FORMATTER`: prints into a string. */
export class STRING_FORMATTER extends OUTPUTFORMATTER {
  private readonly parts: string[] = [];

  protected write(text: string): void {
    this.parts.push(text);
  }

  Clear(): void {
    this.parts.length = 0;
  }

  GetString(): string {
    return this.parts.join('');
  }

  /** `StripUseless` (richio.cpp:526): drop whitespace, parentheses and double quotes. */
  StripUseless(): void {
    const stripped = this.GetString().replace(/[\s()"]/g, '');
    this.parts.length = 0;
    this.parts.push(stripped);
  }
}

/**
 * `PRETTIFIED_FILE_OUTPUTFORMATTER`, minus the file: everything printed is
 * prettified as one buffer by `Finish`, which returns the text a save would
 * write. `ADVANCED_CFG::m_CompactSave` is off by default, so a board is
 * `FORMAT_MODE::NORMAL`.
 */
export class PRETTIFIED_STRING_FORMATTER extends STRING_FORMATTER {
  constructor(private readonly mode: FORMAT_MODE = FORMAT_MODE.NORMAL) {
    super();
  }

  Finish(): string {
    return Prettify(this.GetString(), this.mode);
  }

  /** `Finish`, the prettifier walked in time slices (see `prettifySteps`). */
  async FinishAsync(
    aYield: () => Promise<void>,
    aAbort: () => boolean,
    aBudgetMs: number,
  ): Promise<string | null> {
    const steps = prettifySteps(this.GetString(), this.mode);
    let sliceStart = performance.now();

    for (;;) {
      const r = steps.next();

      if (r.done) return r.value;

      if (performance.now() - sliceStart >= aBudgetMs) {
        await aYield();
        if (aAbort()) return null;
        sliceStart = performance.now();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// LINE_READER: the line-at-a-time byte reader the legacy formats are parsed
// with, over bytes in memory (FILE_LINE_READER and STRING_LINE_READER read the
// same way here). A line is its bytes up to and including the '\n', then a
// NUL, in one mutable buffer the parsers index into and write into (strtok_r
// does), as the C++ does with `char*`. ReadLine() returns it, or null at the end.
// ---------------------------------------------------------------------------

/** `LINE_READER_LINE_DEFAULT_MAX`. */
const LINE_READER_LINE_DEFAULT_MAX = 1000000;

export class LINE_READER {
  protected m_line: Uint8Array = new Uint8Array([0]);
  protected m_length = 0;
  protected m_lineNum = 0;
  private m_pos = 0;

  constructor(
    private readonly m_data: Uint8Array,
    protected readonly m_source = '',
    private readonly m_maxLineLength = LINE_READER_LINE_DEFAULT_MAX,
  ) {}

  /** The next line (with its `'\n'`, then a NUL), or null when the input is exhausted. */
  ReadLine(): Uint8Array | null {
    const d = this.m_data;

    if (this.m_pos >= d.length) {
      this.m_length = 0;
      this.m_line = new Uint8Array([0]);
      return null;
    }

    let end = d.indexOf(0x0a, this.m_pos);
    end = end < 0 ? d.length : end + 1;

    if (end - this.m_pos > this.m_maxLineLength) throw new IO_ERROR('Maximum line length exceeded');

    const line = new Uint8Array(end - this.m_pos + 1);
    line.set(d.subarray(this.m_pos, end));
    this.m_pos = end;

    this.m_line = line;
    this.m_length = line.length - 1;
    this.m_lineNum++;

    return line;
  }

  /** `Line()`: the current line's buffer. */
  Line(): Uint8Array {
    return this.m_line;
  }

  /** `Length()`: the current line's length in bytes. */
  Length(): number {
    return this.m_length;
  }

  LineNumber(): number {
    return this.m_lineNum;
  }

  GetSource(): string {
    return this.m_source;
  }

  /** `FILE_LINE_READER::Rewind()`. */
  Rewind(): void {
    this.m_pos = 0;
    this.m_lineNum = 0;
  }
}
