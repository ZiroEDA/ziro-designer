// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_SHEET, SCH_SHEET_PIN, SCH_SHEET_PATH, SCH_SYMBOL, SCH_SCREEN and SCHEMATIC
 * (eeschema stage E3). The cases marked "qa:" are KiCad's own (qa/tests/eeschema/
 * test_sch_sheet.cpp, test_sch_sheet_path.cpp); the rest are derived from the C++.
 */
import { describe, expect, it } from 'vitest';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { ELECTRICAL_PINTYPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { TRANSFORM } from '@ziroeda/kimath/src/transform.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { DANGLING_END_T } from '@ziroeda/eeschema/sch_item.js';
import { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { SCH_SCREEN, SCH_SCREENS } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SHEET_PIN } from '@ziroeda/eeschema/sch_sheet_pin.js';
import { SCH_SHEET_PATH } from '@ziroeda/eeschema/sch_sheet_path.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { SYMBOL_ORIENTATION_T as O } from '@ziroeda/eeschema/symbol.js';

describe('SCH_SHEET (qa: test_sch_sheet.cpp)', () => {
  it('Default', () => {
    const sheet = new SCH_SHEET();
    expect(sheet.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(sheet.GetParent()).toBeNull();
    expect(sheet.CountSheets()).toBe(1);
    expect(sheet.GetScreenCount()).toBe(0);
    expect(sheet.SymbolCount()).toBe(0);
  });

  it('SchematicParent: a top-level sheet sits under the virtual root', () => {
    const schematic = new SCHEMATIC(null);
    const sheet = new SCH_SHEET();
    sheet.SetParent(schematic);

    expect(sheet.IsVirtualRootSheet()).toBe(false);
    expect(sheet.IsTopLevelSheet()).toBe(false);

    sheet.SetScreen(new SCH_SCREEN(schematic));
    schematic.AddTopLevelSheet(sheet);

    expect(sheet.IsVirtualRootSheet()).toBe(false);
    expect(sheet.IsTopLevelSheet()).toBe(true);
    expect(schematic.Root().IsVirtualRootSheet()).toBe(true);
    expect(schematic.Root().m_Uuid).toBe(niluuid);

    expect(schematic.RemoveTopLevelSheet(sheet)).toBe(true);
    expect(sheet.IsTopLevelSheet()).toBe(false);
  });

  it('AddPins', () => {
    const sheet = new SCH_SHEET();
    const pinPos = { x: 42, y: 13 };
    const pin = new SCH_SHEET_PIN(sheet, pinPos, 'pinname');

    sheet.AddPin(pin);

    expect(sheet.HasPins()).toBe(true);
    expect(sheet.HasPin('pinname')).toBe(true);
    expect(sheet.HasPin('PINname')).toBe(false);
    expect(sheet.GetPin(pinPos)).toBe(pin);
    expect(sheet.GetPins()[0]).toBe(pin);

    sheet.RemovePin(pin);

    expect(sheet.HasPins()).toBe(false);
    expect(sheet.HasPin('pinname')).toBe(false);
    expect(sheet.GetPin(pinPos)).toBeNull();
  });

  it('PinRenumbering: numbers from 2, no duplicates', () => {
    const sheet = new SCH_SHEET();

    for (let i = 0; i < 5; ++i) {
      const pin = new SCH_SHEET_PIN(sheet, { x: i, y: i }, 'name');
      pin.SetNumber(2);
      sheet.AddPin(pin);
    }

    expect(sheet.GetPins().map((p) => p.GetNumber())).toEqual([2, 3, 4, 5, 6]);
  });

  it('EndconnectionPoints', () => {
    const sheet = new SCH_SHEET();
    const defs = [
      { name: '1name', pos: { x: 0, y: 13 } },
      { name: '2name', pos: { x: 0, y: 130 } },
    ];

    for (const d of defs) sheet.AddPin(new SCH_SHEET_PIN(sheet, d.pos, d.name));

    const dangling: import('@ziroeda/eeschema/sch_item.js').DANGLING_END_ITEM[] = [];
    sheet.GetEndPoints(dangling);

    expect(dangling.map((d) => [d.GetType(), d.GetItem(), d.GetPosition()])).toEqual(
      sheet.GetPins().map((p) => [DANGLING_END_T.SHEET_LABEL_END, p, p.GetPosition()]),
    );
    expect(sheet.GetConnectionPoints()).toEqual(defs.map((d) => d.pos));
  });

  it('a pin snaps to the nearest edge (ConstrainOnEdge) and the left edge is the default', () => {
    const sheet = new SCH_SHEET(null, { x: 1000, y: 1000 }, { x: 5000, y: 3000 });
    const pin = new SCH_SHEET_PIN(sheet, { x: 3000, y: 2000 }, 'P');

    expect(pin.GetSide()).toBe(0); // LEFT: SetSide in the constructor
    expect(pin.GetTextPos()).toEqual({ x: 1000, y: 2000 });

    // Nearest segment of (TL→TR, TR→BR, BR→BL, BL→TL) to (5900, 2500) is the right edge
    pin.SetPosition({ x: 5900, y: 2500 });
    expect(pin.GetSide()).toBe(1);
    expect(pin.GetTextPos()).toEqual({ x: 6000, y: 2500 });

    // Clamped to the edge's extent
    pin.ConstrainOnEdge({ x: 5900, y: 9000 }, false);
    expect(pin.GetTextPos()).toEqual({ x: 6000, y: 4000 });
  });

  it('ComparePageNum: integers numerically, before strings; strings naturally', () => {
    expect(SCH_SHEET.ComparePageNum('2', '10')).toBe(-1);
    expect(SCH_SHEET.ComparePageNum('10', '2')).toBe(1);
    expect(SCH_SHEET.ComparePageNum('9', 'A')).toBe(-1);
    expect(SCH_SHEET.ComparePageNum('A', '9')).toBe(1);
    expect(SCH_SHEET.ComparePageNum('A2', 'A10')).toBe(-1);
    expect(SCH_SHEET.ComparePageNum('x', 'x')).toBe(0);
  });
});

describe('SCH_SHEET_PATH (qa: test_sch_sheet_path.cpp)', () => {
  const fixture = () => {
    const schematic = new SCHEMATIC(null);
    const sheets = [0, 1, 2, 3].map((i) => {
      const s = new SCH_SHEET(null, { x: i, y: i });
      s.GetField(FIELD_T.SHEET_NAME)!.SetText(`Sheet${i}`);
      s.SetParent(schematic);
      return s;
    });
    const linear = new SCH_SHEET_PATH();
    linear.push_back(sheets[0]!);
    linear.push_back(sheets[1]!);
    linear.push_back(sheets[2]!);
    return { schematic, sheets, linear };
  };

  it('Empty', () => {
    const empty = new SCH_SHEET_PATH();
    expect(empty.size()).toBe(0);
    expect(empty.Last()).toBeNull();
    expect(empty.LastScreen()).toBeNull();
    expect(empty.PathAsString()).toBe('/');
    expect(empty.PathHumanReadable()).toBe('/');
  });

  it('NonEmpty', () => {
    const { sheets, linear } = fixture();
    expect(linear.size()).toBe(3);
    expect(linear.at(0)).toBe(sheets[0]);
    expect(linear.at(2)).toBe(sheets[2]);
    expect(linear.Last()).toBe(sheets[2]);
    expect(linear.LastScreen()).toBeNull();
    expect(linear.PathAsString()).toMatch(/^\/([0-9a-f-]{36}\/){2}$/);
    expect(linear.PathHumanReadable()).toBe('/Sheet1/Sheet2/');
  });

  it('Compare', () => {
    const { linear } = fixture();
    const empty = new SCH_SHEET_PATH();
    expect(empty.equals(new SCH_SHEET_PATH())).toBe(true);
    expect(empty.equals(linear)).toBe(false);
  });

  it('PathHumanReadableWithSlashes', () => {
    const schematic = new SCHEMATIC(null);
    const sheets = ['Root', 'Power/Supply', 'SubSheet'].map((name, i) => {
      const s = new SCH_SHEET(null, { x: i, y: i });
      s.SetParent(schematic);
      s.GetField(FIELD_T.SHEET_NAME)!.SetText(name);
      return s;
    });
    const path = new SCH_SHEET_PATH();
    for (const s of sheets) path.push_back(s);

    expect(path.PathHumanReadable(true, false, false)).toBe('/Power/Supply/SubSheet/');
    expect(path.PathHumanReadable(true, false, true)).toBe('/Power{slash}Supply/SubSheet/');
    expect(path.PathHumanReadable(true, true, true)).toBe('/Power{slash}Supply/SubSheet');
  });
});

describe('SCH_SYMBOL', () => {
  // A two-unit library symbol: pin 1 on unit 1, pin 2 on unit 2.
  const makeLib = (): LIB_SYMBOL => {
    const lib = new LIB_SYMBOL('R');
    lib.SetUnitCount(2, false);
    lib.GetReferenceField().SetText('R');
    lib.GetValueField().SetText('10k');

    for (const [num, unit, y] of [
      ['1', 1, 100],
      ['2', 2, -100],
    ] as const) {
      lib.AddDrawItem(
        SCH_PIN.makeLibPin(
          lib,
          '~',
          num,
          PIN_ORIENTATION.PIN_DOWN,
          ELECTRICAL_PINTYPE.PT_PASSIVE,
          100,
          50,
          50,
          0,
          { x: 0, y },
          unit,
        ),
      );
    }

    return lib;
  };

  const placed = () => {
    const schematic = new SCHEMATIC(null);
    schematic.CreateDefaultScreens();
    const sheetPath = schematic.Hierarchy()[0]!;
    const symbol = new SCH_SYMBOL(makeLib(), new LIB_ID('Device', 'R'), sheetPath, 1, 0, {
      x: 1000,
      y: 2000,
    });
    sheetPath.LastScreen()!.Append(symbol);
    return { schematic, sheetPath, symbol };
  };

  it('Init: five mandatory fields, prefix U, unit 1', () => {
    const s = new SCH_SYMBOL();
    expect(s.GetFields().map((f) => f.GetId())).toEqual([
      FIELD_T.REFERENCE,
      FIELD_T.VALUE,
      FIELD_T.FOOTPRINT,
      FIELD_T.DATASHEET,
      FIELD_T.DESCRIPTION,
    ]);
    expect(s.GetPrefix()).toBe('U');
    expect(s.GetUnit()).toBe(1);
    expect(s.IsMissingLibSymbol()).toBe(true);
  });

  it('Orientation (qa: test_sch_symbol.cpp): the transforms of 90/180/270', () => {
    const s = new SCH_SYMBOL();
    s.SetOrientation(O.SYM_ORIENT_90);
    expect(s.GetTransform().equals(new TRANSFORM(0, 1, -1, 0))).toBe(true);
    s.SetTransform(new TRANSFORM());
    s.SetOrientation(O.SYM_ORIENT_180);
    expect(s.GetTransform().equals(new TRANSFORM(-1, 0, 0, -1))).toBe(true);
    s.SetTransform(new TRANSFORM());
    s.SetOrientation(O.SYM_ORIENT_270);
    expect(s.GetTransform().equals(new TRANSFORM(0, -1, 1, 0))).toBe(true);
  });

  it('GetOrientation finds the first matching entry: MIRROR_Y + 180 reads back as MIRROR_X', () => {
    const s = new SCH_SYMBOL();
    s.SetOrientation(O.SYM_ORIENT_180 + O.SYM_MIRROR_Y);
    expect(s.GetOrientation()).toBe(O.SYM_MIRROR_X + O.SYM_ORIENT_0);

    s.SetOrientation(O.SYM_ORIENT_90 + O.SYM_MIRROR_X);
    expect(s.GetOrientation()).toBe(O.SYM_MIRROR_X + O.SYM_ORIENT_90);
    expect(s.GetMirrorX()).toBe(true);
    expect(s.GetMirrorY()).toBe(false);
  });

  it('the constructor sets the reference unannotated and makes a pin per library pin', () => {
    const { sheetPath, symbol } = placed();

    expect(symbol.GetRef(sheetPath)).toBe('R?');
    expect(symbol.GetPrefix()).toBe('R');
    expect(symbol.GetValue(false, sheetPath, false)).toBe('10k');
    expect(symbol.GetRawPins().map((p) => p.GetNumber())).toEqual(['1', '2']);
    // GetPins( sheet ) keeps the pins of the instance's unit (and unit-0 pins)
    expect(symbol.GetPins(sheetPath).map((p) => p.GetNumber())).toEqual(['1']);
    expect(symbol.GetField(FIELD_T.VALUE)!.GetTextPos()).toEqual({ x: 1000, y: 2000 });
  });

  it('SetRef, GetRef with the unit, SubReference, ClearAnnotation', () => {
    const { sheetPath, symbol } = placed();

    symbol.SetRef(sheetPath, 'R7');
    symbol.SetUnitSelection(sheetPath, 2);

    expect(symbol.GetRef(sheetPath)).toBe('R7');
    expect(symbol.GetRef(sheetPath, true)).toBe('R7B');
    expect(symbol.IsAnnotated(sheetPath)).toBe(true);
    expect(symbol.IsInNetlist()).toBe(true);

    symbol.ClearAnnotation(sheetPath, false);
    expect(symbol.GetRef(sheetPath)).toBe('R?');
    expect(symbol.IsAnnotated(sheetPath)).toBe(false);

    symbol.SetRef(sheetPath, '#PWR01');
    expect(symbol.IsInNetlist()).toBe(false);
    expect(symbol.GetPrefix()).toBe('#PWR');
  });

  it('pin-side connection points follow the transform and the unit', () => {
    const { symbol } = placed();

    // Unit 1 pin at (0, 100) in library coordinates; identity transform
    expect(symbol.GetConnectionPoints()).toEqual([{ x: 1000, y: 2100 }]);

    symbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
    // (0,100) through (0, 1, -1, 0): x = 0*0 + 1*100 = 100, y = -1*0 + 0*100 = 0
    expect(symbol.GetConnectionPoints()).toEqual([{ x: 1100, y: 2000 }]);
    expect(symbol.IsConnected({ x: 1100, y: 2000 })).toBe(true);
    expect(symbol.IsConnected({ x: 1000, y: 2100 })).toBe(false);
  });

  it('variant attributes live on the instance; the base value is untouched', () => {
    const { sheetPath, symbol } = placed();

    symbol.SetDNP(true, sheetPath, 'V1');
    symbol.SetExcludedFromBOM(true, sheetPath, 'V1');
    symbol.SetValueFieldText('22k', sheetPath, 'V1');

    expect(symbol.GetDNP(sheetPath, 'V1')).toBe(true);
    expect(symbol.GetDNP()).toBe(false);
    expect(symbol.GetExcludedFromBOM(sheetPath, 'V1')).toBe(true);
    expect(symbol.GetExcludedFromBOM()).toBe(false);
    expect(symbol.GetValue(false, sheetPath, false, 'V1')).toBe('22k');
    expect(symbol.GetValue(false, sheetPath, false)).toBe('10k');

    symbol.RenameVariant(sheetPath, 'V1', 'V2');
    expect(symbol.GetVariant(sheetPath, 'V1')).toBeNull();
    expect(symbol.GetVariant(sheetPath, 'V2')?.m_Name).toBe('V2');
  });

  it('copyOf keeps the uuid and gives the copy its own fields and pins', () => {
    const { symbol } = placed();
    const copy = SCH_SYMBOL.copyOf(symbol);

    expect(copy.m_Uuid).toBe(symbol.m_Uuid);
    expect(copy.GetFields()[0]).not.toBe(symbol.GetFields()[0]);
    expect(copy.GetFields()[0]!.GetParent()).toBe(copy);
    expect(copy.GetRawPins()[0]!.GetParent()).toBe(copy);
    expect(copy.GetLibSymbolRef()).not.toBe(symbol.GetLibSymbolRef());
  });
});

describe('SCH_SCREEN and SCHEMATIC', () => {
  it('CreateDefaultScreens: a virtual root over one top-level sheet on page 1', () => {
    const schematic = new SCHEMATIC(null);
    schematic.CreateDefaultScreens();

    const top = schematic.GetTopLevelSheets();
    expect(top).toHaveLength(1);
    expect(top[0]!.GetScreen()!.GetFileName()).toBe('untitled.kicad_sch');
    // The top-level sheet takes its screen's uuid
    expect(top[0]!.m_Uuid).toBe(top[0]!.GetScreen()!.GetUuid());
    expect(schematic.RootScreen()).toBe(top[0]!.GetScreen());
    expect(schematic.Hierarchy()).toHaveLength(1);
    expect(schematic.Hierarchy()[0]!.GetPageNumber()).toBe('1');
    expect(schematic.CurrentSheet().Last()).toBe(top[0]);
  });

  it('Append caches the library symbol under its name, and renames a different one to name_1', () => {
    const schematic = new SCHEMATIC(null);
    schematic.CreateDefaultScreens();
    const screen = schematic.RootScreen()!;
    const path = schematic.Hierarchy()[0]!;

    const makeLib = (value: string) => {
      const lib = new LIB_SYMBOL('R');
      lib.GetValueField().SetText(value);
      return lib;
    };

    const a = new SCH_SYMBOL(makeLib('A'), new LIB_ID('Device', 'R'), path, 1);
    screen.Append(a);
    expect([...screen.GetLibSymbols().keys()]).toEqual(['Device:R']);
    expect(a.GetSchSymbolLibraryName()).toBe('Device:R');

    const b = new SCH_SYMBOL(makeLib('B'), new LIB_ID('Device', 'R'), path, 1);
    screen.Append(b);
    expect([...screen.GetLibSymbols().keys()]).toEqual(['Device:R', 'R_1']);
    expect(b.GetSchSymbolLibraryName()).toBe('R_1');

    // A third variant counts on to the next free suffix; a match reuses its name
    const c = new SCH_SYMBOL(makeLib('C'), new LIB_ID('Device', 'R'), path, 1);
    screen.Append(c);
    expect(c.GetSchSymbolLibraryName()).toBe('R_2');
    const b2 = new SCH_SYMBOL(makeLib('B'), new LIB_ID('Device', 'R'), path, 1);
    screen.Append(b2);
    expect(b2.GetSchSymbolLibraryName()).toBe('R_1');
    screen.Remove(c);
    screen.Remove(b2);

    // Removing the last user of a cached symbol drops it
    screen.Remove(b);
    expect([...screen.GetLibSymbols().keys()]).toEqual(['Device:R']);
  });

  it('SCH_SCREENS walks each screen once, and a shared screen makes a complex hierarchy', () => {
    const schematic = new SCHEMATIC(null);
    schematic.CreateDefaultScreens();
    const rootScreen = schematic.RootScreen()!;

    const shared = new SCH_SCREEN(schematic);
    const s1 = new SCH_SHEET(rootScreen);
    const s2 = new SCH_SHEET(rootScreen);
    s1.SetScreen(shared);
    s2.SetScreen(shared);
    // BuildSheetList skips a child with its parent's file name (the recursion guard)
    s1.SetFileName('shared.kicad_sch');
    s2.SetFileName('shared.kicad_sch');
    rootScreen.Append(s1);
    rootScreen.Append(s2);

    expect(shared.GetRefCount()).toBe(2);
    expect(new SCH_SCREENS(schematic.Root()).GetCount()).toBe(3); // virtual root, top, shared
    expect(schematic.IsComplexHierarchy()).toBe(true);

    schematic.RefreshHierarchy();
    expect(schematic.Hierarchy()).toHaveLength(3);
    expect(rootScreen.Items().OfType(KICAD_T.SCH_SHEET_T)).toEqual([s1, s2]);
  });
});
