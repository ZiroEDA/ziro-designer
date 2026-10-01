// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * EDIT_TOOL (pcbnew/tools/edit_tool.cpp, edit_tool_move_fct.cpp) driven
 * through the tool manager on a live BOARD, with the TOOL_EVENTs the
 * dispatcher makes. KiCad's qa has no suite for this tool; each expectation is
 * read off the C++ line it cites.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_CLICK, TA_MOUSE_DOWN, TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import {
  EDIT_TOOL,
  type EDIT_TOOL_FRAME,
  type MOVE_EXACT_VALUES,
} from '@ziroeda/pcbnew/tools/edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_PICKER_TOOL } from '@ziroeda/pcbnew/tools/pcb_picker_tool.js';
import { PCB_POINT_EDITOR } from '@ziroeda/pcbnew/tools/pcb_point_editor.js';
import {
  byUuid,
  ids,
  MM,
  mm,
  mouse,
  select,
  type TOOL_HARNESS,
  toolHarness,
  U,
} from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

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
  (segment (start 20 10) (end 20 20) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(21)}"))
  (segment (start 100 100) (end 110 100) (width 0.25) (layer "F.Cu") (locked yes) (net 2) (uuid "${U(22)}"))
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(30)}"))
  (gr_line (start 30 40) (end 30 45) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(31)}"))
  (gr_rect (start 40 50) (end 50 60) (stroke (width 0.1) (type solid)) (fill no) (layer "F.SilkS") (uuid "${U(32)}"))
  (gr_rect (start 45 55) (end 55 65) (stroke (width 0.1) (type solid)) (fill no) (layer "F.SilkS") (uuid "${U(33)}"))
  (gr_text "A1" (at 70 70 0) (layer "F.SilkS") (uuid "${U(40)}")
    (effects (font (size 1 1) (thickness 0.15))))
)
`;

/** The frame, with the dialogs EDIT_TOOL asks for answered by the test. */
class EDIT_FRAME extends TEST_PCB_FRAME implements EDIT_TOOL_FRAME {
  infobar: string[] = [];
  unitEntryAnswer: number | null = null;
  unitEntryAsked: string[] = [];
  moveExactAnswer: ((v: MOVE_EXACT_VALUES) => MOVE_EXACT_VALUES | null) | null = null;
  connectedPadAnswer: 'ignore' | 'all' | null = 'ignore';
  edited: BOARD_ITEM[] = [];

  ShowUnitEntryDialog(aTitle: string, aLabel: string, _aValue: number): Promise<number | null> {
    this.unitEntryAsked.push(`${aTitle}|${aLabel}`);
    return Promise.resolve(this.unitEntryAnswer);
  }
  ShowDogboneDialog(): Promise<null> {
    return Promise.resolve(null);
  }
  ShowMoveExactDialog(aValues: MOVE_EXACT_VALUES): Promise<MOVE_EXACT_VALUES | null> {
    return Promise.resolve(this.moveExactAnswer ? this.moveExactAnswer(aValues) : null);
  }
  ShowTrackViaPropertiesDialog(): Promise<void> {
    return Promise.resolve();
  }
  ShowTableCellPropertiesDialog(): Promise<boolean> {
    return Promise.resolve(false);
  }
  ShowTablePropertiesDialog(): Promise<void> {
    return Promise.resolve();
  }
  ShowGetFootprintByNameDialog(): Promise<string | null> {
    return Promise.resolve('c1');
  }
  ShowConnectedPadDialog(): Promise<'ignore' | 'all' | null> {
    return Promise.resolve(this.connectedPadAnswer);
  }
  OpenVertexEditor(): void {}
  ShowInfoBarMsg(aMsg: string): void {
    this.infobar.push(aMsg);
  }
  ShowInfoBarError(aMsg: string): void {
    this.infobar.push(`error: ${aMsg}`);
  }
  OnEditItemRequest(aItem: BOARD_ITEM): void {
    this.edited.push(aItem);
  }
}

interface Harness extends TOOL_HARNESS<EDIT_FRAME> {
  edit: EDIT_TOOL;
}

function harness(): Harness {
  let edit: EDIT_TOOL | null = null;
  const h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new EDIT_FRAME(aBoard),
    () => {
      edit = new EDIT_TOOL();
      return [new PCB_POINT_EDITOR(), edit, new PCB_PICKER_TOOL()];
    },
  );

  return Object.assign(h, { edit: edit! });
}

const track = (h: Harness, n: number): PCB_TRACK => byUuid(h.board, n) as PCB_TRACK;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let h: Harness;

beforeEach(() => {
  h = harness();
});

describe('EDIT_TOOL::Rotate (edit_tool.cpp:2226)', () => {
  it('turns a lone item about its own position, by the frame rotation step, into one undo entry', () => {
    select(h, 20);
    h.mgr.RunAction(PCB_ACTIONS.rotateCcw);
    // refPt = the item's position (updateModificationPoint, :3385-3391) = the track start
    const t = track(h, 20);
    expect(t.GetStart()).toEqual(mm(10, 10));
    // +90 degrees counter-clockwise in KiCad's y-down world: (20,10) -> (10,0)
    expect(t.GetEnd()).toEqual(mm(10, 0));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('rotateCw turns the other way (the action parameter is -1)', () => {
    select(h, 20);
    h.mgr.RunAction(PCB_ACTIONS.rotateCw);
    expect(track(h, 20).GetEnd()).toEqual(mm(10, 20));
  });

  it('a hover selection is cleared after the rotation (:2369-2370)', () => {
    h.mouse = mm(15, 10);
    h.mgr.RunAction(PCB_ACTIONS.rotateCcw);
    expect(track(h, 20).GetEnd()).toEqual(mm(10, 0));
    expect(h.sel.GetSelection().Empty()).toBe(true);
  });

  it('a locked item is not rotated (FilterCollectorForLockedItems)', () => {
    select(h, 22);
    h.mgr.RunAction(PCB_ACTIONS.rotateCcw);
    expect(track(h, 22).GetEnd()).toEqual(mm(110, 100));
  });
});

describe('EDIT_TOOL::Flip (edit_tool.cpp:2635)', () => {
  it('flips a lone footprint about its own anchor to the back', () => {
    select(h, 1);
    h.mgr.RunAction(PCB_ACTIONS.flip);
    const fp = byUuid(h.board, 1) as FOOTPRINT;
    expect(fp.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(fp.GetPosition()).toEqual(mm(60, 30));
  });
});

describe('EDIT_TOOL::Mirror (edit_tool.cpp:2423)', () => {
  it('skips footprints with the infobar message, and mirrors the rest', () => {
    select(h, 1, 30);
    h.mgr.RunAction(PCB_ACTIONS.mirrorH);
    expect(h.frame.infobar).toEqual([
      'Footprints cannot be mirrored. Use Flip to move them to the other side of the board.',
    ]);
    expect((byUuid(h.board, 1) as FOOTPRINT).GetPosition()).toEqual(mm(60, 30));
    // the line is mirrored about the grid-snapped selection centre
    const line = byUuid(h.board, 30) as PCB_SHAPE;
    expect(line.GetStart()).not.toEqual(mm(10, 50));
  });
});

describe('EDIT_TOOL::Remove / DeleteItems (edit_tool.cpp:2738, :2916)', () => {
  it('deletes the selected track in one "Delete" entry', () => {
    const t = track(h, 21);
    select(h, 21);
    h.mgr.RunAction(ACTIONS.doDelete);
    expect(h.board.Tracks().includes(t)).toBe(false);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('a footprint field is hidden, not deleted', () => {
    select(h, 2);
    h.mgr.RunAction(ACTIONS.doDelete);
    const fp = byUuid(h.board, 1) as FOOTPRINT;
    expect(fp.GetField('Reference')!.IsVisible()).toBe(false);
  });

  it('a hidden field reports that fields go through Footprint Properties', () => {
    select(h, 3);
    h.mgr.RunAction(ACTIONS.doDelete);
    expect(h.frame.infobar).toEqual([
      'error: Use the Footprint Properties dialog to remove fields.',
    ]);
  });
});

describe('EDIT_TOOL::Move (edit_tool_move_fct.cpp:741, doMoveSelection :820)', () => {
  it('drags the selection with the cursor and drops it on a click, as one "Move" entry', () => {
    select(h, 20);
    h.mouse = mm(15, 10);
    h.mgr.RunAction(PCB_ACTIONS.move);
    mouse(h, TA_MOUSE_MOTION, mm(15, 20));
    mouse(h, TA_MOUSE_CLICK, mm(15, 20));
    const t = track(h, 20);
    expect(t.GetStart()).toEqual(mm(10, 20));
    expect(t.GetEnd()).toEqual(mm(20, 20));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    // the originally selected items are selected again (:1525-1526)
    expect(ids(h.sel.GetSelection().GetItems())).toEqual(ids([t]));
  });

  it('a cancel puts everything back and pushes nothing', () => {
    select(h, 20);
    h.mouse = mm(15, 10);
    h.mgr.RunAction(PCB_ACTIONS.move);
    mouse(h, TA_MOUSE_MOTION, mm(15, 20));
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(track(h, 20).GetStart()).toEqual(mm(10, 10));
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });

  it('rotating mid-move joins the move rather than pushing its own entry (:2366)', () => {
    select(h, 20);
    h.mouse = mm(15, 10);
    h.mgr.RunAction(PCB_ACTIONS.move);
    mouse(h, TA_MOUSE_MOTION, mm(15, 20));
    h.mgr.RunAction(PCB_ACTIONS.rotateCcw);
    mouse(h, TA_MOUSE_CLICK, mm(15, 20));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    const t = track(h, 20);
    // rotated about the drag reference point, which is the cursor
    expect(t.GetStart().x).toBe(t.GetEnd().x);
  });
});

describe('EDIT_TOOL::Duplicate (edit_tool.cpp:3090)', () => {
  it('duplicates, picks the copy up and drops it; the original stays', () => {
    select(h, 30);
    h.mouse = mm(15, 50);
    h.mgr.RunAction(ACTIONS.duplicate);
    mouse(h, TA_MOUSE_MOTION, mm(15, 55));
    mouse(h, TA_MOUSE_CLICK, mm(15, 55));
    const lines = h.board
      .Drawings()
      .filter((d) => d.Type() === KICAD_T.PCB_SHAPE_T && (d as PCB_SHAPE).GetStart().x === 10 * MM);
    expect(lines.map((l) => (l as PCB_SHAPE).GetStart().y).sort()).toEqual([50 * MM, 55 * MM]);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });
});

describe('EDIT_TOOL::MoveExact (edit_tool.cpp:3000)', () => {
  it('moves by the dialog translation in one "Move Exactly" entry', async () => {
    h.frame.moveExactAnswer = (v) => ({ ...v, translation: mm(5, 0) });
    select(h, 21);
    h.mgr.RunAction(PCB_ACTIONS.moveExact);
    await flush();
    expect(track(h, 21).GetStart()).toEqual(mm(25, 10));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('a cancelled dialog changes nothing', async () => {
    h.frame.moveExactAnswer = () => null;
    select(h, 21);
    h.mgr.RunAction(PCB_ACTIONS.moveExact);
    await flush();
    expect(track(h, 21).GetStart()).toEqual(mm(20, 10));
  });

  it('rotates about each item anchor with one item selected', async () => {
    h.frame.moveExactAnswer = (v) => ({ ...v, rotation: ANGLE_90 });
    select(h, 21);
    h.mgr.RunAction(PCB_ACTIONS.moveExact);
    await flush();
    const t = track(h, 21);
    expect(t.GetStart()).toEqual(mm(20, 10));
    expect(t.GetEnd()).toEqual(mm(30, 10));
  });
});

describe('EDIT_TOOL::Swap (edit_tool_move_fct.cpp:107)', () => {
  it('swaps two footprints positions and orientations', () => {
    select(h, 1, 7);
    h.mgr.RunAction(PCB_ACTIONS.swap);
    const r1 = byUuid(h.board, 1) as FOOTPRINT;
    const c1 = byUuid(h.board, 7) as FOOTPRINT;
    expect(r1.GetPosition()).toEqual(mm(80, 40));
    expect(c1.GetPosition()).toEqual(mm(60, 30));
    expect(r1.GetOrientation().AsDegrees()).toBe(90);
    expect(c1.GetOrientation().AsDegrees()).toBe(0);
  });
});

describe('EDIT_TOOL::SwapPadNets (edit_tool_move_fct.cpp:226)', () => {
  it('rotates the nets of the selected pads, the connected tracks following', async () => {
    select(h, 5, 6);
    h.mgr.RunAction(PCB_ACTIONS.swapPadNets);
    await flush();
    const p1 = byUuid(h.board, 5) as PAD;
    const p2 = byUuid(h.board, 6) as PAD;
    expect([p1.GetNetCode(), p2.GetNetCode()]).toEqual([2, 1]);
  });
});

describe('EDIT_TOOL::ChangeTrackWidth (edit_tool.cpp:1136)', () => {
  it('sets the current track width from the design settings', () => {
    h.board.GetDesignSettings().SetTrackWidthIndex(0);
    const w = h.board.GetDesignSettings().GetCurrentTrackWidth();
    select(h, 20);
    h.mgr.RunAction(PCB_ACTIONS.changeTrackWidth);
    expect(track(h, 20).GetWidth()).toBe(w);
  });
});

describe('EDIT_TOOL::FilletTracks (edit_tool.cpp:1278)', () => {
  it('fewer than two tracks is refused with the infobar message', () => {
    select(h, 20);
    h.mgr.RunAction(PCB_ACTIONS.filletTracks);
    expect(h.frame.infobar).toEqual(['At least two straight track segments must be selected.']);
  });

  it('adds a tangent arc of the radius between two connected tracks and shortens both', async () => {
    h.frame.unitEntryAnswer = 1 * MM;
    select(h, 20, 21);
    h.mgr.RunAction(PCB_ACTIONS.filletTracks);
    await flush();
    const arcs = h.board.Tracks().filter((t) => t.Type() === KICAD_T.PCB_ARC_T);
    expect(arcs).toHaveLength(1);
    expect(track(h, 20).GetEnd()).toEqual(mm(19, 10));
    expect(track(h, 21).GetStart()).toEqual(mm(20, 11));
  });
});

describe('EDIT_TOOL::ModifyLines (edit_tool.cpp:1570)', () => {
  it('extend: exactly two lines are needed', () => {
    select(h, 30);
    h.mgr.RunAction(PCB_ACTIONS.extendLines);
    expect(h.frame.infobar).toEqual(['Exactly two lines must be selected to extend them.']);
  });

  it('extend: two lines that do not meet are extended to their intersection', () => {
    select(h, 30, 31);
    h.mgr.RunAction(PCB_ACTIONS.extendLines);
    const a = byUuid(h.board, 30) as PCB_SHAPE;
    const b = byUuid(h.board, 31) as PCB_SHAPE;
    // (10,50)-(20,50) and (30,40)-(30,45) meet at (30,50)
    // each keeps the end further from the meeting point (item_modification_routine.cpp)
    expect(a.GetStart()).toEqual(mm(10, 50));
    expect(a.GetEnd()).toEqual(mm(30, 50));
    expect(b.GetStart()).toEqual(mm(30, 40));
    expect(b.GetEnd()).toEqual(mm(30, 50));
  });
});

describe('EDIT_TOOL::BooleanPolygons (edit_tool.cpp:1950)', () => {
  it('merges two overlapping rectangles into one polygon', () => {
    select(h, 32, 33);
    h.mgr.RunAction(PCB_ACTIONS.mergePolygons);
    const shapes = h.board.Drawings().filter((d) => d.Type() === KICAD_T.PCB_SHAPE_T);
    const polys = shapes.filter((s) => (s as PCB_SHAPE).GetShape() === 4 /* POLY */);
    expect(polys).toHaveLength(1);
    // both sources are deleted, the new polygon is selected (:2093-2094)
    expect(byUuidOrNull(h.board, 32) === null).toBe(true);
    expect(byUuidOrNull(h.board, 33) === null).toBe(true);
    expect(ids(h.sel.GetSelection().GetItems())).toEqual(ids(polys));
  });
});

describe('EDIT_TOOL::JustifyText (edit_tool.cpp:2560)', () => {
  it('sets the horizontal justification of the text', () => {
    select(h, 40);
    h.mgr.RunAction(ACTIONS.rightJustify);
    expect((byUuid(h.board, 40) as PCB_TEXT).GetHorizJustify()).toBe(1);
  });
});

describe('EDIT_TOOL::Increment (edit_tool.cpp:3264)', () => {
  it('increments the trailing number of a text', () => {
    select(h, 40);
    h.mgr.RunAction(ACTIONS.incrementPrimary);
    expect((byUuid(h.board, 40) as PCB_TEXT).GetText()).toBe('A2');
  });
});

describe('EDIT_TOOL::Properties (edit_tool.cpp:2108)', () => {
  it('a single item goes to the frame edit request', () => {
    select(h, 30);
    h.mgr.RunAction(PCB_ACTIONS.properties);
    expect(ids(h.frame.edited)).toEqual([U(30)]);
  });
});

describe('EDIT_TOOL::GetAndPlace (edit_tool.cpp:881)', () => {
  it('finds the footprint by reference, without case, and selects it', async () => {
    h.mgr.RunAction(PCB_ACTIONS.getAndPlace);
    await flush();
    expect(ids(h.sel.GetSelection().GetItems())).toEqual([U(7)]);
  });
});

describe('EDIT_TOOL::ToggleFootprintAttribute (edit_tool.cpp:1067)', () => {
  it('sets exclude-from-BOM when any selected footprint has it clear', () => {
    select(h, 1, 7);
    h.mgr.RunAction(PCB_ACTIONS.toggleExcludeFromBOM);
    expect((byUuid(h.board, 1) as FOOTPRINT).IsExcludedFromBOM()).toBe(true);
    expect((byUuid(h.board, 7) as FOOTPRINT).IsExcludedFromBOM()).toBe(true);
  });
});

function byUuidOrNull(aBoard: BOARD, aN: number): BOARD_ITEM | null {
  try {
    return byUuid(aBoard, aN);
  } catch {
    return null;
  }
}

// keep the angle import used
void EDA_ANGLE;
void TA_MOUSE_DOWN;
