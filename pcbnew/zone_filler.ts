// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pouring copper zones. Counterpart: `pcbnew/zone_filler.cpp` (ZONE_FILLER),
 * whose shape this follows:
 *
 *   fill = smoothed outline
 *        - thermal reliefs around same-net pads
 *        - clearance around every other net's copper, and every hole
 *        + thermal spokes back to those same-net pads
 *   then islands that reach nothing on the net are dropped.
 *
 * The pour reaches every board in `qa/data/zone_fill/` vertex for vertex
 * against `kicad-cli pcb drc --refill-zones` - the min-thickness prune, the
 * outline smoothing, the hatch pattern, the custom-pad spoke templates and the
 * via thermals are all here, through the Clipper2 port in
 * `libs/kimath/src/clipper2`. (This header used to list all of those as
 * missing; they were added and it was not.)
 *
 * What is NOT yet KiCad's is the object it works on. Everything below
 * `ZONE_FILLER` reads the plain-object `Board` view rather than the BOARD,
 * which is #636 stage 4; the class at the top is that port, method by method.
 */

import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { type Vertex, VertexSet } from '@ziroeda/kimath/src/geometry/vertex_set.js';
import { EuclideanNormI, Perpendicular, ResizeI } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { segmentsForRadius } from './convert_basic_shapes_to_polygon.js';

export { segmentsForRadius };
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';
import { DRC_ENGINE } from './drc/drc_engine.js';
import { DRC_CONSTRAINT_T } from './drc/drc_rule.js';
import { ZONE_CONNECTION } from './zones.js';
import type { ZONE } from './zone.js';
import type { COMMIT } from '@ziroeda/common/commit.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { HASH_128 } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import type { PCB_VIA } from './pcb_track.js';
import { ZONE_LAYER_OVERRIDE } from './board_item.js';
import { UNCONNECTED_LAYER_MODE } from './padstack.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { FLASHING, IsInnerCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { VECTOR2I, add, sub } from '@ziroeda/kimath/src/math/vector2.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import {
  CornerStrategy as CORNER_STRATEGY,
  SHAPE_POLY_SET,
  TransformCircleToPolygon,
  TransformRingToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  type INTERSECTIONS,
  SHAPE_LINE_CHAIN,
} from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { ANGLE_0, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { buildConvexHullOfPolySet } from '@ziroeda/kimath/src/geometry/convex_hull.js';
import { POLY_CONTAINMENT_INDEX } from '@ziroeda/kimath/src/geometry/poly_containment_index.js';
import {
  CUSTOM_SHAPE_ZONE_MODE,
  PAD_ATTRIB,
  PAD_DRILL_POST_MACHINING_MODE,
  PAD_SHAPE,
} from './padstack.js';
import { ISLAND_REMOVAL_MODE, ZONE_FILL_MODE, ZONE_SETTINGS } from './zone_settings.js';
import { ISOLATED_ISLANDS } from './zone.js';
import type { DRC_CONSTRAINT } from './drc/drc_rule.js';
import type { FOOTPRINT } from './footprint.js';
import type { PAD } from './pad.js';
import type { PCB_BARCODE } from './pcb_barcode.js';
import type { PCB_DIMENSION_BASE } from './pcb_dimension.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import { PCB_TEXT } from './pcb_text.js';
import type { PCB_TRACK } from './pcb_track.js';

// ---------------------------------------------------------------------------
// zone_filler.cpp's file-level helpers (cpp:69-380).

/**
 * `PAD_KNOCKOUT_KEY` (cpp:270-296): coincident pads of one net share a
 * knockout. For circular pads the size is the larger of drill and pad.
 */
function padKnockoutKey(aPad: PAD, aLayer: PCB_LAYER_ID): string | null {
  // Deduplicate coincident pads (skip custom pads - they have complex shapes)
  const padShapeType = aPad.GetShape(aLayer);

  if (padShapeType === PAD_SHAPE.CUSTOM) return null;

  // For circular pads: use max of drill and pad size; otherwise just pad size
  const padSize = aPad.GetSize(aLayer);
  let effectiveSize: VECTOR2I;

  if (padShapeType === PAD_SHAPE.CIRCLE) {
    const drill = Math.max(aPad.GetDrillSize().x, aPad.GetDrillSize().y);
    const maxDim = Math.max(padSize.x, padSize.y, drill);
    effectiveSize = { x: maxDim, y: maxDim };
  } else {
    effectiveSize = padSize;
  }

  const pos = aPad.GetPosition();

  return [
    pos.x,
    pos.y,
    effectiveSize.x,
    effectiveSize.y,
    padShapeType,
    aPad.GetOrientation().AsDegrees(),
    aPad.GetNetCode(),
  ].join(',');
}

/** `VIA_KNOCKOUT_KEY` (cpp:298-321). */
function viaKnockoutKey(aVia: PCB_VIA, aLayer: PCB_LAYER_ID): string {
  const pos = aVia.GetPosition();
  const viaEffectiveSize = Math.max(aVia.GetDrillValue(), aVia.GetWidth(aLayer));

  return [pos.x, pos.y, viaEffectiveSize, aVia.GetNetCode()].join(',');
}

/** `TRACK_KNOCKOUT_KEY` (cpp:323-358): endpoints canonicalised so start < end. */
function trackKnockoutKey(aStart: VECTOR2I, aEnd: VECTOR2I, aWidth: number): string {
  let start = aStart;
  let end = aEnd;

  // Canonicalize endpoint order for consistent hashing
  if (!(aStart.x < aEnd.x || (aStart.x === aEnd.x && aStart.y <= aEnd.y))) {
    start = aEnd;
    end = aStart;
  }

  return [start.x, start.y, end.x, end.y, aWidth].join(',');
}

/** `forEachBoardAndFootprintZone` (cpp:360-371). */
function forEachBoardAndFootprintZone(aBoard: BOARD, aFunc: (aZone: ZONE) => void): void {
  for (const zone of aBoard.Zones()) aFunc(zone);

  for (const footprint of aBoard.Footprints()) {
    for (const zone of footprint.Zones()) aFunc(zone);
  }
}

/** `isZoneFillKeepout` (cpp:373-380). */
function isZoneFillKeepout(aZone: ZONE, aLayer: PCB_LAYER_ID, aBBox: BOX2I): boolean {
  return (
    aZone.GetIsRuleArea() &&
    aZone.HasKeepoutParametersSet() &&
    aZone.GetDoNotAllowZoneFills() &&
    aZone.IsOnLayer(aLayer) &&
    aZone.GetBoundingBox().Intersects(aBBox)
  );
}

/** `appendZoneOutlineWithoutArcs` (cpp:382-393). */
function appendZoneOutlineWithoutArcs(aZone: ZONE, aPolys: SHAPE_POLY_SET): void {
  if (aZone.Outline().ArcCount() === 0) {
    aPolys.Append(aZone.Outline());
    return;
  }

  const outline = aZone.Outline().Clone() as SHAPE_POLY_SET;
  outline.ClearArcs();
  aPolys.Append(outline);
}

/**
 * The min-thickness island test (cpp:3058-3073, :2779-2793): drop every outline
 * whose first ring never spans more than `aMinThickness` on either axis.
 */
function dropThinIslands(aFillPolys: SHAPE_POLY_SET, aMinThickness: number): void {
  for (let ii = aFillPolys.OutlineCount() - 1; ii >= 0; ii--) {
    const island = aFillPolys.Polygon(ii);
    const islandExtents = new BOX2I();

    for (const pt of island[0]!.CPoints()) {
      islandExtents.Merge(pt);

      if (islandExtents.GetSizeMax() > aMinThickness) break;
    }

    if (islandExtents.GetSizeMax() < aMinThickness) aFillPolys.DeletePolygon(ii);
  }
}

/**
 * `dropSubResolutionOutlines` (cpp:2745-2756): subtracting a neighbouring
 * zone's fill along an edge the two share sheds sub-micron contours that
 * survive Fracture() and are then counted as islands.
 */
function dropSubResolutionOutlines(aPolys: SHAPE_POLY_SET, aMaxError: number): void {
  const noiseArea = aMaxError * aMaxError;

  for (let ii = aPolys.OutlineCount() - 1; ii >= 0; ii--) {
    if (aPolys.Outline(ii).Area() < noiseArea) aPolys.DeletePolygon(ii);
  }
}

/** `std::map<std::pair<const ZONE*, PCB_LAYER_ID>, SHAPE_POLY_SET>`, keyed in two maps. */
function zoneLayerCacheSet(
  aCache: Map<ZONE, Map<PCB_LAYER_ID, SHAPE_POLY_SET>>,
  aZone: ZONE,
  aLayer: PCB_LAYER_ID,
  aPolys: SHAPE_POLY_SET,
): void {
  let perLayer = aCache.get(aZone);

  if (!perLayer) {
    perLayer = new Map();
    aCache.set(aZone, perLayer);
  }

  perLayer.set(aLayer, aPolys);
}

/** `std::pair<ZONE*, PCB_LAYER_ID>`, a zone-layer to fill. */
type FillItem = [ZONE, PCB_LAYER_ID];

/** `ZONE_FILLER::FillSnapshot`: zone fills captured before an iterative refill wave. */
type FillSnapshot = Map<ZONE, Map<PCB_LAYER_ID, SHAPE_POLY_SET>>;

/** A zone-layer's key for the sets below. KIIDs are unique on a board. */
const fillItemKey = ([aZone, aLayer]: FillItem): string => `${aZone.m_Uuid}:${aLayer}`;

/**
 * `std::set<std::pair<ZONE*, PCB_LAYER_ID>>`. Upstream's iterates in pointer
 * order, which nothing it feeds depends on; this one iterates in insertion
 * order. `add` returns `insert(...).second`.
 */
class FillItemSet {
  private m_items = new Map<string, FillItem>();

  constructor(aItems: Iterable<FillItem> = []) {
    for (const item of aItems) this.add(item);
  }

  get size(): number {
    return this.m_items.size;
  }

  add(aItem: FillItem): boolean {
    const key = fillItemKey(aItem);

    if (this.m_items.has(key)) return false;

    this.m_items.set(key, aItem);
    return true;
  }

  has(aItem: FillItem): boolean {
    return this.m_items.has(fillItemKey(aItem));
  }

  values(): IterableIterator<FillItem> {
    return this.m_items.values();
  }
}

/**
 * `run_fill_waves` (cpp:836-924): walk the dependency DAG, releasing an
 * item's successors the instant its fill publishes.
 *
 * Upstream runs it on a thread pool, so the order items run in varies. It
 * does not matter: a fill reads another zone's fill only where
 * `zoneKnockoutMayInteract` says it may (the knockouts and the refill both
 * gate on it), and that is exactly the edge `zone_fill_dependency` puts in the
 * DAG - "Must be the same gate the knockout reads use, or the read races the
 * writer". Every zone a fill reads has published before it runs, in any
 * topological order, so a queue is KiCad's answer.
 */
function runFillWaves(
  aFillItems: readonly FillItem[],
  aFillFn: (aItem: FillItem) => number,
  aTessFn: (aItem: FillItem) => number,
  aHasDependency: (aWaiter: FillItem, aDependency: FillItem) => boolean,
  aAnyDependencies: boolean,
): void {
  const count = aFillItems.length;

  if (count === 0) return;

  const successors: number[][] = aFillItems.map(() => []);
  const inDegree: number[] = aFillItems.map(() => 0);

  // Skip the O(N²) dependency scan when the caller guarantees no deps.
  if (aAnyDependencies) {
    for (let i = 0; i < count; ++i) {
      for (let j = 0; j < count; ++j) {
        if (i === j) continue;

        if (aHasDependency(aFillItems[j]!, aFillItems[i]!)) {
          successors[i]!.push(j);
          inDegree[j]!++;
        }
      }
    }
  }

  const queue: number[] = [];

  // Seed the pool with every dependency-free item.
  for (let i = 0; i < count; ++i) {
    if (inDegree[i] === 0) queue.push(i);
  }

  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]!;
    const filled = aFillFn(aFillItems[idx]!);

    // Release dependents; their fills read this one's now-published result.
    for (const succ of successors[idx]!) {
      if (--inDegree[succ]! === 0) queue.push(succ);
    }

    if (filled !== 0) aTessFn(aFillItems[idx]!);
  }
}

/** `std::clamp( v, lo, hi )`. */
const stdClamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : hi < v ? hi : v);

/**
 * `ZONE_FILLER` (`pcbnew/zone_filler.cpp`), on KiCad's own BOARD: the pour,
 * method for method, reading its clearances and thermal rules from the
 * board's DRC engine and writing each fill through `ZONE::SetFilledPolysList`.
 *
 * `Fill()`'s prologue also settles the per-layer flashing overrides
 * (`ZLO_FORCE_FLASHED` / `ZLO_FORCE_NO_ZONE_CONNECTION`) before the first pour,
 * deterministically, for the reason upstream gives (issue 12964: the answer
 * must not depend on the order zones happen to be poured in), and re-checks
 * them against the actual fills after the last (issue 22010).
 */
export class ZONE_FILLER {
  private m_board: BOARD;
  private m_commit: COMMIT | null;
  private m_progressReporter: PROGRESS_REPORTER | null = null;

  // ----- the live pour's members (zone_filler.h:200-230) -----------------

  private m_boardOutline = new SHAPE_POLY_SET(); // the board outlines, if exists
  private m_brdOutlinesValid = false; // true if m_boardOutline is well-formed
  private m_maxError: number;
  private m_worstClearance = 0;
  private m_zoneKnockoutSlack: number;
  private m_debugZoneFiller: boolean;

  /** `m_preKnockoutFillCache`: each zone-layer's fill before zone knockouts. */
  private m_preKnockoutFillCache = new Map<ZONE, Map<PCB_LAYER_ID, SHAPE_POLY_SET>>();

  constructor(aBoard: BOARD, aCommit: COMMIT | null = null) {
    this.m_board = aBoard;
    this.m_commit = aCommit;
    this.m_maxError = aBoard.GetDesignSettings().m_MaxError;
    this.m_zoneKnockoutSlack =
      pcbIUScale.mmToIU(ADVANCED_CFG.GetCfg().m_ExtraClearance) + this.m_maxError;

    // To enable add "DebugZoneFiller=1" to kicad_advanced settings file.
    this.m_debugZoneFiller = ADVANCED_CFG.GetCfg().m_DebugZoneFiller;
  }

  IsDebug(): boolean {
    return this.m_debugZoneFiller;
  }

  SetProgressReporter(aReporter: PROGRESS_REPORTER | null): void {
    this.m_progressReporter = aReporter;
  }

  GetProgressReporter(): PROGRESS_REPORTER | null {
    return this.m_progressReporter;
  }

  /**
   * `ZONE_FILLER::Fill( aZones, true, aParent )`, the check mode
   * (zone_filler.cpp:1606-1658): pour, then compare every zone-layer's fill
   * hash with the one it had. Unchanged: false, and nothing is committed. Out
   * of date: ask "Zone fills are out-of-date. Refill?" and keep the new fill
   * on Refill. Upstream's modal blocks inside Fill; ours is awaited, so the
   * check is its own method and the plain Fill stays synchronous for DRC.
   */
  async CheckFill(
    aZones: readonly ZONE[],
    aAsk: (aRequest: KiDialogRequest) => Promise<KiDialogResult>,
  ): Promise<boolean> {
    const oldFillHashes = new Map<ZONE, Map<PCB_LAYER_ID, HASH_128>>();

    for (const zone of aZones) {
      const hashes = new Map<PCB_LAYER_ID, HASH_128>();

      // calculate the hash value for filled areas. it will be used later to know if the
      // current filled areas are up to date (zone_filler.cpp:729-734)
      for (const layer of zone.GetLayerSet().Seq()) {
        zone.BuildHashValue(layer);
        hashes.set(layer, zone.GetHashValue(layer));
      }

      oldFillHashes.set(zone, hashes);
    }

    if (!this.Fill(aZones)) return false;

    let outOfDate = false;

    for (const zone of aZones) {
      // Keepout zones are not filled
      if (zone.GetIsRuleArea()) continue;

      for (const layer of zone.GetLayerSet().Seq()) {
        zone.BuildHashValue(layer);

        if (oldFillHashes.get(zone)?.get(layer) !== zone.GetHashValue(layer)) outOfDate = true;
      }
    }

    const localSettings = this.m_board.GetProject()?.GetLocalSettings();

    if (localSettings?.m_PrototypeZoneFill) {
      const answer = await aAsk({
        caption: 'Confirmation',
        message: 'Prototype zone fill enabled. Disable setting and refill?',
        icon: 'warning',
        labels: { ok: 'Disable and refill', cancel: 'Continue without Refill' },
        doNotShowKey: 'pcbnew/zone_filler.cpp:Fill:prototype',
      });

      if (answer === 'ok') localSettings.m_PrototypeZoneFill = false;
      else if (!outOfDate) return false;
    }

    if (outOfDate) {
      const answer = await aAsk({
        caption: 'Confirmation',
        message: 'Zone fills are out-of-date. Refill?',
        icon: 'warning',
        labels: { ok: 'Refill', cancel: 'Continue without Refill' },
        doNotShowKey: 'pcbnew/zone_filler.cpp:Fill:outOfDate',
      });

      if (answer === 'cancel') return false;
    } else {
      // No need to commit something that hasn't changed (and committing will set
      // the modified flag).
      return false;
    }

    return true;
  }

