// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIB_SYMBOL`, `SYMBOL` and `SCH_PIN` of the live model (eeschema stage E3), against
 * lib_symbol.cpp and sch_pin.cpp. The draw-item order checked here is the order the
 * library writer saves a unit's items in (`MULTIVECTOR` buckets by type, each sorted by
 * `SCH_ITEM::operator<`).
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ELECTRICAL_PINTYPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';

const pin = (sym: LIB_SYMBOL, num: string, unit = 1, x = 0): SCH_PIN =>
  SCH_PIN.makeLibPin(
    sym,
    `P${num}`,
    num,
    PIN_ORIENTATION.PIN_RIGHT,
    ELECTRICAL_PINTYPE.PT_PASSIVE,
    25400,
    12700,
    12700,
    1,
    { x, y: 0 },
    unit,
  );

describe('LIB_SYMBOL', () => {
  it('is born with the five mandatory fields, reference and value visible', () => {
    const s = new LIB_SYMBOL('R');
    const fields: SCH_FIELD[] = [];
    s.GetFields(fields);
    expect(fields.map((f) => f.GetId())).toEqual([
      FIELD_T.REFERENCE,
      FIELD_T.VALUE,
      FIELD_T.FOOTPRINT,
      FIELD_T.DATASHEET,
      FIELD_T.DESCRIPTION,
    ]);
    expect(fields.map((f) => f.IsVisible())).toEqual([true, true, false, false, false]);
    expect(s.GetLibId().GetLibItemName()).toBe('R');
    expect(s.GetPinNameOffset()).toBe(5080); // DEFAULT_PIN_NAME_OFFSET 20 mil
  });

  it('draw items iterate shapes, fields, pins; pins sorted by StrNumCmp number', () => {
    const s = new LIB_SYMBOL('U');
    s.AddDrawItem(pin(s, '10'));
    s.AddDrawItem(pin(s, '2'));
    s.AddDrawItem(new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE));
    const types = [...s.GetDrawItems()].map((i) => i.Type());
    expect(types).toEqual([
      KICAD_T.SCH_SHAPE_T,
      ...Array(5).fill(KICAD_T.SCH_FIELD_T),
      KICAD_T.SCH_PIN_T,
      KICAD_T.SCH_PIN_T,
    ]);
    expect(s.GetPins().map((p) => p.GetNumber())).toEqual(['2', '10']);
    expect(s.GetPinCount()).toBe(2);
  });

  it('units: LetterSubReference and GetUnitDrawItems grouping', () => {
    expect(LIB_SYMBOL.LetterSubReference(1, 'A')).toBe('A');
    expect(LIB_SYMBOL.LetterSubReference(26, 'A')).toBe('Z');
    expect(LIB_SYMBOL.LetterSubReference(27, 'A')).toBe('AA');
    const s = new LIB_SYMBOL('U');
    s.SetUnitCount(2, false);
    s.AddDrawItem(pin(s, '1', 1));
    s.AddDrawItem(pin(s, '2', 2));
    expect(s.GetUnitDisplayName(2, true)).toBe('Unit B');
    const units = s.GetUnitDrawItems();
    expect(units.map((u) => [u.m_unit, u.m_items.length])).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it("Flatten takes a derived symbol's non-empty fields over its parent's", () => {
    const root = new LIB_SYMBOL('Base');
    root.GetValueField().SetText('base');
    root.GetFootprintField().SetText('fp:base');
    root.AddDrawItem(pin(root, '1'));
    const derived = new LIB_SYMBOL('Derived', root);
    derived.GetValueField().SetText('derived');
    expect(derived.IsDerived()).toBe(true);
    expect(derived.GetPins().length).toBe(1); // graphical pins come from the root
    const flat = derived.Flatten();
    expect(flat.IsRoot()).toBe(true);
    expect(flat.GetName()).toBe('Derived');
    expect(flat.GetValueField().GetText()).toBe('derived');
    expect(flat.GetFootprintField().GetText()).toBe('fp:base');
  });

  it("Flatten walks a multi-level chain, an empty middle field keeping the root's", () => {
    const root = new LIB_SYMBOL('Root');
    root.GetValueField().SetText('root');
    const mid = new LIB_SYMBOL('Mid', root);
    mid.GetDatasheetField().SetText('mid.pdf');
    const leaf = new LIB_SYMBOL('Leaf', mid);
    expect(leaf.GetInheritanceDepth()).toBe(2);
    const flat = leaf.Flatten();
    expect(flat.GetValueField().GetText()).toBe('root');
    expect(flat.GetDatasheetField().GetText()).toBe('mid.pdf');
  });

  it('SetLibParent refuses a cycle', () => {
    const a = new LIB_SYMBOL('A');
    const b = new LIB_SYMBOL('B', a);
    a.SetLibParent(b);
    expect(a.IsRoot()).toBe(true);
  });

  it('GetPrefix strips digits, ? and * from the reference', () => {
    const s = new LIB_SYMBOL('R');
    s.GetReferenceField().SetText('R?');
    expect(s.GetPrefix()).toBe('R');
  });
});

describe('SCH_PIN', () => {
  it('an instance pin inherits everything from its library pin', () => {
    const s = new LIB_SYMBOL('U');
    const lib = pin(s, '3');
    lib.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
    lib.SetVisible(false);
    const inst = SCH_PIN.makeFromFile(null, '3', '', '00000000-0000-0000-0000-000000000001');
    expect(inst.GetType()).toBe(ELECTRICAL_PINTYPE.PT_UNSPECIFIED); // no lib pin yet
    inst.SetLibPin(lib);
    expect(inst.GetType()).toBe(ELECTRICAL_PINTYPE.PT_POWER_IN);
    expect(inst.IsVisible()).toBe(false);
    expect(inst.GetLength()).toBe(25400);
    expect(inst.m_Uuid).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('pin names and numbers take no spaces; SetAlt refuses unknown alternates', () => {
    const s = new LIB_SYMBOL('U');
    const p = pin(s, '1');
    p.SetName('A B');
    p.SetNumber('1 2');
    expect([p.GetName(), p.GetNumber()]).toEqual(['A_B', '1_2']);
    const inst = SCH_PIN.makeInstancePin(s, p);
    inst.SetAlt('nope');
    expect(inst.GetAlt()).toBe('');
  });

  it('GetPinRoot runs the length along the orientation', () => {
    const s = new LIB_SYMBOL('U');
    const p = pin(s, '1', 1, 100);
    p.SetOrientation(PIN_ORIENTATION.PIN_UP);
    expect(p.GetPinRoot()).toEqual({ x: 100, y: -25400 });
  });
});
