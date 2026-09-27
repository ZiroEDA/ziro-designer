// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PDF text against KiCad's own: `qa/data/pcbnew/plot/pdf_text/pdf_text.pdf`
 * is kicad-cli's plot of four silkscreen texts (plain, rotated and
 * anisotropic, bold italic, markup with overbar / subscript / superscript).
 * The same board goes through BRDITEMS_PLOTTER into PDF_PLOTTER here, driven
 * as StartPlotBoard / PCB_PLOTTER drive it for a black-and-white PDF, and every
 * object must match: the page stream with its `BT … ET` runs, each Type 3
 * stroke-font subset's glyph procedures, widths, encoding and ToUnicode map,
 * and the font resource dictionary. Streams are compared inflated; the Info
 * dictionary (producer, clock) is skipped.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PDF_PLOTTER } from '@ziroeda/common/plotters/PDF_plotter.js';
import { COLOR4D_BLACK } from '@ziroeda/common/gal/color4d.js';
import { PCB_RENDER_SETTINGS } from '@ziroeda/pcbnew/pcb_painter.js';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import { BRDITEMS_PLOTTER } from '@ziroeda/pcbnew/plot_brditems_plotter.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';

const DIR = resolve(__dirname, '../../../data/pcbnew/plot/pdf_text');

/** Object number -> { body, stream } of a PDF, streams inflated when compressed. */
function objects(aPdf: Buffer): Map<number, { body: string; stream: string | null }> {
  const out = new Map<number, { body: string; stream: string | null }>();
  const text = aPdf.toString('latin1');
  const re = /(\d+) 0 obj\n([\s\S]*?)endobj\n/g;

  for (let m = re.exec(text); m; m = re.exec(text)) {
    const body = m[2]!;
    const s = /^([\s\S]*?)stream\n([\s\S]*)\nendstream\n$/.exec(body);

    if (!s) {
      out.set(Number(m[1]), { body, stream: null });
      continue;
    }

    const raw = Buffer.from(s[2]!, 'latin1');
    const compressed = s[1]!.includes('/FlateDecode');
    const stream = (compressed ? inflateSync(raw) : raw).toString('latin1');
    out.set(Number(m[1]), { body: s[1]!.replace(' /Filter /FlateDecode', ''), stream });
  }

  return out;
}

function plotOurs(): Buffer {
  const board = ParseBoard(readFileSync(resolve(DIR, 'pdf_text.kicad_pcb'), 'utf8'));
  board.SetFileName('/oracle/pdf_text.kicad_pcb');

  // StartPlotBoard( PDF ): the render settings and initializePlotter's viewport.
  const renderSettings = new PCB_RENDER_SETTINGS();
  renderSettings.SetDefaultPenWidth(pcbIUScale.mmToIU(0.0212)); // Hairline at 1200dpi
  renderSettings.SetLayerName('F.Silkscreen');

  const plotter = new PDF_PLOTTER(renderSettings, (b) => b, { debugPdfWriter: true });
  plotter.SetPageSettings(board.GetPageSettings());
  plotter.SetViewport({ x: 0, y: 0 }, pcbIUScale.IU_PER_MILS / 10, 1, false);
  plotter.SetCreator('PCBNEW');
  plotter.SetColorMode(false); // --black-and-white
  plotter.OpenFile('pdf_text.pdf');
  plotter.StartPlot('1', 'F.Silkscreen');

  // PlotOneBoardLayer -> PlotStandardLayer: the board's drawings.
  const params = new PCB_PLOT_PARAMS();
  const itemplotter = new BRDITEMS_PLOTTER(plotter, board, params);
  itemplotter.SetLayerSet(new LSET([PCB_LAYER_ID.F_SilkS]));
  plotter.SetColor(COLOR4D_BLACK);

  for (const item of board.Drawings()) itemplotter.PlotBoardGraphicItem(item);

  // PlotBoardLayers: the drill marks (--drill-shape-opt defaults to 2, full size).
  params.SetDrillMarksType(DRILL_MARKS.FULL_DRILL_SHAPE);
  const drillplotter = new BRDITEMS_PLOTTER(plotter, board, params);
  drillplotter.SetLayerSet(new LSET([PCB_LAYER_ID.F_SilkS]));
  drillplotter.PlotDrillMarks();

  plotter.EndPlot();
  return Buffer.from(plotter.bytes());
}

describe('PDF text matches kicad-cli object for object', () => {
  const expected = objects(readFileSync(resolve(DIR, 'pdf_text.pdf')));
  const actual = objects(plotOurs());

  it('has the same object numbers', () => {
    expect([...actual.keys()].sort((a, b) => a - b)).toEqual(
      [...expected.keys()].sort((a, b) => a - b),
    );
  });

  for (const [n, want] of expected) {
    // The Info dictionary names the program and the clock.
    if (want.body.includes('/Producer')) continue;
    // A stream's deferred /Length is the compressed size.
    if (want.stream === null && /^\d+\n$/.test(want.body)) continue;

    it(`object ${n}`, () => {
      const got = actual.get(n);
      expect((got?.stream ?? got?.body ?? '').split('\n')).toEqual(
        (want.stream ?? want.body).split('\n'),
      );
    });
  }
});
