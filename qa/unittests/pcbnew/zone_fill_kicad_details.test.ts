// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Four details of KiCad's fill that a whole-board fixture only pins by
 * accident, each re-derived from the C++ (and, where noted, from KiCad's own
 * numbers on the CM5 and One-Air-Max demo boards):
 *
 *  - `Simplify()` begins with `splitCollinearOutlines`: an outline that runs
 *    the same line twice with nothing either side is two outlines;
 *  - `doConvertOutlineToPolygon` walks an arc from the point the chain
 *    ARRIVED at, not the arc's own start;
 *  - `VECTOR2I / 2` is `KiROUND` per component (vector2d.h:536), so an odd
 *    drill's slot is placed half a unit further out than truncation puts it;
 *  - a fill outline whose vertex lies within `SEG::SquaredDistance == 0` of
 *    another outline's edge is connected to it (`SHAPE_LINE_CHAIN_BASE::
 *    Collide( aP, 0 )` counts an edge at distance 0, rounded);
 *  - `SHAPE_LINE_CHAIN_BASE::PointInside` tests `p.y >= pt.y` at BOTH ends of
 *    an edge, so a point on the ring's larger-y edge is inside and one on its
 *    smaller-y edge is not — which decides a thermal spoke whose test point
 *    sits exactly on the end of the spoke beside it (hackrf-one's U21).
 */

import { ErrorLoc } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { chainPointInside, simplify } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { doConvertOutlineToPolygon } from '@ziroeda/pcbnew/src/convert_shape_list_to_polygon.js';
import { arcConvertToPolyline } from '@ziroeda/pcbnew/src/router/shape_arc_ops.js';
import { padTransformHoleToPolygon } from '@ziroeda/pcbnew/src/transform_shape_to_polygon.js';
import type { Board, PcbPad, PcbShape, PcbZone } from '@ziroeda/pcbnew/src/types.js';
import { isolatedIslands } from '@ziroeda/pcbnew/src/zone_islands.js';
import { describe, expect, it } from 'vitest';

const MM = (v: number): number => Math.round(v * 1_000_000);

describe('Simplify() splits an exterior waist', () => {
  it('cuts two lobes joined by a near-zero-width diagonal neck into two outlines', () => {
    // A lobe at the bottom left and one at the top right, joined by a neck
    // the outline runs along twice on the diagonal: out from (1, 1) to (2, 2),
    // back from (2.1, 2.1) to (0.9, 0.9) three units higher. The runs are
    // collinear within `ApproxCollinear`'s 10 units and overlap with polygon
    // material on neither side — an exterior waist. A union alone keeps this
    // ONE polygon joined by a two-unit sliver; the split makes it two (CM5's
    // deflated thermal spokes do exactly this).
    const ring = [
      { x: 0, y: 0 },
      { x: MM(1), y: 0 },
      { x: MM(1), y: MM(1) },
      { x: MM(2), y: MM(2) },
      { x: MM(3), y: MM(2) },
      { x: MM(3), y: MM(3) },
      { x: MM(2.1), y: MM(3) },
      { x: MM(2.1), y: MM(2.1) + 3 },
      { x: MM(0.9), y: MM(0.9) + 3 },
      { x: 0, y: MM(1) },
    ];
    const out = simplify([[ring]]);
    expect(out).toHaveLength(2);
    for (const poly of out) expect(poly[0]!.length).toBeGreaterThanOrEqual(4);
  });
});

describe('the board outline walks an arc from where the chain arrived', () => {
  const shape = (over: Partial<PcbShape>): PcbShape => ({
    kind: 'line',
    width: 100_000,
    fillMode: 'none',
    layer: 'Edge.Cuts',
    ...over,
  });

  it("rebuilds the arc as SHAPE_ARC( prevPt, mid, end ) when the neighbour's end is a few units off", () => {
    // A 10 x 10 mm outline whose top-right corner is a 2 mm arc. The line
    // arriving at the arc ends 3 units past the arc's own start — inside the
    // 0.01 mm chaining epsilon — and KiCad polygonises the arc from THAT
    // point (convert_shape_list_to_polygon.cpp:303).
    const arcStart = { x: MM(8), y: 0 };
    const arcMid = { x: MM(8) + 1_414_214, y: MM(2) - 1_414_214 };
    const arcEnd = { x: MM(10), y: MM(2) };
    const arrived = { x: MM(8) + 3, y: 0 };
    const shapes = [
      shape({ start: { x: 0, y: 0 }, end: arrived }),
      shape({ kind: 'arc', start: arcStart, mid: arcMid, end: arcEnd }),
      shape({ start: arcEnd, end: { x: MM(10), y: MM(10) } }),
      shape({ start: { x: MM(10), y: MM(10) }, end: { x: 0, y: MM(10) } }),
      shape({ start: { x: 0, y: MM(10) }, end: { x: 0, y: 0 } }),
    ];
    const r = doConvertOutlineToPolygon(shapes, 5000, MM(0.01), true);
    expect(r.success).toBe(true);
    const ring = r.polygons[0]![0]!;
    const fromArrived = arcConvertToPolyline({ p0: arrived, arcMid, p1: arcEnd, width: 0 }, 5000);
    const fromOwnStart = arcConvertToPolyline({ p0: arcStart, arcMid, p1: arcEnd, width: 0 }, 5000);
    // The two polylines differ somewhere in their interior — else there is nothing to pin.
    expect(fromArrived.slice(1, -1)).not.toEqual(fromOwnStart.slice(1, -1));
    const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;
    const have = new Set(ring.map(key));
    for (const p of fromArrived) expect(have.has(key(p)), key(p)).toBe(true);
    // ... and the arc's own start is not a vertex: the chain never visited it.
    expect(have.has(key(arcStart))).toBe(false);
  });
});

describe('an odd drill size halves with KiROUND', () => {
  it("places USB701's 0.500024 x 1.399997 slot where KiCad does", () => {
    // From the CM5 demo board through KiCad's own `TransformHoleToPolygon`:
    // the slot's segment is (83549987, 64280000)-(82650013, 64280000), so the
    // knockout's leftmost x is 82400001. Truncating the halves gives
    // 82400002 — one unit in, on 54 vertices of that zone.
    const pad: PcbPad = {
      number: '1',
      type: 'thru_hole',
      shape: 'roundrect',
      at: { x: 83_100_000, y: 64_280_000 },
      angle: 270,
      size: { x: 860_000, y: 1_800_000 },
      drill: { oblong: true, w: 500_024, h: 1_399_997 },
      layers: ['F.Cu', 'B.Cu'],
      net: 1,
    };
    const poly = padTransformHoleToPolygon(pad, 0, 5000, ErrorLoc.ERROR_OUTSIDE)[0]![0]!;
    expect(Math.min(...poly.map((p) => p.x))).toBe(82_400_001);
    expect(poly).toHaveLength(16);
  });
});

describe('a fill outline touching another within half a unit is connected', () => {
  const zone = (fills: PcbZone['fills']): PcbZone => ({
    net: 1,
    layers: ['F.Cu'],
    outline: [
      { x: 0, y: 0 },
      { x: MM(4), y: 0 },
      { x: MM(4), y: MM(4) },
      { x: 0, y: MM(4) },
    ],
    fills,
    priority: 0,
    uuid: 'z',
  });
  const board = (z: PcbZone): Board =>
    ({
      zones: [z],
      footprints: [
        {
          reference: 'P1',
          at: { x: MM(1), y: MM(1) },
          rotation: 0,
          layer: 'F.Cu',
          pads: [
            {
              number: '1',
              type: 'smd',
              shape: 'rect',
              at: { x: MM(1), y: MM(1) },
              angle: 0,
              size: { x: MM(1), y: MM(1) },
              layers: ['F.Cu'],
              net: 1,
            } as PcbPad,
          ],
          shapes: [],
          texts: [],
          uuid: 'f',
        },
      ],
      tracks: [],
      arcs: [],
      vias: [],
      shapes: [],
      texts: [],
      nets: new Map([[1, 'N']]),
    }) as unknown as Board;

  it('is ON the edge when SEG::SquaredDistance rounds to 0, not only when exactly collinear', () => {
    // The big outline's top edge runs from (0,0) to (3 mm, 1) — a slope of one
    // unit over 3 mm. The sliver's vertex (1.5 mm, 0) is half a unit below that
    // edge: never integer-collinear, but `SquaredDistance` KiROUNDs 0.25 to 0.
    const big = [
      { x: 0, y: 0 },
      { x: MM(3), y: 1 },
      { x: MM(3), y: MM(3) },
      { x: 0, y: MM(3) },
    ];
    const sliver = [
      { x: MM(1.5), y: 0 },
      { x: MM(1.5) + 40, y: -30 },
      { x: MM(1.5) - 40, y: -30 },
    ];
    const z = zone([{ layer: 'F.Cu', polys: [big, sliver] }]);
    const islands = isolatedIslands(board(z), [
      { zone: 0, layer: 'F.Cu', index: 0, ring: big },
      { zone: 0, layer: 'F.Cu', index: 1, ring: sliver },
    ]);
    expect(islands.get(0)?.get('F.Cu') ?? []).toEqual([]);
  });

  it('and a vertex a whole unit off the edge is not', () => {
    const big = [
      { x: 0, y: 0 },
      { x: MM(3), y: 0 },
      { x: MM(3), y: MM(3) },
      { x: 0, y: MM(3) },
    ];
    const sliver = [
      { x: MM(1.5), y: -1 },
      { x: MM(1.5) + 40, y: -30 },
      { x: MM(1.5) - 40, y: -30 },
    ];
    const z = zone([{ layer: 'F.Cu', polys: [big, sliver] }]);
    const islands = isolatedIslands(board(z), [
      { zone: 0, layer: 'F.Cu', index: 0, ring: big },
      { zone: 0, layer: 'F.Cu', index: 1, ring: sliver },
    ]);
    expect(islands.get(0)?.get('F.Cu') ?? []).toEqual([1]);
  });
});

describe('PointInside on a point that sits exactly on an edge', () => {
  // A 0.28 x 1.14 mm spoke rectangle, as `buildThermalSpokes` lays one out.
  const spoke = [
    { x: 169_640_000, y: 110_751_200 },
    { x: 169_920_000, y: 110_751_200 },
    { x: 169_920_000, y: 109_614_400 },
    { x: 169_640_000, y: 109_614_400 },
  ];

  it('is NOT inside on the smaller-y edge', () => {
    expect(chainPointInside(spoke, { x: 169_780_000, y: 109_614_400 })).toBe(false);
  });

  it('IS inside on the larger-y edge', () => {
    expect(chainPointInside(spoke, { x: 169_780_000, y: 110_751_200 })).toBe(true);
  });

  it('and plainly inside in between', () => {
    expect(chainPointInside(spoke, { x: 169_780_000, y: 110_000_000 })).toBe(true);
  });
});
