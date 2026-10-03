// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A board editor without the window, for driving pcbnew's tools through the
 * TOOL_MANAGER on a live BOARD: the parsed board on a PCB_VIEW over a stub
 * GAL, the view controls answering from a settable mouse, PCB_SELECTION_TOOL
 * invoked as `PCB_EDIT_FRAME::setupTools` leaves it, and the TOOL_EVENTs the
 * dispatcher makes.
 */
import type { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import type { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import type { TOOL_BASE } from '@ziroeda/common/tool/tool_base.js';
import { AS_GLOBAL, BUT_LEFT, TC_MOUSE, TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type {
  TOOL_MANAGER,
  TOOL_MANAGER_VIEW_CONTROLS,
} from '@ziroeda/common/tool/tool_manager.js';
import { wxMenuEvent, wxMenuEventType } from '@ziroeda/common/wx/menu.js';
import { VC_SETTINGS } from '@ziroeda/common/view/view_controls.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_PAINTER } from '@ziroeda/pcbnew/pcb_painter.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { PCB_VIEW } from '@ziroeda/pcbnew/pcb_view.js';
import { PCB_SELECTION_TOOL } from '@ziroeda/pcbnew/tools/pcb_selection_tool.js';
import type { TEST_PCB_FRAME } from './test_pcb_frame.js';

export const MM = 1_000_000;

export const mm = (x: number, y: number): Vec2 => ({ x: x * MM, y: y * MM });

/** A KIID whose last group is `n`: board text and lookups name items by number. */
export const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Items by uuid: a failed comparison of the items themselves prints the whole board. */
export const ids = (aItems: Iterable<{ m_Uuid: string }>): string[] =>
  [...aItems].map((i) => i.m_Uuid);

class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

export interface TOOL_HARNESS<F extends TEST_PCB_FRAME> {
  board: BOARD;
  frame: F;
  mgr: TOOL_MANAGER;
  sel: PCB_SELECTION_TOOL;
  view: PCB_VIEW;
  mouse: Vec2;
  forced: Vec2 | null;
  /** The last cursor shape a tool asked the canvas for. */
  shape?: KICURSOR;
  menus: ACTION_MENU[];
  /** Each shown menu's close, which the tool manager waits on. */
  menuCloses: (() => void)[];
}

/**
 * Parse `aBoardText`, put it on a view, and register PCB_SELECTION_TOOL then
 * `aTools()` in that order (the order `setupTools` registers them in is the
 * order their context-menu rows land in).
 */
export function toolHarness<F extends TEST_PCB_FRAME>(
  aBoardText: string,
  aFrame: (aBoard: BOARD) => F,
  aTools: () => TOOL_BASE[],
): TOOL_HARNESS<F> {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));

  const board = ParseBoard(aBoardText, '/p/x.kicad_pcb');
  board.BuildConnectivity();
  const frame = aFrame(board);
  frame.SetScreen(new PCB_SCREEN({ x: 297 * MM, y: 210 * MM }));
  frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);

  const h: Partial<TOOL_HARNESS<F>> = {
    board,
    frame,
    mouse: { x: 0, y: 0 },
    forced: null,
    menus: [],
    menuCloses: [],
  };
  const { view, controls } = harnessCanvas(board, frame, h as HARNESS_MOUSE);
  h.view = view;

  frame.SetPopupMenuPresenter((aMenu: ACTION_MENU, aOnClose: () => void) => {
    h.menus!.push(aMenu);
    h.menuCloses!.push(aOnClose);
  });

  const mgr = frame.GetToolManager()!;
  mgr.SetEnvironment(board, view, controls, frame.settings, frame);

  const sel = new PCB_SELECTION_TOOL();
  mgr.RegisterTool(sel);

  for (const tool of aTools()) mgr.RegisterTool(tool);

  mgr.InitTools();
  mgr.InvokeTool('common.InteractiveSelection');

  return Object.assign(h, { mgr, sel }) as TOOL_HARNESS<F>;
}

/**
 * The mouse a harness canvas answers from: where it is, and any forced cursor;
 * and the last cursor shape a tool asked the canvas for (`SetCurrentCursor`).
 */
export interface HARNESS_MOUSE {
  mouse: Vec2;
  forced: Vec2 | null;
  shape?: KICURSOR;
}

/**
 * A real PCB_VIEW on a stub GAL with the board's items in it, a canvas, and
 * view controls answering from `aMouse` - what toolHarness gives its frame,
 * for a test that builds its own frame (a real PCB_EDIT_FRAME, say).
 */
