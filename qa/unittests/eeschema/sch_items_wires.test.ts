// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The connectable schematic item classes of the live model (eeschema stage E3):
 * `SCH_LINE`, `SCH_JUNCTION`, `SCH_NO_CONNECT`, `SCH_BUS_WIRE_ENTRY` /
 * `SCH_BUS_BUS_ENTRY`, and `SCH_FIELD`. Each expectation is the C++ arithmetic on
 * the stated inputs (sch_line.cpp, sch_junction.cpp, sch_no_connect.cpp,
 * sch_bus_entry.cpp, sch_field.cpp), with no SCHEMATIC parent, so every default is
 * the `default_values.h` one: wire 6 mil = 1524 IU, junction 36 mil = 9144 IU,
 * no-connect 48 mil = 12192 IU, bus entry 100 mil = 25400 IU.
 */
import { describe, expect, it } from 'vitest';
import { ENDPOINT, STARTPOINT } from '@ziroeda/common/eda_item_flags.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { SCH_BUS_BUS_ENTRY, SCH_BUS_WIRE_ENTRY } from '@ziroeda/eeschema/sch_bus_entry.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { DANGLING_END_ITEM, DANGLING_END_ITEM_HELPER, SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_NO_CONNECT } from '@ziroeda/eeschema/sch_no_connect.js';

const box = (b: BOX2I): number[] => [b.GetX(), b.GetY(), b.GetWidth(), b.GetHeight()];

const wire = (x1: number, y1: number, x2: number, y2: number): SCH_LINE => {
  const l = new SCH_LINE({ x: x1, y: y1 }, SCH_LAYER_ID.LAYER_WIRE);
  l.SetEndPoint({ x: x2, y: y2 });
  return l;
};

describe('SCH_LINE', () => {
  it('the ctor picks the layer and the dangling state from it', () => {
    expect(new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE).IsDangling()).toBe(false);
    expect(new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_NOTES).IsDangling()).toBe(true);
    // any other layer is a graphic line
    expect(new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_DEVICE).GetLayer()).toBe(
      SCH_LAYER_ID.LAYER_NOTES,
    );
  });

  it('GetBoundingBox: half the pen width either side, plus one', () => {
    // pen = m_lastResolvedWidth = 1524, width/2 = 762
    expect(box(wire(0, 0, 10000, 0).GetBoundingBox())).toEqual([-762, -762, 10000 + 1525, 1525]);
    // a bus resolves 12 mil = 3048 -> 1524 either side
    const bus = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_BUS);
    bus.SetEndPoint({ x: 0, y: 500 });
    expect(box(bus.GetBoundingBox())).toEqual([-1524, -1524, 3049, 500 + 3049]);
  });

  it('MergeOverlap joins collinear overlapping wires and refuses parallel ones', () => {
    const a = wire(0, 0, 100, 0);
    const b = wire(50, 0, 200, 0);
    const merged = a.MergeOverlap(null, b, false)!;
    expect(merged.GetStartPoint()).toEqual({ x: 0, y: 0 });
    expect(merged.GetEndPoint()).toEqual({ x: 200, y: 0 });
    expect(merged.IsConnectivityDirty()).toBe(true);

    // drawn right-to-left: each line is normalised to start at its lesser end first
    const r = wire(100, 0, 0, 0).MergeOverlap(null, wire(200, 0, 50, 0), false)!;
    expect([r.GetStartPoint(), r.GetEndPoint()]).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);

    expect(a.MergeOverlap(null, wire(0, 10, 100, 10), false)).toBeNull();
    // one ending before the other begins
    expect(a.MergeOverlap(null, wire(150, 0, 200, 0), false)).toBeNull();
    // a diagonal overlap goes through the long-long slope test
    const d = wire(0, 0, 100, 100).MergeOverlap(null, wire(50, 50, 300, 300), false)!;
    expect(d.GetEndPoint()).toEqual({ x: 300, y: 300 });
  });

  it('Rotate and Mirror act only on the flagged ends', () => {
    const l = wire(100, 0, 200, 0);
    l.SetFlags(ENDPOINT);
    l.Rotate({ x: 0, y: 0 }, true); // CCW 90 in Y-down: (200,0) -> (0,-200)
    expect(l.GetStartPoint()).toEqual({ x: 100, y: 0 });
    expect(l.GetEndPoint()).toEqual({ x: 0, y: -200 });

    const m = wire(100, 0, 200, 0);
    m.SetFlags(STARTPOINT);
    m.MirrorHorizontally(0);
    expect(m.GetStartPoint()).toEqual({ x: -100, y: 0 });
    expect(m.GetEndPoint()).toEqual({ x: 200, y: 0 });
  });

  it('UpdateDanglingState: a wire end touching another wire end is not dangling', () => {
    const a = wire(0, 0, 100, 0);
    const b = wire(100, 0, 100, 100);
    const byType: DANGLING_END_ITEM[] = [];
    a.GetEndPoints(byType);
    b.GetEndPoints(byType);
    const byPos = [...byType];
    DANGLING_END_ITEM_HELPER.sort_dangling_end_items(byType, byPos);

    a.UpdateDanglingState(byType, byPos);
    expect(a.IsStartDangling()).toBe(true);
    expect(a.IsEndDangling()).toBe(false);
  });

  it('operator< orders by layer, start, then end', () => {
    expect(wire(0, 0, 1, 1).lessThan(wire(0, 0, 1, 2))).toBe(true);
    expect(wire(0, 1, 0, 0).lessThan(wire(0, 0, 9, 9))).toBe(false);
  });
});

