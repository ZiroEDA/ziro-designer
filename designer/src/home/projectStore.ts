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
import { sha256Hex } from '../cloud/blobStore.js';
import { gunzip, gzip } from './gzip.js';
import { idbHandle } from './idb_open.js';

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
  /**
   * The cloud `version` this record last agreed with, from the pull that
   * brought it down or the push that landed it.
   *
   * This is what a push names as the version it is replacing, and the server
   * refuses the write if the row has moved since. Undefined means the project
   * has never been in the cloud, which a push states as base 0 — "this is new,
   * and must not already exist".
   *
   * It replaces `syncedAt` as the thing reconciliation actually reads.
   * `syncedAt` is still written, for records that predate this and for nothing
   * else; a timestamp cannot order two machines' writes and never could.
   */
  baseVersion?: number;
  /**
   * The content hashes of this record's files at the moment the two sides last
   * agreed. What divergence is measured against.
   *
   * Deliberately *not* `pushedHashes`, though for a project pushed from here
   * the two hold the same strings. They answer different questions, and
   * conflating them loses data: `pushedHashes` means "these blobs are in the
   * content-addressed store", which lets a push skip uploading and verifying
   * them. A legacy cloud row references its files by path or inline, so its
   * blobs are *not* in that store — recording their computed hashes as pushed
   * would make the next push upload nothing, verify nothing, and commit a row
   * naming objects that were never stored.
   *
   * So a pull records what it took (always), and only a push records what is
   * known present (when it is).
   */
  syncedHashes?: string[];
  /**
   * `hash` is the SHA-256 of `gz`, the key the blob is stored under in the
   * cloud. Computed here, once, when the bytes are written, rather than in the
   * push, which was hashing every file of the project on every sync even when
   * one line of one schematic had changed.
   *
   * Optional: records written before this existed have none, and the push falls
   * back to hashing those.
   */
  /**
   * `size` and `writtenAt` are what a file chooser needs and a compressed blob
   * cannot answer: the file's own length, and when this file — not the project
   * — last changed. Both are free at write time and cost a gunzip afterwards,
   * which is why they are recorded rather than derived on demand.
   *
   * Optional for the same reason `hash` is: records written before this
   * existed have neither, and a record arriving from the cloud carries only
   * what the blob store holds. `listProjectFiles` fills them in on first read.
   */
  files: {
    name: string;
    gz: Uint8Array;
    hash?: string;
    size?: number;
    writtenAt?: number;
  }[];
  /**
   * Folders that exist without holding a file.
   *
   * A project is stored as a flat list of relative paths, so every folder in
   * it is implied by the files inside — which means an empty one cannot be
   * expressed. On a disk it can, and the file chooser has a New Folder button
   * that makes one, so the folders that nothing implies are recorded here,
   * project-relative and without a trailing slash.
   *
   * A folder stops being listed here as soon as a file is written into it,
   * because from then on the file implies it. Nothing else is derived from
   * this list: it is the exception, not the index.
   */
  emptyFolders?: string[];
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
  /**
   * The project's global identity (`projects.uid`), once this copy has met the
   * cloud. Learned from a pull, or from the listing on the first sync after the
   * column existed.
   *
   * This is what a sync matches on. `id` cannot be: it is unique on one machine
   * only, so a project shared with this user may carry the same one as a
   * project of their own, and matching by it would reconcile two unrelated
   * projects into each other.
   */
  cloudUid?: string;
  /**
   * The `id` the cloud row carries, when it is not this record's own.
   *
   * A project shared with this user is filed here under its `uid`, because its
   * owner's local id could already be taken by something of the user's. The
   * row's own id still has to be sent back on a commit, so it is kept.
   */
  cloudId?: string;
  /**
   * The account that owns the project. Equal to `ownerId` for the user's own
   * projects, and someone else's for a shared one.
   *
   * Not a courtesy field: blobs live at `<owner>/blobs/…`, so this is what
   * addresses the file contents. Pushing a shared project under the signed-in
   * user's own id would upload every blob into the wrong account, where the
   * owner cannot read them.
   */
  cloudOwnerId?: string;
  /**
   * What this user may do with the project. Absent means their own.
   *
   * A viewer's local copy is a copy to read, not an unsynced project: without
   * this, sync sees ordinary local edits, pushes, is refused by row-level
   * security, and forks a "(local copy)" aside on every pass forever.
   */
  cloudRole?: 'owner' | 'editor' | 'viewer';
  /**
   * The blob hashes of the last push that landed.
   *
   * Every one of them is referenced by this project's cloud row, so the store
   * still holds them: the delete path only collects blobs no row references.
   * That makes them safe to take as already present, which is what turns a push
   * of an unchanged project from two round trips per file into none.
   *
   * Scoped to the record rather than kept as one global set, deliberately. A
   * hash this project does not reference could have been collected when some
   * other project was deleted, and trusting it then would commit a row pointing
   * at an object that is gone.
   */
  pushedHashes?: string[];
  /**
   * The user template this project *is*, when it was opened with Edit Template.
   *
   * KiCad's onEditTemplate opens the template's own .kicad_pro in place, so the
   * template directory and the project directory are the same thing and editing
   * one edits the other. There is no shared directory here, so the link is
   * recorded and `updateProjectFiles` mirrors each save back into the template
   * store. Absent on every ordinary project, which is nearly all of them.
   */
  templateId?: string;
  /**
   * Set on a user-data folder — `templates`, `symbols`, `footprints`,
   * `models3d` — and absent on every project. See `ensureUserDir`.
   *
   * The MARKER is here rather than in the id, because the id has to be a plain
   * UUID: the cloud's `projects.id` column is `uuid`, so a readable id like
   * `userdir:footprints` was rejected by Postgres on the first push with
   * `invalid input syntax for type uuid`, taking four projects' sync down with
   * it. Encoding meaning in a key that another system parses is what broke;
   * a field of its own cannot.
   */
  userDir?: string;
}

