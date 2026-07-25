/**
 * Symbol Fields Table, end to end over a hierarchy: the dialog's data model
 * collects symbols from every sheet instance, its scopes filter by sheet path,
 * and OK turns the pending cells into per-sheet commands (field edits plus the
 * `${DNP}` / `${EXCLUDE_FROM_…}` attribute writes) that serialize back into the
 * `.kicad_sch` files and undo as one step, SCH_COMMIT's contract.
 *
 * This is the wiring SchematicEditor.applyFieldsEdits performs; `applyEdits`
 * below is that function with the React plumbing removed.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import {
  buildFieldsReferences,
  bulkEditFieldsCommand,
  bulkEditSymbolAttributesCommand,
  composeCommands,
  FieldsDataModel,
  History,
  loadFieldNames,
  readSchematic,
  serializeSchematic,
  type FieldsTableEdits,
  type Schematic,
} from '@ziroeda/eeschema';

const sym = (ref: string, value: string, uuid: string, extra = '', fields = ''): string =>
  `(symbol (lib_id "Device:R") (at 0 0 0) (unit 1) ${extra} (uuid "${uuid}")
     (property "Reference" "${ref}" (at 0 0 0))
     (property "Value" "${value}" (at 0 0 0))
     (property "Footprint" "" (at 0 0 0))
     ${fields})`;

const sheet = (name: string, file: string, uuid: string): string =>
  `(sheet (at 10 10) (size 20 20) (uuid "${uuid}")
     (property "Sheetname" "${name}" (at 0 0 0))
     (property "Sheetfile" "${file}" (at 0 0 0)))`;

const doc = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20231120) (generator "test") (lib_symbols) ${body})`));

/** A two-level project: root + Power (which holds Reg). */
function project(): Map<string, Schematic> {
  return new Map([
    ['main.kicad_sch', doc(`${sym('R1', '1k', 'r1')} ${sheet('Power', 'power.kicad_sch', 's1')}`)],
    ['power.kicad_sch', doc(`${sym('R2', '2k', 'r2')} ${sheet('Reg', 'reg.kicad_sch', 's2')}`)],
    ['reg.kicad_sch', doc(sym('R3', '3k', 'r3'))],
  ]);
}

/** The model the dialog builds when it opens on `docs`. */
function openTable(docs: ReadonlyMap<string, Schematic>): FieldsDataModel {
  const refs = buildFieldsReferences(docs, 'main.kicad_sch');
  const model = new FieldsDataModel(refs);
  loadFieldNames(model, refs);
  model.applyBomPreset({
    name: 'Default Editing',
    fieldsOrdered: [
      { name: 'Reference', label: 'Reference', show: true, groupBy: false },
      { name: 'Value', label: 'Value', show: true, groupBy: false },
      { name: 'Footprint', label: 'Footprint', show: true, groupBy: false },
      { name: '${DNP}', label: 'DNP', show: true, groupBy: false },
      { name: '${EXCLUDE_FROM_BOM}', label: 'Exclude from BOM', show: true, groupBy: false },
      { name: '${EXCLUDE_FROM_BOARD}', label: 'Exclude from Board', show: true, groupBy: false },
      {
        name: '${EXCLUDE_FROM_POS_FILES}',
        label: 'Exclude from Position Files',
        show: true,
        groupBy: false,
      },
    ],
    sortField: 'Reference',
    sortAsc: true,
    filterString: '',
    groupSymbols: false,
    excludeDnp: false,
    includeExcludedFromBom: true,
  });
  return model;
}

/** SchematicEditor.applyFieldsEdits: one composed command per sheet file. */
function applyEdits(
  docs: ReadonlyMap<string, Schematic>,
  edits: FieldsTableEdits,
  histories?: Map<string, History>,
): Map<string, Schematic> {
  const out = new Map(docs);
  for (const file of new Set([...edits.fields.keys(), ...edits.attrs.keys()])) {
    const fields = edits.fields.get(file);
    const attrs = edits.attrs.get(file);
    const cmds = [
      ...(fields?.size ? [bulkEditFieldsCommand(fields)] : []),
      ...(attrs?.size ? [bulkEditSymbolAttributesCommand(attrs)] : []),
    ];
    if (cmds.length === 0) continue;
    const cmd = cmds.length === 1 ? cmds[0]! : composeCommands('Edit Symbol Fields', cmds);
    const before = out.get(file)!;
    if (histories) {
      if (!histories.has(file)) histories.set(file, new History());
      out.set(file, histories.get(file)!.execute(before, cmd));
    } else {
      out.set(file, cmd.apply(before));
    }
  }
  return out;
}

