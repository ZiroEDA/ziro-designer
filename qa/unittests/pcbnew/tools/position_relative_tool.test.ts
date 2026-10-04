// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * POSITION_RELATIVE_TOOL (pcbnew/tools/position_relative_tool.cpp) driven
 * through the tool manager on a live BOARD, with the TOOL_EVENTs the
 * dispatcher makes. KiCad's qa has no suite for this tool; each expectation is
 * read off the C++ line it cites.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { LAYER_ANCHOR, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { RULER_ITEM } from '@ziroeda/common/preview_items/ruler_item.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  AS_GLOBAL,
  BUT_LEFT,
  TA_MOUSE_CLICK,
  TA_MOUSE_DRAG,
  TA_MOUSE_MOTION,
  TA_MOUSE_UP,
  TC_MOUSE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type {
  TOOL_MANAGER,
  TOOL_MANAGER_VIEW_CONTROLS,
} from '@ziroeda/common/tool/tool_manager.js';
import { VC_SETTINGS } from '@ziroeda/common/view/view_controls.js';
import { LeaderMode } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { DIALOG_OFFSET_ITEM } from '@ziroeda/pcbnew/dialogs/dialog_offset_item.js';
import type { DIALOG_POSITION_RELATIVE } from '@ziroeda/pcbnew/dialogs/dialog_position_relative.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/pcb_base_frame.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_PAINTER } from '@ziroeda/pcbnew/pcb_painter.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_VIEW } from '@ziroeda/pcbnew/pcb_view.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_SELECTION_TOOL } from '@ziroeda/pcbnew/tools/pcb_selection_tool.js';
import {
  POSITION_RELATIVE_TOOL,
  type POSITION_RELATIVE_TOOL_FRAME,
} from '@ziroeda/pcbnew/tools/position_relative_tool.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = 1_000_000;

/** The ruler's private state, which nothing public reports. */
interface RULER_PRIVATE {
  m_geomMgr: { GetOrigin(): Vec2; GetEnd(): Vec2; IsReset(): boolean; GetAngleSnap(): LeaderMode };
  m_flipX: boolean;
  m_flipY: boolean;
  m_userUnits: string;
  m_showTicks: boolean;
  m_showEndArrowHead: boolean;
  m_color: unknown;
}
const rulerState = (r: RULER_ITEM): RULER_PRIVATE => r as unknown as RULER_PRIVATE;

