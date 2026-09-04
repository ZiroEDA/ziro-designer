// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The cloud half of project persistence, as a commit protocol.
 *
 * ### What went wrong before
 *
 * A push used to upload each blob to a mutable path, ignore whether any of
 * those uploads succeeded, and then rewrite the row to list file *names* only —
 * discarding the inline copies that were, at that moment, the only ones left.
 * A pull turned a failed download into `gzB64: ''` and wrote the resulting
 * empty record over the local one, which the sync layer then marked as agreed.
 * Eleven of fourteen projects in one browser were reduced to a list of file
 * names with no contents, and nothing anywhere reported an error.
 *
 * ### The protocol now
 *
 * Two rules, both borrowed from systems that do not lose data:
 *
 * **Content-addressed storage.** Blobs are keyed by the hash of their bytes
 * (`blobStore.ts`), so a write can only add and a read can be verified.
 *
 * **The commit is last, and it is the only mutation.** Every blob is stored and
 * then *confirmed present* before the row is written. Until that row lands, the
 * previous version is entirely intact; if anything fails, it stays that way and
 * the error propagates. A row can therefore never reference a blob that is not
 * in the store — the invariant the old design had no way to state, let alone
 * hold.
 *
 * Everything here runs against the {@link CloudBackend} interface, so the
 * failure paths are reachable from tests. They were not before, which is the
 * real reason the bugs survived.
 */

import type { CloudBackend, ManifestEntry, ProjectRow, RowFile } from './backend.js';
import { isInlineFile, isManifestEntry } from './backend.js';
import {
  blobExists,
  blobPath,
  flatBlobPath,
  getBlob,
  legacyPath,
  putBlob,
  sha256Hex,
} from './blobStore.js';
import type { SyncableProject } from '../home/projectStore.js';
import { syncUserTemplates, type TemplateSyncResult } from './templateSync.js';

let backend: CloudBackend | null = null;

/**
 * Install the transport. The app installs the Supabase one at startup; tests
 * install a fake that can fail.
 *
 * Deliberately explicit rather than a module-level import of the Supabase
 * client: that import is what made this file unreachable from the test package
 * (it pulls in `import.meta.env`), and unreachable from tests is where the
 * damage came from.
 */
export function setCloudBackend(next: CloudBackend | null): void {
  backend = next;
}

export const cloudBackendInstalled = (): boolean => backend !== null;

function need(): CloudBackend {
  if (!backend) throw new Error('cloud: no backend installed');
  return backend;
}

/**
 * The installed transport, or null.
 *
 * Exposed so `settingsSync.ts` can work against the same seam rather than
 * standing up a second registry of its own. Settings and projects reach the
 * account through one Supabase client, one `setCloudBackend`, and one place
 * where `{ data, error }` is translated; a parallel install seam would mean two
 * of each, and the reason there is only one is the reason `supabaseBackend.ts`
 * is short enough to audit at a glance.
 */
export const cloudBackend = (): CloudBackend | null => backend;

/**
 * Reconcile the user's templates with the account.
 *
 * Here rather than in `templateSync.ts` because the installed transport is
 * private to this module, the same reason `cloudUpsert` and friends live here
 * and not beside their callers. A no-op with no backend, so signing in to a
 * deployment without cloud configured does nothing rather than throwing.
 */
export async function syncTemplates(userId: string): Promise<TemplateSyncResult> {
  if (!backend) return { pushed: 0, pulled: 0 };
  return syncUserTemplates(backend, userId);
}

const b64ToBytes = (b64: string): Uint8Array => {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
};

const bytesToB64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * id + current version for every cloud project of the signed-in user.
 *
 * Was id + `updated_at`, which is what made reconciliation a comparison between
 * two browsers' clocks. A version is assigned by one authority and is ordered by
 * construction, so "has the cloud moved since I last agreed with it" is a fact
 * rather than an inference.
 */
export async function cloudListMeta(): Promise<
  { id: string; version: number; uid?: string; ownerId?: string }[]
