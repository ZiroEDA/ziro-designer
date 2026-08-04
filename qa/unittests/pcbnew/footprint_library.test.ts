// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading footprint libraries through an injected filesystem.
 *
 * The fake filesystem here is deliberately literal: it lists exactly the names
 * it is given, including hidden ones and odd casing, because the two different
 * wildcard matchers upstream uses for the same `*.kicad_mod` spec disagree on
 * precisely those names and the disagreement is observable.
 */
import { describe, expect, it } from 'vitest';
import {
  footprintLibraryIsModified,
  footprintLibraryNames,
  footprintLibraryTimestamp,
  getLibraryFootprint,
  loadFootprintFromLibraries,
  loadFootprintLibrary,
  loadFootprintLibraryTables,
  loadLibraryTable,
  type FootprintLibraryFs,
  type LibraryDirEntry,
} from '@ziroeda/pcbnew/src/footprint_library.js';
import { flattenLibraryRows } from '@ziroeda/pcbnew/src/fp_lib_table.js';
import { serializeFootprint } from '@ziroeda/pcbnew/src/write-footprint.js';

/** mtime seconds and size for a path, when a test cares about the timestamp. */
type Meta = Record<string, [number, number]>;

/**
 * A filesystem over a flat path -> contents map. Directories are inferred from
 * the paths, so `/lib.pretty/R.kicad_mod` implies a listable `/lib.pretty`.
 */
function makeFs(files: Record<string, string>, meta: Meta = {}): FootprintLibraryFs {
  return {
    readFile: (path) => files[path] ?? null,
    listDirectory: (path) => {
      const prefix = `${path}/`;
      const kinds = new Map<string, boolean>();

      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash === -1) kinds.set(rest, true);
        else kinds.set(rest.slice(0, slash), false);
      }

      if (kinds.size === 0) return null;

      const out: LibraryDirEntry[] = [];

      for (const [name, isFile] of kinds) {
        const [mtimeSeconds, size] = meta[`${path}/${name}`] ?? [0, 0];
        out.push({ name, isFile, mtimeSeconds, size });
      }

      return out;
    },
  };
}

const MOD = (name: string): string =>
  `(footprint "${name}" (version 20240108) (generator "pcbnew") (layer "F.Cu")\n  (descr "a part")\n)`;

const resolve = (name: string): string | undefined =>
  ({ KIPRJMOD: '/proj', KICAD9_FOOTPRINT_DIR: '/stock' })[name];

const fpTable = (...rows: string[]): string =>
  `(fp_lib_table\n  (version 7)\n${rows.join('\n')}\n)`;

const libRow = (nickname: string, uri: string, extra = ''): string =>
  `  (lib (name "${nickname}")(type "KiCad")(uri "${uri}")(options "")(descr "")${extra})`;

