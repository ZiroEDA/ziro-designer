// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_ALIGN_TOOL (tools/sch_align_tool.cpp) on the TOOL_MANAGER: the target is the item under the
 * cursor, else a locked item, else the outermost; connectable items land on the grid.
 */
import { resolve } from 'node:path';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1)!,
  );
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  const text = (x: number, y: number) => {
    const t = new SCH_TEXT(P(x, y), 'T');
    h.frame.AddToScreen(t, h.frame.GetScreen());
    return t;
  };
  const select = (...items: EDA_ITEM[]) => {
    sel.ClearSelection(true);
    for (const i of items) sel.AddItemToSel(i, true);
  };
  return { ...h, mgr, text, select };
}

describe('SCH_ALIGN_TOOL', () => {
  it('aligns left edges to the leftmost item when nothing is under the cursor', () => {
    const h = setUp();
    const a = h.text(0, 0);
    const b = h.text(10, 4);
    const c = h.text(4, 8);
    h.h.mouse = P(100, 100);
    h.select(a, b, c);
    const left = a.GetBoundingBox().GetLeft();
    const undo = h.frame.GetUndoCommandCount();
    h.mgr.RunAction(SCH_ACTIONS.alignLeft);
    expect([a, b, c].map((t) => t.GetBoundingBox().GetLeft())).toEqual([left, left, left]);
    expect(b.GetPosition().y).toBe(P(10, 4).y); // only the one axis
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('the item under the cursor is the target', () => {
    const h = setUp();
    const a = h.text(0, 0);
    const b = h.text(0, 6);
    const c = h.text(0, 12);
    h.h.mouse = b.GetBoundingBox().Centre();
    h.select(a, b, c);
    h.mgr.RunAction(SCH_ACTIONS.alignTop);
    const top = b.GetBoundingBox().GetTop();
    expect([a, c].map((t) => t.GetBoundingBox().GetTop())).toEqual([top, top]);
    expect(b.GetPosition()).toEqual(P(0, 6));
  });

  it('a locked item is the target and does not move', () => {
    const h = setUp();
    const a = h.text(0, 0);
    const b = h.text(20, 0);
    b.SetLocked(true);
    h.h.mouse = P(100, 100);
    h.select(a, b);
    h.mgr.RunAction(SCH_ACTIONS.alignRight);
    expect(b.GetPosition()).toEqual(P(20, 0));
    expect(a.GetBoundingBox().GetRight()).toBe(b.GetBoundingBox().GetRight());
  });
});
