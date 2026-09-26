// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_plot_params.h` / `.cpp` and `pcb_plot_params_parser.h`:
 * `PCB_PLOT_PARAMS`, the plot options a board carries in its
 * `(setup (pcbplotparams …))` block, with its `Format` and the
 * `PCB_PLOT_PARAMS_PARSER` that reads it back; and `DRILL_MARKS` from
 * `plotprint_opts.h`.
 *
 * The C++ parser is its own `DSNLEXER` subclass synchronised onto the board
 * reader (`SyncLineReaderWith`); here it drives the board file's lexer
 * directly, which is the same token stream.
 *
 * `m_colors` / `m_default_colors` (`COLOR_SETTINGS`) are not ported: the
 * plotters take their colours from the render settings they are handed.
 */

import { type Color4d, COLOR4D_UNSPECIFIED } from '@ziroeda/common/color4d.js';
import { type DSNLEXER, T, type Tok } from '@ziroeda/common/dsnlexer.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FormatBool } from '@ziroeda/common/io/kicad/kicad_io_utils.js';
import {
  B_Adhes,
  B_CrtYd,
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  Cmts_User,
  Dwgs_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  F_Adhes,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  Margin,
  type PCB_LAYER_ID,
  Rescue,
  User_1,
} from '@ziroeda/common/layer_id.js';
import { In_Cu } from './layer_ids.js';
import type { LSEQ } from '@ziroeda/common/lseq.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  DXF_OUTLINE_MODE,
  DXF_UNITS,
  PLOT_FORMAT,
  PLOT_PARAMS,
  PLOT_TEXT_MODE,
} from '@ziroeda/common/plotters/plotter.js';
import type { OUTPUTFORMATTER } from '@ziroeda/common/richio.js';
import { FormatDouble2Str } from '@ziroeda/common/string_utils.js';
import { BASE_SET } from '@ziroeda/common/base_set.js';

/** `DRILL_MARKS` (pcbnew/plotprint_opts.h). */
export enum DRILL_MARKS {
  NO_DRILL_SHAPE = 0,
  SMALL_DRILL_SHAPE,
  FULL_DRILL_SHAPE,
}

export const SVG_PRECISION_MIN = 3;
export const SVG_PRECISION_MAX = 6;
export const SVG_PRECISION_DEFAULT = 4;

// default trailing digits in Gerber coordinates, when units are mm
// This is also the max usable precision (i.e. internal Pcbnew Units)
export const gbrDefaultPrecision = 6;

/**
 * Parameters and options when plotting/printing a board.
 */
export class PCB_PLOT_PARAMS extends PLOT_PARAMS {
  m_PDFFrontFPPropertyPopups: boolean; ///< Generate PDF property popup menus for footprints
  m_PDFBackFPPropertyPopups: boolean; ///<   on front and/or back of board
  m_PDFMetadata: boolean; ///< Generate PDF metadata for SUBJECT and AUTHOR
  m_PDFSingle: boolean; ///< Generate a single PDF file for all layers
  m_PDFBackgroundColor: Color4d; ///< Background color to use if m_PDFUseBackgroundColor is true

  /** @internal the parser's `friend` access */
  m_format: PLOT_FORMAT; /// Plot format type (chooses the driver to be used)
  m_layerSelection: LSET;
  m_plotOnAllLayersSequence: LSEQ = [];
  m_skipNPTH_Pads: boolean; /// Used to disable NPTH pads plotting on copper layers
  m_plotPadNumbers: boolean; /// Plot pad numbers when sketching pads on fab layers
  m_drillMarks: DRILL_MARKS; /// Holes can be not plotted, have a small mark, or be
  ///   plotted in actual size
  m_textMode: PLOT_TEXT_MODE;
  m_DXFPlotMode: DXF_OUTLINE_MODE; /// FILLED or SKETCH for filled objects.
  m_DXFUnits: DXF_UNITS;
  m_DXFPolygonMode: boolean; /// In polygon mode, each item to plot is converted to a
  ///   polygon and all polygons are merged.
  m_A4Output: boolean; /// Autoscale the plot to fit an A4 (landscape?) sheet
  m_autoScale: boolean; /// When true set the scale to fit the board in the page
  m_scale: number; /// Global scale factor, 1.0 plots a board at actual size
  m_mirror: boolean; /// Mirror the plot around the X axis
  m_negative: boolean; /// Plot in negative color (supported only by some drivers)
  m_blackAndWhite: boolean; /// Plot in black and white only
  m_plotDrawingSheet: boolean;
  m_plotViaOnMaskLayer: boolean | undefined; /// Deprecated; only used for reading legacy files
  m_subtractMaskFromSilk: boolean; /// On gerbers 'scrape' away the solder mask from
  ///   silkscreen (trim silks)
  /// When plotting gerber files, use a conventional set of Protel extensions instead of .gbr,
  /// that is now the official gerber file extension (this is a deprecated feature)
  m_useGerberProtelExtensions: boolean;
  /// Include attributes from the Gerber X2 format (chapter 5 in revision J2)
  m_useGerberX2format: boolean;
  /// Disable aperture macros in Gerber format (only for broken Gerber readers).  Ideally,
  /// should be never selected.
  m_gerberDisableApertMacros: boolean;
  /// Include netlist info (only in Gerber X2 format) (chapter ? in revision ?)
  m_includeGerberNetlistInfo: boolean;
  /// generate the auxiliary "job file" in gerber format
  m_createGerberJobFile: boolean;
  /// Precision of coordinates in Gerber: accepted 5 or 6 when units are in mm, 6 or 7 in inches
  /// (but Pcbnew uses mm).
  /// 6 is the internal resolution of Pcbnew, but not always accepted by board maker
  /// 5 is the minimal value for professional boards
  m_gerberPrecision: number;
  /// Precision of coordinates in SVG: accepted 3 - 6; 6 is the internal resolution of Pcbnew
  m_svgPrecision: number;
  m_svgFitPageToBoard: boolean;
  m_useAuxOrigin: boolean; ///< Plot gerbers using auxiliary (drill) origin instead
  ///<   of absolute coordinates
  m_outputDirectory: string; ///< Output directory for plot files (usually relative to
  ///<   the board file)
  m_scaleSelection: number; ///< Scale ratio index (UI only)
  m_plotReference: boolean; ///< Enable plotting of part references
  m_plotValue: boolean; ///< Enable plotting of part values
  m_plotFPText: boolean;
  m_sketchPadsOnFabLayers: boolean; ///< Plots pads outlines on fab layers
  m_sketchPadLineWidth: number;
  m_hideDNPFPsOnFabLayers: boolean;
  m_sketchDNPFPsOnFabLayers: boolean;
  m_crossoutDNPFPsOnFabLayers: boolean;
  m_fineScaleAdjustX: number; ///< Compensation for printer scale errors (and therefore
  m_fineScaleAdjustY: number; ///<   expected to be very near 1.0).  Only X and Y
  ///<   dimensions are adjusted: circles are plotted as
  ///<   circles, even if X and Y fine scale differ.
  ///<   Because of this it is mostly useful for printers:
  ///<   postscript plots should use the prologue, which will
  ///<   change the whole output matrix.
  m_widthAdjust: number; ///< Compensation for PS printers/plotters that do not
  ///<   strictly obey line width settings. Only used to plot
  ///<   pads and tracks.
  m_dashedLineDashRatio: number;
  m_dashedLineGapRatio: number;
  m_DXFExportAsMultiLayeredFile: boolean;
  m_layersToExport: [PCB_LAYER_ID, string][] = [];
  m_layer: PCB_LAYER_ID = F_Cu as PCB_LAYER_ID; // uninitialised in the C++

