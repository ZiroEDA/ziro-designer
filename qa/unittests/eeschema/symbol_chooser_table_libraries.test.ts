// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The chooser's libraries are every enabled, visible row of the symbol tables, as
 * `SYMBOL_TREE_MODEL_ADAPTER::AddLibraries` walks `manager.Rows( LIBRARY_TABLE_TYPE::SYMBOL )`
 * (symbol_tree_model_adapter.cpp:116-123): the hosted set standing in for the global table, and a
 * project's own libraries beside it, read from the file each row names.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import {
  configureSymbolLibraryAdapter,
  hostedSymbolLibraryUri,
  libraryLoaded,
  loadIndex,
  loadSymbol,
  loadedLibraryItems,
  preloadLibraryItems,
} from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import { hostedLibraryTable } from '@ziroeda/common/dialogs/lib_table_panel.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/wx/filefn.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const R = readFileSync(resolve(__dirname, '../../data/R.kicad_sym'), 'utf8');
const fetched: string[] = [];
let unmount: () => void = () => {};

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  configureSymbolLibraryAdapter({
    symbolsBase: () => 'https://host/symbols',
    fetchIndex: async () => [
      { name: 'Device', count: 1, symbols: ['C'] },
      { name: 'Connector', count: 1, symbols: ['Conn_01x02'] },
    ],
    trackLoad: (_l, w) => w,
    loadLibraryItemsPooled: async () => [],
  });
  fetched.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return new Response('', { status: 404 });
  });

  const fs = new MEMORY_FILESYSTEM();
  fs.Write('MyLib.kicad_sym', new TextEncoder().encode(R));
  fs.Write('Off.kicad_sym', new TextEncoder().encode(R));
  fs.Write('Device.kicad_sym', new TextEncoder().encode(R));
  unmount = wxMountFileSystem('/proj', fs);

  const table = `(sym_lib_table
  (version 7)
  (lib (name "MyLib")(type "KiCad")(uri "/proj/MyLib.kicad_sym")(options "")(descr "My parts"))
  (lib (name "Off")(type "KiCad")(uri "/proj/Off.kicad_sym")(options "")(descr "")(disabled))
  (lib (name "Gone")(type "KiCad")(uri "/proj/Gone.kicad_sym")(options "")(descr ""))
  (lib (name "Device")(type "KiCad")(uri "/proj/Device.kicad_sym")(options "")(descr "Project Device"))
)`;
  Pgm()
    .GetLibraryManager()
    .SetTable(
      LIBRARY_TABLE_TYPE.SYMBOL,
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE.FromFile(
        '/proj/sym-lib-table',
        table,
        LIBRARY_TABLE_SCOPE.PROJECT,
        LIBRARY_TABLE_TYPE.SYMBOL,
      ),
    );
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  SetPgm(null);
});

describe('the symbol chooser’s libraries', () => {
  it('adds a project library beside the hosted ones, read from its file', async () => {
    const index = await loadIndex();
    const mine = index.find((e) => e.name === 'MyLib');
    expect(mine?.symbols).toEqual(['R']);
    expect(mine?.descr).toBe('My parts');
    expect(libraryLoaded('MyLib')).toBe(true);
    expect(loadedLibraryItems('MyLib')?.map((i) => i.name)).toEqual(['R']);
  });

  it('leaves out a disabled row and a row whose file is missing', async () => {
    const names = (await loadIndex()).map((e) => e.name);
    expect(names).not.toContain('Off');
    expect(names).not.toContain('Gone');
  });

  it('lets a project row replace a hosted library of the same nickname, in place', async () => {
    const index = await loadIndex();
    expect(index.map((e) => e.name).slice(0, 2)).toEqual(['Device', 'Connector']);
    expect(index[0]!.symbols).toEqual(['R']);
    expect(index[0]!.descr).toBe('Project Device');
  });

  it('previews and preloads a project symbol without asking the host', async () => {
    await loadIndex();
    expect((await loadSymbol('MyLib', 'R'))?.libId).toBe('MyLib:R');
    expect((await preloadLibraryItems('MyLib')).map((i) => i.name)).toEqual(['R']);
    expect(fetched).toEqual([]);
  });

  it('keeps a hosted global row the index’s own, not re-read from its download folder', async () => {
    Pgm()
      .GetLibraryManager()
      .SetTable(
        LIBRARY_TABLE_TYPE.SYMBOL,
        LIBRARY_TABLE_SCOPE.GLOBAL,
        hostedLibraryTable(
          LIBRARY_TABLE_TYPE.SYMBOL,
          [{ name: 'Connector' }],
          hostedSymbolLibraryUri,
        ),
      );
    const connector = (await loadIndex()).find((e) => e.name === 'Connector');
    expect(connector?.symbols).toEqual(['Conn_01x02']);
    expect(libraryLoaded('Connector')).toBe(false);
  });

  it('is only the hosted index when no table adds anything', async () => {
    SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
    expect((await loadIndex()).map((e) => e.name)).toEqual(['Device', 'Connector']);
  });
});
