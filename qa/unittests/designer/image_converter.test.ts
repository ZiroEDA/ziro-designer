// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Image Converter (bitmap2component): trace a 1-bit bitmap and emit KiCad
 * artwork. The traced polygons must round-trip, the footprint parses into a
 * PcbFootprint with an fp_poly, the symbol into a LibSymbol with a filled
 * polyline, and the geometry must sit centred on the origin at the requested
 * DPI, with holes cut out of the fill.
 */
import {
  GENERATOR,
  GENERATOR_APPLICATION,
  GENERATOR_VERSION,
} from '@ziroeda/common/src/generator.js';
import { describe, it, expect } from 'vitest';
import { Reporter, RPT_SEVERITY_ERROR } from '@ziroeda/common/src/reporter.js';
import { parse } from '@ziroeda/sexpr';
import { readFootprintFile } from '@ziroeda/pcbnew';
import { readSymbolLib } from '@ziroeda/eeschema';
import { readDrawingSheet } from '@ziroeda/common/src/drawing_sheet/read.js';
import { Bitmap } from '@ziroeda/designer/src/editors/image/potrace.js';
import {
  convert,
  grayToMono,
  imageToGray,
  traceRegions,
  NO_OUTLINE_ERROR,
  OUTLINE_LAYERS,
} from '@ziroeda/designer/src/editors/image/bitmap2component.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  convertOutputSize,
  formatOutputSize,
  initialOutputSize,
  outputDpi,
  parseOutputSize,
} from '@ziroeda/designer/src/editors/image/imageSize.js';

/** A bitmap with a filled rectangle [x0,x1) × [y0,y1). */
function filledRect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Bitmap {
  const bm = new Bitmap(w, h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) bm.data[y * w + x] = 1;
  return bm;
}

const NAME = 'LOGO';