/**
 * Where a save of a template-backed project is mirrored to.
 *
 * A hook rather than a direct call: the template store is a feature built on
 * top of the project store, and having the project store import it would point
 * the dependency the wrong way and drag the template code into every context
 * that touches a project. Installed once, in main.tsx.
 */
type TemplateSink = (templateId: string, files: StoredFile[], projectName: string) => Promise<void>;
let templateSink: TemplateSink | null = null;

export function setTemplateSink(sink: TemplateSink | null): void {
  templateSink = sink;
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

/**
 * The projects database.
 *
 * Through `idbHandle` so that a connection the browser drops - evicted, quota
 * reclaimed, a private window discarding - is opened again on the next call
 * instead of being handed out dead forever. That failure reads as
 * "The database connection is closing" on every transaction from then on, and
 * used to need a reload to clear.
 */
const db = idbHandle(DB_NAME, VERSION, (d) => {
  if (!d.objectStoreNames.contains(STORE)) {
    const store = d.createObjectStore(STORE, { keyPath: 'id' });
    store.createIndex('updatedAt', 'updatedAt');
  }
});

const openDB = (): Promise<IDBDatabase> => db.get();

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
export async function saveProject(
  name: string,
  files: StoredFile[],
  id?: string,
  templateId?: string,
  /** Marks the record as a user-data folder rather than a project. */
  userDir?: string,
): Promise<string> {
  const now = Date.now();
  const pid = id ?? crypto.randomUUID?.() ?? `p${now}-${Math.random().toString(36).slice(2)}`;
  const gzFiles = await Promise.all(
    files.map(async (f) => {
      const gz = await gzip(f.bytes);
      // `size` is the file's own length and `writtenAt` is when this file
      // changed, both free here and a gunzip away afterwards. The chooser's
      // Size and Modified columns are about the file, not about the blob or
      // about the project.
      return {
        name: f.name,
        gz,
        hash: await sha256Hex(gz),
        size: f.bytes.byteLength,
        writtenAt: now,
      };
    }),
  );
  // This rebuilds the record rather than patching it, so anything not carried
  // across here is silently dropped on every save. `createdAt` was already
  // read back for that reason; `syncedAt` has to be too.
  let existing: StoredRecord | undefined;
  if (id) existing = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));

  const record: StoredRecord = {
    id: pid,
    name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastOpenedAt: now,
    files: gzFiles,
    // The sync watermark survives an ordinary save. Dropping it would make
    // `updatedAt > syncedAt` — the definition of "this side diverged" — never
    // true, because the first local edit after a sync would erase the very
    // thing the comparison is against, and the conflict protection (#367)
    // would be inert exactly when it is needed.
    ...(existing?.syncedAt !== undefined ? { syncedAt: existing.syncedAt } : {}),
    // Carried for the same reason as the watermark above: this save changes
    // what is on this machine, not which blobs the cloud row points at. Dropping
    // it would make every save re-examine every file on the next push.
    ...(existing?.pushedHashes ? { pushedHashes: existing.pushedHashes } : {}),
    // The version the cloud row was at when the two sides last agreed. A save
    // edits this machine's copy; it does not move the cloud's, so the base the
    // next push names is unchanged. Dropping it would make the push claim the
    // project is new, and its commit would then refuse to overwrite the row it
    // was derived from.
    ...(existing?.baseVersion !== undefined ? { baseVersion: existing.baseVersion } : {}),
    // Which cloud project this is a copy of, and what this user may do with it.
    // A save changes the contents of a project; it never changes whose project
    // it is. Dropping these would turn a project shared with this user into one
    // that looks like their own the moment they edit it -- and the next sync,
    // seeing a local project the cloud has no row for, would push it up as a
    // *new* project in their account: someone else's board, silently copied.
    ...(existing?.cloudUid ? { cloudUid: existing.cloudUid } : {}),
    ...(existing?.cloudId ? { cloudId: existing.cloudId } : {}),
    ...(existing?.cloudOwnerId ? { cloudOwnerId: existing.cloudOwnerId } : {}),
    ...(existing?.cloudRole ? { cloudRole: existing.cloudRole } : {}),
    // And what those two sides agreed *on*. This is the one that must survive:
    // divergence is "the files differ from these", so a save that erased it
    // would answer "not diverged" for the edit that just happened — the exact
    // shape of the `syncedAt` bug above, one field along.
    ...(existing?.syncedHashes ? { syncedHashes: existing.syncedHashes } : {}),
    // Falls back to the record's existing owner rather than dropping it: an
    // unowned record is visible to every account on the browser, so saving
    // while signed out must not un-own somebody's project.
    ...((currentOwner ?? existing?.ownerId)
      ? { ownerId: (currentOwner ?? existing?.ownerId)! }
      : {}),
    // Carried for the same reason again: the link back to the template this
    // project is editing is a property of the record, not of one save, and the
    // save path below is what mirrors the files into the template store. Drop
    // it here and Edit Template would edit the template exactly once.
    ...((templateId ?? existing?.templateId)
      ? { templateId: (templateId ?? existing?.templateId)! }
      : {}),
    // Carried for the same reason as the rest: a save rebuilds the record, and
    // an empty folder is not derivable from the files — dropping it here would
    // delete the folder the user made the moment anything else was saved.
    ...(existing?.emptyFolders ? { emptyFolders: existing.emptyFolders } : {}),
    // Carried for the same reason as the rest: a save rebuilds the record, and
    // a folder that forgot it was one would appear in the project list.
    ...(existing?.userDir ? { userDir: existing.userDir } : {}),
    ...(userDir ? { userDir } : {}),
  };
  await tx('readwrite', (s) => s.put(record));
  return pid;
}

