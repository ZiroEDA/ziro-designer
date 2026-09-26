// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/connectivity/connectivity_data.h` + `.cpp`: a wrapper class
 * encompassing the connectivity computation algorithm and the ratsnest.
 *
 * The spinlock and the thread pool are gone: every method runs to completion
 * on the one thread, which is the order the C++ serialises to.
 */
import type { COMMIT } from '@ziroeda/common/commit.js';
import { IS_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import type { NET_SETTINGS } from '@ziroeda/common/project/net_settings.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  add,
  Distance,
  SquaredEuclideanNorm,
  sub,
  VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import { UNCONNECTED_LAYER_MODE } from '../padstack.js';
import type { PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import { RN_NET } from '../ratsnest/ratsnest_data.js';
import type { ISOLATED_ISLANDS, ZONE } from '../zone.js';
import {
  type CLUSTER_SEARCH_MODE,
  CN_CONNECTIVITY_ALGO,
  type CN_EDGE,
  CSM_CONNECTIVITY_CHECK,
  CSM_PROPAGATE,
  type PROGRESS_REPORTER_LIKE,
} from './connectivity_algo.js';
import { type CN_ANCHOR, type CN_CLUSTER, CN_ZONE_LAYER } from './connectivity_items.js';
import { INT_MAX } from './connectivity_rtree.js';
import { FROM_TO_CACHE } from './from_to_cache.js';

export interface CN_DISJOINT_NET_ENTRY {
  net: number;
  a: BOARD_CONNECTED_ITEM;
  b: BOARD_CONNECTED_ITEM;
  anchorA: VECTOR2I;
  anchorB: VECTOR2I;
}

export interface RN_DYNAMIC_LINE {
  netCode: number;
  a: VECTOR2I;
  b: VECTOR2I;
}

export enum PROPAGATE_MODE {
  SKIP_CONFLICTS, ///< Clusters with conflicting drivers are not updated (default)
  RESOLVE_CONFLICTS, ///< Clusters with conflicting drivers are updated to the most popular net
}

export const IGNORE_NETS = 0x0001;
export const EXCLUDE_ZONES = 0x0002;

function getMinDist(aItem: BOARD_CONNECTED_ITEM, aPoint: VECTOR2I): number {
  switch (aItem.Type()) {
    case KICAD_T.PCB_TRACE_T:
    case KICAD_T.PCB_ARC_T: {
      const track = aItem as PCB_TRACK;

      return Math.min(Distance(track.GetStart(), aPoint), Distance(track.GetEnd(), aPoint));
    }

    default:
      return Distance(aItem.GetPosition(), aPoint);
  }
}

// a wrapper class encompassing the connectivity computation algorithm and the
export class CONNECTIVITY_DATA {
  private m_connAlgo: CN_CONNECTIVITY_ALGO;
  private m_fromToCache: FROM_TO_CACHE;
  private m_dynamicRatsnest: RN_DYNAMIC_LINE[] = [];
  private m_nets: RN_NET[] = [];

  /// Used to suppress ratsnest calculations on dynamic ratsnests
  private m_skipRatsnestUpdate: boolean;

  private m_progressReporter: PROGRESS_REPORTER_LIKE | null;

  /// @brief Used to get netclass data when drawing ratsnests
  private m_netSettings: NET_SETTINGS | null = null;

  /// @brief Used to map netcode to net name
  private m_netcodeMap = new Map<number, string>();

  constructor();
  constructor(
    aGlobalConnectivity: CONNECTIVITY_DATA,
    aLocalItems: readonly BOARD_ITEM[],
    aSkipRatsnestUpdate?: boolean,
  );
  constructor(
    aGlobalConnectivity?: CONNECTIVITY_DATA,
    aLocalItems?: readonly BOARD_ITEM[],
    aSkipRatsnestUpdate = false,
  ) {
    this.m_connAlgo = new CN_CONNECTIVITY_ALGO(this);
    this.m_progressReporter = null;
    this.m_fromToCache = new FROM_TO_CACHE();

    if (aGlobalConnectivity) {
      this.m_skipRatsnestUpdate = aSkipRatsnestUpdate;
      this.BuildLocal(aGlobalConnectivity, aLocalItems!);
    } else {
      this.m_skipRatsnestUpdate = false;
    }
  }

  Add(aItem: BOARD_ITEM): boolean {
    this.m_connAlgo.Add(aItem);
    return true;
  }

  Remove(aItem: BOARD_ITEM): boolean {
    this.m_connAlgo.Remove(aItem);
    return true;
  }

  Update(aItem: BOARD_ITEM): boolean {
    this.m_connAlgo.Remove(aItem);
    this.m_connAlgo.Add(aItem);
    return true;
  }

  Build(aBoard: BOARD, aReporter: PROGRESS_REPORTER_LIKE | null = null): boolean {
    aBoard.CacheTriangulation(aReporter);

    if (aReporter) {
      aReporter.Report('Updating nets...');
      aReporter.KeepRefreshing(false);
    }

    this.m_nets.length = 0;

    this.m_connAlgo = new CN_CONNECTIVITY_ALGO(this);
    this.m_connAlgo.Build(aBoard, aReporter);

    this.m_netSettings = aBoard.GetDesignSettings().m_NetSettings;

    this.RefreshNetcodeMap(aBoard);

    if (aReporter) {
      aReporter.SetCurrentProgress(0.75);
      aReporter.KeepRefreshing(false);
    }

    this.internalRecalculateRatsnest();

    if (aReporter) {
      aReporter.SetCurrentProgress(1.0);
      aReporter.KeepRefreshing(false);
    }

    return true;
  }

  /// @brief Refresh the map of netcodes to net names
  RefreshNetcodeMap(aBoard: BOARD): void {
    this.m_netcodeMap.clear();

    for (const net of aBoard.GetNetInfo())
      this.m_netcodeMap.set(net.GetNetCode(), net.GetNetname());
  }

  /** `Build( std::shared_ptr<CONNECTIVITY_DATA>&, const std::vector<BOARD_ITEM*>& )`. */
  BuildLocal(aGlobalConnectivity: CONNECTIVITY_DATA, aLocalItems: readonly BOARD_ITEM[]): void {
    this.m_connAlgo = new CN_CONNECTIVITY_ALGO(this);
    this.m_connAlgo.LocalBuild(aGlobalConnectivity, aLocalItems);

    this.internalRecalculateRatsnest();
  }

  Move(aDelta: VECTOR2I): void {
    this.m_connAlgo.ForEachAnchor((anchor: CN_ANCHOR) => {
      anchor.Move(aDelta);
    });
  }

  private updateRatsnest(): void {
    const dirty_nets: RN_NET[] = [];

    // Start with net 1 as net 0 is reserved for not-connected
    // Nets without nodes are also ignored
    for (let i = 1; i < this.m_nets.length; i++) {
      const aNet = this.m_nets[i]!;
      if (aNet.IsDirty() && aNet.GetNodeCount() > 0) dirty_nets.push(aNet);
    }

    for (const net of dirty_nets) net.UpdateNet();

    for (const net of dirty_nets) net.OptimizeRNEdges();
  }

  private addRatsnestCluster(aCluster: CN_CLUSTER): void {
    const rnNet = this.m_nets[aCluster.OriginNet()]!;

    rnNet.AddCluster(aCluster);
  }

  RecalculateRatsnest(aCommit: COMMIT | null = null): void {
    this.internalRecalculateRatsnest(aCommit);
  }

  private internalRecalculateRatsnest(aCommit: COMMIT | null = null): void {
    this.m_connAlgo.PropagateNets(aCommit);

    const lastNet = this.m_connAlgo.NetCount();

    if (lastNet >= this.m_nets.length) {
      const prevSize = this.m_nets.length;
      this.m_nets.length = lastNet + 1;

      for (let i = prevSize; i < this.m_nets.length; i++) this.m_nets[i] = new RN_NET();
    } else {
      for (let ii = lastNet; ii < this.m_nets.length; ++ii) this.m_nets[ii]!.Clear();
    }

    const clusters = this.m_connAlgo.GetClusters();

    for (let net = 0; net < lastNet; net++) {
      if (this.m_connAlgo.IsNetDirty(net)) this.m_nets[net]!.Clear();
    }

    for (const c of clusters) {
      const net = c.OriginNet();

      // Don't add intentionally-kept zone islands to the ratsnest
      if (c.IsOrphaned() && c.Size() === 1) {
        if (c.Items()[0] instanceof CN_ZONE_LAYER) continue;
      }

      if (this.m_connAlgo.IsNetDirty(net)) this.addRatsnestCluster(c);
    }

    this.m_connAlgo.ClearDirtyFlags();

    if (!this.m_skipRatsnestUpdate) this.updateRatsnest();
  }

  BlockRatsnestItems(aItems: readonly BOARD_ITEM[]): void {
    const citems: BOARD_CONNECTED_ITEM[] = [];

    for (const item of aItems) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        for (const pad of (item as FOOTPRINT).Pads()) citems.push(pad);
      } else {
        if (item.IsConnected()) citems.push(item as BOARD_CONNECTED_ITEM);
      }
    }

    for (const item of citems) {
      if (this.m_connAlgo.ItemExists(item)) {
        const entry = this.m_connAlgo.ItemEntry(item);

        for (const cnItem of entry.GetItems()) {
          for (const anchor of cnItem.Anchors()) anchor.SetNoLine(true);
        }
      }
    }
  }

  GetNetCount(): number {
    return this.m_connAlgo.NetCount();
  }

  FillIsolatedIslandsMap(
    aMap: Map<ZONE, Map<PCB_LAYER_ID, ISOLATED_ISLANDS>>,
    aConnectivityAlreadyRebuilt = false,
  ): void {
    this.m_connAlgo.FillIsolatedIslandsMap(aMap, aConnectivityAlreadyRebuilt);
  }

  ComputeLocalRatsnest(
    aItems: readonly BOARD_ITEM[],
    aDynamicData: CONNECTIVITY_DATA | null,
    aInternalOffset: VECTOR2I = { x: 0, y: 0 },
  ): void {
    if (!aDynamicData) return;

    this.m_dynamicRatsnest.length = 0;

    // This gets connections between the stationary board and the
    // moving selection
    const update_lambda = (nc: number): void => {
      const dynamicNet = aDynamicData.m_nets[nc]!;
      const staticNet = this.m_nets[nc]!;

      /// We don't need to compute the dynamic ratsnest in two cases:
      /// 1) We are not moving any net elements
      /// 2) We are moving all net elements
      if (
        dynamicNet.GetNodeCount() !== 0 &&
        dynamicNet.GetNodeCount() !== staticNet.GetNodeCount()
      ) {
        const pos = { pos1: VECTOR2I(), pos2: VECTOR2I() };

        if (staticNet.NearestBicoloredPair(dynamicNet, pos)) {
          this.m_dynamicRatsnest.push({ a: pos.pos1, b: pos.pos2, netCode: nc });
        }
      }
    };

    const num_nets = Math.min(this.m_nets.length, aDynamicData.m_nets.length);

    for (let ii = 1; ii < num_nets; ii++) update_lambda(ii);

    // This gets the ratsnest for internal connections in the moving set
    const edges = this.GetRatsnestForItems(aItems);

    for (const edge of edges) {
      const nodeA = edge.GetSourceNode();
      const nodeB = edge.GetTargetNode();

      if (!nodeA || nodeA.Dirty() || !nodeB || nodeB.Dirty()) continue;

      // Use the parents' positions
      this.m_dynamicRatsnest.push({
        a: add(nodeA.Parent().GetPosition(), aInternalOffset),
        b: add(nodeB.Parent().GetPosition(), aInternalOffset),
        netCode: 0,
      });
    }
  }

  ClearLocalRatsnest(): void {
    this.m_connAlgo.ForEachAnchor((anchor: CN_ANCHOR) => {
      anchor.SetNoLine(false);
    });

    this.HideLocalRatsnest();
  }

  HideLocalRatsnest(): void {
    this.m_dynamicRatsnest.length = 0;
  }

  GetLocalRatsnest(): readonly RN_DYNAMIC_LINE[] {
    return this.m_dynamicRatsnest;
  }

  PropagateNets(aCommit: COMMIT | null = null): void {
    this.m_connAlgo.PropagateNets(aCommit);
  }

  IsConnectedOnLayer(
    aItem: BOARD_CONNECTED_ITEM,
    aLayer: number,
    aTypes: readonly KICAD_T[] = [],
  ): boolean {
    const entry = this.m_connAlgo.ItemEntry(aItem);

    const parentFootprint = aItem.GetParentFootprint();

    const matchType = (aItemType: KICAD_T): boolean => {
      if (aTypes.length === 0) return true;

      return aTypes.includes(aItemType);
    };

    for (const citem of entry.GetItems()) {
      for (const connected of citem.ConnectedItems()) {
        const zoneLayer = connected instanceof CN_ZONE_LAYER ? connected : null;

        // lyIdx is compatible with StartLayer() and EndLayer() notation in CN_ITEM
        // items, where B_Cu is set to INT_MAX (std::numeric_limits<int>::max())
        let lyIdx = aLayer;

        if (aLayer === PCB_LAYER_ID.B_Cu) lyIdx = INT_MAX;

        if (
          connected.Valid() &&
          connected.StartLayer() <= lyIdx &&
          connected.EndLayer() >= lyIdx &&
          matchType(connected.Parent().Type()) &&
          connected.Net() === aItem.GetNetCode()
        ) {
          const connectedItem: BOARD_ITEM = connected.Parent();

          if (connectedItem === aItem) continue;

          if (
            parentFootprint &&
            connectedItem &&
            connectedItem.GetParentFootprint() === parentFootprint
          ) {
            continue;
          }

          if (
            aItem.Type() === KICAD_T.PCB_PAD_T &&
            connectedItem &&
            connectedItem.Type() === KICAD_T.PCB_PAD_T
          ) {
            const thisPad = aItem as PAD;
            const otherPad = connectedItem as PAD;

            const flashesConditionally = (aMode: UNCONNECTED_LAYER_MODE): boolean => {
              return (
                aMode === UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END ||
                aMode === UNCONNECTED_LAYER_MODE.REMOVE_ALL
              );
            };

            if (
              flashesConditionally(thisPad.Padstack().UnconnectedLayerMode()) &&
              flashesConditionally(otherPad.Padstack().UnconnectedLayerMode())
            ) {
              continue;
            }
          }

          if (aItem.Type() === KICAD_T.PCB_PAD_T && zoneLayer) {
            const pad = aItem as PAD;
            const zone = zoneLayer.Parent() as ZONE;
            const islandIdx = zoneLayer.SubpolyIndex();

            if (zone.IsFilled()) {
              const pcbLayer = ToLAYER_ID(aLayer);
              const zoneFill = zone.GetFill(pcbLayer)!;
              const padHull = pad.GetEffectivePolygon(pcbLayer, ERROR_LOC.ERROR_INSIDE).Outline(0);

              for (const pt of zoneFill.COutline(islandIdx).CPoints()) {
                // If the entire island is inside the pad's flashing then the pad
                // won't actually connect to anything else, so only return true if
                // part of the island is *outside* the pad's flashing.
                if (!padHull.PointInside(pt)) return true;
              }
            }

            continue;
          }
          if (aItem.Type() === KICAD_T.PCB_VIA_T && zoneLayer) {
            const via = aItem as PCB_VIA;
            const zone = zoneLayer.Parent() as ZONE;
            const islandIdx = zoneLayer.SubpolyIndex();

            if (zone.IsFilled()) {
              const layer = ToLAYER_ID(aLayer);
              const zoneFill = zone.GetFill(layer)!;
              const viaHull = new SHAPE_CIRCLE(
                via.GetCenter(),
                Math.trunc(via.GetWidth(layer) / 2),
              );

              for (const pt of zoneFill.COutline(islandIdx).CPoints()) {
                // If the entire island is inside the via's flashing then the via
                // won't actually connect to anything else, so only return true if
                // part of the island is *outside* the via's flashing.
                if (!viaHull.Collide(pt)) return true;
              }
            }

            continue;
          }

          return true;
        }
      }
    }

    return false;
  }

  GetUnconnectedCount(aVisibleOnly: boolean): number {
    let unconnected = 0;

    for (const net of this.m_nets) {
      if (!net) continue;

      for (const edge of net.GetEdges()) {
        if (edge.IsVisible() || !aVisibleOnly) ++unconnected;
      }
    }

    return unconnected;
  }

  ClearRatsnest(): void {
    for (const net of this.m_nets) net.Clear();
  }

  GetConnectedItems(aItem: BOARD_CONNECTED_ITEM, aFlags = 0): BOARD_CONNECTED_ITEM[] {
    const rv: BOARD_CONNECTED_ITEM[] = [];

    const clusters = this.m_connAlgo.SearchClusters(
      (aFlags & IGNORE_NETS ? CSM_PROPAGATE : CSM_CONNECTIVITY_CHECK) as CLUSTER_SEARCH_MODE,
      (aFlags & EXCLUDE_ZONES) !== 0,
      aFlags & IGNORE_NETS ? -1 : aItem.GetNetCode(),
    );

    for (const cl of clusters) {
      if (cl.Contains(aItem)) {
        for (const item of cl) {
          if (item.Valid()) rv.push(item.Parent());
        }
      }
    }

    return rv;
  }

  GetNetItems(aNetCode: number, aTypes: readonly KICAD_T[]): BOARD_CONNECTED_ITEM[] {
    const items: BOARD_CONNECTED_ITEM[] = [];

    const type_bits = new Set<KICAD_T>(aTypes);

    this.m_connAlgo.ForEachItem((aItem) => {
      if (aItem.Valid() && aItem.Net() === aNetCode && type_bits.has(aItem.Parent().Type()))
        items.push(aItem.Parent());
    });

    // std::sort + std::unique on the pointers: one entry each, in an arbitrary
    // but fixed order — first-seen order here.
    const seen = new Set<BOARD_CONNECTED_ITEM>();
    return items.filter((i) => {
      if (seen.has(i)) return false;
      seen.add(i);
      return true;
    });
  }

  GetConnectedTracks(aItem: BOARD_CONNECTED_ITEM): PCB_TRACK[] {
    const entry = this.m_connAlgo.ItemEntry(aItem);

    const tracks = new Set<PCB_TRACK>();

    for (const citem of entry.GetItems()) {
      for (const connected of citem.ConnectedItems()) {
        if (
          connected.Valid() &&
          (connected.Parent().Type() === KICAD_T.PCB_TRACE_T ||
            connected.Parent().Type() === KICAD_T.PCB_VIA_T ||
            connected.Parent().Type() === KICAD_T.PCB_ARC_T)
        ) {
          tracks.add(connected.Parent() as PCB_TRACK);
        }
      }
    }

    return [...tracks];
  }

  GetConnectedPads(aItem: BOARD_CONNECTED_ITEM): PAD[];
  GetConnectedPads(aItem: BOARD_CONNECTED_ITEM, pads: Set<PAD>): void;
  GetConnectedPads(aItem: BOARD_CONNECTED_ITEM, pads?: Set<PAD>): PAD[] | undefined {
    const set = pads ?? new Set<PAD>();

    for (const citem of this.m_connAlgo.ItemEntry(aItem).GetItems()) {
      for (const connected of citem.ConnectedItems()) {
        if (connected.Valid() && connected.Parent().Type() === KICAD_T.PCB_PAD_T)
          set.add(connected.Parent() as PAD);
      }
    }

    if (pads) return undefined;

    return [...set];
  }

  GetConnectedPadsAndVias(aItem: BOARD_CONNECTED_ITEM, pads: PAD[], vias: PCB_VIA[]): void {
    for (const citem of this.m_connAlgo.ItemEntry(aItem).GetItems()) {
      for (const connected of citem.ConnectedItems()) {
        if (connected.Valid()) {
          const parent = connected.Parent();

          if (parent.Type() === KICAD_T.PCB_PAD_T) pads.push(parent as PAD);
          else if (parent.Type() === KICAD_T.PCB_VIA_T) vias.push(parent as PCB_VIA);
        }
      }
    }
  }

  GetNodeCount(aNet = -1): number {
    let sum = 0;

    if (aNet < 0) {
      // Node count for all nets
      for (const net of this.m_nets) sum += net.GetNodeCount();
    } else if (aNet < this.m_nets.length) {
      sum = this.m_nets[aNet]!.GetNodeCount();
    }

    return sum;
  }

  GetPadCount(aNet = -1): number {
    let n = 0;

    for (const pad of this.m_connAlgo.ItemList()) {
      if (!pad.Valid() || pad.Parent().Type() !== KICAD_T.PCB_PAD_T) continue;

      const dpad = pad.Parent() as PAD;

      if (aNet < 0 || aNet === dpad.GetNetCode()) n++;
    }

    return n;
  }

  RunOnUnconnectedEdges(aFunc: (edge: CN_EDGE) => boolean): void {
    for (const rnNet of this.m_nets) {
      if (rnNet) {
        for (const edge of rnNet.GetEdges()) {
          if (!aFunc(edge)) return;
        }
      }
    }
  }

  TestTrackEndpointDangling(
    aTrack: PCB_TRACK,
    aIgnoreTracksInPads: boolean,
    aPos: { value: VECTOR2I } | null = null,
  ): boolean {
    const items = this.GetConnectivityAlgo().ItemEntry(aTrack).GetItems();

    // Not in the connectivity system.  This is a bug!
    if (items.length === 0) {
      console.assert(false, 'track not in connectivity system');
      return false;
    }

    const citem = items[0]!;

    if (!citem.Valid()) return false;

    if (aTrack.Type() === KICAD_T.PCB_TRACE_T || aTrack.Type() === KICAD_T.PCB_ARC_T) {
      // Test if a segment is connected on each end.
      //
      // NB: be wary of short segments which can be connected to the *same* other item on
      // each end.  If that's their only connection then they're still dangling.
      const layer = aTrack.GetLayer();
      const accuracy = KiROUND(aTrack.GetWidth() / 2.0);
      let start_count = 0;
      let end_count = 0;

      for (const connected of citem.ConnectedItems()) {
        const item = connected.Parent();
        const zone = item.Type() === KICAD_T.PCB_ZONE_T ? (item as ZONE) : null;
        let rtree = null;
        let hitStart = false;
        let hitEnd = false;

        if (item.GetFlags() & IS_DELETED) continue;

        if (zone) rtree = zone.GetBoard()!.m_CopperZoneRTreeCache.get(zone) ?? null;

        if (rtree) {
          const start = new SHAPE_CIRCLE(aTrack.GetStart(), accuracy);
          const end = new SHAPE_CIRCLE(aTrack.GetEnd(), accuracy);

          hitStart = rtree.QueryColliding(start.BBox(), start, layer);
          hitEnd = rtree.QueryColliding(end.BBox(), end, layer);
        } else {
          const shape = item.GetEffectiveShape(layer);

          hitStart = shape.Collide(aTrack.GetStart(), accuracy);
          hitEnd = shape.Collide(aTrack.GetEnd(), accuracy);
        }

        if (hitStart && hitEnd) {
          if (zone) {
            // Both start and end in a zone: track may be redundant, but it's not dangling
            return false;
          }
          if (item.Type() === KICAD_T.PCB_PAD_T || item.Type() === KICAD_T.PCB_VIA_T) {
            // Both start and end are under a pad: see what the caller wants us to do
            if (aIgnoreTracksInPads) return false;
          }

          if (getMinDist(item, aTrack.GetStart()) < getMinDist(item, aTrack.GetEnd()))
            start_count++;
          else end_count++;
        } else if (hitStart) {
          start_count++;
        } else if (hitEnd) {
          end_count++;
        }

        if (start_count > 0 && end_count > 0) return false;
      }

      if (aPos) aPos.value = start_count === 0 ? aTrack.GetStart() : aTrack.GetEnd();

      return true;
    }
    if (aTrack.Type() === KICAD_T.PCB_VIA_T) {
      // Test if a via is only connected on one layer

      const connected = citem.ConnectedItems();

      if (connected.length === 0) {
        // No connections AND no-net is not an error
        if (aTrack.GetNetCode() <= 0) return false;

        if (aPos) aPos.value = aTrack.GetPosition();

        return true;
      }

      // Here, we check if the via is connected only to items on a single layer
      let first_layer: number = PCB_LAYER_ID.UNDEFINED_LAYER;

      for (const item of connected) {
        if (item.Parent().GetFlags() & IS_DELETED) continue;

        if (first_layer === PCB_LAYER_ID.UNDEFINED_LAYER) first_layer = item.Layer();
        else if (item.Layer() !== first_layer) return false;
      }

      if (aPos) aPos.value = aTrack.GetPosition();

      return true;
    }
    console.assert(false, 'CONNECTIVITY_DATA::TestTrackEndpointDangling: unknown track type');

    return false;
  }

  GetConnectedItemsAtAnchor(
    aItem: BOARD_CONNECTED_ITEM,
    aAnchor: VECTOR2I,
    aTypes: readonly KICAD_T[],
    aMaxError = 0,
  ): BOARD_CONNECTED_ITEM[] {
    const entry = this.m_connAlgo.ItemEntry(aItem);
    const rv: BOARD_CONNECTED_ITEM[] = [];
    const maxError_sq = aMaxError * aMaxError;

    for (const cnItem of entry.GetItems()) {
      for (const connected of cnItem.ConnectedItems()) {
        for (const anchor of connected.Anchors()) {
          if (SquaredEuclideanNorm(sub(anchor.Pos(), aAnchor)) <= maxError_sq) {
            for (const type of aTypes) {
              if (connected.Valid() && connected.Parent().Type() === type) {
                rv.push(connected.Parent());
                break;
              }
            }

            break;
          }
        }
      }
    }

    return rv;
  }

  GetRatsnestForNet(aNet: number): RN_NET | null {
    if (aNet < 0 || aNet >= this.m_nets.length) return null;

    return this.m_nets[aNet]!;
  }

  MarkItemNetAsDirty(aItem: BOARD_ITEM): void {
    if (aItem.Type() === KICAD_T.PCB_FOOTPRINT_T) {
      for (const pad of (aItem as FOOTPRINT).Pads())
        this.m_connAlgo.MarkNetAsDirty(pad.GetNetCode());
    }

    if (aItem.IsConnected())
      this.m_connAlgo.MarkNetAsDirty((aItem as BOARD_CONNECTED_ITEM).GetNetCode());
  }

  RemoveInvalidRefs(): void {
    this.m_connAlgo.RemoveInvalidRefs();

    for (const rnNet of this.m_nets) rnNet.RemoveInvalidRefs();
  }

  SetProgressReporter(aReporter: PROGRESS_REPORTER_LIKE | null): void {
    this.m_progressReporter = aReporter;
    this.m_connAlgo.SetProgressReporter(this.m_progressReporter);
  }

  GetConnectivityAlgo(): CN_CONNECTIVITY_ALGO {
    return this.m_connAlgo;
  }

  HasNetNameForNetCode(nc: number): boolean {
    return this.m_netcodeMap.has(nc);
  }

  GetNetNameForNetCode(nc: number): string {
    const name = this.m_netcodeMap.get(nc);

    if (name === undefined) throw new Error('std::map::at'); // .at() throws

    return name;
  }

  GetRatsnestForItems(aItems: readonly BOARD_ITEM[]): CN_EDGE[] {
    // std::set<int>: ascending
    const nets = new Set<number>();
    const edges: CN_EDGE[] = [];
    const item_set = new Set<BOARD_CONNECTED_ITEM>();

    for (const item of aItems) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const footprint = item as FOOTPRINT;

        for (const pad of footprint.Pads()) {
          nets.add(pad.GetNetCode());
          item_set.add(pad);
        }
      } else if (item.IsConnected()) {
        const conn_item = item as BOARD_CONNECTED_ITEM;

        item_set.add(conn_item);
        nets.add(conn_item.GetNetCode());
      }
    }

    const sortedNets = [...nets];
    stdSort(sortedNets, (a, b) => a < b);

    for (const netcode of sortedNets) {
      const net = this.GetRatsnestForNet(netcode);

      if (!net) continue;

      for (const edge of net.GetEdges()) {
        const srcNode = edge.GetSourceNode();
        const dstNode = edge.GetTargetNode();

        if (!srcNode || srcNode.Dirty() || !dstNode || dstNode.Dirty()) continue;

        const srcParent = srcNode.Parent();
        const dstParent = dstNode.Parent();

        const srcFound = item_set.has(srcParent);
        const dstFound = item_set.has(dstParent);

        if (srcFound && dstFound) edges.push(edge);
      }
    }

    return edges;
  }

  GetRatsnestForPad(aPad: PAD): CN_EDGE[] {
    const edges: CN_EDGE[] = [];
    const net = this.GetRatsnestForNet(aPad.GetNetCode());

    if (!net) return edges;

    for (const edge of net.GetEdges()) {
      if (!edge.GetSourceNode() || edge.GetSourceNode()!.Dirty()) continue;

      if (!edge.GetTargetNode() || edge.GetTargetNode()!.Dirty()) continue;

      if (edge.GetSourceNode()!.Parent() === aPad || edge.GetTargetNode()!.Parent() === aPad)
        edges.push(edge);
    }

    return edges;
  }

  GetRatsnestForComponent(aComponent: FOOTPRINT, aSkipInternalConnections = false): CN_EDGE[] {
    const nets = new Set<number>();
    const pads = new Set<PAD>();
    const edges: CN_EDGE[] = [];

    for (const pad of aComponent.Pads()) {
      nets.add(pad.GetNetCode());
      pads.add(pad);
    }

    const sortedNets = [...nets];
    stdSort(sortedNets, (a, b) => a < b);

    for (const netcode of sortedNets) {
      const net = this.GetRatsnestForNet(netcode);

      if (!net) continue;

      for (const edge of net.GetEdges()) {
        const srcNode = edge.GetSourceNode();
        const dstNode = edge.GetTargetNode();

        if (!srcNode || srcNode.Dirty() || !dstNode || dstNode.Dirty()) continue;

        const srcParent = srcNode.Parent() as PAD;
        const dstParent = dstNode.Parent() as PAD;

        const srcFound = pads.has(srcParent);
        const dstFound = pads.has(dstParent);

        if (srcFound && dstFound && !aSkipInternalConnections) edges.push(edge);
        else if (srcFound || dstFound) edges.push(edge);
      }
    }

    return edges;
  }

  GetNetSettings(): NET_SETTINGS | null {
    return this.m_netSettings;
  }

  GetFromToCache(): FROM_TO_CACHE {
    return this.m_fromToCache;
  }
}
