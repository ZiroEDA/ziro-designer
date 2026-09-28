// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * PROPERTIES_TOOL (`common/tool/properties_tool.cpp`) and
 * `EDA_DRAW_FRAME::UpdateProperties` (eda_draw_frame.cpp:1336-1342): the six
 * events that refresh the Properties panel, and when the frame refuses to.
 */
import { describe, expect, it } from 'vitest';
import { EDA_DRAW_FRAME, type PROPERTIES_PANEL } from '@ziroeda/common/eda_draw_frame.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PROPERTIES_TOOL } from '@ziroeda/common/tool/properties_tool.js';
import {
  AS_GLOBAL,
  EVENTS,
  TA_UNDO_REDO_POST,
  TA_UNDO_REDO_PRE,
  TC_MESSAGE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

class TEST_FRAME extends (EDA_DRAW_FRAME as unknown as new (
  t: FRAME_T,
  s: typeof pcbIUScale,
  u: string,
) => { [K in keyof EDA_DRAW_FRAME]: EDA_DRAW_FRAME[K] }) {
  closing(v: boolean): void {
    (this as unknown as { m_isClosing: boolean }).m_isClosing = v;
  }
}

function setup(shown = true) {
  const frame = new TEST_FRAME(FRAME_T.FRAME_PCB_EDITOR, pcbIUScale, 'mm') as TEST_FRAME;
  let updates = 0;
  const panel: PROPERTIES_PANEL = {
    IsShownOnScreen: () => shown,
    UpdateData: () => {
      updates++;
    },
  };
  frame.SetPropertiesPanel(panel);
  const mgr = new TOOL_MANAGER();
  mgr.SetEnvironment(null, null, null, null, frame as never);
  mgr.RegisterTool(new PROPERTIES_TOOL());
  mgr.InitTools();
  return { frame, mgr, updates: () => updates };
}

describe('PROPERTIES_TOOL', () => {
  it('is common.Properties', () => {
    expect(new PROPERTIES_TOOL().GetName()).toBe('common.Properties');
  });

  it.each([
    ['undo/redo post', new TOOL_EVENT(TC_MESSAGE, TA_UNDO_REDO_POST, AS_GLOBAL)],
    ['PointSelectedEvent', EVENTS.PointSelectedEvent],
    ['SelectedEvent', EVENTS.SelectedEvent],
    ['UnselectedEvent', EVENTS.UnselectedEvent],
    ['ClearedEvent', EVENTS.ClearedEvent],
    ['SelectedItemsModified', EVENTS.SelectedItemsModified],
  ])('%s refreshes the panel', (_n, evt) => {
    const env = setup();
    env.mgr.ProcessEvent(evt);
    expect(env.updates()).toBe(1);
  });

  it('undo/redo PRE and an unrelated event do not', () => {
    const env = setup();
    env.mgr.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_UNDO_REDO_PRE, AS_GLOBAL));
    env.mgr.ProcessEvent(EVENTS.SelectedItemsMoved);
    expect(env.updates()).toBe(0);
  });

  it('the frame skips a hidden panel, a closing frame, and no panel', () => {
    const hidden = setup(false);
    hidden.mgr.ProcessEvent(EVENTS.SelectedEvent);
    expect(hidden.updates()).toBe(0);

    const closing = setup();
    closing.frame.closing(true);
    closing.mgr.ProcessEvent(EVENTS.SelectedEvent);
    expect(closing.updates()).toBe(0);

    const none = setup();
    none.frame.SetPropertiesPanel(null);
    none.mgr.ProcessEvent(EVENTS.SelectedEvent);
    expect(none.updates()).toBe(0);
  });

  it('a units change refreshes it too (EDA_DRAW_FRAME::unitsChangeRefresh)', () => {
    const env = setup();
    env.frame.ChangeUserUnits('in');
    expect(env.updates()).toBe(1);
  });
});

describe('PCB_EDIT_FRAME registers PROPERTIES_TOOL (pcb_edit_frame.cpp:976)', () => {
  it('a selection event reaches the frame panel', () => {
    installPgm();
    const settings = new PCBNEW_SETTINGS();
    const frame = new PCB_EDIT_FRAME({ settings: () => settings } as never);
    let updates = 0;
    frame.SetPropertiesPanel({ IsShownOnScreen: () => true, UpdateData: () => updates++ });
    frame.GetToolManager()!.ProcessEvent(EVENTS.SelectedEvent);
    expect(updates).toBe(1);
  });
});
