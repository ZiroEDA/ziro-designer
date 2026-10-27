// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SYMBOL_EDIT_FRAME's loading and saving (eeschema/symbol_editor/symbol_editor.cpp), live: a symbol
 * loaded from its library through the buffer, a library saved to its file (with the .bak beside
 * it), Save As with its library-table options, Save All's question per library, and the symbol
 * that came from the schematic.
 */
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/wx/filefn.js';
import { SetErrorPresenter, type UnsavedChangesResult } from '@ziroeda/common/confirm.js';
import {
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { SymbolLibAdapter } from '@ziroeda/eeschema/project_sch.js';
import { SYMBOL_EDITOR_DRAWING_TOOLS } from '@ziroeda/eeschema/tools/symbol_editor_drawing_tools.js';
import {
  type SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK,
  SYMBOL_SAVEAS_TYPE,
} from '@ziroeda/eeschema/widgets/symbol_library_save_as_filedlg_hook.js';
import { afterEach, describe, expect, it } from 'vitest';
import { type SYMBOL_EDIT_HARNESS, symbolEditHarness } from './support/symbol_edit_harness.js';

let t: SYMBOL_EDIT_HARNESS;
let errors: string[] = [];
let focused: string[] = [];
let refreshed = 0;
let unsavedAsked: string[] = [];
let unsavedAnswer: UnsavedChangesResult = 'cancel';
/** The schematic frame's SaveSymbolToSchematic calls, and whether one is open (KIWAY). */
let savedToSchematic: string[] = [];
let schematicOpen = (_aOpen: boolean): void => {};
/** What the Save As file dialog answers, and the option its radio buttons leave set. */
let saveAsName: string | null = null;
let saveAsOption = SYMBOL_SAVEAS_TYPE.NORMAL_SAVE_AS;

const prop = (aName: string, aValue: string) =>
  `(property "${aName}" "${aValue}" (at 0 0 0) (effects (font (size 1.27 1.27))))`;

function setUp(aLib?: string) {
  errors = [];
  focused = [];
  refreshed = 0;
  unsavedAsked = [];
  unsavedAnswer = 'cancel';
  savedToSchematic = [];
  saveAsName = null;
  saveAsOption = SYMBOL_SAVEAS_TYPE.NORMAL_SAVE_AS;
  SetErrorPresenter((aText, aExtra) => errors.push(aExtra ? `${aText} | ${aExtra}` : aText));
  t = symbolEditHarness(aLib, {
    focusOnLibId: (aLibId) => focused.push(aLibId.Format()),
    refreshLibTree: () => {
      refreshed++;
    },
    unsavedChangesDialog: async (aMessage) => {
      unsavedAsked.push(aMessage);
      return unsavedAnswer;
    },
    // Save As names the copy (SCH_BASE_FRAME::LibraryFileBrowser's web delta); the hook's
    // choice of table is its place.
    askLibraryName: async (_title, _name, aHook) => {
      (aHook as SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK | undefined)?.TransferDataFromCustomControls(
        saveAsOption,
      );
      return saveAsName;
    },
  });
  const kiway = new KIWAY({
    OnKiCadExit: () => {},
    Player: () => true,
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
  const schframe = {
    SaveSymbolToSchematic: (aSymbol: { GetName(): string }, aUuid: string) =>
      savedToSchematic.push(`${aSymbol.GetName()}@${aUuid}`),
  };
  t.frame.SetKiway(kiway);
  schematicOpen = (aOpen) => {
    if (aOpen) kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, schframe as never);
    else kiway.PlayerDidClose(FRAME_T.FRAME_SCH, schframe as never);
  };
}

afterEach(() => {
  t.dispose();
  SetErrorPresenter((aText, aExtra) => console.error(aExtra ? `${aText}\n${aExtra}` : aText));
});

const text = (aPath: string) => {
  const bytes = t.fs.Read(aPath);
  return bytes ? new TextDecoder().decode(bytes) : null;
};

describe('SYMBOL_EDIT_FRAME loading', () => {
  it('LoadSymbol( LIB_ID ) loads the symbol from its library and shows it in the tree', async () => {
    setUp();

    expect(await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1)).toBe(true);

    expect(t.frame.GetCurSymbol()!.GetName()).toBe('U');
    expect(t.frame.GetCurLib()).toBe('mine');
    expect(focused).toEqual(['mine:U']);
    // Two interchangeable units: synchronized pin editing on.
    expect(t.frame.m_SyncPinEdit).toBe(true);
    // A copy of the buffered symbol, not the buffer's own.
    expect(t.frame.GetCurSymbol() === t.frame.GetLibManager().GetBufferedSymbol('U', 'mine')).toBe(
      false,
    );
  });

  it('loading the symbol already shown, at the same unit, does nothing', async () => {
    setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);
    const shown = t.frame.GetCurSymbol();

    expect(await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1)).toBe(true);
    expect(t.frame.GetCurSymbol() === shown).toBe(true);

    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 2, 1);
    expect(t.frame.GetCurSymbol() === shown).toBe(false);
    expect(t.frame.GetUnit()).toBe(2);
  });

  it('another symbol at the same unit is loaded, not taken for the one shown', async () => {
    setUp(`(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor")
  (symbol "U" (in_bom yes) (on_board yes) ${prop('Reference', 'U')} ${prop('Value', 'U')})
  (symbol "W" (in_bom yes) (on_board yes) ${prop('Reference', 'W')} ${prop('Value', 'W')}))`);
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);

    expect(await t.frame.LoadSymbol(new LIB_ID('mine', 'W'), 1, 1)).toBe(true);
    expect(t.frame.GetCurSymbol()!.GetName()).toBe('W');
  });

  it('LoadSymbol( name, library ) of a symbol that is not there says so and refreshes the tree', async () => {
    setUp();

    await t.frame.LoadSymbol('Nope', 'mine', 1);

    // SYMBOL_LIBRARY_MANAGER::GetBufferedSymbol reports the failed load first, then LoadSymbol
    // its own message, as upstream does.
    expect(errors).toEqual([
      "Error loading symbol Nope from library 'mine'. | Symbol not found.",
      "Symbol Nope not found in library 'mine'.",
    ]);
    expect(refreshed).toBe(1);
    expect(t.frame.GetCurSymbol()).toBeNull();
  });

  it('LoadSymbol( name, library ) sets the drawing default from the units being locked', async () => {
    setUp();
    const drawing = t.frame.GetToolManager()!.GetTool(SYMBOL_EDITOR_DRAWING_TOOLS)!;
    drawing.SetDrawSpecificUnit(true);

    await t.frame.LoadSymbol('U', 'mine', 1);

    expect(t.frame.GetCurSymbol()!.GetName()).toBe('U');
    // U's units are interchangeable (not locked): graphics are common to the units.
    expect(drawing.GetDrawSpecificUnit()).toBe(false);
  });
});

