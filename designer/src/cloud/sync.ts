// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two-way project sync between IndexedDB (local) and the cloud.
 *
 * Strategy: last-write-wins by `updatedAt`, over the union of local and cloud
 * ids. Individual saves and deletes also mirror up while online (see HomePage),
 * so this full pass mainly matters at first sign-in on a new device.
 *
 * ### Failures are reported, not counted as success
 *
 * Every transfer used to be gathered into one `Promise.all`, whose rejection
 * the caller logged to the console and then displayed "✓ Projects synced"
 * anyway. Nothing a user could see distinguished a clean sync from one where
 * every project failed — which is how a fault that emptied eleven projects ran
 * for weeks without a report.
 *
 * So a per-project failure is now caught, kept, and returned. One project
 * failing no longer abandons the rest, and the caller receives a list it is
 * expected to show.
 *
 * Known limitation, unchanged: a delete made offline can be resurrected by the
 * other side on the next sync (no tombstones yet). Deletes while online
 * propagate fine.
 */

import {
  claimProject,
  exportProject,
  forkLocalCopy,
  hasDivergedLocally,
  importProject,
  listSyncMeta,
  localCopyName,
  markSynced,
} from '../home/projectStore.js';
import {
  cloudBackendInstalled,
  cloudDelete,
  cloudGet,
  cloudListMeta,
  cloudUpsert,
} from './cloudStore.js';

/** Progress callback: `done` of `total` transfers finished so far. */
export type SyncProgress = (done: number, total: number) => void;

/** What a completed reconcile did, and what it could not do. */
export interface SyncResult {
  pushed: number;
  pulled: number;
  /** One entry per project that failed. Empty means everything landed. */
  failures: { id: string; direction: 'push' | 'pull'; message: string }[];
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Reconcile all local and cloud projects for the signed-in user. */
export async function syncAllProjects(
  userId: string,
  onProgress?: SyncProgress,
): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, failures: [] };
  if (!cloudBackendInstalled()) return result;

  const [localMeta, cloudMeta] = await Promise.all([listSyncMeta(), cloudListMeta()]);
  const local = new Map(localMeta.map((m) => [m.id, m.updatedAt]));
  const cloud = new Map(cloudMeta.map((m) => [m.id, m.updatedAt]));

  const ops: Promise<void>[] = [];

  // Count the transfers up front so the UI can show "n of m", ticking one as
  // each push/pull settles (order of completion, not of dispatch).
  let done = 0;
  const tick = (): void => {
    done++;
    onProgress?.(done, ops.length);
  };

  /**
   * Run one transfer, recording its outcome either way.
   *
   * The rejection is absorbed on purpose: a project that cannot be transferred
   * is a fact to report, not a reason to abandon the other nineteen. It reaches
   * the user through `SyncResult.failures`.
   */
  const track = (id: string, direction: 'push' | 'pull', p: Promise<void>): void => {
    ops.push(
      p.then(
        () => {
          if (direction === 'push') result.pushed++;
          else result.pulled++;
          tick();
        },
        (e) => {
          result.failures.push({ id, direction, message: message(e) });
          tick();
        },
      ),
    );
  };

  for (const id of new Set([...local.keys(), ...cloud.keys()])) {
    const lt = local.get(id);
    const ct = cloud.get(id);

    if (lt !== undefined && ct === undefined) track(id, 'push', pushOne(userId, id));
    else if (lt === undefined && ct !== undefined) track(id, 'pull', pullOne(id));
    else if (lt !== undefined && ct !== undefined && lt !== ct) {
      if (lt > ct) track(id, 'push', pushOne(userId, id));
      else track(id, 'pull', pullOne(id));
    }
  }

  if (ops.length > 0) onProgress?.(0, ops.length);
  await Promise.all(ops);
  return result;
}

/**
 * Send the local copy up.
 *
 * `cloudUpsert` commits only after every blob it names is stored and confirmed,
 * so a throw here means nothing in the cloud changed. The two bookkeeping
 * writes that follow are therefore reached only on a real success — recording
 * "these sides agree" after a failed push is what let a damaged copy be treated
 * as the agreed one.
 */
async function pushOne(userId: string, id: string): Promise<void> {
  const p = await exportProject(id);
  if (!p) return;
  await cloudUpsert(userId, p);
  // Only after the write lands: a project that has been pushed belongs to this
  // account, so the next person to sign in on this browser does not inherit it.
  await claimProject(id, userId);
  // The two sides agree as of this push (#367).
  await markSynced(id);
}

/**
 * Take the cloud's copy — but not over unsynced local work, and not when the
 * copy cannot be fetched intact.
 *
 * Reconciliation is last-write-wins on `updatedAt`, so a pull overwrites the
 * local record wholesale. That is fine when the local side has not changed
 * since it last agreed with the cloud, and destroys a day's work when it has:
 * edit offline on a laptop, edit on a desktop, sign in, and one side vanished
 * with no prompt and no copy (#367). The local copy is kept as a **new
 * project** first — additive and reversible, where the alternative is losing
 * one side silently.
 *
 * `cloudGet` now verifies every blob against the hash the manifest committed
 * and throws on any that is missing or corrupt, so a partial fetch cannot reach
 * `importProject` disguised as a complete one.
 */
async function pullOne(id: string): Promise<void> {
  const p = await cloudGet(id);
  if (!p) return;
  if (await hasDivergedLocally(id)) {
    await forkLocalCopy(id, localCopyName(p.name, new Date()));
  }
  await importProject(p);
}

/** Mirror a single saved project up to the cloud. Throws if it did not land. */
export async function pushProject(userId: string, id: string): Promise<void> {
  if (!cloudBackendInstalled()) return;
  await pushOne(userId, id);
}

/** Mirror a delete up to the cloud. */
export async function deleteCloudProject(id: string): Promise<void> {
  if (!cloudBackendInstalled()) return;
  await cloudDelete(id);
}
