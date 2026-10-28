// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MAIL_SCH_NAVIGATE_TO_SHEET` (eeschema/cross-probing.cpp:1166-1183): the project tree activated
 * a sub-sheet while the schematic editor holds the project (project_tree_item.cpp:274-299). The
 * editor changes to the FIRST sheet path in Hierarchy() whose screen is that file and answers
 * "success"; a file no sheet shows clears the payload, and the sheet shown does not move.
 */
import { resolve } from 'node:path';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import type { SCH_EDIT_FRAME } from '@ziroeda/eeschema/sch_edit_frame.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function navigate(aFrame: SCH_EDIT_FRAME, aFile: string): string {
  const payload = { value: aFile };
  aFrame.KiwayMailIn(
    new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_NAVIGATE_TO_SHEET, payload),
  );
  return payload.value;
}

function setUp(): SCH_EDIT_FRAME {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  return h.frame;
}

describe('MAIL_SCH_NAVIGATE_TO_SHEET', () => {
  it('changes to the first instance of the file, by its full name', () => {
    const frame = setUp();
    const instances = frame
      .Schematic()
      .Hierarchy()
      .filter((p) => p.LastScreen()?.GetFileName() === '/complex_hierarchy/ampli_ht.kicad_sch');
    // The fixture shows ampli_ht twice: "first" is what is being pinned.
    expect(instances.length).toBeGreaterThan(1);
    expect(frame.GetCurrentSheet().size()).toBe(1);

    expect(navigate(frame, '/complex_hierarchy/ampli_ht.kicad_sch')).toBe('success');
    expect(frame.GetCurrentSheet().equals(instances[0]!)).toBe(true);
  });

  it("takes the manager's project-relative name against the project's folder", () => {
    const frame = setUp();
    expect(navigate(frame, 'ampli_ht.kicad_sch')).toBe('success');
    expect(frame.GetCurrentSheet().LastScreen()?.GetFileName()).toBe(
      '/complex_hierarchy/ampli_ht.kicad_sch',
    );
  });

  it('a file no sheet shows clears the payload and stays on the sheet shown', () => {
    const frame = setUp();
    const before = frame.GetCurrentSheet().PathAsString();
    expect(navigate(frame, 'not_a_sheet.kicad_sch')).toBe('');
    expect(frame.GetCurrentSheet().PathAsString()).toBe(before);
  });

  it('back to the root from a sub-sheet', () => {
    const frame = setUp();
    navigate(frame, 'ampli_ht.kicad_sch');
    expect(navigate(frame, 'complex_hierarchy.kicad_sch')).toBe('success');
    expect(frame.GetCurrentSheet().size()).toBe(1);
  });
});
