// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/zone_utils.h` / `.cpp`: two board-level zone algorithms that don't
 * belong to `ZONE` itself. `Edit_Zone_Params` and `BOARD::TestZoneIntersection`
 * (`edit_zone_helpers.cpp`) are the file's usual companion but are ported
 * separately — the former is a `PCB_EDIT_FRAME` dialog invocation with no
 * model logic of its own, the latter already lives on `board.ts` as
 * `BOARD.TestZoneIntersection`.
 *
 * Upstream farms the per-pair overlap analysis in `AutoAssignZonePriorities`
 * out to `GetKiCadThreadPool()`; there is no thread pool here; a browser tab
 * is one thread, so the loop just runs synchronously in the same order the
 * pairs were found. This is the same simplification the DRC and zone-fill
 * ports already make, and it doesn't change the result: the edges collected
 * are identical regardless of which order the futures resolve in, and the
 * downstream sort in `assignPrioritiesFromGraph` is itself order-independent
 * of that.
 */
import { LSET } from '@ziroeda/common/lset.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from './board.js';
import { PCB_VIA } from './pcb_track.js';
import type { ZONE } from './zone.js';

/** `RuleAreasHaveSameProps` (`zone_utils.cpp:42`, file-local). */
function ruleAreasHaveSameProps(a: ZONE, b: ZONE): boolean {
  return (
    a.GetDoNotAllowZoneFills() === b.GetDoNotAllowZoneFills() &&
    a.GetDoNotAllowFootprints() === b.GetDoNotAllowFootprints() &&
    a.GetDoNotAllowTracks() === b.GetDoNotAllowTracks() &&
    a.GetDoNotAllowVias() === b.GetDoNotAllowVias() &&
    a.GetDoNotAllowPads() === b.GetDoNotAllowPads()
  );
}

function polygonsAreMergeable(
  a: readonly SHAPE_LINE_CHAIN[],
  b: readonly SHAPE_LINE_CHAIN[],
): boolean {
  if (a.length !== b.length) return false;

  // NOTE: this assumes the polygons have their line chains in the same order,
  // but that is not actually required for same geometry (i.e. mergeability).
  for (let i = 0; i < a.length; i++) {
    const chainA = a[i]!;
    const chainB = b[i]!;

    // Note: this assumes the polygons are either already simplified or that it's
    // OK to not merge even if they would be the same after simplification.
    if (
      chainA.PointCount() !== chainB.PointCount() ||
      !chainA.BBox().equals(chainB.BBox()) ||
      !chainA.CompareGeometry(chainB)
    ) {
      // Different geometry, can't merge
      return false;
    }
  }

  return true;
}

function zonesAreMergeable(a: ZONE, b: ZONE): boolean {
  // Can't merge rule areas with zone fills
  if (a.GetIsRuleArea() !== b.GetIsRuleArea()) return false;

  if (a.GetIsRuleArea()) {
    if (!ruleAreasHaveSameProps(a, b)) return false;
  } else {
    // We could also check clearances and so on
    if (a.GetNetCode() !== b.GetNetCode()) return false;
  }

  const polySetA = a.Outline();
  const polySetB = b.Outline();

  if (polySetA.OutlineCount() !== polySetB.OutlineCount()) return false;

  if (polySetA.OutlineCount() === 0) {
    // both have no outline, so they are the same, but we must not
    // dereference them, as they are empty
    return true;
  }

  // REVIEW: this assumes the zones only have a single polygon
  const polyA = polySetA.CPolygon(0);
  const polyB = polySetB.CPolygon(0);

  return polygonsAreMergeable(polyA, polyB);
}

/**
 * Merges zones with identical outlines and nets on different layers into
 * single multi-layer zones. Ownership-transfer semantics of the C++ (takes
 * `unique_ptr`s, returns the ones kept) are irrelevant in JS; the input array
 * is not mutated in place, only read and re-packaged.
 *
 * @param aZones the zones to merge
 * @return the zones that survive: primaries, some carrying merged layers/fills
 */
export function MergeZonesWithSameOutline(aZones: readonly ZONE[]): ZONE[] {
  const deduplicatedZones: ZONE[] = [];

  // Map of zone indexes that we have already merged into a prior zone
  const merged = new Array<boolean>(aZones.length).fill(false);

  for (let i = 0; i < aZones.length; i++) {
    // This one has already been subsumed into a prior zone, so skip it
    // and it will be dropped at the end.
    if (merged[i]) continue;

    const primary = aZones[i]!;
    let layers = primary.GetLayerSet();
    const mergedFills = new Map<PCB_LAYER_ID, SHAPE_POLY_SET>();

    for (let j = i + 1; j < aZones.length; j++) {
      // This zone has already been subsumed by a prior zone, so it
      // cannot be merged into another primary
      if (merged[j]) continue;

      const candidate = aZones[j]!;
      const canMerge = zonesAreMergeable(primary, candidate);

      if (canMerge) {
        for (const layer of candidate.GetLayerSet()) {
          const fill = candidate.GetFill(layer as PCB_LAYER_ID);
          if (fill) mergedFills.set(layer as PCB_LAYER_ID, fill);
        }

        layers = layers.or(candidate.GetLayerSet());
        merged[j] = true;
      }
    }

    if (!layers.equals(primary.GetLayerSet())) {
      for (const layer of primary.GetLayerSet()) {
        const fill = primary.GetFill(layer as PCB_LAYER_ID);
        if (fill) mergedFills.set(layer as PCB_LAYER_ID, fill);
      }

      primary.SetLayerSet(layers);

      for (const [layer, fill] of mergedFills) primary.SetFilledPolysList(layer, fill);

      primary.SetNeedRefill(false);
      primary.SetIsFilled(true);
    }

    // Keep this zone - it's a primary (may or may not have had other zones merged into it)
    deduplicatedZones.push(primary);
  }

  return deduplicatedZones;
}

