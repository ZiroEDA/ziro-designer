// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The user templates directory, as a browser store.
 *
 * KiCad's template selector reads two roots and marks what it finds:
 *
 *     scanDirectory( m_userTemplatesPath, true );
 *     scanDirectory( m_systemTemplatesPath, false );
 *
 * and `KICAD_USER_TEMPLATE_DIR` always has a value, because common_settings.cpp
 * registers it with `PATHS::GetUserTemplatesPath()` as its default. So a stock
 * install always has a writable user root, which is what makes
 * TEMPLATE_WIDGET::onDuplicateTemplate possible - it copies a template's tree
 * into `m_dialog->GetUserTemplatesPath()` under a new name.
 *
 * There is no directory to write to here, so this is that root: an IndexedDB
 * store holding the same three things a template folder holds - the project
 * files, `meta/info.html` and `meta/icon.png`.
 *
 * It is a **separate database** from `ziroeda`/`projects` on purpose. Adding an
 * object store to that one means bumping its version, and a schema migration on
 * the store that holds the user's actual work is not a risk worth taking to add
 * a template feature beside it.
 *
 * A duplicated template's info.html has its images inlined as data: URLs when
 * it is written (see `inlineImages`). A stored page is previewed from a blob:
 * URL, which has no directory to resolve `src="DevEBox_Board.png"` against, so
 * anything left relative would render broken.
 */
import type { PickedHomeFile } from './files.js';
import { renameRel, type TemplateMeta } from './templates.js';
import { idbHandle } from './idb_open.js';

const DB_NAME = 'ziroeda-templates';
const STORE = 'templates';
/**
 * 1 -> 2 when `user_template_files.ts` joined this database.
 *
 * Both modules open the SAME database, so both must name the same version and
 * both `onupgradeneeded` handlers must create BOTH stores: whichever opens
 * first runs the upgrade, and an open at a LOWER version than the one on disk
 * fails outright with a VersionError. Leaving this at 1 would have made the
 * templates list break for anyone who saved a drawing sheet first.
 */
const VERSION = 2;
const FILES_STORE = 'template-files';

export interface UserTemplateRecord {
  /** The directory name upstream, and the identity here. */
  id: string;
  title: string;
  description: string;
  /** The template's own .kicad_pro basename, what CreateProject renames. */
  base: string;
  /** meta/icon.png as a data: URL, or null when the template has none. */
  icon: string | null;
  /** meta/info.html, images already inlined. */
  html: string;
  files: { name: string; bytes: Uint8Array }[];
  createdAt: number;
  /**
   * Last change, and what the cloud merge orders by. Absent on records written
   * before syncing existed, which `touch` treats as `createdAt`.
   */
  updatedAt?: number;
  /**
   * A tombstone. A deleted template has to stay listed, with its files dropped,
   * or the next pull would see the record still present in the cloud index and
   * put it back. Cleared only when the row is genuinely gone from every device,
   * which nothing here tries to work out - the rows are tiny.
   */
  deletedAt?: number;
  /** The moment this record and the cloud index last agreed. */
  syncedAt?: number;
}

/** `updatedAt`, defaulting to the creation time for a pre-sync record. */
export const templateStamp = (r: UserTemplateRecord): number => r.updatedAt ?? r.createdAt;

/**
 * The templates database, through the shared opener - see `idb_open.ts` for the
 * three events every one of these must handle.
 *
 * This one has the version that moved (1 -> 2), so it is the one that would
 * have blocked another tab holding v1 open. Both stores are created here
 * because either module may be the one that opens first.
 */
const db = idbHandle(DB_NAME, VERSION, (d) => {
  if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
  if (!d.objectStoreNames.contains(FILES_STORE))
    d.createObjectStore(FILES_STORE, { keyPath: 'path' });
});

const openDB = (): Promise<IDBDatabase> => db.get();

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        // Resolve on commit, not on request success: IndexedDB reports a
        // request as succeeded and *then* aborts the transaction when it is out
        // of quota, which would otherwise read as a template that saved fine.
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

/**
 * Every stored template, newest first, tombstones included.
 *
 * The sync layer needs the tombstones; everything user-facing goes through
 * `listUserTemplates` below, which drops them.
 */
export async function listUserTemplateRecords(): Promise<UserTemplateRecord[]> {
  try {
    const all = await tx<UserTemplateRecord[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Write a record, stamping it as changed now. */
export async function putUserTemplate(rec: UserTemplateRecord): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...rec, updatedAt: Date.now() }));
}

