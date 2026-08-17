// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where Local History's snapshots live.
 *
 * Upstream's store is a git repository inside the project directory, driven by
 * libgit2 - `LOCAL_HISTORY::Init` creates it, `CommitSnapshot` commits into it,
 * `LoadSnapshots` walks it. There is no project directory here, so this is the
 * same two-table idea git uses underneath: an object table addressed by content
 * hash, and a list of snapshots each naming the hashes it is made of.
 *
 * Its own database, not a second table in `ziroeda`. History is bulky, entirely
 * derived, and the first thing that should go when an origin runs out of room;
 * keeping it separate means it can be dropped without opening the store that
 * holds the projects themselves, and means a corrupt history cannot take the
 * projects with it.
 *
 * ## Why a snapshot is cheap
 *
 * Blobs are shared. Ten snapshots of a board where one file changed cost one
 * copy of everything else, which is what makes snapshotting on every save
 * affordable at all - a project is mostly footprints and 3D models that do not
 * change while you edit a schematic. It is also why deleting a snapshot frees
 * only the blobs no surviving snapshot still references.
 */

import { runTx } from './storageHealth.js';
import { gunzip, gzip } from './gzip.js';
import {
  changedAgainst,
  hashFiles,
  kindOfTitle,
  snapshotTitle,
  snapshotsToEvict,
  type Snapshot,
  type SnapshotKind,
} from './local_history.js';
import type { StoredFile } from './projectStore.js';

const DB_NAME = 'ziroeda-history';
const VERSION = 1;
const SNAPSHOTS = 'snapshots';
const BLOBS = 'blobs';

/** Stored form of a snapshot; `Snapshot` plus the project it belongs to. */
interface SnapshotRecord extends Snapshot {
  projectId: string;
}

interface BlobRecord {
  hash: string;
  gz: Uint8Array;
}

/**
 * `EVT_LOCAL_HISTORY_REFRESH`, which is how upstream's pane learns the history
 * moved:
 *
 *     Bind( EVT_LOCAL_HISTORY_REFRESH, &LOCAL_HISTORY_PANE::OnRefreshEvent, this );
 *
 * A commit posts the event and the pane re-reads. Doing the same here keeps the
 * pane from having to be told by whoever happened to save, and means a snapshot
 * taken from anywhere - a save, an autosave, a restore - shows up without that
 * caller knowing the pane exists.
 */
type HistoryListener = (projectId: string) => void;
const listeners = new Set<HistoryListener>();

