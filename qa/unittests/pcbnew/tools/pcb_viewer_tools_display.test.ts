// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_VIEWER_TOOLS' display modes, NextLineMode and FootprintAutoZoom
 * (pcb_viewer_tools.cpp:106-250, 459-469): each flips one setting in the
 * frame's settings object and repaints exactly the items that read it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_VIEWER_TOOLS } from '@ziroeda/pcbnew/tools/pcb_viewer_tools.js';
import { type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (footprint "R" (layer "F.Cu") (at 10 10)
    (property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "R" (at 0 2 0) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15))))
    (fp_line (start -1 0) (end 1 0) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))
    (fp_text user "U" (at 0 1 0) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu"))
  )
  (gr_line (start 0 0) (end 5 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_text "T" (at 3 3 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
)
`;

let h: TOOL_HARNESS<TEST_PCB_FRAME>;
let repainted: VIEW_ITEM[];

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new TEST_PCB_FRAME(aBoard),
    () => [new PCB_VIEWER_TOOLS()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  repainted = [];
  vi.spyOn(h.view, 'Update').mockImplementation((aItem, aFlags) => {
    if (aFlags === VIEW_UPDATE_FLAGS.REPAINT) repainted.push(aItem);
  });
});

/** The kinds of what was repainted, sorted, so the set is the assertion. */
const kinds = (): string[] => repainted.map((i) => KICAD_T[(i as BOARD_ITEM).Type()]!).sort();

const viewers = () => h.frame.GetPcbNewSettings().m_ViewersDisplay;

describe('PCB_VIEWER_TOOLS display modes', () => {
  it('Sketch Pads flips the pad fill and repaints the pads', () => {
    expect(viewers().m_DisplayPadFill).toBe(true);
    h.mgr.RunAction(PCB_ACTIONS.padDisplayMode);
    expect(viewers().m_DisplayPadFill).toBe(false);
    expect(kinds()).toEqual(['PCB_PAD_T']);
    h.mgr.RunAction(PCB_ACTIONS.padDisplayMode);
    expect(viewers().m_DisplayPadFill).toBe(true);
  });

  it('Show Pad Numbers flips the numbers and repaints the pads', () => {
    expect(viewers().m_DisplayPadNumbers).toBe(true);
    h.mgr.RunAction(PCB_ACTIONS.showPadNumbers);
    expect(viewers().m_DisplayPadNumbers).toBe(false);
    expect(kinds()).toEqual(['PCB_PAD_T']);
  });

  it('Sketch Graphic Items repaints the shapes, in footprints and on the board', () => {
    expect(viewers().m_DisplayGraphicsFill).toBe(true);
    h.mgr.RunAction(PCB_ACTIONS.graphicsOutlines);
    expect(viewers().m_DisplayGraphicsFill).toBe(false);
    expect(kinds()).toEqual(['PCB_SHAPE_T', 'PCB_SHAPE_T']);
  });

  it('Sketch Text Items repaints the fields and every text', () => {
    expect(viewers().m_DisplayTextFill).toBe(true);
    h.mgr.RunAction(PCB_ACTIONS.textOutlines);
    expect(viewers().m_DisplayTextFill).toBe(false);
    // The footprint's Reference, Value, Datasheet and Description fields, its
    // user text, and the board text.
    const fields = h.board.Footprints()[0]!.GetFields().length;
    expect(kinds()).toEqual(
      [...Array(fields).fill('PCB_FIELD_T'), 'PCB_TEXT_T', 'PCB_TEXT_T'].sort(),
    );
  });
});

describe('PCB_VIEWER_TOOLS::NextLineMode', () => {
  it('cycles the board editor through free, 45 and 90 degrees', () => {
    const cfg = h.frame.GetPcbNewSettings();
    const seen: LEADER_MODE[] = [];
    let notified = 0;
    const run = h.mgr.RunAction.bind(h.mgr);
    vi.spyOn(h.mgr, 'RunAction').mockImplementation((aAction, aParam) => {
      if (aAction === PCB_ACTIONS.angleSnapModeChanged) notified++;
      return run(aAction, aParam);
    });

    cfg.m_AngleSnapMode = LEADER_MODE.DIRECT;

    for (let i = 0; i < 3; i++) {
      h.mgr.RunAction(PCB_ACTIONS.lineModeNext);
      seen.push(cfg.m_AngleSnapMode);
    }

    expect(seen).toEqual([LEADER_MODE.DEG45, LEADER_MODE.DEG90, LEADER_MODE.DIRECT]);
    expect(notified).toBe(3);
  });
});

describe('PCB_VIEWER_TOOLS::FootprintAutoZoom', () => {
  it('flips the setting in the frame config', () => {
    const cfg = h.frame.GetPcbNewSettings();
    expect(cfg.m_FootprintViewerAutoZoomOnSelect).toBe(true);
    h.mgr.RunAction(PCB_ACTIONS.fpAutoZoom);
    expect(cfg.m_FootprintViewerAutoZoomOnSelect).toBe(false);
  });
});
