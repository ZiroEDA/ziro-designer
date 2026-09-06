// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board footprints against their libraries.
 * Counterpart: `drc_test_provider_library_parity.cpp`.
 *
 * The libraries arrive through the same injected filesystem
 * `footprint_library.ts` takes, so every case here is a real `fp-lib-table`
 * plus real `.kicad_mod` text — the library side of the comparison is parsed,
 * not hand-built, because a hand-built "library footprint" would test the
 * comparator and nothing else.
 *
 * The distinction that carries the whole feature is which of the two codes
 * comes out. `lib_footprint_issues` means the library could not be consulted;
 * `lib_footprint_mismatch` means it was, and the board has drifted. Board Setup
 * gives them separate severities, so conflating them is not a cosmetic error.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { runDrc, type DrcOptions } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { checkLibraryParity } from '@ziroeda/pcbnew/src/drc/drc_library_parity.js';
import { loadFootprintLibraryTables } from '@ziroeda/pcbnew/src/footprint_library.js';
import type { FootprintLibraryFs, LibraryDirEntry } from '@ziroeda/pcbnew/src/footprint_library.js';
import type { Board, PcbFootprint, PcbPad, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/* -------------------------------------------------------------------------- */
/*  A filesystem, counting the directory scans it is asked for                 */
/* -------------------------------------------------------------------------- */

interface CountingFs extends FootprintLibraryFs {
  /** How many times each directory has been listed. */
  readonly scans: Map<string, number>;
}

/** Directories are inferred from the paths, as in footprint_library.test.ts. */
function makeFs(files: Record<string, string>): CountingFs {
  const scans = new Map<string, number>();

  return {
    scans,
    readFile: (path) => files[path] ?? null,
    listDirectory: (path) => {
      scans.set(path, (scans.get(path) ?? 0) + 1);

      const prefix = `${path}/`;
      const kinds = new Map<string, boolean>();

      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf('/');
        kinds.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1);
      }

      if (kinds.size === 0) return null;

      const out: LibraryDirEntry[] = [];
      for (const [name, isFile] of kinds) out.push({ name, isFile, mtimeSeconds: 0, size: 0 });
      return out;
    },
  };
}

const resolve = (name: string): string | undefined => ({ KIPRJMOD: '/proj' })[name];

const fpTable = (...rows: string[]): string =>
  `(fp_lib_table\n  (version 7)\n${rows.join('\n')}\n)`;

const libRow = (nickname: string, uri: string, extra = ''): string =>
  `  (lib (name "${nickname}")(type "KiCad")(uri "${uri}")(options "")(descr "")${extra})`;

/* -------------------------------------------------------------------------- */
/*  The library footprint, as a file                                          */
/* -------------------------------------------------------------------------- */

/** A two-pad chip resistor with one silkscreen line, sitting at the origin. */
const R_0603 = `(footprint "R_0603" (version 20240108) (generator "pcbnew") (layer "F.Cu")
  (attr smd)
  (fp_line (start -1.5 -0.7) (end 1.5 -0.7) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (pad "1" smd rect (at -0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd rect (at 0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask"))
)`;

/* -------------------------------------------------------------------------- */
/*  The same footprint, placed on a board                                     */
/* -------------------------------------------------------------------------- */

const ORIGIN = { x: MM(10), y: MM(20) };

const pad = (number: string, localX: number, over: Partial<PcbPad> = {}): PcbPad => ({
  number,
  type: 'smd',
  shape: 'rect',
  at: { x: ORIGIN.x + MM(localX), y: ORIGIN.y },
  angle: 0,
  size: { x: MM(0.9), y: MM(0.95) },
  layers: ['F.Cu', 'F.Paste', 'F.Mask'],
  net: 0,
  source: EMPTY,
  ...over,
});

const silk = (): PcbShape => ({
  kind: 'line',
  start: { x: ORIGIN.x + MM(-1.5), y: ORIGIN.y + MM(-0.7) },
  end: { x: ORIGIN.x + MM(1.5), y: ORIGIN.y + MM(-0.7) },
  width: MM(0.12),
  fillMode: 'none',
  layer: 'F.SilkS',
  source: EMPTY,
});

/** A board copy of R_0603 that matches the library exactly. */
const fp = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'Resistors:R_0603',
  reference: 'R1',
  value: '10k',
  at: { ...ORIGIN },
  angle: 0,
  layer: 'F.Cu',
  attributes: ['smd'],
  pads: [pad('1', -0.8), pad('2', 0.8)],
  shapes: [silk()],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  source: EMPTY,
  ...over,
});

