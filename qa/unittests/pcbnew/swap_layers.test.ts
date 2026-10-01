// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The view model's string-layer helpers (pcbnew/types.ts), which answer
 * IsCopperLayer and the copper stack order by name. The swap itself is
 * GLOBAL_EDIT_TOOL::SwapLayers on the live BOARD, tested in
 * tools/global_edit_tool.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  type Board,
  copperRank,
  enabledCopperLayers,
  isCopperLayerName,
} from '@ziroeda/pcbnew/types.js';

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
  ...over,
});

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
