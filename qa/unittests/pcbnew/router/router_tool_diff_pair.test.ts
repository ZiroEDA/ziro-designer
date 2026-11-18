// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Route Differential Pair, armed through the TOOL_MANAGER as the menu, the toolbar and the `6`
 * hotkey arm it (`ROUTER_TOOL::MainLoop`, router_tool.cpp:1925).
 *
 * `pns_diff_pair_session.test.ts` drives the placer through a PnsSession built in pair mode, so it
 * never saw this: MainLoop held the router from before `Activate()`, whose `Reset( RUN )` builds a
 * new one, and set the pair mode on the discarded router. The live router stayed in single-track
 * mode and the "pair" routed one track (uartbridge, U-14).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  TA_MOUSE_CLICK,
  TA_MOUSE_DBLCLICK,
  TA_MOUSE_MOTION,
} from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { ROUTER_TOOL } from '@ziroeda/pcbnew/router/router_tool.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { mm, mouse, type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

/** CLK_P over CLK_N, 1 mm apart, two parts 10 mm apart (pns_diff_pair_session's board). */
const DP_BOARD = `(kicad_pcb (version 20240108) (generator "t")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "/CLK_P") (net 2 "/CLK_N")
  (footprint "L:F" (layer "F.Cu") (at 100 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "/CLK_P"))
    (pad "2" smd rect (at 0 1) (size 1 1) (layers "F.Cu") (net 2 "/CLK_N")))
  (footprint "L:F" (layer "F.Cu") (at 110 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "/CLK_P"))
    (pad "2" smd rect (at 0 1) (size 1 1) (layers "F.Cu") (net 2 "/CLK_N")))
)`;

let h: TOOL_HARNESS<TEST_PCB_FRAME>;

beforeEach(() => {
  h = toolHarness(
    DP_BOARD,
    (b) => new TEST_PCB_FRAME(b),
    () => [new ROUTER_TOOL()],
  );
  const bds = h.board.GetDesignSettings();
  bds.m_DRCEngine = new DRC_ENGINE(h.board, bds);
  bds.m_DRCEngine.InitEngine('(version 1)', 'r.kicad_dru');
  h.view.SetTopLayer(PCB_LAYER_ID.F_Cu);
});

/** ACTION_TOOLBAR / ACTION_MENU: the action's event, with no position. */
function arm(aAction: TOOL_ACTION): void {
  const evt = aAction.MakeEvent();
  evt.SetHasPosition(false);
  h.mgr.ProcessEvent(evt);
}

/** Click the P pad of the left part, run to the right part's P pad, and fix there. */
function routeAcross(): void {
  mouse(h, TA_MOUSE_MOTION, mm(100, 100));
  mouse(h, TA_MOUSE_CLICK, mm(100, 100));
  mouse(h, TA_MOUSE_MOTION, mm(105, 100.5));
  mouse(h, TA_MOUSE_MOTION, mm(110, 100));
  mouse(h, TA_MOUSE_DBLCLICK, mm(110, 100));
}

const tracksOn = (aNet: number): number =>
  h.board.Tracks().filter((t) => t.Type() === KICAD_T.PCB_TRACE_T && t.GetNetCode() === aNet)
    .length;

describe('ROUTER_TOOL::MainLoop in PNS_MODE_ROUTE_DIFF_PAIR', () => {
  it('Route Differential Pair lays both lanes: tracks on the P net and on the N net', () => {
    arm(PCB_ACTIONS.routeDiffPair);
    routeAcross();

    expect(tracksOn(1)).toBeGreaterThan(0);
    expect(tracksOn(2)).toBeGreaterThan(0);
    expect(tracksOn(2)).toBe(tracksOn(1));
  });

  it('Route Single Track from the same pad lays the P net alone', () => {
    arm(PCB_ACTIONS.routeSingleTrack);
    routeAcross();

    expect(tracksOn(1)).toBeGreaterThan(0);
    expect(tracksOn(2)).toBe(0);
  });
});
