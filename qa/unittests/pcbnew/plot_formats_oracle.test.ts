// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SVG, PDF, PostScript and DXF board plots against KiCad's own:
 * `qa/data/pcbnew/plot/fmt_oracle/` holds what `kicad-cli pcb export
 * svg|pdf|ps|dxf` (10.0.6) wrote for `gerber_oracle.kicad_pcb` (regen.sh has
 * the commands). The same board goes through PCB_PLOTTER::Plot, with the plot
 * options PCB_PLOTTER::PlotJobToPlotOpts builds from each command line, and
 * every file must match line for line, except the lines that name the program
 * and the moment. PDFs are compared object for object with streams inflated.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { setFromHexString } from '@ziroeda/common/gal/color4d.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { DXF_UNITS, DXF_OUTLINE_MODE, PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import { PCB_PLOTTER } from '@ziroeda/pcbnew/pcb_plotter.js';

const DIR = resolve(__dirname, '../../data/pcbnew/plot');
const ORACLE = resolve(DIR, 'fmt_oracle');

interface CliSet {
  format: PLOT_FORMAT;
  layers: string[];
  /** `aOutputPathIsSingle`, with the file name the command was given. */
  single?: string;
  opts: (aOpts: PCB_PLOT_PARAMS) => void;
}

/** regen.sh, one entry per line of it. */
const SETS: Record<string, CliSet> = {
  svg: {
    format: PLOT_FORMAT.SVG,
    layers: ['F.Cu', 'F.SilkS'],
    opts: (o) => {
      o.SetBlackAndWhite(true);
      o.SetPlotFrameRef(true);
    },
  },
  svgc: {
    format: PLOT_FORMAT.SVG,
    layers: ['F.Cu', 'B.Cu', 'F.Mask', 'F.Fab'],
    opts: (o) => o.SetPlotFrameRef(true),
  },
  svgfit: {
    format: PLOT_FORMAT.SVG,
    layers: ['F.Cu', 'Edge.Cuts'],
    opts: (o) => o.SetSvgFitPageToBoard(true),
  },
  pdf: {
    format: PLOT_FORMAT.PDF,
    layers: ['F.Cu', 'F.Fab'],
    opts: (o) => o.SetBlackAndWhite(true),
  },
  pdfmulti: {
    format: PLOT_FORMAT.PDF,
    layers: ['F.Cu', 'B.Cu', 'F.SilkS'],
    single: 'gerber_oracle.pdf',
    opts: (o) => {
      o.m_PDFSingle = true;
      o.SetPDFBackgroundColor(setFromHexString('#102030')!);
    },
  },
  ps: {
    format: PLOT_FORMAT.POST,
    layers: ['F.Cu', 'B.SilkS'],
    opts: (o) => o.SetBlackAndWhite(true),
  },
  psc: { format: PLOT_FORMAT.POST, layers: ['F.Cu'], opts: () => {} },
  dxf: {
    format: PLOT_FORMAT.DXF,
    layers: ['F.Cu', 'Edge.Cuts'],
    opts: (o) => o.SetPlotValue(false),
  },
  dxfc: {
    format: PLOT_FORMAT.DXF,
    layers: ['F.Cu', 'F.SilkS'],
    opts: (o) => {
      o.SetPlotValue(false);
      o.SetDXFPlotUnits(DXF_UNITS.MM);
      o.SetDXFPlotMode(DXF_OUTLINE_MODE.SKETCH);
      o.SetDXFPlotPolygonMode(true);
    },
  },
  dxfsingle: {
    format: PLOT_FORMAT.DXF,
    layers: ['F.Cu', 'Edge.Cuts', 'F.SilkS'],
    single: 'gerber_oracle.dxf',
    opts: (o) => {
      o.SetPlotValue(false);
      o.SetDXFMultiLayeredExportOption(true);
    },
  },
};

/**
 * `PCB_PLOTTER::PlotJobToPlotOpts` for these command lines. The CLI defaults
 * (job_export_pcb_*.cpp, command_pcb_export_*.cpp): scale 1, full drill marks,
 * SVG precision 4, DXF in inches with polygon mode off unless `--use-contours`,
 * DXF values off (the command reads `--exclude-value` un-negated), the DNP
 * options off, and `_builtin_default` colours (`-t`, the COLOR_SETTINGS default).
 */
function cliParams(aSet: CliSet, aLayers: PCB_LAYER_ID[]): PCB_PLOT_PARAMS {
  const o = new PCB_PLOT_PARAMS();
  o.SetScale(1);
  o.SetAutoScale(false);
  o.SetDrillMarksType(DRILL_MARKS.FULL_DRILL_SHAPE);

  if (aSet.format === PLOT_FORMAT.SVG) o.SetSvgPrecision(4);

  if (aSet.format === PLOT_FORMAT.DXF) {
    o.SetDXFPlotUnits(DXF_UNITS.INCH);
    o.SetDXFPlotMode(DXF_OUTLINE_MODE.FILLED);
    o.SetDXFPlotPolygonMode(false);
    o.SetDXFMultiLayeredExportOption(false);
  }

  if (aSet.format === PLOT_FORMAT.PDF) {
    o.m_PDFFrontFPPropertyPopups = true;
    o.m_PDFBackFPPropertyPopups = true;
    o.m_PDFMetadata = true;
    o.m_PDFSingle = false;
  }

  if (aSet.format === PLOT_FORMAT.POST) {
    o.SetWidthAdjust(Math.round(0 * pcbIUScale.IU_PER_MM));
    o.SetFineScaleAdjustX(1);
    o.SetFineScaleAdjustY(1);
  }

  o.SetUseAuxOrigin(false);
  o.SetPlotFrameRef(false);
  o.SetSubtractMaskFromSilk(false);
  o.SetPlotReference(true);
  o.SetPlotValue(true);
  o.SetSketchPadsOnFabLayers(false);
  o.SetHideDNPFPsOnFabLayers(false);
  o.SetSketchDNPFPsOnFabLayers(false);
  o.SetCrossoutDNPFPsOnFabLayers(false);
  o.SetPlotPadNumbers(false);
  o.SetBlackAndWhite(false);
  o.SetMirror(false);
  o.SetNegative(false);
  o.SetLayerSelection(new LSET(aLayers));
  o.SetPlotOnAllLayersSequence([]);
  o.SetFormat(aSet.format);
  aSet.opts(o);
  return o;
}

