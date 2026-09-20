// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_MARKER over BOARD_ITEM + MARKER_BASE, with DRC_ITEM/RC_ITEM
 * (`pcbnew/pcb_marker.cpp`, `common/marker_base.cpp`, `drc/drc_item.cpp`).
 * Every expected number and string below was read from KiCad's own `pcbnew`
 * python module through `PCB_MARKER.DeserializeFromString` on a default
 * BOARD, not derived from our port.
 */
import { describe, expect, it } from 'vitest';
import { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { MARKER_T } from '@ziroeda/common/src/marker_base.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/src/reporter.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { DRC_ITEM, PCB_DRC_CODE } from '@ziroeda/pcbnew/drc/drc_item.js';
import { PCB_MARKER } from '@ziroeda/pcbnew/pcb_marker.js';

const A = '11111111-2222-3333-4444-555555555555';
const B = '66666666-7777-8888-9999-aaaaaaaaaaaa';

describe('DRC_ITEM', () => {
  it('Create by code and by settings key give the static table entry; unknown keys give null', () => {
    const byCode = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
    expect(byCode.GetErrorCode()).toBe(PCB_DRC_CODE.DRCE_CLEARANCE);
    expect(byCode.GetSettingsKey()).toBe('clearance');
    expect(byCode.GetErrorText(true)).toBe('Clearance violation');
    expect(byCode.GetErrorMessage(true)).toBe('Clearance violation');
    expect(byCode.GetViolatingRuleDesc(false)).toBe('Local override');
    expect(DRC_ITEM.Create('too_many_vias')!.GetErrorCode()).toBe(
      PCB_DRC_CODE.DRCE_VIA_COUNT_OUT_OF_RANGE,
    );
    expect(DRC_ITEM.Create('bogus_key')).toBe(null);
    expect(DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)).not.toBe(byCode); // a fresh copy each time
  });

  it('GetItemsWithSeverities stops at heading_internal', () => {
    const items = DRC_ITEM.GetItemsWithSeverities();
    expect(items[0]!.GetErrorText(true)).toBe('Electrical');
    expect(items.map((i) => i.GetSettingsKey())).not.toContain('padstack_invalid');
    expect(items.map((i) => i.GetSettingsKey())).toContain('missing_tuning_profile');
    expect(items.filter((i) => i.GetSettingsKey() === '')).toHaveLength(6); // the six headings
  });

  it('SetItems: the EDA_ITEM form keeps only the present ones, the KIID form all four; the diff-pair aux ids are hidden', () => {
    const item = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_CLEARANCE)!;
    item.SetItems(A, B);
    expect(item.GetIDs()).toHaveLength(4);
    expect(item.GetAuxItem2ID()).toBe('00000000-0000-0000-0000-000000000000');
    const dp = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG)!;
    dp.SetItems(A, B, A, B);
    expect(dp.GetAuxItem2ID()).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('PCB_MARKER', () => {
  it('DeserializeFromString / SerializeToString round trip; the default marker is a DRC marker on F.Cu', () => {
    const b = new BOARD();
    const m = PCB_MARKER.DeserializeFromString(`clearance|1000000|2000000|${A}|${B}`)!;
    b.Add(m);
    expect(m.GetMarkerType()).toBe(MARKER_T.MARKER_DRC);
    expect(m.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(m.MarkerScale()).toBe(162500);
    expect(m.GetRCItem()!.GetMainItemID()).toBe(A);
    expect(m.SerializeToString()).toBe(`clearance|1000000|2000000|${A}|${B}`);
    expect(m.GetItemDescription(null, true)).toBe('Marker (Clearance violation)');
    expect(m.GetRCItem()!.GetParent()).toBe(m);
    expect(PCB_MARKER.DeserializeFromString('bogus_key|1|2|x|y')).toBe(null);
  });

  it('GetBoundingBox is the 13x13 arrow shape scaled; HitTest is the box then the polygon', () => {
    const b = new BOARD();
    const m = PCB_MARKER.DeserializeFromString(`clearance|1000000|2000000|${A}|${B}`)!;
    b.Add(m);
    const bb = m.GetBoundingBox();
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      1000000, 2000000, 2112500, 2112500,
    ]);
    expect(m.HitTest({ x: 1100000, y: 2100000 }, 0)).toBe(true);
    expect(m.HitTest({ x: 1000000 + 8 * 162500, y: 2000000 + 8 * 162500 }, 0)).toBe(true);
    expect(m.HitTest({ x: 3000000, y: 4000000 }, 0)).toBe(false);
    expect(m.HitTest({ x: 1000000 + 2 * 162500, y: 2000000 + 6 * 162500 }, 0)).toBe(false); // inside the box, between the arrow's wings

    const poly = new SHAPE_LINE_CHAIN();
    m.ShapeToPolygon(poly);
    // 9 corners appended, the closing (0,0) merged into the first by SetClosed
    // (SHAPE_LINE_CHAIN::mergeFirstLastPointIfNeeded); the python binding cannot take the
    // chain reference, so this one is read from the C++, not the oracle.
    expect(poly.PointCount()).toBe(8);
    expect(poly.IsClosed()).toBe(true);
    expect([poly.CPoint(1).x, poly.CPoint(1).y]).toEqual([8 * 162500, 1 * 162500]);
  });

  it('severity from the board defaults, exclusion, and the generic codes; the view layers follow', () => {
    const b = new BOARD();
    const m = PCB_MARKER.DeserializeFromString(`clearance|1000000|2000000|${A}|${B}`)!;
    b.Add(m);
    expect(m.GetSeverity()).toBe(RPT_SEVERITY_ERROR);
    expect(m.GetColorLayer()).toBe(GAL_LAYER_ID.LAYER_DRC_ERROR);
    expect(m.ViewGetLayers()).toEqual([
      GAL_LAYER_ID.LAYER_DRC_ERROR,
      GAL_LAYER_ID.LAYER_MARKER_SHADOWS,
      GAL_LAYER_ID.LAYER_DRC_SHAPES,
    ]);

    m.SetExcluded(true, 'why');
    expect(m.GetSeverity()).toBe(RPT_SEVERITY_EXCLUSION);
    expect(m.IsTreatedAsExcluded()).toBe(true);
    expect(m.ViewGetLayers()[0]).toBe(GAL_LAYER_ID.LAYER_DRC_EXCLUSION);

    const w = PCB_MARKER.DeserializeFromString(`missing_footprint|0|0|${A}|${B}`)!;
    b.Add(w);
    expect(w.GetMarkerType()).toBe(MARKER_T.MARKER_PARITY);
    expect(w.GetSeverity()).toBe(RPT_SEVERITY_WARNING);
    expect(w.GetColorLayer()).toBe(GAL_LAYER_ID.LAYER_DRC_WARNING);

    const gw = PCB_MARKER.DeserializeFromString(`generic_warning|1|2|${A}|F.Cu`)!;
    b.Add(gw);
    expect(gw.GetColorLayer()).toBe(GAL_LAYER_ID.LAYER_DRC_WARNING);
  });

  it('a ratsnest marker is never hit and draws on no layer; the layered serializations', () => {
    const b = new BOARD();
    const r = PCB_MARKER.DeserializeFromString(`unconnected_items|5|6|F.Cu|4|${A}|${B}`)!;
    b.Add(r);
    expect(r.GetMarkerType()).toBe(MARKER_T.MARKER_RATSNEST);
    expect(r.HitTest({ x: 5, y: 6 }, 0)).toBe(false);
    expect(r.ViewGetLayers()).toEqual([]);
    expect(r.SerializeToString()).toBe(`unconnected_items|5|6|F.Cu|4|${A}|${B}`);

    const sliver = PCB_MARKER.DeserializeFromString(`copper_sliver|1|2|${A}|B.Cu`)!;
    b.Add(sliver);
    expect(sliver.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(sliver.SerializeToString()).toBe(`copper_sliver|1|2|${A}|B.Cu`);

    const st = PCB_MARKER.DeserializeFromString(`starved_thermal|1|2|${A}|${B}|In1.Cu`)!;
    expect(st.GetLayer()).toBe(PCB_LAYER_ID.In1_Cu);
    expect(st.SerializeToString()).toBe(`starved_thermal|1|2|${A}|${B}|In1.Cu`);
  });
});
