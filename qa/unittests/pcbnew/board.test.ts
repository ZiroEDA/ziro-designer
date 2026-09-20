// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * BOARD over BOARD_ITEM_CONTAINER (`pcbnew/board.cpp`): the collections
 * `Add`/`Remove` file items into, the net list, and the layer proxies. The
 * expected values were read from KiCad's own `pcbnew` python module.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';

describe('BOARD', () => {
  it('Add files items into the right collection by class', () => {
    const b = new BOARD();
    b.Add(new PCB_TRACK(b));
    b.Add(new PCB_VIA(b));
    b.Add(new FOOTPRINT(b));
    b.Add(new ZONE(b));
    const edge = new PCB_SHAPE(b, SHAPE_T.SEGMENT);
    edge.SetLayer(PCB_LAYER_ID.Edge_Cuts);
    b.Add(edge);

    expect(b.Tracks()).toHaveLength(2); // track + via both live in m_tracks
    expect(b.Footprints()).toHaveLength(1);
    expect(b.Zones()).toHaveLength(1);
    expect(b.Drawings()).toHaveLength(1);
  });

  it('Remove drops the item', () => {
    const b = new BOARD();
    const t = new PCB_TRACK(b);
    b.Add(t);
    b.Remove(t);
    expect(b.Tracks()).toHaveLength(0);
  });

  it('nets: a NETINFO_ITEM added to the board is found by name and code; a track takes it', () => {
    const b = new BOARD();
    b.Add(new NETINFO_ITEM(b, 'GND'));
    expect(b.FindNet('GND')!.GetNetCode()).toBe(1);
    expect(b.GetNetCount()).toBe(2); // the unconnected net and GND

    const t = new PCB_TRACK(b);
    t.SetNetCode(1);
    b.Add(t);
    expect(t.GetNetname()).toBe('GND');
    expect(t.GetNetCode()).toBe(1);
  });

  it('layer proxies: FlipLayer, GetLayerName, the copper count', () => {
    const b = new BOARD();
    expect(b.FlipLayer(PCB_LAYER_ID.F_Cu)).toBe(PCB_LAYER_ID.B_Cu);
    expect(b.GetLayerName(PCB_LAYER_ID.B_Cu)).toBe('B.Cu');
    expect(b.GetCopperLayerCount()).toBe(2);
  });
});

/**
 * The queries and the whole-board move (`board.cpp`). Each expectation is a
 * value the C++ produces for the same board, not a value read back from ours.
 */
describe('BOARD queries', () => {
  it('IsEmpty is false once any one collection has an item', () => {
    const b = new BOARD();
    expect(b.IsEmpty()).toBe(true);
    b.Add(new PCB_TRACK(b));
    expect(b.IsEmpty()).toBe(false);
  });

  it('GetNodesCount counts pads on a net, and -1 means any net at all', () => {
    const b = new BOARD();
    const net = new NETINFO_ITEM(b, 'GND', 1);
    b.Add(net);
    const fp = new FOOTPRINT(b);
    b.Add(fp);

    const onNet = new PAD(fp);
    onNet.SetNet(net);
    fp.Add(onNet);
    const noNet = new PAD(fp); // net code 0: on no net
    fp.Add(noNet);

    // -1 counts pads whose net code is > 0, so the unassigned pad is excluded.
    expect(b.GetNodesCount()).toBe(1);
    expect(b.GetNodesCount(1)).toBe(1);
    expect(b.GetNodesCount(2)).toBe(0);
  });

  it('TracksInNet picks tracks by net code and leaves the others', () => {
    const b = new BOARD();
    const net = new NETINFO_ITEM(b, 'GND', 1);
    b.Add(net);

    const mine = new PCB_TRACK(b);
    mine.SetNet(net);
    b.Add(mine);
    b.Add(new PCB_TRACK(b)); // net code 0

    expect(b.TracksInNet(1)).toEqual([mine]);
    expect(b.TracksInNet(0)).toHaveLength(1);
    expect(b.TracksInNet(7)).toHaveLength(0);
  });

  it('GetArea/GetAreaCount index the zones, and past the end is null', () => {
    const b = new BOARD();
    const z = new ZONE(b);
    b.Add(z);

    expect(b.GetAreaCount()).toBe(1);
    expect(b.GetArea(0)).toBe(z);
    expect(b.GetArea(1)).toBeNull();
    expect(b.GetArea(-1)).toBeNull();
  });

  it('GetZoneList includes footprint zones only when asked', () => {
    const b = new BOARD();
    b.Add(new ZONE(b));
    const fp = new FOOTPRINT(b);
    b.Add(fp);
    fp.Add(new ZONE(fp));

    expect(b.GetZoneList()).toHaveLength(1);
    expect(b.GetZoneList(true)).toHaveLength(2);
    // The board's own container must not have gained the footprint's zone.
    expect(b.Zones()).toHaveLength(1);
  });

  it('GetSortedPadListByXthenYCoord sorts X first, Y as the tie-break', () => {
    const b = new BOARD();
    const fp = new FOOTPRINT(b);
    b.Add(fp);
    const at = (x: number, y: number): PAD => {
      const p = new PAD(fp);
      p.SetPosition({ x, y });
      fp.Add(p);
      return p;
    };
    const far = at(200, 0);
    const lowY = at(100, 50);
    const highY = at(100, 10);

    const out: PAD[] = [];
    b.GetSortedPadListByXthenYCoord(out);
    expect(out).toEqual([highY, lowY, far]);
  });

  it('Move shifts a board-level item but not one owned by a footprint', () => {
    const b = new BOARD();
    const track = new PCB_TRACK(b);
    track.SetStart({ x: 0, y: 0 });
    track.SetEnd({ x: 10, y: 0 });
    b.Add(track);

    const fp = new FOOTPRINT(b);
    fp.SetPosition({ x: 0, y: 0 });
    b.Add(fp);
    const pad = new PAD(fp);
    pad.SetPosition({ x: 5, y: 5 });
    fp.Add(pad);

    b.Move({ x: 1000, y: 2000 });

    expect(track.GetStart()).toEqual({ x: 1000, y: 2000 });
    expect(fp.GetPosition()).toEqual({ x: 1000, y: 2000 });
    // The pad moved because its FOOTPRINT moved, once -- not again on its own.
    expect(pad.GetPosition()).toEqual({ x: 1005, y: 2005 });
  });
});
