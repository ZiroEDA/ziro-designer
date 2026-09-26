// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_statistics_report.cpp`: the counts behind the Board Statistics
 * dialog, which `DIALOG_BOARD_STATISTICS` only formats.
 *
 * KiCad keeps this apart from `board_statistics.cpp`, which holds nothing but
 * `CollectDrillLineItems`.
 *
 * Everything here is a count or a measurement a fabricator may quote from, so
 * the interesting content is in the rules that decide *what counts*.
 *
 * ## A footprint belongs to a side only if something on it is side-specific
 *
 * `FOOTPRINT::GetSide()` does not return the footprint's own layer. It looks
 * for one item on a layer in `LSET::SideSpecificMask()` and returns
 * `UNDEFINED_LAYER` when it finds none. The counting loop switches on that and
 * increments neither column for `UNDEFINED_LAYER`, so a footprint drawn only
 * on `User.Drawings` appears in no column at all and the Total row is short by
 * it.
 *
 * ## The board area is the outline area, cutouts included
 *
 * `boardArea` sums each outline's own area. Holes come off only when
 * `subtractHolesFromBoardArea` is set — and then the pad and via loops are
 * nested *inside* the per-outline loop upstream, so a board with two outlines
 * subtracts every drilled hole twice. That is upstream's arithmetic and it is
 * kept, because the dialog's number has to be the dialog's number.
 *
 * ## No outline, and an outline that will not close, are the same answer
 *
 * `GetBoardPolygonOutlines( polySet, false )` is asked *not* to infer a
 * rectangle, so a board whose `Edge.Cuts` does not close reports
 * `hasOutline: false` and leaves width, height and area at zero rather than
 * quoting a number from a half-built polygon.
 *
 * ## Courtyard area assumes every component is populated
 *
 * Deliberately: it is a layout measurement, not a BOM one. Pad holes are added
 * to *both* sides' shapes, because a through hole consumes space on the far
 * side even where no courtyard is drawn.
 */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import {
  SHAPE_POLY_SET,
  TransformCircleToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from './board.js';
import { type DrillLineItem, CollectDrillLineItems } from './board_statistics.js';
import { FP_SMD, FP_THROUGH_HOLE } from './footprint.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_PROP } from './padstack.js';
import type { PCB_VIA } from './pcb_track.js';
import { VIATYPE } from './pcb_track_types.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { EdaDataType } from '@ziroeda/common/eda_units.js';
import { GENERATOR_APPLICATION, GENERATOR_VERSION } from '@ziroeda/common/generator.js';
import { GetISO8601CurrentDateTime } from '@ziroeda/common/string_utils.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';

export interface BoardStatisticsOptions {
  /** `m_checkBoxExcludeComponentsNoPins`. */
  excludeFootprintsWithoutPads: boolean;
  /** `m_checkBoxSubtractHoles`. */
  subtractHolesFromBoardArea: boolean;
  /** `m_checkBoxSubtractHolesFromCopper`. */
  subtractHolesFromCopperAreas: boolean;
}

export const DEFAULT_BOARD_STATISTICS_OPTIONS: BoardStatisticsOptions = {
  excludeFootprintsWithoutPads: false,
  subtractHolesFromBoardArea: false,
  subtractHolesFromCopperAreas: false,
};

/** `BOARD_STATISTICS_FP_ENTRY`. */
export interface FootprintStatisticsEntry {
  /** Attribute bits looked at, and the value they must equal. */
  attributeMask: number;
  attributeValue: number;
  title: string;
  frontCount: number;
  backCount: number;
}

/** `BOARD_STATISTICS_INFO_ENTRY<T>`. */
export interface StatisticsCountEntry<T> {
  attribute: T;
  title: string;
  quantity: number;
}

/** `BOARD_STATISTICS_DATA`. */
export interface BoardStatisticsData {
  hasOutline: boolean;
  boardWidth: number;
  boardHeight: number;
  boardArea: number;
  frontCopperArea: number;
  backCopperArea: number;
  frontFootprintCourtyardArea: number;
  backFootprintCourtyardArea: number;
  frontFootprintDensity: number;
  backFootprintDensity: number;
  /** `std::numeric_limits<int>::max()` until two tracks on a net pair collide. */
  minClearanceTrackToTrack: number;
  /** Likewise; only a straight track is a candidate, never an arc. */
  minTrackWidth: number;
  /** Likewise; only round holes are candidates. */
  minDrillSize: number;
  boardThickness: number;
  footprintEntries: FootprintStatisticsEntry[];
  padEntries: StatisticsCountEntry<PAD_ATTRIB>[];
  padPropertyEntries: StatisticsCountEntry<PAD_PROP>[];
  viaEntries: StatisticsCountEntry<VIATYPE>[];
  drillEntries: DrillLineItem[];
}

export const STATISTICS_INT_MAX = 2147483647;

/**
 * `BOARD_STATISTICS_DATA::ResetCounts`: the scalars back to their starting
 * values. The per-entry counts are NOT touched — upstream's isn't either.
 */
export function ResetCounts(aData: BoardStatisticsData): void {
  aData.hasOutline = false;
  aData.boardWidth = 0;
  aData.boardHeight = 0;
  aData.boardArea = 0.0;
  aData.frontCopperArea = 0.0;
  aData.backCopperArea = 0.0;
  aData.frontFootprintCourtyardArea = 0.0;
  aData.backFootprintCourtyardArea = 0.0;
  aData.minClearanceTrackToTrack = STATISTICS_INT_MAX;
  aData.minTrackWidth = STATISTICS_INT_MAX;
  aData.minDrillSize = STATISTICS_INT_MAX;
  aData.boardThickness = 0;
}

/**
 * `InitializeBoardStatisticsData`: the entry lists, then `ResetCounts`.
 *
 * The order of every list is the order of the dialog's rows and of the saved
 * report, so it is part of the output rather than an implementation detail.
 * "Unspecified" is last and matches on `(attributes & (THT|SMD)) == 0`, so a
 * footprint that somehow claims both THT and SMD is counted as THT — the first
 * entry whose test passes wins and the loop breaks.
 */
export function InitializeBoardStatisticsData(): BoardStatisticsData {
  return {
    hasOutline: false,
    boardWidth: 0,
    boardHeight: 0,
    boardArea: 0,
    frontCopperArea: 0,
    backCopperArea: 0,
    frontFootprintCourtyardArea: 0,
    backFootprintCourtyardArea: 0,
    frontFootprintDensity: 0,
    backFootprintDensity: 0,
    minClearanceTrackToTrack: STATISTICS_INT_MAX,
    minTrackWidth: STATISTICS_INT_MAX,
    minDrillSize: STATISTICS_INT_MAX,
    boardThickness: 0,
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
      { attribute: PAD_ATTRIB.PTH, title: 'Through hole:', quantity: 0 },
      { attribute: PAD_ATTRIB.SMD, title: 'SMD:', quantity: 0 },
      { attribute: PAD_ATTRIB.CONN, title: 'Connector:', quantity: 0 },
      { attribute: PAD_ATTRIB.NPTH, title: 'NPTH:', quantity: 0 },
    ],
    padPropertyEntries: [
      { attribute: PAD_PROP.CASTELLATED, title: 'Castellated:', quantity: 0 },
      { attribute: PAD_PROP.PRESSFIT, title: 'Press-fit:', quantity: 0 },
    ],
    viaEntries: [
      { attribute: VIATYPE.THROUGH, title: 'Through vias:', quantity: 0 },
      { attribute: VIATYPE.BLIND, title: 'Blind vias:', quantity: 0 },
      { attribute: VIATYPE.BURIED, title: 'Buried vias:', quantity: 0 },
      { attribute: VIATYPE.MICROVIA, title: 'Micro vias:', quantity: 0 },
    ],
    drillEntries: [],
  };
}