  constructor() {
    super();
    this.m_useGerberProtelExtensions = false;
    this.m_gerberDisableApertMacros = false;
    this.m_useGerberX2format = true;
    this.m_includeGerberNetlistInfo = true;
    this.m_createGerberJobFile = true;
    this.m_gerberPrecision = gbrDefaultPrecision;
    this.m_dashedLineDashRatio = 12.0; // From ISO 128-2
    this.m_dashedLineGapRatio = 3.0; // From ISO 128-2

    // we used 0.1mils for SVG step before, but nm precision is more accurate, so we use nm
    this.m_svgPrecision = SVG_PRECISION_DEFAULT;
    this.m_svgFitPageToBoard = false;
    this.m_plotDrawingSheet = false;
    this.m_DXFPlotMode = DXF_OUTLINE_MODE.FILLED;
    this.m_DXFPolygonMode = true;
    this.m_DXFUnits = DXF_UNITS.INCH;
    this.m_useAuxOrigin = false;
    this.m_negative = false;
    this.m_A4Output = false;
    this.m_plotReference = true;
    this.m_plotValue = true;
    this.m_plotFPText = true;
    this.m_sketchPadsOnFabLayers = false;
    this.m_hideDNPFPsOnFabLayers = false;
    this.m_sketchDNPFPsOnFabLayers = true;
    this.m_crossoutDNPFPsOnFabLayers = true;
    this.m_plotPadNumbers = false;
    this.m_subtractMaskFromSilk = false;
    this.m_format = PLOT_FORMAT.GERBER;
    this.m_mirror = false;
    this.m_drillMarks = DRILL_MARKS.SMALL_DRILL_SHAPE;
    this.m_autoScale = false;
    this.m_scale = 1.0;
    this.m_scaleSelection = 1;
    this.m_fineScaleAdjustX = 1.0;
    this.m_fineScaleAdjustY = 1.0;
    this.m_widthAdjust = 0;
    this.m_textMode = PLOT_TEXT_MODE.DEFAULT;
    this.m_outputDirectory = '';
    this.m_layerSelection = new LSET([
      F_SilkS,
      B_SilkS,
      F_Mask,
      B_Mask,
      F_Paste,
      B_Paste,
      Edge_Cuts,
    ]).or(LSET.AllCuMask());

    this.m_PDFFrontFPPropertyPopups = true;
    this.m_PDFBackFPPropertyPopups = true;
    this.m_PDFMetadata = true;
    this.m_PDFSingle = false;
    this.m_PDFBackgroundColor = COLOR4D_UNSPECIFIED;

    // This parameter controls if the NPTH pads will be plotted or not
    // it is a "local" parameter
    this.m_skipNPTH_Pads = false;

    // line width to plot items in outline mode.
    this.m_sketchPadLineWidth = pcbIUScale.mmToIU(0.1);

    // m_default_colors / m_colors: COLOR_SETTINGS not ported

    this.m_blackAndWhite = true;

    this.m_DXFExportAsMultiLayeredFile = false;
  }

  /** The compiler-generated copy (`PCB_PLOT_PARAMS plotParams = …`). */
  static copyOf(aOther: PCB_PLOT_PARAMS): PCB_PLOT_PARAMS {
    const p = new PCB_PLOT_PARAMS();
    p.assign(aOther);
    return p;
  }