describe('SCH_JUNCTION / SCH_NO_CONNECT', () => {
  it('junction diameter falls back to DEFAULT_JUNCTION_DIAM without a schematic', () => {
    const j = new SCH_JUNCTION({ x: 1000, y: 2000 });
    expect(j.GetEffectiveDiameter()).toBe(9144);
    expect(box(j.GetBoundingBox())).toEqual([1000 - 4572, 2000 - 4572, 9144, 9144]);
    j.SetDiameter(1);
    // max( 1/2, 1 ) = 1: a radius never drops to zero
    expect(j.GetEffectiveDiameter()).toBe(2);
  });

  it('no-connect box is (pen 1 + size 12192) / 2 either side; its hit test is a square', () => {
    const nc = new SCH_NO_CONNECT({ x: 0, y: 0 });
    expect(nc.GetSize()).toBe(12192);
    expect(box(nc.GetBoundingBox())).toEqual([-6096, -6096, 12192, 12192]);
    expect(nc.HitTest({ x: 6096, y: -6096 })).toBe(true);
    expect(nc.HitTest({ x: 6097, y: 0 })).toBe(false);
  });
});

describe('SCH_BUS_ENTRY', () => {
  it('the quadrant ctor signs the 100 mil size', () => {
    const size = (q: number) => new SCH_BUS_WIRE_ENTRY({ x: 0, y: 0 }, q).GetSize();
    expect(size(1)).toEqual({ x: 25400, y: -25400 });
    expect(size(2)).toEqual({ x: 25400, y: 25400 });
    expect(size(3)).toEqual({ x: -25400, y: 25400 });
    expect(size(4)).toEqual({ x: -25400, y: -25400 });
    expect(new SCH_BUS_WIRE_ENTRY({ x: 0, y: 0 }, true).GetSize()).toEqual({ x: 25400, y: -25400 });
  });

  it('a bus-bus entry is on the bus layer; Rotate turns the size vector', () => {
    const e = new SCH_BUS_BUS_ENTRY({ x: 0, y: 0 });
    expect(e.GetLayer()).toBe(SCH_LAYER_ID.LAYER_BUS);
    e.Rotate({ x: 0, y: 0 }, false);
    expect(e.GetEnd()).toEqual({ x: -25400, y: 25400 });
  });

  it('a wire entry with a wire at one end and a bus through the other is connected', () => {
    const entry = new SCH_BUS_WIRE_ENTRY({ x: 0, y: 0 });
    const w = wire(0, 0, -1000, 0);
    const bus = new SCH_LINE({ x: 25400, y: -50000 }, SCH_LAYER_ID.LAYER_BUS);
    bus.SetEndPoint({ x: 25400, y: 50000 });
    const byType: DANGLING_END_ITEM[] = [];
    w.GetEndPoints(byType);
    bus.GetEndPoints(byType);
    entry.GetEndPoints(byType);
    const byPos = [...byType];
    DANGLING_END_ITEM_HELPER.sort_dangling_end_items(byType, byPos);

    expect(entry.UpdateDanglingState(byType, byPos)).toBe(true);
    expect(entry.IsDangling()).toBe(false);
  });
});

