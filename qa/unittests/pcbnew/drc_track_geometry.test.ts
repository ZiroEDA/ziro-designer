// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Track segment length and track angle.
 * Counterparts: `drc_test_provider_track_segment_length.cpp` and
 * `drc_test_provider_track_angle.cpp`.
 *
 * Both are purely rule-driven — nothing in Board Setup expresses either, so a
 * board with no `.kicad_dru` runs neither. The angle test is the interesting
 * one: the two directions are taken *away* from the joint, so a straight-
 * through pair reads 180° and a hairpin reads 0°.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type {
  Board,
  PcbArcTrack,
  PcbFootprint,
  PcbPad,
  PcbTrack,
} from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const track = (x0: number, y0: number, x1: number, y1: number, net = 1): PcbTrack => ({
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.2),
  layer: 'F.Cu',
  net,
  source: EMPTY,
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
    [2, 'N2'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  groups: [],
  source: EMPTY,
  ...over,
});

const BASE: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const codes = (b: Board, code: string, dru?: string) =>
  runDrc(b, { ...BASE, ...(dru ? { customRules: parseDrcRules(dru) } : {}) }).filter(
    (v) => v.code === code,
  );

describe('track segment length', () => {
  it('is not checked at all without a rule', () => {
    expect(codes(board({ tracks: [track(0, 0, 0.1, 0)] }), 'track_segment_length')).toHaveLength(0);
  });

  it('reports a segment shorter than the minimum', () => {
    const b = board({ tracks: [track(0, 0, 0.5, 0)] });
    const v = codes(
      b,
      'track_segment_length',
      `(version 1) (rule "r" (constraint track_segment_length (min 1mm)))`,
    );

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('min length');
  });

  it('reports a segment longer than the maximum', () => {
    const b = board({ tracks: [track(0, 0, 50, 0)] });

    expect(
      codes(
        b,
        'track_segment_length',
        `(version 1) (rule "r" (constraint track_segment_length (max 10mm)))`,
      ),
    ).toHaveLength(1);
  });

  it('accepts one inside the range', () => {
    const b = board({ tracks: [track(0, 0, 5, 0)] });

    expect(
      codes(
        b,
        'track_segment_length',
        `(version 1) (rule "r" (constraint track_segment_length (min 1mm) (max 10mm)))`,
      ),
    ).toHaveLength(0);
  });

  it('measures an arc along its curve, not its chord', () => {
    // A half-circle of radius 5 mm: chord 10 mm, arc length ~15.7 mm. A chord
    // measurement would pass a 12 mm maximum; the arc length does not.
    const arc: PcbArcTrack = {
      start: { x: MM(0), y: MM(0) },
      mid: { x: MM(5), y: MM(5) },
      end: { x: MM(10), y: MM(0) },
      width: MM(0.2),
      layer: 'F.Cu',
      net: 1,
      source: EMPTY,
    };
    const b = board({ arcs: [arc] });

    expect(
      codes(
        b,
        'track_segment_length',
        `(version 1) (rule "r" (constraint track_segment_length (max 12mm)))`,
      ),
    ).toHaveLength(1);
    expect(
      codes(
        b,
        'track_segment_length',
        `(version 1) (rule "r" (constraint track_segment_length (max 20mm)))`,
      ),
    ).toHaveLength(0);
  });
});

describe('track angle', () => {
  const dru = (min: number) => `(version 1) (rule "r" (constraint track_angle (min ${min}deg)))`;

  it('is not checked at all without a rule', () => {
    const b = board({ tracks: [track(0, 0, 10, 0), track(10, 0, 10.1, 1)] });

    expect(codes(b, 'track_angle')).toHaveLength(0);
  });

  it('reads a straight-through joint as 180 degrees', () => {
    // Directions are taken away from the joint, so collinear is the maximum.
    const b = board({ tracks: [track(0, 0, 10, 0), track(10, 0, 20, 0)] });

    expect(codes(b, 'track_angle', dru(90))).toHaveLength(0);
  });

  it('reads a hairpin as 0 degrees and reports it', () => {
    // Two collinear tracks doubling back over each other. Both this and the
    // straight-through case are collinear, so they are the pair that proves
    // the direction flip is doing something.
    const b = board({ tracks: [track(0, 0, 10, 0), track(10, 0, 5, 0)] });

    const v = codes(b, 'track_angle', dru(90));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('0.0°');
  });

  it('reports an acute corner', () => {
    // A 90 degree corner fails a 135 degree minimum.
    const b = board({ tracks: [track(0, 0, 10, 0), track(10, 0, 10, 10)] });
    const v = codes(b, 'track_angle', dru(135));

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('min angle');
    expect(v[0]!.message).toContain('90.0°');
  });

  it('marks the joint, not either track end', () => {
    const b = board({ tracks: [track(0, 0, 10, 0), track(10, 0, 10, 10)] });

    expect(codes(b, 'track_angle', dru(135))[0]!.pos).toEqual({ x: MM(10), y: 0 });
  });

  it('accepts a 45 degree mitre against a 45 degree minimum', () => {
    // Directions away from the joint make this 135 degrees, not 45.
    const b = board({ tracks: [track(0, 0, 10, 0), track(10, 0, 20, 10)] });

    expect(codes(b, 'track_angle', dru(90))).toHaveLength(0);
  });

  it('excuses a corner that lands inside a pad', () => {
    const pad: PcbPad = {
      number: '1',
      type: 'smd',
      shape: 'rect',
      at: { x: MM(10), y: 0 },
      angle: 0,
      size: { x: MM(2), y: MM(2) },
      layers: ['F.Cu'],
      net: 1,
      source: EMPTY,
    };
    const fp: PcbFootprint = {
      lib: 'L:F',
      reference: 'U1',
      at: { x: MM(10), y: 0 },
      angle: 0,
      layer: 'F.Cu',
      pads: [pad],
      shapes: [],
      texts: [],
      models: [],
      attributes: ['allow_missing_courtyard'],
      source: EMPTY,
    };
    const b = board({ tracks: [track(0, 0, 10, 0), track(10, 0, 10, 10)], footprints: [fp] });

    expect(codes(b, 'track_angle', dru(135))).toHaveLength(0);
  });

  it('ignores tracks on different layers', () => {
    const b = board({
      tracks: [track(0, 0, 10, 0), { ...track(10, 0, 10, 10), layer: 'B.Cu' }],
    });

    expect(codes(b, 'track_angle', dru(135))).toHaveLength(0);
  });

  it('ignores tracks on different nets', () => {
    // Upstream walks each track's *connected* tracks, which share a net.
    const b = board({ tracks: [track(0, 0, 10, 0), track(10, 0, 10, 10, 2)] });

    expect(codes(b, 'track_angle', dru(135))).toHaveLength(0);
  });

  it('reports a joint once, not once per direction', () => {
    const b = board({ tracks: [track(0, 0, 10, 0), track(10, 0, 10, 10)] });

    expect(codes(b, 'track_angle', dru(135))).toHaveLength(1);
  });

  it('leaves two tracks that do not meet alone', () => {
    const b = board({ tracks: [track(0, 0, 5, 0), track(6, 0, 6, 10)] });

    expect(codes(b, 'track_angle', dru(135))).toHaveLength(0);
  });
});
