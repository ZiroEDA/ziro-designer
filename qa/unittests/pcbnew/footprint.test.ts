// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FOOTPRINT over BOARD_ITEM_CONTAINER (`pcbnew/footprint.cpp`), with its pads,
 * fields and courtyard. Every expected number below was read from KiCad's own
 * `pcbnew` python module on the same inputs (a default 2-copper BOARD), not
 * derived from our port.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LIB_ID } from '@ziroeda/common/src/lib_id.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT, FP_SMD } from '@ziroeda/pcbnew/footprint.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB, PAD_SHAPE } from '@ziroeda/pcbnew/padstack.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { PCB_TEXTBOX } from '@ziroeda/pcbnew/pcb_textbox.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';

const bbox = (fp: FOOTPRINT, aIncludeText?: boolean): [number, number, number, number] => {
  const r = fp.GetBoundingBox(aIncludeText);
  return [r.GetX(), r.GetY(), r.GetWidth(), r.GetHeight()];
};

/** An R_0603 on a board: two roundrect SMD pads and a rectangular front courtyard. */
const mkR0603 = (): { board: BOARD; fp: FOOTPRINT; p1: PAD; p2: PAD; crtyd: PCB_SHAPE } => {
  const board = new BOARD();
  const fp = new FOOTPRINT(board);
  board.Add(fp);
  fp.SetReference('R1');
  fp.SetValue('10k');
  fp.SetFPID(new LIB_ID('Resistor_SMD', 'R_0603_1608Metric'));

  const mkPad = (num: string, x: number): PAD => {
    const p = new PAD(fp);
    p.SetNumber(num);
    p.SetAttribute(PAD_ATTRIB.SMD);
    p.SetLayerSet(PAD.SMDMask());
    p.SetShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.ROUNDRECT);
    p.SetSize(PCB_LAYER_ID.F_Cu, { x: 875000, y: 950000 });
    p.SetPosition({ x, y: 0 });
    fp.Add(p);
    return p;
  };

  const p1 = mkPad('1', -825000);
  const p2 = mkPad('2', 825000);

  const crtyd = new PCB_SHAPE(fp, SHAPE_T.RECTANGLE);
  crtyd.SetLayer(PCB_LAYER_ID.F_CrtYd);
  crtyd.SetStart({ x: -1480000, y: -730000 });
  crtyd.SetEnd({ x: 1480000, y: 730000 });
  crtyd.SetWidth(50000);
  fp.Add(crtyd);

  return { board, fp, p1, p2, crtyd };
};

