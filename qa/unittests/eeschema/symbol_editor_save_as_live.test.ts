// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SYMBOL_EDIT_FRAME's Save Symbol As / Save Copy As (eeschema/symbol_editor/symbol_editor.cpp):
 * SAVE_SYMBOL_AS_DIALOG's validator (no library, no name, read-only, saving into its own
 * inheritance, an overwrite of the symbol or of its parents), SYMBOL_SAVE_AS_HANDLER copying the
 * parent chain or flattening it, renaming on conflict - and UpdateAfterSymbolProperties' rename.
 */
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_NONE, TC_MESSAGE, TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import {
  CheckForParentalChainConflicts,
  CheckSavingIntoOwnInheritance,
  SAVE_AS_IDS,
  SAVE_SYMBOL_AS_DIALOG,
} from '@ziroeda/eeschema/symbol_editor/symbol_editor.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { afterEach, describe, expect, it } from 'vitest';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';
import { type SYMBOL_EDIT_HARNESS, symbolEditHarness } from './support/symbol_edit_harness.js';

const prop = (aName: string, aValue: string) =>
  `(property "${aName}" "${aValue}" (at 0 0 0) (effects (font (size 1.27 1.27))))`;
const lib = (aBody: string) =>
  `(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor") ${aBody})`;
const root = (aName: string) =>
  `(symbol "${aName}" (in_bom yes) (on_board yes) ${prop('Reference', 'U')} ${prop('Value', aName)}
    (symbol "${aName}_1_1" (rectangle (start -5.08 -5.08) (end 5.08 5.08) (stroke (width 0) (type default)) (fill (type none)))))`;
const derived = (aName: string, aParent: string) =>
  `(symbol "${aName}" (extends "${aParent}") ${prop('Reference', 'U')} ${prop('Value', aName)})`;

/** mine: U, D derived from U, E derived from D. other: an unrelated U. */
const MINE = lib(`${root('U')} ${derived('D', 'U')} ${derived('E', 'D')}`);
const OTHER = lib(root('U'));

/** What the window's SAVE_SYMBOL_AS_DIALOG does for one ShowModal: OK with these, or a button. */
type DIALOG_ANSWER = { name: string; library: string; flatten?: boolean } | 'cancel' | 'newLibrary';

let t: SYMBOL_EDIT_HARNESS;
let treeLibId: LIB_ID | null = null;
let answers: DIALOG_ANSWER[] = [];
let dialogs: SAVE_SYMBOL_AS_DIALOG[] = [];
let boxes: string[] = [];
let kiAsked: KiDialogRequest[] = [];
let kiAnswer: KiDialogResult = 'ok';

function setUp() {
  treeLibId = null;
  answers = [];
  dialogs = [];
  boxes = [];
  kiAsked = [];
  kiAnswer = 'ok';
  t = symbolEditHarness(
    MINE,
    {
      isLibraryTreeShown: () => true,
      getTreeLibId: () => treeLibId,
      askKiDialog: async (aRequest) => {
        kiAsked.push(aRequest);
        return kiAnswer;
      },
      showModal: async (aName, _aItems, aArg) => {
        if (aName === 'wxMessageBox') {
          boxes.push((aArg as { message: string }).message);
          return wxID_OK;
        }

        if (aName !== 'SAVE_SYMBOL_AS_DIALOG') return wxID_CANCEL;

        const dlg = aArg as SAVE_SYMBOL_AS_DIALOG;
        dialogs.push(dlg);

        // The window keeps the dialog up while TransferDataFromWindow refuses: each refusal
        // takes the next answer.
        for (;;) {
          const answer = answers.shift() ?? 'cancel';

          if (answer === 'cancel') return wxID_CANCEL;

          if (answer === 'newLibrary') return SAVE_AS_IDS.ID_MAKE_NEW_LIBRARY;

          if (await dlg.TransferDataFromWindow(answer.name, answer.library, !!answer.flatten))
            return wxID_OK;
        }
      },
    },
    { other: OTHER },
  );
  t.frame.SetCurLib('mine');
}

afterEach(() => {
  t.dispose();
});

const libMgr = () => t.frame.GetLibManager();
const names = (aLib: string) => {
  const out: string[] = [];
  libMgr().GetSymbolNames(aLib, out);
  return out.sort();
};
const sym = (aName: string, aLib = 'mine') => libMgr().GetBufferedSymbol(aName, aLib)!;
const parentName = (aName: string, aLib = 'mine') => sym(aName, aLib).GetLibParent()?.GetName();

