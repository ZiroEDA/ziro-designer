// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `COMMON_TOOLS` and the `EDA_DRAW_FRAME` members it drives, run through a
 * real TOOL_MANAGER on a real VIEW with GerbView's settings. Expectations are
 * the C++'s:
 *
 *   doZoomInOut (common_tools.cpp:220-258)   x1.3 (or /1.3), then the first
 *       preset at or past it; peg at either end.
 *   GridNext / GridPrev (:505-527)           wrap around; OnGridChanged puts
 *       the grid, in IU, on the GAL.
 *   ToggleUnits (:651-657)                   metric <-> the LAST imperial
 *       unit used, and back.
 *   UpdateGridSelectBox (eda_draw_frame.cpp:444-467)  one row per grid, then
 *       "---" and "Edit Grids...", selecting last_size_idx.
 *   OnSelectGrid (:537-574)                  the separator row re-selects the
 *       current grid and changes nothing.
 *   OnUpdateSelectZoom (:488-534)            an off-preset zoom gets its own
 *       "Zoom %.2f" row at index 1; OnSelectZoom shifts past it.
 *   GRID::MessageText (grid_settings.cpp:27-41)  "x x y", or one value when
 *       the two print the same.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { EDA_DRAW_PANEL_GAL } from '@ziroeda/common/draw_panel_gal.js';
import { EDA_DRAW_FRAME } from '@ziroeda/common/eda_draw_frame.js';
import { gerbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import type { ORIGIN_TRANSFORMS } from '@ziroeda/common/origin_transforms.js';
import { GRID } from '@ziroeda/common/settings/grid_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import {
  TOOL_MANAGER,
  type TOOL_MANAGER_VIEW_CONTROLS,
} from '@ziroeda/common/tool/tool_manager.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { VC_SETTINGS } from '@ziroeda/common/view/view_controls.js';
import { wxChoice } from '@ziroeda/common/wx/choice.js';
import { ZOOM_MAX_LIMIT_GERBVIEW, ZOOM_MIN_LIMIT_GERBVIEW } from '@ziroeda/common/zoom_defines.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { GERBVIEW_SETTINGS } from '@ziroeda/gerbview/gerbview_settings.js';

class STUB_GAL extends GAL {}

class TEST_FRAME extends EDA_DRAW_FRAME {
  readonly cfg = new GERBVIEW_SETTINGS();
  private m_origin: VECTOR2I = { x: 0, y: 0 };

  constructor() {
    super(FRAME_T.FRAME_GERBER, gerbIUScale, 'mm');
  }

  override config(): GERBVIEW_SETTINGS {
    return this.cfg;
  }

  GetName(): string {
    return 'TestFrame';
  }

  GetOriginTransforms(): ORIGIN_TRANSFORMS {
    throw new Error('not used');
  }

  GetGridOrigin(): VECTOR2I {
    return this.m_origin;
  }

  SetGridOrigin(aPosition: VECTOR2I): void {
    this.m_origin = aPosition;
  }

  setToolManager(aMgr: TOOL_MANAGER): void {
    this.m_toolManager = aMgr;
  }
}

function setup(): { frame: TEST_FRAME; gal: STUB_GAL; mgr: TOOL_MANAGER; tools: COMMON_TOOLS } {
  const frame = new TEST_FRAME();
  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  const view = new VIEW();
  view.SetGAL(gal);
  // As GERBVIEW_DRAW_PANEL_GAL's constructor sets them.
  view.SetScaleLimits(ZOOM_MAX_LIMIT_GERBVIEW, ZOOM_MIN_LIMIT_GERBVIEW);

  const canvas = {
    GetGAL: () => gal,
    GetView: () => view,
    Refresh: () => {},
    ForceRefresh: () => {},
    SetFocus: () => {},
    GetClientSize: () => ({ x: 1000, y: 800 }),
    GetDefaultViewBBox: () => new BOX2I(),
  };
  frame.SetCanvas(canvas as unknown as EDA_DRAW_PANEL_GAL);

  const vcSettings = new VC_SETTINGS();
  const vc = {
    GetSettings: () => vcSettings,
    ApplySettings: () => {},
    ForceCursorPosition: () => {},
    WarpMouseCursor: () => {},
    GetMousePosition: () => ({ x: 0, y: 0 }),
    GetCursorPosition: () => ({ x: 0, y: 0 }),
    SetCrossHairCursorPosition: () => {},
    IsCursorWarpingEnabled: () => false,
    CenterOnCursor: () => {},
  };

  const mgr = new TOOL_MANAGER();
  mgr.SetEnvironment(null, view, vc as unknown as TOOL_MANAGER_VIEW_CONTROLS, frame.cfg, frame);
  frame.setToolManager(mgr);

  const tools = new COMMON_TOOLS();
  mgr.RegisterTool(tools);
  mgr.InitTools();

  return { frame, gal, mgr, tools };
}

