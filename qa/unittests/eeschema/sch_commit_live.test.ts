// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_COMMIT (eeschema stage E3b).  The cases marked "qa:" are KiCad's own
 * (qa/tests/eeschema/test_sch_commit.cpp); the rest are read off sch_commit.cpp, with a
 * recording frame standing in for SCH_EDIT_FRAME as the tool manager's holder.
 */
import { describe, expect, it } from 'vitest';
import { CHANGE_TYPE } from '@ziroeda/common/commit.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IS_MOVING, SELECTED, SELECTED_BY_DRAG } from '@ziroeda/common/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { TOOLS_HOLDER } from '@ziroeda/common/tool/tools_holder.js';
import { type PICKED_ITEMS_LIST, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_COMMIT, SKIP_UNDO } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_GROUP } from '@ziroeda/eeschema/sch_group.js';
import type { SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import { SCH_LABEL } from '@ziroeda/eeschema/sch_label.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_CLEANUP_FLAGS, SCHEMATIC } from '@ziroeda/eeschema/schematic.js';

describe('SCH_COMMIT (qa: test_sch_commit.cpp)', () => {
  it('RecursesThroughGroups', () => {
    const mgr = new TOOL_MANAGER();
    const commit = new SCH_COMMIT(mgr);
    const t1 = new SCH_TEXT();
    const t2 = new SCH_TEXT();
    const group = new SCH_GROUP();
    group.AddItem(t1);
    group.AddItem(t2);

    commit.Stage(group, CHANGE_TYPE.CHT_MODIFY, null, RECURSE_MODE.RECURSE);

    expect(commit.GetStatus(t1)).toBe(CHANGE_TYPE.CHT_MODIFY);
    expect(commit.GetStatus(t2)).toBe(CHANGE_TYPE.CHT_MODIFY);
  });

  it('ClearsSelectedByDragFlag', () => {
    const mgr = new TOOL_MANAGER();
    const commit = new SCH_COMMIT(mgr);
    const text = new SCH_TEXT();
    text.SetFlags(SELECTED_BY_DRAG);
    text.SetSelected();

    commit.Stage(text, CHANGE_TYPE.CHT_MODIFY);

    expect(text.IsSelected()).toBe(true);
    expect(commit.GetStatus(text)).toBe(CHANGE_TYPE.CHT_MODIFY);
  });

  it('the image of a drag-selected item is taken unselected', () => {
    const { screen, mgr, calls } = setup();
    const text = new SCH_TEXT({ x: 0, y: 0 }, 't');
    screen.Append(text);
    text.SetFlags(SELECTED_BY_DRAG);
    text.SetSelected();

    const commit = new SCH_COMMIT(mgr);
    commit.Modify(text, screen);
    commit.Push();

    const image = calls.undo[0]!.list.GetPickedItemLink(0)!;
    expect(image.IsSelected()).toBe(false);
    expect(text.IsSelected()).toBe(true);
  });
});

/** SCH_EDIT_FRAME as the commit sees it: records every call. */
function recordingFrame(schematic: SCHEMATIC) {
  const calls = {
    undo: [] as { list: PICKED_ITEMS_LIST; type: UNDO_REDO; append: boolean }[],
    recalc: [] as SCH_CLEANUP_FLAGS[],
    modified: 0,
    hierarchy: 0,
    updated: [] as [SCH_ITEM, boolean][],
  };

  const frame = {
    IsType: (t: FRAME_T) => t === FRAME_T.FRAME_SCH,
    GetScreen: () => schematic.GetCurrentScreen(),
    GetCurrentSheet: () => schematic.CurrentSheet(),
    UpdateHopOveredWires: () => {},
    UpdateItem: (item: SCH_ITEM, isAddOrDelete = false) => {
      calls.updated.push([item, isAddOrDelete]);
    },
    SaveCopyInUndoList: (list: PICKED_ITEMS_LIST, type: UNDO_REDO, append: boolean) => {
      calls.undo.push({ list, type, append });
    },
    RecalculateConnections: (_c: SCH_COMMIT | null, flags: SCH_CLEANUP_FLAGS) => {
      calls.recalc.push(flags);
    },
    UpdateHierarchyNavigator: () => {
      calls.hierarchy++;
    },
    OnModify: () => {
      calls.modified++;
    },
    // TOOLS_HOLDER, as TOOL_MANAGER::ProcessEvent asks it
    GetDoImmediateActions: () => true,
  };

  const mgr = new TOOL_MANAGER();
  mgr.SetEnvironment(schematic, null, null, null, frame as unknown as TOOLS_HOLDER);
  return { mgr, calls };
}

function setup() {
  const schematic = new SCHEMATIC(null);
  schematic.CreateDefaultScreens();
  const sheet = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(sheet);
  const screen = sheet.LastScreen()!;
  return { schematic, sheet, screen, ...recordingFrame(schematic) };
}

describe('SCH_COMMIT::Push', () => {
  it('an add goes on the screen, files one NEWITEM entry and a local connectivity rebuild', () => {
    const { screen, mgr, calls } = setup();
    const wire = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    wire.SetEndPoint({ x: 100, y: 0 });

    const commit = new SCH_COMMIT(mgr);
    commit.Add(wire, screen);
    commit.Push('Add wire');

    expect(screen.CheckIfOnDrawList(wire)).toBe(true);
    expect(calls.undo).toHaveLength(1);
    expect(calls.undo[0]!.type).toBe(UNDO_REDO.UNSPECIFIED);
    expect(calls.undo[0]!.list.GetDescription()).toBe('Add wire');
    expect(calls.undo[0]!.list.GetPickedItem(0)).toBe(wire);
    expect(calls.undo[0]!.list.GetPickedItemStatus(0)).toBe(UNDO_REDO.NEWITEM);
    expect(calls.recalc).toEqual([SCH_CLEANUP_FLAGS.LOCAL_CLEANUP]);
    expect(calls.updated).toEqual([[wire, true]]);
    expect(calls.modified).toBe(1);
    expect(commit.Empty()).toBe(true);
  });

  it('a graphic-only change files undo but rebuilds no connectivity; a sheet is global', () => {
    const { schematic, screen, mgr, calls } = setup();
    const text = new SCH_TEXT({ x: 0, y: 0 }, 'note');
    const commit = new SCH_COMMIT(mgr);
    commit.Add(text, screen);
    commit.Push();
    expect(calls.undo).toHaveLength(1);
    expect(calls.recalc).toEqual([]);

    const sheet = new SCH_SHEET(screen, { x: 0, y: 0 }, { x: 1000, y: 1000 });
    const c2 = new SCH_COMMIT(mgr);
    c2.Add(sheet, screen);
    c2.Push();
    expect(calls.recalc).toEqual([SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP]);
    expect(calls.hierarchy).toBe(1); // refreshHierarchy
    expect(schematic).toBeTruthy();
  });

  it('a modify files the pre-change image; a moved label is a connectivity change', () => {
    const { screen, mgr, calls } = setup();
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'A');
    screen.Append(label);

    const commit = new SCH_COMMIT(mgr);
    commit.Modify(label, screen);
    label.SetPosition({ x: 500, y: 0 });
    commit.Push('Move');

    const list = calls.undo[0]!.list;
    expect(list.GetPickedItemStatus(0)).toBe(UNDO_REDO.CHANGED);
    const image = list.GetPickedItemLink(0) as SCH_LABEL;
    expect(image).not.toBe(label);
    expect(image.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(calls.recalc).toEqual([SCH_CLEANUP_FLAGS.LOCAL_CLEANUP]);

    // unchanged connectivity: no rebuild
    const c2 = new SCH_COMMIT(mgr);
    c2.Modify(label, screen);
    c2.Push();
    expect(calls.recalc).toHaveLength(1);
  });

  it('a remove leaves the screen and files a DELETED entry holding the image', () => {
    const { screen, mgr, calls } = setup();
    const text = new SCH_TEXT({ x: 0, y: 0 }, 'gone');
    screen.Append(text);

    const commit = new SCH_COMMIT(mgr);
    commit.Remove(text, screen);
    commit.Push();

    expect(screen.CheckIfOnDrawList(text)).toBe(false);
    const list = calls.undo[0]!.list;
    expect(list.GetPickedItemStatus(0)).toBe(UNDO_REDO.DELETED);
    expect(list.GetPickedItemLink(0)).not.toBeNull();
  });

  it('SKIP_UNDO files nothing and rebuilds nothing', () => {
    const { screen, mgr, calls } = setup();
    const wire = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    const commit = new SCH_COMMIT(mgr);
    commit.Add(wire, screen);
    commit.Push('x', SKIP_UNDO);
    expect(screen.CheckIfOnDrawList(wire)).toBe(true);
    expect(calls.undo).toEqual([]);
    expect(calls.recalc).toEqual([]);
  });

  it('pushed items keep only SELECTED / STARTPOINT / ENDPOINT', () => {
    const { screen, mgr } = setup();
    const text = new SCH_TEXT({ x: 0, y: 0 }, 't');
    screen.Append(text);
    const commit = new SCH_COMMIT(mgr);
    commit.Modify(text, screen);
    text.SetFlags(IS_MOVING | SELECTED);
    commit.Push();
    expect(text.HasFlag(SELECTED)).toBe(true);
    expect(text.HasFlag(IS_MOVING)).toBe(false);
  });

  it("a symbol's field is staged as its symbol (undoLevelItem)", () => {
    const { sheet, screen, mgr } = setup();
    const lib = new LIB_SYMBOL('R');
    const symbol = new SCH_SYMBOL(lib, new LIB_ID('Device', 'R'), sheet, 1, 0, { x: 0, y: 0 });
    screen.Append(symbol);
    const value = symbol.GetField(FIELD_T.VALUE)!;

    const commit = new SCH_COMMIT(mgr);
    commit.Modify(value, screen);
    expect(commit.GetStatus(symbol, screen)).toBe(CHANGE_TYPE.CHT_MODIFY);
    expect(commit.GetFirst()).toBe(symbol);
  });
});

describe('SCH_COMMIT::Revert', () => {
  it('a modify swaps the image back; a done add leaves; a done remove returns', () => {
    const { screen, mgr, calls } = setup();
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'A');
    screen.Append(label);
    const added = new SCH_TEXT({ x: 0, y: 0 }, 'new');
    screen.Append(added);
    const removed = new SCH_TEXT({ x: 0, y: 0 }, 'old');

    const commit = new SCH_COMMIT(mgr);
    commit.Modify(label, screen);
    label.SetPosition({ x: 700, y: 0 });
    label.SetText('B');
    commit.Added(added, screen);
    commit.Removed(removed, screen);
    commit.Revert();

    expect(label.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(label.GetText()).toBe('A');
    expect(label.IsConnectivityDirty()).toBe(true);
    expect(screen.CheckIfOnDrawList(added)).toBe(false);
    expect(screen.CheckIfOnDrawList(removed)).toBe(true);
    expect(calls.recalc).toEqual([SCH_CLEANUP_FLAGS.NO_CLEANUP]);
    expect(calls.undo).toEqual([]);
    expect(commit.Empty()).toBe(true);
  });

  it('an add that was never applied is simply dropped', () => {
    const { screen, mgr } = setup();
    const text = new SCH_TEXT({ x: 0, y: 0 }, 'x');
    const commit = new SCH_COMMIT(mgr);
    commit.Add(text, screen);
    commit.Revert();
    expect(screen.CheckIfOnDrawList(text)).toBe(false);

    // not CHT_DONE: Revert leaves the item wherever the tool put it
    screen.Append(text);
    const c2 = new SCH_COMMIT(mgr);
    c2.Add(text, screen);
    c2.Revert();
    expect(screen.CheckIfOnDrawList(text)).toBe(true);
  });
});
