// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_SYMBOL_PROPERTIES (dialog_symbol_properties.cpp) on a live symbol: the fields shown
 * symbol-relative with every resolved template not yet defined, OK as one 'Edit Symbol
 * Properties' commit (value, reference per sheet, orientation, mirror, attributes), the
 * unnamed-field and mandatory-row refusals, a user field added and removed, the hand-off buttons'
 * return codes, and SCH_PIN_TABLE_DATA_MODEL's rows.
 */
import { resolve } from 'node:path';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { FIELD_T, type TEMPLATE_FIELDNAME } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  DIALOG_SYMBOL_PROPERTIES,
  PIN_TABLE_COL_ORDER,
} from '@ziroeda/eeschema/dialogs/dialog_symbol_properties.js';
import { FIELDS_DATA_COL_ORDER } from '@ziroeda/eeschema/fields_grid_table.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SYMBOL_ORIENTATION_T } from '@ziroeda/eeschema/symbol.js';
import { SYMBOL_PROPS_RETVALUE } from '@ziroeda/eeschema/tools/sch_edit_tool.js';
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
  const sub = h.frame
    .Schematic()
    .Hierarchy()
    .find((p) => p.size() === 2)!;
  h.frame.SetCurrentSheet(sub);
  // D_Small: one unit, pins 1 "K" and 2 "A".
  const sym = ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]).find(
    (s) => s.GetLibId().GetLibItemName() === 'D_Small',
  )!;
  return { h, sym, dlg: () => new DIALOG_SYMBOL_PROPERTIES(h.frame, sym, HOST) };
}

const template = (aName: string, aVisible: boolean): TEMPLATE_FIELDNAME => ({
  m_Name: aName,
  m_Visible: aVisible,
  m_URL: false,
});

