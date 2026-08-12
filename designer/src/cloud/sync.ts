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
  exportManifest,
  exportProject,
  forkLocalCopy,
  hasDivergedLocally,
  importProject,
  knownPushedHashes,
  listSyncMeta,
  localCopyName,
  markSynced,
} from '../home/projectStore.js';
import {
  cloudBackendInstalled,
  cloudDelete,
  cloudGet,
  cloudListMeta,
  cloudMissingObjects,
  cloudUpsert,
  restoreFromHistory,
} from './cloudStore.js';

/** Progress callback: `done` of `total` transfers finished so far. */
export type SyncProgress = (done: number, total: number) => void;

/** What one transfer turned out to be. A pull can become a repair. */
type Outcome = 'pushed' | 'pulled' | 'healed';

/**
 * A cloud copy that is damaged beyond any recovery this app can perform: its
 * blobs are gone, this machine has no copy, and no earlier version is intact.
 *
 * Distinguished from an ordinary failure because the two call for opposite
 * responses. An ordinary failure is worth retrying, and does on the next sync. A
 * project in this state will report the same thing on every sign-in for the life
 * of the account, so the only useful thing left is to let the user clear it out.
 */
export class UnrecoverableProject extends Error {
  constructor(
    readonly id: string,
    message: string,
  ) {
    super(message);
    this.name = 'UnrecoverableProject';
  }
}

/** What a completed reconcile did, and what it could not do. */
export interface SyncResult {
  pushed: number;
  pulled: number;
  /**
   * Projects whose cloud copy was unreadable and has been replaced with the
   * local one. Counted apart from `pushed` because it is a repair, not a save:
   * it is worth telling the user that a broken copy in their account was fixed.
   */
  healed: number;
  /** One entry per project that failed. Empty means everything landed. */
  failures: {
    id: string;
    direction: 'push' | 'pull';
    message: string;
    /** Set when retrying can never help; the caller can offer to remove it. */
    unrecoverable?: boolean;
  }[];
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Reconcile all local and cloud projects for the signed-in user. */
export async function syncAllProjects(
  userId: string,
  onProgress?: SyncProgress,
): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, healed: 0, failures: [] };
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
  const track = (id: string, direction: 'push' | 'pull', p: Promise<Outcome>): void => {
    ops.push(
      p.then(
        // What happened, not what was planned: a pull whose cloud copy turns out
        // to be unreadable is completed by pushing the local one, and reporting
        // that as a pull would describe the opposite of what took place.
        (outcome) => {
          if (outcome === 'pushed') result.pushed++;
          else if (outcome === 'pulled') result.pulled++;
          else result.healed++;
          tick();
        },
        (e) => {
          result.failures.push({
            id,
            direction,
            message: message(e),
            ...(e instanceof UnrecoverableProject ? { unrecoverable: true } : {}),
          });
          tick();
        },
      ),
    );
  };

  for (const id of new Set([...local.keys(), ...cloud.keys()])) {
    const lt = local.get(id);
    const ct = cloud.get(id);

    if (lt !== undefined && ct === undefined) track(id, 'push', pushOne(userId, id));
    else if (lt === undefined && ct !== undefined) track(id, 'pull', pullOne(userId, id));
    else if (lt !== undefined && ct !== undefined && lt !== ct) {
      if (lt > ct) track(id, 'push', pushOne(userId, id));
      else track(id, 'pull', pullOne(userId, id));
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
async function pushOne(userId: string, id: string): Promise<Outcome> {
  // A manifest, not the whole project: names, hashes and sizes, with the bytes
  // left in the store until a blob actually has to be uploaded. Encoding every
  // file to base64 to find out that none of them changed cost about 400 ms of
  // main thread on a 10 MB project, every time edits settled.
  const p = await exportManifest(id);
  if (!p) return 'pushed';
  // What the last landed push put in the store. Those blobs are still
  // referenced by the cloud row, so they need neither storing nor confirming
  // again, which is most of the cost of pushing a project that barely changed.
  const committed = await cloudUpsert(userId, p, await knownPushedHashes(id));
  // Only after the write lands: a project that has been pushed belongs to this
  // account, so the next person to sign in on this browser does not inherit it.
  await claimProject(id, userId);
  // The two sides agree as of this push (#367), and this is what it agrees on.
  await markSynced(
    id,
    committed.map((m) => m.hash),
  );
  return 'pushed';
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
async function pullOne(userId: string, id: string): Promise<Outcome> {
  try {
    const p = await cloudGet(id);
    if (!p) return 'pulled';
    if (await hasDivergedLocally(id)) {
      await forkLocalCopy(id, localCopyName(p.name, new Date()));
    }
    await importProject(p);
    return 'pulled';
  } catch (e) {
    return await repairUnreadable(userId, id, e);
  }
}

/**
 * A pull failed. If the cloud copy is unreadable *because its objects are not
 * there*, replace it with the local one; otherwise re-throw.
 *
 * A row that references objects the store does not have cannot be downloaded by
 * anyone, ever. It is not a copy of anything, so there is nothing to weigh
 * against the local copy and nothing to lose by overwriting it — and leaving it
 * alone means the same project fails on every sync for the life of the account,
 * which is exactly what was happening to eleven projects written before the
 * commit protocol existed.
 *
 * Three conditions, all required, because this is the one place a sync
 * overwrites the cloud with something the user did not ask it to:
 *
 *  - the store must *definitely* answer "absent" (`cloudMissingObjects`
 *    propagates anything that could not be asked, so a dropped connection or an
 *    expired token is never mistaken for damage);
 *  - the local copy must exist and have contents, checked with the same
 *    predicate that guards imports, so a damaged local copy cannot be promoted
 *    over a damaged remote one;
 *  - and the push itself is the ordinary commit protocol, which verifies every
 *    blob before it writes the row.
 *
 * When there is nothing local to repair from, the copy really is gone, and the
 * error says so in terms of the project rather than of a storage path.
 */
async function repairUnreadable(userId: string, id: string, cause: unknown): Promise<Outcome> {
  const damage = await cloudMissingObjects(id); // throws on "could not ask"
  if (!damage || damage.missing === 0) throw cause; // readable copy, real failure

  // "Has contents" rather than "exists": a local copy whose files are all empty
  // is the same damage in the other direction, and promoting it over the remote
  // one would destroy the last thing a recovery could come from.
  const local = await exportProject(id);
  const usable = !!local && local.files.some((f) => (f.gzB64?.length ?? 0) > 0);
  if (!usable) {
    // Nothing on this machine to restore from, so the last place to look is the
    // project's own history. Blobs are only collected when no row references
    // them, so an older manifest's objects often outlive the row that replaced
    // it, and for a project damaged before the commit protocol existed that
    // version may be the only readable copy anywhere.
    const restored = await restoreFromHistory(userId, id);
    if (restored) {
      const p = await cloudGet(id);
      if (p) await importProject(p);
      return 'healed';
    }
    throw new UnrecoverableProject(
      id,
      `the cloud copy of "${damage.name || local?.name || id}" cannot be recovered: ` +
        `${damage.missing} of ${damage.total} files are missing from storage, ` +
        `there is no copy on this device, and no earlier version is intact`,
    );
  }

  await pushOne(userId, id);
  return 'healed';
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