/** The area of a pad's hole: a stadium — a rectangle plus two half-circles. */
function padHoleArea(aPad: {
  GetEffectiveHoleShape(): { GetSeg(): { Length(): number }; GetWidth(): number };
}): number {
  const hole = aPad.GetEffectiveHoleShape();
  const width = hole.GetWidth();

  return hole.GetSeg().Length() * width + Math.PI * 0.25 * width * width;
}

/** `ComputeBoardStatistics`. */
export function ComputeBoardStatistics(
  aBoard: BOARD,
  aOptions: BoardStatisticsOptions = DEFAULT_BOARD_STATISTICS_OPTIONS,
  aData: BoardStatisticsData = InitializeBoardStatisticsData(),
): BoardStatisticsData {
  ResetCounts(aData);
  const data = aData;

  for (const footprint of aBoard.Footprints()) {
    if (aOptions.excludeFootprintsWithoutPads && footprint.Pads().length === 0) continue;

    const attributes = footprint.GetAttributes();

    for (const entry of data.footprintEntries) {
      if ((attributes & entry.attributeMask) === entry.attributeValue) {
        switch (footprint.GetSide()) {
          case PCB_LAYER_ID.F_Cu:
            entry.frontCount++;
            break;
          case PCB_LAYER_ID.B_Cu:
            entry.backCount++;
            break;
          default:
            break;
        }

        break;
      }
    }

    // `updatePadCounts` runs per footprint, inside the exclusion test — which
    // costs nothing, since the only footprints excluded have no pads.
    for (const pad of footprint.Pads()) {
      for (const padEntry of data.padEntries) {
        if (pad.GetAttribute() === padEntry.attribute) {
          padEntry.quantity++;
          break;
        }
      }

      for (const propEntry of data.padPropertyEntries) {
        if (pad.GetProperty() === propEntry.attribute) {
          propEntry.quantity++;
          break;
        }
      }
    }
  }

  for (const track of aBoard.Tracks()) {
    // Only PCB_TRACE_T narrows the minimum: a curved track is not a candidate,
    // however thin it is.
    if (track.Type() === KICAD_T.PCB_TRACE_T)
      data.minTrackWidth = Math.min(data.minTrackWidth, track.GetWidth());

    if (track.Type() === KICAD_T.PCB_VIA_T) {
      const via = track as PCB_VIA;

      for (const entry of data.viaEntries) {
        if (via.GetViaType() === entry.attribute) {
          entry.quantity++;
          break;
        }
      }
    }
  }

  data.drillEntries = CollectDrillLineItems(aBoard);

  // `DRILL_LINE_ITEM::COMPARE( COL_COUNT, false )` — descending by quantity.
  data.drillEntries.sort((a, b) => b.qty - a.qty);

  for (const drill of data.drillEntries) {
    if (drill.shape === PAD_DRILL_SHAPE.CIRCLE)
      data.minDrillSize = Math.min(data.minDrillSize, drill.xSize);
  }

  const polySet = new SHAPE_POLY_SET();
  data.hasOutline = aBoard.GetBoardPolygonOutlines(polySet, false);

  if (data.hasOutline) {
    data.boardArea = 0;

    for (let i = 0; i < polySet.OutlineCount(); ++i) {
      data.boardArea += polySet.Outline(i).Area();

      if (aOptions.subtractHolesFromBoardArea) {
        for (let j = 0; j < polySet.HoleCount(i); ++j) data.boardArea -= polySet.Hole(i, j).Area();

        // Upstream nests these two loops inside the per-outline loop, so a
        // board with N outlines subtracts every drilled hole N times. Kept.
        for (const footprint of aBoard.Footprints()) {
          for (const pad of footprint.Pads()) {
            if (!pad.HasHole()) continue;

            data.boardArea -= padHoleArea(pad);
          }
        }

        // Note this one has no `drill > 0` guard: a via is subtracted whatever
        // its drill says.
        for (const track of aBoard.Tracks()) {
          if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

          const drill = (track as PCB_VIA).GetDrillValue();
          data.boardArea -= Math.PI * 0.25 * drill * drill;
        }
      }
    }

    const bbox = polySet.BBox();
    data.boardWidth = bbox.GetWidth();
    data.boardHeight = bbox.GetHeight();
  }

  // The courtyard areas: how much space components occupy. Always assumes every
  // component is populated, as it is a layout measurement.
  const frontShapesForArea = new SHAPE_POLY_SET();
  const backShapesForArea = new SHAPE_POLY_SET();

  const minPadClearanceOuter = aBoard
    .GetDesignSettings()
    .m_NetSettings.GetDefaultNetclass()
    .GetClearance();

  for (const fp of aBoard.Footprints()) {
    const frontA = fp.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
    const backA = fp.GetCourtyard(PCB_LAYER_ID.B_CrtYd);

    if (frontA.OutlineCount() !== 0) frontShapesForArea.Append(frontA);
    if (backA.OutlineCount() !== 0) backShapesForArea.Append(backA);

    // PTH/NPTH holes in footprints can be outside the main courtyard and also
    // consume space on the other side of the board but without a courtyard.
    for (const pad of fp.Pads()) {
      if (!pad.HasHole()) continue;

      if (pad.GetAttribute() !== PAD_ATTRIB.NPTH) {
        pad.TransformShapeToPolygon(
          frontShapesForArea,
          PCB_LAYER_ID.F_Cu,
          Math.min(minPadClearanceOuter, pad.GetOwnClearance(PCB_LAYER_ID.F_Cu)),
          ARC_LOW_DEF,
          ERROR_LOC.ERROR_INSIDE,
        );
        pad.TransformShapeToPolygon(
          backShapesForArea,
          PCB_LAYER_ID.B_Cu,
          Math.min(minPadClearanceOuter, pad.GetOwnClearance(PCB_LAYER_ID.B_Cu)),
          ARC_LOW_DEF,
          ERROR_LOC.ERROR_INSIDE,
        );
      } else {
        pad.TransformHoleToPolygon(frontShapesForArea, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_INSIDE);
        pad.TransformHoleToPolygon(backShapesForArea, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_INSIDE);
      }
    }
  }

  // Deal with overlapping courtyards (if people are ignoring DRC or something)
  // and such through simplify.
  frontShapesForArea.Simplify();
  backShapesForArea.Simplify();

  data.frontFootprintCourtyardArea = frontShapesForArea.Area();
  data.backFootprintCourtyardArea = backShapesForArea.Area();

  if (data.hasOutline) {
    data.frontFootprintDensity = (data.frontFootprintCourtyardArea * 100) / data.boardArea;
    data.backFootprintDensity = (data.backFootprintCourtyardArea * 100) / data.boardArea;
  }

  const frontCopper = new SHAPE_POLY_SET();
  const backCopper = new SHAPE_POLY_SET();
  const frontHoles = new SHAPE_POLY_SET();
  const backHoles = new SHAPE_POLY_SET();

  aBoard.RunOnChildren((child) => {
    if (
      child.Type() === KICAD_T.PCB_FOOTPRINT_T ||
      child.Type() === KICAD_T.PCB_GROUP_T ||
      child.Type() === KICAD_T.PCB_GENERATOR_T
    ) {
      return;
    }

    if (child.IsOnLayer(PCB_LAYER_ID.F_Cu))
      child.TransformShapeToPolySet(
        frontCopper,
        PCB_LAYER_ID.F_Cu,
        0,
        ARC_LOW_DEF,
        ERROR_LOC.ERROR_INSIDE,
      );

    if (child.IsOnLayer(PCB_LAYER_ID.B_Cu))
      child.TransformShapeToPolySet(
        backCopper,
        PCB_LAYER_ID.B_Cu,
        0,
        ARC_LOW_DEF,
        ERROR_LOC.ERROR_INSIDE,
      );

    if (child.Type() === KICAD_T.PCB_PAD_T) {
      const pad = child as unknown as {
        HasHole(): boolean;
        TransformHoleToPolygon(a: SHAPE_POLY_SET, b: number, c: number, d: ERROR_LOC): void;
      };

      if (pad.HasHole()) {
        pad.TransformHoleToPolygon(frontHoles, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);
        pad.TransformHoleToPolygon(backHoles, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);
      }
    } else if (child.Type() === KICAD_T.PCB_VIA_T) {
      const via = child as unknown as PCB_VIA;
      const center = via.GetPosition();
      const radius = Math.trunc(via.GetDrillValue() / 2);

      if (via.IsOnLayer(PCB_LAYER_ID.F_Cu))
        TransformCircleToPolygon(frontHoles, center, radius, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);

      if (via.IsOnLayer(PCB_LAYER_ID.B_Cu))
        TransformCircleToPolygon(backHoles, center, radius, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);
    }
  }, RECURSE_MODE.RECURSE);

  if (aOptions.subtractHolesFromCopperAreas) {
    frontCopper.BooleanSubtract(frontHoles);
    backCopper.BooleanSubtract(backHoles);
  }

  data.frontCopperArea = frontCopper.Area();
  data.backCopperArea = backCopper.Area();

  data.boardThickness = aBoard.GetStackupOrDefault().BuildBoardThicknessFromStackup();

  return data;
}

