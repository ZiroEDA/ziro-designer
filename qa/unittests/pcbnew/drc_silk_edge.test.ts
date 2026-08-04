// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Silkscreen clipped by the board edge.
 * Counterpart: the DRCE_SILK_EDGE_CLEARANCE branch of
 * `drc_test_provider_edge_clearance.cpp`.
 *
 * Same edges as the copper check (#242) and the same centreline rule for
 * Edge.Cuts, but its own clearance and its own code: silk running off the edge
 * is trimmed by the fab rather than shorting anything, so it is usually a
 * gentler severity — while still losing the legend it was meant to print.
 *
 * Silk *text* is not checked. Its shape is a set of stroked glyphs we do not
 * tessellate, which is the same limit the text-thickness check carries.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbFootprint, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const line = (x0: number, x1: number, layer: string, width = 0.15, y = 0): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y) },
  end: { x: MM(x1), y: MM(y) },
  width: MM(width),
  fill: false,
  layer,
  source: EMPTY,
});

/** A vertical board edge at x. */
const edge = (x: number, layer = 'Edge.Cuts', width = 0.05): PcbShape => ({
  kind: 'line',
  start: { x: MM(x), y: MM(-10) },
  end: { x: MM(x), y: MM(10) },
  width: MM(width),
  fill: false,
  layer,
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
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
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  groups: [],
  source: EMPTY,
  ...over,
});

const opts = (minSilkClearance: number): DrcOptions => ({
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
  minSilkClearance,
});

const silkEdge = (b: Board, o: DrcOptions) =>
  runDrc(b, o).filter((v) => v.code === 'silk_edge_clearance');

describe('silkscreen to board edge', () => {
  it('reports a silk line running too close to the edge', () => {
    // Edge at 10, silk ends at 9.8 with a 0.075 mm half-width: 0.125 mm gap.
    const b = board({ shapes: [edge(10), line(0, 9.8, 'F.SilkS')] });

    expect(silkEdge(b, opts(MM(0.5)))).toHaveLength(1);
    expect(silkEdge(b, opts(MM(0.05)))).toHaveLength(0);
  });

  it('checks the back silkscreen as well as the front', () => {
    const b = board({ shapes: [edge(10), line(0, 9.8, 'B.SilkS')] });

    expect(silkEdge(b, opts(MM(0.5)))).toHaveLength(1);
  });

  it('ignores graphics on other layers', () => {
    const b = board({ shapes: [edge(10), line(0, 9.8, 'F.Fab')] });

    expect(silkEdge(b, opts(MM(0.5)))).toHaveLength(0);
  });

  it('reports silk that actually crosses the edge even at zero clearance', () => {
    // SHAPE::Collide is inclusive, so a clearance of zero still catches an
    // overlap — the case that matters when Board Setup asks for no clearance.
    const b = board({ shapes: [edge(10), line(0, 10.5, 'F.SilkS')] });

    expect(silkEdge(b, opts(0))).toHaveLength(1);
  });

  it('is off when the clearance is negative', () => {
    // Even for silk laid straight across the edge.
    const b = board({ shapes: [edge(10), line(0, 10.5, 'F.SilkS')] });

    expect(silkEdge(b, opts(-1))).toHaveLength(0);
  });

  it('measures from the Edge.Cuts centreline, as the copper check does', () => {
    // A 1 mm wide edge line: its drawn edge reaches 9.5, but the cut is at 10.
    const b = board({ shapes: [edge(10, 'Edge.Cuts', 1), line(0, 9.6, 'F.SilkS')] });

    expect(silkEdge(b, opts(MM(0.2)))).toHaveLength(0);
    expect(silkEdge(b, opts(MM(0.5)))).toHaveLength(1);
  });

  it('honours a Margin band’s own width', () => {
    const b = board({ shapes: [edge(10, 'Margin', 1), line(0, 9.6, 'F.SilkS')] });

    expect(silkEdge(b, opts(MM(0.2)))).toHaveLength(1);
  });

  it('reports each graphic once however many edges it is near', () => {
    const b = board({ shapes: [edge(9.9), edge(10.1), line(0, 9.95, 'F.SilkS')] });

    expect(silkEdge(b, opts(MM(0.5)))).toHaveLength(1);
  });

  it('reads silkscreen drawn inside a footprint', () => {
    const fp: PcbFootprint = {
      lib: 'L:F',
      reference: 'U1',
      at: { x: 0, y: 0 },
      angle: 0,
      layer: 'F.Cu',
      pads: [],
      shapes: [line(0, 9.8, 'F.SilkS')],
      texts: [],
      models: [],
      attributes: ['allow_missing_courtyard'],
      source: EMPTY,
    };
    const b = board({ shapes: [edge(10)], footprints: [fp] });

    expect(silkEdge(b, opts(MM(0.5)))).toHaveLength(1);
  });

  it('says nothing when the silk stays well clear', () => {
    const b = board({ shapes: [edge(10), line(0, 5, 'F.SilkS')] });

    expect(silkEdge(b, opts(MM(0.5)))).toHaveLength(0);
  });

  it('says nothing on a board with no edge graphics', () => {
    const b = board({ shapes: [line(0, 9.8, 'F.SilkS')] });

    expect(silkEdge(b, opts(MM(0.5)))).toHaveLength(0);
  });
});