describe('SCH_FIELD', () => {
  it('mandatory fields answer their canonical names and strip their text', () => {
    const f = new SCH_FIELD(null, FIELD_T.REFERENCE);
    expect(f.GetName()).toBe('Reference');
    expect(f.GetLayer()).toBe(SCH_LAYER_ID.LAYER_REFERENCEPART);
    f.SetText('  R1 ');
    expect(f.GetText()).toBe('R1');

    const u = new SCH_FIELD(null, FIELD_T.USER, 'MPN');
    u.SetText(' x ');
    expect(u.GetText()).toBe(' x ');
    expect(u.GetOrdinal()).toBe(0);
    expect(u.IsMandatory()).toBe(false);
  });

  it('IsNetclassLabelFieldName knows the canonical name, "Net Class" and translations', () => {
    expect(SCH_FIELD.IsNetclassLabelFieldName('Netclass')).toBe(true);
    expect(SCH_FIELD.IsNetclassLabelFieldName('Net Class')).toBe(true);
    expect(SCH_FIELD.IsNetclassLabelFieldName('Netzklasse')).toBe(true);
    expect(SCH_FIELD.IsNetclassLabelFieldName('Class')).toBe(false);
  });

  it('a generated field keeps its name as its text', () => {
    const g = new SCH_FIELD(null, FIELD_T.USER, '${DNP}');
    expect(g.IsGeneratedField()).toBe(true);
    expect(g.GetText()).toBe('${DNP}');
    g.SetText('other');
    expect(g.GetText()).toBe('${DNP}');
  });

  it('the copy keeps the uuid and the id; equality compares mandatory fields by id', () => {
    const v = new SCH_FIELD(null, FIELD_T.VALUE);
    v.SetText('10k');
    const c = v.Clone();
    expect(c.m_Uuid).toBe(v.m_Uuid);
    expect(c.GetId()).toBe(FIELD_T.VALUE);
    expect(c.Type()).toBe(KICAD_T.SCH_FIELD_T);

    const r = new SCH_FIELD(null, FIELD_T.REFERENCE);
    // Without flags SCH_ITEM::compare settles two positions-equal fields by uuid first.
    expect(r.compare(v, SCH_ITEM.COMPARE_FLAGS.EQUALITY)).toBe(FIELD_T.REFERENCE - FIELD_T.VALUE);
    expect(r.lessThan(v)).toBe(true);
    expect(v.compare(c, SCH_ITEM.COMPARE_FLAGS.EQUALITY)).toBe(0);
  });

  it('GetShownText shows the name when asked and the File: prefix on sheet files', () => {
    const f = new SCH_FIELD(null, FIELD_T.USER, 'Tol');
    f.SetText('1%');
    f.SetNameShown(true);
    expect(f.GetShownText(true)).toBe('Tol: 1%');
    expect(f.GetShownText(false)).toBe('1%');

    const s = new SCH_FIELD(null, FIELD_T.SHEET_FILENAME);
    s.SetText('sub.kicad_sch');
    expect(s.GetShownText(true)).toBe('File: sub.kicad_sch');
  });
});