/** `formatCount`. */
function formatCount(aCount: number): string {
  return `${aCount}`;
}

/**
 * `appendTable`: a fixed-width table, each column padded to its widest cell.
 *
 * The header row is never treated as a label row even when the table has one,
 * which is what makes the header's first cell right-aligned while every data
 * row's is left-aligned. The rule under the header is `width + 2` dashes per
 * column, floored at three so a one-character column still reads as a rule.
 */
function appendTable(aRows: string[][], aUseFirstColAsLabel: boolean, aOut: string[]): void {
  if (aRows.length === 0) return;

  let columnCount = 0;

  for (const row of aRows) {
    if (row.length > columnCount) columnCount = row.length;
  }

  if (columnCount === 0) return;

  const widths = new Array<number>(columnCount).fill(0);

  for (const row of aRows) {
    for (let col = 0; col < columnCount; ++col) {
      if (col >= row.length) continue;

      const cellWidth = row[col]!.length;

      if (cellWidth > widths[col]!) widths[col] = cellWidth;
    }
  }

  const padLeft = (v: string, w: number): string => v.padStart(w);
  const padRight = (v: string, w: number): string => v.padEnd(w);

  const appendDataRow = (row: string[], treatFirstAsLabel: boolean): void => {
    if (treatFirstAsLabel && aUseFirstColAsLabel) {
      aOut.push(`|${padRight(row[0] ?? '', widths[0]!)}  |`);

      for (let col = 1; col < columnCount; ++col)
        aOut.push(` ${padLeft(row[col] ?? '', widths[col]!)} |`);
    } else {
      aOut.push('|');

      for (let col = 0; col < columnCount; ++col)
        aOut.push(` ${padLeft(row[col] ?? '', widths[col]!)} |`);
    }

    aOut.push('\n');
  };

  appendDataRow(aRows[0]!, false);

  aOut.push('|');

  for (let col = 0; col < columnCount; ++col) {
    let dashCount = widths[col]! + 2;

    if (dashCount < 3) dashCount = 3;

    aOut.push(`${'-'.repeat(dashCount)}|`);
  }

  aOut.push('\n');

  for (let rowIdx = 1; rowIdx < aRows.length; ++rowIdx) appendDataRow(aRows[rowIdx]!, true);
}

