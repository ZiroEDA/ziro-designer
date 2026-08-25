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
  it('fetches the index and each placed symbol, and nothing else', async () => {
    serve((url) => (url.endsWith('index.json') ? INDEX : oneSymbol(symbolOf(url))));
    const { symbolPreloadWork } = await freshSymbols();

    const work = symbolPreloadWork(['Device:R', 'Device:C']);
    await runAll(work);

    // The index is item 0, so the tree can be built even if every symbol fetch
    // fails — it is what the chooser lists from.
    expect(requested[0]).toMatch(/\/symbols\/index\.json$/);
    expect(requested.some((u) => u.endsWith('/symbols/Device/R.kicad_sym'))).toBe(true);
    expect(requested.some((u) => u.endsWith('/symbols/Device/C.kicad_sym'))).toBe(true);
    // No whole-library fetch: `Device.kicad_sym` alone is 500 kB, and the
    // preload exists to avoid exactly that shape of download.
    expect(requested.some((u) => /\/symbols\/Device\.kicad_sym$/.test(u))).toBe(false);
    expect(requested).toHaveLength(3);
  });

  it('asks for a repeated symbol once', async () => {
    // A design places twenty 100 nF capacitors; that is one fetch, not twenty.
    serve((url) => (url.endsWith('index.json') ? INDEX : oneSymbol(symbolOf(url))));
    const { symbolPreloadWork } = await freshSymbols();

    await runAll(symbolPreloadWork(['Device:R', 'Device:R', 'Device:R']));

    expect(requested.filter((u) => u.endsWith('/Device/R.kicad_sym'))).toHaveLength(1);
  });

  it('drops a LIB_ID with no library part rather than 404ing on it', async () => {
    // `LIB_ID::IsValid` wants both halves; a bare name resolves through no
    // library table row at all, so there is nothing to fetch.
    serve((url) => (url.endsWith('index.json') ? INDEX : oneSymbol(symbolOf(url))));
    const { symbolPreloadWork } = await freshSymbols();

    await runAll(symbolPreloadWork(['R', ':R', 'Device:', 'Device:R']));

    expect(requested).toHaveLength(2);
    expect(requested[1]).toMatch(/\/Device\/R\.kicad_sym$/);
  });

  it('is just the index when the design places nothing', async () => {
    serve(() => INDEX);
    const { symbolPreloadWork } = await freshSymbols();
    expect(symbolPreloadWork([])).toHaveLength(1);
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

  it('asks for a repeated footprint once', async () => {
    serve((url) => (url.endsWith('index.json') ? FP_INDEX : ONE_FOOTPRINT));
    const { footprintPreloadWork } = await freshFootprints();

    await runAll(
      footprintPreloadWork(['Resistor_SMD:R_0805_2012Metric', 'Resistor_SMD:R_0805_2012Metric']),
    );

    expect(requested).toHaveLength(2);
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
