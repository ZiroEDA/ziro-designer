// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_statistics_report.cpp`: the counts behind the Board Statistics
 * dialog, which `DIALOG_BOARD_STATISTICS` only formats.
 *
 * KiCad keeps this apart from `board_statistics.cpp`, which holds nothing but
 * `CollectDrillLineItems`; we had both in one file. The rules that decide
 * *what counts* are documented beside the code they govern.
 */
import {
  type DrillLineItem,
  SIDE_SPECIFIC_TECH_LAYERS,
  collectDrillLineItems,
  contourArea,
  getBoardPolygonOutlines,
  padHasHole,
} from './board_statistics.js';
import { padIsOnLayer } from './pad_enumerate.js';
import { enabledCopperLayers, isCopperLayerName } from './swap_layers.js';
import type { Board, PcbFootprint, PcbPad } from './types.js';

export interface BoardStatisticsOptions {
  /** `m_checkBoxExcludeComponentsNoPins`. */
  excludeFootprintsWithoutPads: boolean;
  /** `m_checkBoxSubtractHoles`. */
  subtractHolesFromBoardArea: boolean;
  /**
   * `m_checkBoxSubtractHolesFromCopper`. Carried so callers can round-trip the
   * dialog state; the copper areas it governs are not computed here.
   */
  subtractHolesFromCopperAreas: boolean;
}

/** `DIALOG_BOARD_STATISTICS_SAVED_STATE`: all three checkboxes start clear. */
export const DEFAULT_BOARD_STATISTICS_OPTIONS: BoardStatisticsOptions = {
  excludeFootprintsWithoutPads: false,
  subtractHolesFromBoardArea: false,
  subtractHolesFromCopperAreas: false,
};

/** `BOARD_STATISTICS_FP_ENTRY`: a footprint attribute test and its two columns. */
export interface FootprintStatisticsEntry {
  /** Attribute bits looked at, and the value they must equal. */
  attributeMask: number;
  attributeValue: number;
  title: string;
  frontCount: number;
  backCount: number;
}

/** `BOARD_STATISTICS_INFO_ENTRY<T>`: one labelled count. */
export interface StatisticsCountEntry<T extends string> {
  attribute: T;
  title: string;
  quantity: number;
}

/** `PAD_ATTRIB`, as the file spells it. */
export type PadAttribute = 'thru_hole' | 'smd' | 'connect' | 'np_thru_hole';

/** The two `PAD_PROP` members the dialog counts, as the file spells them. */
export type CountedPadProperty = 'pad_prop_castellated' | 'pad_prop_pressfit';

/** `VIATYPE`, as `PcbVia.kind` spells it, plus the buried member. */
export type ViaTypeName = 'through' | 'blind' | 'buried' | 'micro';

export interface BoardStatisticsData {
  hasOutline: boolean;
  boardWidth: number;
  boardHeight: number;
  boardArea: number;
  /** `std::numeric_limits<int>::max()` when no track set one. */
  minTrackWidth: number;
  /** Likewise; only round holes are candidates. */
  minDrillSize: number;
  footprintEntries: FootprintStatisticsEntry[];
  padEntries: StatisticsCountEntry<PadAttribute>[];
  padPropertyEntries: StatisticsCountEntry<CountedPadProperty>[];
  viaEntries: StatisticsCountEntry<ViaTypeName>[];
  drillEntries: DrillLineItem[];
}

/** `std::numeric_limits<int>::max()`, the sentinel the min fields start at. */
export const STATISTICS_INT_MAX = 2147483647;

/**
 * `InitializeBoardStatisticsData` followed by `ResetCounts`.
 *
 * The order of every list is the order of the dialog's rows and of the saved
 * report, so it is part of the output rather than an implementation detail.
 * "Unspecified" is last and matches on `(attributes & (THT|SMD)) == 0`, so a
 * footprint that somehow claims both THT and SMD is counted as THT — the first
 * entry whose test passes wins and the loop breaks.
 */
