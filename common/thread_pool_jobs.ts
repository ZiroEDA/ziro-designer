// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The jobs a `thread_pool` thread can run.
 *
 * `BS::thread_pool::submit_task` takes any callable; a browser worker takes
 * only what `postMessage` can copy, so a task here is a name and its
 * arguments, and this table is the callable behind each name. The worker
 * (thread_pool_worker.ts) and the inline fallback (thread_pool.ts, where there
 * is no `Worker`) both dispatch through it, so the two cannot drift.
 */
import {
  SHAPE_POLY_SET,
  type TRIANGULATION_JOB,
  type TRIANGULATION_RESULT,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';

export interface POOL_JOBS {
  /** `SHAPE_POLY_SET::CacheTriangulation` on another thread. */
  triangulate: { args: TRIANGULATION_JOB; result: TRIANGULATION_RESULT };
}

export type POOL_JOB_KIND = keyof POOL_JOBS;

export const POOL_JOB_RUNNERS: {
  [K in POOL_JOB_KIND]: (args: POOL_JOBS[K]['args']) => POOL_JOBS[K]['result'];
} = {
  triangulate: (args) => SHAPE_POLY_SET.RunTriangulationJob(args),
};

/** The typed arrays a result owns, for the worker's transfer list. */
export function poolJobTransferables(kind: POOL_JOB_KIND, value: unknown): Transferable[] {
  const out: Transferable[] = [];

  if (kind === 'triangulate') {
    const v = value as TRIANGULATION_JOB | TRIANGULATION_RESULT;

    for (const poly of v.polys) {
      if (Array.isArray(poly)) for (const chain of poly) out.push(chain.pts.buffer);
      else {
        out.push(poly.vertices.buffer);
        out.push(poly.triangles.buffer);
      }
    }
  }

  return out;
}

/** What the main thread posts to a pool worker. */
export interface POOL_REQUEST {
  id: number;
  kind: POOL_JOB_KIND;
  args: unknown;
}

/** What a pool worker posts back. */
export interface POOL_RESPONSE {
  id: number;
  result?: unknown;
  error?: string;
}
