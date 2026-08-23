// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A read-only {@link FileSystem} over a list of paths.
 *
 * Some places in the chooser's sidebar are not folders of the account's tree.
 * GTK's own sidebar has the same split: Home and Documents are directories you
 * can walk into, and `recent:///` is a query — a `GtkRecentManager` listing with
 * nothing behind it to change. Ours has three of those (Recent, Demos,
 * Templates) against one real tree, so rather than teach the chooser about two
 * kinds of place, each listing is dressed as the smallest possible filesystem.
 *
 * **It is still a hierarchy.** A demo's id is a path — `simulation/amplifier_ac`
 * — so Demos must show a `simulation` folder that you open to find the amplifier
 * inside, exactly as the demos directory on disk is laid out and exactly as the
 * Open Demo Project menu groups them. Flattening it put `amplifier_ac` at the
 * top level next to the folder it lives in, which no file manager does. The
 * folders in between are re-derived by {@link dirLevel} — the same function the
 * account's own adapter uses for a project's contents, given a different leaf
 * kind — rather than by a second copy of that logic living here.
 *
 * Everything that would change the tree refuses with the errno a real read-only
 * filesystem returns — `EROFS` — instead of silently doing nothing. The chooser
 * shows the message, which is the honest outcome: you cannot rename a demo.
 */

import {
  type Entry,
  type EntryKind,
  type FileSystem,
  type FlatFile,
  FsError,
  FsErrorCode,
  dirLevel,
} from './filesystem.js';
import { ROOT, fromSegments, segments } from './path.js';

/** What one call to a place's source returns. */
/**
 * The loose files a listing place may also hold.
 *
 * A `GtkPlacesSidebar` row is either a query (`recent:///`, which owns nothing)
 * or a real directory, and KiCad's user templates root is the second kind: it
 * holds the `default` template as a folder AND whatever loose files are saved
 * into it, which is where `PL_EDITOR_FRAME::Files_io` puts a drawing sheet
 * (pagelayout_editor/files.cpp:199-202). `below` delegates the FOLDERS; this
 * delegates the files.
 */
export interface LooseFiles {
  read: (path: string) => Promise<string | null>;
  write: (path: string, text: string) => Promise<void>;
  rename: (path: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

export interface Listing {
  /** Every leaf, named by its path relative to the place's own root. */
  readonly files: readonly FlatFile[];
  /**
   * Which of the *derived* folders are project folders, by absolute path.
   *
   * A demo's files arrive as `simulation/amplifier_ac/amp.kicad_sch`, so
   * `amplifier_ac` is a folder `dirLevel` synthesised — but it is a project,
   * and the Open button has to be able to take it. Nothing about the path says
   * so, which is why the source says so instead.
   */
  readonly projects?: ReadonlySet<string>;
  /**
   * Which leaves are ordinary FILES rather than whatever `leafKind` says, by
   * absolute path.
   *
   * `leafKind` is one answer for the whole listing, and Templates needs two: a
   * template is a leaf you cannot walk into, and a loose drawing sheet beside
   * it is a file you can open. Both live in the one directory upstream, so both
   * come out of the one listing here.
   */
  readonly fileLeaves?: ReadonlySet<string>;
}

/**
 * Build a listing filesystem.
 *
 * `read` is called on every listing rather than captured, so a place stays
 * current — Recent reorders as projects are opened, and a demo manifest that
 * arrives after the window opened still shows up — without the filesystem
 * having to be rebuilt, which would restart the chooser's reload.
 *
 * `leafKind` is what a path with no more slashes becomes. `below` hands every
 * directory under the root to another filesystem: Recent's rows *are* the
 * account's own projects at the same paths, so it only owns the ordering of
 * the top level and delegates what is inside. Without that, walking into a
 * recent project found an empty folder, because this listing only ever knew
 * the project's name.
 */
export function listFileSystem(
  read: () => Promise<Listing>,
  opts: { leafKind?: EntryKind; below?: FileSystem; files?: LooseFiles } = {},
): FileSystem {
  const leafKind: EntryKind = opts.leafKind ?? 'project';
  const readOnly = async (path: string): Promise<never> => {
    throw new FsError(FsErrorCode.READ_ONLY, path, 'This location cannot be changed.');
  };
  const files = opts.files;

  /**
   * One directory of the listing, with the source's project folders re-marked.
   *
   * `dirLevel` calls every folder it synthesises a `folder`, because for a
   * project's contents that is all any of them are. Here some of them are
   * projects, and only the source knows which.
   */
  const level = (listing: Listing, dir: string): Entry[] =>
    dirLevel(listing.files, segments(dir).join('/'), dir, leafKind).map((e) => {
      if (listing.fileLeaves?.has(e.path)) return { ...e, kind: 'file' as const };
      return e.kind === 'folder' && listing.projects?.has(e.path)
        ? { ...e, kind: 'project' as const }
        : e;
    });

  return {
    async list(dir: string): Promise<Entry[]> {
      if (dir !== ROOT && opts.below) return opts.below.list(dir);
      return level(await read(), dir);
    },
    async stat(path: string): Promise<Entry | null> {
      const parent = fromSegments(segments(path).slice(0, -1));
      if (parent !== ROOT && opts.below) return opts.below.stat(path);
      // Ask the level the path sits in, so a synthesised folder is found the
      // same way a leaf is rather than only leaves being visible to stat.
      return level(await read(), parent).find((e) => e.path === path) ?? null;
    },
    async read(path: string): Promise<Uint8Array> {
      if (files) {
        const text = await files.read(path);
        if (text !== null) return new TextEncoder().encode(text);
      }
      if (opts.below) return opts.below.read(path);
      throw new FsError(FsErrorCode.NOT_FOUND, path);
    },
    // A place with loose files is a real DIRECTORY, so the four writes reach
    // them. Everything else still refuses: a demo cannot be renamed, and a
    // template FOLDER is a manifest rather than a directory of this store.
    write: files
      ? async (path, data) => files.write(path, new TextDecoder().decode(data))
      : readOnly,
    rename: files ? (path, to) => files.rename(path, to) : readOnly,
    remove: files ? (path) => files.remove(path) : readOnly,
    // Still refused even with loose files: this store is flat, so there is no
    // subdirectory for a New Folder to make.
    mkdir: readOnly,
    mkproject: readOnly,
  };
}
