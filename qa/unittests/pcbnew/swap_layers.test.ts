// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Moving board items between copper layers.
 * Counterparts: `DIALOG_SWAP_LAYERS` and `GLOBAL_EDIT_TOOL::SwapLayers`.
 *
 * The name is the first thing to get wrong: this is a **one-way map**, not a
 * swap, and it is not required to be injective. Most of the tests below pin
 * behaviour that a reasonable engineer would "fix" if they ported from the
 * dialog's title rather than from the code — through vias that are skipped
 * entirely, footprints that are left behind, and a zone that loses its fill.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSwapLayerMap,
  copperRank,
  enabledCopperLayers,
  isCopperLayerName,
  swapBoardLayers,
  swapItemLayers,
  swapViaLayerPair,
} from '@ziroeda/pcbnew/src/swap_layers.js';
import type { Board, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const P = (x: number, y: number) => ({ x, y });

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 1, name: 'In1.Cu', kind: 'signal' },
    { id: 2, name: 'In2.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
    { id: 37, name: 'F.SilkS', kind: 'user' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'A'],
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

const track = (layer: string, over = {}) => ({
  start: P(0, 0),
  end: P(1000, 0),
  width: 250,
  layer,
  net: 1,
  source: EMPTY,
  ...over,
});

const via = (kind: PcbVia['kind'], layers: [string, string]): PcbVia => ({
  at: P(0, 0),
  size: 800,
  drill: 400,
  layers,
  kind,
  net: 1,
  source: EMPTY,
});

const zone = (layers: string[], over = {}) => ({
  net: 1,
  layers,
  fills: [{ layer: layers[0]!, polys: [[P(0, 0), P(10, 0), P(10, 10)]] }],
  source: EMPTY,
  ...over,
});

const swap = new Map([
  ['F.Cu', 'B.Cu'],
  ['B.Cu', 'F.Cu'],
]);

describe('naming layers', () => {
  it('recognises front, back and inner copper', () => {
    expect(isCopperLayerName('F.Cu')).toBe(true);
    expect(isCopperLayerName('B.Cu')).toBe(true);
    expect(isCopperLayerName('In7.Cu')).toBe(true);
  });

  it('rejects everything that is not copper', () => {
    // These must never be keys or values of the map, or silkscreen would move.
    for (const l of ['F.SilkS', 'B.Mask', 'Edge.Cuts', 'F.Paste', 'User.1', 'Cu', 'In.Cu'])
      expect(isCopperLayerName(l)).toBe(false);
  });

  it('ranks the back as the deepest layer, not the second', () => {
    // KiCad has three different layer orders and this is the physical one. A
    // written layer list puts B.Cu second (id 2); using that ordinal here
    // would make every blind via's pair come out reversed.
    expect(copperRank('F.Cu')).toBe(0);
    expect(copperRank('In1.Cu')).toBe(1);
    expect(copperRank('B.Cu')).toBeGreaterThan(copperRank('In9.Cu'));
  });
});

describe('the rows the dialog offers', () => {
  it('runs front, inners in order, then back last', () => {
    expect(enabledCopperLayers(board())).toEqual(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
  });

  it('puts the rows in stack order however the layer table is written', () => {
    // A .kicad_pcb lists layers by id, where B.Cu comes *second* — right after
    // F.Cu and before every inner layer. Taking the table's order would offer
    // the back as row two and get the dialog visibly wrong on any board with
    // inner layers.
    const fileOrder = board({
      layers: [
        { id: 0, name: 'F.Cu', kind: 'signal' },
        { id: 2, name: 'B.Cu', kind: 'signal' },
        { id: 4, name: 'In1.Cu', kind: 'signal' },
        { id: 6, name: 'In2.Cu', kind: 'signal' },
      ],
    });

    expect(enabledCopperLayers(fileOrder)).toEqual(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
  });

  it('offers only the copper layers the board actually enables', () => {
    // Synthesising names from a layer count would offer rows for inner layers
    // this board does not have.
    const twoLayer = board({
      layers: [
        { id: 0, name: 'F.Cu', kind: 'signal' },
        { id: 31, name: 'B.Cu', kind: 'signal' },
        { id: 37, name: 'F.SilkS', kind: 'user' },
      ],
    });

    expect(enabledCopperLayers(twoLayer)).toEqual(['F.Cu', 'B.Cu']);
  });
});

describe('building the map', () => {
  it('is total — every enabled copper layer gets an entry', () => {
    // Upstream seeds each row with itself, so identity rows are present. The
    // via branch reads the map directly, so a sparse map diverges there.
    const m = buildSwapLayerMap(board(), new Map([['F.Cu', 'B.Cu']]));

    expect([...m.keys()].sort()).toEqual(['B.Cu', 'F.Cu', 'In1.Cu', 'In2.Cu']);
    expect(m.get('In1.Cu')).toBe('In1.Cu');
  });

  it('drops a destination that is not an enabled copper layer', () => {
    const m = buildSwapLayerMap(
      board(),
      new Map([
        ['F.Cu', 'F.SilkS'], // not copper
        ['In1.Cu', 'In9.Cu'], // copper, but this board has no In9
      ]),
    );

    expect(m.get('F.Cu')).toBe('F.Cu');
    expect(m.get('In1.Cu')).toBe('In1.Cu');
  });

  it('accepts a non-injective map', () => {
    // Two layers onto one is allowed and merges them, with no warning. A port
    // that rejected it would refuse something KiCad permits.
    const m = buildSwapLayerMap(
      board(),
      new Map([
        ['In1.Cu', 'F.Cu'],
        ['In2.Cu', 'F.Cu'],
      ]),
    );

    expect(m.get('In1.Cu')).toBe('F.Cu');
    expect(m.get('In2.Cu')).toBe('F.Cu');
  });
});

describe('mapping one item’s layers', () => {
  it('maps simultaneously, never sequentially', () => {
    // The whole reason a two-row swap works. Applied in sequence, F.Cu would
    // become B.Cu and then B.Cu would become F.Cu again — a no-op.
    expect(swapItemLayers(['F.Cu', 'B.Cu'], swap)).toEqual(['B.Cu', 'F.Cu']);
  });

  it('collapses duplicates, because upstream’s layer set is a bitset', () => {
    const merge = new Map([
      ['In1.Cu', 'F.Cu'],
      ['In2.Cu', 'F.Cu'],
    ]);

    expect(swapItemLayers(['In1.Cu', 'In2.Cu'], merge)).toEqual(['F.Cu']);
  });

  it('passes unmapped layers straight through', () => {
    expect(swapItemLayers(['F.SilkS', 'F.Cu'], swap)).toEqual(['F.SilkS', 'B.Cu']);
  });
});

describe('vias', () => {
  it('never touches a through via', () => {
    // Skipped before its layers are even read. A through via spans the whole
    // stack, so a front/back swap cannot change it — and remapping its ends
    // would invent a blind via nobody asked for.
    expect(swapViaLayerPair(via('through', ['F.Cu', 'B.Cu']), swap)).toBeNull();
  });

  it('moves a blind via and keeps the pair ordered by depth', () => {
    expect(swapViaLayerPair(via('blind', ['F.Cu', 'In1.Cu']), swap)).toEqual(['In1.Cu', 'B.Cu']);
  });

  it('re-orders a pair the map inverted', () => {
    // F.Cu→In2.Cu and In1.Cu→F.Cu turns (F,In1) into (In2,F): the shallower
    // layer is now second, so the pair has to be normalised again.
    const m = new Map([
      ['F.Cu', 'In2.Cu'],
      ['In1.Cu', 'F.Cu'],
    ]);

    expect(swapViaLayerPair(via('blind', ['F.Cu', 'In1.Cu']), m)).toEqual(['F.Cu', 'In2.Cu']);
  });

  it('normalises a pair stored deepest-first before mapping it', () => {
    // `(layers "In1.Cu" "F.Cu")` is legal in a file — LayerPair() puts the
    // shallower layer first before anything else looks at it. Skipping that
    // maps the wrong end: here only In1.Cu moves, and reading the pair as
    // given would move F.Cu instead and swap the via end for end.
    const m = new Map([['In1.Cu', 'In2.Cu']]);

    expect(swapViaLayerPair(via('blind', ['In1.Cu', 'F.Cu']), m)).toEqual(['F.Cu', 'In2.Cu']);
  });

  it('leaves a micro via whose ends are unmapped alone', () => {
    expect(swapViaLayerPair(via('micro', ['F.Cu', 'In1.Cu']), new Map())).toBeNull();
  });
});

describe('applying it to a board', () => {
  it('returns the very same board when nothing moves', () => {
    // Not merely equal — identical. Upstream guards its commit with
    // `if (hasChanges)`, so an all-identity map must not dirty the editor or
    // push an undo entry.
    const b = board({ tracks: [track('F.Cu')] });
    const identity = buildSwapLayerMap(b, new Map());

    expect(swapBoardLayers(b, identity)).toBe(b);
  });

  it('moves tracks, arcs, shapes and zones', () => {
    const b = board({
      tracks: [track('F.Cu')],
      arcs: [{ ...track('F.Cu'), mid: P(500, 100) }],
      shapes: [
        {
          kind: 'line' as const,
          start: P(0, 0),
          end: P(1, 1),
          width: 100,
          fill: false,
          layer: 'F.Cu',
          source: EMPTY,
        },
      ],
      zones: [zone(['F.Cu'])],
    });
    const out = swapBoardLayers(b, swap);

    expect(out.tracks[0]!.layer).toBe('B.Cu');
    expect(out.arcs[0]!.layer).toBe('B.Cu');
    expect(out.shapes[0]!.layer).toBe('B.Cu');
    expect(out.zones[0]!.layers).toEqual(['B.Cu']);
  });

  it('leaves footprints and pads exactly where they were', () => {
    // Upstream visits Tracks, Generators, Zones and Drawings — not Footprints.
    // Swapping a real board therefore moves the copper and strands every pad,
    // leaving the board electrically inconsistent. That is KiCad's behaviour;
    // "fixing" it here would make a round-trip through both tools disagree.
    const fp = { ref: 'R1', layer: 'F.Cu', at: P(0, 0), pads: [], source: EMPTY } as never;
    const b = board({ footprints: [fp], tracks: [track('F.Cu')] });
    const out = swapBoardLayers(b, swap);

    expect(out.footprints[0]).toBe(fp);
    expect(out.tracks[0]!.layer).toBe('B.Cu');
  });

  it('never moves an item off a non-copper layer', () => {
    const b = board({
      shapes: [
        {
          kind: 'line' as const,
          start: P(0, 0),
          end: P(1, 1),
          width: 100,
          fill: false,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });

    expect(swapBoardLayers(b, swap)).toBe(b);
  });

  it('discards a zone’s fill when the zone moves', () => {
    // ZONE::SetLayerSet clears the filled polygons and flags a refill. Keeping
    // them would draw copper on a layer the zone no longer occupies.
    const b = board({ zones: [zone(['F.Cu'])] });
    const out = swapBoardLayers(b, swap);

    expect(b.zones[0]!.fills).toHaveLength(1);
    expect(out.zones[0]!.fills).toEqual([]);
  });

  it('moves a zone written with a layer wildcard', () => {
    // read-board keeps `(layers …)` verbatim, so `F&B.Cu` reaches the model as
    // a literal string. Unexpanded it matches no key, and the swap would skip
    // exactly the zones most likely to be on both sides.
    const b = board({ zones: [zone(['F&B.Cu'])] });
    const out = swapBoardLayers(
      b,
      new Map([
        ['F.Cu', 'In1.Cu'],
        ['B.Cu', 'B.Cu'],
      ]),
    );

    expect(out.zones[0]!.layers).toEqual(['In1.Cu', 'B.Cu']);
  });

  it('merges two layers onto one without complaint', () => {
    const b = board({ zones: [zone(['In1.Cu', 'In2.Cu'])] });
    const out = swapBoardLayers(
      b,
      new Map([
        ['In1.Cu', 'F.Cu'],
        ['In2.Cu', 'F.Cu'],
      ]),
    );

    expect(out.zones[0]!.layers).toEqual(['F.Cu']);
  });
});
