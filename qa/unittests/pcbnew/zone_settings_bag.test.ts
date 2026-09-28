// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZONE_SETTINGS_BAG` (`pcbnew/zone_settings_bag.cpp`). Cases derived from
 * the C++: the `BOARD*` constructor clones only eligible zones (no rule
 * areas, no teardrops, copper only) and seeds descending priorities in
 * `HigherPriority` order; `SwapPriority` swaps only the *current* half of the
 * (initial, current) pair; `UpdateClonedZones` writes `SetAssignedPriority`
 * only when at least one clone's priority actually moved.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import { ZONE_SETTINGS } from '@ziroeda/pcbnew/zone_settings.js';
import { ZONE_SETTINGS_BAG } from '@ziroeda/pcbnew/zone_settings_bag.js';

const MM = 1_000_000;

const rect = (
  board: BOARD,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  layer = PCB_LAYER_ID.F_Cu,
): ZONE => {
  const z = new ZONE(board);
  for (const p of [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ])
    z.AppendCorner(p, -1);
  z.SetLayer(layer);
  return z;
};

describe('ZONE_SETTINGS_BAG(BOARD*)', () => {
  it('clones only eligible zones - not rule areas, not off-copper', () => {
    const board = new BOARD();
    const copper = rect(board, 0, 0, 10 * MM, 10 * MM, PCB_LAYER_ID.F_Cu);
    const ruleArea = rect(board, 20 * MM, 0, 30 * MM, 10 * MM, PCB_LAYER_ID.F_Cu);
    ruleArea.SetIsRuleArea(true);
    const silkscreen = rect(board, 40 * MM, 0, 50 * MM, 10 * MM, PCB_LAYER_ID.F_SilkS);
    board.Add(copper);
    board.Add(ruleArea);
    board.Add(silkscreen);

    const bag = new ZONE_SETTINGS_BAG(board);

    expect(bag.GetClonedZoneList()).toHaveLength(1);
  });

  it('seeds descending priorities, highest HigherPriority zone first', () => {
    const board = new BOARD();
    // ZONE::HigherPriority compares m_priority first (then UUID); give the
    // "small" zone the higher already-assigned priority so the seeding order
    // is deterministic rather than falling through to the UUID tiebreak.
    const big = rect(board, 0, 0, 20 * MM, 20 * MM);
    big.SetAssignedPriority(0);
    const small = rect(board, 0, 0, 5 * MM, 5 * MM);
    small.SetAssignedPriority(7);
    board.Add(big);
    board.Add(small);

    const bag = new ZONE_SETTINGS_BAG(board);
    const clones = bag.GetClonedZoneList();
    const smallClone = clones.find((z) => z.Outline().BBox().GetWidth() === 5 * MM)!;
    const bigClone = clones.find((z) => z.Outline().BBox().GetWidth() === 20 * MM)!;

    // 2 eligible zones: priorities are {0, 1}; the HigherPriority one (small, m_priority 7) gets the larger number.
    expect(bag.GetZonePriority(smallClone)).toBe(1);
    expect(bag.GetZonePriority(bigClone)).toBe(0);
  });

  it('SwapPriority swaps only the current half of the pair', () => {
    const board = new BOARD();
    const a = rect(board, 0, 0, 5 * MM, 5 * MM);
    const b = rect(board, 0, 0, 20 * MM, 20 * MM);
    board.Add(a);
    board.Add(b);

    const bag = new ZONE_SETTINGS_BAG(board);
    const [cloneA, cloneB] = bag.GetClonedZoneList();
    const before = [bag.GetZonePriority(cloneA!), bag.GetZonePriority(cloneB!)];

    bag.SwapPriority(cloneA!, cloneB!);

    expect(bag.GetZonePriority(cloneA!)).toBe(before[1]);
    expect(bag.GetZonePriority(cloneB!)).toBe(before[0]);
  });

  it('UpdateClonedZones only writes SetAssignedPriority when a priority actually moved', () => {
    const board = new BOARD();
    const a = rect(board, 0, 0, 5 * MM, 5 * MM);
    const b = rect(board, 0, 0, 20 * MM, 20 * MM);
    board.Add(a);
    board.Add(b);

    const bag = new ZONE_SETTINGS_BAG(board);
    const [cloneA, cloneB] = bag.GetClonedZoneList();
    const originalA = cloneA!.GetAssignedPriority();
    const originalB = cloneB!.GetAssignedPriority();

    // No SetZonePriority call: nothing moved.
    bag.UpdateClonedZones();
    expect(cloneA!.GetAssignedPriority()).toBe(originalA);
    expect(cloneB!.GetAssignedPriority()).toBe(originalB);

    bag.SetZonePriority(cloneA!, 5);
    bag.UpdateClonedZones();
    expect(cloneA!.GetAssignedPriority()).toBe(5);
  });
});

describe('ZONE_SETTINGS_BAG(ZONE*, ZONE_SETTINGS*)', () => {
  it('holds an independent copy of the settings, not the same reference', () => {
    const board = new BOARD();
    const zone = rect(board, 0, 0, 5 * MM, 5 * MM);
    const settings = new ZONE_SETTINGS();
    settings.m_ZonePriority = 3;

    const bag = new ZONE_SETTINGS_BAG(zone, settings);
    const copy = bag.GetZoneSettings(zone)!;

    expect(copy).not.toBe(settings);
    expect(copy.m_ZonePriority).toBe(3);

    copy.m_ZonePriority = 9;
    expect(settings.m_ZonePriority).toBe(3); // the original is untouched
  });
});
