// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The library table on the live classes: LIBRARY_TABLE over the PEGTL grammar
 * (`include/libraries/library_table_grammar.h`), its option strings,
 * `ExpandEnvVarSubstitutions` (common.cpp:591) which expands a row's URI, and
 * `LIBRARY_MANAGER::Rows` / `GetRow` (library_manager.cpp:756-859).
 *
 * The grammar has no error recovery, so the interesting cases are files that
 * look fine and are rejected outright - the user then sees no libraries at
 * all, so those are reproduced, not smoothed over.
 */
import { describe, expect, it } from 'vitest';
import { ExpandEnvVarSubstitutions, type TextVarResolverFn } from '@ziroeda/common/common.js';
import { LIBRARY_MANAGER } from '@ziroeda/common/libraries/library_manager.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';

const REAL_TABLE = `(fp_lib_table
  (version 7)
  (lib (name "LED_SMD")(type "KiCad")(uri "\${KICAD9_FOOTPRINT_DIR}/LED_SMD.pretty")(options "")(descr ""))
  (lib (name "Local")(type "KiCad")(uri "\${KIPRJMOD}/lib.pretty")(options "pad_to_mask=1")(descr "project parts"))
)
`;

const read = (aText: string, aScope = LIBRARY_TABLE_SCOPE.GLOBAL): LIBRARY_TABLE =>
  new LIBRARY_TABLE(false, aText, aScope);

describe('LIBRARY_TABLE over the grammar', () => {
  it('reads the rows of a table KiCad wrote', () => {
    const t = read(REAL_TABLE);

    expect(t.IsOk()).toBe(true);
    expect(t.Type()).toBe(LIBRARY_TABLE_TYPE.FOOTPRINT);
    expect(t.Version()).toBe(7);
    expect(t.Rows().map((r) => r.Nickname())).toEqual(['LED_SMD', 'Local']);
    // Every column lands in its own field; swapping uri and descr would still
    // "parse" but would point the loader at nothing.
    const local = t.Rows()[1]!;
    expect([
      local.Nickname(),
      local.Type(),
      local.URI(),
      local.Options(),
      local.Description(),
      local.Disabled(),
      local.Hidden(),
      local.IsOk(),
    ]).toEqual([
      'Local',
      'KiCad',
      '${KIPRJMOD}/lib.pretty',
      'pad_to_mask=1',
      'project parts',
      false,
      false,
      true,
    ]);
  });

  it('loses the whole table over one stray space inside a property', () => {
    // LIB_PROPERTY is a bare `seq` with padding only between key and value, so
    // `(uri u )` is a syntax error, and no row survives, not even the clean ones.
    const t = read('(fp_lib_table (lib (name "A")(type KiCad)(uri u )))');
    expect(t.IsOk()).toBe(false);
    expect(t.Rows()).toEqual([]);
  });

  it('does allow padding around a whole row and its members', () => {
    // LIB_ROW pads its members and its own closing paren; only the property is strict.
    const t = read('(fp_lib_table\n ( lib (name "A") (uri u) )\n)');
    expect(t.IsOk()).toBe(true);
    expect([t.Rows()[0]!.Nickname(), t.Rows()[0]!.URI()]).toEqual(['A', 'u']);
  });

  it('rejects a padded (hidden ) marker, takes the unpadded flags', () => {
    expect(read('(fp_lib_table (lib (name A)(hidden )))').IsOk()).toBe(false);
    const r = read('(fp_lib_table (lib (name A)(hidden)(disabled)))').Rows()[0]!;
    expect([r.Hidden(), r.Disabled()]).toEqual([true, true]);
  });

  it('treats a backslash inside a quoted value as an ordinary character', () => {
    // QUOTED_TEXT is `until<one<'"'>>`: no escape handling at all.
    const t = read('(fp_lib_table (lib (name A)(descr "a\\")))');
    expect(t.IsOk()).toBe(true);
    expect(t.Rows()[0]!.Description()).toBe('a\\');
  });

  it('reports an unterminated quote as a syntax error with its position', () => {
    // A `must` violation carries a position; a plain non-match does not.
    const t = read('(fp_lib_table\n  (lib (name "A)\n)');
    expect(t.IsOk()).toBe(false);
    expect(t.ErrorDescription()).toMatch(/^Syntax error at line 3, column \d+$/);
  });

  it('rejects a leading blank line without calling it a syntax error', () => {
    // LIB_TABLE opens on a bare LPAREN with no pad: an outright non-match.
    const t = read('\n(fp_lib_table)');
    expect(t.IsOk()).toBe(false);
    expect(t.ErrorDescription()).toBe('An unexpected error occurred while reading library table');
  });

  it('reports nothing when the file has trailing junk after the table', () => {
    // LIB_TABLE_FILE demands eof; the table is only built from a successful parse.
    const t = read('(fp_lib_table (lib (name A))) leftover');
    expect(t.IsOk()).toBe(false);
    expect(t.Rows()).toEqual([]);
  });

  it('keeps a vertical tab inside an unquoted value', () => {
    // TOKEN excludes space, tab, CR and LF but not VT or FF.
    expect(read('(fp_lib_table (lib (name A)(descr a\vb)))').Rows()[0]!.Description()).toBe('a\vb');
  });

  it('lets a repeated key overwrite the earlier one', () => {
    expect(read('(fp_lib_table (lib (name A)(name B)))').Rows()[0]!.Nickname()).toBe('B');
  });

  it('accepts a non-numeric version rather than failing the table', () => {
    // The grammar takes any PROPERTY_VALUE; the lexical_cast afterwards gives up.
    const bad = read('(fp_lib_table (version x))');
    expect(bad.IsOk()).toBe(true);
    expect(bad.Version()).toBeUndefined();
    expect(read('(fp_lib_table)').Version()).toBeUndefined();
    expect(read('(fp_lib_table (version 007))').Version()).toBe(7);
    expect(read('(fp_lib_table (version "7 "))').Version()).toBeUndefined();
  });

  it('stamps every row with the scope it was read for', () => {
    const t = read('(fp_lib_table (lib (name A)))', LIBRARY_TABLE_SCOPE.PROJECT);
    expect(t.Rows()[0]!.Scope()).toBe(LIBRARY_TABLE_SCOPE.PROJECT);
  });
});

