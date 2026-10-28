// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The account's Symbols folder, `GetDefaultUserSymbolsPath()`'s, as a file system KiCad's code reads
 * and writes like any directory.
 *
 * A symbol library saved or dropped into the account goes there and is named by a library table row
 * as `/Symbols/<lib>.kicad_sym`, from any project. KiCad's reads and writes are synchronous, so the
 * folder is held in memory, loaded from the account store when it is mounted, and every write goes
 * back to the store - the cloud sync takes it from there, as it does a project's files.
 *
 * A library may be a FILE or a FOLDER (KiCad 10 keeps a symbol directory as one `.kicad_sym` per
 * symbol), so the load walks the folder all the way down.
 */
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/wx/filefn.js';
import { USER_DIRS } from './chooser_places.js';
import type { FileSystem } from './filesystem.js';

/**
 * Mount the account's Symbols folder from \a aStore at its own path.
 *
 * @return the unmount, which leaves the store as the writes made it.
 */
export function mountUserSymbolsFolder(aStore: FileSystem): Promise<() => void> {
  return mountUserLibraryFolder(aStore, USER_DIRS.symbols);
}

/**
 * Mount the account's Footprints folder, `/Footprints`, the same way: a footprint library is a
 * `.pretty` folder of `.kicad_mod` files there, named by a row of the user's global table.
 */
export function mountUserFootprintsFolder(aStore: FileSystem): Promise<() => void> {
  return mountUserLibraryFolder(aStore, USER_DIRS.footprints);
}

/**
 * Mount the account's Design Blocks folder the same way: a design block library is a
 * `.kicad_blocks` folder there, each block a `.kicad_block` folder in it.
 */
export function mountUserDesignBlocksFolder(aStore: FileSystem): Promise<() => void> {
  return mountUserLibraryFolder(aStore, USER_DIRS.designBlocks);
}

/** Mount the account folder \a root from \a aStore at its own path, every write going back. */
async function mountUserLibraryFolder(aStore: FileSystem, root: string): Promise<() => void> {
  const fs = new MEMORY_FILESYSTEM();

  const load = async (aDir: string): Promise<void> => {
    for (const entry of await aStore.list(aDir)) {
      const rel = entry.path.slice(root.length + 1);

      if (entry.kind === 'file') {
        fs.Write(rel, await aStore.read(entry.path));
      } else {
        fs.Mkdir(rel);
        await load(entry.path);
      }
    }
  };

  // A new account has no such folder until something is put in it.
  if (await aStore.stat(root)) await load(root);

  fs.SetWriteListener((aRel, aData) => {
    aStore.write(`${root}/${aRel}`, aData).catch((e: unknown) => {
      console.warn(`Could not save ${root}/${aRel} to the account:`, e);
    });
  });

  // An empty library is an empty folder (CreateLibrary's `.pretty`): made in the account too.
  fs.SetMkdirListener((aRel) => {
    aStore.mkdir(`${root}/${aRel}`).catch(() => {
      // Already there: the first file in it would have made it anyway.
    });
  });

  return wxMountFileSystem(root, fs);
}
