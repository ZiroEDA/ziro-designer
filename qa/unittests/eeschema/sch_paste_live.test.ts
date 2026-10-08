// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDITOR_CONTROL::Paste and Duplicate on the live model (sch_editor_control.cpp:1856-2849):
 * clipboard content loaded, re-identified, annotated by the paste mode, and handed to the move
 * tool, which places it or reverts it.
 */
import { resolve } from 'node:path';
import { GetClipboardUTF8, SetClipboardFromText } from '@ziroeda/common/clipboard.js';
import type { PasteSpecialMode } from '@ziroeda/common/dialogs/dialog_paste_special_types.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_EDITOR_CONTROL } from '@ziroeda/eeschema/tools/sch_editor_control.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, mouse, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  SetClipboardFromText('');
});
afterEach(() => SetPgm(null));

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1)!,
  );
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  const text = (x: number, y: number, aText: string) => {
    const t = new SCH_TEXT(P(x, y), aText);
    h.frame.AddToScreen(t, h.frame.GetScreen());
    return t;
  };
  const texts = (aText: string) =>
    ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_TEXT_T)] as SCH_TEXT[]).filter(
      (t) => t.GetText() === aText,
    );
  const symbols = () =>
    [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[];
  const sheets = () => [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)] as SCH_SHEET[];
  const place = (aAt: { x: number; y: number }) => {
    mouse(h, TA_MOUSE_MOTION, aAt);
    click(h, aAt);
  };
  return { ...h, mgr, sel, text, texts, symbols, sheets, place };
}

