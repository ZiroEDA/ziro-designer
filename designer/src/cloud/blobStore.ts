// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Content-addressed blob storage: the property that makes losing data hard.
 *
 * A blob's key is the SHA-256 of its bytes. Three things follow, and together
 * they are most of what a professional sync layer is:
 *
 *  1. **Writes cannot destroy.** Two different contents cannot collide on one
 *     key, so an upload can only ever *add*. The previous design keyed blobs by
 *     `<project>/<filename>`, a mutable location: re-saving a file overwrote
 *     the only copy, and a re-save that silently produced nothing overwrote it
 *     with nothing.
 *  2. **Reads are verifiable.** The key states what the bytes must hash to, so
 *     a truncated or substituted download is detectable rather than a plausible
 *     corrupt file handed to the parser. `getBlob` checks every time.
 *  3. **History is nearly free.** Old blobs are still there under their own
 *     keys after a new version is committed, so keeping a list of past
 *     manifests is enough to restore any earlier state. That is what
 *     `project_versions` is for, and it is why this incident would have been a
 *     restore rather than a loss.
 *
 * This is git's object store, and Dropbox's block store, for the same reasons.
 *
 * Blobs are namespaced per user rather than globally. Cross-user deduplication
 * would be cheaper, but "does this hash already exist" then answers questions
 * about other people's files, and the storage saved is not worth an existence
 * oracle over private designs.
 */

import type { CloudBackend } from './backend.js';

/** Hex SHA-256 of the given bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Where a blob lives.
 *
 * The user id must be the first path segment: the Storage row-level security
 * policy is `auth.uid() = (storage.foldername(name))[1]`, so any other layout
 * is refused for every object. `blobs/` separates these from the legacy
 * `<userId>/<projectId>/<file>.gz` objects, which are left exactly where they
 * are — they may be the only remaining copy of something.
 */
export const blobPath = (userId: string, hash: string): string => `${userId}/blobs/${hash}`;

/** The legacy, mutable path. Read-only now; nothing writes here any more. */
export const legacyPath = (userId: string, projectId: string, name: string): string =>
  `${userId}/${projectId}/${encodeURIComponent(name)}.gz`;

/**
 * Store `bytes` and return their hash, skipping the upload when the blob is
 * already there.
 *
 * The existence check is not only an optimisation: it is also the thing that
 * makes a re-push of an unchanged project write nothing at all, so a project
 * that is synced daily accumulates no new objects and no new risk.
 */
export async function putBlob(
  backend: CloudBackend,
  userId: string,
  bytes: Uint8Array,
): Promise<string> {
  const hash = await sha256Hex(bytes);
  const path = blobPath(userId, hash);
  if (await backend.hasObject(path)) return hash;
  await backend.putObject(path, bytes);
  return hash;
}

/**
 * Read a blob and check it against the hash that named it.
 *
 * A mismatch means the object at that key is not what the manifest committed —
 * truncation, a partial upload, a rewritten object — and the only safe answer
 * is to fail. Handing back bytes that hash differently would put a corrupt
 * board in front of the user with no indication anything was wrong, which is
 * the failure mode this whole module exists to remove.
 */
export async function getBlob(
  backend: CloudBackend,
  userId: string,
  hash: string,
): Promise<Uint8Array> {
  const bytes = await backend.getObject(blobPath(userId, hash));
  const actual = await sha256Hex(bytes);
  if (actual !== hash) {
    throw new Error(
      `blob ${hash.slice(0, 12)}… is corrupt: ${bytes.length} bytes hashing to ${actual.slice(0, 12)}…`,
    );
  }
  return bytes;
}
