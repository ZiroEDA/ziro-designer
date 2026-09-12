// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/fixtures_geometry.h`: `KI_TEST::CommonTestData`,
 * and the `qa_utils/geometry` construction helpers the geometry suites share.
 */
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });
const ARC = (a: [number, number], b: [number, number], c: [number, number]): SHAPE_ARC =>
  new SHAPE_ARC(V(a[0], a[1]), V(b[0], b[1]), V(c[0], c[1]), 0);

/**
 * Common data for some of the #SHAPE_POLY_SET tests:
 *      1. holeyPolySet: A polyset containing one single squared outline with two holes: a
 *      non-convex pentagon and a triangle.
 *      2.solidPolySet: A polyset with three empty outlines and no holes.
 *      3. uniqueVertexPolySet: A polyset with one single outline that contains just one vertex.
 *      4. emptyPolySet: A polyset with no outlines.
 */
export class CommonTestData {
  // Polygon sets common for all the tests
  emptyPolySet = new SHAPE_POLY_SET();
  uniqueVertexPolySet = new SHAPE_POLY_SET();
  solidPolySet = new SHAPE_POLY_SET();
  holeyPolySet = new SHAPE_POLY_SET();
  /** Causes arc wraparound when reloading from Clipper, see gitlab issue 9670. */
  curvedPolyWrapRound = new SHAPE_POLY_SET();
  /** Polygon with a single outline + multiple holes. Holes and outline contain arcs. */
  holeyCurvedPolySingle = new SHAPE_POLY_SET();
  /** Polygon with a multiple outlines + multiple holes. Holes and outlines contain arcs. */
  holeyCurvedPolyMulti = new SHAPE_POLY_SET();
  /** Polygon with a single outlines + multiple holes. Intersects with above two polysets. */
  holeyCurvedPolyInter = new SHAPE_POLY_SET();

  // Vectors containing the information with which the polygons are populated.
  uniquePoints: VECTOR2I[] = [];
  holeyPoints: VECTOR2I[] = [];
  holeySegments: SEG[] = [];

