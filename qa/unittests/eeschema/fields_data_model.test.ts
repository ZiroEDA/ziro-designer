// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol Fields Table data model (FIELDS_EDITOR_GRID_DATA_MODEL): column
 * set-up from the field union, grouping by the "Group By" fields, unit
 * collapsing, sorting, mixed-value cells, the generated Qty / item-number
 * columns, attribute columns, the delimited export and applying edits back.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, type Schematic } from '@ziroeda/eeschema';
import {
  buildFieldsReferences,
  FieldsDataModel,
  INDETERMINATE_STATE,
  loadFieldNames,
  QUANTITY_VARIABLE,
  type BomPresetSpec,
} from '@ziroeda/eeschema/src/tools/fields_data_model.js';

const sym = (
  ref: string,
  value: string,
  fp: string,
  uuid: string,
  extra = '',
  fields = '',
): string => `(symbol (lib_id "Device:R") (at 0 0 0) (unit 1) ${extra} (uuid "${uuid}")
  (property "Reference" "${ref}" (at 0 0 0))
  (property "Value" "${value}" (at 0 0 0))
  (property "Footprint" "${fp}" (at 0 0 0))
  ${fields})`;

const load = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20231120) (generator "test") (lib_symbols) ${body})`));

/** A model over one sheet, with the columns LoadFieldNames would create. */
function modelOf(doc: Schematic, preset?: Partial<BomPresetSpec>): FieldsDataModel {
  const docs = new Map([['root.kicad_sch', doc]]);
  const refs = buildFieldsReferences(docs, 'root.kicad_sch');
  const model = new FieldsDataModel(refs);
  loadFieldNames(model, refs);
  model.applyBomPreset({
    name: 'test',
    fieldsOrdered: [
      { name: 'Reference', label: 'Reference', show: true, groupBy: false },
      { name: 'Value', label: 'Value', show: true, groupBy: true },
      { name: 'Footprint', label: 'Footprint', show: true, groupBy: true },
      { name: QUANTITY_VARIABLE, label: 'Qty', show: true, groupBy: false },
    ],
    sortField: 'Reference',
    sortAsc: true,
    filterString: '',
    groupSymbols: true,
    excludeDnp: false,
    includeExcludedFromBom: true,
    ...preset,
  });
  return model;
}

const rowValues = (model: FieldsDataModel, col: number): string[] =>
  model.getRows().map((_, row) => model.getValue(row, col));

describe('fields table data model', () => {
  it('builds a column per mandatory, generated and user field', () => {
    const doc = load(`
      ${sym('R1', '1k', 'R_0603', 'a', '', '(property "MPN" "RC0603" (at 0 0 0))')}
      ${sym('R2', '1k', 'R_0603', 'b')}`);
    const docs = new Map([['root.kicad_sch', doc]]);
    const refs = buildFieldsReferences(docs, 'root.kicad_sch');
    const model = new FieldsDataModel(refs);
    const order = loadFieldNames(model, refs, [{ name: 'Template' }]);
    expect(order).toEqual([
      'Reference',
      'Value',
      'Footprint',
      'Datasheet',
      'Description',
      '${QUANTITY}',
      '${ITEM_NUMBER}',
      'MPN',
      'Template',
    ]);
    // Columns start hidden; a preset decides what shows (ApplyBomPreset).
    expect(model.getColumns().every((c) => !c.show && !c.group)).toBe(true);
  });

  it('groups by the group-by fields and counts quantities', () => {
    const doc = load(`
      ${sym('R10', '1k', 'R_0603', 'a')}
      ${sym('R2', '1k', 'R_0603', 'b')}
      ${sym('R1', '1k', 'R_0805', 'c')}
      ${sym('C1', '100n', 'C_0603', 'd')}`);
    const model = modelOf(doc);
    // Reference col 0, Value 1, Footprint 2, Qty 3 after the preset order.
    expect(rowValues(model, 0)).toEqual(['C1', 'R1', 'R2, R10']);
    expect(rowValues(model, 3)).toEqual(['1', '1', '2']);
    // Ungrouped, every symbol is its own row.
    model.setGroupingEnabled(false);
    model.rebuildRows();
    expect(rowValues(model, 0)).toEqual(['C1', 'R1', 'R2', 'R10']);
  });

  it('collapses units of one symbol into a single row', () => {
    const doc = load(`
      ${sym('U1', 'ECC83', 'Valve', 'a')}
      ${sym('U1', 'ECC83', 'Valve', 'b')}`);
    const model = modelOf(doc, { groupSymbols: false });
    expect(model.getRows()).toHaveLength(1);
    expect(model.getValue(0, 0)).toBe('U1');
    expect(model.getValue(0, 3)).toBe('1'); // one part, two units
  });

  it('reads mixed group values as the indeterminate state', () => {
    const doc = load(`
      ${sym('R1', '1k', 'R_0603', 'a', '', '(property "MPN" "AAA" (at 0 0 0))')}
      ${sym('R2', '1k', 'R_0603', 'b', '', '(property "MPN" "BBB" (at 0 0 0))')}`);
    const model = modelOf(doc);
    model.addColumn('MPN', 'MPN', false);
    model.setShowColumn(model.getFieldNameCol('MPN'), true);
    model.rebuildRows();
    const mpn = model.getFieldNameCol('MPN');
    expect(model.getValue(0, mpn)).toBe(INDETERMINATE_STATE);
    // Writing a value sets it on every symbol of the group.
    model.setValue(0, mpn, 'CCC');
    expect(model.getValue(0, mpn)).toBe('CCC');
  });

  it('expands and collapses a group into its members', () => {
    const doc = load(`
      ${sym('R1', '1k', 'R_0603', 'a')}
      ${sym('R2', '1k', 'R_0603', 'b')}`);
    const model = modelOf(doc);
    expect(model.getRows()).toHaveLength(1);
    model.expandCollapseRow(0);
    expect(model.getRows().map((r) => r.flag)).toEqual(['expanded', 'child', 'child']);
    expect(rowValues(model, 0)).toEqual(['R1, R2', 'R1', 'R2']);
    model.expandCollapseRow(0);
    expect(model.getRows()).toHaveLength(1);
  });

  it('filters, scopes and honours the DNP / exclude-from-BOM options', () => {
    const doc = load(`
      ${sym('#PWR01', 'GND', '', 'p')}
      ${sym('R1', '1k', 'R_0603', 'a', '(dnp yes)')}
      ${sym('R2', '1k', 'R_0603', 'b', '(in_bom no)')}
      ${sym('C1', '100n', 'C_0603', 'c')}`);
    const model = modelOf(doc, { groupSymbols: false });
    // Power symbols never list; the others do while both options are on.
    expect(rowValues(model, 0)).toEqual(['C1', 'R1', 'R2']);
    model.setExcludeDNP(true);
    model.setIncludeExcludedFromBOM(false);
    model.rebuildRows();
    expect(rowValues(model, 0)).toEqual(['C1']);
    model.setExcludeDNP(false);
    model.setIncludeExcludedFromBOM(true);
    model.setFilter('r');
    model.rebuildRows();
    expect(rowValues(model, 0)).toEqual(['R1', 'R2']);
  });

  it('sorts by a column, descending on the second click', () => {
    const doc = load(`
      ${sym('R1', '10k', 'R_0603', 'a')}
      ${sym('R2', '1k', 'R_0603', 'b')}
      ${sym('R3', '100R', 'R_0603', 'c')}`);
    const model = modelOf(doc, { groupSymbols: false });
    model.setSorting(1, true); // Value: 100R < 1k < 10k by ValueStringCompare
    model.rebuildRows();
    expect(rowValues(model, 1)).toEqual(['100R', '1k', '10k']);
    model.setSorting(1, false);
    model.rebuildRows();
    expect(rowValues(model, 1)).toEqual(['10k', '1k', '100R']);
  });

  it('exports the shown columns with the format preset delimiters', () => {
    const doc = load(`
      ${sym('R1', '1k', 'R_0603', 'a')}
      ${sym('R2', '1k', 'R_0603', 'b')}
      ${sym('R3', '1k', 'R_0603', 'c')}`);
    const model = modelOf(doc);
    const csv = model.export({
      fieldDelimiter: ',',
      stringDelimiter: '"',
      refDelimiter: ',',
      refRangeDelimiter: '-',
      keepTabs: false,
      keepLineBreaks: false,
    });
    expect(csv).toBe(
      '"Reference","Value","Footprint","Qty"\n' + '"R1-R3","1k","R_0603","3"\n', // a run of 3 collapses into a range
    );
  });

  it('applies only the changed cells, per sheet', () => {
    const doc = load(`
      ${sym('R1', '1k', 'R_0603', 'a')}
      ${sym('R2', '2k', 'R_0603', 'b')}`);
    const model = modelOf(doc, { groupSymbols: false });
    model.setValue(0, 1, '4k7'); // R1's Value
    expect(model.isEdited()).toBe(true);
    const edits = model.applyData();
    expect([...edits.fields.keys()]).toEqual(['root.kicad_sch']);
    expect([...edits.fields.get('root.kicad_sch')!.values()]).toEqual([{ Value: '4k7' }]);
    expect(edits.attrs.size).toBe(0);
    expect(model.isEdited()).toBe(false);
  });

  it('writes the ${DNP} / ${EXCLUDE_FROM_BOM} columns as symbol attributes', () => {
    const doc = load(`${sym('R1', '1k', 'R_0603', 'a')}`);
    const model = modelOf(doc, {
      fieldsOrdered: [
        { name: 'Reference', label: 'Reference', show: true, groupBy: false },
        { name: '${DNP}', label: 'DNP', show: true, groupBy: false },
        { name: '${EXCLUDE_FROM_BOM}', label: 'Exclude from BOM', show: true, groupBy: false },
      ],
    });
    const dnp = model.getFieldNameCol('${DNP}');
    expect(model.getValue(0, dnp)).toBe('0');
    model.setValue(0, dnp, '1');
    const edits = model.applyData();
    expect(edits.fields.size).toBe(0);
    expect([...edits.attrs.get('root.kicad_sch')!.values()]).toEqual([{ dnp: true }]);
  });

  it('drops a symbol field when its column is removed', () => {
    const doc = load(`${sym('R1', '1k', 'R_0603', 'a', '', '(property "MPN" "AAA" (at 0 0 0))')}`);
    const model = modelOf(doc);
    model.removeColumn(model.getFieldNameCol('MPN'));
    expect(model.applyData().fields.get('root.kicad_sch')!.get('a')).toEqual({ MPN: '' });
  });
});
