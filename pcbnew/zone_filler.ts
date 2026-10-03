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

import { buildBoardPolygonOutlines } from './convert_shape_list_to_polygon_legacy.js';
import type { Geom, MultiPolygon, Ring } from 'polygon-clipping';
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import {
  chainPointInside,
  booleanAdd,
  booleanIntersection,
  booleanOp,
  BooleanOp,
  booleanSubtract,
  chamfer,
  inflateWithLinkedHoles,
  CornerStrategy,
  fillet,
  fracture,
  inflate,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set_algorithms.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { type Vertex, VertexSet } from '@ziroeda/kimath/src/geometry/vertex_set.js';
import { EuclideanNormI, Perpendicular, ResizeI } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { hypot } from '@ziroeda/kimath/src/math/libm.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { defaultThermalSpokeAngle } from './padstack.js';
import { padShapes } from './drc/drc_engine_view.js';
import {
  arcCentralAngle,
  arcRadius,
  arcStartAngle,
  shapeArcCenter,
} from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { shapeBBox, shapeDist, type Shape } from '@ziroeda/kimath/src/geometry/shape_collisions.js';
import { tessellateArc } from './edit-board.js';
import { padShapePos } from './padstack.js';
import { viaIsOnLayer } from './via_layers.js';
import { type FillOutline, isolatedIslands } from './zone_islands.js';
import { textTransformShapeToPolygon, textTransformTextToPolySet } from './text_to_polyset.js';
import {
  arcToPolygon,
  circlePoly,
  dedupeRing,
  segmentsForRadius,
  stadiumPoly,
} from './convert_basic_shapes_to_polygon.js';

export { segmentsForRadius };
import { barcodeGeometry, barcodeHullBoxes } from './pcb_io/kicad_sexpr/board_view.js';
import {
  arcTrackTransformShapeToPolygon,
  edaShapeTransformShapeToPolygon,
  ErrorLoc,
  padTransformHoleToPolygon,
  padTransformShapeToPolygon,
  trackTransformShapeToPolygon,
  viaTransformShapeToPolygon,
} from './transform_shape_to_polygon.js';
import {
  transformCircleToPolygonSet,
  transformRingToPolygon,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import {
  chainIntersect,
  segCollinear,
  segContains,
  segIntersect,
} from '@ziroeda/kimath/src/geometry/seg.js';
import type {
  Board,
  PadPrimitive,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
  PcbVia,
  PcbZone,
  PcbZoneFill,
} from './types.js';
import type { ZoneConnection } from './zone_connection.js';
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';
import { LSET_NameToLayer, type PCB_LAYER_NAME } from '@ziroeda/common/layer_ids.js';
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

/** BOARD_DESIGN_SETTINGS::m_MaxError, the arc approximation limit (0.005 mm). */
const DEFAULT_MAX_ERROR = mmToIU(0.005);

/**
 * `ADVANCED_CFG::m_ExtraClearance` (advanced_config.cpp:244), the
 * `ExtraFillMargin` key: "A small extra clearance to be sure actual track
 * clearances are not smaller than requested clearance due to many
 * approximations in calculations, like arc to segment approx, rounding
 * issues, etc." `buildCopperItemClearances` adds it to EVERY gap it knocks
 * out — pads, holes, vias, tracks, arcs, graphics, text, the board edge,
 * other zones — and to nothing else: not a thermal relief, not a spoke, not
 * a rule area.
 *
 * Half a micron does not sound like a pour. It is the whole of what was
 * left between our fill and KiCad's on eleven of the twelve demo boards:
 * every knockout edge sat exactly 500 units inside upstream's, and the
 * slivers along thousands of them added up to the last 0.02–0.15 %.
 */
/** The implicit "barcode visual separation default" rule: 1 mm (drc_engine.cpp:261). */
const BARCODE_VISUAL_SEPARATION_DEFAULT = mmToIU(1.0);

const EXTRA_CLEARANCE = mmToIU(ADVANCED_CFG.GetCfg().m_ExtraClearance);

/** `DEFAULT_COPPEREDGECLEARANCE` (`include/board_design_settings.h:89`). */
// [data] 0.5 mm, "clearance between copper items and edge cuts".
const DEFAULT_EDGE_CLEARANCE = mmToIU(0.5);

export interface ZoneFillOptions {
  /**
   * The DRC engine's answers for the thermal and zone-connection constraints.
   * Defaults to a `ZONE_FILLER` on the board's own model, which is what the
   * editor gets; a caller supplies one only to observe what was asked.
   */
  rules?: ZONE_RULE_RESOLVER;
  /**
   * Clearance in IU required between this zone and another net's copper. The
   * board's DRC clearance; defaults to the zone's own `(connect_pads
   * (clearance …))`, which is what a board with no rules resolves to.
   */
  clearanceOf?: (zone: PcbZone, otherNet: number) => number;
  /** Arc/circle approximation error (m_MaxError). */
  maxError?: number;
  /**
   * `BOARD_DESIGN_SETTINGS::m_ZoneLayerProperties[ aLayer ].hatching_offset` —
   * the Board Setup > Zone Hatch Offsets page, in IU, keyed by canonical layer
   * name. `ZONE_FILLER::addHatchFillTypeOnZone` reads it as the BOARD default
   * and lets a zone's own `LayerProperties()` override it per layer
   * (`zone_filler.cpp:3929-3936`).
   *
   * Optional because this module is used without a board design settings
   * object; absent means every layer's offset is (0, 0), which is
   * `value_or( VECTOR2I() )`.
   */
  hatchingOffsets?: Readonly<Record<string, { x: number; y: number }>>;
  /**
   * `EDGE_CLEARANCE_CONSTRAINT` — Board Setup > Constraints' "Copper to edge
   * clearance", the gap the pour keeps from Edge.Cuts and Margin.
   *
   * `DEFAULT_COPPEREDGECLEARANCE` is 0.5 mm
   * (`include/board_design_settings.h:89`), which is what a board with no
   * rules resolves to and therefore the default here.
   */
  edgeClearance?: number;
  /**
   * `HOLE_CLEARANCE_CONSTRAINT` — Board Setup > Constraints' "Minimum hole
   * clearance", the gap the pour keeps from a DRILL as opposed to from the
   * copper around it. `knockoutPadClearance` maxes the hole's gap with it, and
   * for an NPTH it is the only ordinary clearance that applies at all.
   */
  holeClearance?: number;
  /**
   * `PHYSICAL_CLEARANCE_CONSTRAINT` / `PHYSICAL_HOLE_CLEARANCE_CONSTRAINT` as
   * resolved for the zone — a rule-only constraint, so a board with no
   * custom rules has none (`EvalRules` answers a null constraint, `Min()` 0).
   */
  physicalClearance?: number;
  physicalHoleClearance?: number;
  /** `m_HoleToHoleMin`, one of the terms of `GetBiggestClearanceValue`. */
  holeToHoleMin?: number;
  /**
   * `QueryWorstConstraint( CLEARANCE_CONSTRAINT )`: the largest clearance any
   * netclass or rule states, whether or not a net uses it.
   */
  worstNetClassClearance?: number;
  /**
   * `DUMP_POLYS_TO_COPPER_LAYER`: every intermediate poly set of
   * `fillCopperZone`, named as upstream names its debug layers, for a test
   * that holds KiCad's own `DebugZoneFiller` dumps.
   */
  onStage?: (name: string, layer: string, polys: Polygon[]) => void;
  /**
   * `BOARD_DESIGN_SETTINGS::m_MinClearance` — Board Setup > Constraints'
   * "Minimum clearance". A pad's local clearance override is floored at it
   * ("Local overrides take precedence over everything *except* board min
   * clearance", drc_engine.cpp:1135). `clearanceOf` already folds it into
   * the ordinary answer; this is the one place the filler needs it on its own.
   */
  minClearance?: number;
}

/**
 * What `evalRulesForItems( CLEARANCE_CONSTRAINT, aZone, aItem, aLayer )` comes
 * back with, for a board carrying no custom rules.
 *
 * `DRC_ENGINE::EvalRules` (drc_engine.cpp:1902-1975) is explicit that this one
 * cannot be an implicit rule, "because they have to be max'ed with netclass
 * values": the netclass clearance is the base, a local clearance on either item
 * raises it (`if( localA > clearance )`), and the board minimum raises it
 * again. So it is the maximum of the four, and a zone whose own
 * `(connect_pads (clearance 0))` says nothing still keeps its netclass's gap —
 * which is most of what `multichannel_mixer` pours.
 */
export interface ClearanceRules {
  /** `BOARD_DESIGN_SETTINGS::m_MinClearance`, Board Setup > Constraints, IU. */
  minClearance?: number;
  /**
   * The effective netclass clearance of a net, IU — `netClassClearanceMM`
   * against the project's netclass table. Undefined for a net whose classes
   * state none.
   */
  netClassClearance?: (net: number) => number | undefined;
}

/** A `ZoneFillOptions.clearanceOf` built from a board's design rules. */
export function zoneClearanceOf(
  rules: ClearanceRules,
): (zone: PcbZone, otherNet: number) => number {
  // Resolving a net's class means matching it against every pattern in the
  // project, and the filler asks per item; a board with a few hundred nets does
  // it tens of thousands of times for a handful of distinct answers.
  const cache = new Map<number, number | undefined>();
  const netClass = (net: number): number | undefined => {
    if (!cache.has(net)) cache.set(net, rules.netClassClearance?.(net));
    return cache.get(net);
  };

  return (zone, otherNet) => {
    let clearance = 0;

    for (const net of [zone.net, otherNet]) {
      const nc = netClass(net);
      if (nc !== undefined && nc > clearance) clearance = nc;
    }

    if (zone.clearance !== undefined && zone.clearance > clearance) clearance = zone.clearance;
    if ((rules.minClearance ?? 0) > clearance) clearance = rules.minClearance ?? 0;

    return clearance;
  };
}

/**
 * The offset a hatched fill uses on one layer — the board default, overridden
 * by the zone's own if it has one for that layer:
 *
 *     VECTOR2I offset = defaultOffsets[aLayer].hatching_offset.value_or( VECTOR2I() );
 *     if( localOffsets.contains( aLayer ) && localOffsets.at( aLayer ).hatching_offset.has_value() )
 *         offset = localOffsets.at( aLayer ).hatching_offset.value();
 *
 * One function because the per-zone dialog resolves it the same way; the rule
 * is "the zone's own value wins ONLY when it has one", which is not the same as
 * merging the two maps.
 */
export function hatchingOffsetFor(
  aLayer: string,
  aBoardDefaults: Readonly<Record<string, { x: number; y: number }>> | undefined,
  aZoneLocal: Readonly<Record<string, { x: number; y: number }>> | undefined,
): { x: number; y: number } {
  return aZoneLocal?.[aLayer] ?? aBoardDefaults?.[aLayer] ?? { x: 0, y: 0 };
}

// ----- polygon helpers --------------------------------------------------------

const ringOf = (pts: Vec2[]): Ring => pts.map((p) => [p.x, p.y] as [number, number]);

/**
 * The boolean ops, in the shapes this file already speaks, computed with
 * **Clipper** — the library `SHAPE_POLY_SET` itself uses.
 *
 * `polygon-clipping` is a different sweep-line implementation and it does not
 * survive a real board: on four of the twelve KiCad demos it threw "Unable to
 * find segment … in SweepLine tree" part-way through a pour, and a zone whose
 * fill throws is a zone that never fills at all. Clipper is integer-based, is
 * what upstream hands its polygons to, and answers.
 *
 * `FillRule::NonZero`, as `SHAPE_POLY_SET::booleanOp` declares. It matters
 * here and not elsewhere: the knockouts overlap each other constantly — two
 * pads of the same part, a track ending on a pad — and under even-odd an
 * overlap between two holes cancels back to copper.
 */
const clip = {
  union: (first: Geom, ...rest: Geom[]): MultiPolygon =>
    fromPolys(booleanOp(asPolys(first), rest.flatMap(asPolys), BooleanOp.ADD)),
  difference: (subject: Geom, ...clips: Geom[]): MultiPolygon =>
    fromPolys(booleanOp(asPolys(subject), clips.flatMap(asPolys), BooleanOp.SUBTRACT)),
  intersection: (subject: Geom, other: Geom): MultiPolygon =>
    fromPolys(booleanOp(asPolys(subject), asPolys(other), BooleanOp.INTERSECT)),
};

/**
 * `Geom` is a ring, a polygon (ring plus holes) or a multipolygon, told apart
 * by nesting depth — the same three shapes `polygon-clipping` accepts, so no
 * call site has to say which it is holding.
 */
function asPolys(g: Geom): Polygon[] {
  const a = g as unknown as unknown[][];
  if (a.length === 0) return [];
  const first = a[0]!;
  if (typeof first[0] === 'number') return [[ptsOf(a as unknown as Ring)]]; // a bare Ring
  if (typeof (first[0] as unknown[])[0] === 'number') return [(a as unknown as Ring[]).map(ptsOf)]; // one Polygon
  return (a as unknown as Ring[][]).map((poly) => poly.map(ptsOf)); // a MultiPolygon
}

const fromPolys = (polys: Polygon[]): MultiPolygon =>
  polys.map((poly) => poly.map(ringOf)) as MultiPolygon;

/**
 * The same ring with whole-IU corners, for anything on its way back INTO the
 * clipper. `inflate` works in floating point, so a pruned fill carries
 * fractional vertices; handing those to a second boolean is what the note on
 * `circlePoly` describes — the sweep line fails outright rather than answering
 * wrongly. KiCad never has the problem because `SHAPE_POLY_SET` is `VECTOR2I`.
 */
const intRingOf = (pts: Vec2[]): Ring =>
  dedupeRing(pts.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]));
const ptsOf = (ring: Ring): Vec2[] => ring.map(([x, y]) => ({ x, y }));
/**
 * `PCB_SHAPE::GetBoundingBox`, near enough for the zone's own guard: the
 * shape's points widened by its stroke.
 */
function shapeBox(s: PcbShape): Box {
  const pts: Vec2[] = [];
  for (const p of [s.start, s.end, s.mid, s.center]) if (p) pts.push(p);
  if (s.pts) pts.push(...s.pts);
  let box = boxOf(pts.length ? pts : [{ x: 0, y: 0 }]);
  if (s.kind === 'circle' && s.center && s.end) {
    const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    box = boxInflate(boxOf([s.center]), r);
  }
  return boxInflate(box, Math.trunc(s.width / 2));
}

/** kimath polygons as the `Geom` list the knockout sets are collected in. */
const asGeoms = (polys: Polygon[]): Geom[] => polys.map((poly) => poly.map(ringOf) as Geom);

/**
 * A DRC shape as a polygon grown by `gap`. Inflation is a union of the shape
 * with a stadium along each edge, which is what keeps this to booleans alone.
 */
export function shapeToPolygon(shape: Shape, gap: number, maxError: number): Geom[] {
  switch (shape.kind) {
    case 'circle':
      return [[circlePoly(shape.c, shape.r + gap, maxError)]];
    case 'stadium':
      return [[stadiumPoly(shape.a, shape.b, shape.r + gap, maxError)]];
    case 'arc': {
      // `TransformArcToPolygon( start, mid, end, width + 2 * clearance, … )` —
      // one polygon on the chord circle, when the arc came with its points.
      if (shape.chord)
        return [
          [
            arcToPolygon(
              shape.chord.s,
              shape.chord.m,
              shape.chord.e,
              2 * (shape.r + gap),
              maxError,
            ),
          ],
        ];
      // A full circle drawn as an arc: the centreline, thickened by its own
      // half-width plus the gap.
      const out: Geom[] = [];
      const steps = segmentsForRadius(shape.rad, maxError);
      let prev: Vec2 | null = null;
      for (let i = 0; i <= steps; i++) {
        const a = shape.a0 + (shape.sweep * i) / steps;
        const p = {
          x: shape.c.x + shape.rad * Math.cos(a),
          y: shape.c.y + shape.rad * Math.sin(a),
        };
        if (prev) out.push([stadiumPoly(prev, p, shape.r + gap, maxError)]);
        prev = p;
      }
      return out;
    }
    case 'poly': {
      const grow = shape.r + gap;
      const out: Geom[] = [[ringOf(shape.pts)]];
      if (grow > 0) {
        for (let i = 0; i < shape.pts.length; i++) {
          const a = shape.pts[i]!;
          const b = shape.pts[(i + 1) % shape.pts.length]!;
          out.push([stadiumPoly(a, b, grow, maxError)]);
        }
      }
      return out;
    }
  }
}

/** An axis-aligned box, as `BOX2I`. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boxOf = (pts: readonly Vec2[]): Box => {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
};

const boxInflate = (b: Box, d: number): Box => ({
  x0: b.x0 - d,
  y0: b.y0 - d,
  x1: b.x1 + d,
  y1: b.y1 + d,
});

const boxesIntersect = (a: Box, b: Box): boolean =>
  a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

const drcBox = (b: { minX: number; minY: number; maxX: number; maxY: number }): Box => ({
  x0: b.minX,
  y0: b.minY,
  x1: b.maxX,
  y1: b.maxY,
});
const boxMerge = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/**
 * `PCB_TRACK::GetBoundingBox` / `PCB_VIA::GetBoundingBox`: the end points
 * grown by the rounded-up radius `( width + 1 ) / 2`, as a `[pos, dim)`
 * rectangle whose far edges are one unit further out.
 */
function trackBox(a: Vec2, b: Vec2, width: number): Box {
  const radius = Math.trunc((width + 1) / 2);
  const bb = boxOf([a, b]);
  return { x0: bb.x0 - radius, y0: bb.y0 - radius, x1: bb.x1 + radius + 1, y1: bb.y1 + radius + 1 };
}

/**
 * `SHAPE_ARC::update_values` + `BBox( 0 )`: start, mid, end and the
 * quadrant points the arc sweeps through, grown by `KiROUND( width / 2 ) + 1`.
 */
