// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The thread a DRC runs on — our `GetKiCadThreadPool()` worker for
 * `DRC_TOOL::RunTests`.
 *
 * KiCad hands each provider's heavy loop to the pool and polls it from the GUI
 * thread (`drc_test_provider_copper_clearance.cpp:697`), and `DIALOG_DRC`
 * repaints and yields while that happens. Neither half is available to one
 * browser thread: a 47 s run holds it from the first provider to the last, so
 * nothing paints and Cancel cannot be reached. Moving the run here is the same
 * division of labour upstream has — the window thread stays live, the work
 * happens elsewhere.
 *
 * Messages go one way while a run is in flight. `postMessage` from inside a
 * synchronous run still reaches the main thread (the receiver's task queue is
 * not this thread's), which is what lets the gauge move; but this thread
 * cannot *read* a message until it is idle, so Cancel is `terminate()` on the
 * other side. Nothing is lost by that: each violation is posted as it is
 * found, so a cancelled run has already delivered everything up to the stop,
 * which is what upstream's handler-per-violation gives it too.
 */
import type { DRC_JOB_REQUEST, DRC_JOB_VIOLATION } from '@ziroeda/pcbnew/drc/drc_job.js';
import { runDrcJob } from '@ziroeda/pcbnew/drc/drc_job.js';

/** What the worker posts back, in the order `DIALOG_DRC` consumes it. */
export type DRC_WORKER_MESSAGE =
  | { t: 'phase'; message: string }
  | { t: 'progress'; value: number }
  | { t: 'violation'; violation: DRC_JOB_VIOLATION }
  | { t: 'done' }
  | { t: 'error'; message: string };

/**
 * The gauge is redrawn at ~10 Hz upstream (`m_updateThrottle`), so there is
 * nothing to gain from posting every `ReportProgress` — a run makes thousands.
 */
const PROGRESS_INTERVAL_MS = 50;

/**
 * The worker scope, when this module IS a worker's entry point.
 *
 * Typed structurally rather than as `DedicatedWorkerGlobalScope`, and guarded
 * on `WorkerGlobalScope`, for the reason `preload_worker.ts` gives: the
 * designer's tsconfig has the DOM lib, not WebWorker.
 */
interface WorkerScope {
  postMessage(message: DRC_WORKER_MESSAGE): void;
  onmessage: ((e: MessageEvent<DRC_JOB_REQUEST>) => void) | null;
}

const global = globalThis as unknown as { WorkerGlobalScope?: unknown };

if (global.WorkerGlobalScope !== undefined) {
  const scope = globalThis as unknown as WorkerScope;

  scope.onmessage = (e: MessageEvent<DRC_JOB_REQUEST>): void => {
    let lastProgress = 0;

    runDrcJob(e.data, {
      onPhase: (message) => {
        lastProgress = 0;
        scope.postMessage({ t: 'phase', message });
      },
      onProgress: (value) => {
        const now = Date.now();

        if (now - lastProgress < PROGRESS_INTERVAL_MS) return;

        lastProgress = now;
        scope.postMessage({ t: 'progress', value });
      },
      onViolation: (violation) => scope.postMessage({ t: 'violation', violation }),
    }).then(
      () => scope.postMessage({ t: 'done' }),
      (err: unknown) =>
        scope.postMessage({
          t: 'error',
          message: err instanceof Error ? (err.stack ?? err.message) : String(err),
        }),
    );
  };
}
