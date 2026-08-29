// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LOAD_STATUS::LOADED`, and the two things that hang off it.
 *
 * `SYMBOL_TREE_MODEL_ADAPTER::AddLibraries` asks
 * `m_adapter->GetLibraryStatus( lib )` for every row of the library table and
 * adds ONLY the libraries that are LOADED; the rest go to
 * `m_pending_load_libraries` and are skipped
 * (eeschema/symbol_tree_model_adapter.cpp:130-139). If that set is not empty a
 * wxTimer at 1000 ms re-runs AddLibraries until it empties (:189-210), and the
 * retry looks at the PENDING set alone rather than rebuilding the tree
 * (:107-124, `if( toLoad.empty() )`).
 *
 * We listed every library from the index whether it was loaded or not, so the
 * chooser showed 223 bare rows with empty descriptions while the status bar
 * still read "Loading Symbol Libraries".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const INDEX = JSON.stringify([
  { name: 'Device', count: 1, symbols: ['R'], descr: 'Devices' },
  { name: 'Connector', count: 1, symbols: ['Conn_01x01'], descr: 'Connectors' },
]);
const LIB_FILE = `(kicad_symbol_lib (version 20241209) (generator "x")
\t(symbol "R" (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))))
`;

function serve(body: (url: string) => string | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL) => {
      const text = body(String(input));
      return Promise.resolve(
        text === null ? new Response('nope', { status: 404 }) : new Response(text, { status: 200 }),
      );
    }),
  );
  vi.stubGlobal('caches', undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fresh(): Promise<
  typeof import('@ziroeda/designer/src/editors/schematic/symbols/index.js')
> {
  vi.resetModules();
  return import('@ziroeda/designer/src/editors/schematic/symbols/index.js');
}

describe('libraryLoaded', { timeout: 30_000 }, () => {
  it('is false before anything is fetched', async () => {
    serve((url) => (url.endsWith('index.json') ? INDEX : LIB_FILE));
    const { libraryLoaded } = await fresh();

    // `!status` is upstream's first case, and it means pending, not loaded.
    expect(libraryLoaded('Device')).toBe(false);
  });

  it('is still false while the fetch is in flight', async () => {
    // The test that matters for the gate: a pending PROMISE is not LOADED. A
    // predicate written as `libCache.has(name)` would answer true here, the
    // tree would list a library whose symbols have not arrived, and the whole
    // point of the gate would be lost.
    let release: (v: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) =>
        String(input).endsWith('index.json')
          ? Promise.resolve(new Response(INDEX, { status: 200 }))
          : new Promise<Response>((r) => {
              release = r;
            }),
      ),
    );
    vi.stubGlobal('caches', undefined);
    const { loadLibrarySymbols, libraryLoaded } = await fresh();

    const inFlight = loadLibrarySymbols('Device');
    expect(libraryLoaded('Device')).toBe(false);

    release(new Response(LIB_FILE, { status: 200 }));
    await inFlight;
    expect(libraryLoaded('Device')).toBe(true);
  });

  it('is true once the library has been read, and only for that library', async () => {
    serve((url) => (url.endsWith('index.json') ? INDEX : LIB_FILE));
    const { loadLibrarySymbols, libraryLoaded } = await fresh();

    await loadLibrarySymbols('Device');

    expect(libraryLoaded('Device')).toBe(true);
    // The control: loading one library must not mark the table LOADED.
    expect(libraryLoaded('Connector')).toBe(false);
  });

  it('stays false for a library that failed to load', async () => {
    // `if( status->load_status == LOAD_ERROR ) continue;` — an errored library
    // is not added either, and must not be reported as loaded.
    serve((url) => (url.endsWith('index.json') ? INDEX : null));
    const { loadLibrarySymbols, libraryLoaded } = await fresh();

    await loadLibrarySymbols('Device').catch(() => undefined);

    expect(libraryLoaded('Device')).toBe(false);
  });
});
