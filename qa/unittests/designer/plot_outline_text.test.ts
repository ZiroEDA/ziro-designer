// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A faced text plots from the same glyph polygons it is drawn with.
 *
 * `PLOTTER::PlotText` hands `FONT::Draw` a `CALLBACK_GAL` whose polygon
 * callback is `PlotPoly` (common/plotters/plotter.cpp:746-756), so every
 * plotter receives an outline glyph as filled polygons — and
 * `qa/data/font/fonttest_kicad_cli.svg` is exactly that output from
 * kicad-cli. These tests plot the same sheet through our SVG and PostScript
 * back-ends and read the ink back in millimetres: a plot that fell back to
 * the stroke font, or filled a glyph's hole, or forgot one of the SCH_TEXT
 * lifts, lands in a different place on the page.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { sheetToPs, sheetToSvg } from '@ziroeda/designer/src/editors/schematic/render/plot.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import {
  getOutlineFont,
  installOutlineFontProvider,
  loadOutlineFontsFor,
  resetOutlineFonts,
  setFaceFetcher,
} from '@ziroeda/designer/src/font/outline_fonts.js';

const FONTS = fileURLToPath(new URL('../../../designer/public/fonts/', import.meta.url));
const DATA = fileURLToPath(new URL('../../data/font/', import.meta.url));

const doc = readSchematic(parse(readFileSync(`${DATA}fonttest.kicad_sch`, 'utf8')));
const opts = { color: false, drawingSheet: false, background: false };

/** The `<text>` hint kicad-cli writes before each run, and the run's ink. */
function kicadRow(text: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const svg = readFileSync(`${DATA}fonttest_kicad_cli.svg`, 'utf8');
  const i = svg.indexOf(`<desc>${text}</desc>`);
  expect(i, `kicad-cli plotted "${text}"`).toBeGreaterThan(0);
  const block = svg.slice(i, svg.indexOf('</g>', i));
  const nums = [...block.matchAll(/(-?\d+\.\d+)[ ,]+(-?\d+\.\d+)/g)];
  const xs = nums.map((n) => Number(n[1]));
  const ys = nums.map((n) => Number(n[2]));
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * A path's points in page mm. `SvgContext` writes a path in the frame it
 * was drawn in and defers the CTM to a `transform="matrix(…)"`, so the
 * matrix is applied here; the viewBox is IU, 10000 per mm.
 */
function pathPointsMM(d: string, transform: string | undefined): { x: number; y: number }[] {
  const m = transform
    ? transform
        .match(/matrix\(([^)]+)\)/)![1]!
        .trim()
        .split(/\s+/)
        .map(Number)
    : [1, 0, 0, 1, 0, 0];
  const [a, b, c, dd, e, f] = m as [number, number, number, number, number, number];
  return [...d.matchAll(/(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g)].map((n) => {
    const x = Number(n[1]);
    const y = Number(n[2]);
    return { x: (a * x + c * y + e) / 10000, y: (b * x + dd * y + f) / 10000 };
  });
}

function extents(pts: { x: number; y: number }[]) {
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** Our SVG's filled paths, in page mm. */
function ourFilledPaths(svg: string) {
  const out = [];
  for (const m of svg.matchAll(
    /<path d="([^"]+)" fill="[^"]+" stroke="none"(?: transform="([^"]+)")?\/>/g,
  )) {
    const pts = pathPointsMM(m[1]!, m[2]);
    if (pts.length) out.push({ d: m[1]!, ...extents(pts) });
  }
  return out;
}

/** Our SVG's stroked paths, in page mm. */
function ourStrokedPaths(svg: string) {
  const out = [];
  for (const m of svg.matchAll(
    /<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="[^"]+"[^>]*?(?: transform="([^"]+)")?\/>/g,
  )) {
    const pts = pathPointsMM(m[1]!, m[2]);
    if (pts.length) out.push({ d: m[1]!, pts, ...extents(pts) });
  }
  return out;
}

