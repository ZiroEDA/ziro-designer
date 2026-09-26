// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PAD over PADSTACK (`pcbnew/pad.cpp`). Every expected number below was read
 * from KiCad's own `pcbnew` python module on the same inputs (a default
 * 2-copper BOARD), not derived from our port.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PAD, PAD_ATTRIB, PAD_SHAPE } from '@ziroeda/pcbnew/pad.js';

const bbox = (p: PAD): [number, number, number, number] => {
  const r = p.GetBoundingBox();
  return [r.GetX(), r.GetY(), r.GetWidth(), r.GetHeight()];
};

const units = new UNITS_PROVIDER(pcbIUScale, 'mm');

describe('PAD', () => {
  it('constructs like PAD( parent ): a 60 mil PTH circle with a 30 mil hole on the PTH mask', () => {
    const p = new PAD(new BOARD());
    expect(p.GetSizeX()).toBe(1524000);
    expect(p.GetDrillSizeX()).toBe(762000);
    expect(p.GetShape(PCB_LAYER_ID.F_Cu)).toBe(PAD_SHAPE.CIRCLE);
    expect(p.GetAttribute()).toBe(PAD_ATTRIB.PTH);
    expect(p.GetLayerSet().FmtHex()).toBe('00000000_00000000_55555555_5555555f');
    expect(bbox(p)).toEqual([-762000, -762000, 1524000, 1524000]);
    expect(p.GetBoundingRadius()).toBe(765687);
    expect(p.HasHole()).toBe(true);
    expect(p.IsOnCopperLayer()).toBe(true);
  });

  it('effective shapes of the default pad', () => {
    const p = new PAD(new BOARD());
    const eff = p.GetEffectiveShape(PCB_LAYER_ID.F_Cu);
    expect(eff).toBeInstanceOf(SHAPE_COMPOUND);
    const parts = (eff as SHAPE_COMPOUND).Shapes();
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBeInstanceOf(SHAPE_CIRCLE);
    expect((parts[0] as SHAPE_CIRCLE).GetRadius()).toBe(762000);

    const hole = p.GetEffectiveHoleShape();
    expect(hole).toBeInstanceOf(SHAPE_SEGMENT);
    expect(hole.GetWidth()).toBe(762000);
    expect(hole.GetSeg().A).toEqual({ x: 0, y: 0 });
  });

  it('HitTest against the effective polygon and the hole', () => {
    const p = new PAD(new BOARD());
    expect(p.HitTest({ x: 700000, y: 0 }, 0)).toBe(true);
    expect(p.HitTest({ x: 800000, y: 0 }, 0)).toBe(false);
    expect(p.HitTest({ x: 750000, y: 0 }, 20000)).toBe(true);
  });

  it('a rotated 2x1 mm roundrect: bbox, radius, corner radius, segments and polygon', () => {
    const p = new PAD(new BOARD());
    p.SetNumber('1');
    p.SetShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.ROUNDRECT);
    p.SetSize(PCB_LAYER_ID.F_Cu, { x: 2000000, y: 1000000 });
    p.SetOrientationDegrees(30);

    expect(bbox(p)).toEqual([-1024519, -841506, 2049038, 1683012]);
    expect(p.GetBoundingRadius()).toBe(1044982);
    expect(p.GetRoundRectCornerRadius(PCB_LAYER_ID.F_Cu)).toBe(250000);

    const parts = (p.GetEffectiveShape(PCB_LAYER_ID.F_Cu) as SHAPE_COMPOUND).Shapes();
    expect(parts).toHaveLength(5); // the body polygon and the four rounded edges
    const seg = parts[1] as SHAPE_SEGMENT;
    expect(seg).toBeInstanceOf(SHAPE_SEGMENT);
    expect(seg.GetSeg().A).toEqual({ x: -524519, y: 591506 });
    expect(seg.GetSeg().B).toEqual({ x: 774519, y: -158494 });
    expect(seg.GetWidth()).toBe(500000);

    const poly = p.GetEffectivePolygon(PCB_LAYER_ID.F_Cu);
    expect(poly.TotalVertices()).toBe(20);
    expect(poly.CVertex(0)).toEqual({ x: -991025, y: 283494 });
    expect(poly.CVertex(5)).toEqual({ x: 399519, y: -808013 });

    expect(p.HitTest({ x: 900000, y: 400000 }, 0)).toBe(false);
    expect(p.HitTest({ x: 900000, y: 600000 }, 0)).toBe(false);

    expect(p.GetItemDescription(units, true)).toBe('PTH pad 1'); // no parent footprint: the `else` of each branch
    expect(p.ViewGetLayers()).toEqual([282, 295, 439, 697, 441, 699, 259, 1, 3]);
  });

  it('SetAttribute( SMD ) trims to one copper layer and drops the hole', () => {
    const p = new PAD(new BOARD());
    p.SetNumber('1');
    p.SetAttribute(PAD_ATTRIB.SMD);
    expect(p.GetLayerSet().FmtHex()).toBe('00000000_00000000_00000000_0000000e');
    expect(p.GetDrillSizeX()).toBe(0);
    expect(p.ViewGetLayers()).toEqual([441, 699, 258, 1, 3]);
    expect(p.GetItemDescription(units, true)).toBe('Pad 1 on B.Cu'); // no parent footprint
  });

  it('a front SMD pad: mask/paste margins fall through to the board defaults; Flip mirrors it', () => {
    const p = new PAD(new BOARD());
    p.SetShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.ROUNDRECT);
    p.SetSize(PCB_LAYER_ID.F_Cu, { x: 2000000, y: 1000000 });
    p.SetOrientationDegrees(30);
    p.SetAttribute(PAD_ATTRIB.SMD);
    p.SetLayerSet(PAD.SMDMask());

    expect(p.GetSolderMaskExpansion(PCB_LAYER_ID.F_Cu)).toBe(0);
    expect(p.GetSolderPasteMargin(PCB_LAYER_ID.F_Cu)).toEqual({ x: 0, y: 0 });
    const vb = p.ViewBBox();
    expect([vb.GetX(), vb.GetY(), vb.GetWidth()]).toEqual([-1024519, -841506, 2049038]);

    p.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(p.GetLayerSet().FmtHex()).toBe('00000000_00000000_00000000_0000800c');
    expect(p.GetOrientationDegrees()).toBe(330);
    expect(p.GetPosition()).toEqual({ x: 0, y: 0 });
  });

  it('Move / Rotate update position and orientation', () => {
    const p = new PAD(new BOARD());
    p.SetPosition({ x: 100, y: 0 });
    p.Move({ x: 10, y: 20 });
    expect(p.GetPosition()).toEqual({ x: 110, y: 20 });

    p.SetPosition({ x: 100, y: 0 });
    p.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(p.GetPosition()).toEqual({ x: 0, y: -100 });
    expect(p.GetOrientation().AsDegrees()).toBe(90);
  });

  it('Clone keeps the UUID and the padstack; ImportSettingsFrom copies the shape', () => {
    const p = new PAD(new BOARD());
    p.SetShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.RECTANGLE);
    p.SetSize(PCB_LAYER_ID.F_Cu, { x: 300000, y: 200000 });
    const c = p.Clone();
    expect(c.m_Uuid).toBe(p.m_Uuid);
    expect(c.GetShape(PCB_LAYER_ID.F_Cu)).toBe(PAD_SHAPE.RECTANGLE);
    expect(c.equals(p)).toBe(true);

    const q = new PAD(new BOARD());
    q.ImportSettingsFrom(p);
    expect(q.GetSize(PCB_LAYER_ID.F_Cu)).toEqual({ x: 300000, y: 200000 });
    expect(q.GetShape(PCB_LAYER_ID.F_Cu)).toBe(PAD_SHAPE.RECTANGLE);
  });
});
