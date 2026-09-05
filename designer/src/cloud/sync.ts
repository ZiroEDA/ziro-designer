// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two-way project sync between IndexedDB (local) and the cloud.
 *
 * Strategy: **fast-forward on a version integer**, over the union of local and
 * cloud ids. Individual saves and deletes also mirror up while online (see
 * HomePage), so this full pass mainly matters at first sign-in on a new device.
 *
 * ### Why not last-write-wins on a timestamp
 *
 * It used to be exactly that, and the timestamp was `Date.now()` **from the
 * browser** — written into `projects.updated_at` and compared against another
 * machine's clock as if the two were one. A device a minute slow lost every
 * race regardless of what actually happened first, and the *contents* were never
 * consulted at all. Since opening a project rewrites its files (identical bytes,
 * fresh timestamp), the last tab to merely open a project won, and could
 * overwrite a different machine's real work.
 *
 * Now every row carries a `version` the server assigns, and a push states the
 * version it is replacing. Three cases, and they are git's:
 *
 *  - **base === cloud, no local change** — already in sync, do nothing.
 *  - **base === cloud, local changed** — fast-forward: push over that version.
 *  - **base < cloud** — the cloud moved. Pull. If this side *also* changed, that
 *    is a genuine conflict, and only then is the local copy forked aside.
 *
 * No clock takes part in any of it, and "changed" means the blob hashes differ.
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
  linkCloudProject,
  listSyncMeta,
  localCopyName,
  markSynced,
} from '../home/projectStore.js';
import {
  cloudBackendInstalled,
  cloudDelete,
  cloudGet,
  cloudGetRow,
  cloudListMeta,
  cloudMemberships,
  assertStoreAnswers,
  cloudMissingObjects,
  cloudUpsert,
  restoreFromHistory,
  StaleBaseError,
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

/**
 * Which cloud project a local copy is a copy of, and what may be done to it.
 *
 * The two ids are the point. `localId` is the key IndexedDB files this copy
 * under; `remoteId` is the `id` the cloud row carries. For the user's own
 * projects they are the same string and always were. For a project shared with
 * them they are not, and cannot be: the owner's local id may already name
 * something of this user's, so a shared copy is filed under the project's `uid`
 * instead. Reconciling on `id` alone would then merge two unrelated projects.
 */
interface ProjectRef {
  localId: string;
  remoteId: string;
  uid?: string;
  /** The account that owns it -- also where its blobs live. */
  ownerId?: string;
  role: 'owner' | 'editor' | 'viewer';
}

/** Reconcile all local and cloud projects for the signed-in user. */
export async function syncAllProjects(
  userId: string,
  onProgress?: SyncProgress,
): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, healed: 0, failures: [] };
  if (!cloudBackendInstalled()) return result;

  const [localMeta, cloudMeta, roles] = await Promise.all([
    listSyncMeta(),
    cloudListMeta(),
    cloudMemberships(),
  ]);

  /**
   * A row with no owner comes from a database without the membership
   * migration, where everything visible is the signed-in user's own -- which is
   * what this assumed before any other kind of row existed. A shared row with
   * no membership entry should not be reachable at all, so the safe reading of
   * one is the least privileged.
   */
  const roleOf = (c: { uid?: string; ownerId?: string }): 'owner' | 'editor' | 'viewer' => {
    if (!c.ownerId || c.ownerId === userId) return 'owner';
    return (c.uid ? roles.get(c.uid) : undefined) ?? 'viewer';
  };

  // Two indexes, because there are two ways a local record is recognised. By
  // `uid` once it has one -- the only handle that means the same thing in two
  // accounts. By `id` otherwise, and then *only among this user's own rows*:
  // that is the migration path for records pushed before the column existed,
  // and confining it to their own projects is what stops a shared project that
  // happens to carry the same id from being mistaken for one of them.
  const byUid = new Map(cloudMeta.filter((c) => c.uid).map((c) => [c.uid!, c]));
  const mineById = new Map(
    cloudMeta.filter((c) => (c.ownerId ?? userId) === userId).map((c) => [c.id, c]),
  );

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

  const matched = new Set<(typeof cloudMeta)[number]>();

  for (const here of localMeta) {
    const there = (here.cloudUid ? byUid.get(here.cloudUid) : undefined) ?? mineById.get(here.id);
    if (there) matched.add(there);

    const ref: ProjectRef = {
      localId: here.id,
      remoteId: there?.id ?? here.id,
      ...(there?.uid ? { uid: there.uid } : {}),
      ...(there?.ownerId ? { ownerId: there.ownerId } : {}),
      role: there ? roleOf(there) : 'owner',
    };

    // Record what was just learned, so later passes match on `uid` instead of
    // falling back to the id -- and so a project pushed before the column
    // existed acquires its identity without a round trip of its own.
    if (there?.uid && there.uid !== here.cloudUid) {
      await linkCloudProject(here.id, {
        uid: there.uid,
        cloudId: there.id,
        ...(there.ownerId ? { ownerId: there.ownerId } : {}),
        role: ref.role,
      });
    }

    // Local only: a project made on this machine, or one the cloud has never
    // seen. Pushed as base 0, which asserts no such row exists.
    if (!there) {
      track(here.id, 'push', pushFallingBackToPull(userId, ref));
    } else if (here.baseVersion === there.version) {
      // Up to date with the cloud. Push only if this side actually changed --
      // and "changed" is the file hashes, so opening a project does not qualify
      // and the account is not written to for nothing.
      //
      // A viewer's copy is never pushed. Their edits are real and are kept, but
      // they are edits to somebody else's project: the write is refused, and
      // attempting it every pass would report a failure they can do nothing
      // about. It surfaces as a forked local copy the next time the cloud side
      // moves, which is where work that cannot go up belongs.
      if (here.diverged && ref.role !== 'viewer') {
        track(here.id, 'push', pushFallingBackToPull(userId, ref));
      }
    } else {
      // The cloud has moved since this copy last agreed with it. Pull;
      // `pullOne` forks the local copy aside if it also changed.
      track(here.id, 'pull', pullOne(userId, ref));
    }
  }

  // Cloud rows nothing local matched: a project from another device, or one
  // just shared with this user. Nothing here to weigh against them.
  for (const there of cloudMeta) {
    if (matched.has(there)) continue;
    const role = roleOf(there);
    // A shared project is filed under its `uid`, never under the id its owner's
    // browser gave it: that id may already name a project of this user's, and
    // importing over it would replace their work with somebody else's.
    const localId = role === 'owner' ? there.id : (there.uid ?? there.id);
    track(
      localId,
      'pull',
      pullOne(userId, {
        localId,
        remoteId: there.id,
        ...(there.uid ? { uid: there.uid } : {}),
        ...(there.ownerId ? { ownerId: there.ownerId } : {}),
        role,
      }),
    );
  }

  if (ops.length > 0) onProgress?.(0, ops.length);
  await Promise.all(ops);
  return result;
}