describe('loadFootprintLibrary', () => {
  it('reads every footprint file and names it after the file', () => {
    const fs = makeFs({
      '/lib.pretty/R_0805.kicad_mod': MOD('WRONG_NAME'),
      '/lib.pretty/C_0603.kicad_mod': MOD('C_0603'),
      '/lib.pretty/readme.txt': 'not a footprint',
    });

    const library = loadFootprintLibrary(fs, '/lib.pretty');

    // Sorted, because upstream reads the names out of an ordered map. An
    // arbitrary order would shuffle the footprint chooser on every load.
    expect(footprintLibraryNames(library)).toEqual(['C_0603', 'R_0805']);
    // The filename wins over the header. Trusting the header instead would make
    // this footprint unloadable by the name enumeration just advertised.
    expect(getLibraryFootprint(library, 'R_0805')?.lib).toBe('R_0805');
    expect(getLibraryFootprint(library, 'WRONG_NAME')).toBeNull();
    expect(library.errorDescription).toBeUndefined();
  });

  it('carries the rename into the source so a save keeps it', () => {
    const fs = makeFs({ '/lib.pretty/R_0805.kicad_mod': MOD('WRONG_NAME') });
    const footprint = getLibraryFootprint(loadFootprintLibrary(fs, '/lib.pretty'), 'R_0805')!;

    // In memory first: this is the value every caller reads.
    expect(footprint.lib).toBe('R_0805');
    // Then through the writer, which emits the *source* header when there is
    // one. Patching only the model would let "WRONG_NAME" come back the moment
    // the footprint were written out, and nothing else would notice.
    const text = serializeFootprint(footprint);
    expect(text).toContain('"R_0805"');
    expect(text).not.toContain('WRONG_NAME');
  });

  it('skips a file it cannot parse and keeps the rest', () => {
    const fs = makeFs({
      '/lib.pretty/Good.kicad_mod': MOD('Good'),
      '/lib.pretty/Broken.kicad_mod': '(footprint "Broken" (layer',
      '/lib.pretty/NotAFootprint.kicad_mod': '(module_something)',
    });

    const library = loadFootprintLibrary(fs, '/lib.pretty');

    // A library is not all-or-nothing the way a library table is: one corrupt
    // file costs you that footprint and nothing else.
    expect(footprintLibraryNames(library)).toEqual(['Good']);
    // The failure still has to be reportable, naming the file.
    expect(library.errorDescription).toContain(
      "Unable to read file '/lib.pretty/Broken.kicad_mod'",
    );
    expect(library.errorDescription).toContain('NotAFootprint');
  });

  it('reports a missing directory rather than an empty library', () => {
    const library = loadFootprintLibrary(makeFs({}), '/gone.pretty');

    // "Not found" and "found but empty" have to stay distinguishable, or a
    // mistyped URI looks like a library the user simply has not filled in yet.
    expect(library.errorDescription).toBe("Footprint library '/gone.pretty' not found.");
    expect(footprintLibraryNames(library)).toEqual([]);
  });

  it('enumerates hidden files but not an upper-case extension', () => {
    const fs = makeFs({
      '/lib.pretty/.old.kicad_mod': MOD('.old'),
      '/lib.pretty/Shouty.KICAD_MOD': MOD('Shouty'),
      '/lib.pretty/Plain.kicad_mod': MOD('Plain'),
    });

    // wxDir on POSIX matches case-sensitively and treats a leading dot as an
    // ordinary character. This is the opposite of the timestamp matcher below,
    // and unifying the two would change which footprints exist.
    expect(footprintLibraryNames(loadFootprintLibrary(fs, '/lib.pretty'))).toEqual([
      '.old',
      'Plain',
    ]);
  });
});

describe('footprintLibraryTimestamp', () => {
  it('sums modification time and size over the footprint files', () => {
    const fs = makeFs(
      { '/lib.pretty/A.kicad_mod': 'a', '/lib.pretty/B.kicad_mod': 'b' },
      {
        '/lib.pretty/A.kicad_mod': [1000, 7],
        '/lib.pretty/B.kicad_mod': [2000, 9],
      },
    );

    // mtime is scaled to milliseconds and the size is added raw, so a rewrite
    // that keeps the size still moves the stamp. Dropping either term makes the
    // library cache miss a real edit.
    expect(footprintLibraryTimestamp(fs, '/lib.pretty')).toBe(1000 * 1000 + 7 + 2000 * 1000 + 9);
  });

  it('ignores hidden files, subdirectories and non-footprints, but not casing', () => {
    const fs = makeFs(
      {
        '/lib.pretty/.hidden.kicad_mod': 'x',
        '/lib.pretty/Shouty.KICAD_MOD': 'x',
        '/lib.pretty/notes.txt': 'x',
        '/lib.pretty/sub.kicad_mod/inner.txt': 'x',
      },
      {
        '/lib.pretty/.hidden.kicad_mod': [5, 1],
        '/lib.pretty/Shouty.KICAD_MOD': [7, 2],
        '/lib.pretty/notes.txt': [9, 4],
        '/lib.pretty/sub.kicad_mod': [11, 8],
      },
    );

    // fnmatch with FNM_PERIOD refuses to match a leading dot with a wildcard,
    // FNM_CASEFOLD ignores case, and only regular files are stat'ed in — the
    // exact inverse of what enumeration accepts.
    expect(footprintLibraryTimestamp(fs, '/lib.pretty')).toBe(7 * 1000 + 2);
  });

  it('calls a library modified when a file changes underneath it', () => {
    const before = makeFs(
      { '/lib.pretty/A.kicad_mod': MOD('A') },
      { '/lib.pretty/A.kicad_mod': [1, 2] },
    );
    const after = makeFs(
      { '/lib.pretty/A.kicad_mod': MOD('A') },
      { '/lib.pretty/A.kicad_mod': [3, 2] },
    );
    const library = loadFootprintLibrary(before, '/lib.pretty');

    expect(footprintLibraryIsModified(before, library)).toBe(false);
    expect(footprintLibraryIsModified(after, library)).toBe(true);
  });
});

