// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The project symbol library table (SYMBOL_LIB_TABLE's project half). A project
 * that ships its own symbols registers them only in `sym-lib-table`, so without
 * reading it every symbol it places resolves to nothing and TestLibSymbolIssues
 * reports the library as unconfigured once per symbol.
 */
import { describe, expect, it } from 'vitest';
import {
  projectSymLibTable,
  projectSymLibTablePath,
  projectSymbolFiles,
  projectSymbolLibraries,
  resolvedProjectSymLibs,
  findSymLibRowByUri,
  serializeSymLibTable,
} from '@ziroeda/designer/src/editors/schematic/symbols/project_sym_lib_table.js';

const TABLE = `(sym_lib_table
  (version 7)
  (lib (name "proj")(type "KiCad")(uri "\${KIPRJMOD}/proj.kicad_sym")(options "")(descr ""))
)`;

const LIB = `(kicad_symbol_lib (version 20231120) (generator kicad_symbol_editor)
  (symbol "R" (pin_names (offset 0))
    (property "Reference" "R" (at 0 0 0))
    (property "Value" "R" (at 0 0 0))
    (symbol "R_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27)
        (name "~" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1)))))))
  (symbol "C" (pin_names (offset 0))
    (property "Reference" "C" (at 0 0 0))
    (property "Value" "C" (at 0 0 0))
    (symbol "C_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27)
        (name "~" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1)))))))
)`;

const files = (...extra: { name: string; text: string }[]) => [
  { name: 'sym-lib-table', text: TABLE },
  { name: 'proj.kicad_sym', text: LIB },
  ...extra,
];

describe('projectSymLibTable', () => {
  it('reads the rows', () => {
    const rows = projectSymLibTable(files());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('proj');
    expect(rows[0]!.uri).toBe('${KIPRJMOD}/proj.kicad_sym');
  });

  it('is absent when the project has no table', () => {
    expect(projectSymLibTable([{ name: 'x.kicad_sch', text: '' }])).toEqual([]);
  });
});

describe('projectSymbolLibraries', () => {
  it('resolves a ${KIPRJMOD} row to the symbols it holds', () => {
    const { symbolLibs, librarySymbols, unloaded } = projectSymbolLibraries(files());
    // The nickname is the row's, never the file's.
    expect([...symbolLibs.keys()]).toEqual(['proj']);
    expect([...symbolLibs.get('proj')!].sort()).toEqual(['C', 'R']);
    expect(librarySymbols.has('proj:R')).toBe(true);
    expect(unloaded.size).toBe(0);
  });

  it('finds the file when the project keeps a directory prefix', () => {
    const nested = [
      { name: 'demo/sym-lib-table', text: TABLE },
      { name: 'demo/proj.kicad_sym', text: LIB },
    ];
    expect(projectSymbolLibraries(nested).symbolLibs.get('proj')?.size).toBe(2);
  });

  it('reports a registered library whose file is missing as unloaded', () => {
    const { symbolLibs, unloaded } = projectSymbolLibraries([
      { name: 'sym-lib-table', text: TABLE },
    ]);
    expect(symbolLibs.size).toBe(0);
    expect(unloaded.get('proj')).toBe('${KIPRJMOD}/proj.kicad_sym');
  });

  it('reports an unreadable library as unloaded rather than throwing', () => {
    const { symbolLibs, unloaded } = projectSymbolLibraries([
      { name: 'sym-lib-table', text: TABLE },
      { name: 'proj.kicad_sym', text: '(kicad_symbol_lib' },
    ]);
    expect(symbolLibs.size).toBe(0);
    expect(unloaded.has('proj')).toBe(true);
  });

  // The rule that matters: a library exists only because a table row registers
  // it. A .kicad_sym sitting in the project folder is a file, not a library —
  // SYMBOL_LIB_TABLE::FindRow resolves nicknames, never directories, so we must
  // never go looking for one.
  it('does not treat an unregistered .kicad_sym in the project as a library', () => {
    const { symbolLibs, librarySymbols } = projectSymbolLibraries([
      { name: 'stray.kicad_sym', text: LIB },
      { name: 'nested/also_stray.kicad_sym', text: LIB },
    ]);
    expect(symbolLibs.size).toBe(0);
    expect(librarySymbols.size).toBe(0);
  });

  it('registers only the rows in the table, not every .kicad_sym present', () => {
    const { symbolLibs } = projectSymbolLibraries(
      files({ name: 'extra.kicad_sym', text: LIB }, { name: 'vendor.kicad_sym', text: LIB }),
    );
    expect([...symbolLibs.keys()]).toEqual(['proj']);
  });

  it('skips a disabled row, as FindRow does', () => {
    const disabled = TABLE.replace('(descr "")', '(descr "")(disabled)');
    const { symbolLibs } = projectSymbolLibraries([
      { name: 'sym-lib-table', text: disabled },
      { name: 'proj.kicad_sym', text: LIB },
    ]);
    expect(symbolLibs.size).toBe(0);
  });
});

