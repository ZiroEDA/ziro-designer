// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Archive / Unarchive project logic: KiCad zips the whole project folder,
 * reading each file as a raw byte stream (PROJECT_ARCHIVER::Archive). We do
 * the same, byte-exact entries, re-nested under a folder named for the
 * project (so an archive unzips the way KiCad expects). Pure functions; the
 * download/upload plumbing stays in the launcher component.
 */

import { unzipSync, zipSync } from 'fflate';
import type { PickedHomeFile } from './files.js';
import { inArchiveAllowList } from './project_tree.js';

/** Path relative to the project's own folder ("proj/proj.kicad_sch" ->
 * "proj.kicad_sch", "proj/sub/a.kicad_sch" -> "sub/a.kicad_sch"). */
export const relPath = (name: string): string => {
  const p = name.replace(/\\/g, '/');
  return p.includes('/') ? p.slice(p.indexOf('/') + 1) : p;
};

const utf8 = new TextEncoder();

/**
 * What a file holds on disk: its bytes as read, or - for a file an editor has
 * written this session, which the app carries as `{ name, text }` only - its
 * text in UTF-8, which is what the writers produce. Empty for an empty file.
 */
function contentOf(f: PickedHomeFile): Uint8Array {
  if (f.bytes && f.bytes.length > 0) return f.bytes;
  return utf8.encode(f.text);
}

/**
 * Collect the zip entries for Archive Project: only allow-listed file types
 * (gerbers/backups/images and other stray files are skipped, matching KiCad's
 * archiver), each under `<name>/…`. Returns null when nothing qualifies.
 *
 * A file as it was read keeps its exact bytes. One an editor has saved has
 * only text - so this used to skip it, and once every file of a project had
 * been edited the archive was empty and the command did nothing at all.
 */
export function archiveEntries(
  files: readonly PickedHomeFile[],
  name: string,
): Record<string, Uint8Array> | null {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    if (!inArchiveAllowList(f.name)) continue;
    const data = contentOf(f);
    if (data.length > 0) entries[`${name}/${relPath(f.name)}`] = data;
  }
  return Object.keys(entries).length > 0 ? entries : null;
}

/** Zip the collected entries (blocking, paint any progress UI first). */
export const zipArchive = (entries: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> =>
  zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>;

/**
 * Expand an uploaded .zip into named byte entries, skipping directory
 * entries and empty files. Returns null when the bytes aren't a valid zip.
 */
export function expandArchive(bytes: Uint8Array): { name: string; data: Uint8Array }[] | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return null;
  }
  return Object.entries(entries)
    .filter(([name, data]) => !name.endsWith('/') && data.length > 0)
    .map(([name, data]) => ({ name, data }));
}