  /** The compiler-generated `operator=` (`m_plotOptions = aOptions`). */
  assign(aOther: PCB_PLOT_PARAMS): this {
    this.m_PDFFrontFPPropertyPopups = aOther.m_PDFFrontFPPropertyPopups;
    this.m_PDFBackFPPropertyPopups = aOther.m_PDFBackFPPropertyPopups;
    this.m_PDFMetadata = aOther.m_PDFMetadata;
    this.m_PDFSingle = aOther.m_PDFSingle;
    this.m_PDFBackgroundColor = { ...aOther.m_PDFBackgroundColor };
    this.m_format = aOther.m_format;
    this.m_layerSelection = new LSET(aOther.m_layerSelection);
    this.m_plotOnAllLayersSequence = aOther.m_plotOnAllLayersSequence.slice();
    this.m_skipNPTH_Pads = aOther.m_skipNPTH_Pads;
    this.m_plotPadNumbers = aOther.m_plotPadNumbers;
    this.m_drillMarks = aOther.m_drillMarks;
    this.m_textMode = aOther.m_textMode;
    this.m_DXFPlotMode = aOther.m_DXFPlotMode;
    this.m_DXFUnits = aOther.m_DXFUnits;
    this.m_DXFPolygonMode = aOther.m_DXFPolygonMode;
    this.m_A4Output = aOther.m_A4Output;
    this.m_autoScale = aOther.m_autoScale;
    this.m_scale = aOther.m_scale;
    this.m_mirror = aOther.m_mirror;
    this.m_negative = aOther.m_negative;
    this.m_blackAndWhite = aOther.m_blackAndWhite;
    this.m_plotDrawingSheet = aOther.m_plotDrawingSheet;
    this.m_plotViaOnMaskLayer = aOther.m_plotViaOnMaskLayer;
    this.m_subtractMaskFromSilk = aOther.m_subtractMaskFromSilk;
    this.m_useGerberProtelExtensions = aOther.m_useGerberProtelExtensions;
    this.m_useGerberX2format = aOther.m_useGerberX2format;
    this.m_gerberDisableApertMacros = aOther.m_gerberDisableApertMacros;
    this.m_includeGerberNetlistInfo = aOther.m_includeGerberNetlistInfo;
    this.m_createGerberJobFile = aOther.m_createGerberJobFile;
    this.m_gerberPrecision = aOther.m_gerberPrecision;
    this.m_svgPrecision = aOther.m_svgPrecision;
    this.m_svgFitPageToBoard = aOther.m_svgFitPageToBoard;
    this.m_useAuxOrigin = aOther.m_useAuxOrigin;
    this.m_outputDirectory = aOther.m_outputDirectory;
    this.m_scaleSelection = aOther.m_scaleSelection;
    this.m_plotReference = aOther.m_plotReference;
    this.m_plotValue = aOther.m_plotValue;
    this.m_plotFPText = aOther.m_plotFPText;
    this.m_sketchPadsOnFabLayers = aOther.m_sketchPadsOnFabLayers;
    this.m_sketchPadLineWidth = aOther.m_sketchPadLineWidth;
    this.m_hideDNPFPsOnFabLayers = aOther.m_hideDNPFPsOnFabLayers;
    this.m_sketchDNPFPsOnFabLayers = aOther.m_sketchDNPFPsOnFabLayers;
    this.m_crossoutDNPFPsOnFabLayers = aOther.m_crossoutDNPFPsOnFabLayers;
    this.m_fineScaleAdjustX = aOther.m_fineScaleAdjustX;
    this.m_fineScaleAdjustY = aOther.m_fineScaleAdjustY;
    this.m_widthAdjust = aOther.m_widthAdjust;
    this.m_dashedLineDashRatio = aOther.m_dashedLineDashRatio;
    this.m_dashedLineGapRatio = aOther.m_dashedLineGapRatio;
    this.m_DXFExportAsMultiLayeredFile = aOther.m_DXFExportAsMultiLayeredFile;
    this.m_layersToExport = aOther.m_layersToExport.map(([l, n]) => [l, n]);
    this.m_layer = aOther.m_layer;
    return this;
  }

  SetSkipPlotNPTH_Pads(aSkip: boolean): void {
    this.m_skipNPTH_Pads = aSkip;
  }

  GetSkipPlotNPTH_Pads(): boolean {
    return this.m_skipNPTH_Pads;
  }

  Format(aFormatter: OUTPUTFORMATTER): void {
    aFormatter.Print('(pcbplotparams');

    aFormatter.Print(`(layerselection 0x${this.m_layerSelection.FmtHex()})`);

    const commonLayers = new LSET();

    for (const commonLayer of this.m_plotOnAllLayersSequence) commonLayers.set(commonLayer);

    aFormatter.Print(`(plot_on_all_layers_selection 0x${commonLayers.FmtHex()})`);

    FormatBool(aFormatter, 'disableapertmacros', this.m_gerberDisableApertMacros);
    FormatBool(aFormatter, 'usegerberextensions', this.m_useGerberProtelExtensions);
    FormatBool(aFormatter, 'usegerberattributes', this.GetUseGerberX2format());
    FormatBool(aFormatter, 'usegerberadvancedattributes', this.GetIncludeGerberNetlistInfo());
    FormatBool(aFormatter, 'creategerberjobfile', this.GetCreateGerberJobFile());

    // save this option only if it is not the default value,
    // to avoid incompatibility with older Pcbnew version
    if (this.m_gerberPrecision !== gbrDefaultPrecision)
      aFormatter.Print(`(gerberprecision ${this.m_gerberPrecision})`);

    aFormatter.Print(`(dashed_line_dash_ratio ${FormatDouble2Str(this.GetDashedLineDashRatio())})`);
    aFormatter.Print(`(dashed_line_gap_ratio ${FormatDouble2Str(this.GetDashedLineGapRatio())})`);

    // SVG options
    aFormatter.Print(`(svgprecision ${this.m_svgPrecision})`);

    FormatBool(aFormatter, 'plotframeref', this.m_plotDrawingSheet);
    aFormatter.Print(`(mode ${this.GetDXFPlotMode() === DXF_OUTLINE_MODE.SKETCH ? 2 : 1})`);
    FormatBool(aFormatter, 'useauxorigin', this.m_useAuxOrigin);

    // PDF options
    FormatBool(aFormatter, 'pdf_front_fp_property_popups', this.m_PDFFrontFPPropertyPopups);
    FormatBool(aFormatter, 'pdf_back_fp_property_popups', this.m_PDFBackFPPropertyPopups);
    FormatBool(aFormatter, 'pdf_metadata', this.m_PDFMetadata);
    FormatBool(aFormatter, 'pdf_single_document', this.m_PDFSingle);

    // DXF options
    FormatBool(aFormatter, 'dxfpolygonmode', this.m_DXFPolygonMode);
    FormatBool(aFormatter, 'dxfimperialunits', this.m_DXFUnits === DXF_UNITS.INCH);
    FormatBool(aFormatter, 'dxfusepcbnewfont', this.m_textMode !== PLOT_TEXT_MODE.NATIVE);

    FormatBool(aFormatter, 'psnegative', this.m_negative);
    FormatBool(aFormatter, 'psa4output', this.m_A4Output);

    FormatBool(aFormatter, 'plot_black_and_white', this.m_blackAndWhite);

    FormatBool(aFormatter, 'sketchpadsonfab', this.m_sketchPadsOnFabLayers);
    FormatBool(aFormatter, 'plotpadnumbers', this.m_plotPadNumbers);
    FormatBool(aFormatter, 'hidednponfab', this.m_hideDNPFPsOnFabLayers);
    FormatBool(aFormatter, 'sketchdnponfab', this.m_sketchDNPFPsOnFabLayers);
    FormatBool(aFormatter, 'crossoutdnponfab', this.m_crossoutDNPFPsOnFabLayers);
    FormatBool(aFormatter, 'subtractmaskfromsilk', this.m_subtractMaskFromSilk);
    aFormatter.Print(`(outputformat ${this.m_format})`);
    FormatBool(aFormatter, 'mirror', this.m_mirror);
    aFormatter.Print(`(drillshape ${this.m_drillMarks})`);
    aFormatter.Print(`(scaleselection ${this.m_scaleSelection})`);
    aFormatter.Print(`(outputdirectory ${aFormatter.Quotew(this.m_outputDirectory)})`);
    aFormatter.Print(')');
  }

