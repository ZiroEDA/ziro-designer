// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_SHEET_PROPERTIES (dialog_sheet_properties.cpp) on a live sheet: the fields shown
 * sheet-relative, the rename (and "Untitled Sheet" for an empty name) with the out-parameters set,
 * Validate's unnamed-field refusal, the empty-file-name refusal, user fields added / deleted /
 * kept, the mandatory rows refused, the page number per instance, the hierarchical path, and
 * wxFileName::MakeRelativeTo for the relative-path question.
 */
import { resolve } from 'node:path';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { wxMakeRelativeTo } from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { DIALOG_SHEET_PROPERTIES } from '@ziroeda/eeschema/dialogs/dialog_sheet_properties.js';
import { FIELDS_DATA_COL_ORDER } from '@ziroeda/eeschema/fields_grid_table.js';
import type { SHEET_PROPERTIES_RESULT } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SHEET_PATH } from '@ziroeda/eeschema/sch_sheet_path.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

const HOST = {
  ChooseFootprint: () => Promise.resolve(null),
  OpenFile: () => Promise.resolve(null),
  OpenDocument: () => {},
};

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const root = h.frame.Schematic().Hierarchy()[0]!;
  h.frame.SetCurrentSheet(root);
  const sheet = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)][0] as SCH_SHEET;
  const result: SHEET_PROPERTIES_RESULT = {
    isUndoable: false,
    clearAnnotation: false,
    updateHierarchyNavigator: false,
  };
  const dlg = new DIALOG_SHEET_PROPERTIES(h.frame, sheet, result, null, HOST, async () => 'ok');
  return { h, sheet, result, dlg, error: vi.fn() };
}

