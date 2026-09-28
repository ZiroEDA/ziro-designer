// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIB_FIELDS_EDITOR_GRID_DATA_MODEL` (lib_fields_data_model.cpp), the
 * Symbol Fields Table's library-mode data model: columns, the per-symbol
 * data store, grouping, sorting and the checkbox attribute getters/setters.
 */
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import {
  getAttributeValue,
  INDETERMINATE_STATE,
  LibFieldsDataModel,
  setAttributeValue,
  SYMBOL_NAME,
} from '@ziroeda/eeschema/lib_fields_data_model.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { describe, expect, it } from 'vitest';

function symbol(name: string, value = ''): LIB_SYMBOL {
  const s = new LIB_SYMBOL(name);
  if (value !== '') {
    const fields: SCH_FIELD[] = [];
    s.GetFields(fields);
    fields.find((f) => f.GetId() === FIELD_T.VALUE)!.SetText(value);
  }
  return s;
}

describe('getAttributeValue / setAttributeValue', () => {
  it('reads DNP/exclude flags as "1"/"0"', () => {
    const s = symbol('R');
    expect(getAttributeValue(s, '${DNP}')).toBe('0');
    s.SetDNP(true);
    expect(getAttributeValue(s, '${DNP}')).toBe('1');
  });

  it('an unknown attribute name reads as "0"', () => {
    expect(getAttributeValue(symbol('R'), '${NOPE}')).toBe('0');
  });

  it('turning LocalPower off leaves the symbol a global power symbol, not normal', () => {
    const s = symbol('#PWR');
    setAttributeValue(s, 'LocalPower', '1');
    expect(s.IsLocalPower()).toBe(true);

    setAttributeValue(s, 'LocalPower', '0');
    // Still a power symbol (global), per the C++ comment this mirrors.
    expect(s.IsPower()).toBe(true);
    expect(s.IsLocalPower()).toBe(false);
  });

  it('turning Power off resets to a normal (non-power) symbol', () => {
    const s = symbol('#PWR');
    setAttributeValue(s, 'Power', '1');
    expect(s.IsPower()).toBe(true);

    setAttributeValue(s, 'Power', '0');
    expect(s.IsPower()).toBe(false);
  });
});