/** The drill shape's printed name. */
function drillShapeName(aShape: PAD_DRILL_SHAPE): string {
  switch (aShape) {
    case PAD_DRILL_SHAPE.CIRCLE:
      return 'Round';
    case PAD_DRILL_SHAPE.OBLONG:
      return 'Slot';
    default:
      return '???';
  }
}

/** A drill row's start/stop layer name, or "N/A" where it has none. */
function drillLayerName(aBoard: BOARD | null, aLayer: PCB_LAYER_ID): string {
  if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER || !aBoard) return 'N/A';

  return aBoard.GetLayerName(aLayer);
}

/** `FormatBoardStatisticsReport`: the plain-text report the dialog saves. */
export function FormatBoardStatisticsReport(
  aData: BoardStatisticsData,
  aBoard: BOARD | null,
  aUnitsProvider: UNITS_PROVIDER,
  aProjectName: string,
  aBoardName: string,
): string {
  const out: string[] = [];
  const v = (value: number, type: EdaDataType = 'distance'): string =>
    aUnitsProvider.MessageTextFromValue(value, true, type);

  out.push('PCB statistics report\n=====================\n');
  out.push(`- Date: ${new Date().toString()}\n`);
  out.push(`- Project: ${aProjectName}\n`);
  out.push(`- Board name: ${aBoardName}\n\n`);

  out.push('Board\n-----\n');

  if (aData.hasOutline) {
    out.push(`- Width: ${aUnitsProvider.MessageTextFromValue(aData.boardWidth)}\n`);
    out.push(`- Height: ${aUnitsProvider.MessageTextFromValue(aData.boardHeight)}\n`);
    out.push(`- Area: ${v(aData.boardArea, 'area')}\n`);
  } else {
    out.push('- Dimensions: unknown\n');
    out.push('- Area: unknown\n');
  }

  out.push(`- Front copper area: ${v(aData.frontCopperArea, 'area')}\n`);
  out.push(`- Back copper area: ${v(aData.backCopperArea, 'area')}\n`);
  out.push(`- Min track clearance: ${v(aData.minClearanceTrackToTrack)}\n`);
  out.push(`- Min track width: ${v(aData.minTrackWidth)}\n`);
  out.push(`- Min drill diameter: ${v(aData.minDrillSize)}\n`);
  out.push(`- Board stackup thickness: ${v(aData.boardThickness)}\n\n`);

  out.push(`- Front footprint area: ${v(aData.frontFootprintCourtyardArea, 'area')}\n`);
  out.push(`- Back footprint area: ${v(aData.backFootprintCourtyardArea, 'area')}\n`);

  out.push('- Front component density: ');
  out.push(aData.hasOutline ? `${aData.frontFootprintDensity.toFixed(2)} %` : 'unknown');
  out.push('\n');

  out.push('- Back component density: ');
  out.push(aData.hasOutline ? `${aData.backFootprintDensity.toFixed(2)} %` : 'unknown');
  out.push('\n');

  out.push('\n');
  out.push('Pads\n----\n');

  for (const padEntry of aData.padEntries) out.push(`- ${padEntry.title} ${padEntry.quantity}\n`);

  for (const propEntry of aData.padPropertyEntries)
    out.push(`- ${propEntry.title} ${propEntry.quantity}\n`);

  out.push('\n');
  out.push('Vias\n----\n');

  for (const viaEntry of aData.viaEntries) out.push(`- ${viaEntry.title} ${viaEntry.quantity}\n`);

  out.push('\n');
  out.push('Components\n----------\n\n');

  const componentRows: string[][] = [['', 'Front Side', 'Back Side', 'Total']];
  let frontTotal = 0;
  let backTotal = 0;

  for (const fpEntry of aData.footprintEntries) {
    componentRows.push([
      fpEntry.title,
      formatCount(fpEntry.frontCount),
      formatCount(fpEntry.backCount),
      formatCount(fpEntry.frontCount + fpEntry.backCount),
    ]);

    frontTotal += fpEntry.frontCount;
    backTotal += fpEntry.backCount;
  }

  componentRows.push([
    'Total:',
    formatCount(frontTotal),
    formatCount(backTotal),
    formatCount(frontTotal + backTotal),
  ]);

  appendTable(componentRows, true, out);

  out.push('\n');
  out.push('Drill holes\n-----------\n\n');

  const drillRows: string[][] = [
    ['Count', 'Shape', 'X Size', 'Y Size', 'Plated', 'Via/Pad', 'Start Layer', 'Stop Layer'],
  ];

  for (const drill of aData.drillEntries) {
    drillRows.push([
      formatCount(drill.qty),
      drillShapeName(drill.shape),
      aUnitsProvider.MessageTextFromValue(drill.xSize),
      aUnitsProvider.MessageTextFromValue(drill.ySize),
      drill.isPlated ? 'PTH' : 'NPTH',
      drill.isPad ? 'Pad' : 'Via',
      drillLayerName(aBoard, drill.startLayer),
      drillLayerName(aBoard, drill.stopLayer),
    ]);
  }

  appendTable(drillRows, false, out);

  return out.join('');
}