describe('SYMBOL_EDIT_FRAME saving', () => {
  it('Save writes the edited library to its file, keeps a .bak, and clears the modified mark', async () => {
    setUp();
    const original = text('mine.kicad_sym');
    // A stale backup from an earlier save is replaced, not kept.
    t.fs.Write('mine.bak', new TextEncoder().encode('stale'));
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);
    t.frame.GetCurSymbol()!.SetKeyWords('opamp');
    t.frame.OnModify();
    expect(t.frame.GetLibManager().IsLibraryModified('mine')).toBe(true);

    await t.frame.Save();

    expect(text('mine.kicad_sym')).toContain('opamp');
    expect(text('mine.bak')).toBe(original);
    expect(t.frame.GetLibManager().IsLibraryModified('mine')).toBe(false);
    expect(errors).toEqual([]);
  });

  it('Save As writes a new file; a cancelled dialog writes nothing', async () => {
    setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);

    // Joining no table, the copy goes in the account's Symbols folder.
    const symbols = new MEMORY_FILESYSTEM();
    const unmount = wxMountFileSystem('/Symbols', symbols);

    try {
      saveAsName = null;
      expect(await t.frame.saveLibrary('mine', true)).toBe(false);
      expect(symbols.Read('copy.kicad_sym')).toBeNull();

      saveAsName = 'copy';
      expect(await t.frame.saveLibrary('mine', true)).toBe(true);
      expect(new TextDecoder().decode(symbols.Read('copy.kicad_sym')!)).toContain('(symbol "U"');
    } finally {
      unmount();
    }
  });

  it('Save As with "Add new project library table entry" adds the library to the project table', async () => {
    setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);
    saveAsName = 'copy';
    saveAsOption = SYMBOL_SAVEAS_TYPE.ADD_PROJECT_TABLE_ENTRY;

    // A project open at /libs, its table a file there: the project's place.
    t.fs.Write(
      'sym-lib-table',
      new TextEncoder().encode(
        Pgm()
          .GetLibraryManager()
          .Table(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.PROJECT)!
          .FormatForSave(),
      ),
    );
    Pgm().GetSettingsManager().LoadProject('/libs/proj.kicad_pro', {});
    SymbolLibAdapter(t.frame.Prj()).LoadOne('mine');

    expect(await t.frame.saveLibrary('mine', true)).toBe(true);
    expect(text('copy.kicad_sym')).toContain('(symbol "U"');

    const table = Pgm()
      .GetLibraryManager()
      .Table(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.PROJECT)!;
    expect(table.HasRow('copy')).toBe(true);
    // The project just opened, its adapter loads on demand: the row loads.
    const adapter = SymbolLibAdapter(t.frame.Prj());
    // Its row names it as KiCad's, from the file: a ${KIPRJMOD} path guessed nothing.
    expect(table.Row('copy')?.Type()).toBe('KiCad');
    adapter.LoadOne('copy');
    expect(adapter.HasLibrary('copy')).toBe(true);
  });

  it('a library that is not in the table cannot be saved in place', async () => {
    setUp();
    const shown: string[] = [];
    t.frame.ShowInfoBarError = (aMsg: string) => {
      shown.push(aMsg);
    };

    expect(await t.frame.saveLibrary('ghost', false)).toBe(false);
    expect(shown).toEqual(['No library specified.']);
  });
});

