// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBER_FILE_IMAGE::LoadGerberFile` (`gerbview/readgerb.cpp`) end to end:
 * what the RS-274X reader builds from a file, in GerbView's own terms.
 *
 * Every number here is worked out from the C++ by hand, in our 1 nm unit
 * (`gerbview.ts`: KiCad's is 10 nm, so each is ten times KiCad's):
 *
 *   `%FSLAX46Y46*%` : m_FmtScale 6, m_FmtLen 10, leading zeros omitted.
 *   `%MOMM*%`       : conv_scale = IU_PER_MILS * 1000 / 25.4 = 1e6 per mm.
 *   `X5000000`      : scale_list[6] = 0.001 * 1e6 * 0.0254 = 25.4, / 25.4
 *                     for metric = 1 per digit, so 5 mm = 5e6.
 */
import { describe, expect, it } from 'vitest';
import {
  APERTURE_T,
  GBR_BASIC_SHAPE_TYPE,
  GERBER_FILE_IMAGE,
  type GERBER_DRAW_ITEM,
} from '@ziroeda/gerbview';

const load = (lines: string[], name = 't.gbr'): GERBER_FILE_IMAGE => {
  const img = new GERBER_FILE_IMAGE(0);
  expect(img.LoadGerberFile(name, lines.join('\n'))).toBe(true);
  return img;
};

const HEAD = ['%FSLAX46Y46*%', '%MOMM*%'];

/** The shoelace area of a polygon set's outlines, in IU². */
function area(item: {
  OutlineCount(): number;
  COutline(i: number): { CPoints(): readonly { x: number; y: number }[] };
}): number {
  let a = 0;
  for (let o = 0; o < item.OutlineCount(); o++) {
    const p = item.COutline(o).CPoints();
    for (let i = 0; i < p.length; i++) {
      const q = p[i]!;
      const r = p[(i + 1) % p.length]!;
      a += q.x * r.y - r.x * q.y;
    }
  }
  return Math.abs(a / 2);
}

