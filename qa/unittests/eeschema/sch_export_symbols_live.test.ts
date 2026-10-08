// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_BASE_FRAME::SelectLibrary (sch_base_frame.cpp:715) and SCH_EDITOR_CONTROL::
 * ExportSymbolsToLibrary (sch_editor_control.cpp:653) on the live model, with the symbol library
 * table and its libraries on the mounted file system.
 */
import { resolve } from 'node:path';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { RSTRING_T } from '@ziroeda/common/project.js';
import type { FILEDLG_HOOK_NEW_LIBRARY } from '@ziroeda/common/widgets/filedlg_hook_new_library.js';
import {
  MEMORY_FILESYSTEM,
  wxFileExists,
  wxMountFileSystem,
  wxReadFileSync,
} from '@ziroeda/common/wx/filefn.js';
import { wxID_CANCEL, wxID_HIGHEST, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SymbolLibAdapter } from '@ziroeda/eeschema/project_sch.js';
import type { EDA_LIST_DIALOG_ARG } from '@ziroeda/eeschema/sch_base_frame.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

let unmount: () => void = () => {};

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  const fs = new MEMORY_FILESYSTEM();
  unmount = wxMountFileSystem('/libs', fs);
  new SCH_IO_KICAD_SEXPR().CreateLibrary('/libs/exported.kicad_sym');
  Pgm()
    .GetLibraryManager()
    .SetTable(
      LIBRARY_TABLE_TYPE.SYMBOL,
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE.FromFile(
        '/libs/sym-lib-table',
        '(sym_lib_table (version 7) (lib (name "exported")(type "KiCad")(uri "/libs/exported.kicad_sym")(options "")(descr "Exported")))',
        LIBRARY_TABLE_SCOPE.PROJECT,
        LIBRARY_TABLE_TYPE.SYMBOL,
      ),
    );
  SymbolLibAdapter(null).LoadOne('exported');
});
afterEach(() => {
  unmount();
  SetPgm(null);
});

const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  return { ...h, mgr: h.frame.GetToolManager()! };
}

/** The symbols in a library file, by name. */
const libNames = (aPath: string) => {
  const names: string[] = [];
  new SCH_IO_KICAD_SEXPR().EnumerateSymbolLib(names, aPath);
  return names.sort();
};

describe('SelectLibrary', () => {
  it('offers the loaded libraries and remembers the one chosen', async () => {
    let shown: EDA_LIST_DIALOG_ARG | null = null;
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog !== 'EDA_LIST_DIALOG') return wxID_CANCEL;
        shown = aArg as EDA_LIST_DIALOG_ARG;
        shown.textSelection = 'exported';
        return wxID_OK;
      },
    });

    expect(await h.frame.SelectLibrary('T', 'L')).toBe('exported');
    expect(shown!.items).toEqual([['exported', 'Exported']]);
    expect(shown!.headers).toEqual(['Library', 'Description']);
    expect(h.frame.Prj().GetRString(RSTRING_T.SCH_LIB_SELECT)).toBe('exported');

    // The remembered library is preselected next time.
    await h.frame.SelectLibrary('T', 'L');
    expect(shown!.selection).toBe('exported');
  });

  it('Cancel is the empty name', async () => {
    const h = setUp({ showModal: () => wxID_CANCEL });

    expect(await h.frame.SelectLibrary('T', 'L')).toBe('');
  });

  it('"New Library..." creates the library, adds it to the project table and asks again', async () => {
    let asks = 0;
    let hook: FILEDLG_HOOK_NEW_LIBRARY | null = null;
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog !== 'EDA_LIST_DIALOG') return wxID_CANCEL;
        const arg = aArg as EDA_LIST_DIALOG_ARG;
        asks++;
        if (asks === 1) return wxID_HIGHEST; // the "New Library..." button
        expect(arg.items.map((r) => r[0])).toEqual(['exported', 'mine']);
        arg.textSelection = 'mine';
        return wxID_OK;
      },
      fileDialog: (_aTitle, _aDir, aFile, _aWildcard, _aStyle, aHook) => {
        expect(aFile).toBe('Library.kicad_sym');
        hook = aHook as FILEDLG_HOOK_NEW_LIBRARY;
        return '/libs/mine';
      },
    });

    expect(await h.frame.SelectLibrary('T', 'L')).toBe('mine');
    expect(asks).toBe(2);
    expect(hook!.kind).toBe('new_library');
    expect(wxFileExists('/libs/mine.kicad_sym')).toBe(true);
    const table = Pgm()
      .GetLibraryManager()
      .Table(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.PROJECT)!;
    expect(table.Row('mine')?.URI()).toBe('/libs/mine.kicad_sym');
    expect(table.Row('mine')?.Type()).toBe('KiCad');
    expect(h.frame.Prj().GetRString(RSTRING_T.SCH_LIB_PATH)).toBe('/libs');
  });

  it('the extra check boxes come back with the values the dialog left', async () => {
    const h = setUp({
      showModal: (_aDialog, _aItems, aArg) => {
        const arg = aArg as EDA_LIST_DIALOG_ARG;
        expect(arg.extraCheckboxes).toEqual([{ label: 'A', value: false }]);
        arg.extraCheckboxes[0]!.value = true;
        arg.textSelection = 'exported';
        return wxID_OK;
      },
    });
    const a = { value: false };

    await h.frame.SelectLibrary('T', 'L', [{ label: 'A', value: a }]);

    expect(a.value).toBe(true);
  });
});

