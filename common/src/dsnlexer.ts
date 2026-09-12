// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DSNLEXER` (common/dsnlexer.cpp) in its KiCad mode — the token reader
 * every `.kicad_*` parser pulls from: `NextTok`, the `Need*` guards, `CurText`
 * and the `Expecting` / `Unexpected` errors.
 *
 * The C++ hands back an `int`: a negative `DSN_*` constant for the structural
 * tokens and a non-negative keyword id from the parser's own keyword table.
 * Here a keyword IS its text: an unquoted word comes back as that string, so
 * `case 'segment':` reads like `case T_segment:` and a quoted `"segment"`
 * stays `T.STRING` exactly as it would stay `DSN_STRING` upstream. `IsSymbol`
 * is true for a string, a bare symbol and a keyword alike, as it is there
 * (`aTok == DSN_SYMBOL || aTok == DSN_STRING || aTok >= 0`).
 *
 * Nothing is materialised beyond the current token: a parser built on this
 * reads a file straight into its model, which is why the whole of a board's
 * text never turns into a tree.
 */

/** The structural tokens, `DSN_*` (include/dsnlexer.h). */
export enum T {
  NONE = -1,
  COMMENT = -2,
  STRING_QUOTE = -3,
  QUOTE_DEF = -4,
  DASH = -5,
  SYMBOL = -6,
  NUMBER = -7,
  RIGHT = -8, // right bracket: ')'
  LEFT = -9, // left bracket: '('
  STRING = -10, // a quoted string, stripped of the quotes
  EOF = -11, // special case for end of file
  BAR = -12, // a '|' when m_knowsBar
}

/** A token: a structural `T`, or an unquoted word as itself. */
export type Tok = T | string;

/** `PARSE_ERROR` (include/ki_exception.h). */
export class PARSE_ERROR extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly inputLine: string,
    readonly lineNumber: number,
    readonly byteIndex: number,
  ) {
    super(`${message} in '${source}', line ${lineNumber}, offset ${byteIndex}`);
    this.name = 'PARSE_ERROR';
  }
}

/**
 * Test for whitespace. Our whitespace, by our definition, is a subset of
 * ASCII, i.e. no bytes with MSB on can be considered whitespace, since they
 * are likely part of a multibyte UTF8 character.
 */
const isSpace = (c: number): boolean => c === 32 || c === 10 || c === 13 || c === 9 || c === 0;

const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/**
 * Return true if the text is a number: either an integer, fixed point, or
 * float with exponent (`^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?`).
 */
function isNumber(src: string, cp: number, limit: number): boolean {
  let sawNumber = false;
  let c = src.charCodeAt(cp);
  if (cp < limit && (c === 45 || c === 43)) ++cp;
  while (cp < limit && isDigit(src.charCodeAt(cp))) {
    ++cp;
    sawNumber = true;
  }
  if (cp < limit && src.charCodeAt(cp) === 46) {
    ++cp;
    while (cp < limit && isDigit(src.charCodeAt(cp))) {
      ++cp;
      sawNumber = true;
    }
  }
  if (sawNumber) {
    c = src.charCodeAt(cp);
    if (cp < limit && (c === 69 || c === 101)) {
      ++cp;
      sawNumber = false; // exponent mandates at least one digit thereafter.
      c = src.charCodeAt(cp);
      if (cp < limit && (c === 45 || c === 43)) ++cp;
      while (cp < limit && isDigit(src.charCodeAt(cp))) {
        ++cp;
        sawNumber = true;
      }
    }
  }
  return sawNumber && cp === limit;
}

const isHexDigit = (c: number): boolean =>
  isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

export class DSNLEXER {
  private readonly src: string;
  private readonly limit: number;
  /** Where the next token starts. */
  private next = 0;
  /** Where the current token started. */
  private curStart = 0;
  private curTok: Tok = T.NONE;
  private prevTok: Tok = T.NONE;
  private curText = '';
  private commentsAreTokens = false;
  /** `m_knowsBar`: whether `|` is a token of its own (files from 20240706 on). */
  private knowsBar = false;
  private readonly stringDelimiter = 34; // '"'

  constructor(
    text: string,
    private readonly source = 'string',
  ) {
    this.src = text;
    this.limit = text.length;
  }

  /** `CurTok()`. */
  CurTok(): Tok {
    return this.curTok;
  }

  /** `PrevTok()`. */
  PrevTok(): Tok {
    return this.prevTok;
  }

  /** `CurText()` / `CurStr()` / `FromUTF8()`: the current token's text. */
  CurText(): string {
    return this.curText;
  }

  /** `CurSource()`. */
  CurSource(): string {
    return this.source;
  }

