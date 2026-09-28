// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `markup_parser.h` / `common/markup_parser.cpp`: the text-markup grammar
 * (`^{ }`, `_{ }`, `~{ }` and URLs) and its parse tree. Upstream is a PEGTL
 * grammar with a `parse_tree` selector; this is the same grammar as a
 * recursive descent, producing the same tree:
 *
 *     markup      : subscript | superscript | overbar
 *     anyString   : ( !markup !url any )+                       [content]
 *     escapeSeq   : '{' identifier '}'
 *     inBraces    : ( !markup escapeSeq | !markup [^}] )+       [content]
 *     url         : ( "http://" | "https://" ) [^ ]+            [content]
 *     braces<C>   : C '{' ( '}' | inBraces | subscript | superscript | overbar )* until '}'
 *     anything    : anyString | url | subscript | superscript | overbar
 *     grammar     : anything* eof
 *
 * `store_content` keeps anyString, url and inBraces as leaves with content;
 * `discard_empty` drops a sub/superscript/overbar node with no children.
 */

export type MARKUP_NODE_TYPE =
  | 'root'
  | 'anyString'
  | 'url'
  | 'anyStringWithinBraces'
  | 'subscript'
  | 'superscript'
  | 'overbar';

export class NODE {
  type: MARKUP_NODE_TYPE;
  children: NODE[] = [];
  /** `string()`: the matched text, for the content-bearing leaves. */
  private m_content: string | null;

  constructor(type: MARKUP_NODE_TYPE, content: string | null = null) {
    this.type = type;
    this.m_content = content;
  }

  is_root(): boolean {
    return this.type === 'root';
  }
  has_content(): boolean {
    return this.m_content !== null;
  }
  string(): string {
    return this.m_content ?? '';
  }

  asString(): string {
    let os = this.type as string;

    if (this.has_content()) os += ` "${this.string()}"`;

    return os;
  }

  typeString(): string {
    if (this.isSubscript()) return 'SUBSCRIPT';
    if (this.isSuperscript()) return 'SUPERSCRIPT';
    if (this.isOverbar()) return 'OVERBAR';
    if (this.type === 'anyString') return 'ANYSTRING';
    if (this.isURL()) return 'URL';
    if (this.type === 'anyStringWithinBraces') return 'ANYSTRINGWITHINBRACES';
    return 'other';
  }

  asWxString(): string {
    return this.string();
  }

  isOverbar(): boolean {
    return this.type === 'overbar';
  }
  isSubscript(): boolean {
    return this.type === 'subscript';
  }
  isSuperscript(): boolean {
    return this.type === 'superscript';
  }
  isURL(): boolean {
    return this.type === 'url';
  }
}

const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

export class MARKUP_PARSER {
  private readonly src: string[];
  private pos = 0;

  constructor(source: string) {
    // `utf8::any` walks code points
    this.src = Array.from(source);
  }

  Parse(): NODE | null {
    const root = new NODE('root');

    // grammar : until< eof, anything >
    while (this.pos < this.src.length) {
      const node = this.anything();

      if (!node) {
        // couldn't parse text item
        return null;
      }

      if (node !== SKIPPED) root.children.push(node);
    }

    return root;
  }

  // ---- rules --------------------------------------------------------------

  /** `anything : sor< anyString, url, subscript, superscript, overbar >`. */
  private anything(): NODE | typeof SKIPPED | null {
    return (
      this.anyString() ?? this.url() ?? this.subscript() ?? this.superscript() ?? this.overbar()
    );
  }

  /** `anyString : plus< seq< not_at< markup >, not_at< url >, utf8::any > >`. */
  private anyString(): NODE | null {
    const start = this.pos;

    while (this.pos < this.src.length && !this.atMarkup() && !this.atUrl()) this.pos++;

    if (this.pos === start) return null;

    return new NODE('anyString', this.src.slice(start, this.pos).join(''));
  }

