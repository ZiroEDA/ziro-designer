// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Courtyards: derived from F.CrtYd / B.CrtYd graphics, and the five DRC checks
 * built on them.
 *
 * A courtyard is not in the file. `FOOTPRINT::BuildCourtyardCaches` chains the
 * graphics into closed outlines, so "no courtyard" and "a courtyard that will
 * not close" are different states with different markers — which is the thing
 * most worth pinning here.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { buildCourtyard } from '@ziroeda/pcbnew/src/courtyard.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbFootprint, PcbPad, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const line = (x0: number, y0: number, x1: number, y1: number, layer = 'F.CrtYd'): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.05),
  fill: false,
  layer,
  source: EMPTY,
});

/** Four lines forming a closed box, as a hand-drawn courtyard is. */
const boxLines = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  layer = 'F.CrtYd',
): PcbShape[] => [
  line(x0, y0, x1, y0, layer),
  line(x1, y0, x1, y1, layer),
  line(x1, y1, x0, y1, layer),
  line(x0, y1, x0, y0, layer),
];

const pad = (x: number, y: number, over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'thru_hole',
  shape: 'circle',
  at: { x: MM(x), y: MM(y) },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  drill: { oblong: false, w: MM(0.5), h: MM(0.5) },
  layers: ['*.Cu'],
  net: 0,
  source: EMPTY,
  ...over,
});

const footprint = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'L:F',
  reference: 'U1',
  at: { x: MM(5), y: MM(5) },
  angle: 0,
  layer: 'F.Cu',
  pads: [],
  shapes: [],
  texts: [],
  models: [],
  source: EMPTY,
  ...over,
});

const board = (footprints: PcbFootprint[]): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints,
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  groups: [],
  source: EMPTY,
});

const BASE: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const codes = (b: Board, code: string) => runDrc(b, BASE).filter((v) => v.code === code);

describe('buildCourtyard', () => {
  it('chains four lines into one closed outline', () => {
    const c = buildCourtyard(footprint({ shapes: boxLines(0, 0, 10, 10) }), 'F.CrtYd');

    expect(c.malformed).toBe(false);
    expect(c.outlines).toHaveLength(1);
    expect(c.outlines[0]).toHaveLength(4);
  });

  it('closes a gap smaller than the chaining epsilon', () => {
    // Courtyards are drawn by hand and rarely meet exactly; upstream allows
    // 0.02 mm between one segment's end and the next one's start.
    const shapes = boxLines(0, 0, 10, 10);
    shapes[0] = line(0, 0, 9.99, 0);

    expect(buildCourtyard(footprint({ shapes }), 'F.CrtYd').malformed).toBe(false);
  });

  it('calls a gap larger than the epsilon malformed', () => {
    const shapes = boxLines(0, 0, 10, 10);
    shapes[0] = line(0, 0, 9, 0);

    const c = buildCourtyard(footprint({ shapes }), 'F.CrtYd');
    expect(c.malformed).toBe(true);
    expect(c.error).toBe('(not a closed shape)');
  });

  it('takes a rectangle as a closed outline on its own', () => {
    const rect: PcbShape = {
      kind: 'rect',
      start: { x: 0, y: 0 },
      end: { x: MM(10), y: MM(10) },
      width: MM(0.05),
      fill: false,
      layer: 'F.CrtYd',
      source: EMPTY,
    };

    expect(buildCourtyard(footprint({ shapes: [rect] }), 'F.CrtYd').outlines).toHaveLength(1);
  });

  it('chains segments drawn in opposing directions', () => {
    // Nothing makes a hand-drawn courtyard consistently wound.
    const shapes = [
      line(0, 0, 10, 0),
      line(10, 10, 10, 0), // drawn backwards
      line(10, 10, 0, 10),
      line(0, 0, 0, 10), // and this one too
    ];

    expect(buildCourtyard(footprint({ shapes }), 'F.CrtYd').malformed).toBe(false);
  });

  it('reads each side separately', () => {
    const fp = footprint({ shapes: [...boxLines(0, 0, 10, 10, 'B.CrtYd')] });

    expect(buildCourtyard(fp, 'F.CrtYd').outlines).toHaveLength(0);
    expect(buildCourtyard(fp, 'B.CrtYd').outlines).toHaveLength(1);
  });

  it('ignores graphics on other layers', () => {
    const fp = footprint({ shapes: boxLines(0, 0, 10, 10, 'F.SilkS') });

    expect(buildCourtyard(fp, 'F.CrtYd').outlines).toHaveLength(0);
    expect(buildCourtyard(fp, 'F.CrtYd').malformed).toBe(false);
  });

  it('has no courtyard rather than a malformed one when nothing is drawn', () => {
    const c = buildCourtyard(footprint(), 'F.CrtYd');

    expect(c.outlines).toHaveLength(0);
    expect(c.malformed).toBe(false);
  });
});