describe('LIBRARY_TABLE options', () => {
  it('splits on unescaped bars and on the first equals only', () => {
    const opts = LIBRARY_TABLE.ParseOptions('a=1|b=2=3|flag|c\\|d=4');
    expect(opts.get('a')).toBe('1');
    expect(opts.get('b')).toBe('2=3');
    // A pair with no equals is present with an empty value.
    expect(opts.get('flag')).toBe('');
    expect(opts.get('c|d')).toBe('4');
  });

  it('trims whitespace only from the front of a pair', () => {
    expect([...LIBRARY_TABLE.ParseOptions('  a = 1 ')]).toEqual([['a ', ' 1 ']]);
  });

  it('formats back sorted, escaping separators in values but not in keys', () => {
    const text = LIBRARY_TABLE.FormatOptions(
      new Map([
        ['z', 'last'],
        ['a', 'x|y'],
        ['flag', ''],
      ]),
    );
    expect(text).toBe('a=x\\|y|flag|z=last');
    expect(LIBRARY_TABLE.ParseOptions(text).get('a')).toBe('x|y');
  });
});

describe('ExpandEnvVarSubstitutions', () => {
  const vars: Record<string, string> = {
    KIPRJMOD: '/proj',
    A: '${B}',
    B: '/deep',
    SELF: '${SELF}',
  };
  /** A project's TextVarResolver over those. */
  const project: TextVarResolverFn = (token) => {
    const v = vars[token.value];
    if (v === undefined) return false;
    token.value = v;
    return true;
  };
  const expand = (s: string): string => ExpandEnvVarSubstitutions(s, project);

  it('accepts all three reference forms', () => {
    expect(expand('${KIPRJMOD}/lib.pretty')).toBe('/proj/lib.pretty');
    expect(expand('$(KIPRJMOD)/lib.pretty')).toBe('/proj/lib.pretty');
    expect(expand('$KIPRJMOD/lib.pretty')).toBe('/proj/lib.pretty');
  });

  it('leaves an unknown reference exactly as it found it', () => {
    expect(expand('${ZZ_NOPE}/lib.pretty')).toBe('${ZZ_NOPE}/lib.pretty');
    expect(expand('$ZZ_NOPE/lib.pretty')).toBe('$ZZ_NOPE/lib.pretty');
  });

  it('swallows a trailing dollar sign', () => {
    // Upstream breaks out of its switch before appending anything when there is
    // no room left for a name. It reads as a bug and is reproduced.
    expect(expand('/libs$')).toBe('/libs');
    expect(expand('${')).toBe('');
  });

  it('honours a backslash escape only until the re-expansion pass undoes it', () => {
    expect(expand('\\${KIPRJMOD}')).toBe('/proj');
    expect(expand('\\$KIPRJMOD')).toBe('$KIPRJMOD');
    expect(expand('a\\b${KIPRJMOD}')).toBe('a\\b/proj');
  });

  it('re-expands a variable whose value is another reference', () => {
    expect(expand('${A}/x')).toBe('/deep/x');
  });

  it('terminates on a self-referential variable', () => {
    // The insert-once guard, not a depth counter. Losing it hangs the app.
    expect(expand('${SELF}')).toBe('${SELF}');
  });
});

