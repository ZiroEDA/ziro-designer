// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/length_delay_calculation/length_delay_calculation.h` / `.cpp`:
 * lengths (and associated routing statistics) in a BOARD context.
 *
 * The `PNS_TUNE` wxLogTrace lines are left out.
 */
import { FLASHING, type PCB_LAYER_ID, PCB_LAYER_ID as LAYER } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { CIRCLE } from '@ziroeda/kimath/src/geometry/circle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  equal,
  SquaredEuclideanNorm,
  sub,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import { BOARD_STACKUP } from '../board_stackup_manager/board_stackup.js';
import { PAD } from '../pad.js';
import { PAD_ATTRIB } from '../padstack.js';
import { type PCB_ARC, PCB_TRACK, type PCB_VIA } from '../pcb_track.js';
import {
  LENGTH_DELAY_CALCULATION_ITEM,
  LENGTH_DELAY_CALCULATION_ITEM_TYPE,
  MERGE_STATUS,
} from './length_delay_calculation_item.js';
import {
  TUNING_PROFILE_GEOMETRY_CONTEXT,
  type TUNING_PROFILE_PARAMETERS_IFACE,
} from './tuning_profile_parameters_iface.js';
import { TUNING_PROFILE_PARAMETERS_USER_DEFINED } from './tuning_profile_parameters_user_defined.js';

/**
 * Holds length measurement result details and statistics
 */
export class LENGTH_DELAY_STATS {
  // Generic statistics
  NumPads = 0;
  NumVias = 0;

  // Space domain statistics
  ViaLength = 0;
  TrackLength = 0;
  PadToDieLength = 0;
  LayerLengths: Map<PCB_LAYER_ID, number> | null = null;

  /// Calculates the total electrical length for this set of statistics
  TotalLength(): number {
    return this.ViaLength + this.TrackLength + this.PadToDieLength;
  }

  // Time domain statistics
  ViaDelay = 0;
  TrackDelay = 0;
  PadToDieDelay = 0;
  LayerDelays: Map<PCB_LAYER_ID, number> | null = null;

  /// Calculates the total electrical propagation delay for this set of statistics
  TotalDelay(): number {
    return this.ViaDelay + this.TrackDelay + this.PadToDieDelay;
  }
}

/**
 * Struct to control which optimisations the length calculation code runs on
 * the given path objects. This is required as some call sites (e.g. PNS) run
 * their own path optimisation, whereas others (e.g. Net Inspector) do not.
 */
export interface PATH_OPTIMISATIONS {
  /// Optimise vias for electrical length calculations, including effective
  /// via span and trace clipping inside via pads
  OptimiseVias: boolean;

  /// Merges all contiguous (end-to-end, same layer) tracks
  MergeTracks: boolean;

  /// Optimises the electrical length of tracks within pads. Note that the track
  /// must terminate at the trace anchor point to be considered for
  /// optimisation. Will require MergeTracks if used with a non-contiguous item
  /// set.
  OptimiseTracesInPads: boolean;

  /// Determines if there is a via-in-pad present on the board but not in the
  /// item set. This condition can arise from the PNS meander placer.
  /// TODO (JJ): This can be fixed in the router
  InferViaInPad: boolean;
}

/**
 * Enum which controls the level of detail returned by the length / delay calculation methods.
 */
export enum LENGTH_DELAY_LAYER_OPT {
  NO_LAYER_DETAIL,
  WITH_LAYER_DETAIL,
}

/**
 * Enum which controls the calculation domain of the length / delay calculation methods.
 */
export enum LENGTH_DELAY_DOMAIN_OPT {
  NO_DELAY_DETAIL,
  WITH_DELAY_DETAIL,
}

/// Enum to describe whether track merging is attempted from the start or end of a track segment
enum MERGE_POINT {
  START,
  END,
}

/** `std::map<VECTOR2I, std::unordered_set<ITEM*>>`: a position map keyed by the point. */
type POSITION_MAP = Map<string, { pos: VECTOR2I; items: Set<LENGTH_DELAY_CALCULATION_ITEM> }>;

const posKey = (p: VECTOR2I): string => `${p.x},${p.y}`;

const positionMapInsert = (
  aMap: POSITION_MAP,
  aPos: VECTOR2I,
  aItem: LENGTH_DELAY_CALCULATION_ITEM,
): void => {
  const key = posKey(aPos);
  let entry = aMap.get(key);

  if (!entry) {
    entry = { pos: aPos, items: new Set() };
    aMap.set(key, entry);
  }

  entry.items.add(aItem);
};

