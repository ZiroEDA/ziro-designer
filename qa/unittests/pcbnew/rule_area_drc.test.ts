// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rule areas as DRC rules, and the outline deflation the courtyard builder uses.
 *
 * Upstream turns every rule area into an implicit `disallow` rule conditioned
 * on `A.intersectsArea('<uuid>')` (`DRC_ENGINE::loadImplicitRules`), so a
 * keepout and a hand-written rule reach the checks by exactly the same path.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { deflatePolygon } from '@ziroeda/pcbnew/courtyard.js';
import type { Board, PcbTrack, PcbVia, PcbZone } from '@ziroeda/pcbnew/types.js';

const MM = (n: number): number => mmToIU(n);

/** A square from (x0,y0) to (x1,y1). */
const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: MM(x0), y: MM(y0) },
  { x: MM(x1), y: MM(y0) },
  { x: MM(x1), y: MM(y1) },
  { x: MM(x0), y: MM(y1) },
];

const ruleArea = (over: Partial<PcbZone> = {}): PcbZone => ({
  net: 0,
  layers: ['F.Cu'],
  fills: [],
  outline: box(10, 0, 20, 10),
  uuid: 'area-1',
  name: 'ko',
  ruleArea: { tracks: true, vias: true, pads: false, copperPour: false, footprints: false },
  ...over,
});

const _track = (x0: number, x1: number, layer = 'F.Cu'): PcbTrack => ({
  start: { x: MM(x0), y: MM(5) },
  end: { x: MM(x1), y: MM(5) },
  width: MM(0.2),
  layer,
  net: 1,
});

const _via = (x: number): PcbVia => ({
  at: { x: MM(x), y: MM(5) },
  size: MM(0.6),
  drill: MM(0.3),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'N1'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  ...over,
});

describe('deflatePolygon', () => {
  it('shrinks a square by the offset on every side', () => {
    const out = deflatePolygon(box(0, 0, 10, 10), MM(1));

    expect(Math.min(...out.map((p) => p.x))).toBeCloseTo(MM(1), -3);
    expect(Math.max(...out.map((p) => p.x))).toBeCloseTo(MM(9), -3);
  });

  it('shrinks an anti-clockwise ring inward too, not outward', () => {
    // The inward normal flips with the winding; getting it wrong would grow
    // the area instead of shrinking it, and silently invert every keepout.
    const out = deflatePolygon([...box(0, 0, 10, 10)].reverse(), MM(1));

    expect(Math.max(...out.map((p) => p.x))).toBeCloseTo(MM(9), -3);
  });

  it('leaves a degenerate outline alone rather than losing its area', () => {
    expect(
      deflatePolygon(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        MM(1),
      ),
    ).toHaveLength(2);
  });
});