describe('DIALOG_SYMBOL_PROPERTIES', () => {
  it('shows the fields symbol-relative, then each resolved template not yet defined', () => {
    const { h, sym, dlg } = setUp();
    const templates = h.frame.Schematic().Settings().m_TemplateFieldNames;
    templates.AddTemplateFieldName(template('MPN', true), true);
    templates.AddTemplateFieldName(template('Vendor', false), false);
    templates.AddTemplateFieldName(template('Vendor', true), true);

    const d = dlg();
    d.TransferDataToWindow();
    const fields = d.Fields().Fields();
    const ref = sym.GetField(FIELD_T.REFERENCE)!;

    expect(fields[0]!.GetId()).toBe(FIELD_T.REFERENCE);
    expect(fields[0]!.GetTextPos()).toEqual({
      x: ref.GetTextPos().x - sym.GetPosition().x,
      y: ref.GetTextPos().y - sym.GetPosition().y,
    });
    // The project's Vendor overrides the global one: one row, hidden.
    expect(fields.filter((f) => f.GetName() === 'Vendor').map((f) => f.IsVisible())).toEqual([
      false,
    ]);
    expect(fields.find((f) => f.GetName() === 'MPN')?.IsVisible()).toBe(true);
  });

  it('writes value, reference, orientation, mirror and attributes as one commit', () => {
    const { h, sym, dlg } = setUp();
    const undo = h.frame.GetUndoCommandCount();
    const sheet = h.frame.GetCurrentSheet();
    const d = dlg();
    const shown = d.TransferDataToWindow();
    d.Fields().SetValue(0, FIELDS_DATA_COL_ORDER.FDC_VALUE, 'D99');
    d.Fields().SetValue(1, FIELDS_DATA_COL_ORDER.FDC_VALUE, '1N4148');

    expect(
      d.TransferDataFromWindow({
        ...shown,
        orientation: 1,
        mirror: 1,
        dnp: true,
        excludeFromBom: true,
      }),
    ).toBe(true);

    expect(sym.GetRef(sheet)).toBe('D99');
    expect(sym.GetField(FIELD_T.VALUE)!.GetText()).toBe('1N4148');
    expect(sym.GetOrientation()).toBe(
      SYMBOL_ORIENTATION_T.SYM_ORIENT_90 | SYMBOL_ORIENTATION_T.SYM_MIRROR_X,
    );
    expect(sym.GetDNP(sheet)).toBe(true);
    expect(sym.GetExcludedFromBOM(sheet)).toBe(true);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    expect([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)]).toContain(sym);
  });

  it('refuses a user field without a name, and the mandatory rows from deletion', () => {
    const { sym, dlg } = setUp();
    const error = vi.fn();
    SetErrorPresenter(error);
    const d = dlg();
    const shown = d.TransferDataToWindow();

    d.FieldsGrid().SetGridCursor(1, 0);
    d.OnDeleteField();
    expect(error).toHaveBeenLastCalledWith('The first 5 fields are mandatory.', '');

    const unnamed = new SCH_FIELD(sym, FIELD_T.USER, '');
    unnamed.SetName('');
    d.Fields().push_back(unnamed);
    expect(d.TransferDataFromWindow(shown)).toBe(false);
    expect(error).toHaveBeenLastCalledWith('Fields must have a name.', '');
  });

  it('adds a hidden user field at the reference’s angle, and drops one deleted from the grid', () => {
    const { sym, dlg } = setUp();
    const d = dlg();
    const shown = d.TransferDataToWindow();
    const rows = d.Fields().size();

    d.OnAddField();
    const added = d.Fields().at(rows);
    expect(added.GetName()).toBe(`Field${rows}`);
    expect(added.IsVisible()).toBe(false);
    expect(added.GetTextAngle().equals(sym.GetField(FIELD_T.REFERENCE)!.GetTextAngle())).toBe(true);
    d.FieldsGrid().DisableCellEditControl();
    d.Fields().SetValue(rows, FIELDS_DATA_COL_ORDER.FDC_VALUE, 'x');
    expect(d.TransferDataFromWindow(shown)).toBe(true);
    expect(sym.GetField(`Field${rows}`)?.GetText()).toBe('x');

    const again = dlg();
    const shown2 = again.TransferDataToWindow();
    again.FieldsGrid().SetGridCursor(rows, 0);
    again.OnDeleteField();
    expect(again.TransferDataFromWindow(shown2)).toBe(true);
    expect(sym.GetField(`Field${rows}`)).toBeNull();
  });

  it('ends with the hand-off code only once the edits applied', () => {
    const { sym, dlg } = setUp();
    const d = dlg();
    const shown = d.TransferDataToWindow();
    d.Fields().SetValue(1, FIELDS_DATA_COL_ORDER.FDC_VALUE, 'changed');

    expect(d.EndWith(shown, SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_EDIT_LIBRARY_SYMBOL)).toBe(
      SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_EDIT_LIBRARY_SYMBOL,
    );
    expect(sym.GetField(FIELD_T.VALUE)!.GetText()).toBe('changed');
  });

  it('lists the pins by number with their base name, type and style', () => {
    const { dlg } = setUp();
    const d = dlg();
    d.TransferDataToWindow();
    const model = d.PinModel()!;
    const row = (r: number) =>
      [
        PIN_TABLE_COL_ORDER.COL_NUMBER,
        PIN_TABLE_COL_ORDER.COL_BASE_NAME,
        PIN_TABLE_COL_ORDER.COL_ALT_NAME,
        PIN_TABLE_COL_ORDER.COL_TYPE,
        PIN_TABLE_COL_ORDER.COL_SHAPE,
      ].map((c) => model.GetValue(r, c));

    expect(d.m_pinsDisabled).toBe(false);
    expect([row(0), row(1)]).toEqual([
      ['1', 'K', '', 'Passive', 'Line'],
      ['2', 'A', '', 'Passive', 'Line'],
    ]);

    model.SortRows(PIN_TABLE_COL_ORDER.COL_NUMBER, false);
    expect(model.GetValue(0, PIN_TABLE_COL_ORDER.COL_NUMBER)).toBe('2');
  });
});
