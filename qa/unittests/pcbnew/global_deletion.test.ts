// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit > Global Deletions: GLOBAL_EDIT_TOOL::GlobalDeletions and
 * DIALOG_GLOBAL_DELETION (pcbnew/dialogs/dialog_global_deletion.cpp) on a live
 * BOARD. KiCad has no qa for it; each expectation cites its line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { DIALOG_GLOBAL_DELETION } from '@ziroeda/pcbnew/dialogs/dialog_global_deletion.js';
import { GLOBAL_EDIT_TOOL } from '@ziroeda/pcbnew/tools/global_edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { type TOOL_HARNESS, toolHarness, U } from './support/pcb_tool_harness.js';
import { GLOBAL_EDIT_TEST_FRAME } from './support/global_edit_test_frame.js';

// A zone (40), a teardrop zone (41), copper track on F.Cu (20) and B.Cu (21),
// a locked track (22), a via (23), a silk line (30), an Edge.Cuts line (31), a
// copper line (32), a text (33), an unlocked (1) and a locked (10) footprint.
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)
    (property "Reference" "R1" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(2)}")
      (effects (font (size 1 1) (thickness 0.15)))))
  (footprint "R" (locked) (layer "F.Cu") (uuid "${U(10)}") (at 80 30)
    (property "Reference" "R2" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(11)}")
      (effects (font (size 1 1) (thickness 0.15)))))
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(20)}"))
  (segment (start 10 20) (end 20 20) (width 0.25) (layer "B.Cu") (net 1) (uuid "${U(21)}"))
  (segment (locked yes) (start 10 30) (end 20 30) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(22)}"))
  (via (at 30 10) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U(23)}"))
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(30)}"))
  (gr_line (start 0 0) (end 100 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "${U(31)}"))
  (gr_line (start 10 60) (end 20 60) (stroke (width 0.1) (type solid)) (layer "F.Cu") (uuid "${U(32)}"))
  (gr_text "T" (at 40 50) (layer "F.SilkS") (uuid "${U(33)}") (effects (font (size 1 1) (thickness 0.15))))
  (zone (net 1) (net_name "N1") (layer "F.Cu") (uuid "${U(40)}") (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25) (filled_areas_thickness no)
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 40 40) (xy 50 40) (xy 50 50) (xy 40 50))))
  (zone (net 1) (net_name "N1") (layer "F.Cu") (uuid "${U(41)}") (hatch edge 0.5)
    (attr (teardrop (type padvia)))
    (connect_pads (clearance 0)) (min_thickness 0.0254) (filled_areas_thickness no)
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 60 40) (xy 61 40) (xy 61 41) (xy 60 41))))
)
`;

class FRAME extends GLOBAL_EDIT_TEST_FRAME {
  answer: Partial<DIALOG_GLOBAL_DELETION> & { ok?: boolean } = {};
  dialog: DIALOG_GLOBAL_DELETION | null = null;
  override ShowGlobalDeletionDialog(aDialog: DIALOG_GLOBAL_DELETION): Promise<boolean> {
    this.dialog = aDialog;
    const { ok = true, ...set } = this.answer;
    Object.assign(aDialog, set);
    return Promise.resolve(ok);
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

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function run(aSet: FRAME['answer']): Promise<void> {
  h.frame.answer = aSet;
  h.mgr.RunAction(PCB_ACTIONS.globalDeletions);
  await flush();
}

/** The uuid numbers still on the board. */
function left(): number[] {
  const ids = [
    ...h.board.Footprints(),
    ...h.board.Tracks(),
    ...h.board.Drawings(),
    ...h.board.Zones(),
  ].map((i) => Number.parseInt(i.m_Uuid.slice(-12), 10));
  return ids.sort((a, b) => a - b);
}

const ALL = [1, 10, 20, 21, 22, 23, 30, 31, 32, 33, 40, 41];

describe('DIALOG_GLOBAL_DELETION', () => {
  it('starts benign: only the unlocked filters on, "All layers", the row naming the layer (:84-91)', async () => {
    await run({ ok: false });
    const dlg = h.frame.dialog!;
    expect(dlg.m_delZones || dlg.m_delAll || dlg.m_delTracks).toBe(false);
    expect([dlg.m_trackFilterLocked, dlg.m_trackFilterUnlocked]).toEqual([false, true]);
    expect(dlg.m_rbLayersOption).toBe(0);
    expect(dlg.m_layerOptionLabels[1]).toBe('Current layer (F.Cu) only');
  });

  it('Cancel deletes nothing (:77)', async () => {
    await run({ ok: false, m_delAll: true });
    expect(left()).toEqual(ALL);
  });

  it('Clear board deletes everything, as one undo step', async () => {
    const undo = h.frame.GetUndoCommandCount();
    await run({ m_delAll: true });
    expect(left()).toEqual([]);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('Zones leaves the teardrop area to Teardrops (:137-149)', async () => {
    await run({ m_delZones: true });
    expect(left()).toContain(41);
    expect(left()).not.toContain(40);
  });

  it('Graphics takes non-copper shapes but not Edge.Cuts, copper, or text (:151-186)', async () => {
    await run({ m_delDrawings: true, m_delTexts: true });
    expect(left()).not.toContain(30);
    expect(left()).toContain(31); // Edge.Cuts carved out (:159)
    expect(left()).toContain(32); // copper is not in AllNonCuMask
    expect(left()).toContain(33); // else-if: Graphics suppresses Text (:180)
  });

  it('Board outlines takes Edge.Cuts only', async () => {
    await run({ m_delBoardEdges: true });
    expect(left()).not.toContain(31);
    expect(left()).toContain(30);
  });

  it('Text alone takes the text', async () => {
    await run({ m_delTexts: true });
    expect(left()).not.toContain(33);
  });

  it('Tracks & vias spares the locked track with the default filters (:217-246)', async () => {
    await run({ m_delTracks: true });
    expect(left()).toContain(22);
    for (const n of [20, 21, 23]) expect(left()).not.toContain(n);
  });

  it('Current layer only keeps what is not on it (:118-121)', async () => {
    await run({ m_delTracks: true, m_rbLayersOption: 1 });
    expect(left()).toContain(21); // B.Cu
    expect(left()).not.toContain(20);
    expect(left()).not.toContain(23); // a via is on F.Cu too
  });

  it('Footprints spares the locked one with the default filters (:192-210)', async () => {
    await run({ m_delFootprints: true });
    expect(left()).toContain(10);
    expect(left()).not.toContain(1);
  });

  it('nothing ticked deletes nothing', async () => {
    await run({});
    expect(left()).toEqual(ALL);
  });
});
