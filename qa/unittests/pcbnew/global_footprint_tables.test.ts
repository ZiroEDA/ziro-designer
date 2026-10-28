// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * LoadGlobalFootprintTables and the footprint store's global libraries (pcbnew/
 * footprint_library_adapter.ts): the user's fp-lib-table in the settings path, chaining the stock
 * one - the hosted set - and naming libraries of their own in the account's Footprints folder.
 * The store lists what the library manager's global rows list, and reads and writes a user
 * library's `.pretty` where its row says.
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
import {
  FOOTPRINT_LIBRARY_STORE,
  isHostedFootprintLibraryRow,
  LoadGlobalFootprintTables,
  SAVE_T,
} from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem, wxReadFileSync } from '@ziroeda/wx/filefn.js';

const FP = LIBRARY_TABLE_TYPE.FOOTPRINT;
const enc = new TextEncoder();
const dec = new TextDecoder();

const FP_TEXT = (aName: string): string => `(footprint "${aName}"
  (layer "F.Cu")
  (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))`;

let cfg: MEMORY_FILESYSTEM;
let account: MEMORY_FILESYSTEM;
let unmounts: (() => void)[];
let store: FOOTPRINT_LIBRARY_STORE;

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  cfg = new MEMORY_FILESYSTEM();
  account = new MEMORY_FILESYSTEM();
  account.Write('Mine.pretty/C_0402.kicad_mod', enc.encode(FP_TEXT('C_0402')));
  unmounts = [
    wxMountFileSystem(PATHS.GetUserSettingsPath(), cfg),
    wxMountFileSystem('/Footprints', account),
  ];
  store = new FOOTPRINT_LIBRARY_STORE({
    footprintText: (_aNick, aName) => Promise.resolve(FP_TEXT(aName)),
    flipLeftRight: () => false,
  });
  store.AddGlobalLibrary('Resistor_SMD', ['R_0402']);
  store.AddGlobalLibrary('Capacitor_SMD', ['C_0603']);
});

afterEach(() => {
  for (const u of unmounts) u();
  SetPgm(null);
});

/** The user's table: the KiCad chain row (enabled or not) and \a aRows of their own. */
const writeUserTable = (aKiCadDisabled: boolean, aRows = ''): void => {
  cfg.Write(
    'fp-lib-table',
    enc.encode(`(fp_lib_table
  (version 7)
  (lib (name "KiCad")(type "Table")(uri "${LIBRARY_MANAGER.StockTableReferenceURI(FP)}")(options "")(descr "")${aKiCadDisabled ? '(disabled)' : ''})
  ${aRows}
)
`),
  );
};

describe('LoadGlobalFootprintTables', () => {
  it('writes the user table on first run, the hosted libraries coming through its chain', () => {
    LoadGlobalFootprintTables([{ name: 'Resistor_SMD', descr: 'Resistor SMD' }]);

    const rows = Pgm().GetLibraryManager().Rows(FP, LIBRARY_TABLE_SCOPE.GLOBAL);
    expect(rows.map((r) => [r.Nickname(), r.Description()])).toEqual([
      ['Resistor_SMD', 'Resistor SMD'],
    ]);
    expect(isHostedFootprintLibraryRow(rows[0]!)).toBe(true);

    const user = LIBRARY_TABLE.FromFile(
      LIBRARY_MANAGER.DefaultGlobalTablePath(FP),
      dec.decode(wxReadFileSync(LIBRARY_MANAGER.DefaultGlobalTablePath(FP))!),
      LIBRARY_TABLE_SCOPE.GLOBAL,
    );
    expect(user.Rows().map((r) => r.Nickname())).toEqual(['KiCad']);
  });
});