export function initialiseBoardStatisticsData(): BoardStatisticsData {
  const FP_THROUGH_HOLE = 0x0001;
  const FP_SMD = 0x0002;

  return {
    hasOutline: false,
    boardWidth: 0,
    boardHeight: 0,
    boardArea: 0,
    minTrackWidth: STATISTICS_INT_MAX,
    minDrillSize: STATISTICS_INT_MAX,
    footprintEntries: [
      {
        attributeMask: FP_THROUGH_HOLE,
        attributeValue: FP_THROUGH_HOLE,
        title: 'THT:',
        frontCount: 0,
        backCount: 0,
      },
      { attributeMask: FP_SMD, attributeValue: FP_SMD, title: 'SMD:', frontCount: 0, backCount: 0 },
      {
        attributeMask: FP_THROUGH_HOLE | FP_SMD,
        attributeValue: 0,
        title: 'Unspecified:',
        frontCount: 0,
        backCount: 0,
      },
    ],
    padEntries: [
      { attribute: 'thru_hole', title: 'Through hole:', quantity: 0 },
      { attribute: 'smd', title: 'SMD:', quantity: 0 },
      { attribute: 'connect', title: 'Connector:', quantity: 0 },
      { attribute: 'np_thru_hole', title: 'NPTH:', quantity: 0 },
    ],
    padPropertyEntries: [
      { attribute: 'pad_prop_castellated', title: 'Castellated:', quantity: 0 },
      { attribute: 'pad_prop_pressfit', title: 'Press-fit:', quantity: 0 },
    ],
    viaEntries: [
      { attribute: 'through', title: 'Through vias:', quantity: 0 },
      { attribute: 'blind', title: 'Blind vias:', quantity: 0 },
      { attribute: 'buried', title: 'Buried vias:', quantity: 0 },
      { attribute: 'micro', title: 'Micro vias:', quantity: 0 },
    ],
    drillEntries: [],
  };
}

/** `FOOTPRINT::GetAttributes()`, the bits the footprint entries test. */
function footprintAttributeBits(fp: PcbFootprint): number {
  const attrs = fp.attributes ?? [];
  return (attrs.includes('through_hole') ? 0x0001 : 0) | (attrs.includes('smd') ? 0x0002 : 0);
}

/**
 * `FOOTPRINT::GetSide()`: the footprint's layer if any pad or graphic is on a
 * side-specific layer, otherwise undefined for `UNDEFINED_LAYER`.
 *
 * Footprint zones are the one source upstream consults that the board model
 * does not carry; a footprint whose *only* side-specific item is a zone would
 * be counted by KiCad and not here.
 */
function footprintSide(fp: PcbFootprint, copperLayers: readonly string[]): string | undefined {
  const sideSpecific = (layer: string): boolean =>
    isCopperLayerName(layer) || (SIDE_SPECIFIC_TECH_LAYERS as readonly string[]).includes(layer);

  for (const pad of fp.pads) {
    if (copperLayers.some((layer) => padIsOnLayer(pad, layer))) return fp.layer;
    if (SIDE_SPECIFIC_TECH_LAYERS.some((layer) => padIsOnLayer(pad, layer))) return fp.layer;
  }

  for (const s of fp.shapes) if (sideSpecific(s.layer)) return fp.layer;

  // Reference and Value are PCB_FIELDs and are not in the m_drawings deque
  // GetSide walks; only user text is.
  for (const t of fp.texts) if (t.kind === 'user' && sideSpecific(t.layer)) return fp.layer;

  return undefined;
}

/**
 * The area of a pad's hole, from `PAD::GetEffectiveHoleShape()`:
 * a stadium of `seg.Length() * width` plus one full circle of diameter `width`.
 *
 * The halving is C++ integer division on `VECTOR2I`, so an odd drill size loses
 * its last nanometre before the area is taken. The segment is also rotated to
 * the pad's orientation upstream, which rounds its endpoints to integers and so
 * can move its length by under a nanometre; that is below the resolution of any
 * number this feeds and is not reproduced.
 */
