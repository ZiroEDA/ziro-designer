// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_DRAWING_TOOLS::DrawShape, DrawRuleArea (with RULE_AREA_CREATE_HELPER) and DrawTable
 * (tools/sch_drawing_tools.cpp) on the TOOL_MANAGER.
 */
import { resolve } from 'node:path';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SCH_RULE_AREA } from '@ziroeda/eeschema/sch_rule_area.js';
import type { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import type { SCH_TABLE } from '@ziroeda/eeschema/sch_table.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, mouse, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1)!,
  );
  const mgr = h.frame.GetToolManager()!;
  const screen = () => h.frame.GetScreen()!;
  const added = <T>(aType: KICAD_T, before: Set<unknown>) =>
    [...screen().Items().OfType(aType)].filter((i) => !before.has(i)) as T[];
  return { ...h, mgr, sel: mgr.GetTool(SCH_SELECTION_TOOL)!, screen, added };
}

describe('SCH_DRAWING_TOOLS::DrawShape', () => {
  it('draws a rectangle from click to click, one undo step, selected', async () => {
    const h = setUp();
    const before = new Set(h.screen().Items().OfType(KICAD_T.SCH_SHAPE_T));
    const undo = h.frame.GetUndoCommandCount();
    h.h.mouse = P(0, 0); // the primed click starts it
    h.mgr.RunAction(SCH_ACTIONS.drawRectangle);
    mouse(h, TA_MOUSE_MOTION, P(8, 4));
    click(h, P(8, 4));
    await flush();
    const shapes = h.added<SCH_SHAPE>(KICAD_T.SCH_SHAPE_T, before);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(shapes[0]!.GetStart()).toEqual(P(0, 0));
    expect(shapes[0]!.GetEnd()).toEqual(P(8, 4));
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    const sel = h.sel.GetSelection().GetItems();
    expect(sel.length === 1 && sel[0] === shapes[0]).toBe(true);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
  });

  it('Escape mid-shape draws nothing', async () => {
    const h = setUp();
    const before = new Set(h.screen().Items().OfType(KICAD_T.SCH_SHAPE_T));
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.drawCircle);
    mouse(h, TA_MOUSE_MOTION, P(3, 0));
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    await flush();
    expect(h.added(KICAD_T.SCH_SHAPE_T, before)).toHaveLength(0);
  });

  it('a text box asks for its text, and a cancelled dialog adds nothing', async () => {
    let answer = wxID_CANCEL;
    const h = setUp({ showModal: () => answer });
    const before = new Set(h.screen().Items().OfType(KICAD_T.SCH_TEXTBOX_T));
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.drawTextBox);
    mouse(h, TA_MOUSE_MOTION, P(6, 3));
    click(h, P(6, 3));
    await flush();
    expect(h.added(KICAD_T.SCH_TEXTBOX_T, before)).toHaveLength(0);
    answer = wxID_OK;
    click(h, P(10, 10));
    mouse(h, TA_MOUSE_MOTION, P(14, 12));
    click(h, P(14, 12));
    await flush();
    expect(h.added(KICAD_T.SCH_TEXTBOX_T, before)).toHaveLength(1);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
  });
});

describe('SCH_DRAWING_TOOLS::DrawRuleArea', () => {
  it('locks in corners on clicks and closes on a double click', async () => {
    const h = setUp();
    const before = new Set(h.screen().Items().OfType(KICAD_T.SCH_RULE_AREA_T));
    h.h.mouse = P(0, 0); // primed: the first corner
    h.mgr.RunAction(SCH_ACTIONS.drawRuleArea);
    mouse(h, TA_MOUSE_MOTION, P(10, 0));
    click(h, P(10, 0));
    mouse(h, TA_MOUSE_MOTION, P(10, 10));
    click(h, P(10, 10));
    mouse(h, TA_MOUSE_MOTION, P(0, 10));
    click(h, P(0, 10));
    h.mgr.RunAction(SCH_ACTIONS.closeOutline);
    await flush();
    const areas = h.added<SCH_RULE_AREA>(KICAD_T.SCH_RULE_AREA_T, before);
    expect(areas).toHaveLength(1);
    const outline = areas[0]!.GetPolyShape().Outline(0);
    expect(outline.PointCount()).toBe(4);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
  });
});

describe('SCH_DRAWING_TOOLS::DrawTable', () => {
  it('sizes a table to the drag and adds it when the table dialog says OK', async () => {
    const h = setUp({
      showModal: (d) => (d === 'DIALOG_TABLE_PROPERTIES' ? wxID_OK : wxID_CANCEL),
    });
    const before = new Set(h.screen().Items().OfType(KICAD_T.SCH_TABLE_T));
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.drawTable);
    mouse(h, TA_MOUSE_MOTION, P(60, 6));
    click(h, P(60, 6));
    await flush();
    const tables = h.added<SCH_TABLE>(KICAD_T.SCH_TABLE_T, before);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.GetPosition()).toEqual(P(0, 0));
    expect(tables[0]!.GetColCount()).toBeGreaterThan(1);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
  });
});
