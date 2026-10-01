// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SHAPE_ARC::ConvertToPolyline` passes its double external radius to
 * `GetArcToSegmentCount( int aRadius, … )` and `CircleToEndSegmentDeltaRadius(
 * int aRadius, … )`: both take an `int`, so the radius arrives truncated. Kept
 * as a double, the effective error — and with it the polyline radius — moves
 * by half a nanometre and a vertex near a .5 rounds the other way.
 *
 * The expectations are KiCad 10.0.6's own: each arc built as a `PCB_ARC`
 * (start, mid, end) in its python module, and
 * `GetEffectiveShape().Cast().ConvertToPolyline()` read back. The arcs are
 * from the PADS importer's hatched pours in `issue23856.asc`, where the
 * rounding first showed.
 */

import { describe, expect, it } from 'vitest';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';

const CASES: { s: number[]; m: number[]; e: number[]; kicad: number[][] }[] = [
  {
    s: [-13692022, -14059225],
    m: [-13720066, -14119039],
    e: [-13774483, -14156719],
    kicad: [
      [-13692022, -14059225],
      [-13699674, -14092156],
      [-13743278, -14143709],
      [-13774483, -14156719],
    ],
  },
  {
    s: [-6580022, -14059225],
    m: [-6608066, -14119039],
    e: [-6662483, -14156719],
    kicad: [
      [-6580022, -14059225],
      [-6587674, -14092156],
      [-6631278, -14143709],
      [-6662483, -14156719],
    ],
  },
  {
    s: [1043895, 28199605],
    m: [936747, 28224267],
    e: [889000, 28323504],
    kicad: [
      [1043895, 28199605],
      [1005946, 28193625],
      [934630, 28221776],
      [891503, 28285168],
      [889000, 28323504],
    ],
  },
];

describe('SHAPE_ARC::ConvertToPolyline truncates the radius it counts segments with', () => {
  for (const c of CASES) {
    it(`(${c.s}) (${c.m}) (${c.e})`, () => {
      const arc = new SHAPE_ARC(
        { x: c.s[0]!, y: c.s[1]! },
        { x: c.m[0]!, y: c.m[1]! },
        { x: c.e[0]!, y: c.e[1]! },
        0,
      );
      const poly = arc.ConvertToPolyline();
      const got: number[][] = [];

      for (let j = 0; j < poly.PointCount(); j++) got.push([poly.CPoint(j).x, poly.CPoint(j).y]);

      expect(got).toEqual(c.kicad);
    });
  }
});
