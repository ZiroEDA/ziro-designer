// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A new symbol library, and Save Library As, named rather than placed (SCH_BASE_FRAME::
 * LibraryFileBrowser): the row goes in the table the dialog's own controls choose
 * (FILEDLG_HOOK_NEW_LIBRARY's two buttons, SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK's four), and the
 * file in that table's place - the account's Symbols folder for the global table, the project for
 * the project's. The global table is the user's (LoadGlobalSymbolTables), kept in the settings
 * path, so a global row is written where it lasts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LIBRARY_MANAGER } from '@ziroeda/common/libraries/library_manager.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PATHS } from '@ziroeda/common/paths.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import type {
  FILEDLG_HOOK_NEW_LIBRARY,
  wxFileDialogCustomizeHook,
} from '@ziroeda/common/widgets/filedlg_hook_new_library.js';
import { LoadGlobalSymbolTables } from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import { SymbolLibAdapter } from '@ziroeda/eeschema/project_sch.js';
import {
  SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK,
  SYMBOL_SAVEAS_TYPE,
} from '@ziroeda/eeschema/widgets/symbol_library_save_as_filedlg_hook.js';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem, wxReadFileSync } from '@ziroeda/wx/filefn.js';
import { type SYMBOL_EDIT_HARNESS, symbolEditHarness } from './support/symbol_edit_harness.js';

const SYM = LIBRARY_TABLE_TYPE.SYMBOL;
const dec = new TextDecoder();

let t: SYMBOL_EDIT_HARNESS;
let mounts: (() => void)[] = [];
/** What the window was asked to name, and what it answers. */
let asked: { name: string; hook: wxFileDialogCustomizeHook | undefined }[];
let answer: { name: string | null; pick?: (aHook: wxFileDialogCustomizeHook) => void };
let errors: string[];
/** The file the computer's picker hands back, or null for Cancel. */
let picked: { name: string; text: string } | null;

function setUp() {
  asked = [];
  answer = { name: null };
  errors = [];
  picked = null;
  SetErrorPresenter((aText) => errors.push(aText));
  t = symbolEditHarness(undefined, {
    askLibraryName: async (_title, aDefaultName, aHook) => {
      asked.push({ name: aDefaultName, hook: aHook });
      if (aHook) answer.pick?.(aHook);
      return answer.name;
    },
    chooseLocalLibraryFile: async (_title, _wild, aHook) => {
      if (aHook) answer.pick?.(aHook);
      return picked;
    },
  });
  // The program's settings path and the account's Symbols folder, as the app mounts them.
  const cfg = new MEMORY_FILESYSTEM();
  const symbols = new MEMORY_FILESYSTEM();
  mounts = [
    wxMountFileSystem(PATHS.GetUserSettingsPath(), cfg),
    wxMountFileSystem('/Symbols', symbols),
  ];
  // A project open at /libs, its table a file there (the harness only installs it), so the
  // project-table choice is offered and ProjectChanged reads the table back.
  t.fs.Write(
    'sym-lib-table',
    new TextEncoder().encode(
      Pgm().GetLibraryManager().Table(SYM, LIBRARY_TABLE_SCOPE.PROJECT)!.FormatForSave(),
    ),
  );
  Pgm().GetSettingsManager().LoadProject('/libs/proj.kicad_pro', {});
  SymbolLibAdapter(t.frame.Prj()).LoadOne('mine');
  LoadGlobalSymbolTables([]);
  return { symbols };
}

afterEach(() => {
  for (const u of mounts) u();
  t.dispose();
  SetErrorPresenter(() => {});
});

/** The user's global table as its file now holds it. */
const userTable = () =>
  LIBRARY_TABLE.FromFile(
    LIBRARY_MANAGER.DefaultGlobalTablePath(SYM),
    dec.decode(wxReadFileSync(LIBRARY_MANAGER.DefaultGlobalTablePath(SYM))!),
    LIBRARY_TABLE_SCOPE.GLOBAL,
  );
const projectTable = () => Pgm().GetLibraryManager().Table(SYM, LIBRARY_TABLE_SCOPE.PROJECT)!;

