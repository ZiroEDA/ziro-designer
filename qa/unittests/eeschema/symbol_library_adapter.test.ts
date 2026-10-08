// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SYMBOL_LIBRARY_ADAPTER (libraries/symbol_library_adapter.cpp) and SCH_IO_MGR (sch_io_mgr.cpp):
 * the symbol libraries of the library tables, loaded through their plugin on the mounted files.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KICTL_CREATE } from '@ziroeda/common/kiway_player.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LIBRARY_MANAGER, LOAD_STATUS } from '@ziroeda/common/libraries/library_manager.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import {
  MEMORY_FILESYSTEM,
  wxFileExists,
  wxMountFileSystem,
  wxReadFileSync,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import {
  SAVE_T,
  SYMBOL_LIBRARY_ADAPTER,
  SYMBOL_TYPE,
} from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_FILE_T, SCH_IO_MGR } from '@ziroeda/eeschema/sch_io/sch_io_mgr.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const DATA = resolve(__dirname, '../../data');
const bytes = (aRel: string) => new Uint8Array(readFileSync(resolve(DATA, aRel)));

let unmount: () => void = () => {};

beforeEach(() => {
  const fs = new MEMORY_FILESYSTEM();
  fs.Write('all.kicad_sym', bytes('eeschema/legacy/legacy_all.kicad_sym'));
  fs.Write('R.kicad_sym', bytes('R.kicad_sym'));
  fs.Write('nested-table', new TextEncoder().encode('(sym_lib_table (version 7))'));
  unmount = wxMountFileSystem('/libs', fs);
});
afterEach(() => unmount());

const row = (aName: string, aUri: string, aType = 'KiCad') =>
  `(lib (name "${aName}")(type "${aType}")(uri "${aUri}")(options "")(descr ""))`;

function adapter(aRows: string): SYMBOL_LIBRARY_ADAPTER {
  const m = new LIBRARY_MANAGER();
  m.SetTable(
    LIBRARY_TABLE_TYPE.SYMBOL,
    LIBRARY_TABLE_SCOPE.PROJECT,
    LIBRARY_TABLE.FromFile(
      '/libs/sym-lib-table',
      `(sym_lib_table (version 7) ${aRows})`,
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE_TYPE.SYMBOL,
    ),
  );
  return new SYMBOL_LIBRARY_ADAPTER(m);
}

describe('SCH_IO_MGR', () => {
  it('type names round trip, and an unknown name is SCH_FILE_UNKNOWN', () => {
    for (const t of [
      SCH_FILE_T.SCH_KICAD,
      SCH_FILE_T.SCH_LEGACY,
      SCH_FILE_T.SCH_PADS,
      SCH_FILE_T.SCH_NESTED_TABLE,
    ])
      expect(SCH_IO_MGR.EnumFromStr(SCH_IO_MGR.ShowType(t))).toBe(t);

    expect(SCH_IO_MGR.ShowType(SCH_FILE_T.SCH_KICAD)).toBe('KiCad');
    expect(SCH_IO_MGR.ShowType(SCH_FILE_T.SCH_NESTED_TABLE)).toBe('Table');
    expect(SCH_IO_MGR.EnumFromStr('kicad')).toBe(SCH_FILE_T.SCH_FILE_UNKNOWN);
  });

  it('guesses a library by what reads it: a table, a .kicad_sym, or (when creating) only the extension', () => {
    expect(SCH_IO_MGR.GuessPluginTypeFromLibPath('/libs/nested-table')).toBe(
      SCH_FILE_T.SCH_NESTED_TABLE,
    );
    expect(SCH_IO_MGR.GuessPluginTypeFromLibPath('/libs/all.kicad_sym')).toBe(SCH_FILE_T.SCH_KICAD);
    expect(SCH_IO_MGR.GuessPluginTypeFromLibPath('/libs/new.kicad_sym')).toBe(
      SCH_FILE_T.SCH_FILE_UNKNOWN,
    );
    expect(SCH_IO_MGR.GuessPluginTypeFromLibPath('/libs/new.kicad_sym', KICTL_CREATE)).toBe(
      SCH_FILE_T.SCH_KICAD,
    );
  });

  it('FindPlugin makes the KiCad plugin', () => {
    expect(SCH_IO_MGR.FindPlugin(SCH_FILE_T.SCH_KICAD)).toBeInstanceOf(SCH_IO_KICAD_SEXPR);
    expect(SCH_IO_MGR.FindPlugin(SCH_FILE_T.SCH_FILE_UNKNOWN)).toBeNull();
  });
});

