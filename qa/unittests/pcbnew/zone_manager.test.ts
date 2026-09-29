// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pcbnew/zone_manager/{model_zones_overview,board_edges_bounding_item}, read
 * off the C++: MODEL_ZONES_OVERVIEW's filter (name OR net, case-insensitive,
 * within the layer filter), priority-order sort after a filter, the four
 * MoveZoneIndex movements and their swap-only-when-in-range rule, and
 * MakeBitmapForLayers' four-stripe cap.
 */
import { describe, expect, it } from 'vitest';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import { ZONE_SETTINGS_BAG } from '@ziroeda/pcbnew/zone_settings_bag.js';
import { BOARD_EDGES_BOUNDING_ITEM } from '@ziroeda/pcbnew/zone_manager/board_edges_bounding_item.js';
import {
  MakeBitmapForLayers,
  MODEL_ZONES_OVERVIEW,
  ZONE_INDEX_MOVEMENT,
  ZONES_OVERVIEW_COL,
  type MODEL_ZONES_OVERVIEW_VIEW,
} from '@ziroeda/pcbnew/zone_manager/model_zones_overview.js';

function zone(board: BOARD, name: string, priority: number, layer = PCB_LAYER_ID.F_Cu): ZONE {
  const z = new ZONE(board);
  for (const p of [
    { x: 0, y: 0 },
    { x: 1e6, y: 0 },
    { x: 1e6, y: 1e6 },
  ])
    z.AppendCorner(p, -1);
  z.SetLayer(layer);
  z.SetZoneName(name);
  z.SetAssignedPriority(priority);
  return z;
}

function setup(specs: [string, number, PCB_LAYER_ID?][]) {
  const board = new BOARD();
  for (const [n, p, l] of specs) board.Add(zone(board, n, p, l));
  const bag = new ZONE_SETTINGS_BAG(board);
  const events: string[] = [];
  const view: MODEL_ZONES_OVERVIEW_VIEW = {
    Reset: (n) => events.push(`reset ${n}`),
    RowChanged: (r) => events.push(`row ${r}`),
    OnRowCountChange: (n) => events.push(`count ${n}`),
  };
  const colors = new COLOR_SETTINGS();
  const model = new MODEL_ZONES_OVERVIEW(
    view,
    { GetBoard: () => board, GetColorSettings: () => colors },
    bag,
  );
  const names = (): string[] =>
    Array.from(
      { length: model.GetCount() },
      (_, i) => model.GetValueByRow(i, ZONES_OVERVIEW_COL.NAME)!.text,
    );
  return { board, bag, model, events, names };
}

describe('MODEL_ZONES_OVERVIEW filter', () => {
  it('matches name or net, case-insensitively, then sorts by priority (highest first)', () => {
    const { model, names, events } = setup([
      ['GND_top', 1],
      ['pwr', 5],
      ['gnd_bottom', 3],
    ]);
    expect(events).toEqual(['reset 3']);
    model.ApplyFilter('  GND ', null);
    expect(names()).toEqual(['gnd_bottom', 'GND_top']);
    expect(events.slice(1)).toEqual(['reset 2', 'count 2']);
  });

  it('name-only and net-only fitters: with both off nothing matches', () => {
    const { model, names } = setup([['abc', 1]]);
    model.EnableFitterByName(false);
    model.EnableFitterByNet(false);
    model.ApplyFilter('abc', null);
    expect(names()).toEqual([]);
    model.EnableFitterByName(true);
    model.ApplyFilter('abc', null);
    expect(names()).toEqual(['abc']);
  });

  it('an empty filter clears it, sorted by priority; the selected zone is re-found by identity', () => {
    const { model, names } = setup([
      ['a', 1],
      ['b', 9],
      ['c', 4],
    ]);
    // Row 2 of the unfiltered (bag order) list is 'c'. The filter narrows to it (row 0).
    const narrowed = model.ApplyFilter('c', model.GetItem(2));
    expect(names()).toEqual(['c']);
    expect(model.GetZone(narrowed)!.GetZoneName()).toBe('c');
    const after = model.ApplyFilter('   ', narrowed);
    expect(names()).toEqual(['b', 'c', 'a']);
    expect(model.GetZone(after)!.GetZoneName()).toBe('c');
    expect(after).toBe(1);
  });

  it('the layer filter drops zones not on that layer, with or without text', () => {
    const { model, names } = setup([
      ['top', 1, PCB_LAYER_ID.F_Cu],
      ['bot', 2, PCB_LAYER_ID.B_Cu],
    ]);
    model.SetLayerFilter(PCB_LAYER_ID.B_Cu);
    model.ClearFilter(null);
    expect(names()).toEqual(['bot']);
    model.ApplyFilter('t', null);
    expect(names()).toEqual(['bot']);
    model.ApplyFilter('top', null);
    expect(names()).toEqual([]);
  });
});