describe('loadLibraryTable', () => {
  it('distinguishes a missing file from an empty one', () => {
    const fs = makeFs({ '/p/empty': '' });

    expect(loadLibraryTable(fs, '/p/gone', 'global')).toMatchObject({
      ok: false,
      errorDescription: "The library table path '/p/gone' does not exist",
    });
    // An empty table is a perfectly good table with no libraries in it, and it
    // takes the caller's expected type on trust.
    expect(loadLibraryTable(fs, '/p/empty', 'global', 'footprint')).toMatchObject({
      ok: true,
      type: 'footprint',
      rows: [],
    });
  });

  it('allows one byte so a lone byte-order mark still reads as empty', () => {
    // A UTF-8 BOM is three bytes, so this deliberately uses a one-byte file:
    // the allowance is measured in bytes, not characters.
    const fs = makeFs({ '/p/one': 'x', '/p/two': 'xy' });

    expect(loadLibraryTable(fs, '/p/one', 'global', 'footprint').ok).toBe(true);
    // Two bytes is a real parse, and "xy" is not a library table.
    expect(loadLibraryTable(fs, '/p/two', 'global', 'footprint').ok).toBe(false);
  });

  it('refuses a table of the wrong kind when a kind is expected', () => {
    const fs = makeFs({ '/p/fp-lib-table': '(sym_lib_table (version 7))' });

    // Without an expected type the parse simply reports what it found; the
    // caller is the one that decides it is the wrong file.
    expect(loadLibraryTable(fs, '/p/fp-lib-table', 'global').type).toBe('symbol');
    expect(loadLibraryTable(fs, '/p/fp-lib-table', 'global', 'footprint')).toMatchObject({
      ok: false,
      errorDescription: 'The library table is of wrong type',
    });
  });
});

describe('loadFootprintLibraryTables', () => {
  it('loads the global and project tables and lets the project win', () => {
    const fs = makeFs({
      '/home/fp-lib-table': fpTable(libRow('Stock', '${KICAD9_FOOTPRINT_DIR}/Stock.pretty')),
      '/proj/fp-lib-table': fpTable(
        libRow('Stock', '${KIPRJMOD}/Stock.pretty'),
        libRow('Extra', '${KIPRJMOD}/Extra.pretty'),
      ),
    });

    const tables = loadFootprintLibraryTables({
      fs,
      globalPath: '/home',
      projectPath: '/proj',
      resolve,
      cwd: '/cwd',
    });

    expect(tables.global?.scope).toBe('global');
    expect(tables.project?.scope).toBe('project');
    const rows = flattenLibraryRows(tables);
    expect(rows.map((r) => [r.nickname, r.uri])).toEqual([
      ['Stock', '${KIPRJMOD}/Stock.pretty'],
      ['Extra', '${KIPRJMOD}/Extra.pretty'],
    ]);
  });

  it('drops a table that is not a footprint table, empty file included', () => {
    const fs = makeFs({
      '/home/fp-lib-table': '(sym_lib_table (version 7))',
      '/proj/fp-lib-table': '',
    });

    const tables = loadFootprintLibraryTables({
      fs,
      globalPath: '/home',
      projectPath: '/proj',
      resolve,
      cwd: '/cwd',
    });

    // A symbol table in the footprint slot is a warning upstream, not an error.
    expect(tables.global).toBeUndefined();
    // An empty file gets no type at all, so it fails the same check — which is
    // why a zero-length fp-lib-table quietly contributes nothing.
    expect(tables.project).toBeUndefined();
  });

  it('splices a nested table and refuses to follow it twice', () => {
    const fs = makeFs({
      '/home/fp-lib-table': fpTable(
        '  (lib (name "vendor")(type "Table")(uri "/vendors/fp-lib-table")(options "")(descr ""))',
        '  (lib (name "again")(type "Table")(uri "/vendors/fp-lib-table")(options "")(descr ""))',
      ),
      '/vendors/fp-lib-table': fpTable(libRow('Vendor', '/vendors/Vendor.pretty')),
    });

    const tables = loadFootprintLibraryTables({
      fs,
      globalPath: '/home',
      resolve,
      cwd: '/cwd',
    });

    expect(flattenLibraryRows(tables).map((r) => r.nickname)).toEqual(['Vendor']);
    // The second reference to the same file is marked bad rather than being
    // followed again; following it would loop forever on a table that
    // references itself.
    expect(tables.global?.rows[1]).toMatchObject({
      ok: false,
      errorDescription: 'A reference to this library table already exists',
    });
  });

  it('resolves a relative nested URI against the working directory', () => {
    const fs = makeFs({
      '/home/fp-lib-table':
        '(fp_lib_table\n  (lib (name "n")(type "Table")(uri "nested/fp-lib-table")(options "")(descr ""))\n)',
      '/cwd/nested/fp-lib-table': fpTable(libRow('FromCwd', '/x.pretty')),
      '/home/nested/fp-lib-table': fpTable(libRow('FromParentDir', '/y.pretty')),
    });

    const tables = loadFootprintLibraryTables({
      fs,
      globalPath: '/home',
      resolve,
      cwd: '/cwd',
    });

    // ExpandURI makes the path absolute against the process working directory
    // *before* loadNestedTables makes it absolute against the parent table's
    // directory, so the second step can never do anything. The comment upstream
    // claims the opposite; the code is what is reproduced here.
    expect(flattenLibraryRows(tables).map((r) => r.nickname)).toEqual(['FromCwd']);
  });

  it('marks the referencing row bad when the nested table will not load', () => {
    const fs = makeFs({
      '/home/fp-lib-table':
        '(fp_lib_table\n  (lib (name "n")(type "Table")(uri "/vendors/fp-lib-table")(options "")(descr ""))\n)',
    });

    const tables = loadFootprintLibraryTables({
      fs,
      globalPath: '/home',
      resolve,
      cwd: '/cwd',
    });

    // The row has to carry the child's own message, so the library manager can
    // say which file is missing rather than "a library failed".
    expect(tables.global?.rows[0]).toMatchObject({
      ok: false,
      errorDescription: "The library table path '/vendors/fp-lib-table' does not exist",
    });
  });
});

