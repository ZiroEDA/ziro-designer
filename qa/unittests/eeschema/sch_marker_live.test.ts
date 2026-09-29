// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_MARKER, ERC_ITEM and ERC_SETTINGS (eeschema stage E3b), each
 * expectation read off sch_marker.cpp / erc_item.cpp / erc_settings.cpp.
 */
import { describe, expect, it } from 'vitest';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { MARKER_T } from '@ziroeda/common/marker_base.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_UNDEFINED,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ERC_ITEM } from '@ziroeda/eeschema/erc/erc_item.js';
import { ERC_SETTINGS, ERCE_T } from '@ziroeda/eeschema/erc/erc_settings.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { SCH_MARKER } from '@ziroeda/eeschema/sch_marker.js';
import { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';

/** A schematic with one top sheet and one sub-sheet, a junction on each. */
function twoSheets() {
  const schematic = new SCHEMATIC(null);
  schematic.CreateDefaultScreens();
  const top = schematic.Hierarchy()[0]!;
  const topScreen = top.LastScreen()!;

  const subScreen = new SCH_SCREEN(schematic);
  const sub = new SCH_SHEET(topScreen);
  sub.SetScreen(subScreen);
  sub.SetFileName('sub.kicad_sch');
  topScreen.Append(sub);

  const j1 = new SCH_JUNCTION({ x: 100, y: 200 });
  const j2 = new SCH_JUNCTION({ x: 300, y: 400 });
  topScreen.Append(j1);
  subScreen.Append(j2);

  schematic.RefreshHierarchy();
  const sheets = schematic.Hierarchy();
  return { schematic, sheets, top: sheets[0]!, subPath: sheets[1]!, j1, j2, topScreen };
}

describe('ERC_ITEM', () => {
  it('Create( key ) finds the first allItemTypes entry: pin_to_pin is the warning', () => {
    expect(ERC_ITEM.Create('pin_to_pin')!.GetErrorCode()).toBe(ERCE_T.ERCE_PIN_TO_PIN_WARNING);
    expect(ERC_ITEM.Create('generic-error')!.GetErrorCode()).toBe(ERCE_T.ERCE_GENERIC_ERROR);
    expect(ERC_ITEM.Create('no_such_key')).toBeNull();
  });

  it('Create( code ) copies the template: title and key survive, edits do not leak back', () => {
    const a = ERC_ITEM.Create(ERCE_T.ERCE_LABEL_NOT_CONNECTED)!;
    expect(a.GetSettingsKey()).toBe('label_dangling');
    expect(a.GetErrorText(false)).toBe('Label not connected');
    a.SetErrorMessage('changed');
    expect(ERC_ITEM.Create(ERCE_T.ERCE_LABEL_NOT_CONNECTED)!.GetErrorMessage(false)).toBe(
      'Label not connected',
    );
  });

  it('GetItemsWithSeverities stops at heading_internal', () => {
    const keys = ERC_ITEM.GetItemsWithSeverities().map((i) => i.GetSettingsKey());
    expect(keys[0]).toBe(''); // heading_connections
    expect(keys[1]).toBe('pin_not_connected');
    expect(keys.at(-1)).toBe('missing_power_pin');
    expect(keys).not.toContain('duplicate_pins');
    expect(keys).not.toContain('generic-warning');
  });
});

describe('ERC_SETTINGS::GetSeverity', () => {
  it('the constructor defaults', () => {
    const s = new ERC_SETTINGS();
    expect(s.GetSeverity(ERCE_T.ERCE_UNSPECIFIED)).toBe(RPT_SEVERITY_UNDEFINED);
    expect(s.GetSeverity(ERCE_T.ERCE_PIN_NOT_CONNECTED)).toBe(RPT_SEVERITY_ERROR);
    expect(s.GetSeverity(ERCE_T.ERCE_ENDPOINT_OFF_GRID)).toBe(RPT_SEVERITY_WARNING);
    expect(s.GetSeverity(ERCE_T.ERCE_SINGLE_GLOBAL_LABEL)).toBe(RPT_SEVERITY_IGNORE);
    expect(s.GetSeverity(ERCE_T.ERCE_FOUR_WAY_JUNCTION)).toBe(RPT_SEVERITY_IGNORE);
    expect(s.GetSeverity(ERCE_T.ERCE_FIELD_NAME_WHITESPACE)).toBe(RPT_SEVERITY_WARNING);
    // not in the map at all: the wxCHECK answer
    expect(s.GetSeverity(ERCE_T.ERCE_ANNOTATION_ACTION)).toBe(RPT_SEVERITY_IGNORE);
  });

  it('pin-to-pin: the warning entry gates both, the code picks the level', () => {
    const s = new ERC_SETTINGS();
    expect(s.GetSeverity(ERCE_T.ERCE_PIN_TO_PIN_ERROR)).toBe(RPT_SEVERITY_ERROR);
    expect(s.GetSeverity(ERCE_T.ERCE_PIN_TO_PIN_WARNING)).toBe(RPT_SEVERITY_WARNING);
    s.SetSeverity(ERCE_T.ERCE_PIN_TO_PIN_WARNING, RPT_SEVERITY_ERROR);
    expect(s.GetSeverity(ERCE_T.ERCE_PIN_TO_PIN_WARNING)).toBe(RPT_SEVERITY_WARNING);
    s.SetSeverity(ERCE_T.ERCE_PIN_TO_PIN_WARNING, RPT_SEVERITY_IGNORE);
    expect(s.GetSeverity(ERCE_T.ERCE_PIN_TO_PIN_ERROR)).toBe(RPT_SEVERITY_IGNORE);
    expect(s.GetSeverity(ERCE_T.ERCE_PIN_TO_PIN_WARNING)).toBe(RPT_SEVERITY_IGNORE);
    // duplicate pins and the generic codes are fixed
    s.SetSeverity(ERCE_T.ERCE_DUPLICATE_PIN_ERROR, RPT_SEVERITY_IGNORE);
    expect(s.GetSeverity(ERCE_T.ERCE_DUPLICATE_PIN_ERROR)).toBe(RPT_SEVERITY_ERROR);
    expect(s.GetSeverity(ERCE_T.ERCE_GENERIC_WARNING)).toBe(RPT_SEVERITY_WARNING);
    expect(s.GetSeverity(ERCE_T.ERCE_GENERIC_ERROR)).toBe(RPT_SEVERITY_ERROR);
  });
});

describe('SCH_MARKER', () => {
  it('construction: an ERC marker at the position, parent of its item, 0.15 mm scale', () => {
    const item = ERC_ITEM.Create(ERCE_T.ERCE_PIN_NOT_CONNECTED)!;
    const m = new SCH_MARKER(item, { x: 12, y: 34 });
    expect(m.GetPosition()).toEqual({ x: 12, y: 34 });
    expect(m.GetMarkerType()).toBe(MARKER_T.MARKER_ERC);
    expect(item.GetParent()).toBe(m);
    expect(m.MarkerScale()).toBe(1500); // schIUScale.mmToIU( 0.15 )
    expect(m.IsLegacyMarker()).toBe(false);
    expect(m.GetClass()).toBe('SCH_MARKER');
    expect(m.GetItemDescription(null, true)).toBe('ERC Marker');
    m.Destroy();
    expect(item.GetParent()).toBeNull();
  });

  it('SerializeToString: key|x|y|main|aux|sheet-specific|main path|aux path', () => {
    const { schematic, top, subPath, j1, j2, topScreen } = twoSheets();
    const item = ERC_ITEM.Create(ERCE_T.ERCE_DRIVER_CONFLICT)!;
    item.SetItems(j1.m_Uuid, j2.m_Uuid);
    item.SetSheetSpecificPath(subPath);
    item.SetItemsSheetPaths(top, subPath);
    const m = new SCH_MARKER(item, { x: -5, y: 7 });
    topScreen.Append(m);
    expect(m.Schematic()).toBe(schematic);

    expect(m.SerializeToString()).toBe(
      [
        'multiple_net_names',
        -5,
        7,
        j1.m_Uuid,
        j2.m_Uuid,
        subPath.Path().AsString(),
        top.Path().AsString(),
        subPath.Path().AsString(),
      ].join('|'),
    );

    // no sheet paths: the three trailing fields are empty but present
    const bare = ERC_ITEM.Create(ERCE_T.ERCE_WIRE_DANGLING)!;
    bare.SetItems(j1.m_Uuid);
    expect(new SCH_MARKER(bare, { x: 1, y: 2 }).SerializeToString()).toBe(
      `wire_dangling|1|2|${j1.m_Uuid}|00000000-0000-0000-0000-000000000000|||`,
    );
  });

  it('SerializeToString: a symbol field names its parent symbol and its own text', () => {
    const { schematic, top } = twoSheets();
    const lib = new LIB_SYMBOL('R');
    const symbol = new SCH_SYMBOL(lib, new LIB_ID('Device', 'R'), top, 1, 0, { x: 0, y: 0 });
    top.LastScreen()!.Append(symbol);
    const value = symbol.GetField(FIELD_T.VALUE)!;
    value.SetText('10k');

    const item = ERC_ITEM.Create(ERCE_T.ERCE_UNRESOLVED_VARIABLE)!;
    item.SetItems(value.m_Uuid);
    const m = new SCH_MARKER(item, { x: 3, y: 4 });
    top.LastScreen()!.Append(m);
    expect(m.Schematic()).toBe(schematic);

    const text = m.SerializeToString();
    expect(text).toBe(`unresolved_variable|3|4|${symbol.m_Uuid}|10k|||`);

    // and back: the field is found again by its text among the symbol's children
    const back = SCH_MARKER.DeserializeFromString(schematic.Hierarchy(), text)!;
    expect(back.GetRCItem()!.GetMainItemID()).toBe(value.m_Uuid);
    expect(back.GetRCItem()!.GetAuxItemID()).toBe('00000000-0000-0000-0000-000000000000');

    // a text that is not there: no marker at all
    expect(
      SCH_MARKER.DeserializeFromString(
        schematic.Hierarchy(),
        `unresolved_variable|3|4|${symbol.m_Uuid}|nope|||`,
      ),
    ).toBeNull();
  });

  it('DeserializeFromString round-trips sheet paths; 5 fields is a legacy marker', () => {
    const { sheets, top, subPath, j1, j2 } = twoSheets();
    const item = ERC_ITEM.Create(ERCE_T.ERCE_DRIVER_CONFLICT)!;
    item.SetItems(j1.m_Uuid, j2.m_Uuid);
    item.SetSheetSpecificPath(subPath);
    item.SetItemsSheetPaths(top, subPath);
    const text = new SCH_MARKER(item, { x: 10, y: 20 }).SerializeToString();

    const m = SCH_MARKER.DeserializeFromString(sheets, text)!;
    const erc = m.GetRCItem() as ERC_ITEM;
    expect(m.GetPosition()).toEqual({ x: 10, y: 20 });
    expect(m.IsLegacyMarker()).toBe(false);
    expect(erc.GetErrorCode()).toBe(ERCE_T.ERCE_DRIVER_CONFLICT);
    expect(erc.GetMainItemID()).toBe(j1.m_Uuid);
    expect(erc.GetAuxItemID()).toBe(j2.m_Uuid);
    expect(erc.IsSheetSpecific()).toBe(true);
    expect(erc.GetSpecificSheetPath().equals(subPath)).toBe(true);
    expect(erc.GetMainItemSheetPath().equals(top)).toBe(true);
    expect(erc.GetAuxItemSheetPath().equals(subPath)).toBe(true);
    expect(m.SerializeToString()).toBe(text);

    const legacy = SCH_MARKER.DeserializeFromString(
      sheets,
      `wire_dangling|1|2|${j1.m_Uuid}|${j2.m_Uuid}`,
    )!;
    expect(legacy.IsLegacyMarker()).toBe(true);
    expect((legacy.GetRCItem() as ERC_ITEM).MainItemHasSheetPath()).toBe(false);

    expect(SCH_MARKER.DeserializeFromString(sheets, 'bogus|1|2|a|b')).toBeNull();
  });

  it('ViewGetLayers / GetColorLayer / GetSeverity follow the schematic ERC settings', () => {
    const { schematic, top, subPath, topScreen } = twoSheets();
    const item = ERC_ITEM.Create(ERCE_T.ERCE_PIN_NOT_CONNECTED)!;
    const m = new SCH_MARKER(item, { x: 0, y: 0 });
    topScreen.Append(m);
    schematic.SetCurrentSheet(top);

    expect(m.GetSeverity()).toBe(RPT_SEVERITY_ERROR);
    expect(m.ViewGetLayers()).toEqual([
      SCH_LAYER_ID.LAYER_ERC_ERR,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ]);
    expect(m.GetColorLayer()).toBe(SCH_LAYER_ID.LAYER_ERC_ERR);

    schematic.ErcSettings().SetSeverity(ERCE_T.ERCE_PIN_NOT_CONNECTED, RPT_SEVERITY_WARNING);
    expect(m.GetSeverity()).toBe(RPT_SEVERITY_WARNING);
    expect(m.ViewGetLayers()[0]).toBe(SCH_LAYER_ID.LAYER_ERC_WARN);
    expect(m.GetColorLayer()).toBe(SCH_LAYER_ID.LAYER_ERC_WARN);

    schematic.ErcSettings().SetSeverity(ERCE_T.ERCE_PIN_NOT_CONNECTED, RPT_SEVERITY_IGNORE);
    expect(m.ViewGetLayers()).toEqual([]);

    // excluded wins over any severity
    m.SetExcluded(true, 'why');
    expect(m.GetSeverity()).toBe(RPT_SEVERITY_EXCLUSION);
    expect(m.ViewGetLayers()).toEqual([
      SCH_LAYER_ID.LAYER_ERC_EXCLUSION,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ]);
    expect(m.GetColorLayer()).toBe(SCH_LAYER_ID.LAYER_ERC_EXCLUSION);

    // a sheet-specific marker is hidden on any other sheet
    item.SetSheetSpecificPath(subPath);
    expect(m.ViewGetLayers()).toEqual([]);
    schematic.SetCurrentSheet(subPath);
    expect(m.ViewGetLayers()[0]).toBe(SCH_LAYER_ID.LAYER_ERC_EXCLUSION);
  });

  it('geometry: Move moves, mirror/rotate do not; hit test is the arrow polygon', () => {
    const m = new SCH_MARKER(ERC_ITEM.Create(ERCE_T.ERCE_WIRE_DANGLING)!, { x: 0, y: 0 });
    m.Move({ x: 10, y: -10 });
    expect(m.GetPosition()).toEqual({ x: 10, y: -10 });
    m.MirrorHorizontally(1000);
    m.MirrorVertically(1000);
    m.Rotate({ x: 500, y: 500 }, true);
    expect(m.GetPosition()).toEqual({ x: 10, y: -10 });

    // MarkerShapeCorners span 0..13 units: the box is 13 * 1500 IU from the position
    const box = m.GetBoundingBox();
    expect([box.GetX(), box.GetY(), box.GetWidth(), box.GetHeight()]).toEqual([
      10,
      -10,
      13 * 1500,
      13 * 1500,
    ]);
    expect(m.HitTest({ x: 10 + 5 * 1500, y: -10 + 5 * 1500 })).toBe(true);
    expect(m.HitTest({ x: 10 + 20 * 1500, y: -10 })).toBe(false);
  });

  it('Clone shares the ERC item and keeps the legacy flag; never equal, zero similarity', () => {
    const item = ERC_ITEM.Create(ERCE_T.ERCE_WIRE_DANGLING)!;
    const m = new SCH_MARKER(item, { x: 1, y: 1 });
    m.SetIsLegacyMarker();
    m.SetExcluded(true, 'c');
    const c = m.Clone();
    expect(c.GetRCItem()).toBe(item);
    expect(c.IsLegacyMarker()).toBe(true);
    expect(c.IsExcluded()).toBe(true);
    expect(c.GetComment()).toBe('c');
    expect(c.m_Uuid).toBe(m.m_Uuid);
    expect(m.equals(c)).toBe(false);
    expect(m.Similarity(c)).toBe(0);
  });
});
