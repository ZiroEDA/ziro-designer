// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Gerber output against KiCad's own: `qa/data/pcbnew/plot/gerber_oracle/`
 * holds what `kicad-cli pcb export gerbers` (10.0.6) wrote for
 * `gerber_oracle.kicad_pcb` (its README has the commands). The same board goes
 * through PCB_PLOTTER -> StartPlotBoard -> PlotBoardLayers -> GERBER_PLOTTER
 * here and every file must match byte for byte, except the three lines that
 * name the program and the time.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import { PCB_PLOTTER } from '@ziroeda/pcbnew/pcb_plotter.js';

const DIR = resolve(__dirname, '../../data/pcbnew/plot');

/** The lines that name the program and the moment: ours say ZiroEDA and now. */
const IDENTITY =
  /^(%TF\.GenerationSoftware,|G04 #@! TF\.GenerationSoftware,|%TF\.CreationDate,|G04 #@! TF\.CreationDate,|G04 Created by )/;

const normalise = (text: string): string =>
  text
    .split('\n')
    .map((line) => (IDENTITY.test(line) ? line.replace(/,.*|by .*/, ',<identity>') : line))
    .join('\n');

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
  params.SetSubtractMaskFromSilk(false);
  // PCB_PLOTTER::PlotJobToPlotOpts: "Always disable plot pad holes" for Gerber.
  params.SetDrillMarksType(DRILL_MARKS.NO_DRILL_SHAPE);
  return params;
}

function plot(aVariant: string, aLayers: PCB_LAYER_ID[]): Map<string, string> {
  const board = ParseBoard(readFileSync(resolve(DIR, 'gerber_oracle.kicad_pcb'), 'utf8'));
  board.SetFileName('/oracle/gerber_oracle.kicad_pcb');

  const out = new Map<string, string>();
  const plotter = new PCB_PLOTTER(board, null, cliParams(aVariant));
  const { success } = plotter.Plot('out', aLayers, [], true, (path, bytes) => {
    out.set(path.replace(/^out\//, ''), new TextDecoder().decode(bytes));
  });

  expect(success).toBe(true);
  return out;
}

describe('Gerber output matches kicad-cli byte for byte', () => {
  for (const variant of readdirSync(resolve(DIR, 'gerber_oracle'))) {
    if (variant.includes('.')) continue; // README.md, regen.sh

    const expectedFiles = readdirSync(resolve(DIR, 'gerber_oracle', variant)).sort();
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
