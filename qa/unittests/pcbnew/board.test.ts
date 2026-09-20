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
import { ADD_MODE } from '@ziroeda/pcbnew/board_item_container.js';
import { GAL_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo.js';
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
    // FOOTPRINT::Add unshifts, so Pads() is the reverse of this order. Both
    // pairs are therefore backwards in the container: one pair needs the X
    // compare to fix it, the other needs the Y tie-break. A comparator that
    // gets either wrong leaves that pair as the container had it.
    const x200 = at(200, 0);
    const x300 = at(300, 0);
    const y10 = at(100, 10);
    const y50 = at(100, 50);

    const out: PAD[] = [];
    b.GetSortedPadListByXthenYCoord(out);
    expect(out).toEqual([y10, y50, x200, x300]);
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

    // A PCB_SHAPE, not a PAD: BoardLevelItems has no PCB_PAD_T, so Move never
    // reaches a pad and the guard would be untested. It does list PCB_SHAPE_T,
    // and BOARD::Visit descends into footprints for that type -- so this shape
    // is reached twice over, once as the footprint's child and once as the
    // footprint itself, which is exactly what the guard is there to stop.
    const inner = new PCB_SHAPE(fp, SHAPE_T.SEGMENT);
    inner.SetStart({ x: 5, y: 5 });
    inner.SetEnd({ x: 6, y: 6 });
    fp.Add(inner);

    b.Move({ x: 1000, y: 2000 });

    expect(track.GetStart()).toEqual({ x: 1000, y: 2000 });
    expect(fp.GetPosition()).toEqual({ x: 1000, y: 2000 });
    // Displaced once, by its parent -- not a second time on its own account.
    expect(inner.GetStart()).toEqual({ x: 1005, y: 2005 });
  });
});

describe('BOARD::GetStackupOrDefault', () => {
  it('builds a default stackup when the board has none, and does not adopt it', () => {
    const b = new BOARD();
    b.SetCopperLayerCount(2);
    expect(b.GetDesignSettings().m_HasStackup).toBe(false);

    const stackup = b.GetStackupOrDefault();
    expect(stackup.GetCount()).toBeGreaterThan(0);
    // The default is a throwaway: the board still reports no stackup, so a
    // caller cannot mutate the board by mutating what it was handed.
    expect(b.GetDesignSettings().m_HasStackup).toBe(false);
  });

  it('returns the board its own descriptor once it has one', () => {
    const b = new BOARD();
    b.SetCopperLayerCount(2);
    const own = b.GetDesignSettings().GetStackupDescriptor();
    own.BuildDefaultStackupList(b.GetDesignSettings(), 2);
    b.GetDesignSettings().m_HasStackup = true;

    expect(b.GetStackupOrDefault()).toBe(own);
  });
});

