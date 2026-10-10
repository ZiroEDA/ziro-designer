// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_SELECTION_TOOL::SelectAll (`eeschema/tools/sch_selection_tool.cpp`) on a live sheet: every
 * item in the view, the sheets' pins added by hand since they are not in it, each wire selected
 * end to end, and the selection filter honoured.
 */
import { resolve } from 'node:path';
import { ENDPOINT, STARTPOINT } from '@ziroeda/common/eda_item_flags.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SHEET_PIN } from '@ziroeda/eeschema/sch_sheet_pin.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
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
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  return { frame: h.frame, mgr, sel, screen: h.frame.GetScreen()! };
}

describe('SCH_SELECTION_TOOL::SelectAll', () => {
  it('selects every symbol, wire and sheet on the sheet, and each sheet’s pins', () => {
    const { mgr, sel, screen } = setUp();
    const symbols = [...screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)];
    const wires = [...screen.Items().OfType(KICAD_T.SCH_LINE_T)] as SCH_LINE[];
    const sheets = [...screen.Items().OfType(KICAD_T.SCH_SHEET_T)] as SCH_SHEET[];
    // The fixture's sheets have no pins; give one a pin, which the view does not hold.
    sheets[0]!.AddPin(new SCH_SHEET_PIN(sheets[0]!, sheets[0]!.GetPosition(), 'P'));
    const pins = sheets.flatMap((s) => s.GetPins());
    expect(pins.length).toBeGreaterThan(0);
    expect([symbols.length, wires.length, sheets.length].every((n) => n > 0)).toBe(true);

    mgr.RunAction(ACTIONS.selectAll);

    const selected = new Set(sel.GetSelection().GetItems());
    for (const item of [...symbols, ...wires, ...sheets, ...pins])
      expect(selected.has(item)).toBe(true);
    for (const w of wires) expect(w.HasFlag(STARTPOINT) && w.HasFlag(ENDPOINT)).toBe(true);
  });

  it('leaves out what the selection filter excludes', () => {
    const { mgr, sel, screen } = setUp();
    sel.GetFilter().wires = false;

    mgr.RunAction(ACTIONS.selectAll);

    const selected = new Set(sel.GetSelection().GetItems());
    const wires = [...screen.Items().OfType(KICAD_T.SCH_LINE_T)] as SCH_LINE[];
    const symbols = [...screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)];
    expect(wires.filter((w) => w.IsWire() && selected.has(w))).toEqual([]);
    expect(symbols.every((s) => selected.has(s))).toBe(true);
  });
});