describe('LIBRARY_MANAGER::Rows and GetRow', () => {
  const manager = (aGlobal: string, aProject?: string): LIBRARY_MANAGER => {
    const m = new LIBRARY_MANAGER();
    m.SetTable(LIBRARY_TABLE_TYPE.FOOTPRINT, LIBRARY_TABLE_SCOPE.GLOBAL, read(aGlobal));
    if (aProject)
      m.SetTable(
        LIBRARY_TABLE_TYPE.FOOTPRINT,
        LIBRARY_TABLE_SCOPE.PROJECT,
        read(aProject, LIBRARY_TABLE_SCOPE.PROJECT),
      );
    return m;
  };

  it('lets a project row shadow a global one without moving it', () => {
    // First-appearance order, last-write value.
    const m = manager(
      '(fp_lib_table (lib (name A)(uri /a)) (lib (name B)(uri /b)))',
      '(fp_lib_table (lib (name B)(uri /proj/b)) (lib (name C)(uri /c)))',
    );
    const rows = m.Rows(LIBRARY_TABLE_TYPE.FOOTPRINT);
    expect(rows.map((r) => r.Nickname())).toEqual(['A', 'B', 'C']);
    expect(rows[1]!.URI()).toBe('/proj/b');
    expect(rows[1]!.Scope()).toBe(LIBRARY_TABLE_SCOPE.PROJECT);
  });

  it('keeps a disabled library: only a disabled nested table is dropped', () => {
    const m = manager('(fp_lib_table (lib (name Off)(uri /off)(disabled)))');
    expect(m.Rows(LIBRARY_TABLE_TYPE.FOOTPRINT).map((r) => r.Nickname())).toEqual(['Off']);
  });

  it('hides an invalid table unless asked for it, and GetRow includes it', () => {
    const m = manager(
      '(fp_lib_table (lib (name Good)(uri /g)))',
      '(fp_lib_table (lib (name FromBadTable)(uri u )))',
    );
    expect(m.Rows(LIBRARY_TABLE_TYPE.FOOTPRINT).map((r) => r.Nickname())).toEqual(['Good']);
    expect(m.GetRow(LIBRARY_TABLE_TYPE.FOOTPRINT, 'Missing')).toBeNull();
    expect(m.GetRow(LIBRARY_TABLE_TYPE.FOOTPRINT, 'Good')?.URI()).toBe('/g');
  });
});