/**
 * Class which calculates lengths (and associated routing statistics) in a BOARD context
 */
export class LENGTH_DELAY_CALCULATION {
  /// The parent board for all items
  protected m_board: BOARD;

  /// The active provider of tuning profile parameters
  protected m_tuningProfileParameters: TUNING_PROFILE_PARAMETERS_IFACE;

  /**
   * Construct the calculator in the given BOARD context. Also constructs a default user-defined time domain
   * parameters provider
   */
  constructor(aBoard: BOARD) {
    this.m_board = aBoard;
    this.m_tuningProfileParameters = new TUNING_PROFILE_PARAMETERS_USER_DEFINED(aBoard, this);
  }

  /**
   * Finds the intersection point between an arc and a pad shape.
   */
  protected static findArcPadIntersection(
    aArc: SHAPE_ARC,
    aPadShape: SHAPE_POLY_SET,
    aInsidePoint: VECTOR2I,
    aIntersection: { value: VECTOR2I },
  ): boolean {
    let found = false;
    let bestDistSq = Number.MAX_SAFE_INTEGER;

    for (let i = 0; i < aPadShape.OutlineCount(); i++) {
      const outline = aPadShape.Outline(i);

      for (let j = 0; j < outline.SegmentCount(); j++) {
        const seg = outline.CSegment(j);
        const intersections: VECTOR2I[] = [];

        if (!aArc.IntersectLine(seg, intersections)) continue;

        for (const pt of intersections) {
          if (!seg.Contains(pt)) continue;

          const distSq = SquaredEuclideanNorm(sub(pt, aInsidePoint));

          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            aIntersection.value = pt;
            found = true;
          }
        }
      }
    }

