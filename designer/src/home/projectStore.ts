// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Offline-first project store (IndexedDB), the local half of ZiroEDA's
 * EasyEDA-style cloud persistence. Projects opened or created in the app are
 * saved here so they survive reloads with no login and no backend; a cloud
 * sync layer (Supabase) can later mirror these records.
 *
 * Files are stored as raw BYTES, mirroring KiCad's PROJECT_ARCHIVER, which
 * reads/writes every project file as a byte stream (project_archiver.cpp) so
 * binary files, 3D models (.step/.wrl), PDFs, images, round-trip exactly, not
 * just s-expression text. KiCad text compresses ~10x, so each file is gzipped
 * (CompressionStream) before storage, the 80 MB Jetson board lands at ~8 MB.
 * gzip is transparent: reads detect the magic bytes and fall back to the raw
 * bytes on browsers without CompressionStream. A UTF-8 text file's raw bytes
 * are its encoding, so records written by the older text-based store stay valid.
 */

import {
  PROBE_ID,
  probeStorage,
  reportStorageFailure,
  reportStorageOk,
  runTx,
  type StorageStatus,
} from './storageHealth.js';
import { withRecordLock } from './record_lock.js';

export interface StoredFile {
  name: string;
  bytes: Uint8Array;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Last time the project was opened (drives Recent Projects order). */
  lastOpenedAt?: number;
  fileCount: number;
  bytes: number; // compressed size on disk
}

interface StoredRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  /**
   * `updatedAt` at the moment of the last successful push or pull — the point
   * the two sides last agreed.
   *
   * Without it, "local is older than the cloud" cannot be told apart from
   * "local was edited *and* is older", so a pull cannot know whether it is
   * about to overwrite work or just catch up. Absent on a record that has
   * never synced, which is treated as "not diverged": forking on a first sync
   * would fork every project the first time somebody signs in.
   */
  syncedAt?: number;
  files: { name: string; gz: Uint8Array }[];
  /**
   * The account this project belongs to, once it has been associated with one.
   *
   * IndexedDB is per browser, not per account, and signing out does not clear
   * it. Without an owner recorded here, signing in as a second person on the
   * same machine made every project of the first person look like "local work
   * that is missing from the cloud", so sync pushed them up under the second
   * account. Where the id happened to already exist, Postgres refused the write
   * (that is the row-level security error); where it did not, one person's
   * projects were silently copied into another person's account.
   *
   * Undefined means the project has never been associated with an account:
   * either it predates this field, or it was made while signed out.
   */
  ownerId?: string;
}

/**
 * The signed-in account, as far as the store is concerned. Set by the auth
 * layer on every session change, so the store can filter without importing it.
 * Null when signed out or when auth is not configured at all, in which case
 * nothing is filtered and the app behaves exactly as it did offline.
 */
let currentOwner: string | null = null;

export function setProjectOwner(userId: string | null): void {
  currentOwner = userId;
}

/**
 * Whether this record belongs to whoever is signed in.
 *
 * Unowned records stay visible: they are either pre-existing projects from
 * before ownership was recorded, or work made while signed out, and hiding
 * somebody's own local work would be worse than the problem being fixed. They
 * are claimed by the first account that syncs them.
 */
export const ownedBy = (owner: string | null, r: { ownerId?: string }): boolean =>
  owner === null || r.ownerId === undefined || r.ownerId === owner;

const ownedByCurrent = (r: { ownerId?: string }): boolean => ownedBy(currentOwner, r);

const DB_NAME = 'ziroeda';
const STORE = 'projects';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * Run a transaction, reporting any failure to the storage-health layer so the
 * UI can warn before the user loses work.
 *
 * Writes resolve on transaction *commit* (see `runTx`), not on request success:
 * IndexedDB signals quota exhaustion by aborting the transaction after its
 * individual requests have already reported success, so the old
 * `req.onsuccess -> resolve` shape reported a clean save for data that was
 * never written. Every caller below awaits this, and several swallow the
 * rejection, so the health report has to happen here rather than at the call
 * sites.
 */
