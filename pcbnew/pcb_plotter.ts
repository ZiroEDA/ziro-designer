// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_PLOTTER` — `pcbnew/pcb_plotter.cpp` / `.h`: plot a list of board
 * layers, one file per layer or (PDF single document, DXF multi-layer) one
 * file for them all; the loop DIALOG_PLOT and `kicad-cli pcb export
 * gerbers|pdf|svg|dxf|ps` both run.
 *
 * Divergences:
 * - **No filesystem.** Each finished file, the Gerber job file included, is
 *   handed to `aWriteFile` with the path upstream would have written it to.
 * - "Now" (Gerber / SVG / PS / job-file dates) comes in as `aDate`, and the PDF
 *   stream compressor through `SetPdfDeflate` (none: uncompressed streams).
 * - `Plot` also returns the layer / file name pairs it fed `AddGbrFile`.
 */

import { ExpandTextVars } from '@ziroeda/common/common.js';
import type { OutStr } from '@ziroeda/common/font/font.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { LSEQ } from '@ziroeda/common/lseq.js';
import { LSET } from '@ziroeda/common/lset.js';
import { GetDefaultPlotExtension } from '@ziroeda/common/plotters/common_plot_functions.js';
import type { PdfDeflate, PDF_PLOTTER } from '@ziroeda/common/plotters/PDF_plotter.js';
import { PLOT_FORMAT, type PLOTTER } from '@ziroeda/common/plotters/plotter.js';
import {
  type Reporter,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
} from '@ziroeda/common/reporter.js';
import { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from './board.js';
import { GERBER_JOBFILE_WRITER } from './exporters/gerber_jobfile_writer.js';
import type { PCB_PLOT_PARAMS } from './pcb_plot_params.js';
import { GetGerberProtelExtension } from './pcbplot.js';
import {
  PlotBoardLayers,
  PlotInteractiveLayer,
  StartPlotBoard,
  setupPlotterNewPDFPage,
} from './plot_board_layers.js';

/** A plotted file: the layer and the file's full name (`jobfile_writer->AddGbrFile`). */
export interface PCB_PLOTTED_FILE {
  layer: PCB_LAYER_ID;
  fullName: string;
}

/** Upstream's optional overrides of `Plot`. */
export interface PCB_PLOT_NAMES {
  aOutputPathIsSingle?: boolean;
  aLayerName?: string;
  aSheetName?: string;
  aSheetPath?: string;
}

/** A plotter's finished document (every PLOTTER here keeps its file in memory). */
function plotterBytes(aPlotter: PLOTTER): Uint8Array {
  return (aPlotter as unknown as { bytes(): Uint8Array }).bytes();
}

export class PCB_PLOTTER {
  protected m_board: BOARD;
  protected m_plotOpts: PCB_PLOT_PARAMS;
  protected m_reporter: Reporter | null;
  protected m_pdfDeflate: PdfDeflate | null = null;

  constructor(aBoard: BOARD, aReporter: Reporter | null, aParams: PCB_PLOT_PARAMS) {
    this.m_board = aBoard;
    this.m_plotOpts = aParams;
    this.m_reporter = aReporter;
  }

  /** The PDF page-stream compressor (upstream links zlib). */
  SetPdfDeflate(aDeflate: PdfDeflate | null): void {
    this.m_pdfDeflate = aDeflate;
  }

  /**
   * Plot each of `aLayersToPlot` (with `aCommonLayers` drawn on every one).
   *
   * @param aWriteFile receives each finished file (upstream's fopen / fclose).
   * @param aDate is "now" for the file dates; upstream reads the clock.
   */
  Plot(
    aOutputPath: string,
    aLayersToPlot: LSEQ,
    aCommonLayers: LSEQ,
    aUseGerberFileExtensions: boolean,
    aWriteFile: (aFullPath: string, aBytes: Uint8Array) => void,
    aDate: Date = new Date(),
    aNames: PCB_PLOT_NAMES = {},
  ): { success: boolean; files: PCB_PLOTTED_FILE[] } {
    const files: PCB_PLOTTED_FILE[] = [];
    const board = this.m_board;
    const textResolver = (token: OutStr): boolean =>
      // Handles board->GetTitleBlock() *and* board->GetProject()
      board.ResolveTextVar(token, 0);
    const aOutputPathIsSingle = aNames.aOutputPathIsSingle ?? false;

    // sanity, ensure one layer to print
    if (aLayersToPlot.length < 1) {
      this.m_reporter?.report('No layers selected for plotting.', RPT_SEVERITY_ERROR);
      return { success: false, files };
    }

    const existingPageInfo = new PAGE_INFO();
    existingPageInfo.assign(board.GetPageSettings());
    const existingAuxOrigin = { ...board.GetDesignSettings().GetAuxOrigin() };

    // Page is board boundary size
    if (this.m_plotOpts.GetFormat() === PLOT_FORMAT.SVG && this.m_plotOpts.GetSvgFitPagetoBoard()) {
      let bbox = board.ComputeBoundingBox(false, false);
      const boardOutlines = new SHAPE_POLY_SET();

      // Board outline geometry is better if it exists so that origin is not influenced by
      // Edge.Cuts line width
      if (board.GetBoardPolygonOutlines(boardOutlines, false) && boardOutlines.OutlineCount() > 0)
        bbox = boardOutlines.BBox();

      const currPageInfo = new PAGE_INFO();
      currPageInfo.assign(board.GetPageSettings());

      currPageInfo.SetWidthMils(bbox.GetWidth() / pcbIUScale.IU_PER_MILS);
      currPageInfo.SetHeightMils(bbox.GetHeight() / pcbIUScale.IU_PER_MILS);

      board.SetPageSettings(currPageInfo);
      this.m_plotOpts.SetUseAuxOrigin(true);

      board.GetDesignSettings().SetAuxOrigin(bbox.GetOrigin());
    }

    // To reuse logic, in single plot mode, we want to kick any extra layers from the main list
    // to commonLayers
    let layersToPlot: PCB_LAYER_ID[];
    let commonLayers: PCB_LAYER_ID[];

    const isPdfMultiPage =
      this.m_plotOpts.GetFormat() === PLOT_FORMAT.PDF && this.m_plotOpts.m_PDFSingle;

    if (
      aOutputPathIsSingle &&
      !this.m_plotOpts.GetDXFMultiLayeredExportOption() &&
      !isPdfMultiPage
    ) {
      layersToPlot = [aLayersToPlot[0]!];
      commonLayers = [...aLayersToPlot.slice(1)];
    } else {
      layersToPlot = [...aLayersToPlot];
      commonLayers = [...aCommonLayers];
    }

    let finalPageCount = 0;
    const layersToExport: [PCB_LAYER_ID, string][] = [];

    // Skip the disabled copper layers and build the layer ID -> layer name mapping for plotter
    // DXF plotter will use this information to name its layers
    for (const layer of layersToPlot) {
      if (this.copperLayerShouldBeSkipped(layer)) continue;

      finalPageCount++;
      layersToExport.push([layer, board.GetLayerName(layer)]);
    }

    let jobfile_writer: GERBER_JOBFILE_WRITER | null = null;

    if (this.m_plotOpts.GetFormat() === PLOT_FORMAT.GERBER && !aOutputPathIsSingle)
      jobfile_writer = new GERBER_JOBFILE_WRITER(board, this.m_reporter);

    const plot_format = this.m_plotOpts.GetFormat();
    let fileExt = GetDefaultPlotExtension(plot_format);
    let sheetPath = '';
    let success = true;
    let plotter: PLOTTER | null = null;
    let pageNum = 1;
    const pdfSingle = plot_format === PLOT_FORMAT.PDF && this.m_plotOpts.m_PDFSingle;
    const dxfMulti =
      plot_format === PLOT_FORMAT.DXF && this.m_plotOpts.GetDXFMultiLayeredExportOption();
    const brdName = fileNameOf(board.GetFileName()).name;

    for (let i = 0; i < layersToPlot.length; i++) {
      const layer = layersToPlot[i]!;

      if (this.copperLayerShouldBeSkipped(layer)) continue;

      const plotSequence = PCB_PLOTTER.getPlotSequence(layer, commonLayers);
      let layerName = board.GetLayerName(layer);
      let fullName: string;
      let fullPath: string;

      if (aOutputPathIsSingle) {
        fullPath = aOutputPath;
        fullName = aOutputPath.split(/[\/]/).pop() ?? aOutputPath;
      } else {
        // Use Gerber Extensions based on layer number
        // (See http://en.wikipedia.org/wiki/Gerber_File)
        if (plot_format === PLOT_FORMAT.GERBER && aUseGerberFileExtensions)
          fileExt = GetGerberProtelExtension(layer);

        if (pdfSingle) fullName = `${brdName}.${GetDefaultPlotExtension(PLOT_FORMAT.PDF)}`;
        else if (dxfMulti) fullName = `${brdName}.${GetDefaultPlotExtension(PLOT_FORMAT.DXF)}`;
        else fullName = PCB_PLOTTER.BuildPlotFileName(brdName, layerName, fileExt);

        fullPath = joinPath(aOutputPath, fullName);
      }

      files.push({ layer, fullName });
      jobfile_writer?.AddGbrFile(layer, fullName);

      if ((!pdfSingle && !dxfMulti) || pageNum === 1) {
        // this will only be used by pdf
        const pageNumber = String(pageNum);
        let pageName = layerName;
        let sheetName = layerName;

        if (aNames.aLayerName !== undefined) {
          layerName = aNames.aLayerName;
          pageName = aNames.aLayerName;
        }

        if (aNames.aSheetName !== undefined) sheetName = aNames.aSheetName;

        if (aNames.aSheetPath !== undefined) sheetPath = aNames.aSheetPath;

        this.m_plotOpts.SetLayersToExport(layersToExport);
        plotter = StartPlotBoard(
          board,
          this.m_plotOpts,
          layer,
          layerName,
          fullPath,
          sheetName,
          sheetPath,
          pageName,
          pageNumber,
          finalPageCount,
          aDate,
          this.m_pdfDeflate,
        );
      }

      if (plotter) {
        plotter.SetLayer(layer);
        plotter.SetTitle(ExpandTextVars(board.GetTitleBlock().GetTitle(), textResolver));

        if (this.m_plotOpts.m_PDFMetadata) {
          const author: OutStr = { value: 'AUTHOR' };

          if (board.ResolveTextVar(author, 0)) plotter.SetAuthor(author.value);

          const subject: OutStr = { value: 'SUBJECT' };

          if (board.ResolveTextVar(subject, 0)) plotter.SetSubject(subject.value);
        }

        try {
          PlotBoardLayers(board, plotter, plotSequence, this.m_plotOpts);
          PlotInteractiveLayer(board, plotter, this.m_plotOpts);
        } catch (e) {
          console.error(e);
          success = false;
          break;
        }

        if (pdfSingle && pageNum !== finalPageCount) {
          const pageNumber = String(pageNum + 1);
          let nextI = i + 1;
          let nextLayer = layersToPlot[nextI]!;

          while (this.copperLayerShouldBeSkipped(nextLayer) && nextI < layersToPlot.length - 1) {
            ++nextI;
            nextLayer = layersToPlot[nextI]!;
          }

          layerName = board.GetLayerName(nextLayer);

          const pageName = layerName;
          const sheetName = layerName;

          (plotter as PDF_PLOTTER).ClosePage();
          (plotter as PDF_PLOTTER).StartPage(pageNumber, pageName);
          setupPlotterNewPDFPage(
            plotter,
            board,
            this.m_plotOpts,
            layerName,
            sheetName,
            sheetPath,
            pageNumber,
            finalPageCount,
          );
        }

        // last page
        if (
          (!pdfSingle && !dxfMulti) ||
          i === aLayersToPlot.length - 1 ||
          pageNum === finalPageCount
        ) {
          try {
            plotter.EndPlot();
            aWriteFile(fullPath, plotterBytes(plotter));
          } catch (e) {
            console.error(e);
            success = false;
          }

          plotter = null;

          this.m_reporter?.report(`Plotted to '${fullPath}'.`, RPT_SEVERITY_ACTION);
        }
      } else {
        this.m_reporter?.report(`Failed to create file '${fullPath}'.`, RPT_SEVERITY_ERROR);

        success = false;
      }

      pageNum++;
    }

    if (jobfile_writer && this.m_plotOpts.GetCreateGerberJobFile()) {
      // Build gerber job file from basename
      const jobPath = joinPath(
        aOutputPath,
        PCB_PLOTTER.BuildPlotFileName(brdName, 'job', 'gbrjob'),
      );
      jobfile_writer.SetDate(aDate);
      jobfile_writer.SetFileSink(aWriteFile);
      jobfile_writer.CreateJobFile(jobPath);
    }

    this.m_reporter?.report('Done.', RPT_SEVERITY_INFO);

    if (this.m_plotOpts.GetFormat() === PLOT_FORMAT.SVG && this.m_plotOpts.GetSvgFitPagetoBoard()) {
      // restore the original page and aux origin
      board.SetPageSettings(existingPageInfo);
      board.GetDesignSettings().SetAuxOrigin(existingAuxOrigin);
    }

    return { success, files };
  }

  /**
   * `BuildPlotFileName`: the board's base name, a `-suffix` made safe for a file
   * name, and the extension.
   */
  static BuildPlotFileName(aBaseName: string, aSuffix: string, aExtension: string): string {
    // remove leading and trailing spaces if any from the suffix, if
    // something survives add it to the name;
    // also the suffix can contain some not allowed chars in filename (/ \ . : and some others),
    // so change them to underscore
    let suffix = aSuffix.trim();

    // wxFileName::GetForbiddenChars( wxPATH_DOS ), plus "%."
    const badchars = '/\\:*?"<>|%.';

    for (const c of badchars) suffix = suffix.replaceAll(c, '_');

    const name = suffix !== '' ? `${aBaseName}-${suffix}` : aBaseName;

    return aExtension !== '' ? `${name}.${aExtension}` : name;
  }

  /** The layer to plot first, then every common layer not already in the sequence. */
  static getPlotSequence(aLayerToPlot: PCB_LAYER_ID, aPlotWithAllLayersSeq: LSEQ): LSEQ {
    const plotSequence: PCB_LAYER_ID[] = [];

    // Base layer always gets plotted first.
    plotSequence.push(aLayerToPlot);

    for (const layer of aPlotWithAllLayersSeq) {
      // Don't plot the same layer more than once;
      if (plotSequence.includes(layer)) continue;

      plotSequence.push(layer);
    }

    return plotSequence;
  }

  protected copperLayerShouldBeSkipped(aLayerToPlot: PCB_LAYER_ID): boolean {
    return LSET.AllCuMask()
      .and(new LSET(this.m_board.GetEnabledLayers()).flip())
      .test(aLayerToPlot);
  }
}

/** `wxFileName::Assign( aPath, aName )`: the directory joined to the file name. */
function joinPath(aPath: string, aName: string): string {
  return aPath ? `${aPath.replace(/\/+$/, '')}/${aName}` : aName;
}

/** `wxFileName( path ).GetName()`: the last component without its extension. */
function fileNameOf(aPath: string): { name: string } {
  const full = aPath.split(/[\\/]/).pop() ?? '';
  const dot = full.lastIndexOf('.');

  return { name: dot > 0 ? full.slice(0, dot) : full };
}
