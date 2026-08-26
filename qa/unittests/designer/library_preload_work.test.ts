// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the preload actually fetches.
 *
 * `symbolPreloadWork` / `footprintPreloadWork` return a list of thunks, and a
 * test that only counted them would be pinning a length — CLAUDE.md's "a value
 * nothing ever reads". So each list is RUN against a stubbed host and the URLs
 * it asks for are the expectation.
 *
 * The substitution these two make for upstream's "load every table row" is
 * argued in designer/src/libraryPreload.ts; what is pinned here is that the
 * design's own items are in the list and that nothing else is.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const INDEX = JSON.stringify([{ name: 'Device', count: 1, symbols: ['R'] }]);
/** Three library-table rows, which is what the preload's work list is built from. */
const THREE_LIB_INDEX = JSON.stringify([
  { name: 'Device', count: 1, symbols: ['R'] },
  { name: 'Connector', count: 1, symbols: ['Conn_01x01'] },
  { name: '74xGxx', count: 1, symbols: ['Inverter_Schmitt_Dual'] },
]);
/** A whole merged library, which is what `<base>/<Library>.kicad_sym` serves. */
const LIB_FILE = `(kicad_symbol_lib (version 20241209) (generator "x")
	(symbol "R" (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))))
`;
const FP_INDEX = JSON.stringify([{ name: 'Resistor_SMD', footprints: ['R_0805'] }]);
/** The per-symbol file the host serves at `<base>/<Library>/<Symbol>.kicad_sym`,
 *  holding the symbol asked for (tools/libraries/upload.mjs). */
const oneSymbol = (name: string): string =>
  `(kicad_symbol_lib (version 20241209) (generator "x")
	(symbol "${name}" (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))))
`;

/** The symbol name a `<base>/<Library>/<Symbol>.kicad_sym` URL asks for. */
const symbolOf = (url: string): string =>
  decodeURIComponent(
    url
      .split('/')
      .pop()
      ?.replace(/\.kicad_sym$/, '') ?? '',
  );
const ONE_FOOTPRINT = '(footprint "R_0805" (layer "F.Cu"))';

let requested: string[] = [];

