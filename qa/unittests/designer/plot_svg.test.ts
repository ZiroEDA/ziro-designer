// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Plot to SVG (DIALOG_PLOT_SCHEMATIC, SVG format): the vector plotter drives the
 * on-screen schematic renderer through a Canvas2D-shaped adapter that records
 * every draw as SVG markup. A schematic with a symbol and a wire must produce a
 * well-formed SVG whose page matches the paper size and whose geometry shows up
 * as `<path>` elements.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { sheetToSvg, pageIU } from '@ziroeda/designer/src/editors/schematic/render/plot.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (pin_numbers hide) (pin_names (offset 0))
      (property "Reference" "R" (at 2.032 0 90))
      (property "Value" "R" (at 0 0 90))
      (symbol "R_0_1"
        (rectangle (start -1.016 -2.54) (end 1.016 2.54)
          (stroke (width 0.254) (type default)) (fill (type none))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27))))))))
  (wire (pts (xy 100 100) (xy 120 100)) (stroke (width 0) (type default)) (uuid "w-1"))
  (symbol (lib_id "Device:R") (at 100 90 0) (uuid "sym-1")
    (property "Reference" "R1" (at 102 88 0))
    (property "Value" "10k" (at 102 92 0))))`;

describe('plot to SVG', () => {
  it('renders a well-formed SVG at the page size with vector geometry', () => {
    const doc = readSchematic(parse(SCH));
    const svg = sheetToSvg(doc, KICAD_DEFAULT, {
      color: true,
      drawingSheet: true,
      background: false,
    });

    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // A4 landscape is 297.0022 x 210.0072 mm, NOT a clean 297 x 210.
    //
    // Re-derived, not re-baselined. `SVG_PLOTTER::StartPlot` writes the page
    // from `m_paperSize = m_pageInfo.GetSizeMils()`
    // (`common/plotters/SVG_plotter.cpp:190`, `:798-800`), and `PAGE_INFO`
    // stores A4 as **11693 x 8268 mils** — 11693 x 0.0254 = 297.0022. KiCad's
    // own SVG for an A4 sheet says 297.002mm.
    //
    // This read 297 because the schematic renderer carried a private paper
    // table with the rounded metric numbers in it; `common/src/page_info.ts`
    // derives mm from the mils, which is the chain KiCad computes.
    expect(svg).toContain('width="297.002mm"');
    expect(svg).toContain('height="210.007mm"');
    expect(svg).toContain(`viewBox="0 0 ${pageIU(doc).w} ${pageIU(doc).h}"`);
    // Wire + symbol body + drawing-sheet border all emit paths/rects.
    expect(svg).toContain('<path');
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(3);
  });

  it('black-and-white output uses only black strokes', () => {
    const doc = readSchematic(parse(SCH));
    const svg = sheetToSvg(doc, KICAD_DEFAULT, {
      color: false,
      drawingSheet: false,
      background: false,
    });
    expect(svg).toContain('stroke="rgb(0, 0, 0)"');
    // The green wire colour from the theme must not appear in B&W.
    expect(svg).not.toContain('rgb(0, 150, 0)');
  });

  it('honours a portrait custom-oriented page size', () => {
    const doc = readSchematic(parse(SCH.replace('(paper "A4")', '(paper "A3" portrait)')));
    const svg = sheetToSvg(doc, KICAD_DEFAULT, {
      color: true,
      drawingSheet: false,
      background: false,
    });
    // A3 portrait swaps the landscape pair: 16535 x 11693 mils becomes
    // 11693 x 16535, i.e. 297.0022 x 419.989 mm.
    expect(svg).toContain('width="297.002mm"');
    expect(svg).toContain('height="419.989mm"');
  });
});