> {
  const rows = await need().listProjects();
  return rows.map((r) => ({
    id: r.id,
    version: Number(r.version ?? 1),
    // Both absent on a database without the membership migration, where every
    // visible row is the signed-in user's own -- which is what the caller
    // assumes when they are missing.
    ...(r.uid ? { uid: r.uid } : {}),
    ...(r.user_id ? { ownerId: r.user_id } : {}),
  }));
}

/**
 * The signed-in user's role on every project shared with them, by `uid`.
 *
 * Empty when the backend cannot say -- a deployment without the membership
 * migration, where nothing is shared with anybody. Absent from the map means
 * "not a shared project", which is the same as "mine".
 */
export async function cloudMemberships(): Promise<Map<string, 'owner' | 'editor' | 'viewer'>> {
  const be = need();
  if (!be.listMemberships) return new Map();
  const rows = await be.listMemberships();
  const out = new Map<string, 'owner' | 'editor' | 'viewer'>();
  for (const r of rows) {
    if (r.role === 'owner' || r.role === 'editor' || r.role === 'viewer') {
      out.set(r.project_uid, r.role);
    }
  }
  return out;
}

/**
 * A commit refused because the row is no longer at the version the caller was
 * editing. Someone else — another tab, another machine — landed a write first.
 *
 * A distinct type because it is the one push failure that is not a failure: the
 * answer is to pull, reconcile and try again, never to retry the same write.
 */
export class StaleBaseError extends Error {
  constructor(readonly id: string) {
    super(`project ${id}: the cloud copy has moved on since this one last agreed with it`);
    this.name = 'StaleBaseError';
  }
}

/**
 * Read the files of a row, whichever of the three shapes it is in.
 *
 * Legacy rows are still out there and still readable; only writing has changed.
 * The one behavioural difference is that a blob which cannot be fetched is now
 * an error in every shape. Returning an empty file for it is what turned a
 * transient storage failure into permanent loss.
 */
async function readFiles(
  be: CloudBackend,
  row: ProjectRow,
  userId: string,
): Promise<{ name: string; gzB64: string }[]> {
  const files: RowFile[] = row.files ?? [];
  if (files.length === 0) return [];

  // Current shape: content-addressed, and verified on arrival.
  if (isManifestEntry(files[0]!)) {
    if (!userId) throw new Error(`project ${row.id}: row has no user_id, cannot address its blobs`);
    return Promise.all(
      (files as ManifestEntry[]).map(async (f) => ({
        name: f.name,
        gzB64: bytesToB64(await getBlob(be, userId, f.hash)),
      })),
    );
  }

  // Legacy shape: blobs base64-encoded in the row itself.
  if (isInlineFile(files[0]!)) {
    return files.map((f) => ({ name: f.name, gzB64: (f as { gzB64: string }).gzB64 }));
  }

  // Legacy shape: names only, blobs at a path built from the project id.
  if (!userId) throw new Error(`project ${row.id}: row has no user_id, cannot address its blobs`);
  return Promise.all(
    files.map(async (f) => ({
      name: f.name,
      gzB64: bytesToB64(await be.getObject(legacyPath(userId, row.id, f.name))),
    })),
  );
}

/**
 * Fetch a single cloud project with its file bodies, or null if absent.
 *
 * `id` here is the row's own id, and `uid` -- when the caller knows it -- is
 * what actually addresses the row; see `CloudBackend.getProject`. The returned
 * `id` is the row's, not a local key: a caller filing this away has to decide
 * that for itself, because a project shared with this user may collide with one
 * of their own.
 *
 * Blobs are read from `row.user_id`, the project's *owner*, which is already
 * what this did and is exactly right for a shared project: the bytes live in
 * the owner's space and are readable from there by anyone on the project.
 */
export async function cloudGet(id: string, uid?: string): Promise<SyncableProject | null> {
  const be = need();
  const row = await be.getProject(id, uid);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    ...(row.uid ? { cloudUid: row.uid } : {}),
    cloudId: row.id,
    ...(row.user_id ? { cloudOwnerId: row.user_id } : {}),
    // What a pull agrees with, and what its next push must name as its base.
    // A legacy row written before the column existed reads as 1, which is what
    // the migration defaulted it to.
    baseVersion: Number(row.version ?? 1),
    files: await readFiles(be, row, row.user_id ?? ''),
  };
}

