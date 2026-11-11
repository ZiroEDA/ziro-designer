// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SYMBOL_EDIT_FRAME's Export Symbol (symbol_editor.cpp) and Import Symbol
 * (symbol_editor_import_export.cpp): a flattened symbol written to a new or existing library file,
 * or into the buffer of a library the table already has; symbols chosen from a file through
 * DIALOG_IMPORT_SYMBOL_SELECT, conflicts skipped or overwritten.
 */
import { SetErrorPresenter, SetInfoPresenter } from '@ziroeda/common/confirm.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { TA_NONE, TC_MESSAGE, TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { DIALOG_IMPORT_SYMBOL_SELECT_ARG } from '@ziroeda/eeschema/symbol_editor/symbol_editor_import_export.js';
import { CONFLICT_RESOLUTION } from '@ziroeda/eeschema/symbol_import_manager.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import type { ChooserFilter } from '@ziroeda/wx/filedlg.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { afterEach, describe, expect, it } from 'vitest';
import { _ } from '@ziroeda/wx/translation.js';
import { type SYMBOL_EDIT_HARNESS, symbolEditHarness } from './support/symbol_edit_harness.js';

const prop = (aName: string, aValue: string) =>
  `(property "${aName}" "${aValue}" (at 0 0 0) (effects (font (size 1.27 1.27))))`;
const lib = (aBody: string) =>
  `(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor") ${aBody})`;
const root = (aName: string, aKeywords = '') =>
  `(symbol "${aName}" (in_bom yes) (on_board yes) ${prop('Reference', 'U')} ${prop('Value', aName)}
    ${aKeywords ? prop('ki_keywords', aKeywords) : ''}
    (symbol "${aName}_1_1" (rectangle (start -5.08 -5.08) (end 5.08 5.08) (stroke (width 0) (type default)) (fill (type none)))))`;
const derived = (aName: string, aParent: string) =>
  `(symbol "${aName}" (extends "${aParent}") ${prop('Reference', 'U')} ${prop('Value', aName)})`;

/** mine: U, and D derived from it. other: an unrelated U. */
const MINE = lib(`${root('U')} ${derived('D', 'U')}`);
const OTHER = lib(root('U'));

let t: SYMBOL_EDIT_HARNESS;
let treeLibId: LIB_ID | null = null;
let filePath: string | null = null;
let fileAsks: { title: string; file: string; filters: readonly ChooserFilter[] }[] = [];
let kiAsked: KiDialogRequest[] = [];
let kiAnswer: KiDialogResult = 'ok';
let errors: string[] = [];
let infos: string[] = [];
let modals: string[] = [];
let select: ((aArg: DIALOG_IMPORT_SYMBOL_SELECT_ARG) => number) | null = null;

function setUp() {
  treeLibId = null;
  filePath = null;
  fileAsks = [];
  kiAsked = [];
  kiAnswer = 'ok';
  errors = [];
  infos = [];
  modals = [];
  select = null;
  SetErrorPresenter((aText) => {
    errors.push(aText);
  });
  SetInfoPresenter(async (aText) => {
    infos.push(aText);
  });
  t = symbolEditHarness(
    MINE,
    {
      isLibraryTreeShown: () => true,
      getTreeLibId: () => treeLibId,
      askKiDialog: async (aRequest) => {
        kiAsked.push(aRequest);
        return kiAnswer;
      },
      fileDialog: async (aTitle, _aDir, aFile, aWildcard) => {
        fileAsks.push({
          title: aTitle,
          file: aFile,
          filters: Array.isArray(aWildcard) ? aWildcard : [aWildcard as ChooserFilter],
        });
        return filePath;
      },
      showModal: async (aName, _aItems, aArg) => {
        modals.push(aName);

        if (aName === 'DIALOG_IMPORT_SYMBOL_SELECT' && select)
          return select(aArg as DIALOG_IMPORT_SYMBOL_SELECT_ARG);

        return wxID_CANCEL;
      },
    },
    { other: OTHER },
  );
  t.frame.SetCurLib('mine');
}

