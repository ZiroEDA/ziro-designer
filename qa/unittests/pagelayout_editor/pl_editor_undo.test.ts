// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PL_EDITOR_FRAME`'s undo/redo, driven through the frame and its tools,
 * against `pagelayout_editor/pl_editor_undo_redo.cpp` and
 * `common/drawing_sheet/ds_proxy_undo_item.cpp`.
 *
 *   SaveCopyInUndoList (:34-45)  `new DS_PROXY_UNDO_ITEM( this )`: EVERY entry
 *       carries the page and the title block, then the redo list is cleared.
 *   GetLayoutFromUndoList (:88-119) / GetLayoutFromRedoList (:52-83)  one
 *       entry moves list to list; the item selected when the entry was taken
 *       comes back selected (ds_proxy_undo_item.cpp:76-90).
 *   RollbackFromUndo (:125-150)  pops and restores, pushes no redo.
 *   setupUIConditions (pl_editor_frame.cpp:311-331)  Undo / Redo enable on
 *       the depths; Paste on `Idle && NoActiveTool`.
 *
 * Every expectation is derived from the C++, never from calling the code
 * under test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CORNER_ANCHOR,
  DS_DATA_ITEM,
  DS_ITEM_TYPE,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { wxUpdateUIEvent } from '@ziroeda/common/wx/wx_event.js';
import type { PL_EDITOR_FRAME } from '@ziroeda/pagelayout_editor/pl_editor_frame.js';
import { PL_ACTIONS } from '@ziroeda/pagelayout_editor/tools/pl_actions.js';
import { PL_SELECTION_TOOL } from '@ziroeda/pagelayout_editor/tools/pl_selection_tool.js';
import { type Harness, makeHarness, settle, toolbar } from './pl_editor_fixture.js';

let model: DS_DATA_MODEL;

beforeEach(() => {
  SetPgm(new PGM_BASE());
  model = new DS_DATA_MODEL();
  DS_DATA_MODEL.SetAltInstance(model);
});

afterEach(() => {
  DS_DATA_MODEL.SetAltInstance(null);
  SetPgm(null);
});

/** A frame on an empty sheet holding two lines, `a` then `b`. */
function twoLines(): { h: Harness; a: DS_DATA_ITEM; b: DS_DATA_ITEM } {
  const h = makeHarness(EDA_UNITS_INT.MM);
  model.ClearList();

  const a = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);
  a.SetStart(10, 10, CORNER_ANCHOR.LT_CORNER);
  a.SetEnd(50, 10, CORNER_ANCHOR.LT_CORNER);
  model.Append(a);

  const b = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);
  b.SetStart(10, 30, CORNER_ANCHOR.LT_CORNER);
  b.SetEnd(50, 30, CORNER_ANCHOR.LT_CORNER);
  model.Append(b);

  h.frame.HardRedraw();
  h.frame.ClearUndoRedoList();
  return { h, a, b };
}

/** `wxEVT_UPDATE_UI` for the control running `aAction`. */
function update(aFrame: PL_EDITOR_FRAME, aAction: TOOL_ACTION): wxUpdateUIEvent {
  const e = new wxUpdateUIEvent(aAction.GetUIId());
  aFrame.ProcessUpdateUI(e);
  return e;
}

/** The start of every line in the model, in mm from its anchor. */
const starts = (): number[] => model.GetItems().map((i) => i.m_Pos.m_Pos.y);

describe('SaveCopyInUndoList (pl_editor_undo_redo.cpp:34-45)', () => {
  it('pushes onto undo and CLEARS redo', () => {
    const { h } = twoLines();

    h.frame.SaveCopyInUndoList();
    h.frame.GetLayoutFromUndoList();
    expect(h.frame.GetRedoCommandCount()).toBe(1);

    h.frame.SaveCopyInUndoList();
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    expect(h.frame.GetRedoCommandCount()).toBe(0);
  });

  it('every entry carries the page: `DS_PROXY_UNDO_ITEM( this )` (:37)', () => {
    const { h } = twoLines();

    h.frame.SaveCopyInUndoList();
    const a4 = new PAGE_INFO();
    a4.SetType('A4');
    h.frame.SetPageSettings(a4);

    h.frame.GetLayoutFromUndoList();
    // The settings page is A3 (pl_editor_settings.cpp:52), restored by the PLUS entry.
    expect(h.frame.GetPageSettings().GetTypeAsString()).toBe('A3');
  });
});

describe('GetLayoutFromUndoList / GetLayoutFromRedoList', () => {
  it('does nothing on an empty stack', () => {
    const { h } = twoLines();

    h.frame.GetLayoutFromUndoList();
    h.frame.GetLayoutFromRedoList();

    expect(model.GetCount()).toBe(2);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
    expect(h.frame.GetRedoCommandCount()).toBe(0);
    expect(h.frame.IsContentModified()).toBe(false);
  });

  it('delete, undo, redo: the sheet goes back and forth, one entry moving list to list', () => {
    const { h, a } = twoLines();
    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(a.GetDrawItems()[0]!);

    h.mgr.RunAction(ACTIONS.doDelete);
    expect(starts()).toEqual([30]);

    h.mgr.RunAction(ACTIONS.undo);
    expect(starts()).toEqual([10, 30]);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
    expect(h.frame.GetRedoCommandCount()).toBe(1);

    h.mgr.RunAction(ACTIONS.redo);
    expect(starts()).toEqual([30]);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    expect(h.frame.GetRedoCommandCount()).toBe(0);
  });

  it('delete, undo: the deleted item comes back SELECTED, as the entry recorded it', () => {
    // DoDelete takes the copy while the item is still selected
    // (pl_edit_tool.cpp:387), and Restore re-selects the recorded index.
    const { h, b } = twoLines();
    const sel = h.mgr.GetTool(PL_SELECTION_TOOL)!;
    sel.AddItemToSel(b.GetDrawItems()[0]!);

    h.mgr.RunAction(ACTIONS.doDelete);
    h.mgr.RunAction(ACTIONS.undo);

    const selection = sel.GetSelection();
    expect(selection.GetSize()).toBe(1);
    expect(selection.Front()).toBe(model.GetItem(1)!.GetDrawItems()[0]);
  });

  it('undo marks the sheet modified (OnModify, :118)', () => {
    const { h, a } = twoLines();
    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(a.GetDrawItems()[0]!);
    h.mgr.RunAction(ACTIONS.doDelete);
    h.frame.GetScreen()!.SetContentModified(false);

    h.mgr.RunAction(ACTIONS.undo);

    expect(h.frame.IsContentModified()).toBe(true);
  });
});

