// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `IFACE::PreloadLibraries` (eeschema/eeschema.cpp:487-607,
 * pcbnew/pcbnew.cpp:772-892) and the two work lists it drives.
 *
 * Every expectation here is derived from the C++ and cited, not from what our
 * implementation prints. The two that would otherwise be re-baselined silently
 * are the poll interval and the time limit: both are `constexpr static int` in
 * the two `PreloadLibraries` bodies and both faces state the same pair.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  cancelPreload,
  preloadInProgress,
  preloadLibraries,
  workQueueAdapter,
  PRELOAD_INTERVAL_MS,
  PRELOAD_JOB_NAME,
  PRELOAD_TIME_LIMIT_MS,
  type PreloadAdapter,
} from '@ziroeda/designer/src/libraryPreload.js';
import {
  BackgroundJobsMonitor,
  backgroundJobsMonitor,
} from '@ziroeda/designer/src/ui/background_jobs_monitor.js';

/** A settled promise chain plus one macrotask, so a `setTimeout(0)` lands. */
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("the constants are KiCad's", () => {
  it('polls every 150 ms', () => {
    // `constexpr static int interval = 150;` — eeschema.cpp:489 and
    // pcbnew.cpp:774, identical in both faces.
    expect(PRELOAD_INTERVAL_MS).toBe(150);
  });

  it('gives up after 120 s', () => {
    // `constexpr static int timeLimit = 120000;` — eeschema.cpp:490,
    // pcbnew.cpp:775.
    expect(PRELOAD_TIME_LIMIT_MS).toBe(120000);
  });

  it('names the two jobs the way the monitor is asked to', () => {
    // `Pgm().GetBackgroundJobMonitor().Create( _( "Loading Symbol Libraries" ) )`
    // (eeschema.cpp:504-505) and `_( "Loading Footprint Libraries" )`
    // (pcbnew.cpp:788-789). Title Case, and no ellipsis.
    expect(PRELOAD_JOB_NAME.symbols).toBe('Loading Symbol Libraries');
    expect(PRELOAD_JOB_NAME.footprints).toBe('Loading Footprint Libraries');
  });
});

describe('workQueueAdapter mirrors LIBRARY_MANAGER_ADAPTER', () => {
  it('reports loaded / total, and nullopt before anything is dispatched', () => {
    // `AsyncLoadProgress()` (common/libraries/library_manager.cpp:1399-1408):
    //     size_t total = m_loadTotal.load();
    //     if( total == 0 ) return std::nullopt;
    //     return loaded / static_cast<float>( total );
    // `m_loadTotal` is only set by `AsyncLoad`, so before that it is 0.
    const adapter = workQueueAdapter([() => Promise.resolve(), () => Promise.resolve()]);
    expect(adapter.asyncLoadProgress()).toBeUndefined();
  });

  it('an empty work list stays at nullopt, as an empty library table does', async () => {
    // `if( rows.empty() ) { … return; }` leaves m_loadTotal at 0
    // (library_manager.cpp:1802-1807).
    const adapter = workQueueAdapter([]);
    adapter.asyncLoad();
    expect(adapter.asyncLoadProgress()).toBeUndefined();
    await adapter.blockUntilLoaded();
  });

  it('counts each item once and finishes at exactly 1', async () => {
    const adapter = workQueueAdapter([
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
      () => Promise.resolve(4),
    ]);
    adapter.asyncLoad();
    expect(adapter.asyncLoadProgress()).toBe(0);
    await adapter.blockUntilLoaded();
    expect(adapter.asyncLoadProgress()).toBe(1);
  });

  it('a failing item still counts, the way a LOAD_ERROR row does', async () => {
    // A worker that throws records LOAD_ERROR and returns; the load as a whole
    // still completes, so `m_loadCount` reaches `m_loadTotal`. A preload whose
    // gauge stuck on one unreachable library would never finish.
    const adapter = workQueueAdapter([
      () => Promise.reject(new Error('HTTP 404')),
      () => Promise.resolve(),
    ]);
    adapter.asyncLoad();
    await adapter.blockUntilLoaded();
    expect(adapter.asyncLoadProgress()).toBe(1);
  });

  it('a second AsyncLoad while futures are outstanding does nothing', async () => {
    // library_manager.cpp:1786-1795: `if( !m_futures.empty() ) { … return; }`.
    let released = (): void => {};
    const gate = new Promise<void>((r) => {
      released = r;
    });
    const adapter = workQueueAdapter([() => gate, () => Promise.resolve()]);
    adapter.asyncLoad();
    adapter.asyncLoad(); // must not restart, must not double-count
    released();
    await adapter.blockUntilLoaded();
    expect(adapter.asyncLoadProgress()).toBe(1);
  });

  it('abort clears the counters', async () => {
    // `AbortAsyncLoad` ends with m_loadTotal = m_loadCount = 0
    // (library_manager.cpp:1388-1396), which puts AsyncLoadProgress back at
    // nullopt.
    const adapter = workQueueAdapter([() => Promise.resolve(), () => Promise.resolve()]);
    adapter.asyncLoad();
    await adapter.abortAsyncLoad();
    expect(adapter.asyncLoadProgress()).toBeUndefined();
  });
});

