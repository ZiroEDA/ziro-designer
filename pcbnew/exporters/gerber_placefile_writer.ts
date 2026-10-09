// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PLACEFILE_GERBER_WRITER (`pcbnew/exporters/gerber_placefile_writer.cpp`):
 * the Gerber X3 component placement file of one board side. Each footprint
 * is a flashed position with its P&P attributes, its courtyard (or its pads'
 * bounding box) as an outline, a diamond at pad 1 and a dot at every other
 * pad; Edge.Cuts follows when asked for.
 *
 * Where upstream opens a file, the plotter's bytes go to the sink set with
 * `SetFileSink`, as GENDRILL_WRITER_BASE's do.
 */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { MALFORMED_B_COURTYARD, MALFORMED_F_COURTYARD } from '@ziroeda/common/eda_item_flags.js';
import {
  ConvertNotAllowedCharsInGerber,
  GBR_APERTURE_ATTRIB,
  GBR_METADATA,
} from '@ziroeda/common/gbr_metadata.js';
import {
  GBR_CMP_PNP_METADATA,
  GBR_NETINFO_TYPE,
  MOUNT_TYPE,
} from '@ziroeda/common/gbr_netlist_metadata.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { GERBER_PLOTTER } from '@ziroeda/common/plotters/GERBER_plotter.js';
import { PLOTTER } from '@ziroeda/common/plotters/plotter.js';
import { unescapeString as UnescapeString } from '@ziroeda/common/string_utils.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import { FP_SMD, FP_THROUGH_HOLE, type FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import { BRDITEMS_PLOTTER } from '../plot_brditems_plotter.js';
import { AddGerberX2Header } from '../pcbplot.js';
import { splitFileName, joinPath } from './gendrill_writer_base.js';

export class PLACEFILE_GERBER_WRITER {
  private m_pcb: BOARD;
  private m_layer: PCB_LAYER_ID; // The board layer currently used (typically F_Cu or B_Cu)
  private m_offset: VECTOR2I = { x: 0, y: 0 }; // Drill offset coordinates
  private m_plotPad1Marker: boolean; // True to plot a flashed marker shape at pad 1 position
  private m_plotOtherPadsMarker: boolean; // True to plot a marker shape at other pads position
  // This is a flashed 0 sized round pad
  private m_variant = ''; // Variant name for variant-aware filtering

  private m_fileSink: (aFullPath: string, aBytes: Uint8Array) => void;
  private m_files = new Map<string, Uint8Array>();
  private m_date: Date | null = null;

  constructor(aPcb: BOARD) {
    this.m_pcb = aPcb;
    this.m_plotPad1Marker = true; // Place a marker to pin 1 (or A1) position
    this.m_plotOtherPadsMarker = true; // Place a marker to other pins position
    this.m_layer = PCB_LAYER_ID.UNDEFINED_LAYER; // No layer set
    this.m_fileSink = (aPath, aBytes) => this.m_files.set(aPath, aBytes);
  }

  /** Where the files go; by default, `GetWrittenFiles()`. */
  SetFileSink(aSink: (aFullPath: string, aBytes: Uint8Array) => void): void {
    this.m_fileSink = aSink;
  }

  /** The files written so far with the default sink, by full path. */
  GetWrittenFiles(): ReadonlyMap<string, Uint8Array> {
    return this.m_files;
  }

  /** "Now", for `TF.CreationDate`. */
  SetDate(aDate: Date): void {
    this.m_date = aDate;
  }

  /**
   * Initialize internal parameters to match drill options.
   *
   * @note PTH and NPTH are always separate files in Gerber format.
   * @param aOffset is the drill coordinates offset.
   */
  SetOptions(aOffset: VECTOR2I): void {
    this.m_offset = aOffset;
  }

  /** Set the variant name for variant-aware filtering. */
  SetVariant(aVariant: string): void {
    this.m_variant = aVariant;
  }