/**
 * Manage Symbol Libraries writes the project's `sym-lib-table`; a row written
 * there is the only thing that makes a library resolvable, so the round trip has
 * to survive exactly.
 */
describe('serializeSymLibTable', () => {
  it('round-trips the rows it writes', () => {
    const rows = [
      {
        name: 'proj',
        type: 'KiCad',
        uri: '${KIPRJMOD}/proj.kicad_sym',
        options: '',
        descr: 'mine',
      },
      {
        name: 'off',
        type: 'KiCad',
        uri: '${KIPRJMOD}/off.kicad_sym',
        options: '',
        descr: '',
        disabled: true,
      },
    ];
    const text = serializeSymLibTable(rows);
    expect(text.startsWith('(sym_lib_table')).toBe(true);
    const back = projectSymLibTable([{ name: 'sym-lib-table', text }]);
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({
      name: 'proj',
      uri: '${KIPRJMOD}/proj.kicad_sym',
      descr: 'mine',
    });
    expect(back[1]!.disabled).toBe(true);
  });

  it('makes a written row resolve the library it points at', () => {
    // The whole point: register the file, and only then does it hold symbols.
    const text = serializeSymLibTable([
      { name: 'mine', type: 'KiCad', uri: '${KIPRJMOD}/proj.kicad_sym', options: '', descr: '' },
    ]);
    const after = projectSymbolLibraries([
      { name: 'sym-lib-table', text },
      { name: 'proj.kicad_sym', text: LIB },
    ]);
    expect([...after.symbolLibs.get('mine')!].sort()).toEqual(['C', 'R']);
    // …under the row's nickname, not the file's name.
    expect(after.symbolLibs.has('proj')).toBe(false);
    expect(after.librarySymbols.has('mine:R')).toBe(true);
  });
});

describe('projectSymLibTablePath', () => {
  it('keeps an existing table where it is', () => {
    expect(projectSymLibTablePath([{ name: 'demo/sym-lib-table', text: '' }])).toBe(
      'demo/sym-lib-table',
    );
  });

  it('creates one next to the .kicad_pro', () => {
    expect(projectSymLibTablePath([{ name: 'demo/board.kicad_pro', text: '' }])).toBe(
      'demo/sym-lib-table',
    );
  });
});

describe('projectSymbolFiles', () => {
  it('lists the project .kicad_sym files and how each is registered', () => {
    const rows = projectSymLibTable(files());
    const listed = projectSymbolFiles(files({ name: 'extra.kicad_sym', text: LIB }), rows);
    expect(listed.map((d) => `${d.file}:${d.registeredAs}`).sort()).toEqual([
      'extra:',
      'proj:proj',
    ]);
  });
});

/**
 * The Symbol Editor's library tree and its MAIL_LIB_EDIT open flow both go
 * through the table: `resolvedProjectSymLibs` is the tree's only source, and
 * `findSymLibRowByUri` is SYMBOL_LIBRARY_ADAPTER::FindRowByURI, which decides
 * whether the project manager may open a `.kicad_sym` at all.
 */
