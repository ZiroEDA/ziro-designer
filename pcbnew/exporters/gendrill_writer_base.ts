// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GENDRILL_WRITER_BASE` with `DRILL_TOOL`, `HOLE_INFO`, `DRILL_SPAN` and
 * `DRILL_PRECISION`: KiCad's `pcbnew/exporters/gendrill_writer_base.cpp` and
 * `.h`. The hole and tool lists every drill file, drill map and drill report
 * is built from.
 *
 * Divergences, both because a browser has no filesystem or clock of its own:
 * - Every file goes to the writer's file sink (`SetFileSink`), keyed by the
 *   path upstream would have opened; by default they are kept and read back
 *   with `GetWrittenFiles()`.
 * - "Now" (the report's `Created on`, the header dates) is `SetDate`'s.
 * - A PDF drill map is written uncompressed unless a deflater is given
 *   (`SetPdfDeflate`): PDF_PLOTTER takes its zlib injected.
 */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { TEXT_ATTRIBUTES } from '@ziroeda/common/font/text_attributes.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/eda_text.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { GetDefaultPlotExtension } from '@ziroeda/common/plotters/common_plot_functions.js';
import { DXF_PLOTTER } from '@ziroeda/common/plotters/DXF_plotter.js';
import { fixed } from '@ziroeda/common/plotters/fmt.js';
import { GERBER_PLOTTER } from '@ziroeda/common/plotters/GERBER_plotter.js';
import { type PdfDeflate, PDF_PLOTTER } from '@ziroeda/common/plotters/PDF_plotter.js';
import {
  DXF_UNITS,
  PLOT_FORMAT,
  type PLOTTER,
  plotterFont,
  USE_DEFAULT_LINE_WIDTH,
} from '@ziroeda/common/plotters/plotter.js';
import { PS_PLOTTER } from '@ziroeda/common/plotters/PS_plotter.js';
import { SVG_PLOTTER } from '@ziroeda/common/plotters/SVG_plotter.js';
import {
  type Reporter,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
} from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ANGLE_0,
  ANGLE_HORIZONTAL,
  type EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import {
  PAD_ATTRIB,
  PAD_DRILL_POST_MACHINING_MODE,
  PAD_DRILL_SHAPE,
  PAD_PROP,
} from '../padstack.js';
import type { PADSTACK_DRILL_PROPS } from '../padstack.js';
import { PCB_PLOT_PARAMS } from '../pcb_plot_params.js';
import { PCB_RENDER_SETTINGS } from '../pcb_painter.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_VIA } from '../pcb_track.js';
import { AddGerberX2Header } from '../pcbplot.js';
import { BRDITEMS_PLOTTER } from '../plot_brditems_plotter.js';

// holes can have an attribute in Excellon drill files, similar to attributes
// in Gerber X2 format
// They are only comments for a better identification of holes (vias, pads...)
// Set to 1 to add these comments and 0 to not use these comments
export const USE_ATTRIB_FOR_HOLES = true;

// hole attribute, mainly to identify vias and pads and add this info as comment
// in NC drill files
export enum HOLE_ATTRIBUTE {
  HOLE_UNKNOWN, // uninitialized type
  HOLE_VIA_THROUGH, // a via hole (always plated) from top to bottom
  HOLE_VIA_BURIED, // a via hole (always plated) not through hole
  HOLE_VIA_BACKDRILL, // a via hole created by a backdrill operation
  HOLE_PAD, // a plated or not plated pad hole
  HOLE_PAD_CASTELLATED, // a plated castelleted pad hole
  HOLE_PAD_PRESSFIT, // a plated press-fit pad hole
  HOLE_MECHANICAL, // a mechanical pad (provided, not used)
}

// Via Protection features according to IPC-4761.
export enum IPC4761_FEATURES {
  FILLED,
  CAPPED,
  PLUGGED_FRONT,
  PLUGGED_BACK,
  COVERED_FRONT,
  COVERED_BACK,
  TENTED_FRONT,
  TENTED_BACK,
}

// the DRILL_TOOL class  handles tools used in the excellon drill file:
export class DRILL_TOOL {
  m_Diameter: number; // the diameter of the used tool (for oblong, the smaller size)
  m_TotalCount = 0; // how many times it is used (round and oblong)
  m_OvalCount = 0; // oblong count
  m_Hole_NotPlated: boolean; // Is the hole plated or not plated
  m_HoleAttribute = HOLE_ATTRIBUTE.HOLE_UNKNOWN; // Attribute (used in Excellon drill file)
  m_IsBackdrill = false; // True when drilling a backdrill span
  m_HasPostMachining = false; // True if any hole for this tool has post-machining
  m_MinStubLength: number | undefined; // Minimum stub length for this tool (IU)
  m_MaxStubLength: number | undefined; // Maximum stub length for this tool (IU)

  constructor(aDiameter: number, a_NotPlated: boolean) {
    this.m_Diameter = aDiameter;
    this.m_Hole_NotPlated = a_NotPlated;
  }
}

/**
 * Handle hole which must be drilled (diameter, position and layers).
 *
 * For buried or micro vias, the hole is not on all layers.  So we must generate a drill file
 * for each layer pair (adjacent layers).  Not plated holes are always through holes, and must
 * be output on a specific drill file because they are drilled after the PCB process is finished.
 */
export class HOLE_INFO {
  m_ItemParent: BOARD_ITEM | null = null; // The pad or via parent of this hole
  m_Hole_Diameter = 0; // hole value, and for oblong: min(hole size x, hole size y).
  m_Tool_Reference = 0; // Tool reference for this hole = 1 ... n (values <=0 must not be used).
  m_Hole_Size: VECTOR2I = { x: 0, y: 0 }; // hole size for oblong holes
  m_Hole_Orient: EDA_ANGLE = ANGLE_0; // Hole rotation (= pad rotation) for oblong holes
  m_Hole_Shape = 0; // hole shape: round (0) or oval (1)
  m_Hole_Pos: VECTOR2I = { x: 0, y: 0 }; // hole position
  m_Hole_Bottom_Layer: PCB_LAYER_ID = PCB_LAYER_ID.B_Cu; // hole ending layer (usually back layer)
  m_Hole_Top_Layer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu; // hole starting layer (usually front layer)
  m_Hole_NotPlated = false; // hole not plated. Must be in a specific drill file or section.
  m_HoleAttribute = HOLE_ATTRIBUTE.HOLE_UNKNOWN; // Attribute, used in Excellon drill file and to sort holes
  m_Hole_Filled = false; // True if the hole is filled
  m_Hole_Capped = false; // True if the hole is capped
  m_Hole_Top_Covered = false; // True if the hole is covered on the top layer
  m_Hole_Bot_Covered = false; // True if the hole is covered on the bottom layer
  m_Hole_Top_Plugged = false; // True if the hole is plugged on the top layer
  m_Hole_Bot_Plugged = false; // True if the hole is plugged on the bottom layer
  m_Hole_Top_Tented = false; // True if the hole is tented on the top layer
  m_Hole_Bot_Tented = false; // True if the hole is tented on the bottom layer
  m_IsBackdrill = false; // True if the hole is a backdrill
  m_FrontPostMachining = PAD_DRILL_POST_MACHINING_MODE.UNKNOWN; // Post-machining mode
  m_FrontPostMachiningSize = 0; // Post-machining size
  m_FrontPostMachiningDepth = 0; // Post-machining depth
  m_FrontPostMachiningAngle = 0; // Post-machining angle
  m_BackPostMachining = PAD_DRILL_POST_MACHINING_MODE.UNKNOWN; // Post-machining mode
  m_BackPostMachiningSize = 0; // Post-machining size
  m_BackPostMachiningDepth = 0; // Post-machining depth
  m_BackPostMachiningAngle = 0; // Post-machining angle
  m_DrillStart: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER; // Start layer for backdrills
  m_DrillEnd: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER; // End layer for backdrills
  m_StubLength: number | undefined; // Stub length for backdrills
}

/** `DRILL_LAYER_PAIR`: `std::pair<PCB_LAYER_ID, PCB_LAYER_ID>`. */
export type DRILL_LAYER_PAIR = readonly [PCB_LAYER_ID, PCB_LAYER_ID];

const pairEq = (a: DRILL_LAYER_PAIR, b: DRILL_LAYER_PAIR): boolean =>
  a[0] === b[0] && a[1] === b[1];

const THROUGH: DRILL_LAYER_PAIR = [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu];

export class DRILL_SPAN {
  m_StartLayer: PCB_LAYER_ID;
  m_EndLayer: PCB_LAYER_ID;
  m_IsBackdrill: boolean;
  m_IsNonPlatedFile: boolean;

  constructor(
    aStartLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu,
    aEndLayer: PCB_LAYER_ID = PCB_LAYER_ID.B_Cu,
    aIsBackdrill = false,
    aIsNonPlated = false,
  ) {
    this.m_StartLayer = aStartLayer;
    this.m_EndLayer = aEndLayer;
    this.m_IsBackdrill = aIsBackdrill;
    this.m_IsNonPlatedFile = aIsNonPlated;
  }

  TopLayer(): PCB_LAYER_ID {
    return this.m_StartLayer < this.m_EndLayer ? this.m_StartLayer : this.m_EndLayer;
  }

  BottomLayer(): PCB_LAYER_ID {
    return this.m_StartLayer < this.m_EndLayer ? this.m_EndLayer : this.m_StartLayer;
  }

  DrillStartLayer(): PCB_LAYER_ID {
    return this.m_StartLayer;
  }

  DrillEndLayer(): PCB_LAYER_ID {
    return this.m_EndLayer;
  }

  Pair(): DRILL_LAYER_PAIR {
    return [this.TopLayer(), this.BottomLayer()];
  }

  /** `operator<`. */
  lt(aOther: DRILL_SPAN): boolean {
    if (this.TopLayer() !== aOther.TopLayer()) return this.TopLayer() < aOther.TopLayer();

    if (this.BottomLayer() !== aOther.BottomLayer())
      return this.BottomLayer() < aOther.BottomLayer();

    if (this.m_IsBackdrill !== aOther.m_IsBackdrill)
      return this.m_IsBackdrill && !aOther.m_IsBackdrill;

    if (this.m_IsNonPlatedFile !== aOther.m_IsNonPlatedFile)
      return this.m_IsNonPlatedFile && !aOther.m_IsNonPlatedFile;

    if (this.m_StartLayer !== aOther.m_StartLayer) return this.m_StartLayer < aOther.m_StartLayer;

    return this.m_EndLayer < aOther.m_EndLayer;
  }
}

/**
 * Helper to handle drill precision format in excellon files.
 */
export class DRILL_PRECISION {
  m_Lhs: number; // Left digit number (integer value of coordinates)
  m_Rhs: number; // Right digit number (decimal value of coordinates)

  constructor(l = 2, r = 4) {
    this.m_Lhs = l;
    this.m_Rhs = r;
  }

  GetPrecisionString(): string {
    return `${this.m_Lhs}:${this.m_Rhs}`;
  }
}

export enum ZEROS_FMT {
  // Zero format in coordinates
  DECIMAL_FORMAT, // Floating point coordinates
  SUPPRESS_LEADING, // Suppress leading zeros
  SUPPRESS_TRAILING, // Suppress trailing zeros
  KEEP_ZEROS, // keep zeros
}

export enum TYPE_FILE {
  // type of holes in file: PTH, NPTH, mixed
  PTH_FILE, // PTH only, this is the default also for blind/buried holes
  NPTH_FILE, // NPTH only
  MIXED_FILE, // PHT+NPTH (mixed)
}

/* Helper function for sorting hole list.
 * Compare function used for sorting holes type type:
 * plated then not plated
 * then by increasing diameter value
 * then by attribute type (vias, pad, mechanical)
 * then by X then Y position
 */
function cmpHoleSorting(a: HOLE_INFO, b: HOLE_INFO): boolean {
  if (a.m_Hole_NotPlated !== b.m_Hole_NotPlated) return b.m_Hole_NotPlated;

  if (a.m_Hole_Diameter !== b.m_Hole_Diameter) return a.m_Hole_Diameter < b.m_Hole_Diameter;

  // At this point (same diameter, same plated type), group by attribute
  // type (via, pad, mechanical, although currently only not plated pads are mechanical)
  if (a.m_HoleAttribute !== b.m_HoleAttribute) return a.m_HoleAttribute < b.m_HoleAttribute;

  // At this point (same diameter, same type), sort by X then Y position.
  // This is optimal for drilling and make the file reproducible as long as holes
  // have not changed, even if the data order has changed.
  if (a.m_Hole_Pos.x !== b.m_Hole_Pos.x) return a.m_Hole_Pos.x < b.m_Hole_Pos.x;

  return a.m_Hole_Pos.y < b.m_Hole_Pos.y;
}

/* Conversion utilities - these will be used often in there... */
const diameter_in_inches = (ius: number): number => (ius * 0.001) / pcbIUScale.IU_PER_MILS;

const diameter_in_mm = (ius: number): number => ius / pcbIUScale.IU_PER_MM;

// return a pen size to plot markers and having a readable shape
// clamped to be >= MIN_SIZE_MM to avoid too small line width
function getMarkerBestPenSize(aMarkerDiameter: number): number {
  let bestsize = Math.trunc(aMarkerDiameter / 10);

  const MIN_SIZE_MM = 0.1;
  bestsize = Math.max(bestsize, pcbIUScale.mmToIU(MIN_SIZE_MM));

  return bestsize;
}

// return a pen size to plot outlines for oval holes
const getSketchOvalBestPenSize = (): number => pcbIUScale.mmToIU(0.1);

// return a default pen size to plot items with no specific line thickness
const getDefaultPenSize = (): number => pcbIUScale.mmToIU(0.2);

/** `wxFileName( path ).GetName()` / `.GetFullName()`. */
export function splitFileName(aPath: string): { dir: string; name: string; fullName: string } {
  const slash = Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\'));
  const fullName = aPath.slice(slash + 1);
  const dot = fullName.lastIndexOf('.');

  return {
    dir: slash >= 0 ? aPath.slice(0, slash) : '',
    name: dot > 0 ? fullName.slice(0, dot) : fullName,
    fullName,
  };
}

/** `wxFileName::SetPath( aDir )` + `GetFullPath()`. */
export const joinPath = (aDir: string, aFullName: string): string =>
  aDir ? `${aDir.replace(/[\\/]+$/, '')}/${aFullName}` : aFullName;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `GetISO8601CurrentDateTime()` at a given moment: local time, no zone. */
export function iso8601DateTime(aDate: Date): string {
  return (
    `${aDate.getFullYear()}-${pad2(aDate.getMonth() + 1)}-${pad2(aDate.getDate())}` +
    `T${pad2(aDate.getHours())}:${pad2(aDate.getMinutes())}:${pad2(aDate.getSeconds())}`
  );
}

const TEXT_ENCODER = new TextEncoder();

/**
 * Create drill maps and drill reports and drill files.
 *
 * Drill files are created by specialized derived classes, depending on the file format.
 */
export abstract class GENDRILL_WRITER_BASE {
  protected m_pcb: BOARD;
  protected m_drillFileExtension = ''; // .drl or .gbr, depending on format
  protected m_unitsMetric = true; // true = mm, false = inches
  protected m_zeroFormat = ZEROS_FMT.DECIMAL_FORMAT; // the zero format option for output file
  protected m_precision = new DRILL_PRECISION(); // The current coordinate precision (not
  // used in decimal format).
  protected m_conversionUnits = 1.0; // scaling factor to convert the board
  // unites to Excellon/Gerber units (i.e inches or mm)
  protected m_offset: VECTOR2I = { x: 0, y: 0 }; // Drill offset coordinates
  protected m_merge_PTH_NPTH = false; // True to generate only one drill file
  protected m_holeListBuffer: HOLE_INFO[] = []; // Buffer containing holes
  protected m_toolListBuffer: DRILL_TOOL[] = []; // Buffer containing tools
  protected m_mapFileFmt = PLOT_FORMAT.PDF; // the format of the map drill file,
  // if this map is needed
  protected m_pageInfo: PAGE_INFO | null = null; // the page info used to plot drill maps
  // If NULL, use a A4 page format

  /** The file sink (see the file comment). */
  protected m_fileSink: (aFullPath: string, aBytes: Uint8Array) => void;
  private m_files = new Map<string, Uint8Array>();
  protected m_date: Date | null = null;
  private m_pdfDeflate: PdfDeflate | null = null;

  // Use derived classes to build a fully initialized GENDRILL_WRITER_BASE class.
  protected constructor(aPcb: BOARD) {
    this.m_pcb = aPcb;
    this.m_fileSink = (aPath, aBytes) => this.m_files.set(aPath, aBytes);
  }

  /** Where the files go (the file comment); by default, `GetWrittenFiles()`. */
  SetFileSink(aSink: (aFullPath: string, aBytes: Uint8Array) => void): void {
    this.m_fileSink = aSink;
  }

  /** The files written so far with the default sink, by full path. */
  GetWrittenFiles(): ReadonlyMap<string, Uint8Array> {
    return this.m_files;
  }

  /** "Now", for the dates the files carry. */
  SetDate(aDate: Date): void {
    this.m_date = aDate;
  }

  /** The zlib compressor for a PDF drill map. */
  SetPdfDeflate(aDeflate: PdfDeflate): void {
    this.m_pdfDeflate = aDeflate;
  }

  protected now(): Date {
    return this.m_date ?? new Date();
  }

  protected writeFile(aFullPath: string, aText: string): void {
    this.m_fileSink(aFullPath, TEXT_ENCODER.encode(aText));
  }

  /**
   * Set the option to make separate drill files for PTH and NPTH.
   *
   * @param aMerge set to true to make only one file containing PTH and NPTH or false to
   *               create 2 separate files.
   */
  SetMergeOption(aMerge: boolean): void {
    this.m_merge_PTH_NPTH = aMerge;
  }

  /** Return the plot offset (usually the position of the drill/place origin). */
  GetOffset(): VECTOR2I {
    return this.m_offset;
  }

  /** Set the page info used to plot drill maps. If null, a A4 page format will be used. */
  SetPageInfo(aPageInfo: PAGE_INFO | null): void {
    this.m_pageInfo = aPageInfo;
  }

  /** Initialize the format for the drill map file. */
  SetMapFileFormat(aMapFmt: PLOT_FORMAT): void {
    this.m_mapFileFmt = aMapFmt;
  }

  /** Returns the file extension of the drill writer format. */
  GetDrillFileExt(): string {
    return this.m_drillFileExtension;
  }

  protected getHolesCount(): number {
    return this.m_holeListBuffer.length;
  }

  /**
   * Create the list of holes and tools for a given board.
   *
   * The list is sorted by increasing drill size.   Only holes included within aLayerPair
   * are listed.  If aLayerPair identifies with [F_Cu, B_Cu], then pad holes are always
   * included also.
   */
  protected buildHolesList(aSpan: DRILL_SPAN, aGenerateNPTH_list: boolean): void {
    this.m_holeListBuffer = [];
    this.m_toolListBuffer = [];

    // wxASSERT( aSpan.TopLayer() < aSpan.BottomLayer() );  // fix the caller

    const computeStubLength = (
      aStartLayer: PCB_LAYER_ID,
      aEndLayer: PCB_LAYER_ID,
    ): number | undefined => {
      if (
        aStartLayer === PCB_LAYER_ID.UNDEFINED_LAYER ||
        aEndLayer === PCB_LAYER_ID.UNDEFINED_LAYER
      )
        return undefined;

      const stackup = this.m_pcb.GetDesignSettings().GetStackupDescriptor();
      return stackup.GetLayerDistance(aStartLayer, aEndLayer);
    };

    if (!aGenerateNPTH_list) {
      for (const track of this.m_pcb.Tracks()) {
        if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

        const via = track as PCB_VIA;
        const padstack = via.Padstack();

        if (aSpan.m_IsBackdrill) {
          const tryEmitBackdrill = (aDrill: PADSTACK_DRILL_PROPS): boolean => {
            if (
              aDrill.start === PCB_LAYER_ID.UNDEFINED_LAYER ||
              aDrill.end === PCB_LAYER_ID.UNDEFINED_LAYER
            )
              return false;

            const drillPair: DRILL_LAYER_PAIR = [
              Math.min(aDrill.start, aDrill.end),
              Math.max(aDrill.start, aDrill.end),
            ];

            if (!pairEq(drillPair, aSpan.Pair())) return false;

            if (aDrill.start !== aSpan.DrillStartLayer() || aDrill.end !== aSpan.DrillEndLayer())
              return false;

            if (aDrill.size.x <= 0 && aDrill.size.y <= 0) return false;

            const hole = new HOLE_INFO();
            hole.m_ItemParent = via;
            hole.m_HoleAttribute = HOLE_ATTRIBUTE.HOLE_VIA_BACKDRILL;
            hole.m_Tool_Reference = -1;
            hole.m_Hole_Orient = ANGLE_0;
            hole.m_Hole_NotPlated = true;
            hole.m_Hole_Shape = 0;
            hole.m_Hole_Pos = via.GetStart();
            hole.m_Hole_Top_Layer = aSpan.TopLayer();
            hole.m_Hole_Bottom_Layer = aSpan.BottomLayer();

            let diameter = aDrill.size.x;

            if (aDrill.size.y > 0)
              diameter = diameter > 0 ? Math.min(diameter, aDrill.size.y) : aDrill.size.y;

            hole.m_Hole_Diameter = diameter;
            hole.m_Hole_Size = { ...aDrill.size };

            if (aDrill.shape !== PAD_DRILL_SHAPE.CIRCLE && aDrill.size.x !== aDrill.size.y)
              hole.m_Hole_Shape = 1;

            hole.m_Hole_Filled = aDrill.is_filled ?? false;
            hole.m_Hole_Capped = aDrill.is_capped ?? false;
            hole.m_Hole_Top_Covered = padstack.IsCovered(hole.m_Hole_Top_Layer) ?? false;
            hole.m_Hole_Bot_Covered = padstack.IsCovered(hole.m_Hole_Bottom_Layer) ?? false;
            hole.m_Hole_Top_Plugged = padstack.IsPlugged(hole.m_Hole_Top_Layer) ?? false;
            hole.m_Hole_Bot_Plugged = padstack.IsPlugged(hole.m_Hole_Bottom_Layer) ?? false;
            hole.m_Hole_Top_Tented = padstack.IsTented(hole.m_Hole_Top_Layer) ?? false;
            hole.m_Hole_Bot_Tented = padstack.IsTented(hole.m_Hole_Bottom_Layer) ?? false;
            hole.m_IsBackdrill = true;
            hole.m_DrillStart = aDrill.start;
            hole.m_DrillEnd = aDrill.end;
            hole.m_StubLength = computeStubLength(aDrill.start, aDrill.end);

            this.m_holeListBuffer.push(hole);
            return true;
          };

          // A via may carry two independent backdrill operations (front-side and
          // back-side), stored as secondary and tertiary drill props. Emit whichever
          // one matches this span.
          tryEmitBackdrill(padstack.SecondaryDrill());
          tryEmitBackdrill(padstack.TertiaryDrill());
          continue;
        }

        const hole_sz = via.GetDrillValue();

        if (hole_sz === 0) continue;

        const [top_layer, bottom_layer] = via.LayerPair();

        // Skip vias not starting and ending on current layer pair
        // (layer order has not matter)
        if (
          !pairEq([top_layer, bottom_layer], aSpan.Pair()) &&
          !pairEq([bottom_layer, top_layer], aSpan.Pair())
        )
          continue;

        const new_hole = new HOLE_INFO();
        new_hole.m_ItemParent = via;

        if (pairEq(aSpan.Pair(), THROUGH))
          new_hole.m_HoleAttribute = HOLE_ATTRIBUTE.HOLE_VIA_THROUGH;
        else new_hole.m_HoleAttribute = HOLE_ATTRIBUTE.HOLE_VIA_BURIED;

        const front = padstack.FrontPostMachining();
        const back = padstack.BackPostMachining();

        new_hole.m_Tool_Reference = -1;
        new_hole.m_Hole_Orient = ANGLE_0;
        new_hole.m_Hole_Diameter = hole_sz;
        new_hole.m_Hole_NotPlated = false;
        new_hole.m_Hole_Size = { x: hole_sz, y: hole_sz };
        new_hole.m_Hole_Shape = 0;
        new_hole.m_Hole_Pos = via.GetStart();
        new_hole.m_Hole_Top_Layer = top_layer;
        new_hole.m_Hole_Bottom_Layer = bottom_layer;
        new_hole.m_Hole_Filled = padstack.IsFilled() ?? false;
        new_hole.m_Hole_Capped = padstack.IsCapped() ?? false;
        new_hole.m_Hole_Top_Covered = padstack.IsCovered(top_layer) ?? false;
        new_hole.m_Hole_Bot_Covered = padstack.IsCovered(bottom_layer) ?? false;
        new_hole.m_Hole_Top_Plugged = padstack.IsPlugged(top_layer) ?? false;
        new_hole.m_Hole_Bot_Plugged = padstack.IsPlugged(bottom_layer) ?? false;
        new_hole.m_Hole_Top_Tented = padstack.IsTented(top_layer) ?? false;
        new_hole.m_Hole_Bot_Tented = padstack.IsTented(bottom_layer) ?? false;
        new_hole.m_IsBackdrill = false;
        new_hole.m_FrontPostMachining = front.mode ?? PAD_DRILL_POST_MACHINING_MODE.UNKNOWN;
        new_hole.m_FrontPostMachiningSize = front.size;
        new_hole.m_FrontPostMachiningDepth = front.depth;
        new_hole.m_FrontPostMachiningAngle = front.angle;
        new_hole.m_BackPostMachining = back.mode ?? PAD_DRILL_POST_MACHINING_MODE.UNKNOWN;
        new_hole.m_BackPostMachiningSize = back.size;
        new_hole.m_BackPostMachiningDepth = back.depth;
        new_hole.m_BackPostMachiningAngle = back.angle;
        new_hole.m_DrillStart = padstack.Drill().start;
        new_hole.m_DrillEnd = bottom_layer;

        this.m_holeListBuffer.push(new_hole);
      }
    }

    if (!aSpan.m_IsBackdrill && pairEq(aSpan.Pair(), THROUGH)) {
      for (const footprint of this.m_pcb.Footprints()) {
        for (const pad of footprint.Pads()) {
          if (!this.m_merge_PTH_NPTH) {
            if (!aGenerateNPTH_list && pad.GetAttribute() === PAD_ATTRIB.NPTH) continue;

            if (aGenerateNPTH_list && pad.GetAttribute() !== PAD_ATTRIB.NPTH) continue;
          }

          if (pad.GetDrillSize().x === 0) continue;

          const new_hole = new HOLE_INFO();
          new_hole.m_ItemParent = pad;
          new_hole.m_Hole_NotPlated = pad.GetAttribute() === PAD_ATTRIB.NPTH;

          if (new_hole.m_Hole_NotPlated) new_hole.m_HoleAttribute = HOLE_ATTRIBUTE.HOLE_MECHANICAL;
          else if (pad.GetProperty() === PAD_PROP.CASTELLATED)
            new_hole.m_HoleAttribute = HOLE_ATTRIBUTE.HOLE_PAD_CASTELLATED;
          else if (pad.GetProperty() === PAD_PROP.PRESSFIT)
            new_hole.m_HoleAttribute = HOLE_ATTRIBUTE.HOLE_PAD_PRESSFIT;
          else new_hole.m_HoleAttribute = HOLE_ATTRIBUTE.HOLE_PAD;

          new_hole.m_Tool_Reference = -1;
          new_hole.m_Hole_Orient = pad.GetOrientation();
          new_hole.m_Hole_Shape = 0;
          new_hole.m_Hole_Diameter = Math.min(pad.GetDrillSize().x, pad.GetDrillSize().y);
          new_hole.m_Hole_Size = { x: new_hole.m_Hole_Diameter, y: new_hole.m_Hole_Diameter };

          if (
            pad.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE &&
            pad.GetDrillSizeX() !== pad.GetDrillSizeY()
          )
            new_hole.m_Hole_Shape = 1;

          new_hole.m_Hole_Size = { ...pad.GetDrillSize() };
          new_hole.m_Hole_Pos = pad.GetPosition();
          new_hole.m_Hole_Bottom_Layer = PCB_LAYER_ID.B_Cu;
          new_hole.m_Hole_Top_Layer = PCB_LAYER_ID.F_Cu;
          this.m_holeListBuffer.push(new_hole);
        }
      }
    }

    // Sort holes per increasing diameter value (and for each dimater, by position)
    this.m_holeListBuffer.sort((a, b) =>
      cmpHoleSorting(a, b) ? -1 : cmpHoleSorting(b, a) ? 1 : 0,
    );

    // build the tool list
    let last_hole = -1; // Set to not initialized (this is a value not used
    // for m_holeListBuffer[ii].m_Hole_Diameter)
    let last_notplated_opt = false;
    let last_attribute = HOLE_ATTRIBUTE.HOLE_UNKNOWN;

    for (const hole of this.m_holeListBuffer) {
      if (
        hole.m_Hole_Diameter !== last_hole ||
        hole.m_Hole_NotPlated !== last_notplated_opt ||
        (USE_ATTRIB_FOR_HOLES && hole.m_HoleAttribute !== last_attribute)
      ) {
        // Upstream reuses one `new_tool`, pushed by value; only these three fields
        // are ever assigned on it, so each push is a fresh tool.
        const new_tool = new DRILL_TOOL(hole.m_Hole_Diameter, hole.m_Hole_NotPlated);
        new_tool.m_HoleAttribute = hole.m_HoleAttribute;
        this.m_toolListBuffer.push(new_tool);
        last_hole = new_tool.m_Diameter;
        last_notplated_opt = new_tool.m_Hole_NotPlated;
        last_attribute = new_tool.m_HoleAttribute;
      }

      const jj = this.m_toolListBuffer.length;

      if (jj === 0) continue; // Should not occurs

      hole.m_Tool_Reference = jj; // Tool value Initialized (value >= 1)

      const tool = this.m_toolListBuffer[jj - 1]!;
      tool.m_TotalCount++;

      if (hole.m_Hole_Shape) tool.m_OvalCount++;

      if (hole.m_IsBackdrill) {
        tool.m_IsBackdrill = true;

        if (hole.m_StubLength !== undefined) {
          const stub = hole.m_StubLength;

          if (tool.m_MinStubLength === undefined || stub < tool.m_MinStubLength)
            tool.m_MinStubLength = stub;

          if (tool.m_MaxStubLength === undefined || stub > tool.m_MaxStubLength)
            tool.m_MaxStubLength = stub;
        }
      }

      const machined = (aMode: PAD_DRILL_POST_MACHINING_MODE): boolean =>
        aMode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE ||
        aMode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK;

      if (
        machined(hole.m_FrontPostMachining) ||
        machined(hole.m_BackPostMachining) ||
        hole.m_IsBackdrill
      )
        tool.m_HasPostMachining = true;
    }
  }

  /** Get unique layer pairs by examining the micro and blind_buried vias. */
  protected getUniqueLayerPairs(): DRILL_SPAN[] {
    // `std::set<DRILL_SPAN>`: ordered by operator<, duplicates dropped.
    const unique: DRILL_SPAN[] = [];
    const emplace = (aSpan: DRILL_SPAN): void => {
      let index = 0;

      for (; index < unique.length; index++) {
        const other = unique[index]!;

        if (!other.lt(aSpan) && !aSpan.lt(other)) return;

        if (aSpan.lt(other)) break;
      }

      unique.splice(index, 0, aSpan);
    };

    for (const track of this.m_pcb.Tracks()) {
      if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = track as PCB_VIA;
      const [top_layer, bottom_layer] = via.LayerPair();

      if (!pairEq([top_layer, bottom_layer], THROUGH))
        emplace(new DRILL_SPAN(top_layer, bottom_layer, false, false));

      const addBackdrillSpan = (aDrill: PADSTACK_DRILL_PROPS): void => {
        if (
          aDrill.start === PCB_LAYER_ID.UNDEFINED_LAYER ||
          aDrill.end === PCB_LAYER_ID.UNDEFINED_LAYER
        )
          return;

        if (aDrill.size.x <= 0 && aDrill.size.y <= 0) return;

        emplace(new DRILL_SPAN(aDrill.start, aDrill.end, true, false));
      };

      addBackdrillSpan(via.Padstack().SecondaryDrill());
      addBackdrillSpan(via.Padstack().TertiaryDrill());
    }

    const ret: DRILL_SPAN[] = [new DRILL_SPAN(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, false, false)];

    for (const span of unique) {
      if (span.m_IsBackdrill || !pairEq(span.Pair(), THROUGH)) ret.push(span);
    }

    return ret;
  }

  /** "front" "back" or "in<aLayer>". */
  protected layerName(aLayer: PCB_LAYER_ID): string {
    // Generic names here.
    switch (aLayer) {
      case PCB_LAYER_ID.F_Cu:
        return 'front';
      case PCB_LAYER_ID.B_Cu:
        return 'back';
      default: {
        // aLayer use even values, and the first internal layer (In1) is B_Cu + 2.
        const ly_id = Math.trunc((aLayer - PCB_LAYER_ID.B_Cu) / 2);
        return `in${ly_id}`;
      }
    }
  }

  /** "<layer1Name>-<layer2Name>". */
  protected layerPairName(aPair: DRILL_LAYER_PAIR): string {
    return `${this.layerName(aPair[0])}-${this.layerName(aPair[1])}`;
  }

  /** The board's copper layers in UI order: F_Cu, In1 ... InN, B_Cu. */
  protected copperUIOrder(): PCB_LAYER_ID[] {
    return LSET.AllCuMask(this.m_pcb.GetCopperLayerCount()).UIOrder();
  }

  /**
   * A filename which identify the drill file function: the board name with the layer
   * pair names added, and for separate (PTH and NPTH) files, "-PTH" or "-NPTH" added.
   */
  protected getDrillFileName(aSpan: DRILL_SPAN, aNPTH: boolean, aMerge_PTH_NPTH: boolean): string {
    let extend = '';

    const layerIndex = (aLayer: PCB_LAYER_ID): number => {
      let conventional_layer_num = 1;

      for (const layer of this.copperUIOrder()) {
        if (layer === aLayer) return conventional_layer_num;

        conventional_layer_num++;
      }

      return conventional_layer_num;
    };

    if (aSpan.m_IsBackdrill) {
      extend = `_Backdrills_Drill_${layerIndex(aSpan.DrillStartLayer())}_${layerIndex(aSpan.DrillEndLayer())}`;
    } else if (aNPTH) {
      extend = '-NPTH';
    } else if (pairEq(aSpan.Pair(), THROUGH)) {
      if (!aMerge_PTH_NPTH) extend = '-PTH';
      // if merged, extend with nothing
    } else {
      extend += '-';
      extend += this.layerPairName(aSpan.Pair());
    }

    const fn = splitFileName(this.m_pcb.GetFileName());

    return `${fn.name}${extend}.${this.m_drillFileExtension}`;
  }

  /** A filename which identifies the specific protection feature. */
  protected getProtectionFileName(aSpan: DRILL_SPAN, aFeature: IPC4761_FEATURES): string {
    let extend = '';
    const pair = aSpan.Pair();

    switch (aFeature) {
      case IPC4761_FEATURES.FILLED:
        extend = `-filling-${this.layerPairName(pair)}`;
        break;
      case IPC4761_FEATURES.CAPPED:
        extend = `-capping-${this.layerPairName(pair)}`;
        break;
      case IPC4761_FEATURES.COVERED_BACK:
        extend = `-covering-${this.layerName(pair[1])}`;
        break;
      case IPC4761_FEATURES.COVERED_FRONT:
        extend = `-covering-${this.layerName(pair[0])}`;
        break;
      case IPC4761_FEATURES.PLUGGED_BACK:
        extend = `-plugging-${this.layerName(pair[1])}`;
        break;
      case IPC4761_FEATURES.PLUGGED_FRONT:
        extend = `-plugging-${this.layerName(pair[0])}`;
        break;
      case IPC4761_FEATURES.TENTED_BACK:
        extend = `-tenting-${this.layerName(pair[1])}`;
        break;
      case IPC4761_FEATURES.TENTED_FRONT:
        extend = `-tenting-${this.layerName(pair[0])}`;
        break;
    }

    const fn = splitFileName(this.m_pcb.GetFileName());

    return `${fn.name}${extend}.${this.m_drillFileExtension}`;
  }

  /**
   * Create the full set of map files for the board, in PS, PDF ... format
   * (use SetMapFileFormat() to select the format).
   */
  CreateMapFilesSet(aPlotDirectory: string, aReporter: Reporter | null = null): boolean {
    const hole_sets = this.getUniqueLayerPairs();

    if (!this.m_merge_PTH_NPTH)
      hole_sets.push(new DRILL_SPAN(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, false, true));

    for (const span of hole_sets) {
      const doing_npth = span.m_IsNonPlatedFile;

      this.buildHolesList(span, doing_npth);

      if (this.getHolesCount() > 0 || doing_npth || pairEq(span.Pair(), THROUGH)) {
        // `GENDRILL_WRITER_BASE::getDrillFileName`, qualified: never a derived override.
        const drillName = GENDRILL_WRITER_BASE.prototype.getDrillFileName.call(
          this,
          span,
          doing_npth,
          this.m_merge_PTH_NPTH,
        );
        const base = splitFileName(drillName).name; // Will be added by GenDrillMap
        const fullfilename = `${joinPath(aPlotDirectory, base)}-drl_map.${GetDefaultPlotExtension(this.m_mapFileFmt)}`;

        const success = this.genDrillMapFile(fullfilename, this.m_mapFileFmt);

        if (!success) {
          aReporter?.report(`Failed to create file '${fullfilename}'.`, RPT_SEVERITY_ERROR);

          return false;
        }

        aReporter?.report(`Created file '${fullfilename}'.`, RPT_SEVERITY_ACTION);
      }
    }

    return true;
  }

  /**
   * The .FileFunction attribute:
   * %TF.FileFunction,Plated[NonPlated],layer1num,layer2num,PTH[NPTH][Blind][Buried],
   * Drill[Route][Mixed]*%, or its NC drill form.
   */
  protected BuildFileFunctionAttributeString(
    aSpan: DRILL_SPAN,
    aHoleType: TYPE_FILE,
    aCompatNCdrill = false,
  ): string {
    let text = aCompatNCdrill ? '; #@! ' : '%';

    text += 'TF.FileFunction,';

    if (aSpan.m_IsBackdrill || aHoleType === TYPE_FILE.NPTH_FILE) text += 'NonPlated,';
    else if (aHoleType === TYPE_FILE.MIXED_FILE)
      // only for Excellon format
      text += 'MixedPlating,';
    else text += 'Plated,';

    const copperCount = this.m_pcb.GetCopperLayerCount();
    const gerberNum = (aLayer: number): number => {
      // In Gerber files, layers num are 1 to copper layer count instead of F_Cu to B_Cu
      if (aLayer === PCB_LAYER_ID.F_Cu) return 1;
      if (aLayer === PCB_LAYER_ID.B_Cu) return copperCount;
      return Math.trunc((aLayer - PCB_LAYER_ID.B_Cu) / 2) + 1;
    };

    let layer1 = gerberNum(aSpan.Pair()[0]);
    let layer2 = gerberNum(aSpan.Pair()[1]);

    // Ensure layer order is from top (smaller layer number) to bottom (bigger layer number)
    if (layer1 > layer2) [layer1, layer2] = [layer2, layer1];

    text += `${layer1},${layer2}`;

    // Now add PTH or NPTH or Blind or Buried attribute
    const toplayer = 1;
    const bottomlayer = copperCount;

    if (aSpan.m_IsBackdrill) text += ',Blind';
    else if (aHoleType === TYPE_FILE.NPTH_FILE) text += ',NPTH';
    else if (aHoleType === TYPE_FILE.MIXED_FILE) {
      // only for Excellon format: write nothing
    } else if (layer1 === toplayer && layer2 === bottomlayer) text += ',PTH';
    else if (layer1 === toplayer || layer2 === bottomlayer) text += ',Blind';
    else text += ',Buried';

    // In NC drill file, these previous parameters should be enough:
    if (aCompatNCdrill) return text;

    // Now add Drill or Route or Mixed:
    // file containing only round holes have Drill attribute
    // file containing only oblong holes have Routed attribute
    // file containing both holes have Mixed attribute
    let hasOblong = false;
    let hasDrill = false;

    for (const hole_descr of this.m_holeListBuffer) {
      if (hole_descr.m_Hole_Shape)
        // m_Hole_Shape not 0 is an oblong hole)
        hasOblong = true;
      else hasDrill = true;
    }

    if (hasOblong && hasDrill) text += ',Mixed';
    else if (hasDrill) text += ',Drill';
    else if (hasOblong) text += ',Rout';

    // else: empty file.

    // End of .FileFunction attribute:
    text += '*%';

    return text;
  }

  /**
   * Plot a map of drill marks for holes.
   *
   * Hole list must be created before calling this function, by buildHolesList() for the
   * right holes set.
   */
  protected genDrillMapFile(aFullFileName: string, aFormat: PLOT_FORMAT): boolean {
    let scale = 1.0;
    let offset = { ...this.GetOffset() };
    let plotter: PLOTTER;
    const dummy = new PAGE_INFO(PAGE_SIZE_TYPE.A4, false);
    let bottom_limit = 0; // Y coord limit of page. 0 mean do not use

    const plot_opts = new PCB_PLOT_PARAMS(); // starts plotting with default options

    const page_info = this.m_pageInfo ?? dummy;

    // Calculate dimensions and center of PCB. The Edge_Cuts layer must be visible
    // to calculate the board edges bounding box
    const visibleLayers = this.m_pcb.GetVisibleLayers();
    this.m_pcb.SetVisibleLayers(visibleLayers.or(new LSET([PCB_LAYER_ID.Edge_Cuts])));
    const bbbox = this.m_pcb.GetBoardEdgesBoundingBox();
    this.m_pcb.SetVisibleLayers(visibleLayers);

    // Some formats cannot be used to generate a document like the map files
    // Currently HPGL (old format not very used)
    let format = aFormat;

    if (format === PLOT_FORMAT.HPGL) format = PLOT_FORMAT.PDF;

    const renderSettings = new PCB_RENDER_SETTINGS();
    renderSettings.SetDefaultPenWidth(getDefaultPenSize());

    // Calculate the scale for the format type, scale 1 in HPGL, drawing on
    // an A4 sheet in PS, + text description of symbols
    switch (format) {
      case PLOT_FORMAT.GERBER:
        plotter = new GERBER_PLOTTER();
        (plotter as GERBER_PLOTTER).SetDate(this.now());
        plotter.SetViewport(offset, pcbIUScale.IU_PER_MILS / 10, scale, false);
        plotter.SetGerberCoordinatesFormat(5); // format x.5 unit = mm
        break;

      case PLOT_FORMAT.DXF: {
        const dxf_plotter = new DXF_PLOTTER();

        dxf_plotter.SetUnits(this.m_unitsMetric ? DXF_UNITS.MM : DXF_UNITS.INCH);

        plotter = dxf_plotter;
        plotter.SetPageSettings(page_info);
        plotter.SetViewport(offset, pcbIUScale.IU_PER_MILS / 10, scale, false);
        break;
      }

      default: {
        // PDF, POST, SVG
        const pageSizeIU = page_info.GetSizeIU(pcbIUScale.IU_PER_MILS);

        // Reserve a 10 mm margin around the page.
        const margin = pcbIUScale.mmToIU(10);

        // Calculate a scaling factor to print the board on the sheet
        const Xscale = (pageSizeIU.x - 2 * margin) / bbbox.GetWidth();

        // We should print the list of drill sizes, so reserve room for it
        // 60% height for board 40% height for list
        const ypagesize_for_board = KiROUND(pageSizeIU.y * 0.6);
        const Yscale = (ypagesize_for_board - margin) / bbbox.GetHeight();

        scale = Math.min(Xscale, Yscale);

        // Experience shows the scale should not to large, because texts
        // create problem (can be to big or too small).
        // So the scale is clipped at 3.0;
        scale = Math.min(scale, 3.0);

        offset = {
          x: KiROUND(bbbox.Centre().x - pageSizeIU.x / 2.0 / scale),
          y: KiROUND(bbbox.Centre().y - ypagesize_for_board / 2.0 / scale),
        };

        // bottom_limit is used to plot the legend (drill diameters)
        // texts are scaled differently for scale > 1.0 and <= 1.0
        // so the limit is scaled differently.
        bottom_limit = Math.trunc((pageSizeIU.y - margin) / Math.min(scale, 1.0));

        if (format === PLOT_FORMAT.SVG) plotter = new SVG_PLOTTER(renderSettings);
        else if (format === PLOT_FORMAT.PDF)
          plotter = new PDF_PLOTTER(renderSettings as never, this.m_pdfDeflate ?? ((b) => b), {
            debugPdfWriter: this.m_pdfDeflate === null,
          });
        else plotter = new PS_PLOTTER(renderSettings);

        plotter.SetPageSettings(page_info);
        plotter.SetViewport(offset, pcbIUScale.IU_PER_MILS / 10, scale, false);
        break;
      }
    }

    plotter.SetCreator('PCBNEW');
    plotter.SetColorMode(false);

    plotter.SetRenderSettings(renderSettings);

    if (!plotter.OpenFile(aFullFileName)) return false;

    plotter.ClearHeaderLinesList();

    // For the Gerber X2 format we need to set the  "FileFunction" to Drillmap
    // and set a few other options.
    if (plotter.GetPlotterType() === PLOT_FORMAT.GERBER) {
      const gbrplotter = plotter as GERBER_PLOTTER;
      gbrplotter.DisableApertMacros(false);
      gbrplotter.UseX2format(true); // Mandatory
      gbrplotter.UseX2NetAttributes(false); // net attributes have no meaning here

      // Attributes are added using X2 format
      AddGerberX2Header(gbrplotter, this.m_pcb, false, this.now());

      // Add the TF.FileFunction
      gbrplotter.AddLineToHeader('%TF.FileFunction,Drillmap*%');

      // Add the TF.FilePolarity
      gbrplotter.AddLineToHeader('%TF.FilePolarity,Positive*%');
    }

    plotter.StartPlot('1');

    // Draw items on edge layer.
    // Not all, only items useful for drill map, i.e. board outlines.
    const itemplotter = new BRDITEMS_PLOTTER(plotter, this.m_pcb, plot_opts);

    // Use attributes of a drawing layer (we are not really draw the Edge.Cuts layer)
    itemplotter.SetLayerSet(new LSET([PCB_LAYER_ID.Dwgs_User]));

    const plotEdge = (item: BOARD_ITEM): void => {
      if (item.GetLayer() !== PCB_LAYER_ID.Edge_Cuts) return;

      if (item.Type() === KICAD_T.PCB_SHAPE_T) {
        const dummy_shape = PCB_SHAPE.copyOf(item as PCB_SHAPE);
        dummy_shape.SetLayer(PCB_LAYER_ID.Dwgs_User);
        dummy_shape.SetParentGroup(null); // Remove group association, not needed for plotting
        itemplotter.PlotShape(dummy_shape);
      }
    };

    for (const item of this.m_pcb.Drawings()) plotEdge(item);

    // Plot edge cuts in footprints
    for (const footprint of this.m_pcb.Footprints())
      for (const item of footprint.GraphicalItems()) plotEdge(item);

    let intervalle = 0;
    const textmarginaftersymbol = pcbIUScale.mmToIU(2);

    // Set Drill Symbols width
    plotter.SetCurrentLineWidth(-1);

    // Plot board outlines and drill map
    this.plotDrillMarks(plotter);

    // Print a list of symbols used.
    const charSize = pcbIUScale.mmToIU(2); // text size in IUs

    // real char scale will be 1/scale, because the global plot scale is scale
    // for scale < 1.0 ( plot bigger actual size)
    // Therefore charScale = 1.0 / scale keep the initial charSize
    // (for scale < 1 we use the global scaling factor: the board must be plotted
    // smaller than the actual size)
    const charScale = Math.min(1.0, 1.0 / scale);

    const TextWidth = KiROUND((charSize * charScale) / 10.0); // Set text width (thickness)
    intervalle = KiROUND(charSize * charScale) + TextWidth;

    // Trace information.
    let plotX = KiROUND(bbbox.GetX() + textmarginaftersymbol * charScale);
    let plotY = bbbox.GetBottom() + intervalle;

    // Plot title  "Info"
    const attrs = new TEXT_ATTRIBUTES();
    attrs.m_StrokeWidth = TextWidth;
    attrs.m_Angle = ANGLE_HORIZONTAL;
    attrs.m_Size = { x: KiROUND(charSize * charScale), y: KiROUND(charSize * charScale) };
    attrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
    attrs.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
    attrs.m_Multiline = false;

    // nullptr /* stroke font */, KIFONT::METRICS::Default()
    const strokeFont = plotterFont(FONT.GetFont(), METRICS.Default());

    plotter.PlotText(
      { x: plotX, y: plotY },
      COLOR4D_UNSPECIFIED,
      'Drill Map:',
      attrs,
      strokeFont,
      METRICS.Default(),
    );

    // For some formats (PS, PDF SVG) we plot the drill size list on more than one column
    // because the list must be contained inside the printed page
    // (others formats do not have a defined page size)
    let max_line_len = 0; // The max line len in iu of the currently plotted column

    for (let ii = 0; ii < this.m_toolListBuffer.length; ii++) {
      const tool = this.m_toolListBuffer[ii]!;

      if (tool.m_TotalCount === 0) continue;

      plotY += intervalle;

      // Ensure there are room to plot the line
      if (bottom_limit && plotY + intervalle > bottom_limit) {
        plotY = bbbox.GetBottom() + intervalle;
        plotX += max_line_len + pcbIUScale.mmToIU(10); //column_width;
        max_line_len = 0;
      }

      let plot_diam = KiROUND(tool.m_Diameter);

      // For markers plotted with the comment, keep marker size <= text height
      plot_diam = Math.min(plot_diam, KiROUND(charSize * charScale));
      const x = KiROUND(plotX - textmarginaftersymbol * charScale - plot_diam / 2.0);
      const y = KiROUND(plotY + charSize * charScale);

      plotter.SetCurrentLineWidth(getMarkerBestPenSize(plot_diam));
      plotter.Marker({ x, y }, plot_diam, ii);
      plotter.SetCurrentLineWidth(-1);

      // List the diameter of each drill in mm and inches.
      let msg = `${fixed(diameter_in_mm(tool.m_Diameter), 3)}mm / ${fixed(diameter_in_inches(tool.m_Diameter), 4)}" `;
      let extraInfo = '';

      if (tool.m_HoleAttribute === HOLE_ATTRIBUTE.HOLE_PAD_CASTELLATED)
        extraInfo += ', castellated';
      else if (tool.m_HoleAttribute === HOLE_ATTRIBUTE.HOLE_PAD_PRESSFIT)
        extraInfo += ', press-fit';

      if (tool.m_IsBackdrill) {
        if (tool.m_MinStubLength !== undefined) {
          const minStub = pcbIUScale.iuToMM(tool.m_MinStubLength);

          if (tool.m_MaxStubLength !== undefined && tool.m_MaxStubLength !== tool.m_MinStubLength) {
            const maxStub = pcbIUScale.iuToMM(tool.m_MaxStubLength);
            extraInfo += `, backdrill stub ${fixed(minStub, 3)}-${fixed(maxStub, 3)}mm`;
          } else {
            extraInfo += `, backdrill stub ${fixed(minStub, 3)}mm`;
          }
        } else {
          extraInfo += ', backdrill';
        }
      }

      if (tool.m_HasPostMachining) extraInfo += ', post-machined';

      let counts: string;

      if (tool.m_TotalCount === 1 && tool.m_OvalCount === 0) counts = `(1 hole${extraInfo})`;
      else if (tool.m_TotalCount === 1) counts = `(1 slot${extraInfo})`;
      else if (tool.m_OvalCount === 0) counts = `(${tool.m_TotalCount} holes${extraInfo})`;
      else if (tool.m_OvalCount === 1)
        counts = `(${tool.m_TotalCount - 1} holes + 1 slot${extraInfo})`;
      else
        counts = `(${tool.m_TotalCount - tool.m_OvalCount} holes + ${tool.m_OvalCount} slots${extraInfo})`;

      msg += counts;

      if (tool.m_Hole_NotPlated) msg += ' (not plated)';

      plotter.PlotText(
        { x: plotX, y },
        COLOR4D_UNSPECIFIED,
        msg,
        attrs,
        strokeFont,
        METRICS.Default(),
      );

      intervalle = KiROUND((charSize * charScale + TextWidth) * 1.2);

      if (intervalle < plot_diam + (1 * pcbIUScale.IU_PER_MM) / scale + TextWidth)
        intervalle = Math.trunc(plot_diam + (1 * pcbIUScale.IU_PER_MM) / scale + TextWidth);

      // Evaluate the text horizontal size, to know the maximal column size
      // This is a rough value, but ok to create a new column to plot next texts
      const text_len = Math.trunc(msg.length * (charSize * charScale + TextWidth));
      max_line_len = Math.max(max_line_len, text_len + plot_diam);
    }

    plotter.EndPlot();

    const bytes = (plotter as unknown as { bytes(): Uint8Array }).bytes();
    this.m_fileSink(aFullFileName, bytes);

    return true;
  }

  /**
   * Create a plain text report file giving a list of drill values and drill count for through
   * holes, oblong holes, and for buried vias, drill values and drill count per layer pair.
   */
  GenDrillReportFile(aFullFileName: string, _aReporter: Reporter | null = null): boolean {
    let out = '';

    const separator = '    =============================================================\n';

    let totalHoleCount: number;
    const brdFilename = splitFileName(this.m_pcb.GetFileName());

    const hole_sets = this.getUniqueLayerPairs();

    out += `Drill report for ${brdFilename.fullName}\n`;
    out += `Created on ${iso8601DateTime(this.now())}\n\n`;

    // Output the cu layer stackup, so layer name references make sense.
    out += 'Copper Layer Stackup:\n';
    out += separator;

    let conventional_layer_num = 1;

    for (const layer of this.copperUIOrder()) {
      out += `    L${String(conventional_layer_num++).padEnd(2)}:  ${this.m_pcb.GetLayerName(layer).padEnd(25)} ${this.layerName(layer)}\n`;
    }

    out += '\n\n';

    /* output hole lists:
     * 1 - through holes
     * 2 - for partial holes only: by layer starting and ending pair
     * 3 - Non Plated through holes
     */

    let buildNPTHlist = false; // First pass: build PTH list only

    // in this loop are plated only:
    for (const span of hole_sets) {
      this.buildHolesList(span, buildNPTHlist);

      out += `Drill file '${this.getDrillFileName(span, false, this.m_merge_PTH_NPTH)}' contains\n`;

      if (pairEq(span.Pair(), THROUGH) && !span.m_IsBackdrill) {
        out += '    plated through holes:\n';
        out += separator;
        const summary = this.printToolSummary(false);
        out += summary.text;
        totalHoleCount = summary.count;
        out += `    Total plated holes count ${totalHoleCount}\n`;
      } else if (span.m_IsBackdrill) {
        out += `    backdrill span: '${this.m_pcb.GetLayerName(span.DrillStartLayer())}' to '${this.m_pcb.GetLayerName(span.DrillEndLayer())}':\n`;
        out += separator;
        const summary = this.printToolSummary(false);
        out += summary.text;
        totalHoleCount = summary.count;
        out += `    Total backdrilled holes count ${totalHoleCount}\n`;
      } else {
        const pair = span.Pair();
        out += `    holes connecting layer pair: '${this.m_pcb.GetLayerName(pair[0])} and ${this.m_pcb.GetLayerName(pair[1])}' (${pair[0] === PCB_LAYER_ID.F_Cu || pair[1] === PCB_LAYER_ID.B_Cu ? 'blind' : 'buried'} vias):\n`;
        out += separator;
        const summary = this.printToolSummary(false);
        out += summary.text;
        totalHoleCount = summary.count;
        out += `    Total plated holes count ${totalHoleCount}\n`;
      }

      out += '\n\n';
    }

    // NPTHoles. Generate the full list (pads+vias) if PTH and NPTH are merged,
    // or only the NPTH list (which never has vias)
    if (!this.m_merge_PTH_NPTH) buildNPTHlist = true;

    const npthSpan = new DRILL_SPAN(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, false, buildNPTHlist);

    this.buildHolesList(npthSpan, buildNPTHlist);

    // nothing wrong with an empty NPTH file in report.
    if (this.m_merge_PTH_NPTH) out += 'Not plated through holes are merged with plated holes\n';
    else
      out += `Drill file '${this.getDrillFileName(npthSpan, true, this.m_merge_PTH_NPTH)}' contains\n`;

    out += '    unplated through holes:\n';
    out += separator;
    const summary = this.printToolSummary(true);
    out += summary.text;
    totalHoleCount = summary.count;
    out += `    Total unplated holes count ${totalHoleCount}\n`;

    this.writeFile(aFullFileName, out);

    return true;
  }

  /**
   * Write the drill marks in PDF, POSTSCRIPT or other supported formats.
   *
   * Each hole size has a symbol (circle, cross X, cross + ...) up to PLOTTER::MARKER_COUNT
   * different values.  If more than PLOTTER::MARKER_COUNT different values, these other
   * values share the same mark shape.
   */
  protected plotDrillMarks(aPlotter: PLOTTER): boolean {
    // Plot the drill map:
    for (const hole of this.m_holeListBuffer) {
      // Gives a good line thickness to have a good marker shape:
      aPlotter.SetCurrentLineWidth(getMarkerBestPenSize(hole.m_Hole_Diameter));

      // Always plot the drill symbol (for slots identifies the needed cutter!
      aPlotter.Marker(hole.m_Hole_Pos, hole.m_Hole_Diameter, hole.m_Tool_Reference - 1);

      if (hole.m_Hole_Shape !== 0) {
        aPlotter.ThickOval(
          hole.m_Hole_Pos,
          hole.m_Hole_Size,
          hole.m_Hole_Orient,
          getSketchOvalBestPenSize(),
          null,
        );
      }
    }

    aPlotter.SetCurrentLineWidth(USE_DEFAULT_LINE_WIDTH);

    return true;
  }

  /** Print m_toolListBuffer[] tools and return the total hole count. */
  protected printToolSummary(aSummaryNPTH: boolean): { text: string; count: number } {
    let out = '';
    let totalHoleCount = 0;

    for (let ii = 0; ii < this.m_toolListBuffer.length; ii++) {
      const tool = this.m_toolListBuffer[ii]!;

      if (aSummaryNPTH && !tool.m_Hole_NotPlated) continue;

      if (!aSummaryNPTH && tool.m_Hole_NotPlated) continue;

      // List the tool number assigned to each drill in mm then in inches.
      const tool_number = ii + 1;
      out += `    T${tool_number}  ${fixed(diameter_in_mm(tool.m_Diameter), 3).padStart(2)}mm  ${fixed(diameter_in_inches(tool.m_Diameter), 4).padStart(2)}"  `;

      // Now list how many holes and ovals are associated with each drill.
      if (tool.m_TotalCount === 1 && tool.m_OvalCount === 0) out += '(1 hole';
      else if (tool.m_TotalCount === 1) out += '(1 hole)  (with 1 slot';
      else if (tool.m_OvalCount === 0) out += `(${tool.m_TotalCount} holes)`;
      else if (tool.m_OvalCount === 1) out += `(${tool.m_TotalCount} holes)  (with 1 slot`;
      // tool.m_OvalCount > 1
      else out += `(${tool.m_TotalCount} holes)  (with ${tool.m_OvalCount} slots`;

      if (tool.m_HoleAttribute === HOLE_ATTRIBUTE.HOLE_PAD_CASTELLATED) out += ', castellated';

      if (tool.m_HoleAttribute === HOLE_ATTRIBUTE.HOLE_PAD_PRESSFIT) out += ', press-fit';

      out += ')\n';

      totalHoleCount += tool.m_TotalCount;
    }

    out += '\n';

    return { text: out, count: totalHoleCount };
  }
}
