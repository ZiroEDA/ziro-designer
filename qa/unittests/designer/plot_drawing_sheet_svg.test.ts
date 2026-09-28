// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic plot draws its page frame through `PlotDrawingSheet`, as
 * `SCH_PLOTTER::plotOneSheetSVG` does. `qa/data/eeschema/plot_sheet/sheet.svg`
 * is `kicad-cli sch export svg --black-and-white` (10.0.6) of an empty A4 sheet
 * with a title block, so the whole file is the drawing sheet; ours must match
 * it line for line but for the `<title>` (file name and clock) and the one text
 * that names the program (`${KICAD_VERSION}`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { sheetToSvg } from '@ziroeda/designer/src/editors/schematic/render/plot.js';
import { KICAD_DEFAULT } from '@ziroeda/eeschema/sch_render_settings.js';

const DIR = resolve(__dirname, '../../data/eeschema/plot_sheet');

/** Drop the lines naming the program, the file and the clock. */
function normalise(aSvg: string): string[] {
  const out: string[] = [];
  let skipping = false;

  for (const line of aSvg.split('\n')) {
    if (line.startsWith('<title>')) continue;
    // The ${KICAD_VERSION} text: its invisible <text>, then its stroked glyphs.
    if (/>KiCad E\.D\.A\. [^<]*<\/text>|>ZiroEDA[^<]*<\/text>/.test(line)) {
      out.pop();
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

describe('the schematic plot frames the page with PlotDrawingSheet', () => {
  it('matches kicad-cli for an empty sheet with a title block', () => {
    const text = readFileSync(resolve(DIR, 'sheet.kicad_sch'), 'utf8');
    const sch = { ...readSchematic(parse(text)), fileName: 'sheet.kicad_sch' };

    const svg = sheetToSvg(
      sch,
      KICAD_DEFAULT,
      // The plot dialog's default "Minimum line width" is the schematic's 6 mils.
      { color: false, drawingSheet: true, background: false, defaultPenIU: 1524 },
      { fileName: 'sheet.svg' },
    );

    expect(normalise(svg)).toEqual(normalise(readFileSync(resolve(DIR, 'sheet.svg'), 'utf8')));
  });
});
