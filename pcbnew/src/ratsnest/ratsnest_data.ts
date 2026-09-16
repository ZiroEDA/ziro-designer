// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/ratsnest/ratsnest_data.h` + `.cpp`: the ratsnest of one net — its
 * anchors, the Delaunay triangulation over them and the minimum spanning
 * tree that is the missing connections.
 *
 * `m_nodes` is a `std::multiset` ordered by CN_PTR_CMP (x, then y): a sorted
 * array here, equal keys kept in insertion order as the multiset keeps them.
 */
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import { SquaredEuclideanNorm, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { Delaunator, INVALID_INDEX } from '@ziroeda/kimath/src/thirdparty/delaunator.js';
import type { LSET } from '@ziroeda/common/src/lset.js';
import { CN_EDGE } from '../connectivity/connectivity_algo.js';
import {
  CN_ANCHOR,
  type CN_CLUSTER,
  type CN_ITEM,
  CN_ZONE_LAYER,
} from '../connectivity/connectivity_items.js';

/** `CN_PTR_CMP`: by x, then y. */
export function CN_PTR_CMP(aItem: CN_ANCHOR, bItem: CN_ANCHOR): boolean {
  if (aItem.Pos().x === bItem.Pos().x) return aItem.Pos().y < bItem.Pos().y;
  return aItem.Pos().x < bItem.Pos().x;
}

/** `std::multiset<std::shared_ptr<CN_ANCHOR>, CN_PTR_CMP>`. */
class ANCHOR_MULTISET {
  readonly items: CN_ANCHOR[] = [];

  /** `std::upper_bound`: the first element the key is less than. */
  upper_bound(aKey: CN_ANCHOR): number {
    let lo = 0;
    let hi = this.items.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (CN_PTR_CMP(aKey, this.items[mid]!)) hi = mid;
      else lo = mid + 1;
    }

    return lo;
  }

  /** `std::lower_bound`: the first element not less than the key. */
  lower_bound(aKey: CN_ANCHOR): number {
    let lo = 0;
    let hi = this.items.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (CN_PTR_CMP(this.items[mid]!, aKey)) lo = mid + 1;
      else hi = mid;
    }

    return lo;
  }

  insert(aItem: CN_ANCHOR): void {
    this.items.splice(this.upper_bound(aItem), 0, aItem);
  }

  clear(): void {
    this.items.length = 0;
  }

  get size(): number {
    return this.items.length;
  }

  [Symbol.iterator](): IterableIterator<CN_ANCHOR> {
    return this.items[Symbol.iterator]();
  }
}

class disjoint_set {
  private m_data: number[] = [];
  private m_depth: number[] = [];

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      this.m_data[i] = i;
      this.m_depth[i] = 0;
    }
  }

  find(aValIn: number): number {
    let aVal = aValIn;
    let root = aVal;

    while (this.m_data[root] !== root) root = this.m_data[root]!;

    // Compress the path
    while (this.m_data[aVal] !== aVal) {
      const tmp = this.m_data[aVal]!;
      this.m_data[aVal] = root;
      aVal = tmp;
    }

    return root;
  }

  unite(aVal1In: number, aVal2In: number): boolean {
    const aVal1 = this.find(aVal1In);
    const aVal2 = this.find(aVal2In);

    if (aVal1 !== aVal2) {
      if (this.m_depth[aVal1]! < this.m_depth[aVal2]!) {
        this.m_data[aVal1] = aVal2;
      } else {
        this.m_data[aVal2] = aVal1;

        if (this.m_depth[aVal1] === this.m_depth[aVal2])
          this.m_depth[aVal1] = this.m_depth[aVal1]! + 1;
      }

      return true;
    }

    return false;
  }
}

class TRIANGULATOR_STATE {
  private m_allNodes = new ANCHOR_MULTISET();

