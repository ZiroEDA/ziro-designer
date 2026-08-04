// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Padstack sanity: PAD::doCheckPad.
 *
 * Two codes with different weight, and keeping them apart is most of the
 * point: `padstack_invalid` is geometry that cannot be built at all, while
 * `padstack` is a padstack that will build but probably is not what was meant.
 * A board full of the latter is a review note; one of the former will not
 * fabricate.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbFootprint, PcbPad } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: { x: MM(5), y: MM(5) },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
  net: 0,
  source: EMPTY,
  ...over,
});

const board = (pads: PcbPad[]): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints: [
    {
      lib: 'L:F',
      reference: 'U1',
      at: { x: MM(5), y: MM(5) },
      angle: 0,
      layer: 'F.Cu',
      pads,
      shapes: [],
      texts: [],
      models: [],
      attributes: ['allow_missing_courtyard'],
      source: EMPTY,
    },
  ],
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
});

const OPTS: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const bad = (p: PcbPad, code: 'padstack' | 'padstack_invalid') =>
  runDrc(board([p]), OPTS).filter((v) => v.code === code);

const detail = (p: PcbPad, code: 'padstack' | 'padstack_invalid') =>
  bad(p, code)
    .map((v) => v.message)
    .join(' | ');

describe('invalid padstacks', () => {
  it('reports a pad with no size', () => {
    expect(bad(pad({ size: { x: 0, y: MM(1) } }), 'padstack_invalid')).toHaveLength(1);
  });

  it('lets a circle have no y size, since its diameter is x', () => {
    expect(
      bad(pad({ shape: 'circle', size: { x: MM(1), y: 0 } }), 'padstack_invalid'),
    ).toHaveLength(0);
    // …but a rect of the same dimensions is still invalid.
    expect(bad(pad({ shape: 'rect', size: { x: MM(1), y: 0 } }), 'padstack_invalid')).toHaveLength(
      1,
    );
  });

  it('reports a hole too small to turn into a polygon', () => {
    const p = pad({ type: 'thru_hole', drill: { oblong: false, w: 2, h: 2 } });

    expect(detail(p, 'padstack_invalid')).toContain('larger than 4 nm');
  });

  it('reports an SMD pad with a hole', () => {
    const p = pad({ type: 'smd', drill: { oblong: false, w: MM(0.5), h: MM(0.5) } });

    expect(detail(p, 'padstack_invalid')).toContain('SMD pad has a hole');
  });

  it('reports a trapezoid whose delta exceeds the pad', () => {
    const p = pad({ shape: 'trapezoid', size: { x: MM(1), y: MM(1) }, delta: { x: MM(2), y: 0 } });

    expect(detail(p, 'padstack_invalid')).toContain('trapezoid delta is too large');
  });

  it('accepts a trapezoid whose delta fits', () => {
    const p = pad({ shape: 'trapezoid', size: { x: MM(2), y: MM(2) }, delta: { x: MM(1), y: 0 } });

    expect(bad(p, 'padstack_invalid')).toHaveLength(0);
  });

  it('reports a negative corner radius, and a chamfer over half', () => {
    expect(detail(pad({ shape: 'roundrect', roundrectRatio: -0.1 }), 'padstack_invalid')).toContain(
      'negative corner radius',
    );
    expect(detail(pad({ chamferRatio: 0.7 }), 'padstack_invalid')).toContain(
      'corner chamfer is too large',
    );
  });
});

describe('questionable padstacks', () => {
  it('reports a corner radius that makes the pad circular', () => {
    expect(detail(pad({ shape: 'roundrect', roundrectRatio: 0.6 }), 'padstack')).toContain(
      'make pad circular',
    );
    expect(bad(pad({ shape: 'roundrect', roundrectRatio: 0.25 }), 'padstack')).toHaveLength(0);
  });

  it('reports an SMD pad with copper on both sides', () => {
    const p = pad({ type: 'smd', layers: ['F.Cu', 'B.Cu'] });

    expect(detail(p, 'padstack')).toContain('both sides of the board');
  });

  it('reports an SMD pad with no outer layers', () => {
    const p = pad({ type: 'smd', layers: ['F.Mask'] });

    expect(detail(p, 'padstack')).toContain('no outer layers');
  });

  it('reports a connector pad carrying solder paste', () => {
    const p = pad({ type: 'connect', layers: ['F.Cu', 'F.Paste'] });

    expect(detail(p, 'padstack')).toContain('no solder paste');
  });

  it('pairs each property with the attribute it expects', () => {
    expect(detail(pad({ padProperty: 'pad_prop_bga', type: 'thru_hole' }), 'padstack')).toContain(
      'BGA',
    );
    expect(detail(pad({ padProperty: 'pad_prop_castellated', type: 'smd' }), 'padstack')).toContain(
      'castellated',
    );
    expect(
      detail(pad({ padProperty: 'pad_prop_heatsink', type: 'np_thru_hole' }), 'padstack'),
    ).toContain('heatsink');
  });

  it('accepts each property on the attribute it belongs with', () => {
    expect(bad(pad({ padProperty: 'pad_prop_bga', type: 'smd' }), 'padstack')).toHaveLength(0);
    expect(
      bad(pad({ padProperty: 'pad_prop_castellated', type: 'thru_hole' }), 'padstack'),
    ).toHaveLength(0);
  });

  it('wants a press-fit pad to have a round hole', () => {
    const oblong = pad({
      padProperty: 'pad_prop_pressfit',
      type: 'thru_hole',
      drill: { oblong: true, w: MM(1), h: MM(0.5) },
    });
    const round = pad({
      padProperty: 'pad_prop_pressfit',
      type: 'thru_hole',
      drill: { oblong: false, w: MM(0.5), h: MM(0.5) },
    });

    expect(detail(oblong, 'padstack')).toContain('press-fit');
    expect(bad(round, 'padstack')).toHaveLength(0);
  });

  it('reports a negative local clearance as having no effect', () => {
    expect(detail(pad({ localClearance: -MM(0.1) }), 'padstack')).toContain('no effect');
  });

  it('reports a negative mask margin larger than the pad', () => {
    expect(detail(pad({ localSolderMaskMargin: -MM(2) }), 'padstack')).toContain(
      'no solder mask will be generated',
    );
    expect(bad(pad({ localSolderMaskMargin: -MM(0.1) }), 'padstack')).toHaveLength(0);
  });

  it('reports a paste margin that shrinks the pad away', () => {
    expect(detail(pad({ localSolderPasteMargin: -MM(2) }), 'padstack')).toContain(
      'no solder paste mask will be generated',
    );
  });

  it('counts the paste ratio as well as the flat margin', () => {
    // A -100% ratio removes the pad entirely, with no flat margin at all.
    expect(detail(pad({ localSolderPasteMarginRatio: -1 }), 'padstack')).toContain(
      'no solder paste mask',
    );
  });

  it('says nothing about an ordinary pad', () => {
    expect(bad(pad(), 'padstack')).toHaveLength(0);
    expect(bad(pad(), 'padstack_invalid')).toHaveLength(0);
  });
});
