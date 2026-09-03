// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `IFACE::PreloadLibraries` — eeschema/eeschema.cpp:487-607 for symbols and
 * pcbnew/pcbnew.cpp:772-892 for footprints. The two are the same routine with
 * a different adapter and a different job name, so it is written once here.
 *
 * ## What upstream does, and when
 *
 * The trigger is **not** the place tool. `PreloadLibraries` is scheduled by
 * `CallAfter` the moment a project opens — eeschema/sch_edit_frame.cpp:1492-1499
 * (Open Project) and eeschema/files-io.cpp:858-864 (a schematic finishing its
 * load), pcbnew/files.cpp:610, and kicad/kicad_manager_frame.cpp:545-548 for
 * both faces at once from the project manager. By the time the user presses
 * `A`, the libraries are in memory and the chooser opens on data it already
 * has. That is the behaviour this port is after: paid once, up front, in the
 * background.
 *
 * The mechanism, verbatim:
 *
 *  - an atomic `compare_exchange_strong` on `m_libraryPreloadInProgress` so two
 *    callers cannot both start it (:493-500) — the project manager and the
 *    editor both schedule one;
 *  - `Pgm().GetBackgroundJobMonitor().Create( _( "Loading Symbol Libraries" ) )`
 *    (:504-505), so the progress lives in the status bar and its job list and
 *    **not** in any dialog;
 *  - `adapter->AsyncLoad()`, then a poll loop reading `AsyncLoadProgress()` and
 *    calling `reporter->SetCurrentProgress( progress )` every {@link
 *    PRELOAD_INTERVAL_MS}, giving up after {@link PRELOAD_TIME_LIMIT_MS};
 *  - an abort flag checked at the top of each iteration (:521-527), set by
 *    `CancelPreload` and `ProjectChanged`.
 *
 * ## Why our work list is not "every library"
 *
 * Upstream loads every row of the library table because they are files on the
 * local disk. Ours are objects in a bucket, and the numbers say a literal
 * transliteration is the wrong answer here, not a faithful one:
 *
 *     symbol libraries          223 files, 230.4 MB raw
 *     individual symbols     22 784 files, in 22 784 round trips
 *
 * That last point is now handled up front instead: {@link preloadBundle}
 * fetches the whole catalogue as ONE object per kind (measured: symbols
 * 230.4 MB raw -> 10.21 MB, footprints 155.9 MB -> 11.73 MB), stores each
 * library gzipped, and the read paths expand one on demand. The stale note this
 * paragraph used to carry - that the bucket serves libraries uncompressed - was
 * true when it was written and is not now.
 *
 * So the preload does what KiCad's *achieves* rather than what it does: it
 * makes resident everything the open design refers to — which is exactly the
 * set the canvas, ERC's library comparison, and the chooser's "Already Placed"
 * and "Recently Used" groups read (`PANEL_SYMBOL_CHOOSER`'s constructor calls
 * `m_frame->GetLibSymbol( i.LibId )` synchronously for both lists, which it can
 * only do because the preload already ran). That set is bounded by the design,
 * not by the library set. The rest of the catalogue stays lazy, and the chooser
 * shows it from the name index, which is one 366 kB file.
 */

import { backgroundJobsMonitor, type BackgroundJob } from './ui/background_jobs_monitor.js';
import { ensureBundle } from './libraryBundleStore.js';

/** Which hosted library set a preload covers. */
export type PreloadKind = 'symbols' | 'footprints';

/**
 * `constexpr static int interval = 150` — eeschema.cpp:489, pcbnew.cpp:774.
 * How often the poll loop reads the adapter's progress.
 */
export const PRELOAD_INTERVAL_MS = 150;

/**
 * `constexpr static int timeLimit = 120000` — eeschema.cpp:490, pcbnew.cpp:775.
 * The loop gives up after this; note it does **not** abort the adapter, it just
 * stops watching and falls through to `BlockUntilLoaded()`.
 */
export const PRELOAD_TIME_LIMIT_MS = 120000;

/**
 * The job names, `BACKGROUND_JOBS_MONITOR::Create`'s argument and also the
 * first thing the reporter reports (eeschema.cpp:505 and :516,
 * pcbnew.cpp:789 and :801). Both strings are used twice upstream, which is why
 * the same constant feeds `create()` and `report()` below.
 */