  // Checks if all nodes in aNodes lie on a single line. Requires the nodes to
  // have unique coordinates!
  private areNodesColinear(aNodes: readonly CN_ANCHOR[]): boolean {
    if (aNodes.length <= 2) return true;

    const p0 = aNodes[0]!.Pos();
    const v0 = sub(aNodes[1]!.Pos(), p0);

    for (let i = 2; i < aNodes.length; i++) {
      const v1 = sub(aNodes[i]!.Pos(), p0);

      // VECTOR2I::Cross is exact in int64
      if (BigInt(v0.x) * BigInt(v1.y) - BigInt(v0.y) * BigInt(v1.x) !== 0n) return false;
    }

    return true;
  }

  Clear(): void {
    this.m_allNodes.clear();
  }

  AddNode(aNode: CN_ANCHOR): void {
    this.m_allNodes.insert(aNode);
  }

  Triangulate(mstEdges: CN_EDGE[]): void {
    const node_pts: number[] = [];
    const anchors: CN_ANCHOR[] = [];
    const anchorChains: CN_ANCHOR[][] = [];

    for (let i = 0; i < this.m_allNodes.size; i++) anchorChains.push([]);

    const addEdge = (src: CN_ANCHOR, dst: CN_ANCHOR): void => {
      mstEdges.push(new CN_EDGE(src, dst, src.Dist(dst)));
    };

    let prev: CN_ANCHOR | null = null;

    for (const n of this.m_allNodes) {
      if (!prev || prev.Pos().x !== n.Pos().x || prev.Pos().y !== n.Pos().y) {
        node_pts.push(n.Pos().x);
        node_pts.push(n.Pos().y);
        anchors.push(n);
        prev = n;
      }

      anchorChains[anchors.length - 1]!.push(n);
    }

    if (anchors.length === 0) {
      return;
    }
    if (anchors.length === 1) {
      // The anchors all have the same position, but may not have overlapping layers.
      prev = null;

      for (const n of this.m_allNodes) {
        if (prev && !prev.Parent().GetLayerSet().and(n.Parent().GetLayerSet()).any()) {
          // Use a minimal but non-zero distance or the edge will be ignored
          mstEdges.push(new CN_EDGE(prev, n, 1));
        }

        prev = n;
      }

      return;
    }
    if (this.areNodesColinear(anchors)) {
      // special case: all nodes are on the same line - there's no
      // triangulation for such set. In this case, we sort along any coordinate
      // and chain the nodes together.
      for (let i = 0; i < anchors.length - 1; i++) addEdge(anchors[i]!, anchors[i + 1]!);
    } else {
      const delaunator = new Delaunator(node_pts);
      const triangles = delaunator.triangles;

      for (let i = 0; i < triangles.length; i += 3) {
        addEdge(anchors[triangles[i]!]!, anchors[triangles[i + 1]!]!);
        addEdge(anchors[triangles[i + 1]!]!, anchors[triangles[i + 2]!]!);
        addEdge(anchors[triangles[i + 2]!]!, anchors[triangles[i]!]!);
      }

      for (let i = 0; i < delaunator.halfedges.length; i++) {
        if (delaunator.halfedges[i] === INVALID_INDEX) continue;

        addEdge(anchors[triangles[i]!]!, anchors[triangles[delaunator.halfedges[i]!]!]!);
      }
    }

    for (let i = 0; i < anchorChains.length; i++) {
      const chain = anchorChains[i]!;

      if (chain.length < 2) continue;

      // std::sort by cluster pointer: an arbitrary but fixed order per run;
      // the clusters' creation order stands in for it.
      stdSort(chain, (a, b) => clusterOrder(a.GetCluster()) < clusterOrder(b.GetCluster()));

      for (let j = 1; j < chain.length; j++) {
        const prevNode = chain[j - 1]!;
        const curNode = chain[j]!;
        const weight = prevNode.GetCluster() !== curNode.GetCluster() ? 1 : 0;
        mstEdges.push(new CN_EDGE(prevNode, curNode, weight));
      }
    }
  }
}

const g_clusterOrder = new WeakMap<CN_CLUSTER, number>();
let g_nextClusterOrder = 1;

/** The "pointer" of a cluster: its first-seen order; null sorts first as nullptr does. */
function clusterOrder(aCluster: CN_CLUSTER | null): number {
  if (!aCluster) return 0;

  let n = g_clusterOrder.get(aCluster);

  if (n === undefined) {
    n = g_nextClusterOrder++;
    g_clusterOrder.set(aCluster, n);
  }

  return n;
}