describe('Paste', () => {
  it('pastes the copied items as new items that follow the cursor, placed by a click as one undo step', () => {
    const h = setUp();
    const t = h.text(0, 0, 'ZQX paste');
    h.sel.AddItemToSel(t, true);
    h.mgr.RunAction(ACTIONS.copy);
    h.sel.ClearSelection(true);
    const undo = h.frame.GetUndoCommandCount();

    h.h.mouse = P(10, 10);
    h.mgr.RunAction(ACTIONS.paste);
    h.place(P(20, 14));

    const both = h.texts('ZQX paste');
    expect(both.length).toBe(2);
    const pasted = both.find((x) => x !== t)!;
    expect(pasted.m_Uuid).not.toBe(t.m_Uuid);
    // The pasted text's own position is its reference point, so it lands under the click.
    expect(pasted.GetPosition()).toEqual(P(20, 14));
    expect(t.GetPosition()).toEqual(P(0, 0));
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('Escape during the move takes the pasted items back out', () => {
    const h = setUp();
    const t = h.text(0, 0, 'ZQX revert');
    h.sel.AddItemToSel(t, true);
    h.mgr.RunAction(ACTIONS.copy);
    const undo = h.frame.GetUndoCommandCount();

    h.mgr.RunAction(ACTIONS.paste);
    mouse(h, TA_MOUSE_MOTION, P(5, 5));
    h.mgr.RunAction(ACTIONS.cancelInteractive);

    expect(h.texts('ZQX revert')).toEqual([t]);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });

  it('text that is not schematic content pastes as a text item', () => {
    const h = setUp();
    SetClipboardFromText('ZQX plain words');

    h.mgr.RunAction(ACTIONS.paste);
    h.place(P(3, 3));

    expect(h.texts('ZQX plain words').length).toBe(1);
  });

  it('an empty clipboard pastes nothing', () => {
    const h = setUp();
    const before = [...h.frame.GetScreen()!.Items()].length;

    h.mgr.RunAction(ACTIONS.paste);

    expect([...h.frame.GetScreen()!.Items()].length).toBe(before);
  });

  it('a pasted symbol gets a new identity and, with automatic annotation, the next free reference', () => {
    const h = setUp();
    const original = h.symbols().find((s) => !s.GetLibSymbolRef()?.IsPower())!;
    const path = h.frame.GetCurrentSheet();
    const ref = original.GetRef(path);
    h.sel.AddItemToSel(original, true);
    h.mgr.RunAction(ACTIONS.copy);
    h.sel.ClearSelection(true);
    const before = new Set(h.symbols());

    h.mgr.RunAction(ACTIONS.paste);
    h.place(P(8, 8));

    const pasted = h.symbols().filter((s) => !before.has(s));
    expect(pasted.length).toBe(1);
    const newRef = pasted[0]!.GetRef(path);
    expect(pasted[0]!.m_Uuid).not.toBe(original.m_Uuid);
    expect(newRef).not.toBe(ref);
    expect(newRef.replace(/\d+$/, '')).toBe(ref.replace(/\d+$/, ''));
    expect(/\d+$/.test(newRef)).toBe(true);
    // Every reference in the hierarchy is still unique.
    const all = h.frame
      .Schematic()
      .Hierarchy()
      .flatMap((p) =>
        ([...p.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[])
          .filter((s) => !s.GetLibSymbolRef()?.IsPower())
          .map((s) => `${s.GetRef(p)}:${s.GetUnit()}`),
      );
    expect(all.filter((r) => r === `${newRef}:${pasted[0]!.GetUnit()}`).length).toBe(1);
  });

  it('Paste Special keeps or removes annotations as chosen; Cancel pastes nothing', async () => {
    let mode: PasteSpecialMode | null = null;
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog !== 'DIALOG_PASTE_SPECIAL') return wxID_CANCEL;
        if (mode === null) return wxID_CANCEL;
        (aArg as { pasteMode: PasteSpecialMode }).pasteMode = mode;
        return wxID_OK;
      },
    });
    const original = h.symbols().find((s) => !s.GetLibSymbolRef()?.IsPower())!;
    const path = h.frame.GetCurrentSheet();
    const ref = original.GetRef(path);
    h.sel.AddItemToSel(original, true);
    h.mgr.RunAction(ACTIONS.copy);
    h.sel.ClearSelection(true);

    const pasteAs = async (aMode: PasteSpecialMode | null) => {
      mode = aMode;
      const before = new Set(h.symbols());
      h.mgr.RunAction(ACTIONS.pasteSpecial);
      await flush();
      if (aMode !== null) h.place(P(12, 12));
      return h.symbols().filter((s) => !before.has(s));
    };

    expect(await pasteAs(null)).toEqual([]);

    const kept = await pasteAs('KEEP_ANNOTATIONS');
    expect(kept.map((s) => s.GetRef(path))).toEqual([ref]);

    const removed = await pasteAs('REMOVE_ANNOTATIONS');
    expect(removed.map((s) => s.GetRef(path))).toEqual([`${ref.replace(/\d+$/, '')}?`]);
  });

  it('a pasted sheet gets a unique name, the existing screen, and the next free page number', () => {
    const h = setUp();
    const original = h.sheets()[0]!;
    const names = new Set(h.sheets().map((s) => s.GetName()));
    h.sel.AddItemToSel(original, true);
    h.mgr.RunAction(ACTIONS.copy);
    h.sel.ClearSelection(true);
    const pagesBefore = h.frame
      .Schematic()
      .Hierarchy()
      .map((p) => p.GetPageNumber());

    h.mgr.RunAction(ACTIONS.paste);
    h.place(P(30, 30));

    const pasted = h.sheets().find((s) => !names.has(s.GetName()))!;
    expect(pasted).toBeDefined();
    expect(pasted.m_Uuid).not.toBe(original.m_Uuid);
    expect(pasted.GetScreen()).toBe(original.GetScreen());

    const base = original.GetName().replace(/\d+$/, '');
    expect(pasted.GetName().startsWith(base)).toBe(true);

    const pastedPath = h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.Last() === pasted)!;
    let free = 1;
    while (pagesBefore.includes(`${free}`)) free++;
    expect(pastedPath.GetPageNumber()).toBe(`${free}`);
  });
});