describe('CheckSavingIntoOwnInheritance and CheckForParentalChainConflicts', () => {
  it('a symbol cannot replace its ancestor, nor its descendent; another library is never circular', () => {
    setUp();

    expect(CheckSavingIntoOwnInheritance(libMgr(), sym('D'), 'U', 'mine')).toEqual([true, false]);
    expect(CheckSavingIntoOwnInheritance(libMgr(), sym('D'), 'E', 'mine')).toEqual([false, true]);
    expect(CheckSavingIntoOwnInheritance(libMgr(), sym('D'), 'D', 'mine')).toEqual([false, false]);
    expect(CheckSavingIntoOwnInheritance(libMgr(), sym('D'), 'FREE', 'mine')).toEqual([
      false,
      false,
    ]);
    expect(CheckSavingIntoOwnInheritance(libMgr(), sym('D'), 'U', 'other')).toEqual([false, false]);
  });

  it('into another library the whole chain is checked, unless flattened', () => {
    setUp();

    expect(CheckForParentalChainConflicts(libMgr(), sym('D'), false, 'NEW', 'other')).toEqual([
      'U',
    ]);
    expect(CheckForParentalChainConflicts(libMgr(), sym('D'), true, 'NEW', 'other')).toEqual([]);
    expect(CheckForParentalChainConflicts(libMgr(), sym('D'), true, 'U', 'other')).toEqual(['U']);
    expect(CheckForParentalChainConflicts(libMgr(), sym('D'), false, 'U', 'mine')).toEqual(['U']);
    expect(CheckForParentalChainConflicts(libMgr(), sym('D'), false, 'NEW', 'mine')).toEqual([]);
  });
});