export class RN_NET {
  ///< Vector of nodes
  protected m_nodes = new ANCHOR_MULTISET();

  ///< Vector of edges that make pre-defined connections
  protected m_boardEdges: CN_EDGE[] = [];

  ///< Vector of edges that makes ratsnest for a given net.
  protected m_rnEdges: CN_EDGE[] = [];

  ///< Flag indicating necessity of recalculation of ratsnest for a net.
  protected m_dirty = true;

  protected m_triangulator = new TRIANGULATOR_STATE();

  IsDirty(): boolean {
    return this.m_dirty;
  }

  ///< Compute the minimum spanning tree using Kruskal's algorithm
  protected kruskalMST(aEdges: readonly CN_EDGE[]): void {
    const dset = new disjoint_set(this.m_nodes.size);

    this.m_rnEdges.length = 0;

    let i = 0;

    for (const node of this.m_nodes) node.SetTag(i++);

    for (const tmp of aEdges) {
      const source = tmp.GetSourceNode();
      const target = tmp.GetTargetNode();

      if (!(source && !source.Dirty() && target && !target.Dirty())) continue;

      if (dset.unite(source.GetTag(), target.GetTag())) {
        if (tmp.GetWeight() > 0) this.m_rnEdges.push(tmp.clone()); // std::vector<CN_EDGE> holds copies
      }
    }
  }

  ///< Recompute ratsnest from scratch.
  protected compute(): void {
    // Special cases do not need complicated algorithms (actually, it does not work well with
    // the Delaunay triangulator)
    if (this.m_nodes.size <= 2) {
      this.m_rnEdges.length = 0;

      // Check if the only possible connection exists
      if (this.m_boardEdges.length === 0 && this.m_nodes.size === 2) {
        // There can be only one possible connection, but it is missing
        const source = this.m_nodes.items[0]!;
        const target = this.m_nodes.items[1]!;

        source.SetTag(0);
        target.SetTag(1);

        this.m_rnEdges.push(new CN_EDGE(source, target));
      } else {
        // Set tags to m_nodes as connected
        for (const node of this.m_nodes) node.SetTag(0);
      }

      return;
    }

    this.m_triangulator.Clear();

    for (const n of this.m_nodes) this.m_triangulator.AddNode(n);

    const triangEdges: CN_EDGE[] = [];

    this.m_triangulator.Triangulate(triangEdges);

    for (const e of this.m_boardEdges) triangEdges.push(e.clone());

    stdSort(triangEdges, (a, b) => a.lessThan(b));

    // Get the minimal spanning tree
    this.kruskalMST(triangEdges);
  }

