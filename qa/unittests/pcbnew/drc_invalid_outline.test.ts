// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board outline.
 * Counterpart: the outline tests of `drc_test_provider_misc.cpp`, over
 * `TestBoardOutlinesGraphicItems` and `BuildBoardPolygonOutlines`.
 *
 * Two separate failures share one code: graphics too small to build anything
 * from, and an Edge.Cuts set that will not chain into a closed shape.
 *
 * The chaining is the courtyard builder's, at the *board's* epsilon — 0.01 mm
 * rather than the courtyard's 0.02 mm. An outline gap this test lets through
 * becomes a gap in the 3D model and in the fabrication outline, so the board
 * is held to the tighter figure.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const line = (x0: number, y0: number, x1: number, y1: number, layer = 'Edge.Cuts'): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.05),
  fill: false,
  layer,
  source: EMPTY,
});

/** Four lines forming a closed rectangle, as a real outline is drawn. */
const rectOutline = (): PcbShape[] => [
  line(0, 0, 50, 0),
  line(50, 0, 50, 40),
  line(50, 40, 0, 40),
  line(0, 40, 0, 0),
];

const board = (shapes: PcbShape[]): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes,
  texts: [],
  dimensions: [],
  textBoxes: [],
  groups: [],
  source: EMPTY,
});

const OPTS: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const outline = (b: Board) => runDrc(b, OPTS).filter((v) => v.code === 'invalid_outline');

describe('board outline', () => {
  it('accepts a closed rectangle', () => {
    expect(outline(board(rectOutline()))).toHaveLength(0);
  });

  it('reports a board with no Edge.Cuts at all', () => {
    const v = outline(board([]));

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('no edges found');
  });

  it('does not count graphics on other layers as an outline', () => {
    const v = outline(board([line(0, 0, 50, 0, 'F.SilkS')]));

    expect(v[0]!.message).toContain('no edges found');
  });

  it('reports an outline with a gap too large to chain', () => {
    const shapes = rectOutline();
    shapes[0] = line(0, 0, 45, 0);

    const v = outline(board(shapes));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('not a closed shape');
  });

  it('closes a gap under the board epsilon', () => {
    // 0.005 mm, inside the 0.01 mm the board allows.
    const shapes = rectOutline();
    shapes[0] = line(0, 0, 49.995, 0);

    expect(outline(board(shapes))).toHaveLength(0);
  });

  it('holds the board to a tighter epsilon than a courtyard', () => {
    // 0.015 mm would chain as a courtyard (0.02 mm) but not as an outline.
    const shapes = rectOutline();
    shapes[0] = line(0, 0, 49.985, 0);

    expect(outline(board(shapes))).toHaveLength(1);
  });

  it('takes a closed rectangle graphic as an outline on its own', () => {
    const rect: PcbShape = {
      kind: 'rect',
      start: { x: 0, y: 0 },
      end: { x: MM(50), y: MM(40) },
      width: MM(0.05),
      fill: false,
      layer: 'Edge.Cuts',
      source: EMPTY,
    };

    expect(outline(board([rect]))).toHaveLength(0);
  });

  it('reports a graphic too small to build anything from', () => {
    // A few nanometres across: invisible on screen, and it builds nothing.
    const speck = line(0, 0, 0, 0);
    speck.end = { x: 500, y: 0 };

    const v = outline(board([...rectOutline(), speck]));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('Suspicious items');
  });

  it('measures a circle by its radius, not its diameter', () => {
    // A circle of radius 5 mm is a fine outline; one of radius 600 nm is not.
    // 600 is chosen so that measuring the diameter instead would read 1200 nm
    // and clear the 1000 nm floor — the test distinguishes the two.
    const circle = (r: number): PcbShape => ({
      kind: 'circle',
      center: { x: MM(10), y: MM(10) },
      end: { x: MM(10) + r, y: MM(10) },
      width: MM(0.05),
      fill: false,
      layer: 'Edge.Cuts',
      source: EMPTY,
    });

    expect(outline(board([circle(MM(5))]))).toHaveLength(0);
    expect(outline(board([circle(600)]))[0]!.message).toContain('Suspicious items');
  });
});