/** All saved projects, newest first, without decompressing file bodies. */
/**
 * The account's user-data folders, as reserved records in this same store.
 *
 * Upstream these are real directories, siblings of the project folders, and
 * every one is a `PATHS::` call — `GetUserTemplatesPath()`,
 * `GetDefaultUserSymbolsPath()` and the rest (see `fs/chooser_places.ts`). A
 * drawing sheet saved from pl_editor lands in `template/` as a loose file
 * (pagelayout_editor/files.cpp:199-202), and a directory holds whatever you put
 * in it: files, and folders inside those.
 *
 * They are records here rather than a second database, and that is the whole
 * design decision. A record already knows how to hold a flat list of relative
 * paths, its empty folders, its gzip blobs, its sync watermark and its owner —
 * which means `project_store_fs` needs no special case for any operation, and
 * `listSyncMeta` pushes a user's templates to the cloud with no code at all.
 * The predecessor was a `template-files` object store in `ziroeda-templates`
 * that only ever backed Templates, leaving Symbols, Footprints and 3D Models as
 * sidebar rows with nothing behind them.
 *
 * They are NOT projects, so `listProjects` leaves them out — the home screen's
 * project list, its Recent row and the Open Project dialog would otherwise
 * offer "Templates" as a board to open. `PROBE_ID` is excluded from that same
 * list for the same reason.
 */
/**
 * The ids of the four folders — fixed UUIDs, one per kind.
 *
 * Fixed, so the same folder is the same row on every device the account signs
 * in from, and the sync converges instead of making a second Templates. Safe to
 * share across accounts because the cloud's primary key is `(user_id, id)`, not
 * `id` — see `commit_project`, which scopes both its insert and its update by
 * `auth.uid()`.
 *
 * They are UUIDs and not `userdir:templates` because `projects.id` is a `uuid`
 * column. The readable form reached Postgres on the first push and came back
 * `invalid input syntax for type uuid`, which failed the whole sync run — four
 * real projects stopped syncing because of a folder.
 */
export const USER_DIR_IDS: Record<string, string> = {
  templates: '9a7c1e40-0000-4000-8000-000000000001',
  symbols: '9a7c1e40-0000-4000-8000-000000000002',
  footprints: '9a7c1e40-0000-4000-8000-000000000003',
  models3d: '9a7c1e40-0000-4000-8000-000000000004',
};

/**
 * Which folder a record is, from its id or from what this side already knows.
 *
 * The id half is what survives a pull: the cloud carries no marker, so the four
 * fixed UUIDs are the only thing that says a row is a folder rather than a
 * board. The local half covers a record whose id is the per-owner derived one,
 * which no lookup can reverse.
 */
const userDirOf = (id: string, local?: { userDir?: string }): string | undefined =>
  Object.entries(USER_DIR_IDS).find(([, v]) => v === id)?.[0] ?? local?.userDir;

/** The ids the first version of this used, before the cloud rejected them. */
const LEGACY_USER_DIR_ID = (key: string): string => `userdir:${key}`;

/**
 * Move any folder still under a readable id onto its UUID. Once per page load.
 *
 * This has to run whether or not anything asks for a folder, and that is the
 * whole reason it exists as its own function. It lived inside `ensureUserDir`,
 * which only runs when something LISTS the account tree — and the home screen
 * shows the project tree, not the file manager. So a person could sign in,
 * never open a file dialog, and the sync would still find four `userdir:*` rows
 * in the store and fail on every one of them. Which is what happened.
 *
 * A left-behind row is not inert: `listSyncMeta` returns every record that is
 * not the health probe, so anything the cloud cannot parse is a failed transfer
 * on every sync until it is gone.
 *
 * Not tied to the database version. An `onupgradeneeded` fires once per browser
 * and only when the version moves, so a migration there is unrepeatable and
 * would need a version bump on the store holding the user's actual work.
 */
async function migrateUserDirIds(): Promise<void> {
  // Deliberately NOT memoised. The two obvious caches are both wrong: caching
  // the run makes it once per module, so a row that appears afterwards sits
  // there until the next reload and no test can reach the second call; caching
  // "it came back clean" has the same hole one pass later. What it costs
  // instead is four keyed `get`s, against a `listProjects` that already reads
  // every record in the store — noise next to the call it guards.
  try {
    for (const key of Object.keys(USER_DIR_IDS)) {
      const legacyId = LEGACY_USER_DIR_ID(key);
      const legacy = await tx<StoredRecord | undefined>('readonly', (s) => s.get(legacyId));
      if (!legacy) continue;
      // Moved rather than dropped: it holds whatever was saved into it while
      // the readable ids were live, and the Templates seed cannot bring that
      // back — it only knows the older `template-files` store.
      const id = USER_DIR_IDS[key]!;
      const already = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
      if (!already) await tx('readwrite', (s) => s.put({ ...legacy, id, userDir: key }));
      await tx('readwrite', (s) => s.delete(legacyId));
    }
  } catch {
    // A browser refusing IndexedDB. The rows stay where they are and the sync
    // keeps reporting them, which is better than a home screen that will not
    // load.
  }
}

