// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BACKGROUND_JOBS_MONITOR`, `BACKGROUND_JOB` and `BACKGROUND_JOB_REPORTER` —
 * common/background_jobs_monitor.cpp and include/background_jobs_monitor.h.
 *
 * KiCad has exactly one of these, on `PGM_BASE`
 * (`Pgm().GetBackgroundJobMonitor()`), and everything that works in the
 * background registers with it: the symbol library preload
 * (eeschema/eeschema.cpp:485), the footprint one (pcbnew/pcbnew.cpp:789), the
 * design-block preload (common/pgm_base.cpp:942). Every `KISTATUSBAR` in the
 * app then shows the *same* job, because each bar registers itself with the
 * monitor (`RegisterStatusBar`, :373) rather than owning progress of its own.
 * One module here for the same reason.
 *
 * Two surfaces come out of it:
 *
 *  - the status bar's label + gauge, which show `m_jobs.front()` and nothing
 *    else (`jobUpdated`, :332-347) — one job at a time, the oldest;
 *  - `BACKGROUND_JOB_LIST`, the expandable window with a row per job, which the
 *    gauge opens (`KISTATUSBAR::onBackgroundProgressClick`, :204-216). See
 *    {@link BackgroundJobList}.
 *
 * The jobs themselves are mutable objects that reporters write into from other
 * threads; here the writes are all on the one JS thread, so the mutex, the
 * `CallAfter` marshalling and the `std::atomic` fields have no counterpart.
 * What does carry over is the *shape*: a reporter holds its job and pushes, the
 * monitor notifies, and the widgets are pure readers.
 */

/** `BACKGROUND_JOB` (background_jobs_monitor.h:74-85). */
export interface BackgroundJob {
  /** `m_name` — the job's displayed title, set once by `Create`. */
  readonly name: string;
  /** `m_status` — the reporter's last `Report()` message. */
  status: string;
  /** `m_maxProgress` — the gauge's range. */
  maxProgress: number;
  /** `m_currentProgress` — the gauge's value. */
  currentProgress: number;
  /** `m_reporter`, the handle the worker drives the job through. */
  readonly reporter: BackgroundJobReporter;
}

/**
 * The denominator `SetCurrentProgress` puts a fractional progress over.
 *
 * DATA, not chrome: `BACKGROUND_JOB_REPORTER::SetCurrentProgress`
 * (background_jobs_monitor.cpp:215-221) hardcodes
 * `m_maxProgress.store( 1000 )` and `m_currentProgress.store( 1000 * aProgress )`,
 * so a 0..1 float becomes a 0..1000 gauge. Keeping the same denominator keeps
 * the same rounding: 0.0005 shows as 0 in KiCad and has to here too.
 */
const FRACTIONAL_PROGRESS_RANGE = 1000;

/**
 * `BACKGROUND_JOB_REPORTER` (background_jobs_monitor.cpp:172-222), the subset
 * of `PROGRESS_REPORTER_BASE` a background job actually uses.
 *
 * `SetTitle` is deliberately absent: upstream overrides it to do nothing
 * (background_jobs_monitor.h:53-55), and a method that cannot do anything is
 * worse than no method.
 */
export class BackgroundJobReporter {
  readonly #monitor: BackgroundJobsMonitor;
  readonly #job: BackgroundJob;
  /** `m_cancelled`; `updateUI()` returns `!m_cancelled`, which is what a
   *  worker polls through {@link keepGoing}. */
  #cancelled = false;
  /** `PROGRESS_REPORTER_BASE::m_numPhases` / `m_phase`. */
  #numPhases = 1;
  #phase = 0;

  constructor(monitor: BackgroundJobsMonitor, job: BackgroundJob) {
    this.#monitor = monitor;
    this.#job = job;
  }

  /** `Report()` — the status line under the job's name. */
  report(message: string): void {
    this.#job.status = message;
    this.#monitor.jobUpdated(this.#job);
  }