const board = (footprints: PcbFootprint[]): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints,
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
});

/* -------------------------------------------------------------------------- */
/*  Wiring                                                                    */
/* -------------------------------------------------------------------------- */

interface Setup {
  fs: CountingFs;
  run: (footprints: PcbFootprint[]) => ReturnType<typeof checkLibraryParity>;
}

/**
 * A project whose `fp-lib-table` is `files['/proj/fp-lib-table']`, with the
 * libraries it names living in the same `files` map.
 */
function setup(files: Record<string, string>): Setup {
  const fs = makeFs(files);
  const tables = loadFootprintLibraryTables({ fs, projectPath: '/proj', resolve, cwd: '/proj' });

  return {
    fs,
    run: (footprints) =>
      checkLibraryParity(board(footprints), { fs, tables, resolve, cwd: '/proj' }),
  };
}

/** A project with one library, `Resistors`, holding an unmodified R_0603. */
const goodProject = (): Setup =>
  setup({
    '/proj/fp-lib-table': fpTable(libRow('Resistors', '${KIPRJMOD}/lib.pretty')),
    '/proj/lib.pretty/R_0603.kicad_mod': R_0603,
  });

const codes = (vs: { code: string }[]): string[] => vs.map((v) => v.code);

/* -------------------------------------------------------------------------- */

describe('library parity: a footprint that matches its library', () => {
  it('reports nothing at all', () => {
    // If this fires, every board in the world reports a mismatch on every
    // footprint and the check is worse than not having it. The board copy is
    // placed at (10, 20) mm while the library copy sits at the origin, so this
    // is also the assertion that the comparison happens in the footprint's own
    // frame rather than in board coordinates.
    expect(goodProject().run([fp()])).toEqual([]);
  });

  it('reads the library once however many footprints use it', () => {
    const one = goodProject();
    one.run([fp()]);

    const four = goodProject();
    four.run([
      fp({ reference: 'R1' }),
      fp({ reference: 'R2' }),
      fp({ reference: 'R3' }),
      fp({ reference: 'R4' }),
    ]);

    // Upstream loads each library once and answers from PreloadedFootprints
    // afterwards. Without the cache a board with two hundred resistors would
    // re-scan and re-parse the resistor library two hundred times. Measured
    // against a one-footprint run rather than against a literal count, because
    // a single load costs two listings — the enumeration and the timestamp.
    expect(four.fs.scans.get('/proj/lib.pretty')).toBe(one.fs.scans.get('/proj/lib.pretty'));
  });
});

