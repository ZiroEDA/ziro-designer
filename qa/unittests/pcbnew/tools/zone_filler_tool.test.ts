// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ZONE_FILLER_TOOL (pcbnew/tools/zone_filler_tool.cpp) on a live BOARD, driven
 * through the tool manager: Fill, Fill All, the dirty-zone refill, the
 * out-of-date check, Unfill and Unfill All.
 * KiCad has no qa for the tool; each expectation cites its line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import {
  ZONE_FILLER_TOOL,
  type ZONE_FILLER_TOOL_FRAME,
} from '@ziroeda/pcbnew/tools/zone_filler_tool.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import { byUuid, select, type TOOL_HARNESS, toolHarness, U } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

// Two filled-able zones on F.Cu, net N1, apart from each other.
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (zone (net 1) (net_name "N1") (layer "F.Cu") (uuid "${U(40)}") (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25) (filled_areas_thickness no)
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 10 10) (xy 30 10) (xy 30 30) (xy 10 30))))
  (zone (net 1) (net_name "N1") (layer "F.Cu") (uuid "${U(41)}") (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25) (filled_areas_thickness no)
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 50 10) (xy 70 10) (xy 70 30) (xy 50 30))))
)
`;

class FILLER_FRAME extends TEST_PCB_FRAME implements ZONE_FILLER_TOOL_FRAME {
  m_ZoneFillsDirty = true;
  rulesWarnings = 0;
  ShowZoneFillRulesWarning(): void {
    this.rulesWarnings++;
  }
  slowNotes = 0;
  ShowZoneAutoRefillSlowMessage(): void {
    this.slowNotes++;
  }
  asked: string[] = [];
  answer: KiDialogResult = 'ok';
  AskKiDialog(aRequest: KiDialogRequest): Promise<KiDialogResult> {
    this.asked.push(aRequest.message);
    return Promise.resolve(this.answer);
  }
}

type Harness = TOOL_HARNESS<FILLER_FRAME>;
let h: Harness;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new FILLER_FRAME(aBoard),
    () => [new ZONE_FILLER_TOOL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
});

const zone = (n: number): ZONE => byUuid(h.board, n) as unknown as ZONE;
const tool = (): ZONE_FILLER_TOOL =>
  h.mgr.FindTool('pcbnew.ZoneFiller') as unknown as ZONE_FILLER_TOOL;

describe('ZONE_FILLER_TOOL::FillAllZones (zone_filler_tool.cpp:119-205)', () => {
  it('fills every zone as one undo step and clears the dirty flag (:176-181)', () => {
    const undo = h.frame.GetUndoCommandCount();
    h.mgr.RunAction(PCB_ACTIONS.zoneFillAll);
    expect(zone(40).IsFilled()).toBe(true);
    expect(zone(41).IsFilled()).toBe(true);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    expect(h.frame.m_ZoneFillsDirty).toBe(false);
    expect(tool().IsBusy()).toBe(false);
  });

  it('undo takes the fill back off', () => {
    h.mgr.RunAction(PCB_ACTIONS.zoneFillAll);
    h.frame.RestoreCopyFromUndoList();
    expect(zone(40).IsFilled()).toBe(false);
  });
});

describe('ZONE_FILLER_TOOL::ZoneUnfill / ZoneUnfillAll (:387-452)', () => {
  beforeEach(() => {
    h.mgr.RunAction(PCB_ACTIONS.zoneFillAll);
  });

  it('Unfill All unfills every zone, one undo step', () => {
    const undo = h.frame.GetUndoCommandCount();
    h.mgr.RunAction(PCB_ACTIONS.zoneUnfillAll);
    expect(zone(40).IsFilled()).toBe(false);
    expect(zone(41).IsFilled()).toBe(false);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('Unfill unfills only the selected zone', () => {
    select(h, 40);
    h.mgr.RunAction(PCB_ACTIONS.zoneUnfill);
    expect(zone(40).IsFilled()).toBe(false);
    expect(zone(41).IsFilled()).toBe(true);
    // commit.Modify( zone ) before UnFill: undo puts the fill back.
    h.frame.RestoreCopyFromUndoList();
    expect(zone(40).IsFilled()).toBe(true);
  });

  it('Unfill with no zone selected does nothing (:401-405)', () => {
    const undo = h.frame.GetUndoCommandCount();
    h.mgr.RunAction(PCB_ACTIONS.zoneUnfill);
    expect(zone(40).IsFilled()).toBe(true);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });
});

describe('ZONE_FILLER_TOOL::CheckAllZones and ZONE_FILLER::Fill( aCheck ) (:67-110, zone_filler.cpp:1606-1658)', () => {
  it('does nothing when the board has not changed since the last fill (:69-70)', async () => {
    h.frame.m_ZoneFillsDirty = false;
    await tool().CheckAllZones();
    expect(h.frame.asked).toEqual([]);
    expect(zone(40).IsFilled()).toBe(false);
  });

  it('out-of-date fills: asks, and Refill keeps the new fill as one undo step', async () => {
    const undo = h.frame.GetUndoCommandCount();
    await tool().CheckAllZones();
    expect(h.frame.asked).toEqual(['Zone fills are out-of-date. Refill?']);
    expect(zone(40).IsFilled()).toBe(true);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    expect(h.frame.m_ZoneFillsDirty).toBe(false);
  });

  it('"Continue without Refill" reverts the pour and files nothing', async () => {
    h.frame.answer = 'cancel';
    const undo = h.frame.GetUndoCommandCount();
    await tool().CheckAllZones();
    expect(zone(40).IsFilled()).toBe(false);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
    expect(h.frame.m_ZoneFillsDirty).toBe(true);
  });

  it('fills already current: no question, no undo step (:1653-1657)', async () => {
    h.mgr.RunAction(PCB_ACTIONS.zoneFillAll);
    h.frame.m_ZoneFillsDirty = true;
    const undo = h.frame.GetUndoCommandCount();
    await tool().CheckAllZones();
    expect(h.frame.asked).toEqual([]);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });
});

describe('ZONE_FILLER_TOOL::ZoneFill (:316-377)', () => {
  it('fills the selected zone only, as one undo step', () => {
    select(h, 41);
    const undo = h.frame.GetUndoCommandCount();
    h.mgr.RunAction(PCB_ACTIONS.zoneFill);
    expect(zone(41).IsFilled()).toBe(true);
    expect(zone(40).IsFilled()).toBe(false);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    expect(tool().IsBusy()).toBe(false);
  });

  it('a zone passed with the event is filled instead of the selection (:322-325)', () => {
    select(h, 41);
    h.mgr.RunAction(PCB_ACTIONS.zoneFill, zone(40));
    expect(zone(40).IsFilled()).toBe(true);
    expect(zone(41).IsFilled()).toBe(false);
  });

  it('nothing to fill: no pour, no undo step (:340-344)', () => {
    const undo = h.frame.GetUndoCommandCount();
    h.mgr.RunAction(PCB_ACTIONS.zoneFill);
    expect(zone(40).IsFilled()).toBe(false);
    expect(zone(41).IsFilled()).toBe(false);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });
});

describe('ZONE_FILLER_TOOL::ZoneFillDirty and DirtyZone (:207-313, zone_filler_tool.h:66)', () => {
  it('refills the unfilled zones, appended to the last undo step (APPEND_UNDO)', () => {
    select(h, 40);
    h.mgr.RunAction(PCB_ACTIONS.zoneFill);
    const undo = h.frame.GetUndoCommandCount();
    h.mgr.RunAction(PCB_ACTIONS.zoneFillDirty);
    expect(zone(41).IsFilled()).toBe(true);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });

  it('a filled zone is refilled only when a commit marked it dirty', () => {
    h.mgr.RunAction(PCB_ACTIONS.zoneFillAll);
    zone(40).UnFill();
    zone(40).SetIsFilled(true);
    zone(41).UnFill();
    zone(41).SetIsFilled(true);
    tool().DirtyZone(zone(41));
    h.mgr.RunAction(PCB_ACTIONS.zoneFillDirty);
    expect(zone(40).GetFilledPolysList(zone(40).GetFirstLayer()).OutlineCount()).toBe(0);
    expect(zone(41).GetFilledPolysList(zone(41).GetFirstLayer()).OutlineCount()).toBe(1);
  });

  it('the dirty list is spent by one refill (:227)', () => {
    h.mgr.RunAction(PCB_ACTIONS.zoneFillAll);
    tool().DirtyZone(zone(41));
    h.mgr.RunAction(PCB_ACTIONS.zoneFillDirty);
    zone(41).UnFill();
    zone(41).SetIsFilled(true);
    h.mgr.RunAction(PCB_ACTIONS.zoneFillDirty);
    expect(zone(41).GetFilledPolysList(zone(41).GetFirstLayer()).OutlineCount()).toBe(0);
  });

  it('a quick refill shows no slow-refill note', () => {
    h.mgr.RunAction(PCB_ACTIONS.zoneFillDirty);
    expect(h.frame.slowNotes).toBe(0);
  });
});
