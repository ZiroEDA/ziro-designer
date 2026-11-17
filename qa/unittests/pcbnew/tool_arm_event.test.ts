// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A tool armed by its hotkey is armed at the cursor; from a menu row or the toolbar, nowhere.
 *
 * `ACTION_MANAGER::RunHotKey` -> `TOOL_MANAGER::RunAction` -> `doRunAction`, which gives a
 * TC_COMMAND event `SetMousePosition( GetCursorPosition() )` (tool_manager.cpp:349), and
 * ROUTER_TOOL::MainLoop primes itself from it (`if( aEvent.HasPosition() ) PrimeTool(...)`,
 * router_tool.cpp:1967): X over a pad starts the route from that pad. Ours ran every arming
 * the menu's way, with no position, so X only armed the router (blinky555, I-12).
 */
import { describe, expect, it } from 'vitest';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { toolArmEvent } from '@ziroeda/pcbnew/pcb_edit_frame_ui.js';

const mgr = { GetCursorPosition: () => ({ x: 1_500_000, y: -250_000 }) };

describe('toolArmEvent', () => {
  it('from a hotkey: the action at the cursor', () => {
    const evt = toolArmEvent(PCB_ACTIONS.routeSingleTrack, mgr, true);
    expect(evt.HasPosition()).toBe(true);
    expect(evt.Position()).toEqual({ x: 1_500_000, y: -250_000 });
    expect(evt.IsAction(PCB_ACTIONS.routeSingleTrack)).toBe(true);
  });

  it('from a menu row or the toolbar: no position, so nothing is primed', () => {
    const evt = toolArmEvent(PCB_ACTIONS.routeSingleTrack, mgr, false);
    expect(evt.HasPosition()).toBe(false);
  });
});