function arcTrackBox(start: Vec2, mid: Vec2, end: Vec2, width: number): Box {
  const arc = { p0: start, arcMid: mid, p1: end, width };
  const center = shapeArcCenter(arc);
  const radiusD = arcRadius(arc);
  const points: Vec2[] = [start, mid, end];
  let startAngle = arcStartAngle(arc);
  let endAngle = startAngle.add(arcCentralAngle(arc));
  if (startAngle.gt(endAngle)) [startAngle, endAngle] = [endAngle, startAngle];
  const quadStart = Math.ceil(startAngle.AsDegrees() / 90.0);
  const quadEnd = Math.floor(endAngle.AsDegrees() / 90.0);
  if (radiusD < 2147483647 / 2.0) {
    const radius = KiROUND(radiusD);
    for (let quad = quadStart; quad <= quadEnd; ++quad) {
      const q = quad % 4;
      if (q === 0) points.push({ x: center.x + radius, y: center.y });
      else if (q === 1 || q === -3) points.push({ x: center.x, y: center.y + radius });
      else if (q === 2 || q === -2) points.push({ x: center.x - radius, y: center.y });
      else points.push({ x: center.x, y: center.y - radius });
    }
  }
  const bb = boxOf(points);
  return width !== 0 ? boxInflate(bb, KiROUND(width / 2.0) + 1) : bb;
}

/**
 * `PAD::GetBoundingBox`: the effective shapes' boxes merged with the hole's
 * (`SHAPE_SEGMENT( pos - half_len, pos + half_len, half_width * 2 )`).
 */
function padBox(pad: PcbPad): Box {
  let box: Box | undefined;
  for (const sh of padShapes(pad)) {
    const b = drcBox(shapeBBox(sh));
    box = box ? boxMerge(box, b) : b;
  }
  if (pad.drill) {
    // `Drill().size / 2`: a VECTOR2I over a scalar is KiROUND per component.
    const halfW = Math.min(KiROUND(pad.drill.w / 2), KiROUND(pad.drill.h / 2));
    const halfLen = RotatePoint(
      { x: KiROUND(pad.drill.w / 2) - halfW, y: KiROUND(pad.drill.h / 2) - halfW },
      new EDA_ANGLE(pad.angle),
    );
    const hole = boxInflate(
      boxOf([
        { x: pad.at.x - halfLen.x, y: pad.at.y - halfLen.y },
        { x: pad.at.x + halfLen.x, y: pad.at.y + halfLen.y },
      ]),
      halfW,
    );
    box = box ? boxMerge(box, hole) : hole;
  }
  return box ?? boxOf([pad.at]);
}

/** The extreme points of a DRC shape, enough for a bounding box. */
function shapeCorners(s: Shape): Vec2[] {
  switch (s.kind) {
    case 'circle':
      return [
        { x: s.c.x - s.r, y: s.c.y - s.r },
        { x: s.c.x + s.r, y: s.c.y + s.r },
      ];
    case 'stadium':
      return [
        { x: Math.min(s.a.x, s.b.x) - s.r, y: Math.min(s.a.y, s.b.y) - s.r },
        { x: Math.max(s.a.x, s.b.x) + s.r, y: Math.max(s.a.y, s.b.y) + s.r },
      ];
    case 'arc':
      return [
        { x: s.c.x - s.rad - s.r, y: s.c.y - s.rad - s.r },
        { x: s.c.x + s.rad + s.r, y: s.c.y + s.rad + s.r },
      ];
    case 'poly':
      return s.pts;
  }
}

const boxAround = (a: Vec2, b: Vec2, r: number): Box => boxInflate(boxOf([a, b]), r);

const isCopper = (layer: string): boolean => /\.Cu$/.test(layer);
const padOnLayer = (pad: PcbPad, layer: string): boolean =>
  pad.layers.some((l) => l === layer || l === '*.Cu');

/**
 * `PAD::BuildEffectiveShapes`' hole — a `SHAPE_SEGMENT`, not a circle.
 *
 *     half_width = min( half_size.x, half_size.y );
 *     half_len   = ( half_size.x - half_width, half_size.y - half_width );
 *     RotatePoint( half_len, GetOrientation() );
 *     SHAPE_SEGMENT( m_pos - half_len, m_pos + half_len, half_width * 2 )
 *
 * A round drill collapses to a point of half the diameter, which is the circle
 * again; an OBLONG one is a slot. Taking the larger of the two sizes as a
 * radius, as this did, knocks out a disc where the slot is — on StickHub's
 * 4.0 x 1.5 mm mounting slot that is 7.3 mm² of copper KiCad pours.
 */
function padHoleShape(pad: PcbPad, gap: number): Shape | null {
  if (!pad.drill) return null;

  // `Drill().size / 2` is a VECTOR2I over a scalar: KiROUND per component.
  const halfW = Math.min(KiROUND(pad.drill.w / 2), KiROUND(pad.drill.h / 2));
  const halfLen = rotate(
    { x: KiROUND(pad.drill.w / 2) - halfW, y: KiROUND(pad.drill.h / 2) - halfW },
    pad.angle ?? 0,
  );

  // The hole stays on the pad position. `GetEffectiveHoleShape` builds its
  // segment from `m_pos`; it is the pad's COPPER that a drill `(offset …)`
  // moves, which `padShapePos` does for `padShapes`.
  const at = pad.at;

  if (halfLen.x === 0 && halfLen.y === 0) return { kind: 'circle', c: at, r: halfW + gap };

  return {
    kind: 'stadium',
    a: { x: at.x - halfLen.x, y: at.y - halfLen.y },
    b: { x: at.x + halfLen.x, y: at.y + halfLen.y },
    r: halfW + gap,
  };
}

/**
 * `DRC_ENGINE::EvalRules( THERMAL_RELIEF_GAP_CONSTRAINT, pad, zone )`
 * (drc_engine.cpp:1223-1237, 2027-2042): the pad's own `(thermal_gap …)` when
 * it states one above zero — "Local override on %s; thermal relief gap" —
 * otherwise the zone's. There is no footprint-level value for this one, and
 * a rule area's `thermal_relief_gap` constraint is not modelled.
 *
 * A pad on StickHub says `(thermal_gap 0.25)` over a zone whose gap is 0.15;
 * the relief around it is 0.1 mm wider on every side than the zone's, and
 * this read the zone's for every pad.
 */
/**
 * What the fill asks the DRC engine, for a pour that is still working on the
 * view: `ZONE_FILLER` implements it (`EvalRules` / `EvalZoneConnection`), and
 * the view items hand over the `BOARD_ITEM`s in their `.k`.
 *
 * This exists because the pour below still takes a `Board`. When it takes a
 * `BOARD` the resolver goes with it and these become plain method calls
 * (#636 stage 4).
 */
export interface ZONE_RULE_RESOLVER {
  ThermalReliefGap(aPad: BOARD_ITEM, aZone: ZONE, aLayer: PCB_LAYER_ID): number;
  ThermalSpokeWidth(aPad: BOARD_ITEM, aZone: ZONE, aLayer: PCB_LAYER_ID): number;
  ZoneConnection(aPad: BOARD_ITEM, aZone: ZONE, aLayer: PCB_LAYER_ID): ZONE_CONNECTION;
}

/** A view item's model, which every item carries once it has been through a BOARD. */
function modelOf<T>(aItem: { k?: T }, aWhat: string): T {
  if (!aItem.k) throw new Error(`zone fill: this ${aWhat} has no BOARD_ITEM to resolve rules on`);

  return aItem.k;
}

/**
 * `PAD::GetClearanceOverrides` — the pad's own `(clearance …)`, or its
 * footprint's when the pad states none — and what `DRC_ENGINE::EvalRules`
 * does with it for CLEARANCE_CONSTRAINT and HOLE_CLEARANCE_CONSTRAINT
 * (drc_engine.cpp:1134-1203):
 *
 *     // Local overrides take precedence over everything *except* board min
 *     // clearance
 *
 * It does NOT merely raise the answer. When a pad states one above zero, that
 * value REPLACES the netclass and the zone's own clearance, floored at the
 * board minimum (or the board minimum hole clearance, for the hole). A zone
 * has no override of its own — `BOARD_CONNECTED_ITEM::GetClearanceOverrides`
 * is empty — so the pad's is the only one in play. A stated zero falls
 * through to the ordinary answer: `if( override_val )`.
 *
 * Measured, not read: pic_programmer's solder jumper carries `(clearance
 * 0.25)` on the footprint over a 0.508 mm GND pour. Refilled by KiCad with
 * that line, the relief is 0.25 from the pad; with it deleted, 0.508; with it
 * at 0.9, 0.9. This tree maxed the two and kept 0.508 — 1 mm² of copper too
 * little around the jumper, and the same on CM5's 1.7 mm mounting holes only
 * by luck, 1.7 being the larger there.
 */
function padClearanceOverride(pad: PcbPad, fp: PcbFootprint): number | undefined {
  const override = pad.localClearance ?? fp.localClearance;
  return override !== undefined && override > 0 ? override : undefined;
}

/**
 * `EvalZoneConnection` resolves THT_THERMAL and never returns INHERITED
 * (`drc_engine.cpp`: the constraint walks pad, footprint and zone, and the
 * rewrite turns THT_THERMAL into THERMAL or FULL), so the pour sees three.
 */
const ZONE_CONNECTION_VIEW: Readonly<Record<ZONE_CONNECTION, 'none' | 'thermal' | 'full'>> = {
  [ZONE_CONNECTION.NONE]: 'none',
  [ZONE_CONNECTION.THERMAL]: 'thermal',
  [ZONE_CONNECTION.FULL]: 'full',
  // Defensive: a rule that resolved to neither leaves the pad thermally
  // relieved, which is `ZONE_SETTINGS`' own default.
  [ZONE_CONNECTION.INHERITED]: 'thermal',
  [ZONE_CONNECTION.THT_THERMAL]: 'thermal',
};

/** The rules a zone fill resolves for one pad on one layer. */
interface PadRules {
  gap: number;
  spokeWidth: number;
  connection: ZONE_CONNECTION;
}

function padRules(pad: PcbPad, zone: PcbZone, rules: ZONE_RULE_RESOLVER, layer: string): PadRules {
  const k = modelOf(pad, 'pad');
  const z = modelOf(zone, 'zone');
  const id = LSET_NameToLayer(layer as PCB_LAYER_NAME) as PCB_LAYER_ID;

  return {
    gap: rules.ThermalReliefGap(k, z, id),
    spokeWidth: rules.ThermalSpokeWidth(k, z, id),
    connection: rules.ZoneConnection(k, z, id),
  };
}

// ----- thermal spokes ---------------------------------------------------------

/**
 * ZONE_FILLER::buildThermalSpokes: square-ended segments from the pad centre out
 * past the thermal relief, four of them on the pad's own axes. The width is
 * clamped to the pad's minor axis and dropped entirely below the zone's min
 * thickness, since a stub thinner than that is not copper the pour can hold.
 */
/**
 * One thermal spoke: the copper, and the point that decides whether it is kept.
 *
 * `buildThermalSpokes` gives every spoke five points, and the fifth exists for
 * one reason — "The outside end has an extra center point (which must be at
 * idx 3) which is used for testing whether or not the spoke connects to copper
 * in the parent zone" (`zone_filler.cpp:3478-3481`).
 */
interface ThermalSpoke {
  geom: Geom;
  /** The spoke's own outline, for the spoke-hits-spoke fallback. */
  ring: Vec2[];
  /** `spoke.CPoint( 3 )`: the outer end, on the centreline. */
  tip: Vec2;
}

/**
 * `EDA_ANGLE::Cos` / `::Sin`, which answer EXACTLY on a cardinal angle rather
 * than letting `cos( M_PI / 2 )` come back as 6e-17. `intersectBBox`
 * short-circuits on `dx == 0`, so the difference is the difference between an
 * axis spoke and a very slightly diagonal one.
 */
const angleCos = (deg: number): number => new EDA_ANGLE(deg).Cos();
const angleSin = (deg: number): number => new EDA_ANGLE(deg).Sin();

/** `RotatePoint( VECTOR2I&, const EDA_ANGLE& )` — the integer one, KiROUND. */
const rotate = (p: Vec2, deg: number): Vec2 => RotatePoint(p, new EDA_ANGLE(deg));

/**
 * `buildSpokesFromOrigin`: four spokes out of the origin, in the cardinal
 * directions offset by `deg`, each running to where its centreline leaves
 * `half`'s box.
 *
 * The five points are upstream's, and the fourth is the whole reason the chain
 * is not a plain rectangle — "The outside end has an extra center point (which
 * must be at idx 3) which is used for testing whether or not the spoke connects
 * to copper in the parent zone".
 */
function spokesFromOrigin(
  half: Vec2,
  deg: number,
  spokeHalfW: number,
  center: Vec2 = { x: 0, y: 0 },
): ThermalSpoke[] {
  const out: ThermalSpoke[] = [];

  for (let i = 0; i < 4; i++) {
    const a = deg + i * 90;
    const dx = angleCos(a);
    const dy = angleSin(a);

    let at: Vec2;
    let side: Vec2;

    if (dx === 0) {
      side = { x: spokeHalfW, y: 0 };
      at = { x: KiROUND(0.0), y: KiROUND(dy * half.y) };
    } else if (dy === 0) {
      side = { x: 0, y: spokeHalfW };
      at = { x: KiROUND(dx * half.x), y: KiROUND(0.0) };
    } else {
      // "We are going to intersect with one side or the other. Whichever we hit
      // first is the fraction of the spoke length we keep."
      const distX = half.x / Math.abs(dx);
      const distY = half.y / Math.abs(dy);

      if (distX < distY) {
        side = { x: KiROUND(0.0), y: KiROUND(spokeHalfW / angleSin(90 - a)) };
        at = { x: KiROUND(dx * distX), y: KiROUND(dy * distX) };
      } else {
        side = { x: KiROUND(spokeHalfW / angleSin(a)), y: KiROUND(0.0) };
        at = { x: KiROUND(dx * distY), y: KiROUND(dy * distY) };
      }
    }

    const c = center;
    const ring: Vec2[] = [
      { x: c.x + side.x, y: c.y + side.y },
      { x: c.x - side.x, y: c.y - side.y },
      { x: c.x + at.x - side.x, y: c.y + at.y - side.y },
      { x: c.x + at.x, y: c.y + at.y }, // test pt, idx 3
      { x: c.x + at.x + side.x, y: c.y + at.y + side.y },
    ];
    out.push({ geom: [ringOf(ring)], ring, tip: { x: c.x + at.x, y: c.y + at.y } });
  }

  return out;
}

/** Move a spoke built at the origin onto the pad: rotate, then translate. */
function placeSpoke(spoke: ThermalSpoke, deg: number, to: Vec2): ThermalSpoke {
  const put = (p: Vec2): Vec2 => {
    const r = deg === 0 ? p : rotate(p, deg);
    return { x: r.x + to.x, y: r.y + to.y };
  };
  const ring = spoke.ring.map(put);
  return { geom: [ringOf(ring)], ring, tip: put(spoke.tip) };
}

function thermalSpokes(
  pad: PcbPad,
  zone: PcbZone,
  maxError: number,
  rules: ZONE_RULE_RESOLVER,
  layer: string,
): ThermalSpoke[] {
  const resolved = padRules(pad, zone, rules, layer);
  const gap = resolved.gap;
  const minor = Math.min(pad.size.x, pad.size.y);
  // "ensure the spoke width is smaller than the pad minor size", then "Cannot
  // create stubs having a width < zone min thickness".
  const width = Math.min(resolved.spokeWidth, minor);
  if (width < (zone.minThickness ?? 0)) return [];

  // A custom pad can declare where its spokes attach, as `gr_vector` proxy
  // primitives. When it does, those replace the four axis spokes entirely.
  const templates = (pad.primitives ?? []).filter(
    (prim) => prim.kind === 'gr_vector' && prim.start && prim.end,
  );

  if (templates.length > 0) return customThermalSpokes(pad, zone, templates, width, maxError, gap);

  // `PADSTACK::ThermalSpokeAngle`: 45° puts an X on a round pad, 90° a + on
  // everything else. Reading only the pad's ORIENTATION, as this did, gave a
  // round pad a + — the shape KiCad draws for a rectangle.
  const spokeAngle = pad.thermalSpokeAngle ?? defaultThermalSpokeAngle(pad.shape, pad.anchorShape);

  // "Add half the zone mininum width to the inflate amount to account for the
  // fact that the deflation procedure will shrink the results by half the half
  // the zone min width."
  const zoneHalfWidth =
    (zone.fillMode === 'hatch' ? (zone.hatchThickness ?? 0) : (zone.minThickness ?? 0)) / 2;
  const inflate = gap + maxError + zoneHalfWidth;

  // `dummy_pad.GetBoundingBox()` — the pad's own extent at orientation 0, with
  // no shape offset. A trapezoid's `(rect_delta …)` widens one axis as it
  // narrows the other, so the box takes the larger of the two ends.
  //
  // Not taken from a CUSTOM pad's primitives, which can reach past the anchor:
  // upstream's box would be larger there, and its spokes correspondingly
  // longer. A custom pad that says where its spokes go takes the branch above
  // instead, so this is only the ones that do not.
  // `half_size = KiROUND( box.GetWidth() / 2.0, box.GetHeight() / 2.0 )`,
  // the box being `size / 2` (integer halves, plus `trap_delta / 2` for a
  // trapezoid) inflated by the gap.
  let half: Vec2 = {
    x: KiROUND(
      (2 * (Math.trunc(pad.size.x / 2) + Math.abs(Math.trunc((pad.delta?.y ?? 0) / 2))) +
        2 * inflate) /
        2.0,
    ),
    y: KiROUND(
      (2 * (Math.trunc(pad.size.y / 2) + Math.abs(Math.trunc((pad.delta?.x ?? 0) / 2))) +
        2 * inflate) /
        2.0,
    ),
  };
  // A CUSTOM pad's box is its anchor and primitives, and it need not be
  // centred on the origin: `buildSpokesFromOrigin` starts at `box.GetCenter()`
  // — the origin plus half the size, integer halves — and the spokes are
  // rotated about the ORIGIN and moved to the pad, so the offset turns with
  // the pad.
  let center: Vec2 = { x: 0, y: 0 };
  if (pad.shape === 'custom') {
    const box = boxInflate(customPadLocalBox(pad, maxError), inflate);
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    center = { x: box.x0 + Math.trunc(w / 2), y: box.y0 + Math.trunc(h / 2) };
    half = { x: KiROUND(w / 2.0), y: KiROUND(h / 2.0) };
  }

  // "the bounding box for circles will overshoot the mark considerably when the
  // spokes are near a 45 degree increment. So we build the spokes at 0 degrees
  // and then rotate them" — a round pad's spoke is as long as an axis one,
  // pointed diagonally, not out to the box's corner.
  const circular = pad.shape === 'circle' || (pad.shape === 'oval' && pad.size.x === pad.size.y);
  const built = circular
    ? spokesFromOrigin(half, 0, Math.trunc(width / 2), center).map((sp) =>
        spokeAngle !== 0 ? placeSpoke(sp, spokeAngle, { x: 0, y: 0 }) : sp,
      )
    : spokesFromOrigin(half, spokeAngle, Math.trunc(width / 2), center);

  // "Spokes are from center of pad shape, not from hole" — a drill offset
  // moves the copper, and the spokes go with it.
  return built.map((sp) => placeSpoke(sp, pad.angle ?? 0, padShapePos(pad)));
}