  /**
   * Create a pnp gerber file.
   *
   * @param aFullFilename is the full filename.
   * @param aLayer is the layer (F_Cu or B_Cu) to generate.
   * @param aIncludeBrdEdges use true to include board outlines.
   * @param aExcludeDNP use true to exclude footprints flagged DNP.
   * @param aExcludeBOM use true to exclude footprints flagged exclude from BOM.
   * @return component count, or -1 if the file cannot be created.
   */
  CreatePlaceFile(
    aFullFilename: string,
    aLayer: PCB_LAYER_ID,
    aIncludeBrdEdges: boolean,
    aExcludeDNP: boolean,
    aExcludeBOM: boolean,
  ): number {
    this.m_layer = aLayer;

    const plotOpts = this.m_pcb.GetPlotOptions();

    if (plotOpts.GetUseAuxOrigin()) this.m_offset = this.m_pcb.GetDesignSettings().GetAuxOrigin();

    // Collect footprints on the right layer
    const fp_list: FOOTPRINT[] = [];

    for (const footprint of this.m_pcb.Footprints()) {
      if (footprint.GetExcludedFromPosFilesForVariant(this.m_variant)) continue;

      if (aExcludeDNP && footprint.GetDNPForVariant(this.m_variant)) continue;

      if (aExcludeBOM && footprint.GetExcludedFromBOMForVariant(this.m_variant)) continue;

      if (footprint.GetLayer() === aLayer) fp_list.push(footprint);
    }

    const plotter = new GERBER_PLOTTER();

    // Gerber drill file imply X2 format:
    plotter.UseX2format(true);
    plotter.UseX2NetAttributes(true);
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
    plotter.SetGerberCoordinatesFormat(6);
    plotter.SetCreator('PCBNEW');

    // Add the standard X2 FileFunction for P&P files
    // %TF.FileFunction,Component,Ln,[top][bottom]*%
    let text = `%TF.FileFunction,Component,L${
      aLayer === PCB_LAYER_ID.B_Cu ? this.m_pcb.GetCopperLayerCount() : 1
    },${aLayer === PCB_LAYER_ID.B_Cu ? 'Bot' : 'Top'}*%`;
    plotter.AddLineToHeader(text);

    // Add file polarity (positive)
    text = '%TF.FilePolarity,Positive*%';
    plotter.AddLineToHeader(text);

    if (!plotter.OpenFile(aFullFilename)) return -1;

    // We need a BRDITEMS_PLOTTER to plot pads
    const brd_plotter = new BRDITEMS_PLOTTER(plotter, this.m_pcb, plotOpts);

    plotter.StartPlot('1');

    // Some tools in P&P files have the type and size defined.
    // they are position flash (round), pad1 flash (diamond), other pads flash (round)
    // and component outline thickness (polyline)
    // defined size for footprint position shape (circle)
    const flash_position_shape_diam = pcbIUScale.mmToIU(0.3);

    // defined size for pad 1 position (diamond)
    const pad1_mark_size = pcbIUScale.mmToIU(0.36);

    // Normalized size for other pads (circle)
    // It was initially the size 0, but was changed later to 0.1 mm in rev 2023-08
    // See ComponentPin aperture attribute (see 5.6.10 .AperFunction value)
    const other_pads_mark_size = pcbIUScale.mmToIU(0.1);

    // defined size for component outlines
    const line_thickness = pcbIUScale.mmToIU(0.1);

    brd_plotter.SetLayerSet(new LSET([aLayer]));
    let cmp_count = 0;
    const allowUtf8 = true;
    const quoteOption = false;

    // Plot components data: position, outlines, pad1 and other pads.
    for (const footprint of fp_list) {
      // Manage the aperture attribute component position:
      const metadata = new GBR_METADATA();
      metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_POSITION);

      // Add object attribute: component reference to flash (mainly useful for users)
      // using not quoted UTF8 string
      const ref = ConvertNotAllowedCharsInGerber(
        footprint.Reference().GetShownText(false),
        allowUtf8,
        quoteOption,
      );

      metadata.SetCmpReference(ref);
      metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_CMP);

      // Add P&P specific attributes
      const pnpAttrib = new GBR_CMP_PNP_METADATA();

      // Add rotation info (rotation is CCW, in degrees):
      pnpAttrib.m_Orientation = this.mapRotationAngle(
        footprint.GetOrientationDegrees(),
        aLayer === PCB_LAYER_ID.B_Cu,
      );

      pnpAttrib.m_MountType = MOUNT_TYPE.MOUNT_TYPE_UNSPECIFIED;

