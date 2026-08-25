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
import type { CloudBackend, ProjectRow, RowFile, SettingsRow } from './backend.js';

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
      // Deliberately a listing, not `exists()`.
      //
      // `exists()` HEADs /object/<bucket>/<path>, which this project's storage
      // answers with 400, and storage-js maps both 400 and 404 to "absent". So
      // every blob read as missing: uploads were repeated, and then the commit
      // verification refused every push, because nothing it had just stored
      // could be found. A wrong answer here is far worse than a slow one.
      //
      // The listing is O(objects under the prefix) and returned 504 on accounts
      // holding thousands of blobs. That is mitigated rather than solved: a push
      // now asks only about blobs it has not already recorded as stored, so a
      // project that has not changed asks nothing at all. Sharding the blob
      // prefix by hash is the real fix and needs a read path that accepts both
      // layouts.
      const slash = path.lastIndexOf('/');
      const dir = slash < 0 ? '' : path.slice(0, slash);
      const base = path.slice(slash + 1);
      const { data, error } = await store().list(dir, { search: base, limit: 1 });
      // A failure to *ask* is not an answer. Reporting "absent" would send the
      // caller into a re-upload, which is harmless; reporting "present" on an
      // error would let a commit reference an object nobody has seen.
      if (error) throw new Error(`stat ${path}: ${error.message}`);
      return (data ?? []).some((o) => o.name === base);
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

    async getSettings() {
      // Rejects rather than returning []. A missing table and an expired token
      // are both errors here, and the settings sync has to tell them apart — it
      // says "run the migration" for one and nothing at all for the other. The
      // `listVersions` shortcut above (swallow and fall back) is wrong for a
      // read whose answer decides whether a *push* is safe.
      const data = unwrap(
        await db.from('user_settings').select('key, version, value, updated_at'),
        'read settings',
      );
      return (data ?? []) as SettingsRow[];
    },

    async putSettings(row) {
      // `updated_at` is not sent: the table's trigger stamps it from the
      // server's clock, and reading it back is the point of the `.select()`.
      const { data, error } = await db
        .from('user_settings')
        .upsert(row, { onConflict: 'user_id,key' })
        .select('updated_at')
        .single();
      if (error) throw new Error(`write settings ${row.key}: ${error.message}`);
      if (!data?.updated_at) throw new Error(`write settings ${row.key}: no timestamp returned`);
      return data as { updated_at: string };
    },
  };
}