export const PRELOAD_JOB_NAME: Record<PreloadKind, string> = {
  symbols: 'Loading Symbol Libraries',
  footprints: 'Loading Footprint Libraries',
};

/**
 * The async surface `PreloadLibraries` drives, `LIBRARY_MANAGER_ADAPTER`'s
 * (include/libraries/library_manager.h:149-160).
 */
export interface PreloadAdapter {
  /** `AsyncLoad()` — dispatch the work; returns at once. */
  asyncLoad(): void;
  /**
   * `AsyncLoadProgress()`, `std::optional<float>`
   * (common/libraries/library_manager.cpp:1399-1408): `loaded / total`, or
   * `std::nullopt` when `total == 0`. `undefined` is the `nullopt`, and the
   * loop treats it as "nothing to do, call it finished".
   */
  asyncLoadProgress(): number | undefined;
  /** `BlockUntilLoaded()` — wait for every dispatched item. */
  blockUntilLoaded(): Promise<void>;
  /** `AbortAsyncLoad()` — set the workers' abort flag, then wait. */
  abortAsyncLoad(): Promise<void>;
}

/**
 * How many work items run at once, standing in for `GetKiCadThreadPool()`.
 *
 * Not a KiCad number: upstream's pool is sized to the machine's cores because
 * its work is disk reads and parsing, and ours is HTTP round trips against one
 * host. Six is what a browser will open to a single HTTP/1.1 origin anyway, so
 * dispatching more only queues them somewhere less visible.
 */
const PRELOAD_CONCURRENCY = 6;

/**
 * A `LIBRARY_MANAGER_ADAPTER`-shaped adapter over a list of independent jobs.
 *
 * Mirrors the two counters the real one keeps — `m_loadTotal` set to the number
 * of rows and `m_loadCount` bumped as each finishes
 * (library_manager.cpp:1798-1800) — because those, not any notion of bytes, are
 * what the gauge is a fraction of. Upstream's progress therefore steps once per
 * *library*; ours steps once per work item.
 *
 * A failing item still counts as done. Upstream's worker records a
 * `LOAD_ERROR` status and returns, and the load as a whole completes; a preload
 * that stalled its gauge on one unreachable library would be worse than one
 * that finishes with a gap in it.
 */
export function workQueueAdapter(work: readonly (() => Promise<unknown>)[]): PreloadAdapter {
  let total = 0;
  let loaded = 0;
  let abort = false;
  let running: Promise<void> | null = null;

  const runAll = async (): Promise<void> => {
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (abort) return;
        const i = next++;
        const item = work[i];
        if (!item) return;
        try {
          await item();
        } catch {
          /* LOAD_ERROR: counted, not fatal. See above. */
        }
        loaded++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PRELOAD_CONCURRENCY, work.length) }, () => worker()),
    );
  };

  return {
    asyncLoad(): void {
      // `AsyncLoad` returns early if a previous call's futures are still
      // outstanding (library_manager.cpp:1786-1795).
      if (running) return;
      total = work.length;
      loaded = 0;
      if (total === 0) return;
      running = runAll();
    },
    asyncLoadProgress(): number | undefined {
      if (total === 0) return undefined;
      return loaded / total;
    },
    async blockUntilLoaded(): Promise<void> {
      await running;
    },
    async abortAsyncLoad(): Promise<void> {
      abort = true;
      await running;
      // `m_loadTotal.store( 0 ); m_loadCount.store( 0 );` (:1393-1394).
      total = 0;
      loaded = 0;
      abort = false;
      running = null;
    },
  };
}

/** `m_libraryPreloadInProgress`, one per face. */
const inProgress: Record<PreloadKind, boolean> = { symbols: false, footprints: false };
/** `m_libraryPreloadAbort`. */
const abortRequested: Record<PreloadKind, boolean> = { symbols: false, footprints: false };
/** `m_libraryPreloadReturn`, the future `CancelPreload( true )` waits on. */
const preloadReturn: Record<PreloadKind, Promise<void> | null> = {
  symbols: null,
  footprints: null,
};

