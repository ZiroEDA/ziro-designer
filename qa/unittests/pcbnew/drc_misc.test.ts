// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The four board-hygiene checks: items on disabled layers, unresolved text
 * variables, through-hole pads with no hole, and text on Edge.Cuts.
 *
 * Counterparts: `DRC_TEST_PROVIDER_MISC::testDisabledLayers` and
 * `testTextVars`, `PAD::CheckPads`, and `checkTextOnEdgeCuts` in
 * drc_test_provider_disallow.cpp. Each has a rule that is easy to get too
 * broad, and those are what the tests pin.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type {
  Board,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
  PcbTrack,
  PcbVia,
} from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const track = (layer: string): PcbTrack => ({
  start: { x: 0, y: 0 },
  end: { x: MM(10), y: 0 },
  width: MM(0.2),
  layer,
  net: 1,
  source: EMPTY,
});

const via = (layers: [string, string]): PcbVia => ({
  at: { x: MM(5), y: MM(5) },
  size: MM(0.6),
  drill: MM(0.3),
  layers,
  kind: 'blind',
  net: 1,
  source: EMPTY,
});

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: { x: MM(2), y: MM(2) },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
  net: 0,
  source: EMPTY,
  ...over,
});

const shape = (layer: string): PcbShape => ({
  kind: 'line',
  start: { x: 0, y: 0 },
  end: { x: MM(10), y: 0 },
  width: MM(0.1),
  fill: false,
  layer,
  source: EMPTY,
});

const text = (over: Partial<PcbTextItem> = {}): PcbTextItem => ({
  kind: 'user',
  text: 'hello',
  at: { x: MM(1), y: MM(1) },
  angle: 0,
  layer: 'F.SilkS',
  size: { x: MM(1), y: MM(1) },
  source: EMPTY,
  ...over,
});

const footprint = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'L:F',
  reference: 'U1',
  at: { x: MM(2), y: MM(2) },
  angle: 0,
  layer: 'F.Cu',
  // Enough of a courtyard that the courtyard checks stay quiet.
  pads: [],
  shapes: [],
  texts: [],
  models: [],
  attributes: ['allow_missing_courtyard'],
  source: EMPTY,
  ...over,
});

/** A two-layer board: In1.Cu exists in no `(layers …)` table here. */
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

const codes = (b: Board, code: string) => runDrc(b, BASE).filter((v) => v.code === code);

describe('items on disabled layers', () => {
  it('reports a track on a copper layer the board does not have', () => {
    const v = codes(board({ tracks: [track('In1.Cu')] }), 'item_on_disabled_layer');

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('In1.Cu');
  });

  it('leaves a track on an enabled layer alone', () => {
    expect(codes(board({ tracks: [track('F.Cu')] }), 'item_on_disabled_layer')).toHaveLength(0);
  });

  it('tests a graphic by its layer, like any other item', () => {
    expect(codes(board({ shapes: [shape('In1.Cu')] }), 'item_on_disabled_layer')).toHaveLength(1);
  });

  it('only tests copper — a silkscreen layer is not in the table either', () => {
    // The `(layers …)` table here lists no F.SilkS, and upstream masks the
    // disabled set down to copper, so a silkscreen item is outside this check
    // however absent its layer is.
    const b = board({ shapes: [shape('F.SilkS')], texts: [text({ layer: 'F.SilkS' })] });

    expect(codes(b, 'item_on_disabled_layer')).toHaveLength(0);
  });

  it('reports a via whose span reaches a disabled layer', () => {
    expect(
      codes(board({ vias: [via(['F.Cu', 'In1.Cu'])] }), 'item_on_disabled_layer'),
    ).toHaveLength(1);
  });

  it('reports an SMD pad but not a through-hole one', () => {
    // "Through hole pad pierces all physical layers", so it is never on a
    // disabled layer however the file spells its layer set.
    const smd = footprint({ pads: [pad({ type: 'smd', layers: ['In1.Cu'] })] });
    const th = footprint({
      pads: [
        pad({
          type: 'thru_hole',
          layers: ['In1.Cu'],
          drill: { oblong: false, w: MM(0.3), h: MM(0.3) },
        }),
      ],
    });

    expect(codes(board({ footprints: [smd] }), 'item_on_disabled_layer')).toHaveLength(1);
    expect(codes(board({ footprints: [th] }), 'item_on_disabled_layer')).toHaveLength(0);
  });
});

