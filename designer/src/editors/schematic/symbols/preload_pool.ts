// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GetKiCadThreadPool()` (common/thread_pool.cpp:31-51) for the symbol preload:
 * the pool `SYMBOL_LIBRARY_ADAPTER::AsyncLoad` submits one task per library
 * table row to.
 *
 * Upstream sizes it from `ADVANCED_CFG::m_MaximumThreads`, which defaults to
 * "all of them" — `BS::thread_pool( 0 )` is `std::thread::hardware_concurrency()`.
 * `navigator.hardwareConcurrency` is the browser's answer to the same question,
 * and it is the right one here for the same reason it is upstream: the work is
 * CPU-bound parsing, not the HTTP round trip. (The old `PRELOAD_CONCURRENCY = 6`
 * was reasoned about as sockets, which is what the work used to be bounded by
 * when it was six `fetch`es feeding one thread.)
 */
import { loadLibraryItems, type PreloadRequest, type PreloadResult } from './preload_worker.js';
import type { LibTreeItem } from './lib_tree_item.js';

/**
 * The cap on the pool.
 *
 * Not upstream's — it has none, because a native thread costs a stack and a
 * browser worker costs a whole JS realm (a fresh heap, and our parser module
 * instantiated in it). Past a handful the realms cost more than the parallelism
 * returns, and the 223 tasks are queued against the pool either way.
 */
const MAX_WORKERS = 4;

/** `BS::thread_pool( 0 )` — as many as the machine says it has, within the cap. */
function poolSize(): number {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 1;
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}

interface PoolWorker {
  worker: Worker;
  /** The requests this worker has outstanding, by id. */
  pending: Map<number, (r: PreloadResult) => void>;
}

let pool: PoolWorker[] | null = null;
/** Set once `new Worker` has failed, so we stop trying for the session. */
let workersUnavailable = false;
let nextId = 1;
let nextWorker = 0;

/**
 * Whether the parse can be handed off at all.
 *
 * `false` in the test runner and anywhere else without module workers, and the
 * caller then does the identical work inline — the same function the worker
 * calls, so the two paths cannot drift.
 */
export function preloadWorkersAvailable(): boolean {
  return !workersUnavailable && typeof Worker !== 'undefined';
}

function ensurePool(): PoolWorker[] | null {
  if (pool) return pool;
  if (!preloadWorkersAvailable()) return null;
  try {
    pool = Array.from({ length: poolSize() }, () => {
      // `new URL(..., import.meta.url)` with `{ type: 'module' }` is the form
      // the bundler detects and emits a separate chunk for; a string specifier
      // would be left as a runtime path that does not exist in the build.
      const worker = new Worker(new URL('./preload_worker.js', import.meta.url), {
        type: 'module',
      });
      const entry: PoolWorker = { worker, pending: new Map() };
      worker.onmessage = (e: MessageEvent<PreloadResult>) => {
        const settle = entry.pending.get(e.data.id);
        entry.pending.delete(e.data.id);
        settle?.(e.data);
      };
      // A worker that dies takes its outstanding requests with it; report them
      // as LOAD_ERROR rather than leaving the preload's gauge stuck.
      worker.onerror = () => {
        for (const [id, settle] of entry.pending)
          settle({ id, library: '', error: 'symbol preload worker failed' });
        entry.pending.clear();
      };
      return entry;
    });
  } catch {
    workersUnavailable = true;
    pool = null;
  }
  return pool;
}

/**
 * Read, parse and project one library — off the main thread where that is
 * possible, and inline where it is not.
 *
 * Round-robin rather than least-loaded: the caller
 * (`workQueueAdapter`) already runs a bounded number of these at once, so the
 * queue depth per worker stays even without tracking it.
 */
export async function loadLibraryItemsPooled(library: string, url: string): Promise<LibTreeItem[]> {
  const workers = ensurePool();
  if (!workers || workers.length === 0) return loadLibraryItems(library, url);

  const entry = workers[nextWorker % workers.length]!;
  nextWorker++;
  const id = nextId++;
  const result = await new Promise<PreloadResult>((resolve) => {
    entry.pending.set(id, resolve);
    const request: PreloadRequest = { id, library, url };
    entry.worker.postMessage(request);
  });
  if (result.error) throw new Error(result.error);
  return result.items ?? [];
}

/**
 * `thread_pool::purge()` + `wait()` (common/single_top.cpp:93-94) — drop the
 * pool when the project it was loading goes away.
 */
export function terminatePreloadPool(): void {
  for (const entry of pool ?? []) entry.worker.terminate();
  pool = null;
}
