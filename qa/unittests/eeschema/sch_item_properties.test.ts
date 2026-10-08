// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_ITEM_DESC` (sch_item.cpp:844): the properties every schematic item has - Unit and Body
 * Style, offered only inside a multi-unit / multi-body-style symbol and hidden from the schematic
 * editor, and Private - over EDA_ITEM's.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { TYPE_HASH } from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER } from '@ziroeda/common/properties/property_mgr.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import { SCH_GROUP } from '@ziroeda/eeschema/sch_group.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { SCH_SHEET_PIN } from '@ziroeda/eeschema/sch_sheet_pin.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_BITMAP } from '@ziroeda/eeschema/sch_bitmap.js';
import { GetFieldValidationErrorMessage } from '@ziroeda/common/validators.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { SCH_BUS_WIRE_ENTRY } from '@ziroeda/eeschema/sch_bus_entry.js';
import { SCH_RULE_AREA } from '@ziroeda/eeschema/sch_rule_area.js';
import { SCH_TEXTBOX } from '@ziroeda/eeschema/sch_textbox.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { EDA_SHAPE, FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
} from '@ziroeda/eeschema/sch_label.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const prop = (aName: string) =>
  PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_ITEM), aName)!;

describe('SCH_ITEM_DESC', () => {
  it('registers Unit, Body Style and Private over the EDA_ITEM properties', () => {
    const names = PROPERTY_MANAGER.Instance()
      .GetProperties(TYPE_HASH(SCH_ITEM))
      .map((p) => p.Name());

    expect(names).toEqual(expect.arrayContaining(['Unit', 'Body Style', 'Private']));
    expect(prop('Unit').IsHiddenFromDesignEditors()).toBe(true);
    expect(prop('Body Style').IsHiddenFromDesignEditors()).toBe(true);
    expect(prop('Private').IsHiddenFromDesignEditors()).toBe(true);
    expect(names).not.toContain('Locked'); // #ifdef NOTYET upstream
  });

  it('offers Unit only inside a multi-unit symbol, with "All units" and each unit as choices', () => {
    const h = schToolHarness(schFrame({}));
    openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
    const symbols = h.frame
      .Schematic()
      .Hierarchy()
      .flatMap((p) => [...p.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]);
    const dual = symbols.find((s) => s.GetUnitCount() === 2)!;
    const single = symbols.find((s) => s.GetUnitCount() === 1 && s.GetPins().length > 0)!;

    const dualPin = dual.GetPins()[0]!;
    const singlePin = single.GetPins()[0]!;

    expect(prop('Unit').Available(dualPin)).toBe(true);
    expect(prop('Unit').Available(singlePin)).toBe(false);
    expect(prop('Body Style').Available(singlePin)).toBe(false);

    const choices = prop('Unit').GetChoices(dualPin);
    const rows = Array.from({ length: choices.GetCount() }, (_, i) => [
      choices.GetLabel(i),
      choices.GetValue(i),
    ]);
    expect(rows).toEqual([
      ['All units', 0],
      ['A', 1],
      ['B', 2],
    ]);
  });
});

/** The property names a type shows: masked base properties gone, its own and its bases' kept. */
const shown = (aType: object) =>
  PROPERTY_MANAGER.Instance()
    .GetProperties(TYPE_HASH(aType as never))
    .map((p) => p.Name());

