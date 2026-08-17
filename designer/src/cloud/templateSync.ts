// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * User templates, mirrored to the account.
 *
 * Without this a duplicated template lives in one browser's IndexedDB and
 * nowhere else: it does not follow the user to another machine, and clearing
 * site data takes it. Projects have been synced since the store was built;
 * templates were not, which made "my templates are gone" a surprise waiting to
 * happen.
 *
 * ### Shape
 *
 * Templates ride the *same* content-addressed blob store as projects
 * (`blobStore.ts`), so a template duplicated from a project's board stores no
 * second copy of those bytes. What is new is one small index object per user:
 *
 *     <userId>/templates/index.json
 *
 * holding each template's metadata and a manifest of `{ name, hash, size }`.
 * There is no new table and no SQL migration - the index is an object, written
 * through the same `putObject` every blob uses.
 *
 * ### Why an index object rather than rows
 *
 * A row per template would need a `templates` table, a migration, and row-level
 * security policies to match. Templates are few, small and rarely written; one
 * object per user is enough, and it keeps this entirely inside the storage half
 * of the backend interface, which every deployment already has.
 *
 * The cost is that the index is a single mutable object, so two devices writing
 * at once resolve last-writer-wins. That is why a push *merges* against what is
 * already there rather than overwriting it, and why deletes are tombstones
 * (`deletedAt`) rather than removals - a merge that could not see a deletion
 * would resurrect the template on the next pull.
 *
 * ### Durability
 *
 * The same rule as `cloudStore.ts`: every blob is stored and confirmed present
 * *before* the index that names it is written. Until that write lands the
 * previous index is intact, so the index can never point at an object that is
 * not in the store.
 */
import { getBlob, putBlob } from './blobStore.js';
import type { CloudBackend } from './backend.js';
import {
  type UserTemplateRecord,
  listUserTemplateRecords,
  putUserTemplateVerbatim,
  templateStamp,
} from '../home/user_templates.js';
import { gunzip, gzip } from '../home/gzip.js';

/** One template as the index records it: metadata plus a blob manifest. */
export interface TemplateIndexEntry {
  id: string;
  title: string;
  description: string;
  base: string;
  icon: string | null;
  html: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  files: { name: string; hash: string; size: number }[];
}

export interface TemplateIndex {
  version: 1;
  templates: TemplateIndexEntry[];
}

export const templateIndexPath = (userId: string): string => `${userId}/templates/index.json`;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The stored index, or an empty one when the user has never pushed. */
export async function readIndex(backend: CloudBackend, userId: string): Promise<TemplateIndex> {
  try {
    const bytes = await backend.getObject(templateIndexPath(userId));
    const parsed = JSON.parse(dec.decode(bytes)) as TemplateIndex;
    if (parsed && Array.isArray(parsed.templates)) return parsed;
  } catch {
    // Missing is the normal first-run case, and unreadable is not worth failing
    // a sync over: the merge below treats both as "nothing there yet", and the
    // push that follows rewrites it from what this device holds.
  }
  return { version: 1, templates: [] };
}

/**
 * Merge two sides of the index by id, newest `updatedAt` winning.
 *
 * A tombstone is an ordinary entry and wins on the same rule, which is what
 * makes a delete on one device survive a push from another that still has the
 * template. Exported for the tests: this is the only part with a decision in
 * it, and getting it wrong resurrects deleted templates.
 */
export function mergeIndexes(
  a: readonly TemplateIndexEntry[],
  b: readonly TemplateIndexEntry[],
): TemplateIndexEntry[] {
  const out = new Map<string, TemplateIndexEntry>();
  for (const e of [...a, ...b]) {
    const prev = out.get(e.id);
    if (!prev || e.updatedAt > prev.updatedAt) out.set(e.id, e);
  }
  return [...out.values()].sort((x, y) => y.updatedAt - x.updatedAt);
}

/** A local record as an index entry, storing its blobs on the way. */
async function toEntry(
  backend: CloudBackend,
  userId: string,
  rec: UserTemplateRecord,
): Promise<TemplateIndexEntry> {
  const files: TemplateIndexEntry['files'] = [];
  for (const f of rec.files) {
    const gz = await gzip(f.bytes);
    const hash = await putBlob(backend, userId, gz);
    files.push({ name: f.name, hash, size: gz.length });
  }
  return {
    id: rec.id,
    title: rec.title,
    description: rec.description,
    base: rec.base,
    icon: rec.icon,
    html: rec.html,
    createdAt: rec.createdAt,
    updatedAt: templateStamp(rec),
    ...(rec.deletedAt ? { deletedAt: rec.deletedAt } : {}),
    files,
  };
}

/** An index entry as a local record, fetching its blobs. */
async function toRecord(
  backend: CloudBackend,
  userId: string,
  e: TemplateIndexEntry,
  syncedAt: number,
): Promise<UserTemplateRecord> {
  const files: UserTemplateRecord['files'] = [];
  if (!e.deletedAt) {
    for (const f of e.files) {
      files.push({ name: f.name, bytes: await gunzip(await getBlob(backend, userId, f.hash)) });
    }
  }
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    base: e.base,
    icon: e.icon,
    html: e.html,
    files,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    ...(e.deletedAt ? { deletedAt: e.deletedAt } : {}),
    syncedAt,
  };
}

export interface TemplateSyncResult {
  pushed: number;
  pulled: number;
}

/**
 * Bring the account and this browser into agreement, both ways.
 *
 * Pull first, so a template made on another machine is present before the
 * index is rewritten; then push the merged set. Every blob is confirmed stored
 * by `putBlob` before the index naming it is written, so an interrupted sync
 * leaves the previous index whole.
 */
export async function syncUserTemplates(
  backend: CloudBackend,
  userId: string,
): Promise<TemplateSyncResult> {
  const remote = await readIndex(backend, userId);
  const local = await listUserTemplateRecords();
  const localById = new Map(local.map((r) => [r.id, r]));
  const now = Date.now();

  let pulled = 0;
  for (const e of remote.templates) {
    const mine = localById.get(e.id);
    if (mine && templateStamp(mine) >= e.updatedAt) continue;
    await putUserTemplateVerbatim(await toRecord(backend, userId, e, now));
    pulled += 1;
  }

  // Re-read: the pull above may have replaced records, and the index has to be
  // written from what this browser now actually holds.
  const after = await listUserTemplateRecords();
  const entries: TemplateIndexEntry[] = [];
  let pushed = 0;
  for (const rec of after) {
    const already = remote.templates.find((e) => e.id === rec.id);
    if (already && already.updatedAt >= templateStamp(rec)) {
      entries.push(already);
      continue;
    }
    entries.push(await toEntry(backend, userId, rec));
    pushed += 1;
  }

  const merged = mergeIndexes(remote.templates, entries);
  if (pushed > 0 || merged.length !== remote.templates.length) {
    const next: TemplateIndex = { version: 1, templates: merged };
    await backend.putObject(templateIndexPath(userId), enc.encode(JSON.stringify(next)));
  }
  return { pushed, pulled };
}
