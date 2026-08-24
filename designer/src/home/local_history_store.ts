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
  PRE_RESTORE_TITLE,
  restoredFromTitle,
  snapshotTitle,
  snapshotsToEvict,
  type Snapshot,
  type SnapshotKind,
} from './local_history.js';
import { loadProject, updateProjectFiles, type StoredFile } from './projectStore.js';
import { idbHandle } from './idb_open.js';

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

/**
 * The local-history database, through the shared opener - see `idb_open.ts` for
 * the three events every one of these must handle, and why a dropped
 * connection used to be permanent.
 */
const db = idbHandle(DB_NAME, VERSION, (d) => {
  if (!d.objectStoreNames.contains(SNAPSHOTS)) {
    const store = d.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
    // Every read is "this project's history", so the index is the access path
    // rather than an optimisation.
    store.createIndex('projectId', 'projectId', { unique: false });
  }
  if (!d.objectStoreNames.contains(BLOBS)) d.createObjectStore(BLOBS, { keyPath: 'hash' });
});

const openDb = (): Promise<IDBDatabase> => db.get();

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
 *
 * `title` overrides the composed one, for the two places upstream writes a
 * commit message that is not "Autosave"/"Backup"/"Save": "Pre-restore backup"
 * and "Restored from <hash>" (common/local_history.cpp:2288, :2371). Both fall
 * through `kindOfTitle` to the default tint, which is what upstream's
 * `SetItemTextColour` does with them too - it only special-cases the messages
 * beginning "Autosave" and "Backup".
 */
export async function commitSnapshot(
  projectId: string,
  files: readonly StoredFile[],
  kind: SnapshotKind = 'save',
  detail?: string,
  title?: string,
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
      title: title ?? snapshotTitle(kind, detail),
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

/**
 * `EnforceSizeLimit( aProjectPath, aMaxBytes, ... )`'s budget, whose upstream
 * counterpart is a user setting. Ours is a constant until there is a page to
 * put it on, and it is deliberately generous: blobs are shared between
 * snapshots, so this is the distinct content of a project's whole history
 * rather than the sum of its snapshots, and a project of any size only grows it
 * by what actually changed.
 *
 * It lives here, beside the two functions that use it, rather than in the one
 * screen that happened to call them first.
 */
export const HISTORY_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Commit a snapshot and settle the history — the pair every caller wants.
 *
 * `enforceSizeLimit`'s own contract is "called after a commit, so the history
 * settles rather than grows without bound", so the two belong together. There
 * are two callers now (opening a project, and saving one) and a third would
 * have copied the pairing again.
 *
 * `commitSnapshot` already declines when nothing changed, returning null, so
 * this is a no-op on a save that wrote nothing new — which is what keeps a
 * repeated Ctrl+S from filling the pane with identical rows.
 */
export async function recordSnapshot(
  projectId: string,
  files: readonly StoredFile[],
  kind: SnapshotKind = 'save',
  detail?: string,
): Promise<Snapshot | null> {
  const snap = await commitSnapshot(projectId, files, kind, detail);
  if (snap) await enforceSizeLimit(projectId, HISTORY_MAX_BYTES);
  return snap;
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

/**
 * `LOCAL_HISTORY::RestoreCommit` (common/local_history.cpp:2192-2382), the
 * "Restore Commit" behind the Local History pane's one context-menu item
 * (kicad/local_history_pane.cpp:183-189).
 *
 * The order of operations is upstream's, and each step earns its place:
 *
 *  1. A PRE-RESTORE BACKUP is committed first, of the project exactly as it
 *     stands (:2276-2298, message "Pre-restore backup"). It is what makes the
 *     restore undoable, and it is why the confirmation can promise that. Upstream
 *     tolerates the `NoChanges` result and carries on, so a `null` here is not an
 *     error: it means the working copy already matched the newest snapshot.
 *  2. The snapshot is OVERLAID onto the project rather than replacing it
 *     (:2334-2338). Upstream is explicit that "Restore never removes files that
 *     are absent from the snapshot, so restoring a partial per-editor commit ...
 *     cannot delete the schematic, project file, outputs, or libraries."
 *     `updateProjectFiles` is already exactly that operation - it replaces the
 *     named files and leaves every other one alone - so the overlay is the call
 *     itself, not something layered on top of it.
 *  3. The whole post-overlay project is COMMITTED again (:2367-2372, message
 *     "Restored from <hash>"), so the newest snapshot matches what is on disk.
 *     Without it the next commit would diff against the pre-restore state and
 *     report every restored file as a fresh change.
 *
 * What is deliberately NOT ported, and why:
 *
 *  - STEP 1 upstream is a LOCKFILE sweep for files open in another editor
 *    (:2198-2218), and `KICAD_MANAGER_FRAME::RestoreCommitFromHistory`
 *    (kicad/kicad_manager_frame.cpp:1520-1523) first calls
 *    `Kiway().PlayersClose( true )` and gives up if any editor refuses. Neither
 *    has a counterpart here: there is one tab, one user, and no lock files. The
 *    caller re-reads the project afterwards, which is this app's version of
 *    upstream reopening its editors.
 *  - The `_restore_temp` extraction directory and the retained
 *    `_restore_backup_<stamp>` copy (:2306-2364) are libgit2 plumbing for
 *    getting a tree onto a filesystem safely. Our snapshot is already a list of
 *    files in hand, and the pre-restore commit is the same undo point the
 *    retained directory provides.
 *  - `tagSaveAtHead( repo, "project" )` (:2375) anchors the saved baseline so
 *    reopening does not re-prompt. Here the post-restore commit IS that anchor:
 *    it is the newest snapshot and it matches the bytes just written, so the
 *    project reopens clean.
 *
 * Returns the project's files as they now stand, for the caller to load, or
 * `null` if the snapshot or the project has gone.
 */
export async function restoreSnapshot(
  projectId: string,
  snapshotId: string,
): Promise<StoredFile[] | null> {
  const wanted = await readSnapshot(snapshotId);
  if (!wanted || wanted.length === 0) return null;

  const before = await loadProject(projectId);
  if (!before) return null;

  // 1. The undo point, committed before anything is written.
  await commitSnapshot(projectId, before.files, 'save', undefined, PRE_RESTORE_TITLE);

  // 2. The overlay. Files the snapshot does not mention are left untouched.
  await updateProjectFiles(projectId, wanted);

  // 3. Re-commit the result, so the newest snapshot is the project on disk.
  const after = await loadProject(projectId);
  const files = after?.files ?? wanted;
  await commitSnapshot(projectId, files, 'save', undefined, restoredFromTitle(snapshotId));

  announce(projectId);
  return files;
}
