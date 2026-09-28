// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Gerber output against KiCad's own: `qa/data/pcbnew/plot/gerber_oracle/`
 * holds what `kicad-cli pcb export gerbers` (10.0.6) wrote for
 * `gerber_oracle.kicad_pcb` (its README has the commands). The same board goes
 * through StartPlotBoard -> PlotBoardLayers -> GERBER_PLOTTER
 * here and every file must match byte for byte, except the three lines that
 * name the program and the time (and, with the frame, the title block's
 * `${KICAD_VERSION}`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import { PCB_PLOTTER } from '@ziroeda/pcbnew/pcb_plotter.js';
import { PlotBoardLayers, StartPlotBoard } from '@ziroeda/pcbnew/plot_board_layers.js';
import { GetGerberProtelExtension } from '@ziroeda/pcbnew/pcbplot.js';
import type { GERBER_PLOTTER } from '@ziroeda/common/plotters/GERBER_plotter.js';

const DIR = resolve(__dirname, '../../data/pcbnew/plot');

/** The lines that name the program and the moment: ours say ZiroEDA and now. */
const IDENTITY =
  /^(%TF\.GenerationSoftware,|G04 #@! TF\.GenerationSoftware,|%TF\.CreationDate,|G04 #@! TF\.CreationDate,|G04 Created by )/;

const normalise = (text: string): string =>
  text
    .split('\n')
    .map((line) => (IDENTITY.test(line) ? line.replace(/,.*|by .*/, ',<identity>') : line))
    .filter((line) => !inVersionText(line))
    .join('\n');

/**
 * The title block's `${KICAD_VERSION}` text names the program ("KiCad E.D.A.
 * 10.0.6" there, ours here), so its strokes are dropped: every draw inside its
 * cell, x 177.0 .. 215.0 mm, y 194.6 .. 197.5 mm (the page is A4, 4.6 format).
 */
function inVersionText(aLine: string): boolean {
  const m = /^X(-?\d+)Y(-?\d+)D0[12]\*$/.exec(aLine);
  if (!m) return false;
  const x = Number(m[1]) / 1e6;
  const y = -Number(m[2]) / 1e6;
  return x > 177.0 && x < 215.0 && y > 194.6 && y < 197.5;
}

const LAYERS: Record<string, PCB_LAYER_ID> = {
  F_Cu: PCB_LAYER_ID.F_Cu,
  In1_Cu: PCB_LAYER_ID.In1_Cu,
  In2_Cu: PCB_LAYER_ID.In2_Cu,
  B_Cu: PCB_LAYER_ID.B_Cu,
  F_Mask: PCB_LAYER_ID.F_Mask,
  B_Mask: PCB_LAYER_ID.B_Mask,
  F_Paste: PCB_LAYER_ID.F_Paste,
  F_Silkscreen: PCB_LAYER_ID.F_SilkS,
  B_Silkscreen: PCB_LAYER_ID.B_SilkS,
  Edge_Cuts: PCB_LAYER_ID.Edge_Cuts,
  F_Fab: PCB_LAYER_ID.F_Fab,
  F_Courtyard: PCB_LAYER_ID.F_CrtYd,
  User_Drawings: PCB_LAYER_ID.Dwgs_User,
};

/** kicad-cli's defaults for `pcb export gerbers` (JOB_EXPORT_PCB_GERBERS). */
function cliParams(aVariant: string): PCB_PLOT_PARAMS {
  const params = new PCB_PLOT_PARAMS();
  params.SetFormat(PLOT_FORMAT.GERBER);
  params.SetUseGerberX2format(aVariant !== 'nox2');
  params.SetIncludeGerberNetlistInfo(aVariant !== 'nonetlist');
  params.SetDisableGerberMacros(aVariant === 'nomacros');
  params.SetGerberPrecision(aVariant === 'prec5' ? 5 : 6);
  params.SetUseAuxOrigin(aVariant === 'auxorigin');
  params.SetPlotFrameRef(aVariant === 'frame');
  params.SetSubtractMaskFromSilk(false);
  // PCB_PLOTTER::PlotJobToPlotOpts: "Always disable plot pad holes" for Gerber.
  params.SetDrillMarksType(DRILL_MARKS.NO_DRILL_SHAPE);
  return params;
}

/**
 * `PCBNEW_JOBS_HANDLER::JobExportGerbers`, which is what kicad-cli runs: per
 * layer, `StartPlotBoard( brd, &plotOpts, layer, layerName, path, sheetName,
 * sheetPath )` with the page arguments at their defaults, `PlotBoardLayers`
 * over the layer, `EndPlot`. (The plot dialog runs PCB_PLOTTER instead, which
 * numbers the pages; plot_board_layers.test.ts drives that.)
 */
function plot(aVariant: string, aLayers: PCB_LAYER_ID[]): Map<string, string> {
  const board = ParseBoard(readFileSync(resolve(DIR, 'gerber_oracle.kicad_pcb'), 'utf8'));
  board.SetFileName('/oracle/gerber_oracle.kicad_pcb');

  const out = new Map<string, string>();
  const params = cliParams(aVariant);

  for (const layer of aLayers) {
    const layerName = board.GetLayerName(layer);
    const fileName = PCB_PLOTTER.BuildPlotFileName(
      'gerber_oracle',
      layerName,
      GetGerberProtelExtension(layer),
    );
    const plotter = StartPlotBoard(board, params, layer, layerName, fileName, '', '');

    expect(plotter).not.toBeNull();
    PlotBoardLayers(board, plotter!, [layer], params);
    plotter!.EndPlot();
    out.set(fileName, new TextDecoder().decode((plotter as GERBER_PLOTTER).bytes()));
  }

  return out;
}

describe('Gerber output matches kicad-cli byte for byte', () => {
  for (const variant of readdirSync(resolve(DIR, 'gerber_oracle'))) {
    if (variant.includes('.')) continue; // README.md, regen.sh

    const expectedFiles = readdirSync(resolve(DIR, 'gerber_oracle', variant))
      .filter((f) => !f.endsWith('.gbrjob'))
      .sort();
    const layers = expectedFiles.map((f) => {
      const key = f.replace(/^gerber_oracle-/, '').replace(/\.[^.]+$/, '');
      const layer = LAYERS[key];
      if (layer === undefined) throw new Error(`no layer for ${f}`);
      return layer;
    });

    describe(variant, () => {
      const plotted = plot(variant, layers);

      for (const file of expectedFiles) {
        it(file, () => {
          const expected = readFileSync(resolve(DIR, 'gerber_oracle', variant, file), 'utf8');
          expect(normalise(plotted.get(file) ?? '<not plotted>')).toBe(normalise(expected));
        });
      }
    });
  }
});
