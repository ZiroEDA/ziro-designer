// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The properties panel's rows for a selected SCH_SYMBOL — which rows, in which
 * group, in which order, and which of them are writeable.
 *
 * None of that was pinned before: no test called `schPropertiesFor` on a symbol
 * at all, so the panel could (and did) list a "Locked" row upstream does not
 * have, omit the two pin flags that upstream puts FIRST, and order the rest by
 * whatever the code happened to push.
 *
 * The order is not a preference. `PROPERTIES_PANEL::rebuildProperties` sorts a
 * group's properties by `PROPERTY_MANAGER::GetDisplayOrder`, and
 * `CLASS_DESC::collectPropsRecur` (common/properties/property_mgr.cpp:349-398)
 * builds that by giving each class its own registration order and then placing
 * each BASE class's block at `firstSoFar - m_ownProperties.size()` — below
 * everything a subclass registered. So:
 *
 *  - "Pin numbers" / "Pin names" are `PROPERTY<SYMBOL, bool>`, registered
 *    against the SYMBOL base class, and therefore sort ahead of every property
 *    SCH_SYMBOL declares;
 *  - inside SCH_SYMBOL's own block the order is exactly the source order of
 *    sch_symbol.cpp's SCH_SYMBOL_DESC: Position X, Position Y, Orientation,
 *    Mirror X, Mirror Y, then the five Fields properties, then Unit and Body
 *    Style, then the five Attributes ones. Group membership then splits that
 *    one sequence into the three category blocks — which is why "Unit" ends up
 *    at the BOTTOM of Basic Properties rather than beside Mirror Y;
 *  - the symbol's own fields are added last, by
 *    `SCH_PROPERTIES_PANEL::rebuildProperties`, out of a `std::set<wxString>`
 *    and so alphabetically.
 *
 * The group captions come from the same place: `unspecifiedGroupCaption` is
 * "Basic Properties" (properties_panel.cpp:339) and the two named groups are
 * `_HKI( "Fields" )` and `_HKI( "Attributes" )` in SCH_SYMBOL_DESC.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  schPropertiesFor,
  schItemFriendlyName,
} from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById } from '@ziroeda/eeschema/src/tools/hittest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

/**
 * The fields are deliberately NOT in alphabetical order in the file: Footprint
 * comes before Datasheet before Description. A test whose fixture is already
 * sorted cannot tell "sorted" from "in file order".
 */
const withLib = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
    (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
      (property "Reference" "R1" (at 0 0 0))
      (property "Value" "10k" (at 0 0 0))
      (property "Footprint" "R_0603" (at 0 0 0))
      (property "Datasheet" "ds.pdf" (at 0 0 0))
      (property "Description" "Resistor" (at 0 0 0))))`),
  );

/** The same placement with no cached definition to resolve against. */
const withoutLib = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
    (symbol (lib_id "Nope") (at 100 100 0) (unit 1) (uuid "r1")
      (property "Reference" "R1" (at 0 0 0))
      (property "Value" "10k" (at 0 0 0))))`),
  );

const rowsOf = (doc: Schematic, lib = LIB) => schPropertiesFor(doc, lib, itemRefById(doc, 'r1')!);

describe('a selected symbol lists the rows SCH_SYMBOL registers, in KiCad order', () => {
  it('puts the two SYMBOL-base pin flags before every SCH_SYMBOL property', () => {
    const names = rowsOf(withLib()).map((r) => r.name);
    expect(names.slice(0, 2)).toEqual(['Pin numbers', 'Pin names']);
  });

  it('lists Basic Properties in SCH_SYMBOL_DESC registration order', () => {
    const basic = rowsOf(withLib())
      .filter((r) => r.group === '')
      .map((r) => r.name);
    // "Unit" is absent: R is single-unit, and the property carries
    // `.SetAvailableFunc( multiUnit )`.
    expect(basic).toEqual([
      'Pin numbers',
      'Pin names',
      'Position X',
      'Position Y',
      'Orientation',
      'Mirror X',
      'Mirror Y',
    ]);
  });

  it('lists the Fields group with the five static rows before the symbol fields', () => {
    const fields = rowsOf(withLib())
      .filter((r) => r.group === 'Fields')
      .map((r) => r.name);
    expect(fields).toEqual([
      'Reference',
      'Value',
      'Library Link',
      'Library Description',
      'Keywords',
      // SCH_SYMBOL_FIELD_PROPERTY, alphabetical, and NOT the file's order
      // (Footprint, Datasheet, Description).
      'Datasheet',
      'Description',
      'Footprint',
    ]);
  });

  it('does not double a field that SCH_SYMBOL already declares a property for', () => {
    const fields = rowsOf(withLib()).filter((r) => r.group === 'Fields');
    for (const name of ['Reference', 'Value'])
      expect(fields.filter((r) => r.name === name)).toHaveLength(1);
  });

  it('lists all five Attributes rows', () => {
    const attrs = rowsOf(withLib())
      .filter((r) => r.group === 'Attributes')
      .map((r) => r.name);
    expect(attrs).toEqual([
      'Exclude From Simulation',
      'Exclude From Bill of Materials',
      'Exclude From Board',
      'Exclude From Position Files',
      'Do not Populate',
    ]);
  });

  it('uses only the three group names SCH_SYMBOL_DESC declares, in that order', () => {
    const seen: string[] = [];
    for (const r of rowsOf(withLib())) if (!seen.includes(r.group)) seen.push(r.group);
    expect(seen).toEqual(['', 'Fields', 'Attributes']);
  });

  it('has no "Locked" row — SCH_ITEM_DESC guards it with #ifdef NOTYET', () => {
    expect(rowsOf(withLib()).map((r) => r.name)).not.toContain('Locked');
  });
});

