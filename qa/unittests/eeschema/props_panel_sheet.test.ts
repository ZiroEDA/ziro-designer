// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The "Fields" group is not a static registration on either item that has one.
 *
 * `SCH_PROPERTIES_PANEL::rebuildProperties`
 * (eeschema/widgets/sch_properties_panel.cpp:403-464) walks the SELECTION and,
 * for a SCH_SYMBOL_T, collects `field.GetCanonicalName()` of every field that
 * is not `IsPrivate()` into `m_currentSymbolFieldNames` (`:407-420`); the
 * SCH_SHEET_T arm at `:421-433` does the same into
 * `m_currentSheetFieldNames`. Each collected name that the property manager
 * does not already answer to becomes a SCH_SYMBOL_FIELD_PROPERTY (`:438-449`)
 * or a SCH_SHEET_FIELD_PROPERTY (`:451-462`) in the "Fields" group.
 *
 * Two consequences this file pins, because both are easy to get wrong:
 *
 *  - the names come out of a `std::set<wxString>`, so the rows are
 *    ALPHABETICAL — not the order the file wrote the fields in;
 *  - across a multi-selection the one set is filled from every item, so the
 *    row set is the UNION, not the intersection.
 *
 * SCH_SHEET is the case where this matters most, because SCH_SHEET_DESC
 * (eeschema/sch_sheet.cpp:2122-2173) declares NO "Fields" group at all: every
 * row in a sheet's Fields group, the two mandatory ones included, is one of
 * these dynamic properties.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  dynamicFieldNames,
  schPropertiesFor,
} from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById } from '@ziroeda/eeschema/src/tools/hittest.js';

/**
 * The fields are deliberately NOT written alphabetically, and the user field
 * is written LAST — so "sorted" is distinguishable from "file order" and from
 * "mandatory first, then the rest".
 */
const sheetDoc = () =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
      (sheet (at 10 10) (size 20 20) (uuid "s1")
        (property "Sheetname" "sub" (at 10 9 0))
        (property "Sheetfile" "sub.kicad_sch" (at 10 31 0))
        (property "Assembly" "A1" (at 10 33 0))
        (property private "Secret" "hidden" (at 10 35 0))))`),
  );

const sheetRows = () => {
  const doc = sheetDoc();
  return schPropertiesFor(doc, new Map(), itemRefById(doc, 's1')!);
};

describe('a sheet’s Fields group is built from the sheet’s own fields', () => {
  it('lists every non-private field, alphabetically, and nothing else', () => {
    const fields = sheetRows()
      .filter((r) => r.group === 'Fields')
      .map((r) => r.name);
    // Alphabetical: Assembly, Sheetfile, Sheetname — NOT the file's
    // Sheetname, Sheetfile, Assembly, and not mandatory-first either.
    expect(fields).toEqual(['Assembly', 'Sheetfile', 'Sheetname']);
  });

  it('skips a private field — `if( field.IsPrivate() ) continue;`', () => {
    // The fixture really carries it, so the row's absence means the filter ran.
    expect(sheetDoc().sheets[0]!.fields.map((f) => f.key)).toContain('Secret');
    expect(sheetRows().map((r) => r.name)).not.toContain('Secret');
  });

  it('makes each of them writeable — SCH_SHEET_FIELD_PROPERTY has a setter', () => {
    // sch_properties_panel.cpp:145-171. SCH_SHEET_DESC declares no NO_SETTER
    // row, so no field row of a sheet is read-only.
    const fields = sheetRows().filter((r) => r.group === 'Fields');
    expect(fields.filter((r) => !r.set)).toEqual([]);
  });

  it('writes the edited field back onto the sheet, and undoes it', () => {
    const doc = sheetDoc();
    const rows = schPropertiesFor(doc, new Map(), itemRefById(doc, 's1')!);
    const cmd = rows.find((r) => r.name === 'Sheetfile')!.set!('other.kicad_sch')!;
    const next = cmd.apply(doc);
    const fieldText = (d: typeof doc, key: string) =>
      d.sheets[0]!.fields.find((f) => f.key === key)?.value;
    expect(fieldText(next, 'Sheetfile')).toBe('other.kicad_sch');
    // Only that one field moved.
    expect(fieldText(next, 'Sheetname')).toBe('sub');
    expect(fieldText(cmd.invert(doc).apply(next), 'Sheetfile')).toBe('sub.kicad_sch');
  });

  it('rejects an edit that does not change the value, rather than pushing a no-op', () => {
    const rows = sheetRows();
    expect(rows.find((r) => r.name === 'Sheetname')!.set!('sub')).toBeNull();
  });
});

describe('the collected field names across a selection', () => {
  /**
   * `rebuildProperties` clears the set once and then loops
   * `for( EDA_ITEM* item : aSelection )`, inserting into it — so two symbols
   * with different fields contribute BOTH sets of names, and the availability
   * callback then asks only `m_currentSymbolFieldNames.count( name )`
   * (:444-448), which knows nothing about the individual item. An item
   * missing the field answers with MISSING_FIELD_SENTINEL (:127), which
   * `extractValueAndWritability` turns into the differing-value "<...>" cell
   * — it does not remove the row.
   */
  it('is the union of the selection, not the intersection', () => {
    const a = [{ key: 'Reference' }, { key: 'MPN' }];
    const b = [{ key: 'Reference' }, { key: 'Tolerance' }];
    expect(dynamicFieldNames([...a, ...b])).toEqual(['MPN', 'Reference', 'Tolerance']);
  });

  it('collapses a name two items share into one row', () => {
    expect(dynamicFieldNames([{ key: 'Value' }, { key: 'Value' }])).toEqual(['Value']);
  });

  it('drops a private field wherever in the selection it appears', () => {
    expect(dynamicFieldNames([{ key: 'A' }, { key: 'B', isPrivate: true }])).toEqual(['A']);
  });
});
