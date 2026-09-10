// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The tessellation cache — KiCad's `.3dc` cache, in IndexedDB.
 *
 * `S3D_CACHE::load` (`3d-viewer/3d_cache/3d_cache.cpp:255-315`) hashes the
 * model file's **contents**, looks for `<hash>.3dc` under the user cache
 * directory, and only runs the plugin when that file is absent — then writes
 * the tessellated scene back under the same name. `:205-217` re-hashes when a
 * file's mtime moves and re-tessellates only if the hash actually changed.
 * Your own machine has four of them in `~/.cache/kicad/10.0/3d/`.
 *
 * We do the same thing with the same key. Hashing the bytes rather than the
 * path is what makes the whole mechanism collapse to nothing:
 *
 *   - an edited model is a different key, so staleness needs no comparison, no
 *     mtime, and no sidecar metadata file;
 *   - two projects sharing a connector tessellate it once, between them;
 *   - a renamed, moved, or oddly-named file is still a hit — and real projects
 *     are full of `TRJG0926HENL .stp` (trailing space), `(rev1)`, and three
 *     spellings of the same extension;
 *   - nothing is added to the project, so what we export is byte-for-byte what
 *     KiCad wrote, and committing to somebody's repository adds no files.
 *
 * A failed read is cached too. Without that, a model the kernel cannot parse
 * costs its full tessellation time on **every** open, forever, to fail again.
 *
 * This is derived data. It is never synced to the account and never leaves the
 * device: it is reconstructible from bytes the project already carries, and
 * pushing it would double a project's cloud footprint to store something the
 * next machine can rebuild.
 */
import { idbHandle } from '../../home/idb_open.js';
import { openRecord, sealRecord } from '../../home/local_vault.js';
import { sha256Hex } from '../../cloud/blobStore.js';
import { type Tessellation, tessellationBytes } from './occt_types.js';

const DB_NAME = 'ziroeda-3dcache';
const VERSION = 1;
const STORE = 'tessellations';

/**
 * Total geometry the cache may hold before old entries are dropped.
 *
 * The whole KiCad 10 packages3D set is thousands of models; a user who opens
 * many boards should not silently accumulate their storage quota. 500 MB is
 * generous next to any real session and small next to a browser's quota.
 */
export const MAX_BYTES = 500 * 1024 * 1024;

/**
 * Recency, monotonic within a session.
 *
 * `Date.now()` alone is not enough to order an LRU: several models finish
 * tessellating inside the same millisecond, and rows that tie cannot be ranked,
 * so eviction picks arbitrarily among them. Clamping each stamp above the last
 * one keeps wall-clock meaning across sessions (a stamp is still roughly when
 * it was used) while guaranteeing a total order within one.
 */
let lastStamp = 0;
const stamp = (): number => {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
};

interface CacheRow {
  /** sha256 of the model file's bytes, hex. The only key there is. */
  hash: string;
  /** Null records a read the kernel failed, so it is not retried every open. */
  tess: Tessellation | null;
  bytes: number;
  /** Last read, for eviction. Written on hit as well as on insert. */
  usedAt: number;
}

const db = idbHandle(DB_NAME, VERSION, (d) => {
  if (!d.objectStoreNames.contains(STORE)) {
    const store = d.createObjectStore(STORE, { keyPath: 'hash' });
    // Eviction walks in least-recently-used order; without the index that is a
    // full scan of every mesh in the cache just to free one.
    store.createIndex('usedAt', 'usedAt', { unique: false });
  }
});

/** The cache must never be the reason a model fails to draw. */
const quiet = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

const tx = async (mode: IDBTransactionMode): Promise<IDBObjectStore> => {
  const conn = await db.get();
  return conn.transaction(STORE, mode).objectStore(STORE);
};

/** What a sealed cache row keeps in the clear: the key, and what eviction reads. */
const CACHE_CLEAR = ['hash', 'bytes', 'usedAt'] as const;

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** The cache key for a model: the hash of its own bytes, nothing else. */
export const modelKey = (bytes: Uint8Array): Promise<string> => sha256Hex(bytes);

/**
 * A previous tessellation of these exact bytes, or `undefined` for never-tried.
 *
 * The three outcomes are distinct on purpose: a hit with geometry, a hit
 * recording a kernel failure (`{ tess: null }`), and a miss.
 */
export async function cacheGet(hash: string): Promise<{ tess: Tessellation | null } | undefined> {
  return quiet(async () => {
    // Sealed at rest (local_vault.ts): the tessellation is user data when the
    // model was the user's; hash, size and time stay in the clear for the key
    // and the eviction, which reads nothing else.
    const row = await openRecord<CacheRow>(
      await wrap((await tx('readonly')).get(hash) as IDBRequest<CacheRow | undefined>),
    );
    if (!row) return undefined;
    // Touch it so eviction sees a model that is still in use. Deliberately not
    // awaited: a read should not wait on the bookkeeping of a later eviction.
    void quiet(async () => {
      const touched = await sealRecord({ ...row, usedAt: stamp() }, CACHE_CLEAR);
      const store = await tx('readwrite');
      store.put(touched);
    }, undefined);
    return { tess: row.tess };
  }, undefined);
}

