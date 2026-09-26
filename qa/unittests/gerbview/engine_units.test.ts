// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The units under `readgerb`: `Evaluate` and `AM_PARAM`, `D_CODE`'s shape
 * polygons, and `GERBER_DRAW_ITEM::GetABPosition`.
 *
 * Every expectation is worked by hand from the C++ (`gerbview/evaluate.cpp`,
 * `am_param.cpp`, `dcode.cpp`, `gerber_draw_item.cpp`) in our 1 nm unit, never
 * read back out of the module.
 */
import { describe, expect, it } from 'vitest';
import { AM_PARAM, APERTURE_T } from '@ziroeda/gerbview';
import { CHAR_PTR, LINE_BUFFER } from '@ziroeda/gerbview/libc.js';
import { parseGerber } from './load_image.js';

/** `AM_PARAM::ReadParamFromAmDef` over `text`, then its value with no macro. */
function evaluate(text: string): number {
  const buf = new LINE_BUFFER();
  buf.s = `${text}*`;
  const prm = new AM_PARAM();
  prm.ReadParamFromAmDef(new CHAR_PTR(buf));
  return prm.GetValueFromMacro(null);
}

describe('Evaluate, through AM_PARAM', () => {
  it('multiplies before it adds', () => {
    // 1 + 2 x 3: x (priority 2) beats + (1) when the 3 arrives, so the
    // values are [1, 6] and the ops [+]: 7.
    expect(evaluate('1+2x3')).toBe(7);
    // 2 x 3 + 1: no reduction on the way, then left to right: 2 * 3 + 1.
    expect(evaluate('2x3+1')).toBe(7);
  });

  it('reads X and x alike as multiply, and / as divide', () => {
    expect(evaluate('3X4')).toBe(12);
    expect(evaluate('8/2/2')).toBe(2);
  });

  it('lifts a parenthesised block by 3', () => {
    // ( 1 + 2 ) x 3: the + is priority 4 inside, x is 2 outside, so nothing
    // reduces early and the final pass goes 1 + 2 = 3, x 3 = 9.
    expect(evaluate('(1+2)x3')).toBe(9);
  });

  it('reduces only one level, as upstream does', () => {
    // 1 + ( 2 + 3 x 4 ) is 15 by arithmetic, and 21 in GerbView: the inner
    // + (priority 4) reduces 2 + 3 = 5 as soon as the 3 arrives, because it
    // outranks the outer + (1); then x (5) takes 5 x 4 = 20; 1 + 20 = 21.
    expect(evaluate('1+(2+3x4)')).toBe(21);
  });

  it('reads a sign after an operator as part of the number', () => {
    // '-' after an operator is not SUB: "seems the sign of a value".
    expect(evaluate('2x-3')).toBe(-6);
    expect(evaluate('-3+1')).toBe(-2);
  });
});

const HEAD = ['%FSLAX46Y46*%', '%MOMM*%'];

/** The D-code `n`'s polygon, as `D_CODE::ConvertShapeToPolygon` builds it. */
function apertureOutline(ad: string, n: number): { x: number; y: number }[] {
  const img = parseGerber([...HEAD, ad, `D${n}*`, 'X0Y0D03*', 'M02*'].join('\n'), 't.gbr');
  const item = img.GetItems()[0]!;
  const dcode = img.GetDCODE(n)!;
  dcode.ConvertShapeToPolygon(item);
  return dcode.m_Polygon
    .COutline(0)
    .CPoints()
    .map((p) => ({ x: p.x, y: p.y }));
}

/** Points in x, then y order, so a set compares whatever the walk. */
const sorted = (pts: { x: number; y: number }[]): { x: number; y: number }[] =>
  [...pts].sort((p, q) => p.x - q.x || p.y - q.y);