  Parse(aParser: PCB_PLOT_PARAMS_PARSER): void {
    aParser.Parse(this);
  }

  /**
   * Compare current settings to aPcbPlotParams, including not saved parameters in brd file.
   *
   * @param aPcbPlotParams is the #PCB_PLOT_PARAMS to compare/
   * @return true is parameters are same, false if one (or more) parameter does not match.
   */
  IsSameAs(aPcbPlotParams: PCB_PLOT_PARAMS): boolean {
    if (!this.m_layerSelection.equals(aPcbPlotParams.m_layerSelection)) return false;

    if (
      this.m_plotOnAllLayersSequence.length !== aPcbPlotParams.m_plotOnAllLayersSequence.length ||
      this.m_plotOnAllLayersSequence.some(
        (l, i) => l !== aPcbPlotParams.m_plotOnAllLayersSequence[i],
      )
    )
      return false;

    if (this.m_format === PLOT_FORMAT.GERBER) {
      if (this.m_useGerberProtelExtensions !== aPcbPlotParams.m_useGerberProtelExtensions)
        return false;

      if (this.m_gerberDisableApertMacros !== aPcbPlotParams.m_gerberDisableApertMacros)
        return false;

      if (this.m_useGerberX2format !== aPcbPlotParams.m_useGerberX2format) return false;

      if (this.m_includeGerberNetlistInfo !== aPcbPlotParams.m_includeGerberNetlistInfo)
        return false;

      if (this.m_createGerberJobFile !== aPcbPlotParams.m_createGerberJobFile) return false;

      if (this.m_gerberPrecision !== aPcbPlotParams.m_gerberPrecision) return false;
    }

    if (this.m_dashedLineDashRatio !== aPcbPlotParams.m_dashedLineDashRatio) return false;

    if (this.m_dashedLineGapRatio !== aPcbPlotParams.m_dashedLineGapRatio) return false;

    if (this.m_plotDrawingSheet !== aPcbPlotParams.m_plotDrawingSheet) return false;

    if (this.m_format === PLOT_FORMAT.DXF) {
      if (this.m_DXFPlotMode !== aPcbPlotParams.m_DXFPlotMode) return false;

      if (this.m_DXFPolygonMode !== aPcbPlotParams.m_DXFPolygonMode) return false;

      if (this.m_DXFUnits !== aPcbPlotParams.m_DXFUnits) return false;

      if (this.m_DXFExportAsMultiLayeredFile !== aPcbPlotParams.m_DXFExportAsMultiLayeredFile)
        return false;
    }

    if (this.m_svgPrecision !== aPcbPlotParams.m_svgPrecision) return false;

    if (this.m_format !== PLOT_FORMAT.POST) {
      if (this.m_useAuxOrigin !== aPcbPlotParams.m_useAuxOrigin) return false;
    }

    if (
      this.m_format === PLOT_FORMAT.POST ||
      this.m_format === PLOT_FORMAT.SVG ||
      this.m_format === PLOT_FORMAT.PDF
    ) {
      if (this.m_negative !== aPcbPlotParams.m_negative) return false;

      if (this.m_mirror !== aPcbPlotParams.m_mirror) return false;
    }

    if (this.m_format === PLOT_FORMAT.PDF) {
      if (this.m_PDFFrontFPPropertyPopups !== aPcbPlotParams.m_PDFFrontFPPropertyPopups)
        return false;

      if (this.m_PDFBackFPPropertyPopups !== aPcbPlotParams.m_PDFBackFPPropertyPopups) return false;

      if (this.m_PDFMetadata !== aPcbPlotParams.m_PDFMetadata) return false;
    }

    if (this.m_plotReference !== aPcbPlotParams.m_plotReference) return false;

    if (this.m_plotValue !== aPcbPlotParams.m_plotValue) return false;

    if (this.m_plotFPText !== aPcbPlotParams.m_plotFPText) return false;

    if (this.m_sketchPadsOnFabLayers !== aPcbPlotParams.m_sketchPadsOnFabLayers) return false;

    if (this.m_plotPadNumbers !== aPcbPlotParams.m_plotPadNumbers) return false;

    if (this.m_hideDNPFPsOnFabLayers !== aPcbPlotParams.m_hideDNPFPsOnFabLayers) return false;

    if (this.m_sketchDNPFPsOnFabLayers !== aPcbPlotParams.m_sketchDNPFPsOnFabLayers) return false;

    if (this.m_crossoutDNPFPsOnFabLayers !== aPcbPlotParams.m_crossoutDNPFPsOnFabLayers)
      return false;

    if (this.m_subtractMaskFromSilk !== aPcbPlotParams.m_subtractMaskFromSilk) return false;

    if (this.m_format !== aPcbPlotParams.m_format) return false;

    if (this.m_format !== PLOT_FORMAT.GERBER) {
      if (this.m_drillMarks !== aPcbPlotParams.m_drillMarks) return false;

      if (this.m_scaleSelection !== aPcbPlotParams.m_scaleSelection) return false;

      if (this.m_autoScale !== aPcbPlotParams.m_autoScale) return false;

      if (this.m_scale !== aPcbPlotParams.m_scale) return false;
    }

    if (this.m_format === PLOT_FORMAT.POST) {
      if (this.m_A4Output !== aPcbPlotParams.m_A4Output) return false;

      if (this.m_fineScaleAdjustX !== aPcbPlotParams.m_fineScaleAdjustX) return false;

      if (this.m_fineScaleAdjustY !== aPcbPlotParams.m_fineScaleAdjustY) return false;

      if (this.m_widthAdjust !== aPcbPlotParams.m_widthAdjust) return false;
    }

    if (this.m_textMode !== aPcbPlotParams.m_textMode) return false;

    if (this.m_blackAndWhite !== aPcbPlotParams.m_blackAndWhite) return false;

    if (this.m_outputDirectory !== aPcbPlotParams.m_outputDirectory) return false;

    return true;
  }

