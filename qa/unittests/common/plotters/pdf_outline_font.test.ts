// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PDF_PLOTTER::Text with an outline font: the CIDFontType2 / Type0 pair
 * pdf_outline_font.cpp builds, for "Mo" in DejaVu Sans Mono. kicad-cli never
 * reaches this path from a board (pcbnew strokes a non-embedded outline font
 * into polygons first), so the expectations are the C++ formulas applied to the
 * font's own numbers, read with fontTools rather than through our face:
 * unitsPerEm 2048, advance 1233, gid 48 ('M') and 82 ('o'), hhea 1901 / -483,
 * head bbox -1144 -767 1470 2106, post.isFixedPitch 1, OS/2 fsType 0.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/eda_text.js';
import { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { parseOutlineFace } from '@ziroeda/common/font/outline_face.js';
import { OUTLINE_FONT } from '@ziroeda/common/font/outline_font.js';
import { COLOR4D_BLACK } from '@ziroeda/common/gal/color4d.js';
import { PDF_PLOTTER, pdfRenderSettings } from '@ziroeda/common/plotters/PDF_plotter.js';
import { plotterFont, plotterPageInfo } from '@ziroeda/common/plotters/plotter.js';

const FILE = fileURLToPath(
  new URL('../../../../designer/public/fonts/DejaVuSansMono.ttf', import.meta.url),
);

function plot(): string {
  const bytes = readFileSync(FILE);
  const face = parseOutlineFace(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const saved = OUTLINE_FONT.faceSource;
  OUTLINE_FONT.faceSource = () => ({ face, fileName: FILE, fakeBold: false, fakeItalic: false });

  try {
    const font = OUTLINE_FONT.LoadFont('DejaVu Sans Mono', false, false, null, false)!;
    const plotter = new PDF_PLOTTER(pdfRenderSettings(), (b) => b, { debugPdfWriter: true });
    plotter.SetPageSettings(plotterPageInfo({ sizeMils: { x: 11693, y: 8268 } }));
    plotter.SetViewport({ x: 0, y: 0 }, 2540, 1, false);
    plotter.OpenFile('t.pdf');
    plotter.StartPlot('1');
    plotter.Text(
      { x: 254000, y: 254000 },
      COLOR4D_BLACK,
      'Mo',
      ANGLE_0,
      { x: 20000, y: 20000 },
      GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT,
      GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM,
      2000,
      false,
      false,
      false,
      plotterFont(font, METRICS.Default()),
    );
    plotter.EndPlot();
    return plotter.text();
  } finally {
    OUTLINE_FONT.faceSource = saved;
  }
}

describe('PDF outline font (pdf_outline_font.cpp)', () => {
  const pdf = plot();

  it('shows the word as two-byte CIDs in the Type 0 font', () => {
    expect(pdf).toMatch(/\/KiCadOutline0 \S+ Tf <00010002> Tj ET\nQ\n/);
    expect(pdf).toContain('/KiCadOutline0 ');
  });

  it('writes the CIDFontType2 widths with the 0.0072 * 2.25 fudge', () => {
    // 1233 * 1000 / 2048 = 602.0508; / 0.0162 = 37163.6 -> lrint 37164
    expect(pdf).toContain('/W [ 1 [ 37164 37164 ] ]');
    expect(pdf).toContain('/BaseFont /AAAAAA+DejaVu-Sans-Mono');
  });

  it('describes the face in PDF units', () => {
    expect(pdf).toContain(
      '/FontName /AAAAAA+DejaVu-Sans-Mono\n/Flags 33\n/ItalicAngle 0\n/Ascent 928.223\n' +
        '/Descent -235.84\n/CapHeight 1028.32\n/StemV 80\n' +
        '/FontBBox [ -558.594 -374.512 717.773 1028.32 ]\n',
    );
  });

  it('maps CIDs to glyphs and back to text', () => {
    expect(pdf).toContain('stream\n\u0000\u0000\u00000\u0000R\nendstream');
    expect(pdf).toContain('2 beginbfchar\n<0001> <004D>\n<0002> <006F>\nendbfchar');
  });

  it('embeds the font file whole', () => {
    const size = readFileSync(FILE).length;
    expect(pdf).toMatch(new RegExp(`\\n${size}\\nendobj`));
  });
});
