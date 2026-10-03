// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME::LoadSettings` / `SaveSettings` and the base classes' halves
 * (pcb_edit_frame.cpp:1729-1800, pcb_base_frame.cpp:818-881,
 * eda_draw_frame.cpp LoadSettings / SaveSettings), and the COMMON_TOOLS the
 * frame now registers, which is what changes the units those two persist.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { COMMON_CONTROL } from '@ziroeda/common/tool/common_control.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  PCB_EDIT_FRAME,
  type PCB_EDIT_FRAME_HOOKS,
  pcbCheckedSet,
} from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_SELECTION_TOOL } from '@ziroeda/pcbnew/tools/pcb_selection_tool.js';
import { WINDOW_ACTION_BRIDGE } from '@ziroeda/pcbnew/tools/window_action_bridge.js';

beforeAll(() => {
  installPgm();
});

function frame(aSettings = new PCBNEW_SETTINGS(), shown: Set<string> = new Set()) {
  let auxRebuilt = 0;
  const hooks = {
    settings: () => aSettings,
    onModify: () => {},
    paneShown: (aName: string) => shown.has(aName),
    reCreateAuxiliaryToolbar: () => {
      auxRebuilt++;
    },
  } as unknown as PCB_EDIT_FRAME_HOOKS;
  const f = new PCB_EDIT_FRAME(hooks);
  f.SetBoard(new BOARD());
  return { f, settings: aSettings, auxRebuilt: () => auxRebuilt };
}

describe('PCB_EDIT_FRAME settings', () => {
  it('the constructor loads the units the file holds', () => {
    const cfg = new PCBNEW_SETTINGS();
    cfg.m_System.units = EDA_UNITS_INT.MILS;
    cfg.m_PolarCoords = true;

    const { f } = frame(cfg);

    expect(f.GetUserUnits()).toBe('mils');
    expect(f.GetShowPolarCoords()).toBe(true);
  });

  it('a unit action goes to COMMON_TOOLS, re-lists the aux toolbar and is saved', () => {
    const { f, settings, auxRebuilt } = frame();
    expect(f.GetUserUnits()).toBe('mm');
    // The units group's checks, out of everything the frame checks.
    const units = (): string[] => [...pcbCheckedSet(f)].filter((id) => id.startsWith('units'));
    expect(units()).toEqual(['unitsMm']);

    f.GetToolManager()!.RunAction(ACTIONS.inchesUnits);

    expect(f.GetUserUnits()).toBe('in');
    expect(f.GetBoard()!.GetUserUnits()).toBe('in');
    expect(auxRebuilt()).toBe(1);
    expect(units()).toEqual(['unitsInches']);

    f.SaveSettings(settings);

    expect(settings.m_System.units).toBe(EDA_UNITS_INT.INCH);
    expect(settings.m_System.last_imperial_units).toBe(EDA_UNITS_INT.INCH);
    expect(settings.m_System.last_metric_units).toBe(EDA_UNITS_INT.MM);
  });

  it('Toggle Units returns to the last imperial unit the file remembers', () => {
    const cfg = new PCBNEW_SETTINGS();
    cfg.m_System.last_imperial_units = EDA_UNITS_INT.INCH;
    const { f } = frame(cfg);

    f.GetToolManager()!.RunAction(ACTIONS.toggleUnits);

    expect(f.GetUserUnits()).toBe('in');
  });

  it('saves polar coordinates and which panes are shown', () => {
    const shown = new Set(['Search', 'LayersManager']);
    const { f, settings } = frame(new PCBNEW_SETTINGS(), shown);
    f.SetShowPolarCoords(true);
    // Each the other way round from what the frame shows, so a write that
    // never happens cannot pass on the default.
    settings.m_AuiPanels.show_search = false;
    settings.m_AuiPanels.show_layer_manager = false;
    settings.m_AuiPanels.show_net_inspector = true;
    settings.m_AuiPanels.show_properties = true;
    settings.m_AuiPanels.design_blocks_show = true;

    f.SaveSettings(settings);

    expect(settings.m_PolarCoords).toBe(true);
    expect(settings.m_AuiPanels.show_search).toBe(true);
    expect(settings.m_AuiPanels.show_layer_manager).toBe(true);
    expect(settings.m_AuiPanels.show_net_inspector).toBe(false);
    expect(settings.m_AuiPanels.show_properties).toBe(false);
    expect(settings.m_AuiPanels.design_blocks_show).toBe(false);
  });

  it('moves a legacy user grid onto the grid list', () => {
    const cfg = new PCBNEW_SETTINGS();
    const before = cfg.m_Window.grid.grids.length;
    cfg.m_Window.grid.user_grid_x = '0.3 mm';
    cfg.m_Window.grid.user_grid_y = '0.4 mm';

    frame(cfg);

    const g = cfg.m_Window.grid;
    expect(g.grids.length).toBe(before + 1);
    expect([g.grids.at(-1)!.name, g.grids.at(-1)!.x, g.grids.at(-1)!.y]).toEqual([
      'User Grid',
      '0.3 mm',
      '0.4 mm',
    ]);
    expect([g.user_grid_x, g.user_grid_y]).toEqual(['', '']);
  });

  it('Show3DViewer raises the window viewer, and reloads it only when it was open', () => {
    let open = false;
    let raised = 0;
    const hooks = {
      settings: () => new PCBNEW_SETTINGS(),
      onModify: () => {},
      viewer3DShown: () => open,
      showViewer3D: () => {
        raised++;
        open = true;
      },
    } as unknown as PCB_EDIT_FRAME_HOOKS;
    const f = new PCB_EDIT_FRAME(hooks);
    f.SetBoard(new BOARD());
    let reloads = 0;
    f.Update3DView = () => {
      reloads++;
    };

    f.GetToolManager()!.RunAction(ACTIONS.show3DViewer);
    expect([raised, reloads]).toEqual([1, 0]);

    f.GetToolManager()!.RunAction(ACTIONS.show3DViewer);
    expect([raised, reloads]).toEqual([2, 1]);
  });

  it('registers the common tools in setupTools order, after the window bridge', () => {
    const { f } = frame();
    const order = [...f.GetToolManager()!.Tools()].map((t) => t.constructor);

    // pcb_edit_frame.cpp:949-952: COMMON_CONTROL, COMMON_TOOLS,
    // PCB_SELECTION_TOOL, ZOOM_TOOL lead the list.
    expect(order.slice(0, 5)).toEqual([
      WINDOW_ACTION_BRIDGE,
      COMMON_CONTROL,
      COMMON_TOOLS,
      PCB_SELECTION_TOOL,
      ZOOM_TOOL,
    ]);
  });
});
