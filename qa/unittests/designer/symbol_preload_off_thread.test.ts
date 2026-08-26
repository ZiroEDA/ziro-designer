// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The symbol preload does not read or parse a library on the thread that draws.
 *
 * `SYMBOL_LIBRARY_ADAPTER::AsyncLoad` (common/libraries/library_manager.cpp:1786-1800)
 * submits one task per library table row to `GetKiCadThreadPool()` and returns;
 * `IFACE::PreloadLibraries` (eeschema/eeschema.cpp:487-607) then only polls
 * `AsyncLoadProgress()` every 150 ms. Nothing about the load runs on the UI
 * thread.
 *
 * Ours ran all of it there. `readSymbolLib( parse( text ) )` over the hosted set
 * measured 35 434 ms of main-thread CPU across 223 libraries, in 92 tasks longer
 * than 50 ms with the worst at 2 030 ms (qa/perf/parse_all.bench.ts), so a
 * keystroke or a scroll during a project open waited behind whichever library
 * was mid-parse.
 *
 * `qa` has no `Worker`, so one is stubbed here. That makes this a real
 * behavioural test rather than a structural one: the assertion is that the
 * library bytes are asked for by the WORKER and never by this thread, which is
 * exactly the property that was broken, and it fails if the work goes back
 * inline. What it cannot cover is the worker script itself executing — that
 * needs a browser.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const THREE_LIB_INDEX = JSON.stringify([
  { name: 'Device', count: 1, symbols: ['R'] },
  { name: 'Connector', count: 1, symbols: ['Conn_01x01'] },
  { name: '74xGxx', count: 1, symbols: ['Inverter_Schmitt_Dual'] },
]);

interface PreloadRequest {
  id: number;
  library: string;
  url: string;
}

/** Every `postMessage` any worker in the pool received. */
let posted: PreloadRequest[] = [];
/** Every URL this thread fetched. */
let fetched: string[] = [];
/** The `new Worker(...)` arguments, one entry per worker created. */
let created: { url: string; options: unknown }[] = [];

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(url: URL | string, options?: unknown) {
    created.push({ url: String(url), options });
  }

  postMessage(request: PreloadRequest): void {
    posted.push(request);
    // A real worker answers on a later turn, and the pool must not assume
    // otherwise.
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          id: request.id,
          library: request.library,
          items: [
            {
              name: 'R',
              description: 'Resistor',
              keywords: 'R res resistor',
              footprint: '',
              isPower: false,
              isRoot: true,
              pinCount: 2,
              unitCount: 1,
              chooserFields: [],
            },
          ],
        },
      });
    });
  }

  terminate(): void {}
}

beforeEach(() => {
  posted = [];
  fetched = [];
  created = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL) => {
      const url = String(input);
      fetched.push(url);
      return Promise.resolve(
        url.endsWith('index.json')
          ? new Response(THREE_LIB_INDEX, { status: 200 })
          : new Response('(kicad_symbol_lib (version 20241209) (generator "x"))', { status: 200 }),
      );
    }),
  );
  vi.stubGlobal('caches', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function freshSymbols(): Promise<
  typeof import('@ziroeda/designer/src/editors/schematic/symbols/index.js')
> {
  vi.resetModules();
  return import('@ziroeda/designer/src/editors/schematic/symbols/index.js');
}

const runAll = async (work: readonly (() => Promise<unknown>)[]): Promise<void> => {
  await Promise.all(work.map((item) => item().catch(() => undefined)));
};

describe('symbolPreloadWork with a worker available', () => {
  it('hands every library to a worker and fetches none of them here', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { symbolPreloadWork } = await freshSymbols();

    await runAll(await symbolPreloadWork());

    // One task per library table row, as `m_loadTotal = rows.size()`.
    expect(posted.map((p) => p.library).sort()).toEqual(['74xGxx', 'Connector', 'Device']);
    for (const lib of ['Device', 'Connector', '74xGxx'])
      expect(posted.some((p) => p.url.endsWith(`/symbols/${lib}.kicad_sym`))).toBe(true);

    // The whole point: the library bytes never reached this thread. The index
    // still does — it is the library TABLE, and upstream knows its row count
    // before the load starts.
    expect(fetched.filter((u) => u.endsWith('.kicad_sym'))).toEqual([]);
    expect(fetched.every((u) => u.endsWith('index.json'))).toBe(true);
  });

  it('creates module workers, because the worker imports the parser', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { symbolPreloadWork } = await freshSymbols();

    await runAll(await symbolPreloadWork());

    expect(created.length).toBeGreaterThan(0);
    for (const w of created) {
      // A classic worker cannot `import { parse } from '@ziroeda/sexpr'`, and
      // the bundler only emits the separate chunk for the module form.
      expect(w.options).toEqual({ type: 'module' });
      expect(w.url).toMatch(/preload_worker\.js$/);
    }
  });

  it('records what the worker sent back as LOADED, so the tree can be built', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { symbolPreloadWork, libraryLoaded, loadedLibraryItems } = await freshSymbols();

    await runAll(await symbolPreloadWork());

    expect(libraryLoaded('Device')).toBe(true);
    // `GetSymbols( lib )` — the LIB_TREE_ITEM face, which is what AddLibraries
    // builds each row from.
    expect(loadedLibraryItems('Device')?.map((i) => i.name)).toEqual(['R']);
    expect(loadedLibraryItems('Device')?.[0]?.keywords).toBe('R res resistor');
  });

  it('falls back to this thread only when there is no Worker at all', async () => {
    // The path `qa`'s other preload tests run on, and the reason they still
    // observe fetches here. It must not be reachable when Worker exists.
    vi.stubGlobal('Worker', undefined);
    const { symbolPreloadWork } = await freshSymbols();

    await runAll(await symbolPreloadWork());

    expect(posted).toEqual([]);
    expect(fetched.filter((u) => u.endsWith('.kicad_sym')).length).toBe(3);
  });
});
