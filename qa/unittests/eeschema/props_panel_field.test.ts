// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The properties panel's rows for a selected SCH_FIELD.
 *
 * `SCH_FIELD_DESC` (eeschema/sch_field.cpp:1739-1814) plus what it inherits
 * from EDA_TEXT (common/eda_text.cpp EDA_TEXT_DESC) and SCH_ITEM
 * (eeschema/sch_item.cpp SCH_ITEM_DESC) determines this exactly, and the
 * bug it fixes was an EXTRA row, not a missing one — a side-by-side showed
 * Position X, Position Y and Orientation, none of which upstream lists, inside
 * a "Field" group that exists nowhere in the C++.
 *
 * So the first assertion is the WHOLE ordered row set, group by group. A test
 * that only looked up the rows we do render could not have caught that.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  schItemFriendlyName,
  schPropertiesFor,
  type PropRow,
} from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8');
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

/**
 * A resistor whose Reference carries every text attribute the panel can show,
 * so no row can pass by defaulting: an explicit face, an explicit colour, both
 * justifications off centre, bold, italic, and a non-square nominal size —
 * `(size <height> <width>)` — which is the only way "Text Size" reading the
 * WIDTH can be told from it reading the height.
 */
const sheet = (extra = ''): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
    (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
      (property "Reference" "R1" (at 102 99 0)
        (show_name yes) (do_not_autoplace yes)
        (effects (font (face "KiCad Font") (size 1.27 2.54) (thickness 0.3) bold italic
                       (color 255 0 0 1))
                 (justify right bottom)))
      (property "Value" "10k" (at 102 102 0) (effects (font (size 1.27 1.27))))
      ${extra}))`),
  );

const fieldRef = (doc: Schematic, index: number) =>
  itemRefById(doc, `${refId('symbol', doc.symbols[0]!.uuid, 0)}:field${index}`)!;

const rowsFor = (doc: Schematic, index = 0): PropRow[] =>
  schPropertiesFor(doc, LIB, fieldRef(doc, index));

const named = (rows: PropRow[], name: string): PropRow | undefined =>
  rows.find((r) => r.name === name);

describe('a selected field lists exactly SCH_FIELD_DESC, in KiCad order', () => {
  it('is the whole row set, with nothing extra', () => {
    // `Show Field Name` (:1774) and `Allow Autoplacement` (:1777) carry no
    // group argument, so they land in the unnamed group; everything else is
    // `_HKI( "Text Properties" )`. EDA_TEXT's own block declares Text, Font,
    // Auto Thickness, Italic, Bold, Visible and Color (the masked Thickness,
    // Mirrored, Width, Height and Hyperlink dropping out), the two
    // ReplaceProperty justifications follow, and SCH_FIELD's Text Size is last.
    expect(rowsFor(sheet()).map((r) => [r.group, r.name])).toEqual([
      ['', 'Show Field Name'],
      ['', 'Allow Autoplacement'],
      ['Text Properties', 'Text'],
      ['Text Properties', 'Font'],
      ['Text Properties', 'Auto Thickness'],
      ['Text Properties', 'Italic'],
      ['Text Properties', 'Bold'],
      ['Text Properties', 'Visible'],
      ['Text Properties', 'Color'],
      ['Text Properties', 'Horizontal Justification'],
      ['Text Properties', 'Vertical Justification'],
      ['Text Properties', 'Text Size'],
    ]);
  });

  it.each([
    // `propMgr.Mask( TYPE_HASH( SCH_FIELD ), TYPE_HASH( EDA_TEXT ), … )`
    ['Orientation', 1791],
    ['Hyperlink', 1780],
    ['Thickness', 1781],
    ['Mirrored', 1782],
    ['Width', 1783],
    ['Height', 1784],
  ])('masks %s (sch_field.cpp:%i)', (name) => {
    expect(named(rowsFor(sheet()), name)).toBeUndefined();
  });

  it.each([
    // Nothing SCH_FIELD inherits registers a position: SCH_SYMBOL
    // (sch_symbol.cpp:3908), SCH_PIN (sch_pin.cpp:2043) and SCH_BITMAP
    // (sch_bitmap.cpp:308) each register their own, and SCH_FIELD does not.
    'Position X',
    'Position Y',
    // SCH_ITEM's three are all SetIsHiddenFromDesignEditors().
    'Unit',
    'Body Style',
    'Private',
  ])('does not list %s, which SCH_FIELD never inherits or shows', (name) => {
    expect(named(rowsFor(sheet()), name)).toBeUndefined();
  });

  it('has no "Field" group at all', () => {
    // The group we invented. Upstream's only named group here is
    // `_HKI( "Text Properties" )`.
    expect([...new Set(rowsFor(sheet()).map((r) => r.group))]).toEqual(['', 'Text Properties']);
  });

  it('captions the pane "Field"', () => {
    // `EDA_ITEM_DESC` maps SCH_FIELD_T to `_HKI( "Field" )`
    // (common/eda_item.cpp).
    expect(schItemFriendlyName(sheet(), fieldRef(sheet(), 0))).toBe('Field');
  });
});

describe('each row reads the field, not a default', () => {
  const rows = () => rowsFor(sheet());

  it('reports Show Field Name and Allow Autoplacement in their positive sense', () => {
    // `CanAutoplace()` is positive; the FILE stores `(do_not_autoplace yes)`,
    // so a row that forwarded the stored flag would read `true` here.
    expect(named(rows(), 'Show Field Name')!.value).toBe(true);
    expect(named(rows(), 'Allow Autoplacement')!.value).toBe(false);
  });

  it('reads Text Size as the WIDTH, per GetSchTextSize', () => {
    // `GetSchTextSize() { return GetTextWidth(); }` (sch_field.h:180), and
    // `(size 1.27 2.54)` is height then width, so this is 2.54 mm and not the
    // 1.27 a height-reader would give.
    expect(named(rows(), 'Text Size')!.value).toBe(mmToIU(2.54));
  });

  it('reads Font, Color, the two justifications and the three flags', () => {
    expect(named(rows(), 'Font')!.value).toBe('KiCad Font');
    expect(named(rows(), 'Color')!.value).toBe('rgb(255, 0, 0)');
    expect(named(rows(), 'Color')!.swatch).toBe('rgb(255, 0, 0)');
    expect(named(rows(), 'Horizontal Justification')!.value).toBe('Right');
    expect(named(rows(), 'Vertical Justification')!.value).toBe('Bottom');
    expect(named(rows(), 'Bold')!.value).toBe(true);
    expect(named(rows(), 'Italic')!.value).toBe(true);
    expect(named(rows(), 'Visible')!.value).toBe(true);
    // `GetAutoThickness() { return GetTextThickness() == 0; }` — this field
    // carries `(thickness 0.3)`, so it is NOT auto.
    expect(named(rows(), 'Auto Thickness')!.value).toBe(false);
  });

  it('falls back to Default Font and centre justification with no tokens', () => {
    // The Value field carries nothing but a size, which is the common case and
    // the one a getter reading the wrong key still passes on.
    const value = rowsFor(sheet(), 1);
    expect(named(value, 'Font')!.value).toBe('Default Font');
    expect(named(value, 'Horizontal Justification')!.value).toBe('Center');
    expect(named(value, 'Vertical Justification')!.value).toBe('Center');
    expect(named(value, 'Color')!.value).toBe('');
    expect(named(value, 'Auto Thickness')!.value).toBe(true);
  });
});

describe('the two conditional rules SCH_FIELD_DESC overrides', () => {
  it('makes Text writeable on an ordinary field', () => {
    const text = named(rowsFor(sheet()), 'Text')!;
    expect(text.value).toBe('R1');
    expect(text.set).toBeTypeOf('function');
  });

  it('makes Text read-only on a generated field', () => {
    // `OverrideWriteability( …, "Text", isNotGeneratedField )` (:1801).
    // `SCH_FIELD::SetText` returns without writing on one (:1077-1082), so a
    // writeable cell here would silently discard the user's typing.
    const doc = sheet('(property "${QUANTITY}" "3" (at 102 105 0))');
    const generated = named(rowsFor(doc, 2), 'Text')!;
    expect(generated.set).toBeUndefined();
  });
});

describe('a row commits an undoable edit', () => {
  it('writes Allow Autoplacement through, and inverts back', () => {
    const doc = sheet();
    const cmd = named(rowsFor(doc), 'Allow Autoplacement')!.set!(true)!;
    const after = cmd.apply(doc);
    expect(after.symbols[0]!.fields[0]!.doNotAutoplace).toBe(false);
    expect(cmd.invert(doc).apply(after).symbols[0]!.fields[0]!.doNotAutoplace).toBe(true);
  });

  it('writes Text Size to BOTH axes, as SetSchTextSize does', () => {
    const doc = sheet();
    const after = named(rowsFor(doc), 'Text Size')!.set!(mmToIU(2))!.apply(doc);
    expect(after.symbols[0]!.fields[0]!.effects?.fontSize).toEqual([mmToIU(2), mmToIU(2)]);
  });

  it('replaces one justification axis without disturbing the other', () => {
    const doc = sheet();
    const after = named(rowsFor(doc), 'Horizontal Justification')!.set!('Left')!.apply(doc);
    const justify = after.symbols[0]!.fields[0]!.effects?.justify ?? [];
    expect([...justify].sort()).toEqual(['bottom', 'left']);
  });

  it('writes no token at all for centre, which KiCad omits', () => {
    const doc = sheet();
    const after = named(rowsFor(doc), 'Vertical Justification')!.set!('Center')!.apply(doc);
    expect(after.symbols[0]!.fields[0]!.effects?.justify).toEqual(['right']);
  });
});
