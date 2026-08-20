// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the file chooser talks to.
 *
 * The chooser is a clone of a window that sits over a real filesystem, so it is
 * written against a filesystem here too — `list`, `read`, `write`, `mkdir`,
 * `rename`, `remove` — and never against the project store directly. Today the
 * only implementation is an adapter over that store (`project_store_fs.ts`);
 * when the storage changes underneath, the adapter is what changes.
 *
 * Written the other way round, the widget would take the shape of a
 * project-keyed store — `openProject(id)` rather than `list('/')` — and would
 * have to be rewritten rather than re-pointed.
 *
 * ## The shape of the tree
 *
 * One root, holding project folders and nothing else. Files live inside a
 * project, which is what KiCad does: a project is a directory, and everything
 * belonging to it — the board, the netlists, the 3D models, the notes — sits in
 * that directory beside the `.kicad_pro`. Arbitrary types are allowed there,
 * exactly as upstream allows a `.md` or a `.pdf` in a project folder; what is
 * not allowed is a loose file at the root, because upstream has no such place
 * either. {@link FsErrorCode.NOT_IN_PROJECT} is that refusal.
 *
 * ## Sizes and dates
 *
 * `size` is the file's own length, not what it compresses to on disk. The
 * Size column is the user's answer to "how big is my board", and the store's
 * gzip is our business, not theirs. A folder has neither size nor type — the
 * columns are empty for one, measured — so `size` is `null` for a folder.
 */

import { join } from './path.js';

/** What a directory entry is. Projects are folders that KiCad would open. */
export type EntryKind = 'folder' | 'project' | 'file';

export interface Entry {
  /** One path segment — the name the Name column shows. */
  readonly name: string;
  /** Where it is, absolute from the root. */
  readonly path: string;
  readonly kind: EntryKind;
  /** Bytes, uncompressed. `null` for a folder, which shows no size. */
  readonly size: number | null;
  /** Epoch ms. A synthesised folder carries its newest child's. */
  readonly modified: number;
}

/**
 * Why an operation was refused.
 *
 * Named after the errno a real filesystem would return, so the meanings are
 * the familiar ones, with one addition of our own for the rule upstream gets
 * from the shape of a disk rather than from a check.
 */
export enum FsErrorCode {
  /** No such file or directory. */
  NOT_FOUND = 'NOT_FOUND',
  /** A name is already taken. */
  EXISTS = 'EXISTS',
  /** The name or path is not one we will act on — see `path.ts`. */
  INVALID = 'INVALID',
  /** A file was addressed as a directory, or the reverse. */
  NOT_A_DIRECTORY = 'NOT_A_DIRECTORY',
  /**
   * A file or folder was addressed at the root, where only projects live.
   *
   * Not a permission problem and not a missing directory, which is why it is
   * not `NOT_FOUND` or an `EPERM`: the path is well-formed and the place
   * exists. It is the one structural rule this tree has.
   */
  NOT_IN_PROJECT = 'NOT_IN_PROJECT',
}

/** A refusal, carrying the path it was about so a caller can name it. */
export class FsError extends Error {
  constructor(
    readonly code: FsErrorCode,
    readonly path: string,
    message?: string,
  ) {
    super(message ?? `${code}: ${path}`);
    this.name = 'FsError';
  }
}

/**
 * The account's tree.
 *
 * Everything is async because everything crosses IndexedDB, and eventually the
 * network: the index is local, but a file's bytes are pulled when it is
 * actually opened rather than kept in step.
 */
export interface FileSystem {
  /** One directory's children, unordered — the chooser sorts by its columns. */
  list(dir: string): Promise<Entry[]>;
  /** One entry, or `null` when nothing is there. */
  stat(path: string): Promise<Entry | null>;
  /** A file's bytes. This is the call that may cross the network. */
  read(path: string): Promise<Uint8Array>;
  /** Create or replace a file. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Create a folder. Inside a project only. */
  mkdir(path: string): Promise<void>;
  /** Create a project folder. At the root only. */
  mkproject(path: string): Promise<void>;
  /** Give an entry a new name in the same folder. */
  rename(path: string, name: string): Promise<void>;
  /** Delete an entry, and everything under it if it is a folder. */
  remove(path: string): Promise<void>;
}

/** A file as the store holds it: a path relative to its project, and a size. */
export interface FlatFile {
  /** Relative to the project folder — `sub/dir/board.kicad_pcb`. */
  readonly name: string;
  readonly size: number;
  readonly modified: number;
}

/**
 * One directory level, derived from a project's flat file list.
 *
 * The store keeps a project as a list of relative paths, so the folders in
 * between are implied rather than recorded. This is what re-derives them, and
 * it is the only interesting logic in the adapter — hence its living here,
 * where it can be tested without a database.
 *
 * `dir` is relative to the project and `''` is the project's own root. Only
 * the immediate children come back: `sub/a.txt` and `sub/b/c.txt` both
 * contribute the single folder `sub`.
 *
 * A synthesised folder has no timestamp of its own, so it takes its newest
 * descendant's — which is the answer a real folder would give after those
 * files were written into it, and the only one that is not invented.
 *
 * `base` is where `dir` sits in the account's tree, so the entries come back
 * with absolute paths the chooser can navigate to. The store never sees it.
 */
export function dirLevel(files: readonly FlatFile[], dir: string, base: string): Entry[] {
  const prefix = dir === '' ? '' : `${dir}/`;
  const folders = new Map<string, number>();
  const out: Entry[] = [];

  for (const f of files) {
    if (!f.name.startsWith(prefix)) continue;
    const rest = f.name.slice(prefix.length);
    if (rest === '') continue;
    const slash = rest.indexOf('/');
    if (slash < 0) {
      out.push({
        name: rest,
        path: join(base, rest),
        kind: 'file',
        size: f.size,
        modified: f.modified,
      });
    } else {
      const folder = rest.slice(0, slash);
      const seen = folders.get(folder);
      if (seen === undefined || f.modified > seen) folders.set(folder, f.modified);
    }
  }

  for (const [name, modified] of folders) {
    out.push({ name, path: join(base, name), kind: 'folder', size: null, modified });
  }
  return out;
}