class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (5 "F.SilkS" user "F.Silkscreen")
    (7 "B.SilkS" user "B.Silkscreen")
    (1 "F.Mask" user)
    (3 "B.Mask" user)
    (25 "Edge.Cuts" user)
    (35 "F.Fab" user)
    (37 "B.Fab" user)
  )
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
  (net 3 "N3")
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)
    (property "Reference" "R1" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "10k" (at 0 3 0) (layer "F.Fab") (hide yes) (uuid "${U(3)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "${U(5)}"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (net 2 "N2") (uuid "${U(6)}"))
  )
  (footprint "C" (layer "F.Cu") (uuid "${U(7)}") (at 80 40 90)
    (property "Reference" "C1" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(8)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "1u" (at 0 3 0) (layer "F.Fab") (hide yes) (uuid "${U(9)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 3 "N3") (uuid "${U(10)}"))
  )
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(20)}"))
  (segment (start 100 100) (end 110 100) (width 0.25) (layer "F.Cu") (locked yes) (net 2) (uuid "${U(22)}"))
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(30)}"))
  (gr_line (start 12 60) (end 18 60) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(31)}"))
  (gr_line (start 12 62) (end 18 62) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(32)}"))
  (group "G" (uuid "${U(50)}") (members "${U(31)}" "${U(32)}"))
  (gr_text "A1" (at 70 70 0) (layer "F.SilkS") (uuid "${U(40)}")
    (effects (font (size 1 1) (thickness 0.15))))
)
`;

/** The frame, with the two dialogs the tool asks for answered by the test. */
class POSREL_FRAME extends TEST_PCB_FRAME implements POSITION_RELATIVE_TOOL_FRAME {
  attached: DIALOG_POSITION_RELATIVE[] = [];
  /** What the user does in the modal Offset Item dialog; null cancels. */
  offsetAnswer: ((d: DIALOG_OFFSET_ITEM) => void) | null = null;
  /** The two entries as the dialog showed them: polar by default, so distance (IU) and angle (deg). */
  offsetAsked: number[][] = [];
  warnings: string[] = [];

  override ShowInfoBarWarning(aMsg: string): void {
    this.warnings.push(aMsg);
  }

  AttachPositionRelativeDialog(aDialog: DIALOG_POSITION_RELATIVE): void {
    this.attached.push(aDialog);
  }

  ShowOffsetItemDialog(aDialog: DIALOG_OFFSET_ITEM): Promise<boolean> {
    aDialog.TransferDataToWindow();
    this.offsetAsked.push([aDialog.m_xOffset.GetDoubleValue(), aDialog.m_yOffset.GetDoubleValue()]);

    if (!this.offsetAnswer) return Promise.resolve(false);

    this.offsetAnswer(aDialog);
    return Promise.resolve(aDialog.TransferDataFromWindow());
  }
}

/** A footprint editor frame, whose own settings say how the ruler snaps and which way it points. */
class POSREL_FP_FRAME extends POSREL_FRAME {
  fpSettings: FOOTPRINT_EDITOR_SETTINGS_LIKE = {
    m_DisplayInvertXAxis: true,
    m_DisplayInvertYAxis: false,
    m_AngleSnapMode: LeaderMode.DEG45,
  };

  override GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return this.fpSettings;
  }
}

interface Harness {
  board: BOARD;
  view: PCB_VIEW;
  rulers: RULER_ITEM[];
  /** The ruler's end at each of the tool's GEOMETRY updates of it. */
  rulerEnds: Vec2[];
  frame: POSREL_FRAME;
  mgr: TOOL_MANAGER;
  sel: PCB_SELECTION_TOOL;
  tool: POSITION_RELATIVE_TOOL;
  mouse: Vec2;
  forced: Vec2 | null;
  processed: TOOL_EVENT[];
}

function byUuid(aBoard: BOARD, aN: number): BOARD_ITEM {
  let found: BOARD_ITEM | null = null;

  aBoard.RunOnChildren((aItem: BOARD_ITEM) => {
    if (aItem.m_Uuid === U(aN)) found = aItem;
  }, RECURSE_MODE.RECURSE);

  if (!found) throw new Error(`no item ${U(aN)}`);

  return found;
}

const mm = (x: number, y: number): Vec2 => ({ x: x * MM, y: y * MM });

function harness(aFootprintEditor = false): Harness {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));

  const board = ParseBoard(BOARD_TEXT, '/p/x.kicad_pcb');
  board.BuildConnectivity();
  const frame = aFootprintEditor
    ? new POSREL_FP_FRAME(board, FRAME_T.FRAME_FOOTPRINT_EDITOR)
    : new POSREL_FRAME(board);
  frame.SetScreen(new PCB_SCREEN({ x: 297 * MM, y: 210 * MM }));
  frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);

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

  board.RunOnChildren((aItem: BOARD_ITEM) => view.Add(aItem), RECURSE_MODE.NO_RECURSE);

  for (const fp of board.Footprints())
    fp.RunOnChildren((aItem: BOARD_ITEM) => view.Add(aItem), RECURSE_MODE.NO_RECURSE);

  // the ruler the tool puts on the view
  const rulers: RULER_ITEM[] = [];
  const add = view.Add.bind(view);
  view.Add = (aItem, ...rest) => {
    if (aItem instanceof RULER_ITEM) rulers.push(aItem);
    return add(aItem, ...rest);
  };

  const rulerEnds: Vec2[] = [];
  const update = view.Update.bind(view);
  view.Update = (aItem, ...rest) => {
    if (aItem instanceof RULER_ITEM)
      rulerEnds.push({ ...(aItem as unknown as RULER_PRIVATE).m_geomMgr.GetEnd() });
    return update(aItem, ...rest);
  };

  const h: Partial<Harness> = {
    board,
    view,
    rulers,
    rulerEnds,
    frame,
    mouse: { x: 0, y: 0 },
    forced: null,
    processed: [],
  };

  frame.SetCanvas({
    // Read lazily: the controls are built just below.
    GetViewControls: () => controls,
    GetView: () => view,
    GetGAL: () => gal,
    SetCurrentCursor: () => {},
    ForceRefresh: () => {},
    Refresh: () => {},
    RedrawRatsnest: () => {},
    SetStatusPopup: () => {},
    GetDrawingSheet: () => null,
    GetClientSize: () => ({ x: 1000, y: 1000 }),
  } as unknown as PCB_DRAW_PANEL_GAL);

  const controls = {
    GetMousePosition: () => h.mouse!,
    GetCursorPosition: () => h.forced ?? h.mouse!,
    SetAutoPan: () => {},
    SetCursorPosition: (aPos: Vec2) => {
      h.mouse = { ...aPos };
    },
    ForceCursorPosition: (aEnable: boolean, aPos?: Vec2) => {
      h.forced = aEnable && aPos ? { ...aPos } : null;
    },
    ShowCursor: () => {},
    CaptureCursor: () => {},
    WarpMouseCursor: () => {},
    GetSettings: () => new VC_SETTINGS(),
    ApplySettings: () => {},
  } as unknown as TOOL_MANAGER_VIEW_CONTROLS;

  const mgr = frame.GetToolManager()!;
  mgr.SetEnvironment(board, view, controls, frame.settings, frame);

  const sel = new PCB_SELECTION_TOOL();
  const tool = new POSITION_RELATIVE_TOOL();
  tool.SetIsFootprintEditor(aFootprintEditor);
  mgr.RegisterTool(sel);
  mgr.RegisterTool(tool);
  mgr.InitTools();
  // PCB_EDIT_FRAME::setupTools is followed by ResetTools( MODEL_RELOAD ) once a board is
  // loaded; that, not RUN, is the reason on which this tool makes its BOARD_COMMIT (:80-81)
  mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  mgr.InvokeTool('common.InteractiveSelection');

  // which events the tool manager was asked to process
  const process = mgr.ProcessEvent.bind(mgr);
  mgr.ProcessEvent = (aEvent: TOOL_EVENT): boolean => {
    h.processed!.push(aEvent);
    return process(aEvent);
  };

  return Object.assign(h, { mgr, sel, tool }) as Harness;
}

function mouse(h: Harness, aAction: number, aAt: Vec2, aButton = BUT_LEFT): void {
  h.mouse = aAt;
  const evt = new TOOL_EVENT(TC_MOUSE, aAction, aButton, AS_GLOBAL);
  evt.SetMousePosition(aAt);
  h.mgr.ProcessEvent(evt);
}

function select(h: Harness, ...aUuids: number[]): void {
  for (const n of aUuids) h.sel.AddItemToSel(byUuid(h.board, n), true);
}

const fp = (n: number): FOOTPRINT => byUuid(h.board, n) as FOOTPRINT;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let h: Harness;

beforeEach(() => {
  h = harness();
});

/** Run Position Relative and press OK with a Cartesian offset from the grid origin. */
function positionRelativeTo(aDialog: DIALOG_POSITION_RELATIVE, aX: string, aY: string): void {
  aDialog.OnPolarChanged(false);
  aDialog.SetEntryText(aDialog.m_xOffset, aX);
  aDialog.SetEntryText(aDialog.m_yOffset, aY);
  aDialog.OnUseGridOriginClick();
  aDialog.OnOkClick();
}

describe('POSITION_RELATIVE_TOOL::PositionRelative (position_relative_tool.cpp:95)', () => {
  it('shows the non-modal dialog and gives the frame its window (:150-154)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.frame.attached).toHaveLength(1);
    expect(h.frame.attached[0]!.IsShown()).toBe(true);
  });

  it('prefers a footprint over everything else: the anchor is the top-left FOOTPRINT (:121-127)', () => {
    // the track starts at (10,10), left of and above both footprints
    select(h, 20, 5, 7, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.tool.GetSelectionAnchorPosition()).toEqual(mm(60, 30));
  });

  it('with no footprint, the top-left PAD, not the top-left item (:129-143)', () => {
    // pad 1 of R1 sits at (59,30), pad 1 of C1 at (80,40); the track at (10,10) is further left
    select(h, 20, 5, 10);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.tool.GetSelectionAnchorPosition()).toEqual(mm(59, 30));
  });

  it('with neither, the top-left item of the whole selection (:148)', () => {
    select(h, 40, 30);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    // the line at (10,50) is left of the text at (70,70)
    expect(h.tool.GetSelectionAnchorPosition()).toEqual(mm(10, 50));
  });

  it('ties on x are broken by the smaller y (PCB_SELECTION::GetTopLeftItem)', () => {
    select(h, 5, 6);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.tool.GetSelectionAnchorPosition()).toEqual(mm(59, 30));
  });

  it('does nothing for an empty selection (:114)', () => {
    h.mouse = mm(200, 200);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.frame.attached).toHaveLength(0);
  });

  it('acts on the item under the cursor when nothing is selected (RequestSelection hover)', () => {
    h.mouse = mm(15, 10);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.tool.GetSelectionAnchorPosition()).toEqual(mm(10, 10));
  });

  it('a locked item is filtered out and the tool reports it (:111, FilterCollectorForLockedItems)', () => {
    select(h, 22);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.frame.attached).toHaveLength(0);
  });

  it('a locked item gets the banner telling the user to enable Override locks (:111, ReportFilteredLockedItems)', () => {
    select(h, 22);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.frame.warnings).toEqual([
      "Selection contains locked items. Enable 'Override locks' to operate on them.",
    ]);
  });

  it('keeps the one dialog between calls (:145-147)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    h.mgr.RunAction(ACTIONS.selectionClear);
    select(h, 7);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.frame.attached).toHaveLength(1);
    expect(h.tool.GetSelectionAnchorPosition()).toEqual(mm(80, 40));
  });

  it('rebuilds the dialog when the user units changed since the last call (:141-146)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    const first = h.frame.attached[0]!;
    h.frame.SetUserUnits('in');
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    expect(h.frame.attached).toHaveLength(2);
    expect(first.IsDestroyed()).toBe(true);
    expect(first.IsShown()).toBe(false);
    expect(h.frame.attached[1]!.GetUserUnits()).toBe('in');
  });
});

describe('POSITION_RELATIVE_TOOL::RelativeItemSelectionMove (position_relative_tool.cpp:392)', () => {
  it('lands the selection anchor at reference + offset: delta = anchor + translation - selection anchor (:394)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    // grid origin (0,0) + (10,5): the footprint anchor (60,30) goes to (10,5)
    positionRelativeTo(h.frame.attached[0]!, '10', '5');
    expect(fp(1).GetPosition()).toEqual(mm(10, 5));
  });

  it('is not Move Exactly: typing the same offset twice moves nothing the second time', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '10', '5');
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '10', '5');
    expect(fp(1).GetPosition()).toEqual(mm(10, 5));
  });

  it('is one undo entry (:402)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '10', '5');
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    h.frame.RestoreCopyFromUndoList();
    expect(fp(1).GetPosition()).toEqual(mm(60, 30));
  });

  it('measures from the grid origin the board states', () => {
    h.board.GetDesignSettings().SetGridOrigin(mm(100, 100));
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '1', '2');
    expect(fp(1).GetPosition()).toEqual(mm(101, 102));
  });

  it('a selected pad moves its whole footprint, by the pad as the anchor (:35-37, :119)', () => {
    select(h, 6); // R1 pad 2, at (61,30)
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '10', '10');
    // the pad lands on (10,10), so the footprint moved by (10-61, 10-30)
    expect(fp(1).GetPosition()).toEqual(mm(9, 10));
    expect((byUuid(h.board, 6) as PAD).GetPosition()).toEqual(mm(10, 10));
  });

  it('two pads of one footprint move it once (:41, the dedup set)', () => {
    select(h, 5, 6);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '0', '0');
    // anchor = pad 1 at (59,30): the footprint moves by (-59,-30) exactly once
    expect(fp(1).GetPosition()).toEqual(mm(1, 0));
  });

  it('with free pads allowed, the pad moves alone (:34, aAllowFreePads)', () => {
    h.frame.settings.m_AllowFreePads = true;
    select(h, 6);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '10', '10');
    expect(fp(1).GetPosition()).toEqual(mm(60, 30));
    expect((byUuid(h.board, 6) as PAD).GetPosition()).toEqual(mm(10, 10));
  });

  it('moves the selection the dialog was opened on, not whatever is selected when OK is pressed (:117, m_selection is a copy)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    // the dialog is modeless: the user clicks elsewhere before pressing OK
    h.mgr.RunAction(ACTIONS.selectionClear);
    select(h, 7);
    positionRelativeTo(h.frame.attached[0]!, '10', '5');
    expect(fp(1).GetPosition()).toEqual(mm(10, 5));
    expect(fp(7).GetPosition()).toEqual(mm(80, 40));
  });

  it('in the footprint editor a pad moves alone (:34, m_isFootprintEditor)', () => {
    h = harness(true);
    select(h, 6);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '10', '10');
    expect(fp(1).GetPosition()).toEqual(mm(60, 30));
    // this frame's footprint editor settings invert X, so the typed 10 is -10 on the board
    expect((byUuid(h.board, 6) as PAD).GetPosition()).toEqual(mm(-10, 10));
  });

  it('undo gives the footprint and its pads back (:36, Modify( RECURSE ))', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '10', '5');
    expect((byUuid(h.board, 6) as PAD).GetPosition()).toEqual(mm(11, 5));
    h.frame.RestoreCopyFromUndoList();
    expect((byUuid(h.board, 6) as PAD).GetPosition()).toEqual(mm(61, 30));
    expect((byUuid(h.board, 5) as PAD).GetPosition()).toEqual(mm(59, 30));
  });

  it("undo gives a moved group's members back (:36, Modify( RECURSE ) stages them)", () => {
    select(h, 50);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '0', '0');
    expect((byUuid(h.board, 31) as PCB_SHAPE).GetStart()).not.toEqual(mm(12, 60));
    h.frame.RestoreCopyFromUndoList();
    expect((byUuid(h.board, 31) as PCB_SHAPE).GetStart()).toEqual(mm(12, 60));
    expect((byUuid(h.board, 32) as PCB_SHAPE).GetStart()).toEqual(mm(12, 62));
  });

  it('a hover selection is cleared after the move (:405-406)', () => {
    h.mouse = mm(15, 10);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '0', '0');
    expect(h.sel.GetSelection().Empty()).toBe(true);
  });

  it('a real selection survives the move', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '10', '5');
    expect(h.sel.GetSelection().Size()).toBe(1);
  });

  it('tells the tools the selected items were modified (:408)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    h.processed.length = 0;
    positionRelativeTo(h.frame.attached[0]!, '10', '5');
    // once from BOARD_COMMIT::Push for the selected items it changed, once from the tool itself
    expect(h.processed.filter((e) => e === EVENTS.SelectedItemsModified)).toHaveLength(2);
  });

  it('moves every item of a mixed selection by the same vector', () => {
    select(h, 30, 40);
    h.mgr.RunAction(PCB_ACTIONS.positionRelative);
    positionRelativeTo(h.frame.attached[0]!, '0', '0');
    // anchor = the line at (10,50): everything moves by (-10,-50)
    expect((byUuid(h.board, 30) as PCB_SHAPE).GetStart()).toEqual(mm(0, 0));
    expect((byUuid(h.board, 40) as BOARD_ITEM).GetPosition()).toEqual(mm(60, 20));
  });
});

describe('POSITION_RELATIVE_TOOL::InteractiveOffset (position_relative_tool.cpp:160)', () => {
  /** The three events the tool reads: click the reference, move, click the target. */
  function drawOffset(aFrom: Vec2, aTo: Vec2): void {
    mouse(h, TA_MOUSE_CLICK, aFrom);
    mouse(h, TA_MOUSE_MOTION, aTo);
    mouse(h, TA_MOUSE_CLICK, aTo);
  }

  it('shows the vector end - origin in the Offset Item dialog (:260-264)', async () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 30));
    await flush();
    // the vector end - origin is (-10 mm, 0); the dialog opens in polar mode (:105 of the base,
    // m_polarCoords->SetValue( true )), so it shows 10 mm at 180 degrees
    expect(h.frame.offsetAsked).toEqual([[10 * MM, 180]]);
  });

  it('OK moves the selection by (origin - end) + the dialog offset (:268-271)', async () => {
    select(h, 1);
    h.frame.offsetAnswer = (d) => {
      d.OnPolarChanged(false);
      d.SetEntryText(d.m_xOffset, '5');
      d.SetEntryText(d.m_yOffset, '0');
    };
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 30));
    await flush();
    // (70-60) + 5 = 15 mm along x
    expect(fp(1).GetPosition()).toEqual(mm(75, 30));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('moves along y as well: (origin - end) + the dialog offset (:268-271)', async () => {
    select(h, 1);
    h.frame.offsetAnswer = (d) => {
      d.OnPolarChanged(false);
      d.SetEntryText(d.m_xOffset, '5');
      d.SetEntryText(d.m_yOffset, '2');
    };
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 35));
    await flush();
    // (70-60)+5 = 15 along x, (35-30)+2 = 7 along y
    expect(fp(1).GetPosition()).toEqual(mm(75, 37));
  });

  it('shows the y of the vector as well (:260-264)', async () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 35));
    await flush();
    // (-10, -5) mm: 11.1803398875 mm, and the vector points up-left, -153.4349 degrees,
    // shown negated (pcb_origin_transforms.cpp:76) as 153.4349
    expect(h.frame.offsetAsked).toHaveLength(1);
    expect(h.frame.offsetAsked[0]![0]).toBeCloseTo(11180339.8875, 3);
    expect(h.frame.offsetAsked[0]![1]).toBe(153.4349);
  });

  it('accepting the dialog as shown moves nothing (offset = end - origin cancels the term)', async () => {
    select(h, 1);
    h.frame.offsetAnswer = () => {};
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 30));
    await flush();
    expect(fp(1).GetPosition()).toEqual(mm(60, 30));
  });

  it('Cancel moves nothing and the tool keeps waiting for a new reference (:289)', async () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 30));
    await flush();
    expect(fp(1).GetPosition()).toEqual(mm(60, 30));
    expect(h.frame.GetUndoCommandCount()).toBe(0);

    // a second pass through the same tool still works
    h.frame.offsetAnswer = (d) => {
      d.OnPolarChanged(false);
      d.SetEntryText(d.m_xOffset, '0');
      d.SetEntryText(d.m_yOffset, '0');
    };
    drawOffset(mm(60, 30), mm(65, 30));
    await flush();
    expect(h.frame.offsetAsked).toHaveLength(2);
    expect(fp(1).GetPosition()).toEqual(mm(65, 30));
  });

  it('snaps the clicks to the grid (:216-224)', async () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    // empty board space, so only the 0.1 mm grid can move the points
    drawOffset({ x: 100.04 * MM, y: 60.02 * MM }, { x: 110.03 * MM, y: 60.04 * MM });
    await flush();
    // (100.0, 60.0) and (110.0, 60.0): exactly 10 mm at 180 degrees
    expect(h.frame.offsetAsked).toEqual([[10 * MM, 180]]);
  });

  it('does nothing for an empty selection (:179)', () => {
    h.mouse = mm(200, 200);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    h.mouse = mm(60, 30);
    drawOffset(mm(60, 30), mm(70, 30));
    expect(h.frame.offsetAsked).toEqual([]);
  });

  it('a locked item is filtered and the tool does not start (:175)', () => {
    select(h, 22);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(105, 100), mm(110, 100));
    expect(h.frame.offsetAsked).toEqual([]);
  });

  it('a locked item gets the banner and the tool does not start (:175, ReportFilteredLockedItems)', () => {
    select(h, 22);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    expect(h.frame.warnings).toEqual([
      "Selection contains locked items. Enable 'Override locks' to operate on them.",
    ]);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.interactiveOffsetTool)).toBe(false);
  });

  it('Esc with no origin set ends the tool (:238-244)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.interactiveOffsetTool)).toBe(true);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.interactiveOffsetTool)).toBe(false);
  });

  it('Esc with an origin set only clears it; a second Esc ends the tool (:232-237)', async () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    mouse(h, TA_MOUSE_CLICK, mm(60, 30));
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.interactiveOffsetTool)).toBe(true);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.interactiveOffsetTool)).toBe(false);
  });

  it('the dialog is not shown without a first click (:251, !originSet)', async () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    mouse(h, TA_MOUSE_MOTION, mm(70, 30));
    await flush();
    expect(h.frame.offsetAsked).toEqual([]);
  });

  it('does nothing while the Measure tool is the current tool (:182)', () => {
    select(h, 1);
    h.frame.PushTool(ACTIONS.measureTool.MakeEvent());
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 30));
    expect(h.frame.offsetAsked).toEqual([]);
    expect(h.rulers).toHaveLength(0);
  });

  it('in the footprint editor with no footprint loaded it does nothing (:179)', () => {
    h = harness(true);
    select(h, 1);
    h.frame.GetModel = () => null;
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 30));
    expect(h.frame.offsetAsked).toEqual([]);
  });

  it('in the footprint editor with a footprint loaded it runs (:179)', async () => {
    h = harness(true);
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 30));
    await flush();
    expect(h.frame.offsetAsked).toHaveLength(1);
  });

  it('forces the crosshair onto the snapped point (:219-221)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    mouse(h, TA_MOUSE_MOTION, { x: 100.04 * MM, y: 60.02 * MM });
    expect(h.forced).toEqual(mm(100, 60));
  });

  it('a drag starts the ruler and releasing the button ends it (:246, :251)', async () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    mouse(h, TA_MOUSE_DRAG, mm(60, 30));
    mouse(h, TA_MOUSE_DRAG, mm(70, 30));
    mouse(h, TA_MOUSE_UP, mm(70, 30));
    await flush();
    expect(h.frame.offsetAsked).toEqual([[10 * MM, 180]]);
  });

  it('another tool being activated ends it (:243-249)', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.interactiveOffsetTool)).toBe(true);
    h.mgr.RunAction(ACTIONS.selectionActivate);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.interactiveOffsetTool)).toBe(false);
  });

  it('clicks while the modal dialog is up never reach the tool (the dialog blocks the canvas)', async () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 30));
    // the dialog has not answered yet
    mouse(h, TA_MOUSE_CLICK, mm(10, 10));
    mouse(h, TA_MOUSE_CLICK, mm(20, 20));
    await flush();
    expect(h.frame.offsetAsked).toHaveLength(1);
  });

  it('asking again while it runs does not start a second pass (:164-165, the re-entrancy guard)', async () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
    drawOffset(mm(60, 30), mm(70, 30));
    await flush();
    expect(h.frame.offsetAsked).toHaveLength(1);
  });

  describe('the ruler (:140-148, :272-277, :313-339)', () => {
    it('is put on the view, hidden, in the colour of the anchor layer, with an arrow head and no ticks', () => {
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      expect(h.rulers).toHaveLength(1);
      expect(h.view.HasItem(h.rulers[0]!)).toBe(true);
      expect(h.view.IsVisible(h.rulers[0]!)).toBe(false);
      expect(rulerState(h.rulers[0]!).m_showTicks).toBe(false);
      expect(rulerState(h.rulers[0]!).m_showEndArrowHead).toBe(true);
      expect(rulerState(h.rulers[0]!).m_color).toEqual(
        h.view.GetPainter().GetSettings().GetLayerColor(LAYER_ANCHOR),
      );
    });

    it('shows once the reference point is set and the pointer moves', () => {
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      mouse(h, TA_MOUSE_CLICK, mm(60, 30));
      expect(h.view.IsVisible(h.rulers[0]!)).toBe(false);
      mouse(h, TA_MOUSE_MOTION, mm(70, 30));
      expect(h.view.IsVisible(h.rulers[0]!)).toBe(true);
      expect(rulerState(h.rulers[0]!).m_geomMgr.GetEnd()).toEqual(mm(60, 30));
      expect(rulerState(h.rulers[0]!).m_geomMgr.GetOrigin()).toEqual(mm(70, 30));
    });

    it('is re-pointed at origin + the dialog offset when the dialog is accepted (:272-277)', async () => {
      select(h, 1);
      h.frame.offsetAnswer = (d) => {
        d.OnPolarChanged(false);
        d.SetEntryText(d.m_xOffset, '5');
        d.SetEntryText(d.m_yOffset, '2');
      };
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      drawOffset(mm(60, 30), mm(70, 30));
      await flush();
      // the first click, then the pointer, then the accepted offset from the second click (70,30)
      expect(h.rulerEnds).toContainEqual(mm(75, 32));
    });

    it('the re-pointed end keeps to the angle snap (SetEnd snaps)', async () => {
      h.frame.settings.m_AngleSnapMode = LeaderMode.DEG45;
      select(h, 1);
      h.frame.offsetAnswer = (d) => {
        d.OnPolarChanged(false);
        d.SetEntryText(d.m_xOffset, '5');
        d.SetEntryText(d.m_yOffset, '2');
      };
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      drawOffset(mm(60, 30), mm(70, 30));
      await flush();
      // (5,2) is within 2:1 of the horizontal, so 45 degree mode holds it flat
      expect(h.rulerEnds).toContainEqual(mm(75, 30));
      expect(h.rulerEnds).not.toContainEqual(mm(75, 32));
    });

    it('is left as it was drawn when the dialog is cancelled', async () => {
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      drawOffset(mm(60, 30), mm(70, 30));
      await flush();
      expect(h.view.IsVisible(h.rulers[0]!)).toBe(true);
      expect(rulerState(h.rulers[0]!).m_geomMgr.GetEnd()).toEqual(mm(60, 30));
      expect(rulerState(h.rulers[0]!).m_geomMgr.GetOrigin()).toEqual(mm(70, 30));
    });

    it('is hidden by Esc while the origin is set (:232, cleanup)', () => {
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      mouse(h, TA_MOUSE_CLICK, mm(60, 30));
      mouse(h, TA_MOUSE_MOTION, mm(70, 30));
      h.mgr.RunAction(ACTIONS.cancelInteractive);
      expect(h.view.IsVisible(h.rulers[0]!)).toBe(false);
    });

    it('is taken off the view when the tool ends (:381-382)', () => {
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      h.mgr.RunAction(ACTIONS.cancelInteractive);
      expect(h.view.HasItem(h.rulers[0]!)).toBe(false);
    });

    it('is cleared by an action that is not a mouse event, which may have moved the items (:357-364)', () => {
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      mouse(h, TA_MOUSE_CLICK, mm(60, 30));
      mouse(h, TA_MOUSE_MOTION, mm(70, 30));
      h.mgr.RunAction(ACTIONS.zoomIn);
      expect(h.view.IsVisible(h.rulers[0]!)).toBe(false);
      expect(rulerState(h.rulers[0]!).m_geomMgr.IsReset()).toBe(true);
    });

    it('follows the display axis inversion, and the preferences changing it (:75-87, :342-355)', () => {
      h.frame.settings.m_Display.m_DisplayInvertXAxis = true;
      h.frame.settings.m_Display.m_DisplayInvertYAxis = false;
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      expect(rulerState(h.rulers[0]!).m_flipX).toBe(true);
      expect(rulerState(h.rulers[0]!).m_flipY).toBe(false);
      h.frame.settings.m_Display.m_DisplayInvertXAxis = false;
      h.frame.settings.m_Display.m_DisplayInvertYAxis = true;
      h.mgr.RunAction(ACTIONS.updatePreferences);
      expect(rulerState(h.rulers[0]!).m_flipX).toBe(false);
      expect(rulerState(h.rulers[0]!).m_flipY).toBe(true);
    });

    it('in the footprint editor takes its axes from the footprint editor settings (:78-83)', () => {
      h = harness(true);
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      // POSREL_FP_FRAME: invert X on, Y off
      expect(rulerState(h.rulers[0]!).m_flipX).toBe(true);
      expect(rulerState(h.rulers[0]!).m_flipY).toBe(false);
    });

    it("switches units when the frame's change (:325-337)", () => {
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      expect(rulerState(h.rulers[0]!).m_userUnits).toBe('mm');
      h.frame.SetUserUnits('in');
      h.mgr.RunAction(ACTIONS.updateUnits);
      expect(rulerState(h.rulers[0]!).m_userUnits).toBe('in');
    });
  });

  describe('the angle snap (:300-311)', () => {
    const snapAfterMotion = (): LeaderMode => {
      select(h, 1);
      h.mgr.RunAction(PCB_ACTIONS.interactiveOffsetTool);
      mouse(h, TA_MOUSE_CLICK, mm(60, 30));
      mouse(h, TA_MOUSE_MOTION, mm(70, 31));
      return rulerState(h.rulers[0]!).m_geomMgr.GetAngleSnap();
    };

    it("takes the board editor's mode", () => {
      h.frame.settings.m_AngleSnapMode = LeaderMode.DEG45;
      expect(snapAfterMotion()).toBe(LeaderMode.DEG45);
    });

    it('and 90 degrees when that is the mode', () => {
      h.frame.settings.m_AngleSnapMode = LeaderMode.DEG90;
      expect(snapAfterMotion()).toBe(LeaderMode.DEG90);
    });

    it('is direct by default', () => {
      expect(snapAfterMotion()).toBe(LeaderMode.DIRECT);
    });

    it("in the footprint editor is the footprint editor's own (:305-308)", () => {
      h = harness(true);
      // POSREL_FP_FRAME: 45 degrees, while the board editor settings say direct
      expect(snapAfterMotion()).toBe(LeaderMode.DEG45);
    });
  });
});