let env: ReturnType<typeof setup>;

beforeEach(() => {
  env = setup();
});

describe('COMMON_TOOLS zoom in and out', () => {
  it('steps x1.3 then to the next GerbView preset at or past it', () => {
    // 0.8 x 1.3 = 1.04, past the 1.0 preset: 2.2. (A x1.2 step would stop at 1.0.)
    env.gal.SetZoomFactor(0.8);
    env.mgr.RunAction(ACTIONS.zoomInCenter);
    expect(env.gal.GetZoomFactor()).toBe(2.2);

    env.gal.SetZoomFactor(1.0);
    env.mgr.RunAction(ACTIONS.zoomInCenter);
    // 1.3 -> the first preset >= 1.3 in ZOOM_LIST_GERBVIEW is 2.2
    expect(env.gal.GetZoomFactor()).toBe(2.2);

    env.gal.SetZoomFactor(1.0);
    env.mgr.RunAction(ACTIONS.zoomOutCenter);
    // 1/1.3 = 0.769 -> the last preset <= it is 0.6
    expect(env.gal.GetZoomFactor()).toBe(0.6);
  });

  it('pegs at the ends of the list', () => {
    env.gal.SetZoomFactor(220);
    env.mgr.RunAction(ACTIONS.zoomInCenter);
    expect(env.gal.GetZoomFactor()).toBe(220);

    env.gal.SetZoomFactor(0.022);
    env.mgr.RunAction(ACTIONS.zoomOutCenter);
    expect(env.gal.GetZoomFactor()).toBe(0.022);
  });
});

describe('COMMON_TOOLS grid', () => {
  it('next wraps to the first grid and puts its size, in IU, on the GAL', () => {
    const grid = env.frame.cfg.m_Window.grid;
    grid.last_size_idx = grid.grids.length - 1;

    env.mgr.RunAction(ACTIONS.gridNext);

    expect(grid.last_size_idx).toBe(0);
    const g0 = grid.grids[0]!;
    // gerbIUScale: 1e5 IU per mm, the grid's mm strings parsed as DoubleValueFromString does
    const expectedX = Math.round(Number.parseFloat(g0.x) * (g0.x.includes('mil') ? 2540 : 1e5));
    expect(env.gal.GetGridSize().x).toBe(expectedX);
  });

  it('a preset puts THAT grid on the GAL', () => {
    const grid = env.frame.cfg.m_Window.grid;

    env.mgr.RunAction(ACTIONS.gridPreset, 2);

    expect(grid.last_size_idx).toBe(2);
    expect(env.gal.GetGridSize()).toEqual(env.tools.Grids()[2]);
    expect(env.tools.Grids()[2]).not.toEqual(env.tools.Grids()[0]);
  });

  it('prev wraps to the last grid', () => {
    const grid = env.frame.cfg.m_Window.grid;
    grid.last_size_idx = 0;

    env.mgr.RunAction(ACTIONS.gridPrev);

    expect(grid.last_size_idx).toBe(grid.grids.length - 1);
  });

  it('a preset beyond the list is clamped to it', () => {
    env.mgr.RunAction(ACTIONS.gridPreset, 999);
    expect(env.frame.cfg.m_Window.grid.last_size_idx).toBe(
      env.frame.cfg.m_Window.grid.grids.length - 1,
    );
  });
});

