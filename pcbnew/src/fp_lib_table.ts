// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `fp-lib-table` file format, and resolving a library nickname against it.
 * Counterparts: `LIBRARY_TABLE` (common/libraries/library_table.cpp),
 * `LIBRARY_TABLE_PARSER` (library_table_parser.cpp) over the PEGTL grammar in
 * `include/libraries/library_table_grammar.h`, and `LIBRARY_MANAGER::Rows` /
 * `GetRow` / `ExpandURI` (library_manager.cpp) — the code that used to be split
 * between `FP_LIB_TABLE` and `LIB_TABLE_BASE`.
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
 * grammar rule for rule rather than a reuse of `@ziroeda/sexpr`.
 *
 * `QUOTED_TEXT` is `if_must<one<'"'>, until<one<'"'>>>`, which has no escape
 * handling at all: a quoted value ends at the very next `"`, and a backslash is
 * an ordinary character. `\"` inside a value therefore truncates it — reproduced,
 * because a table written by KiCad and read back by us has to agree with KiCad.
 *
 * ## Project rows shadow global rows, but only by nickname
 *
 * `LIBRARY_MANAGER::Rows` walks the global table then the project table into a
 * map keyed by nickname while remembering first-appearance order. So the project
 * table replaces a global row of the same nickname *in the global row's
 * position*, and contributes its own rows at the end. Disabled rows are still
 * returned (only disabled *nested tables* are skipped) — callers that care must
 * filter, as `HasLibrary( …, aCheckEnabled )` does.
 */

import { fpidLibNickname } from './netlist_reader/pcb_netlist.js';

/** Which table a row came from; `LIBRARY_TABLE_SCOPE` minus the sentinels. */
export type LibraryTableScope = 'global' | 'project';

/** `LIBRARY_TABLE_TYPE`, from the file's own leading keyword. */
export type LibraryTableType = 'symbol' | 'footprint' | 'design_block';

/**
 * `LIBRARY_TABLE_ROW::TABLE_TYPE_NAME`. A row whose `type` is this names another
 * library table to splice in rather than a library. Compared case-sensitively
 * here (as `LIBRARY_MANAGER::Rows` does) even though `PCB_IO_MGR::EnumFromStr`
 * matches every *plugin* name case-insensitively.
 */
export const NESTED_TABLE_ROW_TYPE = 'Table';

/** `LIBRARY_TABLE_ROW`. */
export interface LibraryTableRow {
  nickname: string;
  uri: string;
  /** The IO plugin name (`KiCad`, `Legacy`, …) or `Table` for a nested table. */
  type: string;
  options: string;
  description: string;
  disabled: boolean;
  hidden: boolean;
  /** Cleared when a nested table this row points at could not be loaded. */
  ok: boolean;
  errorDescription?: string;
  scope: LibraryTableScope;
}

/** `LIBRARY_TABLE`. */
export interface LibraryTable {
  /** The file this was parsed from; empty when parsed from a buffer. */
  path: string;
  scope: LibraryTableScope;
  /** Undefined when the parse failed, or when the file was empty. */
  type?: LibraryTableType;
  /** `(version …)`, absent when missing or not an integer. */
  version?: number;
  ok: boolean;
  errorDescription?: string;
  /** 1-based position at which matching stopped, for a syntax error. */
  errorLine?: number;
  errorColumn?: number;
  rows: LibraryTableRow[];
}

/* -------------------------------------------------------------------------- */
/*  Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/** `tao::pegtl::space`, the grammar's separator class. */
const SPACE = new Set([' ', '\n', '\r', '\t', '\v', '\f']);

/**
 * `TOKEN`'s `not_one<'(', ')', ' ', '\t', '\n', '\r'>`. Deliberately not the
 * complement of SPACE: a vertical tab or form feed separates tokens for
 * `plus<space>` but is swallowed *into* an unquoted value by the greedy TOKEN.
 */
const TOKEN_STOP = new Set(['(', ')', ' ', '\t', '\n', '\r']);