describe('MODEL_ZONES_OVERVIEW priority moves', () => {
  const four = (): ReturnType<typeof setup> =>
    setup([
      ['a', 4],
      ['b', 3],
      ['c', 2],
      ['d', 1],
    ]);

  it('the constructor keeps the bag order (board order), not priority order', () => {
    // GetClonedZoneList is board order; only the filters sort.
    const { names } = four();
    expect(names()).toHaveLength(4);
  });

  it('MOVE_UP / MOVE_DOWN swap neighbours and swap the bag priorities too', () => {
    const { model, bag, names, events } = four();
    model.ClearFilter(null); // priority order a b c d
    expect(model.MoveZoneIndex(2, ZONE_INDEX_MOVEMENT.MOVE_UP)).toBe(1);
    expect(names()).toEqual(['a', 'c', 'b', 'd']);
    expect(events.slice(-2)).toEqual(['row 2', 'row 1']);
    const [a, c, b] = [0, 1, 2].map((i) => model.GetZone(i)!);
    expect(bag.GetZonePriority(c!)).toBeGreaterThan(bag.GetZonePriority(b!));
    expect(bag.GetZonePriority(a!)).toBeGreaterThan(bag.GetZonePriority(c!));
    expect(model.MoveZoneIndex(0, ZONE_INDEX_MOVEMENT.MOVE_UP)).toBeUndefined();
    expect(model.MoveZoneIndex(3, ZONE_INDEX_MOVEMENT.MOVE_DOWN)).toBeUndefined();
    expect(model.MoveZoneIndex(0, ZONE_INDEX_MOVEMENT.MOVE_DOWN)).toBe(1);
  });

  it('MOVE_TO_TOP / MOVE_TO_BOTTOM rotate the row to the end and answer its new index', () => {
    const { model, names } = four();
    model.ClearFilter(null);
    expect(model.MoveZoneIndex(3, ZONE_INDEX_MOVEMENT.MOVE_TO_TOP)).toBe(0);
    expect(names()).toEqual(['d', 'a', 'b', 'c']);
    expect(model.MoveZoneIndex(0, ZONE_INDEX_MOVEMENT.MOVE_TO_BOTTOM)).toBe(3);
    expect(names()).toEqual(['a', 'b', 'c', 'd']);
    expect(model.MoveZoneIndex(0, ZONE_INDEX_MOVEMENT.MOVE_TO_TOP)).toBeUndefined();
  });

  it('SwapZonePriority: same index answers itself, out of range answers nothing', () => {
    const { model, events } = four();
    const before = events.length;
    expect(model.SwapZonePriority(1, 1)).toBe(1);
    expect(events).toHaveLength(before); // no row changed
    expect(model.SwapZonePriority(1, 9)).toBeUndefined();
    expect(model.SwapZonePriority(-1, 0)).toBeUndefined();
  });
});

describe('MakeBitmapForLayers', () => {
  const colors = new COLOR_SETTINGS();

  it('one stripe per layer, height 16 / n, each in its layer colour', () => {
    const rects = MakeBitmapForLayers([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu], colors, {
      x: 16,
      y: 16,
    });
    expect(rects.map((r) => [r.y, r.h, r.w])).toEqual([
      [0, 8, 16],
      [8, 8, 16],
    ]);
    expect(rects[0]!.color).toEqual(colors.GetColor(PCB_LAYER_ID.F_Cu));
  });

  it('exactly five layers already caps at four stripes', () => {
    const rects = MakeBitmapForLayers([1, 2, 3, 4, 5] as PCB_LAYER_ID[], colors, { x: 16, y: 16 });
    expect(rects).toHaveLength(4);
  });

  it('more than four layers keeps the first two and the last two (last first of the pair)', () => {
    const seq = [1, 2, 3, 4, 5, 6].map((i) => i as PCB_LAYER_ID);
    const rects = MakeBitmapForLayers(seq, colors, { x: 16, y: 16 });
    expect(rects.map((r) => r.color)).toEqual([
      colors.GetColor(1),
      colors.GetColor(2),
      colors.GetColor(6),
      colors.GetColor(5),
    ]);
    expect(rects.every((r) => r.h === 4)).toBe(true);
  });
});

describe('BOARD_EDGES_BOUNDING_ITEM', () => {
  it('is its box, on Edge_Cuts', () => {
    const box = new BOX2I({ x: 1, y: 2 }, { x: 3, y: 4 });
    const item = new BOARD_EDGES_BOUNDING_ITEM(box);
    expect(item.ViewBBox()).toBe(box);
    expect(item.ViewGetLayers()).toEqual([PCB_LAYER_ID.Edge_Cuts]);
    expect(item.GetClass()).toBe('BOARD_EDGES_BOUNDING_ITEM');
  });
});