describe('COMMON_TOOLS units', () => {
  it('toggles metric to the last imperial unit used, and back', () => {
    expect(env.frame.GetUserUnits()).toBe('mm');

    env.mgr.RunAction(ACTIONS.toggleUnits);
    expect(env.frame.GetUserUnits()).toBe('in');

    env.mgr.RunAction(ACTIONS.milsUnits);
    env.mgr.RunAction(ACTIONS.toggleUnits);
    expect(env.frame.GetUserUnits()).toBe('mm');

    env.mgr.RunAction(ACTIONS.toggleUnits);
    expect(env.frame.GetUserUnits()).toBe('mils');
  });

  it('names the units in status field 5', () => {
    env.mgr.RunAction(ACTIONS.inchesUnits);
    expect(env.frame.GetStatusText(5)).toBe('inches');
  });
});

describe('EDA_DRAW_FRAME grid select box', () => {
  it('is one row per grid, then --- and Edit Grids..., on last_size_idx', () => {
    const box = new wxChoice();
    env.frame.SetGridSelectBox(box);
    env.frame.UpdateGridSelectBox();

    const grids = env.frame.cfg.m_Window.grid.grids;
    expect(box.GetCount()).toBe(grids.length + 2);
    expect(box.GetString(grids.length)).toBe('---');
    expect(box.GetString(grids.length + 1)).toBe('Edit Grids...');
    expect(box.GetSelection()).toBe(env.frame.cfg.m_Window.grid.last_size_idx);
  });

  it('the separator row changes nothing and re-selects the current grid', () => {
    const box = new wxChoice();
    env.frame.SetGridSelectBox(box);
    env.frame.UpdateGridSelectBox();
    const before = env.frame.cfg.m_Window.grid.last_size_idx;

    box.SetSelection(box.GetCount() - 2);
    env.frame.OnSelectGrid();

    expect(env.frame.cfg.m_Window.grid.last_size_idx).toBe(before);
    expect(box.GetSelection()).toBe(before);
  });

  it('a grid row runs the preset', () => {
    const box = new wxChoice();
    env.frame.SetGridSelectBox(box);
    env.frame.UpdateGridSelectBox();

    box.SetSelection(2);
    env.frame.OnSelectGrid();

    expect(env.frame.cfg.m_Window.grid.last_size_idx).toBe(2);
  });
});

describe('EDA_DRAW_FRAME zoom select box', () => {
  it('an off-preset zoom gets a Zoom %.2f row at index 1, dropped again on a preset', () => {
    const box = new wxChoice();
    env.frame.SetZoomSelectBox(box);
    env.gal.SetZoomFactor(1.0);
    env.frame.UpdateZoomSelectBox();

    // 1.0 is ZOOM_LIST_GERBVIEW[8]; index 0 is Zoom Auto
    expect(box.GetSelection()).toBe(9);

    env.gal.SetZoomFactor(1.234);
    env.frame.OnUpdateSelectZoom();
    expect(box.GetString(1)).toBe('Zoom 1.23');
    expect(box.GetSelection()).toBe(1);

    // Picking the 1.0 row, now at 10, is preset 9: the custom row shifts it.
    box.SetSelection(10);
    env.frame.OnSelectZoom();
    expect(env.gal.GetZoomFactor()).toBe(1.0);

    env.frame.OnUpdateSelectZoom();
    expect(box.GetString(1)).toBe('Zoom 0.02');
    expect(box.GetSelection()).toBe(9);
  });
});

describe('GRID::MessageText', () => {
  it('prints one value for a square grid and "x x y" otherwise', () => {
    const square = new GRID('', '0.5 mm', '0.5 mm').MessageText(gerbIUScale, 'mm', true);
    const rect = new GRID('', '0.5 mm', '1 mm').MessageText(gerbIUScale, 'mm', true);
    const half = new GRID('', '0.5 mm', '0.5 mm').MessageText(gerbIUScale, 'mm', true);

    expect(square).not.toContain(' x ');
    expect(rect).toBe(
      `${half} x ${new GRID('', '1 mm', '1 mm').MessageText(gerbIUScale, 'mm', true)}`,
    );
  });
});