describe('missing and malformed', () => {
  it('reports a footprint with no courtyard', () => {
    expect(codes(board([footprint()]), 'missing_courtyard')).toHaveLength(1);
  });

  it('excuses one marked allow_missing_courtyard', () => {
    const fp = footprint({ attributes: ['smd', 'allow_missing_courtyard'] });

    expect(codes(board([fp]), 'missing_courtyard')).toHaveLength(0);
  });

  it('reports a malformed courtyard, and not also a missing one', () => {
    const shapes = boxLines(0, 0, 10, 10);
    shapes[0] = line(0, 0, 9, 0);
    const b = board([footprint({ shapes })]);

    expect(codes(b, 'malformed_courtyard')).toHaveLength(1);
    expect(codes(b, 'missing_courtyard')).toHaveLength(0);
  });

  it('says nothing about a well-formed one', () => {
    const b = board([footprint({ shapes: boxLines(0, 0, 10, 10) })]);

    expect(codes(b, 'malformed_courtyard')).toHaveLength(0);
    expect(codes(b, 'missing_courtyard')).toHaveLength(0);
  });
});

describe('overlapping courtyards', () => {
  it('reports two that overlap', () => {
    const b = board([
      footprint({ reference: 'U1', shapes: boxLines(0, 0, 10, 10) }),
      footprint({ reference: 'U2', shapes: boxLines(5, 5, 15, 15) }),
    ]);

    expect(codes(b, 'courtyards_overlap')).toHaveLength(1);
  });

  it('leaves two that are clear of each other', () => {
    const b = board([
      footprint({ reference: 'U1', shapes: boxLines(0, 0, 10, 10) }),
      footprint({ reference: 'U2', shapes: boxLines(20, 20, 30, 30) }),
    ]);

    expect(codes(b, 'courtyards_overlap')).toHaveLength(0);
  });

  it('allows two that merely touch', () => {
    // "Touching courtyards, or courtyards -at- the clearance distance are
    // legal" — which is what the maxError deflation is for.
    const b = board([
      footprint({ reference: 'U1', shapes: boxLines(0, 0, 10, 10) }),
      footprint({ reference: 'U2', shapes: boxLines(10, 0, 20, 10) }),
    ]);

    expect(codes(b, 'courtyards_overlap')).toHaveLength(0);
  });

  it('does not pit a front courtyard against a back one', () => {
    const b = board([
      footprint({ reference: 'U1', shapes: boxLines(0, 0, 10, 10, 'F.CrtYd') }),
      footprint({ reference: 'U2', shapes: boxLines(5, 5, 15, 15, 'B.CrtYd') }),
    ]);

    expect(codes(b, 'courtyards_overlap')).toHaveLength(0);
  });
});

describe('holes in courtyards', () => {
  const withPad = (p: PcbPad) =>
    board([
      footprint({ reference: 'U1', shapes: boxLines(0, 0, 10, 10) }),
      footprint({ reference: 'U2', at: { x: MM(5), y: MM(5) }, pads: [p] }),
    ]);

  it('reports a PTH inside another footprint’s courtyard', () => {
    expect(codes(withPad(pad(5, 5)), 'pth_inside_courtyard')).toHaveLength(1);
  });

  it('reports an NPTH under its own code', () => {
    const b = withPad(pad(5, 5, { type: 'np_thru_hole' }));

    expect(codes(b, 'npth_inside_courtyard')).toHaveLength(1);
    expect(codes(b, 'pth_inside_courtyard')).toHaveLength(0);
  });

  it('ignores an SMD pad, which has no hole to speak of', () => {
    expect(
      codes(withPad(pad(5, 5, { type: 'smd', drill: undefined })), 'pth_inside_courtyard'),
    ).toHaveLength(0);
  });

  it('exempts a heatsink pad', () => {
    const b = withPad(pad(5, 5, { padProperty: 'pad_prop_heatsink' }));

    expect(codes(b, 'pth_inside_courtyard')).toHaveLength(0);
  });

  it('leaves a hole outside the courtyard alone', () => {
    expect(codes(withPad(pad(30, 30)), 'pth_inside_courtyard')).toHaveLength(0);
  });

  it('does not report a footprint’s own pad inside its own courtyard', () => {
    // The pair loop only ever tests one footprint's pads against another's
    // courtyard, which is what stops every through-hole part reporting itself.
    const b = board([footprint({ shapes: boxLines(0, 0, 10, 10), pads: [pad(5, 5)] })]);

    expect(codes(b, 'pth_inside_courtyard')).toHaveLength(0);
  });
});
