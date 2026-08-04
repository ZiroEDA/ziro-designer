// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `fp-lib-table` format and the row lookup built on it.
 *
 * Two things drive these tests. The grammar is a PEGTL grammar with no error
 * recovery, so the interesting cases are the ones where a file that *looks*
 * fine is rejected outright and the user sees no libraries at all — those have
 * to be reproduced, not smoothed over. And the flattening of the global and
 * project tables decides which library a `LIB_ID` actually resolves to, so the
 * shadowing order is asserted directly rather than through a caller.
 */
import { describe, expect, it } from 'vitest';
import {
  NESTED_TABLE_ROW_TYPE,
  expandEnvVarSubstitutions,
  expandLibraryUri,
  findLibraryRow,
  findLibraryRowForFpid,
  flattenLibraryRows,
  formatLibraryTableOptions,
  libraryRowFullUri,
  parseLibraryTable,
  parseLibraryTableOptions,
  type LibraryTable,
  type LibraryTableRow,
} from '@ziroeda/pcbnew/src/fp_lib_table.js';

const REAL_TABLE = `(fp_lib_table
  (version 7)
  (lib (name "LED_SMD")(type "KiCad")(uri "\${KICAD9_FOOTPRINT_DIR}/LED_SMD.pretty")(options "")(descr ""))
  (lib (name "Local")(type "KiCad")(uri "\${KIPRJMOD}/lib.pretty")(options "pad_to_mask=1")(descr "project parts"))
)
`;

/** A row with everything filled in, for the flattening tests. */
const row = (over: Partial<LibraryTableRow> & { nickname: string }): LibraryTableRow => ({
  uri: `/libs/${over.nickname}.pretty`,
  type: 'KiCad',
  options: '',
  description: '',
  disabled: false,
  hidden: false,
  ok: true,
  scope: 'global',
  ...over,
});

const table = (rows: LibraryTableRow[], over: Partial<LibraryTable> = {}): LibraryTable => ({
  path: '/p/fp-lib-table',
  scope: 'global',
  type: 'footprint',
  ok: true,
  rows,
  ...over,
});