export async function cachePut(
  hash: string,
  tess: Tessellation | null,
  maxBytes: number = MAX_BYTES,
): Promise<void> {
  await quiet(async () => {
    const store = await tx('readwrite');
    const row: CacheRow = {
      hash,
      tess,
      bytes: tess ? tessellationBytes(tess) : 0,
      usedAt: stamp(),
    };
    store.put(await sealRecord(row, CACHE_CLEAR));
  }, undefined);
  await evict(maxBytes);
}

/** Drop least-recently-used rows until the cache is back under its cap. */
async function evict(maxBytes: number): Promise<void> {
  await quiet(async () => {
    const store = await tx('readonly');
    const rows = await wrap(store.getAll() as IDBRequest<CacheRow[]>);
    let total = 0;
    for (const r of rows) total += r.bytes;
    if (total <= maxBytes) return;

    rows.sort((a, b) => a.usedAt - b.usedAt);
    const write = await tx('readwrite');
    for (const r of rows) {
      if (total <= maxBytes) break;
      write.delete(r.hash);
      total -= r.bytes;
    }
  }, undefined);
}

/** Preferences > Maintenance and the tests both need a way to empty it. */
export async function cacheClear(): Promise<void> {
  await quiet(async () => {
    (await tx('readwrite')).clear();
  }, undefined);
}

/** Milliseconds in a day — what `wxDateSpan::SetDays` means once it is arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `S3D_CACHE::CleanCacheDir( int aNumDaysOld )`
 * (`3d-viewer/3d_cache/3d_cache.cpp:609-647`): drop every cached model last
 * *accessed* longer ago than `days`.
 *
 *     durationInDays.SetDays( aNumDaysOld );
 *     thresholdDate = wxDateTime::Now() - durationInDays;
 *     …
 *     if( thisFile.GetTimes( &lastAccess, nullptr, nullptr ) )
 *         if( lastAccess.IsEarlierThan( thresholdDate ) )
 *             wxRemoveFile( thisFile.GetFullPath() );
 *
 * Upstream walks `*.3dc` files and asks the filesystem for each one's access
 * time. There is no such thing to ask here, which is why `usedAt` is written on
 * a cache HIT as well as on insert (`cacheGet` above): it is that access time,
 * kept by hand because the store keeps none.
 *
 * Age, not size. `evict()` above is ours and has no upstream counterpart — a
 * browser gives a page a storage quota where KiCad gets a disk — and the two
 * are answering different questions, so both run: `evict` caps what the cache
 * may cost right now, this drops what the user has stopped using.
 *
 * Note the comparison is strict, as `IsEarlierThan` is: a row used exactly
 * `days` ago stays. Callers must apply upstream's own zero guard before calling
 * — see {@link cleanup3dCache}, which is where it lives.
 *
 * Returns how many rows went, which is what the tests read.
 */
export async function cacheSweepAged(days: number, now: number = Date.now()): Promise<number> {
  return quiet(async () => {
    const threshold = now - days * MS_PER_DAY;
    const store = await tx('readonly');
    const rows = await wrap(store.getAll() as IDBRequest<CacheRow[]>);
    const stale = rows.filter((r) => r.usedAt < threshold);
    if (stale.length === 0) return 0;

    const write = await tx('readwrite');
    for (const r of stale) write.delete(r.hash);
    return stale.length;
  }, 0);
}

/**
 * `PROJECT_PCB::Cleanup3DCache( PROJECT* )` (`pcbnew/project_pcb.cpp:97-118`),
 * which `PCB_BASE_FRAME::canCloseWindow` runs as the board frame goes away
 * (`pcbnew/pcb_base_frame.cpp:124`).
 *
 *     int clearCacheInterval = 0;
 *     if( Pgm().GetCommonSettings() )
 *         clearCacheInterval = Pgm().GetCommonSettings()->m_System.clear_3d_cache_interval;
 *     // An interval of zero means the user doesn't want to ever clear the cache
 *     if( clearCacheInterval > 0 )
 *         cache->CleanCacheDir( clearCacheInterval );
 *
 * The guard is the whole reason this is a function of its own rather than a
 * call to {@link cacheSweepAged}: at 0 the sweep's threshold is *now*, so every
 * row is stale and the setting that is documented to disable clearing would
 * instead clear everything. Upstream states that in a comment and a branch;
 * this is that branch.
 *
 * The interval is passed rather than read here so this stays importable by a
 * test with no `localStorage` — the caller is the frame, exactly as upstream's
 * caller is the frame.
 */
export async function cleanup3dCache(clearCacheInterval: number): Promise<number> {
  if (clearCacheInterval > 0) return cacheSweepAged(clearCacheInterval);
  return 0;
}
