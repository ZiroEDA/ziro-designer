// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ROUTER_TOOL's drag half (router_tool.cpp:2073-2871): InlineDrag re-cuts a
 * selected track or carries a footprint with the router, CanInlineDrag and
 * NeighboringSegmentFilter decide what a drag grabs, and InlineBreakTrack
 * splits a segment where the cursor is.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  AS_GLOBAL,
  TA_CANCEL_TOOL,
  TA_MOUSE_CLICK,
  TA_MOUSE_MOTION,
  TC_COMMAND,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { PnsDragMode } from '@ziroeda/pcbnew/router/pns_drag_algo.js';
import { ROUTER_TOOL } from '@ziroeda/pcbnew/router/router_tool.js';
import { EDIT_TOOL } from '@ziroeda/pcbnew/tools/edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import {
  byUuid,
  ids,
  mm,
  mouse,
  select,
  type TOOL_HARNESS,
  toolHarness,
  U,
} from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

/**
 * A pad at (40,60) wired by one straight track to a pad at (60,60), both N1;
 * a two-segment corner of N2 at (40,80)-(50,80)-(50,90).
 */
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
  (footprint "R1" (layer "F.Cu") (at 40 60) (uuid "00000000-0000-4000-8000-000000000001")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "00000000-0000-4000-8000-000000000011")))
  (footprint "R2" (layer "F.Cu") (at 60 60) (uuid "00000000-0000-4000-8000-000000000002")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "00000000-0000-4000-8000-000000000012")))
  (segment (start 40 60) (end 60 60) (width 0.25) (layer "F.Cu") (net 1) (uuid "00000000-0000-4000-8000-000000000021"))
  (segment (start 40 80) (end 50 80) (width 0.25) (layer "F.Cu") (net 2) (uuid "00000000-0000-4000-8000-000000000022"))
  (segment (start 50 80) (end 50 90) (width 0.25) (layer "F.Cu") (net 2) (uuid "00000000-0000-4000-8000-000000000023"))
)
`;

class DRAG_TEST_FRAME extends TEST_PCB_FRAME {
  readonly infobar: string[] = [];

  override ShowInfoBarError(aErrorMsg: string): void {
    this.infobar.push(aErrorMsg);
  }
}

let h: TOOL_HARNESS<DRAG_TEST_FRAME>;
let rt: ROUTER_TOOL;

const tracks = (aBoard: BOARD): PCB_TRACK[] =>
  aBoard.Tracks().filter((t) => t.Type() === KICAD_T.PCB_TRACE_T);

const ends = (aBoard: BOARD): { x: number; y: number }[][] =>
  tracks(aBoard).map((t) => [t.GetStart(), t.GetEnd()]);

function cancel(): void {
  h.mgr.ProcessEvent(new TOOL_EVENT(TC_COMMAND, TA_CANCEL_TOOL, AS_GLOBAL));
}

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (b) => new DRAG_TEST_FRAME(b),
    () => [new ROUTER_TOOL(), new EDIT_TOOL()],
  );
  const bds = h.board.GetDesignSettings();
  bds.m_DRCEngine = new DRC_ENGINE(h.board, bds);
  bds.m_DRCEngine.InitEngine('(version 1)', 'r.kicad_dru');
  h.view.SetTopLayer(PCB_LAYER_ID.F_Cu);
  rt = h.mgr.GetTool(ROUTER_TOOL)!;
  // `Reset( RUN )` is what builds the router: the frame does it when the tool
  // is first run, InitTools did it here.
});

describe('ROUTER_TOOL::InlineDrag (router_tool.cpp:2326)', () => {
  it('drags a selected track: the segment follows the cursor and the ends stay on the pads', () => {
    select(h, 21);
    h.mouse = mm(50, 60);
    h.mgr.RunAction(PCB_ACTIONS.routerInlineDrag, PnsDragMode.DM_ANY);

    expect(h.frame.UndoRedoBlocked()).toBe(true);

    mouse(h, TA_MOUSE_MOTION, mm(50, 64));
    mouse(h, TA_MOUSE_CLICK, mm(50, 64));

    expect(h.frame.UndoRedoBlocked()).toBe(false);
    const pts = ends(h.board)
      .filter((_e, i) => tracks(h.board)[i]!.GetNetCode() === 1)
      .flat();
    expect(pts).toContainEqual(mm(40, 60));
    expect(pts).toContainEqual(mm(60, 60));
    expect(pts.some((p) => p.y === mm(0, 64).y)).toBe(true);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('Esc leaves the board alone and puts the selection back', () => {
    const before = ends(h.board);
    select(h, 21);
    h.mouse = mm(50, 60);
    h.mgr.RunAction(PCB_ACTIONS.routerInlineDrag, PnsDragMode.DM_ANY);
    mouse(h, TA_MOUSE_MOTION, mm(50, 64));
    // A cancel passes on by default (TOOL_EVENT's m_passEvent), so the idle
    // selection tool sees it after InlineDrag has put the selection back, and
    // clears it, as KiCad does for a hotkey drag. What it clears is the
    // restored selection.
    const atClear: string[][] = [];
    const orig = h.sel.ClearSelection.bind(h.sel);
    h.sel.ClearSelection = (...a: Parameters<typeof orig>) => {
      atClear.push(ids(h.sel.GetSelection().GetItems()));
      return orig(...a);
    };
    cancel();

    expect(ends(h.board)).toEqual(before);
    expect(h.frame.UndoRedoBlocked()).toBe(false);
    expect(atClear).toEqual([[U(21)]]);
  });

  it('drags a footprint and its track end follows (COMPONENT_DRAGGER)', () => {
    select(h, 2);
    h.mouse = mm(60, 60);
    h.mgr.RunAction(PCB_ACTIONS.routerInlineDrag, PnsDragMode.DM_ANY);
    mouse(h, TA_MOUSE_MOTION, mm(60, 70));
    mouse(h, TA_MOUSE_CLICK, mm(60, 70));

    const fp = byUuid(h.board, 2) as unknown as FOOTPRINT;
    expect(fp.GetPosition()).toEqual(mm(60, 70));
    const pts = ends(h.board)
      .filter((_e, i) => tracks(h.board)[i]!.GetNetCode() === 1)
      .flat();
    expect(pts).toContainEqual(mm(60, 70));
    expect(pts).toContainEqual(mm(40, 60));
  });
});

describe('EDIT_TOOL::Drag reaches ROUTER_TOOL::InlineDrag (edit_tool.cpp invokeInlineRouter)', () => {
  it('D on a selected track drags it with the router', () => {
    select(h, 21);
    h.mouse = mm(50, 60);
    h.mgr.RunAction(PCB_ACTIONS.drag45Degree);
    mouse(h, TA_MOUSE_MOTION, mm(50, 62));
    mouse(h, TA_MOUSE_CLICK, mm(50, 62));

    const pts = tracks(h.board)
      .filter((t) => t.GetNetCode() === 1)
      .flatMap((t) => [t.GetStart(), t.GetEnd()]);
    expect(pts.some((p) => p.y === mm(0, 62).y)).toBe(true);
  });
});

describe('ROUTER_TOOL::CanInlineDrag / NeighboringSegmentFilter (:2222-2315)', () => {
  it('one selected track can be dragged', () => {
    select(h, 21);
    expect(rt.CanInlineDrag(PnsDragMode.DM_ANY)).toBe(true);
  });

  it('footprints can be dragged, but several only at 45 degrees', () => {
    select(h, 1, 2);
    expect(rt.CanInlineDrag(PnsDragMode.DM_ANY)).toBe(true);
    expect(rt.CanInlineDrag(PnsDragMode.DM_ANY | PnsDragMode.DM_FREE_ANGLE)).toBe(false);
  });

  it('one footprint is a DraggableItems type, free-angle or not (the Size() == 1 arm)', () => {
    select(h, 2);
    expect(rt.CanInlineDrag(PnsDragMode.DM_ANY | PnsDragMode.DM_FREE_ANGLE)).toBe(true);
  });

  it('a cursor on a corner of two co-terminal segments selects just one of them', () => {
    h.mouse = mm(50, 80);
    expect(rt.CanInlineDrag(PnsDragMode.DM_ANY)).toBe(true);
    expect(h.sel.GetSelection().Size()).toBe(1);
  });
});

describe('ROUTER_TOOL::InlineBreakTrack (router_tool.cpp:2810)', () => {
  it('splits the selected segment at the cursor, as one undo step', () => {
    select(h, 21);
    // Off the centreline: the break point is snapped onto the segment.
    h.mouse = mm(47, 60.05);
    h.mgr.RunAction(PCB_ACTIONS.breakTrack);

    const n1 = tracks(h.board).filter((t) => t.GetNetCode() === 1);
    expect(n1).toHaveLength(2);
    expect(n1.flatMap((t) => [t.GetStart(), t.GetEnd()])).toContainEqual(mm(47, 60));
    expect(h.frame.UndoRedoBlocked()).toBe(false);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });
});

describe('ROUTER_TOOL::MainLoop drag actions (router_tool.cpp:2003-2019)', () => {
  it('drag45Degree in the armed router drags the track under the cursor', () => {
    const evt = PCB_ACTIONS.routeSingleTrack.MakeEvent();
    evt.SetHasPosition(false);
    h.mgr.ProcessEvent(evt);
    mouse(h, TA_MOUSE_MOTION, mm(50, 60));
    h.mgr.RunAction(PCB_ACTIONS.drag45Degree);
    mouse(h, TA_MOUSE_MOTION, mm(50, 63));
    mouse(h, TA_MOUSE_CLICK, mm(50, 63));

    // The fix ends performDragging, which lifts the undo/redo block.
    expect(h.frame.UndoRedoBlocked()).toBe(false);

    const pts = tracks(h.board)
      .filter((t) => t.GetNetCode() === 1)
      .flatMap((t) => [t.GetStart(), t.GetEnd()]);
    expect(pts.some((p) => p.y === mm(0, 63).y)).toBe(true);
    expect(rt.IsToolActive()).toBe(true);
  });
});
