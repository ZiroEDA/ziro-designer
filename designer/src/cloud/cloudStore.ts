/**
 * Supabase-backed project store, the cloud half of Ziro Designer's persistence.
 * Mirrors the IndexedDB API in ../home/projectStore, operating on the same
 * `SyncableProject` shape (gzipped files, base64-encoded).
 *
 * File blobs go to **Supabase Storage** when a bucket is configured
 * (VITE_SUPABASE_STORAGE_BUCKET), the Postgres row then holds only metadata +
 * the file list, NOT the blobs. This keeps large projects out of the database
 * (storing blobs in Postgres is what filled the DB and made it unhealthy). With
 * no bucket configured it falls back to the previous inline-jsonb behaviour,
 * capped in size so it can't bloat the DB.
 *
 * All rows are scoped to the signed-in user by Row Level Security (see
 * supabase/projects.sql); Storage objects live under `<userId>/…` with a
 * matching per-user policy.
 */

import { supabase } from '../auth/supabaseClient.js';
import type { SyncableProject } from '../home/projectStore.js';

// Set to a bucket name to store file blobs in Supabase Storage instead of the
// Postgres row. Leave unset to keep the (capped) inline behaviour.
const BUCKET = (import.meta.env.VITE_SUPABASE_STORAGE_BUCKET as string | undefined) || '';
// Max inline payload (base64) when NOT using Storage, protects the DB.
const INLINE_CAP = 4 * 1024 * 1024;

interface FileRef {
  name: string;
  gzB64?: string;
}
interface Row {
  id: string;
  user_id?: string;
  name: string;
  created_at: string;
  updated_at: string;
  files: FileRef[];
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
// Storage object path for one project file.
const objPath = (userId: string, id: string, name: string): string =>
  `${userId}/${id}/${encodeURIComponent(name)}.gz`;

/** id + updatedAt for every cloud project of the signed-in user. */
export async function cloudListMeta(): Promise<{ id: string; updatedAt: number }[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('projects').select('id, updated_at');
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, updatedAt: new Date(r.updated_at).getTime() }));
}

/** Fetch a single cloud project (with file bodies), or null if absent. */
export async function cloudGet(id: string): Promise<SyncableProject | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as Row;
  const meta = {
    id: r.id,
    name: r.name,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
  const inline = r.files.length === 0 || r.files[0]!.gzB64 !== undefined;
  if (inline || !BUCKET)
    return { ...meta, files: (r.files as { name: string; gzB64: string }[]) ?? [] };

  // Storage-backed: download each blob and re-encode to the gzB64 shape.
  const userId = r.user_id ?? '';
  //
  // A failed download must abort the whole pull. It previously became an empty
  // file, which the caller then wrote into the local store, replacing a good
  // project with blank ones. That is the worst outcome available here: sync
  // resolves by timestamp, so a newer-but-broken cloud row could quietly
  // destroy the only complete copy of the work.
  const files = await Promise.all(
    r.files.map(async (f) => {
      const { data: blob, error: e } = await supabase!.storage
        .from(BUCKET)
        .download(objPath(userId, id, f.name));
      if (e || !blob) {
        throw new Error(
          `Could not download "${f.name}" for project "${r.name}": ${e?.message ?? 'file missing from storage'}.`,
        );
      }
      return { name: f.name, gzB64: bytesToB64(new Uint8Array(await blob.arrayBuffer())) };
    }),
  );
  return { ...meta, files };
}

/** Insert or update a project for the given user. */
export async function cloudUpsert(userId: string, p: SyncableProject): Promise<void> {
  if (!supabase) return;
  const base = {
    id: p.id,
    user_id: userId,
    name: p.name,
    created_at: new Date(p.createdAt).toISOString(),
    updated_at: new Date(p.updatedAt).toISOString(),
  };

  if (BUCKET) {
    // Blobs → Storage; the row keeps only the file names.
    //
    // Every result is checked, because `upload` reports failure by returning an
    // error rather than throwing. Discarding those meant a project whose blobs
    // had all failed to upload still got its row written, listing files that
    // were not in Storage. The row then claimed a complete project, and since
    // sync resolves by timestamp, that empty copy could be pulled back over the
    // good local one. A missing bucket presented exactly this way: twenty
    // silent 400s, then a confident row.
    const uploads = await Promise.all(
      p.files.map((f) =>
        supabase!.storage.from(BUCKET).upload(objPath(userId, p.id, f.name), b64ToBytes(f.gzB64), {
          upsert: true,
          contentType: 'application/gzip',
        }),
      ),
    );
    const failed = uploads.filter((u) => u.error);
    if (failed.length > 0) {
      // Surfaced rather than summarised: the underlying text is what identifies
      // the cause ("Bucket not found" means Storage was never provisioned).
      const reason = failed[0]?.error?.message ?? 'unknown error';
      throw new Error(
        `Cloud sync failed for "${p.name}": ${failed.length} of ${p.files.length} files could not be uploaded (${reason}).`,
      );
    }
    const { error } = await supabase.from('projects').upsert(
      { ...base, files: p.files.map((f) => ({ name: f.name })) },
      {
        // Match the (user_id, id) primary key. Conflicting on id alone would
        // aim the update at another account's row, which row-level security
        // then refuses.
        onConflict: 'user_id,id',
      },
    );
    if (error) throw error;
    return;
  }

  // Inline (no bucket): keep blobs in the row, but cap the size so a big project
  // can't fill the database, it stays local-only until Storage is configured.
  const total = p.files.reduce((n, f) => n + f.gzB64.length, 0);
  if (total > INLINE_CAP) {
    console.warn(
      `Cloud sync skipped for "${p.name}": ${(total / 1048576).toFixed(1)} MB exceeds the inline cap. Configure VITE_SUPABASE_STORAGE_BUCKET to sync large projects.`,
    );
    return;
  }
  const { error } = await supabase
    .from('projects')
    .upsert({ ...base, files: p.files }, { onConflict: 'user_id,id' });
  if (error) throw error;
}

export async function cloudDelete(id: string): Promise<void> {
  if (!supabase) return;
  if (BUCKET) {
    const { data } = await supabase
      .from('projects')
      .select('user_id, files')
      .eq('id', id)
      .maybeSingle();
    const r = data as Pick<Row, 'user_id' | 'files'> | null;
    if (r?.user_id && r.files?.length) {
      await supabase.storage
        .from(BUCKET)
        .remove(r.files.map((f) => objPath(r.user_id!, id, f.name)));
    }
  }
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}