/**
 * `dummy_pad.GetBoundingBox( aLayer )` for a CUSTOM pad — the dummy at the
 * origin, unrotated, with no offset: `buildEffectiveShape`'s box, which is
 * the anchor shape merged with every primitive's `MakeEffectiveShapes()` —
 * a filled polygon's points, a segment grown by `( width + 1 ) / 2`, a
 * circle's `[c - r, c + r]`, an unfilled circle's `SHAPE_ARC` box grown by
 * `KiROUND( width / 2 ) + 1`. This box is NOT centred on the pad's origin,
 * and `buildSpokesFromOrigin` starts the spokes at ITS centre.
 */
function customPadLocalBox(pad: PcbPad, maxError: number): Box {
  let box: Box | undefined;
  const merge = (b: Box): void => {
    box = box ? boxMerge(box, b) : b;
  };
  // the anchor shape
  if ((pad.anchorShape ?? 'circle') === 'circle') {
    const r = Math.trunc(pad.size.x / 2);
    merge({ x0: -r, y0: -r, x1: r, y1: r });
  } else {
    // `SHAPE_RECT( shapePos - size / 2, size.x, size.y )`: a VECTOR2I over a
    // scalar is KiROUND per component.
    const hx = KiROUND(pad.size.x / 2);
    const hy = KiROUND(pad.size.y / 2);
    merge({ x0: -hx, y0: -hy, x1: -hx + pad.size.x, y1: -hy + pad.size.y });
  }
  const segBox = (pts: Vec2[], width: number): Box =>
    boxInflate(boxOf(pts), Math.trunc((width + 1) / 2));
  for (const prim of pad.primitives ?? []) {
    if (prim.kind === 'gr_vector') continue; // a proxy item, not copper
    const width = prim.width;
    switch (prim.kind) {
      case 'gr_poly': {
        const pts = prim.pts ?? [];
        if (pts.length < 2) break;
        if (prim.fill) merge(boxOf(pts));
        if (width > 0 || !prim.fill)
          for (let i = 0; i < pts.length; i++)
            merge(segBox([pts[i]!, pts[(i + 1) % pts.length]!], width));
        break;
      }
      case 'gr_rect': {
        if (!prim.start || !prim.end) break;
        const pts = [
          prim.start,
          { x: prim.end.x, y: prim.start.y },
          prim.end,
          { x: prim.start.x, y: prim.end.y },
        ];
        if (prim.fill) merge(boxOf(pts));
        if (width > 0 || !prim.fill)
          for (let i = 0; i < 4; i++) merge(segBox([pts[i]!, pts[(i + 1) % 4]!], width));
        break;
      }
      case 'gr_line':
        if (prim.start && prim.end) merge(segBox([prim.start, prim.end], width));
        break;
      case 'gr_circle': {
        if (!prim.center || !prim.end) break;
        const c = prim.center;
        // `EDA_SHAPE::GetRadius()`: `KiROUND( hypot )`
        const r = KiROUND(hypot(prim.end.x - c.x, prim.end.y - c.y));
        if (prim.fill) merge({ x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r });
        if (width > 0 || !prim.fill) {
          // `SHAPE_ARC( center, end, ANGLE_360, width )`: every quadrant point
          // is on it, so its box is the circle's, grown by KiROUND( w/2 ) + 1
          const rr = KiROUND(hypot(prim.end.x - c.x, prim.end.y - c.y));
          merge(
            boxInflate(
              boxOf([
                prim.end,
                { x: c.x + rr, y: c.y },
                { x: c.x, y: c.y + rr },
                { x: c.x - rr, y: c.y },
                { x: c.x, y: c.y - rr },
              ]),
              KiROUND(width / 2.0) + 1,
            ),
          );
        }
        break;
      }
      case 'gr_arc':
        if (prim.start && prim.mid && prim.end)
          merge(arcTrackBox(prim.start, prim.mid, prim.end, width));
        break;
      default:
        break;
    }
  }
  void maxError;
  return box ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/**
 * `buildThermalSpokes` for a PCB_VIA — only ever asked in a hatched zone
 * ("We don't currently support via thermal connections *except* in a hatched
 * zone"): the via is circular, `thermalSpokeAngle` stays at its default of
 * 0°, the gap and spoke width are the zone's, the width clamped to the via's
 * diameter, and the box is `PCB_VIA::GetBoundingBox( aLayer )` — the rounded-
 * up radius `( width + 1 ) / 2`, one unit wider at the far edge.
 */
function viaThermalSpokes(v: PcbVia, zone: PcbZone, maxError: number): ThermalSpoke[] {
  const gap = zone.thermalGap ?? mmToIU(0.5);
  const width = Math.min(zone.thermalBridgeWidth ?? mmToIU(0.5), v.size);
  if (width < (zone.minThickness ?? 0)) return [];
  const zoneHalfWidth =
    (zone.fillMode === 'hatch' ? (zone.hatchThickness ?? 0) : (zone.minThickness ?? 0)) / 2;
  const inflate = gap + maxError + zoneHalfWidth;
  const radius = Math.trunc((v.size + 1) / 2);
  // the box is `[pos, dim)`: width `2 * radius + 1`, then `Inflate( inflate )`
  const half = KiROUND((2 * radius + 1 + 2 * inflate) / 2.0);
  return spokesFromOrigin({ x: half, y: half }, 0, Math.trunc(width / 2)).map((sp) =>
    placeSpoke(sp, 0, v.at),
  );
}

/**
 * `ZONE_FILLER::buildHatchZoneThermalRings`: in a hatched zone every
 * thermally connected pad and via gets a RING of copper — inner radius at the
 * thermal gap, as wide as the spoke — clipped to the smoothed outline, so
 * the webbing has something to reach that is not the pad itself. Circular
 * items are `TransformRingToPolygon`; anything else is the pad grown by gap +
 * width minus the pad grown by the gap.
 */
function hatchThermalRing(
  item: { pad: PcbPad } | { via: PcbVia },
  zone: PcbZone,
  smoothedOutline: Polygon[],
  maxError: number,
  rules: ZONE_RULE_RESOLVER,
  layer: string,
): Polygon[] {
  const minThk = zone.minThickness ?? 0;
  let ring: Polygon[];
  if ('via' in item) {
    const v = item.via;
    const padRadius = Math.trunc(v.size / 2);
    const thermalGap = zone.thermalGap ?? mmToIU(0.5);
    const spokeWidth = Math.min(zone.thermalBridgeWidth ?? mmToIU(0.5), padRadius * 2);
    if (spokeWidth < minThk) return [];
    const ringInnerRadius = padRadius + thermalGap;
    ring = [
      [
        ...transformRingToPolygon(
          v.at,
          ringInnerRadius + Math.trunc(spokeWidth / 2),
          spokeWidth,
          maxError,
          ErrorLoc.ERROR_OUTSIDE,
        ),
      ],
    ];
  } else {
    const pad = item.pad;
    const resolved = padRules(pad, zone, rules, layer);
    const thermalGap = resolved.gap;
    const spokeWidth = Math.min(resolved.spokeWidth, Math.min(pad.size.x, pad.size.y));
    if (spokeWidth < minThk) return [];
    const circular = pad.shape === 'circle' || (pad.shape === 'oval' && pad.size.x === pad.size.y);
    if (circular) {
      const padRadius = Math.trunc(Math.max(pad.size.x, pad.size.y) / 2);
      const ringInnerRadius = padRadius + thermalGap;
      ring = [
        [
          ...transformRingToPolygon(
            padShapePos(pad),
            ringInnerRadius + Math.trunc(spokeWidth / 2),
            spokeWidth,
            maxError,
            ErrorLoc.ERROR_OUTSIDE,
          ),
        ],
      ];
    } else {
      const outer = padTransformShapeToPolygon(
        pad,
        thermalGap + spokeWidth,
        maxError,
        ErrorLoc.ERROR_OUTSIDE,
      );
      const inner = padTransformShapeToPolygon(pad, thermalGap, maxError, ErrorLoc.ERROR_OUTSIDE);
      ring = booleanSubtract(outer, inner);
    }
  }
  // "Clip the thermal ring to the zone boundary so it doesn't overflow"
  return booleanIntersection(ring, smoothedOutline);
}

/**
 * The points that stand for a pad's own copper in the island test.
 *
 * `CN_CLUSTER::IsOrphaned()` is `m_originPad == nullptr` — a fill outline is
 * isolated only when NOTHING in its cluster is a PAD — so an outline that
 * merely overlaps its own pad is connected, spoke or no spoke.
 *
 * That is not a corner case. A thermal spoke starts at the pad CENTRE, and the
 * drill knockout takes its root out, leaving a fragment that sits on the pad's
 * copper and touches nothing else. KiCad keeps those; a test that knew only the
 * spoke TIPS dropped them — four of them on kit-dev's JP101 alone.
 */
function padAnchors(pad: PcbPad): Vec2[] {
  const shapes = padShapes(pad);
  const centre = padShapePos(pad);
  const out: Vec2[] = [centre];
  const inside = (p: Vec2): boolean =>
    shapes.some((s) => shapeDist({ kind: 'circle', c: p, r: 0 }, s) <= 0);

  // A 5 x 5 lattice over the pad's own extent, the ones that land on copper.
  // A point is all this test can ask, so the pad is covered by several rather
  // than spoken for by its centre — which, on a through pad, is inside the
  // drill and on no copper at all.
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      if (i === 0 && j === 0) continue;
      const local = rotate({ x: (i * pad.size.x) / 5, y: (j * pad.size.y) / 5 }, pad.angle ?? 0);
      const p = { x: centre.x + local.x, y: centre.y + local.y };
      if (inside(p)) out.push(p);
    }
  }

  return out;
}

/**
 * The points that stand for a via's copper in the island test.
 *
 * The connectivity engine's `CN_ITEM` for a via is its whole annulus, and a
 * fill outline is in the via's cluster when the two OVERLAP — anywhere. A
 * centre point cannot say that: on tinytapeout a 0.65 mm GND via sits with
 * its centre 0.1 mm outside a sliver of the pour and its rim 0.3 mm inside
 * it, and upstream keeps the sliver where this dropped it.
 *
 * The centre plus a ring of points just inside the rim. Sixteen is enough
 * that a piece of copper the via's rim crosses at all — one at least the
 * zone's minimum thickness wide — meets one of them.
 */
function viaAnchors(v: PcbVia): Vec2[] {
  const out: Vec2[] = [v.at];
  const r = v.size / 2 - 1;
  if (r <= 0) return out;
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    out.push({ x: v.at.x + r * Math.cos(a), y: v.at.y + r * Math.sin(a) });
  }
  return out;
}

/** Is `p` inside `poly`'s outer ring and outside every hole? */
function pointInPolygon(poly: Polygon, p: Vec2): boolean {
  const outer = poly[0];
  if (!outer || !pointInRing(p, outer)) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i]!)) return false;
  return true;
}

/**
 * `buildThermalSpokes`' `customSpokes` branch (zone_filler.cpp:3560-3620): a
 * CUSTOM pad whose primitives include proxy SEGMENTs says where its spokes
 * go. Each template is rotated with the pad and moved to `ShapePos`, turned
 * so that A is the end inside the pad's effective polygon (dropped when
 * neither is), and TRIMMED: B is moved to the first crossing of the pad
 * grown by the thermal gap + maxError (`trimToOutline`), provided the segment
 * crosses the pad's own outline at all. Two edge lines half a spoke width
 * either side, each pushed half a width past both ends, are trimmed the same
 * way — both must cross, or there is no spoke — and the five points are the
 * two at A, the two trimmed edge ends and the trimmed centre, all three
 * pushed out by the zone's minimum thickness, the centre one being the test
 * point at index 3.
 */
function customThermalSpokes(
  pad: PcbPad,
  zone: PcbZone,
  templates: PadPrimitive[],
  width: number,
  maxError: number,
  gap: number,
): ThermalSpoke[] {
  const spokeHalfW = Math.trunc(width / 2);
  const orientation = new EDA_ANGLE(pad.angle ?? 0);
  const shapePos = padShapePos(pad);

  const thermalPoly = padTransformShapeToPolygon(
    pad,
    gap + maxError,
    maxError,
    ErrorLoc.ERROR_OUTSIDE,
  );
  const thermalOutline = thermalPoly[0]?.[0] ?? [];
  const effective = padTransformShapeToPolygon(pad, 0, maxError, ErrorLoc.ERROR_OUTSIDE);
  const padOutline = effective[0]?.[0] ?? [];
  // `SHAPE_POLY_SET::Contains( aP )`: inside an outline and in none of its holes.
  const contains = (pt: Vec2): boolean =>
    effective.some(
      (poly) =>
        chainPointInside(poly[0]!, pt) && !poly.slice(1).some((h) => chainPointInside(h, pt)),
    );

  // `trimToOutline`: crosses the pad outline, and then B becomes the first
  // crossing of the thermal outline.
  const trimToOutline = (seg: { a: Vec2; b: Vec2 }): boolean => {
    if (chainIntersect(padOutline, seg.a, seg.b).length === 0) return false;
    const hits = chainIntersect(thermalOutline, seg.a, seg.b);
    if (hits.length === 0) return false;
    seg.b = { x: hits[0]!.p.x, y: hits[0]!.p.y };
    return true;
  };

  const out: ThermalSpoke[] = [];
  for (const prim of templates) {
    const rotA = RotatePoint({ x: prim.start!.x, y: prim.start!.y }, orientation);
    const rotB = RotatePoint({ x: prim.end!.x, y: prim.end!.y }, orientation);
    const seg = {
      a: { x: rotA.x + shapePos.x, y: rotA.y + shapePos.y },
      b: { x: rotB.x + shapePos.x, y: rotB.y + shapePos.y },
    };
    // "Make sure seg.A is the origin"
    if (!contains(seg.a)) {
      if (!contains(seg.b)) continue;
      [seg.a, seg.b] = [seg.b, seg.a];
    }
    if (!trimToOutline(seg)) continue;
    let direction = ResizeI({ x: seg.b.x - seg.a.x, y: seg.b.y - seg.a.y }, spokeHalfW);
    const offset = ResizeI(Perpendicular(direction), spokeHalfW);
    const segL = {
      a: { x: seg.a.x - direction.x - offset.x, y: seg.a.y - direction.y - offset.y },
      b: { x: seg.b.x + direction.x - offset.x, y: seg.b.y + direction.y - offset.y },
    };
    const segR = {
      a: { x: seg.a.x - direction.x + offset.x, y: seg.a.y - direction.y + offset.y },
      b: { x: seg.b.x + direction.x + offset.x, y: seg.b.y + direction.y + offset.y },
    };
    if (!(trimToOutline(segL) && trimToOutline(segR))) continue;
    direction = ResizeI(direction, zone.minThickness ?? 0);
    const tip = { x: seg.b.x + direction.x, y: seg.b.y + direction.y };
    const ring: Vec2[] = [
      { x: seg.a.x + offset.x, y: seg.a.y + offset.y },
      { x: seg.a.x - offset.x, y: seg.a.y - offset.y },
      { x: segL.b.x + direction.x, y: segL.b.y + direction.y },
      tip, // test pt at index 3
      { x: segR.b.x + direction.x, y: segR.b.y + direction.y },
    ];
    out.push({ geom: [ringOf(ring)], ring, tip });
  }
  return out;
}

// ----- the filler -------------------------------------------------------------

/** The fill polygons one zone would take, per layer (ZONE_FILLER::fillSingleZone). */
/**
 * Points along a same-net segment's centreline, as connectivity anchors.
 *
 * One point per item is not enough: a track's ends usually sit inside the
 * relief holes of the pads it lands on, so its START anchors whichever region
 * that hole happens to be in — or none.
 */
function alongSegment(a: Vec2, b: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= 4; i++)
    out.push({ x: a.x + ((b.x - a.x) * i) / 4, y: a.y + ((b.y - a.y) * i) / 4 });
  return out;
}

/**
 * `ZONE::HigherPriority` (zone.cpp:453).
 *
 * Three tests, in order: a teardrop outranks anything that is not one, then the
 * priority number, and then — the part that is easy to miss — the UUID. Two
 * ordinary zones of equal priority on different nets are NOT peers: one of them
 * wins and knocks the other out. Treating equal priority as "no knockout either
 * way", as this did, leaves both pours filling the overlap, which is a short.
 */
function higherPriority(a: PcbZone, b: PcbZone): boolean {
  const aTeardrop = a.teardropType !== undefined;
  const bTeardrop = b.teardropType !== undefined;
  if (aTeardrop !== bTeardrop) return aTeardrop;

  const ap = a.priority ?? 0;
  const bp = b.priority ?? 0;
  if (ap !== bp) return ap > bp;

  // `m_Uuid > aOther->m_Uuid` — KIID compares the bytes, and the canonical
  // lowercase hex form compares the same way as a string.
  return (a.uuid ?? '') > (b.uuid ?? '');
}

