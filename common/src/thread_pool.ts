// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `thread_pool` (include/thread_pool.h: `BS::priority_thread_pool`) and
 * `GetKiCadThreadPool()` (common/thread_pool.cpp), over browser workers.
 *
 * KiCad hands the pool a callable and waits on the future; a worker here can
 * be handed only what `postMessage` copies, so a task is a name from
 * thread_pool_jobs.ts and its arguments, and `submit_task` answers with a
 * promise. Where module workers do not exist — the test runner, node — the
 * job runs inline on this thread, through the very same runner the worker
 * calls, so the result cannot differ.
 *
 * The pool is `ADVANCED_CFG::m_MaximumThreads` threads, 0 meaning as many as
 * the machine reports (`BS::thread_pool( 0 )` is `hardware_concurrency()`).
 * One is kept back for the thread that draws: a browser worker is a whole JS
 * realm, and the main thread still has the frame to paint while they run.
 */
import { ADVANCED_CFG } from './advanced_config.js';
import {
  type POOL_JOB_KIND,
  POOL_JOB_RUNNERS,
  type POOL_JOBS,
  type POOL_REQUEST,
  type POOL_RESPONSE,
  poolJobTransferables,
} from './thread_pool_jobs.js';

interface POOL_THREAD {
  worker: Worker;
  /** The tasks this thread has outstanding, by id. */
  pending: Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>;
}

// biome-ignore lint/style/useNamingConvention: the C++ type is `thread_pool`
export class thread_pool {
  private m_threads: POOL_THREAD[] | null = null;
  private readonly m_threadCount: number;
  private m_nextId = 1;
  private m_nextThread = 0;
  /** Set once `new Worker` has failed, so the session stops trying. */
  private m_workersUnavailable = false;
  /** Every task not yet settled, for `wait()`. */
  private m_running = new Set<Promise<unknown>>();

  /** `BS::thread_pool( num_threads )`: 0 is the hardware's own count. */
  constructor(num_threads = 0) {
    const hardware = globalThis.navigator?.hardwareConcurrency ?? 1;
    this.m_threadCount = Math.max(1, num_threads > 0 ? num_threads : hardware - 1);
  }

  get_thread_count(): number {
    return this.m_threadCount;
  }

  /** Whether the tasks leave this thread at all. */
  is_threaded(): boolean {
    return !this.m_workersUnavailable && typeof Worker !== 'undefined';
  }

  private threads(): POOL_THREAD[] | null {
    if (this.m_threads) return this.m_threads;
    if (!this.is_threaded()) return null;

    try {
      this.m_threads = Array.from({ length: this.m_threadCount }, () => {
        // `new URL(..., import.meta.url)` with `{ type: 'module' }` is the form
        // the bundler detects and emits a separate chunk for.
        const worker = new Worker(new URL('./thread_pool_worker.js', import.meta.url), {
          type: 'module',
        });
        const thread: POOL_THREAD = { worker, pending: new Map() };

        worker.onmessage = (e: MessageEvent<POOL_RESPONSE>) => {
          const task = thread.pending.get(e.data.id);
          thread.pending.delete(e.data.id);

          if (!task) return;

          if (e.data.error !== undefined) task.reject(new Error(e.data.error));
          else task.resolve(e.data.result);
        };
        // A worker that dies takes its outstanding tasks with it.
        worker.onerror = (e) => {
          for (const [, task] of thread.pending)
            task.reject(new Error(e.message || 'thread pool worker failed'));
          thread.pending.clear();
        };

        return thread;
      });
    } catch {
      this.m_workersUnavailable = true;
      this.m_threads = null;
    }

    return this.m_threads;
  }

  /**
   * `submit_task`: queue the job and get its future. Round-robin over the
   * threads; every task of a batch is queued at once, as `BOARD::CacheTriangulation`
   * queues its zones, so the depth per thread stays even without tracking it.
   */
  submit_task<K extends POOL_JOB_KIND>(
    kind: K,
    args: POOL_JOBS[K]['args'],
  ): Promise<POOL_JOBS[K]['result']> {
    type R = POOL_JOBS[K]['result'];
    const threads = this.threads();
    let promise: Promise<R>;

    if (!threads || threads.length === 0) {
      promise = new Promise<R>((resolve, reject) => {
        // Off the caller's stack, as a queued task is
        setTimeout(() => {
          try {
            resolve((POOL_JOB_RUNNERS[kind] as (a: unknown) => R)(args));
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        }, 0);
      });
    } else {
      const thread = threads[this.m_nextThread % threads.length]!;
      this.m_nextThread++;
      const id = this.m_nextId++;
      promise = new Promise<R>((resolve, reject) => {
        thread.pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
        const request: POOL_REQUEST = { id, kind, args };
        thread.worker.postMessage(request, poolJobTransferables(kind, args));
      });
    }

    const tracked: Promise<unknown> = promise.then(
      () => this.m_running.delete(tracked),
      () => this.m_running.delete(tracked),
    );
    this.m_running.add(tracked);

    return promise;
  }

  /** `wait()`: until every submitted task has settled. */
  async wait(): Promise<void> {
    while (this.m_running.size > 0) await Promise.all([...this.m_running]);
  }

  /** `purge()` + the destructor: the threads go; unsettled tasks are rejected by their workers. */
  destroy(): void {
    for (const thread of this.m_threads ?? []) thread.worker.terminate();
    this.m_threads = null;
  }
}

let tp: thread_pool | null = null;

/**
 * Get a reference to the current thread pool. `PGM_BASE` owns none here, so
 * the pool is always the one built from `ADVANCED_CFG::m_MaximumThreads`.
 */
export function GetKiCadThreadPool(): thread_pool {
  if (tp) return tp;

  const num_threads = Math.max(0, ADVANCED_CFG.GetCfg().m_MaximumThreads);
  tp = new thread_pool(num_threads);

  return tp;
}

/** Invalidate the cached thread pool pointer. */
export function InvalidateKiCadThreadPool(): void {
  tp?.destroy();
  tp = null;
}