/**
 * `FormatBoardStatisticsJson`.
 *
 * The UI strings end in colons and sometimes carry a suffix like "vias", so
 * `jsonize` strips both before snake-casing. The via keys pass
 * `removeSuffix`, the pad and component keys do not — that asymmetry is
 * upstream's and it is what makes "Through vias:" into `through` while
 * "Through hole:" stays `through_hole`.
 */
export function FormatBoardStatisticsJson(
  aData: BoardStatisticsData,
  aBoard: BOARD | null,
  aUnitsProvider: UNITS_PROVIDER,
  aProjectName: string,
  aBoardName: string,
): string {
  const v = (value: number, type: EdaDataType = 'distance'): string =>
    aUnitsProvider.MessageTextFromValue(value, true, type);

  const jsonize = (title: string, removeSuffix: boolean): string => {
    let json = title;

    if (removeSuffix) {
      const cut = json.lastIndexOf(' ');
      json = cut < 0 ? '' : json.slice(0, cut);
    }

    if (json.endsWith(':')) json = json.slice(0, -1);

    return json.replaceAll(' ', '_').replaceAll('-', '_').toLowerCase();
  };

  const board: Record<string, unknown> = { has_outline: aData.hasOutline };

  if (aData.hasOutline) {
    board.width = aUnitsProvider.MessageTextFromValue(aData.boardWidth);
    board.height = aUnitsProvider.MessageTextFromValue(aData.boardHeight);
    board.area = v(aData.boardArea, 'area');
    board.front_component_density = aData.frontFootprintDensity.toFixed(2);
    board.back_component_density = aData.backFootprintDensity.toFixed(2);
  } else {
    board.width = null;
    board.height = null;
    board.area = null;
    board.front_component_density = null;
    board.back_component_density = null;
  }

  board.front_copper_area = v(aData.frontCopperArea, 'area');
  board.back_copper_area = v(aData.backCopperArea, 'area');
  board.min_track_clearance = aUnitsProvider.MessageTextFromValue(aData.minClearanceTrackToTrack);
  board.min_track_width = aUnitsProvider.MessageTextFromValue(aData.minTrackWidth);
  board.min_drill_diameter = aUnitsProvider.MessageTextFromValue(aData.minDrillSize);
  board.board_thickness = aUnitsProvider.MessageTextFromValue(aData.boardThickness);
  board.front_footprint_area = v(aData.frontFootprintCourtyardArea, 'area');
  board.back_footprint_area = v(aData.backFootprintCourtyardArea, 'area');

  if (aData.hasOutline) {
    board.front_footprint_density = aData.frontFootprintDensity.toFixed(2);
    board.back_footprint_density = aData.backFootprintDensity.toFixed(2);
  } else {
    board.front_footprint_density = null;
    board.back_footprint_density = null;
  }

  const pads: Record<string, number> = {};

  for (const padEntry of aData.padEntries) pads[jsonize(padEntry.title, false)] = padEntry.quantity;

  for (const propEntry of aData.padPropertyEntries)
    pads[jsonize(propEntry.title, false)] = propEntry.quantity;

  const vias: Record<string, number> = {};

  for (const viaEntry of aData.viaEntries) vias[jsonize(viaEntry.title, true)] = viaEntry.quantity;

  const components: Record<string, unknown> = {};
  let frontTotal = 0;
  let backTotal = 0;

  for (const fpEntry of aData.footprintEntries) {
    components[jsonize(fpEntry.title, false)] = {
      front: fpEntry.frontCount,
      back: fpEntry.backCount,
      total: fpEntry.frontCount + fpEntry.backCount,
    };

    frontTotal += fpEntry.frontCount;
    backTotal += fpEntry.backCount;
  }

  components.total = { front: frontTotal, back: backTotal, total: frontTotal + backTotal };

  const drillHoles = aData.drillEntries.map((drill) => ({
    count: drill.qty,
    shape: drillShapeName(drill.shape),
    x_size: aUnitsProvider.MessageTextFromValue(drill.xSize),
    y_size: aUnitsProvider.MessageTextFromValue(drill.ySize),
    plated: drill.isPlated,
    source: drill.isPad ? 'Pad' : 'Via',
    start_layer: drillLayerName(aBoard, drill.startLayer),
    stop_layer: drillLayerName(aBoard, drill.stopLayer),
  }));

  return JSON.stringify(
    {
      metadata: {
        date: GetISO8601CurrentDateTime(),
        generator: `${GENERATOR_APPLICATION} ${GENERATOR_VERSION}`,
        project: aProjectName,
        board_name: aBoardName,
      },
      board,
      pads,
      vias,
      components,
      drill_holes: drillHoles,
    },
    null,
    2,
  );
}
