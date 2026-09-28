// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIBRARY_TABLE_PARSER` (common/libraries/library_table_parser.cpp,
 * include/libraries/library_table_parser.h) over the PEGTL grammar in
 * `include/libraries/library_table_grammar.h`: a library table's text into
 * `LIBRARY_TABLE_IR`, or a `LIBRARY_PARSE_ERROR`. Moved here from
 * pcbnew/fp_lib_table.ts on 09-27, when LIBRARY_TABLE itself was ported.
 *
 * ## The grammar is far stricter than it looks
 *
 * A library table is s-expressions, but it is *not* parsed by the general
 * s-expression reader, so the general reader's tolerances do not apply and a
 * file the board reader would swallow is rejected here. `LIB_PROPERTY` is
 * `seq<LPAREN, KEY, plus<space>, PROPERTY_VALUE, RPAREN>` with no padding
 * anywhere except between key and value, so `(name foo )` and `( name foo)` are
 * both syntax errors; so is `(hidden )`. There is no recovery: one malformed
 * row fails the whole table, which then reports zero libraries rather than the
 * ones it could read. That is why this is a hand-written matcher mirroring the
 * grammar rule for rule rather than a reuse of `@ziroeda/sexpr` (writing goes
 * through the shared XNODE / OUTPUTFORMATTER, as upstream's does).
 *
 * `QUOTED_TEXT` is `if_must<one<'"'>, until<one<'"'>>>`, which has no escape
 * handling at all: a quoted value ends at the very next `"`, and a backslash is
 * an ordinary character. `\"` inside a value therefore truncates it — reproduced,
 * because a table written by KiCad and read back by us has to agree with KiCad.
 */
import { LIBRARY_TABLE_TYPE } from './library_table.js';

/** `LIBRARY_TABLE_ROW_IR`. */
export interface LIBRARY_TABLE_ROW_IR {
  nickname: string;
  uri: string;
  type: string;
  options: string;
  description: string;
  disabled: boolean;
  hidden: boolean;
}

/** `LIBRARY_TABLE_IR`. */
export interface LIBRARY_TABLE_IR {
  version: string;
  type: LIBRARY_TABLE_TYPE;
  rows: LIBRARY_TABLE_ROW_IR[];
}

/** `LIBRARY_PARSE_ERROR`; `line` / `column` are 1-based, 0 when not a syntax error. */
export interface LIBRARY_PARSE_ERROR {
  description: string;
  line: number;
  column: number;
}

/** `tl::expected<LIBRARY_TABLE_IR, LIBRARY_PARSE_ERROR>`. */
export type LIBRARY_PARSE_RESULT =
  | { ok: true; value: LIBRARY_TABLE_IR }
  | { ok: false; error: LIBRARY_PARSE_ERROR };

/** `tao::pegtl::space`, the grammar's separator class. */
const SPACE = new Set([' ', '\n', '\r', '\t', '\v', '\f']);

/**
 * `TOKEN`'s `not_one<'(', ')', ' ', '\t', '\n', '\r'>`. Deliberately not the
 * complement of SPACE: a vertical tab or form feed separates tokens for
 * `plus<space>` but is swallowed *into* an unquoted value by the greedy TOKEN.
 */
const TOKEN_STOP = new Set(['(', ')', ' ', '\t', '\n', '\r']);

/**
 * The leading keywords, in the grammar's `sor` order. A function, not a
 * constant: `library_table.ts` imports this module, and the enum it defines is
 * not initialised yet while this one is being evaluated.
 */
const tableTypes = (): ReadonlyArray<readonly [string, LIBRARY_TABLE_TYPE]> => [
  ['sym_lib_table', LIBRARY_TABLE_TYPE.SYMBOL],
  ['fp_lib_table', LIBRARY_TABLE_TYPE.FOOTPRINT],
  ['design_block_lib_table', LIBRARY_TABLE_TYPE.DESIGN_BLOCK],
];

/** `LIB_PROPERTY_KEY`, in the grammar's `sor` order. */
const PROPERTY_KEYS = ['name', 'type', 'uri', 'options', 'descr'] as const;
type PropertyKey = (typeof PROPERTY_KEYS)[number];

/** A `must<>` violation: everything after it is unreachable, the table is lost. */
class MustError {
  constructor(readonly offset: number) {}
}

interface Cursor {
  readonly s: string;
  i: number;
}

const newRowIR = (): LIBRARY_TABLE_ROW_IR => ({
  nickname: '',
  uri: '',
  type: '',
  options: '',
  description: '',
  disabled: false,
  hidden: false,
});

/** The IR member each `LIB_PROPERTY_KEY`'s action writes. */
const PROPERTY_FIELD = {
  name: 'nickname',
  type: 'type',
  uri: 'uri',
  options: 'options',
  descr: 'description',
} as const satisfies Record<PropertyKey, keyof LIBRARY_TABLE_ROW_IR>;

function literal(c: Cursor, text: string): boolean {
  if (!c.s.startsWith(text, c.i)) return false;
  c.i += text.length;
  return true;
}

/** `star<space>`. */
function starSpace(c: Cursor): void {
  while (c.i < c.s.length && SPACE.has(c.s[c.i]!)) c.i++;
}

/** `plus<space>`. */
function plusSpace(c: Cursor): boolean {
  const start = c.i;
  starSpace(c);
  return c.i > start;
}

/**
 * `PROPERTY_VALUE`, `sor<QUOTED_TEXT, TOKEN>`. Returns null when neither matches.
 * A `"` with no partner is a `must` violation, not a fall-through to TOKEN,
 * because QUOTED_TEXT is an `if_must`.
 */
function propertyValue(c: Cursor): string | null {
  if (c.s[c.i] === '"') {
    const end = c.s.indexOf('"', c.i + 1);
    if (end === -1) throw new MustError(c.s.length);
    const value = c.s.slice(c.i + 1, end);
    c.i = end + 1;
    return value;
  }

  const start = c.i;
  while (c.i < c.s.length && !TOKEN_STOP.has(c.s[c.i]!)) c.i++;
  return c.i > start ? c.s.slice(start, c.i) : null;
}

/**
 * `LIB_PROPERTY`. The value is stored the moment PROPERTY_VALUE matches, before
 * the closing paren is checked, because a PEGTL action fires on its own rule's
 * success and is not undone when an enclosing rule backtracks. No successful
 * parse can observe the difference — the only way past a failed LIB_PROPERTY is
 * a `must` violation a few rules up — but the write happening early is what the
 * upstream state machine does.
 */
function libProperty(c: Cursor, row: LIBRARY_TABLE_ROW_IR): boolean {
  const save = c.i;

  if (!literal(c, '(')) return false;

  let key: PropertyKey | undefined;
  for (const k of PROPERTY_KEYS) {
    if (literal(c, k)) {
      key = k;
      break;
    }
  }

  if (key === undefined || !plusSpace(c)) {
    c.i = save;
    return false;
  }

  const value = propertyValue(c);

  if (value === null) {
    c.i = save;
    return false;
  }

  row[PROPERTY_FIELD[key]] = value;

  if (!literal(c, ')')) {
    c.i = save;
    return false;
  }

  return true;
}

/** `LIB_ROW_MEMBER`, `sor<LIB_PROPERTY, HIDDEN_MARKER, DISABLED_MARKER>`. */
function libRowMember(c: Cursor, row: LIBRARY_TABLE_ROW_IR): boolean {
  if (libProperty(c, row)) return true;

  if (literal(c, '(hidden)')) {
    row.hidden = true;
    return true;
  }

  if (literal(c, '(disabled)')) {
    row.disabled = true;
    return true;
  }

  return false;
}

/** `LIB_ROW`, an `if_must`: once the opening paren is seen, `lib` is compulsory. */
function libRow(c: Cursor, rows: LIBRARY_TABLE_ROW_IR[]): boolean {
  const save = c.i;
  starSpace(c);

  if (!literal(c, '(')) {
    c.i = save;
    return false;
  }

  starSpace(c);

  if (!literal(c, 'lib') || !plusSpace(c)) throw new MustError(c.i);

  const row = newRowIR();
  let members = 0;

  for (;;) {
    const mark = c.i;
    starSpace(c);

    if (!libRowMember(c, row)) {
      c.i = mark;
      break;
    }

    starSpace(c);
    members++;
  }

  if (members === 0) throw new MustError(c.i);

  starSpace(c);

  if (!literal(c, ')')) throw new MustError(c.i);

  starSpace(c);
  rows.push(row);
  return true;
}

/** `TABLE_VERSION`, a plain `seq` so it simply backtracks when absent. */
function tableVersion(c: Cursor): string | null {
  const save = c.i;

  if (!literal(c, '(') || !literal(c, 'version') || !plusSpace(c)) {
    c.i = save;
    return null;
  }

  const value = propertyValue(c);

  if (value === null || !literal(c, ')')) {
    c.i = save;
    return null;
  }

  return value;
}

/**
 * `LIB_TABLE_FILE`, `seq<LIB_TABLE, eof>`. `LIB_TABLE` opens on a bare `(` with
 * no leading `pad`, so so much as a blank line before it is a whole-file
 * rejection rather than a `must` violation.
 */
function libTableFile(c: Cursor, model: LIBRARY_TABLE_IR): boolean {
  if (!literal(c, '(')) return false;

  for (const [keyword, type] of tableTypes()) {
    if (literal(c, keyword)) {
      model.type = type;
      break;
    }
  }

  if (model.type === LIBRARY_TABLE_TYPE.UNINITIALIZED) throw new MustError(c.i);

  // pad_opt< TABLE_VERSION, space >
  starSpace(c);
  const version = tableVersion(c);
  if (version !== null) {
    model.version = version;
    starSpace(c);
  }

  while (libRow(c, model.rows));

  starSpace(c);

  if (!literal(c, ')')) throw new MustError(c.i);

  starSpace(c);
  return c.i === c.s.length;
}

function lineColumn(s: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;

  for (let i = 0; i < offset; i++) {
    if (s[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }

  return { line, column: offset - lineStart + 1 };
}

/** `LIBRARY_TABLE_PARSER`. */
export class LIBRARY_TABLE_PARSER {
  /**
   * `Parse( aPath )`. The browser has no file to open, so the caller hands
   * over the file's text with its path; the path only names it in the message.
   */
  Parse(aPath: string, aText: string): LIBRARY_PARSE_RESULT {
    return this.parse(aText, `An unexpected error occurred while reading library table ${aPath} `);
  }

  /** `ParseBuffer( aBuffer )`. */
  ParseBuffer(aBuffer: string): LIBRARY_PARSE_RESULT {
    return this.parse(aBuffer, 'An unexpected error occurred while reading library table');
  }

  private parse(aText: string, aUnexpected: string): LIBRARY_PARSE_RESULT {
    const c: Cursor = { s: aText, i: 0 };
    const model: LIBRARY_TABLE_IR = {
      version: '',
      type: LIBRARY_TABLE_TYPE.UNINITIALIZED,
      rows: [],
    };

    try {
      if (!libTableFile(c, model))
        return { ok: false, error: { description: aUnexpected, line: 0, column: 0 } };
    } catch (e) {
      if (!(e instanceof MustError)) throw e;

      const { line, column } = lineColumn(aText, e.offset);
      return {
        ok: false,
        error: { description: `Syntax error at line ${line}, column ${column}`, line, column },
      };
    }

    return { ok: true, value: model };
  }
}
