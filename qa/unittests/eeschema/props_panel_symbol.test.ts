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

  /**
   * The three SCH_SYMBOL_DESC declares plus the one it INHERITS.
   *
   * `CLASS_DESC::rebuild`'s `collectGroupsRecursive`
   * (common/properties/property_mgr.cpp:317-343) walks a class's own
   * `m_groupDisplayOrder` first and only then recurses into its bases, adding
   * a group the first time it is seen. SCH_SYMBOL's own registration order is
   * "" (Position X, sch_symbol.cpp:3908), "Fields" (:3938) and "Attributes"
   * (:4007); "Pin Display" is registered against the SYMBOL base by
   * LIB_SYMBOL_DESC (lib_symbol.cpp:2676), so it can only be appended after
   * all three — never interleaved.
   */
  it('appends the inherited "Pin Display" group after SCH_SYMBOL_DESC\'s own three', () => {
    const seen: string[] = [];
    for (const r of rowsOf(withLib())) if (!seen.includes(r.group)) seen.push(r.group);
    expect(seen).toEqual(['', 'Fields', 'Attributes', 'Pin Display']);
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
    // Counted out, not derived from the code under test: 2 pin flags + 5
    // Basic Properties + 5 static Fields + 3 symbol fields + 5 Attributes +
    // 3 Pin Display. Only the three NO_SETTER Fields rows are read-only; all
    // three Pin Display rows have setters (lib_symbol.cpp:2678-2690).
    const rows = rowsOf(withLib());
    expect(rows).toHaveLength(23);
    expect(rows.filter((r) => r.set)).toHaveLength(20);
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

/**
 * The "Pin Display" group, `lib_symbol.cpp:2676-2690`.
 *
 * It is declared in LIB_SYMBOL_DESC, but three of its four rows are
 * `PROPERTY<SYMBOL, …>` and SYMBOL is the base of BOTH LIB_SYMBOL and
 * SCH_SYMBOL (`eeschema/symbol.h:62`), so a placed symbol inherits them. The
 * fourth is `PROPERTY<LIB_SYMBOL, bool>` and cannot reach a SCH_SYMBOL:
 * `PROPERTIES_PANEL::rebuildProperties` only ever offers
 * `propMgr.GetProperties( TYPE_HASH( SCH_SYMBOL ) )`, and LIB_SYMBOL is a
 * SIBLING of SCH_SYMBOL under SYMBOL, not a base of it.
 */
describe('the Pin Display group a schematic symbol inherits from SYMBOL', () => {
  it('lists exactly the three SYMBOL-owned rows, in LIB_SYMBOL_DESC order', () => {
    const pinDisplay = rowsOf(withLib())
      .filter((r) => r.group === 'Pin Display')
      .map((r) => r.name);
    expect(pinDisplay).toEqual(['Show Pin Number', 'Show Pin Name', 'Pin Name Position Offset']);
  });

  it('never offers "Place Pin Names Inside", which is PROPERTY<LIB_SYMBOL, bool>', () => {
    // lib_symbol.cpp:2684. The Symbol Editor's LIB_SYMBOL gets it; a placement
    // never can. "Right in one frame, wrong in the other" is the bug shape.
    expect(rowsOf(withLib()).map((r) => r.name)).not.toContain('Place Pin Names Inside');
    expect(rowsOf(withoutLib(), new Map()).map((r) => r.name)).not.toContain(
      'Place Pin Names Inside',
    );
  });

  /**
   * Upstream registers "Pin numbers"/"Pin names" (sch_symbol.cpp:3930-3936)
   * AND "Show Pin Number"/"Show Pin Name" (lib_symbol.cpp:2678-2683) over the
   * SAME `SYMBOL::SetShowPinNumbers` / `SetShowPinNames`.
   * `PROPERTY_MANAGER::AddProperty` de-duplicates by NAME
   * (property_mgr.cpp:140), and these four names are all different, so all
   * four rows exist and two of them drive each value. That is upstream's
   * shape, not a bug to tidy away.
   */
  it('duplicates each flag: one row in Basic Properties, one in Pin Display', () => {
    const rows = rowsOf(withLib());
    const at = (n: string) => rows.find((r) => r.name === n)!;
    // R.kicad_sym hides pin numbers and shows pin names, so the pair does not
    // read the same value and an accidental swap would show.
    expect(at('Pin numbers').value).toBe(at('Show Pin Number').value);
    expect(at('Pin names').value).toBe(at('Show Pin Name').value);
    expect(at('Show Pin Number').value).toBe(false);
    expect(at('Show Pin Name').value).toBe(true);
  });

  it('writes the same flag from either of the two rows', () => {
    for (const name of ['Pin numbers', 'Show Pin Number']) {
      const doc = withLib();
      const next = rowsOf(doc).find((r) => r.name === name)!.set!(true)!.apply(doc);
      expect(next.libSymbols[0]!.pinNumbersHidden).toBe(false);
      // Both rows follow, because both read the one cached definition. The
      // map is rebuilt from the edited document exactly as the frame's
      // `libById` memo does (SchematicEditor.tsx:1402-1405).
      const after = schPropertiesFor(
        next,
        new Map(next.libSymbols.map((l) => [l.libId, l])),
        itemRefById(next, 'r1')!,
      );
      expect(after.find((r) => r.name === 'Pin numbers')!.value).toBe(true);
      expect(after.find((r) => r.name === 'Show Pin Number')!.value).toBe(true);
    }
  });

  /**
   * The pair in Pin Display carries NO `SetAvailableFunc` — only the
   * sch_symbol.cpp pair does (`:3932`, `:3936`). So without a cached
   * definition these two rows REMAIN, reading false, because
   * `SCH_SYMBOL::GetShowPinNumbers` is `m_part && …` (sch_symbol.cpp:3542).
   */
  it('keeps its two flags — unlike the gated pair — with no cached definition', () => {
    const rows = rowsOf(withoutLib(), new Map());
    const names = rows.map((r) => r.name);
    expect(names).toContain('Show Pin Number');
    expect(names).toContain('Show Pin Name');
    expect(names).not.toContain('Pin numbers');
    expect(rows.find((r) => r.name === 'Show Pin Number')!.value).toBe(false);
    expect(rows.find((r) => r.name === 'Show Pin Name')!.value).toBe(false);
  });

  /**
   * `PROPERTY_DISPLAY::PT_SIZE` (lib_symbol.cpp:2689) makes it a distance row,
   * and it reads `SYMBOL::GetPinNameOffset` on the SCH_SYMBOL — which is
   * SYMBOL's own member, 0 from `symbol.h:71` and never copied out of the
   * cached definition by `SetLibSymbol` (sch_symbol.cpp:254-266) or the
   * from-LIB_SYMBOL constructor (:80-114). So a placement whose definition
   * offsets its pin names by 20 mils still reads 0.
   */
  it('is a distance row reading the placement’s own offset, not the definition’s', () => {
    const offsetLib = rBlock.replace('(offset 0)', '(offset 0.508)');
    const doc = readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols ${offsetLib})
        (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
          (property "Reference" "R1" (at 0 0 0))
          (property "Value" "10k" (at 0 0 0))))`),
    );
    // The fixture really does carry the non-zero offset — and the map the row
    // provider is handed must be built from THIS document, not from the
    // module-level `LIB` whose R has `(offset 0)`. Resolving to a definition
    // that happens to say 0 would make a row reading `lib.pinNameOffset`
    // indistinguishable from one reading the placement's own.
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    expect(libById.get('R')!.pinNameOffset).toBe(5080);
    // ...and the row still reads the SCH_SYMBOL's own zero.
    const row = schPropertiesFor(doc, libById, itemRefById(doc, 'r1')!).find(
      (r) => r.name === 'Pin Name Position Offset',
    )!;
    expect(row.kind).toBe('dist');
    expect(row.value).toBe(0);
  });

  it('writes the offset onto the placement, leaving the cached definition alone', () => {
    const doc = withLib();
    const cmd = rowsOf(doc).find((r) => r.name === 'Pin Name Position Offset')!.set!(5080)!;
    const next = cmd.apply(doc);
    expect(next.symbols[0]!.pinNameOffset).toBe(5080);
    expect(next.libSymbols[0]).toEqual(doc.libSymbols[0]);
    expect(cmd.invert(doc).apply(next).symbols[0]!.pinNameOffset).toBe(undefined);
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