describe('RollbackFromUndo (pl_editor_undo_redo.cpp:125-150)', () => {
  it('restores what the entry captured and pushes NOTHING onto redo', () => {
    const { h } = twoLines();

    h.frame.SaveCopyInUndoList();
    model.Remove(model.GetItem(0)!);
    h.frame.RollbackFromUndo();

    expect(starts()).toEqual([10, 30]);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
    expect(h.frame.GetRedoCommandCount()).toBe(0);
  });

  it('draw, cancel: the half-drawn line is gone and Redo is not offered', () => {
    const { h } = twoLines();

    toolbar(h.mgr, PL_ACTIONS.drawLine);
    h.cursor.at = { x: 100000, y: 100000 };
    h.mgr.RunAction(ACTIONS.cursorClick);
    expect(model.GetCount()).toBe(3);

    h.mgr.RunAction(ACTIONS.cancelInteractive);

    expect(model.GetCount()).toBe(2);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
    expect(h.frame.GetRedoCommandCount()).toBe(0);
  });
});

describe('Page Preview Settings (pl_editor_control.cpp:90-111)', () => {
  it('Cancel pops the entry it pushed and leaves no redo', async () => {
    const { h } = twoLines();
    h.host.pageSettingsAnswers.push(false);

    h.mgr.RunAction(PL_ACTIONS.previewSettings);
    await settle();

    expect(h.frame.GetUndoCommandCount()).toBe(0);
    expect(h.frame.GetRedoCommandCount()).toBe(0);
    expect(h.frame.IsContentModified()).toBe(false);
  });

  it('OK, then Undo: the page goes back to what it was', async () => {
    const { h } = twoLines();
    h.host.ShowPageSettingsDialog = () => {
      const a4 = new PAGE_INFO();
      a4.SetType('A4');
      h.frame.SetPageSettings(a4);
      return Promise.resolve(true);
    };

    h.mgr.RunAction(PL_ACTIONS.previewSettings);
    await settle();
    expect(h.frame.GetPageSettings().GetTypeAsString()).toBe('A4');
    expect(h.frame.IsContentModified()).toBe(true);

    h.mgr.RunAction(ACTIONS.undo);
    expect(h.frame.GetPageSettings().GetTypeAsString()).toBe('A3');
  });
});

describe('setupUIConditions (pl_editor_frame.cpp:311-331)', () => {
  it('Undo and Redo enable on GetUndoCommandCount() > 0 / GetRedoCommandCount() > 0', () => {
    const { h, a } = twoLines();

    expect(update(h.frame, ACTIONS.undo).GetEnabled()).toBe(false);
    expect(update(h.frame, ACTIONS.redo).GetEnabled()).toBe(false);

    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(a.GetDrawItems()[0]!);
    h.mgr.RunAction(ACTIONS.doDelete);
    expect(update(h.frame, ACTIONS.undo).GetEnabled()).toBe(true);
    expect(update(h.frame, ACTIONS.redo).GetEnabled()).toBe(false);

    h.mgr.RunAction(ACTIONS.undo);
    expect(update(h.frame, ACTIONS.undo).GetEnabled()).toBe(false);
    expect(update(h.frame, ACTIONS.redo).GetEnabled()).toBe(true);
  });

  it('Cut, Copy and Delete want a selection', () => {
    const { h, a } = twoLines();

    for (const act of [ACTIONS.cut, ACTIONS.copy, ACTIONS.doDelete])
      expect(update(h.frame, act).GetEnabled()).toBe(false);

    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(a.GetDrawItems()[0]!);

    for (const act of [ACTIONS.cut, ACTIONS.copy, ACTIONS.doDelete])
      expect(update(h.frame, act).GetEnabled()).toBe(true);
  });

  it('Paste is greyed while a drawing tool is armed (NoActiveTool)', () => {
    const { h } = twoLines();

    expect(update(h.frame, ACTIONS.paste).GetEnabled()).toBe(true);

    toolbar(h.mgr, PL_ACTIONS.drawRectangle);
    expect(update(h.frame, ACTIONS.paste).GetEnabled()).toBe(false);

    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(update(h.frame, ACTIONS.paste).GetEnabled()).toBe(true);
  });

  it('the armed tool and the title block mode are the checked controls', () => {
    const { h } = twoLines();

    expect(update(h.frame, ACTIONS.selectionTool).GetChecked()).toBe(true);
    expect(update(h.frame, PL_ACTIONS.layoutEditMode).GetChecked()).toBe(true);
    expect(update(h.frame, PL_ACTIONS.layoutNormalMode).GetChecked()).toBe(false);

    toolbar(h.mgr, PL_ACTIONS.placeText);
    expect(update(h.frame, PL_ACTIONS.placeText).GetChecked()).toBe(true);
    expect(update(h.frame, ACTIONS.selectionTool).GetChecked()).toBe(false);
  });
});
