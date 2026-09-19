// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The main-thread half of the DRC worker: `DRC_TOOL::RunTests` asks for a job
 * to be run, this puts it on a worker and feeds what comes back to the hooks.
 *
 * One worker per run, not a pool. A DRC is a thing a person asks for once and
 * then reads the results of, so the realm a `new Worker` costs is paid in the
 * same click that is about to spend tens of seconds anyway — and holding one
 * open between runs would hold a whole second copy of the board with it.
 *
 * Cancel is `terminate()`. A worker in the middle of a synchronous run cannot
 * read a message, so asking it to stop is not possible; killing it is, and it
 * is safe here because it shares nothing — it owns a copy of the board built
 * from the text it was handed. Every violation found before the stop has
 * already been delivered.
 */
import type { DRC_JOB_HOOKS, DRC_JOB_REQUEST } from '@ziroeda/pcbnew/src/drc/drc_job.js';
import { runDrcJob } from '@ziroeda/pcbnew/src/drc/drc_job.js';
import type { DRC_WORKER_MESSAGE } from './drc_worker.js';

/** Set once `new Worker` has failed, so we stop trying for the session. */
let workersUnavailable = false;

/** How often the run is asked whether the user pressed Cancel. */
const CANCEL_POLL_MS = 100;

/**
 * Whether the run can be handed off at all.
 *
 * False in the test runner and anywhere else without module workers, and the
 * caller then runs the identical job inline — `runDrcJob` either way, so the
 * two paths cannot drift.
 */
export function drcWorkerAvailable(): boolean {
  return !workersUnavailable && typeof Worker !== 'undefined';
}

/**
 * Run a DRC job, off the main thread where that is possible.
 *
 * Resolves when the run finishes, fails, or is cancelled; rejects only if the
 * job itself threw, which `DIALOG_DRC` reports in its message pane.
 */
export async function runDrcJobOffThread(
  aRequest: DRC_JOB_REQUEST,
  aHooks: DRC_JOB_HOOKS,
): Promise<void> {
  if (!drcWorkerAvailable()) return runDrcJob(aRequest, aHooks);

  let worker: Worker;

  try {
    // `new URL(..., import.meta.url)` with `{ type: 'module' }` is the form the
    // bundler detects and emits a separate chunk for; a string specifier would
    // be left as a runtime path that does not exist in the build.
    worker = new Worker(new URL('./drc_worker.js', import.meta.url), { type: 'module' });
  } catch {
    workersUnavailable = true;
    return runDrcJob(aRequest, aHooks);
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const finish = (andThen: () => void): void => {
      if (settled) return;

      settled = true;

      if (poll !== null) clearInterval(poll);

      worker.terminate();
      andThen();
    };

    poll = setInterval(() => {
      // The run is over as far as the caller is concerned; what it has
      // collected so far is what it keeps.
      if (aHooks.isCancelled?.()) finish(() => resolve());
    }, CANCEL_POLL_MS);

    worker.onmessage = (e: MessageEvent<DRC_WORKER_MESSAGE>): void => {
      const msg = e.data;

      switch (msg.t) {
        case 'phase':
          aHooks.onPhase(msg.message);
          break;
        case 'progress':
          aHooks.onProgress(msg.value);
          break;
        case 'violation':
          aHooks.onViolation(msg.violation);
          break;
        case 'done':
          finish(() => resolve());
          break;
        case 'error':
          finish(() => reject(new Error(msg.message)));
          break;
      }
    };

    // A worker that dies takes the run with it. It has already delivered what
    // it found, so this is reported rather than thrown away.
    worker.onerror = (e: ErrorEvent): void => {
      finish(() => reject(new Error(e.message || 'the DRC worker failed')));
    };

    worker.postMessage(aRequest);
  });
}