describe('New Library', () => {
  it('asks for a name, with the table chooser, and puts the library in the project when that is the table', async () => {
    const { symbols } = setUp();
    answer = {
      name: 'Fresh',
      pick: (aHook) => {
        (aHook as FILEDLG_HOOK_NEW_LIBRARY).useGlobalTable = false;
      },
    };

    expect(await t.frame.AddLibraryFile(true)).toBe('/libs/Fresh.kicad_sym');

    expect(asked.length).toBe(1);
    expect((asked[0]!.hook as FILEDLG_HOOK_NEW_LIBRARY | undefined)?.kind).toBe('new_library');
    expect(t.fs.Read('Fresh.kicad_sym')).not.toBeNull();
    expect(symbols.List('')).toEqual([]);
    expect(projectTable().HasRow('Fresh')).toBe(true);
    expect(userTable().HasRow('Fresh')).toBe(false);
  });

  it('refuses a name the place already has, and writes nothing', async () => {
    const { symbols } = setUp();
    symbols.Write('Taken.kicad_sym', new TextEncoder().encode('(kicad_symbol_lib)'));
    answer = { name: 'Taken' };

    expect(await t.frame.AddLibraryFile(true)).toBe('');

    expect(errors).toEqual(["Library 'Taken' already exists."]);
    expect(dec.decode(symbols.Read('Taken.kicad_sym')!)).toBe('(kicad_symbol_lib)');
    expect(userTable().HasRow('Taken')).toBe(false);
  });

  it("puts it in the user's global table, which keeps it, when that is the choice", async () => {
    setUp();
    answer = { name: 'Everywhere' };

    expect(await t.frame.AddLibraryFile(true)).toBe('/Symbols/Everywhere.kicad_sym');

    expect(userTable().HasRow('Everywhere')).toBe(true);
    // The stock chain stays beside it.
    expect(userTable().HasRow('KiCad')).toBe(true);
    expect(Pgm().GetLibraryManager().GetRow(SYM, 'Everywhere')?.URI()).toBe(
      '/Symbols/Everywhere.kicad_sym',
    );
  });

  it('writes nothing when the dialog is cancelled', async () => {
    const { symbols } = setUp();
    answer = { name: null };

    expect(await t.frame.AddLibraryFile(true)).toBe('');
    expect(symbols.List('')).toEqual([]);
  });
});

describe('Save Library As', () => {
  it("adds a global row to the user's table when the dialog says so", async () => {
    const { symbols } = setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);
    answer = {
      name: 'Copy',
      pick: (aHook) =>
        (aHook as SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK).TransferDataFromCustomControls(
          SYMBOL_SAVEAS_TYPE.ADD_GLOBAL_TABLE_ENTRY,
        ),
    };

    expect(await t.frame.saveLibrary('mine', true)).toBe(true);

    expect(asked[0]!.hook instanceof SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK).toBe(true);
    expect(dec.decode(symbols.Read('Copy.kicad_sym')!)).toContain('(symbol "U"');
    expect(userTable().HasRow('Copy')).toBe(true);
    expect(projectTable().HasRow('Copy')).toBe(false);
  });

  it('puts the copy in the project when it joins the project table', async () => {
    const { symbols } = setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);
    answer = {
      name: 'Local',
      pick: (aHook) =>
        (aHook as SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK).TransferDataFromCustomControls(
          SYMBOL_SAVEAS_TYPE.ADD_PROJECT_TABLE_ENTRY,
        ),
    };

    expect(await t.frame.saveLibrary('mine', true)).toBe(true);

    expect(dec.decode(t.fs.Read('Local.kicad_sym')!)).toContain('(symbol "U"');
    expect(symbols.List('')).toEqual([]);
    expect(projectTable().HasRow('Local')).toBe(true);
  });
});

describe('Add Library', () => {
  const LIB = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "Q" (in_bom yes) (on_board yes)
    (property "Reference" "Q" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "Q" (at 0 0 0) (effects (font (size 1.27 1.27))))))`;

  it("copies the computer's file into the account and adds it to the user's table", async () => {
    const { symbols } = setUp();
    picked = { name: 'Bought.kicad_sym', text: LIB };

    expect(await t.frame.AddLibraryFile(false)).toBe('/Symbols/Bought.kicad_sym');

    expect(dec.decode(symbols.Read('Bought.kicad_sym')!)).toBe(LIB);
    expect(userTable().HasRow('Bought')).toBe(true);
    expect(projectTable().HasRow('Bought')).toBe(false);
  });

  it('copies it into the project when that is the table', async () => {
    setUp();
    picked = { name: 'Bought.kicad_sym', text: LIB };
    answer = {
      name: null,
      pick: (aHook) => {
        (aHook as FILEDLG_HOOK_NEW_LIBRARY).useGlobalTable = false;
      },
    };

    expect(await t.frame.AddLibraryFile(false)).toBe('/libs/Bought.kicad_sym');

    expect(dec.decode(t.fs.Read('Bought.kicad_sym')!)).toBe(LIB);
    expect(projectTable().HasRow('Bought')).toBe(true);
  });

  it('refuses a file whose name the account already has', async () => {
    const { symbols } = setUp();
    symbols.Write('Bought.kicad_sym', new TextEncoder().encode('(kicad_symbol_lib)'));
    picked = { name: 'Bought.kicad_sym', text: LIB };

    expect(await t.frame.AddLibraryFile(false)).toBe('');

    expect(errors).toEqual(["Library 'Bought' already exists."]);
    expect(dec.decode(symbols.Read('Bought.kicad_sym')!)).toBe('(kicad_symbol_lib)');
  });
});