/** Write a record exactly as given - used by a pull, which must not restamp. */
export async function putUserTemplateVerbatim(rec: UserTemplateRecord): Promise<void> {
  await tx('readwrite', (s) => s.put(rec));
}

/**
 * The stored templates as the selector's own shape.
 *
 * `html` becomes a blob: URL rather than a data: URL because the preview needs
 * to reach into the frame to inject KiCad's stylesheet, and a data: URL is
 * given an opaque origin that `allow-same-origin` cannot reopen.
 */
export async function listUserTemplates(): Promise<TemplateMeta[]> {
  const recs = (await listUserTemplateRecords()).filter((r) => !r.deletedAt);
  return recs.map((r) => ({
    id: r.id,
    base: r.base,
    title: r.title,
    description: r.description,
    icon: r.icon,
    html: URL.createObjectURL(new Blob([r.html], { type: 'text/html' })),
    category: 'user' as const,
    source: 'user' as const,
    files: r.files.map((f) => f.name),
  }));
}

export async function getUserTemplate(id: string): Promise<UserTemplateRecord | null> {
  try {
    const rec = await tx<UserTemplateRecord | undefined>('readonly', (s) => s.get(id));
    return rec && !rec.deletedAt ? rec : null;
  } catch {
    return null;
  }
}

