// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_CONTROL's display modes (pcbnew/tools/pcb_control.cpp:217-470,
 * 2946-2985): each changes one display option - the frame's
 * PCB_DISPLAY_OPTIONS or the settings object's m_Display - and repaints the
 * items that read it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '@ziroeda/common/tool/actions.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { WX_INFOBAR, WX_INFOBAR_HYPERLINK } from '@ziroeda/common/eda_base_frame.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import {
  HIGH_CONTRAST_MODE,
  NET_COLOR_MODE,
  ZONE_DISPLAY_MODE,
} from '@ziroeda/common/project/board_project_settings.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_CONTROL } from '@ziroeda/pcbnew/tools/pcb_control.js';
import { type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (segment (start 0 0) (end 5 0) (width 0.25) (layer "F.Cu") (net 0))
  (arc (start 0 5) (mid 2 6) (end 4 5) (width 0.25) (layer "F.Cu") (net 0))
  (via (at 3 3) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0))
  (gr_line (start 0 10) (end 5 10) (stroke (width 0.1) (type solid)) (layer "F.Cu"))
  (gr_line (start 0 12) (end 5 12) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))
  (zone (net 0) (net_name "") (layer "F.Cu") (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25) (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 70 10) (xy 90 10) (xy 90 30) (xy 70 30))))
)
`;

let h: TOOL_HARNESS<TEST_PCB_FRAME>;
let repainted: VIEW_ITEM[];

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new TEST_PCB_FRAME(aBoard),
    () => [new PCB_CONTROL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  repainted = [];
  vi.spyOn(h.view, 'Update').mockImplementation((aItem, aFlags) => {
    if (aFlags === VIEW_UPDATE_FLAGS.REPAINT) repainted.push(aItem);
  });
});

const kinds = (): string[] => repainted.map((i) => KICAD_T[(i as BOARD_ITEM).Type()]!).sort();

const display = () => h.frame.GetPcbNewSettings().m_Display;
const opts = () => h.frame.GetDisplayOptions();

describe('PCB_CONTROL display modes', () => {
  it('Sketch Tracks repaints the tracks and arcs and the copper graphics', () => {
    h.mgr.RunAction(PCB_ACTIONS.trackDisplayMode);
    expect(display().m_DisplayPcbTrackFill).toBe(false);
    expect(kinds()).toEqual(['PCB_ARC_T', 'PCB_SHAPE_T', 'PCB_TRACE_T']);
    const shape = repainted.find((i) => (i as BOARD_ITEM).Type() === KICAD_T.PCB_SHAPE_T);
    expect((shape as PCB_SHAPE).IsOnCopperLayer()).toBe(true);
  });

  it('Sketch Vias repaints the vias', () => {
    h.mgr.RunAction(PCB_ACTIONS.viaDisplayMode);
    expect(display().m_DisplayViaFill).toBe(false);
    expect(kinds()).toEqual(['PCB_VIA_T']);
  });

  it('each zone action sets its mode and repaints the zones', () => {
    const modes: [typeof PCB_ACTIONS.zoneDisplayOutline, ZONE_DISPLAY_MODE][] = [
      [PCB_ACTIONS.zoneDisplayOutline, ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE],
      [PCB_ACTIONS.zoneDisplayFractured, ZONE_DISPLAY_MODE.SHOW_FRACTURE_BORDERS],
      [PCB_ACTIONS.zoneDisplayTriangulated, ZONE_DISPLAY_MODE.SHOW_TRIANGULATION],
      [PCB_ACTIONS.zoneDisplayFilled, ZONE_DISPLAY_MODE.SHOW_FILLED],
    ];

    for (const [action, mode] of modes) {
      repainted = [];
      h.mgr.RunAction(action);
      expect(opts().m_ZoneDisplayMode).toBe(mode);
      expect(kinds()).toEqual(['PCB_ZONE_T']);
    }

    // zoneDisplayToggle: filled <-> outline.
    h.mgr.RunAction(PCB_ACTIONS.zoneDisplayToggle);
    expect(opts().m_ZoneDisplayMode).toBe(ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE);
    h.mgr.RunAction(PCB_ACTIONS.zoneDisplayToggle);
    expect(opts().m_ZoneDisplayMode).toBe(ZONE_DISPLAY_MODE.SHOW_FILLED);
  });

  it('Draw Zone Fills over an unfilled zone shows the 5 s warning with its link', () => {
    const shown: { message: string; time: number; buttons: WX_INFOBAR_HYPERLINK[] }[] = [];
    let buttons: WX_INFOBAR_HYPERLINK[] = [];
    let dismissed = 0;
    const infobar: WX_INFOBAR = {
      IsLocked: () => false,
      AddButton: (b) => {
        buttons.push(b);
      },
      RemoveAllButtons: () => {
        buttons = [];
      },
      ShowMessageFor: (message, time) => {
        shown.push({ message, time, buttons: [...buttons] });
      },
      Dismiss: () => {
        dismissed++;
      },
    };
    h.frame.SetInfoBar(infobar);

    h.mgr.RunAction(PCB_ACTIONS.zoneDisplayOutline);
    expect(shown).toHaveLength(0);
    h.mgr.RunAction(PCB_ACTIONS.zoneDisplayFilled);

    expect(shown).toHaveLength(1);
    expect(shown[0]!.message).toBe(
      'Not all zones are filled. Use Edit > Fill All Zones (B) if you wish to see all fills.',
    );
    expect(shown[0]!.time).toBe(5000);
    expect(shown[0]!.buttons.map((b) => b.label)).toEqual(["Don't show again"]);

    shown[0]!.buttons[0]!.onClick();
    expect(dismissed).toBe(1);
  });

  it('Inactive Layer View Mode toggles normal and dimmed; H cycles all three', () => {
    expect(opts().m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.NORMAL);
    h.mgr.RunAction(ACTIONS.highContrastMode);
    expect(opts().m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.DIMMED);
    h.mgr.RunAction(ACTIONS.highContrastMode);
    expect(opts().m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.NORMAL);

    const posted: string[] = [];
    const post = h.mgr.PostEvent.bind(h.mgr);
    vi.spyOn(h.mgr, 'PostEvent').mockImplementation((aEvent) => {
      if (aEvent.Matches(EVENTS.ContrastModeChangedByKeyEvent)) posted.push('feedback');
      return post(aEvent);
    });

    const seen: HIGH_CONTRAST_MODE[] = [];

    for (let i = 0; i < 3; i++) {
      h.mgr.RunAction(ACTIONS.highContrastModeCycle);
      seen.push(opts().m_ContrastModeDisplay);
    }

    expect(seen).toEqual([
      HIGH_CONTRAST_MODE.DIMMED,
      HIGH_CONTRAST_MODE.HIDDEN,
      HIGH_CONTRAST_MODE.NORMAL,
    ]);
    expect(posted).toHaveLength(3);
  });

  it('the net colour mode cycles all, ratsnest, off', () => {
    const seen: NET_COLOR_MODE[] = [];
    h.frame.GetDisplayOptions().m_NetColorMode = NET_COLOR_MODE.ALL;

    for (let i = 0; i < 3; i++) {
      h.mgr.RunAction(PCB_ACTIONS.netColorModeCycle);
      seen.push(opts().m_NetColorMode);
    }

    expect(seen).toEqual([NET_COLOR_MODE.RATSNEST, NET_COLOR_MODE.OFF, NET_COLOR_MODE.ALL]);
  });

  it('Flip Board View flips the option', () => {
    expect(opts().m_FlipBoardView).toBe(false);
    h.mgr.RunAction(PCB_ACTIONS.flipBoard);
    expect(opts().m_FlipBoardView).toBe(true);
  });

  it('Rehatch rehatches the hatched shapes only, and updates them', () => {
    const shapes = h.board
      .Drawings()
      .filter((i) => i.Type() === KICAD_T.PCB_SHAPE_T) as unknown as PCB_SHAPE[];
    shapes[0]!.SetFillMode(FILL_T.HATCH);
    const hatched = vi.spyOn(shapes[0]!, 'UpdateHatching');
    const plain = vi.spyOn(shapes[1]!, 'UpdateHatching');
    const updated: VIEW_ITEM[] = [];
    vi.spyOn(h.view, 'Update').mockImplementation((aItem) => {
      updated.push(aItem);
    });

    h.mgr.RunAction(PCB_ACTIONS.rehatchShapes);

    expect(hatched).toHaveBeenCalledTimes(1);
    expect(plain).not.toHaveBeenCalled();
    expect(updated).toEqual([shapes[0]]);
  });
});
