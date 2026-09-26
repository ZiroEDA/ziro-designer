// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/connectivity/connectivity_algo.h` + `.cpp`: the connectivity search
 * (which copper touches which), the cluster walk and net propagation.
 *
 * The C++ runs the per-item search on the thread pool; the visitors only
 * ever *add* symmetric connections, so running them in item order gives the
 * same graph. The deferred via-net list is sorted by item afterwards (by
 * `m_id`, the pointer order), exactly as the C++ sorts it by pointer.
 */
import type { COMMIT } from '@ziroeda/common/commit.js';
import { FLASHING, IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { EuclideanNormI, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import { ZONE_LAYER_OVERRIDE } from '../board_item.js';
import { FOOTPRINT, FP_JUST_ADDED } from '../footprint.js';
import type { NETINFO_ITEM } from '../netinfo.js';
import type { PAD } from '../pad.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_ARC, PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import type { ISOLATED_ISLANDS, ZONE } from '../zone.js';
import type { CONNECTIVITY_DATA } from './connectivity_data.js';
import {
  type CN_ANCHOR,
  CN_CLUSTER,
  CN_ITEM,
  CN_LIST,
  CN_ZONE_LAYER,
} from './connectivity_items.js';
import { INT_MAX } from './connectivity_rtree.js';

/** The slice of PROGRESS_REPORTER the search reports to (pending with the class, #636 stage 6). */
export interface PROGRESS_REPORTER_LIKE {
  SetMaxProgress(aMaxProgress: number): void;
  SetCurrentProgress(aProgress: number): void;
  AdvanceProgress(): void;
  KeepRefreshing(aWait?: boolean): boolean;
  IsCancelled(): boolean;
  Report(aMessage: string): void;
}

/**
 * CN_EDGE represents a point-to-point connection, whether realized or unrealized (ie: tracks etc.
 * or a ratsnest line).
 */
export class CN_EDGE {
  private m_source: CN_ANCHOR | null;
  private m_target: CN_ANCHOR | null;
  private m_weight: number;
  private m_visible: boolean;

  constructor(aSource: CN_ANCHOR | null = null, aTarget: CN_ANCHOR | null = null, aWeight = 0) {
    this.m_source = aSource;
    this.m_target = aTarget;
    this.m_weight = aWeight;
    this.m_visible = true;
  }

  clone(): CN_EDGE {
    const e = new CN_EDGE(this.m_source, this.m_target, this.m_weight);
    e.m_visible = this.m_visible;
    return e;
  }

  /**
   * This sort operator provides a sort-by-weight for the ratsnest operation.
   *
   * @param aOther the other edge to compare.
   * @return true if our weight is smaller than the other weight.
   */
  lessThan(aOther: CN_EDGE): boolean {
    return this.m_weight < aOther.m_weight;
  }

  /**
   * Comparison operator for std::stable_sort.
   *
   * @param aOther the other edge to compare.
   * @return true if this edge should come before aOther in the sorted order.
   *
   * Comparison order:
   * 1. Compare source nodes by position (x, then y)
   * 2. Then compare by weight
   * 3. Then by visibility
   * 4. If everything is equal, return false for stable ordering
   */
  StableSortCompare(aOther: CN_EDGE): boolean {
    const thisPos = this.GetSourcePos();
    const otherPos = aOther.GetSourcePos();

    // First compare by source node position
    if (thisPos.x !== otherPos.x) return thisPos.x < otherPos.x;

    if (thisPos.y !== otherPos.y) return thisPos.y < otherPos.y;

    // Then compare by weight
    if (this.m_weight !== aOther.m_weight) return this.m_weight < aOther.m_weight;

    // Then by visibility
    if (this.m_visible !== aOther.m_visible) return this.m_visible && !aOther.m_visible;

    // If everything is equal, return false for stable ordering
    return false;
  }

  GetSourceNode(): CN_ANCHOR | null {
    return this.m_source;
  }
  GetTargetNode(): CN_ANCHOR | null {
    return this.m_target;
  }

  SetSourceNode(aNode: CN_ANCHOR | null): void {
    this.m_source = aNode;
  }
  SetTargetNode(aNode: CN_ANCHOR | null): void {
    this.m_target = aNode;
  }

  RemoveInvalidRefs(): void {
    if (this.m_source && !this.m_source.Valid()) this.m_source = null;

    if (this.m_target && !this.m_target.Valid()) this.m_target = null;
  }

  SetWeight(weight: number): void {
    this.m_weight = weight;
  }
  GetWeight(): number {
    return this.m_weight;
  }

  SetVisible(aVisible: boolean): void {
    this.m_visible = aVisible;
  }

  IsVisible(): boolean {
    return this.m_visible;
  }

  GetSourcePos(): VECTOR2I {
    return this.m_source!.Pos();
  }
  GetTargetPos(): VECTOR2I {
    return this.m_target!.Pos();
  }
  GetLength(): number {
    return EuclideanNormI(sub(this.m_target!.Pos(), this.m_source!.Pos()));
  }
}

export enum CLUSTER_SEARCH_MODE {
  CSM_PROPAGATE,
  CSM_CONNECTIVITY_CHECK,
  CSM_RATSNEST,
}
export const { CSM_PROPAGATE, CSM_CONNECTIVITY_CHECK, CSM_RATSNEST } = CLUSTER_SEARCH_MODE;

export type CLUSTERS = CN_CLUSTER[];

/*
 * Holds a list of CN_ITEMs for a given BOARD_CONNECTED_ITEM.  For most items (pads, tracks,
 * etc.) the list will have a single CN_ITEM, but for ZONEs it will have one item for each
 * distinct outline on each layer.
 */
export class ITEM_MAP_ENTRY {
  m_items: CN_ITEM[] = [];

  constructor(aItem: CN_ITEM | null = null) {
    if (aItem) this.m_items.push(aItem);
  }

  MarkItemsAsInvalid(): void {
    for (const item of this.m_items) item.SetValid(false);
  }

  Link(aItem: CN_ITEM): void {
    this.m_items.push(aItem);
  }

  GetItems(): readonly CN_ITEM[] {
    return this.m_items;
  }
}

export class CN_CONNECTIVITY_ALGO {
  private m_parentConnectivityData: CONNECTIVITY_DATA;
  private m_itemList = new CN_LIST();
  private m_itemMap = new Map<BOARD_ITEM, ITEM_MAP_ENTRY>();
  private m_connClusters: CN_CLUSTER[] = [];
  private m_ratsnestClusters: CN_CLUSTER[] = [];
  private m_dirtyNets: boolean[] = [];
  private m_isLocal: boolean;
  private m_globalConnectivityData: CONNECTIVITY_DATA | null = null;
  private m_progressReporter: PROGRESS_REPORTER_LIKE | null = null;

  constructor(aParentConnectivityData: CONNECTIVITY_DATA) {
    this.m_parentConnectivityData = aParentConnectivityData;
    this.m_isLocal = false;
  }

  ItemExists(aItem: BOARD_CONNECTED_ITEM): boolean {
    return this.m_itemMap.has(aItem);
  }

  /** `m_itemMap[ aItem ]`: operator[] creates an empty entry. */
  ItemEntry(aItem: BOARD_CONNECTED_ITEM): ITEM_MAP_ENTRY {
    let entry = this.m_itemMap.get(aItem);

    if (!entry) {
      entry = new ITEM_MAP_ENTRY();
      this.m_itemMap.set(aItem, entry);
    }

    return entry;
  }

  IsNetDirty(aNet: number): boolean {
    if (aNet < 0) return false;

    return this.m_dirtyNets[aNet] ?? false;
  }

  ClearDirtyFlags(): void {
    for (let ii = 0; ii < this.m_dirtyNets.length; ii++) this.m_dirtyNets[ii] = false;
  }

  GetDirtyClusters(aClusters: CLUSTERS): void {
    for (const cl of this.m_ratsnestClusters) {
      const net = cl.OriginNet();

      if (net >= 0 && this.m_dirtyNets[net]) aClusters.push(cl);
    }
  }

  NetCount(): number {
    return this.m_dirtyNets.length;
  }

  Remove(aItem: BOARD_ITEM): boolean {
    let anythingDeleted = false;

    this.markItemNetAsDirty(aItem);

    switch (aItem.Type()) {
      case KICAD_T.PCB_FOOTPRINT_T:
        for (const pad of (aItem as FOOTPRINT).Pads()) {
          if (this.m_itemMap.has(pad)) {
            // prevent double deletion
            this.m_itemMap.get(pad)!.MarkItemsAsInvalid();
            this.m_itemMap.delete(pad);
            anythingDeleted = true;
          }
        }

        this.m_itemList.SetDirty(true);
        break;

      case KICAD_T.PCB_PAD_T:
      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
      case KICAD_T.PCB_VIA_T:
      case KICAD_T.PCB_ZONE_T:
      case KICAD_T.PCB_SHAPE_T:
        if (this.m_itemMap.has(aItem)) {
          // prevent double deletion
          this.m_itemMap.get(aItem)!.MarkItemsAsInvalid();
          this.m_itemMap.delete(aItem);
          this.m_itemList.SetDirty(true);
          anythingDeleted = true;
        }

        break;

      default:
        return false;
    }

    // Once we delete an item, it may connect between lists, so mark both as potentially invalid
    if (anythingDeleted) this.m_itemList.SetHasInvalid(true);

    return true;
  }

  private markItemNetAsDirty(aItem: BOARD_ITEM): void {
    if (aItem.IsConnected()) {
      const citem = aItem as BOARD_CONNECTED_ITEM;
      this.MarkNetAsDirty(citem.GetNetCode());
    } else {
      if (aItem.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const footprint = aItem as FOOTPRINT;

        for (const pad of footprint.Pads()) this.MarkNetAsDirty(pad.GetNetCode());
      }
    }
  }

  Add(aItem: BOARD_ITEM): boolean {
    if (!aItem.IsOnCopperLayer()) return false;

    const alreadyAdded = (item: BOARD_ITEM): boolean => {
      const it = this.m_itemMap.get(item);

      if (!it) return false;

      // Don't be fooled by an empty ITEM_MAP_ENTRY auto-created by operator[].
      return it.GetItems().length !== 0;
    };

    switch (aItem.Type()) {
      case KICAD_T.PCB_NETINFO_T:
        this.MarkNetAsDirty((aItem as NETINFO_ITEM).GetNetCode());
        break;

      case KICAD_T.PCB_FOOTPRINT_T: {
        if ((aItem as FOOTPRINT).GetAttributes() & FP_JUST_ADDED) return false;

        for (const pad of (aItem as FOOTPRINT).Pads()) {
          if (alreadyAdded(pad)) return false;

          this.add(pad, this.m_itemList.AddPad(pad));
        }

        break;
      }

      case KICAD_T.PCB_PAD_T: {
        const fp = aItem.GetParentFootprint();
        if (fp) {
          if (fp.GetAttributes() & FP_JUST_ADDED) return false;
        }

        if (alreadyAdded(aItem)) return false;

        this.add(aItem, this.m_itemList.AddPad(aItem as PAD));
        break;
      }

      case KICAD_T.PCB_TRACE_T:
        if (alreadyAdded(aItem)) return false;

        this.add(aItem, this.m_itemList.AddTrack(aItem as PCB_TRACK));
        break;

      case KICAD_T.PCB_ARC_T:
        if (alreadyAdded(aItem)) return false;

        this.add(aItem, this.m_itemList.AddArc(aItem as PCB_ARC));
        break;

      case KICAD_T.PCB_VIA_T:
        if (alreadyAdded(aItem)) return false;

        this.add(aItem, this.m_itemList.AddVia(aItem as PCB_VIA));
        break;

      case KICAD_T.PCB_SHAPE_T:
        if (alreadyAdded(aItem)) return false;

        if (!IsCopperLayer(aItem.GetLayer())) return false;

        this.add(aItem, this.m_itemList.AddShape(aItem as PCB_SHAPE));
        break;

      case KICAD_T.PCB_ZONE_T: {
        const zone = aItem as ZONE;

        if (alreadyAdded(aItem)) return false;

        this.m_itemMap.set(zone, new ITEM_MAP_ENTRY());

        // Don't check for connections on layers that only exist in the zone but
        // were disabled in the board
        const board = zone.GetBoard()!;
        const layerset = board.GetEnabledLayers().and(zone.GetLayerSet());

        layerset.RunOnLayers((layer: PCB_LAYER_ID) => {
          for (const zitem of this.m_itemList.AddZone(zone, layer))
            this.m_itemMap.get(zone)!.Link(zitem);
        });

        break;
      }

      default:
        return false;
    }

    this.markItemNetAsDirty(aItem);

    return true;
  }

  /** `add( Container& c, BItem brditem )`: the item is already in the list. */
  private add(brditem: BOARD_ITEM, item: CN_ITEM | null): void {
    this.m_itemMap.set(brditem, new ITEM_MAP_ENTRY(item));
  }

  RemoveInvalidRefs(): void {
    for (const item of this.m_itemList) item.RemoveInvalidRefs();
  }

  private searchConnections(): void {
    const garbage: CN_ITEM[] = [];

    this.m_parentConnectivityData.RemoveInvalidRefs();

    if (this.m_isLocal) this.m_globalConnectivityData!.RemoveInvalidRefs();

    this.m_itemList.RemoveInvalidItems(garbage);

    for (const item of garbage) item.destroy();

    const dirtyItems: CN_ITEM[] = [];

    for (const aItem of this.m_itemList) if (aItem.Dirty()) dirtyItems.push(aItem);

    if (this.m_progressReporter) {
      this.m_progressReporter.SetMaxProgress(dirtyItems.length);

      if (!this.m_progressReporter.KeepRefreshing()) return;
    }

    if (this.m_itemList.IsDirty()) {
      // Collect deferred net code changes to avoid data races in parallel search.
      // Vias connected to zones have their net codes updated after all parallel work
      // completes, but only if the via has no higher-priority connections (tracks, pads).
      const deferredNetCodes: [CN_ITEM, number][] = [];

      for (let ii = 0; ii < dirtyItems.length; ++ii) {
        if (this.m_progressReporter?.IsCancelled()) continue;

        const visitor = new CN_VISITOR(dirtyItems[ii]!, deferredNetCodes);
        this.m_itemList.FindNearby(dirtyItems[ii]!, (c) => visitor.visit(c));

        if (this.m_progressReporter) this.m_progressReporter.AdvanceProgress();
      }

      // Apply deferred zone net changes, but only for vias that have no non-zone
      // connections.  Tracks and pads take priority over zones for net assignment;
      // cluster-based propagation will handle those vias.
      //
      // A single via can touch zones of several different nets (e.g. a through via
      // crossing a GND plane and a power plane).  The order in which those candidate
      // nets are collected depends on the parallel search and is not stable across
      // connectivity rebuilds, so we must not simply pick the first one: doing so makes
      // the via's net flip arbitrarily on every rebuild (i.e. on every undo/redo).
      // Instead, if the via's existing net matches any zone it touches, we keep it.
      // This preserves a deliberately-assigned net and only falls back to a
      // deterministic choice (lowest net code) when the current net no longer touches
      // any zone.
      stdSort(deferredNetCodes, (a, b) => a[0].m_id < b[0].m_id);

      for (let it = 0; it < deferredNetCodes.length; ) {
        const cnItem = deferredNetCodes[it]![0];

        // Entries for the same via are contiguous after the sort above.
        let groupEnd = it;

        while (groupEnd < deferredNetCodes.length && deferredNetCodes[groupEnd]![0] === cnItem)
          ++groupEnd;

        if (cnItem.ConnectedItems().some((c) => c.Parent().Type() !== KICAD_T.PCB_ZONE_T)) {
          // Connected to a track or pad, so cluster propagation owns the net.
          it = groupEnd;
          continue;
        }

        const existingNet = cnItem.Parent().GetNetCode();
        let keepExisting = false;
        let bestNet = INT_MAX;

        for (let entry = it; entry < groupEnd; ++entry) {
          if (deferredNetCodes[entry]![1] === existingNet) {
            keepExisting = true;
            break;
          }

          bestNet = Math.min(bestNet, deferredNetCodes[entry]![1]);
        }

        if (!keepExisting) cnItem.Parent().SetNetCode(bestNet);

        it = groupEnd;
      }

      if (this.m_progressReporter) this.m_progressReporter.KeepRefreshing();
    }

    this.m_itemList.ClearDirtyFlags();
  }

  SearchClusters(aMode: CLUSTER_SEARCH_MODE): CLUSTERS;
  SearchClusters(aMode: CLUSTER_SEARCH_MODE, aExcludeZones: boolean, aSingleNet: number): CLUSTERS;
  SearchClusters(
    aMode: CLUSTER_SEARCH_MODE,
    aExcludeZones?: boolean,
    aSingleNet?: number,
  ): CLUSTERS {
    if (aExcludeZones === undefined) return this.SearchClusters(aMode, aMode === CSM_PROPAGATE, -1);

    const withinAnyNet = aMode !== CSM_PROPAGATE;

    const Q: CN_ITEM[] = [];
    // std::set<CN_ITEM*>: pointer order, m_id here
    const item_set: CN_ITEM[] = [];
    const clusters: CLUSTERS = [];

    if (this.m_itemList.IsDirty()) this.searchConnections();

    const visited = new Set<CN_ITEM>();

    const addToSearchList = (aItem: CN_ITEM): void => {
      if (withinAnyNet && aItem.Net() <= 0) return;

      if (!aItem.Valid()) return;

      if (aSingleNet! >= 0 && aItem.Net() !== aSingleNet) return;

      if (aExcludeZones && aItem.Parent().Type() === KICAD_T.PCB_ZONE_T) return;

      item_set.push(aItem);
    };

    for (const item of this.m_itemList) addToSearchList(item);

    item_set.sort((a, b) => a.m_id - b.m_id);

    if (this.m_progressReporter?.IsCancelled()) return [];

    let head = 0;

    while (head < item_set.length) {
      const cluster = new CN_CLUSTER();
      let root: CN_ITEM;

      while (head < item_set.length && visited.has(item_set[head]!)) head++;

      if (head >= item_set.length) break;

      root = item_set[head]!;
      visited.add(root);

      Q.length = 0;
      Q.push(root);

      let qHead = 0;

      while (qHead < Q.length) {
        const current = Q[qHead++]!;
        cluster.Add(current);

        for (const n of current.ConnectedItems()) {
          if (withinAnyNet && n.Net() !== root.Net()) continue;

          if (aExcludeZones && n.Parent().Type() === KICAD_T.PCB_ZONE_T) continue;

          if (!visited.has(n) && n.Valid()) {
            visited.add(n);
            Q.push(n);
          }
        }
      }

      clusters.push(cluster);
    }

    if (this.m_progressReporter?.IsCancelled()) return [];

    stdSort(clusters, (a, b) => a.OriginNet() < b.OriginNet());

    return clusters;
  }

  Build(aBoard: BOARD, aReporter: PROGRESS_REPORTER_LIKE | null = null): void {
    // Generate CN_ZONE_LAYERs for each island on each layer of each zone
    //
    const zitems: CN_ZONE_LAYER[] = [];

    for (const zone of aBoard.Zones()) {
      if (zone.IsOnCopperLayer()) {
        this.m_itemMap.set(zone, new ITEM_MAP_ENTRY());
        this.markItemNetAsDirty(zone);

        // Don't check for connections on layers that only exist in the zone but
        // were disabled in the board
        const board = zone.GetBoard()!;
        const layerset = board.GetEnabledLayers().and(zone.GetLayerSet()).and(LSET.AllCuMask());

        layerset.RunOnLayers((layer: PCB_LAYER_ID) => {
          for (let j = 0; j < zone.GetFilledPolysList(layer).OutlineCount(); j++)
            zitems.push(new CN_ZONE_LAYER(zone, layer, j));
        });
      }
    }

    // Setup progress metrics
    //
    let progressDelta = 50;
    let size = 0.0;

    size += zitems.length; // Once for building RTrees
    size += zitems.length; // Once for adding to connectivity
    size += aBoard.Tracks().length;
    size += aBoard.Drawings().length;

    for (const footprint of aBoard.Footprints()) size += footprint.Pads().length;

    size *= 1.5; // Our caller gets the other third of the progress bar

    progressDelta = Math.max(progressDelta, Math.trunc(size) >> 2);

    const report = (progress: number): void => {
      if (aReporter && progress % progressDelta === 0) {
        aReporter.SetCurrentProgress(progress / size);
        aReporter.KeepRefreshing(false);
      }
    };

    // Generate RTrees for CN_ZONE_LAYER items (in parallel)
    //
    for (const aZoneLayer of zitems) {
      if (aReporter?.IsCancelled()) continue;

      aZoneLayer.BuildRTree();

      if (aReporter) aReporter.AdvanceProgress();
    }

    // Add CN_ZONE_LAYERS, tracks, and pads to connectivity
    //
    let ii = zitems.length;

    for (const zitem of zitems) {
      this.m_itemList.AddZoneLayer(zitem);
      this.ItemEntry(zitem.Parent()).Link(zitem);
      report(++ii);
    }

    for (const tv of aBoard.Tracks()) {
      this.Add(tv);
      report(++ii);
    }

    for (const footprint of aBoard.Footprints()) {
      for (const pad of footprint.Pads()) {
        this.Add(pad);
        report(++ii);
      }
    }

    for (const drawing of aBoard.Drawings()) {
      if (drawing.Type() === KICAD_T.PCB_SHAPE_T) {
        const shape = drawing as PCB_SHAPE;

        if (shape.IsOnCopperLayer()) this.Add(shape);
      }

      report(++ii);
    }

    if (aReporter) {
      aReporter.SetCurrentProgress(ii / size);
      aReporter.KeepRefreshing(false);
    }
  }

  LocalBuild(aGlobalConnectivity: CONNECTIVITY_DATA, aLocalItems: readonly BOARD_ITEM[]): void {
    this.m_isLocal = true;
    this.m_globalConnectivityData = aGlobalConnectivity;

    for (const item of aLocalItems) {
      switch (item.Type()) {
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T:
        case KICAD_T.PCB_PAD_T:
        case KICAD_T.PCB_FOOTPRINT_T:
        case KICAD_T.PCB_SHAPE_T:
          this.Add(item);
          break;

        default:
          break;
      }
    }
  }

  private propagateConnections(aCommit: COMMIT | null): void {
    for (const cluster of this.m_connClusters) {
      if (cluster.IsConflicting()) {
        // Conflicting pads in cluster: we don't know the user's intent so best to do
        // nothing.
      } else if (cluster.HasValidNet()) {
        // Propagate from the origin (will be a pad if there are any, or another item if
        // there are no pads).
        for (const item of cluster) {
          if (
            item.Valid() &&
            item.CanChangeNet() &&
            item.Parent().GetNetCode() !== cluster.OriginNet()
          ) {
            this.MarkNetAsDirty(item.Parent().GetNetCode());
            this.MarkNetAsDirty(cluster.OriginNet());

            if (aCommit) aCommit.Modify(item.Parent());

            item.Parent().SetNetCode(cluster.OriginNet());
          }
        }
      }
    }
  }

  /**
   * Propagate nets from pads to other items in clusters.
   * @param aCommit is used to store undo information for items modified by the call.
   */
  PropagateNets(aCommit: COMMIT | null = null): void {
    this.updateJumperPads();
    this.m_connClusters = this.SearchClusters(CSM_PROPAGATE);
    this.propagateConnections(aCommit);
  }

  /**
   * Fill in the isolated islands map with copper islands that are not connected to a net.
   */
  FillIsolatedIslandsMap(
    aMap: Map<ZONE, Map<PCB_LAYER_ID, ISOLATED_ISLANDS>>,
    aConnectivityAlreadyRebuilt: boolean,
  ): void {
    let progressDelta = 50;
    let ii = 0;

    progressDelta = Math.max(progressDelta, aMap.size >> 2);

    if (!aConnectivityAlreadyRebuilt) {
      for (const [zone] of aMap) {
        this.Remove(zone);
        this.Add(zone);
        ii++;

        if (this.m_progressReporter && ii % progressDelta === 0) {
          this.m_progressReporter.SetCurrentProgress(ii / aMap.size);
          this.m_progressReporter.KeepRefreshing(false);
        }

        if (this.m_progressReporter?.IsCancelled()) return;
      }
    }

    this.m_connClusters = this.SearchClusters(CSM_CONNECTIVITY_CHECK);

    for (const [zone, zoneIslands] of aMap) {
      for (const [layer, layerIslands] of zoneIslands) {
        if (zone.GetFilledPolysList(layer).IsEmpty()) continue;

        let notInConnectivity = true;

        for (const cluster of this.m_connClusters) {
          for (const item of cluster) {
            if (item.Parent() === zone && item.GetBoardLayer() === layer) {
              const z = item as CN_ZONE_LAYER;
              notInConnectivity = false;

              if (cluster.IsOrphaned()) layerIslands.m_IsolatedOutlines.push(z.SubpolyIndex());
              else if (z.HasSingleConnection())
                layerIslands.m_SingleConnectionOutlines.push(z.SubpolyIndex());
            }
          }
        }

        // Non-copper zones (silk, mask, etc.) are never added to the connectivity graph,
        // so notInConnectivity is always true for them.  Without the IsCopperLayer guard
        // outline 0 of every non-copper multi-island fill gets dropped on every refill
        // (issue 24089).
        if (notInConnectivity && IsCopperLayer(layer)) layerIslands.m_IsolatedOutlines.push(0);
      }
    }
  }

  GetClusters(): CLUSTERS {
    this.m_ratsnestClusters = this.SearchClusters(CSM_RATSNEST);
    return this.m_ratsnestClusters;
  }

  ItemList(): CN_LIST {
    return this.m_itemList;
  }

  ForEachAnchor(aFunc: (anchor: CN_ANCHOR) => void): void {
    for (const item of this.m_itemList) {
      for (const anchor of item.Anchors()) aFunc(anchor);
    }
  }

  ForEachItem(aFunc: (item: CN_ITEM) => void): void {
    for (const item of this.m_itemList) aFunc(item);
  }

  MarkNetAsDirty(aNet: number): void {
    if (aNet < 0) return;

    if (this.m_dirtyNets.length <= aNet) {
      let lastNet = this.m_dirtyNets.length - 1;

      if (lastNet < 0) lastNet = 0;

      this.m_dirtyNets.length = aNet + 1;

      for (let i = lastNet; i < aNet + 1; i++) this.m_dirtyNets[i] = true;
    }

    this.m_dirtyNets[aNet] = true;
  }

  Clear(): void {
    this.m_ratsnestClusters.length = 0;
    this.m_connClusters.length = 0;
    this.m_itemMap.clear();
    this.m_itemList.Clear();
  }

  SetProgressReporter(aReporter: PROGRESS_REPORTER_LIKE | null): void {
    this.m_progressReporter = aReporter;
  }

  private updateJumperPads(): void {
    // Map of footprint -> map of pad number -> list of CN_ITEMs for pads with that number
    // std::map<FOOTPRINT*, std::map<wxString, ...>>: the footprints by pointer, the
    // numbers by wxString order.
    const padsByFootprint = new Map<FOOTPRINT, Map<string, CN_ITEM[]>>();

    for (const item of this.m_itemList) {
      if (!item.Valid() || item.Parent().Type() !== KICAD_T.PCB_PAD_T) continue;

      const pad = item.Parent() as PAD;
      const fp = pad.GetParentFootprint()!;

      let padsMap = padsByFootprint.get(fp);

      if (!padsMap) {
        padsMap = new Map();
        padsByFootprint.set(fp, padsMap);
      }

      let list = padsMap.get(pad.GetNumber());

      if (!list) {
        list = [];
        padsMap.set(pad.GetNumber(), list);
      }

      list.push(item);
    }

    for (const [footprint, padsMap] of padsByFootprint) {
      if (footprint.GetDuplicatePadNumbersAreJumpers()) {
        for (const padsList of padsMap.values()) {
          for (let i = 0; i < padsList.length; ++i) {
            for (let j = 1; j < padsList.length; ++j) {
              padsList[i]!.Connect(padsList[j]!);
              padsList[j]!.Connect(padsList[i]!);
            }
          }
        }
      }

      for (const group of footprint.JumperPadGroups()) {
        const toConnect: CN_ITEM[] = [];

        // std::set<wxString>: the numbers in string order
        for (const padNumber of [...group].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
          let list = padsMap.get(padNumber);

          if (!list) {
            list = [];
            padsMap.set(padNumber, list);
          }

          toConnect.push(...list);
        }

        for (let i = 0; i < toConnect.length; ++i) {
          for (let j = 1; j < toConnect.length; ++j) {
            toConnect[i]!.Connect(toConnect[j]!);
            toConnect[j]!.Connect(toConnect[i]!);
          }
        }
      }
    }
  }
}

export class CN_VISITOR {
  protected m_item: CN_ITEM; ///< The item we are looking for connections to.

  /// Deferred net code changes collected during parallel connectivity search. Thread-safe
  /// collection via mutex. Processed after parallel search completes.
  protected m_deferredNetCodes: [CN_ITEM, number][];

  constructor(aItem: CN_ITEM, aDeferredNetCodes: [CN_ITEM, number][]) {
    this.m_item = aItem;
    this.m_deferredNetCodes = aDeferredNetCodes;
  }

  /** `operator()( CN_ITEM* aCandidate )`. */
  visit(aCandidate: CN_ITEM): boolean {
    const parentA = aCandidate.Parent();
    const parentB = this.m_item.Parent();

    if (!aCandidate.Valid() || !this.m_item.Valid()) return true;

    if (parentA === parentB) return true;

    // Don't connect items in different nets that can't be changed
    if (
      !aCandidate.CanChangeNet() &&
      !this.m_item.CanChangeNet() &&
      aCandidate.Net() !== this.m_item.Net()
    )
      return true;

    // If both m_item and aCandidate are marked dirty, they will both be searched
    // Since we are reciprocal in our connection, we arbitrarily pick one of the connections
    // to conduct the expensive search
    if (aCandidate.Dirty() && aCandidate.m_id < this.m_item.m_id) return true;

    // We should handle zone-zone connection separately
    if (parentA.Type() === KICAD_T.PCB_ZONE_T && parentB.Type() === KICAD_T.PCB_ZONE_T) {
      this.checkZoneZoneConnection(this.m_item as CN_ZONE_LAYER, aCandidate as CN_ZONE_LAYER);
      return true;
    }

    if (parentA.Type() === KICAD_T.PCB_ZONE_T) {
      this.checkZoneItemConnection(aCandidate as CN_ZONE_LAYER, this.m_item);
      return true;
    }

    if (parentB.Type() === KICAD_T.PCB_ZONE_T) {
      this.checkZoneItemConnection(this.m_item as CN_ZONE_LAYER, aCandidate);
      return true;
    }

    let commonLayers = parentA.GetLayerSet().and(parentB.GetLayerSet());

    const board = parentA.GetBoard();
    if (board) commonLayers = commonLayers.and(board.GetEnabledLayers());

    for (const layer of commonLayers) {
      let flashingA = FLASHING.NEVER_FLASHED;
      let flashingB = FLASHING.NEVER_FLASHED;

      if (parentA.Type() === KICAD_T.PCB_PAD_T) {
        if (!(parentA as PAD).ConditionallyFlashed(layer)) flashingA = FLASHING.ALWAYS_FLASHED;
      } else if (parentA.Type() === KICAD_T.PCB_VIA_T) {
        if (!(parentA as PCB_VIA).ConditionallyFlashed(layer)) flashingA = FLASHING.ALWAYS_FLASHED;
      }

      if (parentB.Type() === KICAD_T.PCB_PAD_T) {
        if (!(parentB as PAD).ConditionallyFlashed(layer)) flashingB = FLASHING.ALWAYS_FLASHED;
      } else if (parentB.Type() === KICAD_T.PCB_VIA_T) {
        if (!(parentB as PCB_VIA).ConditionallyFlashed(layer)) flashingB = FLASHING.ALWAYS_FLASHED;
      }

      if (
        parentA
          .GetEffectiveShape(layer, flashingA)
          .Collide(parentB.GetEffectiveShape(layer, flashingB))
      ) {
        this.m_item.Connect(aCandidate);
        aCandidate.Connect(this.m_item);
        return true;
      }
    }

    return true;
  }

  protected checkZoneItemConnection(aZoneLayer: CN_ZONE_LAYER, aItem: CN_ITEM): void {
    const layer = aZoneLayer.GetLayer();
    const item = aItem.Parent();

    if (!item.IsOnLayer(layer)) return;

    const connect = (): void => {
      // We don't propagate nets from zones, so via-zone net changes are deferred
      // and applied only if the via has no higher-priority connections (tracks, pads).
      if (aItem.Parent().Type() === KICAD_T.PCB_VIA_T && aItem.CanChangeNet()) {
        this.m_deferredNetCodes.push([aItem, aZoneLayer.Net()]);
      }

      aZoneLayer.Connect(aItem);
      aItem.Connect(aZoneLayer);
    };

    // Try quick checks first...
    if (item.Type() === KICAD_T.PCB_PAD_T) {
      const pad = item as PAD;

      if (
        pad.ConditionallyFlashed(layer) &&
        pad.GetZoneLayerOverride(layer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION
      ) {
        return;
      }

      // Don't connect zones to pads on backdrilled or post-machined layers
      if (pad.IsBackdrilledOrPostMachined(layer)) return;
    } else if (item.Type() === KICAD_T.PCB_VIA_T) {
      const via = item as PCB_VIA;

      if (
        via.ConditionallyFlashed(layer) &&
        via.GetZoneLayerOverride(layer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION
      ) {
        return;
      }

      // Don't connect zones to vias on backdrilled or post-machined layers
      if (via.IsBackdrilledOrPostMachined(layer)) return;
    }

    for (let i = 0; i < aItem.AnchorCount(); ++i) {
      if (aZoneLayer.ContainsPoint(aItem.GetAnchor(i))) {
        connect();
        return;
      }
    }

    if (item.Type() === KICAD_T.PCB_VIA_T || item.Type() === KICAD_T.PCB_PAD_T) {
      // As long as the pad/via crosses the zone layer, check for the full effective shape
      // We check for the overlapping layers above
      if (aZoneLayer.Collide(item.GetEffectiveShape(layer, FLASHING.ALWAYS_FLASHED))) connect();

      return;
    }

    if (aZoneLayer.Collide(item.GetEffectiveShape(layer))) connect();
  }

  protected checkZoneZoneConnection(aZoneLayerA: CN_ZONE_LAYER, aZoneLayerB: CN_ZONE_LAYER): void {
    // CN_ZONE_LAYER now caches its own copy of the outline, so we just check if it's non-empty.
    if (!aZoneLayerA.HasValidOutline() || !aZoneLayerB.HasValidOutline()) return;

    const boxA = aZoneLayerA.BBox();
    const boxB = aZoneLayerB.BBox();

    const layer = aZoneLayerA.GetLayer();

    if (aZoneLayerB.GetLayer() !== layer) return;

    if (!boxA.Intersects(boxB)) return;

    const outlineA = aZoneLayerA.GetOutline();

    for (let i = 0; i < outlineA.PointCount(); i++) {
      const pt = outlineA.CPoint(i);

      if (!boxB.Contains(pt)) continue;

      if (aZoneLayerB.ContainsPoint(pt)) {
        aZoneLayerA.Connect(aZoneLayerB);
        aZoneLayerB.Connect(aZoneLayerA);
        return;
      }
    }

    const outlineB = aZoneLayerB.GetOutline();

    for (let i = 0; i < outlineB.PointCount(); i++) {
      const pt = outlineB.CPoint(i);

      if (!boxA.Contains(pt)) continue;

      if (aZoneLayerA.ContainsPoint(pt)) {
        aZoneLayerA.Connect(aZoneLayerB);
        aZoneLayerB.Connect(aZoneLayerA);
        return;
      }
    }
  }
}
