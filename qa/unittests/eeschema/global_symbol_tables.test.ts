// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * LoadGlobalSymbolTables (eeschema/libraries/symbol_library_adapter.ts): the program's global
 * symbol table as KiCad 10 has it - the user's table in the settings path, chaining the stock one,
 * which here is the hosted set. The windows call it once they have the hosted index.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_MANAGER } from '@ziroeda/common/libraries/library_manager.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { PATHS } from '@ziroeda/common/paths.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_SETTINGS } from '@ziroeda/common/settings/kicad_settings.js';
import {
  configureSymbolLibraryAdapter,
  isHostedSymbolLibraryRow,
  LoadGlobalSymbolTables,
  loadIndex,
} from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem, wxReadFileSync } from '@ziroeda/wx/filefn.js';
import { SymbolLibAdapter } from '@ziroeda/eeschema/project_sch.js';

const SYM = LIBRARY_TABLE_TYPE.SYMBOL;
const dec = new TextDecoder();

let cfg: MEMORY_FILESYSTEM;
let unmount: () => void;

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  cfg = new MEMORY_FILESYSTEM();
  unmount = wxMountFileSystem(PATHS.GetUserSettingsPath(), cfg);
});

afterEach(() => {
  unmount();
  SetPgm(null);
});

const globalRows = () => Pgm().GetLibraryManager().Rows(SYM, LIBRARY_TABLE_SCOPE.GLOBAL);

/** The user's table as stored. */
const stored = (): LIBRARY_TABLE =>
  LIBRARY_TABLE.FromFile(
    LIBRARY_MANAGER.DefaultGlobalTablePath(SYM),
    dec.decode(wxReadFileSync(LIBRARY_MANAGER.DefaultGlobalTablePath(SYM))!),
    LIBRARY_TABLE_SCOPE.GLOBAL,
  );

