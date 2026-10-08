// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_PROPERTIES_PANEL (eeschema/widgets/sch_properties_panel.cpp) over the live frame: the
 * selection tool's items, a row per field name on the selected symbols, an edit one SCH_COMMIT
 * ("Edit Properties") that reaches the other units, the reference routed through the symbol,
 * and a sheet file name checked before anything changes.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import type { SCH_SHEET_PATH } from '@ziroeda/eeschema/sch_sheet_path.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { SCH_PROPERTIES_PANEL } from '@ziroeda/eeschema/widgets/sch_properties_panel.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const errors: string[] = [];
  const h = schToolHarness(schFrame({ displayError: (m) => errors.push(m) }));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const schematic = h.frame.Schematic();
  const symbolsOn = (p: SCH_SHEET_PATH) =>
    [...p.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[];
  const path = schematic.Hierarchy().find((p) => symbolsOn(p).some((s) => s.GetUnitCount() > 1))!;
  h.frame.SetCurrentSheet(path);
  const symbols = symbolsOn(path);
  const unit = symbols.find((s) => s.GetUnitCount() > 1)!;
  const others = symbols.filter((s) => s !== unit && s.GetRef(path) === unit.GetRef(path));
  const sel = h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
  const panel = new SCH_PROPERTIES_PANEL(h.frame);
  const select = (...aItems: Parameters<typeof sel.AddItemToSel>[0][]) => {
    sel.ClearSelection(true);
    for (const item of aItems) sel.AddItemToSel(item, true);
    panel.UpdateData();
  };
  return { h, path, symbols, unit, others, panel, select, errors };
}

const rowNames = (aPanel: SCH_PROPERTIES_PANEL, aGroup: string) =>
  aPanel.m_groups.find((g) => g.name === aGroup)?.cells.map((c) => c.property.Name()) ?? [];

describe('SCH_PROPERTIES_PANEL', () => {
  it("shows the selection tool's symbol, a Fields row per field name on it", () => {
    const { unit, panel, select } = setUp();
    const extra = new SCH_FIELD(unit, FIELD_T.USER, 'ZZ Supplier');
    extra.SetText('ACME');
    unit.AddField(extra);

    select(unit);

    expect(panel.m_caption).toBe('Symbol');
    const fields = rowNames(panel, 'Fields');
    expect(fields).toContain('ZZ Supplier');
    const cell = panel.m_groups
      .flatMap((g) => g.cells)
      .find((c) => c.property.Name() === 'ZZ Supplier')!;
    expect(cell.value).toBe('ACME');

    // The row is offered only while a selected symbol has that field.
    select();
    expect(panel.m_caption).toBe('No objects selected');
  });

  it('an edit is one "Edit Properties" commit, and reaches the other units', async () => {
    const { h, unit, others, panel, select } = setUp();
    expect(others.length).toBeGreaterThan(0);
    select(unit);
    const undo = h.frame.GetUndoCommandCount();

    await panel.valueChanged('Value', 'LM-PANEL');

    expect(unit.GetValueProp()).toBe('LM-PANEL');
    for (const o of others) expect(o.GetField(FIELD_T.VALUE)!.GetText()).toBe('LM-PANEL');
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    // AfterCommit re-reads the grid.
    const cell = panel.m_groups.flatMap((g) => g.cells).find((c) => c.property.Name() === 'Value')!;
    expect(cell.value).toBe('LM-PANEL');
  });

  it("a reference field's Text goes through the symbol, so the instance data is what changes", async () => {
    const { path, unit, panel, select } = setUp();
    const refField = unit.GetField(FIELD_T.REFERENCE)!;
    select(refField);

    await panel.valueChanged('Text', 'U99');

    expect(unit.GetRef(path)).toBe('U99');
  });

  it('a sheet name the validator refuses is vetoed with the field message', () => {
    const { h, panel, select } = setUp();
    const sheet = [
      ...h.frame.Schematic().Root().GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T),
    ][0] as SCH_SHEET;
    h.frame.SetCurrentSheet(h.frame.Schematic().Hierarchy()[0]!);
    select(sheet);

    const veto = panel.valueChanging('Sheet Name', 'a/b');

    expect(veto?.message).toMatch(/^Sheet Name: /);
    expect(panel.valueChanging('Sheet Name', 'fine')).toBe(null);
  });

  it('a sheet file name must be valid; the same name changes nothing', async () => {
    const { h, panel, errors } = setUp();
    const sheet = [
      ...h.frame.Schematic().Root().GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T),
    ][0] as SCH_SHEET;
    const commit = new SCH_COMMIT(h.frame);

    expect(await panel.handleSheetFilenameChange(h.frame, sheet, commit, 'bad\0name')).toBe(false);
    expect(errors).toEqual(['A sheet must have a valid file name.']);

    // The extension is added before comparing, so the bare name is the same file.
    const bare = sheet.GetFileName().replace(/\.kicad_sch$/, '');
    expect(await panel.handleSheetFilenameChange(h.frame, sheet, commit, bare)).toBe(true);
    expect(commit.Empty()).toBe(true);
  });
});