describe('LibFieldsDataModel: columns and cells', () => {
  it('addColumn seeds the data store from each symbol, getValue reads it back', () => {
    const a = symbol('R_0402', '10k');
    const b = symbol('R_0603', '4k7');
    const model = new LibFieldsDataModel([a, b]);

    model.addColumn(SYMBOL_NAME, SYMBOL_NAME, false, false);
    model.addColumn('Value', 'Value', false, false);
    model.rebuildRows();

    expect(model.getRows().length).toBe(2);
    const rowA = model.getRows().find((r) => r.refs[0] === a)!;
    expect(model.getGroupValue(rowA, model.getFieldNameCol(SYMBOL_NAME))).toBe('R_0402');
    expect(model.getGroupValue(rowA, model.getFieldNameCol('Value'))).toBe('10k');
  });

  it('a second addColumn for the same field name is a no-op', () => {
    const model = new LibFieldsDataModel([symbol('R')]);
    model.addColumn('Value', 'Value', false, false);
    model.addColumn('Value', 'Different Label', false, false);
    expect(model.getColumns().length).toBe(1);
    expect(model.getColumns()[0]!.label).toBe('Value');
  });

  it('setValue edits the current data and marks the column edited', () => {
    const s = symbol('R', '10k');
    const model = new LibFieldsDataModel([s]);
    model.addColumn('Value', 'Value', false, false);
    model.rebuildRows();

    expect(model.isEdited()).toBe(false);
    model.setValue(0, model.getFieldNameCol('Value'), '22k');
    expect(model.isEdited()).toBe(true);
    expect(model.getValue(0, model.getFieldNameCol('Value'))).toBe('22k');
  });

  it('setValue is a no-op on the symbol-name column', () => {
    const s = symbol('R');
    const model = new LibFieldsDataModel([s]);
    model.addColumn(SYMBOL_NAME, SYMBOL_NAME, false, false);
    model.rebuildRows();

    model.setValue(0, model.getFieldNameCol(SYMBOL_NAME), 'Renamed');
    expect(model.getValue(0, model.getFieldNameCol(SYMBOL_NAME))).toBe('R');
  });

  it('removeColumn drops the field from the store and shifts a later sort column', () => {
    const model = new LibFieldsDataModel([symbol('R')]);
    model.addColumn('A', 'A', false, false);
    model.addColumn('B', 'B', false, false);
    model.setSorting(1, true); // sorting on B (col 1)
    model.removeColumn(0); // remove A
    expect(model.getColumns().map((c) => c.fieldName)).toEqual(['B']);
    expect(model.getFieldNameCol('A')).toBe(-1);
  });

  it('renameColumn moves the stored data under the new field name', () => {
    const s = symbol('R', '10k');
    const model = new LibFieldsDataModel([s]);
    model.addColumn('Value', 'Value', false, false);
    model.rebuildRows();

    model.renameColumn(0, 'Val2');
    expect(model.getColumns()[0]!.fieldName).toBe('Val2');
    expect(model.getValue(0, 0)).toBe('10k');
  });

  it('moveColumn relocates a column both leftward and rightward like std::rotate', () => {
    const model = new LibFieldsDataModel([]);
    model.addColumn('A', 'A', false, false);
    model.addColumn('B', 'B', false, false);
    model.addColumn('C', 'C', false, false);
    model.addColumn('D', 'D', false, false);

    model.moveColumn(0, 2); // A moves right past B, C
    expect(model.getColumns().map((c) => c.fieldName)).toEqual(['B', 'C', 'A', 'D']);

    model.moveColumn(2, 0); // A (now at 2) moves back to the front
    expect(model.getColumns().map((c) => c.fieldName)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('isExpanderColumn is true only for the first visible column', () => {
    const model = new LibFieldsDataModel([]);
    model.addColumn('A', 'A', false, false);
    model.addColumn('B', 'B', false, false);
    model.getColumns()[1]!.show = true;
    expect(model.isExpanderColumn(0)).toBe(true); // A is hidden, so it's still "first"
    expect(model.isExpanderColumn(1)).toBe(true); // nothing visible before B either
  });
});

describe('LibFieldsDataModel: grouping and filtering', () => {
  it('groups symbols whose group-by column values match', () => {
    const a = symbol('R_0402', '10k');
    const b = symbol('R_0603', '10k');
    const c = symbol('R_1206', '4k7');
    const model = new LibFieldsDataModel([a, b, c]);
    model.addColumn('Value', 'Value', false, false);
    model.getColumns()[0]!.group = true;
    model.setGroupingEnabled(true);
    model.rebuildRows();

    expect(model.getRows().length).toBe(2);
    const grouped = model.getRows().find((r) => r.refs.length === 2)!;
    expect(grouped.flag).toBe('collapsed');
    expect(grouped.refs).toContain(a);
    expect(grouped.refs).toContain(b);
  });

  it('a mixed-value cell across a group reads as INDETERMINATE_STATE', () => {
    const a = symbol('R_0402', '10k');
    const b = symbol('R_0603', '10k');
    const tolA = new SCH_FIELD(null, FIELD_T.USER, 'Tolerance');
    tolA.SetText('1%');
    a.AddField(tolA);
    const tolB = new SCH_FIELD(null, FIELD_T.USER, 'Tolerance');
    tolB.SetText('5%');
    b.AddField(tolB);

    const model = new LibFieldsDataModel([a, b]);
    model.addColumn('Value', 'Value', false, false);
    model.addColumn('Tolerance', 'Tolerance', false, false);
    model.getColumns()[0]!.group = true; // group by Value only
    model.setGroupingEnabled(true);
    model.rebuildRows();

    const row = model.getRows()[0]!;
    expect(row.refs.length).toBe(2); // grouped: both symbols share Value "10k"
    expect(model.getGroupValue(row, model.getFieldNameCol('Tolerance'))).toBe(INDETERMINATE_STATE);
  });

  it('filter keeps only symbols with a matching field value (wildcard, case-insensitive)', () => {
    const a = symbol('R_0402', '10k');
    const b = symbol('R_0603', '4k7');
    const model = new LibFieldsDataModel([a, b]);
    model.addColumn('Value', 'Value', false, false);
    model.setFilter('10*');
    model.rebuildRows();

    expect(model.getRows().length).toBe(1);
    expect(model.getRows()[0]!.refs[0]).toBe(a);
  });

  it('renumbers item numbers 1-based after sort', () => {
    const a = symbol('R_B');
    const b = symbol('R_A');
    const model = new LibFieldsDataModel([a, b]);
    model.addColumn(SYMBOL_NAME, SYMBOL_NAME, false, false);
    model.setSorting(0, true);
    model.rebuildRows();

    expect(model.getRows().map((r) => r.itemNumber)).toEqual([1, 2]);
  });
});

describe('LibFieldsDataModel: sort ordering', () => {
  it('sorts groups by the sort column ascending/descending', () => {
    const a = symbol('A', 'zzz');
    const b = symbol('B', 'aaa');
    const model = new LibFieldsDataModel([a, b]);
    model.addColumn('Value', 'Value', false, false);
    model.setSorting(0, true);
    model.rebuildRows();
    expect(model.getRows().map((r) => r.refs[0]!.GetName())).toEqual(['B', 'A']);

    model.setSorting(0, false);
    model.sort();
    expect(model.getRows().map((r) => r.refs[0]!.GetName())).toEqual(['A', 'B']);
  });
});

describe('INDETERMINATE_STATE sentinel', () => {
  it('reading a column no symbol has data for yields INDETERMINATE_STATE', () => {
    const model = new LibFieldsDataModel([symbol('R')]);
    // No addColumn call: getFieldNameCol returns -1, getValue guards on that.
    expect(model.getValue(0, 5)).toBe(INDETERMINATE_STATE);
  });
});
