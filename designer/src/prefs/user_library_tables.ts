// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The user's global library tables where KiCad keeps them: files in `PATHS::GetUserSettingsPath()`,
 * beside the settings (`LIBRARY_MANAGER::DefaultGlobalTablePath`). KiCad's code reads and writes
 * them as files - `LoadGlobalTables`, `CreateGlobalTable`, a table's `Save()` - so they are mounted
 * there, each backed by its settings slice, which is what the account syncs.
 *
 * The symbol, footprint and design block tables.
 */
import { LIBRARY_MANAGER } from '@ziroeda/common/libraries/library_manager.js';
import { LIBRARY_TABLE_TYPE } from '@ziroeda/common/libraries/library_table.js';
import { PATHS } from '@ziroeda/common/paths.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/wx/filefn.js';

/** What the mount asks of the settings: each table's text, and a change to it. */
export interface USER_LIBRARY_TABLE_SETTINGS {
  readonly symLibTable: string;
  setSymLibTable(aText: string): void;
  readonly fpLibTable: string;
  setFpLibTable(aText: string): void;
  readonly designBlockLibTable: string;
  setDesignBlockLibTable(aText: string): void;
  subscribe(aListener: () => void): () => void;
}

/** Mount the user's global library tables, following the slices as the account changes them. */
export function mountUserLibraryTables(aSettings: USER_LIBRARY_TABLE_SETTINGS): () => void {
  const fs = new MEMORY_FILESYSTEM();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  // Each table's file, with its slice's text and how a save reaches the slice.
  const tables = [
    {
      name: LIBRARY_MANAGER.TableFileName(LIBRARY_TABLE_TYPE.SYMBOL),
      text: () => aSettings.symLibTable,
      set: (aText: string) => aSettings.setSymLibTable(aText),
      shown: '',
    },
    {
      name: LIBRARY_MANAGER.TableFileName(LIBRARY_TABLE_TYPE.FOOTPRINT),
      text: () => aSettings.fpLibTable,
      set: (aText: string) => aSettings.setFpLibTable(aText),
      shown: '',
    },
    {
      name: LIBRARY_MANAGER.TableFileName(LIBRARY_TABLE_TYPE.DESIGN_BLOCK),
      text: () => aSettings.designBlockLibTable,
      set: (aText: string) => aSettings.setDesignBlockLibTable(aText),
      shown: '',
    },
  ];
  let refreshing = false;

  // The slices into the files: at mount, and when the account brings another device's change.
  const refresh = (): void => {
    for (const t of tables) {
      const text = t.text();

      if (text === t.shown) continue;

      t.shown = text;
      refreshing = true;

      if (text === '') fs.Remove(t.name);
      else fs.Write(t.name, enc.encode(text));

      refreshing = false;
    }
  };

  // A file into its slice: a save of the table.
  fs.SetWriteListener((aRel, aData) => {
    const t = tables.find((x) => x.name === aRel);

    if (refreshing || !t) return;

    t.shown = dec.decode(aData);
    t.set(t.shown);
  });

  refresh();

  const unsubscribe = aSettings.subscribe(refresh);
  const unmount = wxMountFileSystem(PATHS.GetUserSettingsPath(), fs);

  return () => {
    unsubscribe();
    unmount();
  };
}
