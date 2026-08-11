// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Supabase implementation of {@link CloudBackend}.
 *
 * This is the **only** file that knows Supabase's `{ data, error }` convention,
 * and its whole job is to turn it into "resolve or reject". That convention is
 * what cost us eleven projects: `storage.upload()` and `storage.download()`
 * report failure in a returned field, an `await` on them succeeds either way,
 * and the caller that forgets to read `error` cannot tell a stored file from a
 * lost one. Confining the translation to one short file means there is exactly
 * one place to get it right, and it is small enough to audit at a glance.
 *
 * Nothing here contains sync logic. Everything above it works against the
 * interface, so it can be tested against a backend that fails on demand.
 */

import { supabase } from '../auth/supabaseClient.js';
import type { CloudBackend, ProjectRow, RowFile } from './backend.js';

/**
 * Bucket for file blobs. Without it there is no object store to address, and
 * `cloudStore` stays on the inline row shape.
 */
export const BUCKET: string =
  (import.meta.env.VITE_SUPABASE_STORAGE_BUCKET as string | undefined) || '';

/** A Supabase `{ data, error }` result, unwrapped or thrown. */
function unwrap<T>(r: { data: T; error: { message?: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message ?? String(r.error)}`);
  return r.data;
}

/**
 * True when an upload failed only because the object is already there.
 *
 * Not an error for us: paths are content hashes, so an existing object at the
 * path already holds exactly the bytes we were about to write.
 */
function isAlreadyExists(error: { message?: string; statusCode?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return error.statusCode === '409' || msg.includes('already exists') || msg.includes('duplicate');
}

/** So a database without the history migration says so once, not every save. */
let warnedNoHistory = false;

export function supabaseBackend(): CloudBackend {
  const db = supabase;
  if (!db) throw new Error('supabaseBackend: Supabase is not configured');
  const store = () => {
    if (!BUCKET) throw new Error('supabaseBackend: no storage bucket configured');
    return db.storage.from(BUCKET);
  };

  return {
    async listProjects() {
      const data = unwrap(await db.from('projects').select('id, updated_at'), 'list projects');
      return (data ?? []) as { id: string; updated_at: string }[];
    },

    async getProject(id) {
      const data = unwrap(
        await db.from('projects').select('*').eq('id', id).maybeSingle(),
        `read project ${id}`,
      );
      return (data as ProjectRow | null) ?? null;
    },

    async putProject(row) {
      // Conflict on the (user_id, id) primary key. On `id` alone the update
      // would aim at another account's row, which row-level security refuses.
      const { error } = await db.from('projects').upsert(row, { onConflict: 'user_id,id' });
      if (error) throw new Error(`write project ${row.id}: ${error.message}`);
    },

    async deleteProject(id) {
      const { error } = await db.from('projects').delete().eq('id', id);
      if (error) throw new Error(`delete project ${id}: ${error.message}`);
    },

    async putObject(path, bytes) {
      const { error } = await store().upload(path, bytes as BlobPart, {
        // Never overwrite. The path is the hash of the content, so an existing
        // object is already the bytes we want, and refusing the write is how a
        // content-addressed store stays incapable of losing anything.
        upsert: false,
        contentType: 'application/gzip',
      });
      if (error && !isAlreadyExists(error)) throw new Error(`upload ${path}: ${error.message}`);
    },

    async getObject(path) {
      const { data, error } = await store().download(path);
      if (error || !data) throw new Error(`download ${path}: ${error?.message ?? 'no data'}`);
      return new Uint8Array(await data.arrayBuffer());
    },

    async hasObject(path) {
      // A HEAD on the object itself, not a listing of the folder it is in.
      //
      // This used to `list(dir, { search: base })`, which is O(objects under
      // the prefix): every blob of every project of one user lives under
      // `<user>/blobs/`, so the cost of asking about one object grew with the
      // number of objects, and at a few thousand it started returning 504 and
      // failing pushes outright.
      //
      // `exists` keeps the contract this interface needs: it answers true, or
      // false for a definite 404, and **throws** for anything else. A failure to
      // ask is not an answer — reporting "absent" would send the caller into a
      // harmless re-upload, but reporting "present" on an error would let a
      // commit reference an object nobody has seen.
      const { data } = await store().exists(path);
      return data === true;
    },

    async removeObjects(paths) {
      if (paths.length === 0) return;
      const { error } = await store().remove(paths);
      if (error) throw new Error(`remove ${paths.length} objects: ${error.message}`);
    },

    async recordVersion(userId, row) {
      // Best-effort: a database whose `manifest.sql` migration has not been run
      // has no such table, and history is additive — worth having, never worth
      // failing a sync over. The error is surfaced once so it is not invisible.
      const { error } = await db.from('project_versions').insert({
        project_id: row.id,
        user_id: userId,
        name: row.name,
        files: row.files,
        committed_at: row.updated_at,
      });
      // Once per session, not per push. Every save reports the same missing
      // table, and a console that scrolls is a console nobody reads.
      if (error && !warnedNoHistory) {
        warnedNoHistory = true;
        console.warn(
          `Project history is off: ${error.message}. ` +
            'Run supabase/manifest.sql to enable version history and the recovery ' +
            'it makes possible for damaged projects.',
        );
      }
    },

    async listVersions(userId, projectId) {
      const { data, error } = await db
        .from('project_versions')
        .select('name, files, committed_at')
        .eq('user_id', userId)
        .eq('project_id', projectId)
        .order('version_id', { ascending: false });
      // A database without the migration has no table. That is not a failure to
      // report: there simply is no history to offer, and the caller falls back.
      if (error) return [];
      return (data ?? []) as { name: string; files: RowFile[]; committed_at: string }[];
    },
  };
}
