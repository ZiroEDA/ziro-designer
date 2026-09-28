// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_PLOTTER` — `pcbnew/pcb_plotter.cpp` / `.h`: plot a list of board
 * layers to one file per layer, the loop DIALOG_PLOT and `kicad-cli pcb export
 * gerbers` both run.
 *
 * Divergences:
 * - **No filesystem.** Each finished file is handed to `aWriteFile` with the
 *   path upstream would have written it to.
 * - **Gerber only**, as `StartPlotBoard` (plot_board_layers.ts) is; the PDF
 *   single-document and DXF multi-layer branches are therefore not here.
 * - The Gerber job file (`GERBER_JOBFILE_WRITER`) is written by the caller:
 *   `Plot` returns the layer / file name pairs `AddGbrFile` would have been fed.
 */

import { ExpandTextVars } from '@ziroeda/common/common.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { LSEQ } from '@ziroeda/common/lseq.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { GERBER_PLOTTER } from '@ziroeda/common/plotters/GERBER_plotter.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import {
  type Reporter,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
} from '@ziroeda/common/reporter.js';
import type { BOARD } from './board.js';
import type { PCB_PLOT_PARAMS } from './pcb_plot_params.js';
import { GetGerberProtelExtension } from './pcbplot.js';
import { PlotBoardLayers, StartPlotBoard } from './plot_board_layers.js';

/** `GetDefaultPlotExtension` for the one format PCB_PLOTTER drives here. */
const GERBER_EXTENSION = 'gbr';

/** A plotted file: the layer and the file's full name (`jobfile_writer->AddGbrFile`). */
export interface PCB_PLOTTED_FILE {
  layer: PCB_LAYER_ID;
  fullName: string;
}

export class PCB_PLOTTER {
  protected m_board: BOARD;
  protected m_plotOpts: PCB_PLOT_PARAMS;
  protected m_reporter: Reporter | null;

  constructor(aBoard: BOARD, aReporter: Reporter | null, aParams: PCB_PLOT_PARAMS) {
    this.m_board = aBoard;
    this.m_plotOpts = aParams;
    this.m_reporter = aReporter;
  }

  /**
   * Plot each of `aLayersToPlot` (with `aCommonLayers` drawn on every one) to
   * its own file under `aOutputPath`.
   *
   * @param aWriteFile receives each finished file (upstream's fopen / fclose).
   * @param aDate is "now" for the Gerber header dates; upstream reads the clock.
   */
  Plot(
    aOutputPath: string,
    aLayersToPlot: LSEQ,
    aCommonLayers: LSEQ,
    aUseGerberFileExtensions: boolean,
    aWriteFile: (aFullPath: string, aBytes: Uint8Array) => void,
    aDate: Date = new Date(),
  ): { success: boolean; files: PCB_PLOTTED_FILE[] } {
    const files: PCB_PLOTTED_FILE[] = [];

    // sanity, ensure one layer to print
    if (aLayersToPlot.length < 1) {
      this.m_reporter?.report('No layers selected for plotting.', RPT_SEVERITY_ERROR);
      return { success: false, files };
    }

    if (this.m_plotOpts.GetFormat() !== PLOT_FORMAT.GERBER) {
      this.m_reporter?.report('Only Gerber plotting is available.', RPT_SEVERITY_ERROR);
      return { success: false, files };
    }

    const layersToPlot = aLayersToPlot;
    const commonLayers = aCommonLayers;

    // Skip the disabled copper layers and build the layer ID -> layer name mapping for plotter
    // DXF plotter will use this information to name its layers
    const layersToExport: [PCB_LAYER_ID, string][] = [];

    for (const layer of layersToPlot) {
      if (this.copperLayerShouldBeSkipped(layer)) continue;

      layersToExport.push([layer, this.m_board.GetLayerName(layer)]);
    }

    let fileExt = GERBER_EXTENSION;
    let success = true;
    let pageNum = 1;

    for (const layer of layersToPlot) {
      if (this.copperLayerShouldBeSkipped(layer)) continue;

      const plotSequence = PCB_PLOTTER.getPlotSequence(layer, commonLayers);
      const layerName = this.m_board.GetLayerName(layer);

      // Use Gerber Extensions based on layer number
      // (See http://en.wikipedia.org/wiki/Gerber_File)
      if (aUseGerberFileExtensions) fileExt = GetGerberProtelExtension(layer);

      const brdName = fileNameOf(this.m_board.GetFileName()).name;
      const fullName = PCB_PLOTTER.BuildPlotFileName(brdName, layerName, fileExt);
      const fullPath = aOutputPath ? `${aOutputPath.replace(/\/+$/, '')}/${fullName}` : fullName;

      files.push({ layer, fullName });

      this.m_plotOpts.SetLayersToExport(layersToExport);
      const plotter = StartPlotBoard(
        this.m_board,
        this.m_plotOpts,
        layer,
        layerName,
        fullPath,
        layerName,
        '',
        layerName,
        String(pageNum), // this will only be used by pdf
        layersToExport.length,
        aDate,
      );

      if (plotter) {
        plotter.SetLayer(String(layer));
        const board = this.m_board;
        plotter.SetTitle(
          ExpandTextVars(board.GetTitleBlock().GetTitle(), (token) =>
            board.ResolveTextVar(token, 0),
          ),
        );

        try {
          PlotBoardLayers(this.m_board, plotter, plotSequence, this.m_plotOpts);
          // (PlotInteractiveLayer: PDF only.)
          plotter.EndPlot();
        } catch (e) {
          console.error(e);
          success = false;
          break;
        }

        aWriteFile(fullPath, (plotter as GERBER_PLOTTER).bytes());

        this.m_reporter?.report(`Plotted to '${fullPath}'.`, RPT_SEVERITY_ACTION);
      } else {
        this.m_reporter?.report(`Failed to create file '${fullPath}'.`, RPT_SEVERITY_ERROR);

        success = false;
      }

      pageNum++;
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

/** `wxFileName( path ).GetName()`: the last component without its extension. */
function fileNameOf(aPath: string): { name: string } {
  const full = aPath.split(/[\\/]/).pop() ?? '';
  const dot = full.lastIndexOf('.');

  return { name: dot > 0 ? full.slice(0, dot) : full };
}