/**
 * `ZONE_FILLER::subtractHigherPriorityZones` (zone_filler.cpp:2676).
 *
 * Every zone on this layer that shares this zone's net code and carries a
 * STRICTLY greater assigned priority takes its own outline away from this
 * fill. Three details that a reading of the different-net knockout would get
 * wrong:
 *
 *  - `HigherPriority()` is deliberately NOT used — "we only want explicitly-
 *    higher priorities, not equal-priority zones", so the teardrop and UUID
 *    tie-breaks play no part and two same-net zones of equal priority both
 *    keep the overlap.
 *  - the knockout is the zone's raw outline (`appendZoneOutlineWithoutArcs`),
 *    not its smoothed outline and not its filled copper, and no clearance is
 *    added to it.
 *  - a teardrop area never knocks anything out here.
 *
 * `SameNet` is bare net-code equality, so two no-net zones qualify as well.
 */
function subtractHigherPriorityZones(
  fill: Polygon[],
  board: Board,
  zoneIndex: number,
  layer: string,
  near: (box: Box) => boolean,
): Polygon[] {
  if (fill.length === 0) return fill;

  const zone = board.zones[zoneIndex]!;
  const knockouts: Ring[][] = [];

  board.zones.forEach((other, i) => {
    if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
    if (other.net !== zone.net) return;
    if ((other.priority ?? 0) <= (zone.priority ?? 0)) return;
    if (other.teardropType !== undefined) return;
    if (!other.layers.includes(layer)) return;
    // "if( aKnockout->GetBoundingBox().Intersects( zoneBBox ) )".
    if (!near(boxOf(other.outline))) return;
    // `appendZoneOutlineWithoutArcs`: the whole `m_Poly`, holes included, so
    // a lower-priority pour fills inside a higher one's cutout.
    knockouts.push([intRingOf(other.outline), ...(other.holes ?? []).map(intRingOf)]);
  });

  if (knockouts.length === 0) return fill;

  return booleanSubtract(
    fill,
    knockouts.map((poly) => poly.map(ptsOf)),
  );
}

/**
 * `SHAPE_POLY_SET::Inflate( aAmount, aCornerStrategy, aMaxError, aSimplify )`:
 * the segment count is `GetArcToSegmentCount( |aAmount|, aMaxError, 360° )`.
 */
function inflateKi(
  polys: Polygon[],
  amount: number,
  strategy: CornerStrategy,
  maxError: number,
  simplify = false,
): Polygon[] {
  return inflate(polys, amount, strategy, segmentsForRadius(Math.abs(amount), maxError), simplify);
}

/** The `islandExtents.GetSizeMax()` of `fillCopperZone`'s blob test. */
function islandExtentMax(poly: Polygon): number {
  const outer = poly[0];
  if (!outer || outer.length === 0) return 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of outer) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

/**
 * One zone's copper, per layer, BEFORE the island pass — with the anchors that
 * pass will need.
 *
 * `ZONE_FILLER::Fill` pours every zone and only then calls
 * `FillIsolatedIslandsMap`, so what decides an island is the finished board,
 * not the board as it stood when this zone's turn came. Splitting the two is
 * what lets `fillZones` ask the question in upstream's order.
 */
interface ZoneFillParts {
  layer: string;
  polys: Vec2[][];
  /** Points where same-net copper reaches this layer's pour. */
  connected: Vec2[];
  /**
   * `m_preKnockoutFillCache`: the fill BEFORE the different-net zone
   * knockouts, which the iterative refill starts over from.
   */
  preKnockout: Polygon[];
}

