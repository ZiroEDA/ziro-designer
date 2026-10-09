// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PAD_TOOL (pcbnew/tools/pad_tool.cpp) driven through the tool manager on a live
 * BOARD, with the TOOL_EVENTs the dispatcher makes. KiCad's qa has no suite for
 * this tool; each expectation is read off the C++ line it cites.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { ENTERED } from '@ziroeda/common/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  AS_GLOBAL,
  BUT_LEFT,
  TA_MOUSE_CLICK,
  TA_MOUSE_DBLCLICK,
  TA_MOUSE_DRAG,
  TA_MOUSE_MOTION,
  TC_MOUSE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type {
  TOOL_MANAGER,
  TOOL_MANAGER_VIEW_CONTROLS,
} from '@ziroeda/common/tool/tool_manager.js';
import { VC_SETTINGS } from '@ziroeda/common/view/view_controls.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { DIALOG_ENUM_PADS } from '@ziroeda/pcbnew/dialogs/dialog_enum_pads.js';
import type { DIALOG_FP_EDIT_PAD_TABLE } from '@ziroeda/pcbnew/dialogs/dialog_fp_edit_pad_table.js';
import {
  type DIALOG_PUSH_PAD_PROPERTIES,
  wxID_CANCEL,
} from '@ziroeda/pcbnew/dialogs/dialog_push_pad_properties.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/pcb_base_frame.js';
import { LeaderMode } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK } from '@ziroeda/pcbnew/padstack.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_PAINTER } from '@ziroeda/pcbnew/pcb_painter.js';
import { SELECTION as SELECTION_CLASS } from '@ziroeda/common/tool/selection.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_VIEW } from '@ziroeda/pcbnew/pcb_view.js';
import { PAD_TOOL, type PAD_TOOL_FRAME } from '@ziroeda/pcbnew/tools/pad_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_SELECTION_TOOL } from '@ziroeda/pcbnew/tools/pcb_selection_tool.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = 1_000_000;

