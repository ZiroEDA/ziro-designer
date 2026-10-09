// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FIELDS_GRID_TABLE (fields_grid_table.cpp) over live SCH_FIELD copies: each column's GetValue /
 * SetValue, the private rows the schematic editor hides, and which cells GetAttr makes read-only or
 * gives the netclass combobox.
 */
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { GRID_CELL_COMBOBOX } from '@ziroeda/common/widgets/grid_combobox.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxAttrKind } from '@ziroeda/common/wx/grid.js';
import { FIELDS_DATA_COL_ORDER, FIELDS_GRID_TABLE } from '@ziroeda/eeschema/fields_grid_table.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { SCH_GLOBALLABEL, SCH_LABEL } from '@ziroeda/eeschema/sch_label.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schFrame } from './support/sch_tool_harness.js';

const HOST: GRID_TEXT_BUTTON_HOST = {
  ChooseFootprint: () => Promise.resolve(null),
  OpenFile: () => Promise.resolve(null),
  OpenDocument: () => {},
};

const {
  FDC_NAME,
  FDC_VALUE,
  FDC_SHOWN,
  FDC_H_ALIGN,
  FDC_V_ALIGN,
  FDC_TEXT_SIZE,
  FDC_ORIENTATION,
  FDC_POSX,
  FDC_FONT,
  FDC_COLOR,
} = FIELDS_DATA_COL_ORDER;

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function table(aFields: (label: SCH_LABEL) => SCH_FIELD[]) {
  const frame = schFrame({});
  const label = new SCH_LABEL({ x: 0, y: 0 }, 'L');
  let modified = 0;
  const t = new FIELDS_GRID_TABLE(
    { OnModify: () => modified++ },
    frame,
    new WX_GRID(),
    label,
    HOST,
  );
  for (const f of aFields(label)) t.push_back(f);
  return { t, modified: () => modified };
}

function field(aLabel: SCH_LABEL, aName: string, aText = ''): SCH_FIELD {
  const f = new SCH_FIELD(aLabel, FIELD_T.USER, aName);
  f.SetText(aText);
  return f;
}

describe('FIELDS_GRID_TABLE', () => {
  it('shows a label field’s name through SCH_LABEL_BASE::GetDefaultFieldName, and its value escaped', () => {
    const { t } = table((l) => [field(l, 'Netclass', 'a\nb'), field(l, 'Note', '{slash}')]);

    expect(t.GetValue(0, FDC_NAME)).toBe('Net Class');
    expect(t.GetValue(0, FDC_VALUE)).toBe('a{return}b');
    expect(t.GetValue(1, FDC_VALUE)).toBe('/');
    expect(t.GetValue(1, FDC_SHOWN)).toBe('1');
  });

  it('formats size and position in the frame’s units and the font and colour as KiCad does', () => {
    const { t } = table((l) => {
      const f = field(l, 'A');
      f.SetTextSize({ x: 12700, y: 12700 });
      f.SetTextPos({ x: 25400, y: 0 });
      return [f];
    });

    expect(t.GetValue(0, FDC_TEXT_SIZE)).toBe('1.27 mm');
    expect(t.GetValue(0, FDC_POSX)).toBe('2.54 mm');
    expect(t.GetValue(0, FDC_ORIENTATION)).toBe('Horizontal');
    expect(t.GetValue(0, FDC_FONT)).toBe('Default Font');
    expect(t.GetValue(0, FDC_COLOR)).toBe('rgba(0, 0, 0, 0.000)');
  });

  it('sets justification, size, orientation and position from their cells, and reports each', () => {
    const { t, modified } = table((l) => [field(l, 'A')]);
    const f = t.at(0);

    t.SetValue(0, FDC_H_ALIGN, ' Left ');
    t.SetValue(0, FDC_V_ALIGN, 'Top');
    t.SetValue(0, FDC_TEXT_SIZE, '2.54');
    t.SetValue(0, FDC_ORIENTATION, 'Vertical');
    t.SetValue(0, FDC_POSX, '5.08');

    expect(f.GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    expect(f.GetVertJustify()).toBe(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
    expect(f.GetTextSize()).toEqual({ x: 25400, y: 25400 });
    expect(f.GetTextAngle().IsVertical()).toBe(true);
    expect(f.GetTextPos().x).toBe(50800);
    expect(modified()).toBe(5);
  });

  it('writes the value unescaped, and a path that does not exist as typed', () => {
    const { t } = table((l) => [field(l, 'A')]);

    t.SetValue(0, FDC_VALUE, 'x{slash}y');
    expect(t.at(0).GetText()).toBe('x/y');

    t.SetValue(0, FDC_VALUE, '/no/such/file.pdf');
    expect(t.at(0).GetText()).toBe('/no/such/file.pdf');
  });

  it('hides a private field in the schematic editor, row for row', () => {
    const { t } = table((l) => {
      const hidden = field(l, 'Hidden', 'h');
      hidden.SetPrivate(true);
      return [field(l, 'A', 'a'), hidden, field(l, 'B', 'b')];
    });

    expect(t.size()).toBe(3);
    expect(t.GetNumberRows()).toBe(2);
    expect(t.GetNumberCols()).toBe(FIELDS_DATA_COL_ORDER.FDC_SCH_EDIT_COUNT);
    expect(t.GetValue(1, FDC_VALUE)).toBe('b');
  });

  it('makes a mandatory field’s name read-only and gives the Netclass value the netclass combobox', () => {
    const frame = schFrame({});
    const label = new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'G');
    const t = new FIELDS_GRID_TABLE({ OnModify: () => {} }, frame, new WX_GRID(), label, HOST);
    for (const f of label.GetFields()) t.push_back(SCH_FIELD.copyOf(f));
    t.push_back(field(label as unknown as SCH_LABEL, 'Netclass'));
    t.push_back(field(label as unknown as SCH_LABEL, 'Note'));

    expect(t.at(0).GetId()).toBe(FIELD_T.INTERSHEET_REFS);
    expect(t.GetAttr(0, FDC_NAME, wxAttrKind.Any)?.IsReadOnly()).toBe(true);
    expect(t.GetAttr(2, FDC_NAME, wxAttrKind.Any)?.IsReadOnly()).toBe(false);
    expect(t.GetAttr(1, FDC_VALUE, wxAttrKind.Any)?.GetEditorPtr()).toBeInstanceOf(
      GRID_CELL_COMBOBOX,
    );
    expect(t.GetAttr(2, FDC_VALUE, wxAttrKind.Any)?.GetEditorPtr()).not.toBeInstanceOf(
      GRID_CELL_COMBOBOX,
    );
  });

  it('resets an inherited row to its parent instead of erasing it', () => {
    const { t } = table(() => []);
    const parent = field(new SCH_LABEL(), 'P', 'parent');

    t.AddInheritedField(parent);
    t.at(0).SetText('edited');
    expect(t.IsInherited(0)).toBe(false);

    expect(t.EraseRow(0)).toBe(false);
    expect(t.at(0).GetText()).toBe('parent');
    expect(t.IsInherited(0)).toBe(true);
  });
});
