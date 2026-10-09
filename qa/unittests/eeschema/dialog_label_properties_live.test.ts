// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_LABEL_PROPERTIES (dialog_label_properties.cpp) on live labels, over FIELDS_GRID_TABLE
 * (fields_grid_table.cpp): the combo's existing labels, the fields copied label-relative and
 * written back absolute, the empty-field cleanup and ordinals, the empty-text refusal, a new
 * label's copies through SetLabelList, the add / move / delete handlers and the duplicate-name veto.
 */
import { resolve } from 'node:path';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { DIALOG_LABEL_PROPERTIES } from '@ziroeda/eeschema/dialogs/dialog_label_properties.js';
import { FIELDS_DATA_COL_ORDER } from '@ziroeda/eeschema/fields_grid_table.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_LABEL,
  type SCH_LABEL_BASE,
  SPIN_STYLE,
} from '@ziroeda/eeschema/sch_label.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

const HOST: GRID_TEXT_BUTTON_HOST = {
  ChooseFootprint: () => Promise.resolve(null),
  OpenFile: () => Promise.resolve(null),
  OpenDocument: () => {},
};

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp<T extends SCH_LABEL_BASE>(aLabel: T, aNew = false) {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(h.frame.Schematic().Hierarchy()[0]!);
  if (aNew) aLabel.SetFlags(IS_NEW);
  else h.frame.AddToScreen(aLabel, h.frame.GetScreen());
  aLabel.SetParent(h.frame.Schematic());
  return { h, label: aLabel, dlg: new DIALOG_LABEL_PROPERTIES(h.frame, aLabel, aNew, HOST) };
}

function userField(aLabel: SCH_LABEL_BASE, aName: string, aText: string): SCH_FIELD {
  const field = new SCH_FIELD(aLabel, FIELD_T.USER, aName);
  // The constructor names an unnamed field "Field"; a row the user cleared has no name.
  field.SetName(aName);
  field.SetText(aText);
  return field;
}