describe('SYMBOL_LIBRARY_ADAPTER', () => {
  it('loads a table row through its plugin; the loaded library answers names and symbols', () => {
    const a = adapter(row('All', '/libs/all.kicad_sym'));

    expect(a.LoadOne('All')?.load_status).toBe(LOAD_STATUS.LOADED);
    expect(a.HasLibrary('All')).toBe(true);
    expect(a.GetSymbolNames('All').sort()).toEqual([
      'PWRTEST',
      'TESTPART',
      'TESTPART_ALT',
      'TESTPART_ALT2',
    ]);
    expect(a.GetSymbolNames('All', SYMBOL_TYPE.POWER_ONLY)).toEqual(['PWRTEST']);
    expect(
      a
        .GetSymbols('All')
        .map((s) => s.GetLibId().Format())
        .sort(),
    ).toEqual(['All:PWRTEST', 'All:TESTPART', 'All:TESTPART_ALT', 'All:TESTPART_ALT2']);
  });

  it('LoadSymbol names the symbol by the library nickname; an unloaded library has none', () => {
    const a = adapter(row('All', '/libs/all.kicad_sym'));

    expect(a.LoadSymbol('All', 'TESTPART')).toBeNull();
    a.LoadOne('All');
    expect(a.LoadSymbol(new LIB_ID('All', 'TESTPART'))?.GetLibId().Format()).toBe('All:TESTPART');
  });

  it('a library that will not load records the error; a missing row says not found', () => {
    const a = adapter(row('Gone', '/libs/gone.kicad_sym'));

    const status = a.LoadOne('Gone');
    expect(status?.load_status).toBe(LOAD_STATUS.LOAD_ERROR);
    expect(status?.error?.message).toBe("Library '/libs/gone.kicad_sym' not found.");
    expect(a.HasLibrary('Gone')).toBe(false);
    expect(a.LoadOne('Nope')?.error?.message).toBe('Library Nope not found');
  });

  it('an unknown type cannot make a plugin', () => {
    const a = adapter(row('X', '/libs/all.kicad_sym', 'Bogus'));

    expect(a.LoadOne('X')?.error?.message).toBe('Unknown library type Bogus ');
  });

  it('SaveSymbol writes into the library, but not over an existing symbol unless overwriting', () => {
    const a = adapter(row('All', '/libs/all.kicad_sym'));
    a.LoadOne('All');
    const r = LIB_SYMBOL.copyOf(new SCH_IO_KICAD_SEXPR().LoadSymbol('/libs/R.kicad_sym', 'R')!);

    expect(a.SaveSymbol('All', r)).toBe(SAVE_T.SAVE_OK);
    expect(new TextDecoder().decode(wxReadFileSync('/libs/all.kicad_sym')!)).toContain(
      '(symbol "R"',
    );

    const again = LIB_SYMBOL.copyOf(r);
    expect(a.SaveSymbol('All', again, false)).toBe(SAVE_T.SAVE_SKIPPED);
    expect(a.SaveSymbol('All', null)).toBe(SAVE_T.SAVE_SKIPPED);
  });

  it("CreateLibrary makes the row's library file; the library is then writable", () => {
    const a = adapter(row('New', '/libs/new.kicad_sym'));

    expect(a.CreateLibrary('New')).toBe(true);
    expect(wxFileExists('/libs/new.kicad_sym')).toBe(true);
    a.LoadOne('New');
    expect(a.IsSymbolLibWritable('New')).toBe(true);
    expect(a.GetSymbolNames('New')).toEqual([]);
  });

  it('the modify hash moves when a loaded library changes', () => {
    const a = adapter(row('All', '/libs/all.kicad_sym') + row('R', '/libs/R.kicad_sym'));
    a.LoadOne('All');
    a.LoadOne('R');
    const hash = a.GetModifyHash();
    const libHash = a.GetLibraryModifyHash('R')!;

    wxWriteFileSync('/libs/R.kicad_sym', bytes('GND.kicad_sym'));
    a.GetSymbolNames('R');

    expect(a.GetLibraryModifyHash('R')).toBeGreaterThan(libHash);
    expect(a.GetModifyHash()).toBeGreaterThan(hash);
    expect(a.GetLibraryModifyHash('Nope')).toBeUndefined();
  });
});