  /** `SetNumPhases()` — the gauge counts phases from here on. */
  setNumPhases(numPhases: number): void {
    this.#numPhases = numPhases;
    this.#job.maxProgress = numPhases;
    this.#monitor.jobUpdated(this.#job);
  }

  /** `AdvancePhase()`. */
  advancePhase(): void {
    this.#phase = Math.min(this.#phase + 1, this.#numPhases);
    this.#job.currentProgress = this.#phase;
    this.#monitor.jobUpdated(this.#job);
  }

  /** `SetCurrentProgress( double )` — a 0..1 fraction onto a 0..1000 gauge. */
  setCurrentProgress(progress: number): void {
    this.#job.maxProgress = FRACTIONAL_PROGRESS_RANGE;
    this.#job.currentProgress = Math.trunc(FRACTIONAL_PROGRESS_RANGE * progress);
    this.#monitor.jobUpdated(this.#job);
  }

  /** `Cancel()`. */
  cancel(): void {
    this.#cancelled = true;
  }

  /** `updateUI()`, which returns `!m_cancelled` — false means "stop". */
  keepGoing(): boolean {
    return !this.#cancelled;
  }
}

/** `BACKGROUND_JOBS_MONITOR`. One per application, exported below. */
export class BackgroundJobsMonitor {
  /** `m_jobs`, in creation order; the status bar shows `front()`. */
  #jobs: BackgroundJob[] = [];
  #listeners = new Set<() => void>();
  /** A new array identity per change, so `useSyncExternalStore` sees it. */
  #snapshot: readonly BackgroundJob[] = [];

  /** `Create( aName )` — a job with its own reporter, already registered. */
  create(name: string): BackgroundJob {
    const job: BackgroundJob = {
      name,
      status: '',
      maxProgress: 0,
      currentProgress: 0,
      // Assigned below: the reporter needs the job it reports on.
      reporter: undefined as unknown as BackgroundJobReporter,
    };
    (job as { reporter: BackgroundJobReporter }).reporter = new BackgroundJobReporter(this, job);
    this.#jobs.push(job);
    this.#publish();
    return job;
  }

  /**
   * `Remove( aJob )`. Upstream then re-pushes the new front job to the status
   * bars, or hides the gauge when none is left (:270-289); here the bar reads
   * {@link frontJob} on every publish, so the same thing falls out of the
   * notification.
   */
  remove(job: BackgroundJob): void {
    const at = this.#jobs.indexOf(job);
    if (at < 0) return;
    this.#jobs.splice(at, 1);
    this.#publish();
  }

  /**
   * `jobUpdated()` — called by the reporters only. Public because TypeScript
   * has no `friend class`; `BACKGROUND_JOB_REPORTER` is upstream's.
   */
  jobUpdated(_job: BackgroundJob): void {
    this.#publish();
  }

  /**
   * The job the status bar shows: `m_jobs.front()`, and *only* that one.
   * `jobUpdated` pushes to the bars `if( m_jobs.front() == aJob )` (:337), so a
   * second concurrent job is invisible until the first one finishes — you see
   * it in the list window instead.
   */
  frontJob(): BackgroundJob | null {
    return this.#jobs[0] ?? null;
  }

  /** Every job, for `BACKGROUND_JOB_LIST`. */
  jobs(): readonly BackgroundJob[] {
    return this.#snapshot;
  }

  /** `useSyncExternalStore`'s subscribe. */
  subscribe(onChange: () => void): () => void {
    this.#listeners.add(onChange);
    return () => {
      this.#listeners.delete(onChange);
    };
  }

  #publish(): void {
    this.#snapshot = this.#jobs.slice();
    for (const listener of this.#listeners) listener();
  }
}

/** `Pgm().GetBackgroundJobMonitor()` — the one monitor the whole app shares. */
export const backgroundJobsMonitor = new BackgroundJobsMonitor();
