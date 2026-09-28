// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MergeZonesWithSameOutline` and `AutoAssignZonePriorities`
 * (`pcbnew/zone_utils.cpp`). Cases derived from the C++ itself: merge
 * requires the same outline *and* net (or, for rule areas, the same
 * do-not-allow flags); priority assignment counts pads/vias per net inside
 * the overlap and gives the zone with more of them the higher priority.
 */
import { describe, expect, it } from 'vitest';
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo_item.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB, PAD_SHAPE } from '@ziroeda/pcbnew/padstack.js';
import { AutoAssignZonePriorities, MergeZonesWithSameOutline } from '@ziroeda/pcbnew/zone_utils.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import { ADD_MODE } from '@ziroeda/pcbnew/board_item_container.js';

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

describe('MergeZonesWithSameOutline', () => {
  it('merges two zones with the same outline and net, on different layers, into one', () => {
    const board = new BOARD();
    const a = rect(board, 0, 0, 10 * MM, 10 * MM, PCB_LAYER_ID.F_Cu);
    const b = rect(board, 0, 0, 10 * MM, 10 * MM, PCB_LAYER_ID.B_Cu);

    const merged = MergeZonesWithSameOutline([a, b]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.GetLayerSet().test(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(merged[0]!.GetLayerSet().test(PCB_LAYER_ID.B_Cu)).toBe(true);
  });

  it('leaves zones with different outlines alone', () => {
    const board = new BOARD();
    const a = rect(board, 0, 0, 10 * MM, 10 * MM);
    const b = rect(board, 0, 0, 5 * MM, 5 * MM);

    expect(MergeZonesWithSameOutline([a, b])).toHaveLength(2);
  });

  it('leaves two same-outline zones on different nets alone', () => {
    const board = new BOARD();
    board.Add(new NETINFO_ITEM(board, 'GND'));
    board.Add(new NETINFO_ITEM(board, 'VCC'));
    const a = rect(board, 0, 0, 10 * MM, 10 * MM, PCB_LAYER_ID.F_Cu);
    const b = rect(board, 0, 0, 10 * MM, 10 * MM, PCB_LAYER_ID.B_Cu);
    a.SetNetCode(board.FindNet('GND')!.GetNetCode());
    b.SetNetCode(board.FindNet('VCC')!.GetNetCode());

    expect(MergeZonesWithSameOutline([a, b])).toHaveLength(2);
  });

  it('leaves two same-outline rule areas with different do-not-allow flags alone', () => {
    const board = new BOARD();
    const a = rect(board, 0, 0, 10 * MM, 10 * MM);
    const b = rect(board, 0, 0, 10 * MM, 10 * MM);
    a.SetIsRuleArea(true);
    b.SetIsRuleArea(true);
    a.SetDoNotAllowVias(true);
    b.SetDoNotAllowVias(false);

    expect(MergeZonesWithSameOutline([a, b])).toHaveLength(2);
  });
});

describe('AutoAssignZonePriorities', () => {
  it('does nothing with fewer than two eligible zones', () => {
    const board = new BOARD();
    board.Add(rect(board, 0, 0, 10 * MM, 10 * MM));
    expect(AutoAssignZonePriorities(board)).toBe(false);
  });

  it('does nothing when no zones overlap', () => {
    const board = new BOARD();
    board.Add(rect(board, 0, 0, 5 * MM, 5 * MM));
    board.Add(rect(board, 20 * MM, 20 * MM, 25 * MM, 25 * MM));
    expect(AutoAssignZonePriorities(board)).toBe(false);
  });

  it('gives the higher priority to the zone whose net has more pads in the overlap', () => {
    const board = new BOARD();
    board.Add(new NETINFO_ITEM(board, 'A'));
    board.Add(new NETINFO_ITEM(board, 'B'));
    const netA = board.FindNet('A')!.GetNetCode();
    const netB = board.FindNet('B')!.GetNetCode();

    const zoneA = rect(board, 0, 0, 10 * MM, 10 * MM);
    zoneA.SetNetCode(netA);
    const zoneB = rect(board, 5 * MM, 5 * MM, 15 * MM, 15 * MM);
    zoneB.SetNetCode(netB);
    board.Add(zoneA);
    board.Add(zoneB);

    // One pad for net A, sitting inside the overlap region (5..10, 5..10); none for net B.
    const fp = new FOOTPRINT(board);
    const pad = new PAD(fp);
    pad.SetAttribute(PAD_ATTRIB.SMD);
    pad.SetShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.RECTANGLE);
    pad.SetSize(PCB_LAYER_ID.F_Cu, { x: MM, y: MM });
    pad.SetPosition({ x: 7 * MM, y: 7 * MM });
    pad.SetLayerSet(new LSET([PCB_LAYER_ID.F_Cu]));
    pad.SetNetCode(netA);
    fp.Add(pad, ADD_MODE.APPEND);
    board.Add(fp);

    const changed = AutoAssignZonePriorities(board);

    expect(changed).toBe(true);
    expect(zoneA.GetAssignedPriority()).toBeGreaterThan(zoneB.GetAssignedPriority());
  });

  it('falls back to the smaller-area zone getting priority when neither net has an item in the overlap', () => {
    const board = new BOARD();
    board.Add(new NETINFO_ITEM(board, 'A'));
    board.Add(new NETINFO_ITEM(board, 'B'));
    const netA = board.FindNet('A')!.GetNetCode();
    const netB = board.FindNet('B')!.GetNetCode();

    const bigZone = rect(board, 0, 0, 20 * MM, 20 * MM);
    bigZone.SetNetCode(netA);
    const smallZone = rect(board, 5 * MM, 5 * MM, 10 * MM, 10 * MM);
    smallZone.SetNetCode(netB);
    board.Add(bigZone);
    board.Add(smallZone);

    const changed = AutoAssignZonePriorities(board);

    expect(changed).toBe(true);
    expect(smallZone.GetAssignedPriority()).toBeGreaterThan(bigZone.GetAssignedPriority());
  });
});