/**
 * How much of a cloud copy is not actually in the object store.
 *
 * A row can outlive its objects. Rows written before the commit protocol
 * existed named files at a mutable `<user>/<project>/<file>.gz` path and were
 * rewritten without those objects ever landing, so they reference bytes nobody
 * has: every download of them fails with "Object not found", forever, on every
 * sync. Nothing writes rows like that any more (see `cloudUpsert`), but the ones
 * already out there are stuck, and a stuck project reports the same error every
 * time the app starts.
 *
 * Answering "is this copy readable at all" needs a different question from
 * "download it". `hasObject` throws when it cannot ask, and that distinction is
 * the whole safety of this function: an object that is **definitely absent** is
 * damage worth repairing, while a network or auth failure is not, and treating
 * the second as the first would overwrite a good cloud copy from a stale local
 * one. Anything that fails to answer propagates instead of counting as missing.
 *
 * Returns null when there is no such row.
 */
export async function cloudMissingObjects(
  id: string,
  uid?: string,
): Promise<{ name: string; missing: number; total: number; version: number } | null> {
  const be = need();
  const row = await be.getProject(id, uid);
  if (!row) return null;

  const files: RowFile[] = row.files ?? [];
  const userId = row.user_id ?? '';
  // An inline row carries its bytes in the row itself, so it has no objects to
  // be missing; without a user id nothing can be addressed to check.
  if (files.length === 0 || !userId || isInlineFile(files[0]!)) {
    return { name: row.name, missing: 0, total: files.length, version: Number(row.version ?? 1) };
  }

  // Manifest rows address blobs by hash, which may be stored under either
  // layout; the older shapes address a path built from the project id. A blob
  // reported missing merely because it predates the sharded layout would be a
  // loss this app then "repairs" by overwriting the cloud, so both are checked.
  const present = isManifestEntry(files[0]!)
    ? await Promise.all((files as ManifestEntry[]).map((f) => blobExists(be, userId, f.hash)))
    : await Promise.all(files.map((f) => be.hasObject(legacyPath(userId, row.id, f.name))));
  // The row's own name, so a report can say which project rather than which
  // key — and its version, which a repair has to name as the thing it replaces.
  return {
    name: row.name,
    missing: present.filter((ok) => !ok).length,
    total: present.length,
    version: Number(row.version ?? 1),
  };
}

/**
 * Prove the object store is answering truthfully before anything acts on a
 * "missing" answer.
 *
 * A listing under row-level security returns *rows you are allowed to see*, and
 * a request with no valid session is allowed to see none — with no error. So
 * "the store says absent" and "the store cannot see anything" arrive here as
 * the same value, and the second one, read as the first, says every blob of
 * every project is gone: which is what happened, on an account whose data was
 * entirely intact, with 138 versions of the project it condemned.
 *
 * The control is a fixed, tiny object of our own. Writing it is idempotent
 * (content-addressed, same bytes, same key) and reading it back must say
 * present. If it does not, the answer "absent" carries no information at all
 * and every caller must refuse to act on one.
 *
 * Throws rather than returning false: a caller that cannot ask must not
 * continue down a path whose whole premise is a reliable answer.
 */
const PROBE_BYTES = new TextEncoder().encode('ziro-store-probe-v1');

export async function assertStoreAnswers(userId: string): Promise<void> {
  const be = need();
  const hash = await sha256Hex(PROBE_BYTES);
  const path = blobPath(userId, hash);
  // Written every time: the probe is what proves writes land *and* are visible,
  // and it is one small idempotent object per account.
  await be.putObject(path, PROBE_BYTES);
  if (!(await be.hasObject(path))) {
    throw new Error(
      'the object store is not answering reliably (a blob just written reads as absent), ' +
        'so nothing can be concluded about what is or is not stored',
    );
  }
}

