// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_PRINTOUT (`eeschema/printing/sch_printout.cpp`) on a live hierarchy: one page per active
 * sheet, printed in page-number order with that sheet current and its page number on the
 * drawing sheet, and the frame's own sheet back afterwards.
 *
 * PrintPage needs a page-sized canvas (GAL_PRINT), so a subclass records what it was handed.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_PRINTOUT } from '@ziroeda/eeschema/printing/sch_printout.js';
import type { SCH_EDIT_FRAME } from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import type { SCH_VIEW } from '@ziroeda/eeschema/sch_view.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

class RECORDING_PRINTOUT extends SCH_PRINTOUT {
  pages: { screen: SCH_SCREEN; current: string; pageNumber: string; firstPage: boolean }[] = [];

  constructor(private readonly m_frame: SCH_EDIT_FRAME) {
    super(m_frame, 'Print Schematic');
  }

  override PrintPage(aScreen: SCH_SCREEN): boolean {
    const ds = (this.m_frame.GetCanvas()!.GetView() as SCH_VIEW).GetDrawingSheet()!;
    this.pages.push({
      screen: aScreen,
      current: this.m_frame.GetCurrentSheet().PathHumanReadable(),
      pageNumber: (ds as unknown as { m_pageNumber: string }).m_pageNumber,
      firstPage: (ds as unknown as { m_isFirstPage: boolean }).m_isFirstPage,
    });
    return true;
  }
}

function setUp() {
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  return h.frame;
}

describe('SCH_PRINTOUT', () => {
  it('counts one page per active sheet', () => {
    const frame = setUp();
    const out = new SCH_PRINTOUT(frame, 'Print');
    const count = frame.Schematic().Root().CountActiveSheets();

    expect(count).toBe(frame.Schematic().Hierarchy().length);
    expect(out.GetPageInfo()).toEqual({
      minPage: 1,
      selPageFrom: 1,
      maxPage: count,
      selPageTo: count,
    });
    expect([out.HasPage(count), out.HasPage(count + 1)]).toEqual([true, false]);
  });

  it('prints each page with its sheet current, in page-number order, then restores the sheet', () => {
    const frame = setUp();
    const list = frame.Schematic().Hierarchy();
    list.SortByPageNumbers(false);
    const before = frame.GetCurrentSheet().PathHumanReadable();
    const out = new RECORDING_PRINTOUT(frame);

    for (let page = 1; page <= list.length; ++page) expect(out.OnPrintPage(page)).toBe(true);

    expect(out.pages.map((p) => p.current)).toEqual(list.map((p) => p.PathHumanReadable()));
    expect(out.pages.map((p) => p.screen)).toEqual(list.map((p) => p.LastScreen()));
    expect(out.pages.map((p) => p.pageNumber)).toEqual(list.map((p) => p.GetPageNumber()));
    expect(out.pages.map((p) => p.firstPage)).toEqual(
      list.map((p) => p.LastScreen()!.GetVirtualPageNumber() === 1),
    );
    expect(frame.GetCurrentSheet().PathHumanReadable()).toBe(before);
  });

  it('refuses a page outside the hierarchy', () => {
    const frame = setUp();
    const out = new RECORDING_PRINTOUT(frame);

    expect(out.OnPrintPage(0)).toBe(false);
    expect(out.OnPrintPage(frame.Schematic().Hierarchy().length + 1)).toBe(false);
    expect(out.pages).toEqual([]);
  });
});
