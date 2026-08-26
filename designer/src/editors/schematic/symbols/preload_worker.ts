// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One worker of the symbol preload's pool — our `GetKiCadThreadPool()` thread.
 *
 * `SYMBOL_LIBRARY_ADAPTER::AsyncLoad` (common/libraries/library_manager.cpp:1786-1800)
 * submits one task per library table row to the thread pool and returns
 * immediately; `IFACE::PreloadLibraries` then only *polls*
 * `AsyncLoadProgress()` from the UI thread every 150 ms
 * (eeschema/eeschema.cpp:487-607). The reading and the parsing never touch the
 * thread that draws.
 *
 * Ours did. `readSymbolLib( parse( text ) )` over the hosted set measured
 * **35 434 ms** of main-thread CPU across 223 libraries, in 92 separate tasks
 * longer than 50 ms with the worst — MCU_ST_STM32H7, 15.5 MB — at **2 030 ms**
 * (qa/perf/parse_all.bench.ts). Every keystroke and every scroll during a
 * project open waited behind whichever library was mid-parse, which is exactly
 * the freeze this is here to remove.
 *
 * What goes back is a {@link LibTreeItem} per symbol, not the symbol: see
 * lib_tree_item.ts for why the parsed form cannot be kept.
 */
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import { libTreeItem, type LibTreeItem } from './lib_tree_item.js';

/** `submit_task`'s argument: which library, and where it is served from. */
export interface PreloadRequest {
  id: number;
  library: string;
  url: string;
}

/**
 * The task's result. `error` is `LOAD_STATUS::LOAD_ERROR` — upstream's worker
 * records it and returns, and the load as a whole still completes
 * (library_manager.cpp), so a failure is reported rather than thrown.
 */
export interface PreloadResult {
  id: number;
  library: string;
  items?: LibTreeItem[];
  error?: string;
}

/** Fetch, parse and project one library. Exported so the main thread can run
 *  the identical work inline where there is no `Worker` (see preload_pool.ts). */
export async function loadLibraryItems(library: string, url: string): Promise<LibTreeItem[]> {
  const res = await fetch(url);
  // Without this the body of a 404 or an error page reaches the parser, and a
  // missing library surfaces as `Expected a top-level list starting with "("`.
  if (!res.ok)
    throw new Error(`symbol library "${library}" could not be loaded (HTTP ${res.status})`);
  return readSymbolLib(parse(await res.text())).map(libTreeItem);
}

/**
 * The worker scope, when this module IS a worker's entry point.
 *
 * Typed structurally rather than as `DedicatedWorkerGlobalScope`: the designer's
 * tsconfig has the DOM lib, not WebWorker, and pulling WebWorker in globally
 * would redeclare half of it. The same module is also imported by the main
 * thread for `loadLibraryItems`, where none of this must run — hence the guard,
 * which `WorkerGlobalScope` existing is the only reliable test for.
 */
interface WorkerScope {
  postMessage(message: PreloadResult): void;
  onmessage: ((e: MessageEvent<PreloadRequest>) => void) | null;
}

const global = globalThis as unknown as { WorkerGlobalScope?: unknown };

if (global.WorkerGlobalScope !== undefined) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (e: MessageEvent<PreloadRequest>): void => {
    const { id, library, url } = e.data;
    loadLibraryItems(library, url).then(
      (items) => scope.postMessage({ id, library, items }),
      (err: unknown) => scope.postMessage({ id, library, error: String(err) }),
    );
  };
}