  OptimizeRNEdges(): void {
    const optimizeZoneAnchor = (
      aPos: VECTOR2I,
      aLayerSet: LSET,
      aAnchor: CN_ANCHOR,
      setOptimizedTo: (a: CN_ANCHOR) => void,
    ): void => {
      let closest_dist_sq = SquaredEuclideanNorm(sub(aAnchor.Pos(), aPos));
      let closest_pt: VECTOR2I = { x: 0, y: 0 };
      let closest_item: CN_ITEM | null = null;

      for (const item of aAnchor.Item()!.ConnectedItems()) {
        // Don't consider shorted items
        if (aAnchor.Item()!.Net() !== item.Net()) continue;

        const zoneLayer = item instanceof CN_ZONE_LAYER ? item : null;

        if (zoneLayer && aLayerSet.test(zoneLayer.GetBoardLayer())) {
          const pts = zoneLayer.GetOutline().CPoints();

          for (const pt of pts) {
            const dist_sq = SquaredEuclideanNorm(sub(pt, aPos));

            if (dist_sq < closest_dist_sq) {
              closest_pt = pt;
              closest_item = zoneLayer;
              closest_dist_sq = dist_sq;
            }
          }
        }
      }

      if (closest_item) setOptimizedTo(new CN_ANCHOR(closest_pt, closest_item));
    };

    const optimizeZoneToZoneAnchors = (
      a: CN_ANCHOR,
      b: CN_ANCHOR,
      setOptimizedATo: (a: CN_ANCHOR) => void,
      setOptimizedBTo: (a: CN_ANCHOR) => void,
    ): void => {
      interface CENTER {
        pt: VECTOR2I;
        valid: boolean;
      }

      interface DIST_PAIR {
        dist_sq: number;
        idA: number;
        idB: number;
      }

      const connectedItemsA = a.Item()!.ConnectedItems();
      const connectedItemsB = b.Item()!.ConnectedItems();

      const centersA: CENTER[] = connectedItemsA.map(() => ({ pt: { x: 0, y: 0 }, valid: false }));
      const centersB: CENTER[] = connectedItemsB.map(() => ({ pt: { x: 0, y: 0 }, valid: false }));

      for (let i = 0; i < connectedItemsA.length; i++) {
        const itemA = connectedItemsA[i]!;
        const zoneLayerA = itemA instanceof CN_ZONE_LAYER ? itemA : null;

        if (!zoneLayerA) continue;

        const shapeA = zoneLayerA.GetOutline();
        centersA[i]!.pt = shapeA.BBox().GetCenter();
        centersA[i]!.valid = true;
      }

      for (let i = 0; i < connectedItemsB.length; i++) {
        const itemB = connectedItemsB[i]!;
        const zoneLayerB = itemB instanceof CN_ZONE_LAYER ? itemB : null;

        if (!zoneLayerB) continue;

        const shapeB = zoneLayerB.GetOutline();
        centersB[i]!.pt = shapeB.BBox().GetCenter();
        centersB[i]!.valid = true;
      }

      const pairsToTest: DIST_PAIR[] = [];

      for (let ia = 0; ia < centersA.length; ia++) {
        for (let ib = 0; ib < centersB.length; ib++) {
          const ca = centersA[ia]!;
          const cb = centersB[ib]!;

          if (!ca.valid || !cb.valid) continue;

          const dist_sq = SquaredEuclideanNorm(sub(cb.pt, ca.pt));

          pairsToTest.push({ dist_sq, idA: ia, idB: ib });
        }
      }

      stdSort(pairsToTest, (dp_a, dp_b) => dp_a.dist_sq < dp_b.dist_sq);

      const c_polyPairsLimit = 3;

      for (let i = 0; i < pairsToTest.length && i < c_polyPairsLimit; i++) {
        const pair = pairsToTest[i]!;
        const zoneLayerA = connectedItemsA[pair.idA] as CN_ZONE_LAYER;
        const zoneLayerB = connectedItemsB[pair.idB] as CN_ZONE_LAYER;

        if (zoneLayerA === zoneLayerB) continue;

        const shapeA = zoneLayerA.GetOutline();
        const shapeB = zoneLayerB.GetOutline();

        const ptA: VECTOR2I = { x: 0, y: 0 };
        const ptB: VECTOR2I = { x: 0, y: 0 };

        if (shapeA.ClosestSegmentsFast(shapeB, ptA, ptB)) {
          setOptimizedATo(new CN_ANCHOR(ptA, zoneLayerA));
          setOptimizedBTo(new CN_ANCHOR(ptB, zoneLayerB));
        }
      }
    };

    for (const edge of this.m_rnEdges) {
      const source = edge.GetSourceNode();
      const target = edge.GetTargetNode();

      if (!(source && !source.Dirty() && target && !target.Dirty())) continue;

      if (source.ConnectedItemsCount() === 0) {
        optimizeZoneAnchor(source.Pos(), source.Parent().GetLayerSet(), target, (optimized) => {
          edge.SetTargetNode(optimized);
        });
      } else if (target.ConnectedItemsCount() === 0) {
        optimizeZoneAnchor(target.Pos(), target.Parent().GetLayerSet(), source, (optimized) => {
          edge.SetSourceNode(optimized);
        });
      } else {
        optimizeZoneToZoneAnchors(
          source,
          target,
          (optimized) => {
            edge.SetSourceNode(optimized);
          },
          (optimized) => {
            edge.SetTargetNode(optimized);
          },
        );
      }
    }
  }

  UpdateNet(): void {
    this.compute();
    this.m_dirty = false;
  }