/** The raw row, tombstone or not. For the sync layer's merge. */
export async function getUserTemplateRow(id: string): Promise<UserTemplateRecord | null> {
  try {
    return (await tx<UserTemplateRecord | undefined>('readonly', (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

/**
 * Merge changed files into a stored template, which is what makes Edit Template
 * genuinely edit rather than fork.
 *
 * A merge by name rather than a replacement, because the caller is an autosave
 * carrying only the files that changed - the schematic, say, while the board
 * and the footprint library are untouched and absent from the call. Replacing
 * would delete everything the editor did not happen to write.
 *
 * The project that was opened from the template carries the project's name in
 * its paths, so the leading directory is stripped back off: a template's files
 * are relative to the template, exactly as GetFileList() returns them.
 *
 * Only the files move. The page, the icon and the description belong to the
 * template, not to the project opened from it.
 */
export async function updateUserTemplateFiles(
  id: string,
  files: { name: string; bytes: Uint8Array }[],
  projectName: string,
): Promise<boolean> {
  const rec = await getUserTemplate(id);
  if (!rec) return false;
  const byName = new Map(rec.files.map((f) => [f.name, f]));
  for (const f of files) {
    // Strip the project directory, then undo CreateProject's rename. That
    // rename is `base -> projectName` over names and directory segments, so
    // running renameRel with the two swapped puts the path back: a project file
    // "MyCopy/MyCopy.kicad_sch" is the template's "API_Series-500.kicad_sch".
    const stripped = f.name.replace(/\\/g, '/').split('/').slice(1).join('/') || f.name;
    const rel = renameRel(stripped, projectName, rec.base);
    // Only files the template already has: a project may grow files of its own
    // (a netlist, an export) and those are not part of the template.
    if (byName.has(rel)) byName.set(rel, { name: rel, bytes: f.bytes });
  }
  await putUserTemplate({ ...rec, files: [...byName.values()] });
  return true;
}

/**
 * Delete, as a tombstone rather than a removal.
 *
 * Dropping the row outright would be undone by the next pull: the cloud index
 * would still list the template, and nothing in the merge could tell "deleted
 * here" from "not yet arrived here". The files go, so the space is reclaimed;
 * what stays is a few fields saying when it went.
 */
export async function deleteUserTemplate(id: string): Promise<void> {
  const rec = await getUserTemplate(id);
  if (!rec) return;
  const now = Date.now();
  await tx('readwrite', (s) =>
    s.put({ ...rec, files: [], html: '', icon: null, deletedAt: now, updatedAt: now }),
  );
}

/** A stored template's files, ready for the same rename CreateProject applies. */
export async function userTemplateFiles(id: string): Promise<PickedHomeFile[]> {
  const rec = await getUserTemplate(id);
  if (!rec) return [];
  const dec = new TextDecoder();
  return rec.files.map((f) => ({ name: f.name, text: dec.decode(f.bytes), bytes: f.bytes }));
}

const toDataUrl = (bytes: Uint8Array, mime: string): string => {
  let bin = '';
  // A spread into fromCharCode blows the stack on a large icon, so chunk it.
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
};

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/**
 * Rewrite every relative <img src> in a template's page to a data: URL.
 *
 * A stored page is shown from a blob: URL, which carries no directory for a
 * relative reference to resolve against. STM32H7_DevEBox's page points at
 * DevEBox_Board.png beside it, so without this a duplicate of that template
 * would preview with a broken image.
 */
async function inlineImages(html: string, resolve: (rel: string) => string): Promise<string> {
  const refs = [...html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi)];
  let out = html;
  for (const m of refs) {
    const rel = m[1]!;
    if (/^(https?:|data:|blob:|\/)/i.test(rel)) continue;
    try {
      const res = await fetch(resolve(rel));
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ext = rel.split('.').pop()?.toLowerCase() ?? '';
      out = out.split(rel).join(toDataUrl(bytes, MIME[ext] ?? 'application/octet-stream'));
    } catch {
      /* leave the reference alone; the page still renders without the image */
    }
  }
  return out;
}

/**
 * onDuplicateTemplate: copy a template under a new name into the user root.
 *
 * Upstream asks for the name with a wxTextEntryDialog defaulted to
 * `<name>_copy`, refuses an empty one, and then copies the tree. The copy is
 * always a *user* template whatever it was copied from, which is the whole
 * point - a system template cannot be edited, its duplicate can.
 */
export async function duplicateTemplate(
  source: TemplateMeta,
  newId: string,
  loadFiles: (t: TemplateMeta) => Promise<{ name: string; bytes: Uint8Array }[]>,
): Promise<UserTemplateRecord> {
  const files = await loadFiles(source);

  let html = '';
  let icon: string | null = null;

  if (source.source === 'user') {
    const rec = await getUserTemplate(source.id);
    html = rec?.html ?? '';
    icon = rec?.icon ?? null;
  } else {
    const dir = `/templates/${encodeURIComponent(source.id)}/meta/`;
    try {
      const res = await fetch(`${dir}info.html`);
      if (res.ok) html = await inlineImages(await res.text(), (rel) => dir + rel);
    } catch {
      /* no page: the selector falls back to its generated one */
    }
    if (source.icon) {
      try {
        const res = await fetch(source.icon);
        if (res.ok) icon = toDataUrl(new Uint8Array(await res.arrayBuffer()), 'image/png');
      } catch {
        /* no icon: the selector falls back to the KiCad application icon */
      }
    }
  }

  const rec: UserTemplateRecord = {
    id: newId,
    title: newId,
    description: source.description,
    // The copied files still carry the source's basename, so renaming on
    // project creation has to keep matching it.
    base: source.base,
    icon,
    html,
    files,
    createdAt: Date.now(),
  };
  await putUserTemplate(rec);
  return rec;
}

/**
 * The loose files the templates root used to hold, for the one-way move out.
 *
 * `user_template_files.ts` was a flat `path -> text` store in this database,
 * added because nothing modelled the loose `.kicad_wks` files that
 * `PL_EDITOR_FRAME::Files_io` writes into `template/`
 * (pagelayout_editor/files.cpp:199-202). It backed Templates and only
 * Templates, so Symbols, Footprints and 3D Models stayed sidebar rows with
 * nothing behind them, and it was removed when all four became folders of the
 * account tree instead.
 *
 * Anything a person saved in between is still sitting in `template-files`.
 * `ensureUserDir` reads this once, when it creates the Templates folder, and
 * the rows are left where they are rather than deleted: this runs during a
 * READ of the folder, and a migration that destroys the only copy of the data
 * it is moving has to be the one that also committed it.
 *
 * `FILES_STORE` is still created by the upgrade above, so this opens whether or
 * not the deleted module ever ran.
 */
export async function legacyTemplateFiles(): Promise<{ path: string; text: string }[]> {
  try {
    const db = await openDB();
    const all = await new Promise<{ path: string; text: string; deletedAt?: number }[]>(
      (resolve, reject) => {
        const t = db.transaction(FILES_STORE, 'readonly');
        const req = t.objectStore(FILES_STORE).getAll();
        let result: { path: string; text: string; deletedAt?: number }[] = [];
        req.onsuccess = () => {
          result = req.result;
        };
        t.oncomplete = () => resolve(result);
        t.onabort = () => reject(t.error);
        t.onerror = () => reject(t.error);
      },
    );
    // The store kept tombstones so a sync could see a delete; a deleted file is
    // not one to carry across.
    return all.filter((f) => !f.deletedAt).map((f) => ({ path: f.path, text: f.text }));
  } catch {
    // No such database, or a browser refusing IndexedDB. Either way the
    // Templates folder starts empty rather than failing to open.
    return [];
  }
}