/**
 * Push, and if the cloud moved underneath us in the meantime, pull instead.
 *
 * The listing this pass planned from was read at the start of it, so by the
 * time a transfer runs another device may have committed. That is an ordinary
 * race, not a fault, and the resolution is the same one `pullOne` already
 * implements: take the cloud's copy, forking this side aside first if it too
 * has changed. Reporting it as a failed push would put a red banner in front of
 * the user for something the next line of code can settle correctly.
 */
async function pushFallingBackToPull(userId: string, ref: ProjectRef): Promise<Outcome> {
  try {
    return await pushOne(userId, ref.localId);
  } catch (e) {
    if (!(e instanceof StaleBaseError)) throw e;
    return pullOne(userId, ref);
  }
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
async function pushOne(userId: string, id: string, base?: number): Promise<Outcome> {
  // `id` is the *local* key throughout. Which cloud row this writes, and whose
  // account its blobs go to, comes from the record itself -- `exportManifest`
  // carries the project's `uid`, the row's own id and its owner -- so a shared
  // project is committed where it lives rather than copied into the pusher's
  // account. `cloudUpsert` refuses outright if the role is viewer.
  // A manifest, not the whole project: names, hashes and sizes, with the bytes
  // left in the store until a blob actually has to be uploaded. Encoding every
  // file to base64 to find out that none of them changed cost about 400 ms of
  // main thread on a 10 MB project, every time edits settled.
  const p = await exportManifest(id);
  if (!p) return 'pushed';
  // What the last landed push put in the store. Those blobs are still
  // referenced by the cloud row, so they need neither storing nor confirming
  // again, which is most of the cost of pushing a project that barely changed.
  //
  // `baseVersion` is the version this copy came from. Undefined means it has
  // never been in the cloud, which is stated as base 0: the commit lands only
  // if no such row exists, so a project another device already created under
  // this id is never silently overwritten.
  const { manifest, version } = await cloudUpsert(
    userId,
    p,
    await knownPushedHashes(id),
    // `base` overrides only where the caller knows the row it is replacing
    // better than the local record does — the repair path, which has just read
    // the damaged row and is deliberately overwriting it.
    base ?? p.baseVersion ?? 0,
  );
  // Only after the write lands: a project that has been pushed belongs to this
  // account, so the next person to sign in on this browser does not inherit it.
  await claimProject(id, userId);
  // The two sides agree as of this push (#367), and this is what it agrees on:
  // these blobs, at that version.
  await markSynced(
    id,
    manifest.map((m) => m.hash),
    version,
  );

  // A project's global identity is assigned by the server when the row is
  // created, so a push cannot know it and `commitProject` returns the version
  // rather than the uid. Without this, a project made and saved in one sitting
  // has no identity recorded until the next full reconcile — and everything
  // that names a project across accounts needs one, so Share would truthfully
  // but uselessly report that a project already sitting in the cloud cannot be
  // shared yet.
  //
  // One extra read, and only ever on the first push of a project: afterwards
  // the record has the uid and this is skipped.
  // A first commit is always the caller's own project -- the function refuses
  // to create a row inside another account, and says so -- so the owner is
  // known without asking anybody. Recorded because it is what addresses the
  // blobs, and the fallback that stands in for it is only right by coincidence.
  if (!p.cloudOwnerId) {
    await linkCloudProject(id, { ownerId: userId, role: 'owner' });
  }

  // Only for a record that predates minting its own identity. A project made by
  // this build already named itself at creation, so there is nothing to learn
  // and no extra round trip to pay for.
  if (!p.cloudUid) {
    try {
      const row = await cloudGetRow(p.cloudId ?? id);
      if (row?.uid) {
        await linkCloudProject(id, {
          uid: row.uid,
          cloudId: row.id,
          ...(row.user_id ? { ownerId: row.user_id } : {}),
          role: 'owner',
        });
      }
    } catch (e) {
      // Never fatal. The push landed; this is bookkeeping that the next
      // reconcile will do anyway.
      console.warn(`project identity not recorded for "${p.name}":`, e);
    }
  }
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
async function pullOne(userId: string, ref: ProjectRef): Promise<Outcome> {
  try {
    const p = await cloudGet(ref.remoteId, ref.uid);
    if (!p) return 'pulled';
    if (await hasDivergedLocally(ref.localId)) {
      await forkLocalCopy(ref.localId, localCopyName(p.name, new Date()));
    }
    // Filed under the local key, which for a shared project is not the id the
    // row carries -- `cloudGet` reports the row's identity and leaves the
    // filing decision here, because only this side knows what is already taken.
    await importProject({ ...p, id: ref.localId, cloudRole: ref.role });
    return 'pulled';
  } catch (e) {
    return await repairUnreadable(userId, ref, e);
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
async function repairUnreadable(userId: string, ref: ProjectRef, cause: unknown): Promise<Outcome> {
  const damage = await cloudMissingObjects(ref.remoteId, ref.uid); // throws on "could not ask"
  if (!damage || damage.missing === 0) throw cause; // readable copy, real failure

  // A project this user may only read is not theirs to rewrite. Every step
  // below ends in overwriting the cloud copy from a local one, which for a
  // viewer means replacing the owner's project with whatever is in this
  // browser -- and the write would be refused anyway, one blob upload later.
  if (ref.role === 'viewer') throw cause;

  // Everything below treats "absent" as fact — it overwrites the cloud copy,
  // and failing that, tells the user their project is gone. So the answer has
  // to be worth that: a listing under row-level security returns nothing at all
  // when the request is not authorised, and returns it *without an error*, so a
  // session that lapsed mid-pass reads exactly like an emptied bucket.
  //
  // That is not a hypothetical. It condemned a project with 138 intact versions
  // whose blobs were all present, and offered to delete it.
  await assertStoreAnswers(userId);

  // "Has contents" rather than "exists": a local copy whose files are all empty
  // is the same damage in the other direction, and promoting it over the remote
  // one would destroy the last thing a recovery could come from.
  const local = await exportProject(ref.localId);
  const usable = !!local && local.files.some((f) => (f.gzB64?.length ?? 0) > 0);
  if (!usable) {
    // Nothing on this machine to restore from, so the last place to look is the
    // project's own history. Blobs are only collected when no row references
    // them, so an older manifest's objects often outlive the row that replaced
    // it, and for a project damaged before the commit protocol existed that
    // version may be the only readable copy anywhere.
    const restored = await restoreFromHistory(userId, ref.remoteId, ref.uid);
    if (restored) {
      const p = await cloudGet(ref.remoteId, ref.uid);
      if (p) await importProject({ ...p, id: ref.localId, cloudRole: ref.role });
      return 'healed';
    }
    throw new UnrecoverableProject(
      ref.localId,
      `the cloud copy of "${damage.name || local?.name || ref.localId}" cannot be recovered: ` +
        `${damage.missing} of ${damage.total} files are missing from storage, ` +
        `there is no copy on this device, and no earlier version is intact`,
    );
  }

  // Over the damaged row, at the version it is actually at. The local record's
  // own base is stale or absent here by definition — that is what being
  // unreadable means — and stating 0 would claim the project is new and be
  // refused for the very row this is repairing.
  await pushOne(userId, ref.localId, damage.version);
  return 'healed';
}

/**
 * Mirror a single saved project up to the cloud. Throws if it did not land.
 *
 * A stale base is the one failure that is not a failure: another tab or machine
 * committed while this one was editing. Retrying the same write would either
 * fail again or, under the old protocol, silently destroy their work — so the
 * answer is to reconcile this one project, which pulls and forks the local copy
 * aside if it too has changed. Nothing is lost either way.
 */
export async function pushProject(userId: string, id: string): Promise<void> {
  if (!cloudBackendInstalled()) return;
  try {
    await pushOne(userId, id);
  } catch (e) {
    if (!(e instanceof StaleBaseError)) throw e;
    // Read back from the record rather than assuming the local id names the
    // row: for a shared project it does not, and pulling by it would fetch
    // whatever else happens to carry that id -- or nothing.
    const p = await exportManifest(id);
    await pullOne(userId, {
      localId: id,
      remoteId: p?.cloudId ?? id,
      ...(p?.cloudUid ? { uid: p.cloudUid } : {}),
      ...(p?.cloudOwnerId ? { ownerId: p.cloudOwnerId } : {}),
      role: p?.cloudRole ?? 'owner',
    });
  }
}

/**
 * Mirror a delete up to the cloud.
 *
 * The identity is resolved from the account's own listing rather than from the
 * local record, because the record is normally gone by the time this runs. A
 * shared project is filed locally under its `uid`, so that is the first thing
 * to look for; an owned one is filed under the row's id.
 *
 * `cloudDelete` decides what a delete *means*: the owner destroys the project,
 * anyone else gives up their membership.
 */
export async function deleteCloudProject(id: string, userId?: string): Promise<void> {
  if (!cloudBackendInstalled()) return;
  const meta = await cloudListMeta();
  const hit =
    meta.find((m) => m.uid === id) ??
    meta.find((m) => m.id === id && (m.ownerId ?? userId) === userId);
  if (!hit) return;
  await cloudDelete(hit.id, {
    ...(hit.uid ? { uid: hit.uid } : {}),
    ...(userId ? { signedInUser: userId } : {}),
  });
}

/**
 * Drop a row the sync pass reported as unrecoverable, and *only* the row.
 *
 * The blobs it names are supposed to be missing already, so there is nothing to
 * reclaim by collecting them — and if the report was wrong, collecting them is
 * what would turn a false alarm into the real thing.
 */
export async function forgetDamagedProject(id: string): Promise<void> {
  if (!cloudBackendInstalled()) return;
  await cloudDelete(id, { keepBlobs: true });
}