  SetTextMode(aVal: PLOT_TEXT_MODE): void {
    this.m_textMode = aVal;
  }

  override GetTextMode(): PLOT_TEXT_MODE {
    return this.m_textMode;
  }

  SetDXFPlotMode(aPlotMode: DXF_OUTLINE_MODE): void {
    this.m_DXFPlotMode = aPlotMode;
  }

  override GetDXFPlotMode(): DXF_OUTLINE_MODE {
    return this.m_DXFPlotMode;
  }

  SetPlotPadNumbers(aFlag: boolean): void {
    this.m_plotPadNumbers = aFlag;
  }

  GetPlotPadNumbers(): boolean {
    return this.m_plotPadNumbers;
  }

  SetDXFPlotPolygonMode(aFlag: boolean): void {
    this.m_DXFPolygonMode = aFlag;
  }

  GetDXFPlotPolygonMode(): boolean {
    return this.m_DXFPolygonMode;
  }

  SetDXFPlotUnits(aUnit: DXF_UNITS): void {
    this.m_DXFUnits = aUnit;
  }

  GetDXFPlotUnits(): DXF_UNITS {
    return this.m_DXFUnits;
  }

  SetDrillMarksType(aVal: DRILL_MARKS): void {
    this.m_drillMarks = aVal;
  }

  GetDrillMarksType(): DRILL_MARKS {
    return this.m_drillMarks;
  }

  SetScale(aVal: number): void {
    this.m_scale = aVal;
  }

  GetScale(): number {
    return this.m_scale;
  }

  SetFineScaleAdjustX(aVal: number): void {
    this.m_fineScaleAdjustX = aVal;
  }

  GetFineScaleAdjustX(): number {
    return this.m_fineScaleAdjustX;
  }

  SetFineScaleAdjustY(aVal: number): void {
    this.m_fineScaleAdjustY = aVal;
  }

  GetFineScaleAdjustY(): number {
    return this.m_fineScaleAdjustY;
  }

  SetWidthAdjust(aVal: number): void {
    this.m_widthAdjust = aVal;
  }

  GetWidthAdjust(): number {
    return this.m_widthAdjust;
  }

  SetAutoScale(aFlag: boolean): void {
    this.m_autoScale = aFlag;
  }

  GetAutoScale(): boolean {
    return this.m_autoScale;
  }

  SetMirror(aFlag: boolean): void {
    this.m_mirror = aFlag;
  }

  GetMirror(): boolean {
    return this.m_mirror;
  }

  SetSketchPadsOnFabLayers(aFlag: boolean): void {
    this.m_sketchPadsOnFabLayers = aFlag;
  }

  GetSketchPadsOnFabLayers(): boolean {
    return this.m_sketchPadsOnFabLayers;
  }

  SetSketchPadLineWidth(aWidth: number): void {
    this.m_sketchPadLineWidth = aWidth;
  }

  GetSketchPadLineWidth(): number {
    return this.m_sketchPadLineWidth;
  }

  SetHideDNPFPsOnFabLayers(aFlag: boolean): void {
    this.m_hideDNPFPsOnFabLayers = aFlag;
  }

  GetHideDNPFPsOnFabLayers(): boolean {
    return this.m_hideDNPFPsOnFabLayers;
  }

  SetSketchDNPFPsOnFabLayers(aFlag: boolean): void {
    this.m_sketchDNPFPsOnFabLayers = aFlag;
  }

  GetSketchDNPFPsOnFabLayers(): boolean {
    return this.m_sketchDNPFPsOnFabLayers;
  }

  SetCrossoutDNPFPsOnFabLayers(aFlag: boolean): void {
    this.m_crossoutDNPFPsOnFabLayers = aFlag;
  }

  GetCrossoutDNPFPsOnFabLayers(): boolean {
    return this.m_crossoutDNPFPsOnFabLayers;
  }

  SetPlotValue(aFlag: boolean): void {
    this.m_plotValue = aFlag;
  }

  GetPlotValue(): boolean {
    return this.m_plotValue;
  }

  SetPlotReference(aFlag: boolean): void {
    this.m_plotReference = aFlag;
  }

  GetPlotReference(): boolean {
    return this.m_plotReference;
  }

  SetPlotFPText(aFlag: boolean): void {
    this.m_plotFPText = aFlag;
  }

  GetPlotFPText(): boolean {
    return this.m_plotFPText;
  }

  SetNegative(aFlag: boolean): void {
    this.m_negative = aFlag;
  }

  GetNegative(): boolean {
    return this.m_negative;
  }

  GetLegacyPlotViaOnMaskLayer(): boolean | undefined {
    return this.m_plotViaOnMaskLayer;
  }

