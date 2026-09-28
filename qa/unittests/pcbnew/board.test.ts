// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * BOARD over BOARD_ITEM_CONTAINER (`pcbnew/board.cpp`): the collections
 * `Add`/`Remove` file items into, the net list, and the layer proxies. The
 * expected values were read from KiCad's own `pcbnew` python module.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ADD_MODE } from '@ziroeda/pcbnew/board_item_container.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { VIATYPE } from '@ziroeda/pcbnew/pcb_track_types.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import type { HISTORY_FILE_DATA } from '@ziroeda/common/local_history.js';
import { GetDefaultVariantName } from '@ziroeda/common/string_utils.js';
import { PCB_DIM_ALIGNED } from '@ziroeda/pcbnew/pcb_dimension.js';
import { DIM_UNITS_MODE } from '@ziroeda/pcbnew/pcb_dimension_types.js';
import { NETCLASS } from '@ziroeda/common/netclass.js';
import { SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
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
    // A footprint on F.Cu can be hidden while F.Cu itself is shown: the
    // answer comes from the project's visible items, not the layer.
    const b = new BOARD();
    const manager = new SETTINGS_MANAGER();
    manager.LoadProject('/p/a.kicad_pro');
    b.SetProject(manager.Prj());

    b.SetElementVisibility(GAL_LAYER_ID.LAYER_FOOTPRINTS_FR, false);

    expect(b.IsLayerVisible(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(b.IsFootprintLayerVisible(PCB_LAYER_ID.F_Cu)).toBe(false);
    expect(b.IsFootprintLayerVisible(PCB_LAYER_ID.B_Cu)).toBe(true);

    // A layer that is neither reports visible.
    b.SetElementVisibility(GAL_LAYER_ID.LAYER_FOOTPRINTS_BK, false);
    expect(b.IsFootprintLayerVisible(PCB_LAYER_ID.Edge_Cuts)).toBe(true);
  });

  it('visibility lives in the project local settings; a board without one shows everything', () => {
    const alone = new BOARD();
    expect(alone.IsElementVisible(GAL_LAYER_ID.LAYER_RATSNEST)).toBe(true);
    expect(alone.IsLayerVisible(PCB_LAYER_ID.B_Cu)).toBe(true);
    alone.SetVisibleLayers(new LSET([PCB_LAYER_ID.F_Cu]));
    expect(alone.GetVisibleLayers().count()).toBe(LSET.AllLayersMask().count());

    const b = new BOARD();
    const manager = new SETTINGS_MANAGER();
    manager.LoadProject('/p/a.kicad_pro', null, {
      board: { visible_items: ['tracks'], visible_layers: new LSET([PCB_LAYER_ID.B_Cu]).FmtHex() },
    });
    b.SetProject(manager.Prj());

    // What the .kicad_prl said
    expect(b.IsElementVisible(GAL_LAYER_ID.LAYER_TRACKS)).toBe(true);
    expect(b.IsElementVisible(GAL_LAYER_ID.LAYER_VIAS)).toBe(false);
    expect(b.GetVisibleElements().Contains(GAL_LAYER_ID.LAYER_PADS)).toBe(false);
    expect(b.GetVisibleElements().Contains(GAL_LAYER_ID.LAYER_TRACKS)).toBe(true);
    expect(b.IsLayerVisible(PCB_LAYER_ID.B_Cu)).toBe(true);
    expect(b.IsLayerVisible(PCB_LAYER_ID.F_Cu)).toBe(false);
    // ... but an enabled-layer gate still applies
    expect(b.IsLayerVisible(PCB_LAYER_ID.In1_Cu)).toBe(false);

    // Writes go to the same place the file is saved from
    b.SetVisibleLayers(new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]));
    b.SetElementVisibility(GAL_LAYER_ID.LAYER_VIAS, true);
    const prl = manager.Prj().GetLocalSettings().SaveToJson().board as Record<string, unknown>;
    expect(prl.visible_layers).toBe(new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]).FmtHex());
    expect(prl.visible_items).toEqual(['vias', 'tracks']); // GAL id order

    // SetVisibleAlls turns every layer on, and the items up to
    // GAL_LAYER_ID_BITMASK_END (+31): LAYER_DRAW_BITMAPS is +30, LAYER_PADS is +32 and stays.
    b.SetElementVisibility(GAL_LAYER_ID.LAYER_DRAW_BITMAPS, false);
    b.SetElementVisibility(GAL_LAYER_ID.LAYER_PADS, false);
    b.SetVisibleAlls();
    expect(b.GetVisibleLayers().all()).toBe(true);
    expect(b.IsElementVisible(GAL_LAYER_ID.LAYER_DRAW_BITMAPS)).toBe(true);
    expect(b.IsElementVisible(GAL_LAYER_ID.LAYER_PADS)).toBe(false);
  });

  it('SetElementVisibility( LAYER_RATSNEST ) writes the per-item flag on every net item', () => {
    const b = new BOARD();
    const t = new PCB_TRACK(b);
    b.Add(t);
    const fp = new FOOTPRINT(b);
    const pad = new PAD(fp);
    fp.Add(pad);
    b.Add(fp);
    const z = new ZONE(b);
    b.Add(z);

    b.SetElementVisibility(GAL_LAYER_ID.LAYER_RATSNEST, false);
    expect(t.GetLocalRatsnestVisible()).toBe(false);
    expect(pad.GetLocalRatsnestVisible()).toBe(false);
    expect(z.GetLocalRatsnestVisible()).toBe(false);

    // Any other element leaves them alone
    b.SetElementVisibility(GAL_LAYER_ID.LAYER_VIAS, true);
    expect(t.GetLocalRatsnestVisible()).toBe(false);
  });

  it('SetProject hands the file the design settings and the board the net settings', () => {
    const b = new BOARD();
    const manager = new SETTINGS_MANAGER();
    manager.LoadProject('/p/a.kicad_pro', {
      board: { design_settings: { rules: { min_clearance: 0.123 } } },
      net_settings: { classes: [{ name: 'Default', clearance: 0.45 }] },
      text_variables: { REV: '7' },
    });
    b.SetProject(manager.Prj());

    expect(b.GetProject()).toBe(manager.Prj());
    expect(b.GetDesignSettings().m_MinClearance).toBe(123_000);
    expect(b.GetDesignSettings().m_NetSettings).toBe(manager.Prj().GetProjectFile().NetSettings());
    expect(b.GetDesignSettings().m_NetSettings.GetDefaultNetclass().GetClearance()).toBe(450_000);
    expect(manager.Prj().GetProjectFile().m_BoardSettings).toBe(b.GetDesignSettings());

    // The text variables reach the board through the project
    const token = { value: 'REV' };
    expect(b.ResolveTextVar(token, 0)).toBe(true);
    expect(token.value).toBe('7');
    const name = { value: 'PROJECTNAME' };
    expect(b.ResolveTextVar(name, 0)).toBe(true);
    expect(name.value).toBe('a');
    const vars: string[] = [];
    b.GetContextualTextVars(vars);
    expect(vars).toContain('REV');
    b.SynchronizeProperties();
    expect(b.GetProperties().get('REV')).toBe('7');

    // aReferenceOnly: the pointer, none of the ownership
    const ref = new BOARD();
    ref.SetProject(manager.Prj(), true);
    expect(ref.GetProject()).toBe(manager.Prj());
    expect(ref.GetDesignSettings().m_NetSettings).not.toBe(b.GetDesignSettings().m_NetSettings);

    // ClearProject releases both
    b.ClearProject();
    expect(b.GetProject()).toBeNull();
    expect(manager.Prj().GetProjectFile().m_BoardSettings).toBeNull();
    expect(b.GetDesignSettings().m_NetSettings).not.toBe(
      manager.Prj().GetProjectFile().NetSettings(),
    );
    expect(b.ResolveTextVar({ value: 'PROJECTNAME' }, 0)).toBe(false);
  });

  it('legacy netclasses in the board file move into the project on SetProject', () => {
    const b = new BOARD();
    b.m_LegacyNetclassesLoaded = true;
    const legacy = new NETCLASS('OLD', false);
    legacy.SetClearance(777);
    b.GetDesignSettings().m_NetSettings.SetNetclass('OLD', legacy);

    const manager = new SETTINGS_MANAGER();
    manager.LoadProject('/p/a.kicad_pro');
    b.SetProject(manager.Prj());

    expect(manager.Prj().GetProjectFile().NetSettings().GetNetclasses().get('OLD')).toBe(legacy);
  });

  it('SynchronizeNetsAndNetClasses is a no-op without a project', () => {
    const b = new BOARD();
    const net = new NETINFO_ITEM(b, 'HV1');
    b.Add(net);
    b.GetDesignSettings().m_NetSettings.LoadFromJson({
      classes: [{ name: 'HV', clearance: 0.5 }],
      netclass_patterns: [{ pattern: 'HV*', netclass: 'HV' }],
    });

    b.SynchronizeNetsAndNetClasses(false);
    expect(net.GetNetClass().GetName()).toBe('Default');

    const manager = new SETTINGS_MANAGER();
    manager.LoadProject('/p/a.kicad_pro', {
      net_settings: {
        classes: [{ name: 'HV', clearance: 0.5 }],
        netclass_patterns: [{ pattern: 'HV*', netclass: 'HV' }],
      },
    });
    b.SetProject(manager.Prj());
    b.SynchronizeNetsAndNetClasses(false);
    // HV leaves most params unset, so the effective class is the composite with Default
    expect(net.GetNetClass().GetName()).toBe('HV,Default');
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

describe('BOARD bulk removal', () => {
  const populated = (): BOARD => {
    const b = new BOARD();
    b.Add(new NETINFO_ITEM(b, 'GND', 1));
    b.Add(new PCB_TRACK(b), ADD_MODE.APPEND);
    b.Add(new PCB_VIA(b), ADD_MODE.APPEND);
    b.Add(new FOOTPRINT(b), ADD_MODE.APPEND);
    b.Add(new ZONE(b), ADD_MODE.APPEND);
    const edge = new PCB_SHAPE(b, SHAPE_T.SEGMENT);
    edge.SetLayer(PCB_LAYER_ID.Edge_Cuts);
    b.Add(edge, ADD_MODE.APPEND);
    return b;
  };

  it('RemoveAll with no argument empties every collection, nets included', () => {
    const b = populated();
    b.RemoveAll();

    expect(b.Tracks()).toHaveLength(0);
    expect(b.Footprints()).toHaveLength(0);
    expect(b.Zones()).toHaveLength(0);
    expect(b.Drawings()).toHaveLength(0);
    expect(b.FindNet('GND')).toBeNull();
  });

  it('RemoveAll of one type leaves the others', () => {
    const b = populated();
    b.RemoveAll([KICAD_T.PCB_ZONE_T]);

    expect(b.Zones()).toHaveLength(0);
    expect(b.Tracks()).toHaveLength(2);
    expect(b.Footprints()).toHaveLength(1);
  });

  it('refuses PCB_VIA_T: tracks, arcs and vias share one container', () => {
    // Upstream fails an assertion; asking for the vias alone would leave
    // m_tracks half-emptied, so nothing happens.
    const b = populated();
    b.RemoveAll([KICAD_T.PCB_VIA_T]);

    expect(b.Tracks()).toHaveLength(2);
  });

  it('tells the listeners once, with every removed item', () => {
    const b = populated();
    const seen: number[] = [];
    b.AddListener({
      OnBoardItemsRemoved: (_board: BOARD, items: readonly BOARD_ITEM[]) => {
        seen.push(items.length);
      },
    } as never);

    b.RemoveAll([KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ZONE_T]);

    expect(seen).toEqual([3]); // track + via + zone, in one call
  });

  it('drops removed items and their children from the id cache', () => {
    // Otherwise ResolveItem hands back a footprint the board no longer holds.
    const b = populated();
    const fp = b.Footprints()[0]!;
    const pad = new PAD(fp);
    fp.Add(pad, ADD_MODE.APPEND);

    expect(b.ResolveItem(fp.m_Uuid, true)).toBe(fp);

    b.DeleteAllFootprints();

    expect(b.ResolveItem(fp.m_Uuid, true)).toBeNull();
    expect(b.ResolveItem(pad.m_Uuid, true)).toBeNull();
  });

  it('DetachAllFootprints keeps them alive and parentless', () => {
    const b = populated();
    const fp = b.Footprints()[0]!;

    b.DetachAllFootprints();

    expect(b.Footprints()).toHaveLength(0);
    expect(fp.GetParent()).toBeNull();
  });
});

describe('BOARD zones and cross-references', () => {
  const square = (b: BOARD, x: number, size: number, y = 0): ZONE => {
    const z = new ZONE(b);
    z.SetLayer(PCB_LAYER_ID.F_Cu);
    const o = z.Outline();
    o.NewOutline();
    o.Append(x, y);
    o.Append(x + size, y);
    o.Append(x + size, y + size);
    o.Append(x, y + size);
    return z;
  };

  it('TestZoneIntersection: crossing outlines intersect', () => {
    const b = new BOARD();
    expect(b.TestZoneIntersection(square(b, 0, 100), square(b, 50, 100))).toBe(true);
  });

  it('TestZoneIntersection: a zone wholly inside another crosses no segment but still intersects', () => {
    // The corner-containment pass after the segment test; one corner is enough.
    // Wholly inside means off every edge -- a square at y=0 would sit ON the
    // outer's bottom edge and the segment test would catch it instead.
    const b = new BOARD();
    expect(b.TestZoneIntersection(square(b, 0, 100), square(b, 25, 10, 25))).toBe(true);
  });

  it('TestZoneIntersection: different layers never intersect, whatever the geometry', () => {
    const b = new BOARD();
    const other = square(b, 0, 100);
    other.SetLayer(PCB_LAYER_ID.B_Cu);
    expect(b.TestZoneIntersection(square(b, 0, 100), other)).toBe(false);
  });

  it('TestZoneIntersection: disjoint boxes short-circuit to false', () => {
    const b = new BOARD();
    expect(b.TestZoneIntersection(square(b, 0, 100), square(b, 500, 100))).toBe(false);
  });

  it('AddArea starts a zone with one corner on the given layer -- and loses the net', () => {
    // Upstream calls SetNetCode BEFORE SetLayer, and a fresh ZONE has no layer
    // (ExportSetting's non-full export skips the layer set), so SetNetCode's
    // "not on copper" guard zeroes the net. Faithful, and harmless: nothing in
    // KiCad calls AddArea any more. Pinned so a fix here is a decision, not
    // a drift.
    const b = new BOARD();
    b.Add(new NETINFO_ITEM(b, 'GND', 1));
    const z = b.AddArea(null, 1, PCB_LAYER_ID.B_Cu, { x: 10, y: 20 }, 0 as never);

    expect(b.Zones()).toContain(z);
    expect(z.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(z.GetNetCode()).toBe(0);
    expect(z.Outline().Outline(0).PointCount()).toBe(1);
  });

  it('ConvertKIIDsToCrossReferences rewrites a footprint KIID to its reference', () => {
    const b = new BOARD();
    const fp = new FOOTPRINT(b);
    fp.SetReference('U7');
    b.Add(fp, ADD_MODE.APPEND);

    expect(b.ConvertKIIDsToCrossReferences(`see \${${fp.m_Uuid}:VALUE}`)).toBe('see ${U7:VALUE}');
  });

  it('ConvertKIIDsToCrossReferences leaves a plain variable and an escaped one alone', () => {
    const b = new BOARD();

    // No colon: not a cross-reference, even though it looks like one.
    expect(b.ConvertKIIDsToCrossReferences('${LAYER}')).toBe('${LAYER}');
    // Escaped: copied to the matching brace, depth counted.
    expect(b.ConvertKIIDsToCrossReferences('\\${a:{b}}')).toBe('\\${a:{b}}');
  });

  it('GetContextualTextVars adds each name once', () => {
    const b = new BOARD();
    const vars = ['LAYER'];
    b.GetContextualTextVars(vars);

    expect(vars.filter((v) => v === 'LAYER')).toHaveLength(1);
    expect(vars).toContain('PROJECTNAME');
    expect(vars).toContain('DRC_ERROR <message_text>');
  });
});

describe('BOARD layer removal', () => {
  // A ZONE is the board-level item that genuinely spans layers; a PCB_SHAPE is
  // single-layer and SetLayerSet with two would fail upstream as well.
  const twoLayerItem = (b: BOARD): ZONE => {
    const z = new ZONE(b);
    z.SetLayerSet(new LSET().set(PCB_LAYER_ID.F_Cu).set(PCB_LAYER_ID.B_Cu));
    b.Add(z, ADD_MODE.APPEND);
    return z;
  };

  it('HasItemsOnLayer ignores footprints and their children', () => {
    // A PCB_SHAPE inside the footprint, not a PAD: BoardLevelItems has no
    // PCB_PAD_T, so a pad is never reached and the guard would go untested.
    // Visit does descend into footprints for PCB_SHAPE_T, so this one IS
    // reached, and only the GetParentFootprint check keeps it out.
    const b = new BOARD();
    const fp = new FOOTPRINT(b);
    const inner = new PCB_SHAPE(fp, SHAPE_T.SEGMENT);
    inner.SetLayer(PCB_LAYER_ID.F_Cu);
    fp.Add(inner, ADD_MODE.APPEND);
    b.Add(fp, ADD_MODE.APPEND);

    // On F.Cu, but owned by a footprint and not removed with a layer, so the
    // layer reads as empty.
    expect(b.HasItemsOnLayer(PCB_LAYER_ID.F_Cu)).toBe(false);

    const t = new PCB_TRACK(b);
    t.SetLayer(PCB_LAYER_ID.F_Cu);
    b.Add(t, ADD_MODE.APPEND);
    expect(b.HasItemsOnLayer(PCB_LAYER_ID.F_Cu)).toBe(true);
  });

  it('HasItemsOnLayer: a through via is on no layer in particular', () => {
    const b = new BOARD();
    b.SetCopperLayerCount(4);
    const v = new PCB_VIA(b);
    v.SetViaType(VIATYPE.THROUGH);
    b.Add(v, ADD_MODE.APPEND);

    // Ask about F.Cu -- the through via's LayerPair top. Only the THROUGH guard
    // keeps it out; for an inner layer the pair test would reject it anyway
    // and the guard would be untested.
    expect(b.HasItemsOnLayer(PCB_LAYER_ID.F_Cu)).toBe(false);
    expect(b.HasItemsOnLayer(PCB_LAYER_ID.In1_Cu)).toBe(false);

    // A blind via whose bottom IS the layer counts.
    const blind = new PCB_VIA(b);
    blind.SetViaType(VIATYPE.BLIND);
    blind.SetLayerPair(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu);
    b.Add(blind, ADD_MODE.APPEND);
    expect(b.HasItemsOnLayer(PCB_LAYER_ID.In1_Cu)).toBe(true);
  });

  it('RemoveAllItemsOnLayer strips the layer from a multi-layer item and keeps it', () => {
    const b = new BOARD();
    const s = twoLayerItem(b);

    expect(b.RemoveAllItemsOnLayer(PCB_LAYER_ID.F_Cu)).toBe(false); // nothing removed
    expect(b.Zones()).toContain(s);
    expect(s.GetLayerSet().test(PCB_LAYER_ID.F_Cu)).toBe(false);
    expect(s.GetLayerSet().test(PCB_LAYER_ID.B_Cu)).toBe(true);
  });

  it('RemoveAllItemsOnLayer removes an item that was on that layer alone', () => {
    const b = new BOARD();
    const t = new PCB_TRACK(b);
    t.SetLayer(PCB_LAYER_ID.F_Cu);
    b.Add(t, ADD_MODE.APPEND);

    expect(b.RemoveAllItemsOnLayer(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(b.Tracks()).toHaveLength(0);
  });

  it('RemoveAllItemsOnLayer leaves a through via alone, removes a blind one ending there', () => {
    const b = new BOARD();
    b.SetCopperLayerCount(4);
    const thru = new PCB_VIA(b);
    thru.SetViaType(VIATYPE.THROUGH);
    b.Add(thru, ADD_MODE.APPEND);
    const blind = new PCB_VIA(b);
    blind.SetViaType(VIATYPE.BLIND);
    blind.SetLayerPair(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu);
    b.Add(blind, ADD_MODE.APPEND);

    expect(b.RemoveAllItemsOnLayer(PCB_LAYER_ID.In1_Cu)).toBe(true);
    expect(b.Tracks()).toEqual([thru]);

    // And removing the through via's own top layer still leaves it: it has no
    // layer set to edit, so it is skipped outright rather than re-spanned.
    expect(b.RemoveAllItemsOnLayer(PCB_LAYER_ID.F_Cu)).toBe(false);
    expect(b.Tracks()).toEqual([thru]);
  });
});

describe('BOARD message panel', () => {
  it('counts pads, vias, segments and the nets something is ON', () => {
    const b = new BOARD();
    b.Add(new NETINFO_ITEM(b, 'GND', 1));
    b.Add(new NETINFO_ITEM(b, 'UNUSED', 2)); // declared, nothing on it
    const fp = new FOOTPRINT(b);
    const pad = new PAD(fp);
    pad.SetNetCode(1);
    fp.Add(pad, ADD_MODE.APPEND);
    b.Add(fp, ADD_MODE.APPEND);
    const t = new PCB_TRACK(b);
    t.SetNetCode(1);
    b.Add(t, ADD_MODE.APPEND);
    b.Add(new PCB_VIA(b), ADD_MODE.APPEND);
    b.BuildConnectivity();

    const list: MSG_PANEL_ITEM[] = [];
    b.GetMsgPanelInfo(null as never, list);
    const byName = Object.fromEntries(list.map((i) => [i.GetUpperText(), i.GetLowerText()]));

    expect(byName.Pads).toBe('1');
    expect(byName.Vias).toBe('1');
    expect(byName['Track Segments']).toBe('1');
    // UNUSED is in the net list but on nothing, so it is not counted.
    expect(byName.Nets).toBe('1');
  });

  it('describes itself as PCB', () => {
    expect(new BOARD().GetItemDescription(null, true)).toBe('PCB');
  });

  it('variants: delete and rename touch the board list, the descriptions and every footprint', () => {
    const b = new BOARD();
    const fp = new FOOTPRINT(b);
    b.Add(fp);
    b.AddVariant('Lite');
    b.AddVariant('Pro');
    b.SetVariantDescription('Pro', 'all parts');
    fp.AddVariant('Pro');
    b.SetCurrentVariant('pro');
    expect(b.GetCurrentVariant()).toBe('Pro');

    // case-insensitive lookup, exact name kept
    b.RenameVariant('PRO', 'Max');
    expect(b.GetVariantNames()).toEqual(['Lite', 'Max']);
    expect(b.GetVariantDescription('Max')).toBe('all parts');
    expect(b.GetVariantDescription('Pro')).toBe('');
    expect(b.GetCurrentVariant()).toBe('Max');
    expect(fp.HasVariant('Max')).toBe(true);
    expect(fp.HasVariant('Pro')).toBe(false);

    // a rename onto another existing name, or onto the default, is refused
    b.RenameVariant('Max', 'lite');
    b.RenameVariant('Max', GetDefaultVariantName());
    expect(b.GetVariantNames()).toEqual(['Lite', 'Max']);

    // the UI list: default first, then natural order
    b.AddVariant('V10');
    b.AddVariant('V2');
    expect(b.GetVariantNamesForUI()).toEqual([GetDefaultVariantName(), 'Lite', 'Max', 'V2', 'V10']);

    b.DeleteVariant('max');
    expect(b.GetVariantNames()).toEqual(['Lite', 'V10', 'V2']);
    expect(b.GetCurrentVariant()).toBe('');
    expect(fp.HasVariant('Max')).toBe(false);
    b.DeleteVariant(GetDefaultVariantName());
    expect(b.GetVariantNames()).toEqual(['Lite', 'V10', 'V2']);
  });

  it('UpdateUserUnits re-derives only the AUTOMATIC dimensions, and repaints them', () => {
    const b = new BOARD();
    const auto = new PCB_DIM_ALIGNED(b);
    auto.SetUnitsMode(DIM_UNITS_MODE.AUTOMATIC);
    const fixed = new PCB_DIM_ALIGNED(b);
    fixed.SetUnitsMode(DIM_UNITS_MODE.MILS);
    b.Add(auto);
    b.Add(fixed);
    expect(auto.GetUnits()).toBe('mm');

    b.SetUserUnits('in');
    const updated: unknown[] = [];
    b.UpdateUserUnits(b, { Update: (aItem: unknown) => updated.push(aItem) } as never);

    expect(auto.GetUnits()).toBe('in');
    expect(fixed.GetUnits()).toBe('mils');
    expect(updated).toEqual([auto]);
  });

  it('SaveToHistory serialises the board under its project-relative path', () => {
    const b = new BOARD();
    const out: HISTORY_FILE_DATA[] = [];

    b.SaveToHistory('/p/', out); // no project
    expect(out).toEqual([]);

    const manager = new SETTINGS_MANAGER();
    manager.LoadProject('/p/a.kicad_pro');
    b.SetProject(manager.Prj());
    b.SaveToHistory('/p/', out); // unsaved board
    b.SetFileName('/elsewhere/a.kicad_pcb');
    b.SaveToHistory('/p/', out); // not under the project
    b.SetFileName('/p/sub/a.kicad_pcb');
    b.SaveToHistory('/other/', out); // another project's snapshot
    expect(out).toEqual([]);

    b.SaveToHistory('/p/', out);
    expect(out).toHaveLength(1);
    expect(out[0]!.relativePath).toBe('sub/a.kicad_pcb');
    expect(out[0]!.prettify).toBe(true);
    expect(out[0]!.content.startsWith('(kicad_pcb')).toBe(true);
  });
});