  /** `CurLineNumber()`: 1-based, counted on demand — it is only for errors. */
  CurLineNumber(): number {
    let n = 1;
    for (let i = 0; i < this.curStart && i < this.limit; i++)
      if (this.src.charCodeAt(i) === 10) n++;
    return n;
  }

  /** `CurLine()`: the text of the line the current token is on. */
  CurLine(): string {
    let a = this.curStart;
    while (a > 0 && this.src.charCodeAt(a - 1) !== 10) a--;
    let b = this.curStart;
    while (b < this.limit && this.src.charCodeAt(b) !== 10) b++;
    return this.src.slice(a, b);
  }

  /** `CurOffset()`: the byte offset of the current token in its line. */
  CurOffset(): number {
    let a = this.curStart;
    while (a > 0 && this.src.charCodeAt(a - 1) !== 10) a--;
    return this.curStart - a;
  }

  /** `SetKnowsBar( aValue )`. */
  SetKnowsBar(value: boolean): boolean {
    const old = this.knowsBar;
    this.knowsBar = value;
    return old;
  }

  SetCommentsAreTokens(value: boolean): boolean {
    const old = this.commentsAreTokens;
    this.commentsAreTokens = value;
    return old;
  }

  /** `IsSymbol( aTok )`: a string, a bare symbol, or a keyword. */
  static IsSymbol(tok: Tok): boolean {
    return tok === T.SYMBOL || tok === T.STRING || typeof tok === 'string';
  }

  static IsNumber(tok: Tok): boolean {
    return tok === T.NUMBER;
  }

  /** `GetTokenString( aTok )` for messages. */
  static GetTokenString(tok: Tok): string {
    if (typeof tok === 'string') return tok;
    switch (tok) {
      case T.LEFT:
        return '(';
      case T.RIGHT:
        return ')';
      case T.STRING:
        return 'quoted string';
      case T.NUMBER:
        return 'number';
      case T.SYMBOL:
        return 'symbol';
      case T.EOF:
        return 'end of input';
      case T.BAR:
        return '|';
      default:
        return `token ${tok}`;
    }
  }

  protected throwError(message: string, offset = this.CurOffset()): never {
    throw new PARSE_ERROR(message, this.source, this.CurLine(), this.CurLineNumber(), offset);
  }

  /** `Expecting( int aTok )` / `Expecting( const char* text )`. */
  Expecting(what: Tok): never {
    if (typeof what === 'string' && !/^[a-z_0-9]+$/.test(what))
      this.throwError(`Expecting ${what}. Got '${DSNLEXER.GetTokenString(this.curTok)}'`);
    this.throwError(`Expecting '${DSNLEXER.GetTokenString(what)}'`);
  }

  /** `Unexpected( int aTok )` / `Unexpected( const char* text )`. */
  Unexpected(what: Tok = this.curTok): never {
    this.throwError(`Unexpected '${DSNLEXER.GetTokenString(what)}'`);
  }

  /** `Duplicate( int aTok )`. */
  Duplicate(what: Tok): never {
    this.throwError(`${DSNLEXER.GetTokenString(what)} is a duplicate`);
  }

  NeedLEFT(): void {
    if (this.NextTok() !== T.LEFT) this.Expecting(T.LEFT);
  }

  NeedRIGHT(): void {
    if (this.NextTok() !== T.RIGHT) this.Expecting(T.RIGHT);
  }

  NeedBAR(): void {
    if (this.NextTok() !== T.BAR) this.Expecting(T.BAR);
  }

  NeedSYMBOL(): Tok {
    const tok = this.NextTok();
    if (!DSNLEXER.IsSymbol(tok)) this.Expecting(T.SYMBOL);
    return tok;
  }

  NeedSYMBOLorNUMBER(): Tok {
    const tok = this.NextTok();
    if (!DSNLEXER.IsSymbol(tok) && !DSNLEXER.IsNumber(tok)) this.Expecting('a symbol or number');
    return tok;
  }

  NeedNUMBER(expectation: string): Tok {
    const tok = this.NextTok();
    if (!DSNLEXER.IsNumber(tok)) this.throwError(`need a number for '${expectation}'`);
    return tok;
  }

  /**
   * `parseDouble()`: the current token as a double. `fast_float` accepts
   * anything `isNumber` let through; `Number()` does the same for that
   * grammar.
   */
  parseDouble(): number {
    const v = Number(this.curText);
    if (Number.isNaN(v)) this.throwError('Invalid floating point number');
    return v;
  }