/** Subscribe to history changes. Returns the unsubscribe. */
export function onHistoryChanged(fn: HistoryListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(projectId: string): void {
  for (const fn of listeners) fn(projectId);
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) {
        const store = db.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
        // Every read is "this project's history", so the index is the access
        // path rather than an optimisation.
        store.createIndex('projectId', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(BLOBS)) {
        db.createObjectStore(BLOBS, { keyPath: 'hash' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('history db failed to open'));
  }).catch((err: unknown) => {
    // A failed open must not be cached as a permanently broken database: a
    // private-mode origin that gains storage later should work then.
    dbPromise = null;
    throw err;
  });

  return dbPromise;
}

/** History is a convenience. It must never be the reason a save fails. */
async function quietly<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Newest first, which is the order the pane lists them in. */
export async function listSnapshots(projectId: string): Promise<Snapshot[]> {
  return quietly(async () => {
    const db = await openDb();
    const rows = await new Promise<SnapshotRecord[]>((resolve, reject) => {
      const t = db.transaction(SNAPSHOTS, 'readonly');
      const req = t.objectStore(SNAPSHOTS).index('projectId').getAll(projectId);
      req.onsuccess = () => resolve(req.result as SnapshotRecord[]);
      req.onerror = () => reject(req.error);
    });
    return rows.sort((a, b) => b.at - a.at).map(({ projectId: _p, ...s }) => s);
  }, []);
}

/**
 * `CommitSnapshot`: hash the project, store what is new, record the list.
 *
 * Returns `null` when nothing changed, which is upstream's behaviour too - git
 * declines an empty commit, and a history full of identical entries would make
 * the pane useless exactly when it is needed.
 */
export async function commitSnapshot(
  projectId: string,
  files: readonly StoredFile[],
  kind: SnapshotKind = 'save',
  detail?: string,
): Promise<Snapshot | null> {
  return quietly(async () => {
    const hashed = await hashFiles(files);
    const history = await listSnapshots(projectId);
    const previous = history[0];
    const changed = changedAgainst(previous?.files, hashed);

    if (changed.length === 0) return null;

    const db = await openDb();
    const byHash = new Map(hashed.map((h, i) => [h.hash, files[i]] as const));

    // Only the blobs this database has never seen. The check is per hash, so a
    // file that reverted to a previous version costs nothing.
    for (const f of hashed) {
      const exists = await runTx<BlobRecord | undefined>(db, BLOBS, 'readonly', (store) =>
        store.get(f.hash),
      );
      if (exists) continue;
      const source = files.find((x) => x.name === f.name) ?? byHash.get(f.hash);
      if (!source) continue;
      const gz = await gzip(source.bytes);
      await runTx(db, BLOBS, 'readwrite', (store) => store.put({ hash: f.hash, gz }));
    }

    const at = Date.now();
    const record: SnapshotRecord = {
      // Sortable and unique without a counter table: the stamp orders them and
      // the suffix separates two saves inside one millisecond.
      id: `${at.toString(36)}-${Math.floor(performance.now() * 1000).toString(36)}`,
      projectId,
      at,
      title: snapshotTitle(kind, detail),
      kind,
      files: hashed,
      changed,
    };

    await runTx(db, SNAPSHOTS, 'readwrite', (store) => store.put(record));
    announce(projectId);

    const { projectId: _p, ...snapshot } = record;
    return snapshot;
  }, null);
}

/** The files as they were, ready to be written back over the project. */
export async function readSnapshot(id: string): Promise<StoredFile[] | null> {
  return quietly(async () => {
    const db = await openDb();
    const record = await runTx<SnapshotRecord | undefined>(db, SNAPSHOTS, 'readonly', (store) =>
      store.get(id),
    );
    if (!record) return null;

    const out: StoredFile[] = [];
    for (const f of record.files) {
      const blob = await runTx<BlobRecord | undefined>(db, BLOBS, 'readonly', (store) =>
        store.get(f.hash),
      );
      // A missing blob is a torn history rather than a torn file: restore what
      // is there and let the caller see a short list, instead of failing whole.
      if (blob) out.push({ name: f.name, bytes: await gunzip(blob.gz) });
    }
    return out;
  }, null);
}

/** Drop snapshots, and every blob no surviving snapshot still points at. */
export async function deleteSnapshots(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await quietly(async () => {
    const db = await openDb();
    for (const id of ids) {
      await runTx(db, SNAPSHOTS, 'readwrite', (store) => store.delete(id));
    }
    await collectGarbage(db);
  }, undefined);
}

/** Everything for one project, for when the project itself is deleted. */
export async function deleteProjectHistory(projectId: string): Promise<void> {
  const snapshots = await listSnapshots(projectId);
  await deleteSnapshots(snapshots.map((s) => s.id));
  announce(projectId);
}

/**
 * `EnforceSizeLimit`. Called after a commit, so the history settles rather than
 * grows without bound.
 */
export async function enforceSizeLimit(projectId: string, maxBytes: number): Promise<void> {
  const snapshots = await listSnapshots(projectId);
  const evicted = snapshotsToEvict(snapshots, maxBytes);
  if (evicted.length === 0) return;
  await deleteSnapshots(evicted);
  announce(projectId);
}

/** Blobs nothing references. Cheap because the reference set is small. */
async function collectGarbage(db: IDBDatabase): Promise<void> {
  const all = await new Promise<SnapshotRecord[]>((resolve, reject) => {
    const t = db.transaction(SNAPSHOTS, 'readonly');
    const req = t.objectStore(SNAPSHOTS).getAll();
    req.onsuccess = () => resolve(req.result as SnapshotRecord[]);
    req.onerror = () => reject(req.error);
  });

  const live = new Set<string>();
  for (const s of all) for (const f of s.files) live.add(f.hash);

  const hashes = await new Promise<string[]>((resolve, reject) => {
    const t = db.transaction(BLOBS, 'readonly');
    const req = t.objectStore(BLOBS).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });

  for (const hash of hashes) {
    if (live.has(hash)) continue;
    await runTx(db, BLOBS, 'readwrite', (store) => store.delete(hash));
  }
}

/** Re-derive a snapshot's kind from its title, as the pane does. */
export const snapshotKind = kindOfTitle;
