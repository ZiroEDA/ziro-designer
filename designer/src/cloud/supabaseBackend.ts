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
      // `uid` and `user_id` come back because this listing now spans two
      // accounts: row-level security returns projects shared with the signed-in
      // user alongside their own, and `id` alone cannot tell them apart.
      const withIdentity = await db.from('projects').select('id, uid, user_id, version');
      if (!withIdentity.error) {
        return (withIdentity.data ?? []) as {
          id: string;
          version: number;
          uid?: string;
          user_id?: string;
        }[];
      }

      // A database whose `uid` migration has not been run has no such column,
      // and PostgREST answers a select that names one with an error rather than
      // by ignoring it. Without this fallback, deploying the code before
      // running the migration takes cloud sync down for **every** account:
      // `cloudListMeta` is the first thing a sign-in does, and the whole
      // reconcile fails on it.
      //
      // Narrow on purpose. Only "that column does not exist" falls back; an
      // expired token or a network failure must still reject, because a
      // listing that quietly returns fewer projects than the account has is
      // exactly the shape that makes a sync push a stale copy over a good one.
      const missingColumn =
        withIdentity.error.code === '42703' ||
        /column .* does not exist/i.test(withIdentity.error.message ?? '');
      if (!missingColumn) throw new Error(`list projects: ${withIdentity.error.message}`);

      const legacy = unwrap(await db.from('projects').select('id, version'), 'list projects');
      // No `uid` and no `user_id`, which is what the sync layer already reads as
      // "every visible row is this user's own" — true, on a database that
      // cannot share anything.
      return (legacy ?? []) as { id: string; version: number }[];
    },

    async getProject(id, uid) {
      // By `uid` whenever the caller knows it. `.eq('id', id)` can now match two
      // visible rows — one of the user's own and one shared with them under the
      // same browser-local id — and `maybeSingle()` answers that with an error,
      // so addressing by a local id is not merely ambiguous but broken.
      const q = uid
        ? db.from('projects').select('*').eq('uid', uid)
        : db.from('projects').select('*').eq('id', id);
      const rows = unwrap(await q, `read project ${uid ?? id}`) as ProjectRow[] | null;
      return (rows ?? [])[0] ?? null;
    },

    async listMemberships() {
      // Own rows only. The roster policy deliberately shows every member of a
      // project to every other member, so without this filter a user on a
      // three-person project reads back two roles that are not theirs.
      const me = (await db.auth.getUser()).data.user?.id;
      if (!me) return [];
      const { data, error } = await db
        .from('project_members')
        .select('project_uid, role')
        .eq('user_id', me);
      // A database without the membership migration has no such table, and the
      // answer there is the true one: this user is a member of nothing.
      if (error) return [];
      return (data ?? []) as { project_uid: string; role: string }[];
    },

    async commitProject(row, base) {
      // The compare-and-swap lives in Postgres, not here, because it has to be
      // one statement. Read-then-write from the browser is the same race with
      // more steps: two devices both read version 4 and both write 5.
      //
      // `updated_at` is deliberately not sent. The function stamps it from the
      // server's clock, and the whole reason this RPC exists is that a client's
      // clock had no business deciding anything.
      const { data, error } = await db.rpc('commit_project', {
        p_id: row.id,
        p_name: row.name,
        p_files: row.files,
        p_base: base,
        // Names the project directly when it is one this user does not own.
        // Without it the function looks for *the caller's own* row of that id,
        // finds nothing, and reports the caller stale — which reads as a
        // conflict rather than as "you were editing someone else's project".
        ...(row.uid ? { p_uid: row.uid } : {}),
      });
      if (error) throw new Error(`commit project ${row.id}: ${error.message}`);
      // Null is the contract's "you are stale", not a failure to write.
      return data === null || data === undefined ? null : Number(data);
    },

    async deleteProject(id) {
      const { error } = await db.from('projects').delete().eq('id', id);
      if (error) throw new Error(`delete project ${id}: ${error.message}`);
    },

    async setLinkAccess(uid, role) {
      // The owner-only rule is a trigger in the database
      // (`projects_freeze_identity`), not a check here: an editor holds UPDATE
      // on the row through `projects_update_editor`, so nothing client-side
      // could be relied on to stop them.
      const { error } = await db.from('projects').update({ link_access: role }).eq('uid', uid);
      if (error) throw new Error(`share ${uid}: ${error.message}`);
    },

    async openByLink(uid) {
      const { data, error } = await db.rpc('join_project_by_link', { p_uid: uid });
      if (error) throw new Error(error.message);
      return (data as string | null) ?? null;
    },

    async redeemInvite(token) {
      const { data, error } = await db.rpc('redeem_project_invite', { p_token: token });
      // Every refusal the function makes arrives as one message, deliberately:
      // it does not distinguish "expired" from "no such token", because doing
      // so would tell somebody probing which tokens are real.
      if (error) throw new Error(error.message);
      const row = (data as { project_uid: string; role: string }[] | null)?.[0];
      return row ?? null;
    },

    async leaveProject(uid) {
      const me = (await db.auth.getUser()).data.user?.id;
      if (!me) throw new Error(`leave project ${uid}: not signed in`);
      // The `project_members_leave` policy permits exactly this row and no
      // other, so a user can always show themselves out and can never remove
      // anybody else.
      const { error } = await db
        .from('project_members')
        .delete()
        .eq('project_uid', uid)
        .eq('user_id', me);
      if (error) throw new Error(`leave project ${uid}: ${error.message}`);
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
        // Who committed, which for a shared project is not who owns it. The
        // project itself is named by `project_uid`.
        user_id: userId,
        // Sent explicitly rather than left to the table's trigger. That trigger
        // fills it by looking up `(user_id, project_id)` in `projects`, which
        // only finds anything when the committer is the owner — so on a shared
        // project it would leave the column null, and the insert policy, having
        // no project to ask about, would refuse the row outright.
        ...(row.uid ? { project_uid: row.uid } : {}),
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

    async listVersions(userId, projectId, uid) {
      // By project, not by author. `user_id` on a version row records who
      // committed it, so on a shared project filtering by it returns only the
      // versions this user happened to write and hides exactly the history a
      // recovery would need.
      const q = db.from('project_versions').select('name, files, committed_at');
      const { data, error } = await (uid
        ? q.eq('project_uid', uid)
        : q.eq('user_id', userId).eq('project_id', projectId)
      ).order('version_id', { ascending: false });
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
