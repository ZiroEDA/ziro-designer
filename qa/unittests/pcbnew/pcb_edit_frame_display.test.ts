// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PCB_EDIT_FRAME half of PCB_CONTROL's display modes: the ratsnest
 * toggles (pcb_control.cpp:239-261, 443-470) go through
 * PCB_EDIT_FRAME::SetElementVisibility (pcb_edit_frame.cpp:2024-2033) and
 * OnDisplayOptionsChanged (:2012-2015), which tells the Appearance panel; the
 * contrast cycle's feedback is the frame's HOTKEY_CYCLE_POPUP; and
 * PCB_BASE_FRAME::SetDisplayOptions (pcb_base_frame.cpp:1067-1097) recaches
 * only for the zone mode and the board flip.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import {
  HIGH_CONTRAST_MODE,
  RATSNEST_MODE,
  ZONE_DISPLAY_MODE,
} from '@ziroeda/common/project/board_project_settings.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { PCB_DISPLAY_OPTIONS } from '@ziroeda/pcbnew/pcb_painter.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';

beforeAll(() => {
  installPgm();
});

function frame() {
  const settings = new PCBNEW_SETTINGS();
  let appearanceUpdates = 0;
  const hooks = {
    settings: () => settings,
    onModify: () => {},
    updateDisplayOptions: () => {
      appearanceUpdates++;
    },
  } as unknown as PCB_EDIT_FRAME_HOOKS;
  const f = new PCB_EDIT_FRAME(hooks);
  f.SetBoard(new BOARD());
  return { f, settings, appearanceUpdates: () => appearanceUpdates };
}

describe('PCB_CONTROL ratsnest modes on the board editor', () => {
  it('Show Ratsnest flips the global ratsnest, on the board and in the panel', () => {
    const { f, settings, appearanceUpdates } = frame();
    expect(settings.m_Display.m_ShowGlobalRatsnest).toBe(true);

    f.GetToolManager()!.RunAction(PCB_ACTIONS.showRatsnest);

    expect(settings.m_Display.m_ShowGlobalRatsnest).toBe(false);
    expect(f.GetBoard()!.IsElementVisible(GAL_LAYER_ID.LAYER_RATSNEST)).toBe(false);
    expect(appearanceUpdates()).toBe(1);
  });

  it('Curved Ratsnest Lines flips the curve and tells the panel', () => {
    const { f, settings, appearanceUpdates } = frame();
    expect(settings.m_Display.m_DisplayRatsnestLinesCurved).toBe(false);

    f.GetToolManager()!.RunAction(PCB_ACTIONS.ratsnestLineMode);

    expect(settings.m_Display.m_DisplayRatsnestLinesCurved).toBe(true);
    // The global flag is untouched by the line mode.
    expect(settings.m_Display.m_ShowGlobalRatsnest).toBe(true);
    expect(appearanceUpdates()).toBe(1);
  });

  it('the ratsnest mode cycles all layers, visible layers, none', () => {
    const { f, settings } = frame();
    const seen: string[] = [];
    const state = (): string =>
      !settings.m_Display.m_ShowGlobalRatsnest
        ? 'off'
        : settings.m_Display.m_RatsnestMode === RATSNEST_MODE.ALL
          ? 'all'
          : 'visible';

    settings.m_Display.m_ShowGlobalRatsnest = true;
    settings.m_Display.m_RatsnestMode = RATSNEST_MODE.ALL;

    for (let i = 0; i < 3; i++) {
      f.GetToolManager()!.RunAction(PCB_ACTIONS.ratsnestModeCycle);
      seen.push(state());
    }

    expect(seen).toEqual(['visible', 'off', 'all']);
    expect(f.GetBoard()!.IsElementVisible(GAL_LAYER_ID.LAYER_RATSNEST)).toBe(true);
  });

  it('SetElementVisibility keeps the ratsnest VIEW layer on and the board flag as given', () => {
    const { f } = frame();
    const visible = new Map<number, boolean>();
    f.SetCanvas({
      GetView: () => ({
        SetLayerVisible: (aLayer: number, aOn: boolean) => visible.set(aLayer, aOn),
      }),
    } as unknown as PCB_DRAW_PANEL_GAL);

    f.SetElementVisibility(GAL_LAYER_ID.LAYER_RATSNEST, false);
    f.SetElementVisibility(GAL_LAYER_ID.LAYER_VIAS, false);

    expect(visible.get(GAL_LAYER_ID.LAYER_RATSNEST)).toBe(true);
    expect(visible.get(GAL_LAYER_ID.LAYER_VIAS)).toBe(false);
    expect(f.GetBoard()!.IsElementVisible(GAL_LAYER_ID.LAYER_RATSNEST)).toBe(false);
    f.SetCanvas(null);
  });
});

describe('the contrast feedback', () => {
  it('pops the frame popup with the three modes, at the new one', () => {
    const { f } = frame();
    const popups: [string, readonly string[], number][] = [];
    f.SetHotkeyPopup({ Popup: (t, items, sel) => popups.push([t, items, sel]) });
    const common = PgmOrNull()!.GetCommonSettings()!;
    const was = common.m_Input.hotkey_feedback;
    common.m_Input.hotkey_feedback = true;

    // The cycle posts ContrastModeChangedByKeyEvent; the manager processes
    // the posted queue before RunAction returns.
    f.GetToolManager()!.RunAction(ACTIONS.highContrastModeCycle);

    common.m_Input.hotkey_feedback = was;

    expect(f.GetDisplayOptions().m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.DIMMED);
    expect(popups).toEqual([['Inactive Layer Display', ['Normal', 'Dimmed', 'Hidden'], 1]]);
  });
});

describe('PCB_BASE_FRAME::SetDisplayOptions', () => {
  it('recaches only when the zone mode or the flip changes', () => {
    const { f } = frame();
    const recache = vi.fn();
    // The active layer is the screen's, which a frame without a window has not got.
    vi.spyOn(f, 'GetActiveLayer').mockReturnValue(PCB_LAYER_ID.F_Cu);
    f.SetCanvas({
      GetView: () => ({
        UpdateDisplayOptions: () => {},
        SetMirror: () => {},
        IsMirroredY: () => false,
        RecacheAllItems: recache,
      }),
      SetHighContrastLayer: () => {},
      Refresh: () => {},
    } as unknown as PCB_DRAW_PANEL_GAL);

    const next = (aEdit: (o: PCB_DISPLAY_OPTIONS) => void): void => {
      const o = Object.assign(new PCB_DISPLAY_OPTIONS(), f.GetDisplayOptions());
      aEdit(o);
      f.SetDisplayOptions(o);
    };

    next((o) => {
      o.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.DIMMED;
    });
    next((o) => {
      o.m_TrackOpacity = 0.5;
    });
    expect(recache).not.toHaveBeenCalled();

    next((o) => {
      o.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE;
    });
    expect(recache).toHaveBeenCalledTimes(1);

    next((o) => {
      o.m_FlipBoardView = true;
    });
    expect(recache).toHaveBeenCalledTimes(2);
    f.SetCanvas(null);
  });
});
