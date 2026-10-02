// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_CONTROL's grid origin, Interactive Delete and board tables
 * (pcb_control.cpp:757-1008, 1971-2083, 2907-2942) and BOARD_EDITOR_CONTROL's
 * drill origin (board_editor_control.cpp:2235-2281), through PCB_PICKER_TOOL
 * and EDIT_TOOL on the live BOARD.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { BUT_LEFT, TA_MOUSE_CLICK, TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { BOARD_EDITOR_CONTROL } from '@ziroeda/pcbnew/tools/board_editor_control.js';
import { EDIT_TOOL } from '@ziroeda/pcbnew/tools/edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_CONTROL } from '@ziroeda/pcbnew/tools/pcb_control.js';
import { PCB_PICKER_TOOL } from '@ziroeda/pcbnew/tools/pcb_picker_tool.js';
import {
  byUuid,
  mm,
  mouse,
  select,
  type TOOL_HARNESS,
  toolHarness,
} from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (gr_line (start 10 10) (end 30 10) (stroke (width 0.2) (type solid)) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000001"))
  (gr_line (start 10 40) (end 30 40) (stroke (width 0.2) (type solid)) (layer "F.SilkS") (locked yes) (uuid "00000000-0000-4000-8000-000000000002"))
)
`;

/** The page dialog's answer: the paper OK writes, or null for Cancel. */
let pagePaper: string | null = null;

/** What the footprint chooser answers: a library footprint, or null for Cancel. */
let chosenFootprint: (() => FOOTPRINT) | null = null;

const LIB_FOOTPRINT = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "")
  (net 1 "LIBNET")
  (footprint "Lib:R" (layer "F.Cu") (at 0 0) (uuid "00000000-0000-4000-8000-0000000000aa")
    (property "Reference" "R?" (at 0 -2 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-0000000000ab"))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "LIBNET") (uuid "00000000-0000-4000-8000-0000000000ac"))
  )
)`;

const libFootprint = (): FOOTPRINT => {
  const lib = ParseBoard(LIB_FOOTPRINT);
  const fp = lib.Footprints()[0]!;
  // the pad still carries the library board's net, as a library pad can
  expect(fp.Pads()[0]!.GetNetCode()).toBe(1);
  lib.Remove(fp);
  return fp;
};

class PAGE_FRAME extends TEST_PCB_FRAME {
  SelectFootprintFromLibrary(): Promise<FOOTPRINT | null> {
    return Promise.resolve(chosenFootprint ? chosenFootprint() : null);
  }

  override ShowPageSettingsDialog(): Promise<boolean> {
    if (pagePaper === null) return Promise.resolve(false);
    const page = new PAGE_INFO();
    page.SetType(pagePaper);
    this.SetPageSettings(page);
    const tb = new TITLE_BLOCK();
    tb.SetTitle('NEW TITLE');
    this.SetTitleBlock(tb);
    return Promise.resolve(true);
  }
}

let h: TOOL_HARNESS<TEST_PCB_FRAME>;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new PAGE_FRAME(aBoard),
    () => [new PCB_PICKER_TOOL(), new EDIT_TOOL(), new PCB_CONTROL(), new BOARD_EDITOR_CONTROL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  pagePaper = null;
  chosenFootprint = null;
});

const click = (p: Vec2): void => {
  mouse(h, TA_MOUSE_MOTION, p);
  mouse(h, TA_MOUSE_CLICK, p, BUT_LEFT);
};
const start = (aAction: TOOL_ACTION): void => {
  const evt = aAction.MakeEvent();
  evt.SetHasPosition(false);
  h.mgr.ProcessEvent(evt);
};
const bds = () => h.board.GetDesignSettings();
const shapes = (): PCB_SHAPE[] => h.board.Drawings() as unknown as PCB_SHAPE[];