describe('LoadGlobalSymbolTables', () => {
  // 2026-10-28: a symbol of the user's own library, listed in Choose Symbol, placed nothing. The
  // project's preload (AsyncLoad) runs when it opens, before the index - and so the global
  // tables - are in, and LoadSymbol reads only libraries already loaded.
  it("loads the user's own libraries into an adapter that preloaded before them", () => {
    const device = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "R" (in_bom yes) (on_board yes)
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "R_0_1" (rectangle (start -1.016 -2.54) (end 1.016 2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
)
`;
    const symbols = new MEMORY_FILESYSTEM();
    const unmountSymbols = wxMountFileSystem('/Symbols', symbols);
    try {
      symbols.Write('Mine.kicad_sym', new TextEncoder().encode(device));
      LoadGlobalSymbolTables([{ name: 'Device' }]);
      const table = stored();
      const mine = table.InsertRow();
      mine.SetNickname('Mine');
      mine.SetType('KiCad');
      mine.SetURI('/Symbols/Mine.kicad_sym');
      expect(table.Save().ok).toBe(true);

      // A fresh program: the project opens and preloads, then the index brings the tables.
      SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
      const adapter = SymbolLibAdapter(null);
      adapter.AsyncLoad();
      expect(adapter.LoadSymbol('Mine', 'R')).toBeNull();

      LoadGlobalSymbolTables([{ name: 'Device' }]);

      expect(adapter.LoadSymbol('Mine', 'R')?.GetName()).toBe('R');
    } finally {
      unmountSymbols();
    }
  });

  it("writes the user's table on first run, and the hosted libraries come through its chain", () => {
    LoadGlobalSymbolTables([{ name: 'Device' }, { name: 'power' }]);

    expect(
      stored()
        .Rows()
        .map((r) => [r.Nickname(), r.Type()]),
    ).toEqual([['KiCad', 'Table']]);
    expect(globalRows().map((r) => r.Nickname())).toEqual(['Device', 'power']);
    expect(globalRows().every(isHostedSymbolLibraryRow)).toBe(true);
  });

  it("keeps the user's own rows, which are not hosted, across a reload", () => {
    LoadGlobalSymbolTables([{ name: 'Device' }]);
    const table = stored();
    const mine = table.InsertRow();
    mine.SetNickname('Mine');
    mine.SetType('KiCad');
    mine.SetURI('/Symbols/Mine.kicad_sym');
    expect(table.Save().ok).toBe(true);

    LoadGlobalSymbolTables([{ name: 'Device' }, { name: 'power' }]);

    expect(globalRows().map((r) => r.Nickname())).toEqual(['Device', 'power', 'Mine']);
    expect(
      globalRows()
        .filter((r) => !isHostedSymbolLibraryRow(r))
        .map((r) => r.Nickname()),
    ).toEqual(['Mine']);
  });

  it('leaves out of the stock table a library the tables already name', () => {
    LoadGlobalSymbolTables([]);
    const table = stored();
    const mine = table.InsertRow();
    mine.SetNickname('Mine');
    mine.SetType('KiCad');
    mine.SetURI('/Symbols/Mine.kicad_sym');
    table.Save();
    LoadGlobalSymbolTables([]);

    // The index lists every library it read, "Mine" included.
    LoadGlobalSymbolTables([{ name: 'Device' }, { name: 'Mine' }]);

    const mineRows = globalRows().filter((r) => r.Nickname() === 'Mine');
    expect(mineRows.length).toBe(1);
    expect(mineRows[0]!.URI()).toBe('/Symbols/Mine.kicad_sym');
    const stockText = dec.decode(wxReadFileSync(LIBRARY_MANAGER.StockTablePath(SYM))!);
    expect(stockText).not.toContain('"Mine"');
  });

  it('makes the stock table the global one when there is nowhere to keep a user table', () => {
    unmount();
    unmount = () => {};

    LoadGlobalSymbolTables([{ name: 'Device' }]);

    expect(globalRows().map((r) => r.Nickname())).toEqual(['Device']);
    expect(Pgm().GetLibraryManager().Table(SYM, LIBRARY_TABLE_SCOPE.GLOBAL)!.IsReadOnly()).toBe(
      true,
    );
  });
});

/**
 * PGM_KICAD::OnPgmInit loads the global tables for every window (kicad.cpp:295). Ours are read the
 * first time the hosted index is in, inside the one index load every chooser shares, so a library
 * in the user's table is in the schematic's Place Symbol tree without the Symbol Editor having
 * been opened first.
 */
describe('the symbol index', () => {
  it("installs the global tables once the hosted set is in, the user's own rows read beside it", async () => {
    const SYMBOLS = new MEMORY_FILESYSTEM();
    const unmountSymbols = wxMountFileSystem('/Symbols', SYMBOLS);
    try {
      SYMBOLS.Write(
        'Mine.kicad_sym',
        new TextEncoder().encode(`(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "M" (in_bom yes) (on_board yes)
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "M" (at 0 0 0) (effects (font (size 1.27 1.27))))))`),
      );
      cfg.Write(
        'sym-lib-table',
        new TextEncoder().encode(`(sym_lib_table
  (version 7)
  (lib (name "KiCad")(type "Table")(uri "${LIBRARY_MANAGER.StockTableReferenceURI(SYM)}")(options "")(descr ""))
  (lib (name "Mine")(type "KiCad")(uri "/Symbols/Mine.kicad_sym")(options "")(descr ""))
)
`),
      );
      configureSymbolLibraryAdapter({
        symbolsBase: () => '',
        fetchIndex: () =>
          Promise.resolve([
            {
              name: 'Device',
              count: 1,
              symbols: ['R'],
              descr: 'Generic symbols for common devices',
            },
          ]),
        trackLoad: (_aLabel, aWork) => aWork,
        loadLibraryItemsPooled: () => Promise.resolve([]),
      });

      const index = await loadIndex();

      expect(index.map((e) => e.name)).toEqual(['Device', 'Mine']);
      expect(globalRows().map((r) => r.Nickname())).toEqual(['Device', 'Mine']);
      // The stock row has the index's description, as template/sym-lib-table's has; the user's
      // own row keeps its file's.
      expect(globalRows().map((r) => r.Description())).toEqual([
        'Generic symbols for common devices',
        '',
      ]);
    } finally {
      unmountSymbols();
    }
  });
});

/**
 * What the chooser lists is the manager's enabled, shown rows (`AddLibraries`, eeschema manual:
 * "Inactive libraries ... do not appear in any library browsers"; an unchecked Show hides one):
 * the hosted set is filtered by them, not listed whole beside them.
 */
describe('the symbol index, through the tables', () => {
  const hostedIndex = () =>
    configureSymbolLibraryAdapter({
      symbolsBase: () => '',
      fetchIndex: () =>
        Promise.resolve([
          { name: 'Device', count: 1, symbols: ['R'] },
          { name: 'power', count: 1, symbols: ['GND'] },
        ]),
      trackLoad: (_aLabel, aWork) => aWork,
      loadLibraryItemsPooled: () => Promise.resolve([]),
    });

  it('leaves out a stock library the user hid in the KiCad tab (ApplyLibOverrides)', async () => {
    hostedIndex();
    const kicad = Pgm().GetSettingsManager().RegisterSettings(new KICAD_SETTINGS());
    kicad.m_LibOverrides.set(
      LIBRARY_MANAGER.StockTablePath(SYM),
      new Map([['Device', { disabled: false, hidden: true }]]),
    );

    LoadGlobalSymbolTables([{ name: 'Device' }, { name: 'power' }]);

    // The nested stock table took the override as it was read (loadNestedTables).
    expect(globalRows().map((r) => [r.Nickname(), r.Hidden()])).toEqual([
      ['Device', true],
      ['power', false],
    ]);
    expect((await loadIndex()).map((e) => e.name)).not.toContain('Device');
  });

  // ApplyLibOverrides: `if( !aTable.IsReadOnly() ) return;` - a writable table keeps its own
  // Enable and Show in its file, so an override filed under its path is not read.
  it("leaves the user's own, writable table to its file, whatever overrides say", () => {
    const kicad = Pgm().GetSettingsManager().RegisterSettings(new KICAD_SETTINGS());
    const userTable = LIBRARY_MANAGER.DefaultGlobalTablePath(SYM);
    kicad.m_LibOverrides.set(userTable, new Map([['Mine', { disabled: true, hidden: true }]]));
    cfg.Write(
      'sym-lib-table',
      new TextEncoder().encode(`(sym_lib_table
  (version 7)
  (lib (name "Mine")(type "KiCad")(uri "/Symbols/Mine.kicad_sym")(options "")(descr ""))
)
`),
    );
    const table = LIBRARY_TABLE.FromFile(
      userTable,
      dec.decode(wxReadFileSync(userTable)!),
      LIBRARY_TABLE_SCOPE.GLOBAL,
    );

    Pgm().GetLibraryManager().ApplyLibOverrides(table);

    expect(table.Rows().map((r) => [r.Nickname(), r.Disabled(), r.Hidden()])).toEqual([
      ['Mine', false, false],
    ]);
  });

  it('lists no stock library once the KiCad row chaining them is disabled', async () => {
    hostedIndex();
    cfg.Write(
      'sym-lib-table',
      new TextEncoder().encode(`(sym_lib_table
  (version 7)
  (lib (name "KiCad")(type "Table")(uri "${LIBRARY_MANAGER.StockTableReferenceURI(SYM)}")(options "")(descr "")(disabled))
)
`),
    );

    LoadGlobalSymbolTables([{ name: 'Device' }, { name: 'power' }]);

    expect(await loadIndex()).toEqual([]);
  });
});