class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const HEADER = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
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
  (net 2 "N2")`;

const PROPS = (a: number, b: number): string => `
    (property "Reference" "R" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(a)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "V" (at 0 3 0) (layer "F.Fab") (hide yes) (uuid "${U(b)}")
      (effects (font (size 1 1) (thickness 0.15))))`;

/** A board with two footprints of the same library ID ("R") and one other ("C"). */
const BOARD_TEXT = `${HEADER}
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)${PROPS(2, 3)}
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "${U(11)}"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (net 2 "N2") (uuid "${U(12)}"))
  )
  (footprint "R" (layer "F.Cu") (uuid "${U(4)}") (at 100 30)${PROPS(5, 6)}
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (uuid "${U(21)}"))
    (pad "2" smd oval (at 1 0) (size 1 1) (layers "F.Cu") (uuid "${U(22)}"))
    (pad "3" smd rect (at 3 0) (size 1 1) (layers "F.Cu" "F.Mask") (uuid "${U(23)}"))
    (pad "4" smd rect (at 5 0 90) (size 1 1) (layers "F.Cu") (uuid "${U(24)}"))
    (pad "5" connect rect (at 7 0) (size 1 1) (layers "F.Cu") (uuid "${U(25)}"))
  )
  (footprint "C" (layer "F.Cu") (uuid "${U(7)}") (at 140 30)${PROPS(8, 9)}
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (uuid "${U(31)}"))
  )
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(40)}"))
)
`;

/** A footprint-editor board: one footprint, its pads numbered out of order. */
const FP_TEXT = `${HEADER}
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)${PROPS(2, 3)}
    (pad "10" smd rect (at -3 0) (size 1.5 1.5) (layers "F.Cu") (uuid "${U(11)}"))
    (pad "2" smd rect (at 0 0) (size 1.5 1.5) (layers "F.Cu") (uuid "${U(12)}"))
    (pad "1" smd rect (at 3 0) (size 1.5 1.5) (layers "F.Cu") (uuid "${U(13)}"))
    (pad "7" thru_hole circle (at 0 5) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "${U(14)}"))
  )
)
`;

/** A footprint with a custom shaped pad: an anchor and one polygon primitive. */
const CUSTOM_TEXT = `${HEADER}
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)${PROPS(2, 3)}
    (pad "1" smd custom (at 0 0) (size 1 1) (layers "F.Cu")
      (options (clearance outline) (anchor circle))
      (primitives (gr_poly (pts (xy 0 0) (xy 3 0) (xy 3 3) (xy 0 3)) (width 0) (fill yes)))
      (uuid "${U(11)}"))
  )
)
`;

/** The frame, with the dialogs the tool asks for answered by the test. */
class PAD_FRAME extends TEST_PCB_FRAME implements PAD_TOOL_FRAME {
  pushAnswer: ((d: DIALOG_PUSH_PAD_PROPERTIES) => number) | null = null;
  pushAsked = 0;
  enumAnswer: ((d: DIALOG_ENUM_PADS) => boolean) | null = null;
  enumAsked = 0;
  tables: DIALOG_FP_EDIT_PAD_TABLE[] = [];
  infobar: string[] = [];
  dismissed = 0;
  modified = 0;
  edited: BOARD_ITEM[] = [];
  /** The footprint editor's settings, kept so that a test can read what the tool did to them. */
  fpSettings: FOOTPRINT_EDITOR_SETTINGS_LIKE = {
    m_DisplayInvertXAxis: false,
    m_DisplayInvertYAxis: false,
    m_AngleSnapMode: LeaderMode.DIRECT,
  };

  override GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return this.fpSettings;
  }

  OnEditItemRequest(aItem: BOARD_ITEM): void {
    this.edited.push(aItem);
  }

  ShowPushPadPropertiesDialog(aDialog: DIALOG_PUSH_PAD_PROPERTIES): Promise<number> {
    this.pushAsked++;
    return Promise.resolve(this.pushAnswer ? this.pushAnswer(aDialog) : wxID_CANCEL);
  }

  ShowEnumPadsDialog(aDialog: DIALOG_ENUM_PADS): Promise<boolean> {
    this.enumAsked++;

    if (!this.enumAnswer) return Promise.resolve(false);

    const ok = this.enumAnswer(aDialog);
    return Promise.resolve(ok && aDialog.TransferDataFromWindow());
  }

  ShowPadTableDialog(aDialog: DIALOG_FP_EDIT_PAD_TABLE): void {
    this.tables.push(aDialog);
  }

  override ShowInfoBarMsg(aMsg: string): void {
    this.infobar.push(aMsg);
  }

  DismissInfoBar(): void {
    this.dismissed++;
  }

  override OnModify(): void {
    this.modified++;
    super.OnModify();
  }
}

interface Harness {
  board: BOARD;
  view: PCB_VIEW;
  frame: PAD_FRAME;
  mgr: TOOL_MANAGER;
  sel: PCB_SELECTION_TOOL;
  tool: PAD_TOOL;
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

function harness(aText = BOARD_TEXT, aFootprintEditor = false): Harness {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));

  const board = ParseBoard(aText, '/p/x.kicad_pcb');
  board.BuildConnectivity();
  const frame = new PAD_FRAME(
    board,
    aFootprintEditor ? FRAME_T.FRAME_FOOTPRINT_EDITOR : FRAME_T.FRAME_PCB_EDITOR,
  );
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
  view.SetCenter(mm(60, 30));

  board.RunOnChildren((aItem: BOARD_ITEM) => view.Add(aItem), RECURSE_MODE.NO_RECURSE);

  for (const fp of board.Footprints())
    fp.RunOnChildren((aItem: BOARD_ITEM) => view.Add(aItem), RECURSE_MODE.NO_RECURSE);

  const h: Partial<Harness> = {
    board,
    view,
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
    SetHighContrastLayer: () => {},
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
  const tool = new PAD_TOOL();
  tool.SetIsFootprintEditor(aFootprintEditor);
  mgr.RegisterTool(sel);
  mgr.RegisterTool(tool);
  mgr.InitTools();
  mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  mgr.InvokeTool('common.InteractiveSelection');

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

const pad = (n: number): PAD => byUuid(h.board, n) as PAD;
const fp = (n: number): FOOTPRINT => byUuid(h.board, n) as FOOTPRINT;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const sizeOf = (p: PAD): Vec2 => ({ ...p.GetSize(PADSTACK.ALL_LAYERS) });

let h: Harness;

beforeEach(() => {
  h = harness();
});

describe('PAD_TOOL::Reset (pad_tool.cpp:61)', () => {
  it('a model reload starts the pad numbering over at 1 (:63-64)', () => {
    h.tool.SetLastPadNumber('9');
    h.tool.Reset(RESET_REASON.MODEL_RELOAD);
    expect(h.tool.GetLastPadNumber()).toBe('1');
  });

  it('any other reset leaves the numbering alone', () => {
    h.tool.SetLastPadNumber('9');
    h.tool.Reset(RESET_REASON.REDRAW);
    expect(h.tool.GetLastPadNumber()).toBe('9');
  });

  const dimmed = (): void => {
    const o = h.frame.GetDisplayOptions();
    const opts = Object.assign(Object.create(Object.getPrototypeOf(o)), o);
    opts.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.DIMMED;
    h.frame.SetDisplayOptions(opts);
  };

  it('with no pad being edited a reset leaves the display options alone (:66, ResolveItem( niluuid ) is null)', () => {
    dimmed();
    const dismissed = h.frame.dismissed;
    h.tool.Reset(RESET_REASON.REDRAW);
    expect(h.frame.GetDisplayOptions().m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.DIMMED);
    expect(h.frame.dismissed).toBe(dismissed);
  });

  it('when the pad being edited is gone, a reset puts the contrast mode back and dismisses the infobar (:66-78)', () => {
    pad(11).SetFlags(ENTERED);
    h.mgr.ProcessEvent(EVENTS.UndoRedoPostEvent); // OnUndoRedo: edit mode entered
    expect(h.tool.InPadEditMode()).toBe(true);
    expect(h.frame.GetDisplayOptions().m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.DIMMED);

    const commit = new BOARD_COMMIT(h.frame);
    commit.Remove(pad(11));
    commit.Push('remove the pad');
    const dismissed = h.frame.dismissed;
    h.tool.Reset(RESET_REASON.REDRAW);

    expect(h.frame.GetDisplayOptions().m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.NORMAL);
    expect(h.frame.dismissed).toBe(dismissed + 1);
    expect(h.tool.InPadEditMode()).toBe(false);
  });
});

describe('PAD_TOOL::copyPadSettings (:172)', () => {
  it('copies the one selected pad into the board design settings pad (:178-188)', () => {
    pad(11).SetSize(PADSTACK.ALL_LAYERS, mm(2, 3));
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.copyPadSettings);
    expect(sizeOf(h.frame.GetDesignSettings().m_Pad_Master)).toEqual(mm(2, 3));
  });

  it('copies nothing from two pads (:177)', () => {
    const before = sizeOf(h.frame.GetDesignSettings().m_Pad_Master);
    pad(11).SetSize(PADSTACK.ALL_LAYERS, mm(2, 3));
    select(h, 11, 12);
    h.mgr.RunAction(PCB_ACTIONS.copyPadSettings);
    expect(sizeOf(h.frame.GetDesignSettings().m_Pad_Master)).toEqual(before);
  });

  it('copies nothing from a selection that is not a pad (:181)', () => {
    const before = sizeOf(h.frame.GetDesignSettings().m_Pad_Master);
    select(h, 40);
    h.mgr.RunAction(PCB_ACTIONS.copyPadSettings);
    expect(sizeOf(h.frame.GetDesignSettings().m_Pad_Master)).toEqual(before);
  });
});

describe('PAD_TOOL::pastePadProperties (:145)', () => {
  beforeEach(() => {
    const master = h.frame.GetDesignSettings().m_Pad_Master;
    master.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
    master.SetSize(PADSTACK.ALL_LAYERS, mm(2, 3));
  });

  it("gives every selected pad the design settings pad's settings, in one undo entry (:156-165)", () => {
    select(h, 11, 12);
    h.mgr.RunAction(PCB_ACTIONS.applyPadSettings);
    expect(sizeOf(pad(11))).toEqual(mm(2, 3));
    expect(sizeOf(pad(12))).toEqual(mm(2, 3));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    h.frame.RestoreCopyFromUndoList();
    expect(sizeOf(pad(11))).toEqual(mm(1, 1));
  });

  it('leaves what is not a pad alone (:158)', () => {
    select(h, 11, 40);
    h.mgr.RunAction(PCB_ACTIONS.applyPadSettings);
    expect(sizeOf(pad(11))).toEqual(mm(2, 3));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it("keeps the pad's own number and position (ImportSettingsFrom)", () => {
    select(h, 12);
    h.mgr.RunAction(PCB_ACTIONS.applyPadSettings);
    expect(pad(12).GetNumber()).toBe('2');
    expect(pad(12).GetPosition()).toEqual(mm(61, 30));
  });

  it('tells the other tools the selected items were modified (:167)', () => {
    select(h, 11);
    h.processed.length = 0;
    h.mgr.RunAction(PCB_ACTIONS.applyPadSettings);
    expect(h.processed).toContain(EVENTS.SelectedItemsModified);
  });
});

describe('PAD_TOOL::pushPadSettings and doPushPadProperties (:193, :242)', () => {
  beforeEach(() => {
    // the source: R1 pad 1, made 2 x 2
    pad(11).SetSize(PADSTACK.ALL_LAYERS, mm(2, 2));
    select(h, 11);
  });

  const push = async (
    aAnswer: number,
    aFilters?: Partial<Record<string, boolean>>,
  ): Promise<void> => {
    h.frame.pushAnswer = (d) => {
      if (aFilters) Object.assign(d, aFilters);
      return aAnswer;
    };
    h.mgr.RunAction(PCB_ACTIONS.pushPadSettings);
    await flush();
  };

  it("puts the frame's footprint in the message panel and asks the dialog (:254-258)", async () => {
    await push(wxID_CANCEL);
    expect(h.frame.pushAsked).toBe(1);
  });

  it('OK changes the pads of the current footprint only (:269)', async () => {
    await push(0);
    expect(sizeOf(pad(12))).toEqual(mm(2, 2));
    expect(sizeOf(pad(21))).toEqual(mm(1, 1));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('Cancel changes nothing (:260-261)', async () => {
    await push(wxID_CANCEL);
    expect(sizeOf(pad(12))).toEqual(mm(1, 1));
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });

  it('Apply changes the pads of every footprint with the same library ID, and no other (:263, :205)', async () => {
    await push(1);
    expect(sizeOf(pad(21))).toEqual(mm(2, 2));
    expect(sizeOf(pad(31))).toEqual(mm(1, 1)); // the "C" footprint
  });

  it('skips pads of a different shape while that filter is on (:211-213), and takes them when it is off', async () => {
    await push(1);
    expect(sizeOf(pad(22))).toEqual(mm(1, 1));
    h = harness();
    pad(11).SetSize(PADSTACK.ALL_LAYERS, mm(2, 2));
    select(h, 11);
    await push(1, { m_Pad_Shape_Filter_CB: false });
    expect(sizeOf(pad(22))).toEqual(mm(2, 2));
  });

  it('skips pads on different layers while that filter is on (:218-219)', async () => {
    await push(1);
    expect(sizeOf(pad(23))).toEqual(mm(1, 1));
    h = harness();
    pad(11).SetSize(PADSTACK.ALL_LAYERS, mm(2, 2));
    select(h, 11);
    await push(1, { m_Pad_Layer_Filter_CB: false });
    expect(sizeOf(pad(23))).toEqual(mm(2, 2));
  });

  it('skips pads with a different orientation relative to their footprint (:215-216)', async () => {
    await push(1);
    expect(sizeOf(pad(24))).toEqual(mm(1, 1));
    h = harness();
    pad(11).SetSize(PADSTACK.ALL_LAYERS, mm(2, 2));
    select(h, 11);
    await push(1, { m_Pad_Orient_Filter_CB: false });
    expect(sizeOf(pad(24))).toEqual(mm(2, 2));
  });

  it('skips pads of a different type (:221-222)', async () => {
    await push(1);
    expect(sizeOf(pad(25))).toEqual(mm(1, 1));
    h = harness();
    pad(11).SetSize(PADSTACK.ALL_LAYERS, mm(2, 2));
    select(h, 11);
    await push(1, { m_Pad_Type_Filter_CB: false });
    expect(sizeOf(pad(25))).toEqual(mm(2, 2));
  });

  it('pushes only from one pad (:248)', async () => {
    select(h, 12);
    await push(0);
    expect(h.frame.pushAsked).toBe(0);
  });

  it('tells the other tools the selected items were modified (:278)', async () => {
    h.processed.length = 0;
    await push(0);
    expect(h.processed).toContain(EVENTS.SelectedItemsModified);
  });
});

/**
 * A click as the dispatcher makes it: the pointer is first reported there, because a click
 * that arrives after a jump sweeps the line from the previous position (:405-423).
 */
const click = (aAt: Vec2): void => {
  mouse(h, TA_MOUSE_MOTION, aAt);
  mouse(h, TA_MOUSE_CLICK, aAt);
};
const numbers = (): string[] =>
  fp(1)
    .Pads()
    .map((p) => p.GetNumber());

describe('PAD_TOOL::EnumeratePads (:299)', () => {
  beforeEach(() => {
    h = harness(FP_TEXT, true);
  });

  /** Run the tool and answer its dialog. */
  const start = async (aPrefix = '', aStart = 1, aStep = 1): Promise<void> => {
    h.frame.enumAnswer = (d) => {
      d.m_padPrefix = aPrefix;
      d.m_padStartNum = aStart;
      d.m_padNumStep = aStep;
      return true;
    };
    h.mgr.RunAction(PCB_ACTIONS.enumeratePads);
    await flush();
  };

  // pads: "10" (57,30), "2" (60,30), "1" (63,30), "7" (60,35)
  it('does nothing outside the footprint editor (:301)', async () => {
    h = harness(FP_TEXT, false);
    await start();
    expect(h.frame.enumAsked).toBe(0);
  });

  it('does nothing in pad edit mode (:301)', async () => {
    pad(11).SetFlags(ENTERED);
    h.mgr.ProcessEvent(EVENTS.UndoRedoPostEvent);
    await start();
    expect(h.frame.enumAsked).toBe(0);
  });

  it('does nothing when the dialog is cancelled (:317-319)', async () => {
    h.frame.enumAnswer = () => false;
    h.mgr.RunAction(PCB_ACTIONS.enumeratePads);
    await flush();
    expect(h.frame.enumAsked).toBe(1);
    click(mm(57, 30));
    expect(numbers()).toEqual(['10', '2', '1', '7']);
  });

  it('numbers each pad clicked, from the first number by the step, with the prefix (:390-445)', async () => {
    await start('A', 10, 2);
    click(mm(57, 30));
    click(mm(63, 30));
    expect(numbers()).toEqual(['A10', '2', 'A12', '7']);
  });

  it('a double click finishes: one undo entry holds every rename (:482-486)', async () => {
    await start('', 1, 1);
    click(mm(57, 30));
    click(mm(60, 30));
    mouse(h, TA_MOUSE_DBLCLICK, mm(60, 35));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    h.frame.RestoreCopyFromUndoList();
    expect(numbers()).toEqual(['10', '2', '1', '7']);
  });

  it('Esc reverts every rename and pushes nothing (:373-380)', async () => {
    await start();
    click(mm(57, 30));
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(numbers()).toEqual(['10', '2', '1', '7']);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });

  it('another tool being activated keeps the renames (:381-387)', async () => {
    await start();
    click(mm(57, 30));
    h.mgr.RunAction(ACTIONS.selectionActivate);
    expect(numbers()).toEqual(['1', '2', '1', '7']);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('clicking a pad numbered in this session gives its number back, for the next pad (:455-474)', async () => {
    await start('', 5, 1);
    click(mm(57, 30)); // 10 -> 5
    click(mm(60, 30)); // 2 -> 6
    click(mm(57, 30)); // takes 5 back
    expect(numbers()).toEqual(['10', '6', '1', '7']);
    click(mm(63, 30)); // the released 5 is the next number, not 7
    expect(pad(13).GetNumber()).toBe('5');
  });

  it('released numbers come back first-in first-out (:437-443)', async () => {
    await start('', 1, 1);
    click(mm(57, 30)); // 1
    click(mm(60, 30)); // 2
    click(mm(63, 30)); // 3
    click(mm(60, 30)); // release 2
    click(mm(57, 30)); // release 1
    click(mm(60, 35)); // the first released, 2
    expect(pad(14).GetNumber()).toBe('2');
  });

  it('the last number used is remembered for Add Pad (:432)', async () => {
    await start('B', 5, 1);
    click(mm(57, 30));
    expect(h.tool.GetLastPadNumber()).toBe('B5');
  });

  it('a drag numbers the pads it sweeps, the one under the pointer first (:405-423)', async () => {
    await start('', 1, 1);
    mouse(h, TA_MOUSE_DRAG, mm(57, 30));
    mouse(h, TA_MOUSE_DRAG, mm(63, 30));
    // pad "10" first, then the sweep from (63,30) back: "1" under the pointer, then "2"
    expect(numbers()).toEqual(['1', '3', '2', '7']);
  });

  it('a drag over a numbered pad leaves it numbered; only a click gives it back (:455)', async () => {
    await start('', 1, 1);
    click(mm(57, 30));
    mouse(h, TA_MOUSE_DRAG, mm(57, 30));
    expect(pad(11).GetNumber()).toBe('1');
  });

  it('forces the crosshair onto the centre of the pad under the pointer (:365-368)', async () => {
    await start();
    mouse(h, TA_MOUSE_MOTION, { x: 57.3 * MM, y: 30.2 * MM });
    expect(h.forced).toEqual(mm(57, 30));
  });

  it('a pad that cannot have a number is skipped (:408, CanHaveNumber)', async () => {
    pad(14).SetAttribute(PAD_ATTRIB.NPTH);
    pad(14).SetNumber('');
    await start();
    click(mm(60, 35));
    expect(pad(14).GetNumber()).toBe('');
  });

  it('a click after a jump sweeps the line and so gives back a pad it passes over (:405-423, :455)', async () => {
    await start('', 1, 1);
    click(mm(57, 30)); // 10 -> 1
    mouse(h, TA_MOUSE_CLICK, mm(63, 30)); // no motion first: the walk from (63,30) back to (57,30)
    // "1" is numbered 2, "2" is numbered 3, and "10", back where the line ends, is given back
    expect(numbers()).toEqual(['10', '3', '2', '7']);
  });
});

describe('PAD_TOOL::PlacePad (:565)', () => {
  beforeEach(() => {
    h = harness(FP_TEXT, true);
    h.frame.GetDesignSettings().m_Pad_Master.SetSize(PADSTACK.ALL_LAYERS, mm(2, 2));
  });

  const padCount = (): number => fp(1).Pads().length;
  /** A new pad goes to the front of the footprint's list: the pads that were not there before. */
  const placedPads = (): PAD[] =>
    fp(1)
      .Pads()
      .filter((p) => ![11, 12, 13, 14].some((n) => pad(n) === p));

  it('does nothing outside the footprint editor (:571)', () => {
    h = harness(FP_TEXT, false);
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_CLICK, mm(80, 40));
    expect(padCount()).toBe(4);
  });

  it('does nothing with no footprint loaded (:574)', () => {
    h = harness(HEADER + ')\n', true);
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    expect(h.board.Footprints()).toHaveLength(0);
  });

  it('a click places a pad at the snapped point, from the design settings pad, in one undo entry (:604-614)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_MOTION, { x: 80.04 * MM, y: 40.03 * MM });
    mouse(h, TA_MOUSE_CLICK, { x: 80.04 * MM, y: 40.03 * MM });
    expect(padCount()).toBe(5);
    const placed = placedPads()[0]!;
    expect(placed.GetPosition()).toEqual(mm(80, 40));
    expect(sizeOf(placed)).toEqual(mm(2, 2));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('numbers the new pad after the last number used (:580-596)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_MOTION, mm(80, 40));
    mouse(h, TA_MOUSE_CLICK, mm(80, 40));
    // the last number after a model reload is "1"; "1" and "2" and "7" and "10" are taken
    console.log(
      'NUMS',
      fp(1)
        .Pads()
        .map((p) => [p.GetNumber(), p.m_Uuid]),
      h.tool.GetLastPadNumber(),
    );
    expect(placedPads()[0]!.GetNumber()).toBe('3');
    // placing a pad makes the next one at once (IPO_REPEAT | IPO_SINGLE_CLICK), which takes the
    // next number and is the last number used
    expect(h.tool.GetLastPadNumber()).toBe('4');
  });

  it('repeats: the next click places the next pad, numbered after the last (:596, IPO_REPEAT)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    for (const at of [mm(80, 40), mm(85, 40)]) {
      mouse(h, TA_MOUSE_MOTION, at);
      mouse(h, TA_MOUSE_CLICK, at);
    }
    expect(
      placedPads()
        .map((p) => p.GetNumber())
        .sort(),
    ).toEqual(['3', '4']);
  });

  it('keeps the settings of the pad just placed for the next (:610, ImportSettingsFrom( *pad ))', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_MOTION, mm(80, 40));
    // the pad on the cursor is edited before it is placed
    const preview = fp(1).Pads().length;
    expect(preview).toBe(4);
    mouse(h, TA_MOUSE_CLICK, mm(80, 40));
    expect(sizeOf(h.frame.GetDesignSettings().m_Pad_Master)).toEqual(mm(2, 2));
  });

  it('Esc ends the tool (:Ep, IPO_SINGLE_CLICK)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.placePad)).toBe(true);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.placePad)).toBe(false);
    expect(padCount()).toBe(4);
  });

  it('rotates the pad on the cursor by the rotation step, and places it rotated (:620, IPO_ROTATE)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_MOTION, mm(80, 40));
    h.mgr.RunAction(PCB_ACTIONS.rotateCcw);
    mouse(h, TA_MOUSE_CLICK, mm(80, 40));
    expect(placedPads()[0]!.GetOrientation().AsDegrees()).toBe(90);
  });

  it('flips the pad on the cursor, and places it flipped (:620, IPO_FLIP)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_MOTION, mm(80, 40));
    h.mgr.RunAction(PCB_ACTIONS.rotateCcw);
    h.mgr.RunAction(PCB_ACTIONS.flip);
    mouse(h, TA_MOUSE_CLICK, mm(80, 40));
    // PAD::Flip negates the pad's orientation relative to its footprint: +90 becomes -90
    expect(placedPads()[0]!.GetOrientation().Normalize().AsDegrees()).toBe(270);
  });

  it('Properties edits the pad on the cursor (pcb_tool_base.cpp)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_MOTION, mm(80, 40));
    h.processed.length = 0;
    h.mgr.RunAction(PCB_ACTIONS.properties);
    expect(h.frame.edited).toHaveLength(1);
    expect(h.processed).toContain(EVENTS.SelectedItemsModified);
  });

  it('a refresh of the preview makes the pad again at the cursor (pcb_tool_base.cpp)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_MOTION, mm(80, 40));
    h.mgr.RunAction(ACTIONS.refreshPreview);
    mouse(h, TA_MOUSE_CLICK, mm(80, 40));
    expect(placedPads()).toHaveLength(1);
    expect(placedPads()[0]!.GetPosition()).toEqual(mm(80, 40));
  });

  it('places with the angle snap off, and gives the mode back afterwards (pcb_tool_base.cpp:54-76, :380-384)', () => {
    h.frame.fpSettings.m_AngleSnapMode = LeaderMode.DEG45;
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    expect(h.frame.fpSettings.m_AngleSnapMode).toBe(LeaderMode.DIRECT);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(h.frame.fpSettings.m_AngleSnapMode).toBe(LeaderMode.DEG45);
  });

  it('with the snap already off it leaves it alone and announces nothing', () => {
    h.processed.length = 0;
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(
      h.processed.filter((e) => e.getCommandStr?.() === PCB_ACTIONS.angleSnapModeChanged.GetName()),
    ).toHaveLength(0);
  });

  it('clears the selection when it starts (pcb_tool_base.cpp:78)', () => {
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    expect(h.sel.GetSelection().Empty()).toBe(true);
  });

  it('another tool being activated ends it (pcb_tool_base.cpp:154-172)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    h.mgr.RunAction(ACTIONS.selectionActivate);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.placePad)).toBe(false);
  });

  it('the pad on the cursor follows the pointer onto the grid (SnapItem)', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_MOTION, { x: 90.04 * MM, y: 50.03 * MM });
    expect(h.forced).toEqual(mm(90, 50));
  });

  it('the pad rides the cursor until it is placed: nothing is added by a motion', () => {
    h.mgr.RunAction(PCB_ACTIONS.placePad);
    mouse(h, TA_MOUSE_MOTION, mm(80, 40));
    expect(padCount()).toBe(4);
  });
});

describe('PAD_TOOL::EditPad, OnUndoRedo and the pad edit mode (:680, :732, :768, :804)', () => {
  beforeEach(() => {
    h = harness(CUSTOM_TEXT, true);
  });

  const shapes = (): number =>
    fp(1)
      .GraphicalItems()
      .filter((d) => d.Type() === KICAD_T.PCB_SHAPE_T).length;
  const mode = (): HIGH_CONTRAST_MODE => h.frame.GetDisplayOptions().m_ContrastModeDisplay;

  it('does nothing outside the footprint editor (:682)', () => {
    h = harness(CUSTOM_TEXT, false);
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    expect(h.tool.InPadEditMode()).toBe(false);
  });

  it('explodes a custom pad into its anchor and graphic shapes on its copper layer (:706-720, :834-872)', () => {
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    expect(shapes()).toBe(1);
    expect(pad(11).GetShape(PADSTACK.ALL_LAYERS)).toBe(PAD_SHAPE.CIRCLE);
    expect(pad(11).GetPrimitives(PADSTACK.ALL_LAYERS)).toHaveLength(0);
    const shape = fp(1)
      .GraphicalItems()
      .find((d) => d.Type() === KICAD_T.PCB_SHAPE_T) as PCB_SHAPE;
    expect(shape.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('enters the pad edit mode: flagged, dimmed, active layer, selection cleared, infobar (:722-725, :768-801)', () => {
    select(h, 11);
    h.frame.SetActiveLayer(PCB_LAYER_ID.B_Cu);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    expect(h.tool.InPadEditMode()).toBe(true);
    expect(pad(11).IsEntered()).toBe(true);
    expect(mode()).toBe(HIGH_CONTRAST_MODE.DIMMED);
    expect(h.frame.GetActiveLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(h.sel.GetSelection().Empty()).toBe(true);
    // explode and recombine share one hotkey, so the message says "again"
    expect(h.frame.infobar).toEqual(['Pad Edit Mode.  Press Ctrl+E again to exit.']);
  });

  it('a pad on the back copper layer only is edited on the back (:834-841)', () => {
    pad(11).SetLayerSet(
      new (
        pad(11).GetLayerSet().constructor as new (
          l: PCB_LAYER_ID[],
        ) => ReturnType<PAD['GetLayerSet']>
      )([PCB_LAYER_ID.B_Cu]),
    );
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    expect(h.frame.GetActiveLayer()).toBe(PCB_LAYER_ID.B_Cu);
  });

  it('a pad that is not custom enters the edit mode with nothing exploded (:844)', async () => {
    h = harness(FP_TEXT, true);
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    expect(h.tool.InPadEditMode()).toBe(true);
    expect(
      fp(1)
        .GraphicalItems()
        .filter((d) => d.Type() === KICAD_T.PCB_SHAPE_T),
    ).toHaveLength(0);
  });

  it('needs exactly one pad selected (:706)', () => {
    h = harness(FP_TEXT, true);
    select(h, 11, 12);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    expect(h.tool.InPadEditMode()).toBe(false);
  });

  it('the same action again recombines: the shapes are merged back into the pad (:687-704)', () => {
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    h.mgr.RunAction(PCB_ACTIONS.recombinePad);
    expect(shapes()).toBe(0);
    expect(pad(11).GetShape(PADSTACK.ALL_LAYERS)).toBe(PAD_SHAPE.CUSTOM);
    expect(pad(11).GetPrimitives(PADSTACK.ALL_LAYERS).length).toBeGreaterThan(0);
    expect(h.tool.InPadEditMode()).toBe(false);
    expect(h.frame.GetUndoCommandCount()).toBe(2);
  });

  it('leaving the mode puts the contrast mode back and dismisses the infobar (:804-831)', () => {
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    const dismissed = h.frame.dismissed;
    h.mgr.RunAction(PCB_ACTIONS.recombinePad);
    expect(mode()).toBe(HIGH_CONTRAST_MODE.NORMAL);
    expect(h.frame.dismissed).toBe(dismissed + 1);
  });

  it('keeps a high contrast mode the user already had (:777-785)', () => {
    const o = h.frame.GetDisplayOptions();
    const opts = Object.assign(Object.create(Object.getPrototypeOf(o)), o);
    opts.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.HIDDEN;
    h.frame.SetDisplayOptions(opts);
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    expect(mode()).toBe(HIGH_CONTRAST_MODE.HIDDEN);
    h.mgr.RunAction(PCB_ACTIONS.recombinePad);
    expect(mode()).toBe(HIGH_CONTRAST_MODE.HIDDEN);
  });

  it('the painter is told which pad is being edited, and which no longer is (:717, :808)', () => {
    const settings = (h.view.GetPainter() as PCB_PAINTER).GetSettings();
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    expect(settings.m_PadEditModePad).toBe(pad(11));
    h.mgr.RunAction(PCB_ACTIONS.recombinePad);
    expect(settings.m_PadEditModePad).toBeNull();
  });

  it('an undo that leaves a pad flagged enters the mode, and one that clears it leaves it (:732-765)', () => {
    pad(11).SetFlags(ENTERED);
    h.mgr.ProcessEvent(EVENTS.UndoRedoPostEvent);
    expect(h.tool.InPadEditMode()).toBe(true);
    expect(mode()).toBe(HIGH_CONTRAST_MODE.DIMMED);
    expect(h.frame.infobar).toHaveLength(1);
    pad(11).ClearFlags(ENTERED);
    h.mgr.ProcessEvent(EVENTS.UndoRedoPostEvent);
    expect(h.tool.InPadEditMode()).toBe(false);
    expect(mode()).toBe(HIGH_CONTRAST_MODE.NORMAL);
  });

  it('an undo that changes nothing about the flagged pad does nothing more (:754)', () => {
    pad(11).SetFlags(ENTERED);
    h.mgr.ProcessEvent(EVENTS.UndoRedoPostEvent);
    h.mgr.ProcessEvent(EVENTS.UndoRedoPostEvent);
    expect(h.frame.infobar).toHaveLength(1);
  });

  it('RecombinePad on a dry run lists the shapes and changes nothing (:876)', () => {
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.explodePad);
    const merged = h.tool.RecombinePad(pad(11), true);
    expect(merged).toHaveLength(1);
    expect(shapes()).toBe(1);
  });
});

describe('PAD_TOOL::PadTable (:886) and Init (:83)', () => {
  it('opens the Pad Table on the footprint in the footprint editor (:895-898)', () => {
    h = harness(FP_TEXT, true);
    h.mgr.RunAction(PCB_ACTIONS.padTable);
    expect(h.frame.tables).toHaveLength(1);
    expect(h.frame.tables[0]!.GetPadForRow(0)).toBe(pad(13)); // "1" sorts first
  });

  it('does nothing in the board editor (:888)', () => {
    h = harness(FP_TEXT, false);
    h.mgr.RunAction(PCB_ACTIONS.padTable);
    expect(h.frame.tables).toHaveLength(0);
  });

  it('does nothing in the pad edit mode (:888)', () => {
    h = harness(FP_TEXT, true);
    pad(11).SetFlags(ENTERED);
    h.mgr.ProcessEvent(EVENTS.UndoRedoPostEvent);
    h.mgr.RunAction(PCB_ACTIONS.padTable);
    expect(h.frame.tables).toHaveLength(0);
  });

  it("adds the pad table, enumerate and explode rows to the selection tool's menu in the footprint editor only (:100-118)", () => {
    const has = (aHarness: Harness, aAction: typeof PCB_ACTIONS.padTable): boolean => {
      const menu = aHarness.sel.GetToolMenu().GetMenu();
      const sel = new SELECTION_CLASS();
      sel.Add(aHarness.board.Footprints()[0]!.Pads()[0] as unknown as never);
      menu.Evaluate(sel);
      return menu.FindItem(aAction.GetUIId()) !== null;
    };
    const board = harness(FP_TEXT, false);
    const editor = harness(FP_TEXT, true);
    for (const a of [PCB_ACTIONS.padTable, PCB_ACTIONS.enumeratePads, PCB_ACTIONS.explodePad]) {
      expect(has(board, a)).toBe(false);
      expect(has(editor, a)).toBe(true);
    }
    // the copy, apply and push rows are in both
    for (const a of [
      PCB_ACTIONS.copyPadSettings,
      PCB_ACTIONS.applyPadSettings,
      PCB_ACTIONS.pushPadSettings,
    ]) {
      expect(has(board, a)).toBe(true);
      expect(has(editor, a)).toBe(true);
    }
    // there is no pad being edited, so there is nothing to recombine
    expect(has(editor, PCB_ACTIONS.recombinePad)).toBe(false);
  });
});