describe('the leaf registrations', () => {
  it('SCH_JUNCTION_DESC: Diameter (a size) and Color, over SCH_ITEM', () => {
    const names = shown(SCH_JUNCTION);
    expect(names).toEqual(expect.arrayContaining(['Diameter', 'Color', 'Unit', 'Private']));

    const j = new SCH_JUNCTION({ x: 0, y: 0 });
    const diameter = PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_JUNCTION), 'Diameter')!;
    diameter.set(j, 2540);
    expect(j.GetDiameter()).toBe(2540);
  });

  it('SCH_TEXT_DESC: Text Size in Text Properties; Mirrored, Width, Height, Thickness, Orientation masked', () => {
    const names = shown(SCH_TEXT);
    expect(names).toContain('Text Size');
    for (const masked of ['Mirrored', 'Width', 'Height', 'Thickness', 'Orientation'])
      expect(names).not.toContain(masked);
    expect(names).toEqual(expect.arrayContaining(['Text', 'Italic', 'Bold']));
    expect(PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_TEXT), 'Text Size')!.Group()).toBe(
      'Text Properties',
    );
  });

  it('SCH_SHEET_PIN_DESC: everything a hierarchical label has', () => {
    expect(shown(SCH_SHEET_PIN)).toEqual(expect.arrayContaining(['Text Size', 'Text']));
  });

  it('SCH_GROUP_DESC: Name in Group Properties; no Position X/Y', () => {
    const names = shown(SCH_GROUP);
    expect(names).toContain('Name');
    expect(names).not.toContain('Position X');
    expect(names).not.toContain('Position Y');
  });

  it('SCH_LABEL_DESC: Shape only on global and hierarchical labels and sheet pins; Hyperlink masked', () => {
    const shape = PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_HIERLABEL), 'Shape')!;
    expect(shape.Available(new SCH_HIERLABEL({ x: 0, y: 0 }, 'H'))).toBe(true);
    expect(shape.Available(new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'G'))).toBe(true);
    expect(shape.Available(new SCH_LABEL({ x: 0, y: 0 }, 'L'))).toBe(false);
    expect(shown(SCH_LABEL)).not.toContain('Hyperlink');
    expect(shown(SCH_LABEL)).toContain('Text Size');
  });

  it('SCH_DIRECTIVE_LABEL_DESC: its own Shape and Pin length; the text properties it has no use for masked', () => {
    const names = shown(SCH_DIRECTIVE_LABEL);
    expect(names).toEqual(expect.arrayContaining(['Shape', 'Pin length']));
    for (const masked of [
      'Text',
      'Thickness',
      'Italic',
      'Bold',
      'Horizontal Justification',
      'Vertical Justification',
    ])
      expect(names).not.toContain(masked);
  });

  it('SCH_LINE_DESC: Line Style only on graphic lines, Wire Style only on wires and buses', () => {
    const get = (n: string) => PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_LINE), n)!;
    const wire = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    const bus = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_BUS);
    const note = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_NOTES);

    expect([get('Line Style').Available(note), get('Line Style').Available(wire)]).toEqual([
      true,
      false,
    ]);
    expect([
      get('Wire Style').Available(wire),
      get('Wire Style').Available(bus),
      get('Wire Style').Available(note),
    ]).toEqual([true, true, false]);
    expect(shown(SCH_LINE)).toEqual(
      expect.arrayContaining([
        'Start X',
        'Start Y',
        'End X',
        'End Y',
        'Length',
        'Line Width',
        'Color',
      ]),
    );
  });

  it('SCH_SHAPE_DESC: Fill Mode only in symbols; Fill Color editable only for a solid / colour fill', () => {
    const get = (n: string) => PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_SHAPE), n)!;
    const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_NOTES);
    const symRect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);

    expect([get('Fill Mode').Available(symRect), get('Fill Mode').Available(rect)]).toEqual([
      true,
      false,
    ]);
    expect(get('Fill Mode').Group()).toBe('Shape Properties');

    // Upstream also overrides "Position X"/"Y" from SCH_ITEM and "Filled" from EDA_SHAPE, none of
    // which exists in 10.0.6: those overrides change nothing, and the rows are not there.
    expect(shown(SCH_SHAPE)).not.toContain('Position X');
    expect(shown(SCH_SHAPE)).not.toContain('Filled');

    // The panel asks PROPERTY_MANAGER::IsWriteableFor, which applies the class's overrides.
    const fillColor = get('Fill Color');
    const writeable = () =>
      PROPERTY_MANAGER.Instance().IsWriteableFor(TYPE_HASH(SCH_SHAPE), fillColor, rect);
    rect.SetFillMode(FILL_T.NO_FILL);
    expect(writeable()).toBe(false);
    rect.SetFillMode(FILL_T.FILLED_WITH_COLOR);
    expect(writeable()).toBe(true);
  });

  it('SCH_BUS_ENTRY_DESC: Wire Style, Line Width and Color on both kinds of entry', () => {
    expect(shown(SCH_BUS_WIRE_ENTRY)).toEqual(
      expect.arrayContaining(['Wire Style', 'Line Width', 'Color', 'Unit']),
    );
  });

  it('SCH_RULE_AREA_DESC: the four exclusion flags in Attributes, over the shape properties', () => {
    const names = shown(SCH_RULE_AREA);
    const flags = [
      'Exclude From Board',
      'Exclude From Simulation',
      'Exclude From Bill of Materials',
      'Do not Populate',
    ];
    expect(names).toEqual(expect.arrayContaining([...flags, 'Fill Mode']));
    for (const f of flags)
      expect(PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_RULE_AREA), f)!.Group()).toBe(
        'Attributes',
      );
  });

  it('SCH_TEXTBOX_DESC: the margins in Margins and Text Size; Shape, Corner Radius and the text sizes masked', () => {
    const names = shown(SCH_TEXTBOX);
    expect(names).toEqual(
      expect.arrayContaining([
        'Margin Left',
        'Margin Top',
        'Margin Right',
        'Margin Bottom',
        'Text Size',
        'Text',
      ]),
    );
    for (const masked of ['Shape', 'Corner Radius', 'Thickness', 'Orientation'])
      expect(names).not.toContain(masked);
    // EDA_SHAPE has a Width and Height of its own (the box); only EDA_TEXT's are masked. Upstream's
    // collectPropsRecur does not de-duplicate, so EDA_SHAPE's arrive once per inheritance path
    // (through SCH_SHAPE and directly) - the same property each time.
    const all = PROPERTY_MANAGER.Instance().GetProperties(TYPE_HASH(SCH_TEXTBOX));
    for (const n of ['Width', 'Height']) {
      const found = new Set(all.filter((p) => p.Name() === n));
      expect(found.size).toBe(1);
      expect([...found][0]!.OwnerHash()).toBe(TYPE_HASH(EDA_SHAPE));
    }
    expect(
      PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_TEXTBOX), 'Margin Top')!.Group(),
    ).toBe('Margins');
  });

  it('SCH_SHEET_DESC: Sheet Name refuses an empty name or a "/", through the field validator', () => {
    const name = PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_SHEET), 'Sheet Name')!;
    const fmt = (v: unknown) => name.Validate(v, null)?.Format({} as never) ?? '';
    expect(fmt('Power')).toBe('');
    expect(fmt('')).toBe('A sheet must have a name.');
    expect(fmt('a/b')).toBe("The sheet name cannot contain '/' character(s).");
    expect(shown(SCH_SHEET)).toEqual(
      expect.arrayContaining([
        'Border Width',
        'Border Color',
        'Background Color',
        'Do not Populate',
      ]),
    );
  });

  it('SCH_BITMAP_DESC: position, then scale, offsets and size in Image Properties', () => {
    const names = shown(SCH_BITMAP);
    expect(names).toEqual(
      expect.arrayContaining([
        'Position X',
        'Position Y',
        'Scale',
        'Transform Offset X',
        'Width',
        'Height',
      ]),
    );
    expect(PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_BITMAP), 'Scale')!.Group()).toBe(
      'Image Properties',
    );
  });
});

