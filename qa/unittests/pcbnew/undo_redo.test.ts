// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_BASE_EDIT_FRAME`'s undo/redo mixin (`pcbnew/undo_redo.ts`, ported
 * from `pcbnew/undo_redo.cpp`). `board_commit.test.ts` already exercises
 * `RestoreCopyFromUndoList`/`RestoreCopyFromRedoList` through `BOARD_COMMIT`
 * (which builds its own `PICKED_ITEMS_LIST` directly); this file covers the
 * parts that only, since nothing else calls them yet:
 * `SaveCopyInUndoList`/`AppendCopyToUndoList` themselves,
 * `UndoRedoBlocked`/`UndoRedoBlock` gating, `RollbackFromUndo`, and
 * `ClearUndoORRedoList`'s partial-clear (`aItemCount`) path.
 */
import { UR_TRANSIENT } from '@ziroeda/common/eda_item_flags.js';
import { UNDO_REDO_LIST } from '@ziroeda/common/eda_base_frame.js';
import { ITEM_PICKER, PICKED_ITEMS_LIST, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';
import { describe, expect, it } from 'vitest';

function trackOn(board: BOARD): PCB_TRACK {
  const track = new PCB_TRACK(board);
  track.SetStart({ x: 0, y: 0 });
  track.SetEnd({ x: 1_000_000, y: 0 });
  track.SetWidth(250_000);
  track.SetLayer(PCB_LAYER_ID.F_Cu);
  return track;
}

function setup(): { board: BOARD; frame: TEST_PCB_FRAME } {
  const board = new BOARD();
  const frame = new TEST_PCB_FRAME(board);
  return { board, frame };
}

describe('SaveCopyInUndoList / AppendCopyToUndoList', () => {
  it('a single-item NEWITEM command undoes by removing the item from the board', () => {
    const { board, frame } = setup();
    const track = trackOn(board);
    board.Add(track);

    frame.SaveCopyInUndoList(track, UNDO_REDO.NEWITEM);
    expect(frame.GetUndoCommandCount()).toBe(1);
    expect(board.Tracks()).toContain(track);

    frame.RestoreCopyFromUndoList();
    expect(board.Tracks()).not.toContain(track);
    expect(frame.GetUndoCommandCount()).toBe(0);
    expect(frame.GetRedoCommandCount()).toBe(1);
  });

  it('AppendCopyToUndoList joins the previous command instead of filing a new one', () => {
    const { board, frame } = setup();
    const t1 = trackOn(board);
    const t2 = trackOn(board);
    board.Add(t1);
    board.Add(t2);

    frame.SaveCopyInUndoList(t1, UNDO_REDO.NEWITEM);
    expect(frame.GetUndoCommandCount()).toBe(1);

    // AppendCopyToUndoList takes a PICKED_ITEMS_LIST, unlike the single-item
    // SaveCopyInUndoList overload.
    const appendList = new PICKED_ITEMS_LIST();
    appendList.PushItem(new ITEM_PICKER(null, t2, UNDO_REDO.NEWITEM));
    frame.AppendCopyToUndoList(appendList, UNDO_REDO.NEWITEM);

    // Still one command: Append joined it rather than filing a second one.
    expect(frame.GetUndoCommandCount()).toBe(1);

    const cmd = frame.PopCommandFromUndoList()!;
    expect(cmd.GetCount()).toBe(2);
    frame.PushCommandToUndoList(cmd);

    frame.RestoreCopyFromUndoList();
    expect(board.Tracks()).not.toContain(t1);
    expect(board.Tracks()).not.toContain(t2);
  });
});

describe('UndoRedoBlocked / UndoRedoBlock', () => {
  it('blocks RestoreCopyFromUndoList and RestoreCopyFromRedoList while set', () => {
    const { board, frame } = setup();
    const track = trackOn(board);
    board.Add(track);
    frame.SaveCopyInUndoList(track, UNDO_REDO.NEWITEM);

    expect(frame.UndoRedoBlocked()).toBe(false);
    frame.UndoRedoBlock(true);
    expect(frame.UndoRedoBlocked()).toBe(true);

    frame.RestoreCopyFromUndoList();
    // Nothing happened: the command is still there, the track still on the board.
    expect(frame.GetUndoCommandCount()).toBe(1);
    expect(board.Tracks()).toContain(track);

    frame.UndoRedoBlock(false);
    expect(frame.UndoRedoBlocked()).toBe(false);
    frame.RestoreCopyFromUndoList();
    expect(frame.GetUndoCommandCount()).toBe(0);
    expect(board.Tracks()).not.toContain(track);

    frame.UndoRedoBlock(true);
    frame.RestoreCopyFromRedoList();
    expect(frame.GetRedoCommandCount()).toBe(1);
    expect(board.Tracks()).not.toContain(track);
  });

  it('defaults UndoRedoBlocked() to false, and UndoRedoBlock() with no argument blocks', () => {
    const { frame } = setup();
    expect(frame.UndoRedoBlocked()).toBe(false);
    frame.UndoRedoBlock();
    expect(frame.UndoRedoBlocked()).toBe(true);
  });
});

describe('RollbackFromUndo', () => {
  it('undoes the last command without filing a redo entry', () => {
    const { board, frame } = setup();
    const track = trackOn(board);
    board.Add(track);
    frame.SaveCopyInUndoList(track, UNDO_REDO.NEWITEM);

    frame.RollbackFromUndo();
    expect(board.Tracks()).not.toContain(track);
    expect(frame.GetUndoCommandCount()).toBe(0);
    expect(frame.GetRedoCommandCount()).toBe(0);
  });
});

describe('ClearUndoORRedoList', () => {
  it('with a positive aItemCount drops only that many commands off the front (oldest first)', () => {
    const { board, frame } = setup();
    const t1 = trackOn(board);
    const t2 = trackOn(board);
    board.Add(t1);
    board.Add(t2);

    frame.SaveCopyInUndoList(t1, UNDO_REDO.NEWITEM);
    frame.SaveCopyInUndoList(t2, UNDO_REDO.NEWITEM);
    expect(frame.GetUndoCommandCount()).toBe(2);

    // Commands cleared this way must already be flagged transient, as a real
    // undo/redo swap would leave them (ClearListAndDeleteItems asserts it).
    t1.SetFlags(UR_TRANSIENT);

    frame.ClearUndoORRedoList(UNDO_REDO_LIST.UNDO_LIST, 1);
    expect(frame.GetUndoCommandCount()).toBe(1);

    // The remaining command is the newer one (t2's), confirming the front
    // (oldest, t1's) command was the one dropped.
    const cmd = frame.PopCommandFromUndoList()!;
    expect(cmd.GetPickedItem(0)).toBe(t2);
  });

  it('with aItemCount 0 is a no-op', () => {
    const { board, frame } = setup();
    const track = trackOn(board);
    board.Add(track);
    frame.SaveCopyInUndoList(track, UNDO_REDO.NEWITEM);

    frame.ClearUndoORRedoList(UNDO_REDO_LIST.UNDO_LIST, 0);
    expect(frame.GetUndoCommandCount()).toBe(1);
  });

  it('with no aItemCount (default -1) clears the whole list', () => {
    const { board, frame } = setup();
    const t1 = trackOn(board);
    const t2 = trackOn(board);
    board.Add(t1);
    board.Add(t2);
    t1.SetFlags(UR_TRANSIENT);
    t2.SetFlags(UR_TRANSIENT);

    frame.SaveCopyInUndoList(t1, UNDO_REDO.NEWITEM);
    frame.SaveCopyInUndoList(t2, UNDO_REDO.NEWITEM);
    expect(frame.GetUndoCommandCount()).toBe(2);

    frame.ClearUndoORRedoList(UNDO_REDO_LIST.UNDO_LIST);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });
});
