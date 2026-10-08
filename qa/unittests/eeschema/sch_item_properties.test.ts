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
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
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