/** A file written by the real bitmap2component 10.0.5; see the data README. */
const readRef = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../data/bitmap2component/${name}`, import.meta.url)), 'utf8');

describe('tracing', () => {
  it('traces a solid square into one outline with no holes', () => {
    const bm = filledRect(24, 24, 6, 6, 18, 18);
    const regions = traceRegions(bm);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(0);
    // An axis-aligned square: 4 corner segments, each emitting a vertex + an
    // edge midpoint (potrace's corner tessellation), so ~8 points.
    expect(regions[0]!.outer.length).toBeLessThanOrEqual(12);
    expect(regions[0]!.outer.length).toBeGreaterThanOrEqual(4);
  });

  it('detects a hole inside a filled ring', () => {
    const bm = filledRect(30, 30, 4, 4, 26, 26);
    // punch an 8×8 hole in the centre
    for (let y = 11; y < 19; y++) for (let x = 11; x < 19; x++) bm.data[y * 30 + x] = 0;
    const regions = traceRegions(bm);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(1);
  });

  it('traces a filled circle (exercises the Bézier / opticurve path)', () => {
    const w = 60;
    const bm = new Bitmap(w, w);
    const cx = 30;
    const cy = 30;
    const r = 22;
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) bm.data[y * w + x] = 1;
    const regions = traceRegions(bm);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(0);
    // A circle smooths into many curve points, not a handful of corners.
    expect(regions[0]!.outer.length).toBeGreaterThan(12);
  });

  it('finds two separate blobs as two regions', () => {
    const bm = new Bitmap(40, 20);
    for (let y = 5; y < 15; y++) {
      for (let x = 4; x < 12; x++) bm.data[y * 40 + x] = 1;
      for (let x = 28; x < 36; x++) bm.data[y * 40 + x] = 1;
    }
    expect(traceRegions(bm)).toHaveLength(2);
  });
});

describe('output size (KiCad IMAGE_SIZE)', () => {
  it('reproduces the native size and round-trips to the original DPI', () => {
    // 300 px @ 300 PPI → 25.4 mm; that size exports back at 300 DPI.
    expect(initialOutputSize(300, 300, 'mm')).toBeCloseTo(25.4, 6);
    expect(initialOutputSize(300, 300, 'inch')).toBeCloseTo(1, 6);
    expect(initialOutputSize(300, 300, 'dpi')).toBe(300);
    expect(outputDpi(25.4, 300, 'mm')).toBeCloseTo(300, 6);
    expect(outputDpi(1, 300, 'inch')).toBeCloseTo(300, 6);
    expect(outputDpi(300, 300, 'dpi')).toBe(300);
  });

  it('doubling the physical size halves the export DPI (bigger artwork)', () => {
    expect(outputDpi(50.8, 300, 'mm')).toBe(150);
  });

  it('truncates the output DPI to an int, as GetOutputDPI does', () => {
    // int outputDPI = GetOriginalSizePixels() / ( m_outputSize / 25.4 ):
    // 200 px over 21 mm is 241.9 DPI, and KiCad exports at 241.
    expect(outputDpi(21, 200, 'mm')).toBe(241);
    // The same in inches, and in DPI (KiROUND, halves away from zero).
    expect(outputDpi(0.827, 200, 'inch')).toBe(241);
    expect(outputDpi(241.5, 200, 'dpi')).toBe(242);
  });

  it('never returns a DPI below 1 (std::max( 1, outputDPI ))', () => {
    // A zero or negative size divides by zero; KiCad clamps to 1 DPI rather
    // than falling back to any default, so the export is tiny, not resized.
    expect(outputDpi(0, 200, 'mm')).toBe(1);
    expect(outputDpi(-5, 200, 'mm')).toBe(1);
    expect(outputDpi(0, 200, 'inch')).toBe(1);
    expect(outputDpi(0, 0, 'mm')).toBe(1);
    expect(outputDpi(0, 200, 'dpi')).toBe(1);
  });

  it('parses a size field like wxString::ToDouble (whole string or nothing)', () => {
    expect(parseOutputSize('25.4')).toBe(25.4);
    expect(parseOutputSize('.5')).toBe(0.5);
    expect(parseOutputSize('-3')).toBe(-3);
    // A field the user has cleared, or typed junk into, is not a zero.
    expect(parseOutputSize('')).toBeNull();
    expect(parseOutputSize('  ')).toBeNull();
    expect(parseOutputSize('abc')).toBeNull();
    expect(parseOutputSize('12abc')).toBeNull();
    expect(parseOutputSize('12 ')).toBeNull();
  });

  it('converts between units keeping the physical size', () => {
    expect(convertOutputSize(25.4, 300, 'mm', 'inch')).toBeCloseTo(1, 6);
    expect(convertOutputSize(1, 300, 'inch', 'mm')).toBeCloseTo(25.4, 6);
    // 25.4 mm of 300 px is 300 DPI
    expect(convertOutputSize(25.4, 300, 'mm', 'dpi')).toBeCloseTo(300, 6);
    expect(convertOutputSize(300, 300, 'dpi', 'mm')).toBeCloseTo(25.4, 6);
  });

  it('formats with KiCad precision: mm %.1f, inch %.2f, DPI integer', () => {
    expect(formatOutputSize(25.4, 'mm')).toBe('25.4');
    expect(formatOutputSize(84.66667, 'mm')).toBe('84.7');
    expect(formatOutputSize(0, 'mm')).toBe('0.0');
    expect(formatOutputSize(1, 'inch')).toBe('1.00');
    expect(formatOutputSize(299.6, 'dpi')).toBe('300');
    // %d of KiROUND, which rounds halves away from zero — Math.round would
    // print -241 here and disagree with wxWidgets on every negative half.
    expect(formatOutputSize(241.5, 'dpi')).toBe('242');
    expect(formatOutputSize(-241.5, 'dpi')).toBe('-242');
  });
});

describe('layer choices', () => {
  it('matches KiCad bitmap2cmp order and mapping', () => {
    expect(OUTLINE_LAYERS.map((l) => l.id)).toEqual([
      'F.Cu',
      'F.SilkS',
      'F.Mask',
      'Dwgs.User',
      'Cmts.User',
      'Eco1.User',
      'Eco2.User',
      'F.Fab',
    ]);
    expect(OUTLINE_LAYERS[1]!.label).toBe('F.Silkscreen');
  });
});

describe('footprint output', () => {
  const bm = filledRect(24, 24, 6, 6, 18, 18);

  it('parses into a footprint with a filled polygon on the chosen layer', () => {
    const layer = OUTLINE_LAYERS[1]!.id; // F.SilkS
    const { text, filename } = convert(bm, {
      format: 'footprint',
      layer,
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(filename).toBe('LOGO.kicad_mod');
    const fp = readFootprintFile(parse(text));
    expect(fp).not.toBeNull();
    const polys = fp!.shapes.filter((s) => s.kind === 'poly');
    expect(polys.length).toBe(1);
    expect(polys[0]!.fill).toBe(true);
    expect(polys[0]!.layer).toBe(layer);
    expect(text).toContain(`(generator "${GENERATOR}")`);
    expect(text).toContain('(attr board_only exclude_from_pos_files exclude_from_bom)');
  });

  it('cuts a hole into the footprint fill by bridging (single fractured ring)', () => {
    const ring = filledRect(30, 30, 4, 4, 26, 26);
    for (let y = 11; y < 19; y++) for (let x = 11; x < 19; x++) ring.data[y * 30 + x] = 0;
    const regions = traceRegions(ring);
    const { text } = convert(ring, {
      format: 'footprint',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    const fp = readFootprintFile(parse(text))!;
    const poly = fp.shapes.filter((s) => s.kind === 'poly');
    // Still one fp_poly, but with the hole bridged in: more points than the
    // outline alone (outer + hole + the two bridge vertices).
    expect(poly).toHaveLength(1);
    const outerPts = regions[0]!.outer.length;
    expect(poly[0]!.pts!.length).toBeGreaterThan(outerPts);
  });

  it('honours the selected outline layer', () => {
    const layer = 'Dwgs.User';
    const { text } = convert(bm, { format: 'footprint', layer, dpiX: 300, dpiY: 300, name: NAME });
    const fp = readFootprintFile(parse(text))!;
    expect(fp.shapes.find((s) => s.kind === 'poly')!.layer).toBe(layer);
    // outputDataHeader keeps the reference/value texts on F.SilkS regardless.
    expect(text.match(/\(layer "F\.SilkS"\)/g)).toHaveLength(2);
  });

  it('centres the artwork on the origin', () => {
    const { text } = convert(bm, {
      format: 'footprint',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    const fp = readFootprintFile(parse(text))!;
    const pts = fp.shapes.find((s) => s.kind === 'poly')!.pts!;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // symmetric square → bounds centred on 0 (internal units)
    expect(Math.abs(Math.max(...xs) + Math.min(...xs))).toBeLessThan(2000);
    expect(Math.abs(Math.max(...ys) + Math.min(...ys))).toBeLessThan(2000);
  });

  it('scales with DPI: half the DPI ≈ twice the size', () => {
    const base = readFootprintFile(
      parse(
        convert(bm, { format: 'footprint', layer: 'F.SilkS', dpiX: 300, dpiY: 300, name: NAME })
          .text,
      ),
    )!;
    const big = readFootprintFile(
      parse(
        convert(bm, { format: 'footprint', layer: 'F.SilkS', dpiX: 150, dpiY: 150, name: NAME })
          .text,
      ),
    )!;
    const span = (fp: typeof base): number => {
      const xs = fp.shapes.find((s) => s.kind === 'poly')!.pts!.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(big) / span(base)).toBeGreaterThan(1.8);
    expect(span(big) / span(base)).toBeLessThan(2.2);
  });
});

describe('symbol output', () => {
  it('parses into a symbol with an outline-filled polyline', () => {
    const bm = filledRect(24, 24, 6, 6, 18, 18);
    const { text, filename } = convert(bm, {
      format: 'symbol',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(filename).toBe('LOGO.kicad_sym');
    const syms = readSymbolLib(parse(text));
    expect(syms).toHaveLength(1);
    expect(syms[0]!.libId).toBe(NAME);
    const polylines = syms[0]!.units
      .flatMap((u) => u.graphics)
      .filter((g) => g.kind === 'polyline');
    expect(polylines.length).toBe(1);
    expect(polylines[0]!.fill?.type).toBe('outline');
  });

  it('places Reference above and Value below the artwork (KiCad outputDataHeader)', () => {
    // 24 px @ 300 DPI → half-height 1.016 mm; ±(1.016 − fieldSize/2) = ±0.381.
    const bm = filledRect(24, 24, 6, 6, 18, 18);
    const { text } = convert(bm, {
      format: 'symbol',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(text).toMatch(/\(property "Reference" "#G"\s*\(at 0 0\.381 0\)/);
    expect(text).toMatch(/\(property "Value" "LOGO"\s*\(at 0 -0\.381 0\)/);
    expect(text).not.toContain('exclude_from_sim');
  });

  it('clipboard paste variant emits the bare symbol fragment (SYMBOL_PASTE_FMT)', () => {
    const bm = filledRect(24, 24, 6, 6, 18, 18);
    const { text } = convert(bm, {
      format: 'symbol',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
      paste: true,
    });
    expect(text).not.toContain('kicad_symbol_lib');
    expect(text.trimStart().startsWith('(symbol "LOGO"')).toBe(true);
  });
});

describe('postscript & drawing-sheet output', () => {
  const bm = filledRect(24, 24, 6, 6, 18, 18);

  it('emits valid EPS with a fill path', () => {
    const { text, filename } = convert(bm, {
      format: 'postscript',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(filename).toBe('LOGO.ps');
    expect(text.startsWith('%!PS-Adobe-3.0 EPSF-3.0')).toBe(true);
    expect(text).toContain('%%BoundingBox: 0 0 24 24');
    expect(text).toContain('moveto');
    expect(text).toContain('closepath fill');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('emits ONE drawing-sheet polygon item, with one (pts) per traced region', () => {
    // outputDataHeader opens `(polygon …)` once and outputOnePolygon adds a
    // `(pts …)` inside it per region, so a two-blob logo is one sheet item with
    // two contours — not two items that select and move separately. Reference:
    // qa/data/bitmap2component/kicad_twoblob_300dpi.kicad_wks, written by
    // bitmap2component 10.0.5 from the same 40×20 two-blob bitmap.
    const two = new Bitmap(40, 20);
    for (let y = 5; y < 15; y++) {
      for (let x = 4; x < 12; x++) two.data[y * 40 + x] = 1;
      for (let x = 28; x < 36; x++) two.data[y * 40 + x] = 1;
    }
    const { text } = convert(two, {
      format: 'drawingsheet',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(text.match(/\(polygon/g)).toHaveLength(1);
    expect(text.match(/\(pts/g)).toHaveLength(2);

    const sheet = readDrawingSheet(parse(text));
    const polys = sheet.items.filter((i) => i.type === 'polygon');
    expect(polys).toHaveLength(1);
    expect(polys[0]!.contours).toHaveLength(2);

    // The same shape as KiCad's own file for this bitmap.
    const ref = readDrawingSheet(parse(readRef('kicad_twoblob_300dpi.kicad_wks')));
    const refPolys = ref.items.filter((i) => i.type === 'polygon');
    expect(refPolys).toHaveLength(1);
    expect(refPolys[0]!.contours).toHaveLength(2);
  });

  it('emits a parseable drawing sheet with a polygon', () => {
    const { text, filename } = convert(bm, {
      format: 'drawingsheet',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(filename).toBe('LOGO.kicad_wks');
    const root = parse(text);
    expect(root.items[0]).toMatchObject({ kind: 'atom', value: 'kicad_wks' });
    expect(text).toContain('(polygon');
    // DS_DATA_ITEM_POLYGONS gets m_LineWidth = 0.01 in createDrawingSheetData.
    expect(text).toContain('(linewidth 0.01)');
  });

  it('EPS uses newpath/moveto with integer pixel coordinates', () => {
    const { text } = convert(bm, {
      format: 'postscript',
      layer: 'F.SilkS',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(text).toContain('newpath');
    expect(text).toMatch(/newpath\n-?\d+ -?\d+ moveto\n/);
  });
});

describe('threshold & negative', () => {
  it('negative inverts foreground/background', () => {
    // Grey ramp image: left half dark, right half light.
    const w = 20;
    const h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const v = x < w / 2 ? 40 : 220;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    const gray = imageToGray(rgba, w, h);
    const normal = grayToMono(gray, 128, false);
    const inverted = grayToMono(gray, 128, true);
    // dark pixel (x=0): foreground when normal, background when negative
    expect(normal.data[0]).toBe(1);
    expect(inverted.data[0]).toBe(0);
    // light pixel (x=w-1): opposite
    expect(normal.data[w - 1]).toBe(0);
    expect(inverted.data[w - 1]).toBe(1);
  });

  it('negates the greyscale before thresholding, as KiCad does', () => {
    // binarize(negated): fg iff (255 − gray) < th. gray 240, th 50 → 15 < 50.
    const rgba = new Uint8ClampedArray([240, 240, 240, 255]);
    const gray = imageToGray(rgba, 1, 1);
    expect(grayToMono(gray, 50, false).data[0]).toBe(0);
    expect(grayToMono(gray, 50, true).data[0]).toBe(1);
  });

  it('truncates the threshold to a whole grey level (unsigned char)', () => {
    // The default slider position, 50 of 100, is 0.5 · 255 = 127.5 in doubles;
    // binarize holds it in an unsigned char, so the comparison is against 127.
    const grey = (v: number) => imageToGray(new Uint8ClampedArray([v, v, v, 255]), 1, 1);
    expect(grayToMono(grey(127), 127.5, false).data[0]).toBe(0); // 127 < 127 is false
    expect(grayToMono(grey(126), 127.5, false).data[0]).toBe(1);
  });

  it('truncates the alpha cut too (alpha_thresh = 0.7 · truncated threshold)', () => {
    // 0.7 · 127 = 88.9 → 88, not 0.7 · 127.5 = 89.25: alpha 89 is opaque enough.
    const black = (a: number) => imageToGray(new Uint8ClampedArray([0, 0, 0, a]), 1, 1);
    expect(grayToMono(black(89), 127.5, false).data[0]).toBe(1);
    expect(grayToMono(black(88), 127.5, false).data[0]).toBe(0);
  });

  it('drops pixels that are too transparent (alpha ≤ 0.7·threshold)', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 30]); // black but nearly invisible
    const gray = imageToGray(rgba, 1, 1);
    expect(grayToMono(gray, 128, false).data[0]).toBe(0); // 30 ≤ 89.6 → background
    const opaque = imageToGray(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
    expect(grayToMono(opaque, 128, false).data[0]).toBe(1);
  });

  it('a blank bitmap reports "no outline created" and still writes the file', () => {
    // createOutputData reports at RPT_SEVERITY_ERROR when potrace found no
    // paths (bitmap2component.cpp:402-406) and ExportToBuffer then shows it in
    // a wxMessageBox captioned "Errors". This test used to assert our silence.
    //
    // The file is still written: bitmap2component 10.0.5, driven on a 10x10
    // all-white PNG, wrote a 500-byte .kicad_mod holding the header, the two
    // fp_texts and the closing paren, and no fp_poly — qa/data/bitmap2component
    // /kicad_blank10_300dpi.kicad_mod is that file.
    const bm = new Bitmap(10, 10);
    const reporter = new Reporter();
    const { text } = convert(
      bm,
      { format: 'footprint', layer: 'F.SilkS', dpiX: 300, dpiY: 300, name: NAME },
      reporter,
    );
    expect(reporter.hasMessage()).toBe(true);
    expect(reporter.lines.map((l) => l.message)).toEqual([NO_OUTLINE_ERROR]);
    expect(reporter.count(RPT_SEVERITY_ERROR)).toBe(1);
    expect(NO_OUTLINE_ERROR).toBe('No shape in black and white image to convert: no outline created.');

    const fp = readFootprintFile(parse(text));
    expect(fp).not.toBeNull();
    expect(fp!.shapes.filter((s) => s.kind === 'poly')).toHaveLength(0);
  });

  it('reports nothing when the image does have a shape', () => {
    const reporter = new Reporter();
    convert(
      filledRect(24, 24, 6, 6, 18, 18),
      { format: 'footprint', layer: 'F.SilkS', dpiX: 300, dpiY: 300, name: NAME },
      reporter,
    );
    expect(reporter.hasMessage()).toBe(false);
  });
});

describe('output size field wiring (BITMAP2CMP_PANEL::OnSizeChangeX)', () => {
  // The frame is a .tsx that qa's tsc cannot compile, so it is read as text,
  // the way canvas_props_wired.test.ts reads its pair. Crude, and still the
  // only check that sees whether the field feeds the export the way KiCad's
  // does: through m_outputSizeX, updated only when ToDouble succeeds.
  const FRAME = readFileSync(
    fileURLToPath(new URL('../../../designer/src/editors/image/ImageConverter.tsx', import.meta.url)),
    'utf8',
  );

  it('parses the size fields with ToDouble semantics, never Number(text) || 0', () => {
    expect(FRAME).toContain('parseOutputSize');
    // `Number(text) || 0` turns a cleared or half-typed field into a zero size,
    // which GetOutputDPI then exports at 1 DPI.
    expect(FRAME).not.toMatch(/Number\((?:text|outX|outY)\)\s*\|\|\s*0/);
  });

  it('keeps the export size apart from the field text (ChangeValue, not the field)', () => {
    // m_outputSizeX / m_outputSizeY, full precision, are what GetOutputDPI reads.
    expect(FRAME).toMatch(/const \[sizeX, setSizeX\] = useState/);
    expect(FRAME).toMatch(/outputDpi\(sizeX, loaded\.w, unit\)/);
    expect(FRAME).toMatch(/outputDpi\(sizeY, loaded\.h, unit\)/);
  });
});

describe("matches KiCad's own bitmap2component output", () => {
  // Every file read here was written by the installed bitmap2component 10.0.5,
  // driven through its GUI on this machine; see qa/data/bitmap2component/.
  //
  // The comparison is on the coordinate SET, not the sequence: KiCad's points
  // come out of SHAPE_POLY_SET::Fracture, which normalises winding and start
  // vertex and bridges holes its own way, and we bridge with earcut's linked
  // list. What has to agree to the last digit is the value of each coordinate,
  // which is exactly what the internal-unit quantisation decides.
  const xySet = (text: string): Set<string> => {
    const out = new Set<string>();
    for (const m of text.matchAll(/\(xy (-?[\d.]+) (-?[\d.]+)\)/g))
      out.add(`${Number(m[1])},${Number(m[2])}`);
    return out;
  };

  const square = filledRect(24, 24, 6, 6, 18, 18);

  it('footprint, 24 px square at 300 DPI', () => {
    const { text } = convert(square, {
      format: 'footprint',
      layer: 'F.Cu',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(xySet(text)).toEqual(xySet(readRef('kicad_square24_300dpi.kicad_mod')));
    // ± half of 12 px at 300 DPI, and the edge midpoints on the axes.
    expect(xySet(text)).toEqual(
      new Set(['-0.508,0.508', '0,0.508', '0.508,0.508', '0.508,0', '0.508,-0.508',
               '0,-0.508', '-0.508,-0.508', '-0.508,0']),
    );
  });

  it('footprint, the same square asked for at 2.1 mm', () => {
    // The Output Size box: 24 px over 2.1 mm truncates to 290 DPI, and the
    // half-width lands on 0.525517 mm — not the 0.525 an untruncated 290.2857
    // DPI, or unquantised millimetres, would give.
    const dpi = outputDpi(2.1, 24, 'mm');
    expect(dpi).toBe(290);
    const { text } = convert(square, {
      format: 'footprint',
      layer: 'F.Cu',
      dpiX: dpi,
      dpiY: dpi,
      name: NAME,
    });
    expect(xySet(text)).toEqual(xySet(readRef('kicad_square24_2.1mm.kicad_mod')));
    expect(text).toContain('0.525517');
    expect(text).not.toContain('0.5255172');
  });

  it('symbol, 24 px square at 300 DPI', () => {
    const { text } = convert(square, {
      format: 'symbol',
      layer: 'F.Cu',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(xySet(text)).toEqual(xySet(readRef('kicad_square24_300dpi.kicad_sym')));
  });

  it('drawing sheet, two blobs at 300 DPI (the truncation is asymmetric)', () => {
    const two = new Bitmap(40, 20);
    for (let y = 5; y < 15; y++) {
      for (let x = 4; x < 12; x++) two.data[y * 40 + x] = 1;
      for (let x = 28; x < 36; x++) two.data[y * 40 + x] = 1;
    }
    const { text } = convert(two, {
      format: 'drawingsheet',
      layer: 'F.Cu',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(xySet(text)).toEqual(xySet(readRef('kicad_twoblob_300dpi.kicad_wks')));
    // int() truncates toward zero, so the centre row is -0.001 and the two
    // edges are +0.423 and -0.424. Millimetre floats would give 0 and ±0.4233.
    expect(text).toContain('-0.001');
    expect(text).toContain('0.423');
    expect(text).toContain('-0.424');
  });

  it('ring with a hole: every coordinate KiCad emits, bridged our own way', () => {
    const ring = filledRect(30, 30, 4, 4, 26, 26);
    for (let y = 11; y < 19; y++) for (let x = 11; x < 19; x++) ring.data[y * 30 + x] = 0;
    const { text } = convert(ring, {
      format: 'footprint',
      layer: 'F.Cu',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    expect(xySet(text)).toEqual(xySet(readRef('kicad_ring30_300dpi.kicad_mod')));
  });

  it('postscript, two blobs: whole pixels, Y flipped in the page height', () => {
    const two = new Bitmap(40, 20);
    for (let y = 5; y < 15; y++) {
      for (let x = 4; x < 12; x++) two.data[y * 40 + x] = 1;
      for (let x = 28; x < 36; x++) two.data[y * 40 + x] = 1;
    }
    const { text } = convert(two, {
      format: 'postscript',
      layer: 'F.Cu',
      dpiX: 300,
      dpiY: 300,
      name: NAME,
    });
    const points = (src: string): Set<string> => {
      const out = new Set<string>();
      for (const m of src.matchAll(/(-?\d+) (-?\d+) (?:moveto|lineto)/g)) out.add(`${m[1]},${m[2]}`);
      return out;
    };
    expect(points(text)).toEqual(points(readRef('kicad_twoblob_300dpi.ps')));
  });
});