describe("the store's global libraries", () => {
  it('lists every hosted library while no global table is loaded', () => {
    expect(store.GetLibraryNames()).toEqual(['Capacitor_SMD', 'Resistor_SMD']);
  });

  it("lists the global table's rows: the hosted ones through the chain, and the user's own", () => {
    writeUserTable(
      false,
      '(lib (name "Mine")(type "KiCad")(uri "/Footprints/Mine.pretty")(options "")(descr ""))',
    );
    LoadGlobalFootprintTables([{ name: 'Resistor_SMD' }, { name: 'Capacitor_SMD' }]);

    expect(store.GetLibraryNames()).toEqual(['Capacitor_SMD', 'Mine', 'Resistor_SMD']);
    expect(store.GetFootprintNames('Mine')).toEqual(['C_0402']);
    expect(store.LoadFootprint('Mine', 'C_0402', false)?.GetFPID().Format()).toBe('Mine:C_0402');
  });

  it("indexes the user's own library for the chooser, with the project's", () => {
    writeUserTable(
      false,
      '(lib (name "Mine")(type "KiCad")(uri "/Footprints/Mine.pretty")(options "")(descr ""))',
    );
    LoadGlobalFootprintTables([{ name: 'Resistor_SMD' }, { name: 'Capacitor_SMD' }]);

    expect(store.OwnIndex().map((l) => [l.name, l.footprints])).toEqual([['Mine', ['C_0402']]]);
  });

  it('lists no hosted library once the KiCad row chaining them is disabled', () => {
    writeUserTable(
      true,
      '(lib (name "Mine")(type "KiCad")(uri "/Footprints/Mine.pretty")(options "")(descr ""))',
    );
    LoadGlobalFootprintTables([{ name: 'Resistor_SMD' }, { name: 'Capacitor_SMD' }]);

    expect(store.GetLibraryNames()).toEqual(['Mine']);
  });

  it("lists no library of the user's own whose row is disabled", () => {
    writeUserTable(
      false,
      '(lib (name "Mine")(type "KiCad")(uri "/Footprints/Mine.pretty")(options "")(descr "")(disabled))',
    );
    LoadGlobalFootprintTables([{ name: 'Resistor_SMD' }, { name: 'Capacitor_SMD' }]);

    expect(store.GetLibraryNames()).toEqual(['Capacitor_SMD', 'Resistor_SMD']);
  });

  it('reads the table again when it is loaded again, as the dialog OK loads it', () => {
    writeUserTable(false);
    LoadGlobalFootprintTables([{ name: 'Resistor_SMD' }, { name: 'Capacitor_SMD' }]);
    expect(store.HasLibrary('Mine')).toBe(false);

    writeUserTable(
      false,
      '(lib (name "Mine")(type "KiCad")(uri "/Footprints/Mine.pretty")(options "")(descr ""))',
    );
    Pgm().GetLibraryManager().LoadGlobalTables([FP]);

    expect(store.HasLibrary('Mine')).toBe(true);
  });

  it('saves into a user library, in its folder; a hosted one stays read only', () => {
    writeUserTable(
      false,
      '(lib (name "Mine")(type "KiCad")(uri "/Footprints/Mine.pretty")(options "")(descr ""))',
    );
    LoadGlobalFootprintTables([{ name: 'Resistor_SMD' }, { name: 'Capacitor_SMD' }]);

    expect(store.IsFootprintLibWritable('Mine')).toBe(true);
    expect(store.IsFootprintLibWritable('Resistor_SMD')).toBe(false);

    const fp = store.LoadFootprint('Mine', 'C_0402', false)!;
    fp.GetFPID().SetLibItemName('C_0603_Mine');
    expect(store.SaveFootprint('Mine', fp)).toBe(SAVE_T.SAVE_OK);
    expect(account.Read('Mine.pretty/C_0603_Mine.kicad_mod')).not.toBeNull();
    expect(store.GetFootprintNames('Mine')).toEqual(['C_0402', 'C_0603_Mine']);

    store.DeleteFootprint('Mine', 'C_0402');
    expect(account.Read('Mine.pretty/C_0402.kicad_mod')).toBeNull();

    expect(store.SaveFootprint('Resistor_SMD', fp)).toBe(SAVE_T.SAVE_SKIPPED);
  });

  it('a project library named as a global one hides it, and gives it back', () => {
    writeUserTable(
      false,
      '(lib (name "Mine")(type "KiCad")(uri "/Footprints/Mine.pretty")(options "")(descr ""))',
    );
    LoadGlobalFootprintTables([{ name: 'Resistor_SMD' }, { name: 'Capacitor_SMD' }]);
    store.SetProjectLibraries([
      {
        name: 'b/fp-lib-table',
        text: '(fp_lib_table (version 7) (lib (name "Mine")(type "KiCad")(uri "${KIPRJMOD}/m.pretty")(options "")(descr "")))',
      },
      { name: 'b/m.pretty/P.kicad_mod', text: FP_TEXT('P') },
    ]);
    expect(store.GetFootprintNames('Mine')).toEqual(['P']);

    store.SetProjectLibraries([]);
    expect(store.GetFootprintNames('Mine')).toEqual(['C_0402']);
  });
});
