// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Filter Selection.
 * Counterparts: `itemIsIncludedByFilter` / `PCB_SELECTION_TOOL::filterSelection`
 * and `DIALOG_FILTER_SELECTION::GetSuggestedAllItemsState`.
 *
 * The filter is inclusive, not exclusive: a kind the dialog does not offer is
 * *dropped*, not kept. Upstream says so on the default branch, and it is what
 * makes the dialog mean "keep only what I ticked".
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import {
  allItemsState,
  DEFAULT_SELECTION_FILTER,
  setAllFilterItems,
  type SelectionFilter,
} from '@ziroeda/pcbnew/dialogs/dialog_filter_selection.js';
import type { Board } from '@ziroeda/pcbnew/types.js';

const MM = (n: number): number => mmToIU(n);

const _board = (): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints: [
    {
      lib: 'L:R',
      reference: 'R1',
      at: { x: 0, y: 0 },
      angle: 0,
      layer: 'F.Cu',
      pads: [
        {
          number: '1',
          type: 'smd',
          shape: 'rect',
          at: { x: 0, y: 0 },
          angle: 0,
          size: { x: MM(1), y: MM(1) },
          layers: ['F.Cu'],
          net: 0,
        },
      ],
      shapes: [],
      texts: [],
      points: [],
      barcodes: [],
      models: [],
    },
    // Index 1: a locked footprint.
    {
      lib: 'L:C',
      reference: 'C1',
      at: { x: MM(5), y: 0 },
      angle: 0,
      layer: 'F.Cu',
      locked: true,
      pads: [],
      shapes: [],
      texts: [],
      points: [],
      barcodes: [],
      models: [],
    },
  ],
  tracks: [
    {
      start: { x: 0, y: 0 },
      end: { x: MM(10), y: 0 },
      width: MM(0.2),
      layer: 'F.Cu',
      net: 0,
    },
  ],
  arcs: [],
  vias: [
    {
      at: { x: MM(3), y: 0 },
      size: MM(0.6),
      drill: MM(0.3),
      layers: ['F.Cu', 'B.Cu'],
      kind: 'through',
      net: 0,
    },
  ],
  zones: [{ net: 0, layers: ['F.Cu'], fills: [] }],
  shapes: [
    // 0: silkscreen, 1: board outline.
    {
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: MM(5), y: 0 },
      width: MM(0.1),
      fillMode: 'none',
      layer: 'F.SilkS',
    },
    {
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: MM(50), y: 0 },
      width: MM(0.05),
      fillMode: 'none',
      layer: 'Edge.Cuts',
    },
  ],
  texts: [
    {
      kind: 'user',
      text: 'REV A',
      at: { x: 0, y: 0 },
      angle: 0,
      layer: 'F.SilkS',
      size: { x: MM(1), y: MM(1) },
    },
  ],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
});

/** Nothing ticked but the boxes named. */
const _only = (over: Partial<SelectionFilter>): SelectionFilter => ({
  ...setAllFilterItems(false),
  ...over,
});

describe('the All items tri-state', () => {
  it('is checked only when every box is ticked', () => {
    expect(allItemsState(setAllFilterItems(true))).toBe('checked');
  });

  it('is unchecked when none is', () => {
    expect(allItemsState(setAllFilterItems(false))).toBe('unchecked');
  });

  it('reads mixed for the dialog’s own default', () => {
    // Locked footprints off, everything else on: seven of eight. Worth
    // knowing rather than "fixing" — it is what upstream shows on open.
    expect(allItemsState(DEFAULT_SELECTION_FILTER)).toBe('mixed');
  });

  it('does not count the locked box while footprints is off', () => {
    // Everything ticked but the footprints pair: six of eight, so mixed.
    const noFootprints = { ...setAllFilterItems(true), footprints: false, lockedFootprints: false };
    expect(allItemsState(noFootprints)).toBe('mixed');

    // And a lone locked-footprints tick counts for nothing, since its parent
    // is off: unchecked, not mixed.
    expect(allItemsState({ ...setAllFilterItems(false), lockedFootprints: true })).toBe(
      'unchecked',
    );
  });
});