afterEach(() => {
  t.dispose();
  SetErrorPresenter((aText) => console.error(aText));
  SetInfoPresenter(async () => {});
});

const libMgr = () => t.frame.GetLibManager();
const names = (aLib: string) => {
  const out: string[] = [];
  libMgr().GetSymbolNames(aLib, out);
  return out.sort();
};
const text = (aName: string) => {
  const bytes = t.fs.Read(aName);
  return bytes ? new TextDecoder().decode(bytes) : null;
};

describe('SYMBOL_EDIT_FRAME::ExportSymbol', () => {
  it('writes the symbol, flattened, to a new library file', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'D');
    filePath = '/libs/out.kicad_sym';

    await t.frame.ExportSymbol();

    expect(fileAsks[0]!.title).toBe(_('Export Symbol'));
    expect(fileAsks[0]!.file).toBe('d.kicad_sym');
    const out = text('out.kicad_sym')!;
    expect(out).toContain('(symbol "D"');
    expect(out).not.toContain('extends');
    expect(out).toContain('rectangle');
    expect(t.frame.GetStatusText()).toBe("Symbol D saved to library '/libs/out.kicad_sym'.");
    expect(t.frame.GetMruPath()).toBe('/libs');
  });

  it('asks before replacing a symbol already in that file', async () => {
    setUp();
    t.fs.Write('out.kicad_sym', new TextEncoder().encode(lib(root('U', 'old'))));
    treeLibId = new LIB_ID('mine', 'U');
    filePath = '/libs/out.kicad_sym';
    kiAnswer = 'cancel';

    await t.frame.ExportSymbol();

    expect(kiAsked[0]!.message).toBe("Symbol U already exists in library 'out.kicad_sym'.");
    expect(kiAsked[0]!.labels?.ok).toBe(_('Overwrite'));
    expect(text('out.kicad_sym')).toContain('old');

    kiAnswer = 'ok';
    await t.frame.ExportSymbol();
    expect(text('out.kicad_sym')).not.toContain('old');
  });

  it('into a library the table has, goes through its buffer', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'D');
    filePath = '/libs/other.kicad_sym';

    await t.frame.ExportSymbol();

    expect(names('other')).toEqual(['D', 'U']);
    expect(libMgr().GetBufferedSymbol('D', 'other')!.IsDerived()).toBe(false);
    expect(libMgr().IsLibraryModified('other')).toBe(true);
    // Not on disk until the library is saved.
    expect(text('other.kicad_sym')).not.toContain('(symbol "D"');
    expect(kiAsked).toEqual([]);

    // A name already there asks first.
    treeLibId = new LIB_ID('mine', 'U');
    kiAnswer = 'cancel';
    await t.frame.ExportSymbol();
    expect(kiAsked[0]!.message).toBe("Symbol 'U' already exists in library 'other'.");
  });

  it('refuses a read-only library, an unwritable folder, and no symbol', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'D');
    filePath = '/libs/other.kicad_sym';
    libMgr().IsLibraryReadOnly = (aLib: string) => aLib === 'other';

    await t.frame.ExportSymbol();

    filePath = '/nowhere/out.kicad_sym';
    await t.frame.ExportSymbol();

    expect(errors).toEqual([
      "Library 'other' is read-only.",
      "Insufficient permissions to save library '/nowhere/out.kicad_sym'.",
    ]);
    expect(names('other')).toEqual(['U']);

    const infoBar: string[] = [];
    t.frame.ShowInfoBarError = (aMsg: string) => {
      infoBar.push(aMsg);
    };
    treeLibId = new LIB_ID('mine', 'NOPE');
    await t.frame.ExportSymbol();
    expect(infoBar).toEqual([_('There is no symbol selected to save.')]);
  });
});

