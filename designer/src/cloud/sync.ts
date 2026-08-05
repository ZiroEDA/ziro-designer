// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two-way project sync between IndexedDB (local) and Supabase (cloud).
 *
 * Strategy: last-write-wins by `updatedAt`. On sign-in we reconcile the union
 * of local + cloud ids, newer copy wins, missing copies are copied across.
 * Individual saves/deletes also mirror to the cloud while online (see HomePage),
 * so this full pass is mainly for first sign-in on a new device.
 *
 * Known MVP limitation: a delete made offline can be resurrected by the other
 * side on next sync (no tombstones yet). Deletes while online propagate fine.
 */

import { authEnabled } from '../auth/supabaseClient.js';
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
import { cloudDelete, cloudGet, cloudListMeta, cloudUpsert } from './cloudStore.js';

/** Progress callback: `done` of `total` transfers finished so far. */
export type SyncProgress = (done: number, total: number) => void;

/** Reconcile all local and cloud projects for the signed-in user. */
export async function syncAllProjects(userId: string, onProgress?: SyncProgress): Promise<void> {
  if (!authEnabled) return;

  const [localMeta, cloudMeta] = await Promise.all([listSyncMeta(), cloudListMeta()]);
  const local = new Map(localMeta.map((m) => [m.id, m.updatedAt]));
  const cloud = new Map(cloudMeta.map((m) => [m.id, m.updatedAt]));

  const ids = new Set([...local.keys(), ...cloud.keys()]);
  const ops: Promise<void>[] = [];

  // Count the transfers up front so the UI can show "n of m", ticking one as
  // each push/pull settles (order of completion, not of dispatch).
  let done = 0;
  const tick = (): void => {
    done++;
    onProgress?.(done, ops.length);
  };
  const track = (p: Promise<void>): void => {
    ops.push(
      p.then(tick, (e) => {
        tick();
        throw e;
      }),
    );
  };

  for (const id of ids) {
    const lt = local.get(id);
    const ct = cloud.get(id);

    if (lt !== undefined && ct === undefined) {
      track(pushOne(userId, id));
    } else if (lt === undefined && ct !== undefined) {
      track(pullOne(id));
    } else if (lt !== undefined && ct !== undefined && lt !== ct) {
      if (lt > ct) track(pushOne(userId, id));
      else track(pullOne(id));
    }
  }

  if (ops.length > 0) onProgress?.(0, ops.length);
  await Promise.all(ops);
}

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
 * Take the cloud's copy — but not over unsynced local work.
 *
 * Reconciliation is last-write-wins on `updatedAt`, so a pull overwrites the
 * local record wholesale. That is fine when the local side has not changed
 * since it last agreed with the cloud, and destroys a day's work when it has:
 * edit offline on a laptop, edit on a desktop, sign in, and one side vanished
 * with no prompt and no copy (#367).
 *
 * The local copy is kept as a **new project** first. That is additive and
 * reversible — the user gets two entries in Recent to compare, and can delete
 * whichever they do not want — where the alternative is losing one of them
 * silently. It costs an extra Recent entry, and only when the two sides have
 * genuinely diverged.
 */
async function pullOne(id: string): Promise<void> {
  const p = await cloudGet(id);
  if (!p) return;
  if (await hasDivergedLocally(id)) {
    await forkLocalCopy(id, localCopyName(p.name, new Date()));
  }
  await importProject(p);
}

/** Mirror a single saved project up to the cloud (best-effort). */
export async function pushProject(userId: string, id: string): Promise<void> {
  if (!authEnabled) return;
  await pushOne(userId, id);
}

/** Mirror a delete up to the cloud (best-effort). */
export async function deleteCloudProject(id: string): Promise<void> {
  if (!authEnabled) return;
  await cloudDelete(id);
}