  constructor() {
    // UniqueVertexPolySet shall have a unique vertex
    this.uniquePoints.push(V(100, 50));

    // Populate the holey polygon set points with 12 points

    // Square
    this.holeyPoints.push(V(100, 100));
    this.holeyPoints.push(V(0, 100));
    this.holeyPoints.push(V(0, 0));
    this.holeyPoints.push(V(100, 0));

    // Pentagon
    this.holeyPoints.push(V(10, 10));
    this.holeyPoints.push(V(10, 20));
    this.holeyPoints.push(V(15, 15));
    this.holeyPoints.push(V(20, 20));
    this.holeyPoints.push(V(20, 10));

    // Triangle
    this.holeyPoints.push(V(40, 10));
    this.holeyPoints.push(V(40, 20));
    this.holeyPoints.push(V(60, 10));

    const hp = this.holeyPoints;

    // Save the segments of the holeyPolySet.
    this.holeySegments.push(new SEG(hp[0]!, hp[1]!));
    this.holeySegments.push(new SEG(hp[1]!, hp[2]!));
    this.holeySegments.push(new SEG(hp[2]!, hp[3]!));
    this.holeySegments.push(new SEG(hp[3]!, hp[0]!));

    // Pentagon segments
    this.holeySegments.push(new SEG(hp[4]!, hp[5]!));
    this.holeySegments.push(new SEG(hp[5]!, hp[6]!));
    this.holeySegments.push(new SEG(hp[6]!, hp[7]!));
    this.holeySegments.push(new SEG(hp[7]!, hp[8]!));
    this.holeySegments.push(new SEG(hp[8]!, hp[4]!));

    // Triangle segments
    this.holeySegments.push(new SEG(hp[9]!, hp[10]!));
    this.holeySegments.push(new SEG(hp[10]!, hp[11]!));
    this.holeySegments.push(new SEG(hp[11]!, hp[9]!));

    // Auxiliary variables to store the contours that will be added to the polygons
    const polyLine = new SHAPE_LINE_CHAIN();
    const hole = new SHAPE_LINE_CHAIN();

    // Create a polygon set with a unique vertex
    polyLine.Append(this.uniquePoints[0]!);
    polyLine.SetClosed(true);
    this.uniqueVertexPolySet.AddOutline(polyLine);

    // Create a polygon set without holes
    this.solidPolySet.NewOutline();
    this.solidPolySet.NewOutline();
    this.solidPolySet.NewOutline();

    // Create a polygon set with holes

    // Adds a new squared outline
    polyLine.Clear();

    for (let i = 0; i < 4; i++) polyLine.Append(hp[i]!);

    polyLine.SetClosed(true);

    this.holeyPolySet.AddOutline(polyLine);

    // Adds a new hole (a pentagon)
    for (let i = 4; i < 9; i++) hole.Append(hp[i]!);

    hole.SetClosed(true);
    this.holeyPolySet.AddHole(hole);

    // Adds a new hole (a triangle)
    hole.Clear();
    for (let i = 9; i < 12; i++) hole.Append(hp[i]!);

    hole.SetClosed(true);
    this.holeyPolySet.AddHole(hole);

    //GENERATE CURVED POLYGON THAT CAUSES WRAPAROUND
    const wrapLine = new SHAPE_LINE_CHAIN();
    wrapLine.Append(ARC([-4300000, -6950000], [2000000, 0], [-4300000, 6950000]));
    wrapLine.Append(ARC([-4300000, 2200000], [-2700000, 0], [-4300000, -2200000]));
    wrapLine.SetClosed(true);
    this.curvedPolyWrapRound.AddOutline(wrapLine);

    // GENERATE CURVED POLYGON WITH HOLES
    // For visualisation, launch test_pns with the arguments "viewcurvedpoly -[single|multi]"

    // First shape:
    const oline0 = new SHAPE_LINE_CHAIN();
    oline0.Append(V(244000, 180000));
    oline0.Append(ARC([582000, 232000], [614000, 354000], [450000, 436000]));
    oline0.Append(ARC([450000, 436000], [310000, 480000], [502000, 614000]));
    oline0.Append(V(872000, 202000));
    oline0.SetClosed(true);
    this.holeyCurvedPolySingle.AddOutline(oline0);

    const o0h1 = new SHAPE_LINE_CHAIN();
    o0h1.Append(V(370000, 482000));
    o0h1.Append(ARC([342000, 576000], [436000, 552000], [474000, 622000]));
    o0h1.Append(ARC([474000, 622000], [534000, 520000], [518000, 470000]));
    o0h1.SetClosed(true);
    this.holeyCurvedPolySingle.AddHole(o0h1);

    const o0h2 = new SHAPE_LINE_CHAIN();
    o0h2.Append(ARC([680000, 286000], [728000, 306000], [760000, 258000]));
    o0h2.Append(ARC([760000, 258000], [746000, 222000], [686000, 260000]));
    o0h2.SetClosed(true);
    this.holeyCurvedPolySingle.AddHole(o0h2);

    this.holeyCurvedPolyMulti = new SHAPE_POLY_SET(this.holeyCurvedPolySingle);

    // Second shape:
    const oline1 = new SHAPE_LINE_CHAIN();
    oline1.Append(V(640000, 840000));
    oline1.Append(ARC([829000, 959000], [990000, 736000], [951000, 461000]));
    oline1.Append(ARC([951000, 461000], [600000, 572000], [620000, 726000]));
    oline1.SetClosed(true);
    this.holeyCurvedPolyMulti.AddOutline(oline1);

    const o1h1 = new SHAPE_LINE_CHAIN();
    o1h1.Append(V(670000, 482000));
    o1h1.Append(ARC([642000, 576000], [736000, 652000], [774000, 622000]));
    o1h1.Append(ARC([774000, 622000], [834000, 520000], [818000, 470000]));
    o1h1.SetClosed(true);
    this.holeyCurvedPolyMulti.AddHole(o1h1);

    const o1h2 = new SHAPE_LINE_CHAIN();
    o1h2.Append(ARC([680000, 286000], [728000, 306000], [760000, 258000]));
    o1h2.Append(ARC([760000, 258000], [746000, 222000], [686000, 260000]));
    o1h2.SetClosed(true);
    this.holeyCurvedPolyMulti.AddHole(o1h2);

    // Intersecting shape:
    const oline2 = new SHAPE_LINE_CHAIN();
    oline2.Append(V(340000, 540000));
    oline2.Append(ARC([629000, 659000], [790000, 436000], [751000, 161000]));
    oline2.Append(ARC([651000, 161000], [300000, 272000], [320000, 426000]));
    oline2.SetClosed(true);
    this.holeyCurvedPolyInter.AddOutline(oline2);

    const o2h2 = new SHAPE_LINE_CHAIN();
    o2h2.Append(ARC([680000, 486000], [728000, 506000], [760000, 458000]));
    o2h2.Append(ARC([760000, 458000], [746000, 422000], [686000, 460000]));
    o2h2.SetClosed(true);
    this.holeyCurvedPolyInter.AddHole(o2h2);
  }
}