describe('loadFootprintFromLibraries', () => {
  const fs = makeFs({
    '/home/fp-lib-table': fpTable(
      libRow('Parts', '${KICAD9_FOOTPRINT_DIR}/Parts.pretty'),
      libRow('Off', '${KICAD9_FOOTPRINT_DIR}/Off.pretty', '(disabled)'),
      libRow('Alien', '/alien.lib').replace('"KiCad"', '"Altium Designer"'),
    ),
    '/proj/fp-lib-table': fpTable(libRow('Parts', '${KIPRJMOD}/Parts.pretty')),
    '/stock/Parts.pretty/R_0805.kicad_mod': MOD('stock version'),
    '/stock/Off.pretty/D_SOD.kicad_mod': MOD('D_SOD'),
    '/proj/Parts.pretty/R_0805.kicad_mod': MOD('project version'),
    '/alien.lib/R_0805.kicad_mod': MOD('R_0805'),
  });

  const tables = loadFootprintLibraryTables({
    fs,
    globalPath: '/home',
    projectPath: '/proj',
    resolve,
    cwd: '/cwd',
  });

  const load = (fpid: string) =>
    loadFootprintFromLibraries({ fs, tables, resolve, cwd: '/cwd', fpid });

  it('follows the shadowing table all the way to a footprint', () => {
    // The whole chain: nickname -> row -> ${KIPRJMOD} -> directory -> file. If
    // the project row did not win, the board would silently diff against the
    // stock footprint instead of the one the project ships.
    expect(load('Parts:R_0805')?.descr).toBe('a part');
    expect(load('Parts:R_0805')?.lib).toBe('R_0805');
    expect(load('Parts:Nope')).toBeNull();
    expect(load('NoSuchLib:R_0805')).toBeNull();
  });

  it('still loads from a disabled library', () => {
    // Nothing on the load path consults the disabled flag — only the browse and
    // pick paths do. Filtering here would break loading a board whose
    // footprints came from a library the user has since switched off.
    expect(load('Off:D_SOD')?.lib).toBe('D_SOD');
  });

  it('declines a row naming a plugin that is not ported', () => {
    // The directory even holds a readable .kicad_mod, so this cannot be a
    // fall-through: the row type has to be checked, or we would present an
    // Altium library's contents as if we had understood it.
    expect(load('Alien:R_0805')).toBeNull();
  });
});