describe('library parity: the library cannot be consulted', () => {
  it('reports the nickname as not configured when no row names it', () => {
    const { run } = goodProject();
    const violations = run([fp({ lib: 'Capacitors:C_0603' })]);

    // `issues`, never `mismatch`: nothing was compared, so claiming the
    // footprint had drifted would be a lie.
    expect(codes(violations)).toEqual(['lib_footprint_issues']);
    expect(violations[0]?.message).toBe(
      "The current configuration does not include the footprint library 'Capacitors'",
    );
  });

  it('unescapes the nickname it names, so a `{slash}` reads as a slash', () => {
    const { run } = setup({ '/proj/fp-lib-table': fpTable() });

    // The nickname is stored escaped in the LIB_ID. Printing it raw would show
    // the user a nickname that does not appear anywhere in their library table.
    expect(run([fp({ lib: 'Foo{slash}Bar:R_0603' })])[0]?.message).toBe(
      "The current configuration does not include the footprint library 'Foo/Bar'",
    );
  });

  it('reports a disabled library as not enabled', () => {
    const { run } = setup({
      '/proj/fp-lib-table': fpTable(libRow('Resistors', '${KIPRJMOD}/lib.pretty', '(disabled)')),
      '/proj/lib.pretty/R_0603.kicad_mod': R_0603,
    });

    const violations = run([fp()]);

    // `loadFootprintFromLibraries` deliberately ignores `disabled` — the load
    // path never consults the flag. This check does, through HasLibrary's
    // aCheckEnabled, so the two must not be collapsed into one another.
    expect(codes(violations)).toEqual(['lib_footprint_issues']);
    expect(violations[0]?.message).toBe(
      "The footprint library 'Resistors' is not enabled in the current configuration",
    );
  });

  it('unescapes the nickname in a configuration message but not elsewhere', () => {
    // The three configuration messages run the nickname through UnescapeString
    // and the two that name a footprint do not. A nickname with no escape in it
    // cannot tell the two apart, so this one carries `{slash}`: the config
    // message must read `R/Lib` and the not-found message must keep the raw
    // token, or the asymmetry is only half pinned.
    const escaped = 'R{slash}Lib';

    const disabled = setup({
      '/proj/fp-lib-table': fpTable(libRow(escaped, '${KIPRJMOD}/lib.pretty', '(disabled)')),
      '/proj/lib.pretty/R_0603.kicad_mod': R_0603,
    });
    expect(disabled.run([fp({ lib: `${escaped}:R_0603` })])[0]?.message).toBe(
      "The footprint library 'R/Lib' is not enabled in the current configuration",
    );

    const absent = setup({
      '/proj/fp-lib-table': fpTable(libRow(escaped, '${KIPRJMOD}/lib.pretty')),
      '/proj/lib.pretty/Other.kicad_mod': R_0603,
    });
    expect(absent.run([fp({ lib: `${escaped}:R_0603` })])[0]?.message).toBe(
      `Footprint 'R_0603' not found in library '${escaped}'`,
    );
  });

  it('reports a missing library directory as not enabled, not as not found', () => {
    const { run } = setup({
      '/proj/fp-lib-table': fpTable(libRow('Resistors', '${KIPRJMOD}/gone.pretty')),
    });

    // Upstream's "was not found at '<uri>'" message is unreachable: reaching
    // its test requires HasLibrary to have already returned true, which means
    // the library *is* loaded. So an unreadable library is announced as though
    // the user had switched it off. Reproduced, not repaired.
    expect(run([fp()])[0]?.message).toBe(
      "The footprint library 'Resistors' is not enabled in the current configuration",
    );
  });

  it('treats one unparseable file as the whole library failing to load', () => {
    const { run } = setup({
      '/proj/fp-lib-table': fpTable(libRow('Resistors', '${KIPRJMOD}/lib.pretty')),
      '/proj/lib.pretty/R_0603.kicad_mod': R_0603,
      '/proj/lib.pretty/broken.kicad_mod': '(footprint "broken" (this is not',
    });

    const violations = run([fp()]);

    // FootprintEnumerate( …, aBestEfforts = false ) throws when *any* file in
    // the directory failed, so LoadOne records LOAD_ERROR for the library even
    // though R_0603 itself parsed perfectly well. If this ever reports nothing
    // — or a mismatch — we have quietly started comparing against a library
    // KiCad considers unloaded, and would disagree with it about every board.
    expect(codes(violations)).toEqual(['lib_footprint_issues']);
    expect(violations[0]?.message).toBe(
      "The footprint library 'Resistors' is not enabled in the current configuration",
    );
  });

  it('reports a footprint the library does not hold', () => {
    const violations = goodProject().run([fp({ lib: 'Resistors:R_0805' })]);

    // The library loaded, so this is a genuine "not in there" rather than a
    // configuration problem — but it is still `issues`, because nothing was
    // compared. Note the nickname is *not* unescaped in this message where it
    // is in the three above; that inconsistency is upstream's.
    expect(codes(violations)).toEqual(['lib_footprint_issues']);
    expect(violations[0]?.message).toBe("Footprint 'R_0805' not found in library 'Resistors'");
  });

  it('leaves both names escaped in that message, where the others unescape', () => {
    const { run } = setup({
      '/proj/fp-lib-table': fpTable(libRow('R{slash}s', '${KIPRJMOD}/lib.pretty')),
      '/proj/lib.pretty/R_0603.kicad_mod': R_0603,
    });

    // Upstream unescapes the nickname in the three configuration messages and
    // in neither of these two. Tidying it up here would put a string in front
    // of the user that no other KiCad surface prints.
    expect(run([fp({ lib: 'R{slash}s:C{slash}0603' })])[0]?.message).toBe(
      "Footprint 'C{slash}0603' not found in library 'R{slash}s'",
    );
  });

  it('will not read a library served by an IO plugin we do not have', () => {
    const { run } = setup({
      '/proj/fp-lib-table': fpTable(
        `  (lib (name "Resistors")(type "Legacy")(uri "\${KIPRJMOD}/lib.pretty")(options "")(descr ""))`,
      ),
      '/proj/lib.pretty/R_0603.kicad_mod': R_0603,
    });

    // The directory here happens to hold readable `.kicad_mod` files, so a
    // check that ignored the plugin name would report parity against a library
    // KiCad would have read with an entirely different reader. Saying "not
    // enabled" is the honest answer: we cannot tell.
    expect(run([fp()])[0]?.message).toBe(
      "The footprint library 'Resistors' is not enabled in the current configuration",
    );
  });

  it('says nothing about a footprint carrying no library nickname', () => {
    // A legacy LIB_ID has no nickname to resolve, and upstream simply moves on
    // — "not much we can do here". Reporting it would light up every board
    // imported from a pre-v5 file with errors the user cannot act on.
    expect(goodProject().run([fp({ lib: 'R_0603' })])).toEqual([]);
  });
});

