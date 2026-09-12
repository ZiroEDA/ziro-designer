// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_circle.cpp` (Circle), transcribed
 * against the `CIRCLE` class.
 */
import { describe, expect, it } from 'vitest';
import { CIRCLE } from '@ziroeda/kimath/src/geometry/circle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const MIN_PRECISION_IU = 4;
const MIN_PRECISION_45DEG = KiROUND(MIN_PRECISION_IU * 0.7071);

type P = [number, number];
const V = (p: P): VECTOR2I => ({ x: p[0], y: p[1] });
const C = (c: P, r: number): CIRCLE => new CIRCLE(V(c), r);
const S = (a: P, b: P): SEG => new SEG(V(a), V(b));

const compareLength = (aLengthA: number, aLengthB: number): boolean =>
  !(aLengthA > aLengthB + MIN_PRECISION_IU) && !(aLengthA < aLengthB - MIN_PRECISION_IU);

const compareVector2I = (a: VECTOR2I, b: VECTOR2I): boolean =>
  compareLength(a.x, b.x) && compareLength(a.y, b.y);

/** `KI_TEST::CheckUnorderedMatches` with `CompareVector2I`. */
function checkUnorderedMatches(expected: P[], got: VECTOR2I[], name: string): void {
  expect(got.length, `${name}: count`).toBe(expected.length);
  const unmatched = [...expected];
  for (const g of got) {
    const i = unmatched.findIndex((e) => compareVector2I(V(e), g));
    expect(i, `${name}: got (${g.x}, ${g.y}) matches nothing expected`).toBeGreaterThanOrEqual(0);
    unmatched.splice(i, 1);
  }
}

