// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_EESCHEMA_PAGE_SETTINGS (dialog_eeschema_page_settings.cpp) on a live hierarchy: the
 * page and title block go into the frame's screen, and each "Export to other sheets" box copies
 * its field into every other screen - and only that field.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { DIALOG_EESCHEMA_PAGE_SETTINGS } from '@ziroeda/eeschema/dialogs/dialog_eeschema_page_settings.js';
import { SCH_SCREENS, type SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(h.frame.Schematic().Hierarchy()[0]!);
  const screens: SCH_SCREEN[] = [];
  const list = new SCH_SCREENS(h.frame.Schematic().Root());
  for (let s = list.GetFirst(); s; s = list.GetNext()) screens.push(s);
  const own = h.frame.GetScreen()!;
  return { frame: h.frame, own, others: screens.filter((s) => s !== own) };
}

const NONE = {
  paper: false,
  date: false,
  rev: false,
  title: false,
  company: false,
  comments: Array(9).fill(false),
};

describe('DIALOG_EESCHEMA_PAGE_SETTINGS', () => {
  it('opens on the screen’s page and title block', () => {
    const { frame, own } = setUp();
    const v = new DIALOG_EESCHEMA_PAGE_SETTINGS(frame).TransferDataToWindow();

    expect(v.title).toBe(own.GetTitleBlock().GetTitle());
    expect(v.paper).toBe(own.GetPageSettings().GetTypeAsString());
  });

  it('writes the page and title block into the frame’s screen only, when nothing is exported', () => {
    const { frame, own, others } = setUp();
    const dlg = new DIALOG_EESCHEMA_PAGE_SETTINGS(frame);
    const before = others.map((s) => [
      s.GetTitleBlock().GetTitle(),
      s.GetPageSettings().GetTypeAsString(),
    ]);
    const v = { ...dlg.TransferDataToWindow(), paper: 'A3', title: 'New title', rev: 'B' };

    expect(dlg.TransferDataFromWindow(v, NONE)).toBe(true);

    expect([own.GetTitleBlock().GetTitle(), own.GetTitleBlock().GetRevision()]).toEqual([
      'New title',
      'B',
    ]);
    expect(own.GetPageSettings().GetTypeAsString()).toBe('A3');
    expect(
      others.map((s) => [s.GetTitleBlock().GetTitle(), s.GetPageSettings().GetTypeAsString()]),
    ).toEqual(before);
  });

  it('exports the ticked fields to every other screen, and no others', () => {
    const { frame, others } = setUp();
    expect(others.length).toBeGreaterThan(0);
    const dlg = new DIALOG_EESCHEMA_PAGE_SETTINGS(frame);
    const revs = others.map((s) => s.GetTitleBlock().GetRevision());
    const v = { ...dlg.TransferDataToWindow(), paper: 'A3', title: 'Everywhere', rev: 'Z' };

    dlg.TransferDataFromWindow(v, { ...NONE, paper: true, title: true });

    for (const s of others) {
      expect(s.GetTitleBlock().GetTitle()).toBe('Everywhere');
      expect(s.GetPageSettings().GetTypeAsString()).toBe('A3');
    }
    expect(others.map((s) => s.GetTitleBlock().GetRevision())).toEqual(revs);
  });
});