  SetPlotFrameRef(aFlag: boolean): void {
    this.m_plotDrawingSheet = aFlag;
  }

  GetPlotFrameRef(): boolean {
    return this.m_plotDrawingSheet;
  }

  SetFormat(aFormat: PLOT_FORMAT): void {
    this.m_format = aFormat;
  }

  GetFormat(): PLOT_FORMAT {
    return this.m_format;
  }

  SetOutputDirectory(aDir: string): void {
    this.m_outputDirectory = aDir;
  }

  GetOutputDirectory(): string {
    return this.m_outputDirectory;
  }

  SetDisableGerberMacros(aDisable: boolean): void {
    this.m_gerberDisableApertMacros = aDisable;
  }

  GetDisableGerberMacros(): boolean {
    return this.m_gerberDisableApertMacros;
  }

  SetUseGerberX2format(aUse: boolean): void {
    this.m_useGerberX2format = aUse;
  }

  GetUseGerberX2format(): boolean {
    return this.m_useGerberX2format;
  }

  SetIncludeGerberNetlistInfo(aUse: boolean): void {
    this.m_includeGerberNetlistInfo = aUse;
  }

  GetIncludeGerberNetlistInfo(): boolean {
    return this.m_includeGerberNetlistInfo;
  }

  SetCreateGerberJobFile(aCreate: boolean): void {
    this.m_createGerberJobFile = aCreate;
  }

  GetCreateGerberJobFile(): boolean {
    return this.m_createGerberJobFile;
  }

  SetUseGerberProtelExtensions(aUse: boolean): void {
    this.m_useGerberProtelExtensions = aUse;
  }

  GetUseGerberProtelExtensions(): boolean {
    return this.m_useGerberProtelExtensions;
  }

  SetGerberPrecision(aPrecision: number): void {
    // Currently Gerber files use mm.
    // accepted precision is only 6 (max value, this is the resolution of Pcbnew)
    // or 5, min value for professional boards, when 6 creates problems
    // to board makers.

    this.m_gerberPrecision =
      aPrecision === gbrDefaultPrecision - 1 ? gbrDefaultPrecision - 1 : gbrDefaultPrecision;
  }

  GetGerberPrecision(): number {
    return this.m_gerberPrecision;
  }

  SetSvgPrecision(aPrecision: number): void {
    this.m_svgPrecision = Math.min(Math.max(aPrecision, SVG_PRECISION_MIN), SVG_PRECISION_MAX);
  }

  GetSvgPrecision(): number {
    return this.m_svgPrecision;
  }

  SetSvgFitPageToBoard(aSvgFitPageToBoard: boolean): void {
    this.m_svgFitPageToBoard = aSvgFitPageToBoard;
  }

  GetSvgFitPagetoBoard(): boolean {
    return this.m_svgFitPageToBoard;
  }

  SetBlackAndWhite(blackAndWhite: boolean): void {
    this.m_blackAndWhite = blackAndWhite;
  }

  GetBlackAndWhite(): boolean {
    return this.m_blackAndWhite;
  }

  SetSubtractMaskFromSilk(aSubtract: boolean): void {
    this.m_subtractMaskFromSilk = aSubtract;
  }

  GetSubtractMaskFromSilk(): boolean {
    return this.m_subtractMaskFromSilk;
  }

  SetLayerSelection(aSelection: LSET): void {
    this.m_layerSelection = aSelection;
  }

  GetLayerSelection(): LSET {
    return this.m_layerSelection;
  }

  SetPlotOnAllLayersSequence(aSeq: LSEQ): void {
    this.m_plotOnAllLayersSequence = aSeq;
  }

  GetPlotOnAllLayersSequence(): LSEQ {
    return this.m_plotOnAllLayersSequence;
  }

  SetUseAuxOrigin(aAux: boolean): void {
    this.m_useAuxOrigin = aAux;
  }

  GetUseAuxOrigin(): boolean {
    return this.m_useAuxOrigin;
  }

  SetScaleSelection(aSelection: number): void {
    this.m_scaleSelection = aSelection;
  }

  GetScaleSelection(): number {
    return this.m_scaleSelection;
  }

  SetA4Output(aForce: boolean): void {
    this.m_A4Output = aForce;
  }

  GetA4Output(): boolean {
    return this.m_A4Output;
  }

  SetDashedLineDashRatio(aVal: number): void {
    this.m_dashedLineDashRatio = aVal;
  }

  GetDashedLineDashRatio(): number {
    return this.m_dashedLineDashRatio;
  }

  SetDashedLineGapRatio(aVal: number): void {
    this.m_dashedLineGapRatio = aVal;
  }

  GetDashedLineGapRatio(): number {
    return this.m_dashedLineGapRatio;
  }

  SetDXFMultiLayeredExportOption(aFlag: boolean): void {
    this.m_DXFExportAsMultiLayeredFile = aFlag;
  }

  GetDXFMultiLayeredExportOption(): boolean {
    return this.m_DXFExportAsMultiLayeredFile;
  }

  SetLayersToExport(aVal: [PCB_LAYER_ID, string][]): void {
    this.m_layersToExport = aVal;
  }

  GetLayersToExport(): [PCB_LAYER_ID, string][] {
    return this.m_layersToExport;
  }

  /**
   * Return the layer this item is on.
   */
  GetLayer(): PCB_LAYER_ID {
    return this.m_layer;
  }

  SetLayer(aLayer: PCB_LAYER_ID): void {
    this.m_layer = aLayer;
  }

  SetPDFBackgroundColor(aColor: Color4d): void {
    this.m_PDFBackgroundColor = aColor;
  }

  GetPDFBackgroundColor(): Color4d {
    return this.m_PDFBackgroundColor;
  }
}

// ---------------------------------------------------------------------------
// PCB_PLOT_PARAMS_PARSER (pcb_plot_params_parser.h + pcb_plot_params.cpp)
// ---------------------------------------------------------------------------

/**
 * These are the layer IDs from before 5e0abadb23425765e164f49ee2f893e94ddb97fc,
 * and are needed for mapping old PCB files to the new layer numbering.
 */