  RemoveInvalidRefs(): void {
    for (const edge of this.m_rnEdges) edge.RemoveInvalidRefs();

    for (const edge of this.m_boardEdges) edge.RemoveInvalidRefs();

    const is_invalid = (edge: CN_EDGE): boolean => !edge.GetSourceNode() || !edge.GetTargetNode();

    this.m_rnEdges = this.m_rnEdges.filter((e) => !is_invalid(e));
    this.m_boardEdges = this.m_boardEdges.filter((e) => !is_invalid(e));
  }

  Clear(): void {
    this.m_rnEdges.length = 0;
    this.m_boardEdges.length = 0;
    this.m_nodes.clear();

    this.m_dirty = true;
  }

  AddCluster(aCluster: CN_CLUSTER): void {
    let firstAnchor: CN_ANCHOR | null = null;

    for (const item of aCluster) {
      const anchors = item.Anchors();
      let nAnchors = item instanceof CN_ZONE_LAYER ? 1 : anchors.length;

      if (nAnchors > anchors.length) nAnchors = anchors.length;

      for (let i = 0; i < nAnchors; i++) {
        anchors[i]!.SetCluster(aCluster);
        this.m_nodes.insert(anchors[i]!);

        if (firstAnchor) {
          if (firstAnchor !== anchors[i])
            this.m_boardEdges.push(new CN_EDGE(firstAnchor, anchors[i]!, 0));
        } else {
          firstAnchor = anchors[i]!;
        }
      }
    }
  }

  GetNodeCount(): number {
    return this.m_nodes.size;
  }

  GetEdges(): CN_EDGE[] {
    // std::stable_sort by StableSortCompare
    this.m_rnEdges.sort((a, b) => (a.StableSortCompare(b) ? -1 : b.StableSortCompare(a) ? 1 : 0));
    return this.m_rnEdges;
  }

  NearestBicoloredPair(aOtherNet: RN_NET, aPos: { pos1: VECTOR2I; pos2: VECTOR2I }): boolean {
    let rv = false;

    let distMax_sq = Number.MAX_SAFE_INTEGER; // VECTOR2I::ECOORD_MAX

    const verify = (aTestNode1: CN_ANCHOR, aTestNode2: CN_ANCHOR): void => {
      const diff = sub(aTestNode1.Pos(), aTestNode2.Pos());
      const dist_sq = SquaredEuclideanNorm(diff);

      if (dist_sq < distMax_sq) {
        rv = true;
        distMax_sq = dist_sq;
        aPos.pos1 = aTestNode1.Pos();
        aPos.pos2 = aTestNode2.Pos();
      }
    };

    /// Sweep-line algorithm to cut the number of comparisons to find the closest point
    ///
    /// Step 1: The outer loop needs to be the subset (selected nodes) as it is a linear search
    for (const nodeA of aOtherNet.m_nodes) {
      if (nodeA.GetNoLine()) continue;

      /// Step 2: O( log n ) search to identify a close element ordered by x
      /// The fwd_it iterator will move forward through the elements while
      /// the rev_it iterator will move backward through the same set
      const start = this.m_nodes.lower_bound(nodeA);
      const items = this.m_nodes.items;

      for (let fwd_it = start; fwd_it < items.length; ++fwd_it) {
        const nodeB = items[fwd_it]!;

        if (nodeB.GetNoLine()) continue;

        const dx = nodeA.Pos().x - nodeB.Pos().x;
        const distX_sq = dx * dx;

        /// As soon as the x distance (primary sort) is larger than the smallest distance,
        /// stop checking further elements
        if (distX_sq > distMax_sq) break;

        verify(nodeA, nodeB);
      }

      /// Step 3: using the same starting point, check points backwards for closer points
      for (let rev_it = start - 1; rev_it >= 0; --rev_it) {
        const nodeB = items[rev_it]!;

        if (nodeB.GetNoLine()) continue;

        const dx = nodeA.Pos().x - nodeB.Pos().x;
        const distX_sq = dx * dx;

        if (distX_sq > distMax_sq) break;

        verify(nodeA, nodeB);
      }
    }

    return rv;
  }
}