// ----- qa_utils/geometry/{line_chain,poly_set,seg}_construction --------------

/** `KI_TEST::BuildRectChain`. */
export function BuildRectChain(aSize: VECTOR2I, aCentre: VECTOR2I = V(0, 0)): SHAPE_LINE_CHAIN {
  const hx = Math.trunc(aSize.x / 2);
  const hy = Math.trunc(aSize.y / 2);
  const pts: VECTOR2I[] = [
    V(aCentre.x - hx, aCentre.y - hy),
    V(aCentre.x - hx, aCentre.y + hy),
    V(aCentre.x + hx, aCentre.y + hy),
    V(aCentre.x + hx, aCentre.y - hy),
  ];

  const chain = new SHAPE_LINE_CHAIN(pts);
  chain.SetClosed(true);

  return chain;
}

/** `KI_TEST::BuildSquareChain`. */
export function BuildSquareChain(aSize: number, aCentre: VECTOR2I = V(0, 0)): SHAPE_LINE_CHAIN {
  return BuildRectChain(V(aSize, aSize), aCentre);
}

/** `KI_TEST::BuildPolyset`. */
export function BuildPolyset(aOutlines: readonly SHAPE_LINE_CHAIN[]): SHAPE_POLY_SET {
  const polyset = new SHAPE_POLY_SET();

  for (const outline of aOutlines) polyset.AddOutline(outline);

  return polyset;
}

/** `KI_TEST::BuildHollowSquare`. */
export function BuildHollowSquare(
  aOuterSize: number,
  aInnerSize: number,
  aCentre: VECTOR2I = V(0, 0),
): SHAPE_POLY_SET {
  const polyset = new SHAPE_POLY_SET();

  polyset.AddOutline(BuildRectChain(V(aOuterSize, aOuterSize), aCentre));
  polyset.AddHole(BuildRectChain(V(aInnerSize, aInnerSize), aCentre));

  return polyset;
}

/** `KI_TEST::BuildHSeg`. */
export function BuildHSeg(aStart: VECTOR2I, aLength: number): SEG {
  return new SEG(V(aStart.x, aStart.y), V(aStart.x + aLength, aStart.y));
}

/** `KI_TEST::BuildVSeg`. */
export function BuildVSeg(aStart: VECTOR2I, aLength: number): SEG {
  return new SEG(V(aStart.x, aStart.y), V(aStart.x, aStart.y + aLength));
}

/** `KI_TEST::IsWithin`. */
export const IsWithin = (aValue: number, aNominal: number, aError: number): boolean =>
  aValue >= aNominal - aError && aValue <= aNominal + aError;
