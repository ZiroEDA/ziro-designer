// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_SELECTION_TOOL` (pcbnew/tools/pcb_selection_tool.cpp) on a live BOARD,
 * driven the way TOOL_DISPATCHER drives it: mouse TOOL_EVENTs into the tool
 * manager, the tool's `Main` loop answering them.
 *
 * KiCad's qa has no suite for this tool, so every expectation below is read off
 * the C++ it names (the line numbers are 10.0.6's), not off our implementation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import {
  AS_GLOBAL,
  BUT_LEFT,
  BUT_RIGHT,
  EVENTS,
  MD_ALT,
  MD_CTRL,
  MD_SHIFT,
  TA_CHOICE_MENU_CHOICE,
  TA_CHOICE_MENU_CLOSED,
  TA_CHOICE_MENU_UPDATE,
  TA_MOUSE_CLICK,
  TA_MOUSE_DBLCLICK,
  TA_MOUSE_DOWN,
  TA_MOUSE_DRAG,
  TA_MOUSE_UP,
  TC_COMMAND,
  TC_MOUSE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type {
  TOOL_MANAGER,
  TOOL_MANAGER_VIEW_CONTROLS,
} from '@ziroeda/common/tool/tool_manager.js';
import { wxMenuEvent, wxMenuEventType } from '@ziroeda/common/wx/menu.js';
import { VC_SETTINGS } from '@ziroeda/common/view/view_controls.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { GENERAL_COLLECTOR } from '@ziroeda/pcbnew/collectors.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_PAINTER } from '@ziroeda/pcbnew/pcb_painter.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { PCB_VIEW } from '@ziroeda/pcbnew/pcb_view.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_POINT_EDITOR } from '@ziroeda/pcbnew/tools/pcb_point_editor.js';
import {
  connectedItemFilter,
  PCB_SELECTION_TOOL,
} from '@ziroeda/pcbnew/tools/pcb_selection_tool.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import { wxMouseEventFromDom } from '@ziroeda/common/wx/dom_events.js';
import { wxSetMouseButtons } from '@ziroeda/common/wx/wx_event.js';
import { makeGatedDispatcher } from '@ziroeda/pcbnew/tools/window_action_bridge.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { MOUSE_DRAG_ACTION } from '@ziroeda/common/mouse_drag_action.js';

const MM = 1_000_000;