describe('library parity: the board copy has drifted', () => {
  it('reports a moved pad as a mismatch', () => {
    const drifted = fp();
    drifted.pads[1] = pad('2', 1.2);

    const violations = goodProject().run([drifted]);

    // `mismatch`, not `issues`: the library was read and the comparison ran.
    expect(codes(violations)).toEqual(['lib_footprint_mismatch']);
    expect(violations[0]?.message).toBe(
      "Footprint 'R_0603' does not match copy in library 'Resistors'",
    );
  });

  it('reports an edited silkscreen line as a mismatch', () => {
    const drifted = fp({ shapes: [] });

    expect(codes(goodProject().run([drifted]))).toEqual(['lib_footprint_mismatch']);
  });

  it('ignores differences DRC mode is meant to ignore', () => {
    // `dnp` and a local clearance override are as likely to be set deliberately
    // on the board as in the library, so upstream's COMPARE_FLAGS::DRC skips
    // them. Reporting them would make every board with an override noisy, and a
    // noisy check gets switched off. This is the assertion that the comparator
    // is called in `drc` mode rather than `report` mode.
    const local = fp({ attributes: ['smd', 'dnp'], localClearance: MM(0.2) });

    expect(goodProject().run([local])).toEqual([]);
  });

  it('places the marker on the offending footprint, under either code', () => {
    const { run } = goodProject();

    // The DRC dialog locates a violation by this position; at the board origin
    // the user would be sent to the corner of the sheet every time.
    const mismatch = run([fp({ shapes: [] })])[0];
    expect(mismatch?.pos).toEqual(ORIGIN);
    expect(mismatch?.items).toEqual([{ desc: 'Footprint R1', pos: ORIGIN }]);

    // The `issues` path builds its own violation and so needs its own
    // assertion. This one also has no reference — an unannotated footprint
    // falls back to its LIB_ID rather than describing itself as "Footprint ".
    const elsewhere = { x: MM(80), y: MM(60) };
    const issue = run([fp({ lib: 'Resistors:R_0805', reference: undefined, at: elsewhere })])[0];
    expect(issue?.pos).toEqual(elsewhere);
    expect(issue?.items).toEqual([{ desc: 'Footprint Resistors:R_0805', pos: elsewhere }]);
  });

  it('reports each drifted footprint separately, in board order', () => {
    const { run } = goodProject();
    const violations = run([
      fp({ reference: 'R1' }),
      fp({ reference: 'R2', shapes: [] }),
      fp({ reference: 'R3', lib: 'Resistors:R_0805' }),
    ]);

    expect(codes(violations)).toEqual(['lib_footprint_mismatch', 'lib_footprint_issues']);
    expect(violations.map((v) => v.items[0]?.desc)).toEqual(['Footprint R2', 'Footprint R3']);
  });
});

describe('library parity through the DRC engine', () => {
  const drcOptions: DrcOptions = {
    minClearance: 0,
    minTrackWidth: 0,
    minViaDiameter: 0,
    minViaAnnulus: 0,
    minThroughHole: 0,
    minHoleToHole: 0,
  };

  it('does not run when the caller supplies no libraries', () => {
    // Upstream bails on `if( !project )` before touching a library. Without
    // that bail, opening a board with no project would report every footprint
    // as having an unconfigured library.
    const violations = runDrc(board([fp({ lib: 'Nowhere:R_0603' })]), drcOptions);

    expect(violations.filter((v) => v.code.startsWith('lib_footprint_'))).toEqual([]);
  });

  it('runs when they are supplied', () => {
    const files = {
      '/proj/fp-lib-table': fpTable(libRow('Resistors', '${KIPRJMOD}/lib.pretty')),
      '/proj/lib.pretty/R_0603.kicad_mod': R_0603,
    };
    const fs = makeFs(files);
    const tables = loadFootprintLibraryTables({ fs, projectPath: '/proj', resolve, cwd: '/proj' });

    const violations = runDrc(board([fp({ shapes: [] })]), {
      ...drcOptions,
      libraries: { fs, tables, resolve, cwd: '/proj' },
    });

    // The engine has to actually forward the option; a check nothing calls is
    // indistinguishable from a check that always passes.
    expect(
      violations.filter((v) => v.code.startsWith('lib_footprint_')).map((v) => v.code),
    ).toEqual(['lib_footprint_mismatch']);
  });
});