describe('Paste, the identity and instance rules', () => {
  it('a cut symbol pasted back still gets a new identity under unique annotation', () => {
    const h = setUp();
    const original = h.symbols().find((s) => !s.GetLibSymbolRef()?.IsPower())!;
    const uuid = original.m_Uuid;
    h.sel.AddItemToSel(original, true);
    h.mgr.RunAction(ACTIONS.cut);
    const before = new Set(h.symbols());

    h.mgr.RunAction(ACTIONS.paste);
    h.place(P(8, 8));

    const pasted = h.symbols().filter((s) => !before.has(s));
    expect(pasted.length).toBe(1);
    expect(pasted[0]!.m_Uuid).not.toBe(uuid);
  });

  it("a pasted symbol keeps only this project's instances, each with a real path", () => {
    const h = setUp();
    const original = h.symbols().find((s) => !s.GetLibSymbolRef()?.IsPower())!;
    h.sel.AddItemToSel(original, true);
    h.mgr.RunAction(ACTIONS.copy);
    h.sel.ClearSelection(true);
    const content = GetClipboardUTF8();
    // The same symbol as another project placed it, beside this project's own instance.
    const foreign = content.replace(
      '(instances',
      '(instances (project "other_proj" (path "/00000000-0000-0000-0000-0000000000aa" (reference "R77") (unit 1)))',
    );
    expect(foreign).not.toBe(content);
    SetClipboardFromText(foreign);
    const before = new Set(h.symbols());

    h.mgr.RunAction(ACTIONS.paste);
    h.place(P(8, 8));

    const pasted = h.symbols().filter((s) => !before.has(s))[0]!;
    const instances = pasted.GetInstances();
    expect(instances.length).toBeGreaterThan(0);
    expect(
      instances.filter((i) => i.m_ProjectName !== 'complex_hierarchy' || i.m_Path.empty()),
    ).toEqual([]);
  });

  it("ChoosePasteLibSymbol takes the clipboard's library symbol over the destination's", () => {
    const h = setUp();
    const clip = new SCH_SCREEN(h.frame.Schematic());
    const dest = new SCH_SCREEN(h.frame.Schematic());
    const a = new LIB_SYMBOL('X');
    a.SetLibId(new LIB_ID('lib', 'X'));
    const b = new LIB_SYMBOL('X');
    b.SetLibId(new LIB_ID('lib', 'X'));
    clip.AddLibSymbol(a);
    dest.AddLibSymbol(b);

    expect(SCH_EDITOR_CONTROL.ChoosePasteLibSymbol(clip, dest, 'lib:X')).toBe(a);
    expect(
      SCH_EDITOR_CONTROL.ChoosePasteLibSymbol(new SCH_SCREEN(h.frame.Schematic()), dest, 'lib:X'),
    ).toBe(b);
    expect(SCH_EDITOR_CONTROL.ChoosePasteLibSymbol(null, null, 'lib:X')).toBeNull();
  });
});

describe('Duplicate', () => {
  it('duplicates through its own clipboard, leaving the system clipboard alone', () => {
    const h = setUp();
    SetClipboardFromText('untouched');
    const t = h.text(0, 0, 'ZQX dup');
    h.sel.AddItemToSel(t, true);
    h.h.mouse = P(0, 0);

    h.mgr.RunAction(ACTIONS.duplicate);
    h.place(P(4, 0));

    expect(h.texts('ZQX dup').length).toBe(2);
    expect(GetClipboardUTF8()).toBe('untouched');
  });

  it('the duplicate is anchored at the selection point nearest the cursor', () => {
    const h = setUp();
    const a = h.text(0, 0, 'ZQX near');
    const b = h.text(10, 0, 'ZQX far');
    h.sel.AddItemToSel(a, true);
    h.sel.AddItemToSel(b, true);
    // The cursor sits on b, so b's copy lands under the click.
    h.h.mouse = P(10, 0);

    h.mgr.RunAction(ACTIONS.duplicate);
    h.place(P(10, 6));

    const farCopy = h.texts('ZQX far').find((x) => x !== b)!;
    const nearCopy = h.texts('ZQX near').find((x) => x !== a)!;
    expect(farCopy.GetPosition()).toEqual(P(10, 6));
    expect(nearCopy.GetPosition()).toEqual(P(0, 6));
  });
});
