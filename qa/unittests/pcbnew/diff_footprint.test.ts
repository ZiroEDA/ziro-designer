// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Fetching a placed footprint's library original and reporting on it.
 * Counterpart: `BOARD_INSPECTION_TOOL::DiffFootprint`.
 *
 * The board footprints here are read the way the board reader reads them, so
 * their pads are board-absolute and rotated, while the library ones come
 * straight off the fake filesystem at the origin. A diff that reports nothing
 * for that pair is the whole point of the exercise.
 *
 * The four ways of not getting a library footprint matter as much as the diff:
 * upstream distinguishes them by wording alone, and three of them come out of
 * one `HasLibrary` call that answers "loaded", not "configured".
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/parser.js';
import {
  diffFootprintAgainstLibrary,
  resolveLibraryFootprint,
  type LibraryFootprintQuery,
} from '@ziroeda/pcbnew/src/diff_footprint.js';
import { loadFootprintLibraryTables } from '@ziroeda/pcbnew/src/footprint_library.js';
import type { FootprintLibraryFs, LibraryDirEntry } from '@ziroeda/pcbnew/src/footprint_library.js';
import { readBoardFootprint } from '@ziroeda/pcbnew/src/read-board.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/src/types.js';

/** A filesystem over a flat path -> contents map, directories inferred. */
function makeFs(files: Record<string, string>): FootprintLibraryFs {
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
      for (const [name, isFile] of kinds) out.push({ name, isFile, mtimeSeconds: 0, size: 0 });
      return out;
    },
  };
}

/** A two-pad resistor, in the footprint's own frame as a library file holds it. */
const MOD = (padSize = '1 1'): string =>
  `(footprint "R_0603" (version 20240108) (generator "pcbnew") (layer "F.Cu")
  (pad "1" smd rect (at -0.8 0) (size ${padSize}) (layers "F.Cu" "F.Mask"))
  (pad "2" smd rect (at 0.8 0) (size 1 1) (layers "F.Cu" "F.Mask"))
  (fp_line (start -1 -0.5) (end 1 -0.5) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
)`;

/**
 * The same footprint as a board carries it: placed and rotated, under its full
 * LIB_ID. Child positions stay footprint-relative in the file and are baked to
 * board coordinates by the reader, while a pad's angle is written out already
 * absolute — which is why the pads here repeat the footprint's 90°.
 */
const boardFootprint = (fpid = 'Lib:R_0603', padSize = '1 1'): PcbFootprint =>
  readBoardFootprint(
    parse(`(footprint "${fpid}" (layer "F.Cu") (at 50 30 90)
  (pad "1" smd rect (at -0.8 0 90) (size ${padSize}) (layers "F.Cu" "F.Mask"))
  (pad "2" smd rect (at 0.8 0 90) (size 1 1) (layers "F.Cu" "F.Mask"))
  (fp_line (start -1 -0.5) (end 1 -0.5) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
)`),
  )!;

const TABLE = (rows: string): string => `(fp_lib_table\n  (version 7)\n${rows}\n)`;

const row = (nickname: string, uri: string, type = 'KiCad', extra = ''): string =>
  `  (lib (name "${nickname}")(type "${type}")(uri "${uri}")(options "")(descr "")${extra})`;

const resolve = (name: string): string | undefined => ({ KIPRJMOD: '/proj' })[name as 'KIPRJMOD'];

/** A query over a filesystem, with the project's own table loaded from it. */
function makeQuery(files: Record<string, string>): LibraryFootprintQuery {
  const fs = makeFs(files);

  return {
    fs,
    tables: loadFootprintLibraryTables({ fs, projectPath: '/proj', resolve, cwd: '/proj' }),
    resolve,
    cwd: '/proj',
  };
}

const WITH_LIBRARY = {
  '/proj/fp-lib-table': TABLE(row('Lib', '${KIPRJMOD}/Lib.pretty')),
  '/proj/Lib.pretty/R_0603.kicad_mod': MOD(),
};

describe('a footprint that still matches its library', () => {
  it('reports no relevant differences for a placed, rotated copy', () => {
    const report = diffFootprintAgainstLibrary(makeQuery(WITH_LIBRARY), boardFootprint());

    // If the placement leaked into the comparison this would list every pad,
    // and the diff would be useless on any real board.
    expect(report.status).toBe('found');
    expect(report.identical).toBe(true);
    expect(report.messages).toEqual(['No relevant differences detected.']);
  });

  it('hands back the library footprint for the visual diff', () => {
    const report = diffFootprintAgainstLibrary(makeQuery(WITH_LIBRARY), boardFootprint());

    // The dialog draws this one on top of the board one; without it the Visual
    // page has nothing to show.
    expect(report.libraryFootprint?.lib).toBe('R_0603');
    expect(report.libraryFootprint?.pads).toHaveLength(2);
    expect(report.library).toBe('Lib');
    expect(report.libraryItem).toBe('R_0603');
  });

  it('still loads a library that holds an unreadable file', () => {
    const report = diffFootprintAgainstLibrary(
      makeQuery({ ...WITH_LIBRARY, '/proj/Lib.pretty/Broken.kicad_mod': '(footprint "B" (layer' }),
      boardFootprint(),
    );

    // One corrupt file costs you that footprint and nothing else — the library
    // is not "not loaded" because of it.
    expect(report.status).toBe('found');
    expect(report.identical).toBe(true);
  });
});