export function harnessCanvas(
  board: BOARD,
  frame: PCB_BASE_EDIT_FRAME,
  h: HARNESS_MOUSE,
): { view: PCB_VIEW; controls: TOOL_MANAGER_VIEW_CONTROLS } {
  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  gal.ResizeScreen(1000, 1000);
  // a 0.1 mm grid, snapping on, as the frame sets it from its grid settings
  gal.SetGridSize({ x: 0.1 * MM, y: 0.1 * MM });
  (gal as unknown as { m_options: { m_gridSnapping: number } }).m_options.m_gridSnapping = 0; // GRID_SNAPPING::ALWAYS
  const view = new PCB_VIEW();
  view.SetGAL(gal);
  view.SetPainter(new PCB_PAINTER(gal, FRAME_T.FRAME_PCB_EDITOR));
  view.SetScale(1);
  view.SetScale(view.GetScale() * (view.ToWorld(1000) / (150 * MM)));
  view.SetCenter(mm(60, 60));

  // PCB_DRAW_PANEL_GAL::DisplayBoard: the top-level items; PCB_VIEW::Add
  // brings a footprint's children with it (adding them again would put each
  // in the R-tree twice, and one Remove would leave a ghost behind).
  for (const item of board.GetItemSet()) view.Add(item);

  frame.SetCanvas({
    // Read lazily: the controls are built just below.
    GetViewControls: () => controls,
    GetView: () => view,
    GetGAL: () => gal,
    SetCurrentCursor: (aCursor: KICURSOR) => {
      h.shape = aCursor;
    },
    ForceRefresh: () => {},
    Refresh: () => {},
    RedrawRatsnest: () => {},
    SetHighContrastLayer: () => {},
    SetStatusPopup: () => {},
    GetDrawingSheet: () => null,
    GetClientSize: () => ({ x: 1000, y: 1000 }),
  } as unknown as PCB_DRAW_PANEL_GAL);

  const controls = {
    GetMousePosition: () => h.mouse,
    GetCursorPosition: () => h.forced ?? h.mouse,
    SetAutoPan: () => {},
    SetCursorPosition: (aPos: Vec2) => {
      h.mouse = { ...aPos };
    },
    ForceCursorPosition: (aEnable: boolean, aPos?: Vec2) => {
      h.forced = aEnable && aPos ? { ...aPos } : null;
    },
    ShowCursor: () => {},
    PinCursorInsideNonAutoscrollArea: () => {},
    CaptureCursor: () => {},
    WarpMouseCursor: () => {},
    GetSettings: () => new VC_SETTINGS(),
    ApplySettings: () => {},
  } as unknown as TOOL_MANAGER_VIEW_CONTROLS;

  return { view, controls };
}

/** The item whose uuid is `U(aN)`, at any depth. */
export function byUuid(aBoard: BOARD, aN: number): BOARD_ITEM {
  let found: BOARD_ITEM | null = null;

  aBoard.RunOnChildren((aItem: BOARD_ITEM) => {
    if (aItem.m_Uuid === U(aN)) found = aItem;
  }, RECURSE_MODE.RECURSE);

  if (!found) throw new Error(`no item ${U(aN)}`);

  return found;
}

/** A mouse event as `TOOL_DISPATCHER` makes it, at `aAt`. */
export function mouse<F extends TEST_PCB_FRAME>(
  h: TOOL_HARNESS<F>,
  aAction: number,
  aAt: Vec2,
  aButton = BUT_LEFT,
): void {
  h.mouse = aAt;
  const evt = new TOOL_EVENT(TC_MOUSE, aAction, aButton, AS_GLOBAL);
  evt.SetMousePosition(aAt);
  h.mgr.ProcessEvent(evt);
}

/** What the popup does when row `aId` of the last menu shown is chosen: the event, then the close. */
export function chooseMenuRow<F extends TEST_PCB_FRAME>(h: TOOL_HARNESS<F>, aId: number): void {
  const menu = h.menus.at(-1)!;
  menu.OnMenuEvent(new wxMenuEvent(wxMenuEventType.wxEVT_COMMAND_MENU_SELECTED, aId, menu));
  h.menuCloses.at(-1)!();
}

/** Add the items `U(n)` to the selection, quietly. */
export function select<F extends TEST_PCB_FRAME>(h: TOOL_HARNESS<F>, ...aUuids: number[]): void {
  for (const n of aUuids) h.sel.AddItemToSel(byUuid(h.board, n), true);
}
