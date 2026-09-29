// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Plot to DXF and PostScript (DIALOG_PLOT_SCHEMATIC, DXF / Postscript formats):
 * the schematic renderer's draws reach the common `DXF_PLOTTER` and
 * `PS_PLOTTER` — the classes `SCH_PLOTTER::plotOneSheetDXF` / `…PS` plot
 * through — with every point resolved through the CTM to page IU. The
 * expectations are read off `kicad-cli sch export dxf / ps` of this sheet
 * (10.0.5).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { sheetToDxf, sheetToPs } from '@ziroeda/eeschema/sch_plotter.js';
import { KICAD_DEFAULT } from '@ziroeda/eeschema/sch_render_settings.js';

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

describe('plot to DXF', () => {
  const doc = readSchematic(parse(SCH));
  // "Export units: Millimeters" — what kicad-cli writes, which has no units flag.
  const dxf = sheetToDxf(doc, KICAD_DEFAULT, {
    color: true,
    drawingSheet: true,
    background: false,
    dxfUnits: 'mm',
  });

  it('is the DXF_PLOTTER AC1018 file, header to EOF', () => {
    expect(dxf.startsWith('  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1018\n')).toBe(true);
    expect(dxf).toContain('  0\nSECTION\n  2\nENTITIES\n');
    expect(dxf.endsWith('  0\nENDSEC\n  0\nEOF\n')).toBe(true);
  });

  it('plots the wire as the LINE entity kicad-cli writes', () => {
    // Byte for byte kicad-cli's wire: DXF_PLOTTER has no paper, so y is the
    // negated page y, and the layer is the ACAD colour nearest the wire's
    // green (0, 150, 0) — LIGHTGREEN.
    expect(dxf).toContain(
      '  8\nLIGHTGREEN\n  6\nCONTINUOUS\n100\nAcDbLine\n' +
        ' 10\n100.\n 20\n-100.\n 30\n0\n 11\n120.\n 21\n-100.\n 31\n0\n',
    );
    expect((dxf.match(/\n {2}0\nLINE\n/g) ?? []).length).toBeGreaterThan(3);
  });

  it('honours "Export units: Millimeters" vs Inches ($INSUNITS + coordinates)', () => {
    expect(dxf).toContain('  9\n$MEASUREMENT\n  70\n1\n  9\n$INSUNITS\n  70\n4\n'); // mm
    const inches = sheetToDxf(doc, KICAD_DEFAULT, {
      color: true,
      drawingSheet: true,
      background: false,
      dxfUnits: 'in',
    });
    expect(inches).toContain('  9\n$MEASUREMENT\n  70\n0\n  9\n$INSUNITS\n  70\n1\n'); // in
    // The wire in inches: 1e6 IU x (1 / 25.4) x 0.0001 per SetViewport and
    // SetUnits(INCH), printed `{:.16f}` and trimmed — Python's %.16f of the
    // same double product gives 3.9370078740157481 and 4.7244094488188981.
    expect(inches).toContain(
      ' 10\n3.9370078740157481\n 20\n-3.9370078740157481\n 30\n0\n' +
        ' 11\n4.7244094488188981\n 21\n-3.9370078740157481\n',
    );
  });

  it('plots the schematic page itself whatever the page-size choice', () => {
    // plotOneSheetDXF is handed the screen's PAGE_INFO and a scale of 1.0
    // (sch_plotter.cpp:740-741): "Page size: A" does not move a DXF.
    const a = sheetToDxf(doc, KICAD_DEFAULT, {
      color: true,
      drawingSheet: true,
      background: false,
      dxfUnits: 'mm',
      pageSizeSelect: 'A',
    });
    expect(a).toBe(dxf);
  });
});

describe('plot to PostScript', () => {
  const doc = readSchematic(parse(SCH));
  const now = new Date(2026, 8, 27, 21, 29, 36);
  const psText = sheetToPs(
    doc,
    KICAD_DEFAULT,
    { color: true, drawingSheet: true, background: false, defaultPenIU: 1524 },
    'sheet1',
    { now },
  );

  it('opens with the PS_PLOTTER DSC header, as kicad-cli writes it', () => {
    expect(
      psText.startsWith(
        '%!PS-Adobe-3.0\n%%Creator: Eeschema-PS\n%%CreationDate: Sun Sep 27 21:29:36 2026\n' +
          '%%Title: ()\n%%Pages: 1\n%%PageOrder: Ascend\n%%BoundingBox: 0 0 596 842\n' +
          '%%DocumentMedia: A4 595 842 0 () ()\n%%Orientation: Landscape\n%%EndComments\n',
      ),
    ).toBe(true);
    // The landscape rotation and the 6 mil default pen, in decimils.
    expect(psText).toContain(
      'linemode1\n82680 0 translate 90 rotate\n60 setlinewidth\n%%EndPageSetup\n',
    );
    expect(psText.endsWith('showpage\ngrestore\n%%EOF\n')).toBe(true);
  });

  it('strokes a pin the way kicad-cli does', () => {
    expect(psText).toContain(
      '0.518 0 0 setrgbcolor\n60 setlinewidth\nnewpath\n39370.1 48246.9 moveto\n39370.1 48746.9 lineto\nstroke\n',
    );
  });

  it('black-and-white output sets only black', () => {
    const bw = sheetToPs(
      doc,
      KICAD_DEFAULT,
      { color: false, drawingSheet: false, background: false },
      'bw',
    );
    // kicad-cli --black-and-white on this sheet: every setrgbcolor is 0 0 0.
    expect(new Set(bw.match(/.* setrgbcolor/g))).toEqual(new Set(['0 0 0 setrgbcolor']));
  });
});