/**
 * A UUID for this account's copy, when another account already holds the fixed
 * one in THIS browser's database.
 *
 * Derived from the owner so it is stable across reloads rather than a fresh
 * random each time, and shaped as a v4 UUID so Postgres accepts it.
 */
async function derivedUserDirId(key: string, owner: string): Promise<string> {
  const h = await sha256Hex(new TextEncoder().encode(`userdir:${key}:${owner}`));
  const v = h.slice(0, 32);
  return [
    v.slice(0, 8),
    v.slice(8, 12),
    `4${v.slice(13, 16)}`,
    `${'89ab'[Number.parseInt(v[16]!, 16) & 3]}${v.slice(17, 20)}`,
    v.slice(20, 32),
  ].join('-');
}

/**
 * The record id this account's `key` folder uses, creating nothing.
 *
 * Normally the fixed UUID. When a record is already there under another
 * account's ownership — two people signing in on one browser, which is exactly
 * what `ownedByCurrent` exists to handle — this account gets its own instead of
 * being handed someone else's templates.
 */
async function userDirId(key: string): Promise<string> {
  const base = USER_DIR_IDS[key]!;
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(base));
  if (!r || ownedByCurrent(r)) return base;
  return currentOwner ? await derivedUserDirId(key, currentOwner) : base;
}

/**
 * The folder's record, made the first time anything touches it.
 *
 * `updateProjectFiles` returns silently when the record is missing, so a save
 * into a folder that was never created would report success and write nothing.
 * Creating it on resolve is what makes the folder EXIST, which is the same
 * thing `mkdir -p` means.
 */
export async function ensureUserDir(
  key: string,
  name: string,
  /**
   * Files to put in it at the moment it is created, and never afterwards.
   *
   * The one caller is Templates, carrying across the loose sheets the old
   * `template-files` store holds — see `legacyTemplateFiles`. Seeding on
   * creation rather than on every resolve is what makes it a migration instead
   * of a mirror: a file the user deletes here does not come back.
   */
  seed?: () => Promise<StoredFile[]>,
): Promise<ProjectMeta> {
  await migrateUserDirIds();
  const id = await userDirId(key);
  let r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) {
    await saveProject(name, seed ? await seed().catch(() => []) : [], id, undefined, key);
    r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  }
  const now = Date.now();
  return {
    id,
    name,
    createdAt: r?.createdAt ?? now,
    updatedAt: r?.updatedAt ?? now,
    fileCount: r?.files.length ?? 0,
    bytes: r?.files.reduce((n, f) => n + f.gz.byteLength, 0) ?? 0,
  };
}

export async function listProjects(): Promise<ProjectMeta[]> {
  await migrateUserDirIds();
  const all = await tx<StoredRecord[]>('readonly', (s) => s.getAll());
  return (
    all
      .filter((r) => r.id !== PROBE_ID) // health-probe canary, not a project
      .filter((r) => r.userDir === undefined) // Templates/Symbols/... are folders, not projects
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
  let mirrorTo: string | undefined;
  let mirrorName = '';
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    const byName = new Map(r.files.map((f) => [f.name, f]));
    const now = Date.now();
    // Whether any of these bytes are actually new.
    //
    // The schematic editor re-serializes and hands its sheets up 900 ms after a
    // project is *opened*, not only after it is edited — its own comment says
    // "fires on sheet switch/load too, re-saving identical content". Writing
    // that restamped `updatedAt`, which made the record look newer than the
    // cloud and look diverged from it, so merely opening a tab could overwrite
    // another machine's real work and fork a "(local copy)" aside. Comparing the
    // hash first makes an identical save cost a hash and change nothing.
    let dirty = false;
    for (const f of changed) {
      const gz = await gzip(f.bytes);
      const hash = await sha256Hex(gz);
      if (byName.get(f.name)?.hash === hash) continue;
      dirty = true;
      byName.set(f.name, { name: f.name, gz, hash, size: f.bytes.byteLength, writtenAt: now });
    }
    // Nothing changed, so nothing is recorded as having changed. Returning here
    // also skips the template mirror, which would otherwise rewrite the template
    // on every open for exactly the same reason.
    if (!dirty) return;
    r.files = [...byName.values()];
    r.updatedAt = now;
    await tx('readwrite', (s) => s.put(r));
    mirrorTo = r.templateId;
    mirrorName = r.name;
  });
  // Outside the record lock: the template store is a different database, and
  // holding this project's lock across a write to it only widens the window in
  // which a second tab is blocked. Best-effort - a template that fails to
  // update must not fail the project save that already committed.
  if (mirrorTo && templateSink) {
    await templateSink(mirrorTo, changed, mirrorName).catch((e) =>
      console.warn('Template mirror failed:', e),
    );
  }
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
  // Repair the extra folder level an old folder-import left, before anything
  // reads the names. Lazily, on open: a sweep over every project at startup
  // would be a write on read and would touch records the user never asked
  // about. Declines by itself when there is nothing to repair, so this costs
  // one record read per open. See `flattenImportedRoot`.
  await flattenImportedRoot(id);

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

/** One file of a project as a listing needs it: no bytes, only what to show. */
export interface ProjectFileMeta {
  /** Relative to the project folder — `sub/dir/board.kicad_pcb`. */
  name: string;
  /** The file's own length, uncompressed. */
  size: number;
  /** When this file was last written. */
  modified: number;
}