interface ZONE_OVERLAP_PAIR {
  zoneA: ZONE;
  zoneB: ZONE;
  sharedLayers: LSET;
}

interface ZONE_PRIORITY_EDGE {
  higher: ZONE;
  lower: ZONE;
  countDiff: number;
  fromArea: boolean;
}

/** `findOverlappingPairs` (`zone_utils.cpp:206`, file-local). */
function findOverlappingPairs(aBoard: BOARD): ZONE_OVERLAP_PAIR[] {
  const pairs: ZONE_OVERLAP_PAIR[] = [];
  const zones = aBoard.Zones();

  for (let i = 0; i < zones.length; i++) {
    const a = zones[i]!;

    if (a.GetIsRuleArea() || a.IsTeardropArea() || !a.IsOnCopperLayer()) continue;

    const bboxA = a.GetBoundingBox();

    for (let j = i + 1; j < zones.length; j++) {
      const b = zones[j]!;

      if (b.GetIsRuleArea() || b.IsTeardropArea() || !b.IsOnCopperLayer()) continue;

      let shared = a.GetLayerSet().and(b.GetLayerSet());
      shared = shared.and(LSET.AllCuMask());

      if (shared.none()) continue;

      if (!b.GetBoundingBox().Intersects(bboxA)) continue;

      const overlaps =
        a.Outline().Collide(b.Outline()) ||
        (b.Outline().TotalVertices() > 0 && a.Outline().Contains(b.Outline().CVertex(0))) ||
        (a.Outline().TotalVertices() > 0 && b.Outline().Contains(a.Outline().CVertex(0)));

      if (overlaps) pairs.push({ zoneA: a, zoneB: b, sharedLayers: shared });
    }
  }

  return pairs;
}

/** `computeConstraint` (`zone_utils.cpp:251`, file-local). */
function computeConstraint(aPair: ZONE_OVERLAP_PAIR, aBoard: BOARD): ZONE_PRIORITY_EDGE | null {
  const polyA = aPair.zoneA.Outline().CloneDropTriangulation();
  const polyB = aPair.zoneB.Outline().CloneDropTriangulation();
  polyA.ClearArcs();
  polyB.ClearArcs();

  const intersection = new SHAPE_POLY_SET();
  intersection.BooleanIntersection(polyA, polyB);

  if (intersection.IsEmpty()) return null;

  intersection.BuildBBoxCaches();

  const netCodeA = aPair.zoneA.GetNetCode();
  const netCodeB = aPair.zoneB.GetNetCode();

  const byArea = (): ZONE_PRIORITY_EDGE | null => {
    const areaA = aPair.zoneA.Outline().Area();
    const areaB = aPair.zoneB.Outline().Area();

    if (areaA === areaB) return null;

    const higher = areaA < areaB ? aPair.zoneA : aPair.zoneB;
    const lower = higher === aPair.zoneA ? aPair.zoneB : aPair.zoneA;
    return { higher, lower, countDiff: 0, fromArea: true };
  };

  // Same-net zones can't be differentiated by item counting since every
  // matching pad/via increments both counters equally.  Fall through to
  // area-based comparison directly.
  if (netCodeA === netCodeB) return byArea();

  let countA = 0;
  let countB = 0;

  const countIfInOverlap = (
    aPos: { x: number; y: number },
    aNetCode: number,
    aLayer: PCB_LAYER_ID,
  ): void => {
    if (!aPair.sharedLayers.test(aLayer)) return;

    if (intersection.Contains(aPos)) {
      if (aNetCode === netCodeA) countA++;
      else if (aNetCode === netCodeB) countB++;
    }
  };

  for (const fp of aBoard.Footprints()) {
    for (const pad of fp.Pads()) {
      for (const layer of aPair.sharedLayers.Seq()) {
        if (pad.IsOnLayer(layer)) {
          countIfInOverlap(pad.GetPosition(), pad.GetNetCode(), layer);
          break;
        }
      }
    }
  }

  for (const track of aBoard.Tracks()) {
    if (!(track instanceof PCB_VIA)) continue;

    for (const layer of aPair.sharedLayers.Seq()) {
      if (track.IsOnLayer(layer)) {
        countIfInOverlap(track.GetPosition(), track.GetNetCode(), layer);
        break;
      }
    }
  }

  if (countA === 0 && countB === 0) return byArea();

  const maxCount = Math.max(countA, countB);
  const diff = Math.abs(countA - countB);
  const ratio = diff / maxCount;

  const SIMILARITY_THRESHOLD = 0.2;

  if (ratio < SIMILARITY_THRESHOLD) {
    const areaA = aPair.zoneA.Outline().Area();
    const areaB = aPair.zoneB.Outline().Area();

    if (areaA === areaB) return null;

    const higher = areaA < areaB ? aPair.zoneA : aPair.zoneB;
    const lower = higher === aPair.zoneA ? aPair.zoneB : aPair.zoneA;
    return { higher, lower, countDiff: diff, fromArea: true };
  }

  const higher = countA > countB ? aPair.zoneA : aPair.zoneB;
  const lower = higher === aPair.zoneA ? aPair.zoneB : aPair.zoneA;
  return { higher, lower, countDiff: diff, fromArea: false };
}