describe('FOOTPRINT', () => {
  it('constructs like FOOTPRINT( parent ): the four mandatory fields, pads locked, F.Cu, unsided', () => {
    const fp = new FOOTPRINT(new BOARD());
    expect(
      fp.GetFields().map((f) => [f.GetName(), f.GetLayer(), f.IsVisible(), f.GetText()]),
    ).toEqual([
      ['Reference', PCB_LAYER_ID.F_SilkS, true, ''],
      ['Value', PCB_LAYER_ID.F_Fab, true, ''],
      ['Datasheet', PCB_LAYER_ID.F_Fab, false, ''],
      ['Description', PCB_LAYER_ID.F_Fab, false, ''],
    ]);
    expect(fp.GetAttributes()).toBe(0);
    expect(fp.IsLocked()).toBe(false);
    expect(fp.LegacyPadsLocked()).toBe(true);
    expect(fp.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(fp.GetSide()).toBe(PCB_LAYER_ID.UNDEFINED_LAYER);
    // An empty footprint's box is the 0.25 mm minimum around the anchor, plus the two empty fields
    expect(bbox(fp)).toEqual([-250000, -278606, 500000, 557213]);
    expect(bbox(fp, false)).toEqual([-250000, -278606, 500000, 557213]);
  });

  it('bounding boxes, side, pad counts, hit tests and the convex hull', () => {
    const { fp } = mkR0603();
    expect(bbox(fp, false)).toEqual([-1505000, -755000, 3010000, 1510000]);
    expect(bbox(fp, true)).toEqual([-1834696, -1021556, 3669393, 2043113]);
    expect(fp.GetSide()).toBe(PCB_LAYER_ID.F_Cu);
    expect(fp.GetPadCount()).toBe(2);
    expect(fp.GetUniquePadCount()).toBe(2);
    expect(fp.GetLikelyAttribute()).toBe(FP_SMD);
    expect(fp.GetTypeName()).toBe('Other');
    expect(fp.HitTest({ x: 0, y: 0 }, 0)).toBe(true);
    expect(fp.HitTest({ x: 3000000, y: 0 }, 0)).toBe(false);
    expect(fp.HitTestAccurate({ x: 0, y: 0 }, 0)).toBe(true);

    const hull = fp.GetBoundingHull();
    expect(hull.TotalVertices()).toBe(8);
    expect([0, 1, 2, 3].map((i) => [hull.CVertex(i).x, hull.CVertex(i).y])).toEqual([
      [-1505000, -740355],
      [-1490355, -755000],
      [1490355, -755000],
      [1505000, -740355],
    ]);
  });

  it('the courtyard cache: one outline, deflated by the polygonisation error, well-formed', () => {
    const { fp } = mkR0603();
    const cy = fp.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
    expect(cy.OutlineCount()).toBe(1);
    expect(cy.TotalVertices()).toBe(4);
    expect(cy.CVertex(0)).toEqual({ x: 1475000, y: -725000 });
    expect(fp.GetFlags() & (1 << 20)).toBe(0); // MALFORMED_F_COURTYARD
  });

  it('description, LIB_ID and view layers', () => {
    const { fp } = mkR0603();
    expect(fp.GetItemDescription(new UNITS_PROVIDER(pcbIUScale, 'mm'), true)).toBe('Footprint R1');
    expect(fp.GetFPIDAsString()).toBe('Resistor_SMD:R_0603_1608Metric');
    expect(fp.ViewGetLayers()).toEqual([269, 276]);
  });

  it('SetPosition / SetOrientation move and turn the children with the anchor', () => {
    const { fp, p1 } = mkR0603();
    fp.SetPosition({ x: 10000000, y: 5000000 });
    fp.SetOrientationDegrees(90);
    expect(p1.GetPosition()).toEqual({ x: 10000000, y: 5825000 });
    expect(p1.GetOrientationDegrees()).toBe(90);
    expect(fp.GetPosition()).toEqual({ x: 10000000, y: 5000000 });
    expect(bbox(fp, false)).toEqual([9245000, 3495000, 1510000, 3010000]);
    expect(fp.Reference().GetPosition()).toEqual({ x: 10000000, y: 5000000 });
    expect(fp.Reference().GetTextAngle().AsDegrees()).toBe(90);
  });

  it('Flip left-right: B.Cu, the orientation kept at 90, pads and fields flipped through the board', () => {
    const { fp, p1, crtyd } = mkR0603();
    fp.SetPosition({ x: 10000000, y: 5000000 });
    fp.SetOrientationDegrees(90);
    fp.Flip({ x: 10000000, y: 5000000 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(fp.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(fp.GetOrientationDegrees()).toBe(90);
    expect(p1.GetPosition()).toEqual({ x: 10000000, y: 5825000 });
    expect(p1.GetLayerSet().FmtHex()).toBe('00000000_00000000_00000000_0000800c');
    expect(fp.Reference().GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
    expect(fp.Reference().IsMirrored()).toBe(true);
    expect(crtyd.GetLayer()).toBe(PCB_LAYER_ID.B_CrtYd);
    expect(fp.GetSide()).toBe(PCB_LAYER_ID.B_Cu);
    expect(bbox(fp, false)).toEqual([9245000, 3495000, 1510000, 3010000]);
    expect(fp.IsOnLayer(PCB_LAYER_ID.B_Cu)).toBe(true);
    expect(fp.IsOnLayer(PCB_LAYER_ID.F_Cu)).toBe(false);
    expect(fp.GetNextPadNumber('2')).toBe('3');
    expect(fp.FindPadByNumber('2')!.GetPosition()).toEqual({ x: 10000000, y: 4175000 });
  });

  it('a text in the footprint resolves ${REFERENCE}', () => {
    const { fp } = mkR0603();
    const t = new PCB_TEXT(fp);
    t.SetText('${REFERENCE}');
    fp.Add(t);
    expect(t.GetShownText(true)).toBe('R1');
  });

  it('Clone copies the children with the UUID; the copy is equal', () => {
    const { fp } = mkR0603();
    const c = fp.Clone();
    expect(c.m_Uuid).toBe(fp.m_Uuid);
    expect(c.Pads()).toHaveLength(2);
    expect(c.Pads()[0]!.GetParent()).toBe(c);
    expect(c.GetReference()).toBe('R1');
    expect(c.equals(fp)).toBe(true);
    // `*existingField = *field`: operator= keeps the copy's own UUID for a mandatory field
    expect(c.GetFields()[0]!.m_Uuid).not.toBe(fp.GetFields()[0]!.m_Uuid);
    expect(c.LegacyPadsLocked()).toBe(true); // m_fpStatus travels with the copy
  });

  it('TransformFPShapesToPolySet includes a text box: its border ovals and its text strokes', () => {
    const b = new BOARD();
    const fp = new FOOTPRINT(b);
    b.Add(fp);
    const t = new PCB_TEXTBOX(fp);
    t.SetStart({ x: 0, y: 0 });
    t.SetEnd({ x: 4000000, y: 2000000 });
    t.SetText('Hi');
    fp.Add(t);

    const ps = new SHAPE_POLY_SET();
    fp.TransformFPShapesToPolySet(
      ps,
      PCB_LAYER_ID.UNDEFINED_LAYER,
      0,
      5000,
      ERROR_LOC.ERROR_INSIDE,
      true,
      true,
    );
    expect(ps.OutlineCount()).toBe(7);
    const bb = ps.BBox();
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      -50000, -50000, 4100000, 2100000,
    ]);
    expect(ps.Area()).toBeCloseTo(1968365363535.5, 0);

    const d = fp.DuplicateItem(false, null, t, true) as PCB_TEXTBOX;
    expect(d).toBeInstanceOf(PCB_TEXTBOX);
    expect(d.m_Uuid).not.toBe(t.m_Uuid);
    expect(fp.GraphicalItems()).toHaveLength(2);
  });
});
