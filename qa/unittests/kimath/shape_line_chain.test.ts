// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_shape_line_chain.cpp` (TestShapeLineChain),
 * transcribed against the `SHAPE_LINE_CHAIN` class.
 *
 * NOTE: Collision of SHAPE_LINE_CHAIN with arcs is tested in shape_arc.test.ts
 */
import { describe, expect, it } from 'vitest';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ANGLE_180 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import {
  CLIPPER_Z_VALUE,
  type Point64Z,
  SHAPE_LINE_CHAIN,
} from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { IsOutlineValid } from './geom_test_utils.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });
const P = (pts: [number, number][]): VECTOR2I[] => pts.map(([x, y]) => V(x, y));

class SLC_CASES {
  Circle1Arc = new SHAPE_LINE_CHAIN();
  Circle2Arcs = new SHAPE_LINE_CHAIN();
  ArcsCoincident = new SHAPE_LINE_CHAIN();
  ArcsCoincidentClosed: SHAPE_LINE_CHAIN;
  ArcsIndependent = new SHAPE_LINE_CHAIN();
  DuplicateArcs: SHAPE_LINE_CHAIN;
  ArcsAndSegMixed: SHAPE_LINE_CHAIN;
  ArcAndPoint = new SHAPE_LINE_CHAIN();
  SegAndArcCoincident = new SHAPE_LINE_CHAIN();
  EmptyChain = new SHAPE_LINE_CHAIN();
  OnePoint = new SHAPE_LINE_CHAIN();
  TwoPoints = new SHAPE_LINE_CHAIN();
  ThreePoints: SHAPE_LINE_CHAIN;

  ArcCircle: SHAPE_ARC; ///< Full Circle arc
  Arc0a: SHAPE_ARC; ///< First half of a circle
  Arc0b: SHAPE_ARC; ///< Second half of a circle
  Arc1: SHAPE_ARC; ///< start coincident with Arc0a end
  Arc2: SHAPE_ARC; ///< Independent arc
  Arc3: SHAPE_ARC; ///< Arc with angle >180

  constructor() {
    this.ArcCircle = new SHAPE_ARC(
      V(183450000, 128360000),
      V(183850000, 128360000),
      V(183450000, 128360000),
      0,
    );

    this.Arc0a = new SHAPE_ARC(
      V(183450000, 128360000),
      V(183650000, 128560000),
      V(183850000, 128360000),
      0,
    );

    this.Arc0b = new SHAPE_ARC(
      V(183850000, 128360000),
      V(183650000, 128160000),
      V(183450000, 128360000),
      0,
    );

    this.Arc1 = new SHAPE_ARC(
      V(183850000, 128360000),
      V(183638550, 128640305),
      V(183500000, 129204974),
      0,
    );

    this.Arc2 = new SHAPE_ARC(
      V(283450000, 228360000),
      V(283650000, 228560000),
      V(283850000, 228360000),
      0,
    );

    this.Arc3 = new SHAPE_ARC(V(0, 0), V(24142136, 10000000), V(0, 20000000), 0);

    this.Circle1Arc.Append(this.ArcCircle, ARC_HIGH_DEF);
    this.Circle1Arc.SetClosed(true);

    this.Circle2Arcs.Append(this.Arc0a, ARC_HIGH_DEF);
    this.Circle2Arcs.Append(this.Arc0b, ARC_HIGH_DEF);
    this.Circle2Arcs.SetClosed(true);

    this.ArcsCoincident.Append(this.Arc0a, ARC_HIGH_DEF);
    this.ArcsCoincident.Append(this.Arc1, ARC_HIGH_DEF);

    this.ArcsCoincidentClosed = new SHAPE_LINE_CHAIN(this.ArcsCoincident);
    this.ArcsCoincidentClosed.SetClosed(true);

    this.ArcsIndependent.Append(this.Arc0a, ARC_HIGH_DEF);
    this.ArcsIndependent.Append(this.Arc2, ARC_HIGH_DEF);

    this.DuplicateArcs = new SHAPE_LINE_CHAIN(this.ArcsCoincident);
    this.DuplicateArcs.Append(this.Arc1, ARC_HIGH_DEF); // should add a segment between end of the chain
    // and new copy of the arc

    this.ArcAndPoint.Append(this.Arc0a, ARC_HIGH_DEF);
    this.ArcAndPoint.Append(V(233450000, 228360000));

    this.ArcsAndSegMixed = new SHAPE_LINE_CHAIN(this.ArcAndPoint);
    this.ArcsAndSegMixed.Append(this.Arc2, ARC_HIGH_DEF);

    this.OnePoint.Append(V(233450000, 228360000));

    this.TwoPoints.Append(V(233450000, 228360000));
    this.TwoPoints.Append(V(263450000, 258360000));

    this.ThreePoints = new SHAPE_LINE_CHAIN(this.TwoPoints);
    this.ThreePoints.Append(V(263450000, 308360000));

    this.SegAndArcCoincident.Append(V(0, 20000000));
    this.SegAndArcCoincident.Append(this.Arc3, ARC_HIGH_DEF);
  }
}

