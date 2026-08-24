// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where the hosted libraries live.
 *
 * The full KiCad sets, symbols, footprints, packages3D (pre-converted to .glb)
 * and the demo projects, are served from this project's Cloudflare R2 bucket,
 * so the app has the same library table wherever it runs. `public/symbols`,
 * `public/footprints` and friends hold only a small bundled subset, kept as an
 * offline fallback.
 *
 * The bucket URL is the built-in default *in code* rather than deployment-only
 * configuration: a dev server that silently fell back to the bundled subset
 * would resolve fewer footprints and symbols than production, which quietly
 * changes what ERC and the choosers report. A `VITE_*_URL` still overrides it
 * (vercel.json sets them to this same bucket).
 */

// The cast keeps this module loadable outside Vite (the qa test runner).
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

/** The library bucket's public host. */
export const LIBRARY_HOST = 'https://pub-ac941e05e1284f409be2ed74ddb151b3.r2.dev';

/** `<base>/index.json` + `<base>/<Library>.kicad_sym`. */
export const SYMBOLS_HOST = viteEnv?.VITE_SYMBOLS_URL || `${LIBRARY_HOST}/symbols`;

/** `<base>/index.json` + `<base>/<Library>.pretty/<Footprint>.kicad_mod`. */
export const FOOTPRINTS_HOST = viteEnv?.VITE_FOOTPRINTS_URL || `${LIBRARY_HOST}/footprints`;

/** `<base>/<Library>.3dshapes/<Model>.glb`, the bucket root. */
export const MODELS3D_HOST = viteEnv?.VITE_MODELS3D_URL || LIBRARY_HOST;

/** `<base>/index.json` + the demo project archives. */
export const DEMOS_HOST = viteEnv?.VITE_DEMOS_URL || `${LIBRARY_HOST}/demos`;

/** The bundled subsets under `public/`, the offline fallback. */
export const bundledBase = (kind: 'symbols' | 'footprints'): string =>
  `${viteEnv?.BASE_URL ?? '/'}${kind}`;

/**
 * The base each library kind is currently served from. It starts at the hosted
 * set and drops to the bundled subset if that turns out to be unreachable
 * (offline dev), so every later per-file fetch follows the same base.
 */
export const libraryBase: { symbols: string; footprints: string } = {
  symbols: SYMBOLS_HOST,
  footprints: FOOTPRINTS_HOST,
};

/**
 * The Cache Storage bucket the two library indexes are kept in.
 *
 * They are the one thing every chooser needs before it can show anything, and
 * they are big: 357 kB of symbol libraries and 649 kB of footprint libraries,
 * measured against the bucket. Nothing persisted them, so every reload paid the
 * whole download again before the first dialog could open — the module-level
 * `indexPromise` in `symbols/index.ts` and `widgets/footprint_list.ts` dedupes
 * within a page, and dies with it.
 *
 * Versioned in the name so a change to what we store here is a new bucket
 * rather than a migration; the old one is deleted on first use.
 */
const INDEX_CACHE = 'ziroeda-library-index-v1';

/** Cache Storage, or null where it is not available (insecure context, tests). */
async function indexCache(): Promise<Cache | null> {
  try {
    const cs = (globalThis as { caches?: CacheStorage }).caches;
    if (!cs) return null;
    return await cs.open(INDEX_CACHE);
  } catch {
    return null;
  }
}

/**
 * Freshen a cached index in the background, quietly.
 *
 * Conditional on the stored ETag, so the usual answer is a 304 with no body —
 * the bucket sends an ETag on every object. The refreshed copy is used by the
 * NEXT load, not this one: swapping an index out from under a chooser that has
 * already rendered it would be a worse surprise than being one reload behind.
 */
function revalidate(cache: Cache, url: string, cached: Response): void {
  const etag = cached.headers.get('ETag');
  void fetch(url, etag ? { headers: { 'If-None-Match': etag } } : undefined)
    .then((res) => {
      if (res.ok) return cache.put(url, res.clone());
      return undefined;
    })
    .catch(() => undefined);
}

/**
 * Warm the cached indexes without touching `libraryBase`.
 *
 * Called at startup so the first chooser opens on a cache hit rather than a
 * megabyte of JSON. It deliberately does NOT share `fetchLibraryIndex`'s
 * failover: that flips `libraryBase` to the bundled subset for the rest of the
 * session, and doing it from a startup prefetch would mean a blip in the first
 * seconds after load silently gives the whole session fewer symbols and
 * footprints than production has — which quietly changes what ERC and the
 * choosers report. A failed warm just leaves the fetch to be paid later.
 */
export async function warmLibraryIndexes(): Promise<void> {
  const cache = await indexCache();
  if (!cache) return;
  for (const kind of ['symbols', 'footprints'] as const) {
    const url = `${libraryBase[kind]}/index.json`;
    try {
      const hit = await cache.match(url);
      if (hit) {
        revalidate(cache, url, hit);
        continue;
      }
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res.clone());
    } catch {
      /* offline, or no room. The index is fetched normally when it is needed. */
    }
  }
}

/** Fetch a library index, failing over to the bundled copy once. */
export async function fetchLibraryIndex<T>(kind: 'symbols' | 'footprints'): Promise<T[]> {
  const url = `${libraryBase[kind]}/index.json`;
  const cache = await indexCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        revalidate(cache, url, hit);
        return (await hit.json()) as T[];
      }
    } catch {
      /* a corrupt entry is not worth failing over for; fetch it again below. */
    }
  }
  try {
    const res = await fetch(url);
    if (res.ok) {
      if (cache) await cache.put(url, res.clone()).catch(() => undefined);
      return (await res.json()) as T[];
    }
  } catch {
    /* unreachable, fall through to the bundled subset */
  }
  libraryBase[kind] = bundledBase(kind);
  try {
    const res = await fetch(`${libraryBase[kind]}/index.json`);
    return res.ok ? ((await res.json()) as T[]) : [];
  } catch {
    return [];
  }
}