  /**
   * `ZONE_FILLER::Fill( aZones )` (cpp:446-1647): pour `aZones`, recording
   * each in the commit first so the fill is one undo step. Returns false when
   * the user cancelled. The out-of-date check (`aCheck`) is `CheckFill`.
   *
   * NB: Invalidates connectivity; the caller rebuilds it afterwards.
   */
  Fill(aZones: readonly ZONE[]): boolean {
    const board = this.m_board;

    // Keyed on knockout geometry only; valid for this fill's passes (pre-knockout fill is
    // rebuilt below).
    this.m_refillResultCache.clear();
    this.m_preHatchSolidFillCache.clear();
    this.m_sameNetApronCache.clear();
    this.m_preKnockoutFillCache.clear();

    this.ensureDrcEngine();

    const toFill: FillItem[] = [];
    const isolatedIslandsMap = new Map<ZONE, Map<PCB_LAYER_ID, ISOLATED_ISLANDS>>();

    const connectivity = board.GetConnectivity();

    // Rebuild (from scratch, ignoring dirty flags) just in case. This really needs to be reliable.
    connectivity.ClearRatsnest();
    connectivity.Build(board, this.m_progressReporter);

    this.m_worstClearance = board.GetMaxClearanceValue();

    if (this.m_progressReporter) {
      this.m_progressReporter.Report('Building zone fills...');
      this.m_progressReporter.SetMaxProgress(aZones.length);
      this.m_progressReporter.KeepRefreshing();
    }

    // The board outlines is used to clip solid areas inside the board (when outlines are valid)
    this.m_boardOutline.RemoveAllContours();
    this.m_brdOutlinesValid = board.GetBoardPolygonOutlines(this.m_boardOutline, true);

    this.PrepareBoardForFill();

    const boardCuMask = LSET.AllCuMask(board.GetCopperLayerCount());

    for (const zone of aZones) {
      // Rule areas are not filled
      if (zone.GetIsRuleArea()) continue;

      // Degenerate zones will cause trouble; skip them
      if (zone.GetNumCorners() <= 2) continue;

      this.m_commit?.Modify(zone);

      const islands = new Map<PCB_LAYER_ID, ISOLATED_ISLANDS>();

      for (const layer of zone.GetLayerSet().Seq()) {
        // Add the zone to the list of zones to test or refill
        toFill.push([zone, layer]);

        islands.set(layer, new ISOLATED_ISLANDS());
      }

      isolatedIslandsMap.set(zone, islands);

      // Remove existing fill first to prevent drawing invalid polygons on some platforms
      zone.UnFill();
    }

    const zone_fill_dependency = (
      aZone: ZONE,
      aLayer: PCB_LAYER_ID,
      aOtherZone: ZONE,
      aRequireCompletedOtherFill: boolean,
    ): boolean => {
      // Check to see if we have to knock-out the filled areas of a higher-priority
      // zone.  If so we have to wait until said zone is filled before we can fill.

      // If the other zone is already filled on the requested layer then we're
      // good-to-go
      if (aRequireCompletedOtherFill && aOtherZone.GetFillFlag(aLayer)) return false;

      // Even if keepouts exclude copper pours, the exclusion is by outline rather than
      // filled area, so we're good-to-go here too
      if (aOtherZone.GetIsRuleArea()) return false;

      // If the other zone is never going to be filled then don't wait for it
      if (aOtherZone.GetNumCorners() <= 2) return false;

      // If the zones share no common layers
      if (!aOtherZone.GetLayerSet().Contains(aLayer)) return false;

      if (aZone.HigherPriority(aOtherZone)) return false;

      // Same-net zones always use outlines to produce determinate results
      if (aOtherZone.SameNet(aZone)) return false;

      // Must be the same gate the knockout reads use, or the read races the writer.
      return this.zoneKnockoutMayInteract(aZone, aOtherZone);
    };

    const fill_item_dependency = (aWaiter: FillItem, aDependency: FillItem): boolean => {
      if (aWaiter[0] === aDependency[0] || aWaiter[1] !== aDependency[1]) return false;

      return zone_fill_dependency(aWaiter[0], aWaiter[1], aDependency[0], true);
    };

    const fill_lambda = ([zone, layer]: FillItem): number => {
      if (this.m_progressReporter?.IsCancelled()) return 0;

      const fillPolys = new SHAPE_POLY_SET();

      if (!this.fillSingleZone(zone, layer, fillPolys)) return 0;

      zone.SetFilledPolysList(layer, fillPolys);

      this.m_progressReporter?.AdvanceProgress();

      return 1;
    };

    const tesselate_lambda = ([zone, layer]: FillItem): number => {
      if (this.m_progressReporter?.IsCancelled()) return 0;

      zone.CacheTriangulation(layer);
      zone.SetFillFlag(layer, true);

      return 1;
    };

    runFillWaves(toFill, fill_lambda, tesselate_lambda, fill_item_dependency, true);

    // Now update the connectivity to check for isolated copper islands
    if (this.m_progressReporter) {
      if (this.m_progressReporter.IsCancelled()) return false;

      this.m_progressReporter.AdvancePhase();
      this.m_progressReporter.Report('Removing isolated copper islands...');
      this.m_progressReporter.KeepRefreshing();
    }

    connectivity.SetProgressReporter(this.m_progressReporter);
    connectivity.FillIsolatedIslandsMap(isolatedIslandsMap);
    connectivity.SetProgressReporter(null);

    if (this.m_progressReporter?.IsCancelled()) return false;

    for (const zone of aZones) {
      // Keepout zones are not filled
      if (zone.GetIsRuleArea()) continue;

      zone.SetIsFilled(true);
    }

    // Now remove isolated copper islands according to the isolated islands strategy assigned
    // by the user (always, never, below-certain-size).
    //
    // Track zone-layer pairs that had islands removed for potential iterative refill.
    const zonesWithRemovedIslandLayers = new FillItemSet();

    // Per-layer tracking: a zone-layer pair is "initially fully isolated" when every fill
    // outline on that layer was an island in the initial pass (i.e. the zone has no pad
    // connectivity on that layer).  Used in the iterative loop to distinguish legitimately
    // unconnected pours — which must be preserved — from zones that became fully isolated
    // only because other fills changed.
    const initiallyFullyIsolatedLayers = new FillItemSet();

    for (const [zone, zoneIslands] of isolatedIslandsMap) {
      // Track per-layer isolation, and skip island removal on layers where every
      // outline is an island (unconnected pour — must be preserved as-is).
      let allLayersFullyIsolated = true;

      for (const [layer, layerIslands] of zoneIslands) {
        const layerFullyIsolated =
          layerIslands.m_IsolatedOutlines.length === zone.GetFilledPolysList(layer).OutlineCount();

        if (layerFullyIsolated) initiallyFullyIsolatedLayers.add([zone, layer]);
        else allLayersFullyIsolated = false;
      }

      if (allLayersFullyIsolated) continue;

      for (const [layer, layerIslands] of zoneIslands) {
        if (this.m_debugZoneFiller && LSET.InternalCuMask().Contains(layer)) continue;

        if (layerIslands.m_IsolatedOutlines.length === 0) continue;

        if (this.removeIslands(zone, layer, layerIslands))
          zonesWithRemovedIslandLayers.add([zone, layer]);

        if (this.m_progressReporter?.IsCancelled()) return false;
      }
    }

    // Iterative refill: when islands are removed, overlapping zones may be able to reclaim
    // the freed space.  Repeat until fills stabilise (convergence), up to a safety limit.
    //
    // Each wave captures a snapshot of all zone fills before running.  Every task in the wave
    // reads knockouts from the snapshot rather than from the live zone objects.
    const iterativeRefill = ADVANCED_CFG.GetCfg().m_ZoneFillIterativeRefill;

    // The initial fill subtracts a higher-priority same-net zone's outline, but
    // refillZoneFromCache() subtracts its actual fill; seed the refill with overlapping
    // lower zones so they reclaim any notch the higher zone left unfilled (issue 23790).
    const sameNetOverlapSeeds = new FillItemSet();

    if (iterativeRefill) {
      const boardCu = LSET.AllCuMask(board.GetCopperLayerCount());

      // Bucket by net so each lower zone scans only its own net.
      const zonesByNet = new Map<number, ZONE[]>();

      forEachBoardAndFootprintZone(board, (zone: ZONE) => {
        if (zone.GetIsRuleArea() || zone.IsTeardropArea()) return;

        let bucket = zonesByNet.get(zone.GetNetCode());

        if (!bucket) {
          bucket = [];
          zonesByNet.set(zone.GetNetCode(), bucket);
        }

        bucket.push(zone);
      });

      for (const lowerZone of aZones) {
        if (lowerZone.GetIsRuleArea() || lowerZone.IsTeardropArea()) continue;

        const sameNet = zonesByNet.get(lowerZone.GetNetCode());

        if (!sameNet) continue;

        const lowerLayers = lowerZone.GetLayerSet().and(boardCu);

        for (const higherZone of sameNet) {
          if (
            higherZone === lowerZone ||
            higherZone.GetAssignedPriority() <= lowerZone.GetAssignedPriority()
          )
            continue;

          if (!lowerZone.GetBoundingBox().Intersects(higherZone.GetBoundingBox())) continue;

          const sharedLayers = lowerLayers.and(higherZone.GetLayerSet());

          for (const layer of sharedLayers.Seq()) {
            // Without a higher-zone fill in the snapshot the lower zone would pour
            // through the higher zone's outline.
            if (
              lowerZone.HasFilledPolysForLayer(layer) &&
              higherZone.HasFilledPolysForLayer(layer)
            ) {
              sameNetOverlapSeeds.add([lowerZone, layer]);
            }
          }
        }
      }
    }

    if (
      iterativeRefill &&
      (zonesWithRemovedIslandLayers.size > 0 || sameNetOverlapSeeds.size > 0)
    ) {
      const maxIterations = 8;
      let progressReported = false;
      let hitIterationLimit = false;

      // Seed: island-removal changes plus same-net overlap reclaims (see above).
      let changedZoneLayers = new FillItemSet([
        ...zonesWithRemovedIslandLayers.values(),
        ...sameNetOverlapSeeds.values(),
      ]);

      const cached_refill_tessellate_lambda = ([zone, layer]: FillItem): number => {
        zone.CacheTriangulation(layer);
        zone.SetFillFlag(layer, true);
        return 1;
      };

      for (let iteration = 0; iteration < maxIterations; ++iteration) {
        // Candidate selection: only re-refill (zone, layer) pairs where `layer` is the
        // same layer that changed on some seed zone and whose bbox touches it.
        const zonesToRefill: FillItem[] = [];
        const zonesToRefillSet = new FillItemSet();

        for (const [changedZone, changedLayer] of changedZoneLayers.values()) {
          const bbox = changedZone.GetBoundingBox().Clone();
          bbox.Inflate(this.m_worstClearance);

          for (const zone of aZones) {
            if (zone.GetIsRuleArea()) continue;

            if (!zone.GetLayerSet().Contains(changedLayer)) continue;

            // A candidate only needs re-evaluation when the changed zone can affect it:
            // as a higher-priority knockout of it (fill shape), or as a same-net zone
            // (connectivity cluster: refilling from cache restores outlines previously
            // removed as islands). Zones that are neither have no dependency on it.
            if (
              zone !== changedZone &&
              !changedZone.HigherPriority(zone) &&
              !changedZone.SameNet(zone)
            ) {
              continue;
            }

            // Same gate as the initial fill keeps the refill's knockout set identical;
            // same-net candidates interact through connectivity, not a knockout.
            if (zone !== changedZone && !changedZone.SameNet(zone)) {
              if (!this.zoneKnockoutMayInteract(zone, changedZone)) continue;
            } else if (!zone.GetBoundingBox().Intersects(bbox)) {
              continue;
            }

            const fillItem: FillItem = [zone, changedLayer];

            if (zonesToRefillSet.add(fillItem)) zonesToRefill.push(fillItem);
          }
        }

        if (zonesToRefill.length === 0) break;

        if (!progressReported) {
          if (this.m_progressReporter) {
            this.m_progressReporter.AdvancePhase();
            this.m_progressReporter.Report('Refilling overlapping zones...');
            this.m_progressReporter.KeepRefreshing();
          }

          progressReported = true;
        }

        // Snapshot hashes before the wave for convergence detection.  Only zones in
        // zonesToRefill can change their fill this wave.
        const iterHashes = new Map<string, HASH_128>();

        for (const fillItem of zonesToRefill) {
          fillItem[0].BuildHashValue(fillItem[1]);
          iterHashes.set(fillItemKey(fillItem), fillItem[0].GetHashValue(fillItem[1]));
        }

        // Snapshot fills before the wave.  Every refill task reads knockouts from this
        // snapshot so all tasks see the same pre-wave state regardless of completion
        // order.  refillZoneFromCache only reads knockouts on the layer being refilled, so
        // only fills on layers that appear in zonesToRefill are cloned.
        const snapshotLayers = new LSET();

        for (const [, layer] of zonesToRefill) snapshotLayers.set(layer);

        const snapshot: FillSnapshot = new Map();

        forEachBoardAndFootprintZone(board, (zone: ZONE) => {
          if (zone.GetIsRuleArea()) return;

          const copperLayers = zone
            .GetLayerSet()
            .and(LSET.AllCuMask(board.GetCopperLayerCount()))
            .and(snapshotLayers);

          for (const layer of copperLayers.Seq()) {
            if (!zone.HasFilledPolysForLayer(layer)) continue;

            const sp = zone.GetFilledPolysList(layer);

            if (sp && sp.OutlineCount() > 0) {
              let perLayer = snapshot.get(zone);

              if (!perLayer) {
                perLayer = new Map();
                snapshot.set(zone, perLayer);
              }

              perLayer.set(layer, sp.CloneDropTriangulation());
            }
          }
        });

        const cached_refill_fill_lambda = ([zone, layer]: FillItem): number => {
          const fillPolys = new SHAPE_POLY_SET();

          if (!this.refillZoneFromCache(zone, layer, fillPolys, snapshot)) return 0;

          zone.SetFilledPolysList(layer, fillPolys);
          zone.SetFillFlag(layer, false);
          return 1;
        };

        runFillWaves(
          zonesToRefill,
          cached_refill_fill_lambda,
          cached_refill_tessellate_lambda,
          () => false,
          /* aAnyDependencies */ false,
        );

        // Island detection on the refilled zones only.  Zones that grew into freed space
        // can still develop islands if they are simultaneously blocked on one side by a
        // higher-priority zone that grew in a prior wave.
        const refillIslandsMap = new Map<ZONE, Map<PCB_LAYER_ID, ISOLATED_ISLANDS>>();

        for (const [zone, layer] of zonesToRefill) {
          if (this.m_debugZoneFiller && LSET.InternalCuMask().Contains(layer)) continue;

          let perLayer = refillIslandsMap.get(zone);

          if (!perLayer) {
            perLayer = new Map();
            refillIslandsMap.set(zone, perLayer);
          }

          perLayer.set(layer, new ISOLATED_ISLANDS());
        }

        connectivity.FillIsolatedIslandsMap(refillIslandsMap);

        for (const [zone, zoneIslands] of refillIslandsMap) {
          for (const [layer, layerIslands] of zoneIslands) {
            if (this.m_debugZoneFiller && LSET.InternalCuMask().Contains(layer)) continue;

            if (layerIslands.m_IsolatedOutlines.length === 0) continue;

            // Preserve layers that were initially fully isolated (unconnected pours):
            // if every outline on this layer is still an island, keep them as-is.
            if (
              initiallyFullyIsolatedLayers.has([zone, layer]) &&
              layerIslands.m_IsolatedOutlines.length ===
                zone.GetFilledPolysList(layer).OutlineCount()
            ) {
              continue;
            }

            this.removeIslands(zone, layer, layerIslands);
          }
        }

        // Convergence check: collect zone-layer pairs whose fill changed (refill or
        // island removal) compared to the pre-wave hash snapshot.  These seed the next
        // iteration.
        changedZoneLayers = new FillItemSet();

        for (const fillItem of zonesToRefill) {
          fillItem[0].BuildHashValue(fillItem[1]);

          const oldHash = iterHashes.get(fillItemKey(fillItem));

          if (fillItem[0].GetHashValue(fillItem[1]) !== oldHash) changedZoneLayers.add(fillItem);
        }

        if (changedZoneLayers.size === 0) break; // Stable — converged.

        if (iteration + 1 >= maxIterations) {
          hitIterationLimit = true;
          break;
        }
      }

      if (hitIterationLimit) {
        // `wxLogWarning( msg )`: there is no parent window to put a KIDIALOG on.
        console.warn(
          `Zone fills may be incorrect: iterative refill did not converge after ${maxIterations} passes.\n\n` +
            'This can happen with complex overlapping zones.  Consider simplifying your zones.',
        );
      }
    }

    // Now remove islands which are either outside the board edge or fail to meet the minimum
    // area requirements
    const polys_to_check: [SHAPE_POLY_SET, number][] = [];

    for (const zone of aZones) {
      // Don't check for connections on layers that only exist in the zone but
      // were disabled in the board
      const zoneBoard = zone.GetBoard()!;
      const zoneCopperLayers = zone
        .GetLayerSet()
        .and(LSET.AllCuMask(zoneBoard.GetCopperLayerCount()));

      // Min-thickness is the web thickness.  On the other hand, a blob min-thickness by
      // min-thickness is not useful.  Since there's no obvious definition of web vs. blob,
      // we arbitrarily choose "at least 3X the area".
      const minArea = zone.GetMinThickness() * zone.GetMinThickness() * 3;

      for (const layer of zoneCopperLayers.Seq()) {
        if (this.m_debugZoneFiller && LSET.InternalCuMask().Contains(layer)) continue;

        polys_to_check.push([zone.GetFilledPolysList(layer), minArea]);
      }
    }

    const island_returns: [SHAPE_POLY_SET, number][] = [];

    for (const [poly, minArea] of polys_to_check) {
      for (let jj = poly.OutlineCount() - 1; jj >= 0; jj--) {
        const island = new SHAPE_POLY_SET();
        const intersection = new SHAPE_POLY_SET();
        const test_poly = poly.Polygon(jj)[0]!;
        const island_area = test_poly.Area();

        if (island_area < minArea) continue;

        island.AddOutline(test_poly);
        intersection.BooleanIntersection(this.m_boardOutline, island);

        // Nominally, all of these areas should be either inside or outside the board
        // outline.  So this test should be able to just compare areas (if they are equal,
        // you are inside).  But in practice, we sometimes have slight overlap at the
        // edges, so testing against half-size area acts as a fail-safe.
        if (intersection.Area() < island_area / 2.0) island_returns.push([poly, jj]);
      }
    }

    if (this.m_progressReporter?.IsCancelled()) return false;

    for (const [poly, idx] of island_returns) poly.DeletePolygonAndTriangulationData(idx, true);

    for (const zone of aZones) zone.CalculateFilledArea();

    this.reevaluateFlashing(boardCuMask);

    if (this.m_progressReporter) {
      if (this.m_progressReporter.IsCancelled()) return false;

      this.m_progressReporter.AdvancePhase();
      this.m_progressReporter.KeepRefreshing();
    }

    return true;
  }