beforeAll(async () => {
  setFaceFetcher(async (file) => {
    const b = readFileSync(FONTS + file);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  resetOutlineFonts();
  installOutlineFontProvider();
  await loadOutlineFontsFor([doc]);
});

describe('plotting a faced text', () => {
  it('loadOutlineFontsFor leaves every face the sheet names ready', () => {
    for (const [face, bold, italic] of [
      ['Arial', false, false],
      ['Arial', true, false],
      ['Arial', false, true],
      ['DejaVu Sans', false, true],
      ['Liberation Mono', false, false],
      ['Times New Roman', false, false],
      ['Nonexistent Face', false, false],
    ] as const)
      expect(getOutlineFont(face, bold, italic), `${face} ${bold} ${italic}`).not.toBeNull();
  });

  it('the SVG carries the Arial row as filled polygons where kicad-cli puts them', () => {
    const svg = sheetToSvg(doc, KICAD_DEFAULT, opts);
    const k = kicadRow('Arial Hello AVWo 0123');
    // The row's glyphs: one filled path per text, inside its band on the page.
    const paths = ourFilledPaths(svg).filter(
      (p) => p.minY > k.minY - 1 && p.maxY < k.maxY + 1 && p.minX > 20 && p.maxX < 70,
    );
    expect(paths.length).toBe(1);
    const minX = Math.min(...paths.map((p) => p.minX));
    const maxX = Math.max(...paths.map((p) => p.maxX));
    const minY = Math.min(...paths.map((p) => p.minY));
    const maxY = Math.max(...paths.map((p) => p.maxY));
    // A hinted pixel at 358 ppem, in mm, over 21 glyphs of run.
    const px = (1.4 * 2.54) / 358;
    expect(Math.abs(minX - k.minX)).toBeLessThan(px);
    expect(Math.abs(maxX - k.maxX)).toBeLessThan(3 * px);
    // The vertical position is the whole point: anchor − 0.25 − 0.4318 − 0.573.
    expect(Math.abs(minY - k.minY)).toBeLessThan(px);
    expect(Math.abs(maxY - k.maxY)).toBeLessThan(px);
  });

  it('the stroke-font row is still strokes, and sits 0.25 mm above its anchor as SCH_TEXT does', () => {
    const svg = sheetToSvg(doc, KICAD_DEFAULT, opts);
    const k = kicadRow('Stroke font AVWo 0123');
    // No filled path in that band: Newstroke is stroked.
    const filled = ourFilledPaths(svg).filter((p) => p.minY > k.minY - 1 && p.maxY < k.maxY + 1);
    expect(filled).toEqual([]);
    // The stroked segments of the row, in mm.
    const ys: number[] = [];
    for (const p of ourStrokedPaths(svg))
      if (p.minX > 25 && p.maxX < 75 && p.minY > k.minY - 0.5 && p.maxY < k.maxY + 0.5)
        ys.push(...p.pts.map((q) => q.y));
    expect(ys.length).toBeGreaterThan(20);
    // kicad-cli plots a stroke glyph as stroked polylines, so its extents are
    // centre-lines like ours; the lowest point is the baseline, and it is
    // 0.6897 mm above the 81.28 anchor — 0.25 + 0.4318 + 0.052 × pen.
    expect(Math.abs(Math.max(...ys) - k.maxY)).toBeLessThan(0.01);
  });

  it('PostScript fills a glyph with every ring in one path, so a hole stays a hole', () => {
    const ps = sheetToPs(doc, KICAD_DEFAULT, opts, 'fonttest');
    // The Arial row's 'o' and '0's: a `fill` with two subpaths. Count fills
    // whose path holds more than one `m` (moveto) — those are ringed glyphs.
    const fills = ps.split('\n').filter((l) => l.endsWith(' fill'));
    const ringed = fills.filter((l) => (l.match(/ m /g) ?? []).length > 1);
    expect(ringed.length).toBeGreaterThan(5);
    // …and every such fill opened exactly one path.
    for (const l of ringed) expect((l.match(/newpath/g) ?? []).length).toBe(1);
  });
});
