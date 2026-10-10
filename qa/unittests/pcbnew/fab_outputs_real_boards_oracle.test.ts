// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * What a factory is sent - Gerbers and Excellon drill files - for seven real boards
 * (qa/data/pcbnew/resave), against kicad-cli 10.0.6 with its defaults
 * (qa/data/pcbnew/fab_oracle/regen.sh). Every file kicad-cli writes, and no other, byte for byte
 * except the lines that name the program and the time. plot_gerber_oracle and drill_oracle cover
 * the options on one synthetic board; this covers real ones: hundreds of pads, zones, text, arcs,
 * a 4-layer board with blind spans.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GERBER_PLOTTER } from '@ziroeda/common/plotters/GERBER_plotter.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { EXCELLON_WRITER } from '@ziroeda/pcbnew/exporters/gendrill_excellon_writer.js';
import { ZEROS_FMT } from '@ziroeda/pcbnew/exporters/gendrill_writer_base.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import { PCB_PLOTTER } from '@ziroeda/pcbnew/pcb_plotter.js';
import { GetGerberProtelExtension } from '@ziroeda/pcbnew/pcbplot.js';
import { PlotBoardLayers, StartPlotBoard } from '@ziroeda/pcbnew/plot_board_layers.js';

const ORACLE = new URL('../../data/pcbnew/fab_oracle/', import.meta.url).pathname;
const BOARDS = new URL('../../data/pcbnew/resave/', import.meta.url).pathname;

const IDENTITY =
  /^(%TF\.GenerationSoftware,|G04 #@! TF\.GenerationSoftware,|%TF\.CreationDate,|G04 #@! TF\.CreationDate,|G04 Created by |; DRILL file |; #@! TF\.CreationDate,|; #@! TF\.GenerationSoftware,|Created on )/;
const normalise = (t: string): string =>
  t
    .split('\n')
    .map((l) => (IDENTITY.test(l) ? '<identity>' : l))
    .join('\n');

/** kicad-cli's `pcb export gerbers` and `pcb export drill` with no options. */
function fabricate(aName: string): Map<string, string> {
  const board = ParseBoard(readFileSync(`${BOARDS}${aName}.kicad_pcb`, 'utf8'));
  board.SetFileName(`/oracle/${aName}.kicad_pcb`);
  const out = new Map<string, string>();
  const dec = new TextDecoder();

  const params = new PCB_PLOT_PARAMS();
  params.SetFormat(PLOT_FORMAT.GERBER);
  params.SetUseGerberX2format(true);
  params.SetIncludeGerberNetlistInfo(true);
  params.SetDisableGerberMacros(false);
  params.SetGerberPrecision(6);
  params.SetUseAuxOrigin(false);
  params.SetPlotFrameRef(false);
  params.SetSubtractMaskFromSilk(false);
  // PCB_PLOTTER::PlotJobToPlotOpts: "Always disable plot pad holes" for Gerber.
  params.SetDrillMarksType(DRILL_MARKS.NO_DRILL_SHAPE);

  const wanted = new Set(readdirSync(`${ORACLE}${aName}`).map((f) => f.replace(/\.gz$/, '')));

  for (const layer of board.GetEnabledLayers().Seq()) {
    const layerName = board.GetLayerName(layer);
    const file = PCB_PLOTTER.BuildPlotFileName(aName, layerName, GetGerberProtelExtension(layer));

    if (!wanted.has(file)) continue;

    const plotter = StartPlotBoard(board, params, layer, layerName, file, '', '')!;
    PlotBoardLayers(board, plotter, [layer], params);
    plotter.EndPlot();
    out.set(file, dec.decode((plotter as GERBER_PLOTTER).bytes()));
  }

  const drill = new EXCELLON_WRITER(board);
  drill.SetFormat(true, ZEROS_FMT.DECIMAL_FORMAT, 3, 3);
  drill.SetOptions(false, false, { x: 0, y: 0 }, true);
  drill.SetRouteModeForOvalHoles(false);
  drill.SetMapFileFormat(PLOT_FORMAT.GERBER);
  drill.CreateDrillandMapFilesSet('out', true, false);

  for (const [path, bytes] of drill.GetWrittenFiles())
    out.set(path.replace(/^out\//, ''), dec.decode(bytes));

  return out;
}

const NAMES = readdirSync(ORACLE)
  .filter((f) => !f.includes('.'))
  .sort();

describe('fabrication outputs match kicad-cli on real boards', () => {
  it('has the boards', () => expect(NAMES.length).toBe(7));

  describe.each(NAMES)('%s', (aName) => {
    const ours = fabricate(aName);
    const files = readdirSync(`${ORACLE}${aName}`)
      .map((f) => f.replace(/\.gz$/, ''))
      .sort();

    it('writes exactly the drill files kicad-cli wrote', () => {
      expect([...ours.keys()].filter((f) => f.endsWith('.drl')).sort()).toEqual(
        files.filter((f) => f.endsWith('.drl')),
      );
    });

    it.each(files)('%s', (aFile) => {
      const want = gunzipSync(readFileSync(`${ORACLE}${aName}/${aFile}.gz`)).toString('utf8');
      expect(normalise(ours.get(aFile) ?? '<not written>')).toBe(normalise(want));
    });
  });
});
