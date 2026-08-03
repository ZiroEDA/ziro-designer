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
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  allItemsState,
  DEFAULT_SELECTION_FILTER,
  filterSelection,
  itemPassesFilter,
  setAllFilterItems,
  type SelectionFilter,
} from '@ziroeda/pcbnew/src/filter_selection.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const board = (): Board => ({
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
          source: EMPTY,
        },
      ],
      shapes: [],
      texts: [],
      models: [],
      source: EMPTY,
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
      models: [],
      source: EMPTY,
    },
  ],
  tracks: [
    {
      start: { x: 0, y: 0 },
      end: { x: MM(10), y: 0 },
      width: MM(0.2),
      layer: 'F.Cu',
      net: 0,
      source: EMPTY,
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
      source: EMPTY,
    },
  ],
  zones: [{ net: 0, layers: ['F.Cu'], fills: [], source: EMPTY }],
  shapes: [
    // 0: silkscreen, 1: board outline.
    {
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: MM(5), y: 0 },
      width: MM(0.1),
      fill: false,
      layer: 'F.SilkS',
      source: EMPTY,
    },
    {
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: MM(50), y: 0 },
      width: MM(0.05),
      fill: false,
      layer: 'Edge.Cuts',
      source: EMPTY,
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
      source: EMPTY,
    },
  ],
  dimensions: [],
  groups: [],
  source: EMPTY,
});

/** Nothing ticked but the boxes named. */
const only = (over: Partial<SelectionFilter>): SelectionFilter => ({
  ...setAllFilterItems(false),
  ...over,
});

describe('itemPassesFilter', () => {
  const b = board();

  it('keeps each kind when its own box is ticked', () => {
    expect(itemPassesFilter(b, 'track:0', only({ tracks: true }))).toBe(true);
    expect(itemPassesFilter(b, 'via:0', only({ vias: true }))).toBe(true);
    expect(itemPassesFilter(b, 'zone:0', only({ zones: true }))).toBe(true);
    expect(itemPassesFilter(b, 'text:0', only({ text: true }))).toBe(true);
  });

  it('drops each kind when its box is not', () => {
    expect(itemPassesFilter(b, 'track:0', only({ vias: true }))).toBe(false);
    expect(itemPassesFilter(b, 'via:0', only({ tracks: true }))).toBe(false);
  });

  it('splits graphics by layer, outline from tech', () => {
    // Edge.Cuts is the board outline; anything else is a tech layer.
    expect(itemPassesFilter(b, 'shape:1', only({ boardOutline: true }))).toBe(true);
    expect(itemPassesFilter(b, 'shape:1', only({ techLayers: true }))).toBe(false);

    expect(itemPassesFilter(b, 'shape:0', only({ techLayers: true }))).toBe(true);
    expect(itemPassesFilter(b, 'shape:0', only({ boardOutline: true }))).toBe(false);
  });

  it('keeps an unlocked footprint without the locked box', () => {
    expect(itemPassesFilter(b, 'footprint:0', only({ footprints: true }))).toBe(true);
  });

  it('drops a locked footprint until the locked box is ticked', () => {
    expect(itemPassesFilter(b, 'footprint:1', only({ footprints: true }))).toBe(false);
    expect(
      itemPassesFilter(b, 'footprint:1', only({ footprints: true, lockedFootprints: true })),
    ).toBe(true);
  });

  it('drops every footprint when the footprints box is off, locked or not', () => {
    const lockedOnly = only({ lockedFootprints: true });

    expect(itemPassesFilter(b, 'footprint:0', lockedOnly)).toBe(false);
    expect(itemPassesFilter(b, 'footprint:1', lockedOnly)).toBe(false);
  });

  it('drops kinds the dialog does not offer at all', () => {
    // Inclusive, not exclusive: a pad or a group has no checkbox, so it is not
    // kept — even with everything ticked.
    const all = setAllFilterItems(true);

    expect(itemPassesFilter(b, 'pad:0:0', all)).toBe(false);
    expect(itemPassesFilter(b, 'group:0', all)).toBe(false);
  });

  it('drops an id that resolves to nothing', () => {
    expect(itemPassesFilter(b, 'track:99', setAllFilterItems(true))).toBe(false);
    expect(itemPassesFilter(b, 'nonsense', setAllFilterItems(true))).toBe(false);
  });
});

describe('filterSelection', () => {
  const b = board();

  it('keeps the surviving ids in the order given', () => {
    const kept = filterSelection(
      b,
      ['via:0', 'track:0', 'zone:0'],
      only({ tracks: true, vias: true }),
    );

    expect(kept).toEqual(['via:0', 'track:0']);
  });

  it('returns nothing when nothing is ticked', () => {
    expect(filterSelection(b, ['track:0', 'via:0'], setAllFilterItems(false))).toEqual([]);
  });
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