describe('SYMBOL_EDIT_FRAME::SaveSymbolCopyAs', () => {
  it('saves a copy under a new name in the same library, keeping its parent; the value follows', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'D');
    answers = [{ name: 'D copy', library: 'mine' }];

    await t.frame.SaveSymbolCopyAs(false);

    expect(names('mine')).toEqual(['D', 'D_copy', 'E', 'U']);
    expect(parentName('D_copy')).toBe('U');
    // The same library keeps the same parent: U itself is not rewritten.
    expect(libMgr().IsSymbolModified('U', 'mine')).toBe(false);
    expect(sym('D_copy').GetValueField().GetText()).toBe('D_copy');
    expect(t.frame.GetCurSymbol()).toBeNull();
    // The dialog started from the symbol, its library and its parents.
    expect(dialogs[0]!.TransferDataToWindow()).toBe('D_copy');
    expect(dialogs[0]!.flattenLabel).toBe(
      'Flatten/remove symbol inheritance (current parent symbols: U)',
    );
  });

  it('Save As opens the copy', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'U');
    answers = [{ name: 'V', library: 'mine' }];

    await t.frame.SaveSymbolCopyAs(true);

    expect(t.frame.GetCurSymbol()!.GetName()).toBe('V');
    expect(dialogs[0]!.flattenLabel).toBeNull();
  });

  it('into another library copies the parents too; flattened, only the one symbol', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'E');
    answers = [{ name: 'E', library: 'other' }];
    // other already has a U: the chain conflict is asked about, and Overwrite All overwrites.
    kiAnswer = 'yes';

    await t.frame.SaveSymbolCopyAs(false);

    // symbol_editor.cpp:977-986: the format and the closing question are messages; the list is not.
    expect(kiAsked[0]!.message).toBe(
      wxFormat(
        _(
          "The following symbols in the inheritance chain of '%s' already exist in library '%s':\n",
        ),
        'E',
        'other',
      ) +
        '  U\n' +
        _('\nDo you want to overwrite all of them, or rename the new symbols?'),
    );
    expect(kiAsked[0]!.yesNo).toEqual({ yes: _('Overwrite All'), no: _('Rename All') });
    expect(names('other')).toEqual(['D', 'E', 'U']);
    expect(parentName('E', 'other')).toBe('D');
    expect(parentName('D', 'other')).toBe('U');
    expect(sym('U', 'other').GetLibId().GetLibNickname()).toBe('other');

    treeLibId = new LIB_ID('mine', 'D');
    answers = [{ name: 'FLAT', library: 'other', flatten: true }];
    await t.frame.SaveSymbolCopyAs(false);

    expect(sym('FLAT', 'other').IsDerived()).toBe(false);
    expect(names('other')).toEqual(['D', 'E', 'FLAT', 'U']);
  });

  it('Rename All gives every conflicting symbol of the chain a free name', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'D');
    answers = [{ name: 'D', library: 'other' }];
    kiAnswer = 'no';

    await t.frame.SaveSymbolCopyAs(false);

    expect(names('other')).toEqual(['D_1', 'U', 'U_1']);
    expect(parentName('D_1', 'other')).toBe('U_1');
  });

  it('the validator refuses no library, no name, a read-only library and a circular save', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'D');
    libMgr().IsLibraryReadOnly = (aLib: string) => aLib === 'other';
    answers = [
      { name: 'X', library: '' },
      { name: '  ', library: 'mine' },
      { name: 'X', library: 'other' },
      { name: 'U', library: 'mine' },
      { name: 'E', library: 'mine' },
      'cancel',
    ];

    await t.frame.SaveSymbolCopyAs(false);

    expect(boxes).toEqual([
      _('A library must be specified.'),
      _('Symbol must have a name.'),
      "Library 'other' is read-only. Choose a different library to save the symbol 'X' to.",
      "Symbol 'D' cannot replace another symbol 'U' that it descends from",
      "Symbol 'D' cannot replace another symbol 'E' that is a descendent of it.",
    ]);
    expect(names('mine')).toEqual(['D', 'E', 'U']);
  });

  it('overwriting the symbol itself is asked, and Cancel keeps the dialog up', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'E');
    sym('U').SetKeyWords('base');
    answers = [{ name: 'U', library: 'other', flatten: true }, 'cancel'];
    kiAnswer = 'cancel';

    await t.frame.SaveSymbolCopyAs(false);

    expect(kiAsked.map((r) => r.message)).toEqual([
      "Symbol 'U' already exists in library 'other'. Do you want to overwrite it?",
    ]);
    expect(kiAsked[0]!.labels?.ok).toBe(_('Overwrite'));
    expect(sym('U', 'other').GetKeyWords()).toBe('');

    kiAsked = [];
    kiAnswer = 'ok';
    answers = [{ name: 'U', library: 'other', flatten: true }];
    await t.frame.SaveSymbolCopyAs(false);
    // Overwritten by E, flattened: U's keywords inherited, E's value following the new name.
    expect(sym('U', 'other').GetKeyWords()).toBe('base');
    expect(sym('U', 'other').GetValueField().GetText()).toBe('U');
    expect(sym('U', 'other').IsDerived()).toBe(false);
  });

  it('New Library... goes round again with the new library selected', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'U');
    answers = ['newLibrary', 'cancel'];

    await t.frame.SaveSymbolCopyAs(false);

    // No file chosen (no window): AddLibraryFile returns nothing, and the list starts there.
    expect(dialogs).toHaveLength(2);
    expect(dialogs[0]!.selection).toBe('');
    expect(names('mine')).toEqual(['D', 'E', 'U']);
  });

  it('SAVE_SYMBOL_AS_DIALOG cleans the typed name', () => {
    expect(SAVE_SYMBOL_AS_DIALOG.getSymbolName('  my part  ')).toBe('my_part');
    // CTX_LIBID: no longer '/', but ':'.
    expect(SAVE_SYMBOL_AS_DIALOG.getSymbolName('a/b:c')).toBe('a/b{colon}c');
  });

  it('runs from the Save Symbol As and Save Copy As actions', async () => {
    setUp();
    treeLibId = new LIB_ID('mine', 'U');
    answers = [
      { name: 'AS', library: 'mine' },
      { name: 'COPY', library: 'mine' },
    ];
    const mgr = t.frame.GetToolManager()!;
    const flush = async () => {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 0));
        mgr.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_NONE, 'test.flush'));
      }
    };

    mgr.RunAction(SCH_ACTIONS.saveSymbolAs);
    await flush();
    expect(t.frame.GetCurSymbol()!.GetName()).toBe('AS');

    mgr.RunAction(SCH_ACTIONS.saveSymbolCopyAs);
    await flush();
    expect(t.frame.GetCurSymbol()!.GetName()).toBe('AS');
    expect(names('mine')).toEqual(['AS', 'COPY', 'D', 'E', 'U']);

    // Add Library with no window: the file browser answers nothing, and nothing is added.
    mgr.RunAction(ACTIONS.addLibrary);
    await flush();
    expect(libMgr().GetLibraryNames().sort()).toEqual(['mine', 'other']);
  });
});

describe('SYMBOL_EDIT_FRAME::UpdateAfterSymbolProperties', () => {
  it('a rename moves the symbol in its library; a taken name is refused and undone', async () => {
    setUp();
    await t.frame.LoadSymbol(new LIB_ID('mine', 'D'), 1, 1);

    t.frame.GetCurSymbol()!.SetName('U');
    t.frame.UpdateAfterSymbolProperties('D');
    expect(t.frame.GetCurSymbol()!.GetName()).toBe('D');
    expect(names('mine')).toEqual(['D', 'E', 'U']);

    t.frame.GetCurSymbol()!.SetName('DD');
    t.frame.UpdateAfterSymbolProperties('D');
    expect(names('mine')).toEqual(['DD', 'E', 'U']);
    expect(t.frame.GetScreen()!.IsContentModified()).toBe(true);
  });
});