/** A GAL with a screen: the VIEW's viewport and pixel size come from it. */
class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Two tracks on F.Cu meeting at (20, 10), a third branching off there (a
 * junction), a via at (40, 10) and a track beyond it on B.Cu; a footprint with
 * one SMD pad at (60, 30); a group of two lines; a locked track far away.
 */
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (9 "F.Adhes" user "F.Adhesive")
    (5 "F.SilkS" user "F.Silkscreen")
    (25 "Edge.Cuts" user)
  )
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)
    (property "Reference" "R1" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "10k" (at 0 3 0) (layer "F.Fab") (hide yes) (uuid "${U(3)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (fp_rect (start -4 -2) (end 4 2) (stroke (width 0.12) (type solid)) (fill no) (layer "F.SilkS") (uuid "${U(4)}"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 2 "N2") (uuid "${U(5)}"))
  )
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(10)}"))
  (gr_line (start 10 52) (end 20 52) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(11)}"))
  (group "" (uuid "${U(12)}") (members "${U(10)}" "${U(11)}"))
  (gr_line (start 10 60) (end 20 60) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(13)}"))
  (gr_line (start 10 60) (end 20 60) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(14)}"))
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(20)}"))
  (segment (start 20 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(21)}"))
  (segment (start 20 10) (end 20 20) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(22)}"))
  (segment (start 30 10) (end 40 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(23)}"))
  (via (at 40 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U(24)}"))
  (segment (start 40 10) (end 50 10) (width 0.25) (layer "B.Cu") (net 1) (uuid "${U(25)}"))
  (segment (start 100 100) (end 110 100) (width 0.25) (layer "F.Cu") (locked yes) (net 2) (uuid "${U(26)}"))
)
`;

interface Harness {
  board: BOARD;
  frame: TEST_PCB_FRAME;
  mgr: TOOL_MANAGER;
  tool: PCB_SELECTION_TOOL;
  view: PCB_VIEW;
  /** The menus the tool asked the frame to show, each with its close. */
  menus: { menu: ACTION_MENU; close: () => void }[];
  /** Where the mouse is, in board IU. */
  mouse: Vec2;
}

function byUuid(aBoard: BOARD, aN: number): BOARD_ITEM {
  let found: BOARD_ITEM | null = null;

  aBoard.RunOnChildren((aItem: BOARD_ITEM) => {
    if (aItem.m_Uuid === U(aN)) found = aItem;
  }, RECURSE_MODE.RECURSE);

  if (!found) throw new Error(`no item ${U(aN)}`);

  return found;
}

function harness(): Harness {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));

  const board = ParseBoard(BOARD_TEXT, '/p/x.kicad_pcb');
  board.BuildConnectivity();
  const frame = new TEST_PCB_FRAME(board);
  frame.SetScreen(new PCB_SCREEN({ x: 297 * MM, y: 210 * MM }));
  frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);

  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  gal.ResizeScreen(1000, 1000);
  const view = new PCB_VIEW();
  view.SetGAL(gal);
  view.SetPainter(new PCB_PAINTER(gal, FRAME_T.FRAME_PCB_EDITOR));
  // A 1000 px screen over 150 mm of board: 0.15 mm a pixel, the slop the
  // collectors guide works in.
  view.SetScale(1);
  view.SetScale(view.GetScale() * (view.ToWorld(1000) / (150 * MM)));
  view.SetCenter({ x: 60 * MM, y: 60 * MM });

  board.RunOnChildren((aItem: BOARD_ITEM) => view.Add(aItem), RECURSE_MODE.NO_RECURSE);

  for (const fp of board.Footprints())
    fp.RunOnChildren((aItem: BOARD_ITEM) => view.Add(aItem), RECURSE_MODE.NO_RECURSE);

  const h: Partial<Harness> = { board, frame, view, menus: [], mouse: { x: 0, y: 0 } };

  frame.SetCanvas({
    // Read lazily: the controls are built just below.
    GetViewControls: () => controls,
    GetView: () => view,
    GetGAL: () => gal,
    SetCurrentCursor: () => {},
    ForceRefresh: () => {},
    Refresh: () => {},
    GetClientSize: () => ({ x: 1000, y: 1000 }),
  } as unknown as PCB_DRAW_PANEL_GAL);

  // A popup that remembers the menu and stays open until the test answers it.
  frame.SetPopupMenuPresenter((aMenu: ACTION_MENU, aOnClose: () => void) => {
    h.menus!.push({ menu: aMenu, close: aOnClose });
  });

  const controls = {
    GetMousePosition: () => h.mouse!,
    GetCursorPosition: () => h.mouse!,
    SetAutoPan: () => {},
    ShowCursor: () => {},
    CaptureCursor: () => {},
    SetCursorPosition: () => {},
    ForceCursorPosition: () => {},
    WarpMouseCursor: () => {},
    GetSettings: () => new VC_SETTINGS(),
    ApplySettings: () => {},
  } as unknown as TOOL_MANAGER_VIEW_CONTROLS;

  const mgr = frame.GetToolManager()!;
  mgr.SetEnvironment(board, view, controls, frame.settings, frame);

  const tool = new PCB_SELECTION_TOOL();
  mgr.RegisterTool(tool);
  mgr.RegisterTool(new PCB_POINT_EDITOR());
  mgr.InitTools();
  mgr.InvokeTool('common.InteractiveSelection');

  return Object.assign(h, { mgr, tool }) as Harness;
}

function mouse(h: Harness, aAction: number, aAt: Vec2, aMods = 0, aButton = BUT_LEFT): void {
  h.mouse = aAt;
  const evt = new TOOL_EVENT(TC_MOUSE, aAction, aButton | aMods, AS_GLOBAL);
  evt.SetMousePosition(aAt);
  h.mgr.ProcessEvent(evt);
}

/** A press and its release without moving: TA_MOUSE_DOWN then TA_MOUSE_CLICK. */
function click(h: Harness, aAt: Vec2, aMods = 0): void {
  mouse(h, TA_MOUSE_DOWN, aAt, aMods);
  mouse(h, TA_MOUSE_CLICK, aAt, aMods);
}

/** A left drag from `aFrom` to `aTo` and the release. */
function drag(h: Harness, aFrom: Vec2, aTo: Vec2, aMods = 0): void {
  mouse(h, TA_MOUSE_DOWN, aFrom, aMods);

  // A real pointer sends many motions; `SelectRectArea` decides the mode from
  // the previous one (:1279), so the last position is sent twice.
  for (const at of [aFrom, aTo, aTo]) {
    h.mouse = at;
    const evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_DRAG, BUT_LEFT | aMods, AS_GLOBAL);
    evt.SetMousePosition(at);
    evt.setMouseDragOrigin(aFrom);
    h.mgr.ProcessEvent(evt);
  }

  mouse(h, TA_MOUSE_UP, aTo, aMods);
}

const mm = (x: number, y: number): Vec2 => ({ x: x * MM, y: y * MM });

function selectedUuids(h: Harness): string[] {
  return h.tool
    .GetSelection()
    .GetItems()
    .map((i) => i.m_Uuid)
    .sort();
}

let h: Harness;

beforeEach(() => {
  h = harness();
});

afterEach(() => SetPgm(null));

describe('PCB_SELECTION_TOOL::Main, a left click (pcb_selection_tool.cpp:315-358)', () => {
  it('selects the track under the cursor', () => {
    click(h, mm(15, 10));
    expect(selectedUuids(h)).toEqual([U(20)]);
    expect(byUuid(h.board, 20).IsSelected()).toBe(true);
  });

  it('clears the selection on a click over nothing', () => {
    click(h, mm(15, 10));
    click(h, mm(80, 80));
    expect(selectedUuids(h)).toEqual([]);
    expect(byUuid(h.board, 20).IsSelected()).toBe(false);
  });

  it('replaces the selection without a modifier, adds with Shift', () => {
    click(h, mm(15, 10));
    click(h, mm(35, 10));
    expect(selectedUuids(h)).toEqual([U(23)]);
    click(h, mm(15, 10), MD_SHIFT);
    expect(selectedUuids(h)).toEqual([U(20), U(23)]);
  });

  it('Ctrl+Shift removes an item from the selection (m_subtractive)', () => {
    click(h, mm(15, 10));
    click(h, mm(35, 10), MD_SHIFT);
    click(h, mm(15, 10), MD_SHIFT | MD_CTRL);
    expect(selectedUuids(h)).toEqual([U(23)]);
  });

  it('Ctrl toggles (m_exclusive_or) while Ctrl-click is not the net highlight', () => {
    click(h, mm(15, 10));
    click(h, mm(15, 10), MD_CTRL);
    expect(selectedUuids(h)).toEqual([]);
    click(h, mm(15, 10), MD_CTRL);
    expect(selectedUuids(h)).toEqual([U(20)]);
  });

  it('a click without a mouse-down first does nothing: the disambiguation timer arms on the press', () => {
    mouse(h, TA_MOUSE_CLICK, mm(15, 10));
    expect(selectedUuids(h)).toEqual([]);
  });

  it('selects the pad, not its footprint, when the pad is under the cursor', () => {
    click(h, mm(60, 30));
    expect(selectedUuids(h)).toEqual([U(5)]);
  });

  it('prefers the pad to its footprint by size, before the active-layer rule (:4462-4541)', () => {
    // With F.SilkS in front only the footprint (its silk outline) is on the
    // active layer. Were the much smaller pad not preferred first, the
    // active-layer rule (:4547-4565) would keep the footprint instead.
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_SilkS);
    click(h, mm(60, 30));
    expect(selectedUuids(h)).toEqual([U(5)]);
  });

  it('selects the footprint through its body away from the pad', () => {
    click(h, mm(63, 31));
    expect(selectedUuids(h)).toEqual([U(1)]);
  });

  it('a click on a group member selects the group', () => {
    click(h, mm(15, 50));
    expect(selectedUuids(h)).toEqual([U(12)]);
  });

  it('does not select a locked track while the filter excludes locked items', () => {
    click(h, mm(105, 100));
    expect(selectedUuids(h)).toEqual([]);
    h.tool.GetFilter().lockedItems = true;
    click(h, mm(105, 100));
    expect(selectedUuids(h)).toEqual([U(26)]);
  });

  it('does not select a type the Selection Filter excludes', () => {
    h.tool.GetFilter().tracks = false;
    click(h, mm(15, 10));
    expect(selectedUuids(h)).toEqual([]);
  });
});

describe('PCB_SELECTION_TOOL::SelectRectArea / SelectMultiple (:1264-1597)', () => {
  it('left to right selects only what is inside the box', () => {
    drag(h, mm(9, 9), mm(31, 11));
    expect(selectedUuids(h)).toEqual([U(20), U(21)]);
  });

  it('right to left selects what the box touches', () => {
    drag(h, mm(31, 11), mm(25, 9));
    expect(selectedUuids(h)).toEqual([U(21), U(23)]);
  });

  it('a box around a whole group selects the group', () => {
    drag(h, mm(9, 49), mm(21, 53));
    expect(selectedUuids(h)).toEqual([U(12)]);
  });

  it('the selection is ordered by rows, then columns (:1557-1569)', () => {
    drag(h, mm(9, 9), mm(65, 35));
    const ys = h.tool
      .GetSelection()
      .GetItems()
      .map((i) => i.GetPosition().y / MM);
    // every track and the via sit on y = 10; the footprint's position is y = 30
    expect(ys[0]).toBe(10);
    expect(ys[ys.length - 1]).toBe(30);
  });
});

describe('PCB_SELECTION_TOOL::SelectPolyArea, the lasso (:1366-1462)', () => {
  /** A lasso through `aPts`: it starts on the first drag, appends every later one, ends on a double click. */
  function lasso(aPts: Vec2[]): void {
    h.mgr.RunAction(ACTIONS.selectSetLasso);
    mouse(h, TA_MOUSE_DOWN, aPts[0]!);

    for (const at of [aPts[0]!, ...aPts]) {
      h.mouse = at;
      const evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_DRAG, BUT_LEFT, AS_GLOBAL);
      evt.SetMousePosition(at);
      evt.setMouseDragOrigin(aPts[0]!);
      h.mgr.ProcessEvent(evt);
    }

    mouse(h, TA_MOUSE_UP, aPts[aPts.length - 1]!);
    mouse(h, TA_MOUSE_DBLCLICK, aPts[aPts.length - 1]!);
  }

  it('clockwise on screen selects what it encloses', () => {
    lasso([mm(9, 9), mm(31, 9), mm(31, 11), mm(9, 11)]);
    expect(selectedUuids(h)).toEqual([U(20), U(21)]);
  });

  it('counter-clockwise selects what it touches', () => {
    lasso([mm(31, 9), mm(25, 9), mm(25, 11), mm(31, 11)]);
    expect(selectedUuids(h)).toEqual([U(21), U(23)]);
  });
});

describe('the filters around a pick', () => {
  it('a click the Selection Filter rejects flashes the rejecting boxes (:819-832)', () => {
    const flashed: string[] = [];
    h.frame.m_selectionFilterPanel = {
      SetCheckboxesFromFilter: () => {},
      OnFlashEvent: (o) => {
        for (const [k, v] of Object.entries(o)) if (v === true) flashed.push(k);
      },
    };
    h.tool.GetFilter().tracks = false;
    click(h, mm(15, 10));
    return Promise.resolve().then(() => expect(flashed).toEqual(['tracks']));
  });

  it('FilterCollectorForFreePads promotes a pad to its footprint unless free pads are allowed', () => {
    const pad = byUuid(h.board, 5);
    const collector = new GENERAL_COLLECTOR();
    collector.Append(pad);
    h.tool.FilterCollectorForFreePads(collector);
    expect(collector.At(0)?.m_Uuid).toBe(U(1));
    h.frame.settings.m_AllowFreePads = true;
    const again = new GENERAL_COLLECTOR();
    again.Append(pad);
    h.tool.FilterCollectorForFreePads(again);
    expect(again.At(0)?.m_Uuid).toBe(U(5));
  });

  it('RequestSelection runs the client filter over the selection (:676-752)', () => {
    click(h, mm(60, 30));
    const got = h.tool.RequestSelection((_w, aCollector, aTool) =>
      aTool.FilterCollectorForFreePads(aCollector),
    );
    expect(got.GetItems().map((i) => i.m_Uuid)).toEqual([U(1)]);
  });
});

describe('PCB_SELECTION_TOOL::selectNet (:2711-2752)', () => {
  it('selects every track and via on the nets of the selection', () => {
    click(h, mm(15, 10));
    h.mgr.RunAction(PCB_ACTIONS.selectNet);
    expect(selectedUuids(h)).toEqual([U(20), U(21), U(22), U(23), U(24), U(25)]);
  });
});

describe('PCB_SELECTION_TOOL::expandConnection (:2029-2110)', () => {
  it('stops at the junction first, then at the pads, then takes the net', () => {
    click(h, mm(15, 10));
    h.mgr.RunAction(PCB_ACTIONS.selectConnection);
    // STOP_AT_JUNCTION: the junction at (20, 10) has three tracks, so only the
    // start track is selected and the next stop condition is tried - STOP_AT_PAD
    // walks through the junction and the via to the end of the net.
    expect(selectedUuids(h)).toEqual([U(20), U(21), U(22), U(23), U(24), U(25)]);
  });

  it('connectedItemFilter keeps one connected item per net', () => {
    const tracks = [20, 21, 26].map((n) => byUuid(h.board, n));
    const collector = { list: [...tracks] };
    const fake = {
      GetCount: () => collector.list.length,
      At: (i: number) => collector.list[i]!,
      Remove: (i: number) => collector.list.splice(i, 1),
    };
    connectedItemFilter(mm(0, 0), fake as never, h.tool);
    // Walked from the back (:1701): 26 (N2) and 21 (N1) are kept, 20 repeats N1.
    expect(collector.list.map((i) => i.m_Uuid)).toEqual([U(21), U(26)]);
  });
});

describe('PCB_SELECTION_TOOL, the rest of Main', () => {
  it('a double click on a group enters it (:381-402)', () => {
    click(h, mm(15, 50));
    mouse(h, TA_MOUSE_DBLCLICK, mm(15, 50));
    expect(h.tool.GetEnteredGroup()?.m_Uuid).toBe(U(12));
    // EnterGroup selects the members
    expect(selectedUuids(h)).toEqual([U(10), U(11)]);
  });

  it('a click outside an entered group leaves it (selectPoint :796-797)', () => {
    click(h, mm(15, 50));
    mouse(h, TA_MOUSE_DBLCLICK, mm(15, 50));
    click(h, mm(15, 10));
    expect(h.tool.GetEnteredGroup()).toBeNull();
  });

  it('a right click on an empty selection picks first, then shows the menu (:359-380)', () => {
    mouse(h, TA_MOUSE_CLICK, mm(15, 10), 0, BUT_RIGHT);
    expect(selectedUuids(h)).toEqual([U(20)]);
    expect(h.tool.GetSelection().IsHover()).toBe(true);
    expect(h.menus.length).toBe(1);
  });

  it('a right click on a footprint field keeps the selected footprint (the whole rule is `m_selection.Empty()`)', () => {
    click(h, mm(63, 31));
    mouse(h, TA_MOUSE_CLICK, mm(60, 27), 0, BUT_RIGHT); // R1's reference text
    expect(selectedUuids(h)).toEqual([U(1)]);
  });

  it('a right click with a selection does not re-pick', () => {
    click(h, mm(15, 10));
    mouse(h, TA_MOUSE_CLICK, mm(35, 10), 0, BUT_RIGHT);
    expect(selectedUuids(h)).toEqual([U(20)]);
  });

  it('Escape clears the selection (IsCancel, :554-562)', () => {
    click(h, mm(15, 10));
    h.mgr.ProcessEvent(new TOOL_EVENT(TC_COMMAND, 0x2000 /* TA_CANCEL_TOOL */, 27, AS_GLOBAL));
    expect(selectedUuids(h)).toEqual([]);
  });

  it('selectionClear, selectItem and unselectItem are the tool actions', () => {
    const t = byUuid(h.board, 23);
    h.mgr.RunAction(ACTIONS.selectItem, t);
    expect(selectedUuids(h)).toEqual([U(23)]);
    h.mgr.RunAction(ACTIONS.unselectItem, t);
    expect(selectedUuids(h)).toEqual([]);
    h.mgr.RunAction(ACTIONS.selectItem, t);
    h.mgr.RunAction(ACTIONS.selectionClear);
    expect(selectedUuids(h)).toEqual([]);
  });

  it('SelectAll takes every selectable item that passes the filter, groups whole', () => {
    h.mgr.RunAction(ACTIONS.selectAll);
    const got = selectedUuids(h);
    expect(got).toContain(U(12));
    expect(got).not.toContain(U(10));
    expect(got).not.toContain(U(26)); // locked, and the filter excludes locked items
    expect(got).toContain(U(1));
    expect(got).not.toContain(U(5)); // the footprint's pad goes with it
  });
});

describe('the disambiguation menu (SELECTION_TOOL::doSelectionMenu, selection_tool.cpp)', () => {
  /** What the popup does when a row is pointed at, or chosen and closed. */
  const point = (aMenu: ACTION_MENU, aId: number): void =>
    aMenu.OnMenuEvent(new wxMenuEvent(wxMenuEventType.wxEVT_MENU_HIGHLIGHT, aId, aMenu));
  const choose = (aEntry: { menu: ACTION_MENU; close: () => void }, aId: number): void => {
    aEntry.menu.OnMenuEvent(
      new wxMenuEvent(wxMenuEventType.wxEVT_COMMAND_MENU_SELECTED, aId, aEntry.menu),
    );
    aEntry.close();
  };

  beforeEach(() => {
    // GuessSelectionCandidates prefers single-layer silk items when a silk
    // layer is active (:4396-4407); two identical lines tie on everything after.
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_SilkS);
  });

  it('asks when two items tie, and selects nothing until a row is chosen', () => {
    click(h, mm(15, 60));
    expect(h.menus.length).toBe(1);
    expect(selectedUuids(h)).toEqual([]);
    // two rows, a separator, Select All
    expect(h.menus[0]!.menu.GetMenuItemCount()).toBe(4);
  });

  it('pointing at a row brightens that item', () => {
    click(h, mm(15, 60));
    point(h.menus[0]!.menu, 1);
    const lit = [13, 14].filter((n) => byUuid(h.board, n).IsBrightened());
    expect(lit.length).toBe(1);
  });

  it('choosing a row selects that item alone, and un-brightens it', () => {
    click(h, mm(15, 60));
    choose(h.menus[0]!, 2);
    expect(selectedUuids(h).length).toBe(1);
    expect([U(13), U(14)]).toContain(selectedUuids(h)[0]);
    expect(byUuid(h.board, 13).IsBrightened() || byUuid(h.board, 14).IsBrightened()).toBe(false);
  });

  it('Select All selects both', () => {
    click(h, mm(15, 60));
    choose(h.menus[0]!, 3);
    expect(selectedUuids(h)).toEqual([U(13), U(14)]);
  });

  it('dismissing the menu selects nothing', () => {
    click(h, mm(15, 60));
    h.menus[0]!.close();
    expect(selectedUuids(h)).toEqual([]);
  });

  it('Alt skips the heuristics, so even the pad and its footprint are asked about', () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    click(h, mm(60, 30), MD_ALT);
    expect(h.menus.length).toBe(1);
  });
});

void KICAD_T;
void TA_CHOICE_MENU_CHOICE;
void TA_CHOICE_MENU_CLOSED;
void TA_CHOICE_MENU_UPDATE;
void EVENTS;

describe('the frame dispatcher, when a window gesture takes the release (#636 stage 3)', () => {
  it('a press after a window-owned drag is a press again, so the next click selects', () => {
    const h = harness();
    // WX_VIEW_CONTROLS answers screen pixels for GetMousePosition( false ).
    const vc = h.mgr.GetViewControls() as unknown as { GetMousePosition(w?: boolean): Vec2 };
    vc.GetMousePosition = (aWorld = true) => (aWorld ? h.mouse : h.view.ToScreen(h.mouse));
    // a move the window owns (the router's inline drag through
    // WINDOW_ACTION_BRIDGE is one): PCB_ACTIONS::move answered by a stand-in for
    // EDIT_TOOL that hands the pointer to the window until the button comes up
    let toWindow = false;
    const moves: string[] = [];
    class WINDOW_MOVE extends TOOL_INTERACTIVE {
      constructor() {
        super('test.WindowMove');
      }
      override Reset(): void {}
      protected override setTransitions(): void {
        this.Go(
          SYNC_HANDLER((aEvent: TOOL_EVENT): number => {
            moves.push(aEvent.getCommandStr());
            toWindow = true;
            return 0;
          }),
          PCB_ACTIONS.move.MakeEvent(),
        );
      }
    }
    h.mgr.RegisterTool(new WINDOW_MOVE());
    h.mgr.InitTools();
    // Preferences > Mouse and Touchpad's default left drag: drag the selected items
    h.frame.CommonSettingsChanged(0, {
      drag_left: MOUSE_DRAG_ACTION.DRAG_SELECTED,
      warp_mouse_on_move: true,
      immediate_actions: true,
    });
    const disp = makeGatedDispatcher(new TOOL_DISPATCHER(h.mgr), () => toWindow);
    const target = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    } as unknown as HTMLElement;
    const send = (aKind: 'down' | 'up' | 'move', aAt: Vec2, aButtons: number): void => {
      const px = h.view.ToScreen(aAt);
      h.mouse = aAt;
      wxSetMouseButtons(aButtons);
      const dom = {
        button: 0,
        buttons: aButtons,
        detail: 1,
        clientX: px.x,
        clientY: px.y,
        pageX: px.x,
        pageY: px.y,
        timeStamp: 0,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      } as unknown as PointerEvent;
      disp.DispatchWxEvent(wxMouseEventFromDom(target, dom, aKind));
    };

    // select R1, then press on it and drag: the selection tool's drag branch
    // hands the move to the window, which then owns the pointer
    const fp = mm(63, 31);
    send('move', fp, 0);
    send('down', fp, 1);
    send('up', fp, 0);
    expect(selectedUuids(h)).toEqual([U(1)]);
    send('down', fp, 1);
    send('move', mm(66, 31), 1);
    expect(moves).toEqual(['pcbnew.InteractiveMove.move']);
    send('move', mm(70, 31), 1);
    send('up', mm(70, 31), 0);
    // the window's pointer-up ends its move
    toWindow = false;

    // a plain click on the track - with no motion first, so nothing but the
    // reset can tell the dispatcher the button was ever released - selects it
    const tr = mm(15, 10);
    send('down', tr, 1);
    send('up', tr, 0);
    expect(selectedUuids(h)).toEqual([U(20)]);
  });
});

describe('TOOLS_HOLDER::CommonSettingsChanged (tools_holder.cpp:159)', () => {
  it("takes the left-drag action from Pgm's COMMON_SETTINGS when the frame hands none over", () => {
    const h = harness();
    Pgm().SetCommonSettings({
      m_Input: {
        drag_left: MOUSE_DRAG_ACTION.DRAG_SELECTED,
        warp_mouse_on_move: false,
        immediate_actions: true,
      },
    } as never);
    expect(h.frame.GetDragAction()).toBe(MOUSE_DRAG_ACTION.SELECT);
    h.frame.CommonSettingsChanged();
    expect(h.frame.GetDragAction()).toBe(MOUSE_DRAG_ACTION.DRAG_SELECTED);
  });
});