function fillZoneParts(
  board: Board,
  zoneIndex: number,
  opts: ZoneFillOptions = {},
  onlyLayers?: ReadonlySet<string>,
): ZoneFillParts[] {
  const zone = board.zones[zoneIndex];
  if (!zone?.outline || zone.outline.length < 3) return [];

  const maxError = opts.maxError ?? DEFAULT_MAX_ERROR;
  const clearanceOf = opts.clearanceOf ?? ((z: PcbZone) => z.clearance ?? mmToIU(0.5));
  // The thermal gap, the spoke width and the zone connection are the DRC
  // engine's answers, as they are upstream - so a `.kicad_dru` that names a
  // pad, a footprint or a net reaches the pour, which is what three local
  // re-implementations of `EvalRules` could not do.
  const rules: ZONE_RULE_RESOLVER = opts.rules ?? new ZONE_FILLER(modelOf(board, 'board'));
  const fills: ZoneFillParts[] = [];

  // `ZONE_FILLER::Fill`'s `m_brdOutlinesValid = GetBoardPolygonOutlines( … )`,
  // handed to `BuildSmoothedPoly` as `aBoardOutline` and used there for one
  // line: `aSmoothedPoly.BooleanIntersection( boardOutline )` (zone.cpp:1594).
  //
  // This is the OTHER half of keeping the pour on the board, and knocking the
  // Edge.Cuts graphics out at the edge clearance is not a substitute for it.
  // A knockout only removes a band along each edge line; a zone outline drawn
  // past the board keeps every square millimetre beyond that band. On a real
  // board that was 28% more copper than KiCad pours — most of it outside the
  // board entirely.
  //
  // `success` false means the outline did not close, and upstream then passes
  // a null pointer and skips the intersection rather than clipping to a
  // half-built polygon.
  const brd = getBoardPolygonOutlines(board, maxError);
  const boardOutline: Geom | null =
    brd.success && brd.polygons.length > 0
      ? brd.polygons.map((poly) => [ringOf(poly.outline), ...poly.holes.map(ringOf)])
      : null;

  for (const layer of zone.layers) {
    if (onlyLayers && !onlyLayers.has(layer)) continue;

    // `ZONE::BuildSmoothedPoly( maxExtents, aLayer, boardOutline, &smoothedPoly )`:
    // the fill STARTS from the outline with its apron, and is trimmed back to
    // `maxExtents` only at the end (zone_filler.cpp:3126).
    const smoothed = buildSmoothedPoly(board, zoneIndex, layer, boardOutline, maxError);
    if (smoothed.maxExtents.length === 0) continue;

    // `fillSingleZone`: "if( aZone->IsOnCopperLayer() ) fillCopperZone( … )
    // else fillNonCopperZone( … )".
    if (!isCopper(layer)) {
      const polys = fillNonCopperZone(board, zoneIndex, layer, smoothed.smoothed, opts);
      fills.push({ layer, polys, connected: [], preKnockout: [] });
      continue;
    }
    const holes: Geom[] = [];
    const spokes: ThermalSpoke[] = [];
    // `knockoutThermalReliefs` keeps its reliefs in a set of its OWN and
    // subtracts them there and then. They are not part of `clearanceHoles`, so
    // they are never subtracted again — which is what lets a spoke, added
    // after them, cross the relief it is there to bridge.
    const reliefHoles: Geom[] = [];
    // Subtracted last of all, after the spokes and the prune (zone_filler.cpp:3130).
    const thermalHoles: Geom[] = [];
    // A hatched zone: the thermally connected pads and vias get rings
    // (`buildHatchZoneThermalRings`), and a solidly connected via has the
    // hatch hole around it dropped so it stays on the webbing.
    const hatch = zone.fillMode === 'hatch';
    const ringItems: ({ pad: PcbPad } | { via: PcbVia })[] = [];
    const solidVias: PcbVia[] = [];
    const connected: Vec2[] = []; // same-net anchors, for island removal

    const gapTo = (net: number): number => clearanceOf(zone, net);

    // `BOX2I zone_boundingbox = aZone->GetBoundingBox(); zone_boundingbox.Inflate(
    // m_worstClearance + extra_margin )`, and every knockout below is guarded by
    // `…->GetBoundingBox().Intersects( zone_boundingbox )`. Without the guard a
    // small pour still polygonises every pad and every track on the board:
    // `m_worstClearance` is `BOARD::GetMaxClearanceValue`, the largest gap any
    // rule can ask for, so nothing that could reach the zone is skipped.
    // `BOARD_DESIGN_SETTINGS::GetBiggestClearanceValue`: the board minimum
    // clearance, hole clearance, hole-to-hole and copper-to-edge, then the
    // worst of every clearance rule and netclass.
    //
    // `QueryWorstConstraint( PHYSICAL_CLEARANCE_CONSTRAINT )` counts every rule
    // whatever its condition, and `loadImplicitRules` always adds "barcode
    // visual separation default", a 1 mm physical clearance on
    // `A.Type == 'Barcode'` (drc_engine.cpp:259-263). So the worst clearance
    // on any board is at least 1 mm, and a board edge 0.6 mm from a pour is
    // knocked out where a smaller guard would have skipped it.
    let worstClearance = Math.max(
      opts.minClearance ?? 0,
      opts.holeClearance ?? 0,
      opts.holeToHoleMin ?? 0,
      opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE,
      opts.worstNetClassClearance ?? 0,
      BARCODE_VISUAL_SEPARATION_DEFAULT,
    );
    for (const net of board.nets.keys()) worstClearance = Math.max(worstClearance, gapTo(net));
    // `GetMaxClearanceValue` walks the items too, and a local override on one
    // pad can be larger than any netclass on the board.
    for (const fp of board.footprints) {
      for (const pad of fp.pads) {
        // `pad->GetClearanceOverrides( nullptr )`: the pad's own, else its
        // footprint's.
        const override = pad.localClearance ?? fp.localClearance;
        if (override !== undefined) worstClearance = Math.max(worstClearance, override);
      }
    }
    // `GetMaxClearanceValue` walks the zones too: another zone's own
    // `(clearance …)` is a gap this pour has to keep.
    for (const z of board.zones)
      if (!z.ruleArea && z.clearance !== undefined)
        worstClearance = Math.max(worstClearance, z.clearance);
    const rawZoneBox = boxOf(zone.outline);
    const zoneBox = boxInflate(rawZoneBox, worstClearance + EXTRA_CLEARANCE);
    const near = (b: Box): boolean => boxesIntersect(b, zoneBox);

    const stage = (name: string, polys: Polygon[]): void => {
      if (opts.onStage) opts.onStage(name, layer, polys);
    };

    let fill: Polygon[] = smoothed.smoothed;
    stage('smoothed-outline', fill);

    // Pads (`ZONE_FILLER::knockoutThermalReliefs` and, for the ones it hands on,
    // `knockoutPadClearance`).
    for (const fp of board.footprints) {
      for (const pad of fp.pads) {
        // "NPTH pads with a drill hole affect all copper layers even when they
        // carry no copper on that layer": everything else off this layer is
        // skipped outright, hole and all.
        const npthWithHole = pad.type === 'np_thru_hole' && pad.drill !== undefined;
        if (!padOnLayer(pad, layer) && !npthWithHole) continue;

        // "padBBox.Inflate( m_worstClearance ); if( !padBBox.Intersects(
        // aZone->GetBoundingBox() ) ) continue" — the pad's REAL box against
        // the zone's own, not the extra-margin one the copper items get.
        if (!boxesIntersect(boxInflate(padBox(pad), worstClearance), rawZoneBox)) continue;

        const holeRadius = pad.drill ? Math.max(pad.drill.w, pad.drill.h) / 2 : 0;

        // `noConnection`: a different net, or any pad at all on a zone with no
        // net of its own.
        const sameNet = (pad.net ?? 0) === zone.net && zone.net > 0;
        // `EvalZoneConnection( pad, aZone, aLayer )` - the pad's own
        // `(zone_connect …)`, else its footprint's, else the zone's, and any
        // `.kicad_dru` rule that names either of them, with THT_THERMAL
        // resolved. `noConnection`: a different net, or any pad at all on a
        // zone with no net of its own, never asks.
        const mode: ZoneConnection = sameNet
          ? ZONE_CONNECTION_VIEW[padRules(pad, zone, rules, layer).connection]
          : 'none';

        if (mode === 'full') {
          // A solid connection knocks out nothing — not the pad, and not its
          // hole either — so the pour runs straight over the pad's copper.
          connected.push(...padAnchors(pad));
          continue;
        }

        if (mode === 'thermal') {
          // A thermally-relieved pad's own copper sits INSIDE the relief hole;
          // what touches the pour is its spokes, so its anchors are added with
          // them below.
          const reliefGap = padRules(pad, zone, rules, layer).gap;
          reliefHoles.push(
            ...asGeoms(
              padTransformShapeToPolygon(pad, reliefGap, maxError, ErrorLoc.ERROR_OUTSIDE),
            ),
          );
          spokes.push(...thermalSpokes(pad, zone, maxError, rules, layer));
          if (hatch) ringItems.push({ pad });
          // The pad is in the cluster whether or not a spoke survives, so any
          // copper left standing on it is connected copper.
          connected.push(...padAnchors(pad));

          // "Ensure additive changes (thermal stubs …) do not add copper …
          // inside the clearance holes": the drill of every thermally
          // connected pad is knocked out at gap ZERO, and only at the END —
          // after the spokes have been added and the min-width prune has run.
          // The spokes all start at the pad centre, so without this the four
          // of them fill the middle of the pad's own hole.
          thermalHoles.push(
            ...asGeoms(padTransformHoleToPolygon(pad, 0, maxError, ErrorLoc.ERROR_OUTSIDE)),
          );
          continue;
        }

        // In a hatched zone a same-net pad with NO connection is not knocked
        // out here: "NONE connections get handled later in
        // buildCopperItemClearances" (zone_filler.cpp:1882-1920), so it takes
        // the different-net path below, extra margin and all.
        if (sameNet && mode === 'none' && !hatch) {
          // A same-net pad with NO connection is knocked out right here in
          // `knockoutThermalReliefs`, into the same set as the reliefs: the
          // gap is the physical clearance or the zone's own, whichever is
          // larger, with NO `m_ExtraClearance`, and a flashed pad's hole is
          // not knocked out separately (zone_filler.cpp:1955-1980).
          const padClearance = Math.max(opts.physicalClearance ?? 0, zone.clearance ?? 0);
          if (padOnLayer(pad, layer) && pad.type !== 'np_thru_hole') {
            reliefHoles.push(
              ...asGeoms(
                padTransformShapeToPolygon(pad, padClearance, maxError, ErrorLoc.ERROR_OUTSIDE),
              ),
            );
          } else if (pad.drill) {
            const holeClearance = Math.max(opts.physicalHoleClearance ?? 0, padClearance);
            reliefHoles.push(
              ...asGeoms(
                padTransformHoleToPolygon(pad, holeClearance, maxError, ErrorLoc.ERROR_OUTSIDE),
              ),
            );
          }
          continue;
        }

        // Every different-net pad. `knockoutPadClearance` treats the copper
        // and the hole as two separate knockouts with two different gaps.
        //
        // "if( flashLayer && gap >= 0 ) addKnockout( … )" — the COPPER only
        // goes when the pad HAS copper on this layer, and an NPTH whose drill
        // fills its pad has none ("NPTH do not need copper clearance gaps to
        // their holes"). Knocking its shape out as well takes away copper
        // KiCad pours.
        const override = padClearanceOverride(pad, fp);
        const npth = pad.type === 'np_thru_hole';

        // `CLEARANCE_CONSTRAINT( aZone, aPad )`: the override, floored at the
        // board minimum, or else the ordinary net-based answer.
        const copperGap =
          override !== undefined ? Math.max(override, opts.minClearance ?? 0) : gapTo(pad.net ?? 0);
        // `HOLE_CLEARANCE_CONSTRAINT( aZone, aPad )`: the same override,
        // floored at the board's hole clearance instead.
        const holeClearance =
          override !== undefined
            ? Math.max(override, opts.holeClearance ?? 0)
            : (opts.holeClearance ?? 0);

        if (padOnLayer(pad, layer) && !npth) {
          holes.push(
            ...asGeoms(
              padTransformShapeToPolygon(
                pad,
                copperGap + EXTRA_CLEARANCE,
                maxError,
                ErrorLoc.ERROR_OUTSIDE,
              ),
            ),
          );
        }

        // The hole's own gap: the board's hole clearance, and — "oblong NPTH
        // holes are milled rather than drilled, so they need edge clearance in
        // addition to hole clearance" — the edge clearance for a slot. A plated
        // hole also takes the ordinary clearance; an NPTH does not.
        let holeGap = holeClearance;
        if (!npth) holeGap = Math.max(holeGap, copperGap);
        if (npth && pad.drill && pad.drill.w !== pad.drill.h)
          holeGap = Math.max(holeGap, opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE);

        holes.push(
          ...asGeoms(
            padTransformHoleToPolygon(
              pad,
              holeGap + EXTRA_CLEARANCE,
              maxError,
              ErrorLoc.ERROR_OUTSIDE,
            ),
          ),
        );
      }
    }

    // "For hatch zones, vias also need thermal treatment to prevent isolation
    // inside hatch holes" (zone_filler.cpp:1992-2100) — still inside
    // `knockoutThermalReliefs`, after the pads and in track order.
    // `EvalZoneConnection( via, zone )`: a via has no override, so the zone's
    // own; THT_THERMAL resolves to FULL, a via being no pad.
    if (hatch)
      for (const v of board.vias) {
        if (!viaIsOnLayer(v, layer)) continue;
        if (!boxesIntersect(boxInflate(trackBox(v.at, v.at, v.size), worstClearance), rawZoneBox))
          continue;
        if (v.net !== zone.net || zone.net <= 0) continue;
        const conn = zone.padConnection ?? 'thermal';
        const mode = conn === 'thru_hole_only' ? 'full' : conn;
        if (mode === 'thermal') {
          const thermalGap = zone.thermalGap ?? mmToIU(0.5);
          // "Only force thermal if the via is small enough to be isolated"
          if (thermalGap > 0) {
            reliefHoles.push(
              ...asGeoms(
                viaTransformShapeToPolygon(v, thermalGap, maxError, ErrorLoc.ERROR_OUTSIDE),
              ),
            );
            spokes.push(...viaThermalSpokes(v, zone, maxError));
            ringItems.push({ via: v });
          }
        } else if (mode === 'full') solidVias.push(v);
      }

    /* ---------------------------------------------------------------------
     * Knockout thermal reliefs: `aFill.BooleanSubtract( holes )`, the reliefs
     * and the same-net no-connection pads, and nothing else.
     */
    fill = booleanSubtract(fill, reliefHoles.flatMap(asPolys));
    stage('minus-thermal-reliefs', fill);

    // "For hatch zones, add thermal rings around pads with thermal relief."
    let thermalRings: Polygon[] = [];
    if (hatch) {
      for (const item of ringItems) {
        const ring = hatchThermalRing(item, zone, smoothed.smoothed, maxError, rules, layer);
        fill = booleanAdd(fill, ring);
        thermalRings = booleanAdd(thermalRings, ring);
      }
      stage('plus-thermal-rings', fill);
    }

    // `buildCopperItemClearances` walks the board in ONE order, and the
    // order is not cosmetic: the knockouts are unioned into a single poly
    // set, and where a ring of Clipper's answer STARTS depends on the order
    // its inputs arrived in. `Fracture` then bridges each hole from its
    // first leftmost vertex, so a ring rotated by one vertex is a slit
    // landing on a different corner, and a fill that is the same copper
    // with different vertices. Tracks, arcs and vias come in the file's own
    // interleaving (`m_board->Tracks()`); then per footprint the reference,
    // the value and its graphical items in file order; then the board's
    // drawings in file order; then the zones.
    const fileOrder = new Map<unknown, number>();
    board.k?.Tracks().forEach((t, i) => {
      fileOrder.set(t, i);
    });
    board.k?.Drawings().forEach((d, i) => {
      fileOrder.set(d, i);
    });
    const at = (item: { k?: unknown }): number => fileOrder.get(item.k) ?? Number.MAX_SAFE_INTEGER;

    const copperItems: { at: number; run: () => void }[] = [];
    // Tracks, arcs and vias on other nets.
    for (const t of board.tracks)
      copperItems.push({
        at: at(t),
        run: () => {
          if (t.layer !== layer) return;
          if (!near(trackBox(t.start, t.end, t.width))) return;
          if (t.net === zone.net && zone.net > 0) {
            connected.push(...alongSegment(t.start, t.end));
            return;
          }
          holes.push(
            ...asGeoms(
              trackTransformShapeToPolygon(
                t,
                gapTo(t.net) + EXTRA_CLEARANCE,
                maxError,
                ErrorLoc.ERROR_OUTSIDE,
              ),
            ),
          );
        },
      });
    for (const a of board.arcs)
      copperItems.push({
        at: at(a),
        run: () => {
          if (a.layer !== layer) return;
          if (!near(arcTrackBox(a.start, a.mid, a.end, a.width))) return;
          if (a.net === zone.net && zone.net > 0) {
            const pts = tessellateArc(a.start, a.mid, a.end);
            for (let i = 1; i < pts.length; i++)
              connected.push(...alongSegment(pts[i - 1]!, pts[i]!));
            return;
          }
          // `PCB_TRACK::TransformShapeToPolygon`, PCB_ARC_T: "width = m_width + ( 2
          // * aClearance )" into `TransformArcToPolygon`.
          holes.push(
            ...asGeoms(
              arcTrackTransformShapeToPolygon(
                a,
                gapTo(a.net) + EXTRA_CLEARANCE,
                maxError,
                ErrorLoc.ERROR_OUTSIDE,
              ),
            ),
          );
        },
      });
    for (const v of board.vias)
      copperItems.push({
        at: at(v),
        run: () => {
          // "if( !track->IsOnLayer( aLayer ) ) continue": a blind or buried
          // via is only on the layers it was drilled between.
          if (!viaIsOnLayer(v, layer)) return;
          // "viaBBox.Inflate( m_worstClearance ); if( !viaBBox.Intersects(
          // aZone->GetBoundingBox() ) )".
          if (!boxesIntersect(boxInflate(trackBox(v.at, v.at, v.size), worstClearance), rawZoneBox))
            return;
          if (v.net === zone.net && zone.net > 0) {
            connected.push(...viaAnchors(v));
            return;
          }
          // `knockoutTrackClearance`, PCB_VIA_T: the copper at the clearance, and
          // the DRILL at the larger of that and the hole clearance
          // (zone_filler.cpp:2303-2320) — a second circle, usually inside the
          // first, in the same set.
          const viaGap = gapTo(v.net);
          holes.push(
            ...asGeoms(
              viaTransformShapeToPolygon(
                v,
                viaGap + EXTRA_CLEARANCE,
                maxError,
                ErrorLoc.ERROR_OUTSIDE,
              ),
            ),
          );
          const drillGap = Math.max(viaGap, opts.holeClearance ?? 0);
          holes.push([
            transformCircleToPolygonSet(
              v.at,
              Math.trunc(v.drill / 2) + drillGap + EXTRA_CLEARANCE,
              maxError,
              ErrorLoc.ERROR_OUTSIDE,
            ).map((p) => [p.x, p.y] as [number, number]),
          ]);
        },
      });
    copperItems.sort((p, q) => p.at - q.at);
    for (const item of copperItems) item.run();

    // Footprints: courtyard (no physical clearance rule, so nothing), the
    // reference, the value, then the graphical items in file order; then the
    // board's own drawings in file order.
    const knockoutGraphic = (s: PcbShape): void => {
      // Board graphics, and the BOARD EDGE (`zone_filler.cpp:2400-2440`).
      //
      // "A item on the Edge_Cuts or Margin is always seen as on any layer", so
      // the board outline knocks copper out of every zone on every layer — and
      // it is the one item measured against `EDGE_CLEARANCE_CONSTRAINT` rather
      // than the ordinary clearance. That gap is the inset a filled board has
      // all the way round its edge, and this filler had no board-graphics
      // knockout at all: the pour ran to the outline the user drew, straight
      // over the edge and over every copper graphic on its own layer.
      //
      // `ignoreLineWidths = true` for Edge.Cuts and only for Edge.Cuts: the
      // outline graphic's stroke is a drawing convention, and the board edge is
      // its CENTRELINE. Margin keeps its width.
      const onLayer = s.layer === layer;
      const isEdge = s.layer === 'Edge.Cuts';
      const isMargin = s.layer === 'Margin';
      if (!onLayer && !isEdge && !isMargin) return;
      // "if( aItem->GetBoundingBox().Intersects( zone_boundingbox ) )" — the
      // top edge of a board whose pour sits well below it is not knocked out,
      // and so never joins the other three edges into one band.
      if (!near(shapeBox(s))) return;

      // "if( !aZone->IsTeardropArea() && aZone->GetNetCode() == 0 ) sameNet =
      // false" — a zone with no net is never the same net as anything.
      const sameNet = (s.net ?? 0) === zone.net && zone.net > 0;

      // The CLEARANCE_CONSTRAINT upgrade applies only to a different-net item
      // on this layer; everything else falls back to the physical clearance,
      // which is 0 on a board with no rules.
      const gap =
        isEdge || isMargin
          ? (opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE)
          : sameNet
            ? 0
            : gapTo(s.net ?? 0);

      holes.push(
        ...asGeoms(
          edaShapeTransformShapeToPolygon(
            s,
            gap + EXTRA_CLEARANCE,
            maxError,
            ErrorLoc.ERROR_OUTSIDE,
            isEdge,
          ),
        ),
      );
    };

    const knockoutText = (t: PcbTextItem): void => {
      // Copper TEXT, which `knockoutGraphicClearance` treats exactly like a
      // graphic — `addKnockout` has a `PCB_TEXT_T` case
      // (zone_filler.cpp:1735-1760). Without it the pour ran straight through the
      // lettering on a copper layer: on complex_hierarchy a two-line B.Cu label
      // is 140 mm² of copper we filled and KiCad does not, which is not a
      // cosmetic difference but a short.
      const onLayer = t.layer === layer;
      const isEdge = t.layer === 'Edge.Cuts';
      const isMargin = t.layer === 'Margin';
      if (!onLayer && !isEdge && !isMargin) return;

      // Text carries no net, so it is never the same net as the pour: `shapeNet`
      // is -1 for anything that is not a PCB_SHAPE.
      const gap = isEdge || isMargin ? (opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE) : gapTo(0);

      // `if( text->IsVisible() )` — and then the rendered hull,
      // `text->TransformShapeToPolygon( aHoles, aLayer, aGap, m_maxError,
      // ERROR_OUTSIDE )`, or for knockout text the rendered strokes themselves.
      if (t.hide) return;
      const polys = t.knockout
        ? textTransformTextToPolySet(t, 0, maxError, ErrorLoc.ERROR_INSIDE)
        : textTransformShapeToPolygon(t, gap + EXTRA_CLEARANCE, maxError, ErrorLoc.ERROR_OUTSIDE);
      if (polys.length === 0) return;
      // `aItem->GetBoundingBox().Intersects( zone_boundingbox )`
      if (!near(boxOf(polys.flatMap((poly) => poly[0]!)))) return;
      holes.push(...asGeoms(polys));
    };

    const fpOrder = (fp: PcbFootprint): Map<unknown, number> => {
      const m = new Map<unknown, number>();
      fp.k?.GraphicalItems().forEach((g, i) => {
        m.set(g, i);
      });
      return m;
    };
    // The view lists the two mandatory fields among `texts`; the other fields
    // live in `fields` and are not graphical items.
    const isField = (t: PcbTextItem): boolean => t.kind === 'reference' || t.kind === 'value';

    for (const fp of board.footprints) {
      const ref = fp.texts.find((t) => t.kind === 'reference');
      const val = fp.texts.find((t) => t.kind === 'value');
      if (ref) knockoutText(ref);
      if (val) knockoutText(val);
      const order = fpOrder(fp);
      const items: { at: number; run: () => void }[] = [];
      for (const s of fp.shapes ?? [])
        items.push({
          at: order.get(s.k) ?? Number.MAX_SAFE_INTEGER,
          run: () => knockoutGraphic(s),
        });
      // `GraphicalItems()` holds every text that is not a field.
      for (const t of fp.texts)
        if (!isField(t))
          items.push({
            at: order.get(t.k) ?? Number.MAX_SAFE_INTEGER,
            run: () => knockoutText(t),
          });
      items.sort((p, q) => p.at - q.at);
      for (const item of items) item.run();
    }

    const drawings: { at: number; run: () => void }[] = [];
    for (const s of board.shapes) drawings.push({ at: at(s), run: () => knockoutGraphic(s) });
    for (const t of board.texts) drawings.push({ at: at(t), run: () => knockoutText(t) });
    drawings.sort((p, q) => p.at - q.at);
    for (const item of drawings) item.run();

    // A barcode on this layer knocks the pour out — `ZONE_FILLER::…`'s
    // `case PCB_BARCODE_T` (`zone_filler.cpp:1765-1770`):
    //
    //     barcode->GetBoundingHull( aHoles, aLayer, aGap, m_maxError, ERROR_OUTSIDE );
    //
    // `GetBoundingHull`, NOT `TransformShapeToPolygon`. Every other item hands
    // the filler its own outline; a barcode hands it two RECTANGLES, one round
    // the symbol and one round the text. So copper is kept out of the whole
    // box rather than threaded between the modules — which is the only useful
    // answer, since a pour reaching into a QR code's light squares would make
    // it unreadable.
    for (const bc of [...board.barcodes, ...board.footprints.flatMap((f) => f.barcodes)]) {
      if (bc.layer !== layer) continue;

      const g = barcodeGeometry(bc);
      for (const hull of barcodeHullBoxes(g, bc)) {
        holes.push(
          ...shapeToPolygon(
            {
              kind: 'poly',
              pts: [
                { x: hull.x1, y: hull.y1 },
                { x: hull.x2, y: hull.y1 },
                { x: hull.x2, y: hull.y2 },
                { x: hull.x1, y: hull.y2 },
              ],
              r: 0,
            },
            gapTo(0) + EXTRA_CLEARANCE,
            maxError,
          ),
        );
      }
    }

    // `ADVANCED_CFG::m_ZoneFillIterativeRefill` is true by default, and it
    // changes the shape of the fill: `buildCopperItemClearances( …,
    // aIncludeZoneClearances = false )` leaves the other zones OUT of the
    // clearance holes. The keepouts join them separately (and the set is
    // simplified a second time when any did); the different-net higher
    // priority zones become `zoneClearances`, a set of their own, subtracted
    // from the spoke test areas and, after the trim to the clearance holes,
    // from the fill — followed by `postKnockoutMinWidthPrune`.
    const keepoutHoles: Polygon[] = [];
    const zoneClearances: Polygon[] = [];
    board.zones.forEach((other, i) => {
      if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
      if (!other.layers.includes(layer)) return;
      // "if( aKnockout->GetBoundingBox().Intersects( zone_boundingbox ) )".
      if (!near(boxOf(other.outline))) return;

      // `isZoneFillKeepout`: a rule area with the copper-pour keepout set. Its
      // knockout is `TransformSmoothedOutlineToPolygon( …, 0, … )` — for a
      // rule area `BuildSmoothedPoly` hands the outline back untouched
      // ("We like keepouts just the way they are"), and no clearance means no
      // inflate, so it is the outline, fractured. A teardrop is exempt.
      if (other.ruleArea) {
        if (other.ruleArea.copperPour && !zone.teardropType)
          keepoutHoles.push(...fracture([[other.outline, ...(other.holes ?? [])]]).map((r) => [r]));
        return;
      }

      if (!higherPriority(other, zone) || other.net === zone.net) return;

      // `ZONE::TransformShapeToPolygon` takes the other zone's FILLED areas,
      // not its outline — "if( !m_FilledPolysList.count( aLayer ) ) return", so
      // a zone with nothing poured on this layer knocks nothing out — and
      // grows them with `InflateWithLinkedHoles`: unfractured, inflated,
      // fractured again. ERROR_OUTSIDE adds one maxError to the clearance.
      const otherFill = other.fills.find((f) => f.layer === layer);
      if (!otherFill || otherFill.polys.length === 0) return;

      // `EvalRules( CLEARANCE_CONSTRAINT, aZone, otherZone )`: "Local
      // clearance on %s" is asked of BOTH items, and the larger wins — so the
      // other zone's own `(clearance …)` raises this gap as much as ours does
      // (drc_engine.cpp:1908-1953; `ZONE::GetLocalClearance` is
      // `m_ZoneClearance`).
      const gap = Math.max(gapTo(other.net), other.clearance ?? 0);
      if (gap < 0) return; // "Negative clearance permits zones to short"

      const amount = gap + EXTRA_CLEARANCE + maxError;
      for (const ring of inflateWithLinkedHoles(
        otherFill.polys.map((poly) => [poly]),
        amount,
        CornerStrategy.ROUND_ALL_CORNERS,
        segmentsForRadius(amount, maxError),
      ))
        zoneClearances.push([ring]);
    });

    // `buildCopperItemClearances` ends with `aHoles.Simplify()`: the knockouts
    // become ONE poly set. `Simplify` is `splitCollinearOutlines` — which
    // finds nothing to split in a set of simple shapes — and then a union with
    // an empty set.
    stage('input:clearance-holes', holes.flatMap(asPolys));
    let clearanceHoles: Polygon[] = booleanAdd(holes.flatMap(asPolys), []);
    if (keepoutHoles.length > 0)
      clearanceHoles = booleanAdd([...clearanceHoles, ...keepoutHoles], []);
    stage('clearance-holes', clearanceHoles);
    // `buildDifferentNetZoneClearances` ends with its own `Simplify()`.
    const zoneKnockouts: Polygon[] =
      zoneClearances.length > 0 ? booleanAdd(zoneClearances, []) : [];

    // Spokes are added back — but only the ones that reach real copper.
    //
    // `zone_filler.cpp:2936-3016`. KiCad builds a throwaway `testAreas` — the
    // pour with EVERY clearance hole already subtracted, then run through the
    // same min-width deflate/inflate the finished fill gets — and keeps a
    // spoke only if its outer end lands inside that. A spoke pointing at a
    // neighbouring pad's clearance hole has its tip in the hole, not on
    // copper, and is dropped.
    //
    // That is the whole reason a KiCad pad beside another pad gets THREE
    // spokes and not four. Adding all four unconditionally, as this did,
    // drives a bridge of copper straight across the neighbour's clearance —
    // which is not a cosmetic difference, it is a short.
    //
    // The second arm is upstream's own fallback: a spoke whose tip is inside
    // ANOTHER spoke is kept too, tested both ways round "to avoid interactions
    // with round-off errors" (kicad#13316). That is how two pads facing each
    // other across a gap too narrow for the pour still connect.
    if (spokes.length > 0) {
      let testAreas = booleanSubtract(fill, clearanceHoles);
      if (zoneKnockouts.length > 0) testAreas = booleanSubtract(testAreas, zoneKnockouts);
      stage('minus-clearance-holes', testAreas);
      testAreas = spokeTestAreas(testAreas, zone, maxError, stage);
      const onCopper = (p: Vec2): boolean => testAreas.some((poly) => pointInPolygon(poly, p));
      const insideSpoke = (spoke: ThermalSpoke, p: Vec2): boolean => pointInRing(p, spoke.ring);

      const kept = spokes.filter(
        (spoke) =>
          onCopper(spoke.tip) ||
          spokes.some(
            (other) =>
              other !== spoke && insideSpoke(other, spoke.tip) && insideSpoke(spoke, other.tip),
          ),
      );
      stage(
        'spokes',
        kept.map((k) => [k.ring]),
      );

      // A kept spoke's tip is by construction ON the copper it bridges to,
      // which makes it the anchor for the pad it belongs to. A dropped one
      // is not — and a pad whose spokes were all dropped connects to
      // nothing, so it anchors nothing.
      for (const k of kept) connected.push(k.tip);

      // `aFillPolys.AddOutline( spoke )`: a kept spoke is one more OUTLINE of
      // the fill's poly set, and no boolean runs until the next line.
      fill = [...fill, ...kept.map((k) => [k.ring])];
    }

    // "the 'real' subtract-clearance-holes has to be done after the spokes
    // are added" (zone_filler.cpp:3020). A spoke runs from the pad centre
    // out past the relief, straight through whatever sits in between; the
    // holes are what stop it short of a neighbour's clearance.
    stage('input:after-spoke-trimming:subject', fill);
    stage('input:after-spoke-trimming:clip', clearanceHoles);
    fill = booleanSubtract(fill, clearanceHoles);
    stage('after-spoke-trimming', fill);

    /* ---------------------------------------------------------------------
     * Prune features that don't meet minimum-width criteria, then fracture,
     * as `fillCopperZone` does — and only THEN look for islands.
     *
     * The order is the whole point. `ZONE_FILLER::Fill` calls
     * `FillIsolatedIslandsMap` after every `fillCopperZone` has returned, so
     * what it sees is the finished, fractured poly set: each outline is one
     * disjoint piece of copper, holes already cut by slits. Asking earlier
     * reads a different board. On ecc83-pp four regions hang off the pour by
     * necks thinner than its 0.381 mm minimum; the deflate/inflate severs them,
     * and 212 mm² of copper KiCad drops as islands survived here because at the
     * time we asked they were still attached.
     */
    const halfMinWidth = Math.trunc((zone.minThickness ?? 0) / 2);
    const epsilon = mmToIU(0.001);
    const prune = halfMinWidth - epsilon > epsilon;

    if (prune) {
      fill = inflateKi(
        fill,
        -(halfMinWidth - epsilon),
        CornerStrategy.CHAMFER_ALL_CORNERS,
        maxError,
      );
      // "Also deflate thermal rings to match, for correct hatch hole notching"
      if (thermalRings.length > 0)
        thermalRings = inflateKi(
          thermalRings,
          -(halfMinWidth - epsilon),
          CornerStrategy.CHAMFER_ALL_CORNERS,
          maxError,
        );
    }

    // "Min-thickness is the web thickness. On the other hand, a blob
    // min-thickness by min-thickness is not useful" — an island whose whole
    // extent, deflated, is under the min thickness is deleted.
    fill = fill.filter((poly) => islandExtentMax(poly) >= (zone.minThickness ?? 0));
    stage('deflated', fill);

    if (hatch) {
      // A hatched zone keeps only its webbing (ZONE_FILLER::addHatchFillTypeOnZone),
      // "note that we do this while deflated". The rings to protect are the
      // thermal rings and the clearance holes, plus a disc for every solidly
      // connected via, so no hatch hole swallows one of them whole.
      let ringsToProtect = booleanAdd(thermalRings, clearanceHoles);
      for (const v of solidVias) {
        const disc: Polygon[] = [
          [
            transformCircleToPolygonSet(
              v.at,
              Math.trunc(v.size / 2),
              maxError,
              ErrorLoc.ERROR_OUTSIDE,
            ).map((pt) => ({ x: pt.x, y: pt.y })),
          ],
        ];
        ringsToProtect = booleanAdd(ringsToProtect, booleanIntersection(disc, smoothed.smoothed));
      }
      fill = addHatchFillTypeOnZone(
        fill,
        zone,
        maxError,
        hatchingOffsetFor(layer, opts.hatchingOffsets, zone.layerProperties),
        ringsToProtect,
        stage,
      );
    } else {
      // "Connect nearby polygons with zero-width lines in order to ensure
      // correct re-inflation" — `aFillPolys.Fracture(); connect_nearby_polys(
      // aFillPolys, aZone->GetMinThickness() )`, in the deflated state.
      fill = connectNearbyPolys(fracture(fill), zone.minThickness ?? 0).map((ring) => [ring]);
      stage('connected-nearby-polys', fill);
    }

    /* ---------------------------------------------------------------------
     * Finish minimum-width pruning by re-inflating
     */
    if (prune)
      fill = inflateKi(
        fill,
        halfMinWidth - epsilon,
        CornerStrategy.ROUND_ALL_CORNERS,
        maxError,
        true,
      );

    // "The deflation/inflation process can leave notches in the outline.
    // Remove these by doing a union with the original ring" —
    // `BooleanAdd( thermalRings )`: the rings as deflated above, and for a
    // solid zone an empty set, but a pass through the clipper all the same.
    fill = booleanAdd(fill, thermalRings);
    stage('after-reinflating', fill);

    /* ---------------------------------------------------------------------
     * Ensure additive changes (thermal stubs and inflating acute corners) do
     * not add copper outside the zone boundary, inside the clearance holes, or
     * between otherwise isolated islands
     */

    // "for( BOARD_ITEM* item : thermalConnectionPads ) addHoleKnockout( pad, 0,
    // clearanceHoles )": the drills join the SIMPLIFIED set as extra outlines.
    clearanceHoles = [...clearanceHoles, ...thermalHoles.flatMap(asPolys)];

    fill = booleanIntersection(fill, smoothed.maxExtents);
    stage('after-trim-to-outline', fill);
    fill = booleanSubtract(fill, clearanceHoles);
    stage('after-trim-to-clearance-holes', fill);

    // "Cache the pre-knockout fill for iterative refill optimization (issue
    // 21746)": what the refill starts over from, BEFORE the zone-to-zone
    // knockouts.
    const preKnockout = fill;
    if (zoneKnockouts.length > 0) {
      stage('input:zone-knockouts', zoneKnockouts);
      fill = booleanSubtract(fill, zoneKnockouts);
      stage('minus-zone-knockouts', fill);
      // "Re-prune minimum-width violations introduced by different-net zone
      // knockouts. This must run BEFORE subtracting same-net higher-priority
      // zones."
      fill = postKnockoutMinWidthPrune(fill, zone, maxError, stage);
    }
    stage('after-post-knockout-min-width', fill);

    // "Lastly give any same-net but higher-priority zones control over their
    // own area" — `ZONE_FILLER::subtractHigherPriorityZones`, the last thing
    // `fillCopperZone` does before it fractures.
    //
    // This is NOT the different-net knockout above. That one keeps a clearance
    // gap and uses the other zone's filled copper; this one takes the other
    // zone's raw OUTLINE, with no gap at all, because the two pours are the
    // same net and may touch — what is being decided is only which zone's fill
    // parameters (thermal relief, minimum thickness, hatching) govern the
    // overlap. Without it a lower-priority pour fills its whole outline and the
    // overlap ends up poured twice, under the wrong rules: on One-Air-Max the
    // +3V3 zone of priority 9 ran 146 mm² past where KiCad stops it, which is
    // the entire span it shares with the priority-24 zone beside it.
    fill = subtractHigherPriorityZones(fill, board, zoneIndex, layer, near);
    stage('minus-higher-priority-zones', fill);

    fills.push({ layer, polys: fracture(fill), connected, preKnockout });
  }

  return fills;
}

