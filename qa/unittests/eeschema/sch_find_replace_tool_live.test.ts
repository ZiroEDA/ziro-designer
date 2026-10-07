// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_FIND_REPLACE_TOOL (tools/sch_find_replace_tool.cpp) on the TOOL_MANAGER, with the
 * SCH_BASE_FRAME half it drives: ShowFindReplaceDialog, ShowFindReplaceStatus.
 */
import { resolve } from 'node:path';
import type { WX_INFOBAR } from '@ziroeda/common/eda_base_frame.js';
import type { SCH_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { DIALOG_SCH_FIND } from '@ziroeda/eeschema/sch_base_frame.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1)!,
  );
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;

  const status: string[] = [];
  const infoBar: WX_INFOBAR = {
    IsLocked: () => false,
    AddButton: () => {},
    AddCloseButton: () => {},
    RemoveAllButtons: () => {},
    ShowMessageFor: (aMessage) => {
      status.push(aMessage);
    },
    Dismiss: () => {},
  };
  h.frame.SetInfoBar(infoBar);

  const dialogs: { replace: boolean; findString: string; data: SCH_SEARCH_DATA }[] = [];
  h.frame.SetFindReplaceDialogFactory((aData, aReplace): DIALOG_SCH_FIND => {
    const d = { replace: aReplace, findString: '', data: aData };
    dialogs.push(d);
    return {
      SetFindEntries: (_aEntries, aFindString) => {
        d.findString = aFindString;
      },
      GetFindEntries: () => [],
      SetReplaceEntries: () => {},
      GetReplaceEntries: () => [],
      Show: () => {},
      Destroy: () => {},
    };
  });

  const text = (x: number, y: number, aText: string) => {
    const t = new SCH_TEXT(P(x, y), aText);
    h.frame.AddToScreen(t, h.frame.GetScreen());
    return t;
  };
  const data = () => h.frame.GetFindReplaceData() as SCH_SEARCH_DATA;
  const selected = () => sel.GetSelection().Items();
  return { ...h, mgr, sel, status, dialogs, text, data, selected };
}

describe('SCH_FIND_REPLACE_TOOL', () => {
  it('Find opens the dialog seeded from a lone selected text, up to its first line', () => {
    const h = setUp();
    const t = h.text(0, 0, 'ZQX one\nsecond line');
    h.sel.AddItemToSel(t, true);

    h.mgr.RunAction(ACTIONS.find);
    h.mgr.RunAction(ACTIONS.findAndReplace);

    expect(h.dialogs.map((d) => [d.replace, d.findString])).toEqual([
      [false, 'ZQX one'],
      [true, 'ZQX one'],
    ]);
  });

  it('with the dialog open, Find brightens every match and nothing else', () => {
    const h = setUp();
    const a = h.text(0, 0, 'ZQX a');
    const b = h.text(10, 0, 'other');
    h.mgr.RunAction(ACTIONS.find);
    h.data().findString = 'ZQX';

    h.mgr.RunAction(ACTIONS.updateFind);

    expect(a.IsBrightened()).toBe(true);
    expect(a.IsForceVisible()).toBe(true);
    expect(b.IsBrightened()).toBe(false);
  });

  it('Find Next walks the matches by x then y, selecting each, then wraps with a status', () => {
    const h = setUp();
    h.mgr.RunAction(ACTIONS.find);
    const c = h.text(20, 0, 'ZQX c');
    const a = h.text(0, 5, 'ZQX a');
    const b = h.text(0, 9, 'ZQX b');
    const d = h.data();
    d.findString = 'ZQX';
    d.searchCurrentSheetOnly = true;

    const order = [];
    for (let i = 0; i < 4; ++i) {
      h.mgr.RunAction(ACTIONS.findNext);
      order.push(h.selected()[0]);
    }

    expect(order[0] === a && order[1] === b && order[2] === c && order[3] === a).toBe(true);
    expect(h.status).toEqual(['Reached end of sheet.']);
  });

  it('Find Previous walks them backwards', () => {
    const h = setUp();
    h.mgr.RunAction(ACTIONS.find);
    const a = h.text(0, 0, 'ZQX a');
    const b = h.text(10, 0, 'ZQX b');
    const d = h.data();
    d.findString = 'ZQX';
    d.searchCurrentSheetOnly = true;

    h.mgr.RunAction(ACTIONS.findPrevious);
    const first = h.selected()[0];
    h.mgr.RunAction(ACTIONS.findPrevious);
    const second = h.selected()[0];

    expect(first === b && second === a).toBe(true);
  });

  it('no match says so', () => {
    const h = setUp();
    h.mgr.RunAction(ACTIONS.find);
    h.data().findString = 'nothing-has-this-ZQX';
    h.data().searchCurrentSheetOnly = true;

    h.mgr.RunAction(ACTIONS.findNext);

    expect(h.status).toEqual(['No matches found.']);
  });

  it('Find Next with no search string opens the dialog instead', () => {
    const h = setUp();
    h.mgr.RunAction(ACTIONS.findNext);

    expect(h.dialogs.length).toBe(1);
    expect(h.dialogs[0]!.replace).toBe(false);
  });

  it('Replace All on the current sheet replaces every match as one undo step', () => {
    const h = setUp();
    h.mgr.RunAction(ACTIONS.findAndReplace);
    const a = h.text(0, 0, 'ZQX a');
    const b = h.text(10, 0, 'b ZQX');
    const c = h.text(20, 0, 'untouched');
    const d = h.data();
    d.findString = 'ZQX';
    d.replaceString = 'ok';
    d.searchCurrentSheetOnly = true;
    const undo = h.frame.GetUndoCommandCount();

    h.mgr.RunAction(ACTIONS.replaceAll);

    expect([a, b, c].map((t) => t.GetText())).toEqual(['ok a', 'b ok', 'untouched']);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('searching all sheets moves to the sheet holding the only match', () => {
    const h = setUp();
    h.mgr.RunAction(ACTIONS.find);
    const here = h.frame.GetCurrentSheet();
    const other = h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.LastScreen() !== here.LastScreen())!;
    const t = new SCH_TEXT(P(0, 0), 'ZQX elsewhere');
    h.frame.AddToScreen(t, other.LastScreen());
    const d = h.data();
    d.findString = 'ZQX';
    d.searchCurrentSheetOnly = false;

    h.mgr.RunAction(ACTIONS.findNext);

    expect(h.frame.GetCurrentSheet().LastScreen() === other.LastScreen()).toBe(true);
    expect(h.selected()[0] === t).toBe(true);
  });

  it('Replace replaces the current match and moves to the next', () => {
    const h = setUp();
    h.mgr.RunAction(ACTIONS.findAndReplace);
    const a = h.text(0, 0, 'ZQX a');
    const b = h.text(10, 0, 'ZQX b');
    const d = h.data();
    d.findString = 'ZQX';
    d.replaceString = 'ok';
    d.searchCurrentSheetOnly = true;

    h.mgr.RunAction(ACTIONS.findNext);
    h.mgr.RunAction(ACTIONS.replaceAndFindNext);

    expect([a.GetText(), b.GetText()]).toEqual(['ok a', 'ZQX b']);
    expect(h.selected()[0] === b).toBe(true);
  });
});