describe('SYMBOL_EDIT_FRAME::ImportSymbol', () => {
  it('imports the chosen symbols, skipping the ones resolved to skip, and loads the first', async () => {
    setUp();
    t.fs.Write(
      'src.kicad_sym',
      new TextEncoder().encode(lib(`${root('A')} ${root('U', 'new')} ${root('B')}`)),
    );
    treeLibId = new LIB_ID('mine', '');
    filePath = '/libs/src.kicad_sym';
    let arg: DIALOG_IMPORT_SYMBOL_SELECT_ARG | null = null;
    select = (aArg) => {
      arg = aArg;
      aArg.selectedSymbols.push('A', 'U', 'B');
      aArg.conflictResolutions.set('U', CONFLICT_RESOLUTION.SKIP);
      return wxID_OK;
    };

    await t.frame.ImportSymbol();

    expect(arg!.filePath).toBe('/libs/src.kicad_sym');
    expect(arg!.destLibrary).toBe('mine');
    expect(names('mine')).toEqual(['A', 'B', 'D', 'U']);
    expect(libMgr().GetBufferedSymbol('U', 'mine')!.GetKeyWords()).toBe('');
    // The first one imported is the one opened.
    expect(t.frame.GetCurSymbol()!.GetName()).toBe('A');
    expect(infos).toEqual(['Imported 2 symbol(s), skipped 1.']);
    // The chooser: every format a plugin reads, then each plugin's own.
    const filters = fileAsks[0]!.filters;
    expect(filters[0]!.label).toBe(_('All supported formats'));
    expect(filters[0]!.extensions).toContain('kicad_sym');
    expect(filters.length).toBeGreaterThan(2);
    // A plugin that reads no library files offers no filter.
    expect(filters.every((f) => f.extensions.length > 0)).toBe(true);
  });

  it('an overwrite resolution replaces the symbol in the library', async () => {
    setUp();
    t.fs.Write('src.kicad_sym', new TextEncoder().encode(lib(root('U', 'new'))));
    treeLibId = new LIB_ID('mine', '');
    filePath = '/libs/src.kicad_sym';
    select = (aArg) => {
      aArg.selectedSymbols.push('U');
      aArg.conflictResolutions.set('U', CONFLICT_RESOLUTION.OVERWRITE);
      return wxID_OK;
    };

    await t.frame.ImportSymbol();

    expect(libMgr().GetBufferedSymbol('U', 'mine')!.GetKeyWords()).toBe('new');
    expect(infos).toEqual([]);
  });

  it('a file no plugin reads is refused; a cancelled selection imports nothing', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', '');
    filePath = '/libs/notes.txt';

    await t.frame.ImportSymbol();
    expect(errors).toEqual(["Unable to find a reader for '/libs/notes.txt'."]);
    expect(modals).toEqual([]);

    t.fs.Write('src.kicad_sym', new TextEncoder().encode(lib(root('A'))));
    filePath = '/libs/src.kicad_sym';
    select = (aArg) => {
      aArg.selectedSymbols.push('A');
      return wxID_CANCEL;
    };
    await t.frame.ImportSymbol();
    expect(names('mine')).toEqual(['D', 'U']);
  });

  it('with no target library, asks for one, and stops when none is chosen', async () => {
    setUp();
    t.frame.SetCurLib('');

    await t.frame.ImportSymbol();

    expect(modals).toEqual(['EDA_LIST_DIALOG']);
    expect(fileAsks).toEqual([]);
  });

  it('runs from the Import Symbol and Export Symbol actions', async () => {
    setUp();
    t.fs.Write('src.kicad_sym', new TextEncoder().encode(lib(root('A'))));
    treeLibId = new LIB_ID('mine', '');
    filePath = '/libs/src.kicad_sym';
    select = (aArg) => {
      aArg.selectedSymbols.push('A');
      return wxID_OK;
    };
    const mgr = t.frame.GetToolManager()!;
    const flush = async () => {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 0));
        mgr.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_NONE, 'test.flush'));
      }
    };

    mgr.RunAction(SCH_ACTIONS.importSymbol);
    await flush();
    expect(names('mine')).toEqual(['A', 'D', 'U']);

    treeLibId = new LIB_ID('mine', 'A');
    filePath = '/libs/out.kicad_sym';
    mgr.RunAction(SCH_ACTIONS.exportSymbol);
    await flush();
    expect(text('out.kicad_sym')).toContain('(symbol "A"');
  });
});