/**
 * Roll a project back to the newest committed version whose blobs are all still
 * in the store.
 *
 * This is what history was kept for. When the current row references objects
 * that are gone, an earlier manifest often does not: blobs are content-addressed
 * and are only collected when no row references them, so the objects of a
 * version that was replaced routinely outlive it. Walking back until every hash
 * of a version is present recovers the most recent state that can actually be
 * read, which for a project damaged before the commit protocol existed may be
 * the only copy left anywhere.
 *
 * Writes the recovered manifest as the current row, so every client sees the
 * same thing afterwards, and returns what it restored. Null when there is no
 * history, no version is intact, or the database has no history table.
 *
 * Only ever moves a project from unreadable to readable. A row whose blobs are
 * all present is not touched: the caller checks that first, and passing one here
 * would replace a working copy with an older working copy.
 */
export async function restoreFromHistory(
  userId: string,
  id: string,
  uid?: string,
): Promise<{ name: string; committedAt: string; files: number } | null> {
  const be = need();
  if (!be.listVersions) return null;
  const versions = await be.listVersions(userId, id, uid);

  for (const version of versions) {
    const entries = (version.files ?? []).filter(isManifestEntry);
    // Older shapes name no blobs to check, so nothing can be proven about them.
    if (entries.length === 0 || entries.length !== (version.files ?? []).length) continue;

    // Both layouts. The projects this exists to rescue are the oldest ones in
    // the account, so their surviving blobs are the most likely to be sitting
    // at the pre-split path; asking only about the new one would find nothing
    // and declare exactly those unrecoverable.
    const present = await Promise.all(entries.map((f) => blobExists(be, userId, f.hash)));
    if (!present.every(Boolean)) continue;

    const row = await be.getProject(id, uid);
    // Over whatever the row is at now, read a moment ago. A repair is still a
    // write and still has to state what it replaces: two tabs both discovering
    // the same damage would otherwise both "fix" it and one would lose.
    const landed = await be.commitProject(
      {
        id: row?.id ?? id,
        ...(row?.uid ? { uid: row.uid } : uid ? { uid } : {}),
        // The owner, so the repaired row keeps belonging to whoever it belonged
        // to. A repair is not a transfer.
        user_id: row?.user_id ?? userId,
        name: version.name || row?.name || 'Recovered project',
        created_at: row?.created_at ?? version.committed_at,
        updated_at: new Date().toISOString(),
        files: entries,
      },
      // A row that is there but carries no version is at 1 — what the migration
      // defaulted every existing row to. Only the absence of the row itself is
      // base 0, and conflating the two makes the repair claim the project is new
      // and be refused for the row it is trying to fix.
      row ? Number(row.version ?? 1) : 0,
    );
    if (landed === null) throw new StaleBaseError(id);
    return { name: version.name, committedAt: version.committed_at, files: entries.length };
  }
  return null;
}

/**
 * Every file of this project is a zero-length blob.
 *
 * gzip of even an empty file is around twenty bytes, so this is not a project
 * of empty files: it is the signature of a record that has already been
 * damaged. Pushing it would copy the damage to the one place a recovery could
 * have come from, so the push refuses and says why. The matching guard on the
 * receiving side lives in `importProject`.
 */
const isHollow = (files: { gzB64?: string; size?: number }[]): boolean =>
  files.length > 0 && files.every((f) => (f.size ?? f.gzB64?.length ?? 0) === 0);

/** A manifest carries no bytes; this is how it gets them when one is needed. */
async function needBytes(p: SyncableProject, name: string): Promise<Uint8Array> {
  if (!p.bytesOf)
    throw new Error(`project ${p.id}: no bytes for "${name}" and no way to read them`);
  return p.bytesOf(name);
}

/**
 * Commit a project: store every blob, confirm every blob, then write the row.
 * Returns the manifest it committed.
 *
 * The ordering is the whole point. Uploading is additive and safe to retry;
 * writing the row is the single moment the project's contents change, and it
 * happens only once there is nothing left that can fail.
 */
