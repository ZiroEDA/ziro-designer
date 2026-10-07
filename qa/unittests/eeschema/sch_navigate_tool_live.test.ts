// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_NAVIGATE_TOOL (tools/sch_navigate_tool.cpp) on the TOOL_MANAGER: enter / leave sheet,
 * back / forward history, previous / next page, and page hyperlinks.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_NAVIGATE_TOOL } from '@ziroeda/eeschema/tools/sch_navigate_tool.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const top = h.frame
    .Schematic()
    .Hierarchy()
    .find((p) => p.size() === 1)!;
  h.frame.SetCurrentSheet(top);
  const mgr = h.frame.GetToolManager()!;
  const nav = mgr.GetTool(SCH_NAVIGATE_TOOL)!;
  nav.ResetHistory();
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  const page = () => h.frame.GetCurrentSheet().GetPageNumber();
  const sheets = () => [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)] as SCH_SHEET[];
  const enter = (s: SCH_SHEET) => {
    sel.ClearSelection(true);
    sel.AddItemToSel(s, true);
    mgr.RunAction(SCH_ACTIONS.enterSheet);
  };
  return { ...h, mgr, nav, page, sheets, enter };
}

describe('SCH_NAVIGATE_TOOL', () => {
  it('enters a selected sheet and leaves it again', () => {
    const h = setUp();
    const rootPage = h.page();
    const [first] = h.sheets();
    h.enter(first!);
    expect(h.frame.GetCurrentSheet().size()).toBe(2);
    expect(h.frame.GetCurrentSheet().Last()).toBe(first);
    h.mgr.RunAction(SCH_ACTIONS.leaveSheet);
    expect(h.frame.GetCurrentSheet().size()).toBe(1);
    expect(h.page()).toBe(rootPage);
    // already at the top: up goes nowhere
    h.mgr.RunAction(SCH_ACTIONS.navigateUp);
    expect(h.frame.GetCurrentSheet().size()).toBe(1);
  });

  it('back and forward walk the history of visited sheets', () => {
    const h = setUp();
    const [a, b] = h.sheets();
    h.enter(a!);
    h.mgr.RunAction(SCH_ACTIONS.leaveSheet);
    h.enter(b!);
    expect(h.frame.GetCurrentSheet().Last()).toBe(b);
    h.mgr.RunAction(SCH_ACTIONS.navigateBack);
    expect(h.frame.GetCurrentSheet().size()).toBe(1);
    h.mgr.RunAction(SCH_ACTIONS.navigateBack);
    expect(h.frame.GetCurrentSheet().Last()).toBe(a);
    expect(h.nav.CanGoForward()).toBe(true);
    h.mgr.RunAction(SCH_ACTIONS.navigateForward);
    h.mgr.RunAction(SCH_ACTIONS.navigateForward);
    expect(h.frame.GetCurrentSheet().Last()).toBe(b);
    expect(h.nav.CanGoForward()).toBe(false);
  });

  it('next and previous step through the hierarchy by virtual page number', () => {
    const h = setUp();
    const order = h.frame.Schematic().Hierarchy();
    expect(h.nav.CanGoPrevious()).toBe(false);
    h.mgr.RunAction(SCH_ACTIONS.navigateNext);
    expect(h.frame.GetCurrentSheet().equals(order[1]!)).toBe(true);
    h.mgr.RunAction(SCH_ACTIONS.navigateNext);
    expect(h.frame.GetCurrentSheet().equals(order[2]!)).toBe(true);
    expect(h.nav.CanGoNext()).toBe(false);
    h.mgr.RunAction(SCH_ACTIONS.navigatePrevious);
    expect(h.frame.GetCurrentSheet().equals(order[1]!)).toBe(true);
  });

  it('a #page hyperlink goes to that page; a missing page says so; the back link returns', () => {
    const h = setUp();
    const errors: string[] = [];
    h.frame.ShowInfoBarError = (m: string) => {
      errors.push(m);
    };
    const target = h.frame.Schematic().Hierarchy()[2]!;
    h.nav.HypertextCommand(`#${target.GetPageNumber()}`);
    expect(h.frame.GetCurrentSheet().equals(target)).toBe(true);
    h.nav.HypertextCommand('#999');
    expect(errors).toEqual(["Page '999' not found."]);
    h.nav.HypertextCommand(SCH_NAVIGATE_TOOL.g_BackLink);
    expect(h.frame.GetCurrentSheet().size()).toBe(1);
  });
});
