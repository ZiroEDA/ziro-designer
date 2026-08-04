// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Hole-to-hole spacing, co-located holes, and the microvia drill code.
 * Counterparts: `drc_test_provider_hole_to_hole.cpp` and
 * `DRC_TEST_PROVIDER_HOLE_SIZE::checkViaHole`.
 *
 * A hole is a SHAPE_SEGMENT, not a circle: a round drill is a zero-length
 * segment whose width is the diameter, and a slot carries the milled axis. One
 * model covers both, and treating a slot as a circle under-reports along its
 * length — which is what these tests are mostly about.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { Board, PcbFootprint, PcbPad, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const via = (x: number, y: number, over: Partial<PcbVia> = {}): PcbVia => ({
  at: { x: MM(x), y: MM(y) },
  size: MM(0.8),
  drill: MM(0.4),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  source: EMPTY,
  ...over,
});

const pad = (x: number, y: number, over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'thru_hole',
  shape: 'circle',
  at: { x: MM(x), y: MM(y) },
  angle: 0,
  size: { x: MM(1.5), y: MM(1.5) },
  drill: { oblong: false, w: MM(0.4), h: MM(0.4) },
  layers: ['*.Cu'],
  net: 1,
  source: EMPTY,
  ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 1, name: 'In1.Cu', kind: 'signal' },
    { id: 2, name: 'In2.Cu', kind: 'signal' },
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
  groups: [],
  source: EMPTY,
  ...over,
});

const fp = (pads: PcbPad[]): PcbFootprint => ({
  lib: 'L:F',
  reference: 'U1',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  models: [],
  attributes: ['allow_missing_courtyard'],
  source: EMPTY,
});

/** Loose everywhere except hole-to-hole, which the caller sets. */
const opts = (minHoleToHole: number, dru?: string): DrcOptions => ({
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole,
  ...(dru ? { customRules: parseDrcRules(dru) } : {}),
});

const codes = (b: Board, code: string, o: DrcOptions) =>
  runDrc(b, o).filter((v) => v.code === code);

describe('hole to hole', () => {
  it('reports two round drills closer than the minimum', () => {
    // Centres 0.6 mm apart, drills 0.4 mm: 0.2 mm edge to edge.
    const b = board({ vias: [via(0, 0), via(0.6, 0)] });

    expect(codes(b, 'hole_to_hole', opts(MM(0.5)))).toHaveLength(1);
    expect(codes(b, 'hole_to_hole', opts(MM(0.1)))).toHaveLength(0);
  });

  it('measures edge to edge, not centre to centre', () => {
    const b = board({ vias: [via(0, 0), via(0.6, 0)] });
    const v = codes(b, 'hole_to_hole', opts(MM(0.5)));

    expect(v[0]!.message).toContain('0.2 mm');
  });

  it('leaves a hole placed exactly at the limit alone', () => {
    // The DRC epsilon is subtracted from the minimum for exactly this: a hole
    // at the limit is legal, not marginally illegal.
    const b = board({ vias: [via(0, 0), via(0.6, 0)] });

    expect(codes(b, 'hole_to_hole', opts(MM(0.2)))).toHaveLength(0);
  });

  it('follows a slot along its length rather than treating it as a circle', () => {
    // A 2 mm × 0.4 mm slot reaches 0.8 mm further along x than its drill
    // diameter would suggest. A circle model would call this clear.
    const slot = pad(0, 0, { drill: { oblong: true, w: MM(2), h: MM(0.4) } });
    const b = board({ footprints: [fp([slot])], vias: [via(1.3, 0)] });

    expect(codes(b, 'hole_to_hole', opts(MM(0.5)))).toHaveLength(1);
  });

  it('turns a slot with the pad, so the axis is not always horizontal', () => {
    const slot = pad(0, 0, { angle: 90, drill: { oblong: true, w: MM(2), h: MM(0.4) } });
    const b = board({ footprints: [fp([slot])], vias: [via(1.3, 0)] });

    // Rotated to vertical, the slot no longer reaches the via along x.
    expect(codes(b, 'hole_to_hole', opts(MM(0.5)))).toHaveLength(0);
  });

  it('exempts two blind vias that share no copper layer', () => {
    // They are drilled before the stack is laminated, so they cannot meet.
    const a = via(0, 0, { kind: 'blind', layers: ['F.Cu', 'In1.Cu'] });
    const c = via(0.5, 0, { kind: 'blind', layers: ['In2.Cu', 'B.Cu'] });

    expect(codes(board({ vias: [a, c] }), 'hole_to_hole', opts(MM(0.5)))).toHaveLength(0);
  });

  it('still checks two blind vias that do share a layer', () => {
    const a = via(0, 0, { kind: 'blind', layers: ['F.Cu', 'In1.Cu'] });
    const c = via(0.5, 0, { kind: 'blind', layers: ['In1.Cu', 'B.Cu'] });

    expect(codes(board({ vias: [a, c] }), 'hole_to_hole', opts(MM(0.5)))).toHaveLength(1);
  });

  it('checks pad drills against via drills', () => {
    const b = board({ footprints: [fp([pad(0, 0)])], vias: [via(0.6, 0)] });

    expect(codes(b, 'hole_to_hole', opts(MM(0.5)))).toHaveLength(1);
  });
});

describe('co-located holes', () => {
  it('reports two holes at the same point', () => {
    const b = board({ vias: [via(5, 5), via(5, 5)] });

    expect(codes(b, 'holes_co_located', opts(MM(0.5)))).toHaveLength(1);
  });

  it('reports co-location instead of, not as well as, too-close', () => {
    // Upstream's branch is an else-if: one violation, not two.
    const b = board({ vias: [via(5, 5), via(5, 5)] });

    expect(codes(b, 'hole_to_hole', opts(MM(0.5)))).toHaveLength(0);
  });

  it('does not call two merely near holes co-located', () => {
    const b = board({ vias: [via(0, 0), via(0.6, 0)] });

    expect(codes(b, 'holes_co_located', opts(MM(0.5)))).toHaveLength(0);
  });

  it('catches a pad drilled at the same point as a via', () => {
    const b = board({ footprints: [fp([pad(5, 5)])], vias: [via(5, 5)] });

    expect(codes(b, 'holes_co_located', opts(MM(0.5)))).toHaveLength(1);
  });
});

describe('microvia drill', () => {
  const small = opts(0);
  small.minThroughHole = MM(0.3);

  it('reports a microvia under its own code', () => {
    const b = board({ vias: [via(0, 0, { kind: 'micro', drill: MM(0.1) })] });

    expect(codes(b, 'microvia_drill_out_of_range', small)).toHaveLength(1);
    expect(codes(b, 'drill_out_of_range', small)).toHaveLength(0);
  });

  it('leaves an ordinary via under the general code', () => {
    const b = board({ vias: [via(0, 0, { drill: MM(0.1) })] });

    expect(codes(b, 'drill_out_of_range', small)).toHaveLength(1);
    expect(codes(b, 'microvia_drill_out_of_range', small)).toHaveLength(0);
  });

  it('honours a rule maximum, which Board Setup cannot express', () => {
    const b = board({ vias: [via(0, 0, { drill: MM(1) })] });
    const withMax = opts(0, `(version 1) (rule "r" (constraint hole_size (max 0.5mm)))`);

    const v = codes(b, 'drill_out_of_range', withMax);
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('max hole');
  });
});