/** `assignPrioritiesFromGraph` (`zone_utils.cpp:373`, file-local). */
function assignPrioritiesFromGraph(
  aEdges: readonly ZONE_PRIORITY_EDGE[],
  aAllZones: readonly ZONE[],
): void {
  const adj = new Map<ZONE, ZONE[]>();
  const inDegree = new Map<ZONE, number>();

  for (const z of aAllZones) {
    inDegree.set(z, 0);
  }

  // Sort edges so area-based (weakest) come first, then by ascending countDiff
  const sortedEdges = aEdges.slice().sort((a, b) => {
    if (a.fromArea !== b.fromArea) return a.fromArea ? -1 : 1;
    return a.countDiff - b.countDiff;
  });

  for (const edge of sortedEdges) {
    const list = adj.get(edge.higher);
    if (list) list.push(edge.lower);
    else adj.set(edge.higher, [edge.lower]);

    inDegree.set(edge.lower, (inDegree.get(edge.lower) ?? 0) + 1);
  }

  // Kahn's algorithm: sources (in-degree 0) have nothing constraining them to be lower,
  // so they are the highest-priority zones. Process them first.
  const byAssignedPriority = (a: ZONE, b: ZONE) =>
    a.GetAssignedPriority() - b.GetAssignedPriority();

  const queue: ZONE[] = [];

  for (const z of aAllZones) {
    if (inDegree.get(z) === 0) queue.push(z);
  }

  queue.sort(byAssignedPriority);

  const topoOrder: ZONE[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    topoOrder.push(current);

    const neighbors = adj.get(current) ?? [];
    neighbors.sort(byAssignedPriority);

    for (const neighbor of neighbors) {
      const nd = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, nd);

      if (nd === 0) queue.push(neighbor);
    }

    queue.sort(byAssignedPriority);
  }

  // Zones stuck in cycles get appended sorted by their current priority
  if (topoOrder.length < aAllZones.length) {
    const ordered = new Set(topoOrder);
    const remaining = aAllZones.filter((z) => !ordered.has(z));
    remaining.sort(byAssignedPriority);

    for (const z of remaining) topoOrder.push(z);
  }

  // topoOrder[0] is the highest-priority zone (source node). Assign descending values.
  for (let i = 0; i < topoOrder.length; i++) {
    topoOrder[i]!.SetAssignedPriority(topoOrder.length - 1 - i);
  }
}

/**
 * Automatically assign zone priorities based on connectivity analysis of
 * overlapping regions.
 *
 * For each pair of overlapping zones, counts pads and vias per-net in the
 * intersection area. The zone whose net has more items in the overlap gets
 * higher priority. When item counts are within 20% of the larger count, the
 * smaller zone gets higher priority.
 *
 * @param aBoard the board whose zone priorities will be reassigned
 * @param aReporter optional progress reporter (unused: nothing here reports
 *   progress yet; kept for signature parity with a future caller)
 * @return true if any priorities were changed
 */
export function AutoAssignZonePriorities(aBoard: BOARD, _aReporter?: PROGRESS_REPORTER): boolean {
  const eligibleZones = aBoard
    .Zones()
    .filter((zone) => !zone.GetIsRuleArea() && !zone.IsTeardropArea() && zone.IsOnCopperLayer());

  if (eligibleZones.length < 2) return false;

  const originalPriorities = new Map<ZONE, number>();
  for (const z of eligibleZones) originalPriorities.set(z, z.GetAssignedPriority());

  const pairs = findOverlappingPairs(aBoard);

  if (pairs.length === 0) return false;

  const edges: ZONE_PRIORITY_EDGE[] = [];

  for (const pair of pairs) {
    const result = computeConstraint(pair, aBoard);
    if (result) edges.push(result);
  }

  if (edges.length === 0) return false;

  assignPrioritiesFromGraph(edges, eligibleZones);

  for (const z of eligibleZones) {
    if (z.GetAssignedPriority() !== originalPriorities.get(z)) return true;
  }

  return false;
}
