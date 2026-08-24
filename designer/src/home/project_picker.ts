// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Browser-side project opening: walk a picked directory (File System Access
 * API), a dropped folder (webkit directory entries), or a plain file list
 * into lazy byte readers for the launcher's ingest path. No direct upstream
 * counterpart, the desktop suite opens projects through the OS file dialog
 * (kicad/kicad_manager_frame.cpp); this module is that behavior's web
 * equivalent. Pure logic against structural interfaces, so it is unit-tested
 * with fakes.
 */

/** A file queued for ingest: name + a lazy, byte-exact reader. */
export interface IngestFile {
  name: string;
  bytesOf: () => Promise<Uint8Array>;
}

/** Folders deeper than this are ignored (guards against runaway trees). */
export const MAX_WALK_DEPTH = 6;

// --- File System Access API (directory picker) ------------------------------

export interface DirHandle {
  values: () => AsyncIterable<FsEntry>;
}
export interface FsEntry {
  kind: string;
  name: string;
  getFile: () => Promise<File>;
  values: () => AsyncIterable<FsEntry>;
}

/** Recurse the picked directory so footprint/3D-model subfolders
 * (CM5IO.pretty, 3d_lib …) populate the tree, not just the top level. */
export async function walkDirectoryHandle(dir: DirHandle): Promise<IngestFile[]> {
  const files: IngestFile[] = [];
  const walk = async (handle: DirHandle, prefix: string, depth: number): Promise<void> => {
    for await (const entry of handle.values()) {
      if (entry.kind === 'file')
        files.push({
          name: prefix + entry.name,
          bytesOf: async () => new Uint8Array(await (await entry.getFile()).arrayBuffer()),
        });
      else if (entry.kind === 'directory' && depth < MAX_WALK_DEPTH)
        await walk(entry, `${prefix}${entry.name}/`, depth + 1);
    }
  };
  await walk(dir, '', 0);
  return files;
}

// --- Drag-and-drop (webkit directory entries) --------------------------------

export interface DropEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader: () => { readEntries: (ok: (b: DropEntry[]) => void, err: () => void) => void };
}

/** Drain a directory reader (readEntries returns results in batches). */
const readAll = (dir: DropEntry): Promise<DropEntry[]> =>
  new Promise((res) => {
    const reader = dir.createReader();
    const all: DropEntry[] = [];
    const next = (): void =>
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) res(all);
          else {
            all.push(...batch);
            next();
          }
        },
        () => res(all),
      );
    next();
  });

/** Walk dropped directory entries, keeping the relative path (prefix) so the
 * directory tree reconstructs folders. Unreadable files are skipped. */
export async function walkDroppedEntries(entries: readonly DropEntry[]): Promise<IngestFile[]> {
  const files: IngestFile[] = [];
  const walk = async (entry: DropEntry, prefix: string, depth: number): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => entry.file(res, rej)).catch(() => null);
      if (file)
        files.push({
          name: prefix + file.name,
          bytesOf: async () => new Uint8Array(await file.arrayBuffer()),
        });
    } else if (entry.isDirectory && depth < MAX_WALK_DEPTH) {
      for (const child of await readAll(entry))
        await walk(child, `${prefix}${entry.name}/`, depth + 1);
    }
  };
  for (const en of entries) await walk(en, '', 0);
  return files;
}

// --- Plain file lists (input[type=file], webkitdirectory fallback) ----------

/** Map a FileList to ingest files, preserving webkitRelativePath when present. */
export const filesFromFileList = (list: FileList): IngestFile[] =>
  Array.from(list).map((f) => ({
    name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    bytesOf: async () => new Uint8Array(await f.arrayBuffer()),
  }));

/**
 * Drop the one folder every picked file sits in.
 *
 * A folder picked with `webkitdirectory`, or dropped, arrives with the folder's
 * own name on the front of every path: choosing `ecc83-pp/` gives
 * `ecc83-pp/ecc83-pp.kicad_sch`, `ecc83-pp/fp-lib-table`, and so on. Stored
 * verbatim under a project that is itself NAMED for that folder, the result is
 * a folder inside a folder - and the project's own documents end up one level
 * down, where the Save As dialog does not list them because it is showing the
 * project root.
 *
 * Upstream never meets this: you point KiCad at a `.kicad_pro` that is already
 * on disk, and the directory containing it IS the project directory. The extra
 * level is an artefact of having to carry a folder into the browser.
 *
 * Stripped only when EVERY path starts with the same segment and at least one
 * file is genuinely below it - the same rule `tar --strip-components=1` uses.
 * A flat selection of loose files has no common folder and is left alone, and
 * so is a selection that spans two, because there is nothing to agree on.
 */
export function stripCommonFolder(files: IngestFile[]): IngestFile[] {
  if (files.length === 0) return files;

  // No guard on the first path having a folder: `shared` below already refuses
  // a flat selection, because no flat path has a second segment. A sweep proved
  // it - deleting that guard changed no behaviour and failed no test, which is
  // what redundant code looks like from the outside.
  const prefix = files[0]!.name.split('/')[0]!;
  // Every one of them, and each with something after the prefix.
  const shared = files.every((f) => {
    const parts = f.name.split('/');
    return parts.length > 1 && parts[0] === prefix;
  });

  if (!shared) return files;
  return files.map((f) => ({ ...f, name: f.name.slice(prefix.length + 1) }));
}
