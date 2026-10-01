// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_UNUSED_PAD_LAYERS (pcbnew/dialogs/dialog_unused_pad_layers.cpp) on a
 * live BOARD, opened by GLOBAL_EDIT_TOOL::RemoveUnusedPads. Each expectation
 * cites its line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { DIALOG_UNUSED_PAD_LAYERS } from '@ziroeda/pcbnew/dialogs/dialog_unused_pad_layers.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { GLOBAL_EDIT_TOOL } from '@ziroeda/pcbnew/tools/global_edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { byUuid, select, type TOOL_HARNESS, toolHarness, U } from '../support/pcb_tool_harness.js';
import { GLOBAL_EDIT_TEST_FRAME } from '../support/global_edit_test_frame.js';

// Four copper layers: a PTH pad (5) and an SMD pad (6) on one footprint, a
// through via (20) and a blind via In1-In2 (21).
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (footprint "J" (layer "F.Cu") (uuid "${U(1)}") (at 50 50)
    (property "Reference" "J1" (at 0 -3 0) (layer "F.Cu") (uuid "${U(2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu") (uuid "${U(5)}"))
    (pad "2" smd rect (at 3 0) (size 1 1) (layers "F.Cu") (uuid "${U(6)}"))
  )
  (via (at 10 10) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (uuid "${U(20)}"))
  (via blind (at 20 10) (size 0.6) (drill 0.3) (layers "In1.Cu" "In2.Cu") (uuid "${U(21)}"))
)
`;

class FRAME extends GLOBAL_EDIT_TEST_FRAME {
  dialog: DIALOG_UNUSED_PAD_LAYERS | null = null;
  override ShowUnusedPadLayersDialog(aDialog: DIALOG_UNUSED_PAD_LAYERS): void {
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
});

function open(
  aSet: Partial<
    Pick<
      DIALOG_UNUSED_PAD_LAYERS,
      'm_cbVias' | 'm_cbPads' | 'm_cbSelectedOnly' | 'm_cbPreserveExternalLayers'
    >
  >,
): DIALOG_UNUSED_PAD_LAYERS {
  h.mgr.RunAction(PCB_ACTIONS.removeUnusedPads);
  return Object.assign(h.frame.dialog!, aSet);
}

const pad = (n: number): PAD => byUuid(h.board, n) as unknown as PAD;
const via = (n: number): PCB_VIA => byUuid(h.board, n) as unknown as PCB_VIA;

describe('DIALOG_UNUSED_PAD_LAYERS', () => {
  it('keeps outside layers by default (:44-47)', () => {
    expect(open({}).m_cbPreserveExternalLayers).toBe(true);
  });

  it('Remove Unused Layers marks PTH pads and vias, keeping outside layers (:150-185)', () => {
    open({ m_cbVias: true, m_cbPads: true }).OnOK();
    expect(pad(5).GetRemoveUnconnected()).toBe(true);
    expect(pad(5).GetKeepTopBottom()).toBe(true);
    expect(pad(6).GetRemoveUnconnected()).toBe(false); // SMD: not PTH (:97-101)
    expect(via(20).GetRemoveUnconnected()).toBe(true); // through, > 2 copper layers (:87-88)
    expect(via(20).GetKeepStartEnd()).toBe(true);
    // BOARD::LayerDepth subtracts raw layer ids (board.cpp:1003-1012), and 10.0's
    // copper ids step by 2 (In1 = 4, In2 = 6): depth 2 > 1, so even this
    // adjacent-layer blind via is a candidate - as is every blind via in 10.0.6.
    expect(via(21).GetRemoveUnconnected()).toBe(true);
  });

  it('unticking Keep outside layers clears keep-top-bottom and keep-start-end', () => {
    open({ m_cbVias: true, m_cbPads: true, m_cbPreserveExternalLayers: false }).OnOK();
    expect(pad(5).GetKeepTopBottom()).toBe(false);
    expect(via(20).GetKeepStartEnd()).toBe(false);
  });

  it('Restore All Layers turns removal back off (:63-67)', () => {
    open({ m_cbVias: true, m_cbPads: true }).OnOK();
    open({ m_cbVias: true, m_cbPads: true }).OnApply();
    expect(pad(5).GetRemoveUnconnected()).toBe(false);
    expect(via(20).GetRemoveUnconnected()).toBe(false);
  });

  it('only vias, when only Vias is ticked', () => {
    open({ m_cbVias: true }).OnOK();
    expect(via(20).GetRemoveUnconnected()).toBe(true);
    expect(pad(5).GetRemoveUnconnected()).toBe(false);
  });

  it('only pads, when only Pads is ticked', () => {
    open({ m_cbPads: true }).OnOK();
    expect(pad(5).GetRemoveUnconnected()).toBe(true);
    expect(via(20).GetRemoveUnconnected()).toBe(false);
  });

  it('Selected only touches the selection (:105-145)', () => {
    select(h, 20);
    open({ m_cbVias: true, m_cbPads: true, m_cbSelectedOnly: true }).OnOK();
    expect(via(20).GetRemoveUnconnected()).toBe(true);
    expect(pad(5).GetRemoveUnconnected()).toBe(false);
  });

  it('one run is one undo step (:189)', () => {
    const undo = h.frame.GetUndoCommandCount();
    open({ m_cbVias: true, m_cbPads: true }).OnOK();
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    h.frame.RestoreCopyFromUndoList();
    expect(pad(5).GetRemoveUnconnected()).toBe(false);
  });
});

describe('a two-layer board', () => {
  it('has no unused layers in a through via (:87-88)', () => {
    h = toolHarness(
      BOARD_TEXT.replace('(4 "In1.Cu" signal) (6 "In2.Cu" signal) ', '').replace(
        /\n {2}\(via blind[^\n]*/,
        '',
      ),
      (aBoard) => new FRAME(aBoard),
      () => [new GLOBAL_EDIT_TOOL()],
    );
    h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
    open({ m_cbVias: true }).OnOK();
    expect(via(20).GetRemoveUnconnected()).toBe(false);
  });
});