describe('D_CODE::ConvertShapeToPolygon', () => {
  // Every standard shape ends in addHoleToPolygon, which runs BooleanSubtract
  // and Fracture even with no hole (dcode.cpp:451-452): the outline goes
  // through Clipper, which drops the repeated closing vertex and chooses the
  // starting vertex and winding. So the vertex SET is what is pinned here.

  it('builds a rectangle on its four corners', () => {
    // currpos = size / 2, then x -= w, y -= h, x += w, y += h.
    expect(sorted(apertureOutline('%ADD10R,1X0.5*%', 10))).toStrictEqual(
      sorted([
        { x: 500000, y: 250000 },
        { x: -500000, y: 250000 },
        { x: -500000, y: -250000 },
        { x: 500000, y: -250000 },
      ]),
    );
  });

  it('turns a regular polygon by MINUS its %AD rotation', () => {
    // P, 1 mm, 3 vertices, 30 degrees. Vertex ii is (500000, 0) rotated by
    // 360 * ii / 3 with RotatePoint's (x cos + y sin, y cos - x sin):
    // (500000, 0), (-250000, -433013), (-250000, 433013). Then the outline by
    // -30 (cos 0.866, sin -0.5): (433013, 250000), (0, -500000),
    // (-433013, 250000). By +30 every y would change sign.
    expect(sorted(apertureOutline('%ADD11P,1X3X30*%', 11))).toStrictEqual(
      sorted([
        { x: 433013, y: 250000 },
        { x: 0, y: -500000 },
        { x: -433013, y: 250000 },
      ]),
    );
  });

  it('knows each standard aperture by its letter', () => {
    const img = parseGerber(
      [...HEAD, '%ADD10C,1*%', '%ADD11R,1X1*%', '%ADD12O,1X2*%', '%ADD13P,1X5*%', 'M02*'].join(
        '\n',
      ),
      't.gbr',
    );
    expect([10, 11, 12, 13].map((n) => img.GetDCODE(n)?.m_ApertType)).toStrictEqual([
      APERTURE_T.APT_CIRCLE,
      APERTURE_T.APT_RECT,
      APERTURE_T.APT_OVAL,
      APERTURE_T.APT_POLYGON,
    ]);
    expect(img.GetDCODE(13)?.m_EdgesCount).toBe(5);
  });
});

describe('GERBER_DRAW_ITEM::GetABPosition', () => {
  const flashAt = (extra: string[]): { x: number; y: number } => {
    const img = parseGerber(
      [...HEAD, ...extra, '%ADD10C,0.1*%', 'D10*', 'X1000000Y0D03*', 'M02*'].join('\n'),
      't.gbr',
    );
    const item = img.GetItems()[0]!;
    return item.GetABPosition(item.m_Start);
  };

  it('negates Y alone when nothing else is set', () => {
    expect(flashAt([])).toStrictEqual({ x: 1000000, y: 0 });
  });

  it('adds %OF, rotates by minus %IR, mirrors A, and flips Y last', () => {
    // (1, 0) mm + %OF (1, 3) = (2, 3); RotatePoint by -90, which is 270:
    // (-y, x) = (-3, 2); %MIA1 negates x: (3, 2); B is not mirrored, so y is
    // negated for the top-down draw axis: (3, -2).
    expect(flashAt(['%OFA1B3*%', '%IR90*%', '%MIA1B0*%'])).toStrictEqual({
      x: 3000000,
      y: -2000000,
    });
  });

  it('leaves Y alone when B is mirrored', () => {
    // (1, 0) + (1, 3) = (2, 3); no rotation; B mirrored: y stays 3.
    expect(flashAt(['%OFA1B3*%', '%MIA0B1*%'])).toStrictEqual({ x: 2000000, y: 3000000 });
  });

  it('adds %IO as well as %OF', () => {
    // (1, 0) + %OF (1, 3) + %IO (0.5, 0.25) = (2.5, 3.25), then -y.
    expect(flashAt(['%OFA1B3*%', '%IOA0.5B0.25*%'])).toStrictEqual({
      x: 2500000,
      y: -3250000,
    });
  });
});
