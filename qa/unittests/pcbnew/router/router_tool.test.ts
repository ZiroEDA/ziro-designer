// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ROUTER_TOOL on TOOL_MANAGER (router_tool.cpp): the routing actions arm
 * MainLoop, a click runs performRouting on the live BOARD until a fix finishes
 * it or Esc abandons the head, and the via and layer commands move the head
 * between copper layers mid-route.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  AS_GLOBAL,
  TA_CANCEL_TOOL,
  TA_MOUSE_CLICK,
  TA_MOUSE_DBLCLICK,
  TA_MOUSE_MOTION,
  TC_COMMAND,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PnsMode } from '@ziroeda/pcbnew/router/pns_routing_settings.js';
import {
  DEFAULT_ROUTER_SIZES,
  sizesAddLayerPair,
  sizesClearLayerPairs,
  sizesGetLayerBottom,
  sizesGetLayerTop,
  sizesPairedLayer,
} from '@ziroeda/pcbnew/router/pns_router.js';
import { copySizes } from '@ziroeda/pcbnew/router/pns_tool_base.js';
import {
  ACT_PlaceThroughVia,
  ACT_SwitchCornerModeToNext,
  ROUTER_TOOL,
} from '@ziroeda/pcbnew/router/router_tool.js';
import { MM, mm, mouse, type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

/** Two pads of N1 on F.Cu, 10 mm apart, and a lone pad of N2. */
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
  (footprint "R1" (layer "F.Cu") (at 40 60) (uuid "00000000-0000-4000-8000-000000000001")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "00000000-0000-4000-8000-000000000011")))
  (footprint "R2" (layer "F.Cu") (at 50 60) (uuid "00000000-0000-4000-8000-000000000002")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "00000000-0000-4000-8000-000000000012")))
  (footprint "R3" (layer "F.Cu") (at 40 80) (uuid "00000000-0000-4000-8000-000000000003")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 2 "N2") (uuid "00000000-0000-4000-8000-000000000013")))
)
`;

/** The window half ROUTER_TOOL asks the frame for: the infobar, the layer popup. */
class ROUTER_TEST_FRAME extends TEST_PCB_FRAME {
  readonly infobar: string[] = [];
  chosenLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;

  ShowInfoBarError(aErrorMsg: string): void {
    this.infobar.push(aErrorMsg);
  }

  SelectOneLayer(): Promise<PCB_LAYER_ID> {
    return Promise.resolve(this.chosenLayer);
  }
}

let h: TOOL_HARNESS<ROUTER_TEST_FRAME>;
let rt: ROUTER_TOOL;

const tracks = (aBoard: BOARD): PCB_TRACK[] =>
  aBoard.Tracks().filter((t) => t.Type() === KICAD_T.PCB_TRACE_T);

const vias = (aBoard: BOARD): PCB_TRACK[] =>
  aBoard.Tracks().filter((t) => t.Type() === KICAD_T.PCB_VIA_T);

/** A move and a click, as the dispatcher makes them. */
function click(aAt: Vec2): void {
  mouse(h, TA_MOUSE_MOTION, aAt);
  mouse(h, TA_MOUSE_CLICK, aAt);
}

/**
 * The toolbar's arming: the action's event without a position
 * (`ACTION_TOOLBAR::onToolEvent`'s `SetHasPosition( false )`), so MainLoop
 * does not prime a click where the pointer last was.
 */
function arm(aAction = PCB_ACTIONS.routeSingleTrack): void {
  const evt = aAction.MakeEvent();
  evt.SetHasPosition(false);
  h.mgr.ProcessEvent(evt);
}

function cancel(): void {
  h.mgr.ProcessEvent(new TOOL_EVENT(TC_COMMAND, TA_CANCEL_TOOL, AS_GLOBAL));
}

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (b) => new ROUTER_TEST_FRAME(b),
    () => [new ROUTER_TOOL()],
  );
  const bds = h.board.GetDesignSettings();
  bds.m_DRCEngine = new DRC_ENGINE(h.board, bds);
  bds.m_DRCEngine.InitEngine('(version 1)', 'r.kicad_dru');
  // PCB_EDIT_FRAME::SetActiveLayer's SetHighContrastLayer: the active layer on top.
  h.view.SetTopLayer(PCB_LAYER_ID.F_Cu);
  rt = h.mgr.GetTool(ROUTER_TOOL)!;
});

describe('ROUTER_TOOL::MainLoop (router_tool.cpp:1925)', () => {
  it('routeSingleTrack arms the tool and leaves the board alone until a click', () => {
    arm();

    expect(rt.IsToolActive()).toBe(true);
    expect(rt.RoutingInProgress()).toBe(false);
    expect(tracks(h.board)).toHaveLength(0);
  });

  it('Esc with nothing in flight pops the tool', () => {
    arm();
    cancel();

    expect(rt.IsToolActive()).toBe(false);
  });
});

describe('ROUTER_TOOL::performRouting (router_tool.cpp:1475)', () => {
  it('a click on a pad starts a route on its net, and the undo/redo block is up', () => {
    arm();
    click(mm(40, 60));

    expect(rt.RoutingInProgress()).toBe(true);
    expect(h.frame.UndoRedoBlocked()).toBe(true);
    expect(h.frame.infobar).toEqual([]);
  });

  it('a double-click fixes the route: tracks of the pad net on F.Cu, one undo step', () => {
    arm();
    click(mm(40, 60));
    mouse(h, TA_MOUSE_MOTION, mm(45, 60));
    mouse(h, TA_MOUSE_DBLCLICK, mm(45, 60));

    expect(rt.RoutingInProgress()).toBe(false);
    expect(h.frame.UndoRedoBlocked()).toBe(false);

    const placed = tracks(h.board);
    expect(placed.length).toBeGreaterThan(0);
    for (const t of placed) {
      expect(t.GetNetCode()).toBe(1);
      expect(LSET.Name(t.GetLayer())).toBe('F.Cu');
    }
    expect(placed.some((t) => t.GetStart().x === 40 * MM || t.GetEnd().x === 40 * MM)).toBe(true);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    // The tool stays armed for the next route.
    expect(rt.IsToolActive()).toBe(true);
  });

  it('a click onto the other pad of the net finishes the route there', () => {
    arm();
    click(mm(40, 60));
    click(mm(50, 60));

    expect(rt.RoutingInProgress()).toBe(false);
    const ends = tracks(h.board).flatMap((t) => [t.GetStart(), t.GetEnd()]);
    expect(ends).toContainEqual(mm(50, 60));
  });

  it('a click near the other pad snaps the end onto it (snapToItem on the end item)', () => {
    arm();
    click(mm(40, 60));
    click(mm(50.3, 60.2));

    expect(rt.RoutingInProgress()).toBe(false);
    const ends = tracks(h.board).flatMap((t) => [t.GetStart(), t.GetEnd()]);
    expect(ends).toContainEqual(mm(50, 60));
  });

  it('Esc mid-route drops the head but keeps what was fixed, and the tool stays', () => {
    arm();
    click(mm(40, 60));
    mouse(h, TA_MOUSE_MOTION, mm(44, 60));
    click(mm(44, 60));
    // A fix nails the segment in the router's world; the board gets it when
    // the route ends (`CommitRouting` after the loop).
    expect(tracks(h.board)).toHaveLength(0);
    mouse(h, TA_MOUSE_MOTION, mm(44, 66));
    cancel();

    expect(rt.RoutingInProgress()).toBe(false);
    expect(rt.IsToolActive()).toBe(true);
    const placed = tracks(h.board);
    expect(placed).toHaveLength(1);
    expect([placed[0]!.GetStart(), placed[0]!.GetEnd()]).toEqual([mm(40, 60), mm(44, 60)]);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('the start net is highlighted while routing, and the highlight is dropped after', () => {
    const rs = h.view.GetPainter()!.GetSettings();
    arm();
    click(mm(40, 60));

    expect(rs.IsHighlightEnabled()).toBe(true);
    expect([...rs.GetHighlightNetCodes()]).toEqual([1]);

    mouse(h, TA_MOUSE_DBLCLICK, mm(44, 60));

    expect(rs.IsHighlightEnabled()).toBe(false);
  });

  it('a start on a non-copper layer is refused: "Tracks on Copper layers only."', () => {
    h.view.ClearTopLayers();
    h.view.SetTopLayer(PCB_LAYER_ID.F_SilkS);
    arm();
    click(mm(20, 20));

    expect(h.frame.infobar).toEqual(['Tracks on Copper layers only.']);
    expect(rt.RoutingInProgress()).toBe(false);
  });

  it('the board minimum track width is read live from BOARD_DESIGN_SETTINGS', () => {
    h.board.GetDesignSettings().m_TrackMinWidth = 0.6 * MM;
    arm();
    click(mm(40, 60));
    mouse(h, TA_MOUSE_MOTION, mm(44, 60));
    mouse(h, TA_MOUSE_DBLCLICK, mm(44, 60));

    expect(tracks(h.board).map((t) => t.GetWidth())).toEqual([0.6 * MM]);
  });

  it('the track width is the toolbar choice in BOARD_DESIGN_SETTINGS', () => {
    const bds = h.board.GetDesignSettings();
    bds.m_TrackWidthList = [0, 0.4 * MM];
    bds.SetTrackWidthIndex(1);
    arm();
    click(mm(40, 60));
    mouse(h, TA_MOUSE_MOTION, mm(44, 60));
    mouse(h, TA_MOUSE_DBLCLICK, mm(44, 60));

    expect(tracks(h.board).map((t) => t.GetWidth())).toEqual([0.4 * MM]);
  });

  it('a route from empty space is a no-net track', () => {
    arm();
    click(mm(20, 20));
    mouse(h, TA_MOUSE_MOTION, mm(25, 20));
    click(mm(25, 20));
    mouse(h, TA_MOUSE_DBLCLICK, mm(25, 24));

    const placed = tracks(h.board);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.every((t) => t.GetNetCode() === 0)).toBe(true);
    expect(placed.flatMap((t) => [t.GetStart(), t.GetEnd()])).toContainEqual(mm(20, 20));
  });

  it('a no-net route fixed onto a pad and finished there commits (simplifyNewLine re-adds its line)', () => {
    arm();
    click(mm(0, 0));
    click(mm(40, 60));
    mouse(h, TA_MOUSE_MOTION, mm(45, 60));
    mouse(h, TA_MOUSE_DBLCLICK, mm(45, 60));

    expect(rt.RoutingInProgress()).toBe(false);
    expect(tracks(h.board).flatMap((t) => [t.GetStart(), t.GetEnd()])).toContainEqual(mm(0, 0));
  });

  it('the message panel shows the route: net, netclass, corner style, mode, width', () => {
    arm();
    click(mm(40, 60));

    const items = h.frame.GetMsgPanelItems();
    expect(items[0]!.GetUpperText()).toBe('Routing Track: N1');
    expect(items[0]!.GetLowerText()).toBe('Resolved Netclass: Default');
    expect(items[1]!.GetUpperText()).toBe('Corner Style');
    expect(items[1]!.GetLowerText()).toBe('45-degree');
    expect(items[2]!.GetLowerText()).toBe('Walk around');
    expect(items[3]!.GetUpperText()).toMatch(/^Track Width: /);
  });
});

describe('ROUTER_TOOL::onViaCommand / handleLayerSwitch (router_tool.cpp:1031-1378)', () => {
  it('V mid-route puts a via on the head; the fix places it and moves the route to B.Cu', () => {
    arm();
    click(mm(40, 60));
    mouse(h, TA_MOUSE_MOTION, mm(44, 60));
    h.mgr.RunAction(ACT_PlaceThroughVia);
    click(mm(44, 60));

    expect(h.frame.GetActiveLayer()).toBe(PCB_LAYER_ID.B_Cu);

    mouse(h, TA_MOUSE_MOTION, mm(44, 66));
    mouse(h, TA_MOUSE_DBLCLICK, mm(44, 66));

    expect(vias(h.board)).toHaveLength(1);
    expect(vias(h.board)[0]!.GetPosition()).toEqual(mm(44, 60));
    expect(tracks(h.board).some((t) => t.GetLayer() === PCB_LAYER_ID.B_Cu)).toBe(true);
    // finishInteractive: `SetActiveLayer( m_originalActiveLayer )`.
    expect(h.frame.GetActiveLayer()).toBe(PCB_LAYER_ID.F_Cu);
  });

  it('V again takes the via off the head', () => {
    arm();
    click(mm(40, 60));
    mouse(h, TA_MOUSE_MOTION, mm(44, 60));
    h.mgr.RunAction(ACT_PlaceThroughVia);
    h.mgr.RunAction(ACT_PlaceThroughVia);
    click(mm(44, 60));
    mouse(h, TA_MOUSE_DBLCLICK, mm(44, 64));

    expect(vias(h.board)).toHaveLength(0);
    expect(tracks(h.board).every((t) => t.GetLayer() === PCB_LAYER_ID.F_Cu)).toBe(true);
  });

  it('layerNext mid-route switches the head to the next copper layer without a via', () => {
    arm();
    click(mm(40, 60));
    mouse(h, TA_MOUSE_MOTION, mm(44, 60));
    h.mgr.RunAction(PCB_ACTIONS.layerNext);
    click(mm(44, 60));

    expect(h.frame.GetActiveLayer()).toBe(PCB_LAYER_ID.B_Cu);
  });
});

describe('ROUTER_TOOL settings commands', () => {
  it('CycleRouterMode walks Highlight -> Shove -> Walk around', () => {
    arm();
    expect(rt.GetRouterMode()).toBe(PnsMode.RM_Walkaround);
    h.mgr.RunAction(PCB_ACTIONS.cycleRouterMode);
    expect(rt.GetRouterMode()).toBe(PnsMode.RM_MarkObstacles);
    h.mgr.RunAction(PCB_ACTIONS.cycleRouterMode);
    expect(rt.GetRouterMode()).toBe(PnsMode.RM_Shove);
  });

  it('routerShoveMode sets the mode on the frame-owned ROUTING_SETTINGS', () => {
    arm();
    h.mgr.RunAction(PCB_ACTIONS.routerShoveMode);
    expect(h.frame.GetPcbNewSettings().m_PnsSettings!.routingMode).toBe(PnsMode.RM_Shove);
  });

  it('the corner-mode switch steps 45 -> rounded 45 mid-route', () => {
    arm();
    click(mm(40, 60));
    h.mgr.RunAction(ACT_SwitchCornerModeToNext);
    expect(h.frame.GetPcbNewSettings().m_PnsSettings!.cornerMode).toBe(CornerMode.ROUNDED_45);
  });

  it('selectionClear runs when the tool arms (MainLoop deselects all)', () => {
    h.sel.AddItemToSel(h.board.Footprints()[0]!, true);
    arm();
    expect(h.sel.GetSelection().Size()).toBe(0);
    void ACTIONS;
  });
});

describe('SIZES_SETTINGS layer pairs (pns_sizes_settings.cpp:30-61)', () => {
  it('AddLayerPair records both directions; GetLayerTop/Bottom read the lowest key', () => {
    const s = copySizes(DEFAULT_ROUTER_SIZES);
    sizesAddLayerPair(s, 3, 1);

    expect(sizesPairedLayer(s, 1)).toBe(3);
    expect(sizesPairedLayer(s, 3)).toBe(1);
    expect(sizesPairedLayer(s, 2)).toBeUndefined();
    expect(sizesGetLayerTop(s)).toBe(1);
    expect(sizesGetLayerBottom(s)).toBe(3);
    expect([s.layerTop, s.layerBottom]).toEqual([1, 3]);
  });

  it('a second pair keeps the first; the lowest key wins Top/Bottom', () => {
    const s = copySizes(DEFAULT_ROUTER_SIZES);
    sizesAddLayerPair(s, 2, 3);
    sizesAddLayerPair(s, 0, 1);

    expect(sizesPairedLayer(s, 2)).toBe(3);
    expect(sizesGetLayerTop(s)).toBe(0);
    expect(sizesGetLayerBottom(s)).toBe(1);
  });

  it('no pairs is F_Cu over B_Cu, as board layer ids', () => {
    const s = copySizes(DEFAULT_ROUTER_SIZES);
    sizesAddLayerPair(s, 0, 1);
    sizesClearLayerPairs(s);

    expect(sizesPairedLayer(s, 0)).toBeUndefined();
    expect(sizesGetLayerTop(s)).toBe(PCB_LAYER_ID.F_Cu);
    expect(sizesGetLayerBottom(s)).toBe(PCB_LAYER_ID.B_Cu);
  });

  it('a copy does not share the map (SIZES_SETTINGS is copied by value)', () => {
    const a = copySizes(DEFAULT_ROUTER_SIZES);
    sizesAddLayerPair(a, 0, 1);
    const b = copySizes(a);
    sizesClearLayerPairs(b);

    expect(sizesPairedLayer(a, 0)).toBe(1);
  });
});