/** A hand-driven adapter, so a test can hold a preload at a chosen progress. */
function scriptedAdapter(): PreloadAdapter & {
  progress: number | undefined;
  blocked: number;
  aborted: number;
} {
  const a = {
    progress: 0 as number | undefined,
    blocked: 0,
    aborted: 0,
    asyncLoad(): void {},
    asyncLoadProgress(): number | undefined {
      return a.progress;
    },
    async blockUntilLoaded(): Promise<void> {
      a.blocked++;
    },
    async abortAsyncLoad(): Promise<void> {
      a.aborted++;
    },
  };
  return a;
}

describe('preloadLibraries drives the background job', () => {
  it('creates one job, reports its name, and removes it when done', async () => {
    const before = backgroundJobsMonitor.jobs().length;
    const adapter = scriptedAdapter();
    adapter.progress = 1;
    const seen: string[] = [];
    const stop = backgroundJobsMonitor.subscribe(() => {
      const job = backgroundJobsMonitor.jobs().find((j) => j.name === PRELOAD_JOB_NAME.symbols);
      if (job) seen.push(job.status);
    });

    await preloadLibraries('symbols', adapter);
    stop();

    // `reporter->Report( _( "Loading Symbol Libraries" ) )` — eeschema.cpp:516,
    // the same string the job is named with.
    expect(seen).toContain('Loading Symbol Libraries');
    // `Pgm().GetBackgroundJobMonitor().Remove( … )` — eeschema.cpp:590.
    expect(backgroundJobsMonitor.jobs().length).toBe(before);
    expect(preloadInProgress('symbols')).toBe(false);
  });

  it('the compare_exchange guard lets only the first caller run', async () => {
    // eeschema.cpp:493-500: "prevent race conditions when PreloadLibraries is
    // called multiple times concurrently (e.g., from project manager and
    // schematic editor both scheduling via CallAfter)".
    const first = scriptedAdapter();
    first.progress = 0.5;
    const second = scriptedAdapter();
    second.progress = 1;
    let peak = 0;
    const stop = backgroundJobsMonitor.subscribe(() => {
      peak = Math.max(
        peak,
        backgroundJobsMonitor.jobs().filter((j) => j.name === PRELOAD_JOB_NAME.footprints).length,
      );
    });

    const a = preloadLibraries('footprints', first);
    const b = preloadLibraries('footprints', second);
    // The second call returns the FIRST one's promise, not a new run.
    expect(b).toBe(a);
    first.progress = 1;
    await a;
    stop();

    expect(peak).toBe(1);
    // The loser's adapter was never touched.
    expect(second.blocked).toBe(0);
    expect(second.aborted).toBe(0);
  });

  it('finishing normally blocks, and aborting aborts', async () => {
    // eeschema.cpp:556-559: `if( aborted ) adapter->AbortAsyncLoad(); else
    // adapter->BlockUntilLoaded();` — the branch matters, because
    // BlockUntilLoaded alone "can hang indefinitely if a worker is stuck on a
    // stalled network".
    const clean = scriptedAdapter();
    clean.progress = 1;
    await preloadLibraries('symbols', clean);
    expect([clean.blocked, clean.aborted]).toEqual([1, 0]);

    const stuck = scriptedAdapter();
    stuck.progress = 0;
    const run = preloadLibraries('symbols', stuck);
    await tick(PRELOAD_INTERVAL_MS + 20);
    await cancelPreload('symbols', true);
    await run;
    expect([stuck.blocked, stuck.aborted]).toEqual([0, 1]);
  });

  it('an adapter with nothing to do reports full progress and stops', async () => {
    // The `else` arm at eeschema.cpp:539-543: a nullopt progress means the
    // adapter had no rows, and the reporter is driven to 1 rather than left
    // showing an empty gauge.
    const empty = scriptedAdapter();
    empty.progress = undefined;
    const monitor = backgroundJobsMonitor;
    const values: number[] = [];
    const stop = monitor.subscribe(() => {
      const job = monitor.jobs().find((j) => j.name === PRELOAD_JOB_NAME.symbols);
      if (job) values.push(job.currentProgress);
    });
    await preloadLibraries('symbols', empty);
    stop();
    // `SetCurrentProgress( 1 )` -> max 1000, value 1000.
    expect(values.at(-1)).toBe(1000);
  });

  it('cancelPreload on an idle face is a no-op, so it cannot poison the next run', async () => {
    // `CancelPreload` is guarded by `if( m_libraryPreloadInProgress.load() )`
    // (eeschema.cpp:612). Without that guard the abort flag would still be set
    // when the next preload started and it would abort immediately.
    expect(preloadInProgress('symbols')).toBe(false);
    await cancelPreload('symbols', true);
    const adapter = scriptedAdapter();
    adapter.progress = 1;
    await preloadLibraries('symbols', adapter);
    expect([adapter.blocked, adapter.aborted]).toEqual([1, 0]);
  });
});