describe('a footprint that has drifted from its library', () => {
  it('lists the differences instead of the reassurance', () => {
    const report = diffFootprintAgainstLibrary(
      makeQuery(WITH_LIBRARY),
      boardFootprint('Lib:R_0603', '2 2'),
    );

    expect(report.status).toBe('found');
    expect(report.identical).toBe(false);
    expect(report.messages).toEqual(['Pad properties differ.']);
  });

  it('compares in report mode, so a board-level override is listed', () => {
    // DiffFootprint passes no compare flags: the user asked what differs, and
    // the answer includes the things the DRC check suppresses.
    const footprint = boardFootprint();
    footprint.localClearance = 300000;

    const report = diffFootprintAgainstLibrary(makeQuery(WITH_LIBRARY), footprint);

    expect(report.messages).toEqual(['Pad clearance overridden.']);
    expect(report.identical).toBe(false);
  });
});

describe('when there is nothing to compare against', () => {
  it('says the library is not in the configuration when the nickname is unknown', () => {
    const report = diffFootprintAgainstLibrary(
      makeQuery(WITH_LIBRARY),
      boardFootprint('Other:R_0603'),
    );

    expect(report.status).toBe('library-not-configured');
    expect(report.messages).toEqual(['The library is not included in the current configuration.']);
    expect(report.libraryFootprint).toBeNull();
  });

  it('says the same for a footprint carrying no library nickname at all', () => {
    // A legacy LIB_ID resolves against the empty nickname and finds nothing.
    // It is emphatically not a search across every configured library.
    const report = diffFootprintAgainstLibrary(makeQuery(WITH_LIBRARY), boardFootprint('R_0603'));

    expect(report.status).toBe('library-not-configured');
    expect(report.library).toBe('');
    expect(report.libraryItem).toBe('R_0603');
  });

  it('says the same for a row naming a plugin we cannot read', () => {
    // Such a row can never reach LOADED, and HasLibrary answers for loaded.
    const report = diffFootprintAgainstLibrary(
      makeQuery({
        '/proj/fp-lib-table': TABLE(row('Lib', '${KIPRJMOD}/Lib.pretty', 'Altium')),
        '/proj/Lib.pretty/R_0603.kicad_mod': MOD(),
      }),
      boardFootprint(),
    );

    expect(report.status).toBe('library-not-configured');
  });

  it('says the same when the row is fine and the directory has gone', () => {
    // The row is right there in the table, so "not included in the current
    // configuration" is misleading — and it is what upstream says, because
    // HasLibrary( …, false ) is asking whether the library ever loaded.
    const report = diffFootprintAgainstLibrary(
      makeQuery({ '/proj/fp-lib-table': TABLE(row('Lib', '${KIPRJMOD}/Gone.pretty')) }),
      boardFootprint(),
    );

    expect(report.status).toBe('library-not-configured');
    expect(report.messages).toEqual(['The library is not included in the current configuration.']);
  });

  it('says the library is not enabled when the row is disabled', () => {
    const report = diffFootprintAgainstLibrary(
      makeQuery({
        '/proj/fp-lib-table': TABLE(row('Lib', '${KIPRJMOD}/Lib.pretty', 'KiCad', '(disabled)')),
        '/proj/Lib.pretty/R_0603.kicad_mod': MOD(),
      }),
      boardFootprint(),
    );

    expect(report.status).toBe('library-not-enabled');
    expect(report.messages).toEqual(['The library is not enabled in the current configuration.']);
  });

  it('prefers "not included" over "not enabled" when the row is both', () => {
    // Upstream asks the two questions in that order, and the first one it can
    // answer wins.
    const report = diffFootprintAgainstLibrary(
      makeQuery({
        '/proj/fp-lib-table': TABLE(row('Lib', '${KIPRJMOD}/Gone.pretty', 'KiCad', '(disabled)')),
      }),
      boardFootprint(),
    );

    expect(report.status).toBe('library-not-configured');
  });

  it('names the item when the library no longer holds it', () => {
    const report = diffFootprintAgainstLibrary(
      makeQuery({
        '/proj/fp-lib-table': TABLE(row('Lib', '${KIPRJMOD}/Lib.pretty')),
        '/proj/Lib.pretty/C_0402.kicad_mod': MOD(),
      }),
      boardFootprint(),
    );

    // The name has to be in the sentence: the user is being told which of the
    // footprints on this board has lost its original.
    expect(report.status).toBe('item-not-found');
    expect(report.messages).toEqual(['The library no longer contains the item R_0603.']);
    expect(report.identical).toBe(false);
  });
});

describe('resolveLibraryFootprint', () => {
  it('hands back the row it found even when the library is unusable', () => {
    // The caller wants to say *why* a library is unusable, which needs the row
    // that names it, not just the verdict.
    const resolved = resolveLibraryFootprint(
      makeQuery({
        '/proj/fp-lib-table': TABLE(row('Lib', '${KIPRJMOD}/Lib.pretty', 'KiCad', '(disabled)')),
        '/proj/Lib.pretty/R_0603.kicad_mod': MOD(),
      }),
      'Lib:R_0603',
    );

    expect(resolved.status).toBe('library-not-enabled');
    expect(resolved.row?.uri).toBe('${KIPRJMOD}/Lib.pretty');
    expect(resolved.footprint).toBeNull();
  });

  it('resolves a LIB_ID to the library original', () => {
    const resolved = resolveLibraryFootprint(makeQuery(WITH_LIBRARY), 'Lib:R_0603');

    expect(resolved.status).toBe('found');
    expect(resolved.footprint?.pads).toHaveLength(2);
  });
});
