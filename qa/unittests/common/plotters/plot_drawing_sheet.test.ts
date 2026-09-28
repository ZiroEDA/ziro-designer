// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PlotDrawingSheet` against KiCad's own: `qa/data/eeschema/plot_sheet/` holds
 * what `kicad-cli sch export svg --black-and-white` (10.0.6) writes for an
 * empty A4 sheet with a title block - nothing but the drawing sheet. The same
 * page and title block go through PlotDrawingSheet into SVG_PLOTTER, set up as
 * SCH_PLOTTER::plotOneSheetSVG sets it up, and the file must match line for
 * line but for the `<title>` (file name and clock) and the one text that names
 * the program (`${KICAD_VERSION}`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { COLOR4D_BLACK } from '@ziroeda/common/gal/color4d.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import {
  GetDefaultPlotExtension,
  PlotDrawingSheet,
} from '@ziroeda/common/plotters/common_plot_functions.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { SVG_PLOTTER } from '@ziroeda/common/plotters/SVG_plotter.js';
import { plotterRenderSettings } from '@ziroeda/common/render_settings.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';

const DIR = resolve(__dirname, '../../../data/eeschema/plot_sheet');

/** Drop the lines naming the program, the file and the clock. */
function normalise(aSvg: string): string[] {
  const lines = aSvg.split('\n');
  const out: string[] = [];
  let skipping = false;

  for (const line of lines) {
    if (line.startsWith('<title>')) continue;
    // The ${KICAD_VERSION} text: its invisible <text>, then its stroked glyphs.
    if (/>KiCad E\.D\.A\. [^<]*<\/text>|>ZiroEDA[^<]*<\/text>/.test(line)) {
      out.pop(); // the <text ...> head
      out.pop();
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.startsWith('</g>')) skipping = false;
      continue;
    }
    out.push(line);
  }

  return out;
}

function plotOurs(): string {
  // SCH_RENDER_SETTINGS' default pen: the schematic's default line width, 6 mils.
  const plotter = new SVG_PLOTTER(
    plotterRenderSettings({ defaultPenWidth: schIUScale.milsToIU(6) }),
  );
  const page = new PAGE_INFO(PAGE_SIZE_TYPE.A4);
  const titleBlock = new TITLE_BLOCK();
  titleBlock.SetTitle('Frame Oracle');
  titleBlock.SetDate('2026-09-28');
  titleBlock.SetRevision('C');
  titleBlock.SetCompany('Test Co');
  titleBlock.SetComment(0, 'first comment');

  plotter.SetPageSettings(page);
  plotter.SetColorMode(false);
  plotter.SetViewport({ x: 0, y: 0 }, schIUScale.IU_PER_MILS / 10, 1, false);
  plotter.SetCreator('Eeschema-SVG');
  plotter.OpenFile('sheet.svg');
  plotter.StartPlot('1');
  PlotDrawingSheet(
    plotter,
    null,
    titleBlock,
    page,
    null,
    '1',
    1,
    '',
    '/',
    'sheet.kicad_sch',
    COLOR4D_BLACK,
    true,
  );
  plotter.EndPlot();
  return plotter.text();
}

describe('PlotDrawingSheet matches kicad-cli', () => {
  it('plots the default drawing sheet and title block as kicad-cli does', () => {
    const expected = readFileSync(resolve(DIR, 'sheet.svg'), 'utf8');
    expect(normalise(plotOurs())).toEqual(normalise(expected));
  });

  it('names the default extension of every format', () => {
    expect(GetDefaultPlotExtension(PLOT_FORMAT.GERBER)).toBe('gbr');
    expect(GetDefaultPlotExtension(PLOT_FORMAT.PDF)).toBe('pdf');
    expect(GetDefaultPlotExtension(PLOT_FORMAT.SVG)).toBe('svg');
    expect(GetDefaultPlotExtension(PLOT_FORMAT.DXF)).toBe('dxf');
    expect(GetDefaultPlotExtension(PLOT_FORMAT.POST)).toBe('ps');
    expect(GetDefaultPlotExtension(PLOT_FORMAT.HPGL)).toBe('');
  });
});