describe('parseLibraryTable', () => {
  it('reads the rows of a table KiCad wrote', () => {
    const t = parseLibraryTable(REAL_TABLE, 'global');

    // If this fails nothing downstream works: no libraries are visible at all.
    expect(t.ok).toBe(true);
    expect(t.type).toBe('footprint');
    expect(t.version).toBe(7);
    expect(t.rows.map((r) => r.nickname)).toEqual(['LED_SMD', 'Local']);
    // Every column has to land in its own field; swapping uri and descr would
    // still "parse" but would point the loader at nothing.
    expect(t.rows[1]).toMatchObject({
      nickname: 'Local',
      type: 'KiCad',
      uri: '${KIPRJMOD}/lib.pretty',
      options: 'pad_to_mask=1',
      description: 'project parts',
      scope: 'global',
      disabled: false,
      hidden: false,
      ok: true,
    });
  });

  it('loses the whole table over one stray space inside a property', () => {
    const t = parseLibraryTable('(fp_lib_table (lib (name "A")(type KiCad)(uri u )))', 'global');

    // LIB_PROPERTY is a bare `seq` with padding only between key and value, so
    // `(uri u )` is a syntax error. Accepting it would make us read files KiCad
    // refuses, and the user would only find out when KiCad opened the project.
    expect(t.ok).toBe(false);
    expect(t.rows).toEqual([]);
    // Not a partial read: a table with one bad row reports nothing, not even
    // the rows that parsed cleanly before it.
    expect(t.type).toBeUndefined();
  });

  it('does allow padding around a whole row and its members', () => {
    // The strictness stops at the property. LIB_ROW pads its members and its
    // own closing paren, so this is the same table, well formed. Tightening the
    // row rule to match the property rule would reject files KiCad accepts.
    const t = parseLibraryTable('(fp_lib_table\n ( lib (name "A") (uri u) )\n)', 'global');

    expect(t.ok).toBe(true);
    expect(t.rows[0]).toMatchObject({ nickname: 'A', uri: 'u' });
  });

  it('rejects a padded (hidden ) marker for the same reason', () => {
    expect(parseLibraryTable('(fp_lib_table (lib (name A)(hidden )))', 'global').ok).toBe(false);
    // The unpadded form is the one that works.
    const t = parseLibraryTable('(fp_lib_table (lib (name A)(hidden)(disabled)))', 'global');
    expect(t.rows[0]).toMatchObject({
      nickname: 'A',
      hidden: true,
      disabled: true,
    });
  });

  it('treats a backslash inside a quoted value as an ordinary character', () => {
    const t = parseLibraryTable('(fp_lib_table (lib (name A)(descr "a\\")))', 'global');

    // QUOTED_TEXT is `until<one<\'"\'>>` — no escape handling whatsoever. The
    // value ends at the next quote and keeps the backslash. Adding escape
    // handling here would silently disagree with what KiCad reads back.
    expect(t.ok).toBe(true);
    expect(t.rows[0]?.description).toBe('a\\');
  });

  it('reports an unterminated quote as a syntax error at the right line', () => {
    const t = parseLibraryTable('(fp_lib_table\n  (lib (name "A)\n)', 'global');

    expect(t.ok).toBe(false);
    // A `must` violation is reported with a position; a plain non-match is not.
    // Conflating the two would leave the user with no idea where to look.
    expect(t.errorDescription).toMatch(/^Syntax error at line \d+, column \d+$/);
    expect(t.errorLine).toBe(3);
  });

  it('rejects a leading blank line without calling it a syntax error', () => {
    const t = parseLibraryTable('\n(fp_lib_table)', 'global');

    // LIB_TABLE opens on a bare LPAREN with no pad, so this is an outright
    // non-match rather than a `must` violation, and upstream words it
    // differently. The two messages are the two failure modes.
    expect(t.ok).toBe(false);
    expect(t.errorDescription).toBe('An unexpected error occurred while reading library table');
    expect(t.errorLine).toBeUndefined();
  });

  it('reports nothing when the file has trailing junk after the table', () => {
    const t = parseLibraryTable('(fp_lib_table (lib (name A))) leftover', 'global');

    // The other failure path: the table itself matched and its rows were
    // collected, but LIB_TABLE_FILE demands eof. Upstream only builds the table
    // from a *successful* parse, so a truncated-then-appended file must report
    // zero libraries rather than the ones it happened to read first.
    expect(t.ok).toBe(false);
    expect(t.rows).toEqual([]);
    expect(t.type).toBeUndefined();
  });

  it('keeps a vertical tab inside an unquoted value', () => {
    const t = parseLibraryTable('(fp_lib_table (lib (name A)(descr a\vb)))', 'global');

    // TOKEN excludes space, tab, CR and LF but not VT or FF, even though all
    // six separate tokens for `plus<space>`. Deriving one set from the other
    // would split this value in half.
    expect(t.rows[0]?.description).toBe('a\vb');
  });

  it('lets a repeated key overwrite the earlier one', () => {
    const t = parseLibraryTable('(fp_lib_table (lib (name A)(name B)))', 'global');

    // Each key action just re-points the write target, so the last wins.
    expect(t.rows[0]?.nickname).toBe('B');
  });

  it('accepts a non-numeric version rather than failing the table', () => {
    const bad = parseLibraryTable('(fp_lib_table (version x))', 'global');

    // The grammar takes any PROPERTY_VALUE; it is the lexical_cast afterwards
    // that gives up. Failing the parse instead would make an old table with a
    // hand-edited version unopenable.
    expect(bad.ok).toBe(true);
    expect(bad.version).toBeUndefined();
    expect(parseLibraryTable('(fp_lib_table)', 'global').version).toBeUndefined();
    expect(parseLibraryTable('(fp_lib_table (version 007))', 'global').version).toBe(7);
    // lexical_cast is strict about surrounding junk.
    expect(parseLibraryTable('(fp_lib_table (version "7 "))', 'global').version).toBeUndefined();
  });

  it('stamps every row with the scope it was read for', () => {
    const t = parseLibraryTable('(fp_lib_table (lib (name A)))', 'project');

    // The scope is what tells a caller whether a row can be edited in the
    // project's own table; a mislabelled row would be saved to the wrong file.
    expect(t.rows[0]?.scope).toBe('project');
  });
});

