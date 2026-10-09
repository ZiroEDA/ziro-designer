// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TABLECELL_PROPERTIES (dialog_tablecell_properties.cpp) on live cells: a single cell's
 * values, the indeterminate states several disagreeing cells show, an indeterminate control
 * writing nothing, the fill colour (unspecified is no fill), one commit, and the return values -
 * Properties' Edit Table... hands over to DIALOG_TABLE_PROPERTIES.
 */
import { resolve } from 'node:path';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import { DIALOG_TABLECELL_PROPERTIES } from '@ziroeda/eeschema/dialogs/dialog_tablecell_properties.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_TABLE } from '@ziroeda/eeschema/sch_table.js';
import { SCH_TABLECELL } from '@ziroeda/eeschema/sch_tablecell.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { TABLECELL_PROPS_RETVALUE } from '@ziroeda/eeschema/tools/sch_edit_tool.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(h.frame.Schematic().Hierarchy()[0]!);

  const table = new SCH_TABLE();
  table.SetColCount(2);
  for (const text of ['A', 'B', 'C', 'D']) {
    const cell = new SCH_TABLECELL();
    cell.SetText(text);
    table.AddCell(cell);
  }
  table.Normalize();
  h.frame.AddToScreen(table, h.frame.GetScreen());

  const cells = [table.GetCell(0, 0)!, table.GetCell(0, 1)!];
  return { h, table, cells };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('DIALOG_TABLECELL_PROPERTIES', () => {
  it('shows one cell’s own values', () => {
    const { h, cells } = setUp();
    cells[0]!.SetBold(true);
    cells[0]!.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);

    const shown = new DIALOG_TABLECELL_PROPERTIES(h.frame, [cells[0]!]).TransferDataToWindow();

    expect([shown.text, shown.bold, shown.hAlign, shown.textColorSet]).toEqual([
      'A',
      true,
      GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
      true,
    ]);
  });

  it('shows what two cells disagree on as indeterminate', () => {
    const { h, cells } = setUp();
    cells[1]!.SetBold(true);
    cells[1]!.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    cells[1]!.SetMarginLeft(cells[0]!.GetMarginLeft() + 100);

    const shown = new DIALOG_TABLECELL_PROPERTIES(h.frame, cells).TransferDataToWindow();

    expect(shown.bold).toBeNull();
    expect(shown.hAlign).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE);
    expect(shown.marginLeft).toBe(INDETERMINATE_STATE);
    expect(shown.marginTop).not.toBe(INDETERMINATE_STATE);
    // Each cell's text is set in turn; the last one is what the box holds.
    expect(shown.text).toBe('B');
  });

  it('leaves an indeterminate property alone, writes the rest to every cell, as one commit', () => {
    const { h, cells } = setUp();
    cells[1]!.SetBold(true);
    const undo = h.frame.GetUndoCommandCount();
    const dlg = new DIALOG_TABLECELL_PROPERTIES(h.frame, cells);
    const shown = dlg.TransferDataToWindow();

    expect(dlg.TransferDataFromWindow({ ...shown, text: 'X', italic: true })).toBe(true);

    expect(cells.map((c) => [c.GetText(), c.IsBold(), c.IsItalic()])).toEqual([
      ['X', false, true],
      ['X', true, true],
    ]);
    expect(dlg.GetReturnValue()).toBe(TABLECELL_PROPS_RETVALUE.TABLECELL_PROPS_OK);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('fills with the chosen colour, and an unspecified fill is no fill', () => {
    const { h, cells } = setUp();
    const dlg = new DIALOG_TABLECELL_PROPERTIES(h.frame, [cells[0]!]);
    const shown = dlg.TransferDataToWindow();

    dlg.TransferDataFromWindow({ ...shown, fillColor: { r: 1, g: 0, b: 0, a: 1 } });
    expect([cells[0]!.GetFillMode(), cells[0]!.GetFillColor()]).toEqual([
      FILL_T.FILLED_WITH_COLOR,
      { r: 1, g: 0, b: 0, a: 1 },
    ]);

    const again = new DIALOG_TABLECELL_PROPERTIES(h.frame, [cells[0]!]);
    again.TransferDataFromWindow({ ...again.TransferDataToWindow(), fillColor: shown.fillColor });
    expect(cells[0]!.GetFillMode()).toBe(FILL_T.NO_FILL);
  });

  it('Edit Table... applies, and Properties then opens the table dialog', async () => {
    const seen: string[] = [];
    let first = true;
    const { h, table, cells } = setUp({
      showModal: (aDialog, aItems) => {
        seen.push(aDialog);
        if (aDialog !== 'DIALOG_TABLECELL_PROPERTIES' || !first) return 0;
        first = false;
        const dlg = new DIALOG_TABLECELL_PROPERTIES(h.frame, aItems as SCH_TABLECELL[]);
        dlg.OnEditTable({ ...dlg.TransferDataToWindow(), text: 'Y' });
        return dlg.GetReturnValue();
      },
    });
    const sel = h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
    sel.ClearSelection(true);
    sel.AddItemToSel(cells[0]!, true);

    h.frame.GetToolManager()!.RunAction(SCH_ACTIONS.properties);
    await flush();

    expect(seen).toEqual(['DIALOG_TABLECELL_PROPERTIES', 'DIALOG_TABLE_PROPERTIES']);
    expect(table.GetCell(0, 0)!.GetText()).toBe('Y');
  });
});