  /** `url : seq< sor< "http://", "https://" >, plus< utf8::not_one<' '> > >`. */
  private url(): NODE | null {
    const start = this.pos;

    if (!this.matchUrlAt(this.pos)) return null;

    this.pos = this.urlEnd(this.pos);

    return new NODE('url', this.src.slice(start, this.pos).join(''));
  }

  private matchUrlAt(at: number): boolean {
    return this.urlEnd(at) > at;
  }

  /** The end of a url starting at `at`, or `at` when there is none. */
  private urlEnd(at: number): number {
    const s = this.src;
    let i = at;
    const prefixes = ['http://', 'https://'];
    let matched = false;

    for (const p of prefixes) {
      const chars = Array.from(p);
      let ok = true;
      for (let k = 0; k < chars.length; k++) {
        if (s[i + k] !== chars[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        i += chars.length;
        matched = true;
        break;
      }
    }

    if (!matched) return at;

    const bodyStart = i;
    while (i < s.length && s[i] !== ' ') i++;

    if (i === bodyStart) return at;

    return i;
  }

  private atUrl(): boolean {
    return this.matchUrlAt(this.pos);
  }

  /** `markup : sor< subscript, superscript, overbar >` as a lookahead. */
  private atMarkup(): boolean {
    const save = this.pos;
    const node = this.subscript() ?? this.superscript() ?? this.overbar();
    this.pos = save;
    return node !== null;
  }

  private subscript(): NODE | typeof SKIPPED | null {
    return this.braces('_', 'subscript');
  }
  private superscript(): NODE | typeof SKIPPED | null {
    return this.braces('^', 'superscript');
  }
  private overbar(): NODE | typeof SKIPPED | null {
    return this.braces('~', 'overbar');
  }

  /**
   * `braces< C > : seq< C, '{', until< '}', sor< anyStringWithinBraces, subscript, superscript, overbar > > >`.
   * `discard_empty`: a node without children is dropped (SKIPPED), the input still consumed.
   */
  private braces(control: string, type: MARKUP_NODE_TYPE): NODE | typeof SKIPPED | null {
    const s = this.src;
    const save = this.pos;

    if (s[this.pos] !== control || s[this.pos + 1] !== '{') return null;

    this.pos += 2;

    const node = new NODE(type);

    for (;;) {
      if (this.pos >= s.length) {
        this.pos = save;
        return null;
      }

      if (s[this.pos] === '}') {
        this.pos++;
        break;
      }

      const child =
        this.anyStringWithinBraces() ?? this.subscript() ?? this.superscript() ?? this.overbar();

      if (child === null) {
        this.pos = save;
        return null;
      }

      if (child !== SKIPPED) node.children.push(child);
    }

    return node.children.length ? node : SKIPPED;
  }

  /**
   * `anyStringWithinBraces : plus< sor< seq< not_at< markup >, escapeSequence >,
   *                                      seq< not_at< markup >, utf8::not_one<'}'> > > >`.
   */
  private anyStringWithinBraces(): NODE | null {
    const s = this.src;
    const start = this.pos;

    for (;;) {
      if (this.pos >= s.length || this.atMarkup()) break;

      const esc = this.escapeSequenceEnd(this.pos);

      if (esc > this.pos) {
        this.pos = esc;
        continue;
      }

      if (s[this.pos] === '}') break;

      this.pos++;
    }

    if (this.pos === start) return null;

    return new NODE('anyStringWithinBraces', s.slice(start, this.pos).join(''));
  }

  /** `escapeSequence : seq< '{', identifier, '}' >`: its end, or `at` when absent. */
  private escapeSequenceEnd(at: number): number {
    const s = this.src;
    let i = at;

    if (s[i] !== '{') return at;
    i++;

    if (i >= s.length || !isIdentStart(s[i]!)) return at;
    i++;

    while (i < s.length && isIdentChar(s[i]!)) i++;

    if (s[i] !== '}') return at;

    return i + 1;
  }
}

/** A `discard_empty` node: matched and consumed, nothing kept. */
const SKIPPED = Symbol('discard_empty');