describe('PCB_CONTROL::GridPlaceOrigin / GridResetOrigin', () => {
  it('one click places the grid origin, then the picker pops; one undo puts it back (:768-806)', () => {
    start(ACTIONS.gridSetOrigin);
    expect(h.frame.IsCurrentTool(ACTIONS.gridSetOrigin)).toBe(true);
    click(mm(12, 34));
    expect(bds().GetGridOrigin()).toEqual(mm(12, 34));
    expect(h.frame.IsCurrentTool(ACTIONS.gridSetOrigin)).toBe(false);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    h.frame.RestoreCopyFromUndoList();
    expect(bds().GetGridOrigin()).toEqual({ x: 0, y: 0 });
    // Redo: the undo swapped the image's position with the marker's (:590-592).
    h.frame.RestoreCopyFromRedoList();
    expect(bds().GetGridOrigin()).toEqual(mm(12, 34));
  });

  it('a stated origin is set with no undo step (:772-777)', () => {
    h.mgr.RunAction(ACTIONS.gridSetOrigin, mm(5, 6));
    expect(bds().GetGridOrigin()).toEqual(mm(5, 6));
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });

  it('reset puts it at (0, 0), undoably (:809-814)', () => {
    h.mgr.RunAction(ACTIONS.gridSetOrigin, mm(5, 6));
    h.mgr.RunAction(ACTIONS.gridResetOrigin);
    expect(bds().GetGridOrigin()).toEqual({ x: 0, y: 0 });
    h.frame.RestoreCopyFromUndoList();
    expect(bds().GetGridOrigin()).toEqual(mm(5, 6));
  });
});

describe('BOARD_EDITOR_CONTROL::DrillOrigin', () => {
  it('one click places the drill/place origin; undo puts it back (:2262-2278)', () => {
    start(PCB_ACTIONS.drillOrigin);
    click(mm(20, 25));
    expect(bds().GetAuxOrigin()).toEqual(mm(20, 25));
    expect(bds().GetGridOrigin()).toEqual({ x: 0, y: 0 });
    h.frame.RestoreCopyFromUndoList();
    expect(bds().GetAuxOrigin()).toEqual({ x: 0, y: 0 });
  });

  it('reset puts it at (0, 0) (:2247-2252)', () => {
    start(PCB_ACTIONS.drillOrigin);
    click(mm(20, 25));
    h.mgr.RunAction(PCB_ACTIONS.drillResetOrigin);
    expect(bds().GetAuxOrigin()).toEqual({ x: 0, y: 0 });
  });
});

describe('PCB_CONTROL::InteractiveDelete (:820-1008)', () => {
  it('each click deletes the item under the cursor, and the tool stays (:839-867)', () => {
    start(ACTIONS.deleteTool);
    click(mm(20, 10));
    expect(shapes()).toHaveLength(1);
    expect(h.frame.IsCurrentTool(ACTIONS.deleteTool)).toBe(true);
    click(mm(80, 80));
    expect(shapes()).toHaveLength(1);
  });

  it('a locked item is refused (:841-848)', () => {
    // With "Locked items" ticked in the selection filter, so the picker does
    // pick it up and the click reaches the locked test.
    h.sel.GetFilter().lockedItems = true;
    start(ACTIONS.deleteTool);
    click(mm(20, 40));
    expect(shapes()).toHaveLength(2);
  });

  it('Esc leaves the tool', () => {
    start(ACTIONS.deleteTool);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(h.frame.IsCurrentTool(ACTIONS.deleteTool)).toBe(false);
  });
});

describe('PCB_CONTROL::PlaceStackup / PlaceCharacteristics (:2907-2942)', () => {
  const tables = () => h.board.Drawings().filter((d) => d.Type() === KICAD_T.PCB_TABLE_T);

  it('the table rides the cursor from its origin through EDIT_TOOL::Move; a click commits it, one undo (:1971-2083)', () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_SilkS);
    h.mouse = mm(50, 50);
    start(PCB_ACTIONS.placeStackup);
    expect(tables()).toHaveLength(0);
    mouse(h, TA_MOUSE_MOTION, mm(60, 70));
    click(mm(60, 70));
    expect(tables()).toHaveLength(1);
    const t = tables()[0]!;
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    // anchored at its own origin, which is where the cursor put it
    expect(t.GetPosition()).toEqual(mm(60, 70));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    expect(h.frame.GetUndoActionDescription()).toBe('Place Board Stackup Table');
  });

  it('Esc during the move places nothing', () => {
    start(PCB_ACTIONS.placeCharacteristics);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(tables()).toHaveLength(0);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });
});