describe('DIALOG_LABEL_PROPERTIES', () => {
  it('loads the combo with every local label in the hierarchy, in std::set order', () => {
    const { dlg } = setUp(new SCH_LABEL({ x: 0, y: 0 }, 'mine'));
    dlg.TransferDataToWindow();

    expect(dlg.ExistingLabels()).toEqual([
      '12Vext',
      'PIEZO_IN',
      'PIEZO_OUT',
      'S_OUT+',
      'Vpil_0_3,3V',
      'mine',
    ]);
  });

  it('gives an existing global label its combo, the shape box and Auto, and no multi-label box', () => {
    const { dlg } = setUp(new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'G'));
    const shown = dlg.TransferDataToWindow();

    // No other global label in the fixture: the rest are its global power symbols' values
    // (+12C, +12V, -VAA, GND, HT, VCC; PWR_FLAG is not label-like).
    expect(dlg.ExistingLabels()).toEqual(['+12C', '+12V', '-VAA', 'G', 'GND', 'HT', 'VCC']);
    expect(dlg.IsMultilineAllowed()).toBe(false);
    expect(dlg.m_hasShape).toBe(true);
    expect(dlg.m_hasAutoRotate).toBe(true);
    expect(shown.text).toBe('G');
  });

  it('shows the fields relative to the label and writes them back absolute', () => {
    const label = new SCH_LABEL({ x: 1000, y: 2000 }, 'L');
    const field = userField(label, 'Note', 'n');
    field.SetTextPos({ x: 1500, y: 2700 });
    label.SetFields([field]);
    const { h, dlg } = setUp(label);
    const undo = h.frame.GetUndoCommandCount();

    const shown = dlg.TransferDataToWindow();
    const table = dlg.Fields();
    expect(table.GetNumberRows()).toBe(1);
    expect(table.at(0).GetTextPos()).toEqual({ x: 500, y: 700 });

    table.SetValue(0, FIELDS_DATA_COL_ORDER.FDC_VALUE, 'changed');
    expect(dlg.TransferDataFromWindow(shown)).toBe(true);

    expect(label.GetFields()[0]!.GetText()).toBe('changed');
    expect(label.GetFields()[0]!.GetTextPos()).toEqual({ x: 1500, y: 2700 });
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('drops an empty unnamed field, names a non-empty one "untitled", and renumbers ordinals from 42', () => {
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'L');
    label.SetFields([
      userField(label, '', ''),
      userField(label, '', 'x'),
      userField(label, 'B', 'b'),
    ]);
    const { dlg } = setUp(label);

    expect(dlg.TransferDataFromWindow(dlg.TransferDataToWindow())).toBe(true);

    expect(label.GetFields().map((f) => [f.GetName(), f.GetText(), f.GetOrdinal()])).toEqual([
      ['untitled', 'x', 42],
      ['B', 'b', 43],
    ]);
  });

  it('refuses to empty an existing label, and leaves it as it was', () => {
    const { h, label, dlg } = setUp(new SCH_LABEL({ x: 0, y: 0 }, 'keep'));
    const error = vi.fn();
    const undo = h.frame.GetUndoCommandCount();
    SetErrorPresenter(error);

    expect(dlg.TransferDataFromWindow({ ...dlg.TransferDataToWindow(), text: '' })).toBe(false);
    expect(error).toHaveBeenCalledWith('Label can not be empty.', '');
    expect(label.GetText()).toBe('keep');
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });

  it('refuses a text size under 0.01 mm', () => {
    const { label, dlg } = setUp(new SCH_LABEL({ x: 0, y: 0 }, 'L'));
    const width = label.GetTextWidth();

    expect(dlg.TransferDataFromWindow({ ...dlg.TransferDataToWindow(), size: '0' })).toBe(false);
    expect(label.GetTextWidth()).toBe(width);
  });

  it('writes the text escaped, the shape, the size, the style and the spin', () => {
    const { label, dlg } = setUp(new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'G'));

    expect(
      dlg.TransferDataFromWindow({
        ...dlg.TransferDataToWindow(),
        text: 'A/B',
        shape: LABEL_FLAG_SHAPE.L_OUTPUT,
        size: '2.54',
        bold: true,
        spinButton: 2,
        autoRotate: false,
      }),
    ).toBe(true);

    expect(label.GetText()).toBe('A{slash}B');
    expect(label.GetShape()).toBe(LABEL_FLAG_SHAPE.L_OUTPUT);
    expect(label.GetTextWidth()).toBe(25400);
    expect(label.IsBold()).toBe(true);
    expect(Number(label.GetSpinStyle())).toBe(SPIN_STYLE.UP);
  });

  it('hands a new label back as one copy per line, each with its own uuid, and commits nothing', () => {
    const { h, label, dlg } = setUp(new SCH_LABEL({ x: 0, y: 0 }, ''), true);
    const list: SCH_LABEL_BASE[] = [];
    dlg.SetLabelList(list);
    const undo = h.frame.GetUndoCommandCount();

    expect(
      dlg.TransferDataFromWindow({
        ...dlg.TransferDataToWindow(),
        text: 'ONE\n\n TWO \r',
        multiLine: true,
      }),
    ).toBe(true);

    expect(list.map((l) => l.GetText())).toEqual(['ONE', 'TWO']);
    expect(new Set([label.m_Uuid, ...list.map((l) => l.m_Uuid)]).size).toBe(3);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });

  it('hands a new directive label back as itself, its pin length from the size box', () => {
    const { label, dlg } = setUp(new SCH_DIRECTIVE_LABEL({ x: 0, y: 0 }), true);
    const list: SCH_LABEL_BASE[] = [];
    dlg.SetLabelList(list);

    expect(dlg.m_hasTextEntry).toBe(false);
    expect(dlg.TransferDataFromWindow({ ...dlg.TransferDataToWindow(), size: '5.08' })).toBe(true);

    expect((label as SCH_DIRECTIVE_LABEL).GetPinLength()).toBe(50800);
    expect(list).toHaveLength(1);
    expect(list[0]!.m_Uuid).toBe(label.m_Uuid);
  });

  it('names the first added field Netclass, and copies the last field’s attributes to the next', () => {
    const { dlg } = setUp(new SCH_LABEL({ x: 0, y: 0 }, 'L'));
    dlg.TransferDataToWindow();
    const table = dlg.Fields();

    // SCH_LABEL_BASE::GetDefaultFieldName( "Netclass" ) is the translated "Net Class", which
    // reads back as the canonical Netclass.
    dlg.OnAddField();
    expect(table.at(0).GetName()).toBe('Net Class');
    expect(table.at(0).GetCanonicalName()).toBe('Netclass');
    expect(table.at(0).IsItalic()).toBe(true);

    table.at(0).SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    dlg.Grid().DisableCellEditControl();
    dlg.OnAddField();
    expect(table.at(1).GetName()).toBe('Field');
    expect(table.at(1).GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
  });

  it('moves a row down but, as upstream calls OnMoveRowUp for it, puts the cursor above', () => {
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'L');
    label.SetFields([
      userField(label, 'A', 'a'),
      userField(label, 'B', 'b'),
      userField(label, 'C', 'c'),
    ]);
    const { dlg } = setUp(label);
    dlg.TransferDataToWindow();
    const grid = dlg.Grid();

    grid.SetGridCursor(1, 0);
    dlg.OnMoveDown();

    expect(
      dlg
        .Fields()
        .Fields()
        .map((f) => f.GetName()),
    ).toEqual(['A', 'C', 'B']);
    expect(grid.GetGridCursorRow()).toBe(0);

    grid.SetGridCursor(2, 0);
    dlg.OnMoveUp();
    expect(
      dlg
        .Fields()
        .Fields()
        .map((f) => f.GetName()),
    ).toEqual(['A', 'B', 'C']);
  });

  it('vetoes a field name another row already has', () => {
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'L');
    label.SetFields([userField(label, 'A', 'a'), userField(label, 'B', 'b')]);
    const { dlg } = setUp(label);
    dlg.TransferDataToWindow();
    const error = vi.fn();
    SetErrorPresenter(error);
    const grid = dlg.Grid();

    grid.SetGridCursor(1, FIELDS_DATA_COL_ORDER.FDC_NAME);
    grid.EnableCellEditControl(true);
    grid.GetCurrentEditor()!.m_value = 'A';

    expect(grid.CommitPendingChanges()).toBe(false);
    expect(error).toHaveBeenCalledWith("Field name 'A' already in use.", '');
    expect(dlg.Fields().at(1).GetName()).toBe('B');
  });

  it('deletes a user row, with the cursor going to the row above', () => {
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'L');
    label.SetFields([userField(label, 'A', 'a'), userField(label, 'B', 'b')]);
    const { dlg } = setUp(label);
    dlg.TransferDataToWindow();

    dlg.Grid().SetGridCursor(1, 0);
    dlg.OnDeleteField();

    expect(
      dlg
        .Fields()
        .Fields()
        .map((f) => f.GetName()),
    ).toEqual(['A']);
    expect(dlg.Grid().GetNumberRows()).toBe(1);
  });
});