function padHoleArea(pad: PcbPad): number {
  const halfX = Math.trunc(pad.drill!.w / 2);
  const halfY = Math.trunc(pad.drill!.h / 2);

  const halfWidth = pad.drill!.oblong ? Math.min(halfX, halfY) : halfX;
  const halfLen = pad.drill!.oblong
    ? Math.hypot(halfX - halfWidth, halfY - halfWidth)
    : /* a round hole is a zero-length segment */ 0;

  const width = halfWidth * 2;
  return 2 * halfLen * width + Math.PI * 0.25 * width * width;
}

/**
 * `ComputeBoardStatistics`.
 *
 * Returns fresh data rather than resetting a caller's struct. That is a
 * deliberate difference: `ResetCounts` clears every field *except* the two
 * footprint densities, which are only ever assigned when there is an outline,
 * so a second run on a board whose outline has since been broken keeps showing
 * the previous board's densities. Densities are not computed here at all, so
 * there is no stale value to carry — see the module note on what is left out.
 */
export function computeBoardStatistics(
  board: Board,
  options: BoardStatisticsOptions = DEFAULT_BOARD_STATISTICS_OPTIONS,
): BoardStatisticsData {
  const data = initialiseBoardStatisticsData();
  const copperLayers = enabledCopperLayers(board);

  for (const fp of board.footprints) {
    if (options.excludeFootprintsWithoutPads && fp.pads.length === 0) continue;

    const attributes = footprintAttributeBits(fp);

    for (const entry of data.footprintEntries) {
      if ((attributes & entry.attributeMask) === entry.attributeValue) {
        const side = footprintSide(fp, copperLayers);
        if (side === 'F.Cu') entry.frontCount++;
        else if (side === 'B.Cu') entry.backCount++;

        break;
      }
    }

    // `updatePadCounts` runs per footprint, inside the exclusion test — which
    // costs nothing, since the only footprints excluded have no pads.
    for (const pad of fp.pads) {
      for (const padEntry of data.padEntries) {
        if (pad.type === padEntry.attribute) {
          padEntry.quantity++;
          break;
        }
      }

      for (const propEntry of data.padPropertyEntries) {
        if (pad.padProperty === propEntry.attribute) {
          propEntry.quantity++;
          break;
        }
      }
    }
  }

  // Only PCB_TRACE_T narrows the minimum: a curved track is not a candidate,
  // however thin it is. Upstream tests the type before the `IsType` filter that
  // admits arcs and vias, and that ordering is the whole behaviour.
  for (const track of board.tracks) data.minTrackWidth = Math.min(data.minTrackWidth, track.width);

  for (const via of board.vias) {
    for (const entry of data.viaEntries) {
      if (via.kind === entry.attribute) {
        entry.quantity++;
        break;
      }
    }
  }

  data.drillEntries = collectDrillLineItems(board);

  // `DRILL_LINE_ITEM::COMPARE( COL_COUNT, false )` — descending by quantity.
  data.drillEntries.sort((a, b) => b.qty - a.qty);

  for (const drill of data.drillEntries) {
    if (drill.shape === 'circle') data.minDrillSize = Math.min(data.minDrillSize, drill.xSize);
  }

  const outlines = getBoardPolygonOutlines(board);
  data.hasOutline = outlines.success;

  if (data.hasOutline) {
    for (const polygon of outlines.polygons) {
      data.boardArea += contourArea(polygon.outline);

      if (options.subtractHolesFromBoardArea) {
        for (const hole of polygon.holes) data.boardArea -= contourArea(hole);

        // Upstream nests these two loops inside the per-outline loop, so a
        // board with N outlines subtracts every drilled hole N times. Kept.
        for (const fp of board.footprints) {
          for (const pad of fp.pads) {
            if (!padHasHole(pad)) continue;
            data.boardArea -= padHoleArea(pad);
          }
        }

        // Note this one has no `drill > 0` guard: a via is subtracted whatever
        // its drill says.
        for (const via of board.vias) data.boardArea -= Math.PI * 0.25 * via.drill * via.drill;
      }
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const polygon of outlines.polygons) {
      for (const p of polygon.outline) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }

    if (Number.isFinite(minX)) {
      data.boardWidth = maxX - minX;
      data.boardHeight = maxY - minY;
    }
  }

  return data;
}
