// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GLOBAL_EDIT_TOOL (pcbnew/tools/global_edit_tool.cpp) and DIALOG_SWAP_LAYERS
 * (pcbnew/dialogs/dialog_swap_layers.cpp) on a live BOARD, driven through the
 * tool manager. KiCad has no qa for either; each expectation cites its line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { DIALOG_SWAP_LAYERS } from '@ziroeda/pcbnew/dialogs/dialog_swap_layers.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import {
  GLOBAL_EDIT_TOOL,
  type GLOBAL_EDIT_TOOL_FRAME,
} from '@ziroeda/pcbnew/tools/global_edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { byUuid, type TOOL_HARNESS, toolHarness, U } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const { F_Cu, In1_Cu, In2_Cu, B_Cu, F_SilkS } = PCB_LAYER_ID;

// Four copper layers. Tracks on F.Cu (20) and B.Cu (21), an arc on F.Cu (22),
// a through via (23) and a blind via In1-B (24), a copper line (30) and a silk
// line (31), a zone on F.Cu (40), and a footprint with an F.Cu pad (5).
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (4 "In1.Cu" signal)
    (6 "In2.Cu" signal)
    (2 "B.Cu" signal)
    (5 "F.SilkS" user "F.Silkscreen")
    (25 "Edge.Cuts" user)
  )
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)
    (property "Reference" "R1" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "${U(5)}"))
  )
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(20)}"))
  (segment (start 10 20) (end 20 20) (width 0.25) (layer "B.Cu") (net 1) (uuid "${U(21)}"))
  (arc (start 10 30) (mid 15 32) (end 20 30) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(22)}"))
  (via (at 30 10) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U(23)}"))
  (via blind (at 30 20) (size 0.6) (drill 0.3) (layers "In1.Cu" "B.Cu") (net 1) (uuid "${U(24)}"))
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.1) (type solid)) (layer "F.Cu") (uuid "${U(30)}"))
  (gr_line (start 10 60) (end 20 60) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(31)}"))
  (zone (net 1) (net_name "N1") (layer "F.Cu") (uuid "${U(40)}") (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25) (filled_areas_thickness no)
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 40 40) (xy 50 40) (xy 50 50) (xy 40 50))))
)
`;

class GLOBAL_EDIT_FRAME extends TEST_PCB_FRAME implements GLOBAL_EDIT_TOOL_FRAME {
  /** What the Swap Layers dialog answers: a row edit, then OK or Cancel. */
  swapAnswer: { set: [PCB_LAYER_ID, PCB_LAYER_ID][]; ok: boolean } = { set: [], ok: true };
  swapDialogs = 0;
  zoneAnswer = { ok: true, repour: false };
  fills = 0;
  modifies = 0;

  override OnModify(): void {
    this.modifies++;
    super.OnModify();
  }

  ShowSwapLayersDialog(aDialog: DIALOG_SWAP_LAYERS): Promise<boolean> {
    this.swapDialogs++;
    const rows = aDialog.GetRows();

    for (const [from, to] of this.swapAnswer.set)
      aDialog.SetDestination(
        rows.findIndex((r) => r.from === from),
        to,
      );

    if (this.swapAnswer.ok) aDialog.TransferDataFromWindow();

    return Promise.resolve(this.swapAnswer.ok);
  }

  ShowZoneManagerDialog(): Promise<{ ok: boolean; repour: boolean }> {
    return Promise.resolve(this.zoneAnswer);
  }

  ShowCleanupTracksAndViasDialog(): void {}
}

/** ZONE_FILLER_TOOL as far as the posted zoneFillAll: it counts the fills. */
class COUNTING_FILLER extends TOOL_INTERACTIVE {
  constructor(private readonly m_frame: () => GLOBAL_EDIT_FRAME) {
    super('pcbnew.ZoneFiller');
  }
  override Init(): boolean {
    return true;
  }
  override Reset(): void {}
  ZoneFillAll(_aEvent: TOOL_EVENT): number {
    this.m_frame().fills++;
    return 0;
  }
  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER<COUNTING_FILLER>(this.ZoneFillAll), PCB_ACTIONS.zoneFillAll.MakeEvent());
  }
}

type Harness = TOOL_HARNESS<GLOBAL_EDIT_FRAME>;
let h: Harness;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new GLOBAL_EDIT_FRAME(aBoard),
    () => [new GLOBAL_EDIT_TOOL(), new COUNTING_FILLER(() => h.frame)],
  );
  // A loaded board: PCB_BASE_EDIT_FRAME::SetBoard's ResetTools( MODEL_RELOAD ),
  // which is when the tool makes its BOARD_COMMIT (global_edit_tool.cpp:52-53).
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const item = (n: number): BOARD_ITEM => byUuid(h.board, n) as BOARD_ITEM;
const layers = (n: number): PCB_LAYER_ID[] => item(n).GetLayerSet().Seq();

async function swap(aSet: [PCB_LAYER_ID, PCB_LAYER_ID][], aOk = true): Promise<void> {
  h.frame.swapAnswer = { set: aSet, ok: aOk };
  h.mgr.RunAction(PCB_ACTIONS.swapLayers);
  await flush();
}

describe('DIALOG_SWAP_LAYERS (dialog_swap_layers.cpp)', () => {
  const dialog = (map = new Map<PCB_LAYER_ID, PCB_LAYER_ID>()) => {
    const dlg = new DIALOG_SWAP_LAYERS({ GetBoard: () => h.board }, map);
    dlg.TransferDataToWindow();
    return { dlg, map };
  };

  it('one row per enabled copper layer, front, inners, back, each to itself (:110-133)', () => {
    expect(dialog().dlg.GetRows()).toEqual([
      { from: F_Cu, to: F_Cu },
      { from: In1_Cu, to: In1_Cu },
      { from: In2_Cu, to: In2_Cu },
      { from: B_Cu, to: B_Cu },
    ]);
  });

  it('a destination that is not an enabled copper layer is dropped (:150-151)', () => {
    const { dlg, map } = dialog();
    dlg.SetDestination(0, F_SilkS);
    dlg.SetDestination(3, PCB_LAYER_ID.In5_Cu);
    dlg.SetDestination(1, In2_Cu);
    dlg.TransferDataFromWindow();
    expect(map.has(F_Cu)).toBe(false);
    expect(map.has(B_Cu)).toBe(false);
    expect(map.get(In1_Cu)).toBe(In2_Cu);
    expect(map.get(In2_Cu)).toBe(In2_Cu);
  });
});

describe('GLOBAL_EDIT_TOOL::SwapLayers (global_edit_tool.cpp:137-192)', () => {
  it('F.Cu and B.Cu swap at once: tracks, arcs, copper graphics and zones (:157-182)', async () => {
    await swap([
      [F_Cu, B_Cu],
      [B_Cu, F_Cu],
    ]);
    expect(layers(20)).toEqual([B_Cu]);
    expect(layers(21)).toEqual([F_Cu]);
    expect(layers(22)).toEqual([B_Cu]);
    expect(layers(30)).toEqual([B_Cu]);
    expect(layers(40)).toEqual([B_Cu]);
    // ZONE::SetLayerSet drops the fill and flags a refill (zone.cpp:585-592).
    expect((item(40) as unknown as { NeedRefill(): boolean }).NeedRefill()).toBe(true);
  });

  it('never moves a pad, a footprint or a non-copper item', async () => {
    await swap([[F_Cu, B_Cu]]);
    expect(layers(5)).toEqual([F_Cu]);
    expect((item(1) as unknown as { GetLayer(): PCB_LAYER_ID }).GetLayer()).toBe(F_Cu);
    expect(layers(31)).toEqual([F_SilkS]);
  });

  it('skips a through via; remaps a blind via ordered top to bottom (:161-174)', async () => {
    await swap([
      [In1_Cu, In2_Cu],
      [F_Cu, B_Cu],
    ]);
    // LayerPair() answers F/B for any through via, so its padstack is what
    // shows it was skipped rather than rewritten.
    const through = item(23) as unknown as PCB_VIA;
    expect([through.Padstack().Drill().start, through.Padstack().Drill().end]).toEqual([
      F_Cu,
      B_Cu,
    ]);
    // SetLayerPair( top, bottom ) writes the drill span top first (:170).
    const blind = item(24) as unknown as PCB_VIA;
    expect(blind.LayerPair()).toEqual([In2_Cu, B_Cu]);
    expect([blind.Padstack().Drill().start, blind.Padstack().Drill().end]).toEqual([In2_Cu, B_Cu]);
  });

  it('merges two layers onto one without asking', async () => {
    await swap([[B_Cu, F_Cu]]);
    expect(layers(20)).toEqual([F_Cu]);
    expect(layers(21)).toEqual([F_Cu]);
  });

  it('Cancel moves nothing (:143-144)', async () => {
    await swap([[F_Cu, B_Cu]], false);
    expect(layers(20)).toEqual([F_Cu]);
    expect(h.frame.swapDialogs).toBe(1);
  });

  it('an identity map changes nothing and pushes no undo step (:184-189)', async () => {
    const undo = h.frame.GetUndoCommandCount();
    await swap([]);
    expect(layers(20)).toEqual([F_Cu]);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
    // `if( hasChanges )` guards OnModify too: the board is not marked modified.
    expect(h.frame.modifies).toBe(0);
  });

  it('a real swap is one undo step', async () => {
    const undo = h.frame.GetUndoCommandCount();
    await swap([[F_Cu, B_Cu]]);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });
});

describe('GLOBAL_EDIT_TOOL::ZonesManager (global_edit_tool.cpp:240-291)', () => {
  it('Cancel does nothing', async () => {
    h.frame.zoneAnswer = { ok: false, repour: true };
    h.mgr.RunAction(PCB_ACTIONS.zonesManager);
    await flush();
    expect(h.frame.fills).toBe(0);
  });

  it('OK with repour posts zoneFillAll; OK alone does not (:285-289)', async () => {
    h.frame.zoneAnswer = { ok: true, repour: false };
    h.mgr.RunAction(PCB_ACTIONS.zonesManager);
    await flush();
    expect(h.frame.fills).toBe(0);
    h.frame.zoneAnswer = { ok: true, repour: true };
    h.mgr.RunAction(PCB_ACTIONS.zonesManager);
    await flush();
    expect(h.frame.fills).toBe(1);
  });

  it('files no undo entry: the commit is filled and never pushed', async () => {
    const undo = h.frame.GetUndoCommandCount();
    h.mgr.RunAction(PCB_ACTIONS.zonesManager);
    await flush();
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });
});
