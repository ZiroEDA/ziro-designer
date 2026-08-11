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
import { blobPath, getBlob, legacyPath, putBlob, sha256Hex } from './blobStore.js';
import type { SyncableProject } from '../home/projectStore.js';

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

/** id + updatedAt for every cloud project of the signed-in user. */
export async function cloudListMeta(): Promise<{ id: string; updatedAt: number }[]> {
  const rows = await need().listProjects();
  return rows.map((r) => ({ id: r.id, updatedAt: new Date(r.updated_at).getTime() }));
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

/** Fetch a single cloud project with its file bodies, or null if absent. */
export async function cloudGet(id: string): Promise<SyncableProject | null> {
  const be = need();
  const row = await be.getProject(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
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
): Promise<{ name: string; missing: number; total: number } | null> {
  const be = need();
  const row = await be.getProject(id);
  if (!row) return null;

  const files: RowFile[] = row.files ?? [];
  const userId = row.user_id ?? '';
  // An inline row carries its bytes in the row itself, so it has no objects to
  // be missing; without a user id nothing can be addressed to check.
  if (files.length === 0 || !userId || isInlineFile(files[0]!)) {
    return { name: row.name, missing: 0, total: files.length };
  }

  const paths = isManifestEntry(files[0]!)
    ? (files as ManifestEntry[]).map((f) => blobPath(userId, f.hash))
    : files.map((f) => legacyPath(userId, row.id, f.name));
  const present = await Promise.all(paths.map((p) => be.hasObject(p)));
  // The row's own name, so a report can say which project rather than which key.
  return { name: row.name, missing: present.filter((ok) => !ok).length, total: paths.length };
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
const isHollow = (files: { gzB64: string }[]): boolean =>
  files.length > 0 && files.every((f) => f.gzB64.length === 0);

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
): Promise<ManifestEntry[]> {
  const be = need();

  if (isHollow(p.files)) {
    throw new Error(
      `refusing to push "${p.name}": all ${p.files.length} files are empty, which means the local copy is damaged`,
    );
  }

  // 1. Work out what this project is made of. The hash comes from the store
  //    where it was computed when the bytes were written; only a file older
  //    than that field is hashed here.
  const files = await Promise.all(
    p.files.map(async (f) => {
      const bytes = b64ToBytes(f.gzB64);
      return { name: f.name, bytes, hash: f.hash ?? (await sha256Hex(bytes)) };
    }),
  );
  const manifest: ManifestEntry[] = files.map((f) => ({
    name: f.name,
    hash: f.hash,
    size: f.bytes.length,
  }));

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
  const fresh = files.filter((f) => !knownPresent.has(f.hash));
  await Promise.all(fresh.map((f) => putBlob(be, userId, f.bytes)));

  const missing = (
    await Promise.all(
      fresh.map(async (f) => ((await be.hasObject(blobPath(userId, f.hash))) ? null : f.name)),
    )
  ).filter((n): n is string => n !== null);
  if (missing.length > 0) {
    throw new Error(
      `refusing to commit "${p.name}": ${missing.length} of ${manifest.length} blobs are not in the store (${missing.slice(0, 3).join(', ')})`,
    );
  }

  // 3. Commit. Everything the row names is now known to exist.
  const row: ProjectRow & { user_id: string } = {
    id: p.id,
    user_id: userId,
    name: p.name,
    created_at: new Date(p.createdAt).toISOString(),
    updated_at: new Date(p.updatedAt).toISOString(),
    files: manifest,
  };
  await be.putProject(row);

  // 4. Record the committed manifest. Additive history: the blobs it names are
  //    never deleted while it exists, so any past version can be restored.
  //
  //    Never fatal. The commit above has already landed, so reporting a failure
  //    here would tell the sync layer the push did not happen and leave the two
  //    sides marked as disagreeing when they agree. A database without the
  //    `manifest.sql` migration simply has no history.
  try {
    await be.recordVersion?.(userId, row);
  } catch (e) {
    console.warn(`project history not recorded for "${p.name}":`, e);
  }

  // What was committed, including hashes computed here for files stored before
  // they carried one. The caller records these as known-present; deriving them
  // from its own copy instead would miss exactly those files and leave them
  // re-checked on every sync forever.
  return manifest;
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
export async function cloudDelete(id: string): Promise<void> {
  const be = need();
  const row = await be.getProject(id);
  if (!row) return;
  const userId = row.user_id ?? '';
  const doomed = (row.files ?? []).filter(isManifestEntry).map((f) => f.hash);

  await be.deleteProject(id);

  if (!userId || doomed.length === 0) return;
  let stillUsed: Set<string>;
  try {
    const others = await be.listProjects();
    const rows = await Promise.all(
      others.filter((o) => o.id !== id).map((o) => be.getProject(o.id)),
    );
    stillUsed = new Set(
      rows.flatMap((r) => (r?.files ?? []).filter(isManifestEntry).map((f) => f.hash)),
    );
  } catch {
    return; // Cannot prove they are unreferenced, so leave them.
  }
  const orphans = [...new Set(doomed)].filter((h) => !stillUsed.has(h));
  if (orphans.length > 0) await be.removeObjects(orphans.map((h) => blobPath(userId, h)));
}