export async function cloudUpsert(
  userId: string,
  p: SyncableProject,
  knownPresent: ReadonlySet<string> = new Set(),
  base = 0,
): Promise<{ manifest: ManifestEntry[]; version: number }> {
  const be = need();

  if (p.cloudRole === 'viewer') {
    throw new Error(`refusing to push "${p.name}": this project is shared read-only`);
  }

  // Blobs live under the project's *owner*, not whoever is writing. An editor
  // uploading into their own space would put the bytes where the owner cannot
  // read them, and commit a row naming objects that, for everyone else on the
  // project, are not there.
  const owner = p.cloudOwnerId ?? userId;

  if (isHollow(p.files)) {
    throw new Error(
      `refusing to push "${p.name}": all ${p.files.length} files are empty, which means the local copy is damaged`,
    );
  }

  // 1. Work out what this project is made of, without reading it.
  //
  //    The hash and the size come from the local store, where they were
  //    computed when the bytes were written. Materialising every file to find
  //    that out is what made a save expensive: a 10 MB project became a 13 MB
  //    base64 string and about 400 ms of main-thread work, on every push, even
  //    when nothing needed uploading. Bytes are fetched below, for the files
  //    that actually have to be stored.
  const bytesFor = async (f: { name: string; gzB64?: string }): Promise<Uint8Array> =>
    f.gzB64 !== undefined ? b64ToBytes(f.gzB64) : await needBytes(p, f.name);

  const manifest: ManifestEntry[] = await Promise.all(
    p.files.map(async (f) => {
      if (f.hash !== undefined && f.size !== undefined) {
        return { name: f.name, hash: f.hash, size: f.size };
      }
      const bytes = await bytesFor(f);
      return { name: f.name, hash: f.hash ?? (await sha256Hex(bytes)), size: bytes.length };
    }),
  );

  // 2. Store, and confirm, only the blobs not already known to be there.
  //
  //    `knownPresent` is the manifest of this project's last landed push, so
  //    every hash in it is referenced by the row currently in the cloud and
  //    cannot have been collected. Re-asking about them was two round trips per
  //    file, on every sync, for files that had not changed: a 107-file project
  //    spent 214 requests to push nothing.
  //
  //    Everything else goes through the original path. `putBlob` skips the
  //    upload when the object is there, and the confirm below catches the rarer
  //    case of a write that reports success and does not land, which is exactly
  //    the class of failure that started all this.
  const fresh = manifest.filter((m) => !knownPresent.has(m.hash));
  await Promise.all(
    fresh.map(async (m) => {
      const src = p.files.find((f) => f.name === m.name)!;
      return putBlob(be, owner, await bytesFor(src));
    }),
  );

  const missing = (
    await Promise.all(
      fresh.map(async (m) => ((await be.hasObject(blobPath(owner, m.hash))) ? null : m.name)),
    )
  ).filter((n): n is string => n !== null);
  if (missing.length > 0) {
    throw new Error(
      `refusing to commit "${p.name}": ${missing.length} of ${manifest.length} blobs are not in the store (${missing.slice(0, 3).join(', ')})`,
    );
  }

  // 3. Commit, but only over the version this copy was derived from.
  //
  //    The blob work above is additive and safe to repeat; this is the single
  //    moment the project's contents change, and it now also asserts *what it
  //    is replacing*. A base that no longer matches means another device landed
  //    a write while this one was uploading, and overwriting it is precisely the
  //    data loss the version column exists to make impossible.
  const row: ProjectRow & { user_id: string } = {
    // The row's own id, which for a shared project is the owner's and not the
    // key this copy is filed under locally.
    id: p.cloudId ?? p.id,
    ...(p.cloudUid ? { uid: p.cloudUid } : {}),
    user_id: owner,
    name: p.name,
    created_at: new Date(p.createdAt).toISOString(),
    // Sent for the row shape's sake; the server stamps its own and nothing
    // reads this to decide anything.
    updated_at: new Date(p.updatedAt).toISOString(),
    files: manifest,
  };
  const version = await be.commitProject(row, base);
  if (version === null) throw new StaleBaseError(p.id);

  // 4. Record the committed manifest. Additive history: the blobs it names are
  //    never deleted while it exists, so any past version can be restored.
  //
  //    Never fatal. The commit above has already landed, so reporting a failure
  //    here would tell the sync layer the push did not happen and leave the two
  //    sides marked as disagreeing when they agree. A database without the
  //    `manifest.sql` migration simply has no history.
  try {
    // `userId`, not `owner`: a version row records who committed it. The
    // project it belongs to is named by `row.uid`.
    await be.recordVersion?.(userId, { ...row, version });
  } catch (e) {
    console.warn(`project history not recorded for "${p.name}":`, e);
  }

  // What was committed, including hashes computed here for files stored before
  // they carried one, and the version it landed as. The caller records both:
  // the hashes as known-present (deriving them from its own copy instead would
  // miss exactly those files and leave them re-checked on every sync forever),
  // and the version as the base its next push must name.
  return { manifest, version };
}