describe('BOARD_EDITOR_CONTROL::modifyLockSelected (board_editor_control.cpp:1540-1631)', () => {
  const line = (n: number) => byUuid(h.board, n);

  it('Lock and Unlock set the selection, one undo step each', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.lock);
    expect(line(1).IsLocked()).toBe(true);
    expect(h.frame.GetUndoActionDescription()).toBe('Lock');
    h.mgr.RunAction(PCB_ACTIONS.unlock);
    expect(line(1).IsLocked()).toBe(false);
    expect(h.frame.GetUndoActionDescription()).toBe('Unlock');
    h.frame.RestoreCopyFromUndoList();
    expect(line(1).IsLocked()).toBe(true);
  });

  it('Toggle unlocks everything when any of the selection is locked, else locks all (:1557-1574)', () => {
    h.sel.GetFilter().lockedItems = true;
    select(h, 1, 2);
    h.mgr.RunAction(PCB_ACTIONS.toggleLock);
    expect(line(1).IsLocked()).toBe(false);
    expect(line(2).IsLocked()).toBe(false);
    h.mgr.RunAction(PCB_ACTIONS.toggleLock);
    expect(line(1).IsLocked()).toBe(true);
    expect(line(2).IsLocked()).toBe(true);
  });

  it('nothing selected and nothing under the cursor: no commit', () => {
    h.mouse = mm(90, 90);
    h.mgr.RunAction(PCB_ACTIONS.lock);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });
});

describe('BOARD_EDITOR_CONTROL::PageSettings (board_editor_control.cpp:520-560)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it('OK keeps what the dialog wrote, as one "Page Settings" step that undo and redo swap', async () => {
    pagePaper = 'A3';
    h.mgr.RunAction(ACTIONS.pageSettings);
    await flush();
    expect(h.board.GetPageSettings().GetTypeAsString()).toBe('A3');
    expect(h.board.GetTitleBlock().GetTitle()).toBe('NEW TITLE');
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    expect(h.frame.GetUndoActionDescription()).toBe('Page Settings');

    h.frame.RestoreCopyFromUndoList();
    expect(h.board.GetPageSettings().GetTypeAsString()).toBe('A4');
    expect(h.board.GetTitleBlock().GetTitle()).toBe('');

    h.frame.RestoreCopyFromRedoList();
    expect(h.board.GetPageSettings().GetTypeAsString()).toBe('A3');
    expect(h.board.GetTitleBlock().GetTitle()).toBe('NEW TITLE');
  });

  it('Cancel rolls the saved undo step back off the list (RollbackFromUndo)', async () => {
    pagePaper = null;
    h.mgr.RunAction(ACTIONS.pageSettings);
    await flush();
    expect(h.board.GetPageSettings().GetTypeAsString()).toBe('A4');
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });
});

describe('BOARD_EDITOR_CONTROL::PlaceFootprint (board_editor_control.cpp:1359-1560)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it('the chooser opens at once; the footprint rides the cursor; a click commits it and the tool stays', async () => {
    chosenFootprint = libFootprint;
    h.mouse = mm(20, 20);
    start(PCB_ACTIONS.placeFootprint);
    await flush();
    expect(h.board.Footprints()).toHaveLength(0);
    mouse(h, TA_MOUSE_MOTION, mm(40, 30));
    click(mm(40, 30));
    expect(h.board.Footprints()).toHaveLength(1);
    const fp = h.board.Footprints()[0]!;
    expect(fp.GetPosition()).toEqual(mm(40, 30));
    expect(fp.Pads()[0]!.GetNetCode()).toBe(0);
    expect(h.frame.GetUndoActionDescription()).toBe('Place Footprint');
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.placeFootprint)).toBe(true);
  });

  it('Esc drops a riding footprint and keeps the tool; a second Esc leaves (:1424-1435)', async () => {
    chosenFootprint = libFootprint;
    start(PCB_ACTIONS.placeFootprint);
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(h.board.Footprints()).toHaveLength(0);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.placeFootprint)).toBe(true);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.placeFootprint)).toBe(false);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });

  it('a cancelled chooser leaves the tool waiting for a click (:1468-1469)', async () => {
    chosenFootprint = null;
    start(PCB_ACTIONS.placeFootprint);
    await flush();
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.placeFootprint)).toBe(true);
    expect(h.board.Footprints()).toHaveLength(0);
  });
});
