// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Silkscreen printed over a solder mask opening.
 * Counterpart: the SILK_MASK_CLEARANCE half of
 * `drc_test_provider_silk_clearance.cpp`.
 *
 * Silk over an opening lands on bare metal, where it will not adhere and can
 * wick into the joint — so unlike the silk-to-edge check this one matters even
 * at a clearance of zero, where a bare overlap is the violation.
 *
 * Two limits, both stated in the engine: silk *text* is not checked (its shape
 * is stroked glyphs we do not tessellate) and the board-level mask expansion
 * is not modelled, so a pad with no local margin opens at its copper outline —
 * which is what KiCad's default of zero means anyway.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbFootprint, PcbPad, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/** A 2 mm square pad at (10, 10), open on the front mask. */
const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: { x: MM(10), y: MM(10) },
  angle: 0,
  size: { x: MM(2), y: MM(2) },
  layers: ['F.Cu', 'F.Mask'],
  net: 0,
  source: EMPTY,
  ...over,
});

const silk = (x0: number, x1: number, y = 10, layer = 'F.SilkS'): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y) },
  end: { x: MM(x1), y: MM(y) },
  width: MM(0.15),
  fillMode: 'none',
  layer,
  source: EMPTY,
});

const fp = (pads: PcbPad[], shapes: PcbShape[] = []): PcbFootprint => ({
  lib: 'L:F',
  reference: 'U1',
  at: { x: MM(10), y: MM(10) },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes,
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  attributes: ['allow_missing_courtyard'],
  source: EMPTY,
});

const board = (footprints: PcbFootprint[], shapes: PcbShape[] = []): Board => ({
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
  shapes,
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
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

const overMask = (b: Board, o: DrcOptions) =>
  runDrc(b, o).filter((v) => v.code === 'silk_over_copper');

describe('silkscreen over a mask opening', () => {
  it('reports silk crossing a pad, even at zero clearance', () => {
    // The pad opens 9..11; the silk runs straight through it.
    const b = board([fp([pad()])], [silk(5, 15)]);

    expect(overMask(b, opts(0))).toHaveLength(1);
  });

  it('says nothing when the silk clears the opening', () => {
    const b = board([fp([pad()])], [silk(0, 5)]);

    expect(overMask(b, opts(0))).toHaveLength(0);
  });

  it('honours a clearance, catching silk that merely comes close', () => {
    // Silk ends at 8.5 with a 0.075 mm half-width; the pad opens at 9.
    const b = board([fp([pad()])], [silk(0, 8.5)]);

    expect(overMask(b, opts(0))).toHaveLength(0);
    expect(overMask(b, opts(MM(0.5)))).toHaveLength(1);
  });

  it('grows the opening by the pad’s own mask margin', () => {
    // A 1 mm margin opens the pad from 8 to 12, which the silk now touches.
    const wide = pad({ localSolderMaskMargin: MM(1) });
    const b = board([fp([wide])], [silk(0, 8.2)]);

    expect(overMask(b, opts(0))).toHaveLength(1);
    expect(overMask(board([fp([pad()])], [silk(0, 8.2)]), opts(0))).toHaveLength(0);
  });

  it('falls back to the footprint’s margin when the pad has none', () => {
    const f: PcbFootprint = { ...fp([pad()]), localSolderMaskMargin: MM(1) };
    const b = board([f], [silk(0, 8.2)]);

    expect(overMask(b, opts(0))).toHaveLength(1);
  });

  it('keeps the two sides apart', () => {
    // Back silk over a front-only opening is not a violation.
    const b = board([fp([pad()])], [silk(5, 15, 10, 'B.SilkS')]);

    expect(overMask(b, opts(0))).toHaveLength(0);
  });

  it('checks both sides of a pad open on both', () => {
    const both = pad({ layers: ['F.Cu', 'B.Cu', '*.Mask'] });
    const b = board([fp([both])], [silk(5, 15, 10, 'B.SilkS')]);

    expect(overMask(b, opts(0))).toHaveLength(1);
  });

  it('ignores a pad with no mask opening at all', () => {
    // A pad with no mask layer is covered; silk over it is printed on mask.
    const covered = pad({ layers: ['F.Cu'] });
    const b = board([fp([covered])], [silk(5, 15)]);

    expect(overMask(b, opts(0))).toHaveLength(0);
  });

  it('reads silkscreen drawn inside a footprint', () => {
    const b = board([fp([pad()], [silk(5, 15)])]);

    expect(overMask(b, opts(0))).toHaveLength(1);
  });

  it('reports a graphic once however many pads it crosses', () => {
    const two = [pad(), pad({ number: '2', at: { x: MM(14), y: MM(10) } })];
    const b = board([fp(two)], [silk(5, 20)]);

    expect(overMask(b, opts(0))).toHaveLength(1);
  });

  it('is off when the clearance is negative', () => {
    const b = board([fp([pad()])], [silk(5, 15)]);

    expect(overMask(b, opts(-1))).toHaveLength(0);
  });
});
