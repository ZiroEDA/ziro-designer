// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One thread of `GetKiCadThreadPool()` (common/thread_pool.cpp): a module
 * worker that runs the jobs of thread_pool_jobs.ts as they are posted to it,
 * and posts each answer back under the request's id.
 */
import {
  POOL_JOB_RUNNERS,
  type POOL_REQUEST,
  type POOL_RESPONSE,
  poolJobTransferables,
} from './thread_pool_jobs.js';

/** The worker's own global, typed as the `Worker` end of the channel. */
const scope = self as unknown as Worker;

scope.onmessage = (e: MessageEvent<POOL_REQUEST>) => {
  const { id, kind, args } = e.data;

  try {
    const runner = POOL_JOB_RUNNERS[kind] as (a: unknown) => unknown;
    const result = runner(args);
    const response: POOL_RESPONSE = { id, result };
    scope.postMessage(response, poolJobTransferables(kind, result));
  } catch (err) {
    const response: POOL_RESPONSE = { id, error: err instanceof Error ? err.message : String(err) };
    scope.postMessage(response);
  }
};