describe('library table options', () => {
  it('splits on unescaped bars and on the first equals only', () => {
    const opts = parseLibraryTableOptions('a=1|b=2=3|flag|c\\|d=4');

    expect(opts.get('a')).toBe('1');
    // Only the *first* equals separates; a value may contain more.
    expect(opts.get('b')).toBe('2=3');
    // A pair with no equals is present with an empty value, which is not the
    // same as being absent.
    expect(opts.get('flag')).toBe('');
    // `\|` is an escaped separator and the backslash disappears.
    expect(opts.get('c|d')).toBe('4');
  });

  it('trims whitespace only from the front of a pair', () => {
    const opts = parseLibraryTableOptions('  a = 1 ');

    // Upstream skips leading space per pair and nothing else, so the key keeps
    // its trailing space. Trimming both ends would invent a key KiCad never
    // writes and quietly change which option a plugin sees.
    expect([...opts]).toEqual([['a ', ' 1 ']]);
  });

  it('formats back sorted, escaping separators in values but not in keys', () => {
    const text = formatLibraryTableOptions(
      new Map([
        ['z', 'last'],
        ['a', 'x|y'],
        ['flag', ''],
      ]),
    );

    // std::map iteration order is the key order, and only values are escaped.
    expect(text).toBe('a=x\\|y|flag|z=last');
    // Which means the escaping round-trips.
    expect(parseLibraryTableOptions(text).get('a')).toBe('x|y');
  });
});

describe('expandEnvVarSubstitutions', () => {
  const vars: Record<string, string> = {
    KIPRJMOD: '/proj',
    A: '${B}',
    B: '/deep',
    SELF: '${SELF}',
  };
  const resolve = (name: string): string | undefined => vars[name];

  it('accepts all three reference forms', () => {
    // A table may carry any of these; missing one form would break real files.
    expect(expandEnvVarSubstitutions('${KIPRJMOD}/lib.pretty', resolve)).toBe('/proj/lib.pretty');
    expect(expandEnvVarSubstitutions('$(KIPRJMOD)/lib.pretty', resolve)).toBe('/proj/lib.pretty');
    expect(expandEnvVarSubstitutions('$KIPRJMOD/lib.pretty', resolve)).toBe('/proj/lib.pretty');
  });

  it('leaves an unknown reference exactly as it found it', () => {
    // This is what keeps a board openable on a machine missing an environment
    // variable: the URI stays legible instead of collapsing to "/lib.pretty".
    expect(expandEnvVarSubstitutions('${NOPE}/lib.pretty', resolve)).toBe('${NOPE}/lib.pretty');
    expect(expandEnvVarSubstitutions('$NOPE/lib.pretty', resolve)).toBe('$NOPE/lib.pretty');
  });

  it('swallows a trailing dollar sign', () => {
    // Upstream breaks out of its switch before appending anything when there is
    // no room left for a name. It reads as a bug and is reproduced.
    expect(expandEnvVarSubstitutions('/libs$', resolve)).toBe('/libs');
    expect(expandEnvVarSubstitutions('${', resolve)).toBe('');
  });

  it('honours a backslash escape only until the re-expansion pass undoes it', () => {
    // The escape suppresses the dollar on the first pass and is then consumed,
    // so a *braced* reference is left looking exactly like an unescaped one and
    // the trailing recursion expands it after all. The escape only survives
    // where there is nothing brace-like left to trigger that pass.
    expect(expandEnvVarSubstitutions('\\${KIPRJMOD}', resolve)).toBe('/proj');
    expect(expandEnvVarSubstitutions('\\$KIPRJMOD', resolve)).toBe('$KIPRJMOD');
    // A backslash before anything else is an ordinary character.
    expect(expandEnvVarSubstitutions('a\\b${KIPRJMOD}', resolve)).toBe('a\\b/proj');
  });

  it('re-expands a variable whose value is another reference', () => {
    // The trailing recursion pass is the only thing that makes indirection
    // work; without it the URI would come back as the literal "${B}".
    expect(expandEnvVarSubstitutions('${A}/x', resolve)).toBe('/deep/x');
  });

  it('terminates on a self-referential variable', () => {
    // The insert-once guard, not a depth counter. Losing it hangs the app.
    expect(expandEnvVarSubstitutions('${SELF}', resolve)).toBe('${SELF}');
  });

  it('makes a relative URI absolute against the working directory', () => {
    expect(expandLibraryUri('${KIPRJMOD}/a/../lib.pretty', resolve, '/cwd')).toBe(
      '/proj/lib.pretty',
    );
    expect(expandLibraryUri('rel.pretty', resolve, '/cwd')).toBe('/cwd/rel.pretty');
  });

  it('only substitutes into a row URI when asked to', () => {
    const r = row({ nickname: 'A', uri: '${KIPRJMOD}/a.pretty' });

    // GetFullURI's aSubstituted defaults to false, and the unsubstituted form is
    // what has to be written back to the table.
    expect(libraryRowFullUri(r)).toBe('${KIPRJMOD}/a.pretty');
    expect(libraryRowFullUri(r, resolve)).toBe('/proj/a.pretty');
  });
});

