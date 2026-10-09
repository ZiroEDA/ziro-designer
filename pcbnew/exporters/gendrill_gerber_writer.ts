// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GERBER_WRITER (`pcbnew/exporters/gendrill_gerber_writer.cpp`): drill files
 * in Gerber X2 format, one per drill span, plus the IPC-4761 via-protection
 * files. The files go through the base class's sink, as the Excellon
 * writer's do.
 */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GBR_APERTURE_ATTRIB, GBR_METADATA } from '@ziroeda/common/gbr_metadata.js';
import { GBR_NETINFO_TYPE } from '@ziroeda/common/gbr_netlist_metadata.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { GERBER_PLOTTER } from '@ziroeda/common/plotters/GERBER_plotter.js';
import {
  type Reporter,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
} from '@ziroeda/common/reporter.js';
import { ANGLE_90, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../board.js';
import { PAD, PAD_PROP } from '../pad.js';
import { AddGerberX2Header } from '../pcbplot.js';
import { PCB_VIA } from '../pcb_track.js';
import {
  type DRILL_LAYER_PAIR,
  DRILL_SPAN,
  GENDRILL_WRITER_BASE,
  IPC4761_FEATURES,
  joinPath,
  splitFileName,
  TYPE_FILE,
  ZEROS_FMT,
} from './gendrill_writer_base.js';

// set to 1 to use flashed oblong holes, 0 to draw them by a line (route holes).
// WARNING: currently ( gerber-layer-format-specification-revision-2023-08 ),
// oblong holes **must be routed* in a drill file and not flashed,
// so set FLASH_OVAL_HOLE to 0
const FLASH_OVAL_HOLE = false;

export class GERBER_WRITER extends GENDRILL_WRITER_BASE {
  constructor(aPcb: BOARD) {
    super(aPcb);
    this.m_zeroFormat = ZEROS_FMT.SUPPRESS_LEADING;
    this.m_conversionUnits = 1.0;
    this.m_unitsMetric = true;
    this.m_drillFileExtension = 'gbr';
    this.m_merge_PTH_NPTH = false;
  }

  /**
   * Initialize internal parameters to match the given format.
   *
   * @param aRightDigits is the number of digits for mantissa part of coordinates (5 or 6).
   */
  SetFormat(aRightDigits = 6): void {
    /* Set conversion scale depending on drill file units */
    this.m_conversionUnits = 1.0 / pcbIUScale.IU_PER_MM; // Gerber units = mm

    // Set precision (unit is mm).
    this.m_precision.m_Lhs = 4;
    this.m_precision.m_Rhs = aRightDigits === 6 ? 6 : 5;
  }

  /** Initialize internal parameters to match drill options. */
  SetOptions(aOffset: VECTOR2I): void {
    this.m_offset = aOffset;
    this.m_merge_PTH_NPTH = false;
  }

  /**
   * Create the full set of Excellon drill file for the board filenames are computed from
   * the board name, and layers id.
   *
   * @param aPlotDirectory is the output folder.
   * @param aGenDrill set to true to generate the EXCELLON drill file.
   * @param aGenMap set to true to generate a drill map file.
   * @param aGenTenting set to true to generate the tenting files.
   * @param aReporter is a REPORTER to return activity or any message (can be nullptr).
   * @return true if OK, false if a file cannot be created.
   */
  CreateDrillandMapFilesSet(
    aPlotDirectory: string,
    aGenDrill: boolean,
    aGenMap: boolean,
    aGenTenting: boolean,
    aReporter: Reporter | null = null,
  ): boolean {
    let success = true;
    // Note: In Gerber drill files, NPTH and PTH are always separate files
    this.m_merge_PTH_NPTH = false;

    const hole_sets = this.getUniqueLayerPairs();

    hole_sets.push(new DRILL_SPAN(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, false, true));

    for (const span of hole_sets) {
      const doing_npth = span.m_IsNonPlatedFile;

      this.buildHolesList(span, doing_npth);

      // The file is created if it has holes, or if it is the non plated drill file
      // to be sure the NPTH file is up to date in separate files mode.
      if (this.getHolesCount() === 0) continue;

      let fullFilename = joinPath(
        aPlotDirectory,
        this.getDrillFileName(span, doing_npth, this.m_merge_PTH_NPTH),
      );

      if (aGenDrill) {
        const isNonPlated = doing_npth || span.m_IsBackdrill;
        let wroteDrillFile = false;

        const result = this.createDrillFile(fullFilename, isNonPlated, span);

        if (result < 0) {
          aReporter?.report(`Failed to create file '${fullFilename}'.`, RPT_SEVERITY_ERROR);
          success = false;
          break;
        }

        wroteDrillFile = true;

        aReporter?.report(`Created file '${fullFilename}'.`, RPT_SEVERITY_ACTION);

        if (wroteDrillFile && span.m_IsBackdrill) {
          if (!this.writeBackdrillLayerPairFile(aPlotDirectory, aReporter, span)) {
            success = false;
            break;
          }
        }
      }

      if (doing_npth) continue;

      for (const feature of [
        IPC4761_FEATURES.FILLED,
        IPC4761_FEATURES.CAPPED,
        IPC4761_FEATURES.COVERED_BACK,
        IPC4761_FEATURES.COVERED_FRONT,
        IPC4761_FEATURES.PLUGGED_BACK,
        IPC4761_FEATURES.PLUGGED_FRONT,
        IPC4761_FEATURES.TENTED_BACK,
        IPC4761_FEATURES.TENTED_FRONT,
      ]) {
        if (!aGenTenting) {
          if (
            feature === IPC4761_FEATURES.TENTED_BACK ||
            feature === IPC4761_FEATURES.TENTED_FRONT
          ) {
            continue;
          }
        }

        if (!this.hasViaType(feature)) continue;

        fullFilename = joinPath(aPlotDirectory, this.getProtectionFileName(span, feature));

        if (this.createProtectionFile(fullFilename, feature, span.Pair()) < 0) {
          if (aReporter) {
            aReporter.report(`Failed to create file '${fullFilename}'.`, RPT_SEVERITY_ERROR);
            success = false;
          }
        } else {
          aReporter?.report(`Created file '${fullFilename}'.`, RPT_SEVERITY_ACTION);
        }
      }
    }

    if (aGenMap) success = this.CreateMapFilesSet(aPlotDirectory, aReporter) && success;

    aReporter?.reportTail('Done.', RPT_SEVERITY_INFO);

    return success;
  }

  /**
   * The plotter every file of this writer starts from: X2, the standard
   * header without FileFunction, mm at the writer's precision.
   */
  private newPlotter(): GERBER_PLOTTER {
    const plotter = new GERBER_PLOTTER();

    // Gerber drill file imply X2 format:
    plotter.UseX2format(true);
    plotter.UseX2NetAttributes(true);
    plotter.DisableApertMacros(false);
    plotter.SetDate(this.now());

    // Add the standard X2 header, without FileFunction
    AddGerberX2Header(plotter, this.m_pcb, false, this.now());
    plotter.SetViewport(
      this.m_offset,
      pcbIUScale.IU_PER_MILS / 10,
      /* scale */ 1.0,
      /* mirror */ false,
    );

    // has meaning only for gerber plotter. Must be called only after SetViewport
    plotter.SetGerberCoordinatesFormat(this.m_precision.m_Rhs);
    plotter.SetCreator('PCBNEW');

    return plotter;
  }

  /**
   * Create a Gerber X2 file for via protection features (IPC-4761).
   *
   * @return hole count, or -1 if the file cannot be created.
   */
  private createProtectionFile(
    aFullFilename: string,
    aFeature: IPC4761_FEATURES,
    _aLayerPair: DRILL_LAYER_PAIR,
  ): number {
    const plotter = this.newPlotter();

    // Add the standard X2 FileFunction for drill files
    // %TF.FileFunction,Plated[NonPlated],layer1num,layer2num,PTH[NPTH][Blind][Buried],Drill[Rout][Mixed]*%
    let text = '%TF,FileFunction,Other,';
    let attrib: string;

    switch (aFeature) {
      case IPC4761_FEATURES.CAPPED:
        text += 'Capping';
        attrib = 'Capping';
        break;
      case IPC4761_FEATURES.FILLED:
        text += 'Filling';
        attrib = 'Filling';
        break;
      case IPC4761_FEATURES.COVERED_BACK:
        text += 'Covering-Back';
        attrib = 'Covering';
        break;
      case IPC4761_FEATURES.COVERED_FRONT:
        text += 'Covering-Front';
        attrib = 'Covering';
        break;
      case IPC4761_FEATURES.PLUGGED_BACK:
        text += 'Plugging-Back';
        attrib = 'Plugging';
        break;
      case IPC4761_FEATURES.PLUGGED_FRONT:
        text += 'Plugging-Front';
        attrib = 'Plugging';
        break;
      case IPC4761_FEATURES.TENTED_BACK:
        text += 'Tenting-Back';
        attrib = 'Tenting';
        break;
      case IPC4761_FEATURES.TENTED_FRONT:
        text += 'Tenting-Front';
        attrib = 'Tenting';
        break;
      default:
        return -1;
    }

    text += '*%';
    plotter.AddLineToHeader(text);

    // Add file polarity (positive)
    text = '%TF.FilePolarity,Positive*%';
    plotter.AddLineToHeader(text);

    if (!plotter.OpenFile(aFullFilename)) return -1;

    plotter.StartPlot('1');

    let holes_count = 0;

    for (const hole_descr of this.m_holeListBuffer) {
      if (!(hole_descr.m_ItemParent instanceof PCB_VIA)) continue;

      const via = hole_descr.m_ItemParent;
      let cont = false;
      let diameter = hole_descr.m_Hole_Diameter;

      switch (aFeature) {
        case IPC4761_FEATURES.FILLED:
          cont = !hole_descr.m_Hole_Filled;
          break;
        case IPC4761_FEATURES.CAPPED:
          cont = !hole_descr.m_Hole_Capped;
          break;
        case IPC4761_FEATURES.COVERED_BACK:
          cont = !hole_descr.m_Hole_Bot_Covered;
          diameter = via.GetWidth(via.BottomLayer());
          break;
        case IPC4761_FEATURES.COVERED_FRONT:
          cont = !hole_descr.m_Hole_Top_Covered;
          diameter = via.GetWidth(via.TopLayer());
          break;
        case IPC4761_FEATURES.PLUGGED_BACK:
          cont = !hole_descr.m_Hole_Bot_Plugged;
          break;
        case IPC4761_FEATURES.PLUGGED_FRONT:
          cont = !hole_descr.m_Hole_Top_Plugged;
          break;
        case IPC4761_FEATURES.TENTED_BACK:
          cont = !hole_descr.m_Hole_Bot_Tented;
          diameter = via.GetWidth(via.BottomLayer());
          break;
        case IPC4761_FEATURES.TENTED_FRONT:
          cont = !hole_descr.m_Hole_Top_Tented;
          diameter = via.GetWidth(via.TopLayer());
          break;
      }

      if (cont) continue;

      const gbr_metadata = new GBR_METADATA();

      gbr_metadata.SetApertureAttrib(attrib);

      plotter.FlashPadCircle(hole_descr.m_Hole_Pos, diameter, gbr_metadata);

      holes_count++;
    }

    plotter.EndPlot();
    this.m_fileSink(aFullFilename, plotter.bytes());

    return holes_count;
  }

  /**
   * Create an Excellon drill file.
   *
   * @param aFullFilename is the full filename.
   * @param aIsNpth set to true for a NPTH file or false for a PTH file.
   * @param aSpan is the drill span (layer pair) to output.
   * @return hole count, or -1 if the file cannot be created.
   */
  private createDrillFile(aFullFilename: string, aIsNpth: boolean, aSpan: DRILL_SPAN): number {
    const plotter = this.newPlotter();

    // Add the standard X2 FileFunction for drill files
    // %TF.FileFunction,Plated[NonPlated],layer1num,layer2num,PTH[NPTH][Blind][Buried],Drill[Rout][Mixed]*%
    let text = this.BuildFileFunctionAttributeString(
      aSpan,
      aIsNpth ? TYPE_FILE.NPTH_FILE : TYPE_FILE.PTH_FILE,
    );
    plotter.AddLineToHeader(text);

    // Add file polarity (positive)
    text = '%TF.FilePolarity,Positive*%';
    plotter.AddLineToHeader(text);

    if (!plotter.OpenFile(aFullFilename)) return -1;

    plotter.StartPlot('1');

    let holes_count = 0;

    let last_item_is_via = true; // a flag to clear object attributes when a via hole is created.

    for (const hole_descr of this.m_holeListBuffer) {
      const hole_pos = hole_descr.m_Hole_Pos;

      // Manage the aperture attributes: in drill files 3 attributes can be used:
      // "ViaDrill", only for vias, not pads
      // "ComponentDrill", only for Through Holes pads
      // "Slot" for oblong holes;
      const gbr_metadata = new GBR_METADATA();

      if (hole_descr.m_ItemParent instanceof PCB_VIA) {
        if (hole_descr.m_IsBackdrill)
          gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_BACKDRILL);
        else gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_VIADRILL);

        if (!last_item_is_via) {
          // be sure the current object attribute is cleared for vias
          plotter.EndBlock(null);
        }

        last_item_is_via = true;
      } else if (hole_descr.m_ItemParent instanceof PAD) {
        last_item_is_via = false;
        const pad = hole_descr.m_ItemParent;

        if (pad.GetProperty() === PAD_PROP.CASTELLATED) {
          gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CASTELLATEDDRILL);
        } else if (pad.GetProperty() === PAD_PROP.PRESSFIT) {
          gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_PRESSFITDRILL);
        } else {
          // Good practice of oblong pad holes (slots) is to use a specific aperture for
          // routing, not used in drill commands.
          if (hole_descr.m_Hole_Shape) {
            gbr_metadata.SetApertureAttrib(
              GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_OBLONG_DRILL,
            );
          } else {
            gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_DRILL);
          }
        }

        // Add object attribute: component reference to pads (mainly useful for users)
        const ref = pad.GetParentFootprint()!.GetReference();

        gbr_metadata.SetCmpReference(ref);
        gbr_metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_CMP);
      }

      if (hole_descr.m_Hole_Shape) {
        if (FLASH_OVAL_HOLE) {
          // set to 1 to use flashed oblong holes, 0 to draw them as a line.
          plotter.FlashPadOval(
            hole_pos,
            hole_descr.m_Hole_Size,
            hole_descr.m_Hole_Orient,
            gbr_metadata,
          );
        } else {
          // Use routing for oblong hole (Slots)
          const { start, end } = convertOblong2Segment(
            hole_descr.m_Hole_Size,
            hole_descr.m_Hole_Orient,
          );
          const width = Math.min(hole_descr.m_Hole_Size.x, hole_descr.m_Hole_Size.y);

          if (width === 0) continue;

          plotter.ThickSegment(
            { x: start.x + hole_pos.x, y: start.y + hole_pos.y },
            { x: end.x + hole_pos.x, y: end.y + hole_pos.y },
            width,
            gbr_metadata,
          );
        }
      } else {
        const diam = Math.min(hole_descr.m_Hole_Size.x, hole_descr.m_Hole_Size.y);
        plotter.FlashPadCircle(hole_pos, diam, gbr_metadata);
      }

      holes_count++;
    }

    plotter.EndPlot();
    this.m_fileSink(aFullFilename, plotter.bytes());

    return holes_count;
  }

  /**
   * @param aSpan is the drill span (layer pair) to manage.
   * @param aNPTH is true when generating NPTH drill file.
   * @param aMerge_PTH_NPTH is true when generating a merged PTH and NPTH drill file.
   * @return a filename which identify the drill file function.
   */
  protected override getDrillFileName(
    aSpan: DRILL_SPAN,
    aNPTH: boolean,
    aMerge_PTH_NPTH: boolean,
  ): string {
    // Gerber files extension is always .gbr.
    // Therefore, to mark drill files, add "-drl" to the filename.
    const fname = splitFileName(super.getDrillFileName(aSpan, aNPTH, aMerge_PTH_NPTH));

    return joinPath(fname.dir, `${fname.name}-drl.${this.m_drillFileExtension}`);
  }

  /** @return true if the hole list buffer has a via with the given protection feature. */
  private hasViaType(aFeature: IPC4761_FEATURES): boolean {
    for (const hole_descr of this.m_holeListBuffer) {
      if (!(hole_descr.m_ItemParent instanceof PCB_VIA)) continue;

      switch (aFeature) {
        case IPC4761_FEATURES.FILLED:
          if (hole_descr.m_Hole_Filled) return true;
          break;
        case IPC4761_FEATURES.CAPPED:
          if (hole_descr.m_Hole_Capped) return true;
          break;
        case IPC4761_FEATURES.COVERED_BACK:
          if (hole_descr.m_Hole_Bot_Covered) return true;
          break;
        case IPC4761_FEATURES.COVERED_FRONT:
          if (hole_descr.m_Hole_Top_Covered) return true;
          break;
        case IPC4761_FEATURES.PLUGGED_BACK:
          if (hole_descr.m_Hole_Bot_Plugged) return true;
          break;
        case IPC4761_FEATURES.PLUGGED_FRONT:
          if (hole_descr.m_Hole_Top_Plugged) return true;
          break;
        case IPC4761_FEATURES.TENTED_BACK:
          if (hole_descr.m_Hole_Bot_Tented) return true;
          break;
        case IPC4761_FEATURES.TENTED_FRONT:
          if (hole_descr.m_Hole_Top_Tented) return true;
          break;
      }
    }

    return false;
  }

  private getBackdrillLayerPairFileName(aSpan: DRILL_SPAN): string {
    const fn = splitFileName(this.m_pcb.GetFileName());
    const pairName = this.layerPairName(aSpan.Pair());

    return `${fn.name}-${pairName}-backdrill-drl.${this.m_drillFileExtension}`;
  }

  private writeBackdrillLayerPairFile(
    aPlotDirectory: string,
    aReporter: Reporter | null,
    aSpan: DRILL_SPAN,
  ): boolean {
    const fullFilename = joinPath(aPlotDirectory, this.getBackdrillLayerPairFileName(aSpan));

    if (this.createDrillFile(fullFilename, true, aSpan) < 0) {
      aReporter?.report(`Failed to create file '${fullFilename}'.`, RPT_SEVERITY_ERROR);

      return false;
    }

    aReporter?.report(`Created file '${fullFilename}'.`, RPT_SEVERITY_ACTION);

    return true;
  }
}

/** A helper to transform an oblong hole to a segment. */
function convertOblong2Segment(
  aSize: VECTOR2I,
  aOrient: EDA_ANGLE,
): { start: VECTOR2I; end: VECTOR2I } {
  const size = { ...aSize };
  let orient = aOrient;

  /* The pad will be drawn as an oblong shape with size.y > size.x
   * (Oval vertical orientation 0)
   */
  if (size.x > size.y) {
    [size.x, size.y] = [size.y, size.x];
    orient = orient.add(ANGLE_90);
  }

  const deltaxy = size.y - size.x; // distance between centers of the oval

  return {
    start: RotatePoint({ x: 0, y: Math.trunc(deltaxy / 2) }, orient),
    end: RotatePoint({ x: 0, y: -Math.trunc(deltaxy / 2) }, orient),
  };
}
