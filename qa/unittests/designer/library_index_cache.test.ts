// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The two library indexes, and what a second visit costs.
 *
 * They are the one thing every chooser needs before it can draw a row: 357 kB
 * of symbol libraries and 649 kB of footprint libraries, measured against the
 * bucket. The module-level `indexPromise` in `symbols/index.ts` and
 * `widgets/footprint_list.ts` dedupes them within a page and dies with it, and
 * nothing persisted them — so every reload paid the whole download again before
 * the first dialog could open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fetchLibraryIndex,
  warmLibraryIndexes,
  libraryBase,
} from '@ziroeda/designer/src/libraryHosts.js';

/** A Cache Storage good enough to hold Responses, which is all this uses. */
function fakeCaches(): { store: Map<string, Response>; puts: number } {
  const store = new Map<string, Response>();
  const state = { store, puts: 0 };
  const cache = {
    match: async (k: string) => store.get(k)?.clone(),
    put: async (k: string, v: Response) => {
      state.puts++;
      store.set(k, v);
    },
  };
  (globalThis as unknown as { caches: unknown }).caches = { open: async () => cache };
  return state;
}

const json = (body: unknown, etag = '"v1"'): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { ETag: etag } });

let base: { symbols: string; footprints: string };

beforeEach(() => {
  base = { ...libraryBase };
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(libraryBase, base);
  (globalThis as unknown as { caches?: unknown }).caches = undefined;
});

describe('the library index is fetched once, not once per visit', () => {
  it('serves the second visit from the cache without downloading the body again', async () => {
    const state = fakeCaches();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json([{ name: 'Device' }]),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchLibraryIndex('symbols')).toEqual([{ name: 'Device' }]);
    const afterFirst = fetchMock.mock.calls.length;
    expect(afterFirst).toBe(1);

    // A second *page* — the in-memory promise is gone, the cache is not.
    expect(await fetchLibraryIndex('symbols')).toEqual([{ name: 'Device' }]);
    const revalidations = fetchMock.mock.calls.slice(afterFirst);
    // Exactly one more call, and it is a conditional revalidation, not a
    // download: the whole point is that the body does not come again.
    expect(revalidations).toHaveLength(1);
    expect(revalidations[0]?.[1]?.headers).toEqual({
      'If-None-Match': '"v1"',
    });
    expect(state.store.size).toBe(1);
  });

  it('answers from the cache even when the network is down', async () => {
    fakeCaches();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ name: 'Device' }])),
    );
    await fetchLibraryIndex('symbols');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    // Not the bundled subset, and not empty: the copy from last time.
    expect(await fetchLibraryIndex('symbols')).toEqual([{ name: 'Device' }]);
  });

  it('still works with no Cache Storage at all', async () => {
    // An insecure context has no `caches`. The index must still load — this is
    // an optimisation, not a dependency.
    (globalThis as unknown as { caches?: unknown }).caches = undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ name: 'Device' }])),
    );
    expect(await fetchLibraryIndex('symbols')).toEqual([{ name: 'Device' }]);
  });
});

describe('warming the indexes at startup', () => {
  it('fetches BOTH indexes, so neither chooser is the one that pays', async () => {
    const state = fakeCaches();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json([{ name: 'Device' }]),
    );
    vi.stubGlobal('fetch', fetchMock);

    await warmLibraryIndexes();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(2);
    expect(urls.some((u) => u.includes('/symbols/index.json'))).toBe(true);
    expect(urls.some((u) => u.includes('/footprints/index.json'))).toBe(true);
    expect(state.puts).toBe(2);
  });

  it('leaves the chooser with nothing to fetch afterwards', async () => {
    fakeCaches();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json([{ name: 'Device' }]),
    );
    vi.stubGlobal('fetch', fetchMock);
    await warmLibraryIndexes();
    const afterWarm = fetchMock.mock.calls.length;

    await fetchLibraryIndex('symbols');
    // One conditional revalidation, no body. Without the warm this would have
    // been the full download, with the dialog open and waiting on it.
    const calls = fetchMock.mock.calls.slice(afterWarm);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]?.headers).toBeTruthy();
  });

  it('does NOT drop the session onto the bundled subset when it fails', async () => {
    // The failover in `fetchLibraryIndex` flips `libraryBase` for the whole
    // session. Doing that from a startup prefetch would mean a blip in the
    // first seconds after load silently gives every later lookup fewer symbols
    // and footprints than production has — which changes what ERC reports.
    fakeCaches();
    const before = { ...libraryBase };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await warmLibraryIndexes();
    expect(libraryBase).toEqual(before);
  });

  it('resolves rather than throwing when there is no cache', async () => {
    (globalThis as unknown as { caches?: unknown }).caches = undefined;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json([]));
    vi.stubGlobal('fetch', fetchMock);
    await expect(warmLibraryIndexes()).resolves.toBeUndefined();
    // And it did not fetch: with nowhere to put the answer there is no warm to
    // do, and a megabyte pulled into a bin nobody reads is worse than nothing.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the warm is wired into startup, not merely available', () => {
  const APP = readFileSync(
    fileURLToPath(new URL('../../../designer/src/App.tsx', import.meta.url)),
    'utf8',
  );

  /** The `load` array inside `prefetchEditors`, entries in order. */
  const queue = (): string[] => {
    const at = APP.indexOf('function prefetchEditors()');
    expect(at, 'prefetchEditors is gone').toBeGreaterThan(-1);
    const open = APP.indexOf('[', APP.indexOf('const load', at));
    const body = APP.slice(open + 1, APP.indexOf('];', open));
    return body
      .split('\n')
      .map((l) => l.replace(/\/\/[^\n]*/, '').trim())
      .filter((l) => l.startsWith('() =>'));
  };

  it('warms the indexes, and does it FIRST', () => {
    // Source text, because this is a wiring fact inside a `.tsx` and there is
    // no DOM test environment here to mount the app in. The behaviour it wires
    // is covered above; what this pins is that something calls it at startup —
    // a mutation that deleted the line failed nothing at all until this existed.
    //
    // Read as an ordered LIST, not with `toContain` over the file: the file
    // mentions `warmLibraryIndexes` in its import and in a comment, so a
    // whole-file check passed with the call itself removed.
    const q = queue();
    expect(q.length, 'the prefetch queue is empty').toBeGreaterThan(1);
    expect(q[0]).toContain('warmLibraryIndexes()');
    // Ahead of every editor chunk. Those arrive a beat later at no cost — the
    // launcher is still on screen — where the index is what a person waits on.
    for (const entry of q.slice(1)) expect(entry).toContain('import(');
  });
});