/**
 * One zone's finished copper.
 *
 * `ZONE_FILLER::Fill` over this one zone: it is poured against the fills the
 * other zones are carrying, and its own islands are judged on that board.
 * `fillZones` is the one that pours everything in upstream's order.
 */
export function fillZone(
  board: Board,
  zoneIndex: number,
  opts: ZoneFillOptions = {},
): PcbZoneFill[] {
  const zone = board.zones[zoneIndex];
  if (!zone) return [];
  if (board.k) new ZONE_FILLER(board.k).PrepareBoardForFill();
  const parts = fillZoneParts(board, zoneIndex, opts);
  const fills = parts.map((part) => ({ layer: part.layer, polys: part.polys }));
  const zones = [...board.zones];
  zones[zoneIndex] = { ...zone, fills };
  const working = { ...board, zones };
  const islands = isolatedIslands(working, fillOutlinesOf(working, [zoneIndex]));
  const zoneIslands = islands.get(zoneIndex) ?? new Map<string, number[]>();
  // "skip island removal on layers where every outline is an island
  // (unconnected pour — must be preserved as-is)": a zone every layer of
  // which is wholly isolated is left alone.
  const allLayersFullyIsolated = fills.every(
    (f) => (zoneIslands.get(f.layer) ?? []).length === f.polys.length,
  );
  if (allLayersFullyIsolated) return fills.filter((f) => f.polys.length > 0);
  return removeIslandsOf(zone, fills, zoneIslands, false).filter((f) => f.polys.length > 0);
}

/** Every fill outline of the given zones, as the connectivity items they are. */
function fillOutlinesOf(board: Board, zoneIndices: Iterable<number>): FillOutline[] {
  const out: FillOutline[] = [];
  for (const zi of zoneIndices) {
    const z = board.zones[zi]!;
    for (const f of z.fills)
      f.polys.forEach((ring, index) => {
        out.push({ zone: zi, layer: f.layer, index, ring });
      });
  }
  return out;
}

/**
 * The `ISLAND_REMOVAL_MODE` switch of `ZONE_FILLER::Fill`
 * (zone_filler.cpp:990-1041), given which outlines are isolated.
 *
 * `initiallyFullyIsolated` is the loop's preservation of "legitimately
 * unconnected pours": when set, a layer on which EVERY outline is still an
 * island is left alone. On the first pass it is the ZONE that is skipped
 * when every layer is fully isolated — that decision is the caller's.
 */
function removeIslandsOf(
  zone: PcbZone,
  fills: PcbZoneFill[],
  isolated: ReadonlyMap<string, number[]>,
  preserveFullyIsolatedLayers: boolean,
): PcbZoneFill[] {
  const mode = zone.islandRemovalMode ?? 'always';
  // `island_area_min` is stored in mm², so the comparison happens there too.
  const iuPerMM = mmToIU(1);
  const minArea = (zone.islandAreaMin ?? 10) * iuPerMM * iuPerMM;
  return fills.map((f) => {
    const islands = isolated.get(f.layer) ?? [];
    if (islands.length === 0) return f;
    if (preserveFullyIsolatedLayers && islands.length === f.polys.length) return f;
    const drop = new Set<number>();
    for (const idx of islands) {
      if (mode === 'always') drop.add(idx);
      else if (mode === 'area' && Math.abs(ringArea(f.polys[idx]!)) < minArea) drop.add(idx);
    }
    return { layer: f.layer, polys: f.polys.filter((_, i) => !drop.has(i)) };
  });
}

/**
 * `SHAPE_POLY_SET::Inflate` on a zone's stored (fractured) fill, as
 * `refillZoneFromCache` grows a different-net knockout: `inflatedFill.Inflate(
 * gap + extra_margin + m_maxError, ROUND_ALL_CORNERS, m_maxError )` — the
 * fractured rings straight in, no unfracture.
 */
function inflateFractured(rings: Vec2[][], amount: number, maxError: number): Polygon[] {
  return inflateKi(
    rings.map((r) => [r]),
    amount,
    CornerStrategy.ROUND_ALL_CORNERS,
    maxError,
  );
}

const zoneBox = (z: PcbZone): Box => boxOf(z.outline ?? []);

/**
 * Fill every zone on the board — `ZONE_FILLER::Fill` (zone_filler.cpp:414),
 * the "Fill All Zones" action, in its order:
 *
 *  1. every fill is cleared, and the (zone, layer) pairs are poured in
 *     dependency WAVES: a pair waits for every higher-priority different-net
 *     zone on that layer whose outline collides with its own within the
 *     worst clearance, because that zone's FILL is what knocks it out;
 *  2. `FillIsolatedIslandsMap` once over the finished board, and the island
 *     removal mode applied — a zone every layer of which is wholly isolated
 *     is left alone;
 *  3. the iterative refill (`m_ZoneFillIterativeRefill`, on by default):
 *     every zone-layer that lost islands, plus every lower zone overlapping
 *     a higher SAME-net zone, seeds a wave of `refillZoneFromCache` — the
 *     pre-knockout fill minus the higher zones' fills as they stood before
 *     the wave — with island detection again and a hash comparison, until
 *     nothing changes or eight passes have run;
 *  4. outlines of at least 3 × min-thickness² that lie more than half
 *     outside the board outline are dropped.
 */