describe('TestShapeLineChain', () => {
  const F = new SLC_CASES();

  it('ClipperConstructorCase1', () => {
    // Case of an arc followed by a segment
    // The clipper path is not in order (on purpose), to simulate the typical return from clipper

    const raw: [number, number, number][] = [
      [125663951, 120099260, 24],
      [125388111, 120170850, 25],
      [125124975, 120280270, 26],
      [124879705, 120425376, 27],
      [124657110, 120603322, 28],
      [124461556, 120810617, 29],
      [124296876, 121043198, 30],
      [124166301, 121296503, 31],
      [124072391, 121565564, 32],
      [124016988, 121845106, 33],
      [124001177, 122129646, 34],
      [124025270, 122413605, 35],
      [124088794, 122691414, 36],
      [124190502, 122957625, 37],
      [124328401, 123207018, 38],
      [124499787, 123434703, 39],
      [124598846, 123537154, 40],
      [127171000, 123786000, 4],
      [127287862, 123704439, 5],
      [127499716, 123513831, 6],
      [127682866, 123295498, 7],
      [127833720, 123053722, 8],
      [127949321, 122793242, 9],
      [128027402, 122519168, 10],
      [128066430, 122236874, 11],
      [128065642, 121951896, 12],
      [128025053, 121669823, 13],
      [127945457, 121396185, 14],
      [127828417, 121136349, 15],
      [127676227, 120895410, 16],
      [127491873, 120678094, 17],
      [127278968, 120488661, 18],
      [127041689, 120330827, 19],
      [126784688, 120207687, 20],
      [126513005, 120121655, 21],
      [126231968, 120074419, 22],
      [125947087, 120066905, 23],
    ];
    const pathClipper2: Point64Z[] = raw.map(([x, y, z]) => ({ x, y, z }));

    const zv = (first: number, second: number): CLIPPER_Z_VALUE => {
      const z = new CLIPPER_Z_VALUE([first, second], 0);
      return z;
    };
    const z_values: CLIPPER_Z_VALUE[] = [zv(-1, -1), zv(-1, -1), zv(-1, -1), zv(-1, -1)];
    for (let i = 0; i < 37; i++) z_values.push(zv(0, -1));

    const arcs: SHAPE_ARC[] = [
      new SHAPE_ARC(V(127171000, 123786000), V(126231718, 120077003), V(124598846, 123537154), 0),
    ];

    const clipper2chain = new SHAPE_LINE_CHAIN(pathClipper2, z_values, arcs);

    expect(IsOutlineValid(clipper2chain)).toBe(true);

    expect(clipper2chain.PointCount()).toBe(37);

    expect(clipper2chain.ArcCount()).toBe(1);

    expect(clipper2chain.ShapeCount()).toBe(2);

    expect(clipper2chain.IsClosed()).toBe(true);
  });

  it('ArcToPolyline', () => {
    const base_chain = new SHAPE_LINE_CHAIN([V(0, 0), V(0, 1000), V(1000, 0)]);

    const chain_insert = new SHAPE_LINE_CHAIN([V(0, 1500), V(1500, 1500), V(1500, 0)]);

    const arc_insert1 = new SHAPE_LINE_CHAIN(
      new SHAPE_ARC(V(0, -100), V(0, -200), ANGLE_180),
      false,
      ARC_HIGH_DEF,
    );

    const arc_insert2 = new SHAPE_LINE_CHAIN(
      new SHAPE_ARC(V(0, 500), V(0, 400), ANGLE_180),
      false,
      ARC_HIGH_DEF,
    );

    expect(base_chain.CShapes().length).toBe(base_chain.CPoints().length);
    expect(arc_insert1.CShapes().length).toBe(arc_insert1.CPoints().length);
    expect(arc_insert2.CShapes().length).toBe(arc_insert2.CPoints().length);

    expect(IsOutlineValid(base_chain)).toBe(true);
    expect(IsOutlineValid(arc_insert1)).toBe(true);
    expect(IsOutlineValid(arc_insert2)).toBe(true);

    base_chain.Insert(0, new SHAPE_ARC(V(0, -100), V(0, -200), ANGLE_180), ARC_HIGH_DEF);
    expect(IsOutlineValid(base_chain)).toBe(true);
    expect(base_chain.CShapes().length).toBe(base_chain.CPoints().length);

    base_chain.Replace(0, 2, chain_insert);
    expect(IsOutlineValid(base_chain)).toBe(true);
    expect(base_chain.CShapes().length).toBe(base_chain.CPoints().length);
  });

  // Similar test to above but with larger coordinates, so we have more than one point per arc
  it('ArcToPolylineLargeCoords', () => {
    const base_chain = new SHAPE_LINE_CHAIN([V(0, 0), V(0, 100000), V(100000, 0)]);

    const chain_insert = new SHAPE_LINE_CHAIN([V(0, 1500000), V(1500000, 1500000), V(1500000, 0)]);

    base_chain.Append(new SHAPE_ARC(V(200000, 0), V(300000, 100000), ANGLE_180), ARC_HIGH_DEF);

    expect(IsOutlineValid(base_chain)).toBe(true);
    expect(base_chain.PointCount()).toBe(11);

    base_chain.Insert(9, V(250000, 0));
    expect(IsOutlineValid(base_chain)).toBe(true);
    expect(base_chain.PointCount()).toBe(12);
    expect(base_chain.ArcCount()).toBe(2); // Should have two arcs after the split

    base_chain.Replace(5, 6, chain_insert);
    expect(IsOutlineValid(base_chain)).toBe(true);
    expect(base_chain.PointCount()).toBe(13); // Adding 3 points, removing 2
    expect(base_chain.ArcCount()).toBe(3); // Should have three arcs after the split

    base_chain.Replace(4, 6, V(550000, 0));
    expect(IsOutlineValid(base_chain)).toBe(true);
    expect(base_chain.PointCount()).toBe(11); // Adding 1 point, removing 3
    expect(base_chain.ArcCount()).toBe(3); // Should still have three arcs

    // Test ClearArcs
    base_chain.SetClosed(true);
    const areaPriorToArcRemoval = base_chain.Area();
    base_chain.ClearArcs();

    expect(IsOutlineValid(base_chain)).toBe(true);
    expect(base_chain.CPoints().length).toBe(base_chain.CShapes().length);
    expect(base_chain.PointCount()).toBe(11); // We should have the same number of points
    expect(base_chain.ArcCount()).toBe(0); // All arcs should have been removed
    expect(base_chain.Area()).toBe(areaPriorToArcRemoval); // Area should not have changed
  });

  // Test that duplicate point gets removed when line is set to be closed and added where required
  it('SetClosedDuplicatePoint', () => {
    // Test from issue #9843
    const chain = new SHAPE_LINE_CHAIN();

    chain.Append(
      new SHAPE_ARC(V(-859598, 2559876), V(-1632771, 1022403), V(-3170244, 249230), 0),
      ARC_HIGH_DEF,
    );

    chain.Append(
      new SHAPE_ARC(V(-3170244, -1657832), V(-292804, -317564), V(1047464, 2559876), 0),
      ARC_HIGH_DEF,
    );

    chain.Append(V(-859598, 2559876)); // add point that is equal to first arc start

    expect(IsOutlineValid(chain)).toBe(true);
    expect(chain.PointCount()).toBe(31);

    // CLOSED CHAIN
    chain.SetClosed(true);
    expect(chain.CPoints().length).toBe(chain.CShapes().length);
    expect(chain.PointCount()).toBe(30); // (-1) should have removed coincident points
    expect(IsOutlineValid(chain)).toBe(true);

    // Special case: arc wrapping around to start (e.g. circle)
    const Circle2Arcs = new SHAPE_LINE_CHAIN(F.Circle2Arcs);
    expect(IsOutlineValid(Circle2Arcs)).toBe(true);
    expect(Circle2Arcs.IsClosed()).toBe(true);
    expect(Circle2Arcs.PointCount()).toBe(16);
    expect(Circle2Arcs.IsArcSegment(15)).toBe(true);
    expect(Circle2Arcs.ShapeCount()).toBe(2);
    Circle2Arcs.SetClosed(false);
    expect(IsOutlineValid(Circle2Arcs)).toBe(true);
    expect(Circle2Arcs.IsClosed()).toBe(false);
    expect(Circle2Arcs.PointCount()).toBe(17);
    expect(Circle2Arcs.IsArcSegment(15)).toBe(true);
    expect(Circle2Arcs.IsArcSegment(16)).toBe(false); // last point doesn't join up
  });

  interface CLOSE_TOGGLE_SHAPE_CASE {
    m_ctx_name: string;
    m_chain: SHAPE_LINE_CHAIN;
    m_closed: boolean;
    m_shape_count: number;
    m_point_count: number;
    m_expected_shape_count: number;
    m_expected_point_count: number;
  }

  const tc = (
    name: string,
    chain: SHAPE_LINE_CHAIN,
    closed: boolean,
    sc: number,
    pc: number,
    esc: number,
    epc: number,
  ): CLOSE_TOGGLE_SHAPE_CASE => ({
    m_ctx_name: name,
    m_chain: chain,
    m_closed: closed,
    m_shape_count: sc,
    m_point_count: pc,
    m_expected_shape_count: esc,
    m_expected_point_count: epc,
  });

  const close_toggle_shape_cases: CLOSE_TOGGLE_SHAPE_CASE[] = [
    tc('Circle1Arc', new SLC_CASES().Circle1Arc, true, 1, 15, 1, 16),
    tc('Circle2Arcs', new SLC_CASES().Circle2Arcs, true, 2, 16, 2, 17),
    tc('ArcsCoincident', new SLC_CASES().ArcsCoincident, false, 2, 14, 3, 14),
    tc('ArcsCoincidentClosed', new SLC_CASES().ArcsCoincidentClosed, true, 3, 14, 2, 14),
    tc('ArcsIndependent', new SLC_CASES().ArcsIndependent, false, 3, 18, 4, 18),
    // SegAndArcCoincident will remove the segment after SetClosed(true) and SetClosed(false)
    // disable test for now
    //tc( "SegAndArcCoincident",  new SLC_CASES().SegAndArcCoincident,  false, 2, 92, 2, 91 ),
    tc('DuplicateArcs', new SLC_CASES().DuplicateArcs, false, 4, 20, 5, 20),
    tc('ArcAndPoint', new SLC_CASES().ArcAndPoint, false, 2, 10, 3, 10),
    tc('ArcsAndSegMixed', new SLC_CASES().ArcsAndSegMixed, false, 4, 19, 5, 19),
    tc('OnePoint', new SLC_CASES().OnePoint, false, 0, 1, 0, 1), // no shapes
    tc('TwoPoints', new SLC_CASES().TwoPoints, false, 1, 2, 2, 2), // there and back
    tc('ThreePoints', new SLC_CASES().ThreePoints, false, 2, 3, 3, 3),
  ];

  it('ToggleClosed', () => {
    for (const c of close_toggle_shape_cases) {
      const ctx = c.m_ctx_name;
      const slc_case = new SHAPE_LINE_CHAIN(c.m_chain); // make a copy to edit
      expect(IsOutlineValid(slc_case), ctx).toBe(true);
      expect(slc_case.IsClosed(), ctx).toBe(c.m_closed);
      expect(slc_case.ShapeCount(), ctx).toBe(c.m_shape_count);
      expect(slc_case.PointCount(), ctx).toBe(c.m_point_count);
      slc_case.SetClosed(!c.m_closed);
      expect(IsOutlineValid(slc_case), ctx).toBe(true);
      expect(slc_case.IsClosed(), ctx).toBe(!c.m_closed);
      expect(slc_case.ShapeCount(), ctx).toBe(c.m_expected_shape_count);
      expect(slc_case.PointCount(), ctx).toBe(c.m_expected_point_count);
      slc_case.SetClosed(c.m_closed); // toggle back to normal
      expect(IsOutlineValid(slc_case), ctx).toBe(true);
      expect(slc_case.IsClosed(), ctx).toBe(c.m_closed);
      expect(slc_case.ShapeCount(), ctx).toBe(c.m_shape_count);
      expect(slc_case.PointCount(), ctx).toBe(c.m_point_count);
    }
  });

  it('PointInPolygon', () => {
    const outline1 = new SHAPE_LINE_CHAIN(
      P([
        [1316455, 913576],
        [1316455, 901129],
        [1321102, 901129],
        [1322152, 901191],
        [1323055, 901365],
        [1323830, 901639],
        [1324543, 902036],
        [1325121, 902521],
        [1325581, 903100],
        [1325914, 903759],
        [1326120, 904516],
        [1326193, 905390],
        [1326121, 906253],
        [1325915, 907005],
        [1325581, 907667],
        [1325121, 908248],
        [1324543, 908735],
        [1323830, 909132],
        [1323055, 909406],
        [1322153, 909579],
        [1321102, 909641],
        [1317174, 909641],
        [1317757, 909027],
        [1317757, 913576],
      ]),
    );
    const outline2 = new SHAPE_LINE_CHAIN(
      P([
        [1297076, 916244],
        [1284629, 916244],
        [1284629, 911597],
        [1284691, 910547],
        [1284865, 909644],
        [1285139, 908869],
        [1285536, 908156],
        [1286021, 907578],
        [1286600, 907118],
        [1287259, 906785],
        [1288016, 906579],
        [1288890, 906506],
        [1289753, 906578],
        [1290505, 906784],
        [1291167, 907118],
        [1291748, 907578],
        [1292235, 908156],
        [1292632, 908869],
        [1292906, 909644],
        [1293079, 910546],
        [1293141, 911597],
        [1293141, 915525],
        [1292527, 914942],
        [1297076, 914942],
      ]),
    );

    // Test a point inside the polygon
    const point1 = V(1317757, 909133);
    const point2 = V(1292633, 914942);

    outline1.SetClosed(true);
    outline2.SetClosed(true);

    expect(outline1.PointInside(point1, 0, false)).toBe(true);
    expect(outline2.PointInside(point2, 0, false)).toBe(true);
  });

  // Test that duplicate point gets removed when we call simplify
  it('SimplifyDuplicatePoint', () => {
    const chain = new SHAPE_LINE_CHAIN();

    chain.Append(V(100, 100));
    chain.Append(V(100, 100), true); //duplicate point to simplify
    chain.Append(V(200, 100));

    expect(IsOutlineValid(chain)).toBe(true);
    expect(chain.PointCount()).toBe(3);

    chain.Simplify();

    expect(chain.CPoints().length).toBe(chain.CShapes().length);
    expect(chain.PointCount()).toBe(2); // (-1) should have removed coincident points
    expect(IsOutlineValid(chain)).toBe(true);
  });

  // Test that duplicate point gets removed when we call simplify
  it('SimplifyKeepEndPoint', () => {
    const chain = new SHAPE_LINE_CHAIN();

    chain.Append(V(114772424, 90949410));
    chain.Append(V(114767360, 90947240));
    chain.Append(V(114772429, 90947228));
    chain.SetClosed(true);

    expect(IsOutlineValid(chain)).toBe(true);
    expect(chain.PointCount()).toBe(3);

    chain.Simplify();

    expect(chain.CPoints().length).toBe(chain.CShapes().length);
    expect(chain.PointCount()).toBe(3);
    expect(IsOutlineValid(chain)).toBe(true);
  });

  it('SimplifyPNSChain', () => {
    const chain = new SHAPE_LINE_CHAIN();
    chain.Append(V(157527820, 223074385));
    chain.Append(V(186541122, 159990156));
    chain.Append(V(186528624, 159977658));
    chain.Append(V(186528624, 159770550));
    chain.Append(V(186528625, 159366691));
    chain.Append(V(186541122, 159354195));
    chain.Append(V(186541122, 155566877));
    chain.Append(V(187291125, 154816872));
    chain.Append(V(187291125, 147807837));
    chain.Append(V(189301788, 145797175));
    chain.Append(V(194451695, 145797175));
    chain.Append(V(195021410, 146366890));

    expect(IsOutlineValid(chain)).toBe(true);
    expect(chain.PointCount()).toBe(12);

    // The chain should be open, so the points should not be simplified
    // between the begining and the end.
    chain.Simplify(10);

    expect(chain.PointCount()).toBe(11);
  });

  it('SimplifyComplexChain', () => {
    const chain = new SHAPE_LINE_CHAIN();

    // Append points
    chain.Append(V(130000, 147320));
    chain.Append(V(125730, 147320));
    chain.Append(V(125730, 150630));
    chain.Append(V(128800, 153700));
    chain.Append(V(150300, 153700));
    chain.Append(V(151500, 152500));
    chain.Append(V(151500, 148900));
    chain.Append(V(149920, 147320));
    chain.Append(V(140000, 147320));

    expect(IsOutlineValid(chain)).toBe(true);
    expect(chain.PointCount()).toBe(9);

    // The chain should be open, so the points should not be simplified
    // between the begining and the end.
    chain.Simplify();

    expect(chain.PointCount()).toBe(9);

    chain.SetClosed(true);
    chain.Simplify();

    expect(chain.PointCount()).toBe(8);
  });

  interface REMOVE_SHAPE_CASE {
    m_ctx_name: string;
    m_chain: SHAPE_LINE_CHAIN;
    m_shape_count: number;
    m_arc_count: number;
    m_remove_index: number;
    m_expected_shape_count: number;
    m_expected_arc_count: number;
  }

  const rc = (
    name: string,
    chain: SHAPE_LINE_CHAIN,
    sc: number,
    ac: number,
    idx: number,
    esc: number,
    eac: number,
  ): REMOVE_SHAPE_CASE => ({
    m_ctx_name: name,
    m_chain: chain,
    m_shape_count: sc,
    m_arc_count: ac,
    m_remove_index: idx,
    m_expected_shape_count: esc,
    m_expected_arc_count: eac,
  });

  const remove_shape_cases: REMOVE_SHAPE_CASE[] = [
    rc('Circle1Arc - 1st arc - index on start', new SLC_CASES().Circle1Arc, 1, 1, 0, 0, 0),
    rc('Circle1Arc - 1st arc - index on mid', new SLC_CASES().Circle1Arc, 1, 1, 8, 0, 0),
    rc('Circle1Arc - 1st arc - index on end', new SLC_CASES().Circle1Arc, 1, 1, 14, 0, 0),
    rc('Circle1Arc - 1st arc - index on  -1', new SLC_CASES().Circle1Arc, 1, 1, -1, 0, 0),
    rc('Circle1Arc - invalid index', new SLC_CASES().Circle1Arc, 1, 1, 15, 1, 1),

    rc('Circle2Arcs - 1st arc - index on start', new SLC_CASES().Circle2Arcs, 2, 2, 0, 2, 1),
    rc('Circle2Arcs - 1st arc - index on mid', new SLC_CASES().Circle2Arcs, 2, 2, 3, 2, 1),
    rc('Circle2Arcs - 1st arc - index on end', new SLC_CASES().Circle2Arcs, 2, 2, 7, 2, 1),
    rc('Circle2Arcs - 2nd arc - index on start', new SLC_CASES().Circle2Arcs, 2, 2, 8, 2, 1),
    rc('Circle2Arcs - 2nd arc - index on mid', new SLC_CASES().Circle2Arcs, 2, 2, 11, 2, 1),
    rc('Circle2Arcs - 2nd arc - index on end', new SLC_CASES().Circle2Arcs, 2, 2, 15, 2, 1),
    rc('Circle2Arcs - 2nd arc - index on  -1', new SLC_CASES().Circle2Arcs, 2, 2, -1, 2, 1),
    rc('Circle2Arcs - invalid index', new SLC_CASES().Circle2Arcs, 2, 2, 16, 2, 2),

    rc('ArcsCoinc. - 1st arc - idx on start', new SLC_CASES().ArcsCoincident, 2, 2, 0, 1, 1),
    rc('ArcsCoinc. - 1st arc - idx on mid', new SLC_CASES().ArcsCoincident, 2, 2, 3, 1, 1),
    rc('ArcsCoinc. - 1st arc - idx on end', new SLC_CASES().ArcsCoincident, 2, 2, 7, 1, 1),
    rc('ArcsCoinc. - 2nd arc - idx on start', new SLC_CASES().ArcsCoincident, 2, 2, 8, 1, 1),
    rc('ArcsCoinc. - 2nd arc - idx on mid', new SLC_CASES().ArcsCoincident, 2, 2, 10, 1, 1),
    rc('ArcsCoinc. - 2nd arc - idx on end', new SLC_CASES().ArcsCoincident, 2, 2, 13, 1, 1),
    rc('ArcsCoinc. - 2nd arc - idx on  -1', new SLC_CASES().ArcsCoincident, 2, 2, -1, 1, 1),
    rc('ArcsCoinc. - invalid idx', new SLC_CASES().ArcsCoincident, 2, 2, 14, 2, 2),
    rc('ArcsCoinc. - 1st arc - idx on start', new SLC_CASES().ArcsCoincident, 2, 2, 0, 1, 1),

    rc('A.Co.Closed - 1st arc - idx on start', new SLC_CASES().ArcsCoincidentClosed, 3, 2, 1, 2, 1),
    rc('A.Co.Closed - 1st arc - idx on mid', new SLC_CASES().ArcsCoincidentClosed, 3, 2, 3, 2, 1),
    rc('A.Co.Closed - 1st arc - idx on end', new SLC_CASES().ArcsCoincidentClosed, 3, 2, 7, 2, 1),
    rc('A.Co.Closed - 2nd arc - idx on start', new SLC_CASES().ArcsCoincidentClosed, 3, 2, 8, 2, 1),
    rc('A.Co.Closed - 2nd arc - idx on mid', new SLC_CASES().ArcsCoincidentClosed, 3, 2, 10, 2, 1),
    rc('A.Co.Closed - 2nd arc - idx on end', new SLC_CASES().ArcsCoincidentClosed, 3, 2, 13, 2, 1),
    rc('A.Co.Closed - 2nd arc - idx on  -1', new SLC_CASES().ArcsCoincidentClosed, 3, 2, -1, 2, 1),
    rc('A.Co.Closed - invalid idx', new SLC_CASES().ArcsCoincidentClosed, 3, 2, 14, 3, 2),

    rc('ArcsIndep. - 1st arc - idx on start', new SLC_CASES().ArcsIndependent, 3, 2, 0, 1, 1),
    rc('ArcsIndep. - 1st arc - idx on mid', new SLC_CASES().ArcsIndependent, 3, 2, 3, 1, 1),
    rc('ArcsIndep. - 1st arc - idx on end', new SLC_CASES().ArcsIndependent, 3, 2, 8, 1, 1),
    rc('ArcsIndep. - 2nd arc - idx on start', new SLC_CASES().ArcsIndependent, 3, 2, 9, 1, 1),
    rc('ArcsIndep. - 2nd arc - idx on mid', new SLC_CASES().ArcsIndependent, 3, 2, 12, 1, 1),
    rc('ArcsIndep. - 2nd arc - idx on end', new SLC_CASES().ArcsIndependent, 3, 2, 17, 1, 1),
    rc('ArcsIndep. - 2nd arc - idx on  -1', new SLC_CASES().ArcsIndependent, 3, 2, -1, 1, 1),
    rc('ArcsIndep. - invalid idx', new SLC_CASES().ArcsIndependent, 3, 2, 18, 3, 2),

    rc('Dup.Arcs - 1st arc - idx on start', new SLC_CASES().DuplicateArcs, 4, 3, 0, 3, 2),
    rc('Dup.Arcs - 1st arc - idx on mid', new SLC_CASES().DuplicateArcs, 4, 3, 3, 3, 2),
    rc('Dup.Arcs - 1st arc - idx on end', new SLC_CASES().DuplicateArcs, 4, 3, 7, 3, 2),
    rc('Dup.Arcs - 2nd arc - idx on start', new SLC_CASES().DuplicateArcs, 4, 3, 8, 3, 2),
    rc('Dup.Arcs - 2nd arc - idx on mid', new SLC_CASES().DuplicateArcs, 4, 3, 10, 3, 2),
    rc('Dup.Arcs - 2nd arc - idx on end', new SLC_CASES().DuplicateArcs, 4, 3, 13, 3, 2),
    rc('Dup.Arcs - 3rd arc - idx on start', new SLC_CASES().DuplicateArcs, 4, 3, 14, 2, 2),
    rc('Dup.Arcs - 3rd arc - idx on mid', new SLC_CASES().DuplicateArcs, 4, 3, 17, 2, 2),
    rc('Dup.Arcs - 3rd arc - idx on end', new SLC_CASES().DuplicateArcs, 4, 3, 19, 2, 2),
    rc('Dup.Arcs - 3rd arc - idx on  -1', new SLC_CASES().DuplicateArcs, 4, 3, -1, 2, 2),
    rc('Dup.Arcs - invalid idx', new SLC_CASES().DuplicateArcs, 4, 3, 20, 4, 3),

    rc('Arcs Mixed - 1st arc - idx on start', new SLC_CASES().ArcsAndSegMixed, 4, 2, 0, 2, 1),
    rc('Arcs Mixed - 1st arc - idx on mid', new SLC_CASES().ArcsAndSegMixed, 4, 2, 3, 2, 1),
    rc('Arcs Mixed - 1st arc - idx on end', new SLC_CASES().ArcsAndSegMixed, 4, 2, 8, 2, 1),
    rc('Arcs Mixed - Straight segment', new SLC_CASES().ArcsAndSegMixed, 4, 2, 9, 3, 2),
    rc('Arcs Mixed - 2nd arc - idx on start', new SLC_CASES().ArcsAndSegMixed, 4, 2, 10, 2, 1),
    rc('Arcs Mixed - 2nd arc - idx on mid', new SLC_CASES().ArcsAndSegMixed, 4, 2, 14, 2, 1),
    rc('Arcs Mixed - 2nd arc - idx on end', new SLC_CASES().ArcsAndSegMixed, 4, 2, 18, 2, 1),
    rc('Arcs Mixed - 2nd arc - idx on  -1', new SLC_CASES().ArcsAndSegMixed, 4, 2, -1, 2, 1),
    rc('Arcs Mixed - invalid idx', new SLC_CASES().ArcsAndSegMixed, 4, 2, 19, 4, 2),
  ];

  it('RemoveShape', () => {
    for (const c of remove_shape_cases) {
      const ctx = c.m_ctx_name;
      const slc_case = new SHAPE_LINE_CHAIN(c.m_chain); // make a copy to edit
      expect(slc_case.ShapeCount(), ctx).toBe(c.m_shape_count);
      expect(slc_case.ArcCount(), ctx).toBe(c.m_arc_count);
      expect(IsOutlineValid(slc_case), ctx).toBe(true);
      slc_case.RemoveShape(c.m_remove_index);
      expect(slc_case.ShapeCount(), ctx).toBe(c.m_expected_shape_count);
      expect(slc_case.ArcCount(), ctx).toBe(c.m_expected_arc_count);
      expect(IsOutlineValid(slc_case), ctx).toBe(true);
    }
  });

  it('RemoveShapeAfterSimplify', () => {
    for (const c of remove_shape_cases) {
      const ctx = c.m_ctx_name;
      const slc_case = new SHAPE_LINE_CHAIN(c.m_chain); // make a copy to edit
      expect(IsOutlineValid(slc_case), ctx).toBe(true);
      expect(slc_case.ShapeCount(), ctx).toBe(c.m_shape_count);
      expect(slc_case.ArcCount(), ctx).toBe(c.m_arc_count);
      slc_case.Simplify();
      expect(IsOutlineValid(slc_case), ctx).toBe(true);
      expect(slc_case.ShapeCount(), ctx).toBe(c.m_shape_count);
      expect(slc_case.ArcCount(), ctx).toBe(c.m_arc_count);
      slc_case.RemoveShape(c.m_remove_index);
      expect(IsOutlineValid(slc_case), ctx).toBe(true);
      expect(slc_case.ShapeCount(), ctx).toBe(c.m_expected_shape_count);
      expect(slc_case.ArcCount(), ctx).toBe(c.m_expected_arc_count);
    }
  });

  it('ShapeCount', () => {
    expect(F.Circle1Arc.ShapeCount()).toBe(1);
    expect(F.Circle2Arcs.ShapeCount()).toBe(2);
    expect(F.ArcsCoincident.ShapeCount()).toBe(2);
    expect(F.ArcsCoincidentClosed.ShapeCount()).toBe(3);
    expect(F.DuplicateArcs.ShapeCount()).toBe(4);
    expect(F.ArcAndPoint.ShapeCount()).toBe(2);
    expect(F.ArcsAndSegMixed.ShapeCount()).toBe(4);
    expect(F.SegAndArcCoincident.ShapeCount()).toBe(2);
    expect(F.EmptyChain.ShapeCount()).toBe(0);
    expect(F.OnePoint.ShapeCount()).toBe(0);
    expect(F.TwoPoints.ShapeCount()).toBe(1);
    expect(F.ThreePoints.ShapeCount()).toBe(2);
  });

  it('NextShape', () => {
    expect(F.Circle1Arc.NextShape(0)).toBe(-1); //only one arc

    expect(F.Circle2Arcs.NextShape(0)).toBe(8); // next shape "Arc0b"
    expect(F.Circle2Arcs.NextShape(8)).toBe(-1); //no more shapes (last point joins with first, part of arc)

    expect(F.ArcsCoincident.NextShape(0)).toBe(8); // next shape "Arc1"
    expect(F.ArcsCoincident.NextShape(8)).toBe(-1); //no more shapes

    expect(F.ArcsCoincidentClosed.NextShape(0)).toBe(8); // next shape "Arc1"
    expect(F.ArcsCoincidentClosed.NextShape(8)).toBe(13); //next shape is hidden segment joining last/first
    expect(F.ArcsCoincidentClosed.NextShape(13)).toBe(-1); //no more shapes

    expect(F.ArcsIndependent.NextShape(0)).toBe(8); // next shape straight seg
    expect(F.ArcsIndependent.NextShape(8)).toBe(9); //next shape second arc
    expect(F.ArcsIndependent.NextShape(9)).toBe(-1); //no more shapes

    expect(F.DuplicateArcs.NextShape(0)).toBe(8); // next shape "Arc1"
    expect(F.DuplicateArcs.NextShape(8)).toBe(13); // next shape hidden segment joining the 2 duplicate arcs
    expect(F.DuplicateArcs.NextShape(13)).toBe(14); // next shape "Arc1" (duplicate)
    expect(F.DuplicateArcs.NextShape(14)).toBe(-1); //no more shapes

    expect(F.ArcAndPoint.NextShape(0)).toBe(8); // next shape straight segment (end of arc->point)
    expect(F.ArcAndPoint.NextShape(8)).toBe(-1); //no more shapes

    expect(F.ArcsAndSegMixed.NextShape(0)).toBe(8); // next shape straight segment (end of arc->point)
    expect(F.ArcsAndSegMixed.NextShape(8)).toBe(9); // next shape straight segment (point->begining of arc)
    expect(F.ArcsAndSegMixed.NextShape(9)).toBe(10); //next shape second arc
    expect(F.ArcsAndSegMixed.NextShape(10)).toBe(-1); //no more shapes
    expect(F.ArcsAndSegMixed.NextShape(20)).toBe(-1); //invalid indices should still work
    expect(F.ArcsAndSegMixed.NextShape(-50)).toBe(-1); //invalid indices should still work

    expect(F.SegAndArcCoincident.NextShape(0)).toBe(1); // next shape Arc3
    expect(F.SegAndArcCoincident.NextShape(1)).toBe(-1); //no more shapes

    expect(F.EmptyChain.NextShape(0)).toBe(-1);
    expect(F.EmptyChain.NextShape(1)).toBe(-1); //invalid indices should still work
    expect(F.EmptyChain.NextShape(2)).toBe(-1); //invalid indices should still work
    expect(F.EmptyChain.NextShape(-2)).toBe(-1); //invalid indices should still work

    expect(F.OnePoint.NextShape(0)).toBe(-1);
    expect(F.OnePoint.NextShape(-1)).toBe(-1);
    expect(F.OnePoint.NextShape(1)).toBe(-1); //invalid indices should still work
    expect(F.OnePoint.NextShape(2)).toBe(-1); //invalid indices should still work
    expect(F.OnePoint.NextShape(-2)).toBe(-1); //invalid indices should still work

    expect(F.TwoPoints.NextShape(0)).toBe(-1);
    expect(F.TwoPoints.NextShape(1)).toBe(-1);
    expect(F.TwoPoints.NextShape(-1)).toBe(-1);

    expect(F.ThreePoints.NextShape(0)).toBe(1);
    expect(F.ThreePoints.NextShape(1)).toBe(-1);
    expect(F.ThreePoints.NextShape(2)).toBe(-1);
    expect(F.ThreePoints.NextShape(-1)).toBe(-1);
  });

  it('AppendArc', () => {
    {
      // Case 1: Arc mid point nearly collinear
      const arc = new SHAPE_ARC(V(100000, 0), V(0, 2499), V(-100000, 0), 0);
      const chain = new SHAPE_LINE_CHAIN();
      chain.Append(arc, ARC_HIGH_DEF);
      expect(IsOutlineValid(chain)).toBe(true);
      expect(chain.ArcCount()).toBe(0);
      expect(chain.PointCount()).toBe(2);
      expect(chain.GetPoint(0)).toEqual(V(100000, 0)); //arc start
      expect(chain.GetPoint(1)).toEqual(V(-100000, 0)); //arc end
      expect(chain.GetPoint(-1)).toEqual(V(-100000, 0)); //arc end
    }

    {
      // Case 2: Arc = Large Circle
      const arc = new SHAPE_ARC(V(100000, 0), V(0, 0), V(100000, 0), 0);
      const chain = new SHAPE_LINE_CHAIN();
      chain.Append(arc, ARC_HIGH_DEF);
      expect(IsOutlineValid(chain)).toBe(true);
      expect(chain.ArcCount()).toBe(1);
      expect(chain.PointCount()).toBe(10);
      expect(chain.GetPoint(0)).toEqual(V(100000, 0)); //arc start
      expect(chain.GetPoint(9)).toEqual(V(100000, 0)); //arc end
      expect(chain.GetPoint(-1)).toEqual(V(100000, 0)); //arc end
    }

    {
      // Case 3: Arc = Small Circle (approximate to point)
      const arc = new SHAPE_ARC(V(2499, 0), V(0, 0), V(2499, 0), 0);
      const chain = new SHAPE_LINE_CHAIN();
      chain.Append(arc, ARC_HIGH_DEF);
      expect(IsOutlineValid(chain)).toBe(true);
      expect(chain.ArcCount()).toBe(0);
      expect(chain.PointCount()).toBe(1);
      expect(chain.GetPoint(0)).toEqual(V(2499, 0)); //arc start
    }

    {
      // Case 3: Small Arc (approximate to segment)
      const arc = new SHAPE_ARC(V(1767, 0), V(2499, 2499), V(0, 1767), 0);
      const chain = new SHAPE_LINE_CHAIN();
      chain.Append(arc, ARC_HIGH_DEF);
      expect(IsOutlineValid(chain)).toBe(true);
      expect(chain.ArcCount()).toBe(0);
      expect(chain.PointCount()).toBe(2);
      expect(chain.GetPoint(0)).toEqual(V(1767, 0)); //arc start
      expect(chain.GetPoint(1)).toEqual(V(0, 1767)); //arc end
    }

    {
      // Case 4: Arc = null arc (all points coincident)
      const arc = new SHAPE_ARC(V(2499, 0), V(2499, 0), V(2499, 0), 0);
      const chain = new SHAPE_LINE_CHAIN();
      chain.Append(arc, ARC_HIGH_DEF);
      expect(IsOutlineValid(chain)).toBe(true);
      expect(chain.ArcCount()).toBe(0);
      expect(chain.PointCount()).toBe(1);
      expect(chain.GetPoint(0)).toEqual(V(2499, 0)); //arc start
    }

    {
      // Case 5: Arc = infinite radius (all points very close)
      const arc = new SHAPE_ARC(V(2499, 0), V(2500, 0), V(2501, 0), 0);
      const chain = new SHAPE_LINE_CHAIN();
      chain.Append(arc, ARC_HIGH_DEF);
      expect(IsOutlineValid(chain)).toBe(true);
      expect(chain.ArcCount()).toBe(0);
      expect(chain.PointCount()).toBe(2);
      expect(chain.GetPoint(0)).toEqual(V(2499, 0)); //arc start
      expect(chain.GetPoint(1)).toEqual(V(2501, 0)); //arc end
    }

    {
      // Case 6: Arc = large radius (all points very close)
      const arc = new SHAPE_ARC(V(-100000, 0), V(0, 1), V(100000, 0), 0);
      const chain = new SHAPE_LINE_CHAIN();
      chain.Append(arc, ARC_HIGH_DEF);
      expect(IsOutlineValid(chain)).toBe(true);
      expect(chain.ArcCount()).toBe(0);
      expect(chain.PointCount()).toBe(2);
      expect(chain.GetPoint(0)).toEqual(V(-100000, 0)); //arc start
      expect(chain.GetPoint(1)).toEqual(V(100000, 0)); //arc end
    }
  });

  // Test special case where the last arc in the chain has a shared point with the first arc
  it('ArcWrappingToStartSharedPoints', () => {
    // represent a circle with two semicircular arcs
    const arc1 = new SHAPE_ARC(V(100000, 0), V(0, 100000), V(-100000, 0), 0);
    const arc2 = new SHAPE_ARC(V(-100000, 0), V(0, -100000), V(100000, 0), 0);

    // Start a chain with the two arcs
    const chain = new SHAPE_LINE_CHAIN();
    chain.Append(arc1, ARC_HIGH_DEF);
    chain.Append(arc2, ARC_HIGH_DEF);
    expect(chain.PointCount()).toBe(13);
    //expect( IsOutlineValid( chain ) ).toBe(true);

    // OPEN CHAIN
    // Start of the chain is not yet a shared point, so can't be an arc end either
    expect(chain.IsSharedPt(0)).toBe(false);
    expect(chain.IsArcEnd(0)).toBe(false);
    expect(chain.IsArcStart(0)).toBe(true);

    // Index 6 is the shared point between the two arcs in the middle of the chain
    expect(chain.IsSharedPt(6)).toBe(true);
    expect(chain.IsArcEnd(6)).toBe(true);
    expect(chain.IsArcStart(6)).toBe(true);

    // End index is not yet a shared point
    let endIndex = chain.PointCount() - 1;
    expect(chain.IsSharedPt(endIndex)).toBe(false);
    expect(chain.IsArcEnd(endIndex)).toBe(true);
    expect(chain.IsArcStart(endIndex)).toBe(false);

    for (let i = 0; i < chain.PointCount(); i++) {
      expect(chain.IsPtOnArc(i)).toBe(true); // all points in the chain are arcs
    }

    // CLOSED CHAIN
    chain.SetClosed(true);
    expect(chain.PointCount()).toBe(12); // (-1) should have removed coincident points
    //expect( IsOutlineValid( chain ) ).toBe(true);

    // Start of the chain should be a shared point now, so can't be an arc end either
    expect(chain.IsSharedPt(0)).toBe(true);
    expect(chain.IsArcEnd(0)).toBe(true);
    expect(chain.IsArcStart(0)).toBe(true);

    // Index 6 is the shared point between the two arcs in the middle of the chain
    expect(chain.IsSharedPt(6)).toBe(true);
    expect(chain.IsArcEnd(6)).toBe(true);
    expect(chain.IsArcStart(6)).toBe(true);

    // End index is in the middle of an arc, so not an end point or shared point
    endIndex = chain.PointCount() - 1;
    expect(chain.IsSharedPt(endIndex)).toBe(false);
    expect(chain.IsArcEnd(endIndex)).toBe(false);
    expect(chain.IsArcStart(endIndex)).toBe(false);
  });

  // Test SHAPE_LINE_CHAIN::Split()
  it('Split', () => {
    const seg1 = new SEG(V(0, 100000), V(50000, 0));
    const seg2 = new SEG(V(200000, 0), V(300000, 0));
    const arc = new SHAPE_ARC(V(200000, 0), V(300000, 0), ANGLE_180);

    // Start a chain with 2 points (seg1)
    const chain = new SHAPE_LINE_CHAIN([seg1.A, seg1.B]);
    expect(chain.PointCount()).toBe(2);
    // Add first arc
    chain.Append(arc, ARC_HIGH_DEF);
    expect(chain.PointCount()).toBe(9);
    // Add two points (seg2)
    chain.Append(seg2.A);
    chain.Append(seg2.B);
    expect(chain.PointCount()).toBe(11);
    expect(IsOutlineValid(chain)).toBe(true);

    {
      // Case 1: Point not in the chain
      const chainCopy = new SHAPE_LINE_CHAIN(chain);
      expect(chainCopy.Split(V(400000, 0))).toBe(-1);
      expect(chainCopy.PointCount()).toBe(chain.PointCount());
      expect(chainCopy.ArcCount()).toBe(chain.ArcCount());
    }

    {
      // Case 2: Point close to start of a segment
      const chainCopy = new SHAPE_LINE_CHAIN(chain);
      const splitPoint = V(seg1.A.x + 5, seg1.A.y - 10);
      expect(chainCopy.Split(splitPoint)).toBe(1);
      expect(IsOutlineValid(chainCopy)).toBe(true);
      expect(chainCopy.GetPoint(1)).toEqual(splitPoint);
      expect(chainCopy.PointCount()).toBe(chain.PointCount() + 1); // new point added
      expect(chainCopy.ArcCount()).toBe(chain.ArcCount());
    }

    {
      // Case 3: Point exactly on the segment
      const chainCopy = new SHAPE_LINE_CHAIN(chain);
      const splitPoint = seg1.B;
      expect(chainCopy.Split(splitPoint)).toBe(1);
      expect(IsOutlineValid(chainCopy)).toBe(true);
      expect(chainCopy.GetPoint(1)).toEqual(splitPoint);
      expect(chainCopy.PointCount()).toBe(chain.PointCount());
      expect(chainCopy.ArcCount()).toBe(chain.ArcCount());
    }

    {
      // Case 4: Point at start of arc
      const chainCopy = new SHAPE_LINE_CHAIN(chain);
      const splitPoint = arc.GetP0();
      expect(chainCopy.Split(splitPoint)).toBe(2);
      expect(IsOutlineValid(chainCopy)).toBe(true);
      expect(chainCopy.GetPoint(2)).toEqual(splitPoint);
      expect(chainCopy.PointCount()).toBe(chain.PointCount());
      expect(chainCopy.ArcCount()).toBe(chain.ArcCount());
    }

    {
      // Case 5: Point close to start of arc
      const chainCopy = new SHAPE_LINE_CHAIN(chain);
      const splitPoint = V(arc.GetP0().x - 10, arc.GetP0().y + 130);
      expect(chainCopy.Split(splitPoint)).toBe(3);
      expect(IsOutlineValid(chainCopy)).toBe(true);
      expect(chainCopy.GetPoint(3)).toEqual(splitPoint);
      expect(chainCopy.IsSharedPt(3)).toBe(true); // must be a shared point
      expect(chainCopy.PointCount()).toBe(chain.PointCount() + 1); // new point added
      expect(chainCopy.ArcCount()).toBe(chain.ArcCount() + 1); // new arc should have been created
    }
  });

  // Test SHAPE_LINE_CHAIN::Slice()
  it('Slice', () => {
    const targetSegment = new SEG(V(200000, 0), V(300000, 0));
    const firstArc = new SHAPE_ARC(V(200000, 0), V(300000, 0), ANGLE_180);
    const secondArc = new SHAPE_ARC(V(-200000, -200000), V(-300000, -100000), ANGLE_180.negate());
    const tol = SHAPE_ARC.DefaultAccuracyForPCB(); // Tolerance for arc collisions

    // Start a chain with 3 points
    const chain = new SHAPE_LINE_CHAIN([V(0, 0), V(0, 100000), V(100000, 0)]);
    expect(chain.PointCount()).toBe(3);
    // Add first arc
    chain.Append(firstArc, ARC_HIGH_DEF);
    expect(chain.PointCount()).toBe(10);
    // Add two points (target segment)
    chain.Append(targetSegment.A);
    chain.Append(targetSegment.B);
    expect(chain.PointCount()).toBe(12);
    // Add a second arc
    chain.Append(secondArc, ARC_HIGH_DEF);
    expect(chain.PointCount()).toBe(20);
    expect(IsOutlineValid(chain)).toBe(true);

    {
      // CASE 1: Start at arc endpoint, finish middle of arc
      const ctx = 'Case 1';
      const sliceResult = chain.Slice(9, 18, ARC_HIGH_DEF);
      expect(IsOutlineValid(sliceResult), ctx).toBe(true);

      expect(sliceResult.ArcCount(), ctx).toBe(1);
      const expectedSliceArc0 = new SHAPE_ARC();
      expectedSliceArc0.ConstructFromStartEndCenter(
        secondArc.GetP0(),
        chain.GetPoint(18),
        secondArc.GetCenter(),
        secondArc.IsClockwise(),
      );

      expect(sliceResult.Arc(0).GetP0(), ctx).toEqual(expectedSliceArc0.GetP0()); // equal arc start points
      expect(sliceResult.Arc(0).Collide(expectedSliceArc0.GetArcMid(), tol), ctx).toBe(true);
      expect(sliceResult.Arc(0).Collide(expectedSliceArc0.GetP1(), tol), ctx).toBe(true);

      expect(sliceResult.PointCount(), ctx).toBe(10);
      expect(sliceResult.GetPoint(0), ctx).toEqual(firstArc.GetP1()); // equal to arc end
      expect(sliceResult.GetPoint(1), ctx).toEqual(targetSegment.A);
      expect(sliceResult.GetPoint(2), ctx).toEqual(targetSegment.B);
      expect(sliceResult.GetPoint(3), ctx).toEqual(expectedSliceArc0.GetP0()); // equal to arc start
      expect(sliceResult.IsArcStart(3), ctx).toBe(true);

      for (let i = 4; i <= 8; i++) expect(sliceResult.IsArcStart(i), ctx).toBe(false);

      for (let i = 3; i <= 7; i++) expect(sliceResult.IsArcEnd(i), ctx).toBe(false);

      expect(sliceResult.IsArcEnd(9), ctx).toBe(true);
      expect(sliceResult.GetPoint(9), ctx).toEqual(expectedSliceArc0.GetP1()); // equal to arc end
    }

    {
      // CASE 2: Start at middle of an arc, finish at arc startpoint
      const ctx = 'Case 2';
      const sliceResult = chain.Slice(5, 12, ARC_HIGH_DEF);
      expect(IsOutlineValid(sliceResult), ctx).toBe(true);

      expect(sliceResult.ArcCount(), ctx).toBe(1);
      const expectedSliceArc0 = new SHAPE_ARC();
      expectedSliceArc0.ConstructFromStartEndCenter(
        chain.GetPoint(5),
        firstArc.GetP1(),
        firstArc.GetCenter(),
        firstArc.IsClockwise(),
      );

      expect(sliceResult.Arc(0).GetP1(), ctx).toEqual(expectedSliceArc0.GetP1()); // equal arc end points
      expect(sliceResult.Arc(0).Collide(expectedSliceArc0.GetArcMid(), tol), ctx).toBe(true);
      expect(sliceResult.Arc(0).Collide(expectedSliceArc0.GetP0(), tol), ctx).toBe(true);

      expect(sliceResult.PointCount(), ctx).toBe(8);
      expect(sliceResult.GetPoint(0), ctx).toEqual(expectedSliceArc0.GetP0()); // equal to arc start
      expect(sliceResult.IsArcStart(0), ctx).toBe(true);

      for (let i = 1; i <= 4; i++) expect(sliceResult.IsArcStart(i), ctx).toBe(false);

      for (let i = 0; i <= 3; i++) expect(sliceResult.IsArcEnd(i), ctx).toBe(false);

      expect(sliceResult.IsArcEnd(4), ctx).toBe(true);
      expect(sliceResult.GetPoint(4), ctx).toEqual(expectedSliceArc0.GetP1()); // equal to arc end

      expect(sliceResult.GetPoint(5), ctx).toEqual(targetSegment.A);
      expect(sliceResult.GetPoint(6), ctx).toEqual(targetSegment.B);
      expect(sliceResult.GetPoint(7), ctx).toEqual(secondArc.GetP0());
    }

    {
      // CASE 3: Full arc, nothing else
      const ctx = 'Case 3';
      const sliceResult = chain.Slice(3, 9, ARC_HIGH_DEF);
      expect(IsOutlineValid(sliceResult), ctx).toBe(true);

      expect(sliceResult.ArcCount(), ctx).toBe(1);
      const sliceArc0 = sliceResult.Arc(0);

      // Equal arc to original inserted arc
      expect(firstArc.GetP1(), ctx).toEqual(sliceArc0.GetP1());
      expect(firstArc.GetArcMid(), ctx).toEqual(sliceArc0.GetArcMid());
      expect(firstArc.GetP1(), ctx).toEqual(sliceArc0.GetP1());

      expect(sliceResult.PointCount(), ctx).toBe(7);
      expect(sliceResult.GetPoint(0), ctx).toEqual(sliceArc0.GetP0()); // equal to arc start
      expect(sliceResult.IsArcStart(0), ctx).toBe(true);

      for (let i = 1; i <= 6; i++) expect(sliceResult.IsArcStart(i), ctx).toBe(false);

      for (let i = 0; i <= 5; i++) expect(sliceResult.IsArcEnd(i), ctx).toBe(false);

      expect(sliceResult.IsArcEnd(6), ctx).toBe(true);
      expect(sliceResult.GetPoint(6), ctx).toEqual(sliceArc0.GetP1()); // equal to arc end
    }

    {
      // CASE 4: Full arc, and straight segments to next arc start
      const ctx = 'Case 4';
      const sliceResult = chain.Slice(3, 12, ARC_HIGH_DEF);
      expect(IsOutlineValid(sliceResult), ctx).toBe(true);

      expect(sliceResult.ArcCount(), ctx).toBe(1);
      const sliceArc0 = sliceResult.Arc(0);

      // Equal arc to original inserted arc
      expect(firstArc.GetP1(), ctx).toEqual(sliceArc0.GetP1());
      expect(firstArc.GetArcMid(), ctx).toEqual(sliceArc0.GetArcMid());
      expect(firstArc.GetP1(), ctx).toEqual(sliceArc0.GetP1());

      expect(sliceResult.PointCount(), ctx).toBe(10);
      expect(sliceResult.GetPoint(0), ctx).toEqual(sliceArc0.GetP0()); // equal to arc start
      expect(sliceResult.IsArcStart(0), ctx).toBe(true);

      for (let i = 1; i <= 6; i++) expect(sliceResult.IsArcStart(i), ctx).toBe(false);

      for (let i = 0; i <= 5; i++) expect(sliceResult.IsArcEnd(i), ctx).toBe(false);

      expect(sliceResult.IsArcEnd(6), ctx).toBe(true);
      expect(sliceResult.GetPoint(6), ctx).toEqual(sliceArc0.GetP1()); // equal to arc end

      expect(sliceResult.GetPoint(7), ctx).toEqual(targetSegment.A);
      expect(sliceResult.GetPoint(8), ctx).toEqual(targetSegment.B);
      expect(sliceResult.GetPoint(9), ctx).toEqual(secondArc.GetP0());
    }

    {
      // Case 5: Chain ends in arc and point
      const chainCopy = new SHAPE_LINE_CHAIN(chain);
      chainCopy.Append(V(400000, 400000));

      const sliceResult = chainCopy.Slice(11, -1, ARC_HIGH_DEF);
      expect(IsOutlineValid(sliceResult), 'Case 5').toBe(true);
      expect(sliceResult.GetPoint(-1), 'Case 5').toEqual(V(400000, 400000));
    }

    {
      // Case 6: Start to end, chain with one point
      const chainCopy = new SLC_CASES().OnePoint;

      const sliceResult = chainCopy.Slice(0, -1, ARC_HIGH_DEF);
      expect(sliceResult.PointCount(), 'Case 6').toBe(1);
      expect(sliceResult.GetPoint(0), 'Case 6').toEqual(V(233450000, 228360000));
      expect(sliceResult.GetPoint(-1), 'Case 6').toEqual(V(233450000, 228360000)); // Same as index 0
    }

    {
      // Case 7: Start to end, chain with two points
      const chainCopy = new SLC_CASES().TwoPoints;

      const sliceResult = chainCopy.Slice(0, -1, ARC_HIGH_DEF);
      expect(sliceResult.PointCount(), 'Case 7').toBe(2);
      expect(sliceResult.GetPoint(0), 'Case 7').toEqual(V(233450000, 228360000));
      expect(sliceResult.GetPoint(1), 'Case 7').toEqual(V(263450000, 258360000));
      expect(sliceResult.GetPoint(-1), 'Case 7').toEqual(V(263450000, 258360000)); // Same as index 1
    }

    {
      // Case 8: Full 2nd arc, nothing else
      const ctx = 'Case 8';
      const sliceResult = chain.Slice(12, 19, ARC_HIGH_DEF);
      expect(IsOutlineValid(sliceResult), ctx).toBe(true);

      expect(sliceResult.ArcCount(), ctx).toBe(1);
      const sliceArc0 = sliceResult.Arc(0);

      // Equal arc to original inserted arc
      expect(secondArc.GetP1(), ctx).toEqual(sliceArc0.GetP1());
      expect(secondArc.GetArcMid(), ctx).toEqual(sliceArc0.GetArcMid());
      expect(secondArc.GetP1(), ctx).toEqual(sliceArc0.GetP1());

      expect(sliceResult.PointCount(), ctx).toBe(8);
      expect(sliceResult.GetPoint(0), ctx).toEqual(sliceArc0.GetP0()); // equal to arc start
      expect(sliceResult.IsArcStart(0), ctx).toBe(true);

      for (let i = 1; i <= 7; i++) expect(sliceResult.IsArcStart(i), ctx).toBe(false);

      for (let i = 0; i <= 6; i++) expect(sliceResult.IsArcEnd(i), ctx).toBe(false);

      expect(sliceResult.IsArcEnd(7), ctx).toBe(true);
      expect(sliceResult.GetPoint(7), ctx).toEqual(sliceArc0.GetP1()); // equal to arc end
    }

    {
      // Case 9: Start at middle of a 2nd arc, finish at end
      const ctx = 'Case 9';
      const sliceResult = chain.Slice(16, 19, ARC_HIGH_DEF);
      expect(IsOutlineValid(sliceResult), ctx).toBe(true);

      expect(sliceResult.ArcCount(), ctx).toBe(1);

      const expectedSliceArc0 = new SHAPE_ARC();
      expectedSliceArc0.ConstructFromStartEndCenter(
        chain.GetPoint(16),
        secondArc.GetP1(),
        secondArc.GetCenter(),
        secondArc.IsClockwise(),
      );

      expect(sliceResult.Arc(0).GetP1(), ctx).toEqual(expectedSliceArc0.GetP1()); // equal arc end points
      expect(sliceResult.Arc(0).Collide(expectedSliceArc0.GetArcMid(), tol), ctx).toBe(true);
      expect(sliceResult.Arc(0).Collide(expectedSliceArc0.GetP0(), tol), ctx).toBe(true);

      expect(sliceResult.PointCount(), ctx).toBe(4);
      expect(sliceResult.GetPoint(0), ctx).toEqual(expectedSliceArc0.GetP0()); // equal to arc start
      expect(sliceResult.IsArcStart(0), ctx).toBe(true);

      for (let i = 1; i <= 3; i++) expect(sliceResult.IsArcStart(i), ctx).toBe(false);

      for (let i = 0; i <= 2; i++) expect(sliceResult.IsArcEnd(i), ctx).toBe(false);

      expect(sliceResult.IsArcEnd(3), ctx).toBe(true);
      expect(sliceResult.GetPoint(3), ctx).toEqual(expectedSliceArc0.GetP1()); // equal to arc end
    }

    {
      // Case 10: New chain, start at arc middle, finish at end
      const ctx = 'Case 10';
      const chain10 = new SHAPE_LINE_CHAIN();
      chain10.Append(firstArc, ARC_HIGH_DEF);

      const sliceResult = chain10.Slice(3, 6, ARC_HIGH_DEF);
      expect(IsOutlineValid(sliceResult), ctx).toBe(true);

      expect(sliceResult.ArcCount(), ctx).toBe(1);

      const expectedSliceArc0 = new SHAPE_ARC();
      expectedSliceArc0.ConstructFromStartEndCenter(
        chain10.GetPoint(3),
        firstArc.GetP1(),
        firstArc.GetCenter(),
        firstArc.IsClockwise(),
      );

      expect(sliceResult.Arc(0).GetP1(), ctx).toEqual(expectedSliceArc0.GetP1()); // equal arc end points
      expect(sliceResult.Arc(0).Collide(expectedSliceArc0.GetArcMid(), tol), ctx).toBe(true);
      expect(sliceResult.Arc(0).Collide(expectedSliceArc0.GetP0(), tol), ctx).toBe(true);

      expect(sliceResult.PointCount(), ctx).toBe(4);
      expect(sliceResult.GetPoint(0), ctx).toEqual(expectedSliceArc0.GetP0()); // equal to arc start
      expect(sliceResult.IsArcStart(0), ctx).toBe(true);

      for (let i = 1; i <= 3; i++) expect(sliceResult.IsArcStart(i), ctx).toBe(false);

      for (let i = 0; i <= 2; i++) expect(sliceResult.IsArcEnd(i), ctx).toBe(false);

      expect(sliceResult.IsArcEnd(3), ctx).toBe(true);
      expect(sliceResult.GetPoint(3), ctx).toEqual(expectedSliceArc0.GetP1()); // equal to arc end
    }
  });

  // Test SHAPE_LINE_CHAIN::NearestPoint( VECTOR2I )
  it('NearestPointPt', () => {
    const seg1 = new SEG(V(0, 100000), V(50000, 0));
    const seg2 = new SEG(V(200000, 0), V(300000, 0));
    const arc = new SHAPE_ARC(V(200000, 0), V(300000, 0), ANGLE_180);

    // Start a chain with 2 points (seg1)
    const chain = new SHAPE_LINE_CHAIN([seg1.A, seg1.B]);
    expect(chain.PointCount()).toBe(2);
    // Add first arc
    chain.Append(arc, ARC_HIGH_DEF);
    expect(chain.PointCount()).toBe(9);
    // Add two points (seg2)
    chain.Append(seg2.A);
    chain.Append(seg2.B);
    expect(chain.PointCount()).toBe(11);
    expect(IsOutlineValid(chain)).toBe(true);

    const ptOnArcCloseToStart = V(297553, 31697); //should be index 3 in chain
    const ptOnArcCloseToEnd = V(139709, 82983); //should be index 6 in chain

    expect(chain.NearestPoint(ptOnArcCloseToStart, true)).toEqual(ptOnArcCloseToStart);
    expect(chain.NearestPoint(ptOnArcCloseToStart, false)).toEqual(arc.GetP0());

    expect(chain.NearestPoint(ptOnArcCloseToEnd, true)).toEqual(ptOnArcCloseToEnd);
    expect(chain.NearestPoint(ptOnArcCloseToEnd, false)).toEqual(arc.GetP1());
  });

  // Test SHAPE_LINE_CHAIN::Replace( SHAPE_LINE_CHAIN )
  it('ReplaceChain', () => {
    // 8949 crash
    const linePts = P([
      [206000000, 140110000],
      [192325020, 140110000],
      [192325020, 113348216],
      [192251784, 113274980],
      [175548216, 113274980],
      [175474980, 113348216],
      [175474980, 136694980],
      [160774511, 121994511],
      [160774511, 121693501],
      [160086499, 121005489],
      [159785489, 121005489],
      [159594511, 120814511],
      [160086499, 120814511],
      [160774511, 120126499],
      [160774511, 119153501],
      [160086499, 118465489],
      [159113501, 118465489],
      [158425489, 119153501],
      [158425489, 119645489],
      [157325020, 118545020],
      [157325020, 101925020],
      [208674980, 101925020],
      [208674980, 145474980],
      [192325020, 145474980],
      [192325020, 140110000],
    ]);

    const baseChain = new SHAPE_LINE_CHAIN(linePts, false);
    baseChain.SetWidth(250000);
    expect(baseChain.PointCount()).toBe(linePts.length);

    const replaceChain = new SHAPE_LINE_CHAIN([V(192325020, 140110000)], false);
    expect(replaceChain.PointCount()).toBe(1);

    baseChain.Replace(1, 23, replaceChain);

    expect(baseChain.PointCount()).toBe(linePts.length - (23 - 1));

    // Replacing the last point in a chain is special-cased
    baseChain.Replace(baseChain.PointCount() - 1, baseChain.PointCount() - 1, V(-1, -1));

    expect(baseChain.CLastPoint()).toEqual(V(-1, -1));
  });

  it('CompareGeometry', () => {
    const chain1 = new SHAPE_LINE_CHAIN();
    chain1.Append(0, 0);
    chain1.Append(100, 0);
    chain1.Append(100, 100);
    chain1.Append(0, 100);
    chain1.SetClosed(true);

    const chain2 = new SHAPE_LINE_CHAIN(chain1);

    // 1. Identical chains
    expect(chain1.CompareGeometry(chain2)).toBe(true);

    // 2. Different chains
    chain2.SetPoint(2, V(101, 101));
    expect(chain1.CompareGeometry(chain2)).toBe(false);

    // 3. Epsilon tolerance
    expect(chain1.CompareGeometry(chain2, false, 2)).toBe(true);

    // 4. Cyclical compare (chain1 but points in started at different vertex)
    const chain3 = new SHAPE_LINE_CHAIN();
    chain3.Append(100, 0);
    chain3.Append(100, 100);
    chain3.Append(0, 100);
    chain3.Append(0, 0);
    chain3.SetClosed(true);

    expect(chain1.CompareGeometry(chain3, false)).toBe(false);
    expect(chain1.CompareGeometry(chain3, true)).toBe(true);

    // 5. Different number of points
    chain3.Append(50, 50); // Add a point
    expect(chain1.CompareGeometry(chain3, true)).toBe(false);

    // 6. Simplify check (chain1 should match chain4 because CompareGeometry calls Simplify())
    const chain4 = new SHAPE_LINE_CHAIN();
    chain4.Append(0, 0);
    chain4.Append(50, 0); // Collinear point
    chain4.Append(100, 0);
    chain4.Append(100, 100);
    chain4.Append(0, 100);
    chain4.SetClosed(true);

    expect(chain1.CompareGeometry(chain4)).toBe(true);
  });

  it('CompareGeometryReversed', () => {
    // Square
    const ptsA = P([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    // Same points, same start, reversed
    const ptsB = P([
      [0, 0],
      [0, 100],
      [100, 100],
      [100, 0],
    ]);

    const chainA = new SHAPE_LINE_CHAIN(ptsA, true);
    const chainB = new SHAPE_LINE_CHAIN(ptsB, true);

    expect(chainA.CompareGeometry(chainB, false)).toBe(false);
    expect(chainA.CompareGeometry(chainB, true)).toBe(true);
  });

  /**
   * Test for issue #22597: Simplify with tolerance should reduce a polygon
   * created from a rotated rounded rectangle (many small line segments approximating arcs).
   * This polygon has 164 points that form a rounded rectangle rotated 45 degrees.
   */
  it('SimplifyWithToleranceIssue22597', () => {
    const chain = new SHAPE_LINE_CHAIN();

    // All 164 points from the reproduction case in issue #22597.
    // Coordinates are in nanometers (KiCad internal units).
    const pts: [number, number][] = [
      [135095398, 233618441],
      [135024554, 233546880],
      [134887999, 233398857],
      [134757514, 233245455],
      [134633313, 233086923],
      [134515595, 232923519],
      [134404553, 232755507],
      [134300366, 232583161],
      [134203203, 232406759],
      [134113222, 232226587],
      [134030567, 232042939],
      [133955377, 231856111],
      [133887768, 231666408],
      [133827854, 231474135],
      [133775731, 231279607],
      [133731482, 231083137],
      [133695180, 230885045],
      [133666884, 230685652],
      [133646639, 230485281],
      [133634480, 230284257],
      [133630425, 230082907],
      [133634480, 229881557],
      [133646639, 229680533],
      [133666884, 229480162],
      [133695180, 229280769],
      [133731482, 229082677],
      [133775731, 228886207],
      [133827854, 228691679],
      [133887768, 228499406],
      [133955377, 228309703],
      [134030567, 228122875],
      [134113222, 227939227],
      [134203203, 227759055],
      [134300366, 227582653],
      [134404553, 227410307],
      [134515595, 227242295],
      [134633313, 227078891],
      [134757514, 226920359],
      [134887999, 226766957],
      [135024554, 226618934],
      [135095398, 226547373],
      [148530427, 213112344],
      [148601988, 213041500],
      [148750011, 212904945],
      [148903413, 212774460],
      [149061945, 212650259],
      [149225349, 212532541],
      [149393361, 212421499],
      [149565707, 212317312],
      [149742109, 212220149],
      [149922281, 212130168],
      [150105929, 212047514],
      [150292757, 211972323],
      [150482460, 211904715],
      [150674733, 211844800],
      [150869261, 211792677],
      [151065731, 211748428],
      [151263823, 211712126],
      [151463216, 211683830],
      [151710655, 211863478], // Suspicious point
      [151864611, 211651426],
      [152065961, 211647371],
      [152267311, 211651426],
      [152468335, 211663586],
      [152668706, 211683830],
      [152868099, 211712126],
      [153066191, 211748428],
      [153262661, 211792677],
      [153457189, 211844800],
      [153649462, 211904715],
      [153839165, 211972323],
      [154025993, 212047514],
      [154209641, 212130168],
      [154389813, 212220149],
      [154566215, 212317312],
      [154738561, 212421499],
      [154906573, 212532541],
      [155069977, 212650259],
      [155228509, 212774460],
      [155381911, 212904945],
      [155529934, 213041500],
      [155601495, 213112344],
      [160551242, 218062092],
      [160622086, 218133653],
      [160758641, 218281676],
      [160889126, 218435078],
      [161013327, 218593610],
      [161131045, 218757014],
      [161242087, 218925026],
      [161346274, 219097372],
      [161443437, 219273774],
      [161533418, 219453946],
      [161616072, 219637594],
      [161691263, 219824422],
      [161758871, 220014125],
      [161818786, 220206398],
      [161870909, 220400926],
      [161915158, 220597396],
      [161951460, 220795488],
      [161979756, 220994881],
      [162000000, 221195252],
      [162012160, 221396276],
      [162016215, 221597626],
      [162012160, 221798976],
      [162000000, 222000000],
      [161979756, 222200371],
      [161951460, 222399764],
      [161915158, 222597856],
      [161870909, 222794326],
      [161818786, 222988854],
      [161758871, 223181127],
      [161691263, 223370830],
      [161616072, 223557658],
      [161533418, 223741306],
      [161443437, 223921478],
      [161346274, 224097880],
      [161242087, 224270226],
      [161131045, 224438238],
      [161013327, 224601642],
      [160889126, 224760174],
      [160758641, 224913576],
      [160622086, 225061599],
      [160551242, 225133160],
      [147116213, 238568188],
      [147044657, 238639037],
      [146896633, 238775592],
      [146743231, 238906077],
      [146584699, 239030279],
      [146421295, 239147996],
      [146253283, 239259039],
      [146080936, 239363226],
      [145904534, 239460389],
      [145724362, 239550371],
      [145540714, 239633024],
      [145353886, 239708216],
      [145164182, 239775824],
      [144971909, 239835739],
      [144777380, 239887863],
      [144580910, 239932111],
      [144382818, 239968413],
      [144183424, 239996709],
      [143983053, 240016953],
      [143782029, 240029113],
      [143580679, 240033169],
      [143379329, 240029113],
      [143178305, 240016953],
      [142977934, 239996709],
      [142778540, 239968413],
      [142580448, 239932111],
      [142383978, 239887863],
      [142189449, 239835739],
      [141997176, 239775824],
      [141807472, 239708216],
      [141620644, 239633024],
      [141436996, 239550371],
      [141256824, 239460389],
      [141080422, 239363226],
      [140908075, 239259039],
      [140740063, 239147996],
      [140576659, 239030279],
      [140418127, 238906077],
      [140264725, 238775592],
      [140116701, 238639037],
      [140045145, 238568188],
    ];

    for (const [x, y] of pts) chain.Append(V(x, y));

    chain.SetClosed(true);

    expect(IsOutlineValid(chain)).toBe(true);
    const originalPointCount = chain.PointCount();
    expect(originalPointCount).toBe(164);

    // With 2mm tolerance (2000000 nm), the many small segments approximating arcs
    // should be simplified significantly. A properly working algorithm should
    // reduce the point count substantially.
    chain.Simplify(2000000);

    const simplifiedCount = chain.PointCount();

    expect(IsOutlineValid(chain)).toBe(true);
    expect(simplifiedCount).toBeLessThan(originalPointCount);

    // The polygon is a rotated rounded rectangle with 4 corners.
    // A 2mm tolerance should reduce it to approximately 4-8 points.
    // If it's only slightly reduced, there may be an issue.
    expect(simplifiedCount).toBeLessThanOrEqual(20);
  });

  it('SelfIntersecting_NoIntersection_OpenChain', () => {
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [1000, 0],
        [2000, 1000],
        [3000, 0],
      ]),
    );

    expect(chain.SelfIntersecting()).toBeUndefined();
  });

  it('SelfIntersecting_NoIntersection_ClosedChain', () => {
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [10000, 0],
        [10000, 10000],
        [0, 10000],
      ]),
    );
    chain.SetClosed(true);

    expect(chain.SelfIntersecting()).toBeUndefined();
  });

  it('SelfIntersecting_CrossingSegments', () => {
    // An X shape: two segments that cross
    //   (0,0)-(10000,10000) and (10000,0)-(0,10000)
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [10000, 10000],
        [10000, 0],
        [0, 10000],
      ]),
    );

    const result = chain.SelfIntersecting();
    expect(result).toBeDefined();
    expect(result!.index_our).toBe(0);
    expect(result!.index_their).toBe(2);
  });

  it('SelfIntersecting_ClosedFigureEight', () => {
    // Closed bowtie: segments (0,0)-(10000,10000) and (10000,0)-(0,10000) cross at center
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [10000, 10000],
        [10000, 0],
        [0, 10000],
      ]),
    );
    chain.SetClosed(true);

    expect(chain.SelfIntersecting()).toBeDefined();
  });

  it('SelfIntersecting_VertexOnSegment', () => {
    // Third vertex lies exactly on the first segment
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [20000, 0],
        [20000, 10000],
        [10000, 0],
        [10000, -10000],
      ]),
    );

    const result = chain.SelfIntersecting();
    expect(result).toBeDefined();
    expect(result!.p.x).toBe(10000);
    expect(result!.p.y).toBe(0);
  });

  it('SelfIntersecting_TwoSegments', () => {
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [10000, 0],
      ]),
    );

    expect(chain.SelfIntersecting()).toBeUndefined();
  });

  it('SelfIntersecting_SinglePoint', () => {
    const chain = new SHAPE_LINE_CHAIN();
    chain.Append(V(0, 0));

    expect(chain.SelfIntersecting()).toBeUndefined();
  });

  it('SelfIntersecting_AdjacentSegmentsIgnored', () => {
    // A simple zigzag where adjacent segments share endpoints but don't self-intersect
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [5000, 10000],
        [10000, 0],
        [15000, 10000],
        [20000, 0],
      ]),
    );

    expect(chain.SelfIntersecting()).toBeUndefined();
  });

  it('SelfIntersecting_ClosedTriangle', () => {
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [10000, 0],
        [5000, 10000],
      ]),
    );
    chain.SetClosed(true);

    expect(chain.SelfIntersecting()).toBeUndefined();
  });

  it('SelfIntersecting_ClosedLastFirstNotFalsePositive', () => {
    // Closed rectangle. The last segment shares its endpoint with the first segment.
    // This must NOT be reported as a self-intersection.
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [10000, 0],
        [10000, 10000],
        [0, 10000],
      ]),
    );
    chain.SetClosed(true);

    expect(chain.SelfIntersecting()).toBeUndefined();
  });

  it('SelfIntersecting_SpatiallyDistant', () => {
    // Segments are far apart spatially, exercising the bbox rejection path
    const chain = new SHAPE_LINE_CHAIN(
      P([
        [0, 0],
        [1000, 0],
        [1000, 1000000],
        [2000, 1000000],
        [2000, 2000000],
        [3000, 2000000],
      ]),
    );

    expect(chain.SelfIntersecting()).toBeUndefined();
  });

  it('SelfIntersecting_LargeNonIntersecting', () => {
    // Build a spiral-like chain with many segments that don't self-intersect
    const chain = new SHAPE_LINE_CHAIN();

    for (let i = 0; i < 200; i++) chain.Append(V(i * 1000, (i % 2) * 5000));

    expect(chain.SelfIntersecting()).toBeUndefined();
  });

  it('SelfIntersecting_LargeWithCrossing', () => {
    // Many non-intersecting segments, then one that crosses back over an earlier one
    const chain = new SHAPE_LINE_CHAIN();

    for (let i = 0; i < 50; i++) chain.Append(V(i * 1000, 0));

    // Last segment crosses back over the first few segments
    chain.Append(V(5000, 10000));
    chain.Append(V(5000, -10000));

    expect(chain.SelfIntersecting()).toBeDefined();
  });
});