/** `std::this_thread::sleep_for`. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * `IFACE::PreloadLibraries( KIWAY* )`.
 *
 * Returns the promise for the background work so a caller that needs to wait
 * can — `CancelPreload( aBlock = true )` does exactly that with
 * `m_libraryPreloadReturn.wait()`. Callers on the UI path should not await it;
 * that is the whole point of the routine.
 */
export function preloadLibraries(kind: PreloadKind, adapter: PreloadAdapter): Promise<void> {
  // `compare_exchange_strong`: the project manager and the editor both schedule
  // a preload via CallAfter, and only the first may run.
  if (inProgress[kind]) return preloadReturn[kind] ?? Promise.resolve();
  inProgress[kind] = true;

  const job: BackgroundJob = backgroundJobsMonitor.create(PRELOAD_JOB_NAME[kind]);

  const preload = async (): Promise<void> => {
    const reporter = job.reporter;
    let elapsed = 0;
    let aborted = false;

    reporter.report(PRELOAD_JOB_NAME[kind]);
    adapter.asyncLoad();

    for (;;) {
      if (abortRequested[kind]) {
        abortRequested[kind] = false;
        aborted = true;
        break;
      }

      await sleep(PRELOAD_INTERVAL_MS);

      const loadStatus = adapter.asyncLoadProgress();

      if (loadStatus !== undefined) {
        reporter.setCurrentProgress(loadStatus);
        if (loadStatus >= 1) break;
      } else {
        reporter.setCurrentProgress(1);
        break;
      }

      elapsed += PRELOAD_INTERVAL_MS;

      if (elapsed > PRELOAD_TIME_LIMIT_MS) break;
    }

    // "AbortAsyncLoad() sets the adapter's worker abort flag and then blocks,
    //  so workers exit at their next checkpoint. BlockUntilLoaded() alone just
    //  waits for each future to complete naturally, which can hang indefinitely
    //  if a worker is stuck on a stalled network or filesystem operation."
    //  (eeschema.cpp:552-555 — and a stalled network is not hypothetical here.)
    if (aborted) await adapter.abortAsyncLoad();
    else await adapter.blockUntilLoaded();

    // pcbnew.cpp:878 clears the abort flag here unconditionally; eeschema.cpp
    // does not, so an abort requested after its loop exited would poison the
    // NEXT preload. Taking pcbnew's version for both: the difference is an
    // upstream inconsistency rather than a behaviour either face depends on.
    abortRequested[kind] = false;
    backgroundJobsMonitor.remove(job);
    inProgress[kind] = false;
    preloadReturn[kind] = null;
  };

  const running = preload();
  preloadReturn[kind] = running;
  return running;
}

/**
 * `IFACE::CancelPreload( bool aBlock )` (eeschema.cpp:610-619). Also
 * `ProjectChanged()`, which is the same thing with `aBlock = false`
 * (eeschema.cpp:622-626): a preload holding a reference to the project being
 * closed has to stop before the project goes away.
 */
export async function cancelPreload(kind: PreloadKind, block = false): Promise<void> {
  if (!inProgress[kind]) return;
  abortRequested[kind] = true;
  if (block) await preloadReturn[kind];
}

/** Whether a preload of this kind is running — `m_libraryPreloadInProgress`. */
export function preloadInProgress(kind: PreloadKind): boolean {
  return inProgress[kind];
}

/**
 * Make a kind's stock catalogue resident before its preload runs.
 *
 * A job on the same `BACKGROUND_JOBS_MONITOR` every other preload uses, so this
 * shows in the status bar's gauge and its job list rather than in a dialog —
 * `Pgm().GetBackgroundJobMonitor().Create( … )`, eeschema.cpp:504-505.
 *
 * Never throws and never blocks the preload behind a failure: `ensureBundle`
 * reports false and the per-library fetches carry on exactly as before.
 */
export async function preloadBundle(kind: PreloadKind): Promise<void> {
  const job: BackgroundJob = backgroundJobsMonitor.create(PRELOAD_JOB_NAME[kind]);
  job.reporter.report(PRELOAD_JOB_NAME[kind]);
  try {
    await ensureBundle(kind, (done, total) => {
      job.reporter.setCurrentProgress(total > 0 ? done / total : 0);
    });
  } finally {
    backgroundJobsMonitor.remove(job);
  }
}