  /**
   * The island deletion both the initial pass (cpp:1009-1036) and the refill
   * waves (cpp:1290-1313) run on one zone-layer. True when it deleted any.
   */
  private removeIslands(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    aLayerIslands: ISOLATED_ISLANDS,
  ): boolean {
    let removed = false;

    // The list of polygons to delete must be explored from last to first in list,
    // to allow deleting a polygon from list without breaking the remaining of the list
    const islands = [...aLayerIslands.m_IsolatedOutlines].sort((a, b) => b - a);

    const poly = aZone.GetFilledPolysList(aLayer);
    const minArea = aZone.GetMinIslandArea();
    const mode = aZone.GetIslandRemovalMode();

    for (const idx of islands) {
      const outline = poly.Outline(idx);

      if (mode === ISLAND_REMOVAL_MODE.ALWAYS) {
        poly.DeletePolygonAndTriangulationData(idx, false);
        removed = true;
      } else if (mode === ISLAND_REMOVAL_MODE.AREA && outline.Area(true) < minArea) {
        poly.DeletePolygonAndTriangulationData(idx, false);
        removed = true;
      } else {
        aZone.SetIsIsland(aLayer, idx);
      }
    }

    poly.UpdateTriangulationDataHash();
    aZone.CalculateFilledArea();

    return removed;
  }

  /**
   * "Second pass: Re-evaluate via flashing based on actual filled polygons"
   * (cpp:1483-1591). The first pass marks a via or pad ZLO_FORCE_FLASHED when
   * it is within a zone OUTLINE; if the fill does not actually reach it (an
   * obstacle in between), it must not flash (issue 22010).
   */
  private reevaluateFlashing(aBoardCuMask: LSET): void {
    const board = this.m_board;

    interface INDEXED_ZONE {
      bbox: BOX2I;
      index: POLY_CONTAINMENT_INDEX;
    }

    const filledZonesByNetLayer = new Map<string, INDEXED_ZONE[]>();
    const netLayerKey = (aNetcode: number, aLayer: PCB_LAYER_ID): string => `${aNetcode}:${aLayer}`;

    for (const zone of board.Zones()) {
      if (zone.GetIsRuleArea()) continue;

      for (const layer of zone.GetLayerSet().Seq()) {
        if (!zone.HasFilledPolysForLayer(layer)) continue;

        const fill = zone.GetFilledPolysList(layer);

        if (fill.IsEmpty()) continue;

        const index = new POLY_CONTAINMENT_INDEX();
        index.Build(fill);

        const key = netLayerKey(zone.GetNetCode(), layer);
        let list = filledZonesByNetLayer.get(key);

        if (!list) {
          list = [];
          filledZonesByNetLayer.set(key, list);
        }

        list.push({ bbox: zone.GetBoundingBox(), index });
      }
    }

    const zoneReachesPoint = (
      aNetcode: number,
      aLayer: PCB_LAYER_ID,
      aCenter: VECTOR2I,
      aRadius: number,
    ): boolean => {
      const list = filledZonesByNetLayer.get(netLayerKey(aNetcode, aLayer));

      if (!list) return false;

      for (const iz of list) {
        if (!iz.bbox.GetInflated(aRadius).Contains(aCenter)) continue;

        if (iz.index.Contains(aCenter, aRadius)) return true;
      }

      return false;
    };

    for (const track of board.Tracks()) {
      if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = track as unknown as PCB_VIA;
      const center = via.GetPosition();
      const holeRadius = Math.trunc(via.GetDrillValue() / 2);
      const netcode = via.GetNetCode();
      const layers = via.GetLayerSet().and(aBoardCuMask);

      for (const layer of layers.Seq()) {
        if (via.GetZoneLayerOverride(layer) !== ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED) continue;

        const reach = Math.max(holeRadius, Math.trunc(via.GetWidth(layer) / 2));

        if (!zoneReachesPoint(netcode, layer, center, reach))
          via.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION);
      }
    }