    return found;
  }

  /// Clips the given line to the minimal direct electrical length within the pad
  protected static clipLineToPad(
    aLine: SHAPE_LINE_CHAIN,
    aPad: PAD,
    aLayer: PCB_LAYER_ID,
    aForward = true,
  ): SHAPE_LINE_CHAIN {
    console.assert(aLine.PointCount() >= 2);

    const start = aForward ? 0 : aLine.PointCount() - 1;
    const delta = aForward ? 1 : -1;

    const shape = aPad.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_INSIDE);

    // Find the first point OUTSIDE the pad
    let firstOutside = -1;
    const intersectionPt = { value: { x: 0, y: 0 } as VECTOR2I };
    let hasIntersection = false;

    for (
      let vertex = start + delta;
      aForward ? vertex < aLine.PointCount() : vertex >= 0;
      vertex += delta
    ) {
      if (!shape.Contains(aLine.GetPoint(vertex))) {
        firstOutside = vertex;
        const prevVertex = vertex - delta;

        // Check if the crossing segment is part of an arc
        const arcIdx = aLine.ArcIndex(prevVertex);

        if (arcIdx >= 0 && aLine.ArcIndex(vertex) === arcIdx) {
          hasIntersection = LENGTH_DELAY_CALCULATION.findArcPadIntersection(
            aLine.Arc(arcIdx),
            shape,
            aLine.GetPoint(prevVertex),
            intersectionPt,
          );
        }

        // Fallback to segment intersection if arc intersection didn't work
        if (!hasIntersection) {
          const seg = new SEG(aLine.GetPoint(vertex), aLine.GetPoint(prevVertex));
          const loc: VECTOR2I = { x: 0, y: 0 };

          if (shape.Collide(seg, 0, undefined, loc)) {
            intersectionPt.value = loc;
            hasIntersection = true;
          }
        }

        break;
      }
    }

    if (firstOutside < 0) return aLine; // All points inside pad, nothing to clip

    // Build new chain using Slice (preserves arcs correctly without index corruption)
    const newChain = new SHAPE_LINE_CHAIN();

    if (aForward) {
      // Chain: padCenter -> intersection -> [firstOutside to end]
      newChain.Append(aPad.GetPosition());
      if (hasIntersection) newChain.Append(intersectionPt.value);
      newChain.Append(aLine.Slice(firstOutside, -1));
    } else {
      // Chain: [0 to firstOutside] -> intersection -> padCenter
      newChain.Append(aLine.Slice(0, firstOutside));
      if (hasIntersection) newChain.Append(intersectionPt.value);
      newChain.Append(aPad.GetPosition());
    }

    return newChain;
  }

  /**
   * @brief Calculates the electrical length of the given items
   */
  CalculateLengthDetails(
    aItems: LENGTH_DELAY_CALCULATION_ITEM[],
    aOptimisations: PATH_OPTIMISATIONS,
    aStartPad: PAD | null = null,
    aEndPad: PAD | null = null,
    aLayerOpt: LENGTH_DELAY_LAYER_OPT = LENGTH_DELAY_LAYER_OPT.NO_LAYER_DETAIL,
    aDomain: LENGTH_DELAY_DOMAIN_OPT = LENGTH_DELAY_DOMAIN_OPT.NO_DELAY_DETAIL,
  ): LENGTH_DELAY_STATS {
    // If this set of items has not been optimised, optimise for shortest electrical path
    if (aOptimisations.OptimiseVias || aOptimisations.MergeTracks || aOptimisations.MergeTracks) {
      const pads: LENGTH_DELAY_CALCULATION_ITEM[] = [];
      const lines: LENGTH_DELAY_CALCULATION_ITEM[] = [];
      const vias: LENGTH_DELAY_CALCULATION_ITEM[] = [];

      // Map of line endpoints to line objects
      const linesPositionMap: POSITION_MAP = new Map();

      // Map of pad positions to pad objects
      const padsPositionMap: POSITION_MAP = new Map();

      for (const item of aItems) {
        if (item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.PAD) {
          pads.push(item);
          positionMapInsert(padsPositionMap, item.GetPad()!.GetPosition(), item);
        } else if (item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.VIA) {
          vias.push(item);
        } else if (item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.LINE) {
          lines.push(item);
          positionMapInsert(linesPositionMap, item.GetLine().CPoint(0), item);
          positionMapInsert(linesPositionMap, item.GetLine().CLastPoint(), item);
        }
      }

      if (aOptimisations.OptimiseVias)
        this.optimiseVias(vias, lines, linesPositionMap, padsPositionMap);

      if (aOptimisations.MergeTracks) LENGTH_DELAY_CALCULATION.mergeLines(lines, linesPositionMap);

      // Clip traces inside VIA pads after merging
      if (aOptimisations.OptimiseVias) {
        for (const via of vias) {
          const pcbVia = via.GetVia()!;

          for (const lineItem of lines) {
            if (lineItem.GetMergeStatus() !== MERGE_STATUS.MERGED_IN_USE) continue;

            lineItem.SetLine(
              LENGTH_DELAY_CALCULATION.OptimiseTraceInVia(
                lineItem.GetLine(),
                pcbVia,
                lineItem.GetStartLayer(),
              ),
            );
          }
        }
      }

      if (aOptimisations.OptimiseTracesInPads)
        LENGTH_DELAY_CALCULATION.optimiseTracesInPads(pads, lines);
    }

    const details = new LENGTH_DELAY_STATS();

    // Create the layer detail maps if required
    if (aLayerOpt === LENGTH_DELAY_LAYER_OPT.WITH_LAYER_DETAIL) {
      details.LayerLengths = new Map();

      if (aDomain === LENGTH_DELAY_DOMAIN_OPT.WITH_DELAY_DETAIL) details.LayerDelays = new Map();
    }

    const useHeight = this.m_board.GetDesignSettings().m_UseHeightForLengthCalcs;

    // If this is a contiguous set of items, check if we have an inferred fanout via at either end. Note that this
    // condition only arises as a result of how PNS assembles tuning paths - for DRC / net inspector calculations these
    // fanout vias will be present in the object set and therefore do not need to be inferred
    if (aOptimisations.InferViaInPad && useHeight) {
      const withDelayDetail = aDomain === LENGTH_DELAY_DOMAIN_OPT.WITH_DELAY_DETAIL;
      this.inferViaInPad(aStartPad, aItems[0]!, details, withDelayDetail);
      this.inferViaInPad(aEndPad, aItems[aItems.length - 1]!, details, withDelayDetail);
    }

    // Add stats for each item
    for (const item of aItems) {
      // Don't include merged items
      if (
        item.GetMergeStatus() === MERGE_STATUS.MERGED_RETIRED ||
        item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.UNKNOWN
      ) {
        continue;
      }

      // Calculate the space domain statistics
      if (item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.LINE) {
        const length = Math.trunc(item.GetLine().Length());

        details.TrackLength += length;

        if (details.LayerLengths) {
          details.LayerLengths.set(
            item.GetStartLayer(),
            (details.LayerLengths.get(item.GetStartLayer()) ?? 0) + length,
          );
        }
      } else if (item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.VIA && useHeight) {
        const [layerStart, layerEnd] = item.GetLayers();
        const viaHeight = this.StackupHeight(layerStart, layerEnd);
        details.ViaLength += viaHeight;
        details.NumVias += 1;
      } else if (item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.PAD) {
        const padToDie = item.GetPad()!.GetPadToDieLength();
        details.PadToDieLength += padToDie;
        details.NumPads += 1;
      }
    }

    // Calculate the time domain statistics if required
    if (aDomain === LENGTH_DELAY_DOMAIN_OPT.WITH_DELAY_DETAIL && aItems.length > 0) {
      // TODO(JJ): Populate this
      const ctx = new TUNING_PROFILE_GEOMETRY_CONTEXT();
      ctx.NetClass = aItems[0]!.GetEffectiveNetClass(); // We don't care if this is merged for net class lookup

      const itemDelays = this.m_tuningProfileParameters.GetPropagationDelays(aItems, ctx);

      console.assert(itemDelays.length === aItems.length);

      for (let i = 0; i < aItems.length; ++i) {
        const item = aItems[i]!;

        if (
          item.GetMergeStatus() === MERGE_STATUS.MERGED_RETIRED ||
          item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.UNKNOWN
        ) {
          continue;
        }

        if (item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.LINE) {
          details.TrackDelay += itemDelays[i]!;

          if (details.LayerDelays) {
            details.LayerDelays.set(
              item.GetStartLayer(),
              (details.LayerDelays.get(item.GetStartLayer()) ?? 0) + itemDelays[i]!,
            );
          }
        } else if (item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.VIA && useHeight) {
          details.ViaDelay += itemDelays[i]!;
        } else if (item.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.PAD) {
          details.PadToDieDelay += itemDelays[i]!;
        }
      }
    }

    return details;
  }

  /**
   * Infers if there is a via in the given pad. Adds via details to the length details data structure if found.
   */
  protected inferViaInPad(
    aPad: PAD | null,
    aItem: LENGTH_DELAY_CALCULATION_ITEM,
    aDetails: LENGTH_DELAY_STATS,
    aWithDelayDetail: boolean,
  ): void {
    if (aPad && aItem.Type() === LENGTH_DELAY_CALCULATION_ITEM_TYPE.LINE) {
      const startBottomLayer = aItem.GetStartLayer();
      const padLayers = aPad.Padstack().LayerSet();

      if (!padLayers.Contains(startBottomLayer)) {
        // This must be either F_Cu or B_Cu
        const padLayer = padLayers.Contains(LAYER.F_Cu) ? LAYER.F_Cu : LAYER.B_Cu;

        aDetails.NumVias += 1;
        aDetails.ViaLength += this.StackupHeight(startBottomLayer, padLayer);

        // Look up via delay details if required
        if (aWithDelayDetail) {
          const ctx = new TUNING_PROFILE_GEOMETRY_CONTEXT();
          ctx.NetClass = aItem.GetEffectiveNetClass();
          const delay = this.m_tuningProfileParameters.GetViaPropagationDelay(
            startBottomLayer,
            padLayer,
            LAYER.F_Cu,
            LAYER.B_Cu,
            ctx,
          );
          aDetails.ViaDelay += delay;
        }
      }
    }
  }

  /**
   * @brief Calculates the electrical length of the given items
   */
  CalculateLength(
    aItems: LENGTH_DELAY_CALCULATION_ITEM[],
    aOptimisations: PATH_OPTIMISATIONS,
    aStartPad: PAD | null = null,
    aEndPad: PAD | null = null,
  ): number {
    return this.CalculateLengthDetails(aItems, aOptimisations, aStartPad, aEndPad).TotalLength();
  }

  /**
   * @brief Calculates the electrical propagation delay of the given items
   */
  CalculateDelay(
    aItems: LENGTH_DELAY_CALCULATION_ITEM[],
    aOptimisations: PATH_OPTIMISATIONS,
    aStartPad: PAD | null = null,
    aEndPad: PAD | null = null,
  ): number {
    return this.CalculateLengthDetails(
      aItems,
      aOptimisations,
      aStartPad,
      aEndPad,
      LENGTH_DELAY_LAYER_OPT.NO_LAYER_DETAIL,
      LENGTH_DELAY_DOMAIN_OPT.WITH_DELAY_DETAIL,
    ).TotalDelay();
  }

  /**
   * Returns the stackup distance between the two given layers.
   *
   * Note: Can return 0 if the board design settings disallow stackup height calculations
   */
  StackupHeight(aFirstLayer: PCB_LAYER_ID, aSecondLayer: PCB_LAYER_ID): number {
    if (!this.m_board || !this.m_board.GetDesignSettings().m_UseHeightForLengthCalcs) return 0;

    if (this.m_board.GetDesignSettings().m_HasStackup) {
      const stackup = this.m_board.GetDesignSettings().GetStackupDescriptor();
      return stackup.GetLayerDistance(aFirstLayer, aSecondLayer);
    } else {
      const stackup = new BOARD_STACKUP();
      stackup.BuildDefaultStackupList(
        this.m_board.GetDesignSettings(),
        this.m_board.GetCopperLayerCount(),
      );
      return stackup.GetLayerDistance(aFirstLayer, aSecondLayer);
    }
  }

  /**
   * Merges any lines (traces) that are contiguous, on one layer, and with no junctions
   */
  protected static mergeLines(
    aLines: LENGTH_DELAY_CALCULATION_ITEM[],
    aLinesPositionMap: POSITION_MAP,
  ): void {
    const removeFromPositionMap = (line: LENGTH_DELAY_CALCULATION_ITEM): void => {
      aLinesPositionMap.get(posKey(line.GetLine().CPoint(0)))?.items.delete(line);
      aLinesPositionMap.get(posKey(line.GetLine().CLastPoint()))?.items.delete(line);
    };

    // Attempts to merge unmerged lines in to aPrimaryLine
    const tryMerge = (
      aMergePoint: MERGE_POINT,
      aMergePos: VECTOR2I,
      aPrimaryItem: LENGTH_DELAY_CALCULATION_ITEM,
      aDidMerge: { value: boolean },
    ): void => {
      const startItr = aLinesPositionMap.get(posKey(aMergePos));

      if (startItr === undefined) return;

      const startItems = startItr.items;

      if (startItems.size !== 1) return;

      const lineToMerge = startItems.values().next().value as LENGTH_DELAY_CALCULATION_ITEM;

      // Don't merge if lines are on different layers
      if (aPrimaryItem.GetStartLayer() !== lineToMerge.GetStartLayer()) return;

      // Merge the lines
      lineToMerge.SetMergeStatus(MERGE_STATUS.MERGED_RETIRED);
      aPrimaryItem.SetLine(
        LENGTH_DELAY_CALCULATION.mergeShapeLineChains(
          aPrimaryItem.GetLine(),
          lineToMerge.GetLine(),
          aMergePoint,
        ),
      );
      removeFromPositionMap(lineToMerge);
      aDidMerge.value = true;
    };

    // Cluster all lines in to contiguous entities
    for (const primaryItem of aLines) {
      // Don't start with an already merged line
      if (primaryItem.GetMergeStatus() !== MERGE_STATUS.UNMERGED) continue;

      // Remove starting line from the position map
      removeFromPositionMap(primaryItem);

      // Merge all endpoints
      primaryItem.SetMergeStatus(MERGE_STATUS.MERGED_IN_USE);
      let mergeComplete = false;

      while (!mergeComplete) {
        const startMerged = { value: false };
        const endMerged = { value: false };

        const startPos = primaryItem.GetLine().CPoint(0);
        const endPos = primaryItem.GetLine().CLastPoint();

        tryMerge(MERGE_POINT.START, startPos, primaryItem, startMerged);
        tryMerge(MERGE_POINT.END, endPos, primaryItem, endMerged);

        mergeComplete = !startMerged.value && !endMerged.value;
      }
    }
  }

  /**
   * Merges two SHAPE_LINE_CHAINs where there is a shared endpoing.
   *
   * aSecondary is merged in to aPrimary
   */
  protected static mergeShapeLineChains(
    aPrimary: SHAPE_LINE_CHAIN,
    aSecondary: SHAPE_LINE_CHAIN,
    aMergePoint: MERGE_POINT,
  ): SHAPE_LINE_CHAIN {
    // Append carries the arcs across and drops the shared point. Orient the
    // secondary so its joining end meets the primary.
    if (aMergePoint === MERGE_POINT.START) {
      // Secondary joins the primary's start, so build secondary + primary.
      const merged = equal(aSecondary.GetPoint(0), aPrimary.GetPoint(0))
        ? aSecondary.Reverse()
        : new SHAPE_LINE_CHAIN(aSecondary);

      console.assert(equal(merged.CLastPoint(), aPrimary.GetPoint(0)));

      merged.Append(aPrimary);
      return merged;
    } else {
      if (equal(aSecondary.GetPoint(0), aPrimary.CLastPoint())) {
        aPrimary.Append(aSecondary);
      } else {
        console.assert(equal(aSecondary.CLastPoint(), aPrimary.CLastPoint()));
        aPrimary.Append(aSecondary.Reverse());
      }

      return aPrimary;
    }
  }

  /**
   * Optimises the given set of items to minimise the electrical path length. At the moment
   * only optimises lines attached to pads, future work could optimise paths through pads
   *
   * Assumes that any polylines are only connected at either end, and not at midpoints
   */
  protected static optimiseTracesInPads(
    aPads: LENGTH_DELAY_CALCULATION_ITEM[],
    aLines: LENGTH_DELAY_CALCULATION_ITEM[],
  ): void {
    for (const padItem of aPads) {
      const pad = padItem.GetPad()!;

      for (const lineItem of aLines) {
        // Ignore merged lines
        if (lineItem.GetMergeStatus() !== MERGE_STATUS.MERGED_IN_USE) continue;

        const pcbLayer = lineItem.GetStartLayer();

        lineItem.SetLine(
          LENGTH_DELAY_CALCULATION.OptimiseTraceInPad(lineItem.GetLine(), pad, pcbLayer),
        );
      }
    }
  }

  /**
   * Optimises the via layers. Ensures that vias that are routed through only on one layer do not count towards total
   * length calculations.
   */
  protected optimiseVias(
    aVias: LENGTH_DELAY_CALCULATION_ITEM[],
    _aLines: LENGTH_DELAY_CALCULATION_ITEM[],
    aLinesPositionMap: POSITION_MAP,
    _aPadsPositionMap: POSITION_MAP,
  ): void {
    for (const via of aVias) {
      const pcbVia = via.GetVia()!;

      const connectedLines = new Set<LENGTH_DELAY_CALCULATION_ITEM>();

      const viaPos = pcbVia.GetPosition();

      const exactMatch = aLinesPositionMap.get(posKey(viaPos));

      if (exactMatch !== undefined) for (const l of exactMatch.items) connectedLines.add(l);

      let maxRadius = 0;

      pcbVia.Padstack().ForEachUniqueLayer((layer: PCB_LAYER_ID) => {
        maxRadius = Math.max(maxRadius, Math.trunc(pcbVia.GetWidth(layer) / 2));
      });

      const maxRadiusSq = maxRadius * maxRadius;

      for (const { pos, items: lineSet } of aLinesPositionMap.values()) {
        if (equal(pos, viaPos)) continue;

        if (SquaredEuclideanNorm(sub(pos, viaPos)) > maxRadiusSq) continue;

        for (const lineItem of lineSet) {
          const layer = lineItem.GetStartLayer();
          const shape = pcbVia.GetEffectiveShape(layer, FLASHING.ALWAYS_FLASHED);

          if (shape?.Collide(pos, 0)) connectedLines.add(lineItem);
        }
      }

      let coincidentPad: PAD | null = null;

      for (const pad of this.m_board.GetConnectivity().GetConnectedPads(pcbVia)) {
        coincidentPad = pad;
        break;
      }

      const spanLayers = new LSET();

      for (const lineItem of connectedLines) spanLayers.set(lineItem.GetStartLayer());

      if (coincidentPad) {
        let padSideLayer: PCB_LAYER_ID;

        if (
          coincidentPad.GetAttribute() === PAD_ATTRIB.SMD ||
          coincidentPad.GetAttribute() === PAD_ATTRIB.CONN
        ) {
          padSideLayer = coincidentPad.Padstack().LayerSet().CuStack()[0]!;
        } else {
          padSideLayer = coincidentPad.GetParentFootprint()!.GetLayer();
        }

        spanLayers.set(padSideLayer);
      }

      const cuStack = spanLayers.CuStack();

      if (cuStack.length === 0) {
        // Nothing connects to this via
        via.SetLayers(pcbVia.GetLayer(), pcbVia.GetLayer());
      } else if (cuStack.length === 1) {
        // Stub via
        via.SetLayers(cuStack[0]!, cuStack[0]!);
      } else {
        // Signal transitions layers
        via.SetLayers(cuStack[0]!, cuStack[cuStack.length - 1]!);
      }
    }
  }

  /// Optimises the given trace / line to minimise the electrical path length within the given pad
  static OptimiseTraceInPad(
    aLine: SHAPE_LINE_CHAIN,
    aPad: PAD,
    aPcbLayer: PCB_LAYER_ID,
  ): SHAPE_LINE_CHAIN {
    // Only consider lines which terminate in the pad
    if (
      !equal(aLine.CPoint(0), aPad.GetPosition()) &&
      !equal(aLine.CLastPoint(), aPad.GetPosition())
    )
      return aLine;

    if (!aPad.FlashLayer(aPcbLayer)) return aLine;

    const shape = aPad.GetEffectivePolygon(aPcbLayer, ERROR_LOC.ERROR_INSIDE);

    if (shape.Contains(aLine.CPoint(0)))
      return LENGTH_DELAY_CALCULATION.clipLineToPad(aLine, aPad, aPcbLayer, true);
    else if (shape.Contains(aLine.CLastPoint()))
      return LENGTH_DELAY_CALCULATION.clipLineToPad(aLine, aPad, aPcbLayer, false);

    return aLine;
  }

  /// Clips the given line to the minimal direct electrical length within the via
  protected static clipLineToVia(
    aLine: SHAPE_LINE_CHAIN,
    aVia: PCB_VIA,
    aLayer: PCB_LAYER_ID,
    aForward: boolean,
  ): SHAPE_LINE_CHAIN {
    console.assert(aLine.PointCount() >= 2);

    const start = aForward ? 0 : aLine.PointCount() - 1;
    const delta = aForward ? 1 : -1;

    const viaShape = aVia.GetEffectiveShape(aLayer, FLASHING.ALWAYS_FLASHED);

    if (!viaShape) return aLine;

    const viaCircle = viaShape instanceof SHAPE_CIRCLE ? viaShape : null;

    if (!viaCircle) return aLine;

    // Find the first point OUTSIDE the via pad
    let firstOutside = -1;
    let intersectionPt: VECTOR2I = { x: 0, y: 0 };
    let hasIntersection = false;

    for (
      let vertex = start + delta;
      aForward ? vertex < aLine.PointCount() : vertex >= 0;
      vertex += delta
    ) {
      if (!viaShape.Collide(aLine.GetPoint(vertex), 0)) {
        firstOutside = vertex;
        const prevVertex = vertex - delta;

        const seg = new SEG(aLine.GetPoint(vertex), aLine.GetPoint(prevVertex));

        const circle = new CIRCLE(viaCircle.GetCenter(), viaCircle.GetRadius());

        const pts = circle.Intersect(seg);

        if (pts.length > 0) {
          // Pick the intersection closest to the outside vertex
          const outside = aLine.GetPoint(vertex);
          intersectionPt = pts[0]!;

          for (let i = 1; i < pts.length; i++) {
            if (
              SquaredEuclideanNorm(sub(pts[i]!, outside)) <
              SquaredEuclideanNorm(sub(intersectionPt, outside))
            ) {
              intersectionPt = pts[i]!;
            }
          }

          hasIntersection = true;
        }

        break;
      }
    }

    if (firstOutside < 0) return aLine;

    const newChain = new SHAPE_LINE_CHAIN();

    if (aForward) {
      // viaCenter -> intersection -> [firstOutside to end]
      newChain.Append(aVia.GetPosition());

      if (hasIntersection) newChain.Append(intersectionPt);

      newChain.Append(aLine.Slice(firstOutside, -1));
    } else {
      // [0 to firstOutside] -> intersection -> viaCenter
      newChain.Append(aLine.Slice(0, firstOutside));

      if (hasIntersection) newChain.Append(intersectionPt);

      newChain.Append(aVia.GetPosition());
    }

    return newChain;
  }

  /// Clips trace portions inside a VIA pad and replaces them with a straight-line segment
  /// from the VIA edge intersection to the VIA centre, analogous to OptimiseTraceInPad.
  static OptimiseTraceInVia(
    aLine: SHAPE_LINE_CHAIN,
    aVia: PCB_VIA,
    aLayer: PCB_LAYER_ID,
  ): SHAPE_LINE_CHAIN {
    const viaShape = aVia.GetEffectiveShape(aLayer, FLASHING.ALWAYS_FLASHED);

    if (!viaShape) return aLine;

    if (viaShape.Collide(aLine.CPoint(0), 0))
      return LENGTH_DELAY_CALCULATION.clipLineToVia(aLine, aVia, aLayer, true);
    else if (viaShape.Collide(aLine.CLastPoint(), 0))
      return LENGTH_DELAY_CALCULATION.clipLineToVia(aLine, aVia, aLayer, false);

    return aLine;
  }

  /// Returns true if the given point falls inside VIA pad shape on the given layer
  static IsPointInsideViaPad(aVia: PCB_VIA, aPoint: VECTOR2I, aLayer: PCB_LAYER_ID): boolean {
    const shape = aVia.GetEffectiveShape(aLayer, FLASHING.ALWAYS_FLASHED);
    return !!shape && shape.Collide(aPoint, 0);
  }

  /// Return a LENGTH_CALCULATION_ITEM constructed from the given BOARD_CONNECTED_ITEM
  GetLengthCalculationItem(aBoardItem: BOARD_CONNECTED_ITEM): LENGTH_DELAY_CALCULATION_ITEM {
    if (aBoardItem instanceof PCB_TRACK) {
      const track = aBoardItem;

      if (track.Type() === KICAD_T.PCB_VIA_T) {
        const via = track as PCB_VIA;

        const item = new LENGTH_DELAY_CALCULATION_ITEM();
        item.SetVia(via);
        item.CalculateViaLayers(this.m_board);
        item.SetEffectiveNetClass(via.GetEffectiveNetClass());

        return item;
      }

      if (track.Type() === KICAD_T.PCB_ARC_T) {
        const arcParent = track as PCB_ARC;
        const shapeArc = new SHAPE_ARC(
          arcParent.GetStart(),
          arcParent.GetMid(),
          arcParent.GetEnd(),
          arcParent.GetWidth(),
        );
        const chainArc = new SHAPE_LINE_CHAIN(shapeArc);

        const item = new LENGTH_DELAY_CALCULATION_ITEM();
        item.SetLine(chainArc);
        item.SetLayers(track.GetLayer());
        item.SetEffectiveNetClass(arcParent.GetEffectiveNetClass());

        return item;
      }

      if (track.Type() === KICAD_T.PCB_TRACE_T) {
        const points: VECTOR2I[] = [track.GetStart(), track.GetEnd()];
        const shape = new SHAPE_LINE_CHAIN(points);

        const item = new LENGTH_DELAY_CALCULATION_ITEM();
        item.SetLine(shape);
        item.SetLayers(track.GetLayer());
        item.SetEffectiveNetClass(track.GetEffectiveNetClass());

        return item;
      }
    } else if (aBoardItem instanceof PAD) {
      const pad = aBoardItem;
      const item = new LENGTH_DELAY_CALCULATION_ITEM();
      item.SetPad(pad);

      const layers = pad.Padstack().LayerSet();
      let firstLayer: PCB_LAYER_ID = LAYER.UNDEFINED_LAYER;
      let secondLayer: PCB_LAYER_ID = LAYER.UNDEFINED_LAYER;

      for (const layer of layers.CuStack()) {
        if (firstLayer === LAYER.UNDEFINED_LAYER) firstLayer = layer;
        else secondLayer = layer;
      }

      item.SetLayers(firstLayer, secondLayer);
      item.SetEffectiveNetClass(pad.GetEffectiveNetClass());

      return item;
    }

    return new LENGTH_DELAY_CALCULATION_ITEM();
  }

  /// Sets the provider for tuning profile parameter resolution
  SetTuningProfileParametersProvider(aProvider: TUNING_PROFILE_PARAMETERS_IFACE): void {
    this.m_tuningProfileParameters = aProvider;
  }

  /// Ensure time domain properties provider is synced with board / project settings if required
  SynchronizeTuningProfileProperties(): void {
    this.m_tuningProfileParameters.OnSettingsChanged();
  }

  /**
   * @brief Calculates the length of track required for the given delay in a specific geometry context
   */
  CalculateLengthForDelay(aDesiredDelay: number, aCtx: TUNING_PROFILE_GEOMETRY_CONTEXT): number {
    return this.m_tuningProfileParameters.GetTrackLengthForPropagationDelay(aDesiredDelay, aCtx);
  }

  /**
   * Gets the propagation delay for the given shape line chain
   */
  CalculatePropagationDelayForShapeLineChain(
    aShape: SHAPE_LINE_CHAIN,
    aCtx: TUNING_PROFILE_GEOMETRY_CONTEXT,
  ): number {
    return this.m_tuningProfileParameters.CalculatePropagationDelayForShapeLineChain(aShape, aCtx);
  }
}
