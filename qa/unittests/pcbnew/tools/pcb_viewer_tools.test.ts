// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_VIEWER_TOOLS::MeasureTool (pcb_viewer_tools.cpp:258-457) on the
 * TOOL_MANAGER: a RULER_ITEM on the VIEW over a TWO_POINT_GEOMETRY_MANAGER.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { GetClipboardUTF8 } from '@ziroeda/common/clipboard.js';
import { RULER_ITEM } from '@ziroeda/common/preview_items/ruler_item.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import {
  AS_GLOBAL,
  BUT_LEFT,
  MD_SHIFT,
  TA_MOUSE_CLICK,
  TA_MOUSE_MOTION,
  TC_MOUSE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { PCB_VIEWER_TOOLS } from '@ziroeda/pcbnew/tools/pcb_viewer_tools.js';
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

let h: TOOL_HARNESS<TEST_PCB_FRAME>;
let rulers: RULER_ITEM[];

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new TEST_PCB_FRAME(aBoard),
    () => [new PCB_VIEWER_TOOLS()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  rulers = [];
  const add = h.view.Add.bind(h.view);
  vi.spyOn(h.view, 'Add').mockImplementation((aItem, aLayer) => {
    if (aItem instanceof RULER_ITEM) rulers.push(aItem);
    return add(aItem, aLayer);
  });
});

const click = (p: Vec2): void => {
  mouse(h, TA_MOUSE_MOTION, p);
  mouse(h, TA_MOUSE_CLICK, p, BUT_LEFT);
};
const move = (p: Vec2): void => mouse(h, TA_MOUSE_MOTION, p);
const start = (aAction: TOOL_ACTION): void => {
  const evt = aAction.MakeEvent();
  evt.SetHasPosition(false);
  h.mgr.ProcessEvent(evt);
};
const esc = (): void => {
  h.mgr.RunAction(ACTIONS.cancelInteractive);
};
const ruler = (): RULER_ITEM => rulers[0]!;
const visible = (): boolean => h.view.IsVisible(ruler());

describe('PCB_VIEWER_TOOLS::MeasureTool', () => {
  it('puts a hidden ruler on the VIEW and shows the MEASURE cursor', () => {
    start(ACTIONS.measureTool);
    expect(rulers).toHaveLength(1);
    expect(visible()).toBe(false);
    expect(h.shape).toBe(KICURSOR.MEASURE);
  });

  it('a click sets the origin; motion shows the ruler to the cursor; a second click pins it', () => {
    start(ACTIONS.measureTool);
    click(mm(10, 10));
    move(mm(40, 50));
    expect(visible()).toBe(true);
    // 30 mm across, 40 down: 50 mm long.
    expect(ruler().GetDimensionStrings().join(' ')).toContain('50');
    const pinned = ruler().GetDimensionStrings();
    click(mm(40, 50));
    move(mm(60, 60));
    // The pinned ruler stays where the click left it.
    expect(ruler().GetDimensionStrings()).toEqual(pinned);
  });

  it('Shift holds the ruler to 45 degrees', () => {
    start(ACTIONS.measureTool);
    click(mm(0, 0));
    move(mm(10, 1));
    const straight = ruler().GetDimensionStrings().join(' ');
    // A motion with Shift down: LEADER_MODE::DEG45 snaps the end onto the axis.
    const shifted = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_MOTION, MD_SHIFT, AS_GLOBAL);
    shifted.SetMousePosition(mm(10, 1));
    h.mgr.ProcessEvent(shifted);
    expect(ruler().GetDimensionStrings().join(' ')).not.toBe(straight);
  });

  it('Esc with an origin hides the ruler and keeps the tool; a second Esc leaves', () => {
    start(ACTIONS.measureTool);
    click(mm(10, 10));
    move(mm(20, 20));
    esc();
    expect(visible()).toBe(false);
    expect(h.frame.IsCurrentTool(ACTIONS.measureTool)).toBe(true);
    esc();
    expect(h.frame.IsCurrentTool(ACTIONS.measureTool)).toBe(false);
  });

  it('copy puts the dimension strings on the clipboard while measuring', () => {
    start(ACTIONS.measureTool);
    click(mm(10, 10));
    move(mm(40, 50));
    h.mgr.RunAction(ACTIONS.copy);
    expect(GetClipboardUTF8()).toBe(ruler().GetDimensionStrings().join('\n'));
  });
});