export const LEGACY_PCB_LAYER_ID_COUNT = 60;

/*
 * Mapping to translate a legacy layer ID into the new PCB layer IDs.
 * (`s_legacyLayerIdMap`, a std::map: iterated in legacy-id order.)
 */
const s_legacyLayerIdMap: [number, PCB_LAYER_ID][] = (() => {
  const map: [number, PCB_LAYER_ID][] = [
    [0, F_Cu],
    [31, B_Cu],
  ];

  for (let i = 1; i <= 30; i++) map.push([i, In_Cu(i)]);

  map.push(
    [39, F_Mask],
    [38, B_Mask],
    [37, F_SilkS],
    [36, B_SilkS],
    [33, F_Adhes],
    [32, B_Adhes],
    [35, F_Paste],
    [34, B_Paste],
    [40, Dwgs_User],
    [41, Cmts_User],
    [42, Eco1_User],
    [43, Eco2_User],
    [44, Edge_Cuts],
    [45, Margin],
    [46, B_CrtYd],
    [47, F_CrtYd],
    [48, B_Fab],
    [49, F_Fab],
  );

  for (let i = 1; i <= 9; i++) map.push([49 + i, (User_1 + (i - 1) * 2) as PCB_LAYER_ID]);

  map.push([59, Rescue]);
  return map;
})();

export function remapLegacyLayerLSET(aLegacyLSET: BASE_SET): LSET {
  const newLayers = new LSET();

  for (const [legacyLayer, newLayer] of s_legacyLayerIdMap)
    newLayers.set(newLayer, aLegacyLSET.test(legacyLayer));

  return newLayers;
}

/**
 * The parser for PCB_PLOT_PARAMS.
 *
 * The C++ is a `PCB_PLOT_PARAMS_LEXER` over the board file's line reader;
 * here it reads the board parser's own token stream.
 */
export class PCB_PLOT_PARAMS_PARSER {
  constructor(
    private readonly m_lexer: DSNLEXER,
    private readonly m_boardFileVersion: number,
  ) {}

  private NextTok(): Tok {
    return this.m_lexer.NextTok();
  }

  private CurText(): string {
    return this.m_lexer.CurText();
  }

