// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_FRAME's undo list on the live items (schematic_undo_redo.ts, eeschema stage
 * E3b), driven the way the editor drives it: SCH_COMMITs pushed through the frame, then
 * rolled back.  Every expectation is read off schematic_undo_redo.cpp / sch_commit.cpp.
 */
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNDO_REDO_LIST } from '@ziroeda/common/eda_base_frame.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { PICKED_ITEMS_LIST, ITEM_PICKER, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_LABEL } from '@ziroeda/eeschema/sch_label.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';

// SCH_EDIT_FRAME asks Prj() in its constructor, as KiCad's does: KiCad always has a PGM_BASE.
beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const hooks: SCH_EDIT_FRAME_HOOKS = {
  crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
  highlightNet: () => {},
  syncSelection: () => {},
  assignFootprints: () => {},
  saveProject: () => true,
  getNetlist: () => null,
};

function setup() {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('t.kicad_pro'));
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const sheet = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(sheet);

  const frame = new SCH_EDIT_FRAME(hooks);
  frame.SetSchematic(schematic);

  return { schematic, sheet, screen: sheet.LastScreen()!, frame };
}

const wireAt = (y: number): SCH_LINE => {
  const w = new SCH_LINE({ x: 0, y }, SCH_LAYER_ID.LAYER_WIRE);
  w.SetEndPoint({ x: 1000, y });
  return w;
};

describe('SCH_EDIT_FRAME undo list, through SCH_COMMIT', () => {
  it('a pushed add is one undo entry; rolling it back takes the item off the screen', () => {
    const { screen, frame, schematic } = setup();
    const wire = wireAt(0);
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'N');

    const commit = new SCH_COMMIT(frame);
    commit.Add(wire, screen);
    commit.Add(label, screen);
    commit.Push('Add wire');

    expect(frame.GetUndoCommandCount()).toBe(1);
    expect(frame.GetUndoActionDescription()).toBe('Add wire');
    // the push recalculated the connectivity through the frame
    expect(schematic.ConnectionGraph().GetSubgraphForItem(wire)!.GetDriver()).toBe(label);

    frame.RollbackSchematicFromUndo();

    expect(frame.GetUndoCommandCount()).toBe(0);
    expect(screen.CheckIfOnDrawList(wire)).toBe(false);
    expect(screen.CheckIfOnDrawList(label)).toBe(false);
    // and recalculated it again: the removed items are no longer in the graph
    expect(schematic.ConnectionGraph().GetSubgraphForItem(wire)).toBeNull();
  });

  it('a pushed modify rolls back to the image, reference fields through SetRef', () => {
    const { sheet, screen, frame } = setup();
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'A');
    screen.Append(label);

    const lib = new LIB_SYMBOL('R');
    const symbol = new SCH_SYMBOL(lib, new LIB_ID('Device', 'R'), sheet, 1, 0, { x: 0, y: 0 });
    screen.Append(symbol);
    symbol.SetRef(sheet, 'R1');

    const commit = new SCH_COMMIT(frame);
    commit.Modify(label, screen);
    label.SetPosition({ x: 400, y: 0 });
    label.SetText('B');
    commit.Push('Edit');

    const c2 = new SCH_COMMIT(frame);
    const ref = symbol.GetField(FIELD_T.REFERENCE)!;
    c2.Modify(ref, screen);
    symbol.SetRef(sheet, 'R9');
    c2.Push('Ref');

    frame.RollbackSchematicFromUndo();
    expect(symbol.GetRef(sheet)).toBe('R1');
    expect(label.GetText()).toBe('B');

    frame.RollbackSchematicFromUndo();
    expect(label.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(label.GetText()).toBe('A');
    expect(screen.CheckIfOnDrawList(label)).toBe(true);
  });

  it('a pushed remove rolls back onto the screen', () => {
    const { screen, frame } = setup();
    const text = new SCH_TEXT({ x: 0, y: 0 }, 't');
    screen.Append(text);

    const commit = new SCH_COMMIT(frame);
    commit.Remove(text, screen);
    commit.Push();
    expect(screen.CheckIfOnDrawList(text)).toBe(false);

    frame.RollbackSchematicFromUndo();
    expect(screen.CheckIfOnDrawList(text)).toBe(true);
  });
});