/**
 * A project's files without their bytes.
 *
 * This is the index, and it is what the file manager lists. `loadProject`
 * gunzips every file in the project, which is the right thing when opening one
 * and far too much for drawing a directory: a listing is answered from the
 * record's own metadata and touches no blob at all.
 *
 * Records written before `size` and `writtenAt` existed, and records pulled
 * from the cloud, carry neither. Those are measured once — the only gunzip
 * this function ever does — and written back, so the second listing of an old
 * project is as cheap as the first listing of a new one. The write-back does
 * not touch `updatedAt`: it records what was always true about bytes already
 * stored, and bumping the project's clock for it would make sync believe the
 * project had diverged and push the whole thing.
 */
export async function listProjectFiles(id: string): Promise<ProjectFileMeta[] | null> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return null;
  if (r.files.every((f) => f.size !== undefined))
    return r.files.map((f) => ({
      name: f.name,
      size: f.size!,
      modified: f.writtenAt ?? r.updatedAt,
    }));

  const measured = new Map<string, number>();
  for (const f of r.files) {
    if (f.size === undefined) measured.set(f.name, (await gunzip(f.gz)).byteLength);
  }
  await withRecordLock(id, async () => {
    const cur = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!cur) return;
    let changed = false;
    for (const f of cur.files) {
      const size = measured.get(f.name);
      // Only where it is still missing: another tab may have rewritten this
      // file between the read above and this lock, and its size is the one
      // that matches its bytes.
      if (size !== undefined && f.size === undefined) {
        f.size = size;
        changed = true;
      }
    }
    if (changed) await tx('readwrite', (s) => s.put(cur));
  });

  return r.files.map((f) => ({
    name: f.name,
    size: f.size ?? measured.get(f.name) ?? 0,
    modified: f.writtenAt ?? r.updatedAt,
  }));
}

/**
 * One file's bytes, or null when the project or the file is gone.
 *
 * The chooser lists from the index and pulls a file only when it is actually
 * opened; this is that pull's local half.
 */
export async function readProjectFile(id: string, name: string): Promise<Uint8Array | null> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  const f = r?.files.find((x) => x.name === name);
  return f ? await gunzip(f.gz) : null;
}

/** The folders of a project that hold no file — see `emptyFolders`. */
export async function listEmptyFolders(id: string): Promise<string[]> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  return r?.emptyFolders ?? [];
}

/**
 * Rewrite the empty-folder list.
 *
 * Whole-list rather than add/remove because the caller has just worked out
 * which folders are still empty, and two tabs disagreeing about one folder is
 * not worth a merge. Does not touch `updatedAt`: an empty folder is not
 * content, and a sync that pushed the whole project because somebody clicked
 * New Folder would be a poor trade.
 */
export async function setEmptyFolders(id: string, folders: string[]): Promise<void> {
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    r.emptyFolders = folders;
    await tx('readwrite', (s) => s.put(r));
  });
}

/**
 * Rename one file, or a whole folder, inside a project.
 *
 * `from` and `to` are project-relative. A folder is renamed by giving its own
 * path: every file beneath it moves with it, which is what renaming a
 * directory does.
 *
 * The bytes are not touched — a rename moves a name, and re-gzipping a
 * project's every file to change one of them would be work no filesystem does.
 * That is also why this is not `replaceProjectFiles`: expressing a rename as a
 * new file list would mean handing back bytes we already hold, compressed
 * again.
 *
 * Returns false when nothing matched.
 */
export async function renameProjectPath(id: string, from: string, to: string): Promise<boolean> {
  let moved = false;
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    const prefix = `${from}/`;
    for (const f of r.files) {
      if (f.name === from) {
        f.name = to;
        moved = true;
      } else if (f.name.startsWith(prefix)) {
        f.name = to + f.name.slice(from.length);
        moved = true;
      }
    }
    if (r.emptyFolders) {
      r.emptyFolders = r.emptyFolders.map((d) =>
        d === from || d.startsWith(prefix) ? to + d.slice(from.length) : d,
      );
      moved ||= r.emptyFolders.length > 0;
    }
    if (!moved) return;
    r.updatedAt = Date.now();
    await tx('readwrite', (s) => s.put(r));
  });
  return moved;
}

/**
 * Undo the extra folder level a picked folder used to leave behind.
 *
 * Until `stripCommonFolder` ran at ingest, a project imported from a FOLDER
 * stored every path with that folder's name on the front - and since the
 * project is itself named for it, the documents sat one level below the
 * project root. The root then listed a folder and nothing else, which is what
 * a Save As filtered to `.kicad_sch` showed: no schematic, in the project
 * whose schematic was open.
 *
 * This repairs the records that already carry it. It rewrites stored data, so
 * the rule is deliberately STRICTER than the ingest one, which only has to be
 * sensible about a fresh selection:
 *
 *   - every file shares one leading segment, and something is below it;
 *   - the project root currently holds NO file at all;
 *   - and stripping reveals a KiCad project document at the root.
 *
 * The third is what makes it a repair rather than a guess. A project that
 * genuinely keeps everything in one subfolder is left alone, because flattening
 * it would not put a `.kicad_pro`, `.kicad_sch` or `.kicad_pcb` at the root, and
 * that is the shape the defect always produces.
 *
 * Idempotent by construction: once it has run, the root holds files, so the
 * second condition fails and nothing happens.
 *
 * Returns the folder it removed, or null when it left the project alone.
 *
 * Not exported: `loadProject` is the only caller, and `wiring_guard` is right
 * that an exported durability function nothing else calls is either dead or
 * should not be exported. It is tested THROUGH `loadProject`, which is the
 * better test anyway - it proves the repair happens when a project is opened,
 * not merely that the function works when called.
 */
