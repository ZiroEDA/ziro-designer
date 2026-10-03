// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME::setupUIConditions` (pcb_edit_frame.cpp:995-1367): what each
 * action's check / enable state is a function of, asked of the frame the way
 * ACTION_MANAGER asks it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import { ZONE_DISPLAY_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PnsMode } from '@ziroeda/pcbnew/router/pns_routing_settings.js';
import { ROUTER_TOOL } from '@ziroeda/pcbnew/router/router_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';

beforeAll(() => {
  installPgm();
});

function frame(shown: Set<string> = new Set()) {
  const settings = new PCBNEW_SETTINGS();
  const hooks = {
    settings: () => settings,
    onModify: () => {},
    paneShown: (aName: string) => shown.has(aName),
  } as unknown as PCB_EDIT_FRAME_HOOKS;
  const f = new PCB_EDIT_FRAME(hooks);
  f.SetBoard(new BOARD());
  return { f, settings, shown };
}

const sel = new SELECTION();
const checked = (f: PCB_EDIT_FRAME, a: TOOL_ACTION): boolean =>
  f.GetToolManager()!.GetActionManager().GetCondition(a)!.checkCondition(sel);
const enabled = (f: PCB_EDIT_FRAME, a: TOOL_ACTION): boolean =>
  f.GetToolManager()!.GetActionManager().GetCondition(a)!.enableCondition(sel);

describe('PCB_EDIT_FRAME::setupUIConditions', () => {
  it('undo is enabled by the undo list', () => {
    const { f } = frame();
    expect(enabled(f, ACTIONS.undo)).toBe(false);
    const shape = new PCB_SHAPE(f.GetBoard());
    shape.SetLayer(PCB_LAYER_ID.F_SilkS);
    const commit = new BOARD_COMMIT(f);
    commit.Add(shape);
    commit.Push('add');
    expect(enabled(f, ACTIONS.undo)).toBe(true);
  });

  it('cut / copy / select all want a board with items in it', () => {
    const { f } = frame();
    expect(enabled(f, ACTIONS.copy)).toBe(false);
    const shape = new PCB_SHAPE(f.GetBoard());
    shape.SetLayer(PCB_LAYER_ID.F_SilkS);
    f.GetBoard()!.Add(shape);
    expect(enabled(f, ACTIONS.copy)).toBe(true);
    expect(enabled(f, ACTIONS.selectAll)).toBe(true);
  });

  it('the zone display rows check the display option they set', () => {
    const { f } = frame();
    const opts = f.GetDisplayOptions();
    opts.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE;
    expect(checked(f, PCB_ACTIONS.zoneDisplayOutline)).toBe(true);
    expect(checked(f, PCB_ACTIONS.zoneDisplayFilled)).toBe(false);
  });

  it('the pane rows check the pane being shown', () => {
    const { f, shown } = frame();
    expect(checked(f, PCB_ACTIONS.showLayersManager)).toBe(false);
    shown.add('LayersManager');
    shown.add('PropertiesManager');
    shown.add('NetInspector');
    shown.add('Search');
    expect(checked(f, PCB_ACTIONS.showLayersManager)).toBe(true);
    expect(checked(f, ACTIONS.showProperties)).toBe(true);
    expect(checked(f, PCB_ACTIONS.showNetInspector)).toBe(true);
    expect(checked(f, ACTIONS.showSearch)).toBe(true);
  });

  it('the ratsnest rows follow the display settings', () => {
    const { f, settings } = frame();
    settings.m_Display.m_ShowGlobalRatsnest = false;
    settings.m_Display.m_DisplayRatsnestLinesCurved = true;
    expect(checked(f, PCB_ACTIONS.showRatsnest)).toBe(false);
    expect(checked(f, PCB_ACTIONS.ratsnestLineMode)).toBe(true);
  });

  it('the router mode rows check the router tool’s mode', () => {
    const { f } = frame();
    const router = f.GetToolManager()!.GetTool(ROUTER_TOOL)!;
    const mode = router.GetRouterMode();
    expect(checked(f, PCB_ACTIONS.routerShoveMode)).toBe(mode === PnsMode.RM_Shove);
    expect(checked(f, PCB_ACTIONS.routerWalkaroundMode)).toBe(mode === PnsMode.RM_Walkaround);
    expect(checked(f, PCB_ACTIONS.routerHighlightMode)).toBe(mode === PnsMode.RM_MarkObstacles);
  });

  it('auto track width checks BOARD_DESIGN_SETTINGS::m_UseConnectedTrackWidth', () => {
    const { f } = frame();
    f.GetDesignSettings().m_UseConnectedTrackWidth = true;
    expect(checked(f, PCB_ACTIONS.autoTrackWidth)).toBe(true);
    f.GetDesignSettings().m_UseConnectedTrackWidth = false;
    expect(checked(f, PCB_ACTIONS.autoTrackWidth)).toBe(false);
  });

  it('a tool row is checked while it is the current tool', () => {
    const { f } = frame();
    expect(checked(f, ACTIONS.measureTool)).toBe(false);
    f.PushTool(ACTIONS.measureTool.MakeEvent());
    expect(checked(f, ACTIONS.measureTool)).toBe(true);
  });

  it('the flip-board row checks m_FlipBoardView', () => {
    const { f } = frame();
    f.GetDisplayOptions().m_FlipBoardView = true;
    expect(checked(f, PCB_ACTIONS.flipBoard)).toBe(true);
  });
});
