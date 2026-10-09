// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_BASE_FRAME::UpdateStatusBar` (sch_base_frame.cpp:252), which TOOL_MANAGER::UpdateUI runs
 * after every event: the cursor in field 2, its offset from SCH_SCREEN::m_LocalOrigin in field
 * 3. Unported, the schematic's X/Y and dx/dy panes never moved off their placeholders.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MM, mouse, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness(schFrame());
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetUserUnits('mm');
  const fields: string[] = [];
  h.frame.SetStatusTextSink((aText, aField) => {
    fields[aField] = aText;
  });
  return { h, fields };
}

describe('SCH_BASE_FRAME::UpdateStatusBar', () => {
  it('writes the cursor and its offset from the local origin as the pointer moves', () => {
    const { h, fields } = setUp();
    h.frame.GetScreen()!.m_LocalOrigin = { x: 10 * MM, y: 20 * MM };

    mouse(h, TA_MOUSE_MOTION, { x: 13 * MM, y: 24 * MM });

    // The schematic scale is short form: "%.3f" with a trailing 0 trimmed (eda_units.cpp:459, 497).
    expect(fields[2]).toBe('X 13.00  Y 24.00');
    expect(fields[3]).toBe('dx 3.00  dy 4.00  dist 5.00');
  });

  it('follows the pointer to its next position', () => {
    const { h, fields } = setUp();

    mouse(h, TA_MOUSE_MOTION, { x: 1 * MM, y: 2 * MM });
    mouse(h, TA_MOUSE_MOTION, { x: 5 * MM, y: 7 * MM });

    expect(fields[2]).toBe('X 5.00  Y 7.00');
  });
});