async function flattenImportedRoot(id: string): Promise<string | null> {
  let removed: string | null = null;

  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r || r.files.length === 0) return;

    const first = r.files[0]!.name.split('/');
    if (first.length < 2) return;

    const prefix = first[0]!;
    const shared = r.files.every((f) => {
      const parts = f.name.split('/');
      return parts.length > 1 && parts[0] === prefix;
    });
    if (!shared) return;

    // Stripping must reveal a project document at the root, or this is not the
    // defect and the folder is the user's own.
    const revealed = r.files.map((f) => f.name.slice(prefix.length + 1));
    const isDoc = (n: string): boolean =>
      !n.includes('/') && /\.(kicad_pro|kicad_sch|kicad_pcb)$/i.test(n);
    if (!revealed.some(isDoc)) return;

    r.files.forEach((f, i) => {
      f.name = revealed[i]!;
    });

    if (r.emptyFolders) {
      r.emptyFolders = r.emptyFolders
        .filter((d) => d === prefix || d.startsWith(`${prefix}/`))
        .map((d) => d.slice(prefix.length + 1))
        .filter((d) => d.length > 0);
    }

    r.updatedAt = Date.now();
    await tx('readwrite', (s) => s.put(r));
    removed = prefix;
  });

  return removed;
}

/**
 * Delete a file, or a folder and everything under it.
 *
 * Returns the number of files removed; an empty folder removes none and is
 * still a deletion, which is why the empty-folder list is pruned here too.
 */
export async function deleteProjectPath(id: string, path: string): Promise<number> {
  let removed = 0;
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    const prefix = `${path}/`;
    const kept = r.files.filter((f) => !(f.name === path || f.name.startsWith(prefix)));
    removed = r.files.length - kept.length;
    const folders = (r.emptyFolders ?? []).filter((d) => !(d === path || d.startsWith(prefix)));
    if (removed === 0 && folders.length === (r.emptyFolders ?? []).length) return;
    r.files = kept;
    r.emptyFolders = folders;
    r.updatedAt = Date.now();
    await tx('readwrite', (s) => s.put(r));
  });
  return removed;
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
 * Record which cloud project this local record is a copy of.
 *
 * Called whenever the identity is learned: from a pull, from the first listing
 * that reports a `uid` for a project pushed before the column existed, and from
 * a push that created the row.
 *
 * Separate from `claimProject` because it answers a different question.
 * `ownerId` is *which signed-in account this browser record is filed under*,
 * which for a shared project is still the person reading it; `cloudOwnerId` is
 * *who owns the project in the cloud*, which is where its blobs live and who
 * may delete it. Conflating them is what would push another person's project
 * into this user's account.
 */
export async function linkCloudProject(
  id: string,
  cloud: {
    uid?: string;
    cloudId?: string;
    ownerId?: string;
    role?: 'owner' | 'editor' | 'viewer';
  },
): Promise<void> {
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    if (cloud.uid) r.cloudUid = cloud.uid;
    // Only when it differs: for the user's own project the cloud row's id *is*
    // the local one, and storing it twice invites the two to drift apart.
    if (cloud.cloudId && cloud.cloudId !== id) r.cloudId = cloud.cloudId;
    if (cloud.ownerId) r.cloudOwnerId = cloud.ownerId;
    if (cloud.role) r.cloudRole = cloud.role;
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
export async function markSynced(
  id: string,
  pushedHashes?: string[],
  version?: number,
): Promise<void> {
  await withRecordLock(id, async () => {
    const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
    if (!r) return;
    r.syncedAt = r.updatedAt;
    // Recorded together, and only here, so the three cannot disagree: these are
    // the blobs the row that just landed refers to, and that is the version it
    // landed as — the base the next push has to name.
    if (pushedHashes) {
      r.pushedHashes = pushedHashes;
      // The push sent this record's files, so these are also the contents the
      // two sides now agree on.
      r.syncedHashes = pushedHashes;
    }
    if (version !== undefined) r.baseVersion = version;
    await tx('readwrite', (s) => s.put(r));
  });
}

/**
 * Blob hashes this project's cloud row is known to reference, from the last
 * push that landed. Empty when it has never pushed.
 */
export async function knownPushedHashes(id: string): Promise<Set<string>> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  return new Set(r?.pushedHashes ?? []);
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
  /** The cloud version this copy is derived from; see `StoredRecord.baseVersion`. */
  baseVersion?: number;
  /**
   * Where this project lives in the cloud, when that is not simply "mine".
   *
   * `id` above is the *local* key — the one IndexedDB files this record under —
   * and for a project shared with this user it is deliberately not the id the
   * cloud row carries. These four say what the cloud copy actually is; see the
   * matching fields on `StoredRecord`.
   */
  cloudUid?: string;
  cloudId?: string;
  cloudOwnerId?: string;
  cloudRole?: 'owner' | 'editor' | 'viewer';
  /**
   * `gzB64` is the file's stored bytes, base64 encoded — and is optional
   * because encoding them is expensive enough to matter. A 10 MB project turns
   * into a 13 MB string and about 400 ms of main-thread work, which a push was
   * paying on every save even when one file had changed and nothing needed
   * uploading at all.
   *
   * A manifest omits it and supplies `bytesOf` instead, so only the files that
   * actually have to be stored are ever read. `hash` and `size` come from the
   * local store, where they were computed when the bytes were written.
   */
  files: { name: string; gzB64?: string; hash?: string; size?: number }[];
  /** Read one file's stored bytes, for a manifest that carries none. */
  bytesOf?: (name: string) => Promise<Uint8Array>;
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
export async function listSyncMeta(): Promise<
  {
    id: string;
    baseVersion?: number;
    diverged: boolean;
    cloudUid?: string;
    cloudOwnerId?: string;
    cloudRole?: 'owner' | 'editor' | 'viewer';
  }[]
> {
  // Before the list, not after: this is the call that decides what gets pushed,
  // and a readable id reaching Postgres is the failure it has to prevent.
  await migrateUserDirIds();
  const all = await tx<StoredRecord[]>('readonly', (s) => s.getAll());
  // The filter is the fix for cross-account leakage: sync compares this list
  // against the cloud, and row-level security means another account's rows are
  // invisible, so anything left in here would look local-only and be pushed up
  // under the wrong owner.
  return Promise.all(
    all
      .filter((r) => r.id !== PROBE_ID && ownedByCurrent(r))
      .map(async (r) => ({
        id: r.id,
        ...(r.baseVersion !== undefined ? { baseVersion: r.baseVersion } : {}),
        // How this record is matched to a cloud row, and whether it may be
        // pushed at all. Matching on `id` alone stopped being sound once a
        // project belonging to somebody else could be sitting in this store.
        ...(r.cloudUid ? { cloudUid: r.cloudUid } : {}),
        ...(r.cloudOwnerId ? { cloudOwnerId: r.cloudOwnerId } : {}),
        ...(r.cloudRole ? { cloudRole: r.cloudRole } : {}),
        diverged: await divergedFrom(r),
      })),
  );
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
    ...(r.baseVersion !== undefined ? { baseVersion: r.baseVersion } : {}),
    files: r.files.map((f) => ({
      name: f.name,
      gzB64: bytesToB64(f.gz),
      ...(f.hash ? { hash: f.hash } : {}),
      // Carried so the other side does not have to gunzip the whole project to
      // learn how big its files are. `SyncableProject` has always had the
      // field; nothing filled it in.
      ...(f.size !== undefined ? { size: f.size } : {}),
    })),
  };
}

