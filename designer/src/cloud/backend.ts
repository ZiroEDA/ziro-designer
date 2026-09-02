// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The transport the cloud store talks to, as an interface.
 *
 * ### Why this exists
 *
 * The previous design called the Supabase client directly from the store, so
 * every code path that mattered ran only in a browser against a live database.
 * Nothing could exercise a *failing* transport, and that is precisely where the
 * bugs were: `supabase.storage.upload()` reports failure by returning
 * `{ data, error }` rather than throwing, the store never read `error`, and a
 * push whose every blob upload had failed reported success and then rewrote the
 * row that held the only surviving copy of the files.
 *
 * So the rule this file encodes is: **a method here either fulfils its contract
 * or rejects.** No result-object to forget to check, no empty value standing in
 * for an error. `supabaseBackend.ts` is the single place where Supabase's
 * `{ data, error }` convention is translated, and it is three dozen lines that
 * can be read in one sitting. Everything above it is ordinary logic over an
 * interface, testable against a backend that fails on demand — which is what
 * `qa/unittests/designer/cloud_store.test.ts` does.
 *
 * The same shape as `setFontProvider` and the injected measuring context in
 * `canvas_font_provider.ts`: a path that only runs in a browser is a path
 * nobody checks.
 */

/**
 * A file in the current row shape: a name, the hash of its gzipped bytes, and
 * that blob's length.
 *
 * The hash *is* the storage key, so a manifest entry is a durable reference to
 * exact content rather than to a mutable location. See `blobStore.ts`.
 */
export interface ManifestEntry {
  name: string;
  hash: string;
  size: number;
}

/** Legacy shape: blobs base64-encoded inline in the Postgres row. */
export interface InlineFile {
  name: string;
  gzB64: string;
}

/**
 * Legacy shape: the row lists names only, blobs live at a path built from the
 * project id and the file name. This is the shape that lost data — the path is
 * mutable, so a re-push overwrites in place and a failed one leaves the row
 * pointing at nothing.
 */
export interface NamedFile {
  name: string;
}

export type RowFile = ManifestEntry | InlineFile | NamedFile;

export const isManifestEntry = (f: RowFile): f is ManifestEntry =>
  typeof (f as ManifestEntry).hash === 'string';
export const isInlineFile = (f: RowFile): f is InlineFile =>
  typeof (f as InlineFile).gzB64 === 'string';

/** A row of the `projects` table. */
export interface ProjectRow {
  id: string;
  user_id?: string;
  name: string;
  created_at: string;
  /**
   * Display only, and stamped by the server. Nothing decides anything from it.
   *
   * It used to hold whatever `Date.now()` the browser said and to be the entire
   * basis of reconciliation, so two machines' clocks were compared as if they
   * were one. `version` answers that question now; see `commitProject`.
   */
  updated_at: string;
  /**
   * The row's commit counter, incremented by every write that lands.
   *
   * Absent only on a row read through a path that did not select it.
   */
  version?: number;
  files: RowFile[];
}

/**
 * Storage and database operations, every one of which throws on failure.
 *
 * Object operations are content-addressed by convention: `putObject` is only
 * ever called with a path derived from the hash of `bytes`, which makes it
 * idempotent — writing the same path twice writes identical content — and makes
 * an overwrite incapable of destroying anything.
 */
export interface CloudBackend {
  /** Every project of the signed-in user: id and current version only. */
  listProjects(): Promise<{ id: string; version: number }[]>;

  /** One project row, or null when the user has no such project. */
  getProject(id: string): Promise<ProjectRow | null>;

  /**
   * Write the row, but only if it is still at `base`. Returns the new version,
   * or **null** when the row has moved on and this caller is stale.
   *
   * Called only after every blob its manifest names is known to be stored, so a
   * row never references an object that is not there.
   *
   * `base` of 0 means "this project is new": the write lands only if no such
   * row exists. An upsert there would silently overwrite a project another
   * device created under the same id, which is not a hypothetical -- ids are
   * fixed for the user-data folders.
   *
   * Null rather than a throw because a stale base is an ordinary outcome of two
   * devices editing, not a fault. The caller pulls and reconciles; every real
   * failure still rejects.
   */
  commitProject(row: ProjectRow & { user_id: string }, base: number): Promise<number | null>;

  deleteProject(id: string): Promise<void>;

  /** Store bytes at a path. Resolves only when the object is durably written. */
  putObject(path: string, bytes: Uint8Array): Promise<void>;

  /** Read an object. Rejects when it is missing or unreadable — never returns empty. */
  getObject(path: string): Promise<Uint8Array>;

  /** Whether an object is present. Used to skip re-uploads and to verify a commit. */
  hasObject(path: string): Promise<boolean>;

  /** Remove objects. The only destructive operation in the interface. */
  removeObjects(paths: string[]): Promise<void>;

  /**
   * Append a committed manifest to the project's history, if the database has
   * the table for it.
   *
   * Optional and best-effort: history is what makes a bad commit recoverable
   * rather than final, but a deployment whose SQL migration has not been run
   * yet must still sync rather than fail. See `supabase/manifest.sql`.
   */
  recordVersion?(userId: string, row: ProjectRow): Promise<void>;

  /**
   * The project's committed manifests, newest first.
   *
   * The read half of `recordVersion`, and the reason keeping history was worth
   * anything: when the current row turns out to reference blobs that are not in
   * the store, an earlier manifest may name blobs that still are. Blobs are
   * content-addressed and only ever collected when no row references them, so an
   * older version's objects frequently outlive the row that replaced it.
   *
   * Optional for the same reason as `recordVersion`: a database whose migration
   * has not been run has no such table, and must still sync.
   */
  listVersions?(
    userId: string,
    projectId: string,
  ): Promise<{ name: string; files: RowFile[]; committed_at: string }[]>;

  /**
   * Every settings file the signed-in user has stored, with its bytes.
   *
   * Optional for the same reason as `recordVersion`: a database whose
   * `supabase/user_settings.sql` migration has not been run has no such table,
   * and the app must still work. localStorage is the source of truth either
   * way; the account copy is only what makes it follow the person to another
   * machine. See `settingsSync.ts`.
   *
   * Whole rows rather than a metadata listing: a user's seven settings files
   * together are a few kilobytes, so a second round trip to fetch the ones that
   * turned out to need pulling would cost more than it saved. That is the
   * opposite call from projects, where the manifest exists precisely because
   * the bytes are megabytes.
   */
  getSettings?(): Promise<SettingsRow[]>;

  /**
   * Write one settings file, returning the row's new `updated_at`.
   *
   * The timestamp comes back rather than being supplied because it is the
   * *server's* clock, and one clock shared by every device is what lets "the
   * account moved since we last agreed" be decided exactly. See `SliceStamp`.
   */
  putSettings?(row: {
    user_id: string;
    key: string;
    version: number;
    value: unknown;
  }): Promise<{ updated_at: string }>;
}

/** A row of the `user_settings` table: one KiCad settings file. */
export interface SettingsRow {
  /** The file's basename — `common`, `eeschema`, `colors.user`, `hotkeys`, … */
  key: string;
  /** `meta.version`, the schema version of the build that wrote it. */
  version: number;
  value: unknown;
  updated_at: string;
}