describe('Circle', () => {
  it('ParameterCtorMod', () => {
    const circle = new CIRCLE({ x: 10, y: 20 }, 10);
    expect(circle.Center).toEqual({ x: 10, y: 20 });
    expect(circle.Radius).toBe(10);

    circle.Center.x += 10;
    circle.Center.y += 10;
    circle.Radius += 20;

    expect(circle.Center).toEqual({ x: 20, y: 30 });
    expect(circle.Radius).toBe(30);
  });

  it('Contains', () => {
    const cases: [string, P, number, P, boolean][] = [
      ['on center', [100, 100], 200, [100, 100], false],
      ['0 deg', [100, 100], 200, [300, 100], true],
      ['0 deg, allowed tolerance pos', [100, 100], 200, [100, 300 + MIN_PRECISION_IU], true],
      ['0 deg, allowed tolerance neg', [100, 100], 200, [100, 300 - MIN_PRECISION_IU], true],
      [
        '0 deg, allowed tolerance pos + 1',
        [100, 100],
        200,
        [100, 300 + MIN_PRECISION_IU + 1],
        false,
      ],
      [
        '0 deg, allowed tolerance neg - 1',
        [100, 100],
        200,
        [100, 300 - MIN_PRECISION_IU - 1],
        false,
      ],
      ['45 deg', [100, 100], 200, [241, 241], true],
      [
        '45 deg, allowed tolerance pos',
        [100, 100],
        200,
        [241 + MIN_PRECISION_45DEG, 241 + MIN_PRECISION_45DEG],
        true,
      ],
      [
        '45 deg, allowed tolerance pos + 1',
        [100, 100],
        200,
        [241 + MIN_PRECISION_45DEG + 1, 241 + MIN_PRECISION_45DEG + 1],
        false,
      ],
      ['90 deg', [100, 100], 200, [100, 300], true],
      ['180 deg', [100, 100], 200, [-100, 100], true],
      ['270 deg', [100, 100], 200, [100, -100], true],
    ];
    for (const [name, c, r, p, exp] of cases) expect(C(c, r).Contains(V(p)), name).toBe(exp);
  });

  it('NearestPoint', () => {
    const cases: [string, P, number, P, P][] = [
      ['on center', [10, 10], 20, [10, 10], [30, 10]], // special case: when at the circle return a point on the x axis
      ['inside', [10, 10], 20, [10, 20], [10, 30]],
      ['outside', [10, 10], 20, [10, 50], [10, 30]],
      ['angled', [10, 10], 20, [50, 50], [24, 24]],
    ];
    for (const [name, c, r, p, exp] of cases)
      expect(C(c, r).NearestPoint(V(p)), name).toEqual(V(exp));
  });

  it('IntersectCircle', () => {
    const cases: [string, P, number, P, number, P[]][] = [
      [
        'two point aligned',
        [10, 10],
        20,
        [10, 45],
        20,
        [
          [0, 27],
          [21, 27],
        ],
      ],
      [
        'two point angled',
        [10, 10],
        20,
        [20, 20],
        20,
        [
          [2, 28],
          [28, 2],
        ],
      ],
      ['tangent aligned, external', [10, 10], 20, [10, 50], 20, [[10, 30]]],
      ['tangent aligned, internal', [10, 10], 40, [10, 30], 20, [[10, 50]]],
      ['no intersection', [10, 10], 20, [10, 51], 20, []],
      ['KiROUND overflow 1', [44798001, -94001999], 200001, [44797999, -94001999], 650001, []],
      ['KiROUND overflow 2', [50747999, -92402001], 650001, [50748001, -92402001], 200001, []],
      ['KiROUND overflow 3', [43947999, -92402001], 650001, [43948001, -92402001], 200001, []],
      ['KiROUND overflow 4', [46497999, -94001999], 200001, [46498001, -94001999], 650001, []],
      [
        'Co-centered, same radius',
        [205999999, 136367974],
        3742026,
        [205999999, 136367974],
        3742026,
        [],
      ], // Exercise d=0
    ];
    for (const [name, c1, r1, c2, r2, exp] of cases) {
      checkUnorderedMatches(exp, C(c1, r1).Intersect(C(c2, r2)), `${name} Case 1`);
      checkUnorderedMatches(exp, C(c2, r2).Intersect(C(c1, r1)), `${name} Case 2`);
    }
  });

  it('Intersect', () => {
    const cases: [string, P, number, P, P, P[]][] = [
      [
        'two point aligned',
        [0, 0],
        20,
        [10, -40],
        [10, 40],
        [
          [10, -17],
          [10, 17],
        ],
      ],
      [
        'two point angled',
        [0, 0],
        20,
        [-20, -40],
        [20, 40],
        [
          [8, 17],
          [-8, -17],
        ],
      ],
      ['tangent', [0, 0], 20, [20, 0], [20, 40], [[20, 0]]],
      ['no intersection', [0, 0], 20, [25, 0], [25, 40], []],
      ['no intersection: seg end points inside circle', [0, 0], 20, [0, 10], [0, -10], []],
    ];
    for (const [name, c, r, a, b, exp] of cases)
      checkUnorderedMatches(exp, C(c, r).Intersect(S(a, b)), name);
  });

  it('IntersectLine', () => {
    const cases: [string, P, number, P, P, P[]][] = [
      [
        'two point aligned',
        [0, 0],
        20,
        [10, 45],
        [10, 40],
        [
          [10, -17],
          [10, 17],
        ],
      ],
      [
        'two point angled',
        [0, 0],
        20,
        [-20, -40],
        [20, 40],
        [
          [8, 17],
          [-8, -17],
        ],
      ],
      ['tangent', [0, 0], 20, [20, 0], [20, 40], [[20, 0]]],
      ['no intersection', [0, 0], 20, [25, 0], [25, 40], []],
      [
        'intersection, seg end points inside circle',
        [0, 0],
        20,
        [0, 10],
        [0, -10],
        [
          [0, 20],
          [0, -20],
        ],
      ],
    ];
    for (const [name, c, r, a, b, exp] of cases)
      checkUnorderedMatches(exp, C(c, r).IntersectLine(S(a, b)), name);
  });

  it('ConstructFromTanTanPt', () => {
    const cases: [string, P, P, P, P, P, P, number][] = [
      [
        '90 degree segs, point on seg',
        [0, 0],
        [0, 1000],
        [0, 0],
        [1000, 0],
        [0, 400],
        [400, 400],
        400,
      ], // result from simple geometric inference
      [
        '90 degree segs, point floating',
        [0, 0],
        [0, 1000],
        [0, 0],
        [1000, 0],
        [200, 100],
        [500, 500],
        500,
      ], // result from LibreCAD 2.2.0-rc2
      [
        '45 degree segs, point on seg',
        [0, 0],
        [1000, 0],
        [0, 0],
        [1000, 1000],
        [400, 0],
        [400, 166],
        166,
      ], // result from LibreCAD 2.2.0-rc2
      [
        '45 degree segs, point floating',
        [0, 0],
        [1000000, 0],
        [0, 0],
        [1000000, 1000000],
        [200000, 100000],
        [332439, 137701],
        137701,
      ], // result from LibreCAD 2.2.0-rc2
      [
        '135 degree segs, point on seg',
        [0, 0],
        [1000000, 0],
        [0, 0],
        [-1000000, 1000000],
        [400000, 0],
        [400009, 965709],
        965709,
      ], // amended to get the test to pass
      [
        '135 degree segs, point floating',
        [0, 0],
        [1000, 0],
        [0, 0],
        [-1000, 1000],
        [200, 100],
        [814, 1964],
        1964,
      ], // amended to get the test to pass
      ['point on intersection', [10, 0], [1000, 0], [10, 0], [-1000, 1000], [10, 0], [10, 0], 0], // special case: radius=0
    ];
    for (const [name, a1, a2, b1, b2, pt, expC, expR] of cases) {
      const circle = new CIRCLE();
      circle.ConstructFromTanTanPt(S(a1, a2), S(b1, b2), V(pt));
      expect(
        compareVector2I(V(expC), circle.Center),
        `${name}: centre got (${circle.Center.x}, ${circle.Center.y})`,
      ).toBe(true);
      expect(compareLength(expR, circle.Radius), `${name}: radius got ${circle.Radius}`).toBe(true);
    }
  });
});