    for (const footprint of board.Footprints()) {
      for (const pad of footprint.Pads()) {
        const center = pad.GetPosition();
        const netcode = pad.GetNetCode();
        const layers = pad.GetLayerSet().and(aBoardCuMask);

        let holeRadius = 0;

        if (pad.HasHole())
          holeRadius = Math.trunc(Math.min(pad.GetDrillSizeX(), pad.GetDrillSizeY()) / 2);

        for (const layer of layers.Seq()) {
          if (pad.GetZoneLayerOverride(layer) !== ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED) continue;

          // A thermal spoke reaches the pad copper edge. Testing only the hole radius lands
          // on the spoke endpoint and rounds out for some hole sizes, dropping a connected
          // pad's flashing (issue 24865). Use the pad copper radius, still inside the gap.
          const padSize = pad.GetSize(layer);
          const reach = Math.max(holeRadius, Math.trunc(Math.min(padSize.x, padSize.y) / 2));

          if (!zoneReachesPoint(netcode, layer, center, reach))
            pad.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION);
        }
      }
    }
  }

  /**
   * `ZONE_FILLER::Fill`'s prologue (zone_filler.cpp:481-676): the board state
   * every pour reads, brought up to date before any of them runs.
   *
   * Public only while `Fill` itself is still the view's; it is private
   * upstream, and becomes private here when the pour moves into this class.
   */
  PrepareBoardForFill(): void {
    const board = this.m_board;

    this.ensureDrcEngine();

    // `m_worstClearance` (:466) and `m_boardOutline` (:478-479) are read by
    // the pour, which is still the view's; they arrive with it.
    //
    // "Update and cache zone bounding boxes and pad effective shapes so that
    // we don't have to make them thread-safe." (:481-483)
    for (const zone of board.Zones()) zone.CacheBoundingBox();

    for (const footprint of board.Footprints()) {
      for (const pad of footprint.Pads()) {
        if (pad.IsDirty()) {
          pad.BuildEffectiveShapes();
          pad.BuildEffectivePolygon(ERROR_LOC.ERROR_OUTSIDE);
        }
      }

      for (const zone of footprint.Zones()) zone.CacheBoundingBox();

      // "Rules may depend on insideCourtyard() or other expressions" (:500).
      footprint.BuildCourtyardCaches();
      footprint.BuildNetTieCache();
    }

    this.determineConditionalFlashing();
  }

  /**
   * `Fill`'s first act (zone_filler.cpp:421-455).
   *
   * "The fill evaluates thermal-relief and clearance rules through the board's
   * DRC engine on worker threads. Interactive callers always supply an
   * initialized engine, but headless consumers … can reach here with none,
   * which would crash on the first EvalRules() call."
   *
   * Upstream then loads the board's `.kicad_dru` into the new engine and, if
   * that throws, keeps the engine anyway — "Rules failing to compile only
   * matters when the user runs DRC; the fill falls back to the implicit
   * constraints". We have no file to reach for here, so the engine is built on
   * the implicit constraints alone, which is that same fallback.
   */
  private ensureDrcEngine(): DRC_ENGINE {
    const bds = this.m_board.GetDesignSettings();

    if (!bds.m_DRCEngine) {
      const engine = new DRC_ENGINE(this.m_board, bds);

      try {
        engine.InitEngine(null);
      } catch {
        /* see above: an engine on the implicit rules is still an engine */
      }

      // "Publish only after InitEngine() has fully populated the engine so a
      // concurrent reader never observes a non-null but half-initialized one."
      bds.m_DRCEngine = engine;
    }

    return bds.m_DRCEngine;
  }

  /**
   * `DRC_ENGINE::EvalRules( THERMAL_RELIEF_GAP_CONSTRAINT, aPad, aZone, aLayer )`
   * (zone_filler.cpp:1901, 1947), the gap `knockoutThermalReliefs` opens
   * around a thermally connected pad.
   */
  ThermalReliefGap(aPad: BOARD_ITEM, aZone: ZONE, aLayer: PCB_LAYER_ID): number {
    return this.ensureDrcEngine()
      .EvalRules(DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT, aPad, aZone, aLayer)
      .GetValue()
      .Min();
  }

  /**
   * `EvalRules( THERMAL_SPOKE_WIDTH_CONSTRAINT, … )` (zone_filler.cpp:3396).
   *
   * `buildThermalSpokes` reads `Opt()`, not `Min()`
   * (`zone_filler.cpp:3397-3400`): the two differ for a pad whose own
   * `(thermal_bridge_width …)` is below the zone's minimum thickness, where
   * the constraint's Min is raised to that minimum and its Opt is not.
   */
  ThermalSpokeWidth(aPad: BOARD_ITEM, aZone: ZONE, aLayer: PCB_LAYER_ID): number {
    return this.ensureDrcEngine()
      .EvalRules(DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT, aPad, aZone, aLayer)
      .GetValue()
      .Opt();
  }

  /**
   * `DRC_ENGINE::EvalZoneConnection( aPad, aZone, aLayer )`
   * (zone_filler.cpp:1886, 1933) — the ZONE_CONNECTION_CONSTRAINT, plus the
   * THT_THERMAL rewrite that turns it into THERMAL on a plated through-hole
   * pad and FULL on everything else.
   */
  ZoneConnection(aPad: BOARD_ITEM, aZone: ZONE, aLayer: PCB_LAYER_ID): ZONE_CONNECTION {
    return this.ensureDrcEngine().EvalZoneConnection(aPad, aZone, aLayer).m_ZoneConnection;
  }

  /**
   * "Determine state of conditional via flashing" and "…pad flashing"
   * (zone_filler.cpp:576-676).
   *
   * A via or pad with "remove unconnected layers" is drawn — and connected —
   * on a given layer only where it actually meets a zone of its own net. The
   * C++ settles every one of those before the first pour, and its comment says
   * why: "This is now done completely deterministically prior to filling due to
   * the pathological case presented in …/issues/12964". Deciding it while
   * pouring would make the answer depend on the order the zones ran in.
   */
  private determineConditionalFlashing(): void {
    const board = this.m_board;
    const boardCuMask = LSET.AllCuMask(board.GetCopperLayerCount());

    for (const track of board.Tracks()) {
      if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = track as PCB_VIA;
      const padstack = via.Padstack();

      via.ClearZoneLayerOverrides();

      if (!via.GetRemoveUnconnected()) continue;

      const bbox = via.GetBoundingBox().Clone();
      const center = via.GetPosition();
      const holeRadius = Math.trunc(via.GetDrillValue() / 2) + 1;
      const netcode = via.GetNetCode();
      const layers = new LSET(via.GetLayerSet()).andAssign(boardCuMask) as LSET;

      // "Checking if the via hole touches the zone outline": the hole, not the
      // centre — `Contains( center, -1, holeRadius )` accepts a point that is
      // outside the outline by less than the hole's radius.
      const viaTestFn = (aZone: ZONE): boolean => aZone.Outline().Contains(center, -1, holeRadius);

      layers.RunOnLayers((layer) => {
        if (!via.ConditionallyFlashed(layer)) return;

        if (this.isInPourKeepoutArea(bbox, layer, center)) {
          via.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION);
          return;
        }

        const zone = this.findHighestPriorityZone(bbox, layer, netcode, viaTestFn);

        if (
          zone &&
          zone.GetNetCode() === via.GetNetCode() &&
          (padstack.UnconnectedLayerMode() !== UNCONNECTED_LAYER_MODE.START_END_ONLY ||
            layer === padstack.Drill().start ||
            layer === padstack.Drill().end)
        ) {
          via.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED);
        } else {
          via.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION);
        }
      });
    }

    for (const footprint of board.Footprints()) {
      for (const pad of footprint.Pads()) {
        pad.ClearZoneLayerOverrides();

        if (!pad.GetRemoveUnconnected()) continue;

        const bbox = pad.GetBoundingBox().Clone();
        const center = pad.GetPosition();
        const netcode = pad.GetNetCode();
        const layers = new LSET(pad.GetLayerSet()).andAssign(boardCuMask) as LSET;

        // The pad's test is the centre alone; only the via's gets the hole
        // radius. (zone_filler.cpp:648-652 against :598-602.)
        const padTestFn = (aZone: ZONE): boolean => aZone.Outline().Contains(center);

        layers.RunOnLayers((layer) => {
          if (!pad.ConditionallyFlashed(layer)) return;

          if (this.isInPourKeepoutArea(bbox, layer, center)) {
            pad.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION);
            return;
          }

          const zone = this.findHighestPriorityZone(bbox, layer, netcode, padTestFn);

          if (zone && zone.GetNetCode() === pad.GetNetCode())
            pad.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED);
          else pad.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION);
        });
      }
    }
  }

  /** The `findHighestPriorityZone` lambda (zone_filler.cpp:507-545). */
  private findHighestPriorityZone(
    aBBox: BOX2I,
    aItemLayer: PCB_LAYER_ID,
    aNetcode: number,
    aTestFn: (aZone: ZONE) => boolean,
  ): ZONE | null {
    let highestPriority = 0;
    let highestPriorityZone: ZONE | null = null;

    for (const zone of this.m_board.Zones()) {
      // Rule areas are not filled
      if (zone.GetIsRuleArea()) continue;

      if (zone.GetAssignedPriority() < highestPriority) continue;

      if (!zone.IsOnLayer(aItemLayer)) continue;

      // Degenerate zones will cause trouble; skip them
      if (zone.GetNumCorners() <= 2) continue;

      if (!zone.GetBoundingBox().Intersects(aBBox)) continue;

      if (!aTestFn(zone)) continue;

      // "Prefer highest priority and matching netcode". Note the OR: a
      // same-net zone wins at EQUAL priority, which is what makes the
      // netcode test below meaningful.
      if (zone.GetAssignedPriority() > highestPriority || zone.GetNetCode() === aNetcode) {
        highestPriority = zone.GetAssignedPriority();
        highestPriorityZone = zone;
      }
    }

    return highestPriorityZone;
  }

  /** The `isInPourKeepoutArea` lambda (zone_filler.cpp:547-574). */
  private isInPourKeepoutArea(
    aBBox: BOX2I,
    aItemLayer: PCB_LAYER_ID,
    aTestPoint: VECTOR2I,
  ): boolean {
    for (const zone of this.m_board.Zones()) {
      if (!zone.GetIsRuleArea()) continue;

      if (!zone.HasKeepoutParametersSet()) continue;

      if (!zone.GetDoNotAllowZoneFills()) continue;

      if (!zone.IsOnLayer(aItemLayer)) continue;

      // Degenerate zones will cause trouble; skip them
      if (zone.GetNumCorners() <= 2) continue;

      if (!zone.GetBoundingBox().Intersects(aBBox)) continue;

      if (zone.Outline().Contains(aTestPoint)) return true;
    }

    return false;
  }

  /** `zoneKnockoutMayInteract` (cpp:408-431). */
  private zoneKnockoutMayInteract(aZone: ZONE, aKnockout: ZONE): boolean {
    let reach = this.m_worstClearance + this.m_zoneKnockoutSlack + aZone.GetMinThickness();

    if (this.m_board.GetDesignSettings().m_ZoneKeepExternalFillets) {
      for (const zone of [aZone, aKnockout]) {
        if (
          zone.GetCornerSmoothingType() === ZONE_SETTINGS.SMOOTHING_CHAMFER ||
          zone.GetCornerSmoothingType() === ZONE_SETTINGS.SMOOTHING_FILLET
        ) {
          reach += Math.trunc(zone.GetCornerRadius());
        }
      }
    }

    const bbox = aZone.GetBoundingBox().Clone();
    bbox.Inflate(reach);

    if (!bbox.Intersects(aKnockout.GetBoundingBox())) return false;

    return aZone.Outline().Collide(aKnockout.Outline(), reach);
  }

  /**
   * `addKnockout( BOARD_ITEM*, PCB_LAYER_ID, int, SHAPE_POLY_SET& )`
   * (cpp:1678-1707): a pad or via grown by `aGap`; a custom pad as its convex
   * hull when it asks for one.
   */
  private addKnockout(
    aItem: BOARD_ITEM,
    aLayer: PCB_LAYER_ID,
    aGap: number,
    aHoles: SHAPE_POLY_SET,
  ): void {
    if (
      aItem.Type() === KICAD_T.PCB_PAD_T &&
      (aItem as unknown as PAD).GetShape(aLayer) === PAD_SHAPE.CUSTOM
    ) {
      const pad = aItem as unknown as PAD;
      const poly = new SHAPE_POLY_SET();
      pad.TransformShapeToPolygon(poly, aLayer, aGap, this.m_maxError, ERROR_LOC.ERROR_OUTSIDE);

      // the pad shape in zone can be its convex hull or the shape itself
      if (pad.GetCustomShapeInZoneOpt() === CUSTOM_SHAPE_ZONE_MODE.CONVEXHULL) {
        const convex_hull = buildConvexHullOfPolySet(poly);

        aHoles.NewOutline();

        for (const pt of convex_hull) aHoles.Append(pt);
      } else {
        aHoles.Append(poly);
      }
    } else {
      aItem.TransformShapeToPolygon(aHoles, aLayer, aGap, this.m_maxError, ERROR_LOC.ERROR_OUTSIDE);
    }
  }

  /** `addHoleKnockout` (cpp:1712-1716). */
  private addHoleKnockout(aPad: PAD, aGap: number, aHoles: SHAPE_POLY_SET): void {
    aPad.TransformHoleToPolygon(aHoles, aGap, this.m_maxError, ERROR_LOC.ERROR_OUTSIDE);
  }

  /**
   * `addKnockout( BOARD_ITEM*, PCB_LAYER_ID, int, bool aIgnoreLineWidth, … )`
   * (cpp:1723-1782): a graphic item grown by `aGap`.
   */
  private addGraphicKnockout(
    aItem: BOARD_ITEM,
    aLayer: PCB_LAYER_ID,
    aGap: number,
    aIgnoreLineWidth: boolean,
    aHoles: SHAPE_POLY_SET,
  ): void {
    switch (aItem.Type()) {
      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T: {
        const text = aItem as unknown as PCB_TEXT;

        if (text.IsVisible()) {
          if (text.IsKnockout()) {
            // Knockout text should only leave holes where the text is, not where the copper
            // fill around it would be.
            const textCopy = text.Clone() as PCB_TEXT;
            textCopy.SetIsKnockout(false);
            textCopy.TransformTextToPolySet(aHoles, 0, this.m_maxError, ERROR_LOC.ERROR_INSIDE);
          } else {
            text.TransformShapeToPolygon(
              aHoles,
              aLayer,
              aGap,
              this.m_maxError,
              ERROR_LOC.ERROR_OUTSIDE,
            );
          }
        }

        break;
      }

      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_TABLE_T:
      case KICAD_T.PCB_SHAPE_T:
      case KICAD_T.PCB_TARGET_T:
        aItem.TransformShapeToPolygon(
          aHoles,
          aLayer,
          aGap,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
          aIgnoreLineWidth,
        );
        break;

      case KICAD_T.PCB_BARCODE_T: {
        const barcode = aItem as unknown as PCB_BARCODE;
        barcode.GetBoundingHull(aHoles, aLayer, aGap, this.m_maxError, ERROR_LOC.ERROR_OUTSIDE);
        break;
      }

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_LEADER_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T: {
        const dim = aItem as unknown as PCB_DIMENSION_BASE;

        dim.TransformShapeToPolygon(
          aHoles,
          aLayer,
          aGap,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
          false,
        );
        PCB_TEXT.prototype.TransformShapeToPolygon.call(
          dim,
          aHoles,
          aLayer,
          aGap,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );
        break;
      }

      default:
        break;
    }
  }

  /**
   * `knockoutThermalReliefs` (cpp:1789-2099): removes the thermal reliefs
   * around pads connected to the zone, and sorts the rest into the lists the
   * later passes take. Does NOT add the spokes.
   */
  private knockoutThermalReliefs(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    aFill: SHAPE_POLY_SET,
    aThermalConnectionPads: BOARD_ITEM[],
    aNoConnectionPads: PAD[],
    aSolidConnectionItems: BOARD_ITEM[],
  ): void {
    const bds = this.m_board.GetDesignSettings();
    const drc = bds.m_DRCEngine!;
    let connection: ZONE_CONNECTION;
    let constraint: DRC_CONSTRAINT;
    let padClearance: number;
    let holeClearance: number;
    const holes = new SHAPE_POLY_SET();

    // Deduplication sets for coincident pads and vias
    const processedPads = new Set<string>();
    const processedVias = new Set<string>();

    for (const footprint of this.m_board.Footprints()) {
      for (const pad of footprint.Pads()) {
        // NPTH pads with a drill hole affect all copper layers even when they carry no copper
        // on that layer (e.g. layers limited to "*.Mask"). The physical hole still requires
        // a clearance knockout, so skip only pads that are truly irrelevant to this layer.
        const npthWithHole = pad.GetAttribute() === PAD_ATTRIB.NPTH && pad.GetDrillSize().x > 0;

        if (!pad.IsOnLayer(aLayer) && !npthWithHole) continue;

        const padBBox = pad.GetBoundingBox().Clone();
        padBBox.Inflate(this.m_worstClearance);

        if (!padBBox.Intersects(aZone.GetBoundingBox())) continue;

        const padKey = padKnockoutKey(pad, aLayer);

        if (padKey !== null) {
          if (processedPads.has(padKey)) continue;

          processedPads.add(padKey);
        }

        let noConnection = pad.GetNetCode() !== aZone.GetNetCode();

        if (!aZone.IsTeardropArea()) {
          if (
            aZone.GetNetCode() === 0 ||
            pad.GetZoneLayerOverride(aLayer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION
          ) {
            noConnection = true;
          }
        }

        // Check if the pad is backdrilled or post-machined on this layer
        if (pad.IsBackdrilledOrPostMachined(aLayer)) noConnection = true;

        if (noConnection) {
          // collect these for knockout in buildCopperItemClearances()
          aNoConnectionPads.push(pad);
          continue;
        }

        // For hatch zones, respect the zone connection type just like solid zones
        // Pads with THERMAL connection get thermal rings; FULL connections get no knockout;
        // NONE connections get handled later in buildCopperItemClearances.
        if (aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN) {
          constraint = drc.EvalZoneConnection(pad, aZone, aLayer);
          connection = constraint.m_ZoneConnection;

          if (connection === ZONE_CONNECTION.THERMAL && !pad.CanFlashLayer(aLayer))
            connection = ZONE_CONNECTION.NONE;

          switch (connection) {
            case ZONE_CONNECTION.THERMAL: {
              const padShape = pad.GetEffectiveShape(aLayer, FLASHING.ALWAYS_FLASHED);

              if (aFill.Collide(padShape, 0)) {
                // Get the thermal relief gap
                constraint = drc.EvalRules(
                  DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
                  pad,
                  aZone,
                  aLayer,
                );
                const thermalGap = constraint.GetValue().Min();

                // Knock out the thermal gap only - the thermal ring will be added separately
                aThermalConnectionPads.push(pad);
                this.addKnockout(pad, aLayer, thermalGap, holes);
              }

              break;
            }

            case ZONE_CONNECTION.NONE:
              // Will be handled by buildCopperItemClearances
              aNoConnectionPads.push(pad);
              break;

            default:
              // No knockout - pad connects directly to the hatch
              break;
          }

          continue;
        }

        if (aZone.IsTeardropArea()) {
          connection = ZONE_CONNECTION.FULL;
        } else {
          constraint = drc.EvalZoneConnection(pad, aZone, aLayer);
          connection = constraint.m_ZoneConnection;
        }

        if (connection === ZONE_CONNECTION.THERMAL && !pad.CanFlashLayer(aLayer))
          connection = ZONE_CONNECTION.NONE;

        switch (connection) {
          case ZONE_CONNECTION.THERMAL: {
            const padShape = pad.GetEffectiveShape(aLayer, FLASHING.ALWAYS_FLASHED);

            if (aFill.Collide(padShape, 0)) {
              constraint = drc.EvalRules(
                DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
                pad,
                aZone,
                aLayer,
              );
              padClearance = constraint.GetValue().Min();

              aThermalConnectionPads.push(pad);
              this.addKnockout(pad, aLayer, padClearance, holes);
            }

            break;
          }

          case ZONE_CONNECTION.NONE:
            constraint = drc.EvalRules(
              DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
              pad,
              aZone,
              aLayer,
            );

            if (constraint.GetValue().Min() > aZone.GetLocalClearance()!)
              padClearance = constraint.GetValue().Min();
            else padClearance = aZone.GetLocalClearance()!;

            if (pad.FlashLayer(aLayer)) {
              this.addKnockout(pad, aLayer, padClearance, holes);
            } else if (pad.GetDrillSize().x > 0) {
              constraint = drc.EvalRules(
                DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
                pad,
                aZone,
                aLayer,
              );

              if (constraint.GetValue().Min() > padClearance)
                holeClearance = constraint.GetValue().Min();
              else holeClearance = padClearance;

              pad.TransformHoleToPolygon(
                holes,
                holeClearance,
                this.m_maxError,
                ERROR_LOC.ERROR_OUTSIDE,
              );
            }

            break;

          default:
            // No knockout
            continue;
        }
      }
    }

    // For hatch zones, vias also need thermal treatment to prevent isolation inside hatch
    // holes. We respect the zone connection type just like pads: THERMAL gets a relief
    // knockout, FULL connects directly to the webbing, NONE is handled in
    // buildCopperItemClearances.
    if (aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN) {
      for (const track of this.m_board.Tracks()) {
        if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

        const via = track as unknown as PCB_VIA;

        if (!via.IsOnLayer(aLayer)) continue;

        const viaBBox = via.GetBoundingBox().Clone();
        viaBBox.Inflate(this.m_worstClearance);

        if (!viaBBox.Intersects(aZone.GetBoundingBox())) continue;

        // Deduplicate coincident vias (circular, so use max of drill and width)
        const viaKey = viaKnockoutKey(via, aLayer);

        if (processedVias.has(viaKey)) continue;

        processedVias.add(viaKey);

        let noConnection =
          via.GetNetCode() !== aZone.GetNetCode() ||
          (via.Padstack().UnconnectedLayerMode() === UNCONNECTED_LAYER_MODE.START_END_ONLY &&
            aLayer !== via.Padstack().Drill().start &&
            aLayer !== via.Padstack().Drill().end);

        if (via.GetZoneLayerOverride(aLayer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION)
          noConnection = true;

        // Check if this layer is affected by backdrill or post-machining
        if (via.IsBackdrilledOrPostMachined(aLayer)) {
          noConnection = true;

          // Add knockout for backdrill/post-machining hole
          let pmSize = 0;
          let bdSize = 0;

          const frontPM = via.Padstack().FrontPostMachining();
          const backPM = via.Padstack().BackPostMachining();

          if (
            frontPM.mode !== PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED &&
            frontPM.mode !== PAD_DRILL_POST_MACHINING_MODE.UNKNOWN
          ) {
            pmSize = Math.max(pmSize, frontPM.size);
          }

          if (
            backPM.mode !== PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED &&
            backPM.mode !== PAD_DRILL_POST_MACHINING_MODE.UNKNOWN
          ) {
            pmSize = Math.max(pmSize, backPM.size);
          }

          const secDrill = via.Padstack().SecondaryDrill();

          if (
            secDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER &&
            secDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER
          )
            bdSize = secDrill.size.x;

          const knockoutSize = Math.max(pmSize, bdSize);

          if (knockoutSize > 0) {
            const clearance = aZone.GetLocalClearance() ?? 0;

            TransformCircleToPolygon(
              holes,
              via.GetPosition(),
              Math.trunc(knockoutSize / 2) + clearance,
              this.m_maxError,
              ERROR_LOC.ERROR_OUTSIDE,
            );
          }
        }

        if (noConnection) continue;

        constraint = drc.EvalZoneConnection(via, aZone, aLayer);
        connection = constraint.m_ZoneConnection;

        switch (connection) {
          case ZONE_CONNECTION.THERMAL: {
            constraint = drc.EvalRules(
              DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
              via,
              aZone,
              aLayer,
            );
            const thermalGap = constraint.GetValue().Min();

            // Only force thermal if the via is small enough to be isolated in a hatch hole.
            // A via wider than the hole width will always touch the webbing naturally.
            if (thermalGap > 0) {
              aThermalConnectionPads.push(via);
              this.addKnockout(via, aLayer, thermalGap, holes);
            }

            break;
          }

          case ZONE_CONNECTION.NONE:
            // Will be handled by buildCopperItemClearances
            break;

          default:
            // No knockout. A small via in a hatch hole would be isolated, so register it
            // to drop that hole and keep the via on the webbing.
            aSolidConnectionItems.push(via);
            break;
        }
      }
    }

    aFill.BooleanSubtract(holes);
  }

  /** `evalRulesForItems` (cpp:2134-2144): a constraint's Min, or -1 when none applies. */
  private evalRulesForItems(
    aConstraint: DRC_CONSTRAINT_T,
    a: BOARD_ITEM,
    b: BOARD_ITEM,
    aEvalLayer: PCB_LAYER_ID,
  ): number {
    const c = this.m_board
      .GetDesignSettings()
      .m_DRCEngine!.EvalRules(aConstraint, a, b, aEvalLayer);

    if (c.IsNull()) return -1;

    return c.GetValue().Min();
  }

  /** The backdrill / post-machining knockout both clearance passes add (cpp:2185-2224, :2318-2352). */
  private addPostMachiningKnockout(
    aItem: PAD | PCB_VIA,
    aGap: number,
    aExtraMargin: number,
    aHoles: SHAPE_POLY_SET,
  ): void {
    let pmSize = 0;
    let bdSize = 0;

    const frontPM = aItem.Padstack().FrontPostMachining();
    const backPM = aItem.Padstack().BackPostMachining();

    if (
      frontPM.mode !== PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED &&
      frontPM.mode !== PAD_DRILL_POST_MACHINING_MODE.UNKNOWN
    ) {
      pmSize = Math.max(pmSize, frontPM.size);
    }

    if (
      backPM.mode !== PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED &&
      backPM.mode !== PAD_DRILL_POST_MACHINING_MODE.UNKNOWN
    ) {
      pmSize = Math.max(pmSize, backPM.size);
    }

    const secDrill = aItem.Padstack().SecondaryDrill();

    if (
      secDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      secDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER
    )
      bdSize = secDrill.size.x;

    const knockoutSize = Math.max(pmSize, bdSize);

    if (knockoutSize > 0) {
      const clearance = Math.max(aGap, 0) + aExtraMargin;

      TransformCircleToPolygon(
        aHoles,
        aItem.GetPosition(),
        Math.trunc(knockoutSize / 2) + clearance,
        this.m_maxError,
        ERROR_LOC.ERROR_OUTSIDE,
      );
    }
  }

  /**
   * `buildCopperItemClearances` (cpp:2106-2591): the clearance holes around
   * every copper item, hole, graphic, courtyard and (optionally) zone that is
   * not connected to the zone.
   */
  private buildCopperItemClearances(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    aNoConnectionPads: readonly PAD[],
    aHoles: SHAPE_POLY_SET,
    aIncludeZoneClearances = true,
  ): void {
    const {
      PHYSICAL_CLEARANCE_CONSTRAINT,
      CLEARANCE_CONSTRAINT,
      PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
    } = DRC_CONSTRAINT_T;
    const { HOLE_CLEARANCE_CONSTRAINT, EDGE_CLEARANCE_CONSTRAINT } = DRC_CONSTRAINT_T;

    // Deduplication sets for coincident items
    const processedPads = new Set<string>();
    const processedVias = new Set<string>();
    const processedTracks = new Set<string>();

    // A small extra clearance to be sure actual track clearances are not smaller than
    // requested clearance due to many approximations in calculations, like arc to segment
    // approx, rounding issues, etc.
    const zone_boundingbox = aZone.GetBoundingBox().Clone();
    const extra_margin = pcbIUScale.mmToIU(ADVANCED_CFG.GetCfg().m_ExtraClearance);

    // Items outside the zone bounding box are skipped, so it needs to be inflated by the
    // largest clearance value found in the netclasses and rules
    zone_boundingbox.Inflate(this.m_worstClearance + extra_margin);

    // Add non-connected pad clearances
    const knockoutPadClearance = (aPad: PAD): void => {
      const init_gap = this.evalRulesForItems(PHYSICAL_CLEARANCE_CONSTRAINT, aZone, aPad, aLayer);
      let gap = init_gap;
      const hasHole = aPad.GetDrillSize().x > 0;
      const flashLayer = aPad.FlashLayer(aLayer);
      const platedHole = hasHole && aPad.GetAttribute() === PAD_ATTRIB.PTH;

      if (flashLayer || platedHole) {
        gap = Math.max(gap, this.evalRulesForItems(CLEARANCE_CONSTRAINT, aZone, aPad, aLayer));
      }

      if (flashLayer && gap >= 0) this.addKnockout(aPad, aLayer, gap + extra_margin, aHoles);

      if (hasHole) {
        // NPTH do not need copper clearance gaps to their holes
        if (aPad.GetAttribute() === PAD_ATTRIB.NPTH) gap = init_gap;

        gap = Math.max(
          gap,
          this.evalRulesForItems(PHYSICAL_HOLE_CLEARANCE_CONSTRAINT, aZone, aPad, aLayer),
        );

        gap = Math.max(gap, this.evalRulesForItems(HOLE_CLEARANCE_CONSTRAINT, aZone, aPad, aLayer));

        // Oblong NPTH holes are milled rather than drilled, so they need
        // edge clearance in addition to hole clearance
        if (
          aPad.GetAttribute() === PAD_ATTRIB.NPTH &&
          aPad.GetDrillSize().x !== aPad.GetDrillSize().y
        ) {
          gap = Math.max(
            gap,
            this.evalRulesForItems(EDGE_CLEARANCE_CONSTRAINT, aZone, aPad, aLayer),
          );
        }

        if (gap >= 0) this.addHoleKnockout(aPad, gap + extra_margin, aHoles);
      }

      // Handle backdrill and post-machining knockouts
      if (aPad.IsBackdrilledOrPostMachined(aLayer))
        this.addPostMachiningKnockout(aPad, gap, extra_margin, aHoles);
    };

    for (const pad of aNoConnectionPads) {
      // Deduplicate coincident pads (skip custom pads - they have complex shapes)
      const padKey = padKnockoutKey(pad, aLayer);

      if (padKey !== null) {
        if (processedPads.has(padKey)) continue;

        processedPads.add(padKey);
      }

      knockoutPadClearance(pad);
    }

    // Add non-connected track clearances
    const knockoutTrackClearance = (aTrack: PCB_TRACK): void => {
      if (!aTrack.GetBoundingBox().Intersects(zone_boundingbox)) return;

      let sameNet = aTrack.GetNetCode() === aZone.GetNetCode();

      if (!aZone.IsTeardropArea() && aZone.GetNetCode() === 0) sameNet = false;

      let gap = this.evalRulesForItems(PHYSICAL_CLEARANCE_CONSTRAINT, aZone, aTrack, aLayer);

      if (aTrack.Type() === KICAD_T.PCB_VIA_T) {
        const via = aTrack as unknown as PCB_VIA;

        if (via.GetZoneLayerOverride(aLayer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION)
          sameNet = false;
      }

      if (!sameNet)
        gap = Math.max(gap, this.evalRulesForItems(CLEARANCE_CONSTRAINT, aZone, aTrack, aLayer));

      if (aTrack.Type() === KICAD_T.PCB_VIA_T) {
        const via = aTrack as unknown as PCB_VIA;

        if (via.FlashLayer(aLayer) && gap > 0) {
          via.TransformShapeToPolygon(
            aHoles,
            aLayer,
            gap + extra_margin,
            this.m_maxError,
            ERROR_LOC.ERROR_OUTSIDE,
          );
        }

        gap = Math.max(
          gap,
          this.evalRulesForItems(PHYSICAL_HOLE_CLEARANCE_CONSTRAINT, aZone, via, aLayer),
        );

        if (!sameNet)
          gap = Math.max(
            gap,
            this.evalRulesForItems(HOLE_CLEARANCE_CONSTRAINT, aZone, via, aLayer),
          );

        if (gap >= 0) {
          const radius = Math.trunc(via.GetDrillValue() / 2);

          TransformCircleToPolygon(
            aHoles,
            via.GetPosition(),
            radius + gap + extra_margin,
            this.m_maxError,
            ERROR_LOC.ERROR_OUTSIDE,
          );
        }

        // Handle backdrill and post-machining knockouts
        if (via.IsBackdrilledOrPostMachined(aLayer))
          this.addPostMachiningKnockout(via, gap, extra_margin, aHoles);
      } else if (gap >= 0) {
        aTrack.TransformShapeToPolygon(
          aHoles,
          aLayer,
          gap + extra_margin,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );
      }
    };

    for (const track of this.m_board.Tracks()) {
      if (!track.IsOnLayer(aLayer)) continue;

      // Deduplicate coincident tracks and vias
      if (track.Type() === KICAD_T.PCB_VIA_T) {
        const viaKey = viaKnockoutKey(track as unknown as PCB_VIA, aLayer);

        if (processedVias.has(viaKey)) continue;

        processedVias.add(viaKey);
      } else {
        const trackKey = trackKnockoutKey(track.GetStart(), track.GetEnd(), track.GetWidth());

        if (processedTracks.has(trackKey)) continue;

        processedTracks.add(trackKey);
      }

      knockoutTrackClearance(track);
    }

    // Add graphic item clearances.
    const knockoutGraphicClearance = (aItem: BOARD_ITEM): void => {
      let shapeNet = -1;

      if (aItem.Type() === KICAD_T.PCB_SHAPE_T)
        shapeNet = (aItem as unknown as PCB_SHAPE).GetNetCode();

      let sameNet = shapeNet === aZone.GetNetCode();

      if (!aZone.IsTeardropArea() && aZone.GetNetCode() === 0) sameNet = false;

      // A item on the Edge_Cuts or Margin is always seen as on any layer:
      if (
        aItem.IsOnLayer(aLayer) ||
        aItem.IsOnLayer(PCB_LAYER_ID.Edge_Cuts) ||
        aItem.IsOnLayer(PCB_LAYER_ID.Margin)
      ) {
        if (aItem.GetBoundingBox().Intersects(zone_boundingbox)) {
          let ignoreLineWidths = false;
          let gap = this.evalRulesForItems(PHYSICAL_CLEARANCE_CONSTRAINT, aZone, aItem, aLayer);

          if (aItem.IsOnLayer(aLayer) && !sameNet) {
            gap = Math.max(gap, this.evalRulesForItems(CLEARANCE_CONSTRAINT, aZone, aItem, aLayer));
          } else if (aItem.IsOnLayer(PCB_LAYER_ID.Edge_Cuts)) {
            gap = Math.max(
              gap,
              this.evalRulesForItems(EDGE_CLEARANCE_CONSTRAINT, aZone, aItem, aLayer),
            );
            ignoreLineWidths = true;
          } else if (aItem.IsOnLayer(PCB_LAYER_ID.Margin)) {
            gap = Math.max(
              gap,
              this.evalRulesForItems(EDGE_CLEARANCE_CONSTRAINT, aZone, aItem, aLayer),
            );
          }

          if (gap >= 0) {
            gap += extra_margin;
            this.addGraphicKnockout(aItem, aLayer, gap, ignoreLineWidths, aHoles);
          }
        }
      }
    };

    const knockoutCourtyardClearance = (aFootprint: FOOTPRINT): void => {
      if (!aFootprint.GetBoundingBox().Intersects(zone_boundingbox)) return;

      const gap = this.evalRulesForItems(PHYSICAL_CLEARANCE_CONSTRAINT, aZone, aFootprint, aLayer);

      // For internal copper layers, GetCourtyard( aLayer ) always returns the
      // front courtyard because IsBackLayer() is false for all internal layers.
      // Use the footprint's own layer to select the correct courtyard instead.
      const courtyardSide = IsInnerCopperLayer(aLayer) ? aFootprint.GetLayer() : aLayer;

      if (gap === 0) {
        aHoles.Append(aFootprint.GetCourtyard(courtyardSide));
      } else if (gap > 0) {
        const hole = aFootprint.GetCourtyard(courtyardSide).Clone() as SHAPE_POLY_SET;
        hole.Inflate(gap, CORNER_STRATEGY.ROUND_ALL_CORNERS, this.m_maxError);
        aHoles.Append(hole);
      }
    };

    for (const footprint of this.m_board.Footprints()) {
      knockoutCourtyardClearance(footprint);
      knockoutGraphicClearance(footprint.Reference());
      knockoutGraphicClearance(footprint.Value());

      const allowedNetTiePads = new Set<PAD>();

      // Don't knock out holes for graphic items which implement a net-tie to the zone's net
      // on the layer being filled.
      if (footprint.IsNetTie()) {
        for (const pad of footprint.Pads()) {
          let sameNet = pad.GetNetCode() === aZone.GetNetCode();

          if (!aZone.IsTeardropArea() && aZone.GetNetCode() === 0) sameNet = false;

          if (sameNet) {
            if (pad.IsOnLayer(aLayer)) allowedNetTiePads.add(pad);

            for (const other of footprint.GetNetTiePads(pad)) {
              if (other.IsOnLayer(aLayer)) allowedNetTiePads.add(other);
            }
          }
        }
      }

      for (const item of footprint.GraphicalItems()) {
        const itemBBox = item.GetBoundingBox().Clone();

        if (!zone_boundingbox.Intersects(itemBBox)) continue;

        let skipItem = false;

        if (item.IsOnLayer(aLayer)) {
          const itemShape = item.GetEffectiveShape();

          for (const pad of allowedNetTiePads) {
            if (
              pad.GetBoundingBox().Intersects(itemBBox) &&
              pad.GetEffectiveShape(aLayer).Collide(itemShape)
            ) {
              skipItem = true;
              break;
            }
          }
        }

        if (!skipItem) knockoutGraphicClearance(item);
      }
    }

    for (const item of this.m_board.Drawings()) knockoutGraphicClearance(item);

    // Add non-connected zone clearances
    const knockoutZoneClearance = (aKnockout: ZONE): void => {
      // If the zones share no common layers
      if (!aKnockout.GetLayerSet().Contains(aLayer)) return;

      if (aKnockout.GetIsRuleArea()) {
        if (
          aKnockout.GetBoundingBox().Intersects(zone_boundingbox) &&
          aKnockout.GetDoNotAllowZoneFills() &&
          !aZone.IsTeardropArea()
        ) {
          // Keepouts use outline with no clearance
          aKnockout.TransformSmoothedOutlineToPolygon(
            aHoles,
            0,
            this.m_maxError,
            ERROR_LOC.ERROR_OUTSIDE,
            null,
          );
        }
      } else if (
        aKnockout.HigherPriority(aZone) &&
        !aKnockout.SameNet(aZone) &&
        this.zoneKnockoutMayInteract(aZone, aKnockout)
      ) {
        let gap = Math.max(
          0,
          this.evalRulesForItems(PHYSICAL_CLEARANCE_CONSTRAINT, aZone, aKnockout, aLayer),
        );

        gap = Math.max(gap, this.evalRulesForItems(CLEARANCE_CONSTRAINT, aZone, aKnockout, aLayer));

        // Negative clearance permits zones to short
        if (gap < 0) return;

        const poly = new SHAPE_POLY_SET();
        aKnockout.TransformShapeToPolygon(
          poly,
          aLayer,
          gap + extra_margin,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );
        aHoles.Append(poly);
      }
    };

    if (aIncludeZoneClearances) {
      for (const otherZone of this.m_board.Zones()) knockoutZoneClearance(otherZone);

      for (const footprint of this.m_board.Footprints()) {
        for (const otherZone of footprint.Zones()) knockoutZoneClearance(otherZone);
      }
    }

    aHoles.Simplify();
  }

  /** `buildDifferentNetZoneClearances` (cpp:2597-2650). */
  private buildDifferentNetZoneClearances(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    aHoles: SHAPE_POLY_SET,
  ): void {
    const extra_margin = pcbIUScale.mmToIU(ADVANCED_CFG.GetCfg().m_ExtraClearance);

    // Keepout zones (rule areas) are excluded here because they are subtracted earlier in
    // the fill process, before the deflate/inflate min-width cycle.  Subtracting them here
    // would trigger a second deflate/inflate pass that creates artifacts along curved
    // keepout boundaries (issue 23515).
    const knockoutZoneClearance = (aKnockout: ZONE): void => {
      if (aKnockout.GetIsRuleArea()) return;

      if (!aKnockout.GetLayerSet().Contains(aLayer)) return;

      if (
        aKnockout.HigherPriority(aZone) &&
        !aKnockout.SameNet(aZone) &&
        this.zoneKnockoutMayInteract(aZone, aKnockout)
      ) {
        let gap = Math.max(
          0,
          this.evalRulesForItems(
            DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
            aZone,
            aKnockout,
            aLayer,
          ),
        );

        gap = Math.max(
          gap,
          this.evalRulesForItems(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, aZone, aKnockout, aLayer),
        );

        if (gap < 0) return;

        const poly = new SHAPE_POLY_SET();
        aKnockout.TransformShapeToPolygon(
          poly,
          aLayer,
          gap + extra_margin,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );
        aHoles.Append(poly);
      }
    };

    forEachBoardAndFootprintZone(this.m_board, knockoutZoneClearance);

    aHoles.Simplify();
  }

  /**
   * `subtractHigherPriorityZones` (cpp:2656-2690): the outlines of higher
   * priority same-net zones, which are in charge of the fill inside them.
   */
  private subtractHigherPriorityZones(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    aRawFill: SHAPE_POLY_SET,
  ): void {
    const zoneBBox = aZone.GetBoundingBox().Clone();
    const knockouts = new SHAPE_POLY_SET();

    const collectZoneOutline = (aKnockout: ZONE): void => {
      if (!aKnockout.GetLayerSet().Contains(aLayer)) return;

      if (aKnockout.GetBoundingBox().Intersects(zoneBBox))
        appendZoneOutlineWithoutArcs(aKnockout, knockouts);
    };

    forEachBoardAndFootprintZone(this.m_board, (otherZone: ZONE) => {
      // Don't use `HigherPriority()` here because we only want explicitly-higher
      // priorities, not equal-priority zones.
      const higherPrioritySameNet =
        otherZone.SameNet(aZone) && otherZone.GetAssignedPriority() > aZone.GetAssignedPriority();

      if (higherPrioritySameNet && !otherZone.IsTeardropArea()) collectZoneOutline(otherZone);
    });

    if (knockouts.OutlineCount() > 0) aRawFill.BooleanSubtract(knockouts);
  }

  /** `m_preHatchSolidFillCache`: a hatch zone-layer's fill before the hatch, for the refiller. */
  private m_preHatchSolidFillCache = new Map<ZONE, Map<PCB_LAYER_ID, SHAPE_POLY_SET>>();
  /** `m_sameNetApronCache` (issue 23790). */
  private m_sameNetApronCache = new Map<ZONE, Map<PCB_LAYER_ID, SHAPE_POLY_SET>>();

  /**
   * `connect_nearby_polys` (cpp:2697-2742): zero-width strands between
   * outlines that come within `aDistance`, so the re-inflation joins them.
   * The VERTEX_CONNECTOR walk is `connectNearbyPolys`'s, over the outlines.
   */
  private connect_nearby_polys(aPolys: SHAPE_POLY_SET, aDistance: number): void {
    if (aPolys.OutlineCount() < 1) return;

    const rings: Vec2[][] = [];

    for (let i = 0; i < aPolys.OutlineCount(); i++) rings.push([...aPolys.Outline(i).CPoints()]);

    const connected = connectNearbyPolys(rings, aDistance);

    if (connected === rings) return;

    for (let i = 0; i < connected.length; i++) {
      if (connected[i]!.length === rings[i]!.length) continue;

      const line = new SHAPE_LINE_CHAIN(connected[i]!, true);
      aPolys.Polygon(i)[0] = line;
    }
  }

  /**
   * `postKnockoutMinWidthPrune` (cpp:2758-2802): the min-width cycle again,
   * after a different-net zone's knockout, with the same-net apron unioned in
   * so a shared border is not rounded away.
   */
  private postKnockoutMinWidthPrune(
    aZone: ZONE,
    aFillPolys: SHAPE_POLY_SET,
    aSameNetApron: SHAPE_POLY_SET,
  ): void {
    const half_min_width = Math.trunc(aZone.GetMinThickness() / 2);
    const epsilon = pcbIUScale.mmToIU(0.001);

    if (half_min_width - epsilon <= epsilon) return;

    // Captured before the apron goes in so the closing intersection strips the apron back off
    const preDeflate = aFillPolys.CloneDropTriangulation();

    if (aSameNetApron.OutlineCount() > 0) aFillPolys.BooleanAdd(aSameNetApron);

    aFillPolys.Deflate(
      half_min_width - epsilon,
      CORNER_STRATEGY.CHAMFER_ALL_CORNERS,
      this.m_maxError,
    );

    aFillPolys.Fracture();
    this.connect_nearby_polys(aFillPolys, aZone.GetMinThickness());

    dropThinIslands(aFillPolys, aZone.GetMinThickness());

    aFillPolys.Inflate(
      half_min_width - epsilon,
      CORNER_STRATEGY.ROUND_ALL_CORNERS,
      this.m_maxError,
      true,
    );
    aFillPolys.BooleanIntersection(preDeflate);
  }

  /**
   * `fillCopperZone` (cpp:2820-3214). Note that aSmoothedOutline is larger
   * than the zone where it intersects with other, same-net zones, to keep the
   * min-width re-inflation from carving divots between them; the final
   * aMaxExtents trim removes those areas again.
   */
  private fillCopperZone(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    _aDebugLayer: PCB_LAYER_ID,
    aSmoothedOutline: SHAPE_POLY_SET,
    aMaxExtents: SHAPE_POLY_SET,
    aFillPolys: SHAPE_POLY_SET,
  ): boolean {
    // Features which are min_width should survive pruning; features that are *less* than
    // min_width should not.  Therefore we subtract epsilon from the min_width when
    // deflating/inflating.
    const half_min_width = Math.trunc(aZone.GetMinThickness() / 2);
    const epsilon = pcbIUScale.mmToIU(0.001);

    // ROUND_ALL_CORNERS produces the uniformly nicest shapes, but also a lot of segments.
    // CHAMFER_ALL_CORNERS improves the segment count.
    const fastCornerStrategy = CORNER_STRATEGY.CHAMFER_ALL_CORNERS;
    const cornerStrategy = CORNER_STRATEGY.ROUND_ALL_CORNERS;

    const thermalConnectionPads: BOARD_ITEM[] = [];
    const noConnectionPads: PAD[] = [];
    const solidConnectionItems: BOARD_ITEM[] = [];
    const thermalSpokes: SHAPE_LINE_CHAIN[] = [];
    const clearanceHoles = new SHAPE_POLY_SET();

    aFillPolys.assign(aSmoothedOutline);

    if (this.m_progressReporter?.IsCancelled()) return false;

    // Knockout thermal reliefs.
    this.knockoutThermalReliefs(
      aZone,
      aLayer,
      aFillPolys,
      thermalConnectionPads,
      noConnectionPads,
      solidConnectionItems,
    );

    if (this.m_progressReporter?.IsCancelled()) return false;

    // For hatch zones, add thermal rings around pads with thermal relief.
    // The rings are clipped to the zone boundary and provide the connection point
    // for the hatch webbing instead of connecting directly to the pad.
    const thermalRings = new SHAPE_POLY_SET();

    if (aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN) {
      this.buildHatchZoneThermalRings(
        aZone,
        aLayer,
        aSmoothedOutline,
        thermalConnectionPads,
        aFillPolys,
        thermalRings,
      );
    }

    if (this.m_progressReporter?.IsCancelled()) return false;

    // Knockout electrical clearances.
    //
    // When iterative refill is enabled, we build zone-to-zone clearances separately so we can
    // cache the fill before zone knockouts are applied (issue 21746).  Keepout zones are always
    // included in clearanceHoles regardless of the iterative refill setting so they are
    // subtracted before the deflate/inflate min-width cycle (issue 23515).
    const iterativeRefill = ADVANCED_CFG.GetCfg().m_ZoneFillIterativeRefill;

    this.buildCopperItemClearances(
      aZone,
      aLayer,
      noConnectionPads,
      clearanceHoles,
      !iterativeRefill /* include zone clearances only if not iterative */,
    );

    if (iterativeRefill) {
      const zone_boundingbox = aZone.GetBoundingBox().Clone();
      let addedKeepoutHoles = false;

      const collectKeepoutHoles = (candidate: ZONE): void => {
        if (aZone.IsTeardropArea()) return;

        if (!isZoneFillKeepout(candidate, aLayer, zone_boundingbox)) return;

        candidate.TransformSmoothedOutlineToPolygon(
          clearanceHoles,
          0,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
          null,
        );
        addedKeepoutHoles = true;
      };

      forEachBoardAndFootprintZone(this.m_board, collectKeepoutHoles);

      if (addedKeepoutHoles) clearanceHoles.Simplify();
    }

    if (this.m_progressReporter?.IsCancelled()) return false;

    // Add thermal relief spokes.
    this.buildThermalSpokes(aZone, aLayer, thermalConnectionPads, thermalSpokes);

    if (this.m_progressReporter?.IsCancelled()) return false;

    // Create a temporary zone that we can hit-test spoke-ends against.  It's only temporary
    // because the "real" subtract-clearance-holes has to be done after the spokes are added.
    const USE_BBOX_CACHES = true;
    const testAreas = aFillPolys.CloneDropTriangulation();
    testAreas.BooleanSubtract(clearanceHoles);

    // When iterative refill is enabled, zone-to-zone clearances are not included in
    // clearanceHoles (they're applied later to allow pre-knockout caching).  But we still
    // need to account for them when testing spoke endpoints.
    const zoneClearances = new SHAPE_POLY_SET();

    if (iterativeRefill) {
      this.buildDifferentNetZoneClearances(aZone, aLayer, zoneClearances);

      if (zoneClearances.OutlineCount() > 0) testAreas.BooleanSubtract(zoneClearances);
    }

    // Prune features that don't meet minimum-width criteria
    if (half_min_width - epsilon > epsilon) {
      testAreas.Deflate(half_min_width - epsilon, fastCornerStrategy, this.m_maxError);
      testAreas.Inflate(half_min_width - epsilon, fastCornerStrategy, this.m_maxError);
    }

    if (this.m_progressReporter?.IsCancelled()) return false;

    // Spoke-end-testing is hugely expensive so we generate cached bounding-boxes to speed
    // things up a bit.
    testAreas.BuildBBoxCaches();

    for (const spoke of thermalSpokes) {
      const testPt = spoke.CPoint(3);

      // Hit-test against zone body
      if (testAreas.Contains(testPt, -1, 1, USE_BBOX_CACHES)) {
        aFillPolys.AddOutline(spoke);
        continue;
      }

      // Hit-test against other spokes
      for (const other of thermalSpokes) {
        // Hit test in both directions to avoid interactions with round-off errors.
        // (See https://gitlab.com/kicad/code/kicad/-/issues/13316.)
        if (
          other !== spoke &&
          other.PointInside(testPt, 1, USE_BBOX_CACHES) &&
          spoke.PointInside(other.CPoint(3), 1, USE_BBOX_CACHES)
        ) {
          aFillPolys.AddOutline(spoke);
          break;
        }
      }
    }

    if (this.m_progressReporter?.IsCancelled()) return false;

    aFillPolys.BooleanSubtract(clearanceHoles);

    // Prune features that don't meet minimum-width criteria
    if (half_min_width - epsilon > epsilon) {
      aFillPolys.Deflate(half_min_width - epsilon, fastCornerStrategy, this.m_maxError);

      // Also deflate thermal rings to match, for correct hatch hole notching
      if (thermalRings.OutlineCount() > 0)
        thermalRings.Deflate(half_min_width - epsilon, fastCornerStrategy, this.m_maxError);
    }

    // Min-thickness is the web thickness.  On the other hand, a blob min-thickness by
    // min-thickness is not useful.  Since there's no obvious definition of web vs. blob, we
    // arbitrarily choose "at least 2X min-thickness on one axis".  (Since we're doing this
    // during the deflated state, that means we test for "at least min-thickness".)
    dropThinIslands(aFillPolys, aZone.GetMinThickness());

    if (this.m_progressReporter?.IsCancelled()) return false;

    // Process the hatch pattern (note that we do this while deflated)
    if (
      aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN &&
      (!this.m_board.GetProject() ||
        !this.m_board.GetProject()!.GetLocalSettings().m_PrototypeZoneFill)
    ) {
      // Combine thermal rings with clearance holes (non-connected pad clearances) so that
      // the hatch hole-dropping logic considers both types of rings
      const ringsToProtect = thermalRings.CloneDropTriangulation();
      ringsToProtect.BooleanAdd(clearanceHoles);

      // Drop the hatch hole around each fully connected via so it stays on the webbing.
      // Feed only the hole-drop set, not the fill, so wider vias are left untouched.
      for (const item of solidConnectionItems) {
        if (item.Type() !== KICAD_T.PCB_VIA_T || !item.IsOnLayer(aLayer)) continue;

        const via = item as unknown as PCB_VIA;

        const disc = new SHAPE_POLY_SET();
        TransformCircleToPolygon(
          disc,
          via.GetPosition(),
          Math.trunc(via.GetWidth(aLayer) / 2),
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );
        disc.BooleanIntersection(aSmoothedOutline);
        ringsToProtect.BooleanAdd(disc);
      }

      // The refiller needs the un-hatched extent to re-border zones it later carves (issue 24758).
      if (ADVANCED_CFG.GetCfg().m_ZoneFillIterativeRefill) {
        const solid = aFillPolys.CloneDropTriangulation();

        if (half_min_width - epsilon > epsilon)
          solid.Inflate(half_min_width - epsilon, cornerStrategy, this.m_maxError, true);

        solid.BooleanIntersection(aMaxExtents);
        solid.BooleanSubtract(clearanceHoles);

        zoneLayerCacheSet(this.m_preHatchSolidFillCache, aZone, aLayer, solid);
      }

      if (!this.addHatchFillTypeOnZone(aZone, aLayer, _aDebugLayer, aFillPolys, ringsToProtect))
        return false;
    } else {
      // Connect nearby polygons with zero-width lines in order to ensure correct
      // re-inflation.
      aFillPolys.Fracture();
      this.connect_nearby_polys(aFillPolys, aZone.GetMinThickness());
    }

    if (this.m_progressReporter?.IsCancelled()) return false;

    // Finish minimum-width pruning by re-inflating
    if (half_min_width - epsilon > epsilon)
      aFillPolys.Inflate(half_min_width - epsilon, cornerStrategy, this.m_maxError, true);

    // The deflation/inflation process can leave notches in the outline.  Remove these by
    // doing a union with the original ring
    aFillPolys.BooleanAdd(thermalRings);

    // Ensure additive changes (thermal stubs and inflating acute corners) do not add copper
    // outside the zone boundary, inside the clearance holes, or between otherwise isolated
    // islands
    for (const item of thermalConnectionPads) {
      if (item.Type() === KICAD_T.PCB_PAD_T)
        this.addHoleKnockout(item as unknown as PAD, 0, clearanceHoles);
    }

    aFillPolys.BooleanIntersection(aMaxExtents);
    aFillPolys.BooleanSubtract(clearanceHoles);

    // Cache the pre-knockout fill for iterative refill optimization (issue 21746).
    // The cache stores the fill BEFORE zone-to-zone knockouts so the iterative refill can
    // reclaim space when higher-priority zones have islands removed.
    let knockoutsApplied = false;
    let sameNetApron = new SHAPE_POLY_SET();

    if (iterativeRefill) {
      // The band the aMaxExtents trim just took away but an abutting same-net zone still
      // pours into (issue 23790)
      sameNetApron = aSmoothedOutline.CloneDropTriangulation();
      sameNetApron.BooleanSubtract(aMaxExtents);
      sameNetApron.BooleanSubtract(clearanceHoles);

      zoneLayerCacheSet(
        this.m_preKnockoutFillCache,
        aZone,
        aLayer,
        aFillPolys.CloneDropTriangulation(),
      );
      zoneLayerCacheSet(
        this.m_sameNetApronCache,
        aZone,
        aLayer,
        sameNetApron.CloneDropTriangulation(),
      );

      // Reuse the zone clearances already computed for spoke endpoint testing
      if (zoneClearances.OutlineCount() > 0) {
        aFillPolys.BooleanSubtract(zoneClearances);
        sameNetApron.BooleanSubtract(zoneClearances);
        knockoutsApplied = true;
      }
    }

    // Re-prune minimum-width violations introduced by different-net zone knockouts.
    //
    // This must run BEFORE subtracting same-net higher-priority zones.  The fill no longer
    // reaches into overlapping same-net zone areas once trimmed to aMaxExtents, so
    // sameNetApron stands in for that overlap and keeps the deflate/inflate cycle from
    // carving divots at same-net zone boundaries.
    if (knockoutsApplied) this.postKnockoutMinWidthPrune(aZone, aFillPolys, sameNetApron);

    // Lastly give any same-net but higher-priority zones control over their own area.
    this.subtractHigherPriorityZones(aZone, aLayer, aFillPolys);

    dropSubResolutionOutlines(aFillPolys, this.m_maxError);

    aFillPolys.Fracture();
    return true;
  }

  /** `fillNonCopperZone` (cpp:3218-3324): a technical-layer zone, minus knockout items and keepouts. */
  private fillNonCopperZone(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    aSmoothedOutline: SHAPE_POLY_SET,
    aFillPolys: SHAPE_POLY_SET,
  ): boolean {
    const zone_boundingbox = aZone.GetBoundingBox().Clone();
    const clearanceHoles = new SHAPE_POLY_SET();

    const knockoutGraphicItem = (aItem: BOARD_ITEM): void => {
      if (
        aItem.IsKnockout() &&
        aItem.IsOnLayer(aLayer) &&
        aItem.GetBoundingBox().Intersects(zone_boundingbox)
      ) {
        this.addGraphicKnockout(aItem, aLayer, 0, true, clearanceHoles);
      }
    };

    for (const footprint of this.m_board.Footprints()) {
      if (this.m_progressReporter?.IsCancelled()) return false;

      knockoutGraphicItem(footprint.Reference());
      knockoutGraphicItem(footprint.Value());

      for (const item of footprint.GraphicalItems()) knockoutGraphicItem(item);
    }

    for (const item of this.m_board.Drawings()) knockoutGraphicItem(item);

    aFillPolys.assign(aSmoothedOutline);
    aFillPolys.BooleanSubtract(clearanceHoles);

    const keepoutHoles = new SHAPE_POLY_SET();

    forEachBoardAndFootprintZone(this.m_board, (candidate: ZONE) => {
      if (!isZoneFillKeepout(candidate, aLayer, zone_boundingbox)) return;

      appendZoneOutlineWithoutArcs(candidate, keepoutHoles);
    });

    if (keepoutHoles.OutlineCount() > 0) aFillPolys.BooleanSubtract(keepoutHoles);

    // Features which are min_width should survive pruning; features that are *less* than
    // min_width should not.  Therefore we subtract epsilon from the min_width when
    // deflating/inflating.
    const half_min_width = Math.trunc(aZone.GetMinThickness() / 2);
    const epsilon = pcbIUScale.mmToIU(0.001);

    aFillPolys.Deflate(
      half_min_width - epsilon,
      CORNER_STRATEGY.CHAMFER_ALL_CORNERS,
      this.m_maxError,
    );

    // Remove the non filled areas due to the hatch pattern
    if (aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN) {
      const noThermalRings = new SHAPE_POLY_SET(); // Non-copper zones have no thermal reliefs

      if (!this.addHatchFillTypeOnZone(aZone, aLayer, aLayer, aFillPolys, noThermalRings))
        return false;
    }

    // Re-inflate after pruning of areas that don't meet minimum-width criteria
    if (half_min_width - epsilon > epsilon)
      aFillPolys.Inflate(
        half_min_width - epsilon,
        CORNER_STRATEGY.ROUND_ALL_CORNERS,
        this.m_maxError,
      );

    aFillPolys.Fracture();
    return true;
  }

  /** `fillSingleZone` (cpp:3331-3361): one zone-layer, copper or not. */
  private fillSingleZone(aZone: ZONE, aLayer: PCB_LAYER_ID, aFillPolys: SHAPE_POLY_SET): boolean {
    const boardOutline = this.m_brdOutlinesValid ? this.m_boardOutline : null;
    const maxExtents = new SHAPE_POLY_SET();
    const smoothedPoly = new SHAPE_POLY_SET();
    let debugLayer = PCB_LAYER_ID.UNDEFINED_LAYER;

    if (this.m_debugZoneFiller && LSET.InternalCuMask().Contains(aLayer)) {
      debugLayer = aLayer;
      aLayer = PCB_LAYER_ID.F_Cu;
    }

    if (!aZone.BuildSmoothedPoly(maxExtents, aLayer, boardOutline, smoothedPoly)) return false;

    if (this.m_progressReporter?.IsCancelled()) return false;

    if (aZone.IsOnCopperLayer()) {
      if (this.fillCopperZone(aZone, aLayer, debugLayer, smoothedPoly, maxExtents, aFillPolys))
        aZone.SetNeedRefill(false);
    } else if (this.fillNonCopperZone(aZone, aLayer, smoothedPoly, aFillPolys)) {
      aZone.SetNeedRefill(false);
    }

    return true;
  }

  /**
   * `buildThermalSpokes` (cpp:3367-3740): square-ended segments from the pad
   * centre to just outside the thermal relief. The outside end has an extra
   * centre point, at idx 3, which tests whether the spoke reaches the zone.
   */
  private buildThermalSpokes(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    aSpokedPadsList: readonly BOARD_ITEM[],
    aSpokesList: SHAPE_LINE_CHAIN[],
  ): void {
    const bds = this.m_board.GetDesignSettings();
    const drc = bds.m_DRCEngine!;
    const zoneBB = aZone.GetBoundingBox().Clone();
    let constraint: DRC_CONSTRAINT;
    let zone_half_width = Math.trunc(aZone.GetMinThickness() / 2);

    if (aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN)
      zone_half_width = Math.trunc(aZone.GetHatchThickness() / 2);

    zoneBB.Inflate(Math.max(bds.GetBiggestClearanceValue(), aZone.GetLocalClearance()!));

    // Is a point on the boundary of the polygon inside or outside?
    // The boundary may be off by MaxError
    const epsilon = bds.m_MaxError;

    for (const item of aSpokedPadsList) {
      // We currently only connect to pads, not pad holes
      if (!item.IsOnLayer(aLayer)) continue;

      let thermalReliefGap = 0;
      let spoke_w = 0;
      let pad: PAD | null = null;
      let via: PCB_VIA | null = null;
      let circular = false;

      if (item.Type() === KICAD_T.PCB_PAD_T) {
        pad = item as unknown as PAD;
        const padSize = pad.GetSize(aLayer);

        if (
          pad.GetShape(aLayer) === PAD_SHAPE.CIRCLE ||
          (pad.GetShape(aLayer) === PAD_SHAPE.OVAL && padSize.x === padSize.y)
        ) {
          circular = true;
        }
      } else if (item.Type() === KICAD_T.PCB_VIA_T) {
        via = item as unknown as PCB_VIA;
        circular = true;
      }

      // For hatch zones, use proper DRC constraints for thermal gap and spoke width,
      // just like solid zones. This ensures consistent thermal relief appearance and
      // respects pad-specific thermal spoke settings.
      if (aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN) {
        if (pad) {
          constraint = drc.EvalRules(
            DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
            pad,
            aZone,
            aLayer,
          );
          thermalReliefGap = constraint.GetValue().Min();

          constraint = drc.EvalRules(
            DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT,
            pad,
            aZone,
            aLayer,
          );
          spoke_w = constraint.GetValue().Opt();

          const spoke_max_allowed_w = Math.min(pad.GetSize(aLayer).x, pad.GetSize(aLayer).y);
          spoke_w = stdClamp(spoke_w, constraint.Value().Min(), constraint.Value().Max());
          spoke_w = Math.min(spoke_w, spoke_max_allowed_w);

          if (spoke_w < aZone.GetMinThickness()) continue;
        } else if (via) {
          constraint = drc.EvalRules(
            DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
            via,
            aZone,
            aLayer,
          );
          thermalReliefGap = constraint.GetValue().Min();

          constraint = drc.EvalRules(
            DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT,
            via,
            aZone,
            aLayer,
          );
          spoke_w = constraint.GetValue().Opt();

          spoke_w = Math.min(spoke_w, via.GetWidth(aLayer));

          if (spoke_w < aZone.GetMinThickness()) continue;
        } else {
          continue;
        }
      } else if (pad) {
        constraint = drc.EvalRules(
          DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
          pad,
          aZone,
          aLayer,
        );
        thermalReliefGap = constraint.GetValue().Min();

        constraint = drc.EvalRules(
          DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT,
          pad,
          aZone,
          aLayer,
        );
        spoke_w = constraint.GetValue().Opt();

        // Spoke width should ideally be smaller than the pad minor axis.
        // Otherwise the thermal shape is not really a thermal relief,
        // and the algo to count the actual number of spokes can fail
        const spoke_max_allowed_w = Math.min(pad.GetSize(aLayer).x, pad.GetSize(aLayer).y);

        spoke_w = stdClamp(spoke_w, constraint.Value().Min(), constraint.Value().Max());

        // ensure the spoke width is smaller than the pad minor size
        spoke_w = Math.min(spoke_w, spoke_max_allowed_w);

        // Cannot create stubs having a width < zone min thickness
        if (spoke_w < aZone.GetMinThickness()) continue;
      } else {
        // We don't currently support via thermal connections *except* in a hatched zone.
        continue;
      }

      const spoke_half_w = Math.trunc(spoke_w / 2);

      // Quick test here to possibly save us some work
      const itemBB = item.GetBoundingBox().Clone();
      itemBB.Inflate(thermalReliefGap + epsilon);

      if (!itemBB.Intersects(zoneBB)) continue;

      let customSpokes = false;

      if (pad && pad.GetShape(aLayer) === PAD_SHAPE.CUSTOM) {
        for (const primitive of pad.GetPrimitives(aLayer)) {
          if (primitive.IsProxyItem() && primitive.GetShape() === SHAPE_T.SEGMENT) {
            customSpokes = true;
            break;
          }
        }
      }

      const buildSpokesFromOrigin = (box: BOX2I, angle: EDA_ANGLE): void => {
        const center = box.GetCenter();
        const half_size = VECTOR2I(KiROUND(box.GetWidth() / 2.0), KiROUND(box.GetHeight() / 2.0));

        // Function to find intersection of line with box edge
        const intersectBBox = (spokeAngle: EDA_ANGLE): [VECTOR2I, VECTOR2I] => {
          const dx = spokeAngle.Cos();
          const dy = spokeAngle.Sin();

          // Short-circuit the axis cases because they will be degenerate in the
          // intersection test
          if (dx === 0) return [VECTOR2I(0, KiROUND(dy * half_size.y)), VECTOR2I(spoke_half_w, 0)];

          if (dy === 0) return [VECTOR2I(KiROUND(dx * half_size.x), 0), VECTOR2I(0, spoke_half_w)];

          // We are going to intersect with one side or the other.  Whichever
          // we hit first is the fraction of the spoke length we keep
          const dist_x = half_size.x / Math.abs(dx);
          const dist_y = half_size.y / Math.abs(dy);

          if (dist_x < dist_y) {
            return [
              VECTOR2I(KiROUND(dx * dist_x), KiROUND(dy * dist_x)),
              VECTOR2I(0, KiROUND(spoke_half_w / ANGLE_90.sub(spokeAngle).Sin())),
            ];
          }

          return [
            VECTOR2I(KiROUND(dx * dist_y), KiROUND(dy * dist_y)),
            VECTOR2I(KiROUND(spoke_half_w / spokeAngle.Sin()), 0),
          ];
        };

        // Precalculate angles for four cardinal directions
        const angles = [
          new EDA_ANGLE(0.0).add(angle), // Right
          new EDA_ANGLE(90.0).add(angle), // Up
          new EDA_ANGLE(180.0).add(angle), // Left
          new EDA_ANGLE(270.0).add(angle), // Down
        ];

        // Generate four spokes in cardinal directions
        for (const spokeAngle of angles) {
          const [intersection, spoke_side] = intersectBBox(spokeAngle);

          const spoke = new SHAPE_LINE_CHAIN();
          spoke.Append(add(center, spoke_side));
          spoke.Append(sub(center, spoke_side));
          spoke.Append(sub(add(center, intersection), spoke_side));
          spoke.Append(add(center, intersection)); // test pt
          spoke.Append(add(add(center, intersection), spoke_side));
          spoke.SetClosed(true);
          aSpokesList.push(spoke);
        }
      };

      if (customSpokes) {
        const thermalPoly = new SHAPE_POLY_SET();
        let thermalOutline = new SHAPE_LINE_CHAIN();

        pad!.TransformShapeToPolygon(
          thermalPoly,
          aLayer,
          thermalReliefGap + epsilon,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );

        if (thermalPoly.OutlineCount()) thermalOutline = thermalPoly.Outline(0);

        const padPoly = pad!.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_OUTSIDE);
        const padOutline = padPoly.Outline(0);

        const trimToOutline = (aSegment: SEG): boolean => {
          let intersections: INTERSECTIONS = [];

          if (padOutline.Intersect(aSegment, intersections)) {
            intersections = [];

            // Trim the segment to the thermal outline
            if (thermalOutline.Intersect(aSegment, intersections)) {
              aSegment.B = intersections[0]!.p;
              return true;
            }
          }

          return false;
        };

        for (const primitive of pad!.GetPrimitives(aLayer)) {
          if (!primitive.IsProxyItem() || primitive.GetShape() !== SHAPE_T.SEGMENT) continue;

          const seg = new SEG(primitive.GetStart(), primitive.GetEnd());

          seg.A = RotatePoint(seg.A, pad!.GetOrientation());
          seg.B = RotatePoint(seg.B, pad!.GetOrientation());
          seg.A = add(seg.A, pad!.ShapePos(aLayer));
          seg.B = add(seg.B, pad!.ShapePos(aLayer));

          // Make sure seg.A is the origin
          if (!padPoly.Contains(seg.A)) {
            // Do not create this spoke if neither point is in the pad.
            if (!padPoly.Contains(seg.B)) continue;

            seg.Reverse();
          }

          // Trim segment to pad and thermal outline polygon.
          // If there is no intersection with the pad, don't create the spoke.
          if (!trimToOutline(seg)) continue;

          let direction = ResizeI(sub(seg.B, seg.A), spoke_half_w);
          const offset = ResizeI(Perpendicular(direction), spoke_half_w);
          // Extend the spoke edges by half the spoke width to capture convex pad shapes
          // with a maximum of 45 degrees.
          const segL = new SEG(
            sub(sub(seg.A, direction), offset),
            sub(add(seg.B, direction), offset),
          );
          const segR = new SEG(
            add(sub(seg.A, direction), offset),
            add(add(seg.B, direction), offset),
          );

          // Only create this spoke if both edges intersect the pad and thermal outline
          if (trimToOutline(segL) && trimToOutline(segR)) {
            // Extend the spoke by the minimum thickness for the zone to ensure full
            // connection width
            direction = ResizeI(direction, aZone.GetMinThickness());

            const spoke = new SHAPE_LINE_CHAIN();

            spoke.Append(add(seg.A, offset));
            spoke.Append(sub(seg.A, offset));

            spoke.Append(add(segL.B, direction));
            spoke.Append(add(seg.B, direction)); // test pt at index 3.
            spoke.Append(add(segR.B, direction));

            spoke.SetClosed(true);
            aSpokesList.push(spoke);
          }
        }
      } else {
        // Use pad's thermal spoke angle for both solid and hatch zones.
        // This ensures custom thermal spoke templates are respected.
        const thermalSpokeAngle = pad ? pad.GetThermalSpokeAngle() : ANGLE_0;

        let spokesBox = new BOX2I();
        let position = VECTOR2I(0, 0);
        let orientation = ANGLE_0;

        // Since the bounding-box needs to be correclty rotated we use a dummy pad to keep
        // from dirtying the real pad's cached shapes.
        if (pad) {
          const dummy_pad = pad.Clone();
          dummy_pad.SetOrientation(ANGLE_0);

          // Spokes are from center of pad shape, not from hole. So the dummy pad has no shape
          // offset and is at position 0,0
          dummy_pad.SetPosition(VECTOR2I(0, 0));
          dummy_pad.SetOffset(aLayer, VECTOR2I(0, 0));

          spokesBox = dummy_pad.GetBoundingBox(aLayer).Clone();
          position = pad.ShapePos(aLayer);
          orientation = pad.GetOrientation();
        } else if (via) {
          const dummy_via = via.Clone();
          dummy_via.SetPosition(VECTOR2I(0, 0));

          spokesBox = dummy_via.GetBoundingBox(aLayer).Clone();
          position = via.GetPosition();
        }

        // Add half the zone mininum width to the inflate amount to account for the fact that
        // the deflation procedure will shrink the results by half the half the zone min width.
        spokesBox.Inflate(thermalReliefGap + epsilon + zone_half_width);

        // Yet another wrinkle: the bounding box for circles will overshoot the mark
        // considerably when the spokes are near a 45 degree increment.  So we build the
        // spokes at 0 degrees and then rotate them to the correct position.
        if (circular) {
          buildSpokesFromOrigin(spokesBox, ANGLE_0);

          if (!thermalSpokeAngle.equals(ANGLE_0)) {
            // Rotate the last four elements of aspokeslist
            for (let ii = aSpokesList.length - 1; ii >= aSpokesList.length - 4; ii--)
              aSpokesList[ii]!.Rotate(thermalSpokeAngle);
          }
        } else {
          buildSpokesFromOrigin(spokesBox, thermalSpokeAngle);
        }

        for (let ii = aSpokesList.length - 1; ii >= aSpokesList.length - 4; ii--) {
          aSpokesList[ii]!.Rotate(orientation);
          aSpokesList[ii]!.Move(position);
        }
      }
    }

    for (const spoke of aSpokesList) spoke.GenerateBBoxCache();
  }

  /**
   * `buildHatchZoneThermalRings` (cpp:3743-3851): in a hatch zone, a ring
   * around each thermal pad or via that the webbing connects to instead of
   * the pad itself, clipped to the zone.
   */
  private buildHatchZoneThermalRings(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    aSmoothedOutline: SHAPE_POLY_SET,
    aThermalConnectionPads: readonly BOARD_ITEM[],
    aFillPolys: SHAPE_POLY_SET,
    aThermalRings: SHAPE_POLY_SET,
  ): void {
    const drc = this.m_board.GetDesignSettings().m_DRCEngine!;
    let constraint: DRC_CONSTRAINT;

    for (const item of aThermalConnectionPads) {
      if (!item.IsOnLayer(aLayer)) continue;

      let pad: PAD | null = null;
      let isCircular = false;
      let thermalGap = 0;
      let spokeWidth = 0;
      let position = VECTOR2I(0, 0);
      let padRadius = 0;

      if (item.Type() === KICAD_T.PCB_PAD_T) {
        pad = item as unknown as PAD;
        const padSize = pad.GetSize(aLayer);
        position = pad.ShapePos(aLayer);

        isCircular =
          pad.GetShape(aLayer) === PAD_SHAPE.CIRCLE ||
          (pad.GetShape(aLayer) === PAD_SHAPE.OVAL && padSize.x === padSize.y);

        if (isCircular) padRadius = Math.trunc(Math.max(padSize.x, padSize.y) / 2);

        constraint = drc.EvalRules(
          DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
          pad,
          aZone,
          aLayer,
        );
        thermalGap = constraint.GetValue().Min();

        constraint = drc.EvalRules(
          DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT,
          pad,
          aZone,
          aLayer,
        );
        spokeWidth = constraint.GetValue().Opt();

        // Clamp spoke width to pad size
        const spokeMaxWidth = Math.min(padSize.x, padSize.y);
        spokeWidth = Math.min(spokeWidth, spokeMaxWidth);
      } else if (item.Type() === KICAD_T.PCB_VIA_T) {
        const via = item as unknown as PCB_VIA;
        position = via.GetPosition();
        isCircular = true;
        padRadius = Math.trunc(via.GetWidth(aLayer) / 2);

        constraint = drc.EvalRules(
          DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
          via,
          aZone,
          aLayer,
        );
        thermalGap = constraint.GetValue().Min();

        constraint = drc.EvalRules(
          DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT,
          via,
          aZone,
          aLayer,
        );
        spokeWidth = constraint.GetValue().Opt();

        // Clamp spoke width to via diameter
        spokeWidth = Math.min(spokeWidth, padRadius * 2);
      } else {
        continue;
      }

      // Don't create a ring if spoke width is too small
      if (spokeWidth < aZone.GetMinThickness()) continue;

      let thermalRing = new SHAPE_POLY_SET();

      if (isCircular) {
        // For circular pads/vias: create an arc ring
        // Ring inner radius = pad radius + thermal gap
        // Ring width = spoke width
        const ringInnerRadius = padRadius + thermalGap;
        const ringWidth = spokeWidth;

        TransformRingToPolygon(
          thermalRing,
          position,
          ringInnerRadius + Math.trunc(ringWidth / 2),
          ringWidth,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );
      } else {
        // For non-circular pads: create ring by inflating pad to outer radius,
        // then subtracting pad inflated to inner radius
        const outerShape = new SHAPE_POLY_SET();
        const innerShape = new SHAPE_POLY_SET();

        // Outer ring edge = pad + thermal gap + spoke width
        pad!.TransformShapeToPolygon(
          outerShape,
          aLayer,
          thermalGap + spokeWidth,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );

        // Inner ring edge = pad + thermal gap (this is already knocked out)
        pad!.TransformShapeToPolygon(
          innerShape,
          aLayer,
          thermalGap,
          this.m_maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );

        thermalRing = outerShape;
        thermalRing.BooleanSubtract(innerShape);
      }

      // Clip the thermal ring to the zone boundary so it doesn't overflow
      thermalRing.BooleanIntersection(aSmoothedOutline);

      // Add the thermal ring to the fill
      aFillPolys.BooleanAdd(thermalRing);

      // Also collect thermal rings for hatch hole notching to ensure connectivity
      aThermalRings.BooleanAdd(thermalRing);
    }
  }

  /**
   * `addHatchFillTypeOnZone` (cpp:3854-4047): cut a grid of holes out of the
   * DEFLATED fill so only its webbing is left. `maxError` is a local that the
   * hole smoothing reassigns, and the two deflates below use that value.
   */
  private addHatchFillTypeOnZone(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    _aDebugLayer: PCB_LAYER_ID,
    aFillPolys: SHAPE_POLY_SET,
    aThermalRings: SHAPE_POLY_SET,
  ): boolean {
    // obviously line thickness must be > zone min thickness.
    // It can happens if a board file was edited by hand by a python script
    // Use 1 micron margin to be *sure* there is no issue in Gerber files
    // (Gbr file unit = 1 or 10 nm) due to some truncation in coordinates or calculations
    // This margin also avoid problems due to rounding coordinates in next calculations
    // that can create incorrect polygons
    const thickness = Math.max(
      aZone.GetHatchThickness(),
      aZone.GetMinThickness() + pcbIUScale.mmToIU(0.001),
    );

    const gridsize = thickness + aZone.GetHatchGap();
    let maxError = this.m_board.GetDesignSettings().m_MaxError;

    const filledPolys = aFillPolys.CloneDropTriangulation();
    // Use a area that contains the rotated bbox by orientation, and after rotate the result
    // by -orientation.
    if (!aZone.GetHatchOrientation().IsZero())
      filledPolys.Rotate(aZone.GetHatchOrientation().negate());

    const bbox = filledPolys.BBox(0);

    // Build hole shape
    // the hole size is aZone->GetHatchGap(), but because the outline thickness
    // is aZone->GetMinThickness(), the hole shape size must be larger
    let hole_base = new SHAPE_LINE_CHAIN();
    const hole_size = aZone.GetHatchGap() + aZone.GetMinThickness();
    hole_base.Append(VECTOR2I(0, 0));
    hole_base.Append(VECTOR2I(hole_size, 0));
    hole_base.Append(VECTOR2I(hole_size, hole_size));
    hole_base.Append(VECTOR2I(0, hole_size));
    hole_base.SetClosed(true);

    // Calculate minimal area of a grid hole.
    // All holes smaller than a threshold will be removed
    const minimal_hole_area = hole_base.Area() * aZone.GetHatchHoleMinArea();

    // Now convert this hole to a smoothed shape:
    if (aZone.GetHatchSmoothingLevel() > 0) {
      // the actual size of chamfer, or rounded corner radius is the half size
      // of the HatchFillTypeGap scaled by aZone->GetHatchSmoothingValue()
      // aZone->GetHatchSmoothingValue() = 1.0 is the max value for the chamfer or the
      // radius of corner (radius = half size of the hole)
      let smooth_value = KiROUND((aZone.GetHatchGap() * aZone.GetHatchSmoothingValue()) / 2);

      // Minimal optimization:
      // make smoothing only for reasonable smooth values, to avoid a lot of useless segments
      // and if the smooth value is small, use chamfer even if fillet is requested
      const SMOOTH_MIN_VAL_MM = 0.02;
      const SMOOTH_SMALL_VAL_MM = 0.04;

      if (smooth_value > pcbIUScale.mmToIU(SMOOTH_MIN_VAL_MM)) {
        const smooth_hole = new SHAPE_POLY_SET();
        smooth_hole.AddOutline(hole_base);
        let smooth_level = aZone.GetHatchSmoothingLevel();

        if (smooth_value < pcbIUScale.mmToIU(SMOOTH_SMALL_VAL_MM) && smooth_level > 1)
          smooth_level = 1;

        // Use a larger smooth_value to compensate the outline tickness
        // (chamfer is not visible is smooth value < outline thickess)
        smooth_value += Math.trunc(aZone.GetMinThickness() / 2);

        // smooth_value cannot be bigger than the half size oh the hole:
        smooth_value = Math.min(smooth_value, Math.trunc(aZone.GetHatchGap() / 2));

        // the error to approximate a circle by segments when smoothing corners by a arc
        maxError = Math.max(maxError * 2, Math.trunc(smooth_value / 20));

        switch (smooth_level) {
          case 1:
            // Chamfer() uses the distance from a corner to create a end point
            // for the chamfer.
            hole_base = smooth_hole.Chamfer(smooth_value).Outline(0);
            break;

          default:
            if (aZone.GetHatchSmoothingLevel() > 2) maxError = Math.trunc(maxError / 2); // Force better smoothing

            hole_base = smooth_hole.Fillet(smooth_value, maxError).Outline(0);
            break;

          case 0:
            break;
        }
      }
    }

    // Build holes
    const holes = new SHAPE_POLY_SET();

    const defaultOffsets = this.m_board.GetDesignSettings().m_ZoneLayerProperties;
    const localOffsets = aZone.LayerProperties();

    let offset = defaultOffsets.get(aLayer)?.hatching_offset ?? VECTOR2I(0, 0);

    const local = localOffsets.get(aLayer)?.hatching_offset;

    if (local !== undefined && local !== null) offset = local;

    const x_offset = bbox.GetX() - (bbox.GetX() % gridsize) - gridsize;
    const y_offset = bbox.GetY() - (bbox.GetY() % gridsize) - gridsize;

    for (let xx = x_offset; xx <= bbox.GetRight(); xx += gridsize) {
      for (let yy = y_offset; yy <= bbox.GetBottom(); yy += gridsize) {
        // Generate hole
        const hole = hole_base.Clone() as SHAPE_LINE_CHAIN;
        hole.Move(VECTOR2I(xx, yy));

        if (!aZone.GetHatchOrientation().IsZero()) hole.Rotate(aZone.GetHatchOrientation());

        hole.Move(VECTOR2I(offset.x % gridsize, offset.y % gridsize));

        holes.AddOutline(hole);
      }
    }

    holes.ClearArcs();

    let deflated_thickness = aZone.GetHatchThickness() - aZone.GetMinThickness();

    // Don't let thickness drop below maxError * 2 or it might not get reinflated.
    deflated_thickness = Math.max(deflated_thickness, maxError * 2);

    // The fill has already been deflated to ensure GetMinThickness() so we just have to
    // account for anything beyond that.
    const deflatedFilledPolys = aFillPolys.CloneDropTriangulation();
    deflatedFilledPolys.ClearArcs();
    deflatedFilledPolys.Deflate(deflated_thickness, CORNER_STRATEGY.CHAMFER_ALL_CORNERS, maxError);
    holes.BooleanIntersection(deflatedFilledPolys);

    const deflatedOutline = aZone.Outline().CloneDropTriangulation();
    deflatedOutline.ClearArcs();
    deflatedOutline.Deflate(aZone.GetMinThickness(), CORNER_STRATEGY.CHAMFER_ALL_CORNERS, maxError);
    holes.BooleanIntersection(deflatedOutline);

    // Now filter truncated holes to avoid small holes in pattern
    // It happens for holes near the zone outline
    for (let ii = 0; ii < holes.OutlineCount(); ) {
      const area = holes.Outline(ii).Area();

      if (area < minimal_hole_area) holes.DeletePolygon(ii);
      else ++ii;
    }

    // Drop any holes that completely enclose a thermal ring to ensure thermal reliefs
    // stay connected to the hatch webbing. Only drop holes where the thermal ring is
    // entirely inside the hole; partial overlaps are kept to preserve the hatch pattern.
    if (aThermalRings.OutlineCount() > 0) {
      const thermalBBox = aThermalRings.BBox();

      // Iterate through holes (backwards since we may delete)
      for (let holeIdx = holes.OutlineCount() - 1; holeIdx >= 0; holeIdx--) {
        const hole = holes.Outline(holeIdx);
        const holeBBox = hole.BBox();

        // Quick rejection: skip if hole bbox doesn't intersect thermal rings bbox
        if (!holeBBox.Intersects(thermalBBox)) continue;

        // Check if ANY thermal ring is completely enclosed by this hole
        for (let ringIdx = 0; ringIdx < aThermalRings.OutlineCount(); ringIdx++) {
          const ring = aThermalRings.Outline(ringIdx);
          const ringBBox = ring.BBox();
          const ringCenter = ringBBox.Centre();

          // Quick rejection: hole bbox must contain ring bbox
          if (!holeBBox.Contains(ringBBox)) continue;

          // Check 1: Is the ring center inside the hole?
          if (!hole.PointInside(ringCenter)) continue;

          // Check 2: Is at least one point on the ring inside the hole?
          if (ring.PointCount() === 0 || !hole.PointInside(ring.CPoint(0))) continue;

          // Check 3: Does the ring outline NOT intersect the hole outline?
          // If there's no intersection, the ring is fully enclosed (not touching edges)
          const intersections: INTERSECTIONS = [];
          ring.Intersect(hole, intersections);

          if (intersections.length === 0) {
            // This hole completely encloses a ring - drop it
            holes.DeletePolygon(holeIdx);
            break; // Move to next hole
          }
        }
      }
    }

    // create grid. Useto
    // generate strictly simple polygons needed by Gerber files and Fracture()
    aFillPolys.BooleanSubtract(holes);

    return true;
  }

  /**
   * `m_refillResultCache`: (zone, layer) → the knockout-geometry hash and the
   * fill it gave. A hit lets an unchanged-knockout zone skip the subtract and
   * prune. Cleared each Fill(). `HASH_128` is a hex string here, so the two
   * hashes joined in order are the order-preserving combine.
   */
  private m_refillResultCache = new Map<ZONE, Map<PCB_LAYER_ID, [string, SHAPE_POLY_SET]>>();

  /**
   * `refillZoneFromCache` (cpp:4084-4304): re-apply only the higher-priority
   * zone knockouts to the cached pre-knockout fill. With `aSnapshot`, other
   * zones' fills come from the pre-wave snapshot rather than the live zones.
   */
  private refillZoneFromCache(
    aZone: ZONE,
    aLayer: PCB_LAYER_ID,
    aFillPolys: SHAPE_POLY_SET,
    aSnapshot: FillSnapshot | null = null,
  ): boolean {
    const cached = this.m_preKnockoutFillCache.get(aZone)?.get(aLayer);

    if (!cached) return false;

    // Restore the cached pre-knockout fill
    aFillPolys.assign(cached);

    // Subtract the FILLED area of higher-priority zones (with clearance for different nets).
    // For same-net zones: subtract the filled area directly.
    // For different-net zones: subtract the filled area with DRC-evaluated clearance plus
    // extra_margin and m_maxError to match the margins used in the initial fill. Without these
    // margins, polygon approximation error can produce fills that violate clearance (issue 23053).
    const extra_margin = pcbIUScale.mmToIU(ADVANCED_CFG.GetCfg().m_ExtraClearance);
    const zoneBBox = aZone.GetBoundingBox().Clone();
    zoneBBox.Inflate(this.m_worstClearance + extra_margin);

    let knockoutsApplied = false;
    const diffNetKnockouts = new SHAPE_POLY_SET();
    const sameNetKnockouts = new SHAPE_POLY_SET();

    const collectZoneKnockout = (otherZone: ZONE): void => {
      if (otherZone === aZone) return;

      if (!otherZone.GetLayerSet().Contains(aLayer)) return;

      if (otherZone.IsTeardropArea() && otherZone.SameNet(aZone)) return;

      if (!otherZone.HigherPriority(aZone)) return;

      // Same gate as the initial fill so the refill's knockout set matches; same-net
      // fills are subtracted un-inflated, so a plain bbox test suffices.
      if (otherZone.SameNet(aZone)) {
        if (!otherZone.GetBoundingBox().Intersects(zoneBBox)) return;
      } else if (!this.zoneKnockoutMayInteract(aZone, otherZone)) {
        return;
      }

      // Resolve the fill to use: from the snapshot when provided, otherwise the live fill.
      // The snapshot ensures all parallel tasks in a wave read a consistent pre-wave state
      // so no task can block another by writing a larger fill first.
      let fill: SHAPE_POLY_SET | undefined;

      if (aSnapshot) {
        fill = aSnapshot.get(otherZone)?.get(aLayer);

        if (!fill) return; // not filled at snapshot time; skip
      } else {
        if (!otherZone.HasFilledPolysForLayer(aLayer)) return;

        fill = otherZone.GetFilledPolysList(aLayer);

        if (!fill) return;
      }

      if (fill.OutlineCount() === 0) return;

      if (otherZone.SameNet(aZone)) {
        // Equal priorities tie-break on UUID in HigherPriority(). The initial fill
        // only gives strictly-higher zones their outline.
        const ownsOutline =
          otherZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN &&
          otherZone.GetAssignedPriority() > aZone.GetAssignedPriority();

        if (ownsOutline) appendZoneOutlineWithoutArcs(otherZone, sameNetKnockouts);
        else sameNetKnockouts.Append(fill);
      } else {
        let gap = Math.max(
          0,
          this.evalRulesForItems(
            DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
            aZone,
            otherZone,
            aLayer,
          ),
        );

        gap = Math.max(
          gap,
          this.evalRulesForItems(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, aZone, otherZone, aLayer),
        );

        if (gap < 0) return;

        const inflatedFill = fill.CloneDropTriangulation();
        inflatedFill.Inflate(
          gap + extra_margin + this.m_maxError,
          CORNER_STRATEGY.ROUND_ALL_CORNERS,
          this.m_maxError,
        );
        diffNetKnockouts.Append(inflatedFill);
        knockoutsApplied = true;
      }
    };

    forEachBoardAndFootprintZone(this.m_board, collectZoneKnockout);

    // Refill output is a pure function of the (fill-constant) pre-knockout fill and these
    // knockouts; hash them and skip the subtract + min-width prune below on a cache hit.
    // Order-preserving combine, not XOR: diff-net (inflated/pruned) and same-net knockouts
    // must stay distinct in the key.
    const knockoutHash = `${diffNetKnockouts.GetHash()}:${sameNetKnockouts.GetHash()}`;
    const hit = this.m_refillResultCache.get(aZone)?.get(aLayer);

    if (hit && hit[0] === knockoutHash) {
      aFillPolys.assign(hit[1]);
      return true;
    }

    // Keepout zones are not collected here because they are already baked into the cached
    // pre-knockout fill.  They were subtracted before the initial deflate/inflate min-width
    // cycle so the cached fill already reflects keepout boundaries (issue 23515).

    // Subtract different-net knockouts first, then re-prune min-width violations BEFORE
    // subtracting same-net knockouts.  The cached fill was already trimmed to the zone
    // outline, so the prune needs the cached apron to stand in for the overlap with abutting
    // same-net zones and keep the deflate/inflate cycle from carving divots at their shared
    // boundaries.
    if (diffNetKnockouts.OutlineCount() > 0) aFillPolys.BooleanSubtract(diffNetKnockouts);

    if (knockoutsApplied) {
      const apron = this.m_sameNetApronCache.get(aZone)?.get(aLayer);
      const sameNetApron = apron ? apron.CloneDropTriangulation() : new SHAPE_POLY_SET();

      // The apron may only buffer where copper can still go, so it takes the same knockouts
      if (sameNetApron.OutlineCount() > 0 && diffNetKnockouts.OutlineCount() > 0)
        sameNetApron.BooleanSubtract(diffNetKnockouts);

      this.postKnockoutMinWidthPrune(aZone, aFillPolys, sameNetApron);
    }

    if (sameNetKnockouts.OutlineCount() > 0) aFillPolys.BooleanSubtract(sameNetKnockouts);

    // The cache was hatched before these knockouts, so restore the border the carve cut
    // through with a min-width ring, bounded by the un-hatched extent to stay clearance-safe
    // (issue 24758).
    if (aZone.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN) {
      const solidExtent =
        this.m_preHatchSolidFillCache.get(aZone)?.get(aLayer) ?? new SHAPE_POLY_SET();

      const knockouts = diffNetKnockouts.CloneDropTriangulation();
      knockouts.Append(sameNetKnockouts);

      if (solidExtent.OutlineCount() > 0 && knockouts.OutlineCount() > 0) {
        const border = knockouts.CloneDropTriangulation();
        border.Inflate(aZone.GetMinThickness(), CORNER_STRATEGY.ROUND_ALL_CORNERS, this.m_maxError);
        border.BooleanSubtract(knockouts);
        border.BooleanIntersection(solidExtent);

        aFillPolys.BooleanAdd(border);
      }
    }

    dropSubResolutionOutlines(aFillPolys, this.m_maxError);

    aFillPolys.Fracture();

    let perLayer = this.m_refillResultCache.get(aZone);

    if (!perLayer) {
      perLayer = new Map();
      this.m_refillResultCache.set(aZone, perLayer);
    }

    perLayer.set(aLayer, [knockoutHash, aFillPolys.CloneDropTriangulation()]);

    return true;
  }
}

/**
 * `ZONE_FILLER::connect_nearby_polys` (zone_filler.cpp:2712-2757) and the
 * `VERTEX_CONNECTOR` it runs on (:94-230), over kimath's `VERTEX_SET`.
 *
 * The deflate that prunes anything thinner than the minimum width also
 * severs every NECK thinner than it, and a severed neck is not what the
 * user drew: two pieces of copper that were one. So, in the deflated state,
 * upstream looks for pairs of convex vertices on different outlines (or far
 * apart along the same one) within `minThickness` of each other, and joins
 * them with a zero-width spike — `line.Insert( vertex + 1, pt1 );
 * line.Insert( vertex + 1, pt2 )` on the first outline — that the round
 * re-inflate turns into a bar one minimum thickness wide.
 *
 * The search is upstream's own: the vertices are threaded onto ONE circular
 * list in outline order, simplified at `m_TriangulateSimplificationLevel`
 * (50 units, squared), Morton-sorted, and a candidate is looked for by
 * walking that z-order both ways within the ±distance box — which is what
 * decides between two candidates at the same distance.
 */
function connectNearbyPolys(rings: Vec2[][], distance: number): Vec2[][] {
  if (rings.length < 1) return rings;

  // `VERTEX_SET( ADVANCED_CFG::GetCfg().m_TriangulateSimplificationLevel )`
  const vs = new VertexSet(50);
  // `aPolys.BBoxFromCaches()`
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const r of rings)
    for (const p of r) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  vs.setBoundingBox({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });

  const outlineDistances: number[][] = [];
  let tail: Vertex | null = null;
  rings.forEach((outline, i) => {
    const distances: number[] = [0.0];
    for (let j = 0; j < outline.length; j++) {
      const a = outline[j]!;
      const b = outline[(j + 1) % outline.length]!;
      distances.push(
        distances[distances.length - 1]! + EuclideanNormI({ x: b.x - a.x, y: b.y - a.y }),
      );
    }
    outlineDistances.push(distances);
    tail = vs.createList(outline, tail, i);
  });
  if (tail) (tail as Vertex).updateList();
  if (vs.vertices.length === 0) return rings;

  const limit2 = distance * distance;
  const getPoint = (aPt: Vertex): Vertex | null => {
    // z-order range for the current point ± limit bounding box
    const maxZ = vs.zOrder(aPt.x + distance, aPt.y + distance);
    const minZ = vs.zOrder(aPt.x - distance, aPt.y - distance);

    let min_dist = Number.POSITIVE_INFINITY;
    let retval: Vertex | null = null;

    const check_pt = (p: Vertex): void => {
      // A nearby point along the same contour is already connected and would
      // consume the visited-point suppression before a contour-distant point
      // across a neck is considered.
      if (p.userData === aPt.userData) {
        const distances = outlineDistances[p.userData]!;
        const directDistance = Math.abs(distances[p.i]! - distances[aPt.i]!);
        const contourDistance = Math.min(
          directDistance,
          distances[distances.length - 1]! - directDistance,
        );
        if (contourDistance < distance) return;
      }
      const dx = p.x - aPt.x;
      const dy = p.y - aPt.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > 0 && dist2 < limit2 && dist2 < min_dist && p.isEar(true)) {
        min_dist = dist2;
        retval = p;
      }
    };

    let p = aPt.nextZ;
    while (p && p.z <= maxZ) {
      check_pt(p);
      p = p.nextZ;
    }
    p = aPt.prevZ;
    while (p && p.z >= minZ) {
      check_pt(p);
      p = p.prevZ;
    }
    return retval;
  };

  // `FindResults`
  const front = vs.vertices[0]!;
  const visited = new Set<Vertex>();
  const seen = new Set<string>();
  const results: { o1: number; o2: number; v1: number; v2: number }[] = [];
  let p = front.next;
  while (p !== front) {
    // Skip points that are concave
    if (!p.isEar()) {
      p = p.next;
      continue;
    }
    const q = visited.has(p) ? null : getPoint(p);
    if (q) {
      visited.add(p);
      const key = `${p.userData},${q.userData},${p.i},${q.i}`;
      if (!visited.has(q) && !seen.has(key)) {
        seen.add(key);
        results.push({ o1: p.userData, o2: q.userData, v1: p.i, v2: q.i });
        // We don't want to connect multiple points in the same vicinity, so
        // skip 2 points before and after each point and match.
        visited.add(p.prev);
        visited.add(p.prev.prev);
        visited.add(p.next);
        visited.add(p.next.next);
        visited.add(q.prev);
        visited.add(q.prev.prev);
        visited.add(q.next);
        visited.add(q.next.next);
        visited.add(q);
      }
    }
    p = p.next;
  }
  if (results.length === 0) return rings;

  // `std::set<RESULTS>` iterates in (outline1, outline2, vertex1, vertex2) order.
  results.sort((a, b) => a.o1 - b.o1 || a.o2 - b.o2 || a.v1 - b.v1 || a.v2 - b.v2);
  const insertions = new Map<number, { vertex: number; pt: Vec2 }[]>();
  for (const r of results) {
    const pt1 = rings[r.o1]![r.v1]!;
    const pt2 = rings[r.o2]![r.v2]!;
    const list = insertions.get(r.o1) ?? [];
    // "insert the existing point first so that we can place the new point
    // between the two points at the same location"
    list.push({ vertex: r.v1, pt: pt1 }, { vertex: r.v1, pt: pt2 });
    insertions.set(r.o1, list);
  }

  const out = rings.map((r) => [...r]);
  for (const [outline, vertices] of insertions) {
    // "Stable sort here because we want to make sure that we are inserting
    // pt1 first and pt2 second but still sorting the rest of the indices
    // from highest to lowest."
    const sorted = vertices
      .map((v, k) => ({ ...v, k }))
      .sort((a, b) => b.vertex - a.vertex || a.k - b.k);
    const line = out[outline]!;
    for (const { vertex, pt } of sorted) {
      // `SHAPE_LINE_CHAIN::Insert( aVertex, aP )`: past the end it is an
      // `Append`, which drops a point equal to the last one.
      if (vertex + 1 === line.length) {
        const l = line[line.length - 1]!;
        if (l.x !== pt.x || l.y !== pt.y) line.push({ x: pt.x, y: pt.y });
      } else line.splice(vertex + 1, 0, { x: pt.x, y: pt.y });
    }
  }
  return out;
}
