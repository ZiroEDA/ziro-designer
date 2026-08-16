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
import type { TemplateMeta } from './templates.js';

const DB_NAME = 'ziroeda-templates';
const STORE = 'templates';
const VERSION = 1;

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
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
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

/** Every stored template, newest first. Empty when storage is unavailable. */
export async function listUserTemplateRecords(): Promise<UserTemplateRecord[]> {
  try {
    const all = await tx<UserTemplateRecord[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/**
 * The stored templates as the selector's own shape.
 *
 * `html` becomes a blob: URL rather than a data: URL because the preview needs
 * to reach into the frame to inject KiCad's stylesheet, and a data: URL is
 * given an opaque origin that `allow-same-origin` cannot reopen.
 */
export async function listUserTemplates(): Promise<TemplateMeta[]> {
  const recs = await listUserTemplateRecords();
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
    return (await tx<UserTemplateRecord | undefined>('readonly', (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

export async function deleteUserTemplate(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
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
  await tx('readwrite', (s) => s.put(rec));
  return rec;
}