      if (footprint.GetAttributes() & FP_THROUGH_HOLE)
        pnpAttrib.m_MountType = MOUNT_TYPE.MOUNT_TYPE_TH;
      else if (footprint.GetAttributes() & FP_SMD)
        pnpAttrib.m_MountType = MOUNT_TYPE.MOUNT_TYPE_SMD;

      // Add component value info:
      const fpValue = UnescapeString(
        footprint.GetFieldValueForVariant(this.m_variant, GetCanonicalFieldName(FIELD_T.VALUE)),
      );
      pnpAttrib.m_Value = ConvertNotAllowedCharsInGerber(fpValue, allowUtf8, quoteOption);

      // Add component footprint info:
      let fp_info = footprint.GetFPID().GetLibItemName();
      pnpAttrib.m_Footprint = ConvertNotAllowedCharsInGerber(fp_info, allowUtf8, quoteOption);

      // Add footprint lib name:
      fp_info = footprint.GetFPID().GetLibNickname();
      pnpAttrib.m_LibraryName = ConvertNotAllowedCharsInGerber(fp_info, allowUtf8, quoteOption);

      metadata.m_NetlistMetadata.SetExtraData(pnpAttrib.FormatCmpPnPMetadata());

      const flash_pos = footprint.GetPosition();

      plotter.FlashPadCircle(flash_pos, flash_position_shape_diam, metadata);
      metadata.m_NetlistMetadata.ClearExtraData();

      // Now some extra metadata is output, avoid blindly clearing the full metadata list
      metadata.m_NetlistMetadata.m_TryKeepPreviousAttributes = true;

      // We plot the footprint courtyard when possible.
      // If not, the pads bounding box will be used.
      let useFpPadsBbox = true;
      const onBack = aLayer === PCB_LAYER_ID.B_Cu;

      footprint.BuildCourtyardCaches();

      const checkFlag = onBack ? MALFORMED_B_COURTYARD : MALFORMED_F_COURTYARD;

      if ((footprint.GetFlags() & checkFlag) === 0) {
        metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_COURTYARD);

        const courtyard = footprint.GetCourtyard(aLayer);

