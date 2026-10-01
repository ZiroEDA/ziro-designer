// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_CLEANUP_TRACKS_AND_VIAS (pcbnew/dialogs/dialog_cleanup_tracks_and_vias.cpp)
 * on a live BOARD, opened by GLOBAL_EDIT_TOOL::CleanupTracksAndVias. Each
 * expectation cites its line; TRACKS_CLEANER itself is tested in
 * tracks_cleaner.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { DIALOG_CLEANUP_TRACKS_AND_VIAS } from '@ziroeda/pcbnew/dialogs/dialog_cleanup_tracks_and_vias.js';
import { GLOBAL_EDIT_TOOL } from '@ziroeda/pcbnew/tools/global_edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { type TOOL_HARNESS, toolHarness, U } from '../support/pcb_tool_harness.js';
import { GLOBAL_EDIT_TEST_FRAME } from '../support/global_edit_test_frame.js';

// Two co-linear segments of N1 meeting at (20,10) with nothing else there:
// "Merge co-linear tracks" makes them one.
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(20)}"))
  (segment (start 20 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(21)}"))
)
`;

class CLEANUP_FRAME extends GLOBAL_EDIT_TEST_FRAME {
  dialog: DIALOG_CLEANUP_TRACKS_AND_VIAS | null = null;
  override ShowCleanupTracksAndViasDialog(aDialog: DIALOG_CLEANUP_TRACKS_AND_VIAS): void {
    this.dialog = aDialog;
  }
}

let h: TOOL_HARNESS<CLEANUP_FRAME>;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new CLEANUP_FRAME(aBoard),
    () => [new GLOBAL_EDIT_TOOL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
});

function open(): DIALOG_CLEANUP_TRACKS_AND_VIAS {
  h.mgr.RunAction(PCB_ACTIONS.cleanupTracksAndVias);
  const dlg = h.frame.dialog!;
  dlg.TransferDataToWindow();
  dlg.m_mergeSegmOpt = true;
  dlg.OnCheckBox();
  return dlg;
}

const tracks = (): number => h.board.Tracks().length;

describe('DIALOG_CLEANUP_TRACKS_AND_VIAS', () => {
  it('the tool opens it, offering "Build Changes" first (:89-95)', () => {
    expect(open().GetOKLabel()).toBe('Build Changes');
  });

  it('the first OK is a dry run: lists the change, keeps the board, stays open (:135-140)', async () => {
    const dlg = open();
    const undo = h.frame.GetUndoCommandCount();
    expect(await dlg.TransferDataFromWindow()).toBe(false);
    expect(dlg.m_changesTreeModel.GetTree().length).toBe(1);
    expect(tracks()).toBe(2);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
    expect(dlg.GetOKLabel()).toBe('Update PCB');
  });

  it('the second OK cleans up, as one undo step, and closes (:243-249)', async () => {
    const dlg = open();
    await dlg.TransferDataFromWindow();
    const undo = h.frame.GetUndoCommandCount();
    expect(await dlg.TransferDataFromWindow()).toBe(true);
    expect(tracks()).toBe(1);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('changing an option after a dry run goes back to "Build Changes" (:98-103)', async () => {
    const dlg = open();
    await dlg.TransferDataFromWindow();
    dlg.m_cleanViasOpt = true;
    dlg.OnCheckBox();
    expect(dlg.GetOKLabel()).toBe('Build Changes');
    expect(dlg.m_changesTreeModel.GetTree().length).toBe(0);
  });

  it('a net filter on another net leaves these tracks out (:176-180)', async () => {
    const dlg = open();
    dlg.m_netFilterOpt = true;
    dlg.m_netFilter = 2;
    dlg.OnCheckBox();
    await dlg.TransferDataFromWindow();
    expect(dlg.m_changesTreeModel.GetTree().length).toBe(0);
  });

  it('lists the net classes, Default first (:48-56)', () => {
    expect(open().m_netclassNames[0]).toBe('Default');
  });
});
