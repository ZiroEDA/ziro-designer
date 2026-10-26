// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_PLOTTER` on the live schematic, plotting to SVG as `kicad-cli sch export svg` does
 * (EESCHEMA_JOBS_HANDLER::JobExportPlot), byte for byte. qa/data/eeschema/plot_live holds wires
 * (a dashed one, a coloured dotted one, a crossing), junctions (a default and a coloured one),
 * no-connects, a bus with two entries, symbols rotated, mirrored and DNP, a power symbol with a
 * hidden reference, a polyline, a filled rectangle, a circle and a text. Each golden_* folder is
 * kicad-cli 10.0.6's output for the flags it is named after:
 *
 *   golden          (none)
 *   golden_bw       --black-and-white
 *   golden_nosheet  --exclude-drawing-sheet --no-background-color
 *   golden_hopover  --draw-hop-over
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KICAD_FONT_NAME } from '@ziroeda/common/font/font.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { LoadSchematic } from '@ziroeda/eeschema/eeschema_helpers.js';
import type { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { SCH_PLOT_OPTS, SCH_PLOTTER } from '@ziroeda/eeschema/sch_plotter.js';
import { SCH_RENDER_SETTINGS } from '@ziroeda/eeschema/sch_render_settings.js';
import { SCH_SCREENS } from '@ziroeda/eeschema/sch_screen.js';
import { describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '../../data/eeschema/plot_live');

const defaultTheme = COLOR_SETTINGS.CreateBuiltinColorSettings().find(
  (c) => c.GetFilename() === COLOR_SETTINGS.COLOR_BUILTIN_DEFAULT,
)!;

/** `EESCHEMA_JOBS_HANDLER::getSchematic`: the file loaded as kicad-cli loads it. */
function load(): SCHEMATIC {
  const pro = join(DIR, 'plot.kicad_pro');
  const project = new PROJECT();
  project.setProjectFullName(pro);
  const file = new PROJECT_FILE(pro);
  project.setProjectFile(file);
  file.LoadFromFile(JSON.parse(readFileSync(pro, 'utf8')) as never);

  return LoadSchematic(join(DIR, 'plot.kicad_sch'), project, (p) =>
    existsSync(p) ? readFileSync(p, 'utf8') : null,
  )!;
}

/** `EESCHEMA_JOBS_HANDLER::InitRenderSettings`, then the job's font and minimum pen width. */
function renderSettingsFor(aSch: SCHEMATIC): SCH_RENDER_SETTINGS {
  const rs = new SCH_RENDER_SETTINGS();
  rs.LoadColors(defaultTheme);
  rs.m_ShowHiddenPins = false;
  rs.m_ShowHiddenFields = false;
  rs.m_ShowPinAltIcons = false;

  const settings = aSch.Settings();
  rs.SetDefaultPenWidth(settings.m_DefaultLineWidth);
  rs.m_LabelSizeRatio = settings.m_LabelSizeRatio;
  rs.m_TextOffsetRatio = settings.m_TextOffsetRatio;
  rs.m_PinSymbolSize = settings.m_PinSymbolSize;
  rs.SetDashLengthRatio(settings.m_DashedLineDashRatio);
  rs.SetGapLengthRatio(settings.m_DashedLineGapRatio);

  rs.SetDefaultFont(KICAD_FONT_NAME);
  rs.SetMinPenWidth(847); // JOB_EXPORT_SCH_PLOT::m_minPenWidth, "hairline @ 300dpi"

  const screens = new SCH_SCREENS(aSch.Root());

  for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
    for (const item of screen.Items()) item.ClearCaches();
  }

  return rs;
}

/**
 * The file without the one text naming the program: `${KICAD_VERSION}` is KiCad's product name
 * upstream and ours here (ds_draw_item.ts), so its invisible `<text>` and stroked glyphs go.
 */
function withoutProgramName(aSvg: string): string {
  const out: string[] = [];
  let skipping = false;

  for (const line of aSvg.split('\n')) {
    if (/>KiCad E\.D\.A\. [^<]*<\/text>|>ZiroEDA<\/text>/.test(line)) {
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

  return out.join('\n');
}

/** The golden, and the local time it was plotted at (its `<title>` date). */
function golden(aFolder: string): { text: string; date: Date } {
  const text = readFileSync(resolve(DIR, aFolder, 'plot.svg'), 'utf8');
  const stamp = /date (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d) /.exec(text)![1]!;
  return { text, date: new Date(stamp) };
}

function plot(aFolder: string, aOpts: (o: SCH_PLOT_OPTS) => void = () => {}): void {
  const sch = load();
  const { text, date } = golden(aFolder);
  const opts = new SCH_PLOT_OPTS();
  aOpts(opts);

  const plotter = new SCH_PLOTTER(sch);
  plotter.m_plotDate = date;
  plotter.Plot(PLOT_FORMAT.SVG, opts, renderSettingsFor(sch));

  expect(plotter.m_outputs.map((o) => o.fileName)).toEqual(['plot.svg']);
  expect(withoutProgramName(plotter.m_outputs[0]!.text)).toBe(withoutProgramName(text));
}

describe('SCH_PLOTTER::Plot, SVG, against kicad-cli', () => {
  it('colour, drawing sheet and background', () => plot('golden'));

  it('black and white', () =>
    plot('golden_bw', (o) => {
      o.m_blackAndWhite = true;
    }));

  it('no drawing sheet, no background', () =>
    plot('golden_nosheet', (o) => {
      o.m_plotDrawingSheet = false;
      o.m_useBackgroundColor = false;
    }));

  it('hop-overs at the wire crossing', () =>
    plot('golden_hopover', (o) => {
      o.m_plotHopOver = true;
    }));
});