describe('resolvedProjectSymLibs', () => {
  it('returns only rows whose file is present, disabled ones included', () => {
    const disabled = `(sym_lib_table
      (lib (name "on")(type "KiCad")(uri "\${KIPRJMOD}/proj.kicad_sym")(options "")(descr ""))
      (lib (name "off")(type "KiCad")(uri "\${KIPRJMOD}/other.kicad_sym")(options "")(descr "")(disabled))
      (lib (name "gone")(type "KiCad")(uri "\${KIPRJMOD}/missing.kicad_sym")(options "")(descr ""))
    )`;
    const resolved = resolvedProjectSymLibs([
      { name: 'sym-lib-table', text: disabled },
      { name: 'proj.kicad_sym', text: LIB },
      { name: 'other.kicad_sym', text: LIB },
    ]);
    // "gone" has no file, so it is not a resolvable library at all.
    expect(resolved.map((r) => `${r.row.name}:${r.row.disabled ?? false}`)).toEqual([
      'on:false',
      'off:true',
    ]);
  });

  it('ignores an unregistered .kicad_sym entirely', () => {
    expect(resolvedProjectSymLibs([{ name: 'stray.kicad_sym', text: LIB }])).toEqual([]);
  });
});

describe('findSymLibRowByUri', () => {
  it('finds the row that points at a file', () => {
    expect(findSymLibRowByUri(files(), 'proj.kicad_sym')?.name).toBe('proj');
  });

  it('returns nothing for a file no row points at', () => {
    // What makes the symbol editor refuse to open it, with upstream's
    // "configuration does not include the symbol library" message.
    expect(
      findSymLibRowByUri(files({ name: 'stray.kicad_sym', text: LIB }), 'stray.kicad_sym'),
    ).toBe(undefined);
  });

  it('still finds a disabled row, so "not enabled" is reported separately', () => {
    const disabled = TABLE.replace('(descr "")', '(descr "")(disabled)');
    const row = findSymLibRowByUri(
      [
        { name: 'sym-lib-table', text: disabled },
        { name: 'proj.kicad_sym', text: LIB },
      ],
      'proj.kicad_sym',
    );
    expect(row?.disabled).toBe(true);
  });
});

/**
 * `${KIPRJMOD}` is a real path, so a row names one file and only that file.
 * Resolving loosely would let a row pick up a same-named library the engineer
 * never registered — the exact thing the table exists to prevent.
 */
describe('${KIPRJMOD} resolution is exact', () => {
  it('does not match a same-named file in a subfolder', () => {
    const { symbolLibs, unloaded } = projectSymbolLibraries([
      { name: 'demo/sym-lib-table', text: TABLE },
      { name: 'demo/vendor/proj.kicad_sym', text: LIB },
    ]);
    // The row points at demo/proj.kicad_sym, which is not there.
    expect(symbolLibs.size).toBe(0);
    expect(unloaded.get('proj')).toBe('${KIPRJMOD}/proj.kicad_sym');
  });

  it('resolves a row that names a subfolder itself', () => {
    const sub = TABLE.replace('${KIPRJMOD}/proj.kicad_sym', '${KIPRJMOD}/vendor/proj.kicad_sym');
    const { symbolLibs } = projectSymbolLibraries([
      { name: 'demo/sym-lib-table', text: sub },
      { name: 'demo/vendor/proj.kicad_sym', text: LIB },
    ]);
    expect(symbolLibs.get('proj')?.size).toBe(2);
  });

  it('anchors the project root on the .kicad_pro when the table is elsewhere', () => {
    const { symbolLibs } = projectSymbolLibraries([
      { name: 'demo/board.kicad_pro', text: '{}' },
      { name: 'demo/sym-lib-table', text: TABLE },
      { name: 'demo/proj.kicad_sym', text: LIB },
    ]);
    expect(symbolLibs.get('proj')?.size).toBe(2);
  });
});