describe('flattenLibraryRows', () => {
  it('lets a project row shadow a global one without moving it', () => {
    const global = table([row({ nickname: 'A' }), row({ nickname: 'B' })]);
    const project = table(
      [
        row({ nickname: 'B', uri: '/proj/B.pretty', scope: 'project' }),
        row({ nickname: 'C', scope: 'project' }),
      ],
      { scope: 'project' },
    );

    const rows = flattenLibraryRows({ global, project });

    // Order is first-appearance, value is last-write. Appending the project row
    // instead would reorder the library list under the user every time a
    // project happened to override a stock library.
    expect(rows.map((r) => r.nickname)).toEqual(['A', 'B', 'C']);
    expect(rows[1]?.uri).toBe('/proj/B.pretty');
    expect(rows[1]?.scope).toBe('project');
  });

  it('keeps a disabled library but drops a disabled nested table', () => {
    const nested = table([row({ nickname: 'Inner' })]);
    const global = table([
      row({ nickname: 'Off', disabled: true }),
      row({
        nickname: 'ignored',
        type: NESTED_TABLE_ROW_TYPE,
        uri: '/n',
        disabled: true,
      }),
    ]);

    const rows = flattenLibraryRows({
      global,
      children: new Map([['/n', nested]]),
    });

    // The disabled check sits inside the nested-table branch only. Filtering
    // disabled libraries here would hide them from Manage Footprint Libraries,
    // which is the one place they must stay visible.
    expect(rows.map((r) => r.nickname)).toEqual(['Off']);
  });

  it('splices a nested table in at the referencing row position', () => {
    const nested = table([row({ nickname: 'N1' }), row({ nickname: 'N2' })]);
    const global = table([
      row({ nickname: 'A' }),
      row({
        nickname: 'ignored',
        type: NESTED_TABLE_ROW_TYPE,
        uri: '${VENDOR}/t',
      }),
      row({ nickname: 'Z' }),
    ]);

    // The child map is keyed by the row's *unexpanded* URI; keying it by the
    // expanded one would silently drop every nested table.
    const rows = flattenLibraryRows({
      global,
      children: new Map([['${VENDOR}/t', nested]]),
    });

    expect(rows.map((r) => r.nickname)).toEqual(['A', 'N1', 'N2', 'Z']);
  });

  it('propagates a hidden nested table onto the child rows themselves', () => {
    const nested = table([row({ nickname: 'N1' })]);
    const global = table([
      row({
        nickname: 'ignored',
        type: NESTED_TABLE_ROW_TYPE,
        uri: '/n',
        hidden: true,
      }),
    ]);

    const rows = flattenLibraryRows({
      global,
      children: new Map([['/n', nested]]),
    });

    expect(rows[0]?.hidden).toBe(true);
    // Upstream propagates by writing the flag onto the child row, so it sticks
    // to the table afterwards rather than being a property of this call.
    expect(nested.rows[0]?.hidden).toBe(true);
  });

  it('hides invalid rows and invalid tables unless asked for them', () => {
    const global = table([row({ nickname: 'Good' }), row({ nickname: 'Bad', ok: false })]);
    const project = table([row({ nickname: 'FromBadTable', scope: 'project' })], {
      scope: 'project',
      ok: false,
    });

    // The default is the browsing view: only usable libraries.
    expect(flattenLibraryRows({ global, project }).map((r) => r.nickname)).toEqual(['Good']);
    // The diagnostic view has to see the broken ones to explain them.
    expect(flattenLibraryRows({ global, project }, true).map((r) => r.nickname)).toEqual([
      'Good',
      'Bad',
      'FromBadTable',
    ]);
  });
});

describe('resolving a nickname', () => {
  const global = table([row({ nickname: 'Good' }), row({ nickname: 'Broken', ok: false })]);

  it('finds a row whose nested table failed to load', () => {
    // GetRow passes aIncludeInvalid true so the caller can say *why* a library
    // is unusable instead of "no such library".
    expect(findLibraryRow({ global }, 'Broken')?.nickname).toBe('Broken');
    expect(findLibraryRow({ global }, 'Missing')).toBeUndefined();
  });

  it('takes the nickname off a LIB_ID and finds nothing for a legacy one', () => {
    expect(findLibraryRowForFpid({ global }, 'Good:R_0805')?.nickname).toBe('Good');
    // A footprint field carrying only "R_0805" names no library, and upstream
    // does not go hunting through every library for it.
    expect(findLibraryRowForFpid({ global }, 'R_0805')).toBeUndefined();
  });
});