        for (let ii = 0; ii < courtyard.OutlineCount(); ii++) {
          const poly = courtyard.Outline(ii);

          if (!poly.PointCount()) continue;

          useFpPadsBbox = false;
          PLOTTER.prototype.PlotPolyLineChain.call(
            plotter,
            poly,
            FILL_T.NO_FILL,
            line_thickness,
            metadata,
          );
        }
      }

      if (useFpPadsBbox) {
        metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_FOOTPRINT);

        // bbox of fp pads, pos 0, rot 0, non flipped
        const bbox = footprint.GetFpPadsLocalBbox();

        // negate bbox Y values if the fp is flipped (always flipped around X axis
        // in Gerber P&P files).
        const y_sign = aLayer === PCB_LAYER_ID.B_Cu ? -1 : 1;

        const poly = new SHAPE_LINE_CHAIN();
        poly.Append(bbox.GetLeft(), y_sign * bbox.GetTop());
        poly.Append(bbox.GetLeft(), y_sign * bbox.GetBottom());
        poly.Append(bbox.GetRight(), y_sign * bbox.GetBottom());
        poly.Append(bbox.GetRight(), y_sign * bbox.GetTop());
        poly.SetClosed(true);

        poly.Rotate(footprint.GetOrientation());
        poly.Move(footprint.GetPosition());
        PLOTTER.prototype.PlotPolyLineChain.call(
          plotter,
          poly,
          FILL_T.NO_FILL,
          line_thickness,
          metadata,
        );
      }

      const pad_key_list: PAD[] = [];

      if (this.m_plotPad1Marker) {
        this.findPads1(pad_key_list, footprint);

        for (const pad1 of pad_key_list) {
          metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_PAD1_POS);

          metadata.SetPadName(pad1.GetNumber(), allowUtf8, quoteOption);

          metadata.SetPadPinFunction(pad1.GetPinFunction(), allowUtf8, quoteOption);

          metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_PAD);

          // Flashes a diamond at pad position:
          plotter.FlashRegularPolygon(pad1.GetPosition(), pad1_mark_size, 4, ANGLE_0, metadata);
        }
      }

      if (this.m_plotOtherPadsMarker) {
        metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_PADOTHER_POS);
        metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_PAD);

        for (const pad of footprint.Pads()) {
          // Already plotted
          if (pad_key_list.includes(pad)) continue;

          // Skip also pads not on the current layer, like pads only
          // on a tech layer
          if (!pad.IsOnLayer(aLayer)) continue;

          metadata.SetPadName(pad.GetNumber(), allowUtf8, quoteOption);

          metadata.SetPadPinFunction(pad.GetPinFunction(), allowUtf8, quoteOption);

          // Flashes a round, 0 sized round shape at pad position
          plotter.FlashPadCircle(pad.GetPosition(), other_pads_mark_size, metadata);
        }
      }

      plotter.ClearAllAttributes(); // Unconditionally close all .TO attributes

      cmp_count++;
    }

    // Plot board outlines, if requested
    if (aIncludeBrdEdges) {
      brd_plotter.SetLayerSet(new LSET([PCB_LAYER_ID.Edge_Cuts]));

      // Plot edge layer and graphic items
      for (const item of this.m_pcb.Drawings()) brd_plotter.PlotBoardGraphicItem(item);

      // Draw footprint other graphic items:
      for (const footprint of fp_list) {
        for (const item of footprint.GraphicalItems()) {
          if (item.Type() === KICAD_T.PCB_SHAPE_T && item.GetLayer() === PCB_LAYER_ID.Edge_Cuts)
            brd_plotter.PlotShape(item as PCB_SHAPE);
        }
      }
    }

    plotter.EndPlot();
    this.m_fileSink(aFullFilename, plotter.bytes());

    return cmp_count;
  }

  /**
   * @return a filename which identify the drill file function.
   *         It is the board name with the layer pair names added, and for separate
   *         (PTH and NPTH) files, "-NPH" or "-NPTH" added
   * @param aFullBaseFilename = a full filename. it will be modified
   *        to add "-pnp" and set the extension
   * @param aLayer = layer (F_Cu or B_Cu) to generate
   */
  GetPlaceFileName(aFullBaseFilename: string, aLayer: PCB_LAYER_ID): string {
    // Gerber files extension is always .gbr.
    // Therefore, to mark pnp files, add "-pnp" to the filename, and a layer id.
    const fn = splitFileName(aFullBaseFilename);

    let post_id = '-pnp_';
    post_id += aLayer === PCB_LAYER_ID.B_Cu ? 'bottom' : 'top';

    return joinPath(fn.dir, `${fn.name}${post_id}.gbr`);
  }

  private now(): Date {
    return this.m_date ?? new Date();
  }

  /**
   * Convert a KiCad footprint orientation to gerber rotation both are in degrees.
   */
  private mapRotationAngle(aAngle: number, aIsFlipped: boolean): number {
    // Convert a KiCad footprint orientation to gerber rotation, depending on the layer
    // Gerber rotation is:
    // rot angle > 0 for rot CW, seen from Top side
    // same a Pcbnew for Top side
    // (angle + 180) for Bottom layer i.e flipped around Y axis: X axis coordinates mirrored.
    // because Pcbnew flip around the X axis : Y coord mirrored, that is similar to mirror
    // around Y axis + 180 deg rotation
    if (aIsFlipped) {
      let gbr_angle = 180.0 + aAngle;

      // Normalize between -180 ... + 180 deg
      // Not mandatory, but the angle is more easy to read
      if (gbr_angle <= -180) gbr_angle += 360.0;
      else if (gbr_angle > 180) gbr_angle -= 360.0;

      return gbr_angle;
    }

    return aAngle;
  }

  /**
   * Find the pad(s) 1 (or pad "A1") of a footprint.
   *
   * Usually only one pad is found. Used to place a marker in this position.
   */
  private findPads1(aPadList: PAD[], aFootprint: FOOTPRINT): void {
    // Fint the pad "1" or pad "A1"
    // this is possible only if only one pad is found
    // useful to place a marker in this position
    for (const pad of aFootprint.Pads()) {
      if (!pad.IsOnLayer(this.m_layer)) continue;

      if (pad.GetNumber() === '1' || pad.GetNumber() === 'A1') aPadList.push(pad);
    }
  }
}