describe('LoadGerberFile', () => {
  it('reads flashes and a trace, in file coordinates', () => {
    const img = load([
      ...HEAD,
      '%ADD10C,0.5*%',
      '%ADD11R,1X0.5*%',
      'D10*',
      'X0Y0D03*',
      'X5000000Y0D03*',
      'D11*',
      'G01*',
      'X0Y0D02*',
      'X10000000Y0D01*',
      'M02*',
    ]);

    const items = img.GetItems();
    expect(items.map((i) => i.m_ShapeType)).toStrictEqual([
      GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE,
      GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE,
      GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT,
    ]);
    expect(items[1]!.m_Start).toStrictEqual({ x: 5000000, y: 0 });
    expect(items[1]!.m_Size).toStrictEqual({ x: 500000, y: 500000 });
    expect(items[1]!.m_Flashed).toBe(true);
    // The trace takes the rect's whole m_Size: x is its width.
    expect(items[2]!.m_Start).toStrictEqual({ x: 0, y: 0 });
    expect(items[2]!.m_End).toStrictEqual({ x: 10000000, y: 0 });
    expect(items[2]!.m_Size).toStrictEqual({ x: 1000000, y: 500000 });
    expect(items[2]!.m_DCode).toBe(11);
    expect(img.GetDCODE(11)?.m_ApertType).toBe(APERTURE_T.APT_RECT);
    expect(img.m_GerbMetric).toBe(true);
    expect(img.GetMessages()).toStrictEqual([]);
  });

  it('draws in image coordinates: the Y axis turns downward', () => {
    const img = load([...HEAD, '%ADD10C,0.5*%', 'D10*', 'X1000000Y2000000D03*', 'M02*']);
    const flash = img.GetItems()[0]!;
    expect(flash.m_Start).toStrictEqual({ x: 1000000, y: 2000000 });
    // GetABPosition: "abPos.y must be negated when no mirror, because draw
    // axis is top to bottom".
    expect(flash.GetABPosition(flash.m_Start)).toStrictEqual({ x: 1000000, y: -2000000 });
  });

  it('builds a region from G36 .. G37, closing it once', () => {
    const img = load([
      ...HEAD,
      'G36*',
      'X0Y0D02*',
      'X0Y5000000D01*',
      'X5000000Y5000000D01*',
      'X5000000Y0D01*',
      'X0Y0D01*',
      'G37*',
      'M02*',
    ]);
    const polys = img.GetItems().filter((i) => i.m_ShapeType === GBR_BASIC_SHAPE_TYPE.GBR_POLYGON);
    expect(polys).toHaveLength(1);
    // G37 appends CVertex( 0 ) again, which Append drops as a duplicate of
    // the last point: (0,0) is written once at each end.
    expect(polys[0]!.m_ShapeAsPolygon.COutline(0).CPoints()).toStrictEqual([
      { x: 0, y: 0 },
      { x: 0, y: 5000000 },
      { x: 5000000, y: 5000000 },
      { x: 5000000, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(polys[0]!.m_DCode).toBe(0);
  });

  it('flashes an aperture macro as the union less its holes', () => {
    const img = load([
      ...HEAD,
      '%AMDONUT*',
      '1,1,$1,0,0*',
      '1,0,$2,0,0*%',
      '%ADD20DONUT,2X1*%',
      'D20*',
      'X0Y0D03*',
      'M02*',
    ]);
    const flash = img.GetItems()[0]!;
    expect(flash.m_ShapeType).toBe(GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO);
    const dcode = flash.GetDcodeDescr()!;
    expect(dcode.GetParamCount()).toBe(2);
    expect([dcode.GetParam(1), dcode.GetParam(2)]).toStrictEqual([2, 1]);
    const shape = dcode.GetMacro()!.GetApertureMacroShape(flash, flash.m_Start);
    // Fractured: the hole is joined to the outline, so one outline, no holes.
    expect(shape.OutlineCount()).toBe(1);
    expect(shape.HoleCount(0)).toBe(0);
    // Two 64-gons of radius 1e6 and 0.5e6: 32 r^2 sin( 2pi/64 ) each.
    const k = 32 * Math.sin((2 * Math.PI) / 64);
    expect(area(shape) / (k * (1e12 - 0.25e12))).toBeCloseTo(1, 5);
  });

  it('replicates a Step and Repeat block when it closes', () => {
    const img = load([
      ...HEAD,
      '%ADD10C,0.5*%',
      'D10*',
      '%SRX2Y1I10.0J0*%',
      'X0Y0D03*',
      '%SR*%',
      'M02*',
    ]);
    expect(img.GetItems().map((i) => i.m_Start)).toStrictEqual([
      { x: 0, y: 0 },
      { x: 10000000, y: 0 },
    ]);
  });

  it('records the polarity each item was drawn with', () => {
    const img = load([
      ...HEAD,
      '%ADD10C,1*%',
      'D10*',
      '%LPC*%',
      'X0Y0D03*',
      '%LPD*%',
      'X2000000Y0D03*',
      'M02*',
    ]);
    // GetLayerPolarity() is m_LayerNegative: true means clear.
    expect(img.GetItems().map((i) => i.GetLayerPolarity())).toStrictEqual([true, false]);
  });

  it('reads a multi-quadrant arc as start, end and centre', () => {
    const img = load([
      ...HEAD,
      '%ADD10C,0.2*%',
      'D10*',
      'G03*',
      'X0Y0D02*',
      'X2000000Y0I1000000J0D01*',
      'M02*',
    ]);
    const arc = img.GetItems()[0]!;
    expect(arc.m_ShapeType).toBe(GBR_BASIC_SHAPE_TYPE.GBR_ARC);
    // G03 is GERB_INTERPOL_ARC_POS, handed to fillArcGBRITEM as clockwise,
    // which keeps start and end in file order.
    expect(arc.m_Start).toStrictEqual({ x: 0, y: 0 });
    expect(arc.m_End).toStrictEqual({ x: 2000000, y: 0 });
    expect(arc.m_ArcCentre).toStrictEqual({ x: 1000000, y: 0 });
  });

  it('swaps an arc read as G02 end for start', () => {
    const img = load([
      ...HEAD,
      '%ADD10C,0.2*%',
      'D10*',
      'G75*',
      'G02*',
      'X0Y0D02*',
      'X2000000Y0I1000000J0D01*',
      'M02*',
    ]);
    const arc = img.GetItems()[0]!;
    expect(arc.m_Start).toStrictEqual({ x: 2000000, y: 0 });
    expect(arc.m_End).toStrictEqual({ x: 0, y: 0 });
  });

  it('stores a %TO net on each item it covers, and in the image list', () => {
    const img = load([
      ...HEAD,
      '%ADD10C,1*%',
      '%TO.N,GND*%',
      'D10*',
      'X0Y0D03*',
      '%TD*%',
      'X0Y0D03*',
      'M02*',
    ]);
    const [a, b] = img.GetItems() as [GERBER_DRAW_ITEM, GERBER_DRAW_ITEM];
    expect(a.GetNetAttributes().m_Netname).toBe('GND');
    expect(b.GetNetAttributes().m_Netname).toBe('');
    expect([...img.m_NetnamesList.keys()]).toStrictEqual(['GND']);
  });

  it('loses the command after one it does not know, as GerbView does', () => {
    // %IC is not an RS274X_PARAMETERS entry: ExecuteRS274XCommand returns
    // false with the text on the '*', so the state is END_BLOCK there and the
    // closing '%' OPENS the next command, which reads the next line's opening
    // '%' as its end. The FS line is then read as plain text: F, S, L and A
    // are unexpected, X46Y46 is a coordinate, and M skips the MO line.
    const img = load(['%ICAS*%', '%FSLAX46Y46*%', '%MOMM*%', 'M02*']);
    expect(img.GetMessages()).toStrictEqual([
      'Unexpected char 0x46 (F)',
      'Unexpected char 0x53 (S)',
      'Unexpected char 0x4C (L)',
      'Unexpected char 0x41 (A)',
    ]);
    expect(img.m_GerbMetric).toBe(false);
    expect(img.m_FmtScale).toStrictEqual({ x: 4, y: 4 });
  });

  it('cannot open a file it was not given', () => {
    expect(new GERBER_FILE_IMAGE(0).LoadGerberFile('none.gbr', null)).toBe(false);
  });
});
