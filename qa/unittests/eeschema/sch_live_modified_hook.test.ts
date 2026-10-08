// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The TRANSITIONAL `liveModified` hook (until S7): every SCH_COMMIT push reaches
 * SCH_EDIT_FRAME::OnModify, which tells the window the live model changed so it can follow the
 * tools that edit it. A commit flagged SKIP_SET_DIRTY does not.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_COMMIT, SKIP_SET_DIRTY } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

describe('liveModified', () => {
  it('is told once per commit push, and not for a commit that leaves the document clean', () => {
    let told = 0;
    const h = schToolHarness(schFrame({ liveModified: () => told++ }));
    openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
    told = 0;

    const commit = new SCH_COMMIT(h.frame.GetToolManager()!);
    commit.Add(new SCH_TEXT({ x: 0, y: 0 }, 'ZQX'), h.frame.GetScreen());
    commit.Push('Add');
    expect(told).toBe(1);

    const quiet = new SCH_COMMIT(h.frame.GetToolManager()!);
    quiet.Add(new SCH_TEXT({ x: 10, y: 0 }, 'ZQX 2'), h.frame.GetScreen());
    quiet.Push('Add', SKIP_SET_DIRTY);
    expect(told).toBe(1);
  });

  it('liveSheetChanged is told when DisplayCurrentSheet shows another sheet', () => {
    let told = 0;
    const h = schToolHarness(schFrame({ liveSheetChanged: () => told++ }));
    openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
    const sub = h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!;
    told = 0;

    h.frame.SetCurrentSheet(sub);
    expect(told).toBe(0); // SetCurrentSheet alone does not display it
    h.frame.DisplayCurrentSheet();
    expect(told).toBe(1);
  });
});
