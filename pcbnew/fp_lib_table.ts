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
 * The table itself - its parser and its grammar, which is far stricter than
 * the general s-expression reader - is `common/libraries/`; this file keeps
 * the plain record the resolution below walks.
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

import { LIBRARY_TABLE_TYPE } from '@ziroeda/common/libraries/library_table.js';
import { LIBRARY_TABLE_PARSER } from '@ziroeda/common/libraries/library_table_parser.js';
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

/** `boost::lexical_cast<int>` as `initFromIR` uses it: strict, all or nothing. */
function lexicalCastInt(text: string): number | undefined {
  if (!/^[+-]?\d+$/.test(text)) return undefined;
  const value = Number(text);
  return value >= -2147483648 && value <= 2147483647 ? value : undefined;
}

const TABLE_TYPE_NAMES = new Map<LIBRARY_TABLE_TYPE, LibraryTableType>([
  [LIBRARY_TABLE_TYPE.SYMBOL, 'symbol'],
  [LIBRARY_TABLE_TYPE.FOOTPRINT, 'footprint'],
  [LIBRARY_TABLE_TYPE.DESIGN_BLOCK, 'design_block'],
]);

/**
 * `LIBRARY_TABLE( aFromClipboard, aBuffer, aScope )`: parse a library table out
 * of text, through the shared LIBRARY_TABLE_PARSER, into the plain record the
 * flattening below walks. A failure leaves `ok` false with no rows — upstream
 * only calls `initFromIR` on success, so a table with one bad row reports
 * *nothing*, not the rows before the bad one.
 */
export function parseLibraryTable(buffer: string, scope: LibraryTableScope): LibraryTable {
  const table: LibraryTable = { path: '', scope, ok: false, rows: [] };
  const ir = new LIBRARY_TABLE_PARSER().ParseBuffer(buffer);

  if (!ir.ok) {
    table.errorDescription = ir.error.description;

    if (ir.error.line > 0) {
      table.errorLine = ir.error.line;
      table.errorColumn = ir.error.column;
    }

    return table;
  }

  // LIBRARY_TABLE::initFromIR.
  table.type = TABLE_TYPE_NAMES.get(ir.value.type);
  table.version = lexicalCastInt(ir.value.version);
  table.ok = true;

  for (const row of ir.value.rows) {
    table.rows.push({
      nickname: row.nickname,
      uri: row.uri,
      type: row.type,
      options: row.options,
      description: row.description,
      disabled: row.disabled,
      hidden: row.hidden,
      ok: true,
      scope,
    });
  }

  return table;
}

// The options column's parser and formatter are LIBRARY_TABLE's
// (common/libraries/library_table.cpp), so they live in common/.
export {
  formatLibraryTableOptions,
  parseLibraryTableOptions,
} from '@ziroeda/common/libraries/library_table.js';
import {
  formatLibraryTableOptions,
  parseLibraryTableOptions,
} from '@ziroeda/common/libraries/library_table.js';

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