function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      runTx<T>(db, STORE, mode, fn).then(
        (result) => {
          if (mode !== 'readonly') reportStorageOk();
          return result;
        },
        (err) => {
          reportStorageFailure(err);
          throw err;
        },
      ),
    (err) => {
      reportStorageFailure(err); // could not even open the database
      throw err;
    },
  );
}

/** Boot check: prove a real write/read/delete round-trip works. */
export function checkStorageHealth(): Promise<StorageStatus> {
  return probeStorage(openDB, STORE);
}

// ----- gzip helpers ----------------------------------------------------------

const hasCompression = typeof CompressionStream !== 'undefined';

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasCompression) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  // gzip magic 0x1f 0x8b; anything else is stored raw (older browsers).
  const isGz = data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
  if (!isGz || typeof DecompressionStream === 'undefined') return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ----- public API ------------------------------------------------------------

/**
 * Cheap synchronous gate: is there an IndexedDB API to even try? This proves
 * only that the API exists, not that writes land. `checkStorageHealth()` is
 * the real test, and the health layer reports failures as they happen.
 */
export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Create/replace a project record. Returns the id (generated when omitted). */
export async function saveProject(name: string, files: StoredFile[], id?: string): Promise<string> {
  const now = Date.now();
  const pid = id ?? crypto.randomUUID?.() ?? `p${now}-${Math.random().toString(36).slice(2)}`;
  const gzFiles = await Promise.all(
    files.map(async (f) => ({ name: f.name, gz: await gzip(f.bytes) })),
  );
  // Preserve createdAt when updating an existing record.
  let createdAt = now;
  if (id) {
    const existing = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (existing) createdAt = existing.createdAt;
  }
  const record: StoredRecord = {
    id: pid,
    name,
    createdAt,
    updatedAt: now,
    lastOpenedAt: now,
    files: gzFiles,
    ...(currentOwner ? { ownerId: currentOwner } : {}),
  };
  await tx('readwrite', (s) => s.put(record));
  return pid;
}

/** All saved projects, newest first, without decompressing file bodies. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await tx<StoredRecord[]>('readonly', (s) => s.getAll());
  return (
    all
      .filter((r) => r.id !== PROBE_ID) // health-probe canary, not a project
      .filter(ownedByCurrent) // another account's work stays on disk but hidden
      .map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        lastOpenedAt: r.lastOpenedAt,
        fileCount: r.files.length,
        bytes: r.files.reduce((n, f) => n + f.gz.byteLength, 0),
      }))
      // Recent = last opened (falls back to last saved for older records).
      .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))
  );
}

/** Autosave: replace only the given files in a project (by name), re-gzipping
 *  just those and leaving every other file (pcb, models, binaries) untouched. */
export async function updateProjectFiles(id: string, changed: StoredFile[]): Promise<void> {
  if (changed.length === 0) return;
  // Read-modify-write over the whole record: without the lock, a second tab
  // saving between the read and the put loses everything the first tab wrote,
  // including files it never touched.
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    const byName = new Map(r.files.map((f) => [f.name, f]));
    for (const f of changed) byName.set(f.name, { name: f.name, gz: await gzip(f.bytes) });
    r.files = [...byName.values()];
    r.updatedAt = Date.now();
    await tx('readwrite', (s) => s.put(r));
  });
}

/** Mark a project as just opened (reorders Recent without touching updatedAt,
 *  so it doesn't trigger a needless cloud sync). */
export async function touchOpened(id: string): Promise<void> {
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    r.lastOpenedAt = Date.now();
    await tx('readwrite', (s) => s.put(r));
  });
}

/** Load a project's files (decompressed), or null if it no longer exists. */
export async function loadProject(
  id: string,
): Promise<{ meta: ProjectMeta; files: StoredFile[] } | null> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return null;
  const files = await Promise.all(
    r.files.map(async (f) => ({ name: f.name, bytes: await gunzip(f.gz) })),
  );
  return {
    meta: {
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      fileCount: r.files.length,
      bytes: r.files.reduce((n, f) => n + f.gz.byteLength, 0),
    },
    files,
  };
}

/**
 * Record that a project now belongs to an account. Called after a push lands,
 * so an unowned project stops being claimable by whoever signs in next.
 */