  /** `NextTok()`: advance, and return the token. */
  NextTok(): Tok {
    const src = this.src;
    const limit = this.limit;
    let cur = this.next;
    this.prevTok = this.curTok;

    if (this.curTok === T.EOF) return T.EOF;

    // skip whitespace, and any comment lines: a '#' as the first non-blank
    // character of a line is a comment to its end (comments cannot follow
    // another token on the same line).
    for (;;) {
      while (cur < limit && isSpace(src.charCodeAt(cur))) ++cur;
      if (cur >= limit) {
        this.curStart = cur;
        this.next = cur;
        this.curTok = T.EOF;
        return T.EOF;
      }
      if (src.charCodeAt(cur) === 35 /* # */) {
        // At the start of a line?
        let a = cur;
        while (a > 0 && src.charCodeAt(a - 1) !== 10) {
          if (!isSpace(src.charCodeAt(a - 1))) break;
          a--;
        }
        const atLineStart = a === 0 || src.charCodeAt(a - 1) === 10;
        if (atLineStart) {
          let e = cur;
          while (e < limit && src.charCodeAt(e) !== 10) ++e;
          if (this.commentsAreTokens) {
            let lineStart = cur;
            while (lineStart > 0 && src.charCodeAt(lineStart - 1) !== 10) lineStart--;
            let end = e;
            while (
              end > lineStart &&
              (src.charCodeAt(end - 1) === 13 || src.charCodeAt(end - 1) === 10)
            )
              end--;
            this.curText = src.slice(lineStart, end);
            this.curStart = lineStart;
            this.next = e;
            this.curTok = T.COMMENT;
            return T.COMMENT;
          }
          cur = e;
          continue;
        }
      }
      break;
    }

    this.curStart = cur;
    const c = src.charCodeAt(cur);

    if (c === 40 /* ( */) {
      this.curText = '(';
      this.next = cur + 1;
      this.curTok = T.LEFT;
      return T.LEFT;
    }
    if (c === 41 /* ) */) {
      this.curText = ')';
      this.next = cur + 1;
      this.curTok = T.RIGHT;
      return T.RIGHT;
    }
    if (this.knowsBar && c === 124 /* | */) {
      this.curText = '|';
      this.next = cur + 1;
      this.curTok = T.BAR;
      return T.BAR;
    }

    // A quoted string, will return T.STRING. Understands and deciphers escaped
    // \, \r, \n, \" and the rest of the C escapes; strips the quotes.
    if (c === this.stringDelimiter) {
      ++cur; // skip over the leading delimiter
      let head = cur;
      let text = '';
      let segStart = head;
      while (head < limit) {
        const ch = src.charCodeAt(head);
        if (ch === 92 /* \ */) {
          text += src.slice(segStart, head);
          if (++head >= limit) break; // unterminated
          const e = src.charCodeAt(head++);
          let out: string;
          switch (e) {
            case 34: // "
            case 92: // backslash
              out = String.fromCharCode(e);
              break;
            case 97: // a
              out = '\x07';
              break;
            case 98: // b
              out = '\x08';
              break;
            case 102: // f
              out = '\x0c';
              break;
            case 110: // n
              out = '\n';
              break;
            case 114: // r
              out = '\r';
              break;
            case 116: // t
              out = '\x09';
              break;
            case 118: // v
              out = '\x0b';
              break;
            case 120: {
              // 1 or 2 byte hex escape sequence
              let i = 0;
              while (i < 2 && head + i < limit && isHexDigit(src.charCodeAt(head + i))) i++;
              if (i > 0) out = String.fromCharCode(Number.parseInt(src.slice(head, head + i), 16));
              else out = 'x'; // a goofed hex escape sequence, interpret as 'x'
              head += i;
              break;
            }
            default: {
              // 1-3 byte octal escape sequence
              --head;
              let i = 0;
              while (i < 3 && head + i < limit) {
                const d = src.charCodeAt(head + i);
                if (d < 48 || d > 55) break;
                i++;
              }
              if (i > 0) out = String.fromCharCode(Number.parseInt(src.slice(head, head + i), 8));
              else out = '\\'; // a goofed octal escape sequence, interpret as '\'
              head += i;
              break;
            }
          }
          text += out;
          segStart = head;
        } else if (ch === 34 /* " */) {
          // end of the T.STRING
          text += src.slice(segStart, head);
          this.curText = text;
          this.next = head + 1; // omit this trailing double quote
          this.curTok = T.STRING;
          return T.STRING;
        } else {
          ++head;
        }
      }
      this.throwError('Unterminated delimited string', cur - 1);
    }

    // non-quoted token, read it into curText.
    let head = cur;
    const bar = this.knowsBar;
    while (head < limit) {
      const ch = src.charCodeAt(head);
      if (isSpace(ch) || ch === 40 || ch === 41 || (bar && ch === 124)) break;
      ++head;
    }
    this.curText = src.slice(cur, head);
    this.next = head;
    if (isNumber(src, cur, head)) {
      this.curTok = T.NUMBER;
      return T.NUMBER;
    }
    // A keyword is its own text; nothing here knows the parser's table.
    this.curTok = this.curText;
    return this.curTok;
  }
}
