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
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
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
});