/**
 * Whether a set of stored files is damage rather than data.
 *
 * gzip of even an empty file is around twenty bytes, so a project whose blobs
 * are *all* zero-length is not a project of empty files. It is the signature of
 * a record that has already lost its contents, and the reason this predicate
 * exists is that eleven projects reached exactly that state and every layer
 * treated it as ordinary data.
 *
 * A project with no files at all is left out: that is a real state, not damage.
 */
export const isHollowRecord = (files: { gz: Uint8Array }[]): boolean =>
  files.length > 0 && files.every((f) => f.gz.byteLength === 0);

/** Write a project from its serializable form, preserving its timestamps. */
export async function importProject(p: SyncableProject): Promise<void> {
  // A pull always carries bytes; a manifest (the push shape) never reaches here.
  //
  // A file from a legacy row carries no hash, so one is computed from the bytes
  // that just arrived. That is the same SHA-256 the store would key it under,
  // it costs one hash per file on a pull, and it is what lets divergence be
  // measured for a project whose cloud copy predates content addressing. It
  // does *not* make the blob present in the object store; see `syncedHashes`.
  const files = await Promise.all(
    p.files.map(async (f) => {
      const gz = b64ToBytes(f.gzB64 ?? '');
      return { name: f.name, gz, hash: f.hash ?? (await sha256Hex(gz)), size: f.size };
    }),
  );

  // The last line of defence, and the one that would have held when the others
  // did not. Whatever the layers above believe, an incoming copy with no
  // contents does not get to replace a local copy that has some.
  if (isHollowRecord(files)) {
    const existing = await tx<StoredRecord | undefined>('readonly', (s) => s.get(p.id));
    if ((existing?.files ?? []).some((f) => f.gz.byteLength > 0)) {
      throw new Error(
        `refusing to overwrite "${existing?.name ?? p.id}" with an empty copy: ` +
          `all ${files.length} incoming files have no contents`,
      );
    }
  }

  // What this side already knows that the cloud does not carry. An empty
  // folder is not content and `SyncableProject` has no field for one, so a
  // pull that rebuilt the record without it would quietly delete a folder the
  // user made every time the project came down.
  const local = await tx<StoredRecord | undefined>('readonly', (s) => s.get(p.id));

  const record: StoredRecord = {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    files,
    ...(local?.emptyFolders ? { emptyFolders: local.emptyFolders } : {}),
    // A user-data folder stays one after a pull. `SyncableProject` has no field
    // for the marker and the cloud row has no column for it, so it is recovered
    // from the id — which is exactly why those ids are FIXED. Without this, the
    // first sign-in on a second device would pull Templates, Symbols,
    // Footprints and 3D Models down as four projects to open.
    ...(userDirOf(p.id, local) ? { userDir: userDirOf(p.id, local)! } : {}),
    // We have just taken the cloud's copy wholesale, so this is the point the
    // two sides agree — and this is the version they agree on, which the next
    // push must name as the one it replaces.
    syncedAt: p.updatedAt,
    ...(p.baseVersion !== undefined ? { baseVersion: p.baseVersion } : {}),
    // What was just taken, whatever shape the row was in. Divergence is
    // measured against this.
    syncedHashes: files.map((f) => f.hash),
    ...(currentOwner ? { ownerId: currentOwner } : {}),
    // Which cloud project this is a copy of, and what this user may do with it.
    // Recorded on every pull, so a record that arrived before these existed
    // picks them up the first time it comes down again.
    ...(p.cloudUid ? { cloudUid: p.cloudUid } : {}),
    ...(p.cloudId && p.cloudId !== p.id ? { cloudId: p.cloudId } : {}),
    ...(p.cloudOwnerId ? { cloudOwnerId: p.cloudOwnerId } : {}),
    ...(p.cloudRole ? { cloudRole: p.cloudRole } : {}),
    // The row this came from names exactly these blobs, so they are the ones a
    // later push can take as already stored. Absent when the cloud copy was in
    // one of the older shapes, which carry no hashes.
    ...(p.files.every((f) => f.hash) ? { pushedHashes: p.files.map((f) => f.hash!) } : {}),
  };
  await tx('readwrite', (s) => s.put(record));
}

