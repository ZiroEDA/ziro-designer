// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * designer/src/prefs/user_library_tables.ts: the user's global symbol library table as the file
 * KiCad's code reads and writes in the settings path, backed by its synced settings slice.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LIBRARY_MANAGER } from '@ziroeda/common/libraries/library_manager.js';
import { LIBRARY_TABLE_TYPE } from '@ziroeda/common/libraries/library_table.js';
import {
  mountUserLibraryTables,
  type USER_LIBRARY_TABLE_SETTINGS,
} from '@ziroeda/designer/src/prefs/user_library_tables.js';
import { wxFileExists, wxReadFileSync, wxWriteFileSync } from '@ziroeda/wx/filefn.js';
import { SettingsManager } from '@ziroeda/designer/src/prefs/settings.js';

const PATH = LIBRARY_MANAGER.DefaultGlobalTablePath(LIBRARY_TABLE_TYPE.SYMBOL);
const TABLE = '(sym_lib_table (version 7))';
const dec = new TextDecoder();
const enc = new TextEncoder();

/** A settings slice holding \a aText, recording every write and able to change under the mount. */
function slice(aText: string, aFpText = '', aDbText = '') {
  let text = aText;
  let fpText = aFpText;
  let dbText = aDbText;
  const dbWrites: string[] = [];
  const writes: string[] = [];
  const fpWrites: string[] = [];
  const listeners = new Set<() => void>();
  const settings: USER_LIBRARY_TABLE_SETTINGS = {
    get symLibTable() {
      return text;
    },
    setSymLibTable(aNew: string) {
      text = aNew;
      writes.push(aNew);
      for (const l of listeners) l();
    },
    get fpLibTable() {
      return fpText;
    },
    setFpLibTable(aNew: string) {
      fpText = aNew;
      fpWrites.push(aNew);
      for (const l of listeners) l();
    },
    get designBlockLibTable() {
      return dbText;
    },
    setDesignBlockLibTable(aNew: string) {
      dbText = aNew;
      dbWrites.push(aNew);
      for (const l of listeners) l();
    },
    subscribe(aListener) {
      listeners.add(aListener);
      return () => listeners.delete(aListener);
    },
  };
  return {
    settings,
    writes,
    fpWrites,
    dbWrites,
    /** How many listen to the slice. */
    listening: () => listeners.size,
    /** Another device's change, arriving through the account. */
    pulled(aNew: string) {
      text = aNew;
      for (const l of listeners) l();
    },
  };
}

let unmount: () => void = () => {};
afterEach(() => unmount());

describe('mountUserLibraryTables, the footprint table', () => {
  const FP_PATH = LIBRARY_MANAGER.DefaultGlobalTablePath(LIBRARY_TABLE_TYPE.FOOTPRINT);
  const FP_TABLE = '(fp_lib_table (version 7))';

  it('shows each slice as its own file, and a save of one reaches only its slice', () => {
    const s = slice(TABLE, FP_TABLE);
    unmount = mountUserLibraryTables(s.settings);
    expect(dec.decode(wxReadFileSync(FP_PATH)!)).toBe(FP_TABLE);
    expect(dec.decode(wxReadFileSync(PATH)!)).toBe(TABLE);

    const saved = '(fp_lib_table (version 7) (lib (name "Mine")))';
    wxWriteFileSync(FP_PATH, enc.encode(saved));
    expect(s.fpWrites).toEqual([saved]);
    expect(s.writes).toEqual([]);
  });

  it('mounts the design block table as its own file too', () => {
    const DB_PATH = LIBRARY_MANAGER.DefaultGlobalTablePath(LIBRARY_TABLE_TYPE.DESIGN_BLOCK);
    const s = slice(TABLE, '', '(design_block_lib_table (version 7))');
    unmount = mountUserLibraryTables(s.settings);
    expect(dec.decode(wxReadFileSync(DB_PATH)!)).toBe('(design_block_lib_table (version 7))');

    const saved = '(design_block_lib_table (version 7) (lib (name "Mine")))';
    wxWriteFileSync(DB_PATH, enc.encode(saved));
    expect(s.dbWrites).toEqual([saved]);
    expect(s.writes).toEqual([]);
    expect(s.fpWrites).toEqual([]);
  });

  it('has no footprint table file until the slice holds one', () => {
    unmount = mountUserLibraryTables(slice(TABLE).settings);
    expect(wxFileExists(FP_PATH)).toBe(false);
  });
});

describe('mountUserLibraryTables', () => {
  it('shows the stored table as the file in the settings path', () => {
    unmount = mountUserLibraryTables(slice(TABLE).settings);

    expect(dec.decode(wxReadFileSync(PATH)!)).toBe(TABLE);
  });

  it('shows no file while nothing is stored, so first run creates it', () => {
    unmount = mountUserLibraryTables(slice('').settings);

    expect(wxFileExists(PATH)).toBe(false);
  });

  it('stores what KiCad saves to the file, once', () => {
    const s = slice('');
    unmount = mountUserLibraryTables(s.settings);

    expect(wxWriteFileSync(PATH, enc.encode(TABLE))).toBe(true);

    expect(s.writes).toEqual([TABLE]);
    expect(dec.decode(wxReadFileSync(PATH)!)).toBe(TABLE);
  });

  it("follows the account's change into the file, without storing it back", () => {
    const s = slice(TABLE);
    unmount = mountUserLibraryTables(s.settings);
    const other =
      '(sym_lib_table (version 7) (lib (name "Mine")(type "KiCad")(uri "/Symbols/Mine.kicad_sym")))';

    s.pulled(other);
    expect(dec.decode(wxReadFileSync(PATH)!)).toBe(other);

    s.pulled('');
    expect(wxFileExists(PATH)).toBe(false);
    expect(s.writes).toEqual([]);
  });

  it('is gone once unmounted, and stops following', () => {
    const s = slice(TABLE);
    const u = mountUserLibraryTables(s.settings);
    expect(s.listening()).toBe(1);
    u();

    expect(s.listening()).toBe(0);
    expect(wxFileExists(PATH)).toBe(false);
    s.pulled('(sym_lib_table (version 7))');
    expect(wxFileExists(PATH)).toBe(false);
  });
});

describe('the sym-lib-table slice', () => {
  it("adopts the account's table text, and nothing that is not text", () => {
    const m = new SettingsManager();

    m.adoptSlice('sym-lib-table', { table: TABLE }, 1);
    expect(m.symLibTable).toBe(TABLE);

    m.adoptSlice('sym-lib-table', { table: 7 }, 2);
    expect(m.symLibTable).toBe('');
  });
});