export function fillZones(board: Board, opts: ZoneFillOptions = {}): Board {
  // `ZONE_FILLER::Fill` begins on the BOARD, not on the geometry: the caches
  // every later step reads, and the per-layer flashing decisions. Those are
  // ported (`ZONE_FILLER` above) and run here so a refill settles them the
  // way upstream does; the pour below is still the view's.
  if (board.k) new ZONE_FILLER(board.k).PrepareBoardForFill();

  const maxError = opts.maxError ?? DEFAULT_MAX_ERROR;
  const clearanceOf = opts.clearanceOf ?? ((z: PcbZone) => z.clearance ?? mmToIU(0.5));

  // The zones `Fill` is handed: everything but rule areas and degenerate
  // outlines. Teardrops keep the fill their generator produced (see
  // `fillZoneParts`' comment on them).
  const pourable = (z: PcbZone): boolean =>
    !z.ruleArea && !z.teardropType && !!z.outline && z.outline.length > 2;

  // `m_worstClearance = m_board->GetMaxClearanceValue()`, the same number
  // `fillZoneParts` derives for its knockout box.
  let worstClearance = Math.max(
    opts.minClearance ?? 0,
    opts.holeClearance ?? 0,
    opts.holeToHoleMin ?? 0,
    opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE,
    opts.worstNetClassClearance ?? 0,
    BARCODE_VISUAL_SEPARATION_DEFAULT,
  );
  for (const z of board.zones)
    for (const net of board.nets.keys())
      worstClearance = Math.max(worstClearance, clearanceOf(z, net));
  for (const fp of board.footprints)
    for (const pad of fp.pads) {
      const override = pad.localClearance ?? fp.localClearance;
      if (override !== undefined) worstClearance = Math.max(worstClearance, override);
    }
  for (const z of board.zones)
    if (!z.ruleArea && z.clearance !== undefined)
      worstClearance = Math.max(worstClearance, z.clearance);

  // "Remove existing fill first"
  let working: Board = {
    ...board,
    zones: board.zones.map((z) => (pourable(z) ? { ...z, fills: [] } : z)),
  };
  const setFill = (zi: number, layer: string, polys: Vec2[][]): void => {
    const zones = [...working.zones];
    const z = zones[zi]!;
    const fills = z.fills.filter((f) => f.layer !== layer);
    fills.push({ layer, polys });
    zones[zi] = { ...z, fills };
    working = { ...working, zones };
  };

  interface Item {
    zone: number;
    layer: string;
  }
  const toFill: Item[] = [];
  working.zones.forEach((z, zi) => {
    if (!pourable(z)) return;
    // "for( PCB_LAYER_ID layer : zone->GetLayerSet() ) toFill.emplace_back( zone, layer )":
    // a zone on a technical layer is poured too (`fillNonCopperZone`).
    for (const layer of z.layers) toFill.push({ zone: zi, layer });
  });

  // `zone_fill_dependency( aZone, aLayer, aOtherZone, true )`
  const dependsOn = (waiter: Item, dep: Item): boolean => {
    if (waiter.zone === dep.zone || waiter.layer !== dep.layer) return false;
    const z = working.zones[waiter.zone]!;
    const o = working.zones[dep.zone]!;
    if (o.ruleArea || !o.outline || o.outline.length <= 2) return false;
    if (!o.layers.includes(waiter.layer)) return false;
    if (higherPriority(z, o)) return false;
    if (o.net === z.net) return false;
    if (!boxesIntersect(boxInflate(zoneBox(z), worstClearance), zoneBox(o))) return false;
    // `aZone->Outline()->Collide( aOtherZone->Outline(), m_worstClearance )`
    return (
      shapeDist({ kind: 'poly', pts: z.outline!, r: 0 }, { kind: 'poly', pts: o.outline!, r: 0 }) <
      worstClearance
    );
  };

  const preKnockout = new Map<string, Polygon[]>();
  const keyOf = (it: Item): string => `${it.zone}:${it.layer}`;

  // `run_fill_waves` hands every item of a wave to the thread pool at once
  // (`tp.submit_task`, all at priority 0) and waits. The pool is
  // `BS::priority_thread_pool`, whose queue is `std::priority_queue<pr_task>`
  // — a binary heap — and libstdc++'s heap does NOT pop equal keys first-in
  // first-out: `push_heap` on an equal key appends; `pop_heap` swaps the last
  // element to the top and sifts the hole down the SECOND-child chain (the
  // first-child branch is taken only when `comp` is true, and it never is).
  // So a wave of n tasks runs as 0, 2, 6, 14, 30, ... then backwards from the
  // end — and, since a zone's different-net knockouts are the fills of the
  // higher zones that have ALREADY run (`ZONE::TransformShapeToPolygon` reads
  // `m_FilledPolysList`), that order decides which same-wave zones see each
  // other, hence which get `postKnockoutMinWidthPrune`. This is the order when
  // every task is in the queue before the worker's first pop, which is what a
  // single-threaded KiCad does almost every time (measured on the ESP32-S3
  // DevKit-LiPo board: 135/135 rings on 4 of 5 `MaximumThreads=1` runs); with
  // more threads KiCad's answer varies run to run and this is one of them.
  const heapPopOrder = (ids: number[]): number[] => {
    const heap: number[] = [...ids]; // push_heap of equal keys: append
    const out: number[] = [];
    while (heap.length > 0) {
      out.push(heap[0]!);
      const value = heap.pop()!;
      const len = heap.length;
      if (len === 0) break;
      // `std::__adjust_heap( first, 0, len, value )`
      let hole = 0;
      let second = 0;
      while (second < Math.trunc((len - 1) / 2)) {
        second = 2 * (second + 1);
        heap[hole] = heap[second]!;
        hole = second;
      }
      if ((len & 1) === 0 && second === Math.trunc((len - 2) / 2)) {
        second = 2 * (second + 1);
        heap[hole] = heap[second - 1]!;
        hole = second - 1;
      }
      heap[hole] = value; // `__push_heap` moves nothing for an equal key
    }
    return out;
  };

  // Kahn's algorithm over the dependency DAG: the initial wave holds every
  // item without a dependency, in item order, and every next wave the items
  // freed by the last, in the order they were freed — each run in pop order.
  const runWaves = (items: Item[], fillFn: (it: Item) => void, anyDeps: boolean): void => {
    const successors: number[][] = items.map(() => []);
    const inDegree: number[] = items.map(() => 0);
    if (anyDeps)
      for (let i = 0; i < items.length; i++)
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          if (dependsOn(items[j]!, items[i]!)) {
            successors[i]!.push(j);
            inDegree[j]!++;
          }
        }
    let wave: number[] = [];
    items.forEach((_, i) => {
      if (inDegree[i] === 0) wave.push(i);
    });
    while (wave.length) {
      for (const idx of heapPopOrder(wave)) fillFn(items[idx]!);
      const next: number[] = [];
      for (const idx of wave)
        for (const succ of successors[idx]!) if (--inDegree[succ]! === 0) next.push(succ);
      wave = next;
    }
  };

  runWaves(
    toFill,
    (it) => {
      const parts = fillZoneParts(working, it.zone, opts, new Set([it.layer]));
      const part = parts.find((p) => p.layer === it.layer);
      if (!part) return;
      preKnockout.set(keyOf(it), part.preKnockout);
      setFill(it.zone, it.layer, part.polys);
    },
    true,
  );

  // "Now update the connectivity to check for isolated copper islands"
  const pouredZones = [...new Set(toFill.map((it) => it.zone))];
  // `CN_CONNECTIVITY_ALGO::FillIsolatedIslandsMap` does `Remove( zone );
  // Add( zone )` only for the zones IN THE MAP, and the map is filled before
  // that call's island removal. So the connectivity graph holds, for every
  // zone, its fill as it stood the last time the zone was asked about —
  // islands and all — not its current fill. `connZones` is that graph.
  let connZones = working.zones;
  const islandsMap = isolatedIslands(
    { ...working, zones: connZones },
    fillOutlinesOf({ ...working, zones: connZones }, pouredZones),
  );

  const removedIslandLayers = new Set<string>();
  const initiallyFullyIsolated = new Set<string>();
  for (const zi of pouredZones) {
    const z = working.zones[zi]!;
    const zoneIslands = islandsMap.get(zi) ?? new Map<string, number[]>();
    let allLayersFullyIsolated = true;
    for (const f of z.fills) {
      const isolated = zoneIslands.get(f.layer) ?? [];
      if (isolated.length === f.polys.length) initiallyFullyIsolated.add(`${zi}:${f.layer}`);
      else allLayersFullyIsolated = false;
    }
    if (allLayersFullyIsolated) continue;
    const after = removeIslandsOf(z, z.fills, zoneIslands, false);
    after.forEach((f, k) => {
      if (f.polys.length !== z.fills[k]!.polys.length) removedIslandLayers.add(`${zi}:${f.layer}`);
    });
    const zones = [...working.zones];
    zones[zi] = { ...z, fills: after };
    working = { ...working, zones };
  }

  // "Iterative refill: when islands are removed, overlapping zones may be able
  // to reclaim the freed space."
  const sameNetOverlapSeeds = new Set<string>();
  for (const zi of pouredZones) {
    const lower = working.zones[zi]!;
    working.zones.forEach((higher, hi) => {
      if (hi === zi || higher.ruleArea || higher.teardropType) return;
      if (higher.net !== lower.net) return;
      if ((higher.priority ?? 0) <= (lower.priority ?? 0)) return;
      if (!boxesIntersect(zoneBox(lower), zoneBox(higher))) return;
      for (const layer of lower.layers) {
        if (!isCopper(layer) || !higher.layers.includes(layer)) continue;
        const lf = lower.fills.find((f) => f.layer === layer);
        const hf = higher.fills.find((f) => f.layer === layer);
        if (lf && lf.polys.length > 0 && hf && hf.polys.length > 0)
          sameNetOverlapSeeds.add(`${zi}:${layer}`);
      }
    });
  }

  let changed = new Set<string>([...removedIslandLayers, ...sameNetOverlapSeeds]);
  const maxIterations = 8;
  for (let iteration = 0; iteration < maxIterations && changed.size > 0; ++iteration) {
    const zonesToRefill: Item[] = [];
    const seen = new Set<string>();
    for (const key of changed) {
      const [czStr, changedLayer] = key.split(':') as [string, string];
      const czi = Number(czStr);
      const changedZone = working.zones[czi]!;
      const bbox = boxInflate(zoneBox(changedZone), worstClearance);
      for (const zi of pouredZones) {
        const z = working.zones[zi]!;
        if (!z.layers.includes(changedLayer)) continue;
        if (zi !== czi && !higherPriority(changedZone, z) && changedZone.net !== z.net) continue;
        if (!boxesIntersect(zoneBox(z), bbox)) continue;
        const k = `${zi}:${changedLayer}`;
        if (!seen.has(k)) {
          seen.add(k);
          zonesToRefill.push({ zone: zi, layer: changedLayer });
        }
      }
    }
    if (zonesToRefill.length === 0) break;

    const before = new Map<string, string>();
    for (const it of zonesToRefill)
      before.set(
        keyOf(it),
        fillHash(working.zones[it.zone]!.fills.find((f) => f.layer === it.layer)?.polys ?? []),
      );

    // "Snapshot fills before the wave": every refill reads the higher zones'
    // fills as they stood here.
    const snapshot = working;

    // `refillZoneFromCache`
    const refill = (it: Item): void => {
      const cached = preKnockout.get(keyOf(it));
      if (!cached) return;
      const zone = snapshot.zones[it.zone]!;
      const box = boxInflate(zoneBox(zone), worstClearance + EXTRA_CLEARANCE);
      const diffNet: Polygon[] = [];
      const sameNet: Polygon[] = [];
      snapshot.zones.forEach((other, oi) => {
        if (oi === it.zone || !other.layers.includes(it.layer)) return;
        if (other.teardropType && other.net === zone.net) return;
        if (!higherPriority(other, zone)) return;
        if (!boxesIntersect(zoneBox(other), box)) return;
        const fill = other.fills.find((f) => f.layer === it.layer);
        if (!fill || fill.polys.length === 0) return;
        if (other.net === zone.net) {
          for (const ring of fill.polys) sameNet.push([ring]);
        } else {
          const gap = Math.max(clearanceOf(zone, other.net), other.clearance ?? 0);
          if (gap < 0) return;
          diffNet.push(...inflateFractured(fill.polys, gap + EXTRA_CLEARANCE + maxError, maxError));
        }
      });
      let polys = cached;
      if (diffNet.length > 0) {
        polys = booleanSubtract(polys, diffNet);
        polys = postKnockoutMinWidthPrune(polys, zone, maxError);
      }
      if (sameNet.length > 0) polys = booleanSubtract(polys, sameNet);
      setFill(it.zone, it.layer, fracture(polys));
    };
    runWaves(zonesToRefill, refill, false);

    // "Island detection on the refilled zones only." — the refilled zones are
    // re-added to the connectivity as they stand now; every other zone is in
    // it as it was last added.
    const refilledZones = [...new Set(zonesToRefill.map((it) => it.zone))];
    connZones = [...connZones];
    for (const zi of refilledZones) connZones[zi] = working.zones[zi]!;
    const connBoard = { ...working, zones: connZones };
    const refillIslands = isolatedIslands(connBoard, fillOutlinesOf(connBoard, refilledZones));
    for (const zi of refilledZones) {
      const z = working.zones[zi]!;
      const zoneIslands = refillIslands.get(zi) ?? new Map<string, number[]>();
      const layersHere = new Set(
        zonesToRefill.filter((it) => it.zone === zi).map((it) => it.layer),
      );
      const after = z.fills.map((f) => {
        if (!layersHere.has(f.layer)) return f;
        return removeIslandsOf(
          z,
          [f],
          zoneIslands,
          initiallyFullyIsolated.has(`${zi}:${f.layer}`),
        )[0]!;
      });
      const zones = [...working.zones];
      zones[zi] = { ...z, fills: after };
      working = { ...working, zones };
    }

    // "Convergence check"
    const next = new Set<string>();
    for (const it of zonesToRefill) {
      const now = fillHash(
        working.zones[it.zone]!.fills.find((f) => f.layer === it.layer)?.polys ?? [],
      );
      if (now !== before.get(keyOf(it))) next.add(keyOf(it));
    }
    changed = next;
  }

  // "Now remove islands which are either outside the board edge or fail to
  // meet the minimum area requirements": an outline of at least 3 ×
  // min-thickness² whose intersection with the board outline is under half
  // its area goes.
  // `GetBoardPolygonOutlines( m_boardOutline, aInferOutlineIfNecessary = true )`:
  // when the edges do not close, `m_brdOutlinesValid` is false (so the pour
  // was not clipped to them) but `m_boardOutline` still holds the inferred
  // rectangle — the Edge.Cuts bounding box, or the board's — and it is THAT
  // this pass measures against.
  const brd = getBoardPolygonOutlines(working);
  let boardOutline: Polygon[] = brd.polygons.map((poly) => [poly.outline, ...poly.holes]);
  if (!brd.success || boardOutline.length === 0) {
    const edgePts: Vec2[] = [];
    for (const sh of [...working.shapes, ...working.footprints.flatMap((f) => f.shapes ?? [])])
      if (sh.layer === 'Edge.Cuts')
        for (const pt of [sh.start, sh.end, sh.center, sh.mid, ...(sh.pts ?? [])])
          if (pt) edgePts.push(pt);
    let bb = edgePts.length ? boxOf(edgePts) : { x0: 0, y0: 0, x1: 0, y1: 0 };
    if (bb.x1 - bb.x0 === 0 || bb.y1 - bb.y0 === 0) {
      const all: Vec2[] = [];
      for (const z of working.zones) all.push(...(z.outline ?? []));
      for (const t of working.tracks) all.push(t.start, t.end);
      for (const v of working.vias) all.push(v.at);
      for (const fp of working.footprints) for (const pad of fp.pads) all.push(pad.at);
      if (all.length) bb = boxOf(all);
    }
    if (bb.x1 - bb.x0 === 0 || bb.y1 - bb.y0 === 0) bb = boxInflate(bb, mmToIU(1.0));
    boardOutline = [
      [
        [
          { x: bb.x0, y: bb.y0 },
          { x: bb.x0, y: bb.y1 },
          { x: bb.x1, y: bb.y1 },
          { x: bb.x1, y: bb.y0 },
        ],
      ],
    ];
  }
  for (const zi of pouredZones) {
    const z = working.zones[zi]!;
    const minArea = (z.minThickness ?? 0) * (z.minThickness ?? 0) * 3;
    const fills = z.fills.map((f) => ({
      layer: f.layer,
      // "zoneCopperLayers = zone->GetLayerSet() & LSET::AllCuMask( … )": a
      // technical-layer fill is not measured against the board outline.
      polys: !isCopper(f.layer)
        ? f.polys
        : f.polys.filter((ring) => {
            const islandArea = Math.abs(ringArea(ring));
            if (islandArea < minArea) return true;
            const intersection = booleanIntersection(boardOutline, [[ring]]);
            return polysArea(intersection) >= islandArea / 2.0;
          }),
    }));
    // A layer with no copper writes no `(filled_polygon …)`, so it has no
    // entry, as a board read back would not; and `zone->SetIsFilled( true )`
    // is unconditional — a zone saved `(fill no …)` is poured all the same.
    const nonEmpty = fills.filter((f) => f.polys.length > 0);
    const zones = [...working.zones];
    zones[zi] = { ...z, filled: true, fills: nonEmpty };
    working = { ...working, zones };
  }
  return working;
}

/** `ZONE::BuildHashValue`'s purpose: does the fill differ? A structural key. */
function fillHash(polys: Vec2[][]): string {
  let h = 0;
  let n = 0;
  for (const r of polys)
    for (const p of r) {
      h = (h * 31 + p.x) % 2147483647;
      h = (h * 31 + p.y) % 2147483647;
      n++;
    }
  return `${polys.length}:${n}:${h}`;
}

/** `SHAPE_POLY_SET::Area` — outlines less holes. */
function polysArea(polys: Polygon[]): number {
  let a = 0;
  for (const poly of polys)
    poly.forEach((ring, i) => {
      a += (i === 0 ? 1 : -1) * Math.abs(ringArea(ring));
    });
  return a;
}

/**
 * `ZONE_FILLER::addHatchFillTypeOnZone` (zone_filler.cpp:3826-4053): cut a
 * grid of holes out of the DEFLATED fill so only its webbing is left.
 *
 * The grid pitch is the web thickness plus the gap; each hole is a square of
 * `gap + minThickness`, optionally chamfered (level 1) or filleted (level 2+)
 * by half the gap scaled by the smoothing value. The holes are clipped to the
 * fill deflated by what the web thickness exceeds the minimum by, and to the
 * zone outline deflated by the minimum thickness, and any hole left smaller
 * than `hatchHoleMinArea` of a full one is dropped.
 *
 * `maxError` is a LOCAL upstream reassigns while smoothing the hole, and the
 * reassigned value is what the two deflates below then use.
 *
 * The per-layer `hatching_offset` shifts the whole grid — the Board Setup >
 * Zone Hatch Offsets page's value for this layer, or the zone's own override.
 *
 * Not ported: the thermal-ring protection of a hatched zone's thermal pads
 * (`aThermalRings`, from `buildHatchZoneThermalRings`).
 */
function addHatchFillTypeOnZone(
  fill: Polygon[],
  zone: PcbZone,
  boardMaxError: number,
  offset: { x: number; y: number } = { x: 0, y: 0 },
  thermalRings: Polygon[] = [],
  stage?: (name: string, polys: Polygon[]) => void,
): Polygon[] {
  // obviously line thickness must be > zone min thickness.
  const thickness = Math.max(zone.hatchThickness ?? 0, (zone.minThickness ?? 0) + mmToIU(0.001));
  const gridsize = thickness + (zone.hatchGap ?? 0);
  let maxError = boardMaxError;
  if (gridsize <= 0) return fill;

  const orientation = new EDA_ANGLE(zone.hatchOrientation ?? 0);
  const minus = new EDA_ANGLE(-orientation.AsDegrees());

  // Use a area that contains the rotated bbox by orientation
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const poly of fill)
    for (const ring of poly)
      for (const pt of ring) {
        const r = orientation.IsZero() ? pt : RotatePoint(pt, minus);
        if (r.x < x0) x0 = r.x;
        if (r.y < y0) y0 = r.y;
        if (r.x > x1) x1 = r.x;
        if (r.y > y1) y1 = r.y;
      }
  if (!Number.isFinite(x0)) return fill;

  // Build hole shape
  const hole_size = (zone.hatchGap ?? 0) + (zone.minThickness ?? 0);
  let hole_base: Vec2[] = [
    { x: 0, y: 0 },
    { x: hole_size, y: 0 },
    { x: hole_size, y: hole_size },
    { x: 0, y: hole_size },
  ];

  // Calculate minimal area of a grid hole.
  const minimal_hole_area = Math.abs(chainArea(hole_base)) * (zone.hatchHoleMinArea ?? 0.3);

  // Now convert this hole to a smoothed shape:
  if ((zone.hatchSmoothingLevel ?? 0) > 0) {
    let smooth_value = KiROUND(((zone.hatchGap ?? 0) * (zone.hatchSmoothingValue ?? 0)) / 2);
    const SMOOTH_MIN_VAL_MM = 0.02;
    const SMOOTH_SMALL_VAL_MM = 0.04;

    if (smooth_value > mmToIU(SMOOTH_MIN_VAL_MM)) {
      let smooth_level = zone.hatchSmoothingLevel ?? 0;
      if (smooth_value < mmToIU(SMOOTH_SMALL_VAL_MM) && smooth_level > 1) smooth_level = 1;

      // Use a larger smooth_value to compensate the outline tickness
      smooth_value += Math.trunc((zone.minThickness ?? 0) / 2);
      // smooth_value cannot be bigger than the half size oh the hole:
      smooth_value = Math.min(smooth_value, Math.trunc((zone.hatchGap ?? 0) / 2));
      // the error to approximate a circle by segments when smoothing corners by a arc
      maxError = Math.max(maxError * 2, Math.trunc(smooth_value / 20));

      switch (smooth_level) {
        case 1:
          hole_base = chamfer([[hole_base]], smooth_value)[0]![0]!;
          break;
        case 0:
          break;
        default:
          if ((zone.hatchSmoothingLevel ?? 0) > 2) maxError = Math.trunc(maxError / 2); // Force better smoothing
          hole_base = fillet([[hole_base]], smooth_value, maxError)[0]![0]!;
          break;
      }
    }
  }

  // Build holes
  const holes: Polygon[] = [];
  const x_offset = x0 - (x0 % gridsize) - gridsize;
  const y_offset = y0 - (y0 % gridsize) - gridsize;
  const shift = { x: offset.x % gridsize, y: offset.y % gridsize };

  for (let xx = x_offset; xx <= x1; xx += gridsize) {
    for (let yy = y_offset; yy <= y1; yy += gridsize) {
      const hole = hole_base.map((p) => {
        let q: Vec2 = { x: p.x + xx, y: p.y + yy };
        if (!orientation.IsZero()) q = RotatePoint(q, orientation);
        return { x: q.x + shift.x, y: q.y + shift.y };
      });
      holes.push([hole]);
    }
  }

  // Don't let thickness drop below maxError * 2 or it might not get reinflated.
  const deflated_thickness = Math.max(
    (zone.hatchThickness ?? 0) - (zone.minThickness ?? 0),
    maxError * 2,
  );

  // The fill has already been deflated to ensure GetMinThickness() so we just
  // have to account for anything beyond that.
  const deflatedFilledPolys = inflateKi(
    fill,
    -deflated_thickness,
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  stage?.('hatch-holes', holes);
  let clipped = booleanIntersection(holes, deflatedFilledPolys);
  stage?.('fill-clipped-hatch-holes', clipped);

  const deflatedOutline = inflateKi(
    [[zone.outline!.map((p) => ({ x: p.x, y: p.y }))]],
    -(zone.minThickness ?? 0),
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  clipped = booleanIntersection(clipped, deflatedOutline);
  stage?.('outline-clipped-hatch-holes', clipped);

  // Now filter truncated holes to avoid small holes in pattern
  clipped = clipped.filter((poly) => Math.abs(chainArea(poly[0]!)) >= minimal_hole_area);

  // "Drop any holes that completely enclose a thermal ring to ensure thermal
  // reliefs stay connected to the hatch webbing": the ring's box inside the
  // hole's, the ring's box centre and its first vertex inside the hole, and
  // the two outlines never crossing.
  if (thermalRings.length > 0) {
    const rings = thermalRings.map((poly) => poly[0]!);
    const thermalBox = boxOf(rings.flat());
    for (let holeIdx = clipped.length - 1; holeIdx >= 0; holeIdx--) {
      const hole = clipped[holeIdx]![0]!;
      const holeBox = boxOf(hole);
      if (!boxesIntersect(holeBox, thermalBox)) continue;
      for (const ring of rings) {
        const ringBox = boxOf(ring);
        // `BOX2I::Contains( aRect )`: the box's corners inside, inclusively
        if (
          ringBox.x0 < holeBox.x0 ||
          ringBox.y0 < holeBox.y0 ||
          ringBox.x1 > holeBox.x1 ||
          ringBox.y1 > holeBox.y1
        )
          continue;
        // `BOX2I::Centre()`: the origin plus half the size, integer halves
        const ringCenter = {
          x: ringBox.x0 + Math.trunc((ringBox.x1 - ringBox.x0) / 2),
          y: ringBox.y0 + Math.trunc((ringBox.y1 - ringBox.y0) / 2),
        };
        if (!chainPointInside(hole, ringCenter)) continue;
        if (ring.length === 0 || !chainPointInside(hole, ring[0]!)) continue;
        if (chainsIntersect(ring, hole)) continue;
        clipped.splice(holeIdx, 1);
        break;
      }
    }
  }

  // create grid. Useto generate strictly simple polygons needed by Gerber
  // files and Fracture()
  const out = booleanSubtract(fill, clipped);
  stage?.('after-hatching', out);
  return out;
}

/**
 * `SHAPE_LINE_CHAIN::Intersect( aChain, aIp )` asked only whether it found
 * anything: a segment of one crossing a segment of the other, or — the
 * default `aExcludeColinearAndTouching = false` — collinear and sharing an
 * end point.
 */
function chainsIntersect(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const sa = { a: a[i]!, b: a[(i + 1) % a.length]! };
    for (let j = 0; j < b.length; j++) {
      const sb = { a: b[j]!, b: b[(j + 1) % b.length]! };
      if (segIntersect(sa, sb)) return true;
      if (segCollinear(sa, sb) && (segContains(sa, sb.a) || segContains(sa, sb.b))) return true;
    }
  }
  return false;
}

