// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copper over another item's drilled hole.
 * Counterpart: the hole branch of
 * `DRC_TEST_PROVIDER_COPPER_CLEARANCE::testSingleLayerItemAgainstItem`.
 *
 * The check runs even at a clearance of zero, "because the item cannot be
 * inside (or intersect) the hole" — so a board with no `.kicad_dru` still
 * catches copper laid across someone else's drill.
 *
 * The same-net skip is the part that is easy to miss: it lives in the RTree
 * *filter*, not in the hole branch itself, and without it every track entering
 * its own through-hole pad is a violation.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { Board, PcbFootprint, PcbPad, PcbTrack, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const track = (x0: number, x1: number, net = 1, over: Partial<PcbTrack> = {}): PcbTrack => ({
  start: { x: MM(x0), y: 0 },
  end: { x: MM(x1), y: 0 },
  width: MM(0.2),
  layer: 'F.Cu',
  net,
  source: EMPTY,
  ...over,
});

const via = (x: number, net = 1, over: Partial<PcbVia> = {}): PcbVia => ({
  at: { x: MM(x), y: 0 },
  size: MM(0.8),
  drill: MM(0.4),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net,
  source: EMPTY,
  ...over,
});

const pad = (x: number, net = 1, over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'thru_hole',
  shape: 'circle',
  at: { x: MM(x), y: 0 },
  angle: 0,
  size: { x: MM(1.5), y: MM(1.5) },
  drill: { oblong: false, w: MM(0.6), h: MM(0.6) },
  layers: ['*.Cu'],
  net,
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
  points: [],
  models: [],
  attributes: ['allow_missing_courtyard'],
  source: EMPTY,
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

const holeErrors = (b: Board, dru?: string) =>
  runDrc(b, { ...BASE, ...(dru ? { customRules: parseDrcRules(dru) } : {}) }).filter(
    (v) => v.code === 'hole_clearance',
  );

describe('copper over a hole', () => {
  it('reports a track crossing another net’s via drill', () => {
    const b = board({ tracks: [track(0, 10, 1)], vias: [via(5, 2)] });

    expect(holeErrors(b)).toHaveLength(1);
  });

  it('runs with no rule at all, the limit being zero', () => {
    // Board Setup has no value for this; a bare overlap is the violation.
    const b = board({ tracks: [track(0, 10, 1)], vias: [via(5, 2)] });

    expect(holeErrors(b, undefined)).toHaveLength(1);
  });

  it('leaves a track that clears the drill alone', () => {
    const b = board({ tracks: [track(0, 3, 1)], vias: [via(5, 2)] });

    expect(holeErrors(b)).toHaveLength(0);
  });

  it('does not report a track entering its own net’s pad', () => {
    // The same-net skip: without it every through-hole connection is flagged.
    const b = board({ tracks: [track(0, 5, 1)], footprints: [fp([pad(5, 1)])] });

    expect(holeErrors(b)).toHaveLength(0);
  });

  it('does report a track crossing a different net’s pad drill', () => {
    const b = board({ tracks: [track(0, 10, 1)], footprints: [fp([pad(5, 2)])] });

    expect(holeErrors(b)).toHaveLength(1);
  });

  it('never reports an item against its own hole', () => {
    // A via's copper always lies over its own drill. No separate guard is
    // needed: the item and its hole share a net, so the same-net skip covers
    // it — which is why there is no `is this my own hole` test in the code.
    expect(holeErrors(board({ vias: [via(5, 1)] }))).toHaveLength(0);
    expect(holeErrors(board({ footprints: [fp([pad(5, 1)])] }))).toHaveLength(0);
  });

  it('honours a rule clearance, catching copper that merely comes close', () => {
    // Track edge at x = 3.1, drill edge at 4.8: 1.7 mm apart.
    const b = board({ tracks: [track(0, 3, 1)], vias: [via(5, 2)] });

    expect(holeErrors(b)).toHaveLength(0);
    expect(
      holeErrors(b, `(version 1) (rule "r" (constraint hole_clearance (min 2mm)))`),
    ).toHaveLength(1);
  });

  it('names the rule that imposed the clearance', () => {
    const b = board({ tracks: [track(0, 3, 1)], vias: [via(5, 2)] });
    const v = holeErrors(b, `(version 1) (rule "drills" (constraint hole_clearance (min 2mm)))`);

    expect(v[0]!.message).toContain("rule 'drills'");
  });

  it('does not reach a via hole on a layer the via does not span', () => {
    const blind = via(5, 2, { kind: 'blind', layers: ['F.Cu', 'In1.Cu'] });
    const b = board({ tracks: [track(0, 10, 1, { layer: 'B.Cu' })], vias: [blind] });

    expect(holeErrors(b)).toHaveLength(0);
  });

  it('follows a slot along its length', () => {
    // A 3 mm × 0.5 mm slot reaches much further along x than its drill width.
    const slot = pad(5, 2, { drill: { oblong: true, w: MM(3), h: MM(0.5) } });
    const b = board({ tracks: [track(0, 4, 1)], footprints: [fp([slot])] });

    expect(holeErrors(b)).toHaveLength(1);
  });
});