describe('SCH_EDIT_FRAME::PutDataInPreviousState', () => {
  it('flips NEWITEM and DELETED so the same list redoes, and undoes in reverse order', () => {
    const { screen, frame } = setup();
    const a = new SCH_TEXT({ x: 0, y: 0 }, 'a');
    const b = new SCH_TEXT({ x: 0, y: 0 }, 'b');
    screen.Append(a);

    const list = new PICKED_ITEMS_LIST();
    list.PushItem(new ITEM_PICKER(screen, a, UNDO_REDO.NEWITEM));
    list.PushItem(new ITEM_PICKER(screen, b, UNDO_REDO.DELETED));

    frame.PutDataInPreviousState(list);
    expect(screen.CheckIfOnDrawList(a)).toBe(false);
    expect(screen.CheckIfOnDrawList(b)).toBe(true);
    expect([list.GetPickedItemStatus(0), list.GetPickedItemStatus(1)]).toEqual([
      UNDO_REDO.DELETED,
      UNDO_REDO.NEWITEM,
    ]);

    frame.PutDataInPreviousState(list);
    expect(screen.CheckIfOnDrawList(a)).toBe(true);
    expect(screen.CheckIfOnDrawList(b)).toBe(false);
  });

  it('pickers are undone last-first: two images of one item end on the oldest', () => {
    const { screen, frame } = setup();
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'A');
    screen.Append(label);

    frame.SaveCopyInUndoList(screen, label, UNDO_REDO.CHANGED, false);
    label.SetText('B');
    frame.SaveCopyInUndoList(screen, label, UNDO_REDO.CHANGED, true);
    label.SetText('C');

    const list = frame.PopCommandFromUndoList()!;
    expect(list.GetCount()).toBe(2);
    frame.PutDataInPreviousState(list);
    expect(label.GetText()).toBe('A');
  });

  it("a symbol's reference field image restores the instance reference (SetRef)", () => {
    const { sheet, screen, frame } = setup();
    const lib = new LIB_SYMBOL('R');
    const symbol = new SCH_SYMBOL(lib, new LIB_ID('Device', 'R'), sheet, 1, 0, { x: 0, y: 0 });
    screen.Append(symbol);
    symbol.SetRef(sheet, 'R1');

    // the field itself, not its symbol: SaveCopyInUndoList does no undo-level remap
    frame.SaveCopyInUndoList(screen, symbol.GetField(FIELD_T.REFERENCE)!, UNDO_REDO.CHANGED, false);
    symbol.SetRef(sheet, 'R9');

    frame.RollbackSchematicFromUndo();
    expect(symbol.GetRef(sheet)).toBe('R1');
  });

  it('a CHANGED picker swaps both ways: undo then redo', () => {
    const { screen, frame } = setup();
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'OLD');
    screen.Append(label);

    frame.SaveCopyInUndoList(screen, label, UNDO_REDO.CHANGED, false);
    label.SetText('NEW');

    const list = frame.PopCommandFromUndoList()!;
    frame.PutDataInPreviousState(list);
    expect(label.GetText()).toBe('OLD');
    frame.PutDataInPreviousState(list);
    expect(label.GetText()).toBe('NEW');
  });
});

