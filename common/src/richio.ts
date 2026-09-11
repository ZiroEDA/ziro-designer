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
import { FORMAT_MODE, Prettify } from './io/kicad/kicad_io_utils.js';

/** How many spaces per nestLevel (richio.cpp:424). */
const NESTWIDTH = 2;

export abstract class OUTPUTFORMATTER {
  protected readonly quoteChar: string;

  constructor(quoteChar = '"') {
    this.quoteChar = quoteChar;
  }

  protected abstract write(text: string): void;

  /** `Print( int nestLevel, const char* fmt, ... )`: NESTWIDTH spaces per level, then the text. */
  Print(nestLevel: number, text: string): void;
  /** `Print( const char* fmt, ... )`. */
  Print(text: string): void;
  Print(a: number | string, b?: string): void {
    if (typeof a === 'number') {
      for (let i = 0; i < a; ++i) this.write(' '.repeat(NESTWIDTH));
      this.write(b ?? '');
    } else {
      this.write(a);
    }
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
}