describe('SCH_PIN_DESC', () => {
  it('a pin is edited in the symbol editor: read-only in a schematic symbol, its position hidden there', () => {
    const h = schToolHarness(schFrame({}));
    openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
    const symbol = h.frame
      .Schematic()
      .Hierarchy()
      .flatMap((p) => [...p.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[])
      .find((s) => s.GetPins().length > 0)!;
    const schPin = symbol.GetPins()[0]!;
    const libPin = symbol.GetLibSymbolRef()!.GetPins()[0]!;
    const mgr = PROPERTY_MANAGER.Instance();
    const get = (n: string) => mgr.GetProperty(TYPE_HASH(SCH_PIN), n)!;

    for (const n of [
      'Pin Name',
      'Pin Number',
      'Electrical Type',
      'Graphic Style',
      'Orientation',
      'Length',
    ]) {
      expect(mgr.IsWriteableFor(TYPE_HASH(SCH_PIN), get(n), schPin), n).toBe(false);
      expect(mgr.IsWriteableFor(TYPE_HASH(SCH_PIN), get(n), libPin), n).toBe(true);
    }

    for (const n of ['Position X', 'Position Y', 'Name Text Size', 'Number Text Size', 'Visible']) {
      expect(mgr.IsAvailableFor(TYPE_HASH(SCH_PIN), get(n), schPin), n).toBe(false);
      expect(mgr.IsAvailableFor(TYPE_HASH(SCH_PIN), get(n), libPin), n).toBe(true);
    }

    const types = get('Electrical Type').Choices();
    expect(types.GetLabel(0)).toBe('Input');
    expect(types.GetLabel(types.GetCount() - 1)).toBe('Unconnected');
  });
});

/** The rows of \a aType by group, groups in GetGroupDisplayOrder, rows in GetDisplayOrder. */
function byGroup(aType: abstract new (...args: never[]) => unknown): Map<string, string[]> {
  const mgr = PROPERTY_MANAGER.Instance();
  const order = [...mgr.GetDisplayOrder(TYPE_HASH(aType)).entries()].sort((a, b) => a[1] - b[1]);
  const rows = new Map<string, string[]>(
    mgr.GetGroupDisplayOrder(TYPE_HASH(aType)).map((g) => [g, []]),
  );

  for (const [p] of order) rows.get(p.Group())!.push(p.Name());

  return rows;
}

describe('SCH_SYMBOL_DESC', () => {
  it("groups its rows as upstream's panel does: its own groups first, then SYMBOL's Pin Display", () => {
    const rows = byGroup(SCH_SYMBOL);

    expect([...rows.keys()]).toEqual(['', 'Fields', 'Attributes', 'Pin Display']);
    expect(rows.get('')).toEqual([
      'Pin numbers',
      'Pin names',
      'Position X',
      'Position Y',
      'Orientation',
      'Mirror X',
      'Mirror Y',
      'Unit',
      'Body Style',
    ]);
    expect(rows.get('Fields')).toEqual([
      'Reference',
      'Value',
      'Library Link',
      'Library Description',
      'Keywords',
    ]);
    expect(rows.get('Attributes')).toEqual([
      'Exclude From Simulation',
      'Exclude From Bill of Materials',
      'Exclude From Board',
      'Exclude From Position Files',
      'Do not Populate',
    ]);
    // LIB_SYMBOL_DESC registers these on SYMBOL, so a schematic symbol has them too.
    expect(rows.get('Pin Display')).toEqual([
      'Show Pin Number',
      'Show Pin Name',
      'Pin Name Position Offset',
    ]);
    // Not SCH_ITEM's: upstream links SCH_SYMBOL to SYMBOL only.
    expect([...rows.values()].flat()).not.toContain('Private');
  });

  it('the library-backed rows need a library symbol; Unit needs more than one unit', () => {
    const h = schToolHarness(schFrame({}));
    openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
    const symbols = h.frame
      .Schematic()
      .Hierarchy()
      .flatMap((p) => [...p.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]);
    const dual = symbols.find((s) => s.GetUnitCount() === 2)!;
    const single = symbols.find((s) => s.GetUnitCount() === 1)!;
    const mgr = PROPERTY_MANAGER.Instance();
    const get = (n: string) => mgr.GetProperty(TYPE_HASH(SCH_SYMBOL), n)!;

    expect(mgr.IsAvailableFor(TYPE_HASH(SCH_SYMBOL), get('Unit'), dual)).toBe(true);
    expect(mgr.IsAvailableFor(TYPE_HASH(SCH_SYMBOL), get('Unit'), single)).toBe(false);
    expect(mgr.IsAvailableFor(TYPE_HASH(SCH_SYMBOL), get('Pin numbers'), single)).toBe(true);
    expect(get('Library Link').Writeable(dual)).toBe(false); // NO_SETTER

    // The exclusion rows act on the current sheet's instance, each its own attribute.
    single.SetExcludedFromBOMProp(true);
    expect([single.GetExcludedFromBOMProp(), single.GetExcludedFromSimProp()]).toEqual([true, false]);
    expect(single.GetExcludedFromBOM(h.frame.Schematic().CurrentSheet())).toBe(true);
    single.SetExcludedFromSimProp(true);
    single.SetExcludedFromBOMProp(false);
    expect([single.GetExcludedFromBOMProp(), single.GetExcludedFromSimProp()]).toEqual([false, true]);

    const choices = get('Unit').GetChoices(dual);
    expect([choices.GetLabel(0), choices.GetValue(0), choices.GetLabel(1)]).toEqual(['A', 1, 'B']);
  });
});

describe('LIB_SYMBOL_DESC', () => {
  it("groups its rows as upstream does, SYMBOL's pin rows inside Pin Display", () => {
    const rows = byGroup(LIB_SYMBOL);

    // CLASS_DESC's constructor seeds the unnamed group first, in every class.
    expect([...rows.keys()]).toEqual([
      '',
      'Fields',
      'Symbol Definition',
      'Pin Display',
      'Attributes',
      'Units and Body Styles',
    ]);
    expect(rows.get('Fields')).toEqual([
      'Reference',
      'Value',
      'Footprint',
      'Datasheet',
      'Keywords',
    ]);
    expect(rows.get('Symbol Definition')).toEqual([
      'Define as Power Symbol',
      'Define as Local Power Symbol',
    ]);
    // collectPropsRecur numbers a base's rows before the class's own: SYMBOL's three, then this one.
    expect(rows.get('Pin Display')).toEqual([
      'Show Pin Number',
      'Show Pin Name',
      'Pin Name Position Offset',
      'Place Pin Names Inside',
    ]);
    expect(rows.get('Attributes')).toEqual([
      'Exclude from Simulation',
      'Exclude from Board',
      'Exclude from Bill of Materials',
      'Exclude from Position Files',
    ]);
    expect(rows.get('Units and Body Styles')).toEqual([
      'Number of Symbol Units',
      'Units are Interchangeable',
      'Body Styles',
    ]);
    // SCH_SYMBOL_DESC's two SYMBOL rows.
    expect(rows.get('')).toEqual(['Pin numbers', 'Pin names']);
  });

  it('clearing Local Power on a power symbol leaves it a global power symbol; on a normal one, normal', () => {
    const power = new LIB_SYMBOL('PWR');
    power.SetLocalPowerSymbolProp(true);
    expect([power.IsLocalPower(), power.GetPowerSymbolProp()]).toEqual([true, true]);
    power.SetLocalPowerSymbolProp(false);
    expect([power.IsLocalPower(), power.IsGlobalPower()]).toEqual([false, true]);

    const plain = new LIB_SYMBOL('R');
    plain.SetLocalPowerSymbolProp(false);
    expect(plain.IsPower()).toBe(false);
    plain.SetPowerSymbolProp(true);
    plain.SetPowerSymbolProp(false);
    expect(plain.IsPower()).toBe(false);
  });

  it('Place Pin Names Inside restores the default offset only from zero, and clears it to zero', () => {
    const sym = new LIB_SYMBOL('U');
    sym.SetPinNameOffset(0);
    expect(sym.GetPinNamesInsideProp()).toBe(false);
    sym.SetPinNamesInsideProp(true);
    expect(sym.GetPinNameOffset()).toBe(20 * 254); // DEFAULT_PIN_NAME_OFFSET, 20 mil
    sym.SetPinNameOffset(40 * 254);
    sym.SetPinNamesInsideProp(true);
    expect(sym.GetPinNameOffset()).toBe(40 * 254);
    sym.SetPinNamesInsideProp(false);
    expect(sym.GetPinNameOffset()).toBe(0);
  });

  it('Units are Interchangeable is the inverse of locked units; Number of Symbol Units is the unit count', () => {
    const sym = new LIB_SYMBOL('U');
    sym.SetUnitsInterchangeableProp(false);
    expect(sym.UnitsLocked()).toBe(true);
    sym.SetUnitsInterchangeableProp(true);
    expect(sym.UnitsLocked()).toBe(false);
    sym.SetUnitProp(3);
    expect(sym.GetUnitCount()).toBe(3);
    expect(sym.GetUnitProp()).toBe(3);
  });
});

describe('SCH_FIELD_DESC', () => {
  const mgr = () => PROPERTY_MANAGER.Instance();
  const get = (n: string) => mgr().GetProperty(TYPE_HASH(SCH_FIELD), n)!;

  it("replaces EDA_TEXT's justifications with the field's effective ones, in Text Properties", () => {
    expect(get('Horizontal Justification').OwnerHash()).toBe(TYPE_HASH(SCH_FIELD));
    expect(get('Vertical Justification').OwnerHash()).toBe(TYPE_HASH(SCH_FIELD));
    expect(get('Horizontal Justification').Group()).toBe('Text Properties');
    const names = shown(SCH_FIELD);
    expect(names.filter((n) => n === 'Horizontal Justification').length).toBe(1);
    expect(names).toEqual(
      expect.arrayContaining(['Show Field Name', 'Allow Autoplacement', 'Text Size']),
    );
    for (const masked of ['Hyperlink', 'Thickness', 'Mirrored', 'Width', 'Height', 'Orientation'])
      expect(names).not.toContain(masked);
  });

  it('Private only on a user field; Text read-only on a generated field', () => {
    const reference = new SCH_FIELD(null, FIELD_T.REFERENCE);
    const user = new SCH_FIELD(null, FIELD_T.USER, 'Notes');
    const priv = mgr().GetProperty(TYPE_HASH(SCH_FIELD), 'Private')!;
    expect(mgr().IsAvailableFor(TYPE_HASH(SCH_FIELD), priv, reference)).toBe(false);
    expect(mgr().IsAvailableFor(TYPE_HASH(SCH_FIELD), priv, user)).toBe(true);

    const text = get('Text');
    expect(mgr().IsWriteableFor(TYPE_HASH(SCH_FIELD), text, user)).toBe(true);
    const generated = new SCH_FIELD(null, FIELD_T.USER, '${DNP}');
    expect(generated.IsGeneratedField()).toBe(true);
    expect(mgr().IsWriteableFor(TYPE_HASH(SCH_FIELD), text, generated)).toBe(false);
  });
});

describe('GetFieldValidationErrorMessage', () => {
  it("words the bad characters as upstream does, in the excludes' order", () => {
    expect(GetFieldValidationErrorMessage(FIELD_T.REFERENCE, 'R 1')).toBe(
      'The reference designator cannot contain space character(s).',
    );
    expect(GetFieldValidationErrorMessage(FIELD_T.REFERENCE, 'R\t 1')).toBe(
      'The reference designator cannot contain tab or space character(s).',
    );
    expect(GetFieldValidationErrorMessage(FIELD_T.VALUE, 'a\r\n\tb')).toBe(
      'The value field cannot contain carriage return, line feed, tab character(s).',
    );
    // The prefix is everything before the trailing digits, so only an all-digit reference has none.
    expect(GetFieldValidationErrorMessage(FIELD_T.REFERENCE, '12')).toBe(
      'References must start with a letter.',
    );
    expect(GetFieldValidationErrorMessage(FIELD_T.REFERENCE, '1R')).toBe('');
    expect(GetFieldValidationErrorMessage(FIELD_T.REFERENCE, 'R${X}')).toBe(
      'The reference designator cannot contain text variable references',
    );
    expect(GetFieldValidationErrorMessage(FIELD_T.VALUE, '')).toBe('');
  });
});