export async function claimProject(id: string, userId: string): Promise<void> {
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r || r.ownerId === userId) return;
    r.ownerId = userId;
    await tx('readwrite', (s) => s.put(r));
  });
}

/**
 * Record that the local copy now agrees with the cloud, after a push.
 *
 * Separate from `claimProject`, which early-returns when the owner is already
 * right — the watermark has to move on every successful push, not only the
 * first one.
 */
export async function markSynced(id: string): Promise<void> {
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    r.syncedAt = r.updatedAt;
    await tx('readwrite', (s) => s.put(r));
  });
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function renameProject(id: string, name: string): Promise<void> {
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    r.name = name;
    r.updatedAt = Date.now();
    await tx('readwrite', (s) => s.put(r));
  });
}

// ----- cloud-sync serialization ----------------------------------------------

/** A project record in a JSON-serializable form (gzipped file bytes as base64),
 *  shared by the IndexedDB store and the Supabase cloud store. */
export interface SyncableProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  files: { name: string; gzB64: string }[];
}

function bytesToB64(u8: Uint8Array): string {
  let s = '';
  const chunk = 0x8000; // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

/** id + updatedAt for every local project, for cheap sync diffing. */
export async function listSyncMeta(): Promise<{ id: string; updatedAt: number }[]> {
  const all = await tx<StoredRecord[]>('readonly', (s) => s.getAll());
  // The filter is the fix for cross-account leakage: sync compares this list
  // against the cloud, and row-level security means another account's rows are
  // invisible, so anything left in here would look local-only and be pushed up
  // under the wrong owner.
  return all
    .filter((r) => r.id !== PROBE_ID && ownedByCurrent(r))
    .map((r) => ({ id: r.id, updatedAt: r.updatedAt }));
}

/** Export a stored project to its serializable (base64) form, or null if gone. */
export async function exportProject(id: string): Promise<SyncableProject | null> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    files: r.files.map((f) => ({ name: f.name, gzB64: bytesToB64(f.gz) })),
  };
}

/** Write a project from its serializable form, preserving its timestamps. */
export async function importProject(p: SyncableProject): Promise<void> {
  const record: StoredRecord = {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    files: p.files.map((f) => ({ name: f.name, gz: b64ToBytes(f.gzB64) })),
    // We have just taken the cloud's copy wholesale, so this is the point the
    // two sides agree.
    syncedAt: p.updatedAt,
    ...(currentOwner ? { ownerId: currentOwner } : {}),
  };
  await tx('readwrite', (s) => s.put(record));
}

/**
 * Whether the local copy has been edited since the last time it agreed with the
 * cloud — `updatedAt > syncedAt`.
 *
 * A record that has never synced returns false: it has nothing to diverge
 * *from*, and forking on a first sync would fork everything the first time
 * somebody signs in.
 */
export async function hasDivergedLocally(id: string): Promise<boolean> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  return !!r && r.syncedAt !== undefined && r.updatedAt > r.syncedAt;
}

/**
 * How a preserved copy is named, so it is obvious in Recent what it is.
 *
 * Dated to the day rather than the second: two syncs on the same day should
 * produce the same name, not a churn of near-identical entries. It lives here
 * rather than beside the sync code because that module reaches `import.meta.env`
 * through the auth client, which qa's compiler cannot see.
 */
export const localCopyName = (name: string, when: Date): string =>
  `${name} (local copy, ${when.toISOString().slice(0, 10)})`;

/**
 * Copy the local record to a new project under a new id, so a pull can take the
 * cloud's version without destroying what is here.
 *
 * Returns the new id, or null when there is nothing to copy. The copy has no
 * `syncedAt` and no owner: it is a local artefact of this browser, and pushing
 * it anywhere is the user's decision to make later.
 */
export async function forkLocalCopy(id: string, name: string): Promise<string | null> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return null;
  const now = Date.now();
  const copyId = crypto.randomUUID?.() ?? `p${now}-${Math.random().toString(36).slice(2)}`;
  const copy: StoredRecord = {
    id: copyId,
    name,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    files: r.files,
  };
  await tx('readwrite', (s) => s.put(copy));
  return copyId;
}
