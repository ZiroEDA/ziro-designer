// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit > Edit Track & Via Properties: GLOBAL_EDIT_TOOL::EditTracksAndVias and
 * DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS (dialog_global_edit_tracks_and_vias.cpp)
 * on a live BOARD. KiCad has no qa for it; each expectation cites its line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import type { DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS } from '@ziroeda/pcbnew/dialogs/dialog_global_edit_tracks_and_vias.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { GLOBAL_EDIT_TOOL } from '@ziroeda/pcbnew/tools/global_edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { byUuid, select, type TOOL_HARNESS, toolHarness, U } from './support/pcb_tool_harness.js';
import { GLOBAL_EDIT_TEST_FRAME } from './support/global_edit_test_frame.js';

const MM = (n: number): number => Math.round(n * 1_000_000);

// N1 track on F.Cu (20), N2 track on F.Cu (21), N1 track on B.Cu (22), an N1
// arc on F.Cu (23), a through via (24) and a blind via (25), both N1.
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(20)}"))
  (segment (start 10 20) (end 20 20) (width 0.25) (layer "F.Cu") (net 2) (uuid "${U(21)}"))
  (segment (start 10 30) (end 20 30) (width 0.25) (layer "B.Cu") (net 1) (uuid "${U(22)}"))
  (arc (start 10 40) (mid 15 42) (end 20 40) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(23)}"))
  (via (at 30 10) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U(24)}"))
  (via blind (at 30 20) (size 0.6) (drill 0.3) (layers "F.Cu" "In1.Cu") (net 1) (uuid "${U(25)}"))
)
`;

class FRAME extends GLOBAL_EDIT_TEST_FRAME {
  dialog: DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS | null = null;
  override ShowGlobalEditTracksAndViasDialog(aDialog: DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS): void {
    this.dialog = aDialog;
  }
}

let h: TOOL_HARNESS<FRAME>;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new FRAME(aBoard),
    () => [new GLOBAL_EDIT_TOOL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  // The pre-defined sizes come from the project; entry 0 is "use netclass".
  h.board.GetDesignSettings().m_TrackWidthList = [0, MM(0.4), MM(0.5)];
});

function open(): DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS {
  h.mgr.RunAction(PCB_ACTIONS.editTracksAndVias);
  const dlg = h.frame.dialog!;
  dlg.TransferDataToWindow();
  return dlg;
}

const track = (n: number): PCB_TRACK => byUuid(h.board, n) as unknown as PCB_TRACK;

/** Pick "Track: 0.500 mm ..." (row 1, list entry 2). */
const width05 = (dlg: DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS): void => {
  dlg.m_trackWidthCtrl.selection = 1;
};

describe('DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS', () => {
  it('lists the pre-defined widths, then "leave unchanged", and starts there (:61-64, :204-206)', () => {
    const dlg = open();
    expect(dlg.m_trackWidthCtrl.items).toEqual([
      'Track: 0.400 mm (15.75 mils)',
      'Track: 0.500 mm (19.69 mils)',
      INDETERMINATE_ACTION,
    ]);
    expect(dlg.m_trackWidthCtrl.items[dlg.m_trackWidthCtrl.selection]).toBe(INDETERMINATE_ACTION);
    expect(dlg.m_layerCtrl).toBe(PCB_LAYER_ID.UNDEFINED_LAYER);
  });

  it('sets the chosen width on tracks and arcs, one undo entry (:241-251, :427-432)', () => {
    const dlg = open();
    width05(dlg);
    const undo = h.frame.GetUndoCommandCount();
    dlg.TransferDataFromWindow();
    for (const n of [20, 21, 22, 23]) expect(track(n).GetWidth()).toBe(MM(0.5));
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('leaves everything alone when every action is "leave unchanged"', () => {
    const undo = h.frame.GetUndoCommandCount();
    open().TransferDataFromWindow();
    expect(track(20).GetWidth()).toBe(MM(0.25));
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });

  it('the Tracks box gates tracks and arcs (:404-412)', () => {
    const dlg = open();
    width05(dlg);
    dlg.m_tracks = false;
    dlg.TransferDataFromWindow();
    expect(track(20).GetWidth()).toBe(MM(0.25));
    expect(track(23).GetWidth()).toBe(MM(0.25));
  });

  it('net filter, net class filter, layer filter (:349-372)', () => {
    let dlg = open();
    width05(dlg);
    dlg.m_netFilterOpt = true;
    dlg.m_netFilter = 2;
    dlg.TransferDataFromWindow();
    expect([track(20).GetWidth(), track(21).GetWidth()]).toEqual([MM(0.25), MM(0.5)]);

    dlg = open();
    width05(dlg);
    dlg.m_layerFilterOpt = true;
    dlg.m_layerFilter = PCB_LAYER_ID.B_Cu;
    dlg.TransferDataFromWindow();
    expect(track(22).GetWidth()).toBe(MM(0.5));
    expect(track(20).GetWidth()).toBe(MM(0.25));
  });

  it('the width filter applies to arcs as well as tracks (:381-385)', () => {
    track(23).SetWidth(MM(0.3));
    const dlg = open();
    width05(dlg);
    dlg.m_filterByTrackWidth = true;
    dlg.m_trackWidthFilter.SetValue(MM(0.3));
    dlg.TransferDataFromWindow();
    expect(track(23).GetWidth()).toBe(MM(0.5));
    expect(track(20).GetWidth()).toBe(MM(0.25));
  });

  it('the layer action moves tracks and arcs, never vias (:301-312)', () => {
    const dlg = open();
    dlg.m_layerCtrl = PCB_LAYER_ID.B_Cu;
    dlg.TransferDataFromWindow();
    expect(track(20).GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(track(23).GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(track(24).GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
  });

  it('Selected items only (:327-339)', () => {
    select(h, 21);
    const dlg = open();
    width05(dlg);
    dlg.m_selectedItemsFilter = true;
    dlg.TransferDataFromWindow();
    expect(track(21).GetWidth()).toBe(MM(0.5));
    expect(track(20).GetWidth()).toBe(MM(0.25));
  });

  it('net class values: the Default netclass track width (:315-318)', () => {
    // SetTrackSegmentWidth( ..., true ) reads GetWidthConstraint(), which the
    // DRC engine answers from the netclass once its rules are compiled, as
    // PCB_EDIT_FRAME does when a board loads.
    h.board.GetDesignSettings().m_DRCEngine!.InitEngine(null);
    // A current width other than the netclass's, so "design rules" and "the
    // current width" give different answers.
    h.board.GetDesignSettings().SetTrackWidthIndex(2);
    const dlg = open();
    dlg.m_setToSpecifiedValues = false;
    dlg.TransferDataFromWindow();
    const nc = h.board.GetDesignSettings().m_NetSettings.GetDefaultNetclass();
    expect(track(20).GetWidth()).toBe(nc.GetTrackWidth());
  });

  it('the Vias box is tri-state over the four via types (:118-134)', () => {
    const dlg = open();
    expect(dlg.GetViasValue()).toBe(true);
    dlg.m_blindVias = false;
    expect(dlg.GetViasValue()).toBe(null);
    dlg.OnVias(false);
    expect(dlg.GetViasValue()).toBe(false);
  });

  it('keeps the net class filter for the next open (the destructor statics, :103-104)', () => {
    let dlg = open();
    dlg.m_netclassFilter = 'Default';
    dlg.m_netFilter = 2;
    dlg.OnClose();
    dlg = open();
    expect(dlg.m_netFilter).toBe(2);
  });
});