describe('DIALOG_SHEET_PROPERTIES', () => {
  it('shows the two mandatory rows first, positioned relative to the sheet', () => {
    const { sheet, dlg } = setUp();
    dlg.TransferDataToWindow();
    const table = dlg.Fields();
    const pos = sheet.GetPosition();
    const name = sheet.GetField(FIELD_T.SHEET_NAME)!;

    expect(table.at(0).GetId()).toBe(FIELD_T.SHEET_NAME);
    expect(table.at(1).GetId()).toBe(FIELD_T.SHEET_FILENAME);
    expect(table.at(0).GetTextPos()).toEqual({
      x: name.GetTextPos().x - pos.x,
      y: name.GetTextPos().y - pos.y,
    });
    expect(dlg.Grid().GetNumberRows()).toBe(table.size());
  });

  it('renames the sheet, keeps its file, and says the hierarchy navigator needs updating', async () => {
    const { sheet, result, dlg } = setUp();
    const file = sheet.GetFileName();
    const shown = dlg.TransferDataToWindow();
    dlg.Fields().SetValue(0, FIELDS_DATA_COL_ORDER.FDC_VALUE, 'Renamed');

    expect(await dlg.TransferDataFromWindow(shown)).toBe(true);

    expect(sheet.GetName()).toBe('Renamed');
    expect(sheet.GetFileName()).toBe(file);
    expect(result).toEqual({
      isUndoable: true,
      clearAnnotation: false,
      updateHierarchyNavigator: true,
    });
  });

  it('names a sheet whose name was cleared "Untitled Sheet"', async () => {
    const { sheet, dlg } = setUp();
    const shown = dlg.TransferDataToWindow();
    dlg.Fields().SetValue(0, FIELDS_DATA_COL_ORDER.FDC_VALUE, '');

    expect(await dlg.TransferDataFromWindow(shown)).toBe(true);
    expect(sheet.GetName()).toBe('Untitled Sheet');
  });

  it('refuses a field with text and no name, and an empty file name', async () => {
    const { sheet, dlg, error } = setUp();
    SetErrorPresenter(error);
    const name = sheet.GetName();
    const shown = dlg.TransferDataToWindow();
    const unnamed = new SCH_FIELD(sheet, FIELD_T.SHEET_USER, '');
    unnamed.SetName('');
    unnamed.SetText('x');
    dlg.Fields().push_back(unnamed);

    expect(await dlg.TransferDataFromWindow(shown)).toBe(false);
    expect(error).toHaveBeenLastCalledWith('Fields must have a name.', '');

    dlg.Fields().erase(dlg.Fields().size() - 1);
    // Unedited bad data from a file: the grid's own SetValue would have added the extension.
    dlg.Fields().at(1).SetText('');
    expect(await dlg.TransferDataFromWindow(shown)).toBe(false);
    expect(error).toHaveBeenLastCalledWith('A sheet must have a valid file name.', '');
    expect(sheet.GetName()).toBe(name);
  });

  it('adds a hidden user field named for its row, and drops one deleted from the grid', async () => {
    const { h, sheet, dlg } = setUp();
    const shown = dlg.TransferDataToWindow();
    const rows = dlg.Fields().size();

    dlg.OnAddField();
    const added = dlg.Fields().at(rows);
    expect(added.GetName()).toBe(`Field${rows}`);
    expect(added.IsVisible()).toBe(false);
    dlg.Grid().DisableCellEditControl();
    dlg.Fields().SetValue(rows, FIELDS_DATA_COL_ORDER.FDC_VALUE, 'v');

    expect(await dlg.TransferDataFromWindow(shown)).toBe(true);
    expect(sheet.GetField(`Field${rows}`)?.GetText()).toBe('v');

    const again = new DIALOG_SHEET_PROPERTIES(
      h.frame,
      sheet,
      { isUndoable: false, clearAnnotation: false, updateHierarchyNavigator: false },
      null,
      HOST,
      async () => 'ok',
    );
    const shown2 = again.TransferDataToWindow();
    again.Grid().SetGridCursor(rows, 0);
    again.OnDeleteField();
    expect(await again.TransferDataFromWindow(shown2)).toBe(true);
    expect(sheet.GetField(`Field${rows}`)).toBeNull();
  });

  it('refuses to delete the two mandatory rows', () => {
    const { dlg, error } = setUp();
    SetErrorPresenter(error);
    dlg.TransferDataToWindow();

    dlg.Grid().SetGridCursor(1, 0);
    dlg.OnDeleteField();

    expect(error).toHaveBeenCalledWith('The first 2 fields are mandatory.', '');
    expect(dlg.Fields().at(1).GetId()).toBe(FIELD_T.SHEET_FILENAME);
  });

  it('vetoes a field name another row already has, case-insensitively for the mandatory ones', () => {
    const { dlg, error } = setUp();
    SetErrorPresenter(error);
    dlg.TransferDataToWindow();
    dlg.OnAddField();
    const grid = dlg.Grid();
    grid.GetCurrentEditor()!.m_value = 'sheetname';

    expect(grid.CommitPendingChanges()).toBe(false);
    expect(error).toHaveBeenCalledWith("Field name 'sheetname' already in use.", '');
  });

  it('sets this instance’s page number', async () => {
    const { h, sheet, dlg } = setUp();
    const shown = dlg.TransferDataToWindow();

    expect(await dlg.TransferDataFromWindow({ ...shown, pageNumber: '7' })).toBe(true);

    const instance = new SCH_SHEET_PATH(h.frame.GetCurrentSheet());
    instance.push_back(sheet);
    expect(instance.GetPageNumber()).toBe('7');
  });

  it('shows the hierarchical path the sheet will have', () => {
    const { dlg } = setUp();
    dlg.TransferDataToWindow();
    dlg.Fields().SetValue(0, FIELDS_DATA_COL_ORDER.FDC_VALUE, 'Amp');

    // PathHumanReadable( false ): the root file's name, not "/" (sch_sheet_path.cpp).
    expect(dlg.HierarchicalPath()).toBe('complex_hierarchy/Amp');
  });
});

describe('wxFileName::MakeRelativeTo', () => {
  it('drops the shared directories and climbs out of the rest of the base', () => {
    expect(wxMakeRelativeTo('/p/sub/a.kicad_sch', '/p')).toBe('sub/a.kicad_sch');
    expect(wxMakeRelativeTo('/p/a.kicad_sch', '/p')).toBe('a.kicad_sch');
    expect(wxMakeRelativeTo('/q/a.kicad_sch', '/p/sub')).toBe('../../q/a.kicad_sch');
    expect(wxMakeRelativeTo('/p/x/../a.kicad_sch', '/p/')).toBe('a.kicad_sch');
  });
});