describe('writeability follows the registrations', () => {
  it('makes exactly the three NO_SETTER properties read-only', () => {
    const ro = rowsOf(withLib())
      .filter((r) => !r.set)
      .map((r) => r.name);
    expect(ro).toEqual(['Library Link', 'Library Description', 'Keywords']);
  });

  it('leaves every other row writeable', () => {
    const rows = rowsOf(withLib());
    expect(rows.filter((r) => r.set).length).toBe(rows.length - 3);
  });
});

describe('the pin flags read and write the cached library symbol', () => {
  it('reads each flag off the LIB_SYMBOL, which R sets differently for the two', () => {
    // R.kicad_sym: `(pin_numbers (hide yes))` and a `(pin_names (offset 0))`
    // with no hide. So the two rows must NOT agree.
    const rows = rowsOf(withLib());
    expect(rows.find((r) => r.name === 'Pin numbers')!.value).toBe(false);
    expect(rows.find((r) => r.name === 'Pin names')!.value).toBe(true);
  });

  it('writes the flag onto lib_symbols, not onto the placement', () => {
    const doc = withLib();
    const cmd = rowsOf(doc).find((r) => r.name === 'Pin numbers')!.set!(true)!;
    const next = cmd.apply(doc);
    expect(next.libSymbols[0]!.pinNumbersHidden).toBe(false);
    expect(next.symbols[0]).toEqual(doc.symbols[0]);
  });

  it('undoes back to the flag the file carried', () => {
    const doc = withLib();
    const cmd = rowsOf(doc).find((r) => r.name === 'Pin names')!.set!(false)!;
    const back = cmd.invert(doc).apply(cmd.apply(doc));
    expect(back.libSymbols[0]!.pinNamesHidden).toBe(doc.libSymbols[0]!.pinNamesHidden);
  });

  it('drops both rows when the placement resolves to no cached definition', () => {
    // `.SetAvailableFunc( hasLibPart )` — absent, not greyed.
    const names = rowsOf(withoutLib(), new Map()).map((r) => r.name);
    expect(names).not.toContain('Pin numbers');
    expect(names).not.toContain('Pin names');
    expect(names[0]).toBe('Position X');
  });
});

describe('the caption names the item type (EDA_ITEM::GetFriendlyName)', () => {
  it('calls a placed symbol "Symbol"', () => {
    const doc = withLib();
    expect(schItemFriendlyName(doc, itemRefById(doc, 'r1')!)).toBe('Symbol');
  });

  it('names a wire, a bus and a graphic line differently — SCH_LINE picks by layer', () => {
    const doc = readSchematic(
      parse(`(kicad_sch (version 20250114)
        (wire (pts (xy 0 0) (xy 1 0)) (uuid "w1"))
        (bus (pts (xy 0 5) (xy 1 5)) (uuid "b1"))
        (polyline (pts (xy 0 9) (xy 1 9)) (uuid "p1")))`),
    );
    expect(schItemFriendlyName(doc, itemRefById(doc, 'w1')!)).toBe('Wire');
    expect(schItemFriendlyName(doc, itemRefById(doc, 'b1')!)).toBe('Bus');
    expect(schItemFriendlyName(doc, itemRefById(doc, 'p1')!)).toBe('Graphic Line');
  });

  it('uses the ENUM_MAP string, not the class name, for a no-connect', () => {
    const doc = readSchematic(
      parse('(kicad_sch (version 20250114) (no_connect (at 0 0) (uuid "n1")))'),
    );
    expect(schItemFriendlyName(doc, itemRefById(doc, 'n1')!)).toBe('No-Connect Flag');
  });

  it('names the four label classes by their own overrides', () => {
    const doc = readSchematic(
      parse(`(kicad_sch (version 20250114)
        (label "A" (at 0 0 0) (uuid "l1"))
        (global_label "B" (at 0 5 0) (uuid "l2"))
        (hierarchical_label "C" (at 0 9 0) (uuid "l3"))
        (text "D" (at 0 13 0) (uuid "l4")))`),
    );
    expect(schItemFriendlyName(doc, itemRefById(doc, 'l1')!)).toBe('Label');
    expect(schItemFriendlyName(doc, itemRefById(doc, 'l2')!)).toBe('Global Label');
    expect(schItemFriendlyName(doc, itemRefById(doc, 'l3')!)).toBe('Hierarchical Label');
    expect(schItemFriendlyName(doc, itemRefById(doc, 'l4')!)).toBe('Text');
  });
});