const TABLE_TYPES: ReadonlyArray<readonly [string, LibraryTableType]> = [
  ['sym_lib_table', 'symbol'],
  ['fp_lib_table', 'footprint'],
  ['design_block_lib_table', 'design_block'],
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

interface RowIR {
  name: string;
  type: string;
  uri: string;
  options: string;
  descr: string;
  hidden: boolean;
  disabled: boolean;
}

const newRowIR = (): RowIR => ({
  name: '',
  type: '',
  uri: '',
  options: '',
  descr: '',
  hidden: false,
  disabled: false,
});

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
function libProperty(c: Cursor, row: RowIR): boolean {
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

  row[key] = value;

  if (!literal(c, ')')) {
    c.i = save;
    return false;
  }

  return true;
}

/** `LIB_ROW_MEMBER`, `sor<LIB_PROPERTY, HIDDEN_MARKER, DISABLED_MARKER>`. */
function libRowMember(c: Cursor, row: RowIR): boolean {
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
function libRow(c: Cursor, rows: RowIR[]): boolean {
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

interface TableIR {
  type?: LibraryTableType;
  version: string;
  rows: RowIR[];
}

/**
 * `LIB_TABLE_FILE`, `seq<LIB_TABLE, eof>`. `LIB_TABLE` opens on a bare `(` with
 * no leading `pad`, so so much as a blank line before it is a whole-file
 * rejection rather than a `must` violation.
 */
function libTableFile(c: Cursor, model: TableIR): boolean {
  if (!literal(c, '(')) return false;

  for (const [keyword, type] of TABLE_TYPES) {
    if (literal(c, keyword)) {
      model.type = type;
      break;
    }
  }

  if (model.type === undefined) throw new MustError(c.i);

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

/**
 * `boost::lexical_cast<int>` as `initFromIR` uses it: strict, so a stray space
 * or a trailing `.` yields no version at all rather than a partial read.
 */
function parseVersion(text: string): number | undefined {
  if (!/^[+-]?\d+$/.test(text)) return undefined;
  const value = Number(text);
  return value >= -2147483648 && value <= 2147483647 ? value : undefined;
}

/**
 * `LIBRARY_TABLE( aFromClipboard, aBuffer, aScope )`: parse a library table out
 * of text. A failure leaves `ok` false with no rows — upstream only calls
 * `initFromIR` on success, so a table with one bad row reports *nothing*, not
 * the rows before the bad one.
 */
export function parseLibraryTable(buffer: string, scope: LibraryTableScope): LibraryTable {
  const table: LibraryTable = { path: '', scope, ok: false, rows: [] };
  const c: Cursor = { s: buffer, i: 0 };
  const model: TableIR = { version: '', rows: [] };

  try {
    if (!libTableFile(c, model)) {
      table.errorDescription = 'An unexpected error occurred while reading library table';
      return table;
    }
  } catch (e) {
    if (!(e instanceof MustError)) throw e;
    const { line, column } = lineColumn(buffer, e.offset);
    table.errorDescription = `Syntax error at line ${line}, column ${column}`;
    table.errorLine = line;
    table.errorColumn = column;
    return table;
  }

  table.type = model.type;
  table.version = parseVersion(model.version);
  table.ok = true;

  for (const ir of model.rows) {
    table.rows.push({
      nickname: ir.name,
      uri: ir.uri,
      type: ir.type,
      options: ir.options,
      description: ir.descr,
      disabled: ir.disabled,
      hidden: ir.hidden,
      ok: true,
      scope,
    });
  }

  return table;
}

/* -------------------------------------------------------------------------- */
/*  The options column                                                         */
/* -------------------------------------------------------------------------- */

const OPT_SEP = '|';

/** ASCII `isspace`, the classification `ParseOptions` skips leading run with. */
const isSpace = (ch: string): boolean => ch === ' ' || (ch >= '\t' && ch <= '\r');

/**
 * `LIBRARY_TABLE::ParseOptions`: `a=1|b=2` into a map. Whitespace is skipped
 * only at the *start* of each pair, so `a = 1` gives the key `a ` and the value
 * ` 1`; a `\|` is an escaped separator; a pair with no `=` maps to the empty
 * string, which is how a valueless flag is recorded.
 */
export function parseLibraryTableOptions(optionsList: string): Map<string, string> {
  const props = new Map<string, string>();
  let cp = 0;
  const end = optionsList.length;

  while (cp < end) {
    let pair = '';

    while (cp < end && isSpace(optionsList[cp]!)) cp++;

    while (cp < end) {
      if (optionsList[cp] === '\\' && cp + 1 < end && optionsList[cp + 1] === OPT_SEP) {
        cp++;
        pair += optionsList[cp++];
      } else if (optionsList[cp] === OPT_SEP) {
        cp++;
        break;
      } else {
        pair += optionsList[cp++];
      }
    }

    if (pair.length === 0) continue;

    const eqNdx = pair.indexOf('=');

    if (eqNdx !== -1) props.set(pair.slice(0, eqNdx), pair.slice(eqNdx + 1));
    else props.set(pair, '');
  }

  return props;
}

/**
 * `LIBRARY_TABLE::FormatOptions`. Keys come out sorted because upstream walks a
 * `std::map`, and only the *value* has its separators escaped — a key
 * containing `|` is emitted raw and will not survive a re-parse.
 */
export function formatLibraryTableOptions(properties: ReadonlyMap<string, string>): string {
  let ret = '';

  for (const name of [...properties.keys()].sort()) {
    const value = properties.get(name)!;

    if (ret.length) ret += OPT_SEP;

    ret += name;

    if (value.length) {
      ret += '=';

      for (const ch of value) {
        if (ch === OPT_SEP) ret += '\\';
        ret += ch;
      }
    }
  }

  return ret;
}

/* -------------------------------------------------------------------------- */
/*  URI expansion                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Looks up one `${NAME}`. Upstream tries the project's text variables, then the
 * environment, then a same-base different-version fallback for the four
 * versioned KiCad path variables; all three write a value and stop, so one hook
 * in that order is behaviourally the same thing.
 */
export type UriVarResolver = (name: string) => string | undefined;

/** The variable-name character class: `wxIsalnum`, `_` and `:`. */
const isVarChar = (ch: string): boolean =>
  (ch >= '0' && ch <= '9') ||
  (ch >= 'a' && ch <= 'z') ||
  (ch >= 'A' && ch <= 'Z') ||
  ch === '_' ||
  ch === ':';

/**
 * `KIwxExpandEnvVars`, the substitution behind `ExpandEnvVarSubstitutions`.
 * `${NAME}`, `$(NAME)` and bare `$NAME` are all accepted; an unresolved
 * reference is re-emitted verbatim rather than blanked, which is what keeps a
 * board openable on a machine that is missing an environment variable.
 *
 * Two edge behaviours are upstream's and are reproduced. A `$` as the final
 * character of the string is *dropped*, because the routine breaks out of its
 * switch before appending anything. And a `\` suppresses a following `$` (or
 * `%`), which is why a Windows-style path is not safe to feed in unescaped.
 *
 * The trailing re-expansion pass lets one variable expand into another; it is
 * guarded by an insert-once set, so a variable whose value is its own reference
 * terminates instead of recursing.
 */
export function expandEnvVarSubstitutions(
  text: string,
  resolve: UriVarResolver,
  seen?: Set<string>,
): string {
  if (seen) {
    if (seen.has(text)) return text;
    seen.add(text);
  }

  const len = text.length;
  let result = '';

  for (let n = 0; n < len; n++) {
    let ch = text[n]!;

    if (ch === '\\') {
      if (n < len - 1 && (text[n + 1] === '%' || text[n + 1] === '$')) {
        ch = text[++n]!;
        result += ch;
        continue;
      }

      result += ch;
      continue;
    }

    if (ch !== '$') {
      result += ch;
      continue;
    }

    // '$' opens a reference. The bracket, if any, is consumed here so `ch`
    // becomes the bracket character and `text[n - 1]` is the dollar itself.
    let bracket = '';

    if (n !== len - 1) {
      if (text[n + 1] === '(') {
        bracket = ')';
        ch = text[++n]!;
      } else if (text[n + 1] === '{') {
        bracket = '}';
        ch = text[++n]!;
      }
    }

    let m = n + 1;

    // A trailing '$' with nothing after it is silently swallowed.
    if (m >= len) break;

    while (m < len && isVarChar(text[m]!)) m++;

    const varName = text.slice(n + 1, m);
    const value = resolve(varName);
    const expanded = value !== undefined;

    if (expanded) {
      result += value;
    } else {
      // Variable doesn't exist => don't change anything.
      if (bracket !== '') result += text[n - 1];
      result += ch + varName;
    }

    if (bracket !== '') {
      if (m !== len && text[m] === bracket) {
        if (!expanded) result += bracket;
        m++;
      }
      // A missing closing bracket only warns upstream; the text is left as is.
    }

    n = m - 1;
  }

  const firstPos = result.search(/[{(%]/);
  const lastPos = lastIndexOfAny(result, '})%');

  if (firstPos !== -1 && lastPos !== -1 && firstPos !== lastPos)
    result = expandEnvVarSubstitutions(result, resolve, seen ?? new Set<string>());

  return result;
}

function lastIndexOfAny(s: string, chars: string): number {
  for (let i = s.length - 1; i >= 0; i--) if (chars.includes(s[i]!)) return i;
  return -1;
}

/**
 * `LIBRARY_MANAGER::GetFullURI( aRow, aSubstituted )` — the row's URI, expanded
 * only when a resolver is supplied.
 */
export function libraryRowFullUri(row: LibraryTableRow, resolve?: UriVarResolver): string {
  return resolve ? expandEnvVarSubstitutions(row.uri, resolve) : row.uri;
}

/**
 * `LIBRARY_MANAGER::ExpandURI`: expand, then make absolute. The URI in the table
 * is normally already absolute once `${KICAD9_FOOTPRINT_DIR}` or `${KIPRJMOD}`
 * has been substituted; `cwd` is what a genuinely relative one is resolved
 * against, mirroring `wxFileName::MakeAbsolute()` with no argument.
 */
export function expandLibraryUri(uri: string, resolve: UriVarResolver, cwd: string): string {
  return absolutePath(expandEnvVarSubstitutions(uri, resolve), cwd);
}

/**
 * `wxFileName::MakeAbsolute( aBase )` for POSIX paths: join against the base
 * when relative, then collapse `.` and `..`.
 */
export function absolutePath(path: string, base: string): string {
  const joined = path.startsWith('/') ? path : `${base}/${path}`;
  const out: string[] = [];

  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }

  return `/${out.join('/')}`;
}

/* -------------------------------------------------------------------------- */
/*  Flattening the tables into one list of libraries                           */
/* -------------------------------------------------------------------------- */

/** The tables `LIBRARY_MANAGER::Rows` walks, in the order it walks them. */
export interface LibraryTableSet {
  global?: LibraryTable;
  project?: LibraryTable;
  /**
   * `m_childTables`: nested tables keyed by the *unexpanded* URI of the row that
   * pulled them in, which is how upstream looks them back up.
   */
  children?: ReadonlyMap<string, LibraryTable>;
}

/**
 * `LIBRARY_MANAGER::Rows( FOOTPRINT, BOTH, aIncludeInvalid )`: every library
 * reachable from the two tables, project rows shadowing global rows of the same
 * nickname while keeping the global row's position.
 *
 * Nested tables are spliced in place, and a hidden nested-table row *writes*
 * `hidden` onto every row of the table it names — upstream propagates by
 * mutating the child rows, so the flag sticks to the table afterwards rather
 * than being a property of this call's result. A disabled nested table is
 * skipped entirely; a disabled ordinary library is not.
 */
export function flattenLibraryRows(
  tables: LibraryTableSet,
  includeInvalid = false,
): LibraryTableRow[] {
  const rows = new Map<string, LibraryTableRow>();
  const rowOrder: string[] = [];
  const children = tables.children ?? new Map<string, LibraryTable>();

  const processTable = (table: LibraryTable, parentHidden: boolean): void => {
    if (!table.ok && !includeInvalid) return;

    for (const row of table.rows) {
      if (!row.ok && !includeInvalid) continue;

      if (parentHidden) row.hidden = true;

      if (row.type === NESTED_TABLE_ROW_TYPE) {
        const child = children.get(row.uri);
        if (child === undefined) continue;
        if (row.disabled) continue;
        processTable(child, row.hidden);
      } else {
        if (!rows.has(row.nickname)) rowOrder.push(row.nickname);
        rows.set(row.nickname, row);
      }
    }
  };

  if (tables.global) processTable(tables.global, false);
  if (tables.project) processTable(tables.project, false);

  return rowOrder.map((nickname) => rows.get(nickname)!);
}

/**
 * `LIBRARY_MANAGER::GetRow`. Note the `true`: a row whose nested table failed to
 * load is still findable by nickname, so the caller can report *why* a library
 * is unusable instead of "no such library".
 */
export function findLibraryRow(
  tables: LibraryTableSet,
  nickname: string,
): LibraryTableRow | undefined {
  return flattenLibraryRows(tables, true).find((row) => row.nickname === nickname);
}

/**
 * The library row a `LIB_ID` ("Library:Footprint") names, or undefined when the
 * nickname is absent from both tables. A legacy LIB_ID carrying no nickname
 * resolves against the empty nickname and so finds nothing, which is upstream's
 * "footprint library not enabled" case rather than a search across libraries.
 */
export function findLibraryRowForFpid(
  tables: LibraryTableSet,
  fpid: string,
): LibraryTableRow | undefined {
  return findLibraryRow(tables, fpidLibNickname(fpid));
}