/** The lines that name the program or the moment. */
const IDENTITY = [
  /^<title>SVG Image created as .* date .*<\/title>$/,
  /^%%Creator: /, // PS
  /^%%CreationDate: /,
];

/**
 * The drawing sheet's `${KICAD_VERSION}` text names the program ("KiCad
 * E.D.A. 10.0.6" there, ours here): SVG_PLOTTER writes it as a hidden `<text>`
 * (three lines) and then a `<g class="stroked-text">` of its strokes, which
 * closes on a line that also opens the next element. Both are dropped.
 */
function dropVersionText(aLines: string[]): string[] {
  const out: string[] = [];

  for (let i = 0; i < aLines.length; i++) {
    if (!/>(KiCad E\.D\.A\. [^<]*|ZiroEDA[^<]*)<\/text>$/.test(aLines[i]!)) {
      out.push(aLines[i]!);
      continue;
    }

    out.splice(-2, 2); // `<text x= y=` and `textLength=`

    while (i < aLines.length && !aLines[i]!.startsWith('</g>')) i++;

    out.push(aLines[i]!.slice('</g>'.length));
  }

  return out;
}

const normaliseText = (aText: string): string[] =>
  dropVersionText(aText.split('\n')).map((l) =>
    IDENTITY.some((re) => re.test(l)) ? '<identity>' : l,
  );

/** Object number -> body or inflated stream; the Info dictionary dropped. */
function pdfObjects(aPdf: Uint8Array): Map<number, string> {
  const out = new Map<number, string>();
  const text = Buffer.from(aPdf).toString('latin1');
  const re = /(\d+) 0 obj\n([\s\S]*?)endobj\n/g;

  for (let m = re.exec(text); m; m = re.exec(text)) {
    // The Info dictionary names the program and the clock; its title, creator,
    // author and subject stay.
    const body = m[2]!.replace(/^\/(Producer|CreationDate) .*$/gm, '/$1 <identity>');
    // A deferred /Length is the compressed size.
    if (/^\d+\n$/.test(body)) continue;

    const s = /^([\s\S]*?)stream\n([\s\S]*)\nendstream\n$/.exec(body);

    if (!s) {
      out.set(Number(m[1]), body);
      continue;
    }

    const raw = Buffer.from(s[2]!, 'latin1');
    const compressed = s[1]!.includes('/FlateDecode');
    const stream = (compressed ? inflateSync(raw) : raw).toString('latin1');
    out.set(Number(m[1]), `${s[1]!.replace(' /Filter /FlateDecode', '')}stream\n${stream}`);
  }

  return out;
}

function plot(aName: string, aSet: CliSet): Map<string, Uint8Array> {
  const board = ParseBoard(readFileSync(resolve(DIR, 'gerber_oracle.kicad_pcb'), 'utf8'));
  board.SetFileName('/oracle/gerber_oracle.kicad_pcb');

  const layers = aSet.layers.map((l) => LSET.NameToLayer(l) as PCB_LAYER_ID);
  const out = new Map<string, Uint8Array>();
  const plotter = new PCB_PLOTTER(board, null, cliParams(aSet, layers));
  const { success } = plotter.Plot(
    aSet.single ? `${aName}/${aSet.single}` : aName,
    layers,
    [],
    false,
    (path, bytes) => out.set(path, bytes),
    new Date(0),
    { aOutputPathIsSingle: aSet.single !== undefined },
  );

  expect(success).toBe(true);
  return out;
}

describe('board plots match kicad-cli', () => {
  for (const [name, set] of Object.entries(SETS)) {
    describe(name, () => {
      const plotted = plot(name, set);
      const expectedFiles = readdirSync(resolve(ORACLE, name)).sort();

      it('writes the same files', () => {
        expect([...plotted.keys()].sort()).toEqual(expectedFiles.map((f) => `${name}/${f}`));
      });

      for (const file of expectedFiles) {
        const path = resolve(ORACLE, name, file);
        if (!statSync(path).isFile()) continue;

        it(file, () => {
          const want = new Uint8Array(readFileSync(path));
          const got = plotted.get(`${name}/${file}`) ?? new Uint8Array();

          if (set.format === PLOT_FORMAT.PDF) {
            const w = pdfObjects(want);
            const g = pdfObjects(got);
            expect([...g.keys()]).toEqual([...w.keys()]);
            for (const [n, body] of w)
              expect([n, ...(g.get(n) ?? '').split('\n')]).toEqual([n, ...body.split('\n')]);
            return;
          }

          const dec = new TextDecoder();
          expect(normaliseText(dec.decode(got))).toEqual(normaliseText(dec.decode(want)));
        });
      }
    });
  }
});