/**
 * The project as a manifest: names, hashes and sizes, with the bytes left in
 * the store until something asks for them.
 *
 * `exportProject` base64-encodes every file, which is the right shape for a
 * pull and the wrong one for a push: the push needs bytes only for files it is
 * going to upload, and usually that is none of them.
 *
 * A file stored before hashes were recorded has none, so its bytes are read and
 * hashed here. That is the old cost, paid once per file rather than every save.
 */
export async function exportManifest(id: string): Promise<SyncableProject | null> {
  const r = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
  if (!r) return null;
  const files = await Promise.all(
    r.files.map(async (f) => ({
      name: f.name,
      hash: f.hash ?? (await sha256Hex(f.gz)),
      size: f.gz.byteLength,
    })),
  );
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(r.baseVersion !== undefined ? { baseVersion: r.baseVersion } : {}),
    // A push has to name the row it is writing, not the local record: for a
    // shared project those are different ids, in different accounts.
    ...(r.cloudUid ? { cloudUid: r.cloudUid } : {}),
    ...(r.cloudId ? { cloudId: r.cloudId } : {}),
    ...(r.cloudOwnerId ? { cloudOwnerId: r.cloudOwnerId } : {}),
    ...(r.cloudRole ? { cloudRole: r.cloudRole } : {}),
    files,
    bytesOf: async (name: string) => {
      // Re-read rather than close over the record: a push runs alongside
      // autosave, and the bytes wanted are the ones in the store now.
      const cur = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id));
      const hit = cur?.files.find((f) => f.name === name);
      if (!hit) throw new Error(`"${name}" is no longer in project ${id}`);
      return hit.gz;
    },
  };
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
  return !!r && (await divergedFrom(r));
}

/**
 * Whether this record's contents differ from the ones its last agreed cloud
 * version referenced.
 *
 * **Content, not time.** The old test was `updatedAt > syncedAt`, and
 * `updateProjectFiles` restamps `updatedAt` on every write including one that
 * stores byte-identical files — which the schematic editor performs 900 ms after
 * a project is merely *opened*. So opening a tab and touching nothing marked the
 * project as diverged, and a pull then forked it aside as unsynced work. That is
 * where `ACtoDCconverter (local copy, 2026-09-01)` and its siblings came from.
 *
 * Comparing the blob hashes instead makes the question the one actually being
 * asked. A record that has never agreed with the cloud is not diverged: forking
 * on a first sync would fork every project the first time somebody signs in.
 */
async function divergedFrom(r: StoredRecord): Promise<boolean> {
  // `syncedHashes` where it exists, falling back to `pushedHashes` for records
  // written before the two were told apart — for those the push path set it and
  // the meanings coincide.
  const agreed = r.syncedHashes ?? r.pushedHashes;
  if (!agreed) return false; // never synced: nothing to have diverged from
  const then = new Set(agreed);
  if (r.files.length !== then.size) return true;
  // A file written before hashes were recorded has none, so it is hashed here
  // rather than counted as a difference. Treating "unknown" as "changed" would
  // fork every legacy record once, which is the failure mode being removed.
  for (const f of r.files) {
    const h = f.hash ?? (await sha256Hex(f.gz));
    if (!then.has(h)) return true;
  }
  return false;
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
 * Returns the new id, or null when there is nothing to copy.
 *
 * The copy has no `syncedAt` — it has never agreed with the cloud, and pushing
 * it anywhere is the user's decision to make later — but it **does** carry the
 * current owner. An unowned record is visible to every account on the browser
 * (`ownedBy` treats `undefined` as "anyone's"), and this record is a copy of
 * the signed-in user's board: leaving it unowned would show one person's work
 * to the next person who signs in on a shared machine, which is the exact leak
 * `ownedByCurrent` exists to stop.
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
    // A copy of the project is a copy of its folders too, empty ones included.
    ...(r.emptyFolders ? { emptyFolders: r.emptyFolders } : {}),
    // The original's owner, falling back to whoever is signed in now. Not
    // omitted: see above.
    ...((r.ownerId ?? currentOwner) ? { ownerId: r.ownerId ?? currentOwner! } : {}),
    // `cloudUid`, `cloudId`, `cloudOwnerId` and `cloudRole` are deliberately
    // absent, and carrying them would be actively dangerous. This copy is a new
    // local project with a fresh id and no cloud row; naming the original's
    // project would point its first push straight at that row -- so forking a
    // shared project aside to rescue your own edits would commit them over the
    // work you were forking away from. A fork is yours, and unshared.
  };
  await tx('readwrite', (s) => s.put(copy));
  return copyId;
}