describe('SCH_EDIT_FRAME::SaveCopyInUndoList', () => {
  it('CHANGED stores a duplicate image with the same uuid and the item flags', () => {
    const { screen, frame } = setup();
    const label = new SCH_LABEL({ x: 5, y: 5 }, 'L');
    screen.Append(label);
    label.SetFlags(0x8); // IS_MOVING

    frame.SaveCopyInUndoList(screen, label, UNDO_REDO.CHANGED, false);

    const list = frame.PopCommandFromUndoList()!;
    const image = list.GetPickedItemLink(0)!;
    expect(image).not.toBe(label);
    expect(image.m_Uuid).toBe(label.m_Uuid);
    expect(list.GetPickerFlags(0) & 0x8).toBe(0x8);
  });

  it('append joins the last entry; an empty last entry is reused; a new save clears redo', () => {
    const { screen, frame } = setup();
    const a = new SCH_TEXT({ x: 0, y: 0 }, 'a');
    const b = new SCH_TEXT({ x: 0, y: 0 }, 'b');
    const c = new SCH_TEXT({ x: 0, y: 0 }, 'c');

    frame.SaveCopyInUndoList(screen, a, UNDO_REDO.NEWITEM, false);
    frame.SaveCopyInUndoList(screen, b, UNDO_REDO.NEWITEM, true);
    expect(frame.GetUndoCommandCount()).toBe(1);

    frame.SaveCopyInUndoList(screen, c, UNDO_REDO.NEWITEM, false);
    expect(frame.GetUndoCommandCount()).toBe(2);

    frame.PushCommandToUndoList(new PICKED_ITEMS_LIST());
    const list = new PICKED_ITEMS_LIST();
    list.SetDescription('into the empty one');
    list.PushItem(new ITEM_PICKER(screen, a, UNDO_REDO.UNSPECIFIED));
    frame.SaveCopyInUndoList(list, UNDO_REDO.CHANGED, false);
    expect(frame.GetUndoCommandCount()).toBe(3);
    const top = frame.PopCommandFromUndoList()!;
    // the empty entry was reused, so it keeps its own (empty) description
    expect(top.GetDescription()).toBe('');
    expect(top.GetPickedItemStatus(0)).toBe(UNDO_REDO.CHANGED);
    expect(top.GetPickedItemLink(0)).not.toBeNull();

    frame.PushCommandToRedoList(new PICKED_ITEMS_LIST());
    frame.SaveCopyInUndoList(screen, a, UNDO_REDO.DELETED, false);
    expect(frame.GetRedoCommandCount()).toBe(0);

    // and the list overload clears it too
    frame.PushCommandToRedoList(new PICKED_ITEMS_LIST());
    const l2 = new PICKED_ITEMS_LIST();
    l2.PushItem(new ITEM_PICKER(screen, b, UNDO_REDO.NEWITEM));
    frame.SaveCopyInUndoList(l2, UNDO_REDO.UNSPECIFIED, false);
    expect(frame.GetRedoCommandCount()).toBe(0);
  });

  it('a list save carries clones of the repeat items; rolling back restores that list', () => {
    const { screen, frame } = setup();
    const repeated = new SCH_TEXT({ x: 10, y: 10 }, 'rep');
    frame.AddCopyForRepeatItem(repeated);
    expect(frame.GetRepeatItems()).toHaveLength(1);

    const text = new SCH_TEXT({ x: 0, y: 0 }, 'x');
    const commit = new SCH_COMMIT(frame);
    commit.Add(text, screen);
    commit.Push();

    frame.ClearRepeatItemsList();
    expect(frame.GetRepeatItems()).toHaveLength(0);

    frame.RollbackSchematicFromUndo();
    expect(frame.GetRepeatItems()).toHaveLength(1);
    expect((frame.GetRepeatItems()[0] as SCH_TEXT).GetText()).toBe('rep');
  });

  it('ClearUndoORRedoList drops the oldest commands first', () => {
    const { screen, frame } = setup();

    for (const t of ['1', '2', '3']) {
      const list = new PICKED_ITEMS_LIST();
      list.SetDescription(t);
      list.PushItem(new ITEM_PICKER(screen, new SCH_TEXT({ x: 0, y: 0 }, t), UNDO_REDO.NEWITEM));
      frame.PushCommandToUndoList(list);
    }

    frame.ClearUndoORRedoList(UNDO_REDO_LIST.UNDO_LIST, 2);
    expect(frame.GetUndoCommandCount()).toBe(1);
    expect(frame.GetUndoActionDescription()).toBe('3');

    frame.ClearUndoORRedoList(UNDO_REDO_LIST.UNDO_LIST);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });
});