  Parse(aPcbPlotParams: PCB_PLOT_PARAMS): void {
    let token: Tok;

    // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
    while ((token = this.NextTok()) !== T.RIGHT) {
      if (token === T.EOF) this.m_lexer.Unexpected(T.EOF);

      if (token === T.LEFT) token = this.NextTok();

      if (token === 'pcbplotparams') continue;

      let skip_right = false;

      switch (token) {
        case 'layerselection': {
          token = this.m_lexer.NeedSYMBOLorNUMBER();

          const cur = this.CurText();

          if (token === T.NUMBER) {
            // pretty 3 format had legacy Cu stack.
            //  It's not possible to convert a legacy Cu layer number to a new Cu layer
            //  number without knowing the number or total Cu layers in the legacy board.
            //  We do not have that information here, so simply set all layers ON.  User
            //  can turn them off in the UI.
            aPcbPlotParams.m_layerSelection = new LSET([F_SilkS, B_SilkS]).or(LSET.AllCuMask());
          } else if (cur.startsWith('0x')) {
            // pretty ver. 4.
            // The layers were renumbered in 5e0abadb23425765e164f49ee2f893e94ddb97fc, but there wasn't
            // a board file version change with it, so this value is the one immediately after that happened.
            if (this.m_boardFileVersion < 20240819) {
              const legacyLSET = new BASE_SET(LEGACY_PCB_LAYER_ID_COUNT);

              // skip the leading 2 0x bytes.
              legacyLSET.ParseHex(cur.slice(2));
              aPcbPlotParams.SetLayerSelection(remapLegacyLayerLSET(legacyLSET));
            } else {
              // skip the leading 2 0x bytes.
              aPcbPlotParams.m_layerSelection.ParseHex(cur.slice(2));
            }
          } else {
            this.m_lexer.Expecting('integer or hex layerSelection');
          }

          break;
        }

        case 'plot_on_all_layers_selection': {
          token = this.m_lexer.NeedSYMBOLorNUMBER();

          const cur = this.CurText();

          if (cur.startsWith('0x')) {
            let layers: LSET;

            // The layers were renumbered in 5e0abadb23425765e164f49ee2f893e94ddb97fc, but
            // there wasn't a board file version change with it, so this value is the one
            // immediately after that happened.
            if (this.m_boardFileVersion < 20240819) {
              const legacyLSET = new BASE_SET(LEGACY_PCB_LAYER_ID_COUNT);

              // skip the leading 2 0x bytes.
              legacyLSET.ParseHex(cur.slice(2));

              layers = remapLegacyLayerLSET(legacyLSET);
            } else {
              layers = new LSET();
              // skip the leading 2 0x bytes.
              layers.ParseHex(cur.slice(2));
            }

            aPcbPlotParams.SetPlotOnAllLayersSequence(layers.SeqStackupForPlotting());
          } else {
            this.m_lexer.Expecting('hex plot_on_all_layers_selection');
          }

          break;
        }

        case 'disableapertmacros':
          aPcbPlotParams.m_gerberDisableApertMacros = this.parseBool();
          break;

        case 'usegerberextensions':
          aPcbPlotParams.m_useGerberProtelExtensions = this.parseBool();
          break;

        case 'usegerberattributes':
          aPcbPlotParams.m_useGerberX2format = this.parseBool();
          break;

        case 'usegerberadvancedattributes':
          aPcbPlotParams.m_includeGerberNetlistInfo = this.parseBool();
          break;

        case 'creategerberjobfile':
          aPcbPlotParams.m_createGerberJobFile = this.parseBool();
          break;

        case 'gerberprecision':
          aPcbPlotParams.m_gerberPrecision = this.parseInt(
            gbrDefaultPrecision - 1,
            gbrDefaultPrecision,
          );
          break;

        case 'dashed_line_dash_ratio':
          aPcbPlotParams.m_dashedLineDashRatio = this.parseDouble();
          break;

        case 'dashed_line_gap_ratio':
          aPcbPlotParams.m_dashedLineGapRatio = this.parseDouble();
          break;

        case 'svgprecision':
          aPcbPlotParams.m_svgPrecision = this.parseInt(SVG_PRECISION_MIN, SVG_PRECISION_MAX);
          break;

        case 'svguseinch':
          this.parseBool(); // Unused. For compatibility
          break;

        case 'psa4output':
          aPcbPlotParams.m_A4Output = this.parseBool();
          break;

        case 'excludeedgelayer':
          if (!this.parseBool()) aPcbPlotParams.m_plotOnAllLayersSequence.push(Edge_Cuts);

          break;

        case 'plotframeref':
          aPcbPlotParams.m_plotDrawingSheet = this.parseBool();
          break;

        case 'viasonmask':
          aPcbPlotParams.m_plotViaOnMaskLayer = this.parseBool();
          break;

        case 'useauxorigin':
          aPcbPlotParams.m_useAuxOrigin = this.parseBool();
          break;

        case 'mode':
        case 'hpglpennumber':
        case 'hpglpenspeed':
        case 'hpglpenoverlay':
          // HPGL is no longer supported
          this.parseInt(-2147483648, 2147483647);
          break;

        case 'pdf_front_fp_property_popups':
          aPcbPlotParams.m_PDFFrontFPPropertyPopups = this.parseBool();
          break;

        case 'pdf_back_fp_property_popups':
          aPcbPlotParams.m_PDFBackFPPropertyPopups = this.parseBool();
          break;

        case 'pdf_metadata':
          aPcbPlotParams.m_PDFMetadata = this.parseBool();
          break;

        case 'pdf_single_document':
          aPcbPlotParams.m_PDFSingle = this.parseBool();
          break;

        case 'dxfpolygonmode':
          aPcbPlotParams.m_DXFPolygonMode = this.parseBool();
          break;

        case 'dxfimperialunits':
          aPcbPlotParams.m_DXFUnits = this.parseBool() ? DXF_UNITS.INCH : DXF_UNITS.MM;
          break;

        case 'dxfusepcbnewfont':
          aPcbPlotParams.m_textMode = this.parseBool()
            ? PLOT_TEXT_MODE.DEFAULT
            : PLOT_TEXT_MODE.NATIVE;
          break;

        case 'pscolor':
          this.m_lexer.NeedSYMBOL(); // This actually was never used...
          break;

        case 'psnegative':
          aPcbPlotParams.m_negative = this.parseBool();
          break;

        case 'plot_black_and_white':
          aPcbPlotParams.m_blackAndWhite = this.parseBool();
          break;

        case 'plotinvisibletext': // legacy token; no longer supported
          this.parseBool();
          break;

        case 'sketchpadsonfab':
          aPcbPlotParams.m_sketchPadsOnFabLayers = this.parseBool();
          break;

        case 'plotpadnumbers':
          aPcbPlotParams.m_plotPadNumbers = this.parseBool();
          break;

        case 'hidednponfab':
          aPcbPlotParams.m_hideDNPFPsOnFabLayers = this.parseBool();
          break;

        case 'sketchdnponfab':
          aPcbPlotParams.m_sketchDNPFPsOnFabLayers = this.parseBool();
          break;

        case 'crossoutdnponfab':
          aPcbPlotParams.m_crossoutDNPFPsOnFabLayers = this.parseBool();
          break;

        case 'subtractmaskfromsilk':
          aPcbPlotParams.m_subtractMaskFromSilk = this.parseBool();
          break;

        case 'outputformat':
          aPcbPlotParams.m_format = this.parseInt(
            PLOT_FORMAT.FIRST_FORMAT,
            PLOT_FORMAT.LAST_FORMAT,
          ) as PLOT_FORMAT;
          break;

        case 'mirror':
          aPcbPlotParams.m_mirror = this.parseBool();
          break;

        case 'drillshape':
          aPcbPlotParams.m_drillMarks = this.parseInt(0, 2) as DRILL_MARKS;
          break;

        case 'scaleselection':
          aPcbPlotParams.m_scaleSelection = this.parseInt(0, 4);
          break;

        case 'outputdirectory':
          this.m_lexer.NeedSYMBOLorNUMBER(); // a dir name can be like a number
          aPcbPlotParams.m_outputDirectory = this.CurText();
          break;

        default:
          this.skipCurrent(); // skip unknown or outdated plot parameter
          skip_right = true; // the closing right token is already read.
          break;
      }

      if (!skip_right) this.m_lexer.NeedRIGHT();
    }
  }

  private parseBool(): boolean {
    const token = this.m_lexer.NeedSYMBOL();

    switch (token) {
      case 'false':
      case 'no':
        return false;

      case 'true':
      case 'yes':
        return true;

      default:
        this.m_lexer.Expecting('true, false, yes, or no');
    }
  }

  /**
   * Parse an integer and constrains it between two values.
   *
   * @param aMin is the smallest return value.
   * @param aMax is the largest return value.
   * @return The parsed integer.
   */
  private parseInt(aMin: number, aMax: number): number {
    const token = this.NextTok();

    if (token !== T.NUMBER) this.m_lexer.Expecting(T.NUMBER);

    let val = Number.parseInt(this.CurText(), 10); // atoi

    if (Number.isNaN(val)) val = 0;

    if (val < aMin) val = aMin;
    else if (val > aMax) val = aMax;

    return val;
  }

  private parseDouble(): number {
    const token = this.NextTok();

    if (token !== T.NUMBER) this.m_lexer.Expecting(T.NUMBER);

    return this.m_lexer.parseDouble();
  }

  private skipCurrent(): void {
    let curr_level = 0;
    let token: Tok;

    // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
    while ((token = this.NextTok()) !== T.EOF) {
      if (token === T.LEFT) curr_level--;

      if (token === T.RIGHT) {
        curr_level++;

        if (curr_level > 0) return;
      }
    }
  }
}