describe('SYMBOL_EDIT_FRAME::saveAllLibraries', () => {
  async function modified() {
    setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);
    t.frame.GetCurSymbol()!.SetKeyWords('opamp');
    t.frame.OnModify();
  }

  it('asks about each modified library; Discard saves nothing and goes on', async () => {
    await modified();
    unsavedAnswer = 'discard';

    expect(await t.frame.saveAllLibraries(true)).toBe(true);

    expect(unsavedAsked).toEqual(["Save changes to 'mine' before closing?"]);
    expect(text('mine.kicad_sym')).not.toContain('opamp');
  });

  it('Save saves it; Cancel stops', async () => {
    await modified();
    unsavedAnswer = 'cancel';
    expect(await t.frame.saveAllLibraries(true)).toBe(false);
    expect(text('mine.kicad_sym')).not.toContain('opamp');

    unsavedAnswer = 'save';
    expect(await t.frame.saveAllLibraries(true)).toBe(true);
    expect(text('mine.kicad_sym')).toContain('opamp');
  });

  it('without confirmation it saves without asking', async () => {
    await modified();

    await t.frame.SaveAll();

    expect(unsavedAsked).toEqual([]);
    expect(text('mine.kicad_sym')).toContain('opamp');
  });
});

describe('a symbol from the schematic', () => {
  it('is saved back into the schematic, or reports that none is open', async () => {
    setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);
    t.frame.SetSymbolOrigin(true, false);
    t.frame.GetScreen()!.SetContentModified(true);

    schematicOpen(false);
    expect(await t.frame.saveCurrentSymbol()).toBe(false);
    expect(errors).toEqual(['No schematic currently open.']);

    // Kiway().Player( FRAME_SCH )->SaveSymbolToSchematic( *m_symbol, m_schematicSymbolUUID ).
    t.frame.m_schematicSymbolUUID = '0000-uuid';
    schematicOpen(true);
    expect(await t.frame.saveCurrentSymbol()).toBe(true);
    expect(savedToSchematic).toEqual(['U@0000-uuid']);
    expect(t.frame.GetScreen()!.IsContentModified()).toBe(false);
  });

  it('a modified one asks before another symbol is loaded, and Save sends it back first', async () => {
    setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);
    t.frame.SetSymbolOrigin(true, false);
    t.frame.GetScreen()!.SetContentModified(true);
    unsavedAnswer = 'save';
    schematicOpen(true);

    expect(await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 2, 1)).toBe(true);

    expect(unsavedAsked).toHaveLength(1);
    expect(t.frame.GetUnit()).toBe(2);
    expect(t.frame.IsSymbolFromSchematic()).toBe(false);
  });

  it('a modified one asks before another symbol is loaded, and Cancel keeps it', async () => {
    setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 1, 1);
    t.frame.SetSymbolOrigin(true, false);
    t.frame.GetScreen()!.SetContentModified(true);
    const shown = t.frame.GetCurSymbol();
    unsavedAnswer = 'cancel';

    expect(await t.frame.LoadSymbol(new LIB_ID('mine', 'U'), 2, 1)).toBe(false);

    expect(unsavedAsked).toEqual(['The current symbol has been modified.  Save changes?']);
    expect(t.frame.GetCurSymbol() === shown).toBe(true);
  });
});
