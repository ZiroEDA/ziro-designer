// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * LIBRARY_TABLE (common/libraries/library_table.cpp): parse, copy, compare and
 * format. The formatted text is what KiCad 10.0.5 writes - `(version 7)`, one
 * `(lib …)` per line with ONE space between its members (the installed build's
 * own ~/.config/kicad/10.0/fp-lib-table reads `(lib (name "KiCad") (type
 * "Table") …)`; KiCad 9 wrote them run together), the two markers last.
 */
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';

const TABLE = `(fp_lib_table
  (version 7)
  (lib (name "Footprints")(type "KiCad")(uri "\${KIPRJMOD}/footprints.pretty")(options "")(descr ""))
  (lib (name "Extra")(type "KiCad")(uri "\${KIPRJMOD}\\more.pretty")(options "a=1")(descr "spares")(disabled)(hidden))
)`;

describe('LIBRARY_TABLE', () => {
  it('reads a table from a buffer', () => {
    const t = new LIBRARY_TABLE(true, TABLE, LIBRARY_TABLE_SCOPE.PROJECT);
    expect(t.IsOk()).toBe(true);
    expect(t.Type()).toBe(LIBRARY_TABLE_TYPE.FOOTPRINT);
    expect(t.Version()).toBe(7);
    expect(t.Rows().map((r) => r.Nickname())).toEqual(['Footprints', 'Extra']);
    const extra = t.Row('Extra')!;
    expect(extra.Disabled()).toBe(true);
    expect(extra.Hidden()).toBe(true);
    expect(extra.Scope()).toBe(LIBRARY_TABLE_SCOPE.PROJECT);
    expect(extra.GetOptionsMap().get('a')).toBe('1');
  });

  it('loses the whole table to one bad row', () => {
    const t = new LIBRARY_TABLE(
      true,
      '(fp_lib_table\n  (lib (name "A")(uri "a"))\n  (lib ( name "B"))\n)',
      LIBRARY_TABLE_SCOPE.PROJECT,
    );
    expect(t.IsOk()).toBe(false);
    expect(t.Rows()).toHaveLength(0);
    // column 8 is the `( name` that no LIB_ROW_MEMBER matches
    expect(t.ErrorDescription()).toBe('Syntax error at line 3, column 8');
  });

  it('reads a file, or says why not', () => {
    expect(
      LIBRARY_TABLE.FromFile(
        '/p/fp-lib-table',
        null,
        LIBRARY_TABLE_SCOPE.PROJECT,
      ).ErrorDescription(),
    ).toBe("The library table path '/p/fp-lib-table' does not exist");
    const empty = LIBRARY_TABLE.FromFile(
      '/p/fp-lib-table',
      '',
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE_TYPE.FOOTPRINT,
    );
    expect(empty.IsOk()).toBe(true);
    expect(empty.Type()).toBe(LIBRARY_TABLE_TYPE.FOOTPRINT);
    const wrong = LIBRARY_TABLE.FromFile(
      '/p/sym-lib-table',
      TABLE,
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE_TYPE.SYMBOL,
    );
    expect(wrong.IsOk()).toBe(false);
    expect(wrong.ErrorDescription()).toBe('The library table is of wrong type');
  });

  it('formats as KiCad writes it, slashes in the URI', () => {
    const t = new LIBRARY_TABLE(true, TABLE, LIBRARY_TABLE_SCOPE.PROJECT);
    expect(t.FormatForSave()).toBe(
      '(fp_lib_table\n' +
        '\t(version 7)\n' +
        '\t(lib (name "Footprints") (type "KiCad") (uri "${KIPRJMOD}/footprints.pretty") (options "") (descr ""))\n' +
        '\t(lib (name "Extra") (type "KiCad") (uri "${KIPRJMOD}/more.pretty") (options "a=1") (descr "spares") (disabled) (hidden))\n' +
        ')\n',
    );
    expect(
      LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.PROJECT, LIBRARY_TABLE_TYPE.SYMBOL).FormatForSave(),
    ).toBe('(sym_lib_table\n\t(version 7)\n)\n');
  });

  it('copies deep, and compares rows by value', () => {
    const t = new LIBRARY_TABLE(true, TABLE, LIBRARY_TABLE_SCOPE.PROJECT);
    const copy = t.Clone();
    expect(copy.equals(t)).toBe(true);
    copy.Rows()[0]!.SetDescription('changed');
    expect(t.Rows()[0]!.Description()).toBe('');
    expect(copy.equals(t)).toBe(false);
  });
});
