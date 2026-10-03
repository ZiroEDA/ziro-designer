// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * MICROWAVE_TOOL on the TOOL_MANAGER (microwave_tool.cpp): the four footprint
 * tools are `doInteractiveItemPlacement` with a MICROWAVE_PLACER whose
 * CreateItem runs the generator's dialogs; the line tool is
 * `drawMicrowaveInductor`'s two clicks over a CENTRELINE_RECT_ITEM on the VIEW.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { BUT_LEFT, TA_MOUSE_CLICK, TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { MICROWAVE_TOOL, type MICROWAVE_HOST } from '@ziroeda/pcbnew/microwave/microwave_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { vi } from 'vitest';
import { mm, mouse, type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
)
`;

/** The answers the generators' dialogs give, in order; null is Cancel. */
let answers: (string | null)[] = [];
let inductors: FOOTPRINT[] = [];

class MW_FRAME extends TEST_PCB_FRAME {
  MicrowaveHost(): MICROWAVE_HOST {
    return {
      GetCurrentTrackWidth: () => 250000,
      StringFromValue: (iu) => String(iu),
      ValueFromString: (s) => Number(s),
      CreateNewFootprint: () => new FOOTPRINT(this.GetBoard()),
      OnModify: () => {},
      ShowInfoBarError: () => {},
      DisplayError: () => {},
      TextEntry: async () => answers.shift() ?? null,
      PolygonShapeDialog: async () => false,
      AddInductor: (f) => inductors.push(f),
    };
  }
}

let h: TOOL_HARNESS<MW_FRAME>;

beforeEach(() => {
  answers = [];
  inductors = [];
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new MW_FRAME(aBoard),
    () => [new MICROWAVE_TOOL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const click = (p: Vec2): void => {
  mouse(h, TA_MOUSE_MOTION, p);
  mouse(h, TA_MOUSE_CLICK, p, BUT_LEFT);
};
const move = (p: Vec2): void => mouse(h, TA_MOUSE_MOTION, p);
/** A toolbar click: ACTION_TOOLBAR's event carries no position. */
const start = (aAction: TOOL_ACTION): void => {
  const evt = aAction.MakeEvent();
  evt.SetHasPosition(false);
  h.mgr.ProcessEvent(evt);
};
const esc = (): void => {
  h.mgr.RunAction(ACTIONS.cancelInteractive);
};

describe('MICROWAVE_TOOL::addMicrowaveFootprint (microwave_tool.cpp:56-104)', () => {
  it('the first click runs the dialogs, the gap rides the cursor, the second places it', async () => {
    answers = ['1000000'];
    start(PCB_ACTIONS.microwaveCreateGap);
    expect(h.shape).toBe(KICURSOR.PENCIL);

    click(mm(10, 10));
    await flush();
    expect(h.board.Footprints()).toHaveLength(0);

    // `setCursor()` at the top of the loop: PLACE from the next event on.
    move(mm(20, 15));
    expect(h.shape).toBe(KICURSOR.PLACE);
    const push = vi.spyOn(BOARD_COMMIT.prototype, 'Push');
    click(mm(20, 15));

    expect(push.mock.calls.map((c) => c[0])).toEqual(['Place microwave feature']);
    push.mockRestore();
    expect(h.board.Footprints()).toHaveLength(1);
    expect(h.board.Footprints()[0]!.GetPosition()).toEqual(mm(20, 15));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    // IPO_REPEAT: still armed, nothing on the cursor.
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.microwaveCreateGap)).toBe(true);
    expect(h.shape).toBe(KICURSOR.PENCIL);
  });

  it('Cancel in a dialog makes nothing and leaves the tool armed', async () => {
    answers = [null];
    start(PCB_ACTIONS.microwaveCreateStub);
    click(mm(10, 10));
    await flush();
    click(mm(20, 10));
    await flush();
    expect(h.board.Footprints()).toHaveLength(0);
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.microwaveCreateStub)).toBe(true);
  });

  it('Esc drops the riding item; a second Esc leaves the tool', async () => {
    answers = ['1000000'];
    start(PCB_ACTIONS.microwaveCreateGap);
    click(mm(10, 10));
    await flush();
    esc();
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.microwaveCreateGap)).toBe(true);
    esc();
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.microwaveCreateGap)).toBe(false);
    expect(h.board.Footprints()).toHaveLength(0);
  });
});

describe('MICROWAVE_TOOL::drawMicrowaveInductor (microwave_tool.cpp:109-238)', () => {
  it('two clicks hand the rectangle to createInductorBetween; the preview follows the cursor', async () => {
    const between = vi.spyOn(MICROWAVE_TOOL.prototype, 'createInductorBetween');
    start(PCB_ACTIONS.microwaveCreateLine);
    expect(h.shape).toBe(KICURSOR.PENCIL);

    click(mm(10, 10));
    move(mm(30, 10));
    click(mm(30, 10));
    await flush();

    expect(between.mock.calls).toEqual([[mm(10, 10), mm(30, 10)]]);
    between.mockRestore();
    // The tool waits for the next origin.
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.microwaveCreateLine)).toBe(true);
  });

  it('Esc after the first click forgets the origin; a second Esc leaves', () => {
    const between = vi.spyOn(MICROWAVE_TOOL.prototype, 'createInductorBetween');
    start(PCB_ACTIONS.microwaveCreateLine);
    click(mm(10, 10));
    esc();
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.microwaveCreateLine)).toBe(true);
    click(mm(20, 10));
    esc();
    esc();
    expect(h.frame.IsCurrentTool(PCB_ACTIONS.microwaveCreateLine)).toBe(false);
    expect(between).not.toHaveBeenCalled();
    between.mockRestore();
  });
});