/** `SHAPE_LINE_CHAIN::Area( true )`. */
function chainArea(ring: Vec2[]): number {
  let area = 0.0;
  const size = ring.length;
  for (let i = 0, j = size - 1; i < size; ++i) {
    area += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
    j = i;
  }
  return Math.abs(area * 0.5);
}

/** Twice the signed area of a ring, halved: the enclosed area. */
function ringArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
  return a / 2;
}

/**
 * `ZONE::BuildSmoothedPoly( aSmoothedPoly, aLayer, aBoardOutline,
 * aSmoothedPolyWithApron )` (zone.cpp:1470-1627), both of its answers:
 *
 * - `maxExtents` is `aSmoothedPoly`: the outline, unioned with every
 *   colliding same-net zone (so a corner shared with one is not smoothed
 *   into a divot), clipped to the board, smoothed, and clipped back to the
 *   flattened outline.
 * - `smoothed` is `aSmoothedPolyWithApron`, which is what `fillCopperZone`
 *   STARTS from: the smoothed poly clipped to the outline inflated by the
 *   minimum thickness within the same-net envelope — "we pre-inflate the
 *   contour by the min-thickness within the same-net-intersecting-zones
 *   envelope" so the deflate/inflate cycle cannot dig divots at a same-net
 *   border either. The final `BooleanIntersection( aMaxExtents )` takes the
 *   apron off again.
 *
 * `m_ZoneKeepExternalFillets` is false on every board this reads
 * (board_design_settings.cpp:215; the setting has no UI), so that branch is
 * not taken.
 */
function buildSmoothedPoly(
  board: Board,
  zoneIndex: number,
  layer: string,
  boardOutline: Geom | null,
  maxError: number,
): { smoothed: Polygon[]; maxExtents: Polygon[] } {
  const zone = board.zones[zoneIndex]!;
  // `m_Poly` with its holes: `TransformSmoothedOutlineToPolygon` starts from
  // the whole SHAPE_POLY_SET, so a cutout is a hole in the smoothed outline
  // before any knockout runs.
  const flattened: Polygon[] = [
    [
      zone.outline!.map((p) => ({ x: p.x, y: p.y })),
      ...(zone.holes ?? []).map((h) => h.map((p) => ({ x: p.x, y: p.y }))),
    ],
  ];
  if (zone.ruleArea) return { smoothed: flattened, maxExtents: flattened };

  const mode = zone.cornerSmoothing ?? 'none';
  const radius = zone.cornerRadius ?? 0;
  const smoothRequested =
    (mode === 'chamfer' || mode === 'fillet') && zone.teardropType === undefined;

  const smooth = (polys: Polygon[]): Polygon[] => {
    if (!smoothRequested) return polys;
    return mode === 'chamfer' ? chamfer(polys, radius) : fillet(polys, radius, maxError);
  };

  // `GetInteractingZones`: same-net zones whose outline collides, and the
  // different-net ones whose bounding box touches.
  const epsilon = mmToIU(0.001);
  const bbox = boxInflate(boxOf(zone.outline!), epsilon);
  const sameNet: PcbZone[] = [];
  const diffNet: PcbZone[] = [];
  board.zones.forEach((other, i) => {
    if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
    if (!other.layers.includes(layer)) return;
    if (other.ruleArea || other.teardropType !== undefined) return;
    if (!boxesIntersect(boxOf(other.outline), bbox)) return;
    if (other.net === zone.net) {
      // `m_Poly->Collide( candidate->m_Poly )` — touching along an edge counts,
      // which a plain intersection reads as nothing, so the outline is grown
      // by the same epsilon before it is asked.
      const grown = inflate([[zone.outline!]], epsilon, CornerStrategy.ROUND_ALL_CORNERS);
      if (grown.length > 0 && booleanIntersection(grown, [[other.outline]]).length > 0)
        sameNet.push(other);
    } else {
      diffNet.push(other);
    }
  });

  let smoothedPoly: Polygon[] = flattened;

  for (const neighbour of sameNet) {
    // "The same-net intersecting zone *might* get knocked out along the
    // border by a higher-priority, different-net zone" — and if those enclose
    // THIS zone completely, the neighbour is not really adjoining it.
    const nBox = boxOf(neighbour.outline!);
    let diffNetPoly: Polygon[] = [];
    for (const d of diffNet)
      if (higherPriority(d, neighbour) && boxesIntersect(boxOf(d.outline!), nBox))
        diffNetPoly = booleanAdd(diffNetPoly, [[d.outline!]]);
    let isolated = false;
    if (diffNetPoly.length > 0) isolated = booleanSubtract(flattened, diffNetPoly).length === 0;
    if (!isolated) smoothedPoly = booleanAdd(smoothedPoly, [[neighbour.outline!]]);
  }

  if (boardOutline) smoothedPoly = booleanIntersection(smoothedPoly, asPolys(boardOutline));

  const withSameNetIntersectingZones = smoothedPoly;

  smoothedPoly = smooth(smoothedPoly);

  // The apron.
  let poly = inflateKi(
    flattened,
    zone.minThickness ?? 0,
    CornerStrategy.ROUND_ALL_CORNERS,
    maxError,
  );
  poly = booleanIntersection(poly, withSameNetIntersectingZones);
  const smoothed = booleanIntersection(smoothedPoly, poly);

  const maxExtents = booleanIntersection(smoothedPoly, flattened);

  return { smoothed, maxExtents };
}

/**
 * The throwaway `testAreas` a spoke's tip is hit-tested against
 * (zone_filler.cpp:2936-2965): the fill minus every clearance hole, deflated
 * and re-inflated by half the minimum width — with `fastCornerStrategy`,
 * CHAMFER_ALL_CORNERS, on BOTH legs, and neither the tiny-island cull nor the
 * clip back to the starting copper that the real prune gets.
 *
 * The corner strategy is the whole difference. At a reflex corner of the
 * copper — where a track's clearance band meets a pad's relief arc — a
 * round re-inflate leaves a fillet that a chamfered one does not, and a
 * spoke aimed into that corner has its tip inside one and outside the other.
 * On complex_hierarchy a GND pad's 45° spoke lands 0.02 mm from such a
 * corner: upstream keeps it, and the real prune's rounded test dropped it,
 * 0.6 mm² of copper and one fewer connection to the pad.
 */
function spokeTestAreas(
  fill: Polygon[],
  zone: PcbZone,
  maxError: number,
  stage: (name: string, polys: Polygon[]) => void = () => {},
): Polygon[] {
  const halfMinWidth = Math.trunc((zone.minThickness ?? 0) / 2);
  const epsilon = mmToIU(0.001);
  if (halfMinWidth - epsilon <= epsilon) return fill;

  let testAreas = inflateKi(
    fill,
    -(halfMinWidth - epsilon),
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  stage('spoke-test-deflated', testAreas);
  testAreas = inflateKi(
    testAreas,
    halfMinWidth - epsilon,
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  stage('spoke-test-reinflated', testAreas);
  return testAreas;
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

/** `SHAPE_LINE_CHAIN_BASE::PointInside( p, 1 )`, as `SHAPE_POLY_SET::Contains` asks it. */
const pointInRing = (p: Vec2, ring: Vec2[]): boolean => chainPointInside(ring, p);

/**
 * `ZONE_FILLER::fillNonCopperZone( aZone, aLayer, aSmoothedOutline, aFillPolys )`
 * (zone_filler.cpp:3186-3283): a zone on a technical layer — silkscreen,
 * mask, paste — is the smoothed outline (with its apron; there is no
 * `maxExtents` trim here) minus the KNOCKOUT text on the layer (`IsKnockout()`
 * items only: a knockout text's own strokes, `TransformTextToPolySet( 0,
 * ERROR_INSIDE )`), minus the rule areas that forbid zone fills (their
 * outlines as drawn, `appendZoneOutlineWithoutArcs`), then the min-thickness
 * cycle — deflate with chamfered corners, the hatch pattern if any, inflate
 * with round corners — and `Fracture()`. No clearances, no thermal reliefs,
 * no islands: nothing on these layers is connected to anything.
 */
function fillNonCopperZone(
  board: Board,
  zoneIndex: number,
  layer: string,
  smoothedOutline: Polygon[],
  opts: ZoneFillOptions,
): Vec2[][] {
  const zone = board.zones[zoneIndex]!;
  const maxError = opts.maxError ?? DEFAULT_MAX_ERROR;
  const zoneBox = boxOf(zone.outline ?? []);
  const stage = (name: string, polys: Polygon[]): void => {
    if (opts.onStage) opts.onStage(name, layer, polys);
  };

  // `knockoutGraphicItem`: "aItem->IsKnockout() && aItem->IsOnLayer( aLayer )
  // && aItem->GetBoundingBox().Intersects( zone_boundingbox )" →
  // `addKnockout( aItem, aLayer, 0, true, clearanceHoles )`. Only text carries
  // the knockout flag, and a knockout text's hole is its strokes.
  const clearanceHoles: Polygon[] = [];
  const knockoutText = (t: PcbTextItem): void => {
    if (!t.knockout || t.layer !== layer || t.hide) return;
    const polys = textTransformTextToPolySet(t, 0, maxError, ErrorLoc.ERROR_INSIDE);
    if (polys.length === 0) return;
    if (!boxesIntersect(boxOf(polys.flatMap((poly) => poly[0]!)), zoneBox)) return;
    clearanceHoles.push(...polys);
  };
  for (const fp of board.footprints) {
    // `knockoutGraphicItem( &footprint->Reference() ); …Value(); then GraphicalItems()`
    const ref = fp.texts.find((t) => t.kind === 'reference');
    const val = fp.texts.find((t) => t.kind === 'value');
    if (ref) knockoutText(ref);
    if (val) knockoutText(val);
    for (const t of fp.texts) if (t.kind === 'user') knockoutText(t);
  }
  for (const t of board.texts) knockoutText(t);

  let fill = booleanSubtract(smoothedOutline, clearanceHoles);
  stage('minus-knockouts', fill);

  // `collectKeepout`: `isZoneFillKeepout( candidate, aLayer, zone_boundingbox )`
  // → `appendZoneOutlineWithoutArcs( candidate, keepoutHoles )`.
  const keepoutHoles: Polygon[] = [];
  board.zones.forEach((other, i) => {
    if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
    if (!other.ruleArea?.copperPour || zone.teardropType) return;
    if (!other.layers.includes(layer)) return;
    if (!boxesIntersect(boxOf(other.outline), zoneBox)) return;
    keepoutHoles.push([other.outline.map((p) => ({ x: p.x, y: p.y }))]);
  });
  if (keepoutHoles.length > 0) fill = booleanSubtract(fill, keepoutHoles);

  // "Features which are min_width should survive pruning; features that are
  // *less* than min_width should not."
  const half_min_width = Math.trunc((zone.minThickness ?? 0) / 2);
  const epsilon = mmToIU(0.001);
  fill = inflateKi(fill, -(half_min_width - epsilon), CornerStrategy.CHAMFER_ALL_CORNERS, maxError);
  stage('deflated', fill);

  if (zone.fillMode === 'hatch')
    fill = addHatchFillTypeOnZone(
      fill,
      zone,
      maxError,
      hatchingOffsetFor(layer, opts.hatchingOffsets, zone.layerProperties),
    );

  if (half_min_width - epsilon > epsilon)
    fill = inflateKi(fill, half_min_width - epsilon, CornerStrategy.ROUND_ALL_CORNERS, maxError);
  stage('after-reinflating', fill);

  return fracture(fill);
}

/**
 * `ZONE_FILLER::postKnockoutMinWidthPrune` (zone_filler.cpp:2757-2796): the
 * min-width cycle run again after a different-net zone knockout — deflate
 * (CHAMFER), fracture, connect nearby polys, cull the blobs, re-inflate
 * (ROUND, the second union), and clip back to what it started from.
 */
function postKnockoutMinWidthPrune(
  fill: Polygon[],
  zone: PcbZone,
  maxError: number,
  stage?: (name: string, polys: Polygon[]) => void,
): Polygon[] {
  const half_min_width = Math.trunc((zone.minThickness ?? 0) / 2);
  const epsilon = mmToIU(0.001);
  if (half_min_width - epsilon <= epsilon) return fill;

  const preDeflate = fill;
  let polys = inflateKi(
    fill,
    -(half_min_width - epsilon),
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  stage?.('prune:deflated', polys);
  polys = fracture(polys).map((ring) => [ring]);
  stage?.('prune:fractured', polys);
  polys = connectNearbyPolys(
    polys.map((poly) => poly[0]!),
    zone.minThickness ?? 0,
  ).map((ring) => [ring]);
  stage?.('prune:connected', polys);
  polys = polys.filter((poly) => islandExtentMax(poly) >= (zone.minThickness ?? 0));
  polys = inflateKi(
    polys,
    half_min_width - epsilon,
    CornerStrategy.ROUND_ALL_CORNERS,
    maxError,
    true,
  );
  stage?.('prune:inflated', polys);
  return booleanIntersection(polys, preDeflate);
}

// ---------------------------------------------------------------------------
// `BOARD::GetBoardPolygonOutlines` over the plain-object view.
//
// The BOARD-side method is `board.ts`'s; this is the view twin, and it lives
// here because the view-side filler is its only caller left. It goes when
// `fillZones` moves onto the live BOARD (#636 stage 4) and the class path
// becomes the only one.
/** `BOARD_DESIGN_SETTINGS::m_MaxError`, ARC_HIGH_DEF — arc tessellation error. */
const BOARD_MAX_ERROR = mmToIU(0.005);

/** `DEFAULT_CHAINING_EPSILON_MM`, how far two Edge.Cuts ends may miss and still join. */
const BOARD_CHAINING_EPSILON = mmToIU(0.01);
// The board outline.

/** One top-level outline of the board polygon set, with its cutouts. */
export interface BoardOutlinePolygon {
  outline: Vec2[];
  holes: Vec2[][];
}

export interface BoardPolygonOutlines {
  /**
   * `GetBoardPolygonOutlines`' return value. False whenever a contour did not
   * close, and false when there is nothing on Edge.Cuts at all — in both cases
   * `polygons` is empty, because upstream bails before populating the set.
   */
  success: boolean;
  polygons: BoardOutlinePolygon[];
}

/**
 * `BOARD::GetBoardPolygonOutlines( polySet, false )` — `BuildBoardPolygonOutlines`
 * in `pcbnew/convert_shape_list_to_polygon.ts`, with the board's
 * `m_MaxError` (the design-settings value the caller has; ARC_HIGH_DEF when
 * none is given) and the default chaining epsilon.
 *
 * `success` starts false and only `doConvertOutlineToPolygon` sets it, so a
 * board with nothing on Edge.Cuts answers false and no polygons.
 */
export function getBoardPolygonOutlines(
  board: Board,
  maxError: number = BOARD_MAX_ERROR,
): BoardPolygonOutlines {
  // `isCopperOutside`: a pad whose effective polygon has no intersection
  // with the footprint's own closed outline.
  const copperOutside = (fp: PcbFootprint) => (outline: Polygon[]) => {
    for (const pad of fp.pads) {
      const padPoly = padTransformShapeToPolygon(pad, 0, maxError, ErrorLoc.ERROR_INSIDE);
      if (padPoly.length === 0) continue;
      if (booleanIntersection(outline, padPoly).length === 0) return true;
    }
    return false;
  };
  const r = buildBoardPolygonOutlines(
    board.shapes,
    board.footprints.map((fp) => ({ shapes: fp.shapes ?? [], copperOutside: copperOutside(fp) })),
    maxError,
    BOARD_CHAINING_EPSILON,
  );
  return {
    success: r.success,
    polygons: r.polygons.map((rings) => ({ outline: rings[0]!, holes: rings.slice(1) })),
  };
}

/**
 * `SHAPE_LINE_CHAIN::Area( true )`, upstream's formula verbatim including the
 * absolute value that hides the winding direction — which is why a cutout drawn
 * the same way round as its outline still subtracts.
 */
export function contourArea(pts: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    area += (pts[j]!.x + pts[i]!.x) * (pts[j]!.y - pts[i]!.y);

  return Math.abs(area * 0.5);
}