describe('the reporter puts a 0..1 fraction on a 0..1000 gauge', () => {
  it('SetCurrentProgress stores 1000 and truncates', () => {
    // `BACKGROUND_JOB_REPORTER::SetCurrentProgress`
    // (common/background_jobs_monitor.cpp:213-221):
    //     m_job->m_maxProgress.store( 1000 );
    //     m_job->m_currentProgress.store( static_cast<int>( 1000 * aProgress ) );
    // static_cast<int> truncates toward zero, so 0.6667 is 666, not 667.
    const monitor = new BackgroundJobsMonitor();
    const job = monitor.create('x');
    job.reporter.setCurrentProgress(2 / 3);
    expect(job.maxProgress).toBe(1000);
    expect(job.currentProgress).toBe(666);
    job.reporter.setCurrentProgress(0.0005);
    expect(job.currentProgress).toBe(0);
  });

  it('the poll loop reports the adapter progress unrounded', async () => {
    const monitor = backgroundJobsMonitor;
    const adapter = workQueueAdapter([
      () => Promise.resolve(),
      () => Promise.resolve(),
      () => Promise.resolve(),
    ]);
    const values: number[] = [];
    const stop = monitor.subscribe(() => {
      const job = monitor.jobs().find((j) => j.name === PRELOAD_JOB_NAME.symbols);
      if (job) values.push(job.currentProgress);
    });
    await preloadLibraries('symbols', adapter);
    stop();
    expect(values.at(-1)).toBe(1000);
  });
});

describe('preloadLibraries never awaits its work on the caller', () => {
  it('returns before the first poll has run', async () => {
    // `std::async( std::launch::async, preload )` — the caller gets a future,
    // not a completed load (eeschema.cpp:605-606). Ours must be the same or a
    // project open would block on the network.
    const adapter = scriptedAdapter();
    adapter.progress = 1;
    const spy = vi.fn();
    const run = preloadLibraries('symbols', adapter).then(spy);
    expect(spy).not.toHaveBeenCalled();
    expect(preloadInProgress('symbols')).toBe(true);
    await run;
    expect(spy).toHaveBeenCalled();
  });
});