describe('ExportSymbolsToLibrary', () => {
  const choose =
    (aPower: boolean, aMap: boolean): SCH_EDIT_FRAME_HOOKS['showModal'] =>
    (aDialog, _aItems, aArg) => {
      if (aDialog !== 'EDA_LIST_DIALOG') return wxID_CANCEL;
      const arg = aArg as EDA_LIST_DIALOG_ARG;
      arg.extraCheckboxes[0]!.value = aPower;
      arg.extraCheckboxes[1]!.value = aMap;
      arg.textSelection = 'exported';
      return wxID_OK;
    };

  it('writes every non-power library symbol of the schematic into the chosen library', async () => {
    const h = setUp({ showModal: choose(false, false) });

    h.mgr.RunAction(SCH_ACTIONS.exportSymbolsToLibrary);
    await flush();

    const names = libNames('/libs/exported.kicad_sym');
    expect(names).toContain('LM358N');
    expect(names).toContain('7805');
    expect(names).not.toContain('GND');
    expect(names).not.toContain('PWR_FLAG');
    // Nothing was relinked.
    const sym = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)][0] as SCH_SYMBOL;
    expect(sym.GetLibId().GetLibNickname()).toBe('complex_hierarchy_schlib');
  });

  it('with power symbols included, the power symbols go too', async () => {
    const h = setUp({ showModal: choose(true, false) });

    h.mgr.RunAction(SCH_ACTIONS.exportSymbolsToLibrary);
    await flush();

    expect(libNames('/libs/exported.kicad_sym')).toContain('GND');
  });

  it('mapping relinks the exported symbols to the library, as one undo step', async () => {
    const h = setUp({ showModal: choose(false, true) });
    const undo = h.frame.GetUndoCommandCount();

    h.mgr.RunAction(SCH_ACTIONS.exportSymbolsToLibrary);
    await flush();

    const all = h.frame
      .Schematic()
      .Hierarchy()
      .flatMap((p) => [...p.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]);
    const power = all.filter((s) => s.GetLibSymbolRef()?.IsPower());
    const rest = all.filter((s) => !s.GetLibSymbolRef()?.IsPower());

    expect(rest.every((s) => s.GetLibId().GetLibNickname() === 'exported')).toBe(true);
    expect(power.every((s) => s.GetLibId().GetLibNickname() === 'complex_hierarchy_schlib')).toBe(
      true,
    );
    // Relinked symbols still have their library symbol: UpdateSymbolLinks found it in 'exported'.
    expect(rest.every((s) => s.GetLibSymbolRef() !== null)).toBe(true);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('cancelling the library choice exports nothing', async () => {
    const h = setUp({ showModal: () => wxID_CANCEL });
    const before = new TextDecoder().decode(wxReadFileSync('/libs/exported.kicad_sym')!);

    h.mgr.RunAction(SCH_ACTIONS.exportSymbolsToLibrary);
    await flush();

    expect(new TextDecoder().decode(wxReadFileSync('/libs/exported.kicad_sym')!)).toBe(before);
  });
});