function serve(body: (url: string) => string | null): void {
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL) => {
      const url = String(input);
      requested.push(url);
      const text = body(url);
      return Promise.resolve(
        text === null ? new Response('nope', { status: 404 }) : new Response(text, { status: 200 }),
      );
    }),
  );
  // Cache Storage is what `fetchLibraryIndex` consults first; absent, it goes
  // straight to the network, which is what these tests want to observe.
  vi.stubGlobal('caches', undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function freshSymbols(): Promise<
  typeof import('@ziroeda/designer/src/editors/schematic/symbols/index.js')
> {
  vi.resetModules();
  return import('@ziroeda/designer/src/editors/schematic/symbols/index.js');
}

async function freshFootprints(): Promise<
  typeof import('@ziroeda/designer/src/widgets/footprint_list.js')
> {
  vi.resetModules();
  return import('@ziroeda/designer/src/widgets/footprint_list.js');
}

const runAll = async (work: readonly (() => Promise<unknown>)[]): Promise<void> => {
  for (const item of work) await item().catch(() => undefined);
};

describe('symbolPreloadWork', { timeout: 30_000 }, () => {
  it('fetches every library in the index, whole, and nothing per-symbol', async () => {
    // Upstream's adapter loads every row of the symbol library table, and this
    // now does the same: one whole-library fetch each. The old bounded list -
    // the index plus the symbols the design already placed - was justified by
    // the set being "219.7 MB", which was its UNCOMPRESSED size; stored with
    // content-encoding the same 223 libraries are 9.7 MB.
    serve((url) => (url.endsWith('index.json') ? THREE_LIB_INDEX : LIB_FILE));
    const { symbolPreloadWork } = await freshSymbols();

    const work = await symbolPreloadWork();
    await runAll(work);

    for (const lib of ['Device', 'Connector', '74xGxx'])
      expect(requested.some((u) => u.endsWith(`/symbols/${lib}.kicad_sym`))).toBe(true);
    // Per-symbol files are the OLD shape. Fetching one library as N symbol
    // files was 536 requests for Device alone.
    expect(requested.some((u) => /\/symbols\/[^/]+\/[^/]+\.kicad_sym$/.test(u))).toBe(false);
  });

  it('counts libraries, because that is what m_loadTotal counts', async () => {
    // `m_loadTotal = rows.size()` (library_manager.cpp:1798-1800) and the gauge
    // is loaded/total, so one work item per library is the denominator KiCad
    // shows. The index is awaited before the list exists rather than being an
    // item in it: it IS our library table, and upstream knows its row count
    // before the load starts.
    serve((url) => (url.endsWith('index.json') ? THREE_LIB_INDEX : LIB_FILE));
    const { symbolPreloadWork } = await freshSymbols();

    const work = await symbolPreloadWork();

    expect(work).toHaveLength(3);
    await runAll(work);
    expect(requested.filter((u) => u.endsWith('.kicad_sym'))).toHaveLength(3);
  });

  it('does not depend on what the design places', async () => {
    // The control on the two above. The old list was built FROM the design, so
    // an empty schematic preloaded almost nothing and every later chooser
    // search saw only library names. A design-independent list is the whole
    // point, so this must not vary with it.
    serve((url) => (url.endsWith('index.json') ? THREE_LIB_INDEX : LIB_FILE));
    const { symbolPreloadWork } = await freshSymbols();

    expect(await symbolPreloadWork()).toHaveLength(3);
  });
});
describe('footprintPreloadWork', { timeout: 30_000 }, () => {
  it('fetches the index and each assigned footprint', async () => {
    serve((url) => (url.endsWith('index.json') ? FP_INDEX : ONE_FOOTPRINT));
    const { footprintPreloadWork } = await freshFootprints();

    await runAll(footprintPreloadWork(['Resistor_SMD:R_0805_2012Metric', 'R_0805']));

    expect(requested[0]).toMatch(/\/footprints\/index\.json$/);
    expect(requested).toHaveLength(2);
    // `<base>/<Library>.pretty/<Footprint>.kicad_mod`, libraryHosts.ts:30.
    expect(requested[1]).toMatch(
      /\/footprints\/Resistor_SMD\.pretty\/R_0805_2012Metric\.kicad_mod$/,
    );
  });

  it('asks for a repeated footprint once, and counts it once', async () => {
    // Same reasoning as the symbol side: `loadFootprint` memoises on `fpCache`,
    // so the fetch count alone cannot see the dedupe. The work-list length is
    // the gauge's denominator.
    serve((url) => (url.endsWith('index.json') ? FP_INDEX : ONE_FOOTPRINT));
    const { footprintPreloadWork } = await freshFootprints();

    const work = footprintPreloadWork([
      'Resistor_SMD:R_0805_2012Metric',
      'Resistor_SMD:R_0805_2012Metric',
    ]);
    await runAll(work);

    expect(requested).toHaveLength(2);
    expect(work).toHaveLength(2);
    expect(work.length).toBe(requested.length);
  });
});

describe('the design is walked for exactly the ids the preload wants', () => {
  it('placedSymbolIds takes every symbol in every sheet', async () => {
    const { placedSymbolIds, assignedFootprintIds } = await import(
      '@ziroeda/designer/src/editors/schematic/preload.js'
    );
    const sheet = (libId: string, fp: string) =>
      ({
        symbols: [{ libId, fields: [{ key: 'Footprint', value: fp }] }],
      }) as never;

    // `PreloadLibraries` is hierarchy-wide because the library table is:
    // entering a sub-sheet must not start a fresh wait.
    expect(placedSymbolIds([sheet('Device:R', 'A:x'), sheet('Device:C', 'B:y')]).sort()).toEqual([
      'Device:C',
      'Device:R',
    ]);
    expect(
      assignedFootprintIds([sheet('Device:R', 'A:x'), sheet('Device:C', 'B:y')]).sort(),
    ).toEqual(['A:x', 'B:y']);
  });

  it('an unassigned Footprint field is not a fetch', async () => {
    const { assignedFootprintIds } = await import(
      '@ziroeda/designer/src/editors/schematic/preload.js'
    );
    const sheet = {
      symbols: [
        { libId: 'Device:R', fields: [{ key: 'Footprint', value: '' }] },
        { libId: 'Device:C', fields: [{ key: 'Reference', value: 'C1' }] },
      ],
    } as never;
    expect(assignedFootprintIds([sheet])).toEqual([]);
  });

  it('placedFootprintIds takes every footprint on the board', async () => {
    const { placedFootprintIds } = await import('@ziroeda/designer/src/editors/pcb/preload.js');
    const board = {
      footprints: [{ lib: 'Resistor_SMD:R_0805' }, { lib: 'Resistor_SMD:R_0805' }, { lib: 'bare' }],
    } as never;
    expect(placedFootprintIds(board)).toEqual(['Resistor_SMD:R_0805']);
  });
});
