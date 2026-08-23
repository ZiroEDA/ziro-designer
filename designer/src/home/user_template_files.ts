// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Loose files in the user templates root.
 *
 * `PATHS::GetUserTemplatesPath()` is a real DIRECTORY on disk — on Linux
 * `~/.local/share/kicad/<ver>/template/`, asked of a real wxFileDialog by
 * `qa/probes/savedlg_probe.cpp` — and a directory holds whatever you put in it.
 * KiCad's own `template/` holds the `default` project template as a folder, and
 * `PL_EDITOR_FRAME::Files_io` saves drawing sheets into that same directory as
 * loose `.kicad_wks` files (pagelayout_editor/files.cpp:199-202). Page Settings
 * then points at one by path, its browse button defaulting to that very
 * directory (dialog_page_settings.cpp:686-716).
 *
 * `user_templates.ts` models the FOLDERS in that directory — a template is a
 * record with its own file list. Nothing modelled the loose files, so a drawing
 * sheet had nowhere to go but into the open project, and a sheet in a project
 * is reachable from that project alone. This is the other half of the same
 * directory: a flat path -> text store, in the templates database beside the
 * template records, so the two halves of one folder live in one place.
 *
 * The database version goes 1 -> 2 for the new object store. That is a
 * migration on the TEMPLATES database, which is separate from `ziroeda`
 * /`projects` precisely so a schema change here cannot touch the user's actual
 * work — see the head of `user_templates.ts`.
 */

const DB_NAME = 'ziroeda-templates';
const STORE = 'template-files';
const VERSION = 2;

/** One loose file in the templates root. */
export interface UserTemplateFile {
  /** The path within the root, without a leading slash — `mysheet.kicad_wks`. */
  path: string;
  text: string;
  updatedAt: number;
  /** A tombstone, as the template records carry, so a sync can see a delete. */
  deletedAt?: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Both stores are created here. An upgrade from a version-1 database
      // already has `templates` and needs only the new one; a fresh database
      // gets both, which is why neither is assumed to exist.
      if (!db.objectStoreNames.contains('templates'))
        db.createObjectStore('templates', { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        // Resolve on COMMIT, not on request success: IndexedDB reports a
        // request as succeeded and then aborts the transaction when it is out
        // of quota, which would otherwise read as a file that saved fine.
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        t.oncomplete = () => resolve(result);
        t.onabort = () => reject(t.error);
        t.onerror = () => reject(t.error);
      }),
  );
}

/** The path without its leading slash, which is how the store keys them. */
const key = (path: string): string => path.replace(/^\/+/, '');

/** Every live loose file, newest first. */
export async function listUserTemplateFiles(): Promise<UserTemplateFile[]> {
  try {
    const all = await tx<UserTemplateFile[]>('readonly', (s) => s.getAll());
    return all.filter((f) => !f.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    // A browser with IndexedDB refused (private mode, blocked site data) must
    // leave the chooser showing an empty templates root, not an error page.
    return [];
  }
}

/** One file's text, or null when there is no such file. */
export async function readUserTemplateFile(path: string): Promise<string | null> {
  try {
    const rec = await tx<UserTemplateFile | undefined>('readonly', (s) => s.get(key(path)));
    return rec && !rec.deletedAt ? rec.text : null;
  } catch {
    return null;
  }
}

/** Write one, stamping it now. Overwrites, as a save over a file does. */
export async function writeUserTemplateFile(path: string, text: string): Promise<void> {
  await tx('readwrite', (s) => s.put({ path: key(path), text, updatedAt: Date.now() }));
}

/**
 * Delete one, as a tombstone rather than a removal.
 *
 * The template records do the same, and for the same reason: a sync that saw
 * only the absence of a row would treat a delete on one device as a row missing
 * on the other and put it back.
 */
export async function deleteUserTemplateFile(path: string): Promise<void> {
  const k = key(path);
  const existing = await tx<UserTemplateFile | undefined>('readonly', (s) => s.get(k));
  if (!existing) return;
  await tx('readwrite', (s) =>
    s.put({ ...existing, deletedAt: Date.now(), updatedAt: Date.now() }),
  );
}

/** Move one. A rename is a write of the new path and a tombstone on the old. */
export async function renameUserTemplateFile(path: string, to: string): Promise<void> {
  const text = await readUserTemplateFile(path);
  if (text === null) return;
  await writeUserTemplateFile(to, text);
  await deleteUserTemplateFile(path);
}
