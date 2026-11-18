// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reported: clicking the rectangle or line button started the shape right there, under the
 * toolbar, instead of only arming the tool.
 *
 * ACTION_TOOLBAR::onToolEvent (action_toolbar.cpp:804-811) hands the tool an event with
 * SetHasPosition( false ); DrawShape primes its first point only when the activating event
 * has a position (sch_drawing_tools.cpp:2565-2566). The frame ran the button through
 * RunAction, which stamps the cursor position on every TC_COMMAND (tool_manager.cpp:348-349),
 * so the first corner landed where the pointer was: on the button.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { TA_MOUSE_CLICK, TA_MOUSE_DOWN, TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { schToolbarAction } from '@ziroeda/eeschema/toolbars_sch_editor.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mouse, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const UI = readFileSync(join(__dirname, '../../../eeschema/sch_edit_frame_ui.tsx'), 'utf8');

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const TOOLBAR = { x: -508000, y: -508000 }; // on the 50 mil grid, so snapping keeps it
const A = { x: 254000, y: 254000 };
const B = { x: 508000, y: 381000 };

function drawAfterButton(aPositionless: boolean) {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const mgr = h.frame.GetToolManager()!;
  const screen = h.frame.GetScreen()!;
  const before = new Set(screen.Items());

  h.h.mouse = { ...TOOLBAR }; // the pointer is on the button
  const action = schToolbarAction('rectangle')!;
  if (aPositionless) {
    const evt = action.MakeEvent();
    evt.SetHasPosition(false);
    mgr.ProcessEvent(evt);
  } else mgr.RunAction(action);

  for (const at of [A, B]) {
    mouse(h, TA_MOUSE_MOTION, at);
    mouse(h, TA_MOUSE_DOWN, at);
    mouse(h, TA_MOUSE_CLICK, at);
  }

  return [...screen.Items()].filter((i) => !before.has(i) && i instanceof SCH_SHAPE) as SCH_SHAPE[];
}

describe('a toolbar drawing button', () => {
  it('only arms the tool: the first click on the sheet is the first corner', () => {
    const [rect, ...rest] = drawAfterButton(true);
    expect(rest).toEqual([]);
    expect(rect!.GetStart()).toEqual(A);
    expect(rect!.GetEnd()).toEqual(B);
  });

  it('with the cursor stamped on (RunAction), the corner lands under the button', () => {
    const [rect] = drawAfterButton(false);
    expect(rect!.GetStart()).toEqual(TOOLBAR);
  });

  it("the frame's TOOL_MANAGER tools are armed with a positionless event, as onToolEvent does", () => {
    const body = UI.slice(UI.indexOf('const runToolManagerTool'), UI.indexOf('const onToolSelect'));
    expect(body).toMatch(/evt\.SetHasPosition\(false\);\s*galMgr\.ProcessEvent\(evt\);/);
    expect(body).not.toMatch(/RunAction/);
  });

  // Per call site, because each of them used to have its own copy - and the menu's had none:
  // Place > Draw Hierarchical Sheets set the record tool state, which no TOOL_MANAGER tool
  // reads, so the menu armed nothing (uartbridge, U-1). ACTION_MENU::OnMenuEvent runs the same
  // TOOL_ACTION the button does.
  it.each([
    ['the right toolbar', 'const onRightToolbar', 'const onLeftToggle'],
    ['a Place menu row', 'const onToolSelect', 'const onImageFile'],
  ])('%s runs it before anything else', (_name, aFrom, aTo) => {
    const start = UI.indexOf(aFrom);
    const body = UI.slice(start, UI.indexOf(aTo, start));
    const first = body
      .slice(body.indexOf('=>') + 2)
      .match(/^\s*\{?\s*(?:\/\/[^\n]*\n\s*)*(.+)$/m)?.[1];
    expect(first).toBe('if (runToolManagerTool(id)) return;');
  });

  it('the menus hand their tool rows to onToolSelect', () => {
    expect(UI).toMatch(/buildMenus\(\s*\{\s*tool: onToolSelect,/);
  });
});