describe('BOARD lookups and visibility', () => {
  it('GetCenter is the bounding box middle, and GetFocusPosition follows it', () => {
    const b = new BOARD();
    const t = new PCB_TRACK(b);
    t.SetStart({ x: 0, y: 0 });
    t.SetEnd({ x: 1000, y: 500 });
    t.SetWidth(0);
    b.Add(t);

    expect(b.GetCenter()).toEqual(b.GetBoundingBox().GetCenter());
    expect(b.GetFocusPosition()).toEqual(b.GetCenter());
  });

  it('GetFootprint prefers the active side even when the far side is nearer', () => {
    // Two candidates are kept: the best on the active side and the best on the
    // other. The active-side one wins outright — the alternate is a fallback,
    // not a competitor.
    const b = new BOARD();

    const front = new FOOTPRINT(b);
    front.SetPosition({ x: 0, y: 0 });
    const fpad = new PAD(front);
    fpad.SetSize(undefined as unknown as PCB_LAYER_ID, { x: 2_000_000, y: 2_000_000 });
    fpad.SetLayerSet(new LSET().set(PCB_LAYER_ID.F_Cu));
    front.Add(fpad, ADD_MODE.APPEND);
    b.Add(front, ADD_MODE.APPEND);

    // Nearer the probe point, but on the back.
    const back = new FOOTPRINT(b);
    back.SetPosition({ x: 100_000, y: 0 });
    const bpad = new PAD(back);
    bpad.SetSize(undefined as unknown as PCB_LAYER_ID, { x: 2_000_000, y: 2_000_000 });
    bpad.SetLayerSet(new LSET().set(PCB_LAYER_ID.B_Cu));
    back.Add(bpad, ADD_MODE.APPEND);
    back.Flip({ x: 100_000, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);
    b.Add(back, ADD_MODE.APPEND);

    expect(b.GetFootprint({ x: 100_000, y: 0 }, PCB_LAYER_ID.F_Cu, false)).toBe(front);
    // Ask from the back and the back one wins.
    expect(b.GetFootprint({ x: 100_000, y: 0 }, PCB_LAYER_ID.B_Cu, false)).toBe(back);
  });

  it('GetFootprint skips a locked footprint only when asked', () => {
    const b = new BOARD();
    const fp = new FOOTPRINT(b);
    fp.SetPosition({ x: 0, y: 0 });
    const pad = new PAD(fp);
    pad.SetSize(undefined as unknown as PCB_LAYER_ID, { x: 2_000_000, y: 2_000_000 });
    pad.SetLayerSet(new LSET().set(PCB_LAYER_ID.F_Cu));
    fp.Add(pad, ADD_MODE.APPEND);
    fp.SetLocked(true);
    b.Add(fp, ADD_MODE.APPEND);

    expect(b.GetFootprint({ x: 0, y: 0 }, PCB_LAYER_ID.F_Cu, false)).toBe(fp);
    expect(b.GetFootprint({ x: 0, y: 0 }, PCB_LAYER_ID.F_Cu, false, true)).toBeNull();
  });

  it('IsFootprintLayerVisible asks the two FOOTPRINT flags, not the copper layer', () => {
    // A footprint on F.Cu can be hidden while F.Cu itself is shown, so the
    // question is which GAL element is consulted. `IsElementVisible` is a stub
    // returning true until PROJECT is ported, so the answer is not observable
    // -- the routing is, and that is what breaks if the cases are swapped.
    const b = new BOARD();
    const asked: GAL_LAYER_ID[] = [];
    b.IsElementVisible = (aLayer: GAL_LAYER_ID): boolean => {
      asked.push(aLayer);
      return true;
    };

    b.IsFootprintLayerVisible(PCB_LAYER_ID.F_Cu);
    b.IsFootprintLayerVisible(PCB_LAYER_ID.B_Cu);

    expect(asked).toEqual([GAL_LAYER_ID.LAYER_FOOTPRINTS_FR, GAL_LAYER_ID.LAYER_FOOTPRINTS_BK]);

    // A layer that is neither asks nothing and reports visible.
    expect(b.IsFootprintLayerVisible(PCB_LAYER_ID.Edge_Cuts)).toBe(true);
    expect(asked).toHaveLength(2);
  });

  it('GetNetClassAssignmentCandidates drops the unnamed net', () => {
    const b = new BOARD();
    b.Add(new NETINFO_ITEM(b, 'GND', 1));
    b.Add(new NETINFO_ITEM(b, 'VCC', 2));

    // NETINFO_LIST always carries the unconnected net, whose name is empty.
    expect([...b.GetNetClassAssignmentCandidates()].sort()).toEqual(['GND', 'VCC']);
  });

  it('MapNets re-points items at the destination net of the same NAME', () => {
    // Net codes are not carried: two boards number independently, so the name
    // is the only stable identity.
    const src = new BOARD();
    const gndSrc = new NETINFO_ITEM(src, 'GND', 7);
    src.Add(gndSrc);
    const t = new PCB_TRACK(src);
    t.SetNet(gndSrc);
    src.Add(t);

    const dst = new BOARD();
    const gndDst = new NETINFO_ITEM(dst, 'GND', 3);
    dst.Add(gndDst);

    src.MapNets(dst);

    // The identity is what carries, not the number: the destination numbers
    // its nets independently.
    expect(t.GetNet()).toBe(gndDst);
    expect(t.GetNetname()).toBe('GND');
  });

  it('MapNets creates a net on the destination when it has none of that name', () => {
    const src = new BOARD();
    const sig = new NETINFO_ITEM(src, 'SIG', 4);
    src.Add(sig);
    const t = new PCB_TRACK(src);
    t.SetNet(sig);
    src.Add(t);

    const dst = new BOARD();
    src.MapNets(dst);

    expect(dst.FindNet('SIG')).not.toBeNull();
    expect(t.GetNetname()).toBe('SIG');
  });
});
