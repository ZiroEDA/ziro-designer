// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A track landing inside a via's copper but not on its centre.
 * Counterpart: the DRCE_TRACK_NOT_CENTERED_ON_VIA pass of
 * `drc_test_provider_connectivity.cpp`.
 *
 * The via still conducts, so this is a tidiness check. The rule that gives it
 * its shape is the escape hatch: if *any* track on that layer reaches the via's
 * centre, the layer is properly connected and an off-centre neighbour is
 * tolerated. Without that, every fan-out with two tracks into one via reports.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbTrack, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/** A via 1 mm across at (10, 10): its copper reaches 0.5 mm from centre. */
const via = (over: Partial<PcbVia> = {}): PcbVia => ({
  at: { x: MM(10), y: MM(10) },
  size: MM(1),
  drill: MM(0.4),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  source: EMPTY,
  ...over,
});

const track = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  over: Partial<PcbTrack> = {},
): PcbTrack => ({
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.2),
  layer: 'F.Cu',
  net: 1,
  source: EMPTY,
  ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 1, name: 'In1.Cu', kind: 'signal' },
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
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
  ...over,
});

const OPTS: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const offCentre = (b: Board) =>
  runDrc(b, OPTS).filter((v) => v.code === 'track_not_centered_on_via');

describe('track not centered on via', () => {
  it('reports a track ending inside the via but off its centre', () => {
    // Ends at (10.3, 10): inside the 0.5 mm copper radius, not on centre.
    const b = board({ vias: [via()], tracks: [track(0, 10, 10.3, 10)] });

    expect(offCentre(b)).toHaveLength(1);
  });

  it('marks the offending end', () => {
    const b = board({ vias: [via()], tracks: [track(0, 10, 10.3, 10)] });

    expect(offCentre(b)[0]!.pos).toEqual({ x: MM(10.3), y: MM(10) });
  });

  it('says nothing when the track lands dead centre', () => {
    const b = board({ vias: [via()], tracks: [track(0, 10, 10, 10)] });

    expect(offCentre(b)).toHaveLength(0);
  });

  it('says nothing when the track stops short of the via entirely', () => {
    const b = board({ vias: [via()], tracks: [track(0, 10, 5, 10)] });

    expect(offCentre(b)).toHaveLength(0);
  });

  it('tolerates an off-centre track when another on that layer is centred', () => {
    // The escape hatch: the layer is properly connected, so the second track
    // sitting off-centre is not a violation.
    const b = board({
      vias: [via()],
      tracks: [track(0, 10, 10.3, 10), track(10, 10, 10, 20)],
    });

    expect(offCentre(b)).toHaveLength(0);
  });

  it('does not let a centred track on another layer excuse this one', () => {
    const b = board({
      vias: [via()],
      tracks: [track(0, 10, 10.3, 10), track(10, 10, 10, 20, { layer: 'B.Cu' })],
    });

    expect(offCentre(b)).toHaveLength(1);
  });

  it('ignores a via on another net', () => {
    const b = board({ vias: [via({ net: 2 })], tracks: [track(0, 10, 10.3, 10)] });

    expect(offCentre(b)).toHaveLength(0);
  });

  it('ignores a via that does not span the track’s layer', () => {
    const blind = via({ kind: 'blind', layers: ['F.Cu', 'In1.Cu'] });
    const b = board({ vias: [blind], tracks: [track(0, 10, 10.3, 10, { layer: 'B.Cu' })] });

    expect(offCentre(b)).toHaveLength(0);
  });

  it('checks the start of a track as well as its end', () => {
    const b = board({ vias: [via()], tracks: [track(10.3, 10, 20, 10)] });

    expect(offCentre(b)).toHaveLength(1);
    expect(offCentre(b)[0]!.pos).toEqual({ x: MM(10.3), y: MM(10) });
  });

  it('reports a track once even when it meets two vias', () => {
    const b = board({
      vias: [via(), via({ at: { x: MM(20), y: MM(10) } })],
      tracks: [track(10.3, 10, 20.3, 10)],
    });

    expect(offCentre(b)).toHaveLength(1);
  });

  it('checks arcs as well as straight tracks', () => {
    const b = board({
      vias: [via()],
      arcs: [
        {
          start: { x: MM(0), y: MM(10) },
          mid: { x: MM(5), y: MM(12) },
          end: { x: MM(10.3), y: MM(10) },
          width: MM(0.2),
          layer: 'F.Cu',
          net: 1,
          source: EMPTY,
        },
      ],
    });

    expect(offCentre(b)).toHaveLength(1);
  });
});