describe('through-hole pads with no hole', () => {
  const withPad = (p: PcbPad) => board({ footprints: [footprint({ pads: [p] })] });

  it('reports a PTH pad with no drill at all', () => {
    const b = withPad(pad({ type: 'thru_hole', drill: undefined }));

    expect(codes(b, 'through_hole_pad_without_hole')).toHaveLength(1);
  });

  it('reports an NPTH pad with a zero drill', () => {
    const b = withPad(pad({ type: 'np_thru_hole', drill: { oblong: false, w: 0, h: 0 } }));

    expect(codes(b, 'through_hole_pad_without_hole')).toHaveLength(1);
  });

  it('reports an oblong drill missing its second dimension', () => {
    const b = withPad(pad({ type: 'thru_hole', drill: { oblong: true, w: MM(0.5), h: 0 } }));

    expect(codes(b, 'through_hole_pad_without_hole')).toHaveLength(1);
  });

  it('accepts an oblong drill with both dimensions', () => {
    const b = withPad(pad({ type: 'thru_hole', drill: { oblong: true, w: MM(0.5), h: MM(0.8) } }));

    expect(codes(b, 'through_hole_pad_without_hole')).toHaveLength(0);
  });

  it('says nothing about an SMD pad, which is not expected to have one', () => {
    expect(codes(withPad(pad({ type: 'smd' })), 'through_hole_pad_without_hole')).toHaveLength(0);
  });
});

describe('text on Edge.Cuts', () => {
  it('reports board text on the layer', () => {
    expect(
      codes(board({ texts: [text({ layer: 'Edge.Cuts' })] }), 'text_on_edge_cuts'),
    ).toHaveLength(1);
  });

  it('reports footprint text too', () => {
    const fp = footprint({ texts: [text({ layer: 'Edge.Cuts' })] });

    expect(codes(board({ footprints: [fp] }), 'text_on_edge_cuts')).toHaveLength(1);
  });

  it('leaves text on any other layer alone', () => {
    expect(codes(board({ texts: [text({ layer: 'F.SilkS' })] }), 'text_on_edge_cuts')).toHaveLength(
      0,
    );
  });

  it('does not report a graphic on Edge.Cuts', () => {
    // The board outline *is* graphics on Edge.Cuts. Only text-like items
    // corrupt it, which is why checkTextOnEdgeCuts answers false for a shape.
    const b = board({ shapes: [shape('Edge.Cuts')] });

    expect(codes(b, 'text_on_edge_cuts')).toHaveLength(0);
  });
});

describe('unresolved text variables', () => {
  it('reports a variable the reader could not resolve', () => {
    expect(
      codes(board({ texts: [text({ text: 'Rev ${REVISION}' })] }), 'unresolved_variable'),
    ).toHaveLength(1);
  });

  it('says nothing about plain text', () => {
    expect(codes(board({ texts: [text({ text: 'REV A' })] }), 'unresolved_variable')).toHaveLength(
      0,
    );
  });

  it('says nothing about a lone dollar or brace', () => {
    // `$5.00` and `{a}` are ordinary text; only a `${…}` pair is a variable.
    const b = board({ texts: [text({ text: '$5.00 {a}' })] });

    expect(codes(b, 'unresolved_variable')).toHaveLength(0);
  });

  it('reports footprint text as well as board text', () => {
    const fp = footprint({ texts: [text({ text: '${MISSING}' })] });

    expect(codes(board({ footprints: [fp] }), 'unresolved_variable')).toHaveLength(1);
  });
});