/**
 * Delete a project, and the blobs no other project of this user still needs.
 *
 * Reference-counted rather than "delete this project's folder", because blobs
 * are shared: two projects containing the same footprint library share one
 * object, and a save-as shares nearly all of them. Deleting by project would
 * quietly empty its sibling.
 *
 * Conservative on failure. If the set of still-referenced hashes cannot be
 * established the row is removed and the blobs are left behind: orphaned
 * objects cost storage, and this is the only code path in the module that can
 * destroy anything.
 */
export async function cloudDelete(
  id: string,
  opts: { keepBlobs?: boolean; uid?: string; signedInUser?: string } = {},
): Promise<void> {
  const be = need();
  const row = await be.getProject(id, opts.uid);
  if (!row) return;
  const userId = row.user_id ?? '';

  // Removing a shared project from your own list is not deleting the project.
  // Row-level security would refuse the delete anyway, silently and as a no-op,
  // which is the worst of the three outcomes: the user is told nothing and the
  // project stays. Giving up the membership is what they actually asked for.
  if (opts.signedInUser && userId && userId !== opts.signedInUser) {
    if (row.uid) await be.leaveProject?.(row.uid);
    return;
  }

  const doomed = (row.files ?? []).filter(isManifestEntry).map((f) => f.hash);

  await be.deleteProject(id);

  // `keepBlobs` is for removing a row that is *believed* damaged. Its blobs are
  // supposed to be gone already, so there is nothing to reclaim, and if the
  // belief was ever wrong this is the one step that would make it true.
  if (opts.keepBlobs || !userId || doomed.length === 0) return;
  let stillUsed: Set<string>;
  try {
    // Only this owner's projects. The listing now also returns projects shared
    // with the signed-in user, whose blobs live in a different account entirely
    // -- counting them as "still used" is harmless, but reading them is a round
    // trip per project for an answer that cannot apply.
    const others = (await be.listProjects()).filter(
      (o) => (o.user_id ?? userId) === userId && o.id !== id,
    );
    const rows = await Promise.all(others.map((o) => be.getProject(o.id, o.uid)));
    stillUsed = new Set(
      rows.flatMap((r) => (r?.files ?? []).filter(isManifestEntry).map((f) => f.hash)),
    );
    // Past versions reference blobs too, and that is the entire point of them:
    // `restoreFromHistory` walks back to a manifest whose objects are still
    // there. Counting only current rows collected exactly the objects that make
    // a recovery possible — so deleting one project quietly took the history of
    // every other one with it, and nobody would find out until the day it was
    // needed.
    if (be.listVersions) {
      const histories = await Promise.all(
        others.map((o) => be.listVersions!(userId, o.id, o.uid).catch(() => [])),
      );
      for (const versions of histories) {
        for (const v of versions) {
          for (const f of (v.files ?? []).filter(isManifestEntry)) stillUsed.add(f.hash);
        }
      }
    }
  } catch {
    return; // Cannot prove they are unreferenced, so leave them.
  }
  const orphans = [...new Set(doomed)].filter((h) => !stillUsed.has(h));
  // Both layouts: an orphan may still be sitting at the pre-split path, and
  // removing a key that is not there is not an error.
  if (orphans.length > 0) {
    await be.removeObjects([
      ...orphans.map((h) => blobPath(userId, h)),
      ...orphans.map((h) => flatBlobPath(userId, h)),
    ]);
  }
}