/** The value of `field` on the symbol `ref`, read back out of a document. */
const fieldOf = (d: Schematic, ref: string, field: string): string | undefined =>
  d.symbols
    .find((s) => s.fields.find((f) => f.key === 'Reference')?.value === ref)
    ?.fields.find((f) => f.key === field)?.value;

const cell = (model: FieldsDataModel, ref: string, fieldName: string): string => {
  const col = model.getFieldNameCol(fieldName);
  const row = model.getRows().findIndex((r) => r.refs[0]!.ref + r.refs[0]!.refNumber === ref);
  return model.getValue(row, col);
};

const setCell = (model: FieldsDataModel, ref: string, fieldName: string, value: string): void => {
  const col = model.getFieldNameCol(fieldName);
  const row = model.getRows().findIndex((r) => r.refs[0]!.ref + r.refs[0]!.refNumber === ref);
  model.setValue(row, col, value);
};

describe('symbol fields table over a hierarchy', () => {
  it('collects every sheet instance with its sheet path', () => {
    const refs = buildFieldsReferences(project(), 'main.kicad_sch');
    expect(refs.map((r) => [r.file, r.sheetPath, r.ref + r.refNumber])).toEqual([
      ['main.kicad_sch', '/', 'R1'],
      ['power.kicad_sch', '/s1/', 'R2'],
      ['reg.kicad_sch', '/s1/s2/', 'R3'],
    ]);
  });

  it('scopes the rows to the current sheet, or to it and everything below', () => {
    const model = openTable(project());
    const refsOf = (): string[] =>
      model.getRows().map((r) => r.refs[0]!.ref + r.refs[0]!.refNumber);

    expect(refsOf()).toEqual(['R1', 'R2', 'R3']); // Entire Project

    model.setPath('/s1/');
    model.setScope('sheet');
    model.rebuildRows();
    expect(refsOf()).toEqual(['R2']); // Current Sheet Only

    model.setScope('sheet-recursive');
    model.rebuildRows();
    expect(refsOf()).toEqual(['R2', 'R3']); // Current Sheet and Down
  });

  it('applies edits to the right sheet and writes them into the .kicad_sch', () => {
    const docs = project();
    const model = openTable(docs);
    setCell(model, 'R1', 'Value', '4k7');
    setCell(model, 'R3', 'Footprint', 'Resistor_SMD:R_0603');

    const edits = model.applyData();
    expect([...edits.fields.keys()].sort()).toEqual(['main.kicad_sch', 'reg.kicad_sch']);

    const next = applyEdits(docs, edits);
    expect(fieldOf(next.get('main.kicad_sch')!, 'R1', 'Value')).toBe('4k7');
    expect(fieldOf(next.get('reg.kicad_sch')!, 'R3', 'Footprint')).toBe('Resistor_SMD:R_0603');
    // The untouched sheet is not even re-serialized differently.
    expect(serializeSchematic(next.get('power.kicad_sch')!)).toBe(
      serializeSchematic(docs.get('power.kicad_sch')!),
    );

    const text = serializeSchematic(next.get('main.kicad_sch')!);
    expect(text).toContain('(property "Value" "4k7"');
    // Re-reading the written file gives the same table back (writer/reader agree).
    expect(cell(openTable(new Map(next)), 'R1', 'Value')).toBe('4k7');
  });

  it('creates a user-added field on the symbols that get a value', () => {
    const docs = project();
    const model = openTable(docs);
    model.addColumn('MPN', 'MPN', true);
    model.setShowColumn(model.getFieldNameCol('MPN'), true);
    model.rebuildRows();
    setCell(model, 'R2', 'MPN', 'RC0603FR-071KL');

    const next = applyEdits(docs, model.applyData());
    const power = next.get('power.kicad_sch')!;
    expect(fieldOf(power, 'R2', 'MPN')).toBe('RC0603FR-071KL');
    expect(serializeSchematic(power)).toContain('(property "MPN" "RC0603FR-071KL"');
    // R1 never got a value, so it never got the field.
    expect(fieldOf(next.get('main.kicad_sch')!, 'R1', 'MPN')).toBeUndefined();
  });

  it('removing a column drops that field from the symbols', () => {
    const docs = new Map([
      ['main.kicad_sch', doc(sym('R1', '1k', 'r1', '', '(property "MPN" "AAA" (at 0 0 0))'))],
    ]);
    const refs = buildFieldsReferences(docs, 'main.kicad_sch');
    const model = new FieldsDataModel(refs);
    loadFieldNames(model, refs);
    model.removeColumn(model.getFieldNameCol('MPN'));

    const next = applyEdits(docs, model.applyData());
    expect(fieldOf(next.get('main.kicad_sch')!, 'R1', 'MPN')).toBeUndefined();
    expect(serializeSchematic(next.get('main.kicad_sch')!)).not.toContain('"MPN"');
  });

  it('writes the attribute columns as symbol flags in the file', () => {
    const docs = project();
    const model = openTable(docs);
    setCell(model, 'R1', '${DNP}', '1');
    setCell(model, 'R1', '${EXCLUDE_FROM_BOM}', '1');
    setCell(model, 'R1', '${EXCLUDE_FROM_BOARD}', '1');
    setCell(model, 'R1', '${EXCLUDE_FROM_POS_FILES}', '1');
    setCell(model, 'R1', 'Value', '10k'); // fields + attributes in one commit

    const edits = model.applyData();
    expect([...edits.attrs.get('main.kicad_sch')!.values()]).toEqual([
      {
        dnp: true,
        excludedFromBom: true,
        excludedFromBoard: true,
        excludedFromPosFiles: true,
      },
    ]);

    const text = serializeSchematic(applyEdits(docs, edits).get('main.kicad_sch')!);
    expect(text).toContain('(dnp yes)');
    expect(text).toContain('(in_bom no)');
    expect(text).toContain('(on_board no)');
    expect(text).toContain('(in_pos_files no)'); // stored inverted, like saveSymbol
    expect(text).toContain('(property "Value" "10k"');
  });

  it('undoes fields and attributes together, as one step', () => {
    const docs = project();
    const before = serializeSchematic(docs.get('main.kicad_sch')!);
    const model = openTable(docs);
    setCell(model, 'R1', 'Value', '10k');
    setCell(model, 'R1', '${DNP}', '1');

    const histories = new Map<string, History>();
    const next = applyEdits(docs, model.applyData(), histories);
    expect(serializeSchematic(next.get('main.kicad_sch')!)).not.toBe(before);

    const undone = histories.get('main.kicad_sch')!.undo(next.get('main.kicad_sch')!);
    expect(undone).not.toBeNull();
    expect(serializeSchematic(undone!)).toBe(before);
  });

  it('applies a shared sub-sheet once, however many times it is instantiated', () => {
    // A complex hierarchy: one file placed twice, so two rows share the symbol.
    const docs = new Map([
      [
        'main.kicad_sch',
        doc(`${sheet('A', 'sub.kicad_sch', 'sa')} ${sheet('B', 'sub.kicad_sch', 'sb')}`),
      ],
      ['sub.kicad_sch', doc(sym('R9', '1k', 'r9'))],
    ]);
    const refs = buildFieldsReferences(docs, 'main.kicad_sch');
    expect(refs.map((r) => r.sheetPath)).toEqual(['/sa/', '/sb/']);

    const model = openTable(docs);
    // Both instances carry the same reference, so they collapse into one row.
    expect(model.getRows()).toHaveLength(1);
    setCell(model, 'R9', 'Value', '5k');

    const edits = model.applyData();
    expect(edits.fields.get('sub.kicad_sch')!.size).toBe(1);
    expect(fieldOf(applyEdits(docs, edits).get('sub.kicad_sch')!, 'R9', 'Value')).toBe('5k');
  });

  it('exports what the preview shows: never the "exclude from BOM" symbols', () => {
    const docs = new Map([
      ['main.kicad_sch', doc(`${sym('R1', '1k', 'r1')} ${sym('R2', '2k', 'r2', '(in_bom no)')}`)],
    ]);
    const model = openTable(docs);
    // The table lists both (Include 'Exclude from BOM' Symbols is on) …
    expect(model.getRows()).toHaveLength(2);

    // … but the export drops R2, which is what PreviewRefresh renders.
    model.setIncludeExcludedFromBOM(false);
    model.rebuildRows();
    const csv = model.export({
      fieldDelimiter: ',',
      stringDelimiter: '"',
      refDelimiter: ',',
      refRangeDelimiter: '',
      keepTabs: false,
      keepLineBreaks: false,
    });
    expect(csv).toContain('"R1"');
    expect(csv).not.toContain('"R2"');
  });
});
