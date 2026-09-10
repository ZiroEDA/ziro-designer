// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The Clipper2 port against KiCad's own Clipper2.
 *
 * `qa/data/zone_fill/clipper2_kicad_cases.json` holds 120 boolean and
 * `Inflate` cases with the answers KiCad 10.0.5's `SHAPE_POLY_SET` gave for
 * them (its Python API, same library). Every answer has to come back vertex
 * for vertex IN SEQUENCE: the zone filler's `Fracture` threads holes from
 * their first leftmost vertex, so a ring that is the same set of points
 * rotated by one is a different stored polygon.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BooleanOp,
  booleanOp,
  inflate,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { segmentsForRadius } from '@ziroeda/pcbnew/src/convert_basic_shapes_to_polygon.js';

interface Case {
  a: number[][][][];
  b: number[][][][];
  op: 'add' | 'sub' | 'int' | 'inflate';
  amount?: number;
  strategy?: number;
  maxError?: number;
  simplify?: boolean;
  result: number[][][][];
}

const toPolys = (p: number[][][][]): Polygon[] =>
  p.map((poly) => poly.map((ring) => ring.map(([x, y]) => ({ x: x!, y: y! }))));

const cases = JSON.parse(
  readFileSync(resolve(__dirname, '../../data/zone_fill/clipper2_kicad_cases.json'), 'utf8'),
) as Case[];

describe('Clipper2, as KiCad ships it', () => {
  it('answers every one of the 120 cases vertex for vertex, in sequence', () => {
    const bad: number[] = [];
    cases.forEach((c, i) => {
      const out =
        c.op === 'inflate'
          ? inflate(
              toPolys(c.a),
              c.amount!,
              c.strategy!,
              segmentsForRadius(Math.abs(c.amount!), c.maxError!),
              c.simplify!,
            )
          : booleanOp(
              toPolys(c.a),
              toPolys(c.b),
              c.op === 'add'
                ? BooleanOp.ADD
                : c.op === 'sub'
                  ? BooleanOp.SUBTRACT
                  : BooleanOp.INTERSECT,
            );
      if (JSON.stringify(out) !== JSON.stringify(toPolys(c.result))) bad.push(i);
    });
    expect(bad).toEqual([]);
  });

  it('rounds a scanline crossing half to even, as std::nearbyint does', () => {
    // `TopX` is `std::nearbyint`, and a horizontal edge meeting a sloped one
    // takes that x. KiCad's own answers (SHAPE_POLY_SET::BooleanIntersection
    // in its Python API): the edge (0,0)→(2,4) crosses y=1 at x=0.5 → 0, and
    // (0,0)→(6,4) crosses y=3 at x=4.5 → 4. Round-half-up would say 1 and 5.
    const band: Polygon[] = [
      [
        [
          { x: -10, y: 1 },
          { x: 10, y: 1 },
          { x: 10, y: 3 },
          { x: -10, y: 3 },
        ],
      ],
    ];
    const tri = (apex: number): Polygon[] => [
      [
        [
          { x: 0, y: 0 },
          { x: apex, y: 4 },
          { x: -4, y: 4 },
        ],
      ],
    ];
    expect(booleanOp(tri(2), band, BooleanOp.INTERSECT)).toEqual([
      [
        [
          { x: 2, y: 3 },
          { x: -3, y: 3 },
          { x: -1, y: 1 },
          { x: 0, y: 1 },
        ],
      ],
    ]);
    expect(booleanOp(tri(6), band, BooleanOp.INTERSECT)).toEqual([
      [
        [
          { x: 4, y: 3 },
          { x: -3, y: 3 },
          { x: -1, y: 1 },
          { x: 2, y: 1 },
        ],
      ],
    ]);
  });

  it('is not a set comparison: the first case reversed is a different answer', () => {
    // The guard for the test above — a port that returned the right points in
    // the wrong order would be caught, because this one is.
    const c = cases.find((k) => k.op !== 'inflate')!;
    const out = booleanOp(
      toPolys(c.a),
      toPolys(c.b),
      c.op === 'add' ? BooleanOp.ADD : c.op === 'sub' ? BooleanOp.SUBTRACT : BooleanOp.INTERSECT,
    );
    const rotated = out.map((poly) => poly.map((r) => [...r.slice(1), r[0]!]));
    expect(JSON.stringify(rotated)).not.toBe(JSON.stringify(toPolys(c.result)));
  });
});
