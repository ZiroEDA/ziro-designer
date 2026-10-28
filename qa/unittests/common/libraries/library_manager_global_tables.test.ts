// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The user's global library tables (common/libraries/library_manager.cpp:437-580): a file in the
 * settings path, written on first run with one row chained to the stock table
 * (`CreateGlobalTable`), read back with its nested tables (`LoadGlobalTables`). The stock table is
 * the install's - here the hosted set's, written into a read-only mount at the stock path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_MANAGER } from '@ziroeda/common/libraries/library_manager.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_ROW,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import {
  hostedLibraryTable,
  SetStockLibraryTable,
} from '@ziroeda/common/libraries/library_manager.js';
import { PATHS } from '@ziroeda/common/paths.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import {
  MEMORY_FILESYSTEM,
  wxMountFileSystem,
  wxReadFileSync,
  wxWriteFileSync,
} from '@ziroeda/wx/filefn.js';

const SYM = LIBRARY_TABLE_TYPE.SYMBOL;
const dec = new TextDecoder();
const enc = new TextEncoder();

let cfg: MEMORY_FILESYSTEM;
let unmount: () => void;

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  cfg = new MEMORY_FILESYSTEM();
  unmount = wxMountFileSystem(PATHS.GetUserSettingsPath(), cfg);
  SetStockLibraryTable(
    SYM,
    hostedLibraryTable(SYM, [{ name: 'Device' }, { name: 'power' }], (n) => `/hosted/${n}`),
  );
});

afterEach(() => {
  unmount();
  SetPgm(null);
});

const userTable = (): LIBRARY_TABLE =>
  LIBRARY_TABLE.FromFile(
    LIBRARY_MANAGER.DefaultGlobalTablePath(SYM),
    dec.decode(wxReadFileSync(LIBRARY_MANAGER.DefaultGlobalTablePath(SYM))!),
    LIBRARY_TABLE_SCOPE.GLOBAL,
  );

describe('the paths', () => {
  it('keeps the user table beside the settings, and the stock one with the templates', () => {
    expect(LIBRARY_MANAGER.DefaultGlobalTablePath(SYM)).toBe(
      `${PATHS.GetUserSettingsPath().replace(/\/+$/, '')}/sym-lib-table`,
    );
    expect(LIBRARY_MANAGER.StockTablePath(SYM)).toBe(
      `${PATHS.GetStockTemplatesPath().replace(/\/+$/, '')}/sym-lib-table`,
    );
    expect(LIBRARY_MANAGER.StockTableReferenceURI(SYM)).toBe(LIBRARY_MANAGER.StockTablePath(SYM));
  });
});

describe('CreateGlobalTable', () => {
  it('writes one row, "KiCad", chained to the stock table', () => {
    expect(LIBRARY_MANAGER.CreateGlobalTable(SYM, true)).toBe(true);

    const rows = userTable().Rows();
    expect(rows.length).toBe(1);
    expect([rows[0]!.Nickname(), rows[0]!.Type(), rows[0]!.URI(), rows[0]!.Description()]).toEqual([
      'KiCad',
      LIBRARY_TABLE_ROW.TABLE_TYPE_NAME,
      LIBRARY_MANAGER.StockTablePath(SYM),
      'KiCad Default Libraries',
    ]);
    expect(userTable().Type()).toBe(SYM);
  });

  it('writes no row when told not to populate it', () => {
    expect(LIBRARY_MANAGER.CreateGlobalTable(SYM, false)).toBe(true);
    expect(userTable().Rows().length).toBe(0);
  });

  it('fails with nowhere to write', () => {
    unmount();
    unmount = () => {};
    expect(LIBRARY_MANAGER.CreateGlobalTable(SYM, true)).toBe(false);
  });
});

describe('IsTableValid', () => {
  it('is a readable table that parses', () => {
    const path = LIBRARY_MANAGER.DefaultGlobalTablePath(SYM);
    expect(LIBRARY_MANAGER.IsTableValid(path)).toBe(false);

    cfg.Write('sym-lib-table', enc.encode('(sym_lib_table (version 7) (lib'));
    expect(LIBRARY_MANAGER.IsTableValid(path)).toBe(false);

    LIBRARY_MANAGER.CreateGlobalTable(SYM, true);
    expect(LIBRARY_MANAGER.IsTableValid(path)).toBe(true);
  });
});

describe('LoadGlobalTables', () => {
  it("reads the user's table, the stock libraries through its chain row beside its own", () => {
    LIBRARY_MANAGER.CreateGlobalTable(SYM, true);
    const table = userTable();
    const mine = table.InsertRow();
    mine.SetNickname('Mine');
    mine.SetType('KiCad');
    mine.SetURI('/Symbols/Mine.kicad_sym');
    expect(table.Save().ok).toBe(true);

    Pgm().GetLibraryManager().LoadGlobalTables([SYM]);

    const rows = Pgm().GetLibraryManager().Rows(SYM, LIBRARY_TABLE_SCOPE.GLOBAL);
    expect(rows.map((r) => r.Nickname())).toEqual(['Device', 'power', 'Mine']);
    expect(rows[0]!.URI()).toBe('/hosted/Device');
  });

  it('leaves no global table when the user has none', () => {
    Pgm().GetLibraryManager().LoadGlobalTables([SYM]);
    expect(Pgm().GetLibraryManager().Table(SYM, LIBRARY_TABLE_SCOPE.GLOBAL)).toBeNull();
  });
});

describe('hostedLibraryTable', () => {
  it("gives each row its library's description, which the stock table file keeps", () => {
    SetStockLibraryTable(
      SYM,
      hostedLibraryTable(
        SYM,
        [{ name: 'Device', descr: 'Generic symbols for common devices' }, { name: 'power' }],
        (n) => `/hosted/${n}`,
      ),
    );
    LIBRARY_MANAGER.CreateGlobalTable(SYM, true);
    Pgm().GetLibraryManager().LoadGlobalTables([SYM]);

    const rows = Pgm().GetLibraryManager().Rows(SYM, LIBRARY_TABLE_SCOPE.GLOBAL);
    expect(rows.map((r) => [r.Nickname(), r.Description()])).toEqual([
      ['Device', 'Generic symbols for common devices'],
      ['power', ''],
    ]);
  });
});

describe('the stock table', () => {
  it('is read-only, as an install path is', () => {
    const path = LIBRARY_MANAGER.StockTablePath(SYM);
    const stock = LIBRARY_TABLE.FromFile(
      path,
      dec.decode(wxReadFileSync(path)!),
      LIBRARY_TABLE_SCOPE.GLOBAL,
    );

    expect(stock.Rows().map((r) => r.Nickname())).toEqual(['Device', 'power']);
    expect(stock.IsReadOnly()).toBe(true);
    expect(wxWriteFileSync(path, enc.encode('(sym_lib_table (version 7))'))).toBe(false);
  });

  it("leaves the user's own table writable", () => {
    LIBRARY_MANAGER.CreateGlobalTable(SYM, true);
    expect(userTable().IsReadOnly()).toBe(false);
  });
});
