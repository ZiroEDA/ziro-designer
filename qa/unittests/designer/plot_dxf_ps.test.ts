// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Plot to DXF and PostScript (DIALOG_PLOT_SCHEMATIC, DXF / Postscript formats):
 * the same vector plotter that drives SVG runs the schematic renderer through a
 * Canvas2D-shaped adapter, but resolves every point through the CTM so the
 * back-ends get absolute page coordinates. A schematic with a symbol and a wire
 * must produce a well-formed DXF (LWPOLYLINE entities) and PostScript (stroked
 * paths) at the page size.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { sheetToDxf, sheetToPs } from '@ziroeda/designer/src/editors/schematic/render/plot.js';
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

describe('plot to DXF', () => {
  const doc = readSchematic(parse(SCH));
  // "Export units: Millimeters", the dialog's other choice is Inches, which is
  // KiCad's default selection (m_DXF_plotUnits) and the writer's default too.
  const dxf = sheetToDxf(doc, KICAD_DEFAULT, {
    color: true,
    drawingSheet: true,
    background: false,
    dxfUnits: 'mm',
  });

  it('is a well-formed AC1015 DXF with an ENTITIES section', () => {
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1015');
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('ENTITIES');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('emits LWPOLYLINE geometry for the wire and symbol body', () => {
    const count = (dxf.match(/LWPOLYLINE/g) ?? []).length;
    expect(count).toBeGreaterThan(3);
    // True-colour (code 420) is present for coloured output.
    expect(dxf).toContain('\n420\n');
  });

  it('places geometry within the A4 landscape sheet (297 x 210 mm)', () => {
    // Every vertex X (code 10) / Y (code 20) is in millimetres inside the page.
    const lines = dxf.split('\n');
    let sawVertex = false;
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i] === '10') {
        const x = Number(lines[i + 1]);
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(298);
        sawVertex = true;
      }
      if (lines[i] === '20') {
        const y = Number(lines[i + 1]);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(211);
      }
    }
    expect(sawVertex).toBe(true);
  });

  it('honours "Export units: Millimeters" vs Inches ($INSUNITS + coordinates)', () => {
    expect(dxf).toContain('\n$INSUNITS\n70\n4\n'); // 4 = millimeters
    const inches = sheetToDxf(doc, KICAD_DEFAULT, {
      color: true,
      drawingSheet: true,
      background: false,
      dxfUnits: 'in',
    });
    expect(inches).toContain('\n$INSUNITS\n70\n1\n'); // 1 = inches
    // The A4 sheet is 297 mm ≈ 11.69 in wide, so every X stays under 12.
    // (The file is a flat code/value stream, so codes sit at even indices.)
    const lines = inches.split('\n');
    for (let i = 0; i < lines.length - 1; i += 2) {
      if (lines[i] === '10') expect(Number(lines[i + 1])).toBeLessThanOrEqual(12);
    }
  });

  it('plots onto an A4 page when the page size choice forces one', () => {
    // "Page size: A4" on an A4 schematic is a no-op scale of 1 (KiCad's
    // min(scalex, scaley)); the geometry still lands inside the sheet.
    const a4 = sheetToDxf(doc, KICAD_DEFAULT, {
      color: true,
      drawingSheet: true,
      background: false,
      dxfUnits: 'mm',
      pageSizeSelect: 'A4',
    });
    expect(a4).toContain('LWPOLYLINE');
    const lines = a4.split('\n');
    for (let i = 0; i < lines.length - 1; i += 2) {
      if (lines[i] === '10') expect(Number(lines[i + 1])).toBeLessThanOrEqual(298);
    }
  });
});

describe('plot to PostScript', () => {
  const doc = readSchematic(parse(SCH));
  const psText = sheetToPs(
    doc,
    KICAD_DEFAULT,
    { color: true, drawingSheet: true, background: false },
    'sheet1',
  );

  it('is a well-formed Adobe PostScript document', () => {
    expect(psText.startsWith('%!PS-Adobe-3.0')).toBe(true);
    expect(psText).toContain('%%BoundingBox: 0 0 842 596'); // A4 landscape in points
    expect(psText).toContain('%%Title: sheet1');
    expect(psText).toContain('showpage');
    expect(psText.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('emits stroked vector paths with colour', () => {
    expect(psText).toContain(' setlinewidth ');
    expect(psText).toContain('setrgbcolor stroke');
    expect((psText.match(/ l /g) ?? []).length).toBeGreaterThan(5);
  });

  it('black-and-white output drops the coloured wire, keeping black strokes', () => {
    const bw = sheetToPs(
      doc,
      KICAD_DEFAULT,
      { color: false, drawingSheet: false, background: false },
      'bw',
    );
    // Black strokes are present; the green wire colour (0,150,0) is converted.
    expect(bw).toContain('0.000 0.000 0.000 setrgbcolor');
    expect(bw).not.toContain('0.000 0.588 0.000 setrgbcolor');
  });
});
